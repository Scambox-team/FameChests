//! Stary Pinball (zakładka Gry -> Stary Pinball): darmowa gra, fizykę liczy przeglądarka (web/src/features/oldpinball/). Serwer zapisuje partię
//! (`old_pinball_runs`: start, koniec, wynik) i zamienia punkty na grosze: `pay` groszy za 1000 punktów stołu, najwyżej
//! `perMinute` za minutę od startu partii i `dailyCap` na 24 h; wynik ponad `maxPointsPerSecond` × czas obcinamy.
//! Stoły odblokowuje najlepszy wynik na poprzednim (`unlock`), pierwsze odblokowanie daje `unlockBonus`.

use std::collections::HashMap;

use axum::extract::State;
use serde::Deserialize;
use serde_json::json;

use super::{ok, JsonBody};
use crate::auth::Me;
use crate::data::{g, OldPinballCfg};
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, Res};
use crate::game::{add_state, balance};
use crate::state::AppState;

/// Ile wyników na stół w tabeli najlepszych
const TOP: usize = 5;

/// Najlepsze wyniki gracza na każdym stole
async fn bests(c: &mut Conn, uid: i64) -> sqlx::Result<HashMap<String, i64>> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT table_id, MAX(score) FROM old_pinball_runs WHERE user_id = $1 AND finished_at IS NOT NULL GROUP BY table_id")
            .bind(uid)
            .fetch_all(c)
            .await?;
    Ok(rows.into_iter().collect())
}

async fn earned_today(c: &mut Conn, uid: i64) -> sqlx::Result<i64> {
    sqlx::query_scalar("SELECT COALESCE(SUM(earned), 0)::BIGINT FROM old_pinball_runs WHERE user_id = $1 AND finished_at > $2")
        .bind(uid)
        .bind(now() - 86400.0)
        .fetch_one(c)
        .await
}

/// Stół jest odblokowany, gdy najlepszy wynik na poprzednim sięga jego progu
fn unlocked(cfg: &OldPinballCfg, best: &HashMap<String, i64>, i: usize) -> bool {
    i == 0 || best.get(&cfg.tables[i - 1].id).copied().unwrap_or(0) >= cfg.tables[i].unlock
}

/// Grosze za partię przed limitem dziennym: punkty × stawka stołu, najwyżej `perMinute` za minutę gry
fn payout(cfg: &OldPinballCfg, pay: f64, score: i64, secs: f64) -> i64 {
    if secs < cfg.min_seconds {
        return 0;
    }
    let by_score = (score as f64 * pay / 1000.0).floor() as i64;
    let by_time = (secs / 60.0 * cfg.per_minute as f64).floor() as i64;
    by_score.min(by_time).max(0)
}

pub async fn old_pinball_lobby(State(st): State<AppState>, Me(me): Me) -> Res {
    let cfg = &g().old_pinball;
    let mut c = st.db.acquire().await?;
    let best = bests(&mut c, me.id).await?;
    let today = earned_today(&mut c, me.id).await?;
    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT r.table_id, u.username, MAX(r.score)::BIGINT AS s FROM old_pinball_runs r JOIN users u ON u.id = r.user_id \
         WHERE r.finished_at IS NOT NULL AND r.score > 0 AND u.banned = 0 AND u.ranking_hidden = 0 AND u.money_generated = 0 \
         GROUP BY r.table_id, u.username ORDER BY s DESC LIMIT 500",
    )
    .fetch_all(&mut *c)
    .await?;
    let mut top: HashMap<&str, Vec<serde_json::Value>> = HashMap::new();
    for (t, name, score) in &rows {
        let list = top.entry(t.as_str()).or_default();
        if list.len() < TOP {
            list.push(json!({"name": name, "score": score, "me": *name == me.username}));
        }
    }
    let tables: Vec<_> = cfg
        .tables
        .iter()
        .enumerate()
        .map(|(i, t)| {
            json!({"id": t.id, "name": t.name, "pay": t.pay, "unlock": t.unlock, "unlockBonus": t.unlock_bonus,
                   "unlocked": unlocked(cfg, &best, i), "best": best.get(&t.id).copied().unwrap_or(0),
                   "top": top.get(t.id.as_str()).cloned().unwrap_or_default()})
        })
        .collect();
    ok(json!({"tables": tables, "earnedToday": today, "dailyCap": cfg.daily_cap, "perMinute": cfg.per_minute,
              "minSeconds": cfg.min_seconds}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct StartRequest {
    table: String,
}

pub async fn old_pinball_start(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<StartRequest>) -> Res {
    let cfg = &g().old_pinball;
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let Some(i) = cfg.tables.iter().position(|t| t.id == req.table) else { return bad("Nie ma takiego stołu") };
    let best = bests(&mut tx, me.id).await?;
    if !unlocked(cfg, &best, i) {
        return bad("Ten stół jest jeszcze zablokowany");
    }
    // porzucona partia (zamknięta karta bez rozliczenia) przepada
    sqlx::query("UPDATE old_pinball_runs SET finished_at = started_at WHERE user_id = $1 AND finished_at IS NULL")
        .bind(me.id)
        .execute(&mut *tx)
        .await?;
    let id: i64 = sqlx::query_scalar("INSERT INTO old_pinball_runs (user_id, table_id, started_at) VALUES ($1, $2, $3) RETURNING id")
        .bind(me.id)
        .bind(&req.table)
        .bind(now())
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    ok(json!({"run": id}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct FinishRequest {
    run: i64,
    score: i64,
}

pub async fn old_pinball_finish(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<FinishRequest>) -> Res {
    let cfg = &g().old_pinball;
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let run: Option<(String, f64)> =
        sqlx::query_as("SELECT table_id, started_at FROM old_pinball_runs WHERE id = $1 AND user_id = $2 AND finished_at IS NULL FOR UPDATE")
            .bind(req.run)
            .bind(me.id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((table_id, started)) = run else { return bad("Ta partia jest już rozliczona") };
    let Some(i) = cfg.tables.iter().position(|t| t.id == table_id) else { return bad("Nie ma takiego stołu") };
    let t = &cfg.tables[i];
    let at = now();
    let secs = (at - started).clamp(0.0, cfg.max_hours * 3600.0);
    let score = req.score.clamp(0, (secs * cfg.max_points_per_second) as i64);
    let before = bests(&mut tx, me.id).await?;
    let raw = payout(cfg, t.pay, score, secs);
    let left = (cfg.daily_cap - earned_today(&mut tx, me.id).await?).max(0);
    let earned = raw.min(left);
    // pierwsze odblokowanie następnego stołu
    let next = cfg.tables.get(i + 1).filter(|n| before.get(&t.id).copied().unwrap_or(0) < n.unlock && score >= n.unlock);
    let bonus = next.map_or(0, |n| n.unlock_bonus);
    sqlx::query("UPDATE old_pinball_runs SET finished_at = $1, score = $2, earned = $3, bonus = $4 WHERE id = $5")
        .bind(at)
        .bind(score)
        .bind(earned)
        .bind(bonus)
        .bind(req.run)
        .execute(&mut *tx)
        .await?;
    if earned + bonus > 0 {
        add_state(&mut tx, me.id, "balance", earned + bonus).await?;
    }
    let bal = balance(&mut tx, me.id).await?;
    let today = earned_today(&mut tx, me.id).await?;
    tx.commit().await?;
    let old_best = before.get(&t.id).copied().unwrap_or(0);
    ok(json!({"score": score, "earned": earned, "bonus": bonus, "capped": earned < raw, "best": old_best.max(score),
              "newBest": score > old_best, "unlocked": next.map(|n| &n.name), "earnedToday": today,
              "dailyCap": cfg.daily_cap, "balance": bal}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_payout_limits() {
        let cfg = g().old_pinball.clone();
        assert_eq!(payout(&cfg, 1.0, 1_000_000, cfg.min_seconds - 1.0), 0);
        // limit za minutę
        assert_eq!(payout(&cfg, 1.0, 10_000_000, 60.0), cfg.per_minute);
        assert_eq!(payout(&cfg, 1.0, 100_000, 600.0), 100);
        assert!(cfg.tables.windows(2).all(|w| w[0].pay < w[1].pay), "trudniejszy stół płaci więcej");
        assert_eq!(cfg.tables[0].unlock, 0);
    }
}
