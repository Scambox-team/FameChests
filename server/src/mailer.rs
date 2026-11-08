//! Własna wysyłka maili (SMTP): linki do hasła i zmiany emaila, powiadomienia, próbne maile z panelu admina.
//!
//! Serwer SMTP - jedno z dwóch:
//!   SMTP_URL   smtp://mailpit:1025 albo smtps://user:pass@host:465 (hasło w URL trzeba zakodować: %40 zamiast @ itd.)
//!   SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS - te same zmienne co GOTRUE_SMTP_* w deploy/selfhost (bez kodowania):
//!              port 465 = TLS od razu, 25/1025 bez użytkownika = bez szyfrowania (np. Mailpit), inny (587) = STARTTLS
//! Nadawca:
//!   MAIL_FROM  ScamBox <no-reply@example.pl>; bez niego SMTP_SENDER_NAME + SMTP_ADMIN_EMAIL, a bez nich
//!              "ScamBox <no-reply@localhost>". Zły adres nie zatrzymuje serwera - jest ostrzeżenie i nadawca domyślny.
//! Bez serwera SMTP maile trafiają tylko do logu (z linkiem).

use std::sync::LazyLock;

use lettre::message::{Mailbox, MultiPart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use regex::Regex;

/// Serwer SMTP podany osobnymi zmiennymi (jak GoTrue), zamiast SMTP_URL
#[derive(Debug, Clone, Default)]
pub struct SmtpParts {
    pub host: String,
    pub port: Option<u16>,
    pub user: String,
    pub pass: String,
}

#[derive(Debug, Clone, Default)]
pub struct MailConfig {
    pub url: Option<String>,
    pub parts: Option<SmtpParts>,
    pub from: Option<String>,
    pub sender_name: Option<String>,
    pub sender_email: Option<String>,
    /// adres gry (PUBLIC_URL) - pole {{ .SiteURL }} w mailach (ikona w nagłówku)
    pub site: Option<String>,
}

impl MailConfig {
    pub fn from_env(env: impl Fn(&str) -> Option<String>) -> MailConfig {
        let parts = env("SMTP_HOST").map(|host| SmtpParts {
            host,
            port: env("SMTP_PORT").and_then(|p| p.parse().ok()),
            user: env("SMTP_USER").unwrap_or_default(),
            pass: env("SMTP_PASS").unwrap_or_default(),
        });
        MailConfig {
            url: env("SMTP_URL"),
            parts,
            from: env("MAIL_FROM"),
            sender_name: env("SMTP_SENDER_NAME"),
            sender_email: env("SMTP_ADMIN_EMAIL"),
            site: env("PUBLIC_URL"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Mailer {
    transport: Option<AsyncSmtpTransport<Tokio1Executor>>,
    from: Mailbox,
    site: String,
}

const DEFAULT_FROM: &str = "ScamBox <no-reply@localhost>";

fn sender(cfg: &MailConfig) -> Mailbox {
    if let Some(text) = &cfg.from {
        match text.parse::<Mailbox>() {
            Ok(m) => return m,
            Err(e) => tracing::error!("MAIL_FROM: nieprawidłowy adres nadawcy \"{text}\" ({e}) - używam innego nadawcy"),
        }
    }
    if let Some(email) = &cfg.sender_email {
        match email.trim().parse() {
            Ok(addr) => return Mailbox::new(Some(cfg.sender_name.clone().unwrap_or_else(|| "ScamBox".into())), addr),
            Err(e) => tracing::error!("SMTP_ADMIN_EMAIL: nieprawidłowy adres \"{email}\" ({e})"),
        }
    }
    DEFAULT_FROM.parse().expect("domyślny nadawca")
}

fn transport_from_parts(p: &SmtpParts) -> anyhow::Result<AsyncSmtpTransport<Tokio1Executor>> {
    let port = p.port.unwrap_or(587);
    let mut b = if port == 465 {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&p.host)?
    } else if p.user.is_empty() && matches!(port, 25 | 1025) {
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&p.host)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&p.host)?
    }
    .port(port);
    if !p.user.is_empty() {
        b = b.credentials(Credentials::new(p.user.clone(), p.pass.clone()));
    }
    Ok(b.build())
}

impl Mailer {
    pub fn new(smtp_url: Option<&str>, from: Option<&str>) -> anyhow::Result<Mailer> {
        Mailer::from_config(&MailConfig { url: smtp_url.map(str::to_owned), from: from.map(str::to_owned), ..Default::default() })
    }

    pub fn from_config(cfg: &MailConfig) -> anyhow::Result<Mailer> {
        let transport = match (&cfg.url, &cfg.parts) {
            (Some(url), _) => Some(
                AsyncSmtpTransport::<Tokio1Executor>::from_url(url)
                    .map_err(|e| anyhow::anyhow!("SMTP_URL: nieprawidłowy adres ({e})"))?
                    .build(),
            ),
            (None, Some(p)) => Some(transport_from_parts(p).map_err(|e| anyhow::anyhow!("SMTP_HOST: {e}"))?),
            (None, None) => None,
        };
        let site = cfg.site.as_deref().unwrap_or("http://localhost:8000").trim_end_matches('/').to_owned();
        Ok(Mailer { transport, from: sender(cfg), site })
    }

    /// Jest serwer SMTP (bez niego maile trafiają tylko do logu)
    pub fn configured(&self) -> bool {
        self.transport.is_some()
    }

    /// Wysyła mail HTML (z wersją tekstową). Bez SMTP: ostrzeżenie w logu z adresatem, tematem i pierwszym linkiem.
    pub async fn send(&self, to: &str, subject: &str, html: &str) -> Result<(), String> {
        let html = &crate::mail_templates::render(html, &[("SiteURL", &self.site)]);
        let Some(transport) = &self.transport else {
            tracing::warn!("Brak serwera SMTP (SMTP_URL albo SMTP_HOST) - mail nie wyszedł. Do: {to}, temat: \"{subject}\", link: {}", first_link(html));
            return Ok(());
        };
        let to: Mailbox = to.parse().map_err(|e| format!("adres odbiorcy: {e}"))?;
        let msg = Message::builder()
            .from(self.from.clone())
            .to(to)
            .subject(subject)
            .multipart(MultiPart::alternative_plain_html(plain_text(html), html.to_owned()))
            .map_err(|e| e.to_string())?;
        transport.send(msg).await.map(|_| ()).map_err(|e| {
            tracing::warn!("Wysyłka maila nie powiodła się: {e}");
            e.to_string()
        })
    }
}

static HREF_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"href="([^"]+)""#).unwrap());
static ANCHOR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<a\s[^>]*?href="([^"]+)"[^>]*>"#).unwrap());
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<style.*?</style>|<[^>]*>").unwrap());
static BLANKS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n\s*\n+").unwrap());

/// Pierwszy link w HTML (do logu bez SMTP)
fn first_link(html: &str) -> String {
    HREF_RE.captures_iter(html).map(|c| c[1].replace("&amp;", "&")).find(|l| l.starts_with("http")).unwrap_or_else(|| "(brak)".into())
}

/// Prosta wersja tekstowa maila: bez znaczników, z adresami linków
fn plain_text(html: &str) -> String {
    let with_links = ANCHOR_RE.replace_all(html, |c: &regex::Captures| format!("\n{}\n", c[1].replace("&amp;", "&")));
    let text = TAG_RE.replace_all(&with_links, "\n");
    let text = text
        .replace("&nbsp;", " ")
        .replace("&mdash;", "-")
        .replace("&middot;", "·")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    BLANKS_RE.replace_all(lines.join("\n").trim(), "\n\n").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_has_link_and_no_tags() {
        let t = plain_text(r#"<style>a{}</style><p>Cześć &amp; witaj</p><a href="https://x.pl/a?b=1&amp;c=2">Kliknij</a>"#);
        assert!(t.contains("Cześć & witaj") && t.contains("https://x.pl/a?b=1&c=2") && !t.contains('<'));
        assert_eq!(first_link(r##"<a href="#">x</a><a href="https://x.pl/z">y</a>"##), "https://x.pl/z");
    }

    #[test]
    fn mailer_without_smtp() {
        let m = Mailer::new(None, None).unwrap();
        assert!(!m.configured());
        // zły MAIL_FROM nie zatrzymuje serwera: nadawca z SMTP_ADMIN_EMAIL albo domyślny
        let m = Mailer::new(None, Some("to nie adres")).unwrap();
        assert_eq!(m.from.to_string(), DEFAULT_FROM);
        let cfg = MailConfig {
            from: Some("ScamBox (lokalnie) <a@b.pl>".into()),
            sender_name: Some("ScamBox (gra)".into()),
            sender_email: Some("no-reply@scambox.pl".into()),
            ..Default::default()
        };
        assert_eq!(Mailer::from_config(&cfg).unwrap().from.email.to_string(), "no-reply@scambox.pl");
    }

    #[tokio::test]
    async fn smtp_from_separate_variables() {
        for (port, user) in [(Some(587), "u@x.pl"), (Some(465), "u@x.pl"), (Some(1025), ""), (None, "")] {
            let parts = SmtpParts { host: "smtp.example.com".into(), port, user: user.into(), pass: "p@ss:/word".into() };
            let m = Mailer::from_config(&MailConfig { parts: Some(parts), ..Default::default() }).unwrap();
            assert!(m.configured());
        }
        let env = |k: &str| match k {
            "SMTP_HOST" => Some("smtp.example.com".to_owned()),
            "SMTP_PORT" => Some("587".to_owned()),
            _ => None,
        };
        let cfg = MailConfig::from_env(env);
        assert_eq!(cfg.parts.unwrap().port, Some(587));
    }
}
