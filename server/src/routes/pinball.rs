//! Pinball (zakładka Gry): nagrody w groszach za wynik. Grę liczy przeglądarka (`web/src/features/pinball/core.ts`), ale serwer
//! nie wierzy jej na słowo: przy starcie losuje ziarno gry, a przy końcu dostaje tylko zapis wciśnięć (tick + zdarzenie) i
//! ODTWARZA całą grę (`pinball_sim.rs`, ten sam deterministyczny rdzeń w Rust), sam licząc punkty. Wynik, który gracz zobaczył,
//! nie ma znaczenia - liczy się wynik serwera. Czas sprawdza się też zegarem: gra nie może trwać krócej niż jej zapis (ticki).
//! Wypłata nie ma limitu na grę, na dobę ani na liczbę kart (`pinball` w game.json); grosze mnoży poziom stołu
//! (`level_reward_mult`: im wyższy poziom, tym więcej za punkt, ostatni 2x).
//! Za wyjątkowy wynik jest też karta w wariancie Synthwave (`card_tiers`): im wyższy wynik, tym wyższa rzadkość,
//! losowana ze skrzynek, które dziś są w sklepie (rotacja), a gdy ich nie ma - z domyślnych (stałych i sezonowych).
//! `pick_card` z tym samym wzorem używa też Snake (`snake.rs`, wariant Pikselowa).

use std::collections::BTreeSet;

use axum::extract::State;
use rand::seq::SliceRandom;
use serde::Deserialize;
use serde_json::json;

use super::{ok, JsonBody};
use crate::auth::Me;
use crate::catalog::Catalog;
use crate::data::{g, CardTier};
use crate::db::{lock_me, now};
use crate::error::{bad, Res};
use crate::game::{add_state, balance, insert_for};
use crate::pinball_sim::{self, TICK};
use crate::state::AppState;

/// Progi kart z nazwami rzadkości (dla przeglądarki)
pub fn tiers_json(tiers: &[CardTier]) -> Vec<serde_json::Value> {
    let g = g();
    tiers
        .iter()
        .map(|t| json!({"score": t.score, "rarity": t.rarity, "name": g.rarities.get(&t.rarity).map(|r| r.name.as_str()).unwrap_or("")}))
        .collect()
}

fn info() -> serde_json::Value {
    let g = g();
    let cfg = &g.pinball;
    json!({"pointsPerGr": cfg.points_per_gr, "cardVariant": cfg.card_variant, "cardTiers": tiers_json(&cfg.card_tiers),
           "levelMults": cfg.level_reward_mult})
}

/// Karta za wynik: rzadkość z najwyższego osiągniętego progu, losowa ze skrzynek w rotacji (dziś w sklepie), a gdy
/// nie ma w nich takiej rzadkości - z domyślnych (stałych i sezonowych); brak karty = niższa rzadkość.
pub fn pick_card(cat: &Catalog, tiers: &[CardTier], score: i64) -> Option<String> {
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

/// Nagroda w groszach: punkty / `points_per_gr` razy mnożnik poziomu (`level_reward_mult`), bez limitu
fn reward_for(score: i64, level: usize) -> i64 {
    let cfg = &g().pinball;
    ((score.max(0) as f64 / cfg.points_per_gr.max(1) as f64) * cfg.reward_mult(level)).floor() as i64
}

/// Ustawienia nagród (dla przeglądarki)
pub async fn pinball_status(Me(_): Me) -> Res {
    ok(info())
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Start {
    level: usize,
}

/// Początek gry: serwer zapisuje czas i losuje ziarno (jedna otwarta gra na gracza). Bez ziarna od serwera nie da się
/// wyliczyć nagrody, więc gracz nie może przygotować sobie „dobrej” gry wcześniej.
pub async fn pinball_start(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<Start>) -> Res {
    let level = req.level.max(1);
    if level > pinball_sim::level_count() {
        return bad("Nie ma takiego poziomu");
    }
    let seed: u32 = rand::random();
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    sqlx::query("DELETE FROM pinball_runs WHERE user_id = $1 AND finished_at = 0").bind(me.id).execute(&mut *tx).await?;
    let id: i64 = sqlx::query_scalar("INSERT INTO pinball_runs (user_id, started_at, seed, level) VALUES ($1, $2, $3, $4) RETURNING id")
        .bind(me.id)
        .bind(now())
        .bind(i64::from(seed))
        .bind(level as i32)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    let mut v = info();
    v["run"] = json!(id);
    v["seed"] = json!(seed);
    ok(v)
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Finish {
    run: i64,
    /// zapis gry: naprzemiennie tick i kod zdarzenia (`INPUT_CODES` w core.ts)
    log: Vec<u64>,
    /// ile ticków trwała gra według przeglądarki (tylko do porównania w logu; liczy się odtworzenie)
    ticks: u64,
}

/// Koniec gry: serwer odtwarza zapis i sam liczy wynik; płaci, jeśli gra trwała dość długo i nie szybciej niż w prawdziwym czasie
pub async fn pinball_finish(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<Finish>) -> Res {
    let cfg = &g().pinball;
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let run: Option<(f64, i64, i32)> =
        sqlx::query_as("SELECT started_at, seed, level FROM pinball_runs WHERE id = $1 AND user_id = $2 AND finished_at = 0")
            .bind(req.run)
            .bind(me.id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((started, seed, level)) = run else { return ok(json!({"reward": 0, "reason": "no_run"})) };
    let elapsed = now() - started;
    // odtwarzanie to praca dla procesora (do minuty gry na milisekundy, ale zapis bywa długi) - poza wątkami asynchronicznymi
    let (log, seed32, level_n) = (req.log, seed as u32, level.max(1) as usize);
    let outcome = tokio::task::spawn_blocking(move || pinball_sim::replay(level_n, seed32, &log)).await.ok().flatten();
    let (score, reward, reason) = match outcome {
        None => (0, 0, "invalid"),
        Some(o) if !o.over => (o.score.max(0), 0, "invalid"),
        Some(o) => {
            if u64::from(o.ticks) != req.ticks {
                tracing::warn!(user = me.id, claimed = req.ticks, ticks = o.ticks, level, "pinball: przeglądarka i serwer policzyły różną długość gry");
            }
            let secs = f64::from(o.ticks) * TICK;
            let score = o.score.max(0);
            if secs < cfg.min_seconds {
                (score, 0, "too_short")
            } else if elapsed + 3.0 < secs * 0.9 {
                // zapis jest dłuższy niż czas, który naprawdę minął: gra nie mogła się odbyć w prawdziwym czasie
                (score, 0, "implausible")
            } else {
                (score, reward_for(score, level_n), "ok")
            }
        }
    };
    // karta za wyjątkowy wynik: tylko przy poprawnie odtworzonej i dość długiej grze (bez limitu na dobę)
    let cat = st.cat();
    let card_pid = if reason == "ok" { pick_card(&cat, &cfg.card_tiers, score) } else { None };
    sqlx::query("UPDATE pinball_runs SET finished_at = $1, score = $2, reward = $3, card = $4, verified = $6 WHERE id = $5")
        .bind(now())
        .bind(score)
        .bind(reward)
        .bind(card_pid.as_deref().unwrap_or(""))
        .bind(req.run)
        .bind(i32::from(reason == "ok"))
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
    let mut v = info();
    v["card"] = json!(card);
    v["reward"] = json!(reward);
    v["reason"] = json!(reason);
    v["score"] = json!(score);
    v["balance"] = json!(bal);
    ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reward_has_no_cap() {
        let per = g().pinball.points_per_gr;
        assert_eq!(reward_for(5_000, 1), 5_000 / per);
        assert_eq!(reward_for(100_000_000, 1), 100_000_000 / per);
        assert_eq!(reward_for(-5, 1), 0);
    }

    #[test]
    fn higher_levels_pay_more_up_to_double() {
        let cfg = &g().pinball;
        assert_eq!(cfg.level_reward_mult.len(), pinball_sim::level_count());
        assert!(cfg.level_reward_mult.windows(2).all(|w| w[0] < w[1]), "mnożniki rosnąco");
        assert_eq!(cfg.reward_mult(1), 1.0);
        assert_eq!(cfg.reward_mult(pinball_sim::level_count()), 2.0);
        assert_eq!(reward_for(100_000, 5), 2 * reward_for(100_000, 1));
        assert_eq!(cfg.reward_mult(99), 2.0);
    }

    #[test]
    fn card_rarity_grows_with_the_score() {
        let cat = crate::catalog::build(&[], &[]);
        let tiers = &g().pinball.card_tiers;
        assert!(tiers.windows(2).all(|w| w[0].score < w[1].score), "progi rosnąco");
        assert!(pick_card(&cat, tiers, tiers[0].score - 1).is_none());
        let order = |pid: &str| g().rarities.get_index_of(&cat.people[pid].rarity).unwrap();
        let low = pick_card(&cat, tiers, tiers[0].score).expect("karta za pierwszy próg");
        assert_eq!(cat.people[&low].rarity, tiers[0].rarity);
        // najwyższy próg daje kartę nie gorszą niż najniższy
        let high = pick_card(&cat, tiers, tiers.last().unwrap().score).expect("karta za najwyższy próg");
        assert!(order(&high) >= order(&low));
        assert!(!cat.people[&high].is_special());
    }

    #[test]
    fn pinball_variant_is_real_and_dropped_outside_crates() {
        let v = g().pinball.card_variant.clone();
        assert!(g().is_variant(&v) && g().variant(&v).extra_source.as_deref() == Some("pinball"));
    }
}
