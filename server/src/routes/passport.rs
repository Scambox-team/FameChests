//! Paszport: stempel za każde państwo, z którego gracz wszedł do gry. Kraj ustala SERWER z pozycji GPS wysłanej za zgodą gracza
//! (`borders.rs`, bez zewnętrznych usług), a w bazie zostaje wyłącznie kod państwa i czas zdobycia - współrzędnych nie zapisujemy
//! ani w tabelach, ani w logach. GPS z przeglądarki da się podrobić, więc nagrody za stempel ustawia admin z rozwagą.
//!
//! Panel admina (zakładka Paszport, `passport_settings`): kolor stempla, własna ikona (biały PNG z kanałem alfa - kolor nadaje
//! stempel, więc dowolny jednokolorowy obrazek na przezroczystym tle pasuje do reszty) i nagroda za pierwsze zdobycie
//! (karta w dowolnym wariancie, skrzynka, grosze - ten sam format co w osiągnięciach i kalendarzu adwentowym).

use std::collections::HashMap;
use std::io::Cursor;
use std::net::SocketAddr;
use std::sync::LazyLock;

use axum::extract::{ConnectInfo, Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use image::{imageops, DynamicImage, ImageFormat, Rgba, RgbaImage};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use super::events::{reward_options, reward_view};
use super::game_rankings::NOT_HIDDEN;
use super::variants::Form;
use super::{ok, JsonBody};
use crate::achievements::grant_rewards;
use crate::auth::{client_ip, Admin, Me};
use crate::borders;
use crate::catalog::Catalog;
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, AppError, Res};
use crate::events::clean_reward;
use crate::game::{get_chests, get_state, log_admin, valid_chest_kind, Ctx};
use crate::state::AppState;

/// Ilu graczy najwyżej pokazuje okno stempla
const HOLDERS_MAX: i64 = 500;
/// Próby ustalenia kraju w oknie `WINDOW`: jeden gracz i jeden adres IP
const PER_USER: usize = 30;
const PER_IP: usize = 120;
const WINDOW: f64 = 3600.0;
/// Najwięcej nagród za jeden stempel
const MAX_REWARDS: usize = 4;
/// Zabezpieczenia przed podrabianiem GPS (bez zapisywania współrzędnych):
/// - najwięcej nowych stempli na dobę (ruchome okno 24 h),
/// - prędkość, z jaką można dotrzeć z ostatniego państwa do nowego (samolot ok. 1000 km/h); mierzona od granicy do granicy,
///   więc sąsiedzi nie są ograniczeni, a odległe kraje wymagają realnego czasu na dotarcie,
/// - dokładność pozycji z przeglądarki musi być sensowna (zero albo ponad 50 km odpada).
const MAX_NEW_PER_DAY: i64 = 10;
const MAX_SPEED_KMH: f64 = 1000.0;
/// Bliżej niż tyle km (po uwzględnieniu błędu oszacowania) nie sprawdzamy czasu
const NEAR_KM: f64 = 150.0;
const MAX_ACCURACY_M: f64 = 50_000.0;
/// Własna ikona: największy wgrywany plik i bok kwadratu po zmniejszeniu (px)
const ICON_MAX_BYTES: usize = 3 * 1024 * 1024;
const ICON_SIZE: u32 = 192;

static RECENT: LazyLock<Mutex<HashMap<String, Vec<f64>>>> = LazyLock::new(Mutex::default);

/// Czy klucz (gracz albo IP) może jeszcze próbować; zapisuje próbę
fn allow(key: String, limit: usize) -> bool {
    let t = now();
    let mut map = RECENT.lock();
    if map.len() > 10_000 {
        map.retain(|_, v| v.last().is_some_and(|x| t - x < WINDOW));
    }
    let times = map.entry(key).or_default();
    times.retain(|x| t - x < WINDOW);
    if times.len() >= limit {
        return false;
    }
    times.push(t);
    true
}

// ---------------------------------------------------------------- ustawienia stempli

/// Kolor #rrggbb (małe litery) albo None, gdy to nie kolor
fn clean_color(s: &str) -> Option<String> {
    let t = s.trim().to_ascii_lowercase();
    (t.len() == 7 && t.starts_with('#') && t[1..].chars().all(|c| c.is_ascii_hexdigit())).then_some(t)
}

/// Nagrody stempla z bazy: tylko takie, które da się teraz przyznać (karta i skrzynka muszą nadal istnieć)
async fn stamp_rewards(c: &mut Conn, cat: &Catalog, code: &str) -> sqlx::Result<Vec<Value>> {
    let raw: Option<String> = sqlx::query_scalar("SELECT rewards FROM passport_settings WHERE country = $1").bind(code).fetch_optional(c).await?;
    let list: Vec<Value> = raw.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default();
    Ok(list.iter().filter_map(clean_reward).filter(|r| usable(cat, r)).take(MAX_REWARDS).collect())
}

fn usable(cat: &Catalog, r: &Value) -> bool {
    let s = |k: &str| r.get(k).and_then(Value::as_str).unwrap_or("");
    match s("type") {
        "card" => cat.has(s("person")),
        "chest" => valid_chest_kind(cat, s("kind")),
        _ => true,
    }
}

/// Wygląd stempli zmieniony z panelu: kolor i wersja ikony (adres `/passport/icon/<kod>?v=<wersja>`)
async fn styles(c: &mut Conn) -> sqlx::Result<serde_json::Map<String, Value>> {
    let rows = sqlx::query("SELECT country, color, icon_at, icon IS NOT NULL AS has_icon FROM passport_settings WHERE color <> '' OR icon IS NOT NULL")
        .fetch_all(c)
        .await?;
    Ok(rows
        .iter()
        .map(|r| {
            let mut o = serde_json::Map::new();
            let color: String = r.get("color");
            if !color.is_empty() {
                o.insert("color".into(), json!(color));
            }
            if r.get::<bool, _>("has_icon") {
                o.insert("icon".into(), json!(r.get::<f64, _>("icon_at") as i64));
            }
            (r.get::<String, _>("country"), Value::Object(o))
        })
        .collect())
}

// ---------------------------------------------------------------- gracz

/// Stemple gracza, liczba graczy przy każdym państwie (bez graczy poza rankingiem) i wygląd stempli z panelu
pub async fn passport(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    let mine = sqlx::query("SELECT country, earned_at FROM passport_stamps WHERE user_id = $1 ORDER BY earned_at, country")
        .bind(me.id)
        .fetch_all(&mut *c)
        .await?;
    let counts = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT s.country, COUNT(*) AS n FROM passport_stamps s JOIN users u ON u.id = s.user_id WHERE {NOT_HIDDEN} GROUP BY s.country"
    )))
    .fetch_all(&mut *c)
    .await?;
    let stamps: Vec<_> = mine.iter().map(|r| json!({"c": r.get::<String, _>("country"), "at": r.get::<f64, _>("earned_at")})).collect();
    let holders: serde_json::Map<String, Value> =
        counts.iter().map(|r| (r.get::<String, _>("country"), json!(r.get::<i64, _>("n")))).collect();
    let style = styles(&mut c).await?;
    ok(json!({"stamps": stamps, "holders": holders, "style": style, "total": borders::load()}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Locate {
    lat: f64,
    lon: f64,
    /// dokładność pozycji w metrach (`coords.accuracy`); brak = starszy klient
    accuracy: Option<f64>,
}

/// Gracz kliknął „Zaznacz moją lokalizację”: serwer ustala kraj ze współrzędnych i dopisuje stempel (raz na kraj) razem z nagrodą
/// ustawioną w panelu. Współrzędne żyją tylko w tym zapytaniu - nie trafiają do bazy, logów ani żadnej innej usługi.
pub async fn locate(
    State(st): State<AppState>,
    addr: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Me(me): Me,
    JsonBody(req): JsonBody<Locate>,
) -> Res {
    if !(req.lat.is_finite() && req.lon.is_finite()) || req.lat.abs() > 90.0 || req.lon.abs() > 180.0 {
        return bad("Nieprawidłowa lokalizacja");
    }
    if let Some(a) = req.accuracy {
        if !a.is_finite() || a <= 0.0 || a > MAX_ACCURACY_M {
            return ok(json!({"country": null, "blocked": "accuracy"}));
        }
    }
    let ip = client_ip(&st, &headers, Some(&addr));
    if !allow(format!("u:{}", me.id), PER_USER) || !allow(format!("ip:{ip}"), PER_IP) {
        return bad("Za dużo prób ustalenia lokalizacji. Spróbuj ponownie za godzinę.");
    }
    let Some(code) = borders::country_at(req.lat, req.lon) else {
        // morze, Antarktyda albo obszar, którego Polska nie uznaje za państwo: bez stempla, bez błędu
        return ok(json!({"country": null}));
    };
    let cat = st.cat();
    let cx = Ctx::new(st.clone(), me.clone());
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let t = now();
    // czy od ostatniej lokalizacji dało się dotrzeć do tego państwa (tylko kod państwa i czas, nigdy współrzędne)
    let last: Option<(String, f64)> = sqlx::query_as("SELECT country, at FROM passport_last WHERE user_id = $1").bind(me.id).fetch_optional(&mut *tx).await?;
    if let Some((from, at)) = &last {
        if let Some(wait) = travel_wait_secs(from, code, t - at) {
            tracing::info!("Paszport: gracz {} za szybko z {from} do {code}, brakuje {wait:.0} s", me.id);
            return ok(json!({"country": code, "blocked": "travel", "from": from, "waitMinutes": (wait / 60.0).ceil() as i64}));
        }
    }
    let recent: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM passport_stamps WHERE user_id = $1 AND earned_at > $2")
        .bind(me.id)
        .bind(t - 86400.0)
        .fetch_one(&mut *tx)
        .await?;
    let known: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM passport_stamps WHERE user_id = $1 AND country = $2)").bind(me.id).bind(code).fetch_one(&mut *tx).await?;
    if !known && recent >= MAX_NEW_PER_DAY {
        return ok(json!({"country": code, "blocked": "daily", "limit": MAX_NEW_PER_DAY}));
    }
    sqlx::query("INSERT INTO passport_last (user_id, country, at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET country = excluded.country, at = excluded.at")
        .bind(me.id)
        .bind(code)
        .bind(t)
        .execute(&mut *tx)
        .await?;
    let added = sqlx::query("INSERT INTO passport_stamps (user_id, country, earned_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(me.id)
        .bind(code)
        .bind(t)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM passport_stamps WHERE user_id = $1").bind(me.id).fetch_one(&mut *tx).await?;
    if added == 0 {
        tx.commit().await?;
        return ok(json!({"country": code, "new": false, "count": count}));
    }
    // nagroda za pierwsze zdobycie stempla, w tej samej transakcji
    let rewards = stamp_rewards(&mut tx, &cat, code).await?;
    if !rewards.is_empty() {
        grant_rewards(&mut tx, &cx, &rewards, "passport").await?;
    }
    let (state, chests) = (get_state(&mut tx, me.id).await?, get_chests(&mut tx, &cat, me.id).await?);
    tx.commit().await?;
    let views: Vec<Value> = rewards.iter().map(|r| reward_view(&cat, r)).collect();
    ok(json!({"country": code, "new": true, "count": count, "rewards": views, "state": state, "chests": chests}))
}

/// Ile sekund jeszcze brakuje, żeby z państwa `from` dało się dotrzeć do `to` po `elapsed` sekundach (None = czasu wystarczy)
fn travel_wait_secs(from: &str, to: &str, elapsed: f64) -> Option<f64> {
    let km = borders::min_distance_km(from, to)?;
    if km < NEAR_KM {
        return None;
    }
    let need = km / MAX_SPEED_KMH * 3600.0;
    (elapsed < need).then(|| need - elapsed.max(0.0))
}

/// Gracze, którzy zdobyli stempel danego państwa, od najwcześniejszego (nick i czas; bez graczy poza rankingiem), i nagroda za stempel
pub async fn stamp_holders(State(st): State<AppState>, Me(me): Me, Path(code): Path<String>) -> Res {
    let code = code.to_ascii_uppercase();
    if !borders::has(&code) {
        return bad("Nie ma takiego państwa");
    }
    let mut c = st.db.acquire().await?;
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT s.user_id, s.earned_at FROM passport_stamps s JOIN users u ON u.id = s.user_id
         WHERE s.country = $1 AND {NOT_HIDDEN} ORDER BY s.earned_at, s.user_id LIMIT {HOLDERS_MAX}"
    )))
    .bind(&code)
    .fetch_all(&mut *c)
    .await?;
    let total: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM passport_stamps s JOIN users u ON u.id = s.user_id WHERE s.country = $1 AND {NOT_HIDDEN}"
    )))
    .bind(&code)
    .fetch_one(&mut *c)
    .await?;
    let cat = st.cat();
    let ids: Vec<i64> = rows.iter().map(|r| r.get("user_id")).collect();
    let users = crate::game::users_by_id(&mut c, &cat, ids.iter().copied().map(Some)).await?;
    let list: Vec<_> = rows
        .iter()
        .filter_map(|r| {
            let id: i64 = r.get("user_id");
            let u = users.get(&id)?;
            Some(json!({"user": u, "at": r.get::<f64, _>("earned_at"), "me": id == me.id}))
        })
        .collect();
    let reward: Vec<Value> = stamp_rewards(&mut c, &cat, &code).await?.iter().map(|r| reward_view(&cat, r)).collect();
    ok(json!({"code": code, "users": list, "total": total, "reward": reward}))
}

/// Własna ikona stempla (biały PNG z alfą; kolor nadaje stempel). Adres ma `?v=<wersja>`, więc można ją trzymać w pamięci podręcznej.
pub async fn icon_image(State(st): State<AppState>, Path(code): Path<String>) -> Response {
    let code = code.to_ascii_uppercase();
    let png: Option<Vec<u8>> = sqlx::query_scalar::<_, Option<Vec<u8>>>("SELECT icon FROM passport_settings WHERE country = $1")
        .bind(&code)
        .fetch_optional(&st.db)
        .await
        .ok()
        .flatten()
        .flatten();
    match png {
        Some(b) => (StatusCode::OK, [(header::CONTENT_TYPE, "image/png"), (header::CACHE_CONTROL, "public, max-age=31536000")], b).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// ---------------------------------------------------------------- panel admina

/// Ustawienia wszystkich stempli i listy do formularza nagród (karty, warianty, skrzynki)
pub async fn admin_passport(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let cat = st.cat();
    let (variants, cards, chests) = reward_options(&cat);
    let mut c = st.db.acquire().await?;
    let rows = sqlx::query("SELECT country, color, rewards, icon_at, icon IS NOT NULL AS has_icon FROM passport_settings").fetch_all(&mut *c).await?;
    let settings: serde_json::Map<String, Value> = rows
        .iter()
        .map(|r| {
            let rewards: Value = serde_json::from_str(&r.get::<String, _>("rewards")).unwrap_or_else(|_| json!([]));
            let icon = r.get::<bool, _>("has_icon").then(|| r.get::<f64, _>("icon_at") as i64);
            (r.get::<String, _>("country"), json!({"color": r.get::<String, _>("color"), "rewards": rewards, "icon": icon}))
        })
        .collect();
    let counts = sqlx::query("SELECT country, COUNT(*) AS n FROM passport_stamps GROUP BY country").fetch_all(&mut *c).await?;
    let holders: serde_json::Map<String, Value> = counts.iter().map(|r| (r.get::<String, _>("country"), json!(r.get::<i64, _>("n")))).collect();
    ok(json!({"settings": settings, "variants": variants, "cards": cards, "chests": chests, "holders": holders}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct StampSave {
    /// #rrggbb albo puste (kolor z tabeli państw)
    color: String,
    rewards: Value,
}

/// Kolor i nagroda jednego stempla
pub async fn admin_passport_save(State(st): State<AppState>, Admin(me): Admin, Path(code): Path<String>, JsonBody(req): JsonBody<StampSave>) -> Res {
    let code = code.to_ascii_uppercase();
    if !borders::has(&code) {
        return bad("Nie ma takiego państwa");
    }
    let color = if req.color.trim().is_empty() { String::new() } else { clean_color(&req.color).ok_or_else(|| AppError::bad("Kolor ma mieć postać #rrggbb"))? };
    let cat = st.cat();
    let rewards: Vec<Value> = req.rewards.as_array().into_iter().flatten().filter_map(clean_reward).filter(|r| usable(&cat, r)).take(MAX_REWARDS).collect();
    let mut tx = st.db.begin().await?;
    sqlx::query(
        "INSERT INTO passport_settings (country, color, rewards) VALUES ($1, $2, $3)
         ON CONFLICT (country) DO UPDATE SET color = excluded.color, rewards = excluded.rewards",
    )
    .bind(&code)
    .bind(&color)
    .bind(Value::Array(rewards.clone()).to_string())
    .execute(&mut *tx)
    .await?;
    let desc = format!("{code}: kolor {}, nagrody: {}", if color.is_empty() { "domyślny" } else { &color }, rewards.len());
    log_admin(&mut tx, &me, "passport_save", None, &desc).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "color": color, "rewards": rewards}))
}

/// Własna ikona stempla: wgranie (`image`) albo usunięcie (`remove=1`)
pub async fn admin_passport_icon(State(st): State<AppState>, Admin(me): Admin, Path(code): Path<String>, mp: axum::extract::Multipart) -> Res {
    let code = code.to_ascii_uppercase();
    if !borders::has(&code) {
        return bad("Nie ma takiego państwa");
    }
    let form = Form::read(mp).await?;
    let (version, action): (Option<i64>, &str) = if let Some(blob) = form.upload("image") {
        if blob.len() > ICON_MAX_BYTES {
            return bad("Plik jest za duży (najwyżej 3 MB)");
        }
        let png = process_icon(blob).map_err(AppError::bad)?;
        let at = now();
        sqlx::query(
            "INSERT INTO passport_settings (country, icon, icon_at) VALUES ($1, $2, $3)
             ON CONFLICT (country) DO UPDATE SET icon = excluded.icon, icon_at = excluded.icon_at",
        )
        .bind(&code)
        .bind(png)
        .bind(at)
        .execute(&st.db)
        .await?;
        (Some(at as i64), "passport_icon")
    } else if form.fields.get("remove").map(String::as_str) == Some("1") {
        sqlx::query("UPDATE passport_settings SET icon = NULL, icon_at = 0 WHERE country = $1").bind(&code).execute(&st.db).await?;
        (None, "passport_icon_delete")
    } else {
        return bad("Wybierz plik");
    };
    let mut c = st.db.acquire().await?;
    log_admin(&mut c, &me, action, None, &code).await?;
    ok(json!({"ok": true, "icon": version}))
}

/// Wgrana ikona -> biały obrazek z kanałem alfa (kształt z przezroczystości albo, gdy obrazek jest nieprzezroczysty, z jasności),
/// przycięty do zawartości, wyśrodkowany w kwadracie `ICON_SIZE` i zapisany jako PNG. Stempel barwi ją własnym kolorem (maska),
/// więc kolor wgranego pliku nie ma znaczenia.
fn process_icon(blob: &[u8]) -> Result<Vec<u8>, String> {
    let img = crate::images::decode(blob)?.to_rgba8();
    let (w, h) = img.dimensions();
    if w < 8 || h < 8 {
        return Err("Obrazek jest za mały".into());
    }
    let opaque = img.pixels().all(|p| p[3] >= 250);
    // nieprzezroczysty obrazek: ciemny kształt na jasnym tle (albo odwrotnie - wg jasności ramki)
    let luma = |p: &Rgba<u8>| 0.299 * f32::from(p[0]) + 0.587 * f32::from(p[1]) + 0.114 * f32::from(p[2]);
    let edge: f32 = {
        let mut sum = 0.0;
        let mut n = 0.0;
        for x in 0..w {
            for y in [0, h - 1] {
                sum += luma(img.get_pixel(x, y));
                n += 1.0;
            }
        }
        for y in 0..h {
            for x in [0, w - 1] {
                sum += luma(img.get_pixel(x, y));
                n += 1.0;
            }
        }
        sum / n
    };
    let mut mask = RgbaImage::new(w, h);
    for (x, y, p) in img.enumerate_pixels() {
        let a = if opaque {
            let l = luma(p);
            (if edge >= 128.0 { 255.0 - l } else { l }).clamp(0.0, 255.0) as u8
        } else {
            p[3]
        };
        mask.put_pixel(x, y, Rgba([255, 255, 255, a]));
    }
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0, 0);
    for (x, y, p) in mask.enumerate_pixels() {
        if p[3] > 12 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    if x1 < x0 || y1 < y0 {
        return Err("Ikona jest pusta: wgraj jednokolorowy obrazek na przezroczystym tle".into());
    }
    let crop = imageops::crop_imm(&mask, x0, y0, x1 - x0 + 1, y1 - y0 + 1).to_image();
    let (cw, ch) = crop.dimensions();
    let scale = f64::from(ICON_SIZE) / f64::from(cw.max(ch));
    let (nw, nh) = (((f64::from(cw) * scale).round() as u32).max(1), ((f64::from(ch) * scale).round() as u32).max(1));
    let small = imageops::resize(&crop, nw, nh, imageops::FilterType::Lanczos3);
    let mut out = RgbaImage::new(ICON_SIZE, ICON_SIZE);
    imageops::overlay(&mut out, &small, i64::from((ICON_SIZE - nw) / 2), i64::from((ICON_SIZE - nh) / 2));
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(out).write_to(&mut png, ImageFormat::Png).map_err(|_| "Nie udało się zapisać ikony".to_owned())?;
    Ok(png.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_of(img: &RgbaImage) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(img.clone()).write_to(&mut out, ImageFormat::Png).unwrap();
        out.into_inner()
    }

    fn alpha_at(png: &[u8], x: u32, y: u32) -> u8 {
        image::load_from_memory(png).unwrap().to_rgba8().get_pixel(x, y)[3]
    }

    #[test]
    fn travel_needs_time_but_neighbours_do_not() {
        assert!(travel_wait_secs("PL", "DE", 0.0).is_none(), "sąsiedzi");
        assert!(travel_wait_secs("PL", "PL", 0.0).is_none());
        let wait = travel_wait_secs("PL", "JP", 60.0).expect("Japonia w minutę");
        assert!(wait > 3.0 * 3600.0);
        assert!(travel_wait_secs("PL", "JP", 24.0 * 3600.0).is_none(), "po dobie można dolecieć");
    }

    #[test]
    fn colors() {
        assert_eq!(clean_color(" #A1b2C3 ").as_deref(), Some("#a1b2c3"));
        assert_eq!(clean_color("red"), None);
        assert_eq!(clean_color("#12345"), None);
        assert_eq!(clean_color("#12345g"), None);
    }

    #[test]
    fn transparent_icon_keeps_its_shape_and_loses_its_color() {
        // czerwony kwadrat w rogu przezroczystego obrazka -> przycięty, wyśrodkowany, biały
        let mut im = RgbaImage::new(64, 64);
        for x in 4..20 {
            for y in 4..20 {
                im.put_pixel(x, y, Rgba([200, 10, 10, 255]));
            }
        }
        let out = process_icon(&png_of(&im)).unwrap();
        let o = image::load_from_memory(&out).unwrap().to_rgba8();
        assert_eq!(o.dimensions(), (ICON_SIZE, ICON_SIZE));
        let c = o.get_pixel(ICON_SIZE / 2, ICON_SIZE / 2);
        assert_eq!((c[0], c[1], c[2], c[3]), (255, 255, 255, 255));
        assert_eq!(o.get_pixel(0, 0)[3], 255); // kwadrat wypełnia całe pole
    }

    #[test]
    fn opaque_dark_on_light_becomes_the_shape() {
        // czarne kółko (kwadrat) na białym tle bez przezroczystości
        let mut im = RgbaImage::from_pixel(80, 80, Rgba([255, 255, 255, 255]));
        for x in 30..50 {
            for y in 20..60 {
                im.put_pixel(x, y, Rgba([0, 0, 0, 255]));
            }
        }
        let out = process_icon(&png_of(&im)).unwrap();
        assert!(alpha_at(&out, ICON_SIZE / 2, ICON_SIZE / 2) > 240);
        assert_eq!(alpha_at(&out, 2, ICON_SIZE / 2), 0); // wąski kształt: boki puste
    }

    #[test]
    fn empty_icon_is_rejected() {
        let im = RgbaImage::new(40, 40);
        assert!(process_icon(&png_of(&im)).is_err());
        assert!(process_icon(b"to nie obrazek").is_err());
    }
}
