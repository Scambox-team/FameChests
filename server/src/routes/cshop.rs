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
    let cfg = &crate::data::g().euro;
    let showcase = json!({"base": crate::data::g().showcase_size, "extra": extra, "max": cfg.showcase_max_extra, "price": cfg.showcase_price(extra)});
    ok(json!({"euro": euro, "admin": admin, "items": items, "colors": super::cosmetics::colors_json(), "kinds": kinds(), "showcase": showcase,
        "stickerCrates": stcrates, "stickers": stickers}))
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

/// Dodatkowe miejsce w gablocie za euro (cena rośnie z każdym kupionym: `EuroCfg::showcase_price`, najwyżej `showcase_max_extra`)
pub async fn shop_showcase_buy(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let state = get_state(&mut tx, me.id).await?;
    let extra = state.get("showcase_extra").copied().unwrap_or(0);
    let Some(price) = crate::data::g().euro.showcase_price(extra) else { return bad("Masz już wszystkie dodatkowe miejsca w gablocie") };
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
