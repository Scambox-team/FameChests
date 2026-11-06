//! Wspólny stan serwera (pula bazy, katalog w pamięci, szablony, zdjęcia, Arena, limit logowań).

use std::collections::HashMap;
use std::sync::Arc;

use arc_swap::ArcSwap;
use axum_extra::extract::cookie::Key;
use parking_lot::Mutex;
use sqlx::PgPool;

use crate::arena::ArenaState;
use crate::auth::Limiter;
use crate::catalog::Catalog;
use crate::config::Config;
use crate::images::Images;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub cfg: Arc<Config>,
    pub catalog: Arc<ArcSwap<Catalog>>,
    pub images: Arc<Images>,
    pub arena: Arc<ArenaState>,
    pub login: Limiter,
    pub cookie_key: Key,
    pub online: Arc<Online>,
    /// kopie zapasowe bazy (tylko właściciel, `routes/backups.rs`)
    pub backups: Arc<crate::backup::Backups>,
}

/// Gracze online: kiedy ostatnio coś wysłali (otwarta gra odpytuje /api/me co 30 s, w ukrytej karcie nie).
/// W pamięci procesu jak katalog - po restarcie serwera licznik zaczyna od zera.
#[derive(Default)]
pub struct Online {
    seen: Mutex<HashMap<i64, f64>>,
}

impl Online {
    const SECONDS: f64 = 120.0;

    pub fn touch(&self, uid: i64) {
        self.seen.lock().insert(uid, crate::db::now());
    }

    pub fn count(&self) -> i64 {
        let now = crate::db::now();
        let mut seen = self.seen.lock();
        seen.retain(|_, t| now - *t < Self::SECONDS);
        seen.len() as i64
    }
}

impl AppState {
    /// Aktualny katalog (migawka na czas zapytania)
    pub fn cat(&self) -> Arc<Catalog> {
        self.catalog.load_full()
    }

    /// Katalog od nowa (po zmianie w panelu admina)
    pub async fn refresh_catalog(&self) -> anyhow::Result<()> {
        let mut c = self.db.acquire().await?;
        let cat = crate::catalog::load(&mut c).await?;
        self.catalog.store(Arc::new(cat));
        Ok(())
    }
}
