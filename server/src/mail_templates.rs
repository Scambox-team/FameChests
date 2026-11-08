//! Szablony maili: domyślne treści w `server/email/*.html`, nadpisane w panelu admina trafiają do tabeli `email_templates`.
//! Pola `{{ .Nazwa }}` są podstawiane z escapowaniem HTML wartości. Szablony GoTrue (confirmation, recovery, email_change)
//! renderuje Supabase Auth - tu tylko je przechowujemy i podajemy pod `/email/<nazwa>.html`.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{json, Value};

use crate::db::{now, Conn};

pub const MAX_HTML: usize = 200 * 1024;
pub const MAX_SUBJECT: usize = 200;

pub struct Placeholder {
    pub name: &'static str,
    pub desc: &'static str,
    pub sample: &'static str,
}

pub struct Def {
    pub name: &'static str,
    pub desc: &'static str,
    pub subject: &'static str,
    pub html: &'static str,
    /// true = temat idzie do wysłanego maila (szablony GoTrue mają temat w GOTRUE_MAILER_SUBJECTS_*)
    pub subject_used: bool,
    pub required: &'static [&'static str],
    pub placeholders: &'static [Placeholder],
}

const fn ph(name: &'static str, desc: &'static str, sample: &'static str) -> Placeholder {
    Placeholder { name, desc, sample }
}

const URL: Placeholder = ph("ConfirmationURL", "adres linku z maila", "{SITE}/auth/v1/verify?token=PRZYKLAD");
const LINK: Placeholder = ph("Link", "adres linku z maila (ważny godzinę)", "{SITE}/login?t=sb1_PRZYKLAD");
const LINK_DAY: Placeholder = ph("Link", "adres linku z maila (ważny 24 godziny)", "{SITE}/konto/potwierdz?t=sb1_PRZYKLAD");
const MINUTES_DAY: Placeholder = ph("ExpiresMinutes", "ile minut link jest ważny", "1440");
const USERNAME: Placeholder = ph("Username", "nazwa gracza", "{USER}");
const SITE_URL: Placeholder = ph("SiteURL", "adres gry (np. do ikony w nagłówku)", "{SITE}");
const MINUTES: Placeholder = ph("ExpiresMinutes", "ile minut link jest ważny", "60");
const EMAIL: Placeholder = ph("Email", "adres, na który wysłano mail", "gracz@example.com");
const NEW_EMAIL: Placeholder = ph("NewEmail", "nowy adres email", "nowy@example.com");

pub static DEFS: &[Def] = &[
    Def {
        name: "password_reset",
        desc: "Link do ustawienia nowego hasła (zapomniałem hasła, reset przez admina, \"wyślij mi link\" w profilu).",
        subject: "ScamBox: ustaw nowe hasło",
        html: include_str!("../email/password_reset.html"),
        subject_used: true,
        required: &["Link"],
        placeholders: &[SITE_URL, LINK, USERNAME, MINUTES],
    },
    Def {
        name: "email_change_request",
        desc: "Link do zmiany adresu email, wysyłany na OBECNY adres konta.",
        subject: "ScamBox: zmiana adresu email",
        html: include_str!("../email/email_change_request.html"),
        subject_used: true,
        required: &["Link"],
        placeholders: &[SITE_URL, LINK, USERNAME, MINUTES],
    },
    Def {
        name: "email_changed_notice",
        desc: "Informacja na STARY adres, że email konta został zmieniony.",
        subject: "ScamBox: adres email został zmieniony",
        html: include_str!("../email/email_changed_notice.html"),
        subject_used: true,
        required: &["NewEmail"],
        placeholders: &[SITE_URL, USERNAME, NEW_EMAIL],
    },
    Def {
        name: "email_verify",
        desc: "Link potwierdzający email konta (rejestracja z emailem albo dodanie emaila, gdy gra wysyła maile sama bez Supabase Auth). Ważny 24 godziny.",
        subject: "ScamBox: potwierdź adres email",
        html: include_str!("../email/email_verify.html"),
        subject_used: true,
        required: &["Link"],
        placeholders: &[SITE_URL, LINK_DAY, USERNAME, MINUTES_DAY],
    },
    Def {
        name: "confirmation",
        desc: "Supabase Auth: potwierdzenie adresu przy rejestracji. Temat ustawia GOTRUE_MAILER_SUBJECTS_CONFIRMATION.",
        subject: "ScamBox: potwierdź adres email",
        html: include_str!("../email/confirmation.html"),
        subject_used: false,
        required: &["ConfirmationURL"],
        placeholders: &[SITE_URL, URL, EMAIL],
    },
    Def {
        name: "recovery",
        desc: "Supabase Auth: nowe hasło (gdy nie działa własna poczta gry). Temat ustawia GOTRUE_MAILER_SUBJECTS_RECOVERY.",
        subject: "ScamBox: ustaw nowe hasło",
        html: include_str!("../email/recovery.html"),
        subject_used: false,
        required: &["ConfirmationURL"],
        placeholders: &[SITE_URL, URL, EMAIL],
    },
    Def {
        name: "email_change",
        desc: "Supabase Auth: potwierdzenie zmiany adresu. Temat ustawia GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE.",
        subject: "ScamBox: potwierdź nowy adres email",
        html: include_str!("../email/email_change.html"),
        subject_used: false,
        required: &["ConfirmationURL"],
        placeholders: &[SITE_URL, URL, EMAIL, NEW_EMAIL],
    },
];

pub fn def(name: &str) -> Option<&'static Def> {
    DEFS.iter().find(|d| d.name == name)
}

static FIELD_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\{\{\s*\.(\w+)\s*\}\}").unwrap());
static ANY_BRACES_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)\{\{.*?\}\}").unwrap());

pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// Podstawia `{{ .Nazwa }}` wartościami (z escapowaniem HTML); nieznane pola zostają bez zmian
pub fn render(tpl: &str, vars: &[(&str, &str)]) -> String {
    FIELD_RE
        .replace_all(tpl, |c: &regex::Captures| match vars.iter().find(|(k, _)| *k == &c[1]) {
            Some((_, v)) => escape_html(v),
            None => c[0].to_owned(),
        })
        .into_owned()
}

/// Przykładowa wartość pola: `{SITE}` = adres gry (PUBLIC_URL), `{USER}` = nick admina, który ogląda podgląd
fn fill(sample: &str, site: &str, user: &str) -> String {
    sample.replace("{SITE}", site.trim_end_matches('/')).replace("{USER}", if user.is_empty() { "Gracz123" } else { user })
}

/// Przykładowe wartości pól szablonu (podgląd, mail próbny)
pub fn samples(d: &Def, site: &str, user: &str) -> Vec<(&'static str, String)> {
    d.placeholders.iter().map(|p| (p.name, fill(p.sample, site, user))).collect()
}

/// `samples` w postaci, którą przyjmuje `render`
pub fn sample_refs<'a>(v: &'a [(&'static str, String)]) -> Vec<(&'static str, &'a str)> {
    v.iter().map(|(k, s)| (*k, s.as_str())).collect()
}

/// Treść zapisywana z panelu: wymagane pola muszą być, żadnych nieznanych pól, rozsądny rozmiar
pub fn validate(d: &Def, subject: &str, html: &str) -> Result<(), String> {
    if subject.trim().is_empty() || subject.chars().count() > MAX_SUBJECT || subject.contains(['\r', '\n']) {
        return Err(format!("Temat: 1-{MAX_SUBJECT} znaków, w jednej linii"));
    }
    if html.trim().is_empty() || html.len() > MAX_HTML {
        return Err(format!("Treść HTML: niepusta, najwyżej {} KB", MAX_HTML / 1024));
    }
    for m in ANY_BRACES_RE.find_iter(html) {
        let ok = FIELD_RE.captures(m.as_str()).is_some_and(|c| d.placeholders.iter().any(|p| p.name == &c[1]) && c.get(0).unwrap().as_str() == m.as_str());
        if !ok {
            return Err(format!("Nieznane pole {} - dostępne są tylko pola z listy", m.as_str()));
        }
    }
    for need in d.required {
        let found = FIELD_RE.captures_iter(html).any(|c| &c[1] == *need);
        if !found {
            return Err(format!("Brakuje wymaganego pola {{{{ .{need} }}}}"));
        }
    }
    Ok(())
}

/// Temat i HTML szablonu: z bazy, jeśli admin go zmienił, inaczej domyślny; trzeci element = czy domyślny
pub async fn load(c: &mut Conn, name: &str) -> sqlx::Result<Option<(String, String, bool)>> {
    let Some(d) = def(name) else { return Ok(None) };
    let row = sqlx::query_as::<_, (String, String)>("SELECT subject, html FROM email_templates WHERE name = $1").bind(name).fetch_optional(c).await?;
    Ok(Some(match row {
        Some((subject, html)) => (subject, html, false),
        None => (d.subject.to_owned(), d.html.to_owned(), true),
    }))
}

/// Gotowy mail: (temat, HTML) z podstawionymi wartościami
pub async fn render_named(c: &mut Conn, name: &str, vars: &[(&str, &str)]) -> sqlx::Result<(String, String)> {
    let (subject, html, _) = load(c, name).await?.unwrap_or_else(|| (String::new(), String::new(), true));
    Ok((render(&subject, vars), render(&html, vars)))
}

pub async fn save(c: &mut Conn, name: &str, subject: &str, html: &str) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO email_templates (name, subject, html, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO UPDATE SET subject = excluded.subject, html = excluded.html, updated_at = excluded.updated_at",
    )
    .bind(name)
    .bind(subject.trim())
    .bind(html)
    .bind(now())
    .execute(c)
    .await?;
    Ok(())
}

pub async fn reset(c: &mut Conn, name: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM email_templates WHERE name = $1").bind(name).execute(c).await?;
    Ok(())
}

/// Opis szablonu dla panelu admina
pub fn view(d: &Def, subject: &str, html: &str, is_default: bool, site: &str, user: &str) -> Value {
    let site = site.trim_end_matches('/');
    json!({
        "name": d.name,
        "desc": d.desc,
        "subject": subject,
        "html": html,
        "isDefault": is_default,
        "subjectUsed": d.subject_used,
        "required": d.required,
        "placeholders": d.placeholders.iter().map(|p| json!({"name": p.name, "desc": p.desc, "sample": fill(p.sample, site, user)})).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_escapes_values_and_keeps_unknown_fields() {
        let out = render("Cześć {{ .Username }} i {{.Username}}! {{ .Inne }}", &[("Username", "<b>\"Jan\" & 'Ola'</b>")]);
        assert_eq!(out, "Cześć &lt;b&gt;&quot;Jan&quot; &amp; &#39;Ola&#39;&lt;/b&gt; i &lt;b&gt;&quot;Jan&quot; &amp; &#39;Ola&#39;&lt;/b&gt;! {{ .Inne }}");
    }

    #[test]
    fn default_files_pass_their_own_validation() {
        for d in DEFS {
            validate(d, d.subject, d.html).unwrap_or_else(|e| panic!("{}: {e}", d.name));
            for need in d.required {
                assert!(d.html.contains(&format!("{{{{ .{need} }}}}")), "{}: brak {need}", d.name);
            }
            assert!(!d.html.contains("{{{") && !d.html.contains("}}}"), "{}: niedomknięte pole", d.name);
            let out = render(d.html, &sample_refs(&samples(d, "https://scambox.pl", "Gracz123")));
            assert!(!out.contains("{{"), "{}: nie podstawiono pól", d.name);
        }
    }

    #[test]
    fn validation_rejects_bad_content() {
        let d = def("password_reset").unwrap();
        assert!(validate(d, "Temat", "<p>bez linku</p>").unwrap_err().contains("Link"));
        assert!(validate(d, "Temat", "{{ .Link }} {{ .Cokolwiek }}").unwrap_err().contains("Nieznane"));
        assert!(validate(d, "Temat", "{{ .Link }} {{ if .X }}").is_err());
        assert!(validate(d, "", "{{ .Link }}").is_err());
        assert!(validate(d, "a\nb", "{{ .Link }}").is_err());
        assert!(validate(d, "Temat", &format!("{{{{ .Link }}}}{}", "x".repeat(MAX_HTML))).is_err());
        assert!(validate(d, "Temat", "<a href=\"{{.Link}}\">{{ .Username }}</a>").is_ok());
        assert!(def("nie_ma").is_none());
    }
}
