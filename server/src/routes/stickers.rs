//! Naklejki dla graczy (src/stickers.rs): ekwipunek i naklejanie na karty, otwieranie skrzynek z naklejkami, obrazki i panel admina
//! (`/admin/gstickers`: katalog naklejek z wgrywaniem PNG i skrzynki z naklejkami z szansami wariantów).

use std::collections::HashMap;
use std::io::Cursor;

use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use image::{imageops, DynamicImage, ImageFormat};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::variants::Form;
use super::{ok, JsonBody};
use crate::auth::{Admin, Me};
use crate::data::g;
use crate::db::{lock_me, now};
use crate::error::{bad, AppError, Res};
use crate::game::{add_chests, get_chests, log_admin, Ctx};
use crate::state::AppState;
use crate::stickers::{self, StickerCrate, MAX_ON_CARD, VARIANTS};
use crate::text::clean;

/// Największy wgrywany plik i bok obrazka naklejki po zmniejszeniu (px)
const MAX_BYTES: usize = 5 * 1024 * 1024;
const MAX_SIDE: u32 = 512;
const MAX_STICKERS: i64 = 500;

/// Skrzynki z naklejkami do `/api/config` (rysowanie w ekwipunku)
pub fn crates_json() -> Value {
    Value::Array(
        stickers::crates()
            .iter()
            .map(|c| json!({"id": c.id, "kind": c.kind(), "name": c.name, "emoji": c.emoji, "color1": c.color1, "color2": c.color2, "desc": c.desc,
                            "weights": c.weights_json()}))
            .collect(),
    )
}

fn placement_json(r: &(i64, i64, String, String, f32, f32, f32, f32, i16, i16)) -> Value {
    json!({"id": r.0, "item": r.1, "sticker": r.2, "variant": r.3, "x": r.4, "y": r.5, "w": r.6, "rot": r.7, "flip": r.8 != 0, "photo": r.9 != 0})
}

type PlacedRow = (i64, i64, String, String, f32, f32, f32, f32, i16, i16);
const PLACED_COLS: &str = "s.id, s.item_id, s.sticker_id, s.variant, s.x, s.y, s.w, s.rot, s.flip, s.on_photo";

/// Moje naklejki: katalog (bez obrazków), te w ekwipunku i naklejone na moje karty
pub async fn stickers_me(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    let catalog = stickers::catalog(&mut c).await?;
    let items: Vec<(i64, String, String)> =
        sqlx::query_as("SELECT id, sticker_id, variant FROM sticker_items WHERE user_id = $1 ORDER BY id DESC").bind(me.id).fetch_all(&mut *c).await?;
    let placed: Vec<PlacedRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {PLACED_COLS} FROM card_stickers s JOIN items i ON i.id = s.item_id WHERE i.user_id = $1 ORDER BY s.id"
    )))
    .bind(me.id)
    .fetch_all(&mut *c)
    .await?;
    let mut by_card: Map<String, Value> = Map::new();
    for r in placed.iter().filter(|r| catalog.contains_key(&r.2)) {
        by_card.entry(r.1.to_string()).or_insert_with(|| json!([])).as_array_mut().unwrap().push(placement_json(r));
    }
    ok(json!({
        "catalog": catalog.iter().map(|(id, (n, r, v))| (id.clone(), json!({"name": n, "rarity": r, "v": v}))).collect::<Map<_, _>>(),
        "items": items.iter().filter(|i| catalog.contains_key(&i.1)).map(|(id, s, v)| json!({"id": id, "sticker": s, "variant": v})).collect::<Vec<_>>(),
        "placed": by_card,
        "max": MAX_ON_CARD,
        "variants": VARIANTS.iter().map(|(k, n)| json!({"key": k, "name": n})).collect::<Vec<_>>(),
    }))
}

/// Naklejki wybranych kart (dla cudzych kart: gablota na profilu) - położenia do narysowania
pub async fn placed_for(c: &mut crate::db::Conn, item_ids: &[i64]) -> sqlx::Result<Map<String, Value>> {
    let rows: Vec<PlacedRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {PLACED_COLS} FROM card_stickers s WHERE s.item_id = ANY($1) ORDER BY s.id"
    )))
    .bind(item_ids)
    .fetch_all(c)
    .await?;
    let mut out: Map<String, Value> = Map::new();
    for r in &rows {
        out.entry(r.1.to_string()).or_insert_with(|| json!([])).as_array_mut().unwrap().push(placement_json(r));
    }
    Ok(out)
}

// ---------------------------------------------------------------- otwieranie skrzynek z naklejkami

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct OpenRequest {
    #[serde(rename = "crate")]
    crate_id: String,
    count: i64,
}

/// Otwarcie skrzynek z naklejkami z ekwipunku (skrzynki dostaje się za nagrody; nie ma ich w sklepie)
pub async fn stickers_open(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<OpenRequest>) -> Res {
    let cat = st.cat();
    let count = req.count.clamp(1, g().max_open.max(1));
    let Some(cr) = stickers::crates().iter().find(|c| c.id == req.crate_id).cloned() else { return bad("Nie ma takiej skrzynki z naklejkami") };
    let kind = cr.kind();
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if get_chests(&mut tx, &cat, me.id).await?.get(&kind).copied().unwrap_or(0) < count as i32 {
        return bad("Nie masz tylu takich skrzynek");
    }
    let pool = stickers::pool(&mut tx, &cr.id).await?;
    if pool.is_empty() {
        return bad("Ta skrzynka jest na razie pusta - nie ma w niej żadnych naklejek");
    }
    let rolled: Vec<stickers::Rolled> = (0..count).filter_map(|_| stickers::roll_one(&pool, &cr)).collect();
    add_chests(&mut tx, me.id, &kind, -count).await?;
    let ids = stickers::give(&mut tx, me.id, &rolled).await?;
    crate::exp::award(&mut tx, me.id, "open_stickers", count).await?;
    let catalog = stickers::catalog(&mut tx).await?;
    let chests = get_chests(&mut tx, &cat, me.id).await?;
    tx.commit().await?;
    let drops: Vec<Value> = rolled
        .iter()
        .zip(&ids)
        .map(|(r, id)| {
            let (name, _, v) = catalog.get(&r.sticker).cloned().unwrap_or_default();
            json!({"id": id, "sticker": r.sticker, "variant": r.variant, "name": name, "rarity": r.rarity, "v": v})
        })
        .collect();
    ok(json!({"drops": drops, "chests": chests, "crate": cr.id}))
}

// ---------------------------------------------------------------- naklejanie

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct PlaceRequest {
    /// numer naklejki z ekwipunku (attach) albo naklejonej (update / detach)
    id: i64,
    /// numer karty (egzemplarza), na którą naklejamy
    card: i64,
    x: f64,
    y: f64,
    w: f64,
    rot: f64,
    flip: bool,
    /// naklejka leży na zdjęciu (nad nim), a nie nad całą kartą
    photo: bool,
}

/// Położenie z przeglądarki: tylko liczby w sensownych granicach (% kontenera, stopnie)
fn clean_place(r: &PlaceRequest) -> (f32, f32, f32, f32) {
    let f = |v: f64, lo: f64, hi: f64, d: f64| if v.is_finite() { v.clamp(lo, hi) } else { d } as f32;
    (f(r.x, -20.0, 120.0, 50.0), f(r.y, -20.0, 120.0, 50.0), f(r.w, 6.0, 90.0, 25.0), f(r.rot, -180.0, 180.0, 0.0))
}

/// Naklejenie naklejki z ekwipunku na moją kartę (najwyżej `MAX_ON_CARD` na kartę)
pub async fn sticker_attach(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<PlaceRequest>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let owned: Option<(String, String)> =
        sqlx::query_as("SELECT sticker_id, variant FROM sticker_items WHERE id = $1 AND user_id = $2").bind(req.id).bind(me.id).fetch_optional(&mut *tx).await?;
    let Some((sticker, variant)) = owned else { return bad("Nie masz takiej naklejki") };
    let mine: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM items WHERE id = $1 AND user_id = $2)").bind(req.card).bind(me.id).fetch_one(&mut *tx).await?;
    if !mine {
        return bad("Nie masz takiej karty");
    }
    let on: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM card_stickers WHERE item_id = $1").bind(req.card).fetch_one(&mut *tx).await?;
    if on >= MAX_ON_CARD {
        return bad(format!("Na karcie może być najwyżej {MAX_ON_CARD} naklejek"));
    }
    let (x, y, w, rot) = clean_place(&req);
    let row: PlacedRow = sqlx::query_as(
        "INSERT INTO card_stickers (item_id, sticker_id, variant, x, y, w, rot, flip, on_photo, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, item_id, sticker_id, variant, x, y, w, rot, flip, on_photo",
    )
    .bind(req.card)
    .bind(&sticker)
    .bind(&variant)
    .bind(x)
    .bind(y)
    .bind(w)
    .bind(rot)
    .bind(i16::from(req.flip))
    .bind(i16::from(req.photo))
    .bind(now())
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM sticker_items WHERE id = $1").bind(req.id).execute(&mut *tx).await?;
    tx.commit().await?;
    ok(json!({"placement": placement_json(&row), "used": req.id}))
}

async fn my_placement(c: &mut crate::db::Conn, uid: i64, id: i64) -> sqlx::Result<Option<(i64, String, String)>> {
    sqlx::query_as("SELECT s.item_id, s.sticker_id, s.variant FROM card_stickers s JOIN items i ON i.id = s.item_id WHERE s.id = $1 AND i.user_id = $2")
        .bind(id)
        .bind(uid)
        .fetch_optional(c)
        .await
}

/// Przesunięcie, zmiana rozmiaru, obrotu, odbicia i warstwy (karta / zdjęcie) naklejki, która już jest na mojej karcie
pub async fn sticker_update(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<PlaceRequest>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if my_placement(&mut tx, me.id, req.id).await?.is_none() {
        return bad("Nie ma takiej naklejki na Twojej karcie");
    }
    let (x, y, w, rot) = clean_place(&req);
    sqlx::query("UPDATE card_stickers SET x = $2, y = $3, w = $4, rot = $5, flip = $6, on_photo = $7 WHERE id = $1")
        .bind(req.id)
        .bind(x)
        .bind(y)
        .bind(w)
        .bind(rot)
        .bind(i16::from(req.flip))
        .bind(i16::from(req.photo))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

/// Zdjęcie naklejki z karty: wraca do ekwipunku (z tym samym wariantem)
pub async fn sticker_detach(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<PlaceRequest>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let Some((_, sticker, variant)) = my_placement(&mut tx, me.id, req.id).await? else { return bad("Nie ma takiej naklejki na Twojej karcie") };
    sqlx::query("DELETE FROM card_stickers WHERE id = $1").bind(req.id).execute(&mut *tx).await?;
    let ids = stickers::give(&mut tx, me.id, &[stickers::Rolled { sticker: sticker.clone(), rarity: String::new(), variant: variant.clone() }]).await?;
    tx.commit().await?;
    ok(json!({"item": {"id": ids[0], "sticker": sticker, "variant": variant}, "removed": req.id}))
}

/// Obrazek naklejki (PNG); adres ma `?v=<wersja>`, więc można go trzymać w pamięci podręcznej
pub async fn sticker_image(State(st): State<AppState>, Path(id): Path<String>) -> Response {
    let png: Option<Vec<u8>> = sqlx::query_scalar("SELECT img FROM stickers WHERE id = $1").bind(&id).fetch_optional(&st.db).await.ok().flatten();
    match png {
        Some(b) => (StatusCode::OK, [(header::CONTENT_TYPE, "image/png"), (header::CACHE_CONTROL, "public, max-age=31536000")], b).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// ---------------------------------------------------------------- panel admina

fn rarity_options() -> Vec<Value> {
    let g = g();
    g.rarity_order.iter().filter(|r| *r != "special").map(|r| json!({"key": r, "name": g.rarities[r].name})).collect()
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct PlacedQuery {
    /// numery kart po przecinku (najwyżej 100)
    ids: String,
}

/// Położenia naklejek na dowolnych kartach (po numerach egzemplarzy): przeglądarka dociąga je dla kart, które widać na ekranie (rynek, ekwipunek
/// znajomego, podglądy), więc naklejki są widoczne na karcie wszędzie, nie tylko u właściciela. To publiczne informacje o wyglądzie karty.
pub async fn stickers_placed(State(st): State<AppState>, Me(_): Me, Query(q): Query<PlacedQuery>) -> Res {
    let ids: Vec<i64> = q.ids.split(',').filter_map(|s| s.trim().parse::<i64>().ok()).filter(|i| *i > 0).take(100).collect();
    let mut c = st.db.acquire().await?;
    let placed = placed_for(&mut c, &ids).await?;
    ok(json!({"placed": placed}))
}

/// Skrzynki z naklejkami dla panelu admina: wygląd i szanse (`crates_json`) + cena w euro i flaga „W sklepie”
async fn admin_crates_json(c: &mut crate::db::Conn) -> sqlx::Result<Value> {
    let shop: HashMap<String, (i64, i16)> = sqlx::query_as::<_, (String, i64, i16)>("SELECT id, price, in_shop FROM sticker_crates")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .map(|(id, p, s)| (id, (p, s)))
        .collect();
    let mut list = crates_json();
    for v in list.as_array_mut().into_iter().flatten() {
        let (price, in_shop) = v.get("id").and_then(Value::as_str).and_then(|id| shop.get(id)).copied().unwrap_or((600, 1));
        v["price"] = json!(price);
        v["inShop"] = json!(in_shop != 0);
    }
    Ok(list)
}

/// Oferty pojedynczych naklejek w Sklepie (panel admina): naklejka, wariant, cena w euro, limit i ile sprzedano
async fn offers_json(c: &mut crate::db::Conn) -> sqlx::Result<Value> {
    let rows: Vec<(i64, String, String, i64, i16, Option<i32>, i32)> =
        sqlx::query_as("SELECT id, sticker_id, variant, price, enabled, stock, sold FROM sticker_offers ORDER BY pos, id").fetch_all(c).await?;
    Ok(Value::Array(
        rows.into_iter()
            .map(|(id, sticker, variant, price, enabled, stock, sold)| json!({"id": id, "sticker": sticker, "variant": variant, "price": price, "enabled": enabled != 0, "stock": stock, "sold": sold}))
            .collect(),
    ))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct OffersSave {
    offers: Vec<Value>,
}

/// Oferty pojedynczych naklejek (pełna lista z panelu). Istniejące oferty (z `id`) zachowują licznik sprzedanych sztuk, brakujące w liście znikają.
pub async fn admin_sticker_offers(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<OffersSave>) -> Res {
    if req.offers.len() > 200 {
        return bad("Najwyżej 200 ofert");
    }
    let mut tx = st.db.begin().await?;
    let known: std::collections::HashSet<String> = sqlx::query_scalar("SELECT id FROM stickers").fetch_all(&mut *tx).await?.into_iter().collect();
    let mut keep: Vec<i64> = vec![];
    for (i, o) in req.offers.iter().enumerate() {
        let sticker = o.get("sticker").and_then(Value::as_str).unwrap_or("").to_owned();
        let variant = o.get("variant").and_then(Value::as_str).unwrap_or("normal").to_owned();
        if !known.contains(&sticker) {
            return bad("Wybierz naklejkę z katalogu");
        }
        if !VARIANTS.iter().any(|(k, _)| *k == variant) {
            return bad("Nieznany wariant naklejki");
        }
        let price = o.get("price").and_then(Value::as_i64).unwrap_or(0);
        if !(1..=10_000_000).contains(&price) {
            return bad("Cena oferty: od 1 do 10 000 000 euro");
        }
        let stock = o.get("stock").and_then(Value::as_i64).filter(|s| *s > 0).map(|s| s.min(10_000_000) as i32);
        let enabled = i16::from(o.get("enabled").and_then(Value::as_bool).unwrap_or(true));
        let id = match o.get("id").and_then(Value::as_i64).filter(|id| *id > 0) {
            Some(id) => {
                let n = sqlx::query("UPDATE sticker_offers SET sticker_id = $2, variant = $3, price = $4, enabled = $5, stock = $6, pos = $7 WHERE id = $1")
                    .bind(id).bind(&sticker).bind(&variant).bind(price).bind(enabled).bind(stock).bind(i as i32)
                    .execute(&mut *tx).await?.rows_affected();
                if n == 0 {
                    return bad("Oferta nie istnieje (odśwież panel)");
                }
                id
            }
            None => sqlx::query_scalar("INSERT INTO sticker_offers (sticker_id, variant, price, enabled, stock, pos) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id")
                .bind(&sticker).bind(&variant).bind(price).bind(enabled).bind(stock).bind(i as i32)
                .fetch_one(&mut *tx).await?,
        };
        keep.push(id);
    }
    sqlx::query("DELETE FROM sticker_offers WHERE NOT (id = ANY($1))").bind(&keep).execute(&mut *tx).await?;
    log_admin(&mut tx, &me, "gsticker_offers", None, &format!("{} ofert", keep.len())).await?;
    let offers = offers_json(&mut tx).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "offers": offers}))
}

pub async fn admin_stickers(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let mut c = st.db.acquire().await?;
    let rows: Vec<(String, String, String, i16, String, f64)> =
        sqlx::query_as("SELECT id, name, rarity, enabled, crates, img_at FROM stickers ORDER BY pos, id").fetch_all(&mut *c).await?;
    let owned: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>("SELECT sticker_id, COUNT(*) FROM sticker_items GROUP BY sticker_id")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .collect();
    let placed: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>("SELECT sticker_id, COUNT(*) FROM card_stickers GROUP BY sticker_id")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .collect();
    let list: Vec<Value> = rows
        .iter()
        .map(|(id, name, rarity, enabled, crates, at)| {
            json!({"id": id, "name": name, "rarity": rarity, "enabled": *enabled != 0, "crates": serde_json::from_str::<Value>(crates).unwrap_or(json!([])),
                   "v": *at as i64, "owned": owned.get(id).copied().unwrap_or(0), "placed": placed.get(id).copied().unwrap_or(0)})
        })
        .collect();
    ok(json!({
        "stickers": list, "crates": admin_crates_json(&mut c).await?, "offers": offers_json(&mut c).await?, "rarities": rarity_options(),
        "variants": VARIANTS.iter().map(|(k, n)| json!({"key": k, "name": n})).collect::<Vec<_>>(),
        "secretOdds": g().secret_odds, "maxOnCard": MAX_ON_CARD,
    }))
}

/// PNG naklejki: dowolny obraz z przezroczystością -> RGBA, najwyżej `MAX_SIDE` px dłuższy bok, zapisany jako PNG
fn process_sticker(blob: &[u8]) -> Result<Vec<u8>, String> {
    let mut img = crate::images::decode(blob)?.to_rgba8();
    let (w, h) = img.dimensions();
    if w < 16 || h < 16 {
        return Err("Obrazek jest za mały (najmniej 16 x 16 px)".into());
    }
    if w.max(h) > MAX_SIDE {
        let s = f64::from(MAX_SIDE) / f64::from(w.max(h));
        img = imageops::resize(&img, ((f64::from(w) * s).round() as u32).max(1), ((f64::from(h) * s).round() as u32).max(1), imageops::FilterType::Lanczos3);
    }
    if img.pixels().all(|p| p[3] == 0) {
        return Err("Obrazek jest cały przezroczysty".into());
    }
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(img).write_to(&mut out, ImageFormat::Png).map_err(|_| "Nie udało się zapisać obrazka".to_owned())?;
    Ok(out.into_inner())
}

/// Nowa albo zmieniona naklejka (multipart): `id` (puste = nowa), `name`, `rarity`, `enabled`, `crates` (JSON), `image` (PNG; przy nowej wymagany)
pub async fn admin_sticker_save(State(st): State<AppState>, Admin(me): Admin, mp: Multipart) -> Res {
    let form = Form::read(mp).await?;
    let field = |k: &str| form.fields.get(k).map(|s| s.trim().to_owned()).unwrap_or_default();
    let name = clean(&field("name"), 40);
    if name.is_empty() {
        return bad("Podaj nazwę naklejki");
    }
    let rarity = field("rarity");
    if !g().rarity_order.contains(&rarity) || rarity == "special" {
        return bad("Nieznana rzadkość (naklejki nie mają rzadkości Specjalnej)");
    }
    let known: Vec<String> = stickers::crates().iter().map(|c| c.id.clone()).collect();
    let crates: Vec<String> = serde_json::from_str::<Vec<String>>(&field("crates")).unwrap_or_default().into_iter().filter(|c| known.contains(c)).collect();
    let png = match form.upload("image") {
        Some(b) if b.len() > MAX_BYTES => return bad("Plik jest za duży (najwyżej 5 MB)"),
        Some(b) => Some(process_sticker(b).map_err(AppError::bad)?),
        None => None,
    };
    let enabled = i16::from(field("enabled") != "0");
    let mut tx = st.db.begin().await?;
    let id = field("id");
    let id = if id.is_empty() {
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stickers").fetch_one(&mut *tx).await?;
        if total >= MAX_STICKERS {
            return bad(format!("Najwyżej {MAX_STICKERS} naklejek"));
        }
        let Some(png) = png else { return bad("Wybierz plik PNG z naklejką") };
        let base = super::admin::slug(&name);
        let base = if base.is_empty() { "naklejka".to_owned() } else { base };
        let mut id = base.clone();
        let mut n = 1;
        while sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM stickers WHERE id = $1)").bind(&id).fetch_one(&mut *tx).await? {
            n += 1;
            id = format!("{base}_{n}");
        }
        sqlx::query("INSERT INTO stickers (id, name, rarity, enabled, crates, img, img_at, pos) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
            .bind(&id)
            .bind(&name)
            .bind(&rarity)
            .bind(enabled)
            .bind(json!(crates).to_string())
            .bind(png)
            .bind(now())
            .bind(total as i32)
            .execute(&mut *tx)
            .await?;
        id
    } else {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM stickers WHERE id = $1)").bind(&id).fetch_one(&mut *tx).await?;
        if !exists {
            return bad("Nie ma takiej naklejki");
        }
        sqlx::query("UPDATE stickers SET name = $2, rarity = $3, enabled = $4, crates = $5 WHERE id = $1")
            .bind(&id)
            .bind(&name)
            .bind(&rarity)
            .bind(enabled)
            .bind(json!(crates).to_string())
            .execute(&mut *tx)
            .await?;
        if let Some(png) = png {
            sqlx::query("UPDATE stickers SET img = $2, img_at = $3 WHERE id = $1").bind(&id).bind(png).bind(now()).execute(&mut *tx).await?;
        }
        id
    };
    log_admin(&mut tx, &me, "gsticker_save", None, &format!("{name} ({id}, {rarity})")).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "id": id}))
}

/// Usunięcie naklejki z katalogu razem ze wszystkimi jej egzemplarzami (w ekwipunkach i na kartach)
pub async fn admin_sticker_delete(State(st): State<AppState>, Admin(me): Admin, Path(id): Path<String>) -> Res {
    let mut tx = st.db.begin().await?;
    sqlx::query("DELETE FROM card_stickers WHERE sticker_id = $1").bind(&id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM sticker_items WHERE sticker_id = $1").bind(&id).execute(&mut *tx).await?;
    let n = sqlx::query("DELETE FROM stickers WHERE id = $1").bind(&id).execute(&mut *tx).await?.rows_affected();
    if n == 0 {
        return bad("Nie ma takiej naklejki");
    }
    log_admin(&mut tx, &me, "gsticker_delete", None, &id).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

fn hex(v: &Value, d: &str) -> String {
    let s = v.as_str().unwrap_or("").trim().to_ascii_lowercase();
    if s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit()) { s } else { d.to_owned() }
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct CratesSave {
    crates: Vec<Value>,
}

/// Skrzynki z naklejkami (pełna lista z panelu): nazwa, wygląd i szanse wariantów naklejki. Usunięta skrzynka znika też z ekwipunków graczy.
pub async fn admin_sticker_crates(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<CratesSave>) -> Res {
    if req.crates.len() > stickers::MAX_CRATES {
        return bad("Za dużo skrzynek");
    }
    let mut tx = st.db.begin().await?;
    let mut keep: Vec<String> = vec![];
    for (i, c) in req.crates.iter().enumerate() {
        let name = clean(c.get("name").and_then(Value::as_str).unwrap_or(""), 40);
        if name.is_empty() {
            return bad("Każda skrzynka ma mieć nazwę");
        }
        let given = c.get("id").and_then(Value::as_str).unwrap_or("").trim().to_owned();
        let id = if given.is_empty() {
            let base = super::admin::slug(&name);
            let base = if base.is_empty() { "naklejki".to_owned() } else { base };
            let mut id = base.clone();
            let mut n = 1;
            while keep.contains(&id) || stickers::crates().iter().any(|x| x.id == id) {
                n += 1;
                id = format!("{base}_{n}");
            }
            id
        } else {
            given
        };
        let w = stickers::clean_weights(c.get("weights").unwrap_or(&Value::Null));
        let sc = StickerCrate { id: id.clone(), name: name.clone(), emoji: clean(c.get("emoji").and_then(Value::as_str).unwrap_or(""), 8), color1: hex(&c["color1"], "#ffd23f"),
                                color2: hex(&c["color2"], "#2a1f4d"), desc: clean(c.get("desc").and_then(Value::as_str).unwrap_or(""), 200), weights: w };
        let price = c.get("price").and_then(Value::as_i64).unwrap_or(600).clamp(0, 10_000_000);
        let in_shop = i16::from(c.get("inShop").and_then(Value::as_bool).unwrap_or(true));
        sqlx::query(
            "INSERT INTO sticker_crates (id, name, emoji, color1, color2, descr, weights, pos, price, in_shop) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, emoji = excluded.emoji, color1 = excluded.color1, color2 = excluded.color2,
                 descr = excluded.descr, weights = excluded.weights, pos = excluded.pos, price = excluded.price, in_shop = excluded.in_shop",
        )
        .bind(&sc.id)
        .bind(&sc.name)
        .bind(&sc.emoji)
        .bind(&sc.color1)
        .bind(&sc.color2)
        .bind(&sc.desc)
        .bind(sc.weights_json().to_string())
        .bind(i as i32)
        .bind(price)
        .bind(in_shop)
        .execute(&mut *tx)
        .await?;
        keep.push(id);
    }
    let old: Vec<String> = sqlx::query_scalar("SELECT id FROM sticker_crates").fetch_all(&mut *tx).await?;
    for gone in old.iter().filter(|i| !keep.contains(i)) {
        sqlx::query("DELETE FROM sticker_crates WHERE id = $1").bind(gone).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM user_chests WHERE kind = $1").bind(format!("{}{gone}", stickers::KIND_PREFIX)).execute(&mut *tx).await?;
    }
    log_admin(&mut tx, &me, "gsticker_crates", None, &format!("skrzynki: {}", keep.join(", "))).await?;
    stickers::load(&mut tx).await?;
    let crates = admin_crates_json(&mut tx).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "crates": crates}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uploaded_png_is_normalised() {
        // duży obrazek z przezroczystością -> najwyżej MAX_SIDE, nadal PNG z alfą
        let big = image::RgbaImage::from_fn(900, 600, |x, y| if (200..700).contains(&x) && (100..500).contains(&y) { image::Rgba([255, 0, 0, 255]) } else { image::Rgba([0, 0, 0, 0]) });
        let mut png = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(big).write_to(&mut png, ImageFormat::Png).unwrap();
        let out = process_sticker(&png.into_inner()).unwrap();
        let img = image::load_from_memory(&out).unwrap().to_rgba8();
        assert_eq!(img.width().max(img.height()), MAX_SIDE);
        assert_eq!(img.get_pixel(0, 0)[3], 0);
        // cały przezroczysty i za mały obrazek są odrzucane
        let empty = image::RgbaImage::new(64, 64);
        let mut e = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(empty).write_to(&mut e, ImageFormat::Png).unwrap();
        assert!(process_sticker(&e.into_inner()).is_err());
        let tiny = image::RgbaImage::from_pixel(4, 4, image::Rgba([1, 2, 3, 255]));
        let mut t = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(tiny).write_to(&mut t, ImageFormat::Png).unwrap();
        assert!(process_sticker(&t.into_inner()).is_err());
        assert!(process_sticker(b"to nie jest obrazek").is_err());
    }

    #[test]
    fn placement_is_clamped() {
        let r = PlaceRequest { id: 1, card: 2, x: 9999.0, y: -9999.0, w: 0.1, rot: 720.0, flip: true, photo: false };
        assert_eq!(clean_place(&r), (120.0, -20.0, 6.0, 180.0));
        let nan = PlaceRequest { x: f64::NAN, ..Default::default() };
        assert_eq!(clean_place(&nan).0, 50.0);
    }
}
