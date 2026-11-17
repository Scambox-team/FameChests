//! Gry z nagrodą w groszach za punkty, które liczy SERWER: Obrona Orbity (zakładka Gry) i Super Turbo AIMPULSE 3D
//! (Gry Super Turbo). Tak jak Snake i Super Turbo Run: przy starcie serwer losuje ziarno (bilet `TICKETS` w pamięci procesu,
//! jednorazowy), po grze dostaje tylko zapis klawiszy / strzałów i sam ODTWARZA grę (`invaders_sim`, `aimpulse_sim`), licząc
//! punkty. Zapis dłuższy niż czas, który naprawdę minął od startu (zegar serwera, tolerancja 10% + 3 s), nie daje nic.
//! Nagroda: `per` gr za każde `unit` punktów od `min` punktów, najwyżej `perGame` za grę i `daily` na dobę (klucze
//! `<gra>_reward_*` w `state`, panel admina -> Gry). Zarobek dnia gracza: `user_state` `<gra>_day` / `<gra>_today`.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use axum::extract::{Path, State};
use serde::Deserialize;
use serde_json::json;

use super::snake::{put_setting, setting, today};
use super::{ok, JsonBody};
use crate::auth::{Admin, Me};
use crate::db::{lock_me, Conn};
use crate::error::{bad, Res};
use crate::game::{add_state, get_state, log_admin, set_state};
use crate::state::AppState;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum Arcade {
    Invaders,
    Aimpulse,
}

impl Arcade {
    fn parse(s: &str) -> Option<Arcade> {
        match s {
            "invaders" => Some(Arcade::Invaders),
            "aimpulse" => Some(Arcade::Aimpulse),
            _ => None,
        }
    }

    fn key(self) -> &'static str {
        match self {
            Arcade::Invaders => "invaders",
            Arcade::Aimpulse => "aimpulse",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Arcade::Invaders => "Obrona Orbity",
            Arcade::Aimpulse => "AIMPULSE",
        }
    }

    /// (pole formularza, wartość domyślna, największa dozwolona); `unit` = za ile punktów płacimy `per` gr
    fn fields(self) -> [(&'static str, i64, i64); 5] {
        match self {
            Arcade::Invaders => [("per", 10, 1000), ("unit", 100, 100_000), ("min", 200, 1_000_000), ("perGame", 300, 100_000), ("daily", 900, 1_000_000)],
            Arcade::Aimpulse => [("per", 3, 1000), ("unit", 1000, 1_000_000), ("min", 5000, 10_000_000), ("perGame", 300, 100_000), ("daily", 900, 1_000_000)],
        }
    }

    /// Największy wynik jednej gry, jaki bierzemy pod uwagę (zapas ponad realne wyniki)
    fn max_score(self) -> i64 {
        match self {
            Arcade::Invaders => 500_000,
            Arcade::Aimpulse => 2_000_000,
        }
    }
}

struct Ticket {
    at: Instant,
    seed: u32,
    diff: usize,
    dur: u32,
}

/// bilety gier: (gracz, gra) -> bilet; nowy start zastępuje poprzedni
static TICKETS: LazyLock<Mutex<HashMap<(i64, Arcade), Ticket>>> = LazyLock::new(Default::default);

struct Reward {
    per: i64,
    unit: i64,
    min: i64,
    per_game: i64,
    daily: i64,
}

fn setting_key(game: Arcade, field: &str) -> String {
    format!("{}_reward_{field}", game.key())
}

async fn reward_cfg(c: &mut Conn, game: Arcade) -> sqlx::Result<Reward> {
    let mut v = [0i64; 5];
    for (i, (field, default, _)) in game.fields().iter().enumerate() {
        v[i] = setting(c, &setting_key(game, field), *default).await?;
    }
    Ok(Reward { per: v[0], unit: v[1].max(1), min: v[2], per_game: v[3], daily: v[4] })
}

async fn earned_today(c: &mut Conn, uid: i64, game: Arcade) -> sqlx::Result<i64> {
    let st = get_state(c, uid).await?;
    let (day, sum) = (format!("{}_day", game.key()), format!("{}_today", game.key()));
    Ok(if st.get(&day).copied() == Some(today()) { st.get(&sum).copied().unwrap_or(0) } else { 0 })
}

/// Nagroda za wynik (bez limitu dnia)
fn reward_for(r: &Reward, score: i64) -> i64 {
    if r.per <= 0 || score < r.min.max(1) {
        return 0;
    }
    (score / r.unit * r.per).min(r.per_game)
}

/// Czy zapis tylu kroków gry (po 1/60 s) mógł powstać w tym czasie
fn plausible(ticks: u64, elapsed_secs: f64) -> bool {
    elapsed_secs + 3.0 >= ticks as f64 / 60.0 * 0.9
}

fn cfg_json(r: &Reward, today: i64) -> serde_json::Value {
    json!({"per": r.per, "unit": r.unit, "min": r.min, "perGame": r.per_game, "daily": r.daily, "today": today})
}

fn game_of(name: &str) -> Res<Arcade> {
    Arcade::parse(name).map_or_else(|| bad("Nie ma takiej gry"), Ok)
}

/// Nagroda (i zarobek gracza dziś) dla strony gry
pub async fn arcade_config(State(st): State<AppState>, Me(me): Me, Path(name): Path<String>) -> Res {
    let game = game_of(&name)?;
    let mut c = st.db.acquire().await?;
    let r = reward_cfg(&mut c, game).await?;
    let today = earned_today(&mut c, me.id, game).await?;
    ok(json!({"reward": cfg_json(&r, today)}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct StartRequest {
    /// AIMPULSE: poziom 0-2 i czas rundy w sekundach (30 / 60 / 120)
    diff: usize,
    dur: u32,
}

pub async fn arcade_start(Me(me): Me, Path(name): Path<String>, JsonBody(req): JsonBody<StartRequest>) -> Res {
    let game = game_of(&name)?;
    if game == Arcade::Aimpulse && (req.diff > 2 || !crate::aimpulse_sim::DURS.contains(&req.dur)) {
        return bad("Wybierz poziom i czas rundy");
    }
    let seed: u32 = rand::random();
    let mut t = TICKETS.lock().unwrap_or_else(|e| e.into_inner());
    t.retain(|_, tk| tk.at.elapsed().as_secs() < 3 * 3600);
    t.insert((me.id, game), Ticket { at: Instant::now(), seed, diff: req.diff, dur: req.dur });
    ok(json!({"ok": true, "seed": seed}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct FinishRequest {
    /// Obrona Orbity: (krok, maska klawiszy)...; AIMPULSE: (krok, x, y, z)...
    log: Vec<i64>,
    /// Obrona Orbity: ile kroków zrobiła gra w przeglądarce
    ticks: u64,
}

struct Played {
    score: i64,
    ticks: u64,
    /// dodatkowe dane gry do odpowiedzi (fala / trafienia i strzały)
    extra: serde_json::Value,
}

fn replay(game: Arcade, tk: &Ticket, log: &[i64], ticks: u64) -> Option<Played> {
    match game {
        Arcade::Invaders => {
            if log.iter().any(|v| *v < 0) {
                return None;
            }
            let log: Vec<u64> = log.iter().map(|v| *v as u64).collect();
            crate::invaders_sim::replay(tk.seed, &log, ticks).map(|o| Played { score: o.score, ticks: o.ticks, extra: json!({"wave": o.wave}) })
        }
        Arcade::Aimpulse => crate::aimpulse_sim::replay(tk.seed, tk.diff, tk.dur, log)
            .map(|o| Played { score: o.score, ticks: u64::from(tk.dur) * 60, extra: json!({"hits": o.hits, "shots": o.shots}) }),
    }
}

/// Koniec gry: serwer odtwarza zapis, liczy punkty i płaci grosze (w limicie gry i dnia). Bilet jest jednorazowy.
pub async fn arcade_finish(State(st): State<AppState>, Me(me): Me, Path(name): Path<String>, JsonBody(req): JsonBody<FinishRequest>) -> Res {
    let game = game_of(&name)?;
    let tk = TICKETS.lock().unwrap_or_else(|e| e.into_inner()).remove(&(me.id, game));
    let Some(tk) = tk else { return bad("Gra nie została rozpoczęta") };
    let elapsed = tk.at.elapsed().as_secs_f64();
    let (log, ticks) = (req.log, req.ticks);
    let played = tokio::task::spawn_blocking(move || replay(game, &tk, &log, ticks)).await.ok().flatten();
    let Some(p) = played else { return bad("Nieprawidłowy zapis gry") };
    if !plausible(p.ticks, elapsed) {
        tracing::warn!(user = me.id, game = game.key(), ticks = p.ticks, elapsed, "arcade: zapis dłuższy niż czas gry");
        return bad("Nieprawidłowy wynik");
    }
    let score = p.score.clamp(0, game.max_score());
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let r = reward_cfg(&mut tx, game).await?;
    let earned = earned_today(&mut tx, me.id, game).await?;
    let base = reward_for(&r, score);
    let reward = base.min((r.daily - earned).max(0));
    if reward > 0 {
        add_state(&mut tx, me.id, "balance", reward).await?;
        add_state(&mut tx, me.id, "earned", reward).await?;
        set_state(&mut tx, me.id, &format!("{}_day", game.key()), today()).await?;
        set_state(&mut tx, me.id, &format!("{}_today", game.key()), earned + reward).await?;
    }
    let state = get_state(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({"score": score, "game": p.extra, "reward": reward, "capped": reward < base, "today": earned + reward, "daily": r.daily, "state": state}))
}

/// Ustawienia nagrody dla panelu admina
pub async fn admin_arcade(State(st): State<AppState>, Admin(_me): Admin, Path(name): Path<String>) -> Res {
    let game = game_of(&name)?;
    let mut c = st.db.acquire().await?;
    let r = reward_cfg(&mut c, game).await?;
    ok(json!({"reward": cfg_json(&r, 0)}))
}

/// Panel admina (JSON): pola nagrody (`per`, `unit`, `min`, `perGame`, `daily`); odpowiedź = aktualne ustawienia
pub async fn admin_arcade_save(
    State(st): State<AppState>,
    Admin(me): Admin,
    Path(name): Path<String>,
    JsonBody(req): JsonBody<serde_json::Map<String, serde_json::Value>>,
) -> Res {
    let game = game_of(&name)?;
    let mut tx = st.db.begin().await?;
    let mut log = Vec::new();
    for (field, _, max) in game.fields() {
        let Some(v) = req.get(field) else { continue };
        let n = v.as_i64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()));
        let Some(n) = n else { return bad("Nagroda: podaj liczby całkowite") };
        let min = i64::from(field == "unit");
        if !(min..=max).contains(&n) {
            return bad(format!("Nagroda: wartość od {min} do {max}"));
        }
        put_setting(&mut tx, &setting_key(game, field), n).await?;
        log.push(format!("{field}={n}"));
    }
    if !log.is_empty() {
        log_admin(&mut tx, &me, game.key(), None, &format!("{}: nagroda {}", game.title(), log.join(" "))).await?;
    }
    let r = reward_cfg(&mut tx, game).await?;
    tx.commit().await?;
    ok(json!({"reward": cfg_json(&r, 0)}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reward_grows_with_score_and_is_capped() {
        let r = Reward { per: 10, unit: 100, min: 200, per_game: 300, daily: 900 };
        assert_eq!(reward_for(&r, 199), 0);
        assert_eq!(reward_for(&r, 250), 20);
        assert_eq!(reward_for(&r, 1_000), 100);
        assert_eq!(reward_for(&r, 100_000), 300);
        assert_eq!(reward_for(&Reward { per: 0, ..r }, 1_000), 0);
    }

    #[test]
    fn game_must_fit_in_the_elapsed_time() {
        assert!(plausible(60 * 60, 60.0));
        assert!(plausible(60 * 60, 52.0));
        assert!(!plausible(60 * 60, 40.0));
        assert!(!plausible(60 * 600, 300.0));
    }

    #[test]
    fn only_known_games() {
        assert!(Arcade::parse("invaders").is_some() && Arcade::parse("aimpulse").is_some() && Arcade::parse("snake").is_none());
    }
}
