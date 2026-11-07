//! Snake (zakładka Gry): gra liczy się w przeglądarce (features/snake/). Serwer trzyma ustawienia z panelu admina
//! (zakładka Gry) i wypłaca nagrodę:
//! - wygląd: kolor węża i tła (tabela `state`, klucze `snake_color` / `snake_bg` jako 0xRRGGBB), obrazki PNG (głowa, ciało,
//!   jabłko, tło) w image_cache jako `__snake_<miejsce>.png`;
//! - dźwięki zjedzenia jabłka (najwyżej `MAX_SOUNDS`, gra losuje jeden): `image_cache/__snake_snd_<id>.<mp3|ogg|wav>`;
//! - nagroda w groszach za wynik: `per_apple` gr za jabłko od `min_score` jabłek, najwyżej `per_game` za grę i `daily`
//!   na dobę (klucze `snake_reward_*` w `state`). Wynik liczy przeglądarka, więc serwer wydaje bilet na start gry
//!   (`TICKETS`, w pamięci procesu) i odrzuca wynik niemożliwy w tym czasie (`MIN_MS_PER_APPLE`). Zarobek dnia gracza:
//!   `user_state` `snake_day` / `snake_today`.
//!
//! Pliki idą do eksportu katalogu (export.rs).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use axum::extract::{Multipart, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use chrono::{Datelike, Local};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::variants::Form;
use super::{ok, JsonBody};
use crate::auth::{Admin, Me};
use crate::db::{lock_me, Conn};
use crate::error::{bad, AppError, Res};
use crate::game::{add_state, get_state, log_admin, set_state};
use crate::images::{file_mtime, mimetype, sniff, Kind};
use crate::state::AppState;
use crate::web::send_file;

/// Miejsca na obrazki: klucz i nazwa w panelu
pub const SLOTS: &[(&str, &str)] = &[("head", "głowa"), ("body", "ciało"), ("apple", "jabłko"), ("bg", "tło")];
const DEFAULT_COLOR: i64 = 0x4ade80;
const DEFAULT_BG: i64 = 0x0d130f;

pub const MAX_SOUNDS: usize = 10;
const SOUND_MAX_BYTES: usize = 2 * 1024 * 1024;
pub const SOUND_PREFIX: &str = "__snake_snd_";

/// Nagroda: (klucz w `state`, pole formularza, wartość domyślna, największa dozwolona)
const REWARD: &[(&str, &str, i64, i64)] = &[
    ("snake_reward_per_apple", "perApple", 2, 1000),
    ("snake_reward_min_score", "minScore", 5, 400),
    ("snake_reward_per_game", "perGame", 100, 100_000),
    ("snake_reward_daily", "daily", 300, 1_000_000),
];
/// Najszybciej, jak da się zjeść jabłko (krok węża trwa co najmniej 65 ms, jabłko jest zwykle kilka kratek dalej)
const MIN_MS_PER_APPLE: u128 = 300;
/// Plansza 20 x 20, wąż startuje z 3 kratek
const MAX_SCORE: i64 = 397;

/// Bilety gier: gracz -> chwila startu (jedna gra naraz; nowy start zastępuje poprzedni)
static TICKETS: LazyLock<Mutex<HashMap<i64, Instant>>> = LazyLock::new(Default::default);

pub fn file_id(slot: &str) -> String {
    format!("__snake_{slot}")
}

fn hex(c: i64) -> String {
    format!("#{:06x}", c & 0xff_ffff)
}

fn parse_hex(s: &str) -> Option<i64> {
    let s = s.trim().trim_start_matches('#');
    (s.len() == 6).then(|| i64::from_str_radix(s, 16).ok()).flatten()
}

async fn setting(c: &mut Conn, key: &str, default: i64) -> sqlx::Result<i64> {
    let v: Option<i64> = sqlx::query_scalar("SELECT value FROM state WHERE key = $1").bind(key).fetch_optional(&mut *c).await?;
    Ok(v.unwrap_or(default))
}

async fn put_setting(c: &mut Conn, key: &str, value: i64) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .bind(key)
        .bind(value)
        .execute(&mut *c)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------- dźwięki

/// Rozpoznany plik dźwiękowy: rozszerzenie i typ
fn sniff_audio(b: &[u8]) -> Option<(&'static str, &'static str)> {
    if b.starts_with(b"ID3") || (b.len() > 2 && b[0] == 0xff && (b[1] & 0xe0) == 0xe0) {
        Some(("mp3", "audio/mpeg"))
    } else if b.starts_with(b"OggS") {
        Some(("ogg", "audio/ogg"))
    } else if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WAVE" {
        Some(("wav", "audio/wav"))
    } else {
        None
    }
}

fn audio_mime(ext: &str) -> &'static str {
    match ext {
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        _ => "audio/wav",
    }
}

/// Wgrane dźwięki: (id, ścieżka), od najstarszego
pub fn sound_files(st: &AppState) -> Vec<(String, std::path::PathBuf)> {
    let Ok(dir) = std::fs::read_dir(&st.images.cache_dir) else { return Vec::new() };
    let mut list: Vec<(String, std::path::PathBuf, f64)> = dir
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let (stem, ext) = name.strip_prefix(SOUND_PREFIX)?.rsplit_once('.')?;
            (["mp3", "ogg", "wav"].contains(&ext) && stem.chars().all(|c| c.is_ascii_hexdigit()))
                .then(|| (stem.to_owned(), e.path(), file_mtime(&e.path())))
        })
        .collect();
    list.sort_by(|a, b| a.2.total_cmp(&b.2));
    list.into_iter().map(|(id, p, _)| (id, p)).collect()
}

pub async fn snake_sound(State(st): State<AppState>, Me(_): Me, Path(id): Path<String>, headers: HeaderMap) -> Res {
    let (_, path) = sound_files(&st).into_iter().find(|(s, _)| *s == id).ok_or(AppError::Status(StatusCode::NOT_FOUND))?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_owned();
    send_file(&path, audio_mime(&ext), &headers, "public, max-age=2592000").await
}

// ---------------------------------------------------------------- ustawienia dla przeglądarki

struct Reward {
    per_apple: i64,
    min_score: i64,
    per_game: i64,
    daily: i64,
}

async fn reward_cfg(c: &mut Conn) -> sqlx::Result<Reward> {
    let mut v = [0i64; 4];
    for (i, (key, _, default, _)) in REWARD.iter().enumerate() {
        v[i] = setting(c, key, *default).await?;
    }
    Ok(Reward { per_apple: v[0], min_score: v[1], per_game: v[2], daily: v[3] })
}

fn today() -> i64 {
    Local::now().date_naive().num_days_from_ce() as i64
}

/// Ile gracz zarobił dziś w Snake'u
async fn earned_today(c: &mut Conn, uid: i64) -> sqlx::Result<i64> {
    let st = get_state(c, uid).await?;
    Ok(if st.get("snake_day").copied() == Some(today()) { st.get("snake_today").copied().unwrap_or(0) } else { 0 })
}

/// Nagroda za wynik (bez limitu dnia)
fn reward_for(r: &Reward, score: i64) -> i64 {
    if r.per_apple <= 0 || score < r.min_score.max(1) {
        return 0;
    }
    (score * r.per_apple).min(r.per_game)
}

/// Wygląd, dźwięki i nagroda (uid = zarobek gracza dziś)
async fn look(st: &AppState, uid: Option<i64>) -> Res<Value> {
    let mut c = st.db.acquire().await?;
    let images: Map<String, Value> = SLOTS
        .iter()
        .map(|(slot, _)| {
            let url = st
                .images
                .find(&file_id(slot), &Kind::Main)
                .map(|p| json!(format!("/snake/{slot}?v={}", file_mtime(&p) as i64 % 1_000_000_000)));
            (slot.to_string(), url.unwrap_or(Value::Null))
        })
        .collect();
    let sounds: Vec<Value> = sound_files(st).into_iter().map(|(id, _)| json!({"id": id, "url": format!("/snake/sound/{id}")})).collect();
    let r = reward_cfg(&mut c).await?;
    let today = match uid {
        Some(uid) => earned_today(&mut c, uid).await?,
        None => 0,
    };
    Ok(json!({
        "color": hex(setting(&mut c, "snake_color", DEFAULT_COLOR).await?),
        "background": hex(setting(&mut c, "snake_bg", DEFAULT_BG).await?),
        "defaults": {"color": hex(DEFAULT_COLOR), "background": hex(DEFAULT_BG)},
        "images": images,
        "sounds": sounds,
        "maxSounds": MAX_SOUNDS,
        "reward": {"perApple": r.per_apple, "minScore": r.min_score, "perGame": r.per_game, "daily": r.daily, "today": today},
    }))
}

pub async fn snake_config(State(st): State<AppState>, Me(me): Me) -> Res {
    ok(look(&st, Some(me.id)).await?)
}

/// Obrazek gry (PNG od admina)
pub async fn snake_image(
    State(st): State<AppState>,
    Me(_): Me,
    Path(slot): Path<String>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Res {
    if !SLOTS.iter().any(|(s, _)| *s == slot) {
        return Err(AppError::Status(StatusCode::NOT_FOUND));
    }
    let path = st.images.find(&file_id(&slot), &Kind::Main).ok_or(AppError::Status(StatusCode::NOT_FOUND))?;
    let cache = format!("public, max-age={}", if q.contains_key("v") { 30 * 86400 } else { 0 });
    send_file(&path, mimetype(&path), &headers, &cache).await
}

// ---------------------------------------------------------------- gra: bilet i nagroda

pub async fn snake_start(Me(me): Me) -> Res {
    let mut t = TICKETS.lock().unwrap_or_else(|e| e.into_inner());
    t.retain(|_, at| at.elapsed().as_secs() < 3 * 3600);
    t.insert(me.id, Instant::now());
    ok(json!({"ok": true}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct FinishRequest {
    score: i64,
}

/// Koniec gry: grosze za wynik (w limicie gry i dnia). Bilet jest jednorazowy.
pub async fn snake_finish(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<FinishRequest>) -> Res {
    let started = TICKETS.lock().unwrap_or_else(|e| e.into_inner()).remove(&me.id);
    let Some(started) = started else { return bad("Gra nie została rozpoczęta") };
    let score = req.score;
    if !(0..=MAX_SCORE).contains(&score) || started.elapsed().as_millis() < score as u128 * MIN_MS_PER_APPLE {
        return bad("Nieprawidłowy wynik");
    }
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let r = reward_cfg(&mut tx).await?;
    let earned = earned_today(&mut tx, me.id).await?;
    let base = reward_for(&r, score);
    let reward = base.min((r.daily - earned).max(0));
    if reward > 0 {
        add_state(&mut tx, me.id, "balance", reward).await?;
        add_state(&mut tx, me.id, "earned", reward).await?;
        set_state(&mut tx, me.id, "snake_day", today()).await?;
        set_state(&mut tx, me.id, "snake_today", earned + reward).await?;
    }
    let state = get_state(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({
        "reward": reward,
        "capped": reward < base,          // limit dnia zabrał część nagrody
        "today": earned + reward,
        "daily": r.daily,
        "state": state,
    }))
}

// ---------------------------------------------------------------- panel admina

/// Panel admina (multipart): kolory (`color`, `background` jako #rrggbb, `reset=1` = domyślne), obrazki PNG (pola head /
/// body / apple / bg), `remove` = usuń obrazek, `sound` = nowy dźwięk, `removeSound` = id dźwięku do usunięcia,
/// nagroda (`perApple`, `minScore`, `perGame`, `daily`)
pub async fn admin_snake_save(State(st): State<AppState>, Admin(me): Admin, mp: Multipart) -> Res {
    let form = Form::read(mp).await?;
    let mut done: Vec<String> = Vec::new();
    for (slot, name) in SLOTS {
        if let Some(blob) = form.upload(slot) {
            if sniff(blob) != Some("png") {
                return bad(format!("Obrazek ({name}) musi być plikiem PNG"));
            }
            st.images.save(&file_id(slot), blob, &Kind::Main).map_err(AppError::bad)?;
            done.push(format!("obrazek: {name}"));
        }
    }
    if let Some(slot) = form.fields.get("remove") {
        let Some((slot, name)) = SLOTS.iter().find(|(s, _)| s == slot) else { return bad("Nieznany obrazek") };
        st.images.delete(&file_id(slot), &Kind::Main);
        done.push(format!("usunięty obrazek: {name}"));
    }
    // dźwięki zjedzenia jabłka
    if let Some(blob) = form.upload("sound") {
        if sound_files(&st).len() >= MAX_SOUNDS {
            return bad(format!("Najwyżej {MAX_SOUNDS} dźwięków - usuń któryś"));
        }
        if blob.len() > SOUND_MAX_BYTES {
            return bad("Dźwięk jest za duży (max 2 MB)");
        }
        let Some((ext, _)) = sniff_audio(blob) else { return bad("Dźwięk musi być plikiem MP3, OGG albo WAV") };
        let id = hex::encode(rand::random::<[u8; 4]>());
        let io = |e: std::io::Error| AppError::bad(format!("Nie udało się zapisać dźwięku: {e}"));
        std::fs::create_dir_all(&st.images.cache_dir).map_err(io)?;
        std::fs::write(st.images.cache_dir.join(format!("{SOUND_PREFIX}{id}.{ext}")), blob).map_err(io)?;
        done.push(format!("dźwięk {id}"));
    }
    if let Some(id) = form.fields.get("removeSound") {
        let Some((_, path)) = sound_files(&st).into_iter().find(|(s, _)| s == id) else { return bad("Nie ma takiego dźwięku") };
        let _ = std::fs::remove_file(path);
        done.push(format!("usunięty dźwięk {id}"));
    }
    let mut tx = st.db.begin().await?;
    let reset = form.fields.get("reset").map(String::as_str) == Some("1");
    for (field, key, default) in [("color", "snake_color", DEFAULT_COLOR), ("background", "snake_bg", DEFAULT_BG)] {
        let value = if reset {
            Some(default)
        } else {
            match form.fields.get(field).filter(|s| !s.trim().is_empty()) {
                Some(s) => Some(parse_hex(s).ok_or_else(|| AppError::bad("Kolor w formacie #rrggbb"))?),
                None => None,
            }
        };
        if let Some(v) = value {
            put_setting(&mut tx, key, v).await?;
        }
    }
    if reset {
        done.push("domyślne kolory".into());
    } else if form.fields.contains_key("color") {
        done.push(format!("kolory: {} / {}", form.fields["color"], form.fields.get("background").map_or("", String::as_str)));
    }
    // nagroda
    let mut reward_log = Vec::new();
    for (key, field, _, max) in REWARD {
        let Some(s) = form.fields.get(*field) else { continue };
        let v: i64 = s.trim().parse().map_err(|_| AppError::bad("Nagroda: podaj liczby całkowite"))?;
        if !(0..=*max).contains(&v) {
            return bad(format!("Nagroda: wartość od 0 do {max}"));
        }
        put_setting(&mut tx, key, v).await?;
        reward_log.push(format!("{field}={v}"));
    }
    if !reward_log.is_empty() {
        done.push(format!("nagroda: {}", reward_log.join(" ")));
    }
    log_admin(&mut tx, &me, "snake", None, &done.join(", ")).await?;
    tx.commit().await?;
    ok(look(&st, None).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors() {
        assert_eq!(parse_hex("#4ADE80"), Some(0x4ade80));
        assert_eq!(parse_hex("4ade80"), Some(0x4ade80));
        assert_eq!(parse_hex("#fff"), None);
        assert_eq!(parse_hex("#zzzzzz"), None);
        assert_eq!(hex(0x0d130f), "#0d130f");
    }

    #[test]
    fn audio_and_reward() {
        assert_eq!(sniff_audio(b"ID3\x04....").map(|a| a.0), Some("mp3"));
        assert_eq!(sniff_audio(&[0xff, 0xfb, 0x90, 0]).map(|a| a.0), Some("mp3"));
        assert_eq!(sniff_audio(b"OggS\0\x02").map(|a| a.0), Some("ogg"));
        assert_eq!(sniff_audio(b"RIFF\0\0\0\0WAVEfmt ").map(|a| a.0), Some("wav"));
        assert_eq!(sniff_audio(b"\x89PNG\r\n\x1a\n"), None);
        let r = Reward { per_apple: 2, min_score: 5, per_game: 100, daily: 300 };
        assert_eq!(reward_for(&r, 4), 0);
        assert_eq!(reward_for(&r, 5), 10);
        assert_eq!(reward_for(&r, 80), 100);
        assert_eq!(reward_for(&Reward { per_apple: 0, ..r }, 50), 0);
    }
}
