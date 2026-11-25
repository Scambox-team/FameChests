//! ScamRooms (horror 3D, zakładka Gry): stała nagroda za PRZEJŚCIE gry - zebranie wszystkich kaset i wyjście z lasu: `euro.scamroomsGr` groszy
//! i `euro.scamroomsEuro` euro (game.json). Gra liczy się w przeglądarce (nie ma deterministycznego rdzenia jak Pinball), więc nagrodę
//! ogranicza to, co serwer może sprawdzić sam: bilet z `/start` (jednorazowy, zegar serwera), najkrótszy czas przejścia
//! (`scamroomsMinSeconds`) i najwyżej `scamroomsDaily` nagród na dobę. Fałszerz może więc zdobyć co najwyżej tyle, ile uczciwy gracz
//! przechodzący grę kilka razy dziennie - nie więcej. Odtwarzanie gry po stronie serwera dopisać dopiero razem z rdzeniem deterministycznym.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use axum::extract::State;
use serde::Deserialize;
use serde_json::json;

use super::snake::today;
use super::{ok, JsonBody};
use crate::auth::Me;
use crate::data::g;
use crate::db::lock_me;
use crate::error::{bad, Res};
use crate::game::{add_euro, add_state, get_state, set_state};
use crate::state::AppState;

/// Ile kaset jest w grze (musi się zgadzać z `TAPES` w three/horrorScene.ts)
pub const TAPES: i64 = 6;

/// bilety rozpoczętych gier: gracz -> początek (jedna gra naraz, nowy start unieważnia poprzedni)
static TICKETS: LazyLock<Mutex<HashMap<i64, Instant>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub async fn scamrooms_start(Me(me): Me) -> Res {
    let mut t = TICKETS.lock().unwrap_or_else(|e| e.into_inner());
    t.retain(|_, at| at.elapsed().as_secs() < 3 * 3600);
    t.insert(me.id, Instant::now());
    ok(json!({"ok": true}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Finish {
    /// zebrane kasety i czy gracz wyszedł z lasu (przejście gry)
    tapes: i64,
    escaped: bool,
}

/// Czy taka gra kwalifikuje się do nagrody: przejście z kompletem kaset, nie szybciej niż `min_seconds`
pub fn qualifies(tapes: i64, escaped: bool, elapsed: f64, min_seconds: f64) -> bool {
    escaped && tapes >= TAPES && elapsed >= min_seconds
}

pub async fn scamrooms_finish(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<Finish>) -> Res {
    let started = TICKETS.lock().unwrap_or_else(|e| e.into_inner()).remove(&me.id);
    let Some(at) = started else { return ok(json!({"reward": 0, "euro": 0, "reason": "no_run"})) };
    let cfg = &g().euro;
    if !qualifies(req.tapes, req.escaped, at.elapsed().as_secs_f64(), cfg.scamrooms_min_seconds) {
        return ok(json!({"reward": 0, "euro": 0, "reason": if req.escaped { "too_fast" } else { "not_finished" }}));
    }
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let state = get_state(&mut tx, me.id).await?;
    let day = today();
    let done = if state.get("scamrooms_day").copied() == Some(day) { state.get("scamrooms_today").copied().unwrap_or(0) } else { 0 };
    if done >= cfg.scamrooms_daily {
        return ok(json!({"reward": 0, "euro": 0, "reason": "daily_limit", "daily": cfg.scamrooms_daily}));
    }
    set_state(&mut tx, me.id, "scamrooms_day", day).await?;
    set_state(&mut tx, me.id, "scamrooms_today", done + 1).await?;
    add_state(&mut tx, me.id, "balance", cfg.scamrooms_gr).await?;
    add_state(&mut tx, me.id, "earned", cfg.scamrooms_gr).await?;
    add_euro(&mut tx, me.id, cfg.scamrooms_euro).await?;
    super::piggy::add(&mut tx, me.id, super::piggy::Ev::Game(cfg.scamrooms_gr)).await?;
    let state = get_state(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({"reward": cfg.scamrooms_gr, "euro": cfg.scamrooms_euro, "reason": "ok", "state": state}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_full_escape_after_min_time_pays() {
        assert!(qualifies(TAPES, true, 300.0, 120.0));
        assert!(!qualifies(TAPES - 1, true, 300.0, 120.0), "brakuje kaset");
        assert!(!qualifies(TAPES, false, 300.0, 120.0), "nie wyszedł z lasu");
        assert!(!qualifies(TAPES, true, 30.0, 120.0), "za szybko");
    }

    #[test]
    fn reward_config_is_sane() {
        let c = &g().euro;
        assert_eq!(c.scamrooms_gr, 2000);
        assert!(c.scamrooms_euro > 0 && c.scamrooms_euro < c.scamrooms_gr, "euro warte więcej niż grosze");
        assert!(c.scamrooms_daily >= 1 && c.scamrooms_min_seconds > 0.0);
    }
}
