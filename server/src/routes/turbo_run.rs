//! Super Turbo Run 3D (zakładka Gry -> Gry Super Turbo): bieg po tunelu liczy się w przeglądarce (`three/runScene.ts`).
//! Serwer wypłaca grosze za DYSTANS (metry biegu), tak jak Snake za jabłka: `per_100m` gr za każde 100 m od `min_dist` metrów,
//! bez limitu na grę i na dobę (klucze `run_reward_*` w `state`, ustawienia w panelu admina -> Gry).
//! Za wysoki dystans jest też karta w wariancie Gamingowa RGB (`turbo.runTiers` w game.json, jak w Pinballu; BEZ limitu kart, `turbo_card`,
//! wspólne z Snake 3D, który ma własne progi `turbo.snakeTiers`). Dystansu z przeglądarki serwer NIE przyjmuje: przy starcie losuje
//! ziarno tunelu (bilet `TICKETS` w pamięci procesu, jednorazowy), po biegu dostaje zapis klawiszy i sam ODTWARZA bieg (`run_sim`),
//! licząc dystans do chwili śmierci; zapis dłuższy niż czas, który naprawdę minął (zegar serwera, tolerancja 10% + 3 s), nie daje
//! nic, a dystans jednej gry jest ucinany do `MAX_DIST` metrów. Zarobek dnia gracza: `user_state` `run_day` / `run_today`.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use axum::extract::State;
use serde::Deserialize;
use serde_json::json;

use super::snake::{put_setting, setting, today};
use crate::catalog::Catalog;
use crate::data::{g, CardTier};
use crate::game::insert_for;
use super::{ok, JsonBody};
use crate::auth::{Admin, Me};
use crate::db::{lock_me, Conn};
use crate::error::{bad, Res};
use crate::game::{add_state, get_state, log_admin, set_state};
use crate::live::Live;
use crate::state::AppState;
use super::snake::CommitRequest;

/// Nagroda: (klucz w `state`, pole formularza, wartość domyślna, największa dozwolona)
pub const REWARD: &[(&str, &str, i64, i64)] = &[
    ("run_reward_per_100m", "per100m", 12, 1000),
    ("run_reward_min_dist", "minDist", 200, 100_000),
];
/// Najszybszy możliwy bieg: prędkość tunelu rośnie do 46 m/s, z turbem x1,35 (około 62 m/s); zapas na skoki i start
/// Największy dystans jednej gry (ok. 5 minut najszybszego biegu)
const MAX_DIST: i64 = 20_000;

/// bilety biegów: gracz -> ziarna tunelu wydawane odcinkami (`live.rs`)
static TICKETS: LazyLock<Mutex<HashMap<i64, Live>>> = LazyLock::new(Default::default);

struct Reward {
    per_100m: i64,
    min_dist: i64,
}

async fn reward_cfg(c: &mut Conn) -> sqlx::Result<Reward> {
    let mut v = [0i64; 2];
    for (i, (key, _, default, _)) in REWARD.iter().enumerate() {
        v[i] = setting(c, key, *default).await?;
    }
    Ok(Reward { per_100m: v[0], min_dist: v[1] })
}

async fn earned_today(c: &mut Conn, uid: i64) -> sqlx::Result<i64> {
    let st = get_state(c, uid).await?;
    Ok(if st.get("run_day").copied() == Some(today()) { st.get("run_today").copied().unwrap_or(0) } else { 0 })
}

/// Nagroda za dystans w metrach (bez limitu na grę i na dobę; dystans i tak jest ucinany do `MAX_DIST`)
fn reward_for(r: &Reward, dist: i64) -> i64 {
    if r.per_100m <= 0 || dist < r.min_dist.max(1) {
        return 0;
    }
    dist * r.per_100m / 100
}

/// Czy taki dystans dało się przebiec w tym czasie
/// Czy zapis tylu kroków gry mógł powstać w tym czasie (bieg nie może trwać krócej niż jego zapis)
fn plausible(ticks: u64, elapsed_secs: f64) -> bool {
    elapsed_secs + 3.0 >= ticks as f64 * crate::run_sim::TICK * 0.9
}

fn cfg_json(r: &Reward, today: i64) -> serde_json::Value {
    let t = &g().turbo;
    json!({"per100m": r.per_100m, "minDist": r.min_dist, "today": today,
           "cardVariant": t.card_variant,
           "cardTiers": super::pinball::tiers_json(&t.run_tiers)})
}

/// Karta RGB za wynik w grze Super Turbo (progi `tiers`: dystans albo jabłka), bez limitu na dobę.
/// Wołać w transakcji gracza (po `lock_me`). None = za niski wynik albo nie ma karty do wylosowania.
pub async fn turbo_card(c: &mut Conn, cat: &Catalog, me: &crate::auth::User, tiers: &[CardTier], score: i64) -> sqlx::Result<Option<serde_json::Value>> {
    let Some(pid) = super::pinball::pick_card(cat, tiers, score) else { return Ok(None) };
    let variant = &g().turbo.card_variant;
    let item = insert_for(c, cat, me.id, me.hidden_from_ranking(), &pid, variant, "turbo").await?;
    let p = &cat.people[&pid];
    Ok(Some(json!({"id": item.id, "person": pid, "variant": variant, "name": p.name, "rarity": p.rarity})))
}

/// Nagroda (i zarobek gracza dziś) dla strony gry
pub async fn run_config(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    let r = reward_cfg(&mut c).await?;
    let today = earned_today(&mut c, me.id).await?;
    ok(json!({"reward": cfg_json(&r, today)}))
}

pub async fn run_start(Me(me): Me) -> Res {
    let mut t = TICKETS.lock().unwrap_or_else(|e| e.into_inner());
    t.retain(|_, l| l.at.elapsed().as_secs() < 3 * 3600);
    let live = Live::new(crate::run_sim::SEG, crate::run_sim::TICK, 2);
    let (seeds, seg) = (live.released(), live.seg);
    t.insert(me.id, live);
    ok(json!({"ok": true, "seeds": seeds, "seg": seg}))
}

/// W trakcie biegu: zatwierdza zapis do początku odcinka i wydaje kolejne ziarna tunelu (`live.rs`)
pub async fn run_commit(Me(me): Me, JsonBody(req): JsonBody<CommitRequest>) -> Res {
    let mut t = TICKETS.lock().unwrap_or_else(|e| e.into_inner());
    let Some(live) = t.get_mut(&me.id) else { return bad("Gra nie została rozpoczęta") };
    match live.commit(req.upto, &req.log) {
        Ok(seeds) => ok(json!({"seeds": seeds})),
        Err(why) => {
            tracing::warn!(user = me.id, why, "run: odrzucony odcinek biegu");
            t.remove(&me.id);
            bad("Nieprawidłowy zapis gry")
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct FinishRequest {
    /// reszta zapisu biegu po ostatnim zatwierdzonym odcinku: naprzemiennie numer kroku i kod klawisza (`INPUTS` w runCore.ts)
    log: Vec<i64>,
    /// liczba kroków według przeglądarki (tylko do porównania w logu; liczy się odtworzenie)
    ticks: u64,
}

/// Koniec gry: grosze za dystans (w limicie gry i dnia). Bilet jest jednorazowy.
pub async fn run_finish(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<FinishRequest>) -> Res {
    let started = TICKETS.lock().unwrap_or_else(|e| e.into_inner()).remove(&me.id);
    let Some(live) = started else { return bad("Gra nie została rozpoczęta") };
    let started = live.at;
    let Some((log, seeds)) = live.finish(&req.log) else { return bad("Nieprawidłowy zapis gry") };
    if log.iter().any(|v| *v < 0) {
        return bad("Nieprawidłowy zapis gry");
    }
    let log: Vec<u64> = log.into_iter().map(|v| v as u64).collect();
    // serwer odtwarza bieg z ziaren i zapisu klawiszy (praca dla procesora - poza wątkami asynchronicznymi) i sam liczy dystans
    let outcome = tokio::task::spawn_blocking(move || crate::run_sim::replay(&seeds, &log)).await.ok().flatten();
    let Some(o) = outcome else { return bad("Nieprawidłowy zapis gry") };
    if o.ticks != req.ticks {
        tracing::warn!(user = me.id, claimed = req.ticks, ticks = o.ticks, "run: przeglądarka i serwer policzyły różną długość biegu");
    }
    if !plausible(o.ticks, started.elapsed().as_secs_f64()) {
        return bad("Nieprawidłowy wynik");
    }
    let distance = (o.dist.max(0.0).floor() as i64).min(MAX_DIST);
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    super::game_rankings::record_score(&mut tx, me.id, "run", distance).await?;
    let r = reward_cfg(&mut tx).await?;
    let earned = earned_today(&mut tx, me.id).await?;
    let reward = reward_for(&r, distance);
    if reward > 0 {
        add_state(&mut tx, me.id, "balance", reward).await?;
        add_state(&mut tx, me.id, "earned", reward).await?;
        set_state(&mut tx, me.id, "run_day", today()).await?;
        set_state(&mut tx, me.id, "run_today", earned + reward).await?;
    }
    let card = turbo_card(&mut tx, &st.cat(), &me, &g().turbo.run_tiers, distance).await?;
    super::piggy::add(&mut tx, me.id, super::piggy::Ev::Game(reward)).await?;
    let state = get_state(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({"distance": distance, "reward": reward, "today": earned + reward, "card": card, "state": state}))
}

/// Panel admina (JSON): pola nagrody (`per100m`, `minDist`); odpowiedź = aktualne ustawienia
pub async fn admin_run_save(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<serde_json::Map<String, serde_json::Value>>) -> Res {
    let mut tx = st.db.begin().await?;
    let mut log = Vec::new();
    for (key, field, _, max) in REWARD {
        let Some(v) = req.get(*field) else { continue };
        let n = v.as_i64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()));
        let Some(n) = n else { return bad("Nagroda: podaj liczby całkowite") };
        if !(0..=*max).contains(&n) {
            return bad(format!("Nagroda: wartość od 0 do {max}"));
        }
        put_setting(&mut tx, key, n).await?;
        log.push(format!("{field}={n}"));
    }
    if !log.is_empty() {
        log_admin(&mut tx, &me, "run", None, &format!("nagroda: {}", log.join(" "))).await?;
    }
    let r = reward_cfg(&mut tx).await?;
    tx.commit().await?;
    ok(json!({"reward": cfg_json(&r, 0)}))
}

/// Ustawienia nagrody dla panelu admina
pub async fn admin_run(State(st): State<AppState>, Admin(_me): Admin) -> Res {
    let mut c = st.db.acquire().await?;
    let r = reward_cfg(&mut c).await?;
    ok(json!({"reward": cfg_json(&r, 0)}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reward_grows_with_distance() {
        let r = Reward { per_100m: 12, min_dist: 200 };
        assert_eq!(reward_for(&r, 199), 0);
        assert_eq!(reward_for(&r, 200), 24);
        assert_eq!(reward_for(&r, 1_000), 120);
        assert_eq!(reward_for(&r, 10_000), 1_200);   // bez limitu na grę
        assert_eq!(reward_for(&Reward { per_100m: 0, ..r }, 1_000), 0);
    }

    #[test]
    fn turbo_variant_drops_outside_crates_and_tiers_grow() {
        let t = &g().turbo;
        assert!(g().is_variant(&t.card_variant) && g().variant(&t.card_variant).extra_source.as_deref() == Some("turbo"));
        for tiers in [&t.snake_tiers, &t.run_tiers] {
            assert!(tiers.windows(2).all(|w| w[0].score < w[1].score), "progi rosnąco");
        }
        let cat = crate::catalog::build(&[], &[]);
        assert!(super::super::pinball::pick_card(&cat, &t.run_tiers, t.run_tiers[0].score).is_some());
    }

    #[test]
    fn run_must_fit_in_the_elapsed_time() {
        assert!(plausible(0, 0.0));
        assert!(plausible(120 * 60, 60.0)); // minuta biegu w minutę
        assert!(plausible(120 * 60, 52.0)); // tolerancja 10% + 3 s
        assert!(!plausible(120 * 60, 40.0));
        assert!(!plausible(120 * 600, 300.0));
    }
}
