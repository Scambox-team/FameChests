//! Eksport zmian z panelu admina (karty, skrzynki, warianty) do repozytorium i ich wczytanie w nowej instalacji:
//!   - seed/catalog_export.json - skrzynki i karty dodane/zmienione/ukryte w panelu admina oraz zmiany wariantów
//!     (ustawienia, naklejki, kreator) - BEZ danych graczy,
//!   - seed/custom_images/ - zdjęcia wgrane w panelu admina (karty bez artykułu w Wikipedii albo z własnym plikiem),
//!     wgrane naklejki wariantów i obrazek easter egga.
//!
//! Oba są też wbudowane w plik wykonywalny (assets.rs) - nowa instalacja na serwerze nie potrzebuje folderu gry.

use std::collections::BTreeSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::PgPool;

use crate::catalog::Table;
use crate::config::Config;
use crate::data::g;
use crate::images::{Images, Kind};

const EXPORT_FILE: &str = "seed/catalog_export.json";
const IMAGES_DIR: &str = "seed/custom_images";

/// Zmiana z panelu admina (wiersz catalog_crates / catalog_cards)
#[derive(Debug, Serialize, Deserialize)]
pub struct ExportRow {
    pub id: String,
    pub data: Map<String, Value>,
    pub deleted: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ExportFile {
    pub crates: Vec<ExportRow>,
    pub cards: Vec<ExportRow>,
    pub variants: Vec<ExportRow>,
}

fn parse(data: &str) -> Map<String, Value> {
    serde_json::from_str(data).unwrap_or_default()
}

/// Wczytuje eksport do pustej bazy (nowa instalacja). Istniejących zmian nigdy nie nadpisuje. Zmiany wariantów
/// wczytujemy osobno - także do starszego zapisu, który ma już karty, ale nie ma jeszcze wariantów.
/// Plik z folderu gry (gdy jest), inaczej wbudowany w plik wykonywalny.
pub async fn import_if_empty(pool: &PgPool, base: &Path) -> anyhow::Result<bool> {
    let file = base.join(EXPORT_FILE);
    let text = match std::fs::read_to_string(&file) {
        Ok(t) => t,
        Err(_) => crate::assets::CATALOG_EXPORT.to_owned(),
    };
    let export: ExportFile = serde_json::from_str(&text)?;
    let mut tx = pool.begin().await?;
    let variants_empty: bool = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM catalog_variants").fetch_one(&mut *tx).await? == 0;
    if variants_empty {
        for row in &export.variants {
            sqlx::query("INSERT INTO catalog_variants (id, data, deleted) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
                .bind(&row.id)
                .bind(Value::Object(row.data.clone()).to_string())
                .bind(i32::from(row.deleted))
                .execute(&mut *tx)
                .await?;
        }
    }
    let existing =
        sqlx::query_scalar!(r#"SELECT (SELECT COUNT(*) FROM catalog_crates) + (SELECT COUNT(*) FROM catalog_cards) AS "n!""#)
            .fetch_one(&mut *tx)
            .await?;
    if existing > 0 {
        tx.commit().await?;
        return Ok(false);
    }
    for (table, rows) in [(Table::Crates, &export.crates), (Table::Cards, &export.cards)] {
        for row in rows {
            let data = Value::Object(row.data.clone()).to_string();
            let deleted = i32::from(row.deleted);
            match table {
                Table::Crates => sqlx::query!(
                    "INSERT INTO catalog_crates (id, data, deleted) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                    row.id,
                    data,
                    deleted
                ),
                Table::Cards => sqlx::query!(
                    "INSERT INTO catalog_cards (id, data, deleted) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
                    row.id,
                    data,
                    deleted
                ),
            }
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(true)
}

/// Plik już jest (dla obrazków: w dowolnym formacie - stary .jpg użytkownika czeka na migrację do .webp)
fn has_image(target: &Path) -> bool {
    if target.exists() {
        return true;
    }
    let is_image = target.extension().and_then(|e| e.to_str()).is_some_and(|e| ["webp", "jpg", "jpeg", "png", "gif", "bmp"].contains(&e));
    is_image && ["webp", "jpg", "jpeg", "png", "gif", "bmp"].iter().any(|e| target.with_extension(e).exists())
}

/// Własne zdjęcia z repozytorium -> image_cache (tylko brakujące). Przy każdym starcie, bo na nowym serwerze baza bywa
/// przeniesiona ze starego zapisu (nie jest pusta), a folder ze zdjęciami jest pusty.
/// Folder gry bez seed/custom_images/ (serwer z samym plikiem wykonywalnym) - kopie wbudowane w plik.
pub fn copy_custom_images(base: &Path, data_dir: &Path) -> std::io::Result<()> {
    let src = base.join(IMAGES_DIR);
    let cache = data_dir.join("image_cache");
    std::fs::create_dir_all(&cache)?;
    if !src.is_dir() {
        for name in crate::assets::CustomImages::iter() {
            let target = cache.join(name.as_ref());
            if !has_image(&target) {
                if let Some(f) = crate::assets::CustomImages::get(&name) {
                    std::fs::write(target, f.data)?;
                }
            }
        }
        return Ok(());
    }
    for entry in std::fs::read_dir(&src)? {
        let entry = entry?;
        let target = cache.join(entry.file_name());
        if !has_image(&target) {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// seed/catalog_export.json + seed/custom_images/. Zwraca (skrzynki, karty, zdjęcia).
pub async fn export_catalog(pool: &PgPool, cfg: &Config) -> anyhow::Result<(usize, usize, usize)> {
    let crates = sqlx::query!("SELECT id, data, deleted FROM catalog_crates ORDER BY id")
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| ExportRow { data: parse(&r.data), id: r.id, deleted: r.deleted != 0 })
        .collect();
    let cards = sqlx::query!("SELECT id, data, deleted FROM catalog_cards ORDER BY id")
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| ExportRow { data: parse(&r.data), id: r.id, deleted: r.deleted != 0 })
        .collect();
    let variants = sqlx::query_as::<_, (String, String, i32)>("SELECT id, data, deleted FROM catalog_variants ORDER BY id")
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|(id, data, deleted)| ExportRow { data: parse(&data), id, deleted: deleted != 0 })
        .collect();
    let export = ExportFile { crates, cards, variants };
    // wcięcie 1 spacja - jak json.dump(..., indent=1) w wersji Python (mniejsze różnice w git)
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, serde_json::ser::PrettyFormatter::with_indent(b" "));
    export.serialize(&mut ser)?;
    std::fs::write(cfg.base_dir.join(EXPORT_FILE), buf)?;

    let images = Images::new(&cfg.data_dir);
    let dir = cfg.base_dir.join(IMAGES_DIR);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;
    // zdjęcia kart z katalogu (wszystkie są .webp, więc nie da się odróżnić pobranych z Wikipedii od wgranych)
    let mut files: BTreeSet<std::path::PathBuf> =
        export.cards.iter().filter(|c| !c.deleted).filter_map(|c| images.find(&c.id, &Kind::Main)).collect();
    // zdjęcia wariantów przypisanych do kart (np. Rzulty) i własne zdjęcia wariantów z polem "photo" (np. Halloweenowa)
    let g = g();
    let all_ids: BTreeSet<String> = g
        .crates
        .values()
        .flat_map(|c| c.people.iter().filter_map(|p| p.get("id")?.as_str().map(str::to_owned)))
        .chain(export.cards.iter().map(|c| c.id.clone()))
        .collect();
    for (variant, info) in &g.variants {
        let pids: Vec<&String> = if !info.cards.is_empty() {
            info.cards.iter().collect()
        } else if info.photo {
            all_ids.iter().collect()
        } else {
            vec![]
        };
        files.extend(pids.into_iter().filter_map(|pid| images.find(pid, &Kind::Variant(variant.clone()))));
    }
    // naklejki wariantów wgrane przez admina - standardowe i na pojedynczych kartach (wbudowane grafiki są w static/img)
    for row in &export.variants {
        let rows = vec![(row.id.clone(), row.data.clone())];
        let vs = crate::variants::VariantState::read(&rows, Default::default());
        for sid in vs.sticker_uploads(&row.id) {
            files.extend(images.find(&crate::variants::sticker_file_id(&row.id), &Kind::Variant(sid)));
        }
    }
    // easter egg w bębnie skrzynki (panel admina, sekcja 🥚)
    files.extend(images.find(crate::variants::EGG_ID, &Kind::Main));
    // obrazki gry Snake (panel admina, zakładka Gry)
    for (slot, _) in crate::routes::snake::SLOTS {
        files.extend(images.find(&crate::routes::snake::file_id(slot), &Kind::Main));
    }
    // dźwięki zjedzenia jabłka (__snake_snd_<id>.<mp3|ogg|wav>)
    if let Ok(dir) = std::fs::read_dir(&images.cache_dir) {
        files.extend(
            dir.flatten()
                .map(|e| e.path())
                .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(crate::routes::snake::SOUND_PREFIX))),
        );
    }
    for path in &files {
        std::fs::copy(path, dir.join(path.file_name().unwrap_or_default()))?;
    }
    Ok((export.crates.len(), export.cards.len(), files.len()))
}
