//! Własna wysyłka maili (SMTP): linki do hasła i zmiany emaila, powiadomienia, próbne maile z panelu admina.
//!
//!   SMTP_URL   smtp://mailpit:1025 albo smtps://user:pass@host:465 (puste = maile tylko w logu serwera)
//!   MAIL_FROM  ScamBox <no-reply@example.pl>  (domyślnie "ScamBox <no-reply@localhost>")

use std::sync::LazyLock;

use lettre::message::{Mailbox, MultiPart};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use regex::Regex;

#[derive(Debug, Clone)]
pub struct Mailer {
    transport: Option<AsyncSmtpTransport<Tokio1Executor>>,
    from: Mailbox,
}

impl Mailer {
    pub fn new(smtp_url: Option<&str>, from: Option<&str>) -> anyhow::Result<Mailer> {
        let from: Mailbox = from
            .unwrap_or("ScamBox <no-reply@localhost>")
            .parse()
            .map_err(|e| anyhow::anyhow!("MAIL_FROM: nieprawidłowy adres nadawcy ({e})"))?;
        let transport = match smtp_url {
            Some(url) => Some(
                AsyncSmtpTransport::<Tokio1Executor>::from_url(url)
                    .map_err(|e| anyhow::anyhow!("SMTP_URL: nieprawidłowy adres ({e})"))?
                    .build(),
            ),
            None => None,
        };
        Ok(Mailer { transport, from })
    }

    /// Jest serwer SMTP (bez niego maile trafiają tylko do logu)
    pub fn configured(&self) -> bool {
        self.transport.is_some()
    }

    /// Wysyła mail HTML (z wersją tekstową). Bez SMTP: ostrzeżenie w logu z adresatem, tematem i pierwszym linkiem.
    pub async fn send(&self, to: &str, subject: &str, html: &str) -> Result<(), String> {
        let Some(transport) = &self.transport else {
            tracing::warn!("SMTP_URL nie jest ustawiony - mail nie wyszedł. Do: {to}, temat: \"{subject}\", link: {}", first_link(html));
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
        assert!(Mailer::new(None, Some("to nie adres")).is_err());
    }
}
