//! Maile do kont wysyłane przez grę (własny SMTP): reset hasła i zmiana emaila linkami z jednorazowym tokenem
//! (`tokens.rs`), treści z szablonów (`mail_templates.rs`, edytowalne w panelu admina). Bez SMTP link ląduje w logu serwera.

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::json;

use super::account::{auth_link, mail_on, own_mail, unavailable, user_by_email, valid_email};
use super::{ok, JsonBody};
use crate::auth::{password_error, user_by_id, Me, User, MIN_PASSWORD};
use crate::db::{lock_me, Conn};
use crate::error::{bad, fail, AppError, Res};
use crate::gotrue::Failure;
use crate::mail_templates::render_named;
use crate::state::AppState;
use crate::tokens::{self, KIND_EMAIL_CHANGE, KIND_RESET, KIND_VERIFY};

/// Najkrótszy odstęp między kolejnymi mailami z linkiem tego samego rodzaju do jednego gracza
const RESEND_GAP: f64 = 60.0;
const TOO_SOON: &str = "Mail już wysłaliśmy, odczekaj chwilę przed kolejnym.";
const BAD_LINK: &str = "Link wygasł albo został już użyty. Poproś o nowy.";

/// Adres gry w linkach z maili: PUBLIC_URL, a bez niego adres z nagłówka Host
pub fn base_url(st: &AppState, headers: &HeaderMap) -> String {
    if let Some(u) = &st.cfg.public_url {
        return u.clone();
    }
    let host = headers.get(header::HOST).and_then(|h| h.to_str().ok()).filter(|h| !h.is_empty()).unwrap_or("localhost");
    let forwarded = headers.get("x-forwarded-proto").and_then(|h| h.to_str().ok()).filter(|p| matches!(*p, "http" | "https"));
    let proto = match forwarded {
        Some(p) if st.cfg.trust_proxy => p,
        _ if st.cfg.cookie_secure => "https",
        _ => "http",
    };
    format!("{proto}://{host}")
}

/// Mail z linkiem do ustawienia nowego hasła (token jednorazowy, ważny godzinę)
async fn send_password_reset(st: &AppState, c: &mut Conn, base: &str, user: &User, email: &str) -> Res<()> {
    let raw = tokens::issue(c, user.id, KIND_RESET).await?;
    let link = format!("{base}/login?t={raw}");
    let minutes = tokens::ttl_minutes(KIND_RESET).to_string();
    let (subject, html) =
        render_named(c, "password_reset", &[("Link", &link), ("Username", &user.username), ("ExpiresMinutes", &minutes)]).await?;
    st.cfg.mailer.send(email, &subject, &html).await.map_err(|_| unavailable())
}

/// Mail z linkiem potwierdzającym email (ważny 24 h), link na `/konto/potwierdz`. Błąd tylko w logu - rejestracja
/// i dodanie emaila się nie cofają, gracz może poprosić o link ponownie w ustawieniach konta.
pub async fn send_verification(st: &AppState, base: &str, uid: i64, username: &str, email: &str) {
    let sent = async {
        let mut c = st.db.acquire().await.map_err(|e| e.to_string())?;
        let raw = tokens::issue(&mut c, uid, KIND_VERIFY).await.map_err(|e| e.to_string())?;
        let link = format!("{base}/konto/potwierdz?t={raw}");
        let minutes = tokens::ttl_minutes(KIND_VERIFY).to_string();
        let (subject, html) = render_named(&mut c, "email_verify", &[("Link", &link), ("Username", username), ("ExpiresMinutes", &minutes)])
            .await
            .map_err(|e| e.to_string())?;
        st.cfg.mailer.send(email, &subject, &html).await
    }
    .await;
    if let Err(e) = sent {
        tracing::warn!("potwierdzenie emaila gracza {uid}: mail nie wyszedł: {e}");
    }
}

/// Gracz prosi o ponowne wysłanie linku potwierdzającego email
pub async fn verify_resend(State(st): State<AppState>, Me(me): Me, headers: HeaderMap) -> Res {
    let mut c = st.db.acquire().await?;
    let Some(link) = auth_link(&mut c, me.id).await? else { return bad("To konto nie ma jeszcze emaila") };
    if link.verified || !link.is_local() || !super::account::verify_by_mail(&st) {
        return bad("Ten email nie wymaga potwierdzenia");
    }
    if tokens::issued_within(&mut c, me.id, KIND_VERIFY, RESEND_GAP).await? {
        return fail(StatusCode::TOO_MANY_REQUESTS, TOO_SOON);
    }
    drop(c);
    send_verification(&st, &base_url(&st, &headers), me.id, &me.username, &link.email).await;
    ok(json!({"ok": true}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct TokenOnly {
    token: String,
}

/// Strona pod linkiem potwierdzającym email (`/konto/potwierdz?t=...`): token wystarcza, logowanie niepotrzebne
pub async fn verify_confirm(State(st): State<AppState>, JsonBody(body): JsonBody<TokenOnly>) -> Res {
    let mut tx = st.db.begin().await?;
    let Some(uid) = tokens::consume(&mut tx, body.token.trim(), KIND_VERIFY).await? else { return bad(BAD_LINK) };
    super::account::on_email_verified(&st, &mut tx, uid).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

/// Reset hasła na `email`: własnym mailerem (gdy jest SMTP albo nie ma Supabase Auth), inaczej przez Supabase Auth.
/// `strict` = admin / zalogowany gracz (błędy widać); bez niego („zapomniałem hasła”) odpowiedź jest zawsze taka sama
/// i nie zdradza, czy adres ma konto.
pub async fn deliver_reset(st: &AppState, c: &mut Conn, base: &str, email: &str, strict: bool) -> Res<()> {
    if !own_mail(st) {
        return super::account::send_recovery(st, email).await;
    }
    let email = email.trim().to_lowercase();
    let Some(user) = user_by_email(c, &email).await? else { return Ok(()) };
    if tokens::issued_within(c, user.id, KIND_RESET, RESEND_GAP).await? {
        return if strict { fail(StatusCode::TOO_MANY_REQUESTS, TOO_SOON) } else { Ok(()) };
    }
    match send_password_reset(st, c, base, &user, &email).await {
        Err(e) if !strict => {
            tracing::warn!("reset hasła: mail dla gracza {} nie wyszedł: {e}", user.id);
            Ok(())
        }
        r => r,
    }
}

/// Zalogowany gracz prosi o link do zmiany hasła na własny email
pub async fn send_link(State(st): State<AppState>, Me(me): Me, headers: HeaderMap) -> Res {
    let mut c = st.db.acquire().await?;
    let Some(link) = auth_link(&mut c, me.id).await? else {
        return bad("To konto nie ma jeszcze emaila - najpierw go dodaj (Profil, Email).");
    };
    if !mail_on(&st) {
        return bad("Wysyłka maili nie jest tu włączona");
    }
    deliver_reset(&st, &mut c, &base_url(&st, &headers), &link.email, true).await?;
    ok(json!({"ok": true}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct TokenPassword {
    token: String,
    password: String,
}

/// Nowe hasło z linku w naszym mailu (token `sb1_...`): jedna transakcja z blokadą gracza, token zużyty razem ze zmianą
pub async fn reset_with_token(State(st): State<AppState>, JsonBody(body): JsonBody<TokenPassword>) -> Res {
    if body.password.chars().count() < MIN_PASSWORD {
        return bad(password_error());
    }
    let mut tx = st.db.begin().await?;
    let Some(uid) = tokens::consume(&mut tx, body.token.trim(), KIND_RESET).await? else { return bad(BAD_LINK) };
    lock_me(&mut tx, uid).await?;
    let Some(user) = user_by_id(&mut tx, uid).await? else { return bad(BAD_LINK) };
    let link = auth_link(&mut tx, uid).await?;
    super::account::set_password(&st, &mut tx, &user, link.as_ref(), &body.password).await?;
    // link z maila dotarł do właściciela skrzynki, więc email jest potwierdzony
    super::account::on_email_verified(&st, &mut tx, uid).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- zmiana emaila

/// Zmienia email konta (gracz z linku albo admin): walidacja, unikalność, Supabase Auth (jeśli konto tam jest), `user_auth`.
/// Zwraca poprzedni adres. Konto bez emaila nie ma czego zmieniać (dopisuje się go innym torem).
pub async fn change_email(st: &AppState, c: &mut Conn, user: &User, new_email: &str) -> Res<String> {
    let email = new_email.trim().to_lowercase();
    if !valid_email(&email) {
        return bad("Podaj poprawny adres email");
    }
    let Some(link) = auth_link(c, user.id).await? else { return bad("To konto nie ma jeszcze emaila") };
    if link.email.eq_ignore_ascii_case(&email) {
        return bad("To już jest adres tego konta");
    }
    if user_by_email(c, &email).await?.is_some_and(|o| o.id != user.id) {
        return bad("Ten email jest już zarejestrowany");
    }
    if let (Some(gt), false) = (&st.cfg.gotrue, link.is_local()) {
        gt.admin_set_email(&link.auth_id, &email).await.map_err(|f| match f {
            Failure::Unavailable => unavailable(),
            Failure::Rejected { .. } => AppError::bad("Nie udało się zmienić adresu (może być już zajęty)"),
        })?;
    }
    sqlx::query("UPDATE user_auth SET email = $1 WHERE user_id = $2").bind(&email).bind(user.id).execute(c).await?;
    Ok(link.email)
}

/// Informacja na stary adres, że email konta został zmieniony (po zatwierdzeniu zmiany; błąd tylko w logu)
pub async fn notify_email_changed(st: &AppState, c: &mut Conn, user: &User, old_email: &str, new_email: &str) {
    let sent = async {
        let (subject, html) = render_named(c, "email_changed_notice", &[("Username", &user.username), ("NewEmail", new_email)]).await.map_err(|e| e.to_string())?;
        st.cfg.mailer.send(old_email, &subject, &html).await
    }
    .await;
    if let Err(e) = sent {
        tracing::warn!("zmiana emaila gracza {}: powiadomienie na stary adres nie wyszło: {e}", user.id);
    }
}

/// Zalogowany gracz prosi o zmianę emaila: link idzie na OBECNY adres konta
pub async fn email_change_request(State(st): State<AppState>, Me(me): Me, headers: HeaderMap) -> Res {
    if !own_mail(&st) {
        return bad("Zmiana emaila linkiem nie jest tu dostępna");
    }
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let Some(link) = auth_link(&mut tx, me.id).await? else {
        return bad("To konto nie ma jeszcze emaila - najpierw go dodaj (Profil, Email).");
    };
    if tokens::issued_within(&mut tx, me.id, KIND_EMAIL_CHANGE, RESEND_GAP).await? {
        return fail(StatusCode::TOO_MANY_REQUESTS, TOO_SOON);
    }
    let raw = tokens::issue(&mut tx, me.id, KIND_EMAIL_CHANGE).await?;
    let url = format!("{}/konto/email?t={raw}", base_url(&st, &headers));
    let minutes = tokens::ttl_minutes(KIND_EMAIL_CHANGE).to_string();
    let (subject, html) =
        render_named(&mut tx, "email_change_request", &[("Link", &url), ("Username", &me.username), ("ExpiresMinutes", &minutes)]).await?;
    st.cfg.mailer.send(&link.email, &subject, &html).await.map_err(|_| unavailable())?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct EmailChangeConfirm {
    token: String,
    email: String,
    /// powtórzony nowy adres (jeśli przesłany, musi być taki sam)
    repeat: String,
}

/// Nowy adres z formularza pod linkiem z maila (token wystarcza, logowanie niepotrzebne)
pub async fn email_change_confirm(State(st): State<AppState>, headers: HeaderMap, JsonBody(body): JsonBody<EmailChangeConfirm>) -> Res {
    let email = body.email.trim().to_lowercase();
    if !valid_email(&email) {
        return bad("Podaj poprawny adres email");
    }
    if !body.repeat.is_empty() && body.repeat.trim().to_lowercase() != email {
        return bad("Adresy nie są takie same");
    }
    let mut tx = st.db.begin().await?;
    // zły adres (zajęty itp.) cofa transakcję razem ze zużyciem tokenu - można spróbować jeszcze raz tym samym linkiem
    let Some(uid) = tokens::consume(&mut tx, body.token.trim(), KIND_EMAIL_CHANGE).await? else { return bad(BAD_LINK) };
    lock_me(&mut tx, uid).await?;
    let Some(user) = user_by_id(&mut tx, uid).await? else { return bad(BAD_LINK) };
    let old = change_email(&st, &mut tx, &user, &email).await?;
    // nowy adres bez Supabase Auth trzeba potwierdzić (do tej pory potwierdzony był tylko stary)
    let reverify = super::account::verify_by_mail(&st);
    if reverify {
        sqlx::query("UPDATE user_auth SET verified_at = NULL WHERE user_id = $1").bind(uid).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    let mut c = st.db.acquire().await?;
    notify_email_changed(&st, &mut c, &user, &old, &email).await;
    drop(c);
    if reverify {
        send_verification(&st, &base_url(&st, &headers), uid, &user.username, &email).await;
    }
    ok(json!({"ok": true}))
}
