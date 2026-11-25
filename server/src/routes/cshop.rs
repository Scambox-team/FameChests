//! Sklep z kosmetykami (zakładka „Sklep”, `/sklep`): kosmetyki profilu (src/cosmetics.rs) za euro.
//!
//! - Każdy kosmetyk jest w sklepie, chyba że admin odznaczył „W sklepie” (zdobywa się go inaczej: quest, event, osiągnięcie, level...).
//!   Takie pozycje - i wyłączone albo poza terminem - widzi TYLKO admin, z wyraźnym oznaczeniem, i tylko on może je kupić (testy, jak skrzynki).
//! - Cena w euro (ustawia admin), tagi koloru (wykrywane z grafiki, admin poprawia), opcjonalny limit sztuk (`stock`, licznik `sold`) i okno
//!   sprzedaży (`sale_from` / `sale_to`) dla pozycji specjalnych; domyślnie bez ograniczeń.
//! - Zakup: `lock_me`, sprawdzenie (`cosmetics::purchase_problem`), zajęcie sztuki atomowym `UPDATE ... WHERE sold < stock`, odjęcie euro,
//!   odblokowanie (`cosmetics::unlock`, źródło `shop`). Nie da się kupić dwa razy tego samego.

use axum::extract::State;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{ok, JsonBody};
use crate::auth::Me;
use crate::cosmetics::{self, Avail};
use crate::db::{lock_me, now};
use crate::error::{bad, Res};
use crate::game::{add_euro, get_state};
use crate::state::AppState;

fn euro_of(state: &crate::game::GameState) -> i64 {
    state.get("euro").copied().unwrap_or(0)
}

pub async fn shop_cosmetics(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    let have = cosmetics::unlocked_of(&mut c, me.id).await?;
    let euro = euro_of(&get_state(&mut c, me.id).await?);
    let sold: std::collections::HashMap<String, i64> = sqlx::query_as::<_, (String, i32)>("SELECT id, sold FROM cosmetics")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .map(|(id, n)| (id, i64::from(n)))
        .collect();
    let t = now();
    let admin = me.admin();
    let items: Vec<Value> = cosmetics::list()
        .iter()
        .filter_map(|x| {
            let sold = sold.get(&x.id).copied().unwrap_or(0);
            let avail = cosmetics::availability(x, t, sold);
            let owned = have.contains(&x.id);
            // gracz widzi: dostępne, wyprzedane i te, których sprzedaż się jeszcze nie zaczęła; admin wszystko (z oznaczeniem)
            let shown = matches!(avail, Avail::Open | Avail::SoldOut | Avail::NotYet);
            if !shown && !admin {
                return None;
            }
            let problem = cosmetics::purchase_problem(x, avail, admin, owned, euro);
            let mut v = x.view();
            v["price"] = json!(x.price);
            v["tags"] = json!(x.tags);
            v["owned"] = json!(owned);
            v["avail"] = json!(avail.key());
            v["stock"] = json!(x.stock);
            v["left"] = json!(x.stock.map(|s| (i64::from(s) - sold).max(0)));
            v["saleFrom"] = json!(x.sale_from);
            v["saleTo"] = json!(x.sale_to);
            v["canBuy"] = json!(problem.is_none());
            v["problem"] = json!(problem);
            Some(v)
        })
        .collect();
    let (stcrates, stickers) = sticker_listing(&mut c, admin).await?;
    let extra = get_state(&mut c, me.id).await?.get("showcase_extra").copied().unwrap_or(0);
    let cfg = showcase_cfg();
    let showcase = json!({"base": crate::data::g().showcase_size, "extra": extra, "max": cfg.max, "price": cfg.price_for(extra)});
    ok(json!({"euro": euro, "admin": admin, "items": items, "colors": super::cosmetics::colors_json(), "kinds": kinds(), "showcase": showcase,
        "stickerCrates": stcrates, "stickers": stickers}))
}

// ---------------------------------------------------------------- ceny dodatkowych miejsc w gablocie (panel admina)

/// Ustawienia cen miejsc w gablocie: pierwsze kosztuje `price`, każde następne o `step` więcej, najwyżej `max` dodatkowych.
/// Domyślne z game.json (`euro`), nadpisane w tabeli `state` (klucze `showcase_slot_*`), trzymane w pamięci procesu jak `exp::config()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShowcaseCfg {
    pub price: i64,
    pub step: i64,
    pub max: i64,
}

pub const SHOWCASE_PRICE_MAX: i64 = 1_000_000;
pub const SHOWCASE_STEP_MAX: i64 = 1_000_000;
pub const SHOWCASE_MAX_LIMIT: i64 = 100;
const SHOWCASE_KEYS: [&str; 3] = ["showcase_slot_price", "showcase_slot_step", "showcase_slot_max"];

impl ShowcaseCfg {
    /// Cena następnego miejsca przy `extra` już kupionych (None = kupiono maksimum)
    pub fn price_for(&self, extra: i64) -> Option<i64> {
        (extra >= 0 && extra < self.max).then(|| self.price + self.step * extra)
    }

    /// Cena każdego z kolejnych miejsc (1., 2., ... do `max`) - podgląd w panelu
    pub fn table(&self) -> Vec<i64> {
        (0..self.max).filter_map(|i| self.price_for(i)).collect()
    }

    pub fn check(&self) -> Result<(), crate::error::AppError> {
        use crate::error::AppError;
        if !(0..=SHOWCASE_PRICE_MAX).contains(&self.price) {
            return Err(AppError::bad(format!("Cena pierwszego miejsca: od 0 do {SHOWCASE_PRICE_MAX} euro")));
        }
        if !(0..=SHOWCASE_STEP_MAX).contains(&self.step) {
            return Err(AppError::bad(format!("Podwyżka za kolejne miejsce: od 0 do {SHOWCASE_STEP_MAX} euro")));
        }
        if !(0..=SHOWCASE_MAX_LIMIT).contains(&self.max) {
            return Err(AppError::bad(format!("Najwyżej dodatkowych miejsc: od 0 do {SHOWCASE_MAX_LIMIT}")));
        }
        Ok(())
    }
}

fn showcase_default() -> ShowcaseCfg {
    let e = &crate::data::g().euro;
    ShowcaseCfg { price: e.showcase_slot_price, step: e.showcase_slot_step, max: e.showcase_max_extra }
}

static SHOWCASE: std::sync::LazyLock<parking_lot::RwLock<ShowcaseCfg>> = std::sync::LazyLock::new(|| parking_lot::RwLock::new(showcase_default()));

/// Aktualne ustawienia (domyślne z game.json albo zapisane w panelu)
pub fn showcase_cfg() -> ShowcaseCfg {
    *SHOWCASE.read()
}

/// Wczytuje ustawienia z bazy do pamięci procesu (start serwera, zapis z panelu); pole bez wiersza = wartość domyślna
pub async fn load_showcase(c: &mut crate::db::Conn) -> sqlx::Result<ShowcaseCfg> {
    let rows: Vec<(String, i64)> = sqlx::query_as("SELECT key, value FROM state WHERE key = ANY($1)").bind(&SHOWCASE_KEYS[..]).fetch_all(&mut *c).await?;
    let get = |k: &str| rows.iter().find(|(key, _)| key == k).map(|(_, v)| *v);
    let d = showcase_default();
    let cfg = ShowcaseCfg {
        price: get(SHOWCASE_KEYS[0]).unwrap_or(d.price),
        step: get(SHOWCASE_KEYS[1]).unwrap_or(d.step),
        max: get(SHOWCASE_KEYS[2]).unwrap_or(d.max),
    };
    // wiersz spoza zakresu (ręczna zmiana bazy) nie może zepsuć sklepu
    let cfg = if cfg.check().is_ok() { cfg } else { d };
    *SHOWCASE.write() = cfg;
    Ok(cfg)
}

pub fn showcase_json(extra: Option<i64>) -> Value {
    let cfg = showcase_cfg();
    let d = showcase_default();
    let mut v = json!({"price": cfg.price, "step": cfg.step, "max": cfg.max, "table": cfg.table(),
                       "default": {"price": d.price, "step": d.step, "max": d.max}, "custom": cfg != d});
    if let Some(e) = extra {
        v["next"] = json!(cfg.price_for(e));
    }
    v
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ShowcaseRequest {
    price: i64,
    step: i64,
    max: i64,
}

/// Panel admina: ustawia ceny dodatkowych miejsc w gablocie (pierwsze, podwyżka za każde kolejne, maksimum)
pub async fn admin_showcase_save(State(st): State<AppState>, crate::auth::Admin(me): crate::auth::Admin, JsonBody(req): JsonBody<ShowcaseRequest>) -> Res {
    let cfg = ShowcaseCfg { price: req.price, step: req.step, max: req.max };
    cfg.check()?;
    let mut tx = st.db.begin().await?;
    for (k, v) in SHOWCASE_KEYS.iter().zip([cfg.price, cfg.step, cfg.max]) {
        sqlx::query("INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(k).bind(v).execute(&mut *tx).await?;
    }
    crate::game::log_admin(&mut tx, &me, "showcase_prices", None, &format!("pierwsze {} euro, +{} za każde następne, najwyżej {}", cfg.price, cfg.step, cfg.max)).await?;
    tx.commit().await?;
    load_showcase(&mut *st.db.acquire().await?).await?;
    ok(json!({"ok": true, "showcase": showcase_json(None)}))
}

/// Przywraca ceny z game.json (usuwa wiersze z `state`)
pub async fn admin_showcase_reset(State(st): State<AppState>, crate::auth::Admin(me): crate::auth::Admin) -> Res {
    let mut tx = st.db.begin().await?;
    sqlx::query("DELETE FROM state WHERE key = ANY($1)").bind(&SHOWCASE_KEYS[..]).execute(&mut *tx).await?;
    crate::game::log_admin(&mut tx, &me, "showcase_prices", None, "przywrócono domyślne").await?;
    tx.commit().await?;
    load_showcase(&mut *st.db.acquire().await?).await?;
    ok(json!({"ok": true, "showcase": showcase_json(None)}))
}

/// Naklejki w Sklepie: skrzynki z naklejkami (cena i flaga „W sklepie” w `sticker_crates`) i pojedyncze naklejki w wybranym wariancie
/// (`sticker_offers`). Gracz widzi tylko to, co jest w sklepie i dostępne; admin też ukryte (z oznaczeniem) i może je kupić (testy).
async fn sticker_listing(c: &mut crate::db::Conn, admin: bool) -> sqlx::Result<(Vec<Value>, Vec<Value>)> {
    let shop: std::collections::HashMap<String, (i64, i16)> = sqlx::query_as::<_, (String, i64, i16)>("SELECT id, price, in_shop FROM sticker_crates")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .map(|(id, p, s)| (id, (p, s)))
        .collect();
    let crates: Vec<Value> = crate::stickers::crates()
        .iter()
        .filter_map(|cr| {
            let (price, in_shop) = shop.get(&cr.id).copied().unwrap_or((600, 1));
            let hidden = in_shop == 0;
            (!hidden || admin).then(|| {
                json!({"id": cr.id, "kind": cr.kind(), "name": cr.name, "emoji": cr.emoji, "color1": cr.color1, "color2": cr.color2, "desc": cr.desc,
                       "price": price, "avail": if hidden { "hidden" } else { "open" }, "canBuy": price > 0, "weights": cr.weights_json()})
            })
        })
        .collect();
    type Row = (i64, String, String, i64, i16, Option<i32>, i32, String, String, i16, f64);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT o.id, o.sticker_id, o.variant, o.price, o.enabled, o.stock, o.sold, s.name, s.rarity, s.enabled, s.img_at \
         FROM sticker_offers o JOIN stickers s ON s.id = o.sticker_id ORDER BY o.pos, o.id",
    )
    .fetch_all(c)
    .await?;
    let stickers: Vec<Value> = rows
        .into_iter()
        .filter_map(|(id, sticker, variant, price, enabled, stock, sold, name, rarity, s_enabled, img_at)| {
            let sold_out = stock.is_some_and(|s| sold >= s);
            let hidden = enabled == 0 || s_enabled == 0;
            if (hidden || sold_out) && !admin && !sold_out {
                return None;
            }
            let avail = if sold_out { "soldout" } else if hidden { "hidden" } else { "open" };
            Some(json!({"id": id, "sticker": sticker, "variant": variant, "price": price, "name": name, "rarity": rarity, "v": img_at as i64,
                        "stock": stock, "left": stock.map(|s| (s - sold).max(0)), "avail": avail, "canBuy": !sold_out}))
        })
        .collect();
    Ok((crates, stickers))
}

fn kinds() -> Value {
    Value::Array(cosmetics::KINDS.iter().map(|k| json!({"key": k.key(), "label": k.label()})).collect())
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct BuyRequest {
    id: String,
}

pub async fn shop_cosmetic_buy(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<BuyRequest>) -> Res {
    let Some(item) = cosmetics::get(req.id.trim()) else { return bad("Nie ma takiego kosmetyku") };
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let have = cosmetics::unlocked_of(&mut tx, me.id).await?;
    let euro = euro_of(&get_state(&mut tx, me.id).await?);
    let sold: i32 = sqlx::query_scalar("SELECT sold FROM cosmetics WHERE id = $1").bind(&item.id).fetch_optional(&mut *tx).await?.unwrap_or(0);
    let avail = cosmetics::availability(&item, now(), i64::from(sold));
    if let Some(why) = cosmetics::purchase_problem(&item, avail, me.admin(), have.contains(&item.id), euro) {
        return bad(why);
    }
    // sztuka z limitu: zajmuje ją tylko jedno zapytanie, nawet gdy dwóch graczy kupuje ostatnią naraz
    let claimed = sqlx::query("UPDATE cosmetics SET sold = sold + 1 WHERE id = $1 AND (stock IS NULL OR sold < stock)")
        .bind(&item.id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if claimed == 0 {
        return bad("Ten kosmetyk jest wyprzedany");
    }
    add_euro(&mut tx, me.id, -item.price).await?;
    cosmetics::unlock(&mut tx, me.id, &item.id, "shop").await?;
    let state = get_state(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "id": item.id, "name": item.name, "state": state}))
}

/// Dodatkowe miejsce w gablocie za euro (cena rośnie z każdym kupionym: `ShowcaseCfg::price_for`, ustawienia z panelu admina albo game.json)
pub async fn shop_showcase_buy(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let state = get_state(&mut tx, me.id).await?;
    let extra = state.get("showcase_extra").copied().unwrap_or(0);
    let Some(price) = showcase_cfg().price_for(extra) else { return bad("Masz już wszystkie dodatkowe miejsca w gablocie") };
    if euro_of(&state) < price {
        return bad("Za mało euro");
    }
    add_euro(&mut tx, me.id, -price).await?;
    crate::game::add_state(&mut tx, me.id, "showcase_extra", 1).await?;
    let state = get_state(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "paid": price, "state": state}))
}

#[cfg(test)]
mod tests {
    use crate::data::g;

    #[test]
    fn showcase_slot_prices_grow_and_stop_at_max() {
        let c = &g().euro;
        assert_eq!(c.showcase_price(0), Some(c.showcase_slot_price));
        assert_eq!(c.showcase_price(1), Some(c.showcase_slot_price + c.showcase_slot_step));
        assert!(c.showcase_price(c.showcase_max_extra - 1).is_some());
        assert_eq!(c.showcase_price(c.showcase_max_extra), None);
        assert_eq!(c.showcase_price(-1), None);
    }

    #[test]
    fn overridden_showcase_prices_follow_the_settings() {
        let c = super::ShowcaseCfg { price: 100, step: 40, max: 3 };
        assert_eq!(c.table(), vec![100, 140, 180]);
        assert_eq!(c.price_for(2), Some(180));
        assert_eq!(c.price_for(3), None);
        assert_eq!(c.price_for(-1), None);
        assert_eq!(super::ShowcaseCfg { price: 50, step: 0, max: 2 }.table(), vec![50, 50]);
        assert!(super::ShowcaseCfg { price: 0, step: 0, max: 0 }.table().is_empty());
        assert!(c.check().is_ok());
        assert!(super::ShowcaseCfg { price: -1, ..c }.check().is_err());
        assert!(super::ShowcaseCfg { step: -5, ..c }.check().is_err());
        assert!(super::ShowcaseCfg { max: super::SHOWCASE_MAX_LIMIT + 1, ..c }.check().is_err());
        assert!(super::ShowcaseCfg { price: super::SHOWCASE_PRICE_MAX + 1, ..c }.check().is_err());
    }

    #[test]
    fn default_settings_match_game_json() {
        let d = super::showcase_default();
        let e = &g().euro;
        assert_eq!(d.price_for(1), e.showcase_price(1));
        assert!(d.check().is_ok());
        assert!(d.step > 0, "każde kolejne miejsce ma być droższe");
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct StickerCrateBuy {
    id: String,
    count: i64,
}

/// Skrzynka z naklejkami za euro (domyślny sposób zdobycia): trafia do ekwipunku jak każda skrzynka i otwiera się stamtąd.
/// Ukryta (odznaczone „W sklepie”) - tylko dla admina.
pub async fn shop_sticker_crate_buy(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<StickerCrateBuy>) -> Res {
    let count = req.count.clamp(1, 20);
    let Some(cr) = crate::stickers::crates().iter().find(|c| c.id == req.id).cloned() else { return bad("Nie ma takiej skrzynki") };
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let (price, in_shop): (i64, i16) = sqlx::query_as("SELECT price, in_shop FROM sticker_crates WHERE id = $1").bind(&cr.id).fetch_one(&mut *tx).await?;
    if price <= 0 {
        return bad("Ta skrzynka nie ma jeszcze ceny");
    }
    if in_shop == 0 && !me.admin() {
        return bad("Tej skrzynki nie ma w sklepie");
    }
    let total = price * count;
    if euro_of(&get_state(&mut tx, me.id).await?) < total {
        return bad("Za mało euro");
    }
    add_euro(&mut tx, me.id, -total).await?;
    crate::game::add_chests(&mut tx, me.id, &cr.kind(), count).await?;
    let state = get_state(&mut tx, me.id).await?;
    let chests = crate::game::get_chests(&mut tx, &st.cat(), me.id).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "name": cr.name, "count": count, "paid": total, "state": state, "chests": chests}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct StickerBuy {
    /// numer oferty (`sticker_offers.id`)
    id: i64,
}

/// Pojedyncza naklejka w konkretnym wariancie z oferty admina: trafia do ekwipunku naklejek (nakleja się ją na kartę jak każdą inną)
pub async fn shop_sticker_buy(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<StickerBuy>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    type Row = (String, String, i64, i16, Option<i32>, i32, String, i16);
    let row: Option<Row> = sqlx::query_as(
        "SELECT o.sticker_id, o.variant, o.price, o.enabled, o.stock, o.sold, s.name, s.enabled FROM sticker_offers o JOIN stickers s ON s.id = o.sticker_id WHERE o.id = $1",
    )
    .bind(req.id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((sticker, variant, price, enabled, stock, sold, name, s_enabled)) = row else { return bad("Tej oferty już nie ma") };
    if stock.is_some_and(|s| sold >= s) {
        return bad("Ta naklejka jest wyprzedana");
    }
    if (enabled == 0 || s_enabled == 0) && !me.admin() {
        return bad("Tej naklejki nie ma w sklepie");
    }
    if euro_of(&get_state(&mut tx, me.id).await?) < price {
        return bad("Za mało euro");
    }
    // sztuka z limitu: zajmuje ją tylko jedno zapytanie
    let claimed = sqlx::query("UPDATE sticker_offers SET sold = sold + 1 WHERE id = $1 AND (stock IS NULL OR sold < stock)").bind(req.id).execute(&mut *tx).await?.rows_affected();
    if claimed == 0 {
        return bad("Ta naklejka jest wyprzedana");
    }
    add_euro(&mut tx, me.id, -price).await?;
    sqlx::query("INSERT INTO sticker_items (user_id, sticker_id, variant, created_at) VALUES ($1, $2, $3, $4)")
        .bind(me.id)
        .bind(&sticker)
        .bind(&variant)
        .bind(now())
        .execute(&mut *tx)
        .await?;
    let state = get_state(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "name": name, "variant": variant, "paid": price, "state": state}))
}
