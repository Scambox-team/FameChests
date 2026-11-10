//! Dostępność motywów czasowych (Ustawienia -> Eksperymentalne). Na razie jeden: „Niepodległość” (`independence`),
//! dostępny dla wszystkich graczy od 10.11.2026 do 13.11.2026 (włącznie, czas serwera). Admin może zmienić daty, ustawić go na
//! stałe albo wyłączyć (panel -> Motywy, `/admin/themes`). Ustawienia leżą w tabeli `state` (klucze `theme_independence_*`).
//! `/api/me` podaje w `themes` motywy dostępne graczowi; po wygaśnięciu przeglądarka wraca do motywu domyślnego (`enforceThemes`).

use axum::extract::State;
use chrono::{Datelike, Local, NaiveDate};
use serde::Deserialize;
use serde_json::json;

use super::{ok, JsonBody};
use crate::auth::Admin;
use crate::db::Conn;
use crate::error::{bad, Res};
use crate::game::log_admin;
use crate::state::AppState;

const K_MODE: &str = "theme_independence_mode";
const K_FROM: &str = "theme_independence_from";
const K_TO: &str = "theme_independence_to";
const DEFAULT_FROM: i64 = 20261110;
const DEFAULT_TO: i64 = 20261113;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// w podanym terminie
    Dates,
    /// zawsze
    Permanent,
    /// nigdy (poza adminami)
    Off,
}

impl Mode {
    fn code(self) -> i64 {
        match self {
            Mode::Dates => 0,
            Mode::Permanent => 1,
            Mode::Off => 2,
        }
    }
    fn from_code(c: i64) -> Mode {
        match c {
            1 => Mode::Permanent,
            2 => Mode::Off,
            _ => Mode::Dates,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Mode::Dates => "dates",
            Mode::Permanent => "permanent",
            Mode::Off => "off",
        }
    }
}

pub struct Window {
    pub mode: Mode,
    pub from: NaiveDate,
    pub to: NaiveDate,
}

fn ymd(d: NaiveDate) -> i64 {
    d.year() as i64 * 10000 + d.month() as i64 * 100 + d.day() as i64
}

fn from_ymd(v: i64) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt((v / 10000) as i32, ((v / 100) % 100) as u32, (v % 100) as u32)
}

impl Window {
    pub fn active(&self, today: NaiveDate) -> bool {
        match self.mode {
            Mode::Permanent => true,
            Mode::Off => false,
            Mode::Dates => today >= self.from && today <= self.to,
        }
    }
}

async fn read(c: &mut Conn, key: &str) -> sqlx::Result<Option<i64>> {
    sqlx::query_scalar("SELECT value FROM state WHERE key = $1").bind(key).fetch_optional(&mut *c).await
}

async fn write(c: &mut Conn, key: &str, value: i64) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .bind(key)
        .bind(value)
        .execute(&mut *c)
        .await?;
    Ok(())
}

pub async fn independence(c: &mut Conn) -> sqlx::Result<Window> {
    let mode = Mode::from_code(read(c, K_MODE).await?.unwrap_or(0));
    let from = from_ymd(read(c, K_FROM).await?.unwrap_or(DEFAULT_FROM)).or_else(|| from_ymd(DEFAULT_FROM)).unwrap();
    let to = from_ymd(read(c, K_TO).await?.unwrap_or(DEFAULT_TO)).or_else(|| from_ymd(DEFAULT_TO)).unwrap();
    Ok(Window { mode, from, to })
}

/// Czy motyw Niepodległość jest dziś dostępny dla wszystkich graczy
pub async fn independence_active(c: &mut Conn) -> sqlx::Result<bool> {
    Ok(independence(c).await?.active(Local::now().date_naive()))
}

pub async fn admin_themes(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let mut c = st.db.acquire().await?;
    let w = independence(&mut c).await?;
    let today = Local::now().date_naive();
    ok(json!({
        "today": today.to_string(),
        "independence": {
            "mode": w.mode.name(),
            "from": w.from.to_string(),
            "to": w.to.to_string(),
            "active": w.active(today),
        },
    }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ThemeRequest {
    theme: String,
    mode: String,
    from: String,
    to: String,
}

pub async fn admin_themes_save(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<ThemeRequest>) -> Res {
    if req.theme != "independence" {
        return bad("Nieznany motyw");
    }
    let mode = match req.mode.as_str() {
        "dates" => Mode::Dates,
        "permanent" => Mode::Permanent,
        "off" => Mode::Off,
        _ => return bad("Nieznany tryb"),
    };
    let day = |s: &str| NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok();
    let (from, to) = (day(&req.from), day(&req.to));
    if mode == Mode::Dates {
        match (from, to) {
            (Some(f), Some(t)) if f <= t => {}
            (Some(_), Some(_)) => return bad("Koniec jest przed początkiem"),
            _ => return bad("Podaj daty początku i końca"),
        }
    }
    let mut tx = st.db.begin().await?;
    write(&mut tx, K_MODE, mode.code()).await?;
    if let (Some(f), Some(t)) = (from, to) {
        if f <= t {
            write(&mut tx, K_FROM, ymd(f)).await?;
            write(&mut tx, K_TO, ymd(t)).await?;
        }
    }
    log_admin(&mut tx, &me, "theme_save", None, &format!("Niepodległość: {} {} - {}", mode.name(), req.from, req.to)).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn window() {
        let w = Window { mode: Mode::Dates, from: d(2026, 11, 10), to: d(2026, 11, 13) };
        assert!(!w.active(d(2026, 11, 9)));
        assert!(w.active(d(2026, 11, 10)) && w.active(d(2026, 11, 13)));
        assert!(!w.active(d(2026, 11, 14)));
        assert!(Window { mode: Mode::Permanent, ..w }.active(d(2030, 1, 1)));
        assert!(!Window { mode: Mode::Off, from: d(2026, 1, 1), to: d(2027, 1, 1) }.active(d(2026, 6, 1)));
    }

    #[test]
    fn date_codes() {
        assert_eq!(ymd(d(2026, 11, 10)), 20261110);
        assert_eq!(from_ymd(20261113), Some(d(2026, 11, 13)));
        assert_eq!(from_ymd(20261340), None);
        assert_eq!(Mode::from_code(Mode::Permanent.code()), Mode::Permanent);
        assert_eq!(Mode::from_code(99), Mode::Dates);
    }
}
