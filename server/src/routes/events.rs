//! Eventy (src/events.rs): lista dla graczy z kalendarzem adwentowym, odbiór nagrody dnia, zakładka Eventy w panelu admina.

use std::collections::HashSet;

use axum::extract::{Path, State};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{ok, JsonBody};
use crate::achievements::grant_rewards;
use crate::auth::{Admin, Me};
use crate::catalog::Catalog;
use crate::data::g;
use crate::db::{lock_me, now};
use crate::error::{bad, Res};
use crate::events::{clean_game_events, today, GameEvent, EVENTS_ROW};
use crate::game::{get_chests, get_state, log_admin, valid_chest_kind, Ctx};
use crate::state::AppState;

/// Opis nagrody dla gracza: „Karta: Maria Skłodowska (Złota)”, „Skrzynka: Polska ×2”, „1 000 gr”
pub(super) fn reward_view(cat: &Catalog, r: &Value) -> Value {
    let s = |k: &str| r.get(k).and_then(Value::as_str).unwrap_or("");
    let n = r.get("count").and_then(Value::as_i64).unwrap_or(1);
    let times = if n > 1 { format!(" ×{n}") } else { String::new() };
    match s("type") {
        "money" => json!({"type": "money", "amount": r["amount"], "text": crate::text::fmt_money(r["amount"].as_i64().unwrap_or(0))}),
        "chest" => {
            let kind = s("kind");
            let name = g().money_kind(kind).and_then(|m| g().money_chests.get(m).map(|c| c.name.clone()))
                .or_else(|| cat.crates.get(kind).map(|c| c.name.clone()))
                .unwrap_or_else(|| kind.to_owned());
            json!({"type": "chest", "kind": kind, "count": n, "text": format!("{name}{times}")})
        }
        _ => {
            let pid = s("person");
            let v = s("variant");
            let name = cat.person(pid).map(|p| if p.is_secret() { "Tajna karta".to_owned() } else { p.name.clone() }).unwrap_or_else(|| pid.to_owned());
            let vname = if v.is_empty() || v == "normal" { String::new() } else { format!(" ({})", g().variant(v).name) };
            json!({"type": "card", "person": pid, "variant": v, "count": n, "text": format!("{name}{vname}{times}")})
        }
    }
}

/// Event dla gracza: termin, opis, warianty z dropów, kalendarz (dni minione, dziś, przyszłe; nagrody do dziś, zaległe okienka
/// można otworzyć później). `today` to „dziś” gracza (admin z datą testową ma inne), `avail` - czy kalendarz jest dla niego dostępny.
pub(super) fn event_view(cat: &Catalog, e: &GameEvent, claimed: &HashSet<(String, i32)>, today: NaiveDate, avail: bool) -> Value {
    let (start, end) = e.span();
    let start_day = NaiveDate::parse_from_str(&e.start, "%Y-%m-%d").unwrap_or(today);
    let end_day = NaiveDate::parse_from_str(&e.end, "%Y-%m-%d").unwrap_or(today);
    let running = e.enabled && start_day <= today && today <= end_day;
    let started = (today - start_day).num_days() + 1;
    let advent = e.advent.as_ref().filter(|_| avail).map(|days| {
        json!(days.iter().enumerate().map(|(i, rw)| {
            let day = i as i32 + 1;
            let open = (day as i64) <= started;   // dzień już był albo jest dziś - nagrodę widać
            let done = claimed.contains(&(e.id.clone(), day));
            json!({
                "day": day,
                "claimed": done,
                "today": running && (day as i64) == started,
                "past": (day as i64) < started,
                "claimable": running && open && !done,
                "rewards": if open { json!(rw.iter().map(|r| reward_view(cat, r)).collect::<Vec<_>>()) } else { Value::Null },
            })
        }).collect::<Vec<_>>())
    });
    json!({
        "id": e.id, "name": e.name, "desc": e.desc, "start": e.start, "end": e.end, "startsAt": start, "endsAt": end,
        "active": running,
        "drops": e.drops.iter().map(|d| json!({"variant": d.variant, "name": g().variant(&d.variant).name, "chance": d.chance})).collect::<Vec<_>>(),
        "advent": advent,
    })
}

/// Eventy widoczne dla graczy: trwające i te, które zaczną się w ciągu `UPCOMING_DAYS`
const UPCOMING_DAYS: i64 = 14;

pub async fn events_list(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let t = now() as i64;
    let mut c = st.db.acquire().await?;
    let claimed: HashSet<(String, i32)> = sqlx::query_as::<_, (String, i32)>("SELECT event_id, day FROM advent_claims WHERE user_id = $1")
        .bind(me.id)
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .collect();
    let today = super::christmas::today_for(&mut c, &me).await?;
    let mut list: Vec<Value> = Vec::new();
    for e in cat.vs.game_events.iter().filter(|e| e.enabled) {
        let (s, end) = e.span();
        let christmas = e.id == super::christmas::EVENT_ID;
        let tile = if christmas { Some(super::christmas::tile_state(&mut c, &cat, &me).await?) } else { None };
        // kalendarz świąteczny jest wyłączony dla graczy (admini widzą go zawsze, z ewentualną datą testową)
        let avail = tile.as_ref().map_or(true, |t| t["available"].as_bool() == Some(true));
        let test_in = me.admin() && s <= crate::events::day_start(today) && crate::events::day_start(today) < end;
        if !((t < end && s - UPCOMING_DAYS * 86400 <= t) || test_in) {
            continue;
        }
        let mut v = event_view(&cat, e, &claimed, today, avail);
        if let Some(tile) = tile {
            v["christmas"] = tile;
        }
        list.push(v);
    }
    ok(json!({"events": list}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct AdventRequest {
    /// numer okienka (domyślnie dzisiejsze); zaległe okienka z poprzednich dni też można otworzyć
    day: Option<i32>,
}

/// Odbiór nagrody z kalendarza adwentowego (raz na gracza i okienko): dzisiejszego albo zaległego z poprzednich dni
pub async fn advent_claim(State(st): State<AppState>, Me(me): Me, Path(id): Path<String>, JsonBody(req): JsonBody<AdventRequest>) -> Res {
    let cat = st.cat();
    let Some(e) = cat.vs.game_events.iter().find(|e| e.id == id).cloned() else { return bad("Nie ma takiego eventu") };
    let cx = Ctx::new(st.clone(), me.clone());
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if e.id == super::christmas::EVENT_ID && !super::christmas::available(&mut tx, &me).await? {
        return bad("Kalendarz adwentowy jeszcze nie jest dostępny");
    }
    let today = super::christmas::today_for(&mut tx, &me).await?;
    let Some(start) = NaiveDate::parse_from_str(&e.start, "%Y-%m-%d").ok() else { return bad("Nie ma takiego eventu") };
    let started = (today - start).num_days() + 1;
    let ended = NaiveDate::parse_from_str(&e.end, "%Y-%m-%d").is_ok_and(|end| today > end);
    let days = e.advent.as_ref().map_or(0, |d| d.len() as i64);
    if !e.enabled || started < 1 || ended || days == 0 {
        return bad("Dziś nie ma okienka do otwarcia");
    }
    let day = i64::from(req.day.unwrap_or(started.min(days) as i32));
    if day < 1 || day > days {
        return bad("Nie ma takiego okienka");
    }
    if day > started {
        return bad("To okienko jeszcze się nie otwiera");
    }
    let rewards = e.advent.as_ref().and_then(|d| d.get(day as usize - 1)).cloned().unwrap_or_default();
    let fresh = sqlx::query("INSERT INTO advent_claims (user_id, event_id, day, claimed_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING")
        .bind(me.id)
        .bind(&e.id)
        .bind(day as i32)
        .bind(now())
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if fresh == 0 {
        return bad("To okienko jest już otwarte");
    }
    let usable: Vec<Value> = rewards
        .iter()
        .filter(|r| match r.get("type").and_then(Value::as_str) {
            Some("card") => cat.has(r.get("person").and_then(Value::as_str).unwrap_or("")),
            Some("chest") => valid_chest_kind(&cat, r.get("kind").and_then(Value::as_str).unwrap_or("")),
            _ => true,
        })
        .cloned()
        .collect();
    grant_rewards(&mut tx, &cx, &usable, "advent").await?;
    let state = get_state(&mut tx, me.id).await?;
    let chests = get_chests(&mut tx, &cat, me.id).await?;
    tx.commit().await?;
    ok(json!({"day": day, "rewards": usable.iter().map(|r| reward_view(&cat, r)).collect::<Vec<_>>(), "state": state, "chests": chests}))
}

// ---------------------------------------------------------------- panel admina (zakładka Eventy)

/// Listy do formularzy nagród w panelu (Eventy, Paszport): warianty (do wyboru przy karcie), karty i skrzynki
pub(super) fn reward_options(cat: &Catalog) -> (Vec<Value>, Vec<Value>, Vec<Value>) {
    let g = g();
    let variants: Vec<Value> = g
        .variant_order
        .iter()
        .filter(|v| *v != "normal" && !g.variants[*v].combo && !g.variants[*v].special && !g.variants[*v].always)
        .map(|v| json!({"key": v, "name": g.variants[v].name, "chance": g.variants[v].chance, "enabled": cat.variant_enabled(v)}))
        .collect();
    let mut cards: Vec<Value> =
        cat.people.values().filter(|p| !p.is_special()).map(|p| json!({"id": p.id, "name": p.name, "rarity": p.rarity})).collect();
    cards.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    let mut chests: Vec<Value> = g.money_chests.iter().map(|(k, c)| json!({"kind": format!("money_{k}"), "name": c.name})).collect();
    chests.extend(cat.crates.values().filter(|c| !c.special).map(|c| json!({"kind": c.id, "name": c.name})));
    (variants, cards, chests)
}


/// Eventy (pełne) i listy do formularza: warianty, karty, skrzynki
pub async fn admin_events(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let cat = st.cat();
    let (variants, cards, chests) = reward_options(&cat);
    let mut c = st.db.acquire().await?;
    let claims: Vec<(String, i64)> =
        sqlx::query_as("SELECT event_id, COUNT(*) FROM advent_claims GROUP BY event_id").fetch_all(&mut *c).await?;
    ok(json!({
        "events": cat.vs.game_events,
        "variants": variants, "cards": cards, "chests": chests,
        "claims": claims.into_iter().map(|(e, n)| (e, json!(n))).collect::<serde_json::Map<_, _>>(),
        "today": today().format("%Y-%m-%d").to_string(),
    }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct EventsSave {
    events: Value,
    /// true = wróć do eventów z game.json
    reset: bool,
}

pub async fn admin_events_save(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<EventsSave>) -> Res {
    let mut tx = st.db.begin().await?;
    let details = if req.reset {
        sqlx::query("DELETE FROM catalog_variants WHERE id = $1").bind(EVENTS_ROW).execute(&mut *tx).await?;
        "domyślne eventy".to_owned()
    } else {
        let list = clean_game_events(&req.events);
        let data = json!({"gameEvents": list}).to_string();
        sqlx::query(
            "INSERT INTO catalog_variants (id, data, deleted) VALUES ($1, $2, 0) ON CONFLICT(id) DO UPDATE SET data = excluded.data, deleted = 0",
        )
        .bind(EVENTS_ROW)
        .bind(data)
        .execute(&mut *tx)
        .await?;
        list.iter().map(|e| format!("{} {}–{}{}", e.name, e.start, e.end, if e.enabled { "" } else { " (wył.)" })).collect::<Vec<_>>().join(", ")
    };
    log_admin(&mut tx, &me, "events_save", None, &details).await?;
    tx.commit().await?;
    st.refresh_catalog().await?;
    ok(json!({"ok": true, "events": st.cat().vs.game_events}))
}
