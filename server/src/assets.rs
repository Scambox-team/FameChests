//! Pliki gry wbudowane w plik wykonywalny (scambox.exe działa sam, bez folderu gry): static/, web/dist/,
//! custom_images/ i catalog_export.json. W wersji debug (cargo run bez --release) rust-embed czyta je z dysku przy każdym
//! zapytaniu - zmiany widać od razu.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::LazyLock;

use axum::extract::Path;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use parking_lot::Mutex;
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../static/"]
pub struct Static;

#[derive(RustEmbed)]
#[folder = "../custom_images/"]
pub struct CustomImages;

/// Zbudowany frontend (web/dist, `npm run build` w web/). Brak folderu nie blokuje kompilacji serwera.
#[derive(RustEmbed)]
#[folder = "../web/dist/"]
#[allow_missing = true]
pub struct Web;

/// catalog_export.json z repozytorium (zmiany z panelu admina dla nowej instalacji)
pub const CATALOG_EXPORT: &str = include_str!("../../catalog_export.json");

/// Plik z static/ (ścieżka względna, np. "js/app.js")
pub fn static_file(path: &str) -> Option<Cow<'static, [u8]>> {
    Static::get(path).map(|f| f.data)
}

/// Wersja pliku statycznego do adresu ?v= (skrót treści - zmienia się razem z plikiem)
fn version(path: &str) -> String {
    static CACHE: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Mutex::default);
    if !cfg!(debug_assertions) {
        if let Some(v) = CACHE.lock().get(path) {
            return v.clone();
        }
    }
    let v = Static::get(path).map(|f| hex::encode(&f.metadata.sha256_hash()[..5])).unwrap_or_else(|| "0".into());
    CACHE.lock().insert(path.to_owned(), v.clone());
    v
}

/// Adres pliku statycznego z ?v=<wersja>: po aktualizacji przeglądarka zawsze pobierze nowy plik
pub fn asset(path: &str) -> String {
    format!("/static/{path}?v={}", version(path))
}

/// Strona startowa nowego frontendu
pub fn web_index() -> Option<String> {
    Web::get("index.html").map(|f| String::from_utf8_lossy(&f.data).into_owned())
}

/// /app/<ścieżka> - pliki zbudowanego frontendu (nazwy zawierają skrót treści, więc mogą być w pamięci przeglądarki na stałe)
pub async fn serve_web(Path(path): Path<String>) -> Response {
    let Some(file) = Web::get(&path) else { return StatusCode::NOT_FOUND.into_response() };
    let mime = file.metadata.mimetype().to_owned();
    let mut resp = file.data.into_owned().into_response();
    let h = resp.headers_mut();
    if let Ok(v) = HeaderValue::from_str(&mime) {
        h.insert(header::CONTENT_TYPE, v);
    }
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
    resp
}

/// /static/<ścieżka> - pliki z wbudowanego folderu static/ (ETag = skrót treści)
pub async fn serve_static(Path(path): Path<String>, headers: HeaderMap) -> Response {
    let Some(file) = Static::get(&path) else { return StatusCode::NOT_FOUND.into_response() };
    let etag = format!("\"{}\"", hex::encode(&file.metadata.sha256_hash()[..8]));
    if headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(etag.as_str()) {
        return StatusCode::NOT_MODIFIED.into_response();
    }
    let mime = file.metadata.mimetype().to_owned();
    let mut resp = file.data.into_owned().into_response();
    let h = resp.headers_mut();
    if let Ok(v) = HeaderValue::from_str(&mime) {
        h.insert(header::CONTENT_TYPE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&etag) {
        h.insert(header::ETAG, v);
    }
    // pliki z ?v= dostają długą pamięć podręczną w web::cache_headers
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_files() {
        assert!(static_file("sw.js").is_some());
        assert!(asset("img/casino_leave.png").starts_with("/static/img/casino_leave.png?v="));
        assert!(CATALOG_EXPORT.contains("\"cards\""));
    }
}
