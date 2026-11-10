//! Radio (funkcje eksperymentalne): albumy z plikami dźwiękowymi, które admin dodaje w panelu (`/admin/radio`), a gracz
//! odtwarza w pętli w Ustawieniach -> Eksperymentalne -> Radio (`web/src/sound/radio.ts`).
//!
//! - albumy (`radio_albums`): nazwa, opis, domyślny tryb (losowo / po kolei), włączony, kolejność w liście;
//! - utwory (`radio_tracks`): wewnętrzna nazwa widoczna dla gracza (plik na dysku może się nazywać inaczej), źródło / credit
//!   (tekst + opcjonalny link), kolejność w albumie ustala admin;
//! - pliki leżą w `DATA_DIR/radio/<id>.<rozszerzenie>` (nie w bazie), serwowane z obsługą Range (przewijanie, Safari).
//!   Dozwolone formaty: mp3, ogg / oga / opus, wav, flac, m4a / aac, mp4 (sam dźwięk), webm. Rozmiar do `MAX_BYTES`
//!   (limit całego żądania to 20 MB).
//! Gracz widzi tylko włączone albumy, w których jest co najmniej jeden utwór. Uprawnienie rangi: `content` (roles::need).

use std::path::PathBuf;

use axum::extract::{Multipart, Path, State};
use axum::http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use super::variants::Form;
use super::{ok, JsonBody};
use crate::auth::{Admin, Me};
use crate::db::now;
use crate::error::{bad, fail, Res};
use crate::game::log_admin;
use crate::state::AppState;
use crate::web::send_file;

/// Największy plik utworu (żądanie ma limit 20 MB razem z polami formularza)
pub const MAX_BYTES: usize = 19 * 1024 * 1024;
const MAX_TRACKS_PER_ALBUM: i64 = 300;
const MAX_ALBUMS: i64 = 50;

/// (rozszerzenie, typ MIME)
const FORMATS: &[(&str, &str)] = &[
    ("mp3", "audio/mpeg"),
    ("ogg", "audio/ogg"),
    ("oga", "audio/ogg"),
    ("opus", "audio/ogg"),
    ("wav", "audio/wav"),
    ("flac", "audio/flac"),
    ("m4a", "audio/mp4"),
    ("aac", "audio/aac"),
    ("mp4", "video/mp4"),
    ("webm", "audio/webm"),
];

pub fn mime_of(ext: &str) -> &'static str {
    FORMATS.iter().find(|f| f.0 == ext).map_or("application/octet-stream", |f| f.1)
}

/// Rozszerzenie z nazwy wgranego pliku (małe litery), jeśli to dozwolony format
pub fn ext_of(filename: &str) -> Option<&'static str> {
    let ext = filename.rsplit_once('.')?.1.to_lowercase();
    FORMATS.iter().map(|f| f.0).find(|e| *e == ext)
}

/// Czy zawartość pasuje do rozszerzenia (po nagłówku pliku) - żeby pod `.mp3` nie wgrać np. strony HTML
pub fn looks_like(ext: &str, b: &[u8]) -> bool {
    let starts = |s: &[u8]| b.starts_with(s);
    match ext {
        "mp3" => starts(b"ID3") || (b.len() > 2 && b[0] == 0xFF && b[1] & 0xE0 == 0xE0),
        "aac" => b.len() > 2 && b[0] == 0xFF && b[1] & 0xF0 == 0xF0,
        "ogg" | "oga" | "opus" => starts(b"OggS"),
        "wav" => starts(b"RIFF") && b.len() > 12 && &b[8..12] == b"WAVE",
        "flac" => starts(b"fLaC"),
        "m4a" | "mp4" => b.len() > 12 && &b[4..8] == b"ftyp",
        "webm" => starts(&[0x1A, 0x45, 0xDF, 0xA3]),
        _ => false,
    }
}

fn radio_dir(st: &AppState) -> PathBuf {
    st.cfg.data_dir.join("radio")
}

fn track_path(st: &AppState, id: i64, ext: &str) -> PathBuf {
    radio_dir(st).join(format!("{id}.{ext}"))
}

fn clean(s: &str, max: usize) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

/// Link ze źródła: tylko http(s), inaczej pusty (wartość trafia do atrybutu href u graczy)
fn clean_url(s: &str) -> String {
    let u = s.trim();
    if (u.starts_with("https://") || u.starts_with("http://")) && u.len() <= 500 && !u.contains(char::is_whitespace) {
        u.to_owned()
    } else {
        String::new()
    }
}

fn track_json(r: &sqlx::postgres::PgRow, admin: bool) -> Value {
    let id: i64 = r.get("id");
    let mut v = json!({
        "id": id,
        "title": r.get::<String, _>("title"),
        "credit": r.get::<String, _>("credit"),
        "sourceUrl": r.get::<String, _>("source_url"),
        "url": format!("/radio/file/{id}"),
    });
    if admin {
        v["ext"] = json!(r.get::<String, _>("ext"));
        v["size"] = json!(r.get::<i64, _>("size"));
        v["albumId"] = json!(r.get::<i64, _>("album_id"));
    }
    v
}

async fn albums_json(st: &AppState, admin: bool) -> sqlx::Result<Vec<Value>> {
    let albums = sqlx::query("SELECT id, name, description, shuffle, enabled FROM radio_albums ORDER BY position, id")
        .fetch_all(&st.db)
        .await?;
    let tracks = sqlx::query("SELECT id, album_id, title, credit, source_url, ext, size FROM radio_tracks ORDER BY position, id")
        .fetch_all(&st.db)
        .await?;
    let mut out = Vec::new();
    for a in albums {
        let id: i64 = a.get("id");
        let enabled = a.get::<i32, _>("enabled") != 0;
        let list: Vec<Value> = tracks.iter().filter(|t| t.get::<i64, _>("album_id") == id).map(|t| track_json(t, admin)).collect();
        if !admin && (!enabled || list.is_empty()) {
            continue;
        }
        out.push(json!({
            "id": id,
            "name": a.get::<String, _>("name"),
            "description": a.get::<String, _>("description"),
            "shuffle": a.get::<i32, _>("shuffle") != 0,
            "enabled": enabled,
            "tracks": list,
        }));
    }
    Ok(out)
}

/// Albumy dla gracza (tylko włączone i niepuste)
pub async fn radio_list(State(st): State<AppState>, Me(_): Me) -> Res {
    ok(json!({ "albums": albums_json(&st, false).await? }))
}

/// Plik utworu (z Range)
pub async fn radio_file(State(st): State<AppState>, Me(_): Me, Path(id): Path<i64>, headers: HeaderMap) -> Res {
    let row = sqlx::query("SELECT t.ext FROM radio_tracks t JOIN radio_albums a ON a.id = t.album_id WHERE t.id = $1 AND a.enabled <> 0")
        .bind(id)
        .fetch_optional(&st.db)
        .await?;
    let Some(row) = row else { return fail(StatusCode::NOT_FOUND, "Nie ma takiego utworu") };
    let ext: String = row.get("ext");
    send_file(&track_path(&st, id, &ext), mime_of(&ext), &headers, "private, max-age=86400").await
}

/// Podgląd dla admina: także z wyłączonych albumów
pub async fn admin_radio_file(State(st): State<AppState>, Admin(_): Admin, Path(id): Path<i64>, headers: HeaderMap) -> Res {
    let ext: Option<String> = sqlx::query_scalar("SELECT ext FROM radio_tracks WHERE id = $1").bind(id).fetch_optional(&st.db).await?;
    let Some(ext) = ext else { return fail(StatusCode::NOT_FOUND, "Nie ma takiego utworu") };
    send_file(&track_path(&st, id, &ext), mime_of(&ext), &headers, "no-store").await
}

pub async fn admin_radio(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let formats: Vec<&str> = FORMATS.iter().map(|f| f.0).collect();
    ok(json!({ "albums": albums_json(&st, true).await?, "formats": formats, "maxBytes": MAX_BYTES }))
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AlbumRequest {
    id: Option<i64>,
    name: String,
    description: String,
    shuffle: bool,
    enabled: bool,
}

/// Nowy album (bez `id`) albo zmiana istniejącego
pub async fn admin_album_save(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<AlbumRequest>) -> Res {
    let name = clean(&req.name, 60);
    if name.is_empty() {
        return bad("Podaj nazwę albumu");
    }
    let description = clean(&req.description, 300);
    let mut tx = st.db.begin().await?;
    match req.id {
        Some(id) => {
            let n = sqlx::query("UPDATE radio_albums SET name = $1, description = $2, shuffle = $3, enabled = $4 WHERE id = $5")
                .bind(&name)
                .bind(&description)
                .bind(req.shuffle as i32)
                .bind(req.enabled as i32)
                .bind(id)
                .execute(&mut *tx)
                .await?
                .rows_affected();
            if n == 0 {
                return fail(StatusCode::NOT_FOUND, "Nie ma takiego albumu");
            }
        }
        None => {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM radio_albums").fetch_one(&mut *tx).await?;
            if count >= MAX_ALBUMS {
                return bad(format!("Najwięcej {MAX_ALBUMS} albumów"));
            }
            sqlx::query(
                "INSERT INTO radio_albums (name, description, shuffle, enabled, position) \
                 VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(position) + 1 FROM radio_albums), 0))",
            )
            .bind(&name)
            .bind(&description)
            .bind(req.shuffle as i32)
            .bind(req.enabled as i32)
            .execute(&mut *tx)
            .await?;
        }
    }
    log_admin(&mut tx, &me, "radio_album_save", None, &name).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

/// Usunięcie albumu razem z utworami i plikami
pub async fn admin_album_delete(State(st): State<AppState>, Admin(me): Admin, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    let files: Vec<(i64, String)> = sqlx::query("SELECT id, ext FROM radio_tracks WHERE album_id = $1")
        .bind(id)
        .fetch_all(&mut *tx)
        .await?
        .iter()
        .map(|r| (r.get("id"), r.get("ext")))
        .collect();
    let name: Option<String> = sqlx::query_scalar("DELETE FROM radio_albums WHERE id = $1 RETURNING name").bind(id).fetch_optional(&mut *tx).await?;
    let Some(name) = name else { return fail(StatusCode::NOT_FOUND, "Nie ma takiego albumu") };
    log_admin(&mut tx, &me, "radio_album_delete", None, &format!("{name} ({} utworów)", files.len())).await?;
    tx.commit().await?;
    for (tid, ext) in files {
        let _ = std::fs::remove_file(track_path(&st, tid, &ext));
    }
    ok(json!({"ok": true}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct OrderRequest {
    ids: Vec<i64>,
}

/// Kolejność albumów w liście (tylko podane id, w podanej kolejności)
pub async fn admin_albums_order(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<OrderRequest>) -> Res {
    let mut tx = st.db.begin().await?;
    for (i, id) in req.ids.iter().enumerate() {
        sqlx::query("UPDATE radio_albums SET position = $1 WHERE id = $2").bind(i as i32).bind(id).execute(&mut *tx).await?;
    }
    log_admin(&mut tx, &me, "radio_order", None, "albumy").await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

/// Kolejność utworów w albumie (tak grają w trybie „po kolei”)
pub async fn admin_tracks_order(State(st): State<AppState>, Admin(me): Admin, Path(album): Path<i64>, JsonBody(req): JsonBody<OrderRequest>) -> Res {
    let mut tx = st.db.begin().await?;
    for (i, id) in req.ids.iter().enumerate() {
        sqlx::query("UPDATE radio_tracks SET position = $1 WHERE id = $2 AND album_id = $3")
            .bind(i as i32)
            .bind(id)
            .bind(album)
            .execute(&mut *tx)
            .await?;
    }
    log_admin(&mut tx, &me, "radio_order", None, &format!("album {album}")).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

/// Nowy utwór: formularz z plikiem (`file`), `albumId`, `title`, `credit`, `sourceUrl`
pub async fn admin_track_upload(State(st): State<AppState>, Admin(me): Admin, mp: Multipart) -> Res {
    let form = Form::read(mp).await?;
    let field = |k: &str| form.fields.get(k).map(String::as_str).unwrap_or("");
    let album: i64 = field("albumId").parse().map_err(|_| crate::error::AppError::bad("Wybierz album"))?;
    let Some(filename) = form.upload_name("file") else { return bad("Wybierz plik dźwiękowy") };
    let Some(ext) = ext_of(filename) else {
        let list: Vec<&str> = FORMATS.iter().map(|f| f.0).collect();
        return bad(format!("Nieobsługiwany format. Dozwolone: {}", list.join(", ")));
    };
    let bytes = form.upload("file").unwrap_or_default();
    if bytes.is_empty() {
        return bad("Plik jest pusty");
    }
    if bytes.len() > MAX_BYTES {
        return bad(format!("Plik jest za duży (najwięcej {} MB)", MAX_BYTES / 1024 / 1024));
    }
    if !looks_like(ext, bytes) {
        return bad(format!("Zawartość pliku nie wygląda na .{ext}"));
    }
    let stem = filename.rsplit_once('.').map_or(filename, |p| p.0);
    let mut title = clean(field("title"), 80);
    if title.is_empty() {
        title = clean(&stem.replace(['_', '-'], " "), 80);
    }
    if title.is_empty() {
        title = "Utwór".into();
    }
    let credit = clean(field("credit"), 200);
    let url = clean_url(field("sourceUrl"));
    let dir = radio_dir(&st);
    std::fs::create_dir_all(&dir).map_err(|e| crate::error::AppError::Internal(e.into()))?;
    let mut tx = st.db.begin().await?;
    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM radio_albums WHERE id = $1").bind(album).fetch_optional(&mut *tx).await?;
    if exists.is_none() {
        return fail(StatusCode::NOT_FOUND, "Nie ma takiego albumu");
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM radio_tracks WHERE album_id = $1").bind(album).fetch_one(&mut *tx).await?;
    if count >= MAX_TRACKS_PER_ALBUM {
        return bad(format!("W albumie może być najwięcej {MAX_TRACKS_PER_ALBUM} utworów"));
    }
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO radio_tracks (album_id, title, credit, source_url, ext, size, position, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT MAX(position) + 1 FROM radio_tracks WHERE album_id = $1), 0), $7) RETURNING id",
    )
    .bind(album)
    .bind(&title)
    .bind(&credit)
    .bind(&url)
    .bind(ext)
    .bind(bytes.len() as i64)
    .bind(now())
    .fetch_one(&mut *tx)
    .await?;
    let path = track_path(&st, id, ext);
    std::fs::write(&path, bytes).map_err(|e| crate::error::AppError::Internal(e.into()))?;
    if let Err(e) = log_admin(&mut tx, &me, "radio_track_add", None, &title).await {
        let _ = std::fs::remove_file(&path);
        return Err(e.into());
    }
    if let Err(e) = tx.commit().await {
        let _ = std::fs::remove_file(&path);
        return Err(e.into());
    }
    ok(json!({"ok": true, "id": id}))
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct TrackRequest {
    title: String,
    credit: String,
    source_url: String,
    album_id: Option<i64>,
}

/// Zmiana nazwy, źródła i albumu utworu (plik zostaje)
pub async fn admin_track_save(State(st): State<AppState>, Admin(me): Admin, Path(id): Path<i64>, JsonBody(req): JsonBody<TrackRequest>) -> Res {
    let title = clean(&req.title, 80);
    if title.is_empty() {
        return bad("Podaj nazwę utworu");
    }
    let mut tx = st.db.begin().await?;
    let n = sqlx::query("UPDATE radio_tracks SET title = $1, credit = $2, source_url = $3 WHERE id = $4")
        .bind(&title)
        .bind(clean(&req.credit, 200))
        .bind(clean_url(&req.source_url))
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return fail(StatusCode::NOT_FOUND, "Nie ma takiego utworu");
    }
    if let Some(album) = req.album_id {
        let ok_album: Option<i64> = sqlx::query_scalar("SELECT id FROM radio_albums WHERE id = $1").bind(album).fetch_optional(&mut *tx).await?;
        if ok_album.is_none() {
            return fail(StatusCode::NOT_FOUND, "Nie ma takiego albumu");
        }
        sqlx::query(
            "UPDATE radio_tracks SET album_id = $1, position = COALESCE((SELECT MAX(position) + 1 FROM radio_tracks WHERE album_id = $1), 0) \
             WHERE id = $2 AND album_id <> $1",
        )
        .bind(album)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    log_admin(&mut tx, &me, "radio_track_save", None, &title).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_track_delete(State(st): State<AppState>, Admin(me): Admin, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    let row = sqlx::query("DELETE FROM radio_tracks WHERE id = $1 RETURNING title, ext").bind(id).fetch_optional(&mut *tx).await?;
    let Some(row) = row else { return fail(StatusCode::NOT_FOUND, "Nie ma takiego utworu") };
    let (title, ext): (String, String) = (row.get("title"), row.get("ext"));
    log_admin(&mut tx, &me, "radio_track_delete", None, &title).await?;
    tx.commit().await?;
    let _ = std::fs::remove_file(track_path(&st, id, &ext));
    ok(json!({"ok": true}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_and_headers() {
        assert_eq!(ext_of("Moja piosenka.MP3"), Some("mp3"));
        assert_eq!(ext_of("a.b.opus"), Some("opus"));
        assert_eq!(ext_of("film.exe"), None);
        assert_eq!(ext_of("bez_rozszerzenia"), None);
        assert!(looks_like("mp3", b"ID3\x04\0\0"));
        assert!(looks_like("mp3", &[0xFF, 0xFB, 0x90]));
        assert!(!looks_like("mp3", b"<html>"));
        assert!(looks_like("ogg", b"OggS\0"));
        assert!(looks_like("wav", b"RIFF\0\0\0\0WAVEfmt "));
        assert!(!looks_like("wav", b"RIFF\0\0\0\0AVI LIST"));
        assert!(looks_like("flac", b"fLaC"));
        assert!(looks_like("m4a", b"\0\0\0\x20ftypM4A \0\0"));
        assert!(looks_like("webm", &[0x1A, 0x45, 0xDF, 0xA3, 1]));
        assert_eq!(mime_of("m4a"), "audio/mp4");
    }

    #[test]
    fn text_fields() {
        assert_eq!(clean("  Ala   ma\tkota  ", 20), "Ala ma kota");
        assert_eq!(clean("abcdef", 3), "abc");
        assert_eq!(clean_url("https://example.com/a"), "https://example.com/a");
        assert_eq!(clean_url("javascript:alert(1)"), "");
        assert_eq!(clean_url("https://a b"), "");
    }
}
