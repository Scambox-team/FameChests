//! Konta: rejestracja, logowanie, wylogowanie, zmiana hasła.

use std::net::SocketAddr;
use std::sync::LazyLock;
use std::time::Duration;

use axum::extract::{ConnectInfo, Path, RawQuery, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use axum_extra::extract::cookie::SignedCookieJar;
use rand::Rng;
use regex::Regex;
use serde::Deserialize;
use serde_json::json;

use super::{ok, JsonBody};
use crate::auth::{
    check_password_async, clear_session, client_ip, find_user, hash_password_async, password_error, session_cookie, user_by_id,
    Me, User, MIN_PASSWORD,
};
use crate::data::g;
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, fail, AppError, Res};
use crate::gotrue::{mask_email, Failure, Signup};
use crate::game::ensure_state;
use crate::state::AppState;

static USERNAME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{3,20}$").unwrap());
static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[^@\s]+@[^@\s]+\.[^@\s]+$").unwrap());

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Credentials {
    /// przy logowaniu: nazwa gracza albo email
    username: String,
    password: String,
    /// tylko przy rejestracji z Supabase Auth
    email: String,
    /// zgoda na regulamin i politykę prywatności oraz potwierdzenie wieku (tylko przy rejestracji)
    terms: bool,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct PasswordChange {
    old: String,
    new: String,
}

/// Pierwsze konto przejmuje zapis gry sprzed wprowadzenia kont
async fn adopt_legacy_save(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    sqlx::query!("UPDATE items SET user_id = $1 WHERE user_id IS NULL", uid).execute(&mut *c).await?;
    sqlx::query!(
        "INSERT INTO user_state (user_id, key, value) SELECT $1, key, value FROM state
         ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value",
        uid
    )
    .execute(&mut *c)
    .await?;
    sqlx::query!(
        "INSERT INTO user_discovered (user_id, person_id) SELECT $1, person_id FROM discovered ON CONFLICT DO NOTHING",
        uid
    )
    .execute(&mut *c)
    .await?;
    sqlx::query!("DELETE FROM state").execute(&mut *c).await?;
    sqlx::query!("DELETE FROM discovered").execute(c).await?;
    Ok(())
}

// ---------------------------------------------------------------- email i Supabase Auth

/// Email i konto w Supabase Auth gracza (brak = konto z samym hasłem w grze)
pub struct AuthLink {
    pub auth_id: String,
    pub email: String,
}

pub async fn auth_link(c: &mut Conn, uid: i64) -> sqlx::Result<Option<AuthLink>> {
    let row = sqlx::query_as::<_, (String, String)>("SELECT auth_id, email FROM user_auth WHERE user_id = $1")
        .bind(uid)
        .fetch_optional(c)
        .await?;
    Ok(row.map(|(auth_id, email)| AuthLink { auth_id, email }))
}

async fn user_by_email(c: &mut Conn, email: &str) -> sqlx::Result<Option<User>> {
    let id = sqlx::query_scalar::<_, i64>("SELECT user_id FROM user_auth WHERE LOWER(email) = LOWER($1)")
        .bind(email.trim())
        .fetch_optional(&mut *c)
        .await?;
    match id {
        Some(id) => user_by_id(c, id).await,
        None => Ok(None),
    }
}

/// Nazwa gracza albo email (kto wpisze "@", ten podaje email)
async fn user_by_login(c: &mut Conn, login: &str) -> sqlx::Result<Option<User>> {
    if login.contains('@') {
        user_by_email(c, login).await
    } else {
        find_user(c, login).await
    }
}

fn unavailable() -> AppError {
    AppError::with_status(StatusCode::SERVICE_UNAVAILABLE, "Logowanie i poczta chwilowo nie działają, spróbuj za chwilę")
}

/// Odmowa Supabase Auth przy zakładaniu konta -> komunikat dla gracza
fn signup_error(f: Failure) -> AppError {
    match f {
        Failure::Unavailable => unavailable(),
        Failure::Rejected { code } => match code.as_str() {
            "user_already_exists" | "email_exists" => AppError::bad("Ten email jest już zarejestrowany"),
            "weak_password" => AppError::bad(password_error()),
            "email_address_invalid" | "validation_failed" => AppError::bad("Podaj poprawny adres email"),
            "over_email_send_rate_limit" | "over_request_rate_limit" => {
                AppError::with_status(StatusCode::TOO_MANY_REQUESTS, "Za dużo prób, spróbuj ponownie za chwilę")
            }
            _ => AppError::bad("Nie udało się założyć konta z tym adresem email"),
        },
    }
}

fn valid_email(email: &str) -> bool {
    email.len() <= 254 && EMAIL_RE.is_match(email)
}

enum Verdict {
    /// hasło dobre; `via_auth` = potwierdziło je Supabase Auth (a nie stary hash w grze)
    Ok { via_auth: bool },
    Wrong,
    /// email nie został jeszcze potwierdzony linkiem z maila
    NotConfirmed,
    /// Supabase Auth nie odpowiada, a konto nie ma starego hasła w grze
    Down,
}

async fn legacy_ok(user: &User, password: &str) -> bool {
    !user.password_hash.is_empty() && check_password_async(user.password_hash.clone(), password.to_owned()).await
}

/// Wynik, gdy rozstrzyga stary hash w grze (`empty` = co zwrócić, jeśli konta nie ma hasha)
async fn by_legacy(user: &User, password: &str, empty: Verdict) -> Verdict {
    if legacy_ok(user, password).await {
        Verdict::Ok { via_auth: false }
    } else if user.password_hash.is_empty() {
        empty
    } else {
        Verdict::Wrong
    }
}

/// Sprawdza hasło: konto z emailem - w Supabase Auth, bez emaila - starym hashem w grze. Hash zostaje też
/// kontom, które dopiero dopisały email (do potwierdzenia linku albo awarii Supabase Auth); po pierwszym
/// logowaniu przez Supabase Auth jest kasowany, żeby stare hasło nie działało po jego zmianie.
async fn verify_password(st: &AppState, user: &User, link: Option<&AuthLink>, password: &str) -> Verdict {
    let (Some(link), Some(gt)) = (link, st.cfg.gotrue.as_ref()) else {
        return by_legacy(user, password, Verdict::Down).await;
    };
    match gt.login(&link.email, password).await {
        Ok(_) => Verdict::Ok { via_auth: true },
        Err(f) if f.is("email_not_confirmed") => by_legacy(user, password, Verdict::NotConfirmed).await,
        Err(Failure::Rejected { .. }) => Verdict::Wrong,
        Err(Failure::Unavailable) => by_legacy(user, password, Verdict::Down).await,
    }
}

/// Nowe hasło konta: w Supabase Auth (konto z emailem) i/albo w grze (konto bez emaila lub ze starym hashem)
pub async fn set_password(st: &AppState, c: &mut Conn, user: &User, link: Option<&AuthLink>, new: &str) -> Res<()> {
    if let (Some(link), Some(gt)) = (link, st.cfg.gotrue.as_ref()) {
        gt.admin_set_password(&link.auth_id, new).await.map_err(|_| unavailable())?;
        if user.password_hash.is_empty() {
            return Ok(());
        }
    }
    let hash = hash_password_async(new.to_owned()).await;
    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2").bind(hash).bind(user.id).execute(c).await?;
    Ok(())
}

// ---------------------------------------------------------------- konta

pub async fn register(State(st): State<AppState>, jar: SignedCookieJar, JsonBody(body): JsonBody<Credentials>) -> Res {
    let name = body.username.trim();
    if !USERNAME_RE.is_match(name) {
        return bad("Nazwa: 3–20 znaków (litery, cyfry, _ . -)");
    }
    let email = body.email.trim().to_lowercase();
    if st.cfg.gotrue.is_some() && !valid_email(&email) {
        return bad("Podaj poprawny adres email");
    }
    if body.password.chars().count() < MIN_PASSWORD {
        return bad(password_error());
    }
    if !body.terms {
        return bad(format!("Zaakceptuj regulamin i politykę prywatności oraz potwierdź, że masz co najmniej {} lat", super::reports::MIN_AGE));
    }
    // konto w Supabase Auth powstaje przed kontem w grze; jeśli to drugie się nie uda, kasujemy pierwsze
    let mut signup: Option<Signup> = None;
    if let Some(gt) = &st.cfg.gotrue {
        let mut c = st.db.acquire().await?;
        if find_user(&mut c, name).await?.is_some() {
            return bad("Ta nazwa jest już zajęta");
        }
        if user_by_email(&mut c, &email).await?.is_some() {
            return bad("Ten email jest już zarejestrowany");
        }
        drop(c);
        signup = Some(gt.signup(&email, &body.password, name).await.map_err(signup_error)?);
    }
    // hasło kont z Supabase Auth jest tylko tam; w grze zostaje puste
    let hash = if signup.is_some() { String::new() } else { hash_password_async(body.password).await };
    let created = async {
        let mut tx = st.db.begin().await?;
        if find_user(&mut tx, name).await?.is_some() {
            return bad("Ta nazwa jest już zajęta");
        }
        let first = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "n!" FROM users"#).fetch_one(&mut *tx).await? == 0;
        let new_id = sqlx::query_scalar!(
            "INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
            name,
            hash,
            i32::from(first),
            now()
        )
        .fetch_one(&mut *tx)
        .await?;
        if first {
            adopt_legacy_save(&mut tx, new_id).await?;
        }
        ensure_state(&mut tx, new_id).await?;
        if let Some(s) = &signup {
            sqlx::query("INSERT INTO user_auth (user_id, auth_id, email) VALUES ($1, $2, $3)")
                .bind(new_id)
                .bind(&s.id)
                .bind(&email)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("INSERT INTO terms_accepted (user_id, version, accepted_at) VALUES ($1, $2, $3)")
            .bind(new_id)
            .bind(super::reports::TERMS_VERSION)
            .bind(now())
            .execute(&mut *tx)
            .await?;
        // nowy gracz nie musi czytać starych list zmian - zobaczy dopiero następną aktualizację
        sqlx::query!("UPDATE user_state SET value = $1 WHERE user_id = $2 AND key = 'patch_seen'", g().patch_version(), new_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok::<(i64, bool), AppError>((new_id, first))
    }
    .await;
    let (new_id, first) = match created {
        Ok(v) => v,
        Err(e) => {
            if let (Some(gt), Some(s)) = (&st.cfg.gotrue, &signup) {
                let _ = gt.admin_delete(&s.id).await;
            }
            return Err(e);
        }
    };
    // z potwierdzaniem emaila gracz loguje się dopiero po kliknięciu w link z maila
    if signup.as_ref().is_some_and(|s| !s.confirmed) {
        return Ok(Json(json!({"ok": true, "first": first, "confirm": true})).into_response());
    }
    let jar = jar.add(session_cookie(new_id, st.cfg.cookie_secure));
    Ok((jar, Json(json!({"ok": true, "first": first}))).into_response())
}

pub async fn login(
    State(st): State<AppState>,
    addr: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: SignedCookieJar,
    JsonBody(body): JsonBody<Credentials>,
) -> Res {
    let name = body.username.trim();
    let ip = client_ip(&st, &headers, Some(&addr));
    let wait = st.login.blocked(name, &ip);
    if wait > 0 {
        let msg = format!("Za dużo nieudanych prób logowania. Spróbuj ponownie za {} min.", wait / 60 + 1);
        return fail(StatusCode::TOO_MANY_REQUESTS, msg);
    }
    let mut c = st.db.acquire().await?;
    let user = user_by_login(&mut c, name).await?;
    let verdict = match &user {
        Some(u) => {
            let link = auth_link(&mut c, u.id).await?;
            verify_password(&st, u, link.as_ref(), &body.password).await
        }
        None => Verdict::Wrong,
    };
    let (Verdict::Ok { via_auth }, Some(user)) = (&verdict, user) else {
        return match verdict {
            Verdict::NotConfirmed => Err(AppError::Json(
                StatusCode::FORBIDDEN,
                json!({"error": "Potwierdź adres email: kliknij w link z wiadomości, którą wysłaliśmy po rejestracji.", "unconfirmed": true}),
            )),
            Verdict::Down => Err(unavailable()),
            _ => {
                st.login.note(name, &ip, false);
                metrics::counter!("scambox_login_failures_total").increment(1);
                tokio::time::sleep(Duration::from_millis(400)).await;
                bad("Zła nazwa użytkownika lub hasło")
            }
        };
    };
    st.login.note(name, &ip, true);
    if user.banned != 0 {
        let reason = if user.ban_reason.is_empty() { String::new() } else { format!(" Powód: {}", user.ban_reason) };
        return fail(StatusCode::FORBIDDEN, format!("To konto zostało zablokowane przez admina.{reason}"));
    }
    if *via_auth && !user.password_hash.is_empty() {
        sqlx::query("UPDATE users SET password_hash = '' WHERE id = $1").bind(user.id).execute(&mut *c).await?;
    }
    ensure_state(&mut c, user.id).await?;
    let jar = jar.add(session_cookie(user.id, st.cfg.cookie_secure));
    Ok((jar, Json(json!({"ok": true}))).into_response())
}

pub async fn logout(jar: SignedCookieJar) -> impl IntoResponse {
    (clear_session(jar), Json(json!({"ok": true})))
}

pub async fn change_password(
    State(st): State<AppState>,
    Me(me): Me,
    addr: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    JsonBody(body): JsonBody<PasswordChange>,
) -> Res {
    let ip = client_ip(&st, &headers, Some(&addr));
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if st.login.blocked(&me.username, &ip) > 0 {
        return fail(StatusCode::TOO_MANY_REQUESTS, "Za dużo nieudanych prób. Spróbuj ponownie za kilka minut.");
    }
    let link = auth_link(&mut tx, me.id).await?;
    match verify_password(&st, &me, link.as_ref(), &body.old).await {
        Verdict::Ok { .. } => {}
        Verdict::Down => return Err(unavailable()),
        Verdict::Wrong | Verdict::NotConfirmed => {
            st.login.note(&me.username, &ip, false);
            return bad("Obecne hasło jest nieprawidłowe");
        }
    }
    if body.new.chars().count() < MIN_PASSWORD {
        return bad(format!("Nowe hasło musi mieć co najmniej {MIN_PASSWORD} znaków"));
    }
    set_password(&st, &mut tx, &me, link.as_ref(), &body.new).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- odzyskiwanie hasła i email w koncie

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct EmailBody {
    email: String,
    password: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ResetBody {
    /// token z adresu strony po kliknięciu w link z maila
    token: String,
    password: String,
}

/// Mail z linkiem do resetu hasła (Supabase Auth). Wynik nie zdradza, czy email ma konto: inna odmowa niż limit
/// wysyłek i awaria liczy się jak wysłany mail. Używa go „zapomniałem hasła” i akcja admina.
pub async fn send_recovery(st: &AppState, email: &str) -> Res<()> {
    let Some(gt) = &st.cfg.gotrue else { return bad("Odzyskiwanie hasła nie jest tu włączone") };
    let email = email.trim().to_lowercase();
    if !valid_email(&email) {
        return bad("Podaj poprawny adres email");
    }
    match gt.recover(&email).await {
        Err(Failure::Rejected { code }) if code.starts_with("over_") => {
            fail(StatusCode::TOO_MANY_REQUESTS, "Mail już wysłaliśmy, odczekaj chwilę przed kolejnym.")
        }
        Err(Failure::Unavailable) => Err(unavailable()),
        _ => Ok(()),
    }
}

/// "Zapomniałem hasła": mail z linkiem. Odpowiedź jest zawsze taka sama - nie zdradza, czy email ma konto.
pub async fn forgot(State(st): State<AppState>, JsonBody(body): JsonBody<EmailBody>) -> Res {
    send_recovery(&st, &body.email).await?;
    ok(json!({"ok": true}))
}

/// Link z maila nie dotarł albo wygasł: wysyła potwierdzenie emaila jeszcze raz (przyjmuje nazwę gracza albo email)
pub async fn resend(State(st): State<AppState>, JsonBody(body): JsonBody<Credentials>) -> Res {
    let Some(gt) = &st.cfg.gotrue else { return bad("Email nie jest tu włączony") };
    let mut c = st.db.acquire().await?;
    if let Some(u) = user_by_login(&mut c, body.username.trim()).await? {
        if let Some(link) = auth_link(&mut c, u.id).await? {
            match gt.resend(&link.email).await {
                Err(Failure::Rejected { code }) if code.starts_with("over_") => {
                    return fail(StatusCode::TOO_MANY_REQUESTS, "Mail już wysłaliśmy, odczekaj chwilę przed kolejnym.");
                }
                Err(Failure::Unavailable) => return Err(unavailable()),
                _ => {}
            }
        }
    }
    ok(json!({"ok": true}))
}

/// Nowe hasło po kliknięciu w link z maila
pub async fn reset_password(State(st): State<AppState>, JsonBody(body): JsonBody<ResetBody>) -> Res {
    let Some(gt) = &st.cfg.gotrue else { return bad("Odzyskiwanie hasła nie jest tu włączone") };
    if body.password.chars().count() < MIN_PASSWORD {
        return bad(password_error());
    }
    match gt.set_password_with_token(&body.token, &body.password).await {
        Ok(auth_id) => {
            // od teraz liczy się tylko hasło z Supabase Auth
            sqlx::query("UPDATE users SET password_hash = '' WHERE id IN (SELECT user_id FROM user_auth WHERE auth_id = $1)")
                .bind(auth_id)
                .execute(&st.db)
                .await?;
            ok(json!({"ok": true}))
        }
        Err(f) if f.is("same_password") => bad("Nowe hasło musi się różnić od poprzedniego"),
        Err(f) if f.is("weak_password") => bad(password_error()),
        Err(Failure::Rejected { .. }) => bad("Link wygasł albo został już użyty. Poproś o nowy."),
        Err(Failure::Unavailable) => Err(unavailable()),
    }
}

/// Szablony maili Supabase Auth (HTML w `server/email/`, w wyglądzie gry). GoTrue pobiera je z tego adresu
/// (`GOTRUE_MAILER_TEMPLATES_*` w `deploy/selfhost/docker-compose.override.yml`); są publiczne i bez danych - to sam układ z polami `{{ .ConfirmationURL }}`.
pub async fn email_template(Path(name): Path<String>) -> Response {
    let html = match name.as_str() {
        "confirmation.html" => include_str!("../../email/confirmation.html"),
        "recovery.html" => include_str!("../../email/recovery.html"),
        "email_change.html" => include_str!("../../email/email_change.html"),
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "public, max-age=300")], html).into_response()
}

/// Admin dopisuje email graczowi, który go nie ma (zgubił hasło przed dodaniem emaila): zakłada konto w Supabase Auth
/// z losowym hasłem i zapisuje powiązanie (`user_auth`). Potem leci zwykły mail z linkiem do nowego hasła. Stare hasło
/// z gry przestaje działać dopiero, gdy gracz ustawi nowe (`reset_password` kasuje hash).
pub async fn admin_attach_email(st: &AppState, c: &mut Conn, user: &User, email: &str) -> Res<String> {
    let Some(gt) = &st.cfg.gotrue else { return bad("Email nie jest tu włączony") };
    let email = email.trim().to_lowercase();
    if !valid_email(&email) {
        return bad("Podaj poprawny adres email");
    }
    if user_by_email(c, &email).await?.is_some() {
        return bad("Ten adres jest już przypisany do innego konta");
    }
    let password: String = rand::thread_rng().sample_iter(rand::distributions::Alphanumeric).take(40).map(char::from).collect();
    let id = gt.admin_create(&email, &password, &user.username).await.map_err(|f| match f {
        Failure::Unavailable => unavailable(),
        Failure::Rejected { .. } => AppError::bad("Nie udało się przypisać tego adresu (może być już zajęty)"),
    })?;
    let saved = sqlx::query("INSERT INTO user_auth (user_id, auth_id, email) VALUES ($1, $2, $3)")
        .bind(user.id)
        .bind(&id)
        .bind(&email)
        .execute(&mut *c)
        .await;
    if let Err(e) = saved {
        let _ = gt.admin_delete(&id).await;
        return Err(e.into());
    }
    Ok(id)
}

/// Email konta (zamaskowany) - ustawienia gracza
pub async fn email_info(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    let link = auth_link(&mut c, me.id).await?;
    ok(json!({"enabled": st.cfg.gotrue.is_some(), "email": link.map(|l| mask_email(&l.email))}))
}

/// Gracz sprzed emaili dopisuje adres do konta (potrzebne do odzyskania hasła). Wymaga obecnego hasła.
pub async fn add_email(
    State(st): State<AppState>,
    Me(me): Me,
    addr: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    JsonBody(body): JsonBody<EmailBody>,
) -> Res {
    let Some(gt) = &st.cfg.gotrue else { return bad("Email nie jest tu włączony") };
    let ip = client_ip(&st, &headers, Some(&addr));
    let email = body.email.trim().to_lowercase();
    if !valid_email(&email) {
        return bad("Podaj poprawny adres email");
    }
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if st.login.blocked(&me.username, &ip) > 0 {
        return fail(StatusCode::TOO_MANY_REQUESTS, "Za dużo nieudanych prób. Spróbuj ponownie za kilka minut.");
    }
    if auth_link(&mut tx, me.id).await?.is_some() {
        return bad("To konto ma już przypisany email");
    }
    if !legacy_ok(&me, &body.password).await {
        st.login.note(&me.username, &ip, false);
        return bad("Hasło jest nieprawidłowe");
    }
    if user_by_email(&mut tx, &email).await?.is_some() {
        return bad("Ten email jest już zarejestrowany");
    }
    let signup = gt.signup(&email, &body.password, &me.username).await.map_err(signup_error)?;
    let saved = sqlx::query("INSERT INTO user_auth (user_id, auth_id, email) VALUES ($1, $2, $3)")
        .bind(me.id)
        .bind(&signup.id)
        .bind(&email)
        .execute(&mut *tx)
        .await;
    if let Err(e) = saved {
        let _ = gt.admin_delete(&signup.id).await;
        return Err(e.into());
    }
    tx.commit().await?;
    ok(json!({"ok": true, "confirm": !signup.confirmed}))
}

/// Link z maila (`/auth/v1/verify`): Supabase Auth sprawdza token i odsyła na stronę logowania z wynikiem w adresie
pub async fn auth_verify(State(st): State<AppState>, RawQuery(query): RawQuery) -> Response {
    let Some(gt) = &st.cfg.gotrue else { return StatusCode::NOT_FOUND.into_response() };
    match gt.verify(&query.unwrap_or_default()).await {
        Ok(v) => match v.location {
            Some(to) => (StatusCode::SEE_OTHER, [(header::LOCATION, to), (header::CACHE_CONTROL, "no-store".to_owned())]).into_response(),
            None => (StatusCode::BAD_REQUEST, "Nieprawidłowy link").into_response(),
        },
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn email_templates_keep_the_gotrue_placeholders() {
        for html in [
            include_str!("../../email/confirmation.html"),
            include_str!("../../email/recovery.html"),
            include_str!("../../email/email_change.html"),
        ] {
            assert!(html.contains("{{ .ConfirmationURL }}") && html.contains("{{ .Email }}"));
            assert!(!html.contains("{{{") && !html.contains("}}}"), "niedomknięte pole szablonu");
        }
        assert!(include_str!("../../email/email_change.html").contains("{{ .NewEmail }}"));
    }
}
