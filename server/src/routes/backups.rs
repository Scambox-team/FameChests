//! Kopie zapasowe bazy w panelu admina - TYLKO właściciel (ekstraktor `Owner`: zalogowany admin z id w OWNER_IDS).
//! Zwykły admin dostaje 403, niezalogowany 401. Każde utworzenie i pobranie kopii trafia do dziennika adminów.
//! Kopie robi `crate::backup` (pg_dump); przywraca się je ręcznie `pg_restore` (deploy/selfhost/README.md).

use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use serde::Serialize;
use serde_json::json;

use super::ok;
use crate::auth::Owner;
use crate::backup::{BackupFile, Kind};
use crate::error::{fail, AppError, Res};
use crate::game::log_admin;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupList {
    backups: Vec<BackupFile>,
    every_hours: f64,
    keep: usize,
    dir: String,
    schema: String,
    /// wersja pg_dump (None = brak programu, kopie nie działają)
    pg_dump: Option<String>,
}

pub async fn backups_list(State(st): State<AppState>, Owner(_): Owner) -> Res {
    let b = &st.backups;
    ok(BackupList {
        backups: b.list().await?,
        every_hours: b.every_hours(),
        keep: b.keep(),
        dir: b.dir().display().to_string(),
        schema: st.cfg.db_schema.clone().unwrap_or_else(|| "public".into()),
        pg_dump: b.pg_dump.clone(),
    })
}

/// Nowa kopia teraz (ręczna)
pub async fn backup_create(State(st): State<AppState>, Owner(me): Owner) -> Res {
    let file = match st.backups.create(Kind::Manual).await {
        Ok(f) => f,
        Err(e) => {
            tracing::error!("ręczna kopia bazy ({}): {e:#}", me.username);
            return fail(StatusCode::INTERNAL_SERVER_ERROR, format!("Kopia nie powiodła się: {e}"));
        }
    };
    let mut c = st.db.acquire().await?;
    log_admin(&mut c, &me, "backup_create", None, &file.name).await?;
    ok(json!({"ok": true, "backup": file}))
}

/// Pobranie kopii (plik .dump do pg_restore)
pub async fn backup_download(State(st): State<AppState>, Owner(me): Owner, Path(name): Path<String>) -> Res {
    let Some(path) = st.backups.path_of(&name) else {
        return Err(AppError::with_status(StatusCode::NOT_FOUND, "Nie ma takiej kopii"));
    };
    let mut c = st.db.acquire().await?;
    log_admin(&mut c, &me, "backup_download", None, &name).await?;
    drop(c);
    let mut resp = crate::web::send_file(&path, "application/octet-stream", &HeaderMap::new(), "no-store, private").await?;
    // nazwa sprawdzona w valid_name: same litery, cyfry, - i .
    let disposition = format!("attachment; filename=\"scambox-{name}\"");
    let h = resp.headers_mut();
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&disposition).map_err(|e| AppError::Internal(e.into()))?);
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    Ok(resp)
}
