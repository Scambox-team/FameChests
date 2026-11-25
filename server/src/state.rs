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

/// Katalog dla miejsc bez dostępu do `AppState` (np. wycena kart w licznikach kasyna); ustawiany raz przy starcie
static CATALOG: std::sync::OnceLock<Arc<ArcSwap<Catalog>>> = std::sync::OnceLock::new();

pub fn set_global_catalog(c: Arc<ArcSwap<Catalog>>) {
    let _ = CATALOG.set(c);
}

/// Bieżący katalog (None przed startem serwera, np. w testach)
pub fn global_catalog() -> Option<Arc<Catalog>> {
    CATALOG.get().map(|c| c.load_full())
}

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

    /// Czy gracz coś wysłał w ostatnich dwóch minutach
    pub fn is_online(&self, uid: i64) -> bool {
        self.seen.lock().get(&uid).is_some_and(|t| crate::db::now() - *t < Self::SECONDS)
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
