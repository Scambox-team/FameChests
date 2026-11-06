//! Kopie zapasowe bazy: `pg_dump` (format custom, do `pg_restore`) schematu gry (DB_SCHEMA albo public) do BACKUP_DIR.
//! Automatyczne co BACKUP_EVERY_HOURS (zadanie w tle) i ręczne z panelu - pobiera je tylko właściciel (OWNER_IDS,
//! `routes/backups.rs`). Trzymamy po BACKUP_KEEP najnowszych kopii każdego rodzaju.
//! `pg_dump` musi być w systemie (obraz Dockera go ma: postgresql-client-17, ta sama wersja co serwer bazy).

use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, SystemTime};

use regex::Regex;
use serde::Serialize;
use tokio::process::Command;

use crate::config::Config;

/// Najdłuższy pg_dump - potem przerywamy (zawieszone połączenie nie zablokuje kolejnych kopii)
const DUMP_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Nazwa pliku kopii: auto-20261106-210512.dump / manual-... (tylko takie pliki da się pobrać)
static NAME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(auto|manual)-(\d{8})-(\d{6})\.dump$").unwrap());

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Auto,
    Manual,
}

impl Kind {
    fn prefix(self) -> &'static str {
        match self {
            Kind::Auto => "auto",
            Kind::Manual => "manual",
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub name: String,
    /// "auto" / "manual"
    pub kind: &'static str,
    pub size: u64,
    /// czas utworzenia pliku (sekundy od 1970)
    pub created_at: f64,
}

pub struct Backups {
    dir: PathBuf,
    every_hours: f64,
    keep: usize,
    url: String,
    schema: String,
    /// jedna kopia naraz (automatyczna i ręczna nie piszą równocześnie)
    busy: tokio::sync::Mutex<()>,
    /// `pg_dump --version` przy starcie (None = brak programu)
    pub pg_dump: Option<String>,
}

/// Czy nazwa to plik kopii (chroni przed ../ i pobieraniem innych plików z folderu)
pub fn valid_name(name: &str) -> bool {
    NAME_RE.is_match(name)
}

fn kind_of(name: &str) -> Option<&'static str> {
    NAME_RE.captures(name).map(|c| if &c[1] == "auto" { "auto" } else { "manual" })
}

impl Backups {
    pub async fn new(cfg: &Config) -> Self {
        let pg_dump = match Command::new("pg_dump").arg("--version").output().await {
            Ok(o) if o.status.success() => Some(String::from_utf8_lossy(&o.stdout).trim().to_owned()),
            _ => None,
        };
        Backups {
            dir: cfg.backup_dir.clone(),
            every_hours: cfg.backup_every_hours,
            keep: cfg.backup_keep,
            url: cfg.database_url.clone(),
            schema: cfg.db_schema.clone().unwrap_or_else(|| "public".into()),
            busy: tokio::sync::Mutex::new(()),
            pg_dump,
        }
    }

    pub fn every_hours(&self) -> f64 {
        self.every_hours
    }

    pub fn keep(&self) -> usize {
        self.keep
    }

    pub fn dir(&self) -> &std::path::Path {
        &self.dir
    }

    /// Ścieżka istniejącej kopii o tej nazwie (None = zła nazwa albo brak pliku)
    pub fn path_of(&self, name: &str) -> Option<PathBuf> {
        if !valid_name(name) {
            return None;
        }
        let path = self.dir.join(name);
        path.is_file().then_some(path)
    }

    /// Kopie od najnowszej
    pub async fn list(&self) -> std::io::Result<Vec<BackupFile>> {
        let mut out = vec![];
        let mut rd = match tokio::fs::read_dir(&self.dir).await {
            Ok(rd) => rd,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(e),
        };
        while let Some(entry) = rd.next_entry().await? {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(kind) = kind_of(&name) else { continue };
            let meta = entry.metadata().await?;
            if !meta.is_file() {
                continue;
            }
            let created_at = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0);
            out.push(BackupFile { name, kind, size: meta.len(), created_at });
        }
        out.sort_by(|a, b| b.created_at.total_cmp(&a.created_at).then_with(|| b.name.cmp(&a.name)));
        Ok(out)
    }

    /// Nowa kopia: pg_dump do pliku .part, po sukcesie zmiana nazwy (niepełny plik nigdy nie wygląda na kopię)
    pub async fn create(&self, kind: Kind) -> anyhow::Result<BackupFile> {
        if self.pg_dump.is_none() {
            anyhow::bail!("Brak programu pg_dump na serwerze (obraz Dockera go ma; przy uruchomieniu bez Dockera zainstaluj postgresql-client)");
        }
        let _lock = self.busy.lock().await;
        tokio::fs::create_dir_all(&self.dir).await?;
        let mut name = format!("{}-{}.dump", kind.prefix(), chrono::Local::now().format("%Y%m%d-%H%M%S"));
        // dwie kopie w tej samej sekundzie (np. kliknięcie zaraz po automatycznej) - kolejna sekunda
        while self.dir.join(&name).exists() {
            tokio::time::sleep(Duration::from_millis(1100)).await;
            name = format!("{}-{}.dump", kind.prefix(), chrono::Local::now().format("%Y%m%d-%H%M%S"));
        }
        let path = self.dir.join(&name);
        let part = self.dir.join(format!("{name}.part"));
        let run = Command::new("pg_dump")
            .arg("--dbname")
            .arg(&self.url)
            .arg(format!("--schema={}", self.schema))
            .args(["--format=custom", "--no-owner", "--no-privileges", "--file"])
            .arg(&part)
            .kill_on_drop(true)
            .output();
        let out = match tokio::time::timeout(DUMP_TIMEOUT, run).await {
            Ok(r) => r?,
            Err(_) => {
                let _ = tokio::fs::remove_file(&part).await;
                anyhow::bail!("pg_dump trwał ponad {} min - przerwany", DUMP_TIMEOUT.as_secs() / 60);
            }
        };
        if !out.status.success() {
            let _ = tokio::fs::remove_file(&part).await;
            let err = String::from_utf8_lossy(&out.stderr);
            anyhow::bail!("pg_dump: {}", err.lines().next().unwrap_or("nieznany błąd").trim());
        }
        tokio::fs::rename(&part, &path).await?;
        self.prune(kind).await;
        let size = tokio::fs::metadata(&path).await?.len();
        tracing::info!("kopia bazy: {name} ({} kB)", size / 1024);
        Ok(BackupFile { kind: kind.prefix(), name, size, created_at: crate::db::now() })
    }

    /// Zostawia `keep` najnowszych kopii tego rodzaju
    async fn prune(&self, kind: Kind) {
        let Ok(list) = self.list().await else { return };
        for old in list.iter().filter(|b| b.kind == kind.prefix()).skip(self.keep) {
            if let Err(e) = tokio::fs::remove_file(self.dir.join(&old.name)).await {
                tracing::warn!("kopia bazy: nie usunięto {}: {e}", old.name);
            }
        }
    }

    /// Zadanie w tle: automatyczna kopia, gdy najnowsza automatyczna jest starsza niż BACKUP_EVERY_HOURS.
    /// Sprawdza co 10 min, więc restart serwera nie robi dodatkowej kopii ani jej nie pomija.
    pub async fn run_schedule(self: std::sync::Arc<Self>) {
        if self.every_hours <= 0.0 {
            tracing::info!("automatyczne kopie bazy wyłączone (BACKUP_EVERY_HOURS=0)");
            return;
        }
        if self.pg_dump.is_none() {
            tracing::warn!("automatyczne kopie bazy wyłączone: brak pg_dump");
            return;
        }
        tracing::info!("kopie bazy co {} h w {} (zostaje {} najnowszych)", self.every_hours, self.dir.display(), self.keep);
        tokio::time::sleep(Duration::from_secs(120)).await; // po starcie (uzupełnianie tabel) - nie od razu
        let mut tick = tokio::time::interval(Duration::from_secs(600));
        loop {
            tick.tick().await;
            let newest = match self.list().await {
                Ok(list) => list.into_iter().find(|b| b.kind == "auto").map(|b| b.created_at),
                Err(e) => {
                    tracing::warn!("kopia bazy: folder {}: {e}", self.dir.display());
                    continue;
                }
            };
            if newest.is_some_and(|t| crate::db::now() - t < self.every_hours * 3600.0) {
                continue;
            }
            if let Err(e) = self.create(Kind::Auto).await {
                tracing::error!("automatyczna kopia bazy nie powiodła się: {e:#}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{kind_of, valid_name};

    #[test]
    fn backup_names() {
        assert!(valid_name("auto-20261106-210512.dump"));
        assert!(valid_name("manual-20261106-210512.dump"));
        assert_eq!(kind_of("manual-20261106-210512.dump"), Some("manual"));
        for bad in [
            "../auto-20261106-210512.dump",
            "auto-20261106-210512.dump.part",
            "auto-20261106-210512.dump/../../secret_key.txt",
            "auto-2026110-210512.dump",
            "other-20261106-210512.dump",
            "secret_key.txt",
            "",
            "auto-20261106-210512.DUMP",
            "auto-20261106-210512.dump\0",
        ] {
            assert!(!valid_name(bad), "{bad:?}");
        }
    }
}
