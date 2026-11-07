//! Strzelnica (zakładka Gry): runda 45 s z kaczkami. Rundę liczy przeglądarka (`web/src/features/aim/core.ts`), ale serwer
//! nie wierzy jej na słowo: przy starcie losuje ziarno, a przy końcu dostaje tylko zapis strzałów (tick, x, y) i ODTWARZA całą
//! rundę (`aim_sim.rs`), sam licząc punkty. Czas sprawdza też zegar: runda nie może trwać krócej niż jej zapis. Za wynik nie ma
//! pieniędzy ani kart - to trening, który liczy się tylko w rankingu (`game_rankings.rs`, `aim_runs.verified`).

use axum::extract::State;
use serde::Deserialize;
use serde_json::json;

use super::{ok, JsonBody};
use crate::aim_sim::{self, ROUND_TICKS, TICK};
use crate::auth::Me;
use crate::db::{lock_me, now};
use crate::error::Res;
use crate::state::AppState;

/// Początek rundy: serwer zapisuje czas i losuje ziarno (jedna otwarta runda na gracza)
pub async fn aim_start(State(st): State<AppState>, Me(me): Me) -> Res {
    let seed: u32 = rand::random();
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    sqlx::query("DELETE FROM aim_runs WHERE user_id = $1 AND finished_at = 0").bind(me.id).execute(&mut *tx).await?;
    let id: i64 = sqlx::query_scalar("INSERT INTO aim_runs (user_id, started_at, seed) VALUES ($1, $2, $3) RETURNING id")
        .bind(me.id)
        .bind(now())
        .bind(i64::from(seed))
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    ok(json!({"run": id, "seed": seed}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Finish {
    run: i64,
    /// zapis strzałów: po trzy liczby (tick, x, y)
    log: Vec<i64>,
}

/// Koniec rundy: serwer odtwarza zapis i sam liczy wynik; do rankingu trafia, jeśli runda trwała tyle, co jej zapis
pub async fn aim_finish(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<Finish>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let run: Option<(f64, i64)> = sqlx::query_as("SELECT started_at, seed FROM aim_runs WHERE id = $1 AND user_id = $2 AND finished_at = 0")
        .bind(req.run)
        .bind(me.id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some((started, seed)) = run else { return ok(json!({"verified": false, "reason": "no_run"})) };
    let elapsed = now() - started;
    let log = req.log;
    let outcome = tokio::task::spawn_blocking(move || aim_sim::replay(seed as u32, &log)).await.ok().flatten();
    let secs = f64::from(ROUND_TICKS) * TICK;
    let (score, hits, shots, verified, reason) = match outcome {
        None => (0, 0, 0, false, "invalid"),
        // runda nie mogła się odbyć szybciej niż w prawdziwym czasie (tolerancja 10% + 3 s na opóźnienia)
        Some(o) if elapsed + 3.0 < secs * 0.9 => (o.score, o.hits, o.shots, false, "implausible"),
        Some(o) => (o.score, o.hits, o.shots, true, "ok"),
    };
    sqlx::query("UPDATE aim_runs SET finished_at = $1, score = $2, hits = $3, shots = $4, verified = $5 WHERE id = $6")
        .bind(now())
        .bind(score)
        .bind(hits)
        .bind(shots)
        .bind(i32::from(verified))
        .bind(req.run)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    ok(json!({"verified": verified, "reason": reason, "score": score, "hits": hits, "shots": shots}))
}
