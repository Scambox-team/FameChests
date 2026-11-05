//! Regulamin, dane o stronie i zgłoszenia problemów z kartami.
//!
//! Zgłoszenie może wysłać każdy, także osoba bez konta (np. ta, której wizerunek jest na karcie), więc `/api/reports`
//! i `/api/legal` nie wymagają logowania. Zgłoszenia ogląda i rozpatruje admin (zakładka „Zgłoszenia”).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::LazyLock;

use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;

use super::{ok, JsonBody};
use crate::auth::{client_ip, Admin, MaybeUser, Me};
use crate::db::now;
use crate::error::{bad, fail, AppError, Res};
use crate::game::log_admin;
use crate::state::AppState;
use crate::text::clean;

/// Wersja regulaminu i polityki prywatności. Zmiana = wszyscy gracze akceptują ponownie przy następnym wejściu.
/// Zmieniając teksty w `web/src/features/legal/`, podnieś też tę datę (RRRR-MM-DD).
pub const TERMS_VERSION: &str = "2026-11-05";

/// Najmniejszy wiek gracza (regulamin, formularz rejestracji)
pub const MIN_AGE: u32 = 16;

const MESSAGE_MIN: usize = 10;
const MESSAGE_MAX: usize = 2000;

/// Zgłoszenia z jednego adresu IP w oknie `WINDOW`
const PER_IP: usize = 5;
/// Zgłoszenia jednego gracza w oknie `WINDOW`
const PER_USER: usize = 10;
const WINDOW: f64 = 3600.0;

const STATUSES: &[&str] = &["new", "in_progress", "done", "rejected"];

/// (klucz, czy trzeba podać kontakt) - kategorie o usunięcie karty wymagają kontaktu, żeby było komu odpowiedzieć
const CATEGORIES: &[(&str, bool)] = &[
    ("likeness", true),    // to ja / moja bliska osoba: chcę usunięcia albo zmiany karty
    ("copyright", true),   // zdjęcie lub grafika naruszają prawa autorskie
    ("offensive", false),  // obraźliwy, nieprawdziwy albo niestosowny opis, nazwa, statystyki
    ("error", false),      // błąd: zły obraz, wariant, nazwa, wartość
    ("other", false),
];

static RECENT: LazyLock<Mutex<HashMap<String, Vec<f64>>>> = LazyLock::new(Mutex::default);

/// Czy klucz (IP albo gracz) może jeszcze wysłać zgłoszenie; zapisuje próbę
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

/// Dane o stronie do regulaminu i polityki prywatności (publiczne, bez logowania)
pub async fn legal(State(st): State<AppState>) -> Res {
    ok(json!({
        "termsVersion": TERMS_VERSION,
        "minAge": MIN_AGE,
        "operator": st.cfg.operator_name,
        "contactEmail": st.cfg.contact_email,
    }))
}

pub async fn accept_terms(State(st): State<AppState>, Me(me): Me) -> Res {
    sqlx::query("INSERT INTO terms_accepted (user_id, version, accepted_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(me.id)
        .bind(TERMS_VERSION)
        .bind(now())
        .execute(&st.db)
        .await?;
    ok(json!({"ok": true}))
}

/// Czy gracz zaakceptował aktualną wersję regulaminu
pub async fn terms_ok(c: &mut crate::db::Conn, uid: i64) -> sqlx::Result<bool> {
    sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM terms_accepted WHERE user_id = $1 AND version = $2)")
        .bind(uid)
        .bind(TERMS_VERSION)
        .fetch_one(c)
        .await
}

// ---------------------------------------------------------------- zgłoszenia

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ReportRequest {
    /// id karty z katalogu (gdy zgłoszenie idzie z podglądu karty)
    person: String,
    /// nazwa karty wpisana ręcznie (osoba bez konta nie widzi katalogu)
    card_name: String,
    variant: String,
    category: String,
    message: String,
    contact: String,
    /// pułapka na boty: człowiek tego pola nie widzi i nie wypełnia
    leave_empty: String,
}

pub async fn report_create(
    State(st): State<AppState>,
    MaybeUser(me): MaybeUser,
    addr: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    JsonBody(req): JsonBody<ReportRequest>,
) -> Res {
    if !req.leave_empty.trim().is_empty() {
        return ok(json!({"ok": true})); // bot: udajemy, że poszło
    }
    let Some(&(category, needs_contact)) = CATEGORIES.iter().find(|(k, _)| *k == req.category) else {
        return bad("Wybierz rodzaj problemu");
    };
    let message = clean(&req.message.replace("\r\n", "\n"), MESSAGE_MAX);
    if message.chars().count() < MESSAGE_MIN {
        return bad(format!("Opisz problem (co najmniej {MESSAGE_MIN} znaków)"));
    }
    let contact = clean(&req.contact, 120);
    if (needs_contact || !contact.is_empty()) && !looks_like_email(&contact) {
        return bad(if needs_contact {
            "Podaj adres e-mail, na który możemy odpisać"
        } else {
            "Adres e-mail wygląda na nieprawidłowy"
        });
    }

    let cat = st.cat();
    let person = req.person.trim();
    let (person_id, mut card_name) = match cat.person(person) {
        Some(p) => (p.id.clone(), p.name.clone()),
        None => (String::new(), String::new()),
    };
    if card_name.is_empty() {
        card_name = clean(&req.card_name, 100);
    }
    if person_id.is_empty() && card_name.is_empty() {
        return bad("Podaj, której karty dotyczy zgłoszenie");
    }
    let variant = if person_id.is_empty() { String::new() } else { clean(&req.variant, 40) };

    let ip = client_ip(&st, &headers, Some(&addr));
    if !allow(format!("ip:{ip}"), PER_IP) || me.as_ref().is_some_and(|u| !allow(format!("u:{}", u.id), PER_USER)) {
        return fail(StatusCode::TOO_MANY_REQUESTS, "Wysłano już sporo zgłoszeń. Spróbuj ponownie za godzinę.");
    }

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO card_reports (created_at, user_id, username, person_id, card_name, variant, category, message, contact)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
    )
    .bind(now())
    .bind(me.as_ref().map(|u| u.id))
    .bind(me.as_ref().map(|u| u.username.clone()).unwrap_or_default())
    .bind(person_id)
    .bind(card_name)
    .bind(variant)
    .bind(category)
    .bind(message)
    .bind(contact)
    .fetch_one(&st.db)
    .await?;
    // powiadomienie bez danych osobowych: tylko numer i rodzaj, resztę admin widzi w panelu
    crate::mail::notify_admin(
        &st.cfg,
        format!("ScamBox: nowe zgłoszenie karty #{id}"),
        format!("Nowe zgłoszenie #{id}: {}.

Szczegóły są w panelu admina, w zakładce „Zgłoszenia”.", category_label(category)),
    );
    ok(json!({"ok": true}))
}

fn category_label(key: &str) -> &'static str {
    match key {
        "likeness" => "prośba o usunięcie lub zmianę karty (wizerunek)",
        "copyright" => "naruszenie praw autorskich",
        "offensive" => "obraźliwa lub nieprawdziwa treść karty",
        "error" => "błąd na karcie",
        _ => "inny problem z kartą",
    }
}

/// Z grubsza: coś@coś.coś bez spacji. Nie wysyłamy z serwera żadnej poczty, adres służy tylko do odpowiedzi ręcznie.
fn looks_like_email(s: &str) -> bool {
    let Some((user, host)) = s.split_once('@') else { return false };
    !user.is_empty() && host.contains('.') && !host.starts_with('.') && !host.ends_with('.') && !s.chars().any(char::is_whitespace)
}

// ---------------------------------------------------------------- panel admina

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct ReportRow {
    id: i64,
    created_at: f64,
    user_id: Option<i64>,
    username: String,
    person_id: String,
    card_name: String,
    variant: String,
    category: String,
    message: String,
    contact: String,
    status: String,
    admin_note: String,
    handled_by: String,
    handled_at: Option<f64>,
}

pub async fn admin_reports(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let rows: Vec<ReportRow> = sqlx::query_as(
        "SELECT id, created_at, user_id, username, person_id, card_name, variant, category, message, contact, status,
                admin_note, handled_by, handled_at
         FROM card_reports ORDER BY (status IN ('new', 'in_progress')) DESC, id DESC LIMIT 500",
    )
    .fetch_all(&st.db)
    .await?;
    ok(json!({"reports": rows}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ReportUpdate {
    status: String,
    note: String,
}

pub async fn admin_report_update(
    State(st): State<AppState>,
    Admin(me): Admin,
    Path(id): Path<i64>,
    JsonBody(req): JsonBody<ReportUpdate>,
) -> Res {
    if !STATUSES.contains(&req.status.as_str()) {
        return bad("Zły status");
    }
    let note = clean(&req.note.replace("\r\n", "\n"), 1000);
    let mut tx = st.db.begin().await?;
    let done = sqlx::query("UPDATE card_reports SET status = $2, admin_note = $3, handled_by = $4, handled_at = $5 WHERE id = $1")
        .bind(id)
        .bind(&req.status)
        .bind(&note)
        .bind(&me.username)
        .bind(now())
        .execute(&mut *tx)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::with_status(StatusCode::NOT_FOUND, "Nie ma takiego zgłoszenia"));
    }
    log_admin(&mut tx, &me, "report_update", None, &format!("#{id} → {}", req.status)).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

pub async fn admin_report_delete(State(st): State<AppState>, Admin(me): Admin, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    let done = sqlx::query("DELETE FROM card_reports WHERE id = $1").bind(id).execute(&mut *tx).await?;
    if done.rows_affected() == 0 {
        return Err(AppError::with_status(StatusCode::NOT_FOUND, "Nie ma takiego zgłoszenia"));
    }
    log_admin(&mut tx, &me, "report_delete", None, &format!("#{id}")).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emails() {
        assert!(looks_like_email("jan@example.pl"));
        assert!(!looks_like_email("jan@example"));
        assert!(!looks_like_email("jan example@x.pl"));
        assert!(!looks_like_email("@x.pl"));
        assert!(!looks_like_email(""));
    }

    #[test]
    fn request_uses_camel_case_names_from_the_browser() {
        let r: ReportRequest = serde_json::from_str(
            r#"{"person":"pl_x","cardName":"Ktoś","category":"error","message":"coś jest nie tak","contact":"","leaveEmpty":"bot"}"#,
        )
        .unwrap();
        assert_eq!((r.card_name.as_str(), r.leave_empty.as_str()), ("Ktoś", "bot"));
    }

    #[test]
    fn limit() {
        let key = format!("test:{}", now());
        for _ in 0..3 {
            assert!(allow(key.clone(), 3));
        }
        assert!(!allow(key, 3));
    }
}
