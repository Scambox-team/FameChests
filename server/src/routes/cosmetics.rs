//! Kosmetyki profilu (src/cosmetics.rs): obrazki, ekran wyboru gracza (załóż / zdejmij), prywatność ekwipunku i panel admina
//! („Kosmetyki profilu”: wgrywanie grafik z walidacją wymiarów, nazwa, źródło odblokowania, włączanie, kolejność, ręczne nadanie).

use std::collections::HashMap;

use axum::extract::{Multipart, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{json, Value};

use super::variants::Form;
use super::{ok, JsonBody};
use crate::auth::{find_user, Admin, Me};
use crate::cosmetics::{self, Kind, Visibility, AUTO, KINDS, MAX_COSMETICS};
use crate::db::{lock_me, now};
use crate::error::{bad, Res};
use crate::game::log_admin;
use crate::state::AppState;
use crate::text::clean;

/// Obrazek kosmetyku; adres ma `?v=<wersja>`, więc można go trzymać w pamięci podręcznej przeglądarki
pub async fn cosmetic_image(State(st): State<AppState>, Path(id): Path<String>) -> Response {
    let row: Option<(Vec<u8>, String)> =
        sqlx::query_as("SELECT img, mime FROM cosmetics WHERE id = $1").bind(&id).fetch_optional(&st.db).await.ok().flatten();
    match row {
        Some((bytes, mime)) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, "public, max-age=31536000".to_owned())],
            bytes,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

fn kinds_json() -> Value {
    Value::Array(
        KINDS
            .iter()
            .map(|k| {
                let (w, h) = k.size();
                json!({"key": k.key(), "label": k.label(), "w": w, "h": h, "maxKb": k.max_bytes() / 1024, "requirements": k.requirements()})
            })
            .collect(),
    )
}

// ---------------------------------------------------------------- gracz

/// Ekran „Wygląd profilu”: katalog (zablokowane też, chyba że admin je ukrył), co gracz ma, co ma założone i kto widzi jego ekwipunek
pub async fn my_cosmetics(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    let have = cosmetics::unlocked_of(&mut c, me.id).await?;
    let style = cosmetics::style_of(&mut c, me.id).await?;
    let items: Vec<Value> = cosmetics::list()
        .iter()
        .filter(|x| x.enabled && (have.contains(&x.id) || !x.hide_locked))
        .map(|x| {
            let mut v = x.view();
            let unlocked = have.contains(&x.id);
            v["unlocked"] = json!(unlocked);
            // jak zdobyć - tylko dla tych, których jeszcze nie ma
            v["source"] = json!(if unlocked { "" } else { x.source.as_str() });
            v
        })
        .collect();
    ok(json!({
        "kinds": kinds_json(),
        "items": items,
        "equipped": {"mini": style.mini, "frame": style.frame, "bg": style.bg, "avatar": style.avatar},
        "inventoryVisible": style.inventory.key(),
        "about": {"bio": style.bio, "country": style.country, "bioMax": cosmetics::BIO_MAX},
    }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct EquipRequest {
    kind: String,
    /// puste = zdejmij (standardowy wygląd)
    id: String,
}

/// Zakłada albo zdejmuje kosmetyk. Serwer sprawdza, że pozycja jest odblokowana, włączona i właściwego rodzaju.
pub async fn equip(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<EquipRequest>) -> Res {
    let Some(kind) = Kind::from_key(&req.kind) else { return bad("Nieznany rodzaj kosmetyku") };
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let id = req.id.trim();
    if !id.is_empty() {
        let have = cosmetics::unlocked_of(&mut tx, me.id).await?;
        cosmetics::can_equip(&have, cosmetics::get(id).as_ref(), kind).map_err(crate::error::AppError::bad)?;
    }
    let sql = match kind {
        Kind::Mini => "INSERT INTO user_profile_style (user_id, mini_bg) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET mini_bg = excluded.mini_bg",
        Kind::Frame => "INSERT INTO user_profile_style (user_id, frame) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET frame = excluded.frame",
        Kind::Bg => "INSERT INTO user_profile_style (user_id, profile_bg) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET profile_bg = excluded.profile_bg",
        Kind::Avatar => "INSERT INTO user_profile_style (user_id, avatar) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET avatar = excluded.avatar",
    };
    sqlx::query(sql).bind(me.id).bind(id).execute(&mut *tx).await?;
    let style = cosmetics::style_of(&mut tx, me.id).await?;
    tx.commit().await?;
    if kind == Kind::Avatar {
        cosmetics::set_avatar(me.id, &style.avatar);   // własne zdjęcie profilowe widać od razu wszędzie, gdzie jest nazwa gracza
    }
    ok(json!({"ok": true, "equipped": {"mini": style.mini, "frame": style.frame, "bg": style.bg, "avatar": style.avatar}}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct AboutRequest {
    bio: String,
    /// kod ISO kraju (jak w Paszporcie), puste = bez kraju
    country: String,
}

/// Opis profilu i kraj: darmowe, dla każdego. Opis to zwykły tekst (najwyżej `BIO_MAX` znaków), kraj musi być jednym z państw z Paszportu.
pub async fn set_about(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<AboutRequest>) -> Res {
    let bio = clean(&req.bio, cosmetics::BIO_MAX);
    let country = req.country.trim().to_ascii_uppercase();
    if !country.is_empty() && !crate::borders::has(&country) {
        return bad("Nieznany kraj");
    }
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    sqlx::query(
        "INSERT INTO user_profile_style (user_id, bio, country) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET bio = excluded.bio, country = excluded.country",
    )
    .bind(me.id)
    .bind(&bio)
    .bind(&country)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    ok(json!({"ok": true, "bio": bio, "country": country}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct PrivacyRequest {
    /// `friends` (domyślnie) albo `nobody`
    inventory: String,
}

/// Ustawienie konta: kto może oglądać mój ekwipunek (znajomi / nikt)
pub async fn set_privacy(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<PrivacyRequest>) -> Res {
    if !matches!(req.inventory.as_str(), "friends" | "nobody") {
        return bad("Nieprawidłowe ustawienie");
    }
    let v = Visibility::parse(&req.inventory);
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    sqlx::query(
        "INSERT INTO user_profile_style (user_id, inventory_visible) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET inventory_visible = excluded.inventory_visible",
    )
    .bind(me.id)
    .bind(v.key())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    ok(json!({"ok": true, "inventoryVisible": v.key()}))
}

// ---------------------------------------------------------------- panel admina

fn auto_json() -> Value {
    Value::Array(AUTO.iter().map(|(k, d)| json!({"key": k, "name": d})).collect())
}

pub async fn admin_cosmetics(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let mut c = st.db.acquire().await?;
    let owned: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>("SELECT cosmetic_id, COUNT(*) FROM user_cosmetics GROUP BY cosmetic_id")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .collect();
    let worn: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>(
        "SELECT id, COUNT(*) FROM (SELECT mini_bg AS id FROM user_profile_style UNION ALL SELECT frame FROM user_profile_style \
         UNION ALL SELECT profile_bg FROM user_profile_style) x WHERE id <> '' GROUP BY id",
    )
    .fetch_all(&mut *c)
    .await?
    .into_iter()
    .collect();
    let sold: HashMap<String, i64> = sqlx::query_as::<_, (String, i32)>("SELECT id, sold FROM cosmetics")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .map(|(id, n)| (id, i64::from(n)))
        .collect();
    let list: Vec<Value> = cosmetics::list()
        .iter()
        .map(|x| {
            json!({
                "id": x.id, "kind": x.kind.key(), "name": x.name, "source": x.source, "auto": x.auto, "enabled": x.enabled,
                "hideLocked": x.hide_locked, "url": x.url(), "animated": x.animated, "w": x.w, "h": x.h, "mime": x.mime,
                "owners": owned.get(&x.id).copied().unwrap_or(0), "worn": worn.get(&x.id).copied().unwrap_or(0),
                "price": x.price, "inShop": x.in_shop, "tags": x.tags, "stock": x.stock, "sold": sold.get(&x.id).copied().unwrap_or(0),
                "saleFrom": x.sale_from, "saleTo": x.sale_to,
            })
        })
        .collect();
    ok(json!({"list": list, "kinds": kinds_json(), "auto": auto_json(), "max": MAX_COSMETICS, "colors": colors_json(), "showcase": super::cshop::showcase_json(None)}))
}

pub fn colors_json() -> Value {
    Value::Array(cosmetics::COLORS.iter().map(|(k, n)| json!({"key": k, "name": n})).collect())
}

/// Ceny, limity i terminy z formularza panelu: cena w euro (0 = bez ceny), stock puste = bez limitu, daty jako sekundy unixowe (puste = bez ograniczenia)
struct ShopFields {
    price: i64,
    in_shop: i16,
    stock: Option<i32>,
    sale_from: Option<f64>,
    sale_to: Option<f64>,
}

fn shop_fields(field: &dyn Fn(&str) -> String) -> Result<ShopFields, crate::error::AppError> {
    use crate::error::AppError;
    let price = if field("price").is_empty() { 0 } else { field("price").parse::<i64>().map_err(|_| AppError::bad("Cena: liczba całkowita euro"))? };
    if !(0..=10_000_000).contains(&price) {
        return Err(AppError::bad("Cena: od 0 do 10 000 000 euro"));
    }
    let stock = match field("stock").as_str() {
        "" => None,
        s => Some(s.parse::<i32>().map_err(|_| AppError::bad("Limit sztuk: liczba całkowita"))?),
    };
    if stock.is_some_and(|s| !(1..=10_000_000).contains(&s)) {
        return Err(AppError::bad("Limit sztuk: od 1 (puste = bez limitu)"));
    }
    let time = |k: &str| -> Result<Option<f64>, AppError> {
        match field(k).as_str() {
            "" => Ok(None),
            s => s.parse::<f64>().ok().filter(|t| *t > 0.0).map(Some).ok_or_else(|| AppError::bad("Nieprawidłowa data sprzedaży")),
        }
    };
    let (sale_from, sale_to) = (time("saleFrom")?, time("saleTo")?);
    if let (Some(a), Some(b)) = (sale_from, sale_to) {
        if b <= a {
            return Err(AppError::bad("Koniec sprzedaży musi być po jej początku"));
        }
    }
    Ok(ShopFields { price, in_shop: i16::from(field("inShop") != "0"), stock, sale_from, sale_to })
}

/// Nowy albo zmieniony kosmetyk (multipart): `id` (puste = nowy), `kind` (tylko nowy), `name`, `source`, `auto`, `enabled`, `hideLocked`,
/// `image` (przy nowym wymagany; wymiary i format sprawdza `cosmetics::process_image`)
pub async fn admin_cosmetic_save(State(st): State<AppState>, Admin(me): Admin, mp: Multipart) -> Res {
    let form = Form::read(mp).await?;
    let field = |k: &str| form.fields.get(k).map(|s| s.trim().to_owned()).unwrap_or_default();
    let name = clean(&field("name"), 40);
    if name.is_empty() {
        return bad("Podaj nazwę kosmetyku");
    }
    let source = clean(&field("source"), 120);
    let auto = field("auto");
    if !AUTO.iter().any(|(k, _)| *k == auto) {
        return bad("Nieznane źródło odblokowania");
    }
    let enabled = i16::from(field("enabled") != "0");
    let hide_locked = i16::from(field("hideLocked") == "1");
    let shop = shop_fields(&field)?;
    let id = field("id");
    // tagi koloru: pole `tags` (lista kluczy) wygrywa; przy nowej pozycji bez pola i przy `retag=1` biorą się z wykrytych kolorów obrazka
    let given_tags = form.fields.contains_key("tags").then(|| cosmetics::clean_tags(&field("tags")).join(","));
    let mut tx = st.db.begin().await?;
    let saved_id = if id.is_empty() {
        let Some(kind) = Kind::from_key(&field("kind")) else { return bad("Wybierz rodzaj kosmetyku") };
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cosmetics").fetch_one(&mut *tx).await?;
        if total >= MAX_COSMETICS {
            return bad(format!("Najwyżej {MAX_COSMETICS} kosmetyków"));
        }
        let Some(blob) = form.upload("image") else { return bad("Wybierz plik z grafiką") };
        let img = cosmetics::process_image(kind, blob).map_err(crate::error::AppError::bad)?;
        let base = super::admin::slug(&name);
        let base = if base.is_empty() { kind.key().to_owned() } else { base };
        let mut id = base.clone();
        let mut n = 1;
        while sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM cosmetics WHERE id = $1)").bind(&id).fetch_one(&mut *tx).await? {
            n += 1;
            id = format!("{base}_{n}");
        }
        sqlx::query(
            "INSERT INTO cosmetics (id, kind, name, source, auto, enabled, hide_locked, pos, img, mime, w, h, animated, img_at, created_at,
                                    price, in_shop, tags, stock, sale_from, sale_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15, $16, $17, $18, $19, $20)",
        )
        .bind(&id)
        .bind(kind.key())
        .bind(&name)
        .bind(&source)
        .bind(&auto)
        .bind(enabled)
        .bind(hide_locked)
        .bind(total as i32)
        .bind(&img.bytes)
        .bind(img.mime)
        .bind(img.w as i32)
        .bind(img.h as i32)
        .bind(i16::from(img.animated))
        .bind(now())
        .bind(shop.price)
        .bind(shop.in_shop)
        .bind(given_tags.clone().unwrap_or_else(|| img.colors.join(",")))
        .bind(shop.stock)
        .bind(shop.sale_from)
        .bind(shop.sale_to)
        .execute(&mut *tx)
        .await?;
        id
    } else {
        let kind: Option<String> = sqlx::query_scalar("SELECT kind FROM cosmetics WHERE id = $1").bind(&id).fetch_optional(&mut *tx).await?;
        let Some(kind) = kind.as_deref().and_then(Kind::from_key) else { return bad("Nie ma takiego kosmetyku") };
        sqlx::query(
            "UPDATE cosmetics SET name = $2, source = $3, auto = $4, enabled = $5, hide_locked = $6, price = $7, in_shop = $8, stock = $9,
                                  sale_from = $10, sale_to = $11 WHERE id = $1",
        )
        .bind(&id)
        .bind(&name)
        .bind(&source)
        .bind(&auto)
        .bind(enabled)
        .bind(hide_locked)
        .bind(shop.price)
        .bind(shop.in_shop)
        .bind(shop.stock)
        .bind(shop.sale_from)
        .bind(shop.sale_to)
        .execute(&mut *tx)
        .await?;
        if let Some(tags) = &given_tags {
            sqlx::query("UPDATE cosmetics SET tags = $2 WHERE id = $1").bind(&id).bind(tags).execute(&mut *tx).await?;
        }
        if let Some(blob) = form.upload("image") {
            let img = cosmetics::process_image(kind, blob).map_err(crate::error::AppError::bad)?;
            sqlx::query("UPDATE cosmetics SET img = $2, mime = $3, w = $4, h = $5, animated = $6, img_at = $7 WHERE id = $1")
                .bind(&id)
                .bind(&img.bytes)
                .bind(img.mime)
                .bind(img.w as i32)
                .bind(img.h as i32)
                .bind(i16::from(img.animated))
                .bind(now())
                .execute(&mut *tx)
                .await?;
            // nowa grafika = nowe kolory, chyba że admin ręcznie poprawił tagi w tym samym zapisie
            if given_tags.is_none() || field("retag") == "1" {
                sqlx::query("UPDATE cosmetics SET tags = $2 WHERE id = $1").bind(&id).bind(img.colors.join(",")).execute(&mut *tx).await?;
            }
        }
        id
    };
    log_admin(&mut tx, &me, "cosmetic_save", None, &format!("{name} ({saved_id})")).await?;
    tx.commit().await?;
    cosmetics::reload(&mut *st.db.acquire().await?).await?;
    ok(json!({"ok": true, "id": saved_id}))
}

/// Usunięcie kosmetyku: gracze, którzy go mieli założonego, wracają do standardowego wyglądu, odblokowania znikają
pub async fn admin_cosmetic_delete(State(st): State<AppState>, Admin(me): Admin, Path(id): Path<String>) -> Res {
    let mut tx = st.db.begin().await?;
    let n = sqlx::query("DELETE FROM cosmetics WHERE id = $1").bind(&id).execute(&mut *tx).await?.rows_affected();
    if n == 0 {
        return bad("Nie ma takiego kosmetyku");
    }
    sqlx::query("DELETE FROM user_cosmetics WHERE cosmetic_id = $1").bind(&id).execute(&mut *tx).await?;
    for sql in [
        "UPDATE user_profile_style SET mini_bg = '' WHERE mini_bg = $1",
        "UPDATE user_profile_style SET frame = '' WHERE frame = $1",
        "UPDATE user_profile_style SET profile_bg = '' WHERE profile_bg = $1",
        "UPDATE user_profile_style SET avatar = '' WHERE avatar = $1",
    ] {
        sqlx::query(sql).bind(&id).execute(&mut *tx).await?;
    }
    log_admin(&mut tx, &me, "cosmetic_delete", None, &id).await?;
    tx.commit().await?;
    cosmetics::reload(&mut *st.db.acquire().await?).await?;
    ok(json!({"ok": true}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct OrderRequest {
    ids: Vec<String>,
}

/// Kolejność w katalogu (pełna lista id albo jej część - reszta zostaje na końcu)
pub async fn admin_cosmetic_order(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<OrderRequest>) -> Res {
    let mut tx = st.db.begin().await?;
    for (i, id) in req.ids.iter().enumerate() {
        sqlx::query("UPDATE cosmetics SET pos = $2 WHERE id = $1").bind(id).bind(i as i32).execute(&mut *tx).await?;
    }
    log_admin(&mut tx, &me, "cosmetic_order", None, &format!("{} pozycji", req.ids.len())).await?;
    tx.commit().await?;
    cosmetics::reload(&mut *st.db.acquire().await?).await?;
    ok(json!({"ok": true}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct GrantRequest {
    username: String,
    id: String,
    /// true = odbierz kosmetyk (zdejmuje go też graczowi)
    revoke: bool,
}

/// Ręczne nadanie (albo odebranie) kosmetyku graczowi - ślad w dzienniku admina
pub async fn admin_cosmetic_grant(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<GrantRequest>) -> Res {
    let Some(item) = cosmetics::get(req.id.trim()) else { return bad("Nie ma takiego kosmetyku") };
    let mut tx = st.db.begin().await?;
    let Some(user) = find_user(&mut tx, &req.username).await? else { return bad("Nie ma takiego gracza") };
    lock_me(&mut tx, user.id).await?;
    let msg = if req.revoke {
        sqlx::query("DELETE FROM user_cosmetics WHERE user_id = $1 AND cosmetic_id = $2").bind(user.id).bind(&item.id).execute(&mut *tx).await?;
        for sql in [
            "UPDATE user_profile_style SET mini_bg = '' WHERE user_id = $1 AND mini_bg = $2",
            "UPDATE user_profile_style SET frame = '' WHERE user_id = $1 AND frame = $2",
            "UPDATE user_profile_style SET profile_bg = '' WHERE user_id = $1 AND profile_bg = $2",
            "UPDATE user_profile_style SET avatar = '' WHERE user_id = $1 AND avatar = $2",
        ] {
            sqlx::query(sql).bind(user.id).bind(&item.id).execute(&mut *tx).await?;
        }
        if item.kind == Kind::Avatar && cosmetics::avatar_url(user.id).is_some_and(|u| u == item.url()) {
            cosmetics::set_avatar(user.id, "");
        }
        format!("Odebrano „{}” graczowi {}", item.name, user.username)
    } else if cosmetics::unlock(&mut tx, user.id, &item.id, "admin").await? {
        format!("Nadano „{}” graczowi {}", item.name, user.username)
    } else {
        return bad(format!("{} ma już „{}”", user.username, item.name));
    };
    log_admin(&mut tx, &me, if req.revoke { "cosmetic_revoke" } else { "cosmetic_grant" }, Some(user.id), &format!("{} ({})", item.name, item.id)).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "message": msg}))
}
