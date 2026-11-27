//! Naklejki dla graczy: kolekcjonerskie naklejki z rzadkościami kart (bez Specjalnej), które gracz może nakleić na KAŻDĄ kartę
//! (najwyżej `MAX_ON_CARD` na egzemplarz). To zupełnie osobny mechanizm od „naklejek wariantów” z panelu admina (`catalog_variants`,
//! strona /stickers), które są po prostu wyglądem wariantu karty.
//!
//! - Katalog (`stickers`): obrazek PNG wgrywany z panelu admina (`/admin/gstickers`); wersje foliowana / holo / złota powstają
//!   automatycznie jako filtry CSS (`web/src/features/stickers/stickers.css`), nie jako osobne pliki.
//! - Skrzynki z naklejkami (`sticker_crates`): rodzaj skrzynki w ekwipunku to `sticker_<id>` (jak `money_<rodzaj>`), więc nie ma ich w katalogu
//!   skrzynek z kartami. Admin ustawia dla każdej szanse wariantów naklejki (zwykła / foliowana / holo / złota) - można zrobić skrzynkę, z której
//!   naklejka zawsze wypada np. złota. Rzadkości liczą się jak w kartach (wagi z game.json), tajna to stałe 1 : `secretOdds`.
//! - Posiadane naklejki: `sticker_items` (w ekwipunku), naklejone: `card_stickers` (z kluczem do `items`, więc idą za kartą; przy sprzedaży,
//!   kontrakcie i ulepszaczu wracają do ekwipunku - `release_from_cards`).
//! Rejestr skrzynek jest w pamięci procesu (`crates()`), bo `valid_chest_kind` nie ma dostępu do bazy.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, LazyLock};

use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use parking_lot::RwLock;
use serde_json::{json, Value};

use crate::db::{now, Conn};

/// Najwięcej naklejek na jednej karcie
pub const MAX_ON_CARD: i64 = 10;
/// Na kartę w tym wariancie (także w połączeniu, np. `flag+hologram`) NIE da się naklejać naklejek: hologram to osobna scena, nie zwykła karta
pub fn allows_stickers(variant: &str) -> bool {
    !variant.split('+').any(|p| p == "hologram")
}

/// Prefiks rodzaju skrzynki w ekwipunku
pub const KIND_PREFIX: &str = "sticker_";
/// Skrzynka z przykładowymi naklejkami (tworzona raz, przy pierwszym starcie) - domyślnie w puli „ekskluzywne z leveli”
pub const DEFAULT_CRATE: &str = "naklejki";
/// Warianty naklejki (inne niż warianty kart): zwykła, foliowana, holo, złota
pub const VARIANTS: &[(&str, &str)] = &[("normal", "Zwykła"), ("foil", "Foliowana"), ("holo", "Holo"), ("gold", "Złota")];
/// Domyślne szanse wariantów (wagi) w skrzynce z naklejkami
pub const DEFAULT_WEIGHTS: [f64; 4] = [85.0, 9.0, 4.0, 2.0];
pub const MAX_CRATES: usize = 30;

#[derive(Clone, Debug)]
pub struct StickerCrate {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub color1: String,
    pub color2: String,
    pub desc: String,
    /// wagi wariantów w kolejności `VARIANTS`
    pub weights: [f64; 4],
}

impl StickerCrate {
    pub fn kind(&self) -> String {
        format!("{KIND_PREFIX}{}", self.id)
    }

    pub fn weights_json(&self) -> Value {
        json!({"normal": self.weights[0], "foil": self.weights[1], "holo": self.weights[2], "gold": self.weights[3]})
    }
}

/// Wagi z JSON-a (`{"normal": 85, "foil": 9, ...}`): liczby nieujemne, same zera = zawsze zwykła
pub fn clean_weights(raw: &Value) -> [f64; 4] {
    let mut w = DEFAULT_WEIGHTS;
    if raw.as_object().is_some_and(|o| !o.is_empty()) {
        for (i, (k, _)) in VARIANTS.iter().enumerate() {
            let v = raw.get(*k).and_then(|v| v.as_f64().or_else(|| v.as_str()?.replace(',', ".").trim().parse().ok())).unwrap_or(0.0);
            w[i] = if v.is_finite() { v.clamp(0.0, 1_000_000.0) } else { 0.0 };
        }
    }
    if w.iter().sum::<f64>() <= 0.0 {
        w = [1.0, 0.0, 0.0, 0.0];
    }
    w
}

// ---------------------------------------------------------------- rejestr skrzynek

static CRATES: LazyLock<RwLock<Arc<Vec<StickerCrate>>>> = LazyLock::new(|| RwLock::new(Arc::new(vec![])));

pub fn crates() -> Arc<Vec<StickerCrate>> {
    CRATES.read().clone()
}

/// Skrzynka z naklejkami o rodzaju `sticker_<id>`
pub fn crate_of_kind(kind: &str) -> Option<StickerCrate> {
    let id = kind.strip_prefix(KIND_PREFIX)?;
    crates().iter().find(|c| c.id == id).cloned()
}

/// Katalog naklejek w pamięci (id -> nazwa, rzadkość, włączona): potrzebny tam, gdzie nie ma dostępu do bazy (opis nagrody, pula nagród leveli)
#[derive(Clone, Debug)]
pub struct StickerInfo {
    pub name: String,
    pub rarity: String,
    pub enabled: bool,
}

static STICKERS: LazyLock<RwLock<Arc<HashMap<String, StickerInfo>>>> = LazyLock::new(|| RwLock::new(Arc::new(HashMap::new())));

pub fn info(id: &str) -> Option<StickerInfo> {
    STICKERS.read().get(id).cloned()
}

/// Pula naklejek do nagród (duża nagroda za level): włączone, bez Specjalnej i bez wykluczonych w panelu EXP
pub fn reward_pool(excluded: &std::collections::BTreeSet<String>) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = STICKERS
        .read()
        .iter()
        .filter(|(id, i)| i.enabled && i.rarity != "special" && !excluded.contains(*id))
        .map(|(id, i)| (id.clone(), i.rarity.clone()))
        .collect();
    v.sort();
    v
}

pub async fn load(c: &mut Conn) -> sqlx::Result<()> {
    let st: Vec<(String, String, String, i16)> = sqlx::query_as("SELECT id, name, rarity, enabled FROM stickers").fetch_all(&mut *c).await?;
    *STICKERS.write() = Arc::new(st.into_iter().map(|(id, name, rarity, en)| (id, StickerInfo { name, rarity, enabled: en == 1 })).collect());
    let rows: Vec<(String, String, String, String, String, String, String)> =
        sqlx::query_as("SELECT id, name, emoji, color1, color2, descr, weights FROM sticker_crates ORDER BY pos, id").fetch_all(c).await?;
    let list = rows
        .into_iter()
        .map(|(id, name, emoji, color1, color2, desc, weights)| StickerCrate {
            id,
            name,
            emoji,
            color1,
            color2,
            desc,
            weights: clean_weights(&serde_json::from_str(&weights).unwrap_or(Value::Null)),
        })
        .collect();
    *CRATES.write() = Arc::new(list);
    Ok(())
}

// ---------------------------------------------------------------- losowanie

/// Waga rzadkości w skrzynce: te same wagi co karty (game.json); tajna = 1 na `secretOdds` wobec pozostałych obecnych. Specjalnej nie ma.
pub fn rarity_weights(present: &[String]) -> Vec<(String, f64)> {
    let g = crate::data::g();
    let w = |r: &str| crate::catalog::default_weight(r);
    let others: f64 = present.iter().filter(|r| *r != "secret" && *r != "special").map(|r| w(r)).sum();
    present
        .iter()
        .filter(|r| *r != "special")
        .map(|r| {
            let x = if r == "secret" { if others > 0.0 { others / (g.secret_odds - 1) as f64 } else { 0.0 } } else { w(r) };
            (r.clone(), x)
        })
        .filter(|(_, x)| *x > 0.0)
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Rolled {
    pub sticker: String,
    pub rarity: String,
    pub variant: String,
}

/// Jedna wylosowana naklejka z puli `(id, rzadkość)` dla skrzynki; None, gdy pula jest pusta
pub fn roll_one(pool: &[(String, String)], cr: &StickerCrate) -> Option<Rolled> {
    use rand::seq::SliceRandom;
    let mut present: Vec<String> = vec![];
    for (_, r) in pool {
        if !present.contains(r) {
            present.push(r.clone());
        }
    }
    let ws = rarity_weights(&present);
    let rarity = &ws[crate::game::roll::choose_weighted(&ws.iter().map(|x| x.1).collect::<Vec<_>>())?].0;
    let candidates: Vec<&(String, String)> = pool.iter().filter(|(_, r)| r == rarity).collect();
    let (id, _) = candidates.choose(&mut rand::thread_rng())?;
    let v = crate::game::roll::choose_weighted(&cr.weights).unwrap_or(0);
    Some(Rolled { sticker: id.clone(), rarity: rarity.clone(), variant: VARIANTS[v].0.to_owned() })
}

/// Pula naklejek skrzynki: włączone, z tą skrzynką na liście `crates`
pub async fn pool(c: &mut Conn, crate_id: &str) -> sqlx::Result<Vec<(String, String)>> {
    let rows: Vec<(String, String, String)> = sqlx::query_as("SELECT id, rarity, crates FROM stickers WHERE enabled = 1 ORDER BY pos, id").fetch_all(c).await?;
    Ok(rows
        .into_iter()
        .filter(|(_, r, cr)| r != "special" && serde_json::from_str::<Vec<String>>(cr).unwrap_or_default().iter().any(|x| x == crate_id))
        .map(|(id, r, _)| (id, r))
        .collect())
}

/// Zawartość skrzynki dla gracza (podgląd w sklepie i bębny przy otwieraniu): naklejki z puli z nazwą, rzadkością, wersją obrazka i szansą
/// wypadnięcia przy jednym losowaniu (0-1: waga rzadkości jak w [`roll_one`], dzielona po równo między naklejki tej rzadkości), od najrzadszych
pub async fn contents(c: &mut Conn, crate_id: &str) -> sqlx::Result<Vec<Value>> {
    let rows: Vec<(String, String, String, f64, String)> =
        sqlx::query_as("SELECT id, name, rarity, img_at, crates FROM stickers WHERE enabled = 1 ORDER BY pos, id").fetch_all(c).await?;
    let list: Vec<(String, String, String, f64)> = rows
        .into_iter()
        .filter(|(_, _, r, _, cr)| r != "special" && serde_json::from_str::<Vec<String>>(cr).unwrap_or_default().iter().any(|x| x == crate_id))
        .map(|(id, n, r, at, _)| (id, n, r, at))
        .collect();
    Ok(contents_view(&list))
}

/// Czysta część [`contents`]: szanse z listy (id, nazwa, rzadkość, wersja obrazka)
pub fn contents_view(list: &[(String, String, String, f64)]) -> Vec<Value> {
    let mut present: Vec<String> = vec![];
    for (_, _, r, _) in list {
        if !present.contains(r) {
            present.push(r.clone());
        }
    }
    let ws = rarity_weights(&present);
    let total: f64 = ws.iter().map(|x| x.1).sum();
    let g = crate::data::g();
    let mut out: Vec<(usize, Value)> = list
        .iter()
        .map(|(id, name, rarity, at)| {
            let n = list.iter().filter(|x| &x.2 == rarity).count().max(1) as f64;
            let w = ws.iter().find(|x| &x.0 == rarity).map_or(0.0, |x| x.1);
            let chance = if total > 0.0 { w / total / n } else { 0.0 };
            (g.rarity_idx(rarity), json!({"sticker": id, "name": name, "rarity": rarity, "v": *at as i64, "chance": chance}))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out.into_iter().map(|x| x.1).collect()
}

/// Dodaje naklejki do ekwipunku gracza; zwraca ich numery
pub async fn give(c: &mut Conn, uid: i64, list: &[Rolled]) -> sqlx::Result<Vec<i64>> {
    let mut ids = vec![];
    for r in list {
        let id: i64 = sqlx::query_scalar("INSERT INTO sticker_items (user_id, sticker_id, variant, created_at) VALUES ($1, $2, $3, $4) RETURNING id")
            .bind(uid)
            .bind(&r.sticker)
            .bind(&r.variant)
            .bind(now())
            .fetch_one(&mut *c)
            .await?;
        ids.push(id);
    }
    Ok(ids)
}

/// Karty znikają (sprzedaż, kontrakt, ulepszacz): naklejki z nich wracają do ekwipunku właściciela
pub async fn release_from_cards(c: &mut Conn, uid: i64, item_ids: &[i64]) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO sticker_items (user_id, sticker_id, variant, created_at)
         SELECT $1, s.sticker_id, s.variant, $3 FROM card_stickers s JOIN items i ON i.id = s.item_id
         WHERE s.item_id = ANY($2) AND i.user_id = $1",
    )
    .bind(uid)
    .bind(item_ids)
    .bind(now())
    .execute(c)
    .await?;
    Ok(())
}

pub fn variant_name(v: &str) -> &'static str {
    VARIANTS.iter().find(|x| x.0 == v).map_or("Zwykła", |x| x.1)
}

// ---------------------------------------------------------------- przykładowe naklejki

fn inside_poly(p: &[(f32, f32)], x: f32, y: f32) -> bool {
    let mut c = false;
    let mut j = p.len() - 1;
    for i in 0..p.len() {
        let (a, b) = (p[i], p[j]);
        if (a.1 > y) != (b.1 > y) && x < (b.0 - a.0) * (y - a.1) / (b.1 - a.1) + a.0 {
            c = !c;
        }
        j = i;
    }
    c
}

fn star_pts() -> Vec<(f32, f32)> {
    (0..10)
        .map(|i| {
            let a = std::f32::consts::PI * i as f32 / 5.0 - std::f32::consts::FRAC_PI_2;
            let r = if i % 2 == 1 { 0.42 } else { 0.95 };
            (r * a.cos(), r * a.sin())
        })
        .collect()
}

/// Czy punkt (x, y) w układzie [-1, 1] leży wewnątrz kształtu
fn inside(kind: &str, x: f32, y: f32) -> bool {
    match kind {
        "star" => inside_poly(&star_pts(), x, y),
        "heart" => {
            let (px, py) = (x * 1.25, -y * 1.25 + 0.2);
            (px * px + py * py - 1.0).powi(3) - px * px * py.powi(3) <= 0.0
        }
        "smile" => x * x + y * y <= 0.9 * 0.9,
        "bolt" => inside_poly(&[(0.2, -0.95), (-0.5, 0.12), (-0.04, 0.12), (-0.22, 0.95), (0.52, -0.2), (0.06, -0.2), (0.45, -0.95)], x, y),
        _ => x.abs() / 0.8 + y.abs() / 0.95 <= 1.0,   // diament
    }
}

fn paint(kind: &str, x: f32, y: f32) -> [u8; 3] {
    let t = (y + 1.0) / 2.0;
    let mix = |a: [u8; 3], b: [u8; 3]| [0, 1, 2].map(|i| (f32::from(a[i]) * (1.0 - t) + f32::from(b[i]) * t) as u8);
    match kind {
        "star" => mix([255, 226, 89], [255, 150, 26]),
        "heart" => mix([255, 120, 150], [214, 40, 82]),
        "bolt" => mix([102, 204, 255], [30, 98, 214]),
        "smile" => {
            let dark = [48, 36, 28];
            let (ex, ey) = (x.abs() - 0.3, y + 0.25);
            let eye = ex * ex + ey * ey <= 0.12 * 0.12;
            let d = (x * x + (y - 0.02) * (y - 0.02)).sqrt();
            let mouth = y > 0.12 && (0.45..=0.58).contains(&d);
            if eye || mouth { dark } else { mix([255, 233, 100], [255, 190, 40]) }
        }
        _ => mix([140, 245, 255], [136, 96, 255]),
    }
}

/// Przykładowa naklejka jako PNG 256 x 256: kolorowy kształt z białym obrysem (jak prawdziwa naklejka); `kind`: star, heart, smile, bolt, gem
pub fn example_png(kind: &str) -> Vec<u8> {
    const N: u32 = 256;
    const SS: u32 = 3;
    let mut img = RgbaImage::new(N, N);
    for py in 0..N {
        for px in 0..N {
            let (mut body, mut edge) = (0, 0);
            let mut col = [0f32; 3];
            for sy in 0..SS {
                for sx in 0..SS {
                    let x = ((px * SS + sx) as f32 + 0.5) / (N * SS) as f32 * 2.0 - 1.0;
                    let y = ((py * SS + sy) as f32 + 0.5) / (N * SS) as f32 * 2.0 - 1.0;
                    if inside(kind, x, y) {
                        body += 1;
                        let c = paint(kind, x, y);
                        for i in 0..3 {
                            col[i] += f32::from(c[i]);
                        }
                    } else if inside(kind, x / 1.13, y / 1.13) {
                        edge += 1;
                    }
                }
            }
            let total = (SS * SS) as f32;
            let a = (body + edge) as f32 / total;
            if a > 0.0 {
                let (b, e) = (body as f32, edge as f32 * 255.0);
                let mix = |i: usize| ((col[i] + e) / (b + edge as f32).max(1.0)).round().clamp(0.0, 255.0) as u8;
                img.put_pixel(px, py, Rgba([mix(0), mix(1), mix(2), (a * 255.0).round() as u8]));
            }
        }
    }
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(img).write_to(&mut out, ImageFormat::Png).expect("png");
    out.into_inner()
}

/// Przy pierwszym starcie: skrzynka z naklejkami i kilka przykładowych naklejek (żeby dało się to od razu przetestować).
/// Raz (`state.stickers_seeded`) - to, co admin potem usunie, nie wraca.
pub async fn seed(c: &mut Conn) -> sqlx::Result<()> {
    let done: Option<i64> = sqlx::query_scalar("SELECT value FROM state WHERE key = 'stickers_seeded'").fetch_optional(&mut *c).await?;
    if done.is_some() {
        return Ok(());
    }
    sqlx::query("INSERT INTO state (key, value) VALUES ('stickers_seeded', 1) ON CONFLICT (key) DO NOTHING").execute(&mut *c).await?;
    let any: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stickers").fetch_one(&mut *c).await?;
    if any > 0 {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO sticker_crates (id, name, emoji, color1, color2, descr, weights, pos) VALUES ($1, 'Skrzynka z naklejkami', '🏷️', '#ffd23f', '#2a1f4d',
         'naklejki na karty: od zwykłych po tajną, czasem foliowane, holo albo złote', $2, 0) ON CONFLICT (id) DO NOTHING",
    )
    .bind(DEFAULT_CRATE)
    .bind(json!({"normal": DEFAULT_WEIGHTS[0], "foil": DEFAULT_WEIGHTS[1], "holo": DEFAULT_WEIGHTS[2], "gold": DEFAULT_WEIGHTS[3]}).to_string())
    .execute(&mut *c)
    .await?;
    let examples = [("gwiazdka", "Gwiazdka", "green", "star"), ("usmiech", "Uśmiech", "uncommon", "smile"), ("serduszko", "Serduszko", "blue", "heart"),
                    ("piorun", "Piorun", "purple", "bolt"), ("diament", "Tajny diament", "secret", "gem")];
    for (i, (id, name, rarity, shape)) in examples.iter().enumerate() {
        sqlx::query("INSERT INTO stickers (id, name, rarity, enabled, crates, img, img_at, pos) VALUES ($1, $2, $3, 1, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING")
            .bind(id)
            .bind(name)
            .bind(rarity)
            .bind(json!([DEFAULT_CRATE]).to_string())
            .bind(example_png(shape))
            .bind(now())
            .bind(i as i32)
            .execute(&mut *c)
            .await?;
    }
    Ok(())
}

pub async fn init(c: &mut Conn) -> sqlx::Result<()> {
    seed(&mut *c).await?;
    load(c).await
}

/// Mapa id -> (nazwa, rzadkość, wersja obrazka) całego katalogu (bez obrazków)
pub async fn catalog(c: &mut Conn) -> sqlx::Result<HashMap<String, (String, String, i64)>> {
    let rows: Vec<(String, String, String, f64)> = sqlx::query_as("SELECT id, name, rarity, img_at FROM stickers").fetch_all(c).await?;
    Ok(rows.into_iter().map(|(id, n, r, at)| (id, (n, r, at as i64))).collect())
}

/// Test: podmienia katalog naklejek i skrzynek w pamięci (ustawienia globalne - testy, które z tego korzystają, nie mogą zakładać pustego rejestru)
#[cfg(test)]
pub fn set_test_registry(stickers: &[(&str, &str, bool)], crates: Vec<StickerCrate>) {
    *STICKERS.write() = Arc::new(stickers.iter().map(|(id, r, en)| ((*id).to_owned(), StickerInfo { name: (*id).to_owned(), rarity: (*r).to_owned(), enabled: *en })).collect());
    *CRATES.write() = Arc::new(crates);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cr(w: [f64; 4]) -> StickerCrate {
        StickerCrate { id: "t".into(), name: "T".into(), emoji: "".into(), color1: "".into(), color2: "".into(), desc: "".into(), weights: w }
    }

    #[test]
    fn weights_are_cleaned() {
        assert_eq!(clean_weights(&json!({})), DEFAULT_WEIGHTS);
        assert_eq!(clean_weights(&json!({"normal": 0, "foil": 0, "holo": 0, "gold": 5})), [0.0, 0.0, 0.0, 5.0]);
        assert_eq!(clean_weights(&json!({"normal": "0", "gold": "x"})), [1.0, 0.0, 0.0, 0.0], "same zera = zawsze zwykła");
        assert_eq!(clean_weights(&json!({"normal": -3, "foil": 2})), [0.0, 2.0, 0.0, 0.0]);
    }

    #[test]
    fn rarity_odds_match_cards_and_secret_is_fixed() {
        let present: Vec<String> = ["green", "blue", "secret"].iter().map(|s| s.to_string()).collect();
        let w = rarity_weights(&present);
        let (others, secret) = (w.iter().filter(|x| x.0 != "secret").map(|x| x.1).sum::<f64>(), w.iter().find(|x| x.0 == "secret").unwrap().1);
        let odds = crate::data::g().secret_odds as f64;
        assert!((secret / (others + secret) - 1.0 / odds).abs() < 1e-9, "tajna naklejka: 1 na {odds}");
        assert!(rarity_weights(&["special".to_owned(), "green".to_owned()]).iter().all(|x| x.0 != "special"), "bez Specjalnej");
    }

    #[test]
    fn contents_show_chances_that_sum_to_one() {
        let list = vec![
            ("a".to_owned(), "A".to_owned(), "green".to_owned(), 1.0),
            ("b".to_owned(), "B".to_owned(), "green".to_owned(), 2.0),
            ("c".to_owned(), "C".to_owned(), "blue".to_owned(), 3.0),
            ("d".to_owned(), "D".to_owned(), "secret".to_owned(), 4.0),
        ];
        let v = contents_view(&list);
        assert_eq!(v.len(), 4);
        let sum: f64 = v.iter().map(|x| x["chance"].as_f64().unwrap()).sum();
        assert!((sum - 1.0).abs() < 1e-9, "szanse sumują się do 1: {sum}");
        assert_eq!(v[0]["sticker"], "d", "od najrzadszych");
        let chance = |id: &str| v.iter().find(|x| x["sticker"] == id).unwrap()["chance"].as_f64().unwrap();
        assert!((chance("a") - chance("b")).abs() < 1e-12, "ta sama rzadkość = ta sama szansa");
        assert!(chance("a") < chance("c") * 2.0 && chance("d") < chance("c"));
        assert!(contents_view(&[]).is_empty());
    }

    #[test]
    fn crate_can_force_a_variant() {
        let pool = vec![("a".to_owned(), "green".to_owned()), ("b".to_owned(), "blue".to_owned())];
        for _ in 0..200 {
            assert_eq!(roll_one(&pool, &cr([0.0, 0.0, 0.0, 1.0])).unwrap().variant, "gold");
            assert_eq!(roll_one(&pool, &cr([0.0, 1.0, 0.0, 0.0])).unwrap().variant, "foil");
        }
        assert!(roll_one(&[], &cr(DEFAULT_WEIGHTS)).is_none());
        let mut seen = HashMap::new();
        for _ in 0..4000 {
            *seen.entry(roll_one(&pool, &cr(DEFAULT_WEIGHTS)).unwrap().variant).or_insert(0) += 1;
        }
        assert!(seen["normal"] > seen["foil"] && seen["foil"] > 0 && seen.contains_key("gold"), "{seen:?}");
    }

    #[test]
    fn example_art_is_a_transparent_png_with_a_shape() {
        for k in ["star", "heart", "smile", "bolt", "gem"] {
            let img = image::load_from_memory(&example_png(k)).unwrap().to_rgba8();
            assert_eq!(img.dimensions(), (256, 256));
            assert_eq!(img.get_pixel(0, 0)[3], 0, "{k}: róg przezroczysty");
            assert!(img.get_pixel(128, 128)[3] > 250, "{k}: środek kolorowy");
        }
    }

    #[test]
    fn hologram_cards_take_no_stickers() {
        assert!(!allows_stickers("hologram"));
        assert!(!allows_stickers("flag+hologram"));
        assert!(allows_stickers("normal") && allows_stickers("gold") && allows_stickers("flag+gold"));
    }

    #[test]
    fn kinds_are_recognised() {
        assert!(crate_of_kind("money_daily").is_none());
        assert_eq!(KIND_PREFIX, "sticker_");
    }
}
