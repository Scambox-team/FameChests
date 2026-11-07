//! Pinball (zakładka Gry): nagrody w groszach za wynik. Grę liczy przeglądarka (`web/src/features/pinball/`), więc serwer
//! nie wierzy jej na słowo: czas gry mierzy sam (`start` -> `finish`), wiarygodny wynik ma sufit na sekundę, a wypłata ma
//! limit na grę i na dobę (`pinball` w game.json). Fałszerz może więc co najwyżej wyciągnąć dzienny limit.
//! Za wyjątkowy wynik jest też karta w wariancie Synthwave (`card_tiers`): im wyższy wynik, tym wyższa rzadkość,
//! losowana ze skrzynek, które dziś są w sklepie (rotacja), a gdy ich nie ma - z domyślnych (stałych i sezonowych).

use std::collections::BTreeSet;

use axum::extract::State;
use rand::seq::SliceRandom;
use serde::Deserialize;
use serde_json::json;

use super::{ok, JsonBody};
use crate::auth::Me;
use crate::catalog::Catalog;
use crate::data::g;
use crate::db::{lock_me, now, Conn};
use crate::error::Res;
use crate::game::{add_state, balance, insert_for};
use crate::state::AppState;

/// Ile groszy z Pinballa gracz dostał w ostatnich 24 h
async fn earned_today(c: &mut Conn, uid: i64) -> sqlx::Result<i64> {
    sqlx::query_scalar::<_, i64>("SELECT COALESCE(SUM(reward), 0)::BIGINT FROM pinball_runs WHERE user_id = $1 AND finished_at > $2")
        .bind(uid)
        .bind(now() - 86400.0)
        .fetch_one(c)
        .await
}

/// Ile kart z Pinballa gracz dostał w ostatnich 24 h
async fn cards_today(c: &mut Conn, uid: i64) -> sqlx::Result<i64> {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pinball_runs WHERE user_id = $1 AND card <> '' AND finished_at > $2")
        .bind(uid)
        .bind(now() - 86400.0)
        .fetch_one(c)
        .await
}

fn info(earned: i64, cards: i64) -> serde_json::Value {
    let g = g();
    let cfg = &g.pinball;
    let tiers: Vec<_> = cfg
        .card_tiers
        .iter()
        .map(|t| json!({"score": t.score, "rarity": t.rarity, "name": g.rarities.get(&t.rarity).map(|r| r.name.as_str()).unwrap_or("")}))
        .collect();
    json!({"pointsPerGr": cfg.points_per_gr, "maxPerRun": cfg.max_per_run, "maxPerDay": cfg.max_per_day,
           "left": (cfg.max_per_day - earned).max(0), "cardVariant": cfg.card_variant, "cardTiers": tiers,
           "cardsLeft": (cfg.cards_per_day - cards).max(0)})
}

/// Karta za wynik: rzadkość z najwyższego osiągniętego progu, losowa ze skrzynek w rotacji (dziś w sklepie), a gdy
/// nie ma w nich takiej rzadkości - z domyślnych (stałych i sezonowych); brak karty = niższa rzadkość.
fn pick_card(cat: &Catalog, score: i64) -> Option<String> {
    let tiers = &g().pinball.card_tiers;
    let top = tiers.iter().rposition(|t| score >= t.score)?;
    let pool = |rarity: &str, rotation: bool| -> Vec<String> {
        cat.crates
            .values()
            .filter(|c| !c.special && if rotation { c.shop } else { c.sold() })
            .flat_map(|c| c.people.iter())
            .filter(|pid| cat.people.get(*pid).is_some_and(|p| p.rarity == rarity && !p.is_special()))
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    };
    for tier in tiers[..=top].iter().rev() {
        for rotation in [true, false] {
            if let Some(pid) = pool(&tier.rarity, rotation).choose(&mut rand::thread_rng()) {
                return Some(pid.clone());
            }
        }
    }
    None
}

/// Wynik, który da się zdobyć w `secs` sekund gry (z zapasem na jackpot)
fn plausible(score: i64, secs: f64) -> bool {
    let cfg = &g().pinball;
    (score as f64) <= secs * cfg.max_points_per_second + cfg.slack_points as f64
}

/// Nagroda w groszach: punkty / `points_per_gr`, najwyżej `max_per_run` i tyle, ile zostało z dziennego limitu
fn reward_for(score: i64, left_today: i64) -> i64 {
    let cfg = &g().pinball;
    (score.max(0) / cfg.points_per_gr.max(1)).min(cfg.max_per_run).min(left_today.max(0))
}

/// Ustawienia i ile gracz może jeszcze dziś zarobić
pub async fn pinball_status(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    let earned = earned_today(&mut c, me.id).await?;
    ok(info(earned, cards_today(&mut c, me.id).await?))
}

/// Początek gry: serwer zapisuje czas (jedna otwarta gra na gracza)
pub async fn pinball_start(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    sqlx::query("DELETE FROM pinball_runs WHERE user_id = $1 AND finished_at = 0").bind(me.id).execute(&mut *tx).await?;
    let id: i64 = sqlx::query_scalar("INSERT INTO pinball_runs (user_id, started_at) VALUES ($1, $2) RETURNING id")
        .bind(me.id)
        .bind(now())
        .fetch_one(&mut *tx)
        .await?;
    let earned = earned_today(&mut tx, me.id).await?;
    let cards = cards_today(&mut tx, me.id).await?;
    tx.commit().await?;
    let mut v = info(earned, cards);
    v["run"] = json!(id);
    ok(v)
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Finish {
    run: i64,
    score: i64,
}

/// Koniec gry: wypłata, jeśli gra trwała dość długo, wynik jest wiarygodny i jest jeszcze dzienny limit
pub async fn pinball_finish(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<Finish>) -> Res {
    let cfg = &g().pinball;
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let started: Option<f64> =
        sqlx::query_scalar("SELECT started_at FROM pinball_runs WHERE id = $1 AND user_id = $2 AND finished_at = 0")
            .bind(req.run)
            .bind(me.id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(started) = started else { return ok(json!({"reward": 0, "reason": "no_run"})) };
    let secs = now() - started;
    let earned = earned_today(&mut tx, me.id).await?;
    let (reward, reason) = if secs < cfg.min_seconds {
        (0, "too_short")
    } else if !plausible(req.score, secs) {
        (0, "implausible")
    } else if earned >= cfg.max_per_day {
        (0, "daily_limit")
    } else {
        (reward_for(req.score, cfg.max_per_day - earned), "ok")
    };
    // karta za wyjątkowy wynik: tylko przy wiarygodnej, dość długiej grze i w dziennym limicie kart
    let cards = cards_today(&mut tx, me.id).await?;
    let cat = st.cat();
    let card_pid = if matches!(reason, "ok" | "daily_limit") && cards < cfg.cards_per_day { pick_card(&cat, req.score) } else { None };
    sqlx::query("UPDATE pinball_runs SET finished_at = $1, score = $2, reward = $3, card = $4 WHERE id = $5")
        .bind(now())
        .bind(req.score.max(0))
        .bind(reward)
        .bind(card_pid.as_deref().unwrap_or(""))
        .bind(req.run)
        .execute(&mut *tx)
        .await?;
    if reward > 0 {
        add_state(&mut tx, me.id, "balance", reward).await?;
    }
    let card = match &card_pid {
        Some(pid) => {
            let item = insert_for(&mut tx, &cat, me.id, me.hidden_from_ranking(), pid, &cfg.card_variant, "pinball").await?;
            let p = &cat.people[pid];
            Some(json!({"id": item.id, "person": pid, "variant": cfg.card_variant, "name": p.name, "rarity": p.rarity}))
        }
        None => None,
    };
    let bal = balance(&mut tx, me.id).await?;
    tx.commit().await?;
    let mut v = info(earned + reward, cards + card.is_some() as i64);
    v["card"] = json!(card);
    v["reward"] = json!(reward);
    v["reason"] = json!(reason);
    v["balance"] = json!(bal);
    ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reward_is_capped_per_run_and_per_day() {
        let cfg = &g().pinball;
        assert_eq!(reward_for(5_000, 10_000), 5_000 / cfg.points_per_gr);
        assert_eq!(reward_for(i64::MAX / 2, i64::MAX), cfg.max_per_run);
        assert_eq!(reward_for(1_000_000, 40), 40);
        assert_eq!(reward_for(-5, 100), 0);
        assert_eq!(reward_for(1_000_000, 0), 0);
    }

    #[test]
    fn card_rarity_grows_with_the_score() {
        let cat = crate::catalog::build(&[], &[]);
        let tiers = &g().pinball.card_tiers;
        assert!(tiers.windows(2).all(|w| w[0].score < w[1].score), "progi rosnąco");
        assert!(pick_card(&cat, tiers[0].score - 1).is_none());
        let order = |pid: &str| g().rarities.get_index_of(&cat.people[pid].rarity).unwrap();
        let low = pick_card(&cat, tiers[0].score).expect("karta za pierwszy próg");
        assert_eq!(cat.people[&low].rarity, tiers[0].rarity);
        // najwyższy próg daje kartę nie gorszą niż najniższy
        let high = pick_card(&cat, tiers.last().unwrap().score).expect("karta za najwyższy próg");
        assert!(order(&high) >= order(&low));
        assert!(!cat.people[&high].is_special());
    }

    #[test]
    fn pinball_variant_is_real_and_dropped_outside_crates() {
        let v = g().pinball.card_variant.clone();
        assert!(g().is_variant(&v) && g().variant(&v).extra_source.as_deref() == Some("pinball"));
    }

    #[test]
    fn score_must_fit_the_play_time() {
        assert!(plausible(30_000, 60.0));
        assert!(!plausible(10_000_000, 60.0));
        assert!(!plausible(100_000, 1.0));
    }
}
