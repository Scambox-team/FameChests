//! Ustawienia serwera: flagi uruchomienia i zmienne środowiskowe (także z pliku .env).
//!
//!   DATABASE_URL   postgresql://...           baza gry (wymagana)
//!   TEST_DATABASE_URL                         baza dla --test (domyślnie DATABASE_URL z bazą <nazwa>_test)
//!   DB_SCHEMA      famechests                 tabele gry w osobnym schemacie zamiast "public" (opcjonalnie)
//!   DB_POOL_SIZE   10
//!   SECRET_KEY     długi losowy tekst         klucz ciasteczek logowania (bez niego: DATA_DIR/secret_key.txt)
//!   DATA_DIR       /home/data                 zdjęcia, klucz, kopie (domyślnie <folder gry>/data; na Azure %HOME%\data)
//!   GAME_DIR       folder z static/ i web/ (domyślnie wykrywany)
//!   PORT, BIND     port i adres (domyślnie 5000 / 5001 z --test, 127.0.0.1 / 0.0.0.0 z --lan)
//!   COOKIE_SECURE  1 = ciasteczko tylko po HTTPS (hosting)
//!   TRUST_PROXY    1 = adres gracza z X-Forwarded-For (hosting za proxy)
//!   METRICS_ADDR   127.0.0.1:9100             metryki Prometheus (pusty = wyłączone)
//!   OPERATOR_NAME  Jan Kowalski / Nazwa grupy   kto prowadzi stronę (regulamin, polityka prywatności)
//!   CONTACT_EMAIL  kontakt@example.pl          adres do kontaktu (regulamin, zgłoszenia, RODO); trzymaj w zmiennych, nie w repozytorium
//!   OWNER_IDS      1,5                        id kont właścicieli (kopie bazy, ochrona ich kont przed innymi adminami);
//!                                             tylko tutaj - nie da się ich nadać z panelu ani z bazy
//!   SMTP_URL       smtp://mailpit:1025 | smtps://user:pass@host:465   własna wysyłka maili (reset hasła, zmiana emaila); bez niej: tylko log
//!   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   zamiast SMTP_URL (te same co GOTRUE_SMTP_*; 465 = TLS, 587 = STARTTLS)
//!   MAIL_FROM      ScamBox <no-reply@example.pl>   nadawca maili gry (bez niego SMTP_SENDER_NAME + SMTP_ADMIN_EMAIL)
//!   PUBLIC_URL     https://scambox.pl         adres gry w linkach z maili (wymagany z GOTRUE_URL; bez niego linki wskazują na localhost)
//!   BACKUP_DIR    /backups                   kopie bazy (pg_dump); domyślnie DATA_DIR/backups
//!   BACKUP_EVERY_HOURS 24                     co ile godzin automatyczna kopia (0 = wyłączone)
//!   BACKUP_KEEP    14                         ile kopii każdego rodzaju (automatyczne / ręczne) trzymać
//!
//! Azure App Service (Windows, scambox.exe za IIS - web.config z HttpPlatformHandler): port z HTTP_PLATFORM_PORT,
//! DATA_DIR domyślnie %HOME%\data (folder, który przetrwa restart i wdrożenie), COOKIE_SECURE i TRUST_PROXY domyślnie
//! włączone, metryki domyślnie wyłączone.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};

#[derive(Parser, Debug, Clone)]
#[command(name = "scambox", about = "ScamBox - serwer gry")]
pub struct Cli {
    /// osobna baza do testów (TEST_DATABASE_URL), port 5001
    #[arg(long, global = true)]
    pub test: bool,
    /// dostęp z innych komputerów w sieci (0.0.0.0)
    #[arg(long, global = true)]
    pub lan: bool,
    /// tryb deweloperski: szablony czytane przy każdym zapytaniu, więcej logów - NIGDY dla innych graczy
    #[arg(long, global = true)]
    pub dev: bool,
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand, Debug, Clone)]
pub enum Command {
    /// uruchom grę (domyślnie)
    Serve,
    /// eksport zmian z panelu admina do seed/catalog_export.json + seed/custom_images/
    ExportCatalog,
    /// pobierz brakujące zdjęcia kart (główne i alternatywne)
    FetchImages {
        #[arg(long)]
        force: bool,
    },
}

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub db_schema: Option<String>,
    pub pool_size: u32,
    pub secret_key: String,
    pub base_dir: PathBuf,
    pub data_dir: PathBuf,
    pub addr: SocketAddr,
    pub cookie_secure: bool,
    pub trust_proxy: bool,
    pub metrics_addr: Option<SocketAddr>,
    pub operator_name: Option<String>,
    pub contact_email: Option<String>,
    pub owner_ids: Vec<i64>,
    /// Supabase Auth (GOTRUE_URL): konta z emailem i odzyskiwaniem hasła; None = same nazwy i hasła
    pub gotrue: Option<crate::gotrue::GoTrue>,
    /// własna wysyłka maili (SMTP_URL, MAIL_FROM); bez SMTP_URL maile trafiają tylko do logu
    pub mailer: crate::mailer::Mailer,
    /// adres gry w linkach z maili (PUBLIC_URL); brak = adres z nagłówka Host
    pub public_url: Option<String>,
    pub backup_dir: PathBuf,
    pub backup_every_hours: f64,
    pub backup_keep: usize,
    pub dev: bool,
    pub lan: bool,
}

/// "1, 5,12" -> [1, 5, 12]; błędny wpis zatrzymuje start (literówka nie może po cichu odebrać ownera)
fn parse_ids(s: &str) -> anyhow::Result<Vec<i64>> {
    s.split(',')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(|p| p.parse::<i64>().ok().filter(|id| *id > 0).ok_or_else(|| anyhow::anyhow!("OWNER_IDS: \"{p}\" to nie id konta")))
        .collect()
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

fn env_flag(key: &str) -> bool {
    matches!(env(key).as_deref(), Some("1" | "true" | "yes" | "on"))
}

/// Flaga z domyślną wartością, gdy zmiennej nie ma
fn env_flag_or(key: &str, default: bool) -> bool {
    if env(key).is_some() {
        env_flag(key)
    } else {
        default
    }
}

/// Serwer działa na Azure App Service (zmienne ustawiane przez platformę)
fn on_azure() -> bool {
    env("WEBSITE_SITE_NAME").is_some() || env("HTTP_PLATFORM_PORT").is_some()
}

/// Folder gry (static/, web/, seed/; dane w DATA_DIR)
fn detect_base_dir() -> PathBuf {
    if let Some(dir) = env("GAME_DIR") {
        return PathBuf::from(dir);
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for dir in [cwd.clone(), cwd.join("..")] {
        if dir.join("static").is_dir() && dir.join("web").is_dir() {
            return dir.canonicalize().unwrap_or(dir);
        }
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Jednorazowo: dawniej bez DATA_DIR dane (image_cache/, secret_key.txt) leżały w folderze gry; przenosimy je do data/, jeśli
/// tam jeszcze ich nie ma. Przy błędzie rename (np. inny dysk) - kopia i usunięcie oryginału.
fn migrate_old_data(base: &Path, data: &Path) {
    for name in ["image_cache", "secret_key.txt"] {
        let (from, to) = (base.join(name), data.join(name));
        if !from.exists() || to.exists() {
            continue;
        }
        let moved = std::fs::rename(&from, &to).or_else(|_| {
            if from.is_dir() {
                copy_dir(&from, &to)?;
                std::fs::remove_dir_all(&from)
            } else {
                std::fs::copy(&from, &to)?;
                std::fs::remove_file(&from)
            }
        });
        match moved {
            Ok(()) => tracing::info!("Przeniesiono {} do {}", from.display(), to.display()),
            Err(e) => tracing::warn!("Nie udało się przenieść {} do {}: {e}", from.display(), to.display()),
        }
    }
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn test_url(url: &str) -> String {
    // postgresql://u:p@host:5432/gra?sslmode=... -> .../gra_test?sslmode=...
    let (head, query) = url.split_once('?').map(|(h, q)| (h, Some(q))).unwrap_or((url, None));
    let out = match head.rsplit_once('/') {
        Some((pre, db)) if !db.is_empty() && !pre.ends_with('/') => format!("{pre}/{db}_test"),
        _ => head.to_owned(),
    };
    query.map(|q| format!("{out}?{q}")).unwrap_or(out)
}

impl Config {
    pub fn load(cli: &Cli) -> anyhow::Result<Config> {
        let base_dir = detect_base_dir();
        let azure = on_azure();
        let data_dir = match (env("DATA_DIR"), env("HOME")) {
            (Some(dir), _) => PathBuf::from(dir),
            // Azure: %HOME% (D:\home) jest trwały - site\wwwroot podmienia każde wdrożenie
            (None, Some(home)) if azure => Path::new(&home).join("data"),
            // domyślnie <folder gry>/data (w .gitignore); dane ze starego układu (w samym folderze gry) przenosi migrate_old_data
            _ => {
                let dir = base_dir.join("data");
                std::fs::create_dir_all(&dir)?;
                migrate_old_data(&base_dir, &dir);
                dir
            }
        };
        std::fs::create_dir_all(&data_dir)?;
        let main_url = env("DATABASE_URL").ok_or_else(|| {
            anyhow::anyhow!("Brak DATABASE_URL (np. postgresql://postgres:postgres@localhost:5432/scambox) - ustaw w .env")
        })?;
        let database_url = if cli.test { env("TEST_DATABASE_URL").unwrap_or_else(|| test_url(&main_url)) } else { main_url };
        let db_schema = env("DB_SCHEMA");
        if let Some(s) = &db_schema {
            let ok = s.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c == '_')
                && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
            anyhow::ensure!(ok, "DB_SCHEMA: tylko małe litery, cyfry i _ (np. famechests)");
        }
        let secret_key = match env("SECRET_KEY") {
            Some(k) => k,
            None => {
                let path = data_dir.join("secret_key.txt");
                if !path.exists() {
                    let bytes: [u8; 32] = rand::random();
                    std::fs::write(&path, hex::encode(bytes))?;
                }
                std::fs::read_to_string(&path)?.trim().to_owned()
            }
        };
        // HttpPlatformHandler (IIS na Azure) podaje port, na którym ma słuchać serwer - tylko lokalnie, IIS przekazuje ruch
        let port: u16 = env("HTTP_PLATFORM_PORT")
            .or_else(|| env("PORT"))
            .map(|p| p.parse())
            .transpose()?
            .unwrap_or(if cli.test { 5001 } else { 5000 });
        let host = env("BIND").unwrap_or_else(|| if cli.lan { "0.0.0.0".into() } else { "127.0.0.1".into() });
        let metrics_addr = match std::env::var("METRICS_ADDR") {
            Ok(v) if v.trim().is_empty() => None,
            Ok(v) => Some(v.trim().parse()?),
            Err(_) if azure => None,
            Err(_) => Some(([127, 0, 0, 1], 9100).into()),
        };
        let backup_dir = env("BACKUP_DIR").map(PathBuf::from).unwrap_or_else(|| data_dir.join("backups"));
        let gotrue = match env("GOTRUE_URL") {
            Some(url) => {
                let key = env("GOTRUE_SERVICE_KEY").ok_or_else(|| anyhow::anyhow!("GOTRUE_URL wymaga GOTRUE_SERVICE_KEY (SERVICE_ROLE_KEY z Supabase)"))?;
                let public = env("PUBLIC_URL").ok_or_else(|| anyhow::anyhow!("GOTRUE_URL wymaga PUBLIC_URL (adres gry, np. https://scambox.pl) - tam wracają linki z maili"))?;
                Some(crate::gotrue::GoTrue::new(&url, &key, &public))
            }
            None => None,
        };
        Ok(Config {
            database_url,
            db_schema,
            pool_size: env("DB_POOL_SIZE").map(|p| p.parse()).transpose()?.unwrap_or(10),
            secret_key,
            base_dir,
            data_dir,
            addr: format!("{host}:{port}").parse()?,
            cookie_secure: env_flag_or("COOKIE_SECURE", azure),
            trust_proxy: env_flag_or("TRUST_PROXY", azure),
            metrics_addr,
            operator_name: env("OPERATOR_NAME"),
            contact_email: env("CONTACT_EMAIL"),
            owner_ids: parse_ids(&env("OWNER_IDS").unwrap_or_default())?,
            gotrue,
            mailer: crate::mailer::Mailer::from_config(&crate::mailer::MailConfig::from_env(env))?,
            public_url: env("PUBLIC_URL").map(|u| u.trim_end_matches('/').to_owned()),
            backup_dir,
            backup_every_hours: env("BACKUP_EVERY_HOURS").map(|h| h.parse()).transpose()?.unwrap_or(24.0),
            backup_keep: env("BACKUP_KEEP").map(|k| k.parse()).transpose()?.unwrap_or(14).max(1),
            dev: cli.dev,
            lan: cli.lan,
        })
    }

    /// Właściciel (OWNER_IDS): kopie bazy, a jego konta nie zmieni inny admin
    pub fn is_owner(&self, uid: i64) -> bool {
        self.owner_ids.contains(&uid)
    }

    /// Opis bazy do wypisania przy starcie (bez hasła)
    pub fn describe_db(&self) -> String {
        let url = self.database_url.split('?').next().unwrap_or("");
        let shown = match (url.find("//"), url.rfind('@')) {
            (Some(a), Some(b)) if b > a => format!("{}{}", &url[..a + 2], &url[b + 1..]),
            _ => url.to_owned(),
        };
        match &self.db_schema {
            Some(s) => format!("PostgreSQL {shown} (schemat {s})"),
            None => format!("PostgreSQL {shown}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_ids, test_url};

    #[test]
    fn owner_ids() {
        assert_eq!(parse_ids("").unwrap(), Vec::<i64>::new());
        assert_eq!(parse_ids(" 1, 5,12 ,").unwrap(), vec![1, 5, 12]);
        assert!(parse_ids("1,admin").is_err());
        assert!(parse_ids("0").is_err());
        assert!(parse_ids("-3").is_err());
    }

    #[test]
    fn test_database_name() {
        assert_eq!(test_url("postgresql://u:p@h:5432/gra?sslmode=require"), "postgresql://u:p@h:5432/gra_test?sslmode=require");
        assert_eq!(test_url("postgres://h/gra"), "postgres://h/gra_test");
    }
}
