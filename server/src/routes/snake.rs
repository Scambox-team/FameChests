//! Snake (zakładka Gry): gra liczy się w przeglądarce (features/snake/), serwer trzyma tylko wygląd ustawiany w panelu admina:
//! kolor węża i tła (tabela `state`, klucze `snake_color` / `snake_bg` jako 0xRRGGBB) i obrazki PNG (głowa, ciało, jabłko,
//! tło) w image_cache jako `__snake_<miejsce>.png` (eksport w export.rs).

use std::collections::HashMap;

use axum::extract::{Multipart, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use serde_json::{json, Map, Value};

use super::ok;
use super::variants::Form;
use crate::auth::{Admin, Me};
use crate::db::Conn;
use crate::error::{bad, AppError, Res};
use crate::game::log_admin;
use crate::images::{file_mtime, mimetype, sniff, Kind};
use crate::state::AppState;
use crate::web::send_file;

/// Miejsca na obrazki: klucz i nazwa w panelu
pub const SLOTS: &[(&str, &str)] = &[("head", "głowa"), ("body", "ciało"), ("apple", "jabłko"), ("bg", "tło")];
const DEFAULT_COLOR: i64 = 0x4ade80;
const DEFAULT_BG: i64 = 0x0d130f;

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

async fn color(c: &mut Conn, key: &str, default: i64) -> sqlx::Result<i64> {
    let v: Option<i64> = sqlx::query_scalar("SELECT value FROM state WHERE key = $1").bind(key).fetch_optional(&mut *c).await?;
    Ok(v.unwrap_or(default))
}

/// Wygląd gry dla przeglądarki: kolory i adresy obrazków (null = brak, gra rysuje sama)
async fn look(st: &AppState) -> Res<Value> {
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
    Ok(json!({
        "color": hex(color(&mut c, "snake_color", DEFAULT_COLOR).await?),
        "background": hex(color(&mut c, "snake_bg", DEFAULT_BG).await?),
        "defaults": {"color": hex(DEFAULT_COLOR), "background": hex(DEFAULT_BG)},
        "images": images,
    }))
}

pub async fn snake_config(State(st): State<AppState>, Me(_): Me) -> Res {
    ok(look(&st).await?)
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

/// Panel admina: kolory (`color`, `background` jako #rrggbb, `reset=1` = domyślne), obrazki PNG (pola head / body / apple / bg)
/// i usuwanie obrazka (`remove` = miejsce)
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
            sqlx::query("INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
                .bind(key)
                .bind(v)
                .execute(&mut *tx)
                .await?;
        }
    }
    if reset {
        done.push("domyślne kolory".into());
    } else if form.fields.contains_key("color") {
        done.push(format!("kolory: {} / {}", form.fields["color"], form.fields.get("background").map_or("", String::as_str)));
    }
    log_admin(&mut tx, &me, "snake", None, &done.join(", ")).await?;
    tx.commit().await?;
    ok(look(&st).await?)
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
}
