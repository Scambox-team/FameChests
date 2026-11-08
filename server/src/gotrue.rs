//! Klient Supabase Auth (GoTrue): rejestracja z emailem, logowanie hasłem, odzyskiwanie hasła.
//!
//! Serwer gry pośredniczy we wszystkich zapytaniach (przeglądarka nie widzi GoTrue), a sesja gracza zostaje
//! podpisanym ciasteczkiem z id konta. GoTrue trzyma tylko email + hasło; nazwa gracza i cała gra są w tabelach gry
//! (powiązanie: tabela `user_auth`). Włączone zmienną GOTRUE_URL - bez niej gra działa jak dawniej (same nazwy i hasła).

use std::sync::LazyLock;
use std::time::Duration;

use reqwest::{Method, RequestBuilder};
use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub struct GoTrue {
    url: String,
    service_key: String,
    public_url: String,
}

/// Dlaczego GoTrue nie wykonał polecenia
#[derive(Debug)]
pub enum Failure {
    /// odmowa (zły login, zajęty email, za słabe hasło...) - `code` to kod błędu GoTrue
    Rejected { code: String },
    /// nie odpowiada albo błąd po jego stronie
    Unavailable,
}

impl Failure {
    pub fn is(&self, want: &str) -> bool {
        matches!(self, Failure::Rejected { code } if code == want)
    }
}

pub struct Signup {
    pub id: String,
    /// email od razu potwierdzony (ENABLE_EMAIL_AUTOCONFIRM=true)
    pub confirmed: bool,
}

pub struct Verify {
    pub status: u16,
    pub location: Option<String>,
}

static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        // link z maila kończy się przekierowaniem na stronę gry - oddajemy je przeglądarce, nie idziemy za nim
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("http")
});

fn code_of(v: &Value) -> String {
    let code = v["error_code"].as_str().or_else(|| v["error"].as_str()).unwrap_or("");
    if code == "invalid_grant" && v["error_description"].as_str().is_some_and(|d| d.to_lowercase().contains("not confirmed")) {
        return "email_not_confirmed".into();
    }
    code.to_owned()
}

fn user_id(v: &Value) -> Option<String> {
    v["user"]["id"].as_str().or_else(|| v["id"].as_str()).map(str::to_owned)
}

async fn send(rb: RequestBuilder) -> Result<Value, Failure> {
    let res = rb.send().await.map_err(|e| {
        tracing::warn!("Supabase Auth nie odpowiada: {e}");
        Failure::Unavailable
    })?;
    let status = res.status().as_u16();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if status >= 500 {
        tracing::warn!("Supabase Auth: błąd {status}: {body}");
        return Err(Failure::Unavailable);
    }
    if status >= 400 {
        let code = if status == 429 && code_of(&body).is_empty() { "over_request_rate_limit".to_owned() } else { code_of(&body) };
        return Err(Failure::Rejected { code });
    }
    Ok(body)
}

impl GoTrue {
    pub fn new(url: &str, service_key: &str, public_url: &str) -> GoTrue {
        GoTrue {
            url: url.trim_end_matches('/').to_owned(),
            service_key: service_key.to_owned(),
            public_url: public_url.trim_end_matches('/').to_owned(),
        }
    }

    fn req(&self, method: Method, path: &str) -> RequestBuilder {
        HTTP.request(method, format!("{}{}", self.url, path))
    }

    fn admin(&self, method: Method, path: &str) -> RequestBuilder {
        self.req(method, path).bearer_auth(&self.service_key)
    }

    /// Dokąd link z maila odsyła gracza (strona logowania odczyta z adresu, co się stało)
    fn redirect(&self) -> String {
        format!("{}/login", self.public_url)
    }

    /// Nowe konto; GoTrue wysyła mail z linkiem potwierdzającym (chyba że ENABLE_EMAIL_AUTOCONFIRM=true)
    pub async fn signup(&self, email: &str, password: &str, username: &str) -> Result<Signup, Failure> {
        let body = json!({"email": email, "password": password, "data": {"username": username}});
        let v = send(self.req(Method::POST, "/signup").query(&[("redirect_to", self.redirect())]).json(&body)).await?;
        let id = user_id(&v).ok_or(Failure::Unavailable)?;
        Ok(Signup { id, confirmed: v["access_token"].is_string() })
    }

    /// Sprawdzenie hasła; zwraca id konta w GoTrue
    pub async fn login(&self, email: &str, password: &str) -> Result<String, Failure> {
        let v = send(
            self.req(Method::POST, "/token").query(&[("grant_type", "password")]).json(&json!({"email": email, "password": password})),
        )
        .await?;
        user_id(&v).ok_or(Failure::Unavailable)
    }

    /// Mail z linkiem do ustawienia nowego hasła
    pub async fn recover(&self, email: &str) -> Result<(), Failure> {
        send(self.req(Method::POST, "/recover").query(&[("redirect_to", self.redirect())]).json(&json!({"email": email}))).await?;
        Ok(())
    }

    /// Ponowna wysyłka linku potwierdzającego email
    pub async fn resend(&self, email: &str) -> Result<(), Failure> {
        let body = json!({"type": "signup", "email": email});
        send(self.req(Method::POST, "/resend").query(&[("redirect_to", self.redirect())]).json(&body)).await?;
        Ok(())
    }

    /// Nowe hasło z tokenem z linku odzyskiwania (z adresu strony po kliknięciu w mail); zwraca id konta w GoTrue
    pub async fn set_password_with_token(&self, token: &str, password: &str) -> Result<String, Failure> {
        let v = send(self.req(Method::PUT, "/user").bearer_auth(token).json(&json!({"password": password}))).await?;
        user_id(&v).ok_or(Failure::Unavailable)
    }

    /// Zmiana hasła konta przez serwer (zmiana w grze, reset przez admina)
    pub async fn admin_set_password(&self, id: &str, password: &str) -> Result<(), Failure> {
        send(self.admin(Method::PUT, &format!("/admin/users/{id}")).json(&json!({"password": password}))).await?;
        Ok(())
    }

    /// Zmiana emaila konta przez serwer (po kliknięciu w link z naszego maila albo z panelu admina): od razu potwierdzony
    pub async fn admin_set_email(&self, id: &str, email: &str) -> Result<(), Failure> {
        send(self.admin(Method::PUT, &format!("/admin/users/{id}")).json(&json!({"email": email, "email_confirm": true}))).await?;
        Ok(())
    }

    /// Konto z emailem założone przez admina (gracz sprzed emaili, który zgubił hasło): email od razu potwierdzony,
    /// hasło losowe i nieznane nikomu - gracz ustawia własne z linku "nowe hasło". Zwraca id konta w GoTrue.
    pub async fn admin_create(&self, email: &str, password: &str, username: &str) -> Result<String, Failure> {
        let body = json!({"email": email, "password": password, "email_confirm": true, "user_metadata": {"username": username}});
        let v = send(self.admin(Method::POST, "/admin/users").json(&body)).await?;
        user_id(&v).ok_or(Failure::Unavailable)
    }

    /// Usunięcie konta (usunięty gracz, nieudana rejestracja) - email znów jest wolny
    pub async fn admin_delete(&self, id: &str) -> Result<(), Failure> {
        send(self.admin(Method::DELETE, &format!("/admin/users/{id}"))).await?;
        Ok(())
    }

    /// Link z maila (`/auth/v1/verify?token=...`): GoTrue sprawdza token i odsyła przekierowanie na stronę gry
    pub async fn verify(&self, raw_query: &str) -> Result<Verify, Failure> {
        let res = HTTP.get(format!("{}/verify?{raw_query}", self.url)).send().await.map_err(|e| {
            tracing::warn!("Supabase Auth nie odpowiada: {e}");
            Failure::Unavailable
        })?;
        let location = res.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).map(str::to_owned);
        Ok(Verify { status: res.status().as_u16(), location })
    }
}

/// Adres email wyświetlany bez ujawniania całości: "jan.kowalski@poczta.pl" -> "j***@poczta.pl"
pub fn mask_email(email: &str) -> String {
    match email.split_once('@') {
        Some((name, domain)) => format!("{}***@{domain}", name.chars().next().map(String::from).unwrap_or_default()),
        None => "***".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_email() {
        assert_eq!(mask_email("jan.kowalski@poczta.pl"), "j***@poczta.pl");
        assert_eq!(mask_email("brak"), "***");
    }

    #[test]
    fn error_codes() {
        assert_eq!(code_of(&json!({"error_code": "invalid_credentials", "msg": "x"})), "invalid_credentials");
        assert_eq!(code_of(&json!({"error": "invalid_grant", "error_description": "Email not confirmed"})), "email_not_confirmed");
        assert_eq!(code_of(&json!({"error": "invalid_grant", "error_description": "Invalid login credentials"})), "invalid_grant");
    }

    #[test]
    fn user_id_from_user_or_session() {
        assert_eq!(user_id(&json!({"id": "a"})).as_deref(), Some("a"));
        assert_eq!(user_id(&json!({"user": {"id": "b"}, "access_token": "t"})).as_deref(), Some("b"));
        assert_eq!(user_id(&json!({})), None);
    }
}
