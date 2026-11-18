//! Skarbonka (zakładka Questy, quest główny; domyślnie wyłączona, włącza admin: panel -> Questy): wspólny cel wszystkich graczy
//! na jedną dobę (od północy do północy, czas serwera). Każdego dnia losuje się zadanie (`KINDS`: otwieranie skrzynek, gra w
//! kasynie, wygrane w kasynie, zarobek w grach albo wszystko naraz) i rzadkość nagrody (`RARITIES`). Wszystko liczy się
//! w PIENIĄDZACH (grosze): skrzynka = jej cena, kasyno = wartość postawionych kart (wygrana liczy się podwójnie w „wszystko”),
//! gry = grosze, jakie gra przyznała za wynik (przed limitem dnia). Cel = `piggy_base` × trudność zadania × mnożnik rzadkości,
//! więc trudniejsze zadanie i lepsza nagroda = wyższy cel w złotówkach wkładu, ale mniej „pracy” przy trudnym zadaniu.
//!
//! Po zapełnieniu świnka jest pełna, a gracze muszą ją RAZEM rozbić: `need_hits` kliknięć od co najmniej `min_breakers` różnych
//! osób (`/api/piggy/hit`). Rozbicie (albo północ, jeśli nikt nie rozbił pełnej świnki) rozdaje nagrody: każdy z wkładem dostaje
//! kartę tej samej rzadkości; miejsca 1-3 w wariantach banknotów 500 / 200 / 100 zł, pozostali w wariancie 50 zł (`PLACES`).
//! Niezapełniona do północy świnka przepada. Tabele: `piggy_quests` (doba), `piggy_contrib` (wkład gracza, kliknięcia, nagroda).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Instant;

use axum::extract::State;
use chrono::{Local, TimeZone};
use rand::seq::SliceRandom;
use rand::Rng;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{ok, JsonBody};
use crate::auth::{Admin, Me};
use crate::catalog::Catalog;
use crate::data::{g, CardTier};
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, Res};
use crate::game::{insert_for, log_admin};
use crate::state::AppState;

/// warianty nagród: miejsca 1, 2, 3 i reszta uczestników
pub const PLACES: [&str; 4] = ["banknote500", "banknote200", "banknote100", "banknote50"];

/// Zadanie: (klucz, tytuł, opis, trudność = mnożnik celu; trudniejsze zadanie = niższy cel w złotówkach)
pub const KINDS: &[(&str, &str, &str, f64)] = &[
    ("crates", "Otwierajcie skrzynki", "Liczy się cena każdej otwartej skrzynki.", 1.0),
    ("casino_play", "Grajcie w kasynie", "Liczy się wartość kart postawionych w każdej grze w kasynie.", 1.0),
    ("casino_win", "Wygrywajcie w kasynie", "Liczy się tylko wartość kart postawionych w WYGRANYCH grach.", 0.45),
    ("games", "Zarabiajcie w grach", "Liczą się grosze zdobyte za wynik w grach (Snake, Pinball, Super Turbo, Obrona Orbity).", 0.03),
    ("all", "Wszystko się liczy", "Skrzynki, kasyno (wygrane podwójnie) i grosze z gier - wszystko naraz.", 1.6),
];
/// Rzadkość nagrody: (rzadkość, mnożnik celu, waga losowania)
pub const RARITIES: &[(&str, f64, u32)] = &[("blue", 0.7, 30), ("purple", 1.0, 40), ("red", 1.5, 22), ("gold", 2.5, 8)];

/// Ustawienia w tabeli `state`: (klucz, pole w panelu, domyślna, najmniejsza, największa)
const SETTINGS: &[(&str, &str, i64, i64, i64)] = &[
    ("piggy_enabled", "enabled", 0, 0, 1),
    ("piggy_base", "base", 10_000_000, 1_000, 100_000_000_000),
    ("piggy_hits", "hits", 60, 1, 100_000),
    ("piggy_breakers", "breakers", 3, 1, 100),
];

/// Zdarzenie, które może wpłacić do świnki
pub enum Ev {
    /// otwarte skrzynki: łączna cena (gr)
    Crates(i64),
    /// gra w kasynie: wartość postawionych kart (gr) i czy wygrana
    Casino { stake: i64, won: bool },
    /// grosze przyznane za wynik w grze (przed limitem dnia)
    Game(i64),
}

impl Ev {
    /// Wkład w groszach przy danym zadaniu (0 = nie liczy się)
    fn value(&self, kind: &str) -> i64 {
        match (self, kind) {
            (Ev::Crates(v), "crates" | "all") => *v,
            (Ev::Casino { stake, .. }, "casino_play") => *stake,
            (Ev::Casino { stake, won: true }, "casino_win") => *stake,
            (Ev::Casino { stake, won }, "all") => stake * if *won { 2 } else { 1 },
            (Ev::Game(v), "games" | "all") => *v,
            _ => 0,
        }
        .max(0)
    }
}

async fn setting(c: &mut Conn, key: &str) -> sqlx::Result<i64> {
    let (_, _, default, lo, hi) = SETTINGS.iter().find(|s| s.0 == key).copied().unwrap_or(("", "", 0, 0, 0));
    Ok(super::snake::setting(c, key, default).await?.clamp(lo, hi))
}

/// Doba questa: data (RRRR-MM-DD) i jej granice w sekundach (północ czasu serwera)
fn day_bounds() -> (String, f64, f64) {
    let today = Local::now().date_naive();
    let at = |d: chrono::NaiveDate| {
        Local.from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap_or_default()).earliest().map_or(0.0, |t| t.timestamp() as f64)
    };
    (today.to_string(), at(today), at(today.succ_opt().unwrap_or(today)))
}

pub fn target_for(base: i64, kind: &str, rarity: &str) -> i64 {
    let k = KINDS.iter().find(|x| x.0 == kind).map_or(1.0, |x| x.3);
    let r = RARITIES.iter().find(|x| x.0 == rarity).map_or(1.0, |x| x.1);
    (((base as f64 * k * r) / 1000.0).round() as i64 * 1000).max(1000)
}

/// Mnożniki celu ustawiane w panelu admina (w procentach, klucze `piggy_k_<zadanie>` / `piggy_r_<rzadkość>`; domyślne z `KINDS` / `RARITIES`)
pub struct Mults {
    kinds: Vec<(&'static str, i64)>,
    rarities: Vec<(&'static str, i64)>,
}

pub const PCT_MAX: i64 = 100_000;

impl Mults {
    fn target(&self, base: i64, kind: &str, rarity: &str) -> i64 {
        let k = self.kinds.iter().find(|x| x.0 == kind).map_or(100, |x| x.1) as f64 / 100.0;
        let r = self.rarities.iter().find(|x| x.0 == rarity).map_or(100, |x| x.1) as f64 / 100.0;
        (((base as f64 * k * r) / 1000.0).round() as i64 * 1000).max(1000)
    }
}

async fn mults(c: &mut Conn) -> sqlx::Result<Mults> {
    let mut m = Mults { kinds: Vec::new(), rarities: Vec::new() };
    for k in KINDS {
        let v = super::snake::setting(c, &format!("piggy_k_{}", k.0), (k.3 * 100.0).round() as i64).await?;
        m.kinds.push((k.0, v.clamp(1, PCT_MAX)));
    }
    for r in RARITIES {
        let v = super::snake::setting(c, &format!("piggy_r_{}", r.0), (r.1 * 100.0).round() as i64).await?;
        m.rarities.push((r.0, v.clamp(1, PCT_MAX)));
    }
    Ok(m)
}

#[derive(Clone, sqlx::FromRow)]
struct Quest {
    day: String,
    kind: String,
    rarity: String,
    target: i64,
    total: i64,
    starts_at: f64,
    ends_at: f64,
    filled_at: f64,
    broken_at: f64,
    hits: i64,
    need_hits: i64,
    min_breakers: i64,
}

/// Dzisiejszy quest w pamięci (żeby każde otwarcie skrzynki nie pytało bazy): (dzień, quest albo None = wyłączony / brak)
static CACHE: LazyLock<Mutex<Option<(String, Option<(String, i64)>)>>> = LazyLock::new(Default::default);

fn forget_cache() {
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

async fn load(c: &mut Conn, day: &str) -> sqlx::Result<Option<Quest>> {
    sqlx::query_as("SELECT * FROM piggy_quests WHERE day = $1").bind(day).fetch_optional(c).await
}

/// Dzisiejszy quest; tworzy go, jeśli skarbonka jest włączona, a dziś jeszcze nikt nie pytał
async fn today(c: &mut Conn) -> sqlx::Result<Option<Quest>> {
    let (day, start, end) = day_bounds();
    if let Some(q) = load(c, &day).await? {
        return Ok(Some(q));
    }
    if setting(c, "piggy_enabled").await? == 0 {
        return Ok(None);
    }
    let (kind, rarity) = {
        let mut rng = rand::thread_rng();
        let kind = KINDS.choose(&mut rng).map_or("crates", |k| k.0);
        let total: u32 = RARITIES.iter().map(|r| r.2).sum();
        let mut roll = rng.gen_range(0..total);
        let rarity = RARITIES.iter().find(|r| if roll < r.2 { true } else { roll -= r.2; false }).map_or("purple", |r| r.0);
        (kind, rarity)
    };
    let target = mults(c).await?.target(setting(c, "piggy_base").await?, kind, rarity);
    let (need_hits, min_breakers) = (setting(c, "piggy_hits").await?, setting(c, "piggy_breakers").await?);
    sqlx::query(
        "INSERT INTO piggy_quests (day, kind, rarity, target, starts_at, ends_at, need_hits, min_breakers) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (day) DO NOTHING",
    )
    .bind(&day)
    .bind(kind)
    .bind(rarity)
    .bind(target)
    .bind(start)
    .bind(end)
    .bind(need_hits)
    .bind(min_breakers)
    .execute(&mut *c)
    .await?;
    forget_cache();
    load(c, &day).await
}

/// Wpłata do dzisiejszej świnki (woła się w transakcji zdarzenia: skrzynki, kasyno, gry). Konto 0 / ujemne = pomijane.
pub async fn add(c: &mut Conn, uid: i64, ev: Ev) -> sqlx::Result<()> {
    if uid <= 0 {
        return Ok(());
    }
    let (day, _, _) = day_bounds();
    let cached = CACHE.lock().unwrap_or_else(|e| e.into_inner()).clone().filter(|(d, _)| *d == day);
    let info = match cached {
        Some((_, info)) => info,
        None => {
            let info = today(c).await?.filter(|q| q.broken_at == 0.0).map(|q| (q.kind, q.target));
            *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some((day.clone(), info.clone()));
            info
        }
    };
    let Some((kind, _)) = info else { return Ok(()) };
    let v = ev.value(&kind);
    if v <= 0 {
        return Ok(());
    }
    // świnka rozbita = zamknięta (rozbicie czyści pamięć podręczną)
    let filled: Option<(i64, i64, f64)> = sqlx::query_as(
        "UPDATE piggy_quests SET total = total + $2 WHERE day = $1 AND broken_at = 0 RETURNING total, target, filled_at",
    )
    .bind(&day)
    .bind(v)
    .fetch_optional(&mut *c)
    .await?;
    let Some((total, target, filled_at)) = filled else { return Ok(()) };
    let t = now();
    sqlx::query(
        "INSERT INTO piggy_contrib (day, user_id, amount, first_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (day, user_id) DO UPDATE SET amount = piggy_contrib.amount + excluded.amount",
    )
    .bind(&day)
    .bind(uid)
    .bind(v)
    .bind(t)
    .execute(&mut *c)
    .await?;
    if total >= target && filled_at == 0.0 {
        sqlx::query("UPDATE piggy_quests SET filled_at = $2 WHERE day = $1 AND filled_at = 0").bind(&day).bind(t).execute(&mut *c).await?;
    }
    Ok(())
}

/// Rozbicie: karty dla wszystkich z wkładem (miejsca 1-3 w lepszych banknotach). Wołać pod blokadą wiersza questa.
async fn settle(c: &mut Conn, cat: &Catalog, q: &Quest) -> sqlx::Result<()> {
    let rows: Vec<(i64, i64, bool)> = sqlx::query_as(
        "SELECT p.user_id, p.amount, (u.banned <> 0 OR u.ranking_hidden <> 0 OR u.money_generated <> 0)
         FROM piggy_contrib p JOIN users u ON u.id = p.user_id
         WHERE p.day = $1 AND p.amount > 0 ORDER BY p.amount DESC, p.first_at ASC",
    )
    .bind(&q.day)
    .fetch_all(&mut *c)
    .await?;
    let tiers = [CardTier { score: 0, rarity: q.rarity.clone() }];
    let mut place = 0usize;
    for (uid, _, hidden) in rows {
        // gracze poza rankingiem (admin, testy) dostają kartę, ale nie zajmują miejsc 1-3
        let slot = if hidden { 3 } else { place.min(3) };
        if !hidden {
            place += 1;
        }
        let Some(pid) = super::pinball::pick_card(cat, &tiers, 0) else { continue };
        let item = insert_for(c, cat, uid, hidden, &pid, PLACES[slot], "piggy").await?;
        sqlx::query("UPDATE piggy_contrib SET place = $3, item_id = $4, person_id = $5, variant = $6 WHERE day = $1 AND user_id = $2")
            .bind(&q.day)
            .bind(uid)
            .bind(if hidden { 0 } else { place as i32 })
            .bind(item.id)
            .bind(&pid)
            .bind(PLACES[slot])
            .execute(&mut *c)
            .await?;
    }
    Ok(())
}

/// Zaległe doby: pełna, nierozbita świnka z poprzednich dni rozbija się sama (nagrody nie przepadają)
async fn settle_old(c: &mut Conn, cat: &Catalog) -> sqlx::Result<()> {
    let (day, _, _) = day_bounds();
    let old: Vec<String> =
        sqlx::query_scalar("SELECT day FROM piggy_quests WHERE day < $1 AND filled_at > 0 AND broken_at = 0").bind(&day).fetch_all(&mut *c).await?;
    for d in old {
        let q: Option<Quest> = sqlx::query_as("SELECT * FROM piggy_quests WHERE day = $1 AND broken_at = 0 FOR UPDATE").bind(&d).fetch_optional(&mut *c).await?;
        if let Some(q) = q {
            sqlx::query("UPDATE piggy_quests SET broken_at = $2 WHERE day = $1").bind(&d).bind(now()).execute(&mut *c).await?;
            settle(c, cat, &q).await?;
        }
    }
    Ok(())
}

/// Widok dla gracza: quest, top 3, udziały w pasku, mój wkład i nagroda
async fn view(c: &mut Conn, cat: &Catalog, uid: i64, q: &Quest) -> sqlx::Result<Value> {
    let rows: Vec<(i64, String, i64, i64, i32, String, String, i64)> = sqlx::query_as(
        "SELECT p.user_id, u.username, p.amount, p.hits, p.place, p.person_id, p.variant, p.item_id
         FROM piggy_contrib p JOIN users u ON u.id = p.user_id WHERE p.day = $1 AND p.amount > 0
         ORDER BY p.amount DESC, p.first_at ASC",
    )
    .bind(&q.day)
    .fetch_all(&mut *c)
    .await?;
    let breakers: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM piggy_contrib WHERE day = $1 AND hits > 0").bind(&q.day).fetch_one(&mut *c).await?;
    let hidden: Vec<i64> = sqlx::query_scalar("SELECT id FROM users WHERE banned <> 0 OR ranking_hidden <> 0 OR money_generated <> 0")
        .fetch_all(&mut *c)
        .await?;
    let ranked: Vec<_> = rows.iter().filter(|r| !hidden.contains(&r.0)).collect();
    let person = |r: &(i64, String, i64, i64, i32, String, String, i64)| {
        cat.people.get(&r.5).map(|p| json!({"id": r.7, "person": r.5, "variant": r.6, "name": p.name, "rarity": p.rarity}))
    };
    let mine = rows.iter().find(|r| r.0 == uid);
    let my_place = ranked.iter().position(|r| r.0 == uid).map(|i| i + 1);
    let kind = KINDS.iter().find(|k| k.0 == q.kind).copied().unwrap_or(KINDS[0]);
    let rarity_name = g().rarities.get(&q.rarity).map_or(q.rarity.clone(), |r| r.name.clone());
    // pasek: najwięksi wpłacający osobno, reszta razem
    const BAR: usize = 12;
    let shares: Vec<Value> = rows.iter().take(BAR).map(|r| json!({"name": r.1, "amount": r.2, "me": r.0 == uid})).collect();
    let rest: i64 = rows.iter().skip(BAR).map(|r| r.2).sum();
    Ok(json!({
        "day": q.day, "kind": q.kind, "title": kind.1, "desc": kind.2,
        "rarity": q.rarity, "rarityName": rarity_name,
        "target": q.target, "total": q.total, "startsAt": q.starts_at, "endsAt": q.ends_at,
        "filledAt": q.filled_at, "brokenAt": q.broken_at, "hits": q.hits, "needHits": q.need_hits,
        "breakers": breakers, "minBreakers": q.min_breakers.min(rows.len().max(1) as i64),
        "participants": rows.len(),
        "top": ranked.iter().take(3).map(|r| json!({"name": r.1, "amount": r.2})).collect::<Vec<_>>(),
        "shares": shares, "rest": rest, "restCount": rows.len().saturating_sub(BAR),
        "places": PLACES,
        "mine": {"amount": mine.map_or(0, |r| r.2), "hits": mine.map_or(0, |r| r.3), "place": my_place,
                 "reward": mine.filter(|r| r.7 > 0).and_then(person)},
        "now": now(),
    }))
}

pub async fn piggy_status(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    settle_old(&mut tx, &cat).await?;
    let q = today(&mut tx).await?;
    let v = match &q {
        Some(q) => Some(view(&mut tx, &cat, me.id, q).await?),
        None => None,
    };
    // wczorajsza świnka: czy się udało i co dostałem
    let (day, start, _) = day_bounds();
    let prev: Option<Quest> =
        sqlx::query_as("SELECT * FROM piggy_quests WHERE day < $1 ORDER BY day DESC LIMIT 1").bind(&day).fetch_optional(&mut *tx).await?;
    let prev = match prev.filter(|p| p.ends_at >= start - 1.0) {
        Some(p) => Some(view(&mut tx, &cat, me.id, &p).await?),
        None => None,
    };
    tx.commit().await?;
    ok(json!({"enabled": q.is_some(), "quest": v, "previous": prev}))
}

/// Ostatnie kliknięcia graczy (ochrona przed skryptem klikającym tysiąc razy na sekundę)
static LAST_HIT: LazyLock<Mutex<HashMap<i64, Instant>>> = LazyLock::new(Default::default);
const HIT_GAP_MS: u128 = 90;

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct HitRequest {
    /// kliknięcia zebrane w przeglądarce od ostatniego wysłania (najwyżej 10)
    n: i64,
}

/// Uderzenie w pełną świnkę. Gdy uderzeń jest dość od dość wielu osób, świnka pęka i rozdaje nagrody.
pub async fn piggy_hit(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<HitRequest>) -> Res {
    {
        let mut l = LAST_HIT.lock().unwrap_or_else(|e| e.into_inner());
        if l.len() > 10_000 {
            l.clear();
        }
        if l.get(&me.id).is_some_and(|t| t.elapsed().as_millis() < HIT_GAP_MS * 3) {
            return bad("Za szybko");
        }
        l.insert(me.id, Instant::now());
    }
    let n = req.n.clamp(1, 10);
    let cat = st.cat();
    let (day, _, _) = day_bounds();
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let Some(q) = sqlx::query_as::<_, Quest>("SELECT * FROM piggy_quests WHERE day = $1 FOR UPDATE").bind(&day).fetch_optional(&mut *tx).await? else {
        return bad("Dziś nie ma skarbonki");
    };
    if q.filled_at == 0.0 {
        return bad("Skarbonka nie jest jeszcze pełna");
    }
    let mut broke = false;
    if q.broken_at == 0.0 {
        // uderzać może każdy (też bez wkładu - pomaga rozbić, ale nagrody nie dostaje)
        sqlx::query(
            "INSERT INTO piggy_contrib (day, user_id, amount, hits, first_at) VALUES ($1, $2, 0, $3, $4)
             ON CONFLICT (day, user_id) DO UPDATE SET hits = piggy_contrib.hits + excluded.hits",
        )
        .bind(&day)
        .bind(me.id)
        .bind(n)
        .bind(now())
        .execute(&mut *tx)
        .await?;
        let hits: i64 = sqlx::query_scalar("UPDATE piggy_quests SET hits = hits + $2 WHERE day = $1 RETURNING hits").bind(&day).bind(n).fetch_one(&mut *tx).await?;
        let (breakers, people): (i64, i64) = sqlx::query_as(
            "SELECT COUNT(*) FILTER (WHERE hits > 0), COUNT(*) FILTER (WHERE amount > 0) FROM piggy_contrib WHERE day = $1",
        )
        .bind(&day)
        .fetch_one(&mut *tx)
        .await?;
        if hits >= q.need_hits && breakers >= q.min_breakers.min(people.max(1)) {
            sqlx::query("UPDATE piggy_quests SET broken_at = $2 WHERE day = $1").bind(&day).bind(now()).execute(&mut *tx).await?;
            settle(&mut tx, &cat, &q).await?;
            forget_cache();
            broke = true;
        }
    }
    let q = load(&mut tx, &day).await?.unwrap_or(q);
    let v = view(&mut tx, &cat, me.id, &q).await?;
    tx.commit().await?;
    ok(json!({"quest": v, "broke": broke}))
}

// ---------------------------------------------------------------- panel admina

fn settings_json(vals: &[i64]) -> Value {
    let mut m = serde_json::Map::new();
    for ((_, field, ..), v) in SETTINGS.iter().zip(vals) {
        m.insert((*field).into(), json!(v));
    }
    Value::Object(m)
}

async fn admin_view(c: &mut Conn) -> sqlx::Result<Value> {
    let mut vals = Vec::new();
    for (key, ..) in SETTINGS {
        vals.push(setting(c, key).await?);
    }
    let (day, ..) = day_bounds();
    let q = load(c, &day).await?;
    let base = vals[1];
    let m = mults(c).await?;
    let targets: Vec<Value> = KINDS
        .iter()
        .map(|k| json!({"kind": k.0, "title": k.1, "targets": RARITIES.iter().map(|r| json!({"rarity": r.0, "target": m.target(base, k.0, r.0)})).collect::<Vec<_>>()}))
        .collect();
    Ok(json!({
        "settings": settings_json(&vals),
        "today": q.map(|q| json!({"kind": q.kind, "rarity": q.rarity, "target": q.target, "total": q.total, "filledAt": q.filled_at, "brokenAt": q.broken_at, "hits": q.hits, "needHits": q.need_hits})),
        "kinds": KINDS.iter().map(|k| json!({"kind": k.0, "title": k.1})).collect::<Vec<_>>(),
        "rarities": RARITIES.iter().map(|r| r.0).collect::<Vec<_>>(),
        "targets": targets,
        "kindPct": m.kinds.iter().map(|(k, v)| (k.to_string(), json!(v))).collect::<serde_json::Map<String, Value>>(),
        "rarityPct": m.rarities.iter().map(|(k, v)| (k.to_string(), json!(v))).collect::<serde_json::Map<String, Value>>(),
    }))
}

pub async fn admin_piggy(State(st): State<AppState>, Admin(_me): Admin) -> Res {
    let mut c = st.db.acquire().await?;
    ok(admin_view(&mut c).await?)
}

/// Zapis ustawień (`enabled`, `base`, `hits`, `breakers`); `reroll` = dzisiejsze zadanie od nowa (tylko przed pierwszą wpłatą),
/// `kind` / `rarity` = wybrane zamiast losowych (razem z `reroll`)
pub async fn admin_piggy_save(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<serde_json::Map<String, Value>>) -> Res {
    let mut tx = st.db.begin().await?;
    let mut log = Vec::new();
    for (key, field, _, lo, hi) in SETTINGS {
        let Some(v) = req.get(*field) else { continue };
        let n = v.as_i64().or_else(|| v.as_bool().map(i64::from)).or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()));
        let Some(n) = n else { return bad("Skarbonka: podaj liczby całkowite") };
        if !(*lo..=*hi).contains(&n) {
            return bad(format!("Skarbonka: {field} od {lo} do {hi}"));
        }
        super::snake::put_setting(&mut tx, key, n).await?;
        log.push(format!("{field}={n}"));
    }
    for (field, prefix, names) in [("kindPct", "piggy_k_", KINDS.iter().map(|k| k.0).collect::<Vec<_>>()), ("rarityPct", "piggy_r_", RARITIES.iter().map(|r| r.0).collect::<Vec<_>>())] {
        let Some(map) = req.get(field).and_then(Value::as_object) else { continue };
        for (name, v) in map {
            if !names.contains(&name.as_str()) {
                continue;
            }
            let n = v.as_i64().or_else(|| v.as_str().and_then(|x| x.trim().parse().ok()));
            let Some(n) = n.filter(|n| (1..=PCT_MAX).contains(n)) else { return bad(format!("Skarbonka: mnożnik {name} od 1 do {PCT_MAX} procent")) };
            super::snake::put_setting(&mut tx, &format!("{prefix}{name}"), n).await?;
            log.push(format!("{prefix}{name}={n}%"));
        }
    }
    if req.get("reroll").and_then(Value::as_bool) == Some(true) {
        let (day, ..) = day_bounds();
        let paid: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(amount), 0)::BIGINT FROM piggy_contrib WHERE day = $1").bind(&day).fetch_one(&mut *tx).await?;
        if paid > 0 {
            return bad("Do dzisiejszej skarbonki już ktoś wpłacił - zmiana zadania byłaby nie fair");
        }
        sqlx::query("DELETE FROM piggy_contrib WHERE day = $1").bind(&day).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM piggy_quests WHERE day = $1").bind(&day).execute(&mut *tx).await?;
        forget_cache();
        if let Some(q) = today(&mut tx).await? {
            let kind = req.get("kind").and_then(Value::as_str).filter(|k| KINDS.iter().any(|x| x.0 == *k)).unwrap_or(&q.kind).to_owned();
            let rarity = req.get("rarity").and_then(Value::as_str).filter(|r| RARITIES.iter().any(|x| x.0 == *r)).unwrap_or(&q.rarity).to_owned();
            let target = mults(&mut tx).await?.target(setting(&mut tx, "piggy_base").await?, &kind, &rarity);
            sqlx::query("UPDATE piggy_quests SET kind = $2, rarity = $3, target = $4 WHERE day = $1").bind(&day).bind(&kind).bind(&rarity).bind(target).execute(&mut *tx).await?;
            log.push(format!("dzisiaj: {kind} / {rarity} / {target} gr"));
        }
    }
    forget_cache();
    if !log.is_empty() {
        log_admin(&mut tx, &me, "piggy", None, &log.join(", ")).await?;
    }
    let v = admin_view(&mut tx).await?;
    tx.commit().await?;
    ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harder_tasks_and_better_rewards_change_the_goal() {
        assert_eq!(target_for(300_000, "crates", "purple"), 300_000);
        assert!(target_for(300_000, "crates", "gold") > target_for(300_000, "crates", "purple"));
        assert!(target_for(300_000, "casino_win", "purple") < target_for(300_000, "casino_play", "purple"));
        assert_eq!(target_for(10, "games", "blue") % 1000, 0);
    }

    #[test]
    fn events_count_only_for_their_task() {
        assert_eq!(Ev::Crates(500).value("crates"), 500);
        assert_eq!(Ev::Crates(500).value("casino_play"), 0);
        assert_eq!(Ev::Casino { stake: 100, won: false }.value("casino_win"), 0);
        assert_eq!(Ev::Casino { stake: 100, won: true }.value("casino_win"), 100);
        assert_eq!(Ev::Casino { stake: 100, won: true }.value("all"), 200);
        assert_eq!(Ev::Game(30).value("games"), 30);
    }

    #[test]
    fn reward_variants_exist() {
        for v in PLACES {
            assert!(g().is_variant(v), "{v}");
            assert_eq!(g().variant(v).extra_source.as_deref(), Some("piggy"), "{v}");
        }
        for (r, ..) in RARITIES {
            assert!(g().rarities.contains_key(*r));
        }
    }
}
