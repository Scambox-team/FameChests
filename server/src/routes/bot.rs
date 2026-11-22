//! Dane dla bota Discorda (`GET /api/bot/snapshot`): liczba kont i graczy online, ranking, aktualny quest, eventy i skrzynki
//! w sklepie. Chroni to hasło z `BOT_TOKEN` (nagłówek `Authorization: Bearer ...`); bez `BOT_TOKEN` endpoint odpowiada 404.
//! Zwraca tylko to, co i tak widać w rankingu i w sklepie (nazwy graczy, wartości, liczby) - żadnych emaili ani sald.

use std::collections::HashMap;
use std::collections::HashSet;

use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use serde_json::{json, Value};

use super::events::event_view;
use super::ok;
use super::JsonBody;
use crate::auth::{Me, User};
use crate::game::Ctx;
use crate::data::g;
use crate::db::{now, Conn};
use crate::error::Res;
use crate::events::{day_start, today};
use crate::game::{collection_stats, UserBrief};
use crate::state::AppState;

/// Ile miejsc rankingu dostaje bot
const TOP: usize = 10;

/// Porównanie w stałym czasie (token nie wycieka przez czas odpowiedzi)
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

fn authorized(st: &AppState, h: &HeaderMap) -> Option<bool> {
    let want = st.cfg.bot_token.as_deref()?;
    let got = h.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    Some(same(want.as_bytes(), got.trim().as_bytes()))
}


/// Gracz w rankingu (bez zablokowanych, ukrytych i z pieniędzmi od admina)
struct Row {
    id: i64,
    name: String,
    created: f64,
    value: i64,
    unique: usize,
    opened: i64,
}

async fn ranked_players(c: &mut crate::db::Conn, cat: &crate::catalog::Catalog) -> sqlx::Result<Vec<Row>> {
    let stats = collection_stats(c, cat).await?;
    let opened: HashMap<i64, i64> = sqlx::query_as::<_, (i64, i64)>("SELECT user_id, value FROM user_state WHERE key = 'opened'")
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .collect();
    let users = sqlx::query_as!(User, "SELECT * FROM users WHERE banned = 0 AND ranking_hidden = 0 AND money_generated = 0")
        .fetch_all(&mut *c)
        .await?;
    Ok(users
        .iter()
        .map(|u| {
            let b = UserBrief::new(cat, u, &stats);
            Row { id: u.id, name: u.username.clone(), created: u.created_at, value: b.value, unique: b.unique, opened: opened.get(&u.id).copied().unwrap_or(0) }
        })
        .collect())
}

pub async fn snapshot(State(st): State<AppState>, headers: HeaderMap) -> Res {
    match authorized(&st, &headers) {
        None => return Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
        Some(false) => return Ok(axum::http::StatusCode::UNAUTHORIZED.into_response()),
        Some(true) => {}
    }
    let cat = st.cat();
    let mut c = st.db.acquire().await?;

    // ranking jak na stronie: bez zablokowanych, ukrytych i graczy z pieniędzmi od admina
    let players = ranked_players(&mut c, &cat).await?;
    let top = |key: fn(&Row) -> i64| -> Vec<Value> {
        let mut v: Vec<&Row> = players.iter().collect();
        v.sort_by(|a, b| key(b).cmp(&key(a)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        v.into_iter().take(TOP).map(|p| json!({"username": p.name, "value": p.value, "unique": p.unique, "opened": p.opened})).collect()
    };
    let accounts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users").fetch_one(&mut *c).await?;

    // quest: karta i skrzynki, z których wypada; nazwę karty dokładamy, bo przeglądarka bierze ją z katalogu
    let quest = match super::quests::bot_view(&mut c, &cat).await? {
        Some(q) => {
            let mut v = serde_json::to_value(&q).unwrap_or(Value::Null);
            if let Some(p) = v.get("person").and_then(Value::as_str).and_then(|id| cat.person(id)) {
                v["personName"] = json!(if p.is_secret() { "Tajna karta".to_owned() } else { p.name.clone() });
                v["rarity"] = json!(g().rarities.get(&p.rarity).map_or(p.rarity.clone(), |r| r.name.clone()));
            }
            let crates: Vec<Value> = v["crates"]
                .as_array()
                .map(|a| a.iter().filter_map(Value::as_str).filter_map(|id| cat.crates.get(id)).map(|c| json!(c.name)).collect())
                .unwrap_or_default();
            v["crateNames"] = json!(crates);
            v
        }
        None => Value::Null,
    };

    // skarbonka: dzisiejszy stan (bez graczy spoza rankingu - ich wpłat tu i tak nie ma)
    let piggy = super::piggy::bot_view(&mut c, &cat).await?.unwrap_or(Value::Null);

    // quest CTF: bez flagi, danych zadania i podpowiedzi (to zostaje w grze); karta-nagroda w wariancie Cyfrowa
    let ctf = match super::ctf::ctf_view(&mut c, &cat, 0).await? {
        Some(q) => {
            let mut v = serde_json::to_value(&q).unwrap_or(Value::Null);
            for k in ["mine", "limitReached"] {
                if let Some(o) = v.as_object_mut() {
                    o.remove(k);
                }
            }
            if let Some(p) = v.get("person").and_then(Value::as_str).and_then(|id| cat.person(id)) {
                v["personName"] = json!(p.name);
                v["rarity"] = json!(g().rarities.get(&p.rarity).map_or(p.rarity.clone(), |r| r.name.clone()));
            }
            v
        }
        None => Value::Null,
    };

    // eventy: trwające i zaczynające się w ciągu 14 dni (jak w grze)
    let t = now() as i64;
    let events: Vec<Value> = cat
        .vs
        .game_events
        .iter()
        .filter(|e| e.enabled)
        .filter(|e| {
            let (s, end) = e.span();
            t < end && s - 14 * 86400 <= t
        })
        .map(|e| {
            let mut v = event_view(&cat, e, &HashSet::new());
            v["advent"] = Value::Null; // nagrody kalendarza adwentowego to niespodzianka dla graczy
            v
        })
        .collect();

    // skrzynki w sklepie dziś; rotacja zmienia się o północy czasu serwera
    let crates: Vec<Value> = cat
        .crates
        .values()
        .filter(|c| c.shop && !c.restricted)
        .map(|c| json!({"id": c.id, "name": c.name, "emoji": c.emoji, "price": c.price, "mode": c.mode, "desc": c.desc}))
        .collect();
    let next_rotation = day_start(today().succ_opt().unwrap_or_else(today));

    ok(json!({
        "now": t,
        "accounts": accounts,
        "online": st.online.count(),
        "totalCards": cat.people.len(),
        "ranking": {"value": top(|p| p.value), "cards": top(|p| p.unique as i64), "opened": top(|p| p.opened)},
        "quest": quest,
        "ctf": ctf,
        "piggy": piggy,
        "events": events,
        "crates": crates,
        "nextRotation": next_rotation,
        "patch": g().patch_notes.first().cloned().unwrap_or(Value::Null),
    }))
}

#[derive(serde::Deserialize)]
pub struct PlayerQuery {
    /// dokładna nazwa gracza (bez rozróżniania wielkości liter)
    name: Option<String>,
    /// początek nazwy: podpowiedzi do autouzupełniania (do 10 nazw)
    q: Option<String>,
}

/// `GET /api/bot/player?name=...` - publiczne dane gracza z rankingu; `?q=...` - podpowiedzi nazw.
/// Gracz spoza rankingu (zablokowany, ukryty, z pieniędzmi od admina) wygląda jak nieistniejący.
pub async fn player(State(st): State<AppState>, headers: HeaderMap, axum::extract::Query(q): axum::extract::Query<PlayerQuery>) -> Res {
    match authorized(&st, &headers) {
        None => return Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
        Some(false) => return Ok(axum::http::StatusCode::UNAUTHORIZED.into_response()),
        Some(true) => {}
    }
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let players = ranked_players(&mut c, &cat).await?;

    if let Some(prefix) = q.q.as_deref() {
        let p = prefix.trim().to_lowercase();
        let mut names: Vec<&str> = players.iter().map(|r| r.name.as_str()).filter(|n| n.to_lowercase().contains(&p)).collect();
        names.sort_by_key(|n| (!n.to_lowercase().starts_with(&p), n.to_lowercase()));
        names.truncate(10);
        return ok(json!({"names": names}));
    }

    let want = q.name.as_deref().unwrap_or("").trim().to_lowercase();
    let Some(me) = players.iter().find(|r| r.name.to_lowercase() == want) else {
        return ok(json!({"found": false}));
    };
    // miejsce = ile osób ma więcej + 1 (remisy mają to samo miejsce)
    let place = |key: fn(&Row) -> i64| 1 + players.iter().filter(|r| key(r) > key(me)).count();

    // najcenniejsze karty (tajne bez nazwy, jak w reszcie gry)
    let items: Vec<(String, String)> =
        sqlx::query_as("SELECT person_id, variant FROM items WHERE user_id = $1").bind(me.id).fetch_all(&mut *c).await?;
    let mut cards: Vec<(i64, String, String, String)> = items
        .iter()
        .filter_map(|(pid, variant)| {
            let p = cat.person(pid)?;
            let name = if p.is_secret() { "Tajna karta".to_owned() } else { p.name.clone() };
            let vname = if variant.is_empty() || variant == "normal" { String::new() } else { g().variant(variant).name.clone() };
            Some((p.value(variant), name, vname, g().rarities.get(&p.rarity).map_or(p.rarity.clone(), |r| r.name.clone())))
        })
        .collect();
    cards.sort_by(|a, b| b.0.cmp(&a.0));
    cards.truncate(5);

    let state: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>("SELECT key, value FROM user_state WHERE user_id = $1")
        .bind(me.id)
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .collect();
    let stat = |k: &str| state.get(k).copied().unwrap_or(0);

    ok(json!({
        "found": true,
        "username": me.name,
        "created": me.created,
        "value": me.value,
        "unique": me.unique,
        "totalCards": cat.people.len(),
        "opened": me.opened,
        "contracts": stat("contracts"),
        "upgradesWon": stat("upgrades_won"),
        "upgradesLost": stat("upgrades_lost"),
        "places": {"value": place(|r| r.value), "cards": place(|r| r.unique as i64), "opened": place(|r| r.opened)},
        "players": players.len(),
        "topCards": cards.iter().map(|c| json!({"value": c.0, "name": c.1, "variant": c.2, "rarity": c.3})).collect::<Vec<_>>(),
    }))
}

// ---------------------------------------------------------------- rzadkie dropy

#[derive(serde::Deserialize)]
pub struct DropsQuery {
    after: Option<i64>,
}

/// `GET /api/bot/drops?after=<id>` - nowe wyjątkowe dropy (karta warta >= DISCORD_DROP_MULT cen skrzynki, shop.rs) po id, najstarsze pierwsze, do 20.
/// `max` = najwyższe id w tabeli (bot przy pierwszym starcie zaczyna od niego, żeby nie ogłaszać starych).
/// Nazwa Tajnej karty nie wychodzi z gry: zamiast niej `secret: true`.
/// Dropy starsze niż tyle nie są ogłaszane (bot po dłuższej przerwie nie zalewa kanału starymi dropami)
const DROP_FRESH_SECS: f64 = 3.0 * 3600.0;

pub async fn drops(State(st): State<AppState>, headers: HeaderMap, axum::extract::Query(q): axum::extract::Query<DropsQuery>) -> Res {
    match authorized(&st, &headers) {
        None => return Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
        Some(false) => return Ok(axum::http::StatusCode::UNAUTHORIZED.into_response()),
        Some(true) => {}
    }
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let max: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(id), 0) FROM bot_events").fetch_one(&mut *c).await?;
    let rows: Vec<(i64, String, String, String, String, f64)> = sqlx::query_as(
        "SELECT e.id, u.username, e.person_id, e.variant, e.rarity, e.created_at FROM bot_events e \
         JOIN users u ON u.id = e.user_id WHERE e.id > $1 AND e.created_at > $2 AND u.banned = 0 AND u.ranking_hidden = 0 ORDER BY e.id LIMIT 20",
    )
    .bind(q.after.unwrap_or(max))
    .bind(now() - DROP_FRESH_SECS)
    .fetch_all(&mut *c)
    .await?;
    let drops: Vec<Value> = rows
        .into_iter()
        .map(|(id, user, pid, variant, rarity, at)| {
            // Rzułty papież (wariant tylko Jana Pawła II) jest ogłaszany z nazwą i obrazkiem, reszta tajnych zostaje tajemnicą
            let rzulty = variant.split('+').any(|v| v == "rzulty");
            let secret = rarity == "secret" && !rzulty;
            let name = cat.person(&pid).map(|p| p.name.clone()).unwrap_or_else(|| pid.clone());
            json!({
                "id": id, "username": user, "secret": secret, "rzulty": rzulty,
                "personId": if secret { Value::Null } else { json!(pid) }, "variantKey": variant,
                "person": if secret { Value::Null } else { json!(name) },
                "variant": if variant.is_empty() || variant == "normal" { Value::Null } else { json!(g().variant(&variant).name) },
                "rarity": g().rarities.get(&rarity).map_or(rarity.clone(), |r| r.name.clone()),
                "rarityKey": rarity, "at": at,
            })
        })
        .collect();
    ok(json!({"max": max, "drops": drops}))
}

// ---------------------------------------------------------------- powiązanie z Discordem

/// Nagroda za pierwsze powiązanie konta (grosze)
const DISCORD_REWARD: i64 = 5000;
const CODE_TTL: f64 = 600.0;
/// bez znaków łatwych do pomylenia (0/O, 1/I)
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

#[derive(serde::Deserialize)]
pub struct LinkCodeReq {
    #[serde(rename = "discordId")]
    discord_id: String,
}

/// `POST /api/bot/unlink` {discordId}: bot odłącza konto Discorda od gracza (komenda /odlacz). {unlinked: bool}
pub async fn unlink_by_bot(State(st): State<AppState>, headers: HeaderMap, JsonBody(req): JsonBody<LinkCodeReq>) -> Res {
    match authorized(&st, &headers) {
        None => return Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
        Some(false) => return Ok(axum::http::StatusCode::UNAUTHORIZED.into_response()),
        Some(true) => {}
    }
    let id = req.discord_id.trim();
    let name: Option<String> = sqlx::query_scalar("SELECT u.username FROM discord_links l JOIN users u ON u.id = l.user_id WHERE l.discord_id = $1")
        .bind(id)
        .fetch_optional(&st.db)
        .await?;
    sqlx::query("DELETE FROM discord_links WHERE discord_id = $1").bind(id).execute(&st.db).await?;
    sqlx::query("DELETE FROM discord_link_codes WHERE discord_id = $1").bind(id).execute(&st.db).await?;
    ok(json!({"unlinked": name.is_some(), "username": name}))
}

/// `POST /api/bot/link-code` {discordId}: bot prosi o kod dla gracza Discorda (komenda /polacz).
/// Odpowiedź: {linked, username} gdy to konto Discord jest już połączone, inaczej {code, ttl}.
pub async fn link_code(State(st): State<AppState>, headers: HeaderMap, JsonBody(req): JsonBody<LinkCodeReq>) -> Res {
    match authorized(&st, &headers) {
        None => return Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
        Some(false) => return Ok(axum::http::StatusCode::UNAUTHORIZED.into_response()),
        Some(true) => {}
    }
    let id = req.discord_id.trim();
    if !(15..=22).contains(&id.len()) || !id.bytes().all(|b| b.is_ascii_digit()) {
        return crate::error::bad("Zły identyfikator Discorda");
    }
    let mut c = st.db.acquire().await?;
    let linked: Option<String> =
        sqlx::query_scalar("SELECT u.username FROM discord_links l JOIN users u ON u.id = l.user_id WHERE l.discord_id = $1")
            .bind(id)
            .fetch_optional(&mut *c)
            .await?;
    if let Some(username) = linked {
        return ok(json!({"linked": true, "username": username}));
    }
    sqlx::query("DELETE FROM discord_link_codes WHERE expires_at < $1 OR discord_id = $2").bind(now()).bind(id).execute(&mut *c).await?;
    let code: String = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..8).map(|_| CODE_ALPHABET[rng.gen_range(0..CODE_ALPHABET.len())] as char).collect()
    };
    sqlx::query("INSERT INTO discord_link_codes (code, discord_id, expires_at) VALUES ($1, $2, $3)")
        .bind(&code)
        .bind(id)
        .bind(now() + CODE_TTL)
        .execute(&mut *c)
        .await?;
    ok(json!({"linked": false, "code": code, "ttl": CODE_TTL as i64}))
}

/// `GET /api/bot/links` - połączone konta i ich miejsce w rankingu wartości (None = poza rankingiem): z tego bot nadaje role
pub async fn links(State(st): State<AppState>, headers: HeaderMap) -> Res {
    match authorized(&st, &headers) {
        None => return Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
        Some(false) => return Ok(axum::http::StatusCode::UNAUTHORIZED.into_response()),
        Some(true) => {}
    }
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let players = ranked_players(&mut c, &cat).await?;
    let rows: Vec<(i64, String)> = sqlx::query_as("SELECT user_id, discord_id FROM discord_links").fetch_all(&mut *c).await?;
    let ids: Vec<i64> = rows.iter().map(|r| r.0).collect();

    // karty połączonych graczy: rzadkości, które posiadają, i czy mają Rzułtego Papieża (Jan Paweł II w wariancie "rzulty")
    let items: Vec<(i64, String, String)> =
        sqlx::query_as("SELECT user_id, person_id, variant FROM items WHERE user_id = ANY($1)").bind(&ids).fetch_all(&mut *c).await?;
    let mut rarities: HashMap<i64, HashSet<String>> = HashMap::new();
    // rola RZUŁTY na stałe za wylosowanie Rzułtego ze skrzynki (klaser pamięta to także po sprzedaży karty;
    // source NULL = stare wpisy sprzed zapisywania źródła), a poza tym za samo posiadanie karty (rynek, wymiana)
    let dropped: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT user_id FROM user_collected WHERE user_id = ANY($1) AND person_id = 'pl_secret'
         AND variant ~ '(^|[+])rzulty([+]|$)' AND (source = 'drop' OR source IS NULL)",
    )
    .bind(&ids)
    .fetch_all(&mut *c)
    .await?;
    let mut rzulty: HashSet<i64> = dropped.into_iter().collect();
    for (uid, pid, variant) in &items {
        if let Some(p) = cat.person(pid) {
            rarities.entry(*uid).or_default().insert(p.rarity.clone());
        }
        if pid == "pl_secret" && variant.split('+').any(|v| v == "rzulty") {
            rzulty.insert(*uid);
        }
    }
    let states: Vec<(i64, String, i64)> =
        sqlx::query_as("SELECT user_id, key, value FROM user_state WHERE user_id = ANY($1) AND key IN ('contracts', 'upgrades_won')")
            .bind(&ids)
            .fetch_all(&mut *c)
            .await?;
    let stat = |uid: i64, key: &str| states.iter().find(|s| s.0 == uid && s.1 == key).map_or(0, |s| s.2);

    let t = now();
    let list: Vec<Value> = rows
        .into_iter()
        .map(|(uid, did)| {
            let me = players.iter().find(|r| r.id == uid);
            // gracz poza rankingiem (zablokowany / ukryty): tylko rola "Połączony", bez nagród za statystyki
            let Some(me) = me else { return json!({"discordId": did, "place": null}) };
            let place = 1 + players.iter().filter(|r| r.value > me.value).count();
            let mut owned: Vec<&String> = rarities.get(&uid).map(|s| s.iter().collect()).unwrap_or_default();
            owned.sort();
            json!({
                "discordId": did, "place": place,
                "value": me.value, "unique": me.unique, "totalCards": cat.people.len(), "opened": me.opened,
                "contracts": stat(uid, "contracts"), "upgradesWon": stat(uid, "upgrades_won"),
                "ageDays": ((t - me.created) / 86400.0).floor() as i64,
                "rarities": owned, "rzulty": rzulty.contains(&uid),
            })
        })
        .collect();
    ok(json!({"links": list}))
}

/// `GET /api/discord` (gracz): czy konto jest połączone i jaka jest nagroda
pub async fn discord_status(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    let linked: Option<f64> = sqlx::query_scalar("SELECT linked_at FROM discord_links WHERE user_id = $1").bind(me.id).fetch_optional(&mut *c).await?;
    let rewarded: Option<f64> = sqlx::query_scalar("SELECT at FROM discord_rewards WHERE user_id = $1").bind(me.id).fetch_optional(&mut *c).await?;
    let prefs: Option<(i32, i32)> = sqlx::query_as("SELECT friends, trades FROM discord_notify_settings WHERE user_id = $1")
        .bind(me.id)
        .fetch_optional(&mut *c)
        .await?;
    let (friends, trades) = prefs.unwrap_or((0, 0));
    ok(json!({
        "enabled": st.cfg.bot_token.is_some(), "linked": linked.is_some(), "reward": DISCORD_REWARD, "rewarded": rewarded.is_some(),
        "notify": {"friends": friends == 1, "trades": trades == 1},
    }))
}

// ---------------------------------------------------------------- powiadomienia na DM

/// Jak długo trzymamy wpisy w kolejce; bot po dłuższej przerwie nie zasypie gracza starymi powiadomieniami
const NOTIFY_KEEP_SECS: f64 = 3.0 * 86400.0;
const NOTIFY_FRESH_SECS: f64 = 6.0 * 3600.0;

/// Ustawienie gracza, od którego zależy powiadomienie
#[derive(Clone, Copy)]
pub enum Pref {
    Friends,
    Trades,
}

fn notify_url(st: &AppState, path: &str) -> Option<String> {
    st.cfg.public_url.as_ref().map(|u| format!("{u}{path}"))
}

/// Powiadomienie dla jednego gracza, jeśli bot jest włączony, gracz ma połączony Discord i włączył ten rodzaj powiadomień
pub async fn notify_user(c: &mut Conn, st: &AppState, uid: i64, pref: Pref, kind: &str, data: Value, path: &str) -> sqlx::Result<()> {
    if st.cfg.bot_token.is_none() {
        return Ok(());
    }
    let sql = match pref {
        Pref::Friends => concat!(
            "INSERT INTO discord_notifications (user_id, kind, data, url, created_at) SELECT $1, $2, $3, $4, $5 ",
            "WHERE EXISTS (SELECT 1 FROM discord_links WHERE user_id = $1) ",
            "AND EXISTS (SELECT 1 FROM discord_notify_settings WHERE user_id = $1 AND friends = 1)"
        ),
        Pref::Trades => concat!(
            "INSERT INTO discord_notifications (user_id, kind, data, url, created_at) SELECT $1, $2, $3, $4, $5 ",
            "WHERE EXISTS (SELECT 1 FROM discord_links WHERE user_id = $1) ",
            "AND EXISTS (SELECT 1 FROM discord_notify_settings WHERE user_id = $1 AND trades = 1)"
        ),
    };
    sqlx::query(sql).bind(uid).bind(kind).bind(data.to_string()).bind(notify_url(st, path)).bind(now()).execute(c).await?;
    Ok(())
}

/// Nowa oferta w licytacji: powiadomienie dla wszystkich obserwujących z połączonym Discordem, poza licytującym
pub async fn notify_bid(c: &mut Conn, st: &AppState, listing: i64, bidder: i64, data: Value) -> sqlx::Result<()> {
    if st.cfg.bot_token.is_none() {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO discord_notifications (user_id, kind, data, url, created_at)
         SELECT w.user_id, 'bid', $3, $4, $5 FROM market_watch w JOIN discord_links d ON d.user_id = w.user_id
         WHERE w.listing_id = $1 AND w.user_id <> $2",
    )
    .bind(listing)
    .bind(bidder)
    .bind(data.to_string())
    .bind(notify_url(st, "/market"))
    .bind(now())
    .execute(c)
    .await?;
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct NotifyReq {
    friends: Option<bool>,
    trades: Option<bool>,
}

/// `POST /api/discord/notify` {friends?, trades?} (gracz): włączenie / wyłączenie powiadomień na DM
pub async fn discord_notify(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<NotifyReq>) -> Res {
    let mut c = st.db.acquire().await?;
    sqlx::query(
        "INSERT INTO discord_notify_settings (user_id, friends, trades) VALUES ($1, COALESCE($2, 0), COALESCE($3, 0))
         ON CONFLICT (user_id) DO UPDATE SET friends = COALESCE($2, discord_notify_settings.friends),
                                             trades = COALESCE($3, discord_notify_settings.trades)",
    )
    .bind(me.id)
    .bind(req.friends.map(i32::from))
    .bind(req.trades.map(i32::from))
    .execute(&mut *c)
    .await?;
    let (friends, trades): (i32, i32) =
        sqlx::query_as("SELECT friends, trades FROM discord_notify_settings WHERE user_id = $1").bind(me.id).fetch_one(&mut *c).await?;
    ok(json!({"notify": {"friends": friends == 1, "trades": trades == 1}}))
}

#[derive(serde::Deserialize)]
pub struct NotifyQuery {
    after: Option<i64>,
}

/// `GET /api/bot/notifications?after=<id>` (bot): powiadomienia do wysłania na DM, najstarsze pierwsze, do 50.
/// `max` = najwyższe id (pierwszy start bota zaczyna od niego). Starsze niż NOTIFY_FRESH_SECS są pomijane, starsze niż
/// NOTIFY_KEEP_SECS usuwane; razem z nimi obserwowane licytacje, które już się skończyły.
pub async fn notifications(State(st): State<AppState>, headers: HeaderMap, axum::extract::Query(q): axum::extract::Query<NotifyQuery>) -> Res {
    match authorized(&st, &headers) {
        None => return Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
        Some(false) => return Ok(axum::http::StatusCode::UNAUTHORIZED.into_response()),
        Some(true) => {}
    }
    let mut c = st.db.acquire().await?;
    let t = now();
    sqlx::query("DELETE FROM discord_notifications WHERE created_at < $1").bind(t - NOTIFY_KEEP_SECS).execute(&mut *c).await?;
    sqlx::query("DELETE FROM market_watch w WHERE NOT EXISTS (SELECT 1 FROM market_listings l WHERE l.id = w.listing_id AND l.status = 'active')")
        .execute(&mut *c)
        .await?;
    let max: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(id), 0) FROM discord_notifications").fetch_one(&mut *c).await?;
    let rows: Vec<(i64, String, String, String, Option<String>, f64)> = sqlx::query_as(
        "SELECT n.id, d.discord_id, n.kind, n.data, n.url, n.created_at FROM discord_notifications n
         JOIN discord_links d ON d.user_id = n.user_id WHERE n.id > $1 AND n.created_at > $2 ORDER BY n.id LIMIT 50",
    )
    .bind(q.after.unwrap_or(max))
    .bind(t - NOTIFY_FRESH_SECS)
    .fetch_all(&mut *c)
    .await?;
    let items: Vec<Value> = rows
        .into_iter()
        .map(|(id, did, kind, data, url, at)| {
            json!({"id": id, "discordId": did, "kind": kind, "data": serde_json::from_str::<Value>(&data).unwrap_or(Value::Null), "url": url, "at": at})
        })
        .collect();
    ok(json!({"max": max, "items": items}))
}

#[derive(serde::Deserialize)]
pub struct LinkReq {
    code: String,
}

/// `POST /api/discord/link` {code} (gracz): kod z komendy /polacz na Discordzie; pierwsze powiązanie daje nagrodę
pub async fn discord_link(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<LinkReq>) -> Res {
    let code = req.code.trim().to_uppercase();
    let cx = Ctx::new(st.clone(), me.clone());
    let mut tx = st.db.begin().await?;
    crate::db::lock_me(&mut tx, me.id).await?;
    let has: Option<i64> = sqlx::query_scalar("SELECT user_id FROM discord_links WHERE user_id = $1").bind(me.id).fetch_optional(&mut *tx).await?;
    if has.is_some() {
        return crate::error::bad("To konto ma już połączony Discord. Najpierw je odłącz.");
    }
    // kod jednorazowy: DELETE ... RETURNING zużywa go atomowo
    let discord: Option<String> = sqlx::query_scalar("DELETE FROM discord_link_codes WHERE code = $1 AND expires_at > $2 RETURNING discord_id")
        .bind(&code)
        .bind(now())
        .fetch_optional(&mut *tx)
        .await?;
    let Some(discord) = discord else { return crate::error::bad("Zły albo wygasły kod. Wpisz /polacz na Discordzie, żeby dostać nowy.") };
    let taken: Option<i64> = sqlx::query_scalar("SELECT user_id FROM discord_links WHERE discord_id = $1").bind(&discord).fetch_optional(&mut *tx).await?;
    if taken.is_some() {
        return crate::error::bad("To konto Discord jest już połączone z innym kontem w grze.");
    }
    sqlx::query("INSERT INTO discord_links (user_id, discord_id, linked_at) VALUES ($1, $2, $3)").bind(me.id).bind(&discord).bind(now()).execute(&mut *tx).await?;
    let first = sqlx::query("INSERT INTO discord_rewards (user_id, at) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(me.id)
        .bind(now())
        .execute(&mut *tx)
        .await?
        .rows_affected()
        > 0;
    if first {
        crate::achievements::grant_rewards(&mut tx, &cx, &[json!({"type": "money", "amount": DISCORD_REWARD})], "discord").await?;
    }
    tx.commit().await?;
    ok(json!({"linked": true, "reward": if first { DISCORD_REWARD } else { 0 }}))
}

/// `POST /api/discord/unlink` (gracz): odłącza Discord (bot zabierze role przy następnej synchronizacji; nagroda zostaje, nie da się jej powtórzyć)
pub async fn discord_unlink(State(st): State<AppState>, Me(me): Me) -> Res {
    sqlx::query("DELETE FROM discord_links WHERE user_id = $1").bind(me.id).execute(&st.db).await?;
    ok(json!({"linked": false}))
}

// ---------------------------------------------------------------- karty jako obrazki (komenda /karta, ogłoszenia dropów)

/// Nazwa ukrytego konta technicznego, na którym bot otwiera przeglądarkę, żeby narysować kartę (nie ma go w rankingu)
const RENDER_USER: &str = "__render__";

/// `POST /api/bot/render-session`: ciasteczko sesji konta technicznego dla przeglądarki bota (Chromium rysuje kartę
/// tym samym kodem CSS co gra). Konto powstaje przy pierwszym użyciu, jest ukryte w rankingu i nie ma hasła.
/// Tajne karty są dla niego zamaskowane (jak dla każdego gracza, który ich nie odkrył).
pub async fn render_session(State(st): State<AppState>, headers: HeaderMap, jar: axum_extra::extract::cookie::SignedCookieJar) -> Res {
    match authorized(&st, &headers) {
        None => return Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
        Some(false) => return Ok(axum::http::StatusCode::UNAUTHORIZED.into_response()),
        Some(true) => {}
    }
    let mut tx = st.db.begin().await?;
    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM users WHERE username = $1").bind(RENDER_USER).fetch_optional(&mut *tx).await?;
    let uid = match existing {
        Some(id) => id,
        None => {
            // hasło puste: nie da się na nie zalogować (jak konta z Supabase Auth)
            let id: i64 = sqlx::query_scalar("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ($1, '', 0, $2) RETURNING id")
                .bind(RENDER_USER)
                .bind(now())
                .fetch_one(&mut *tx)
                .await?;
            sqlx::query("UPDATE users SET ranking_hidden = 1, money_generated = 1 WHERE id = $1").bind(id).execute(&mut *tx).await?;
            crate::game::ensure_state(&mut tx, id).await?;
            sqlx::query("INSERT INTO terms_accepted (user_id, version, accepted_at) VALUES ($1, $2, $3)")
                .bind(id)
                .bind(super::reports::TERMS_VERSION)
                .bind(now())
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE user_state SET value = $1 WHERE user_id = $2 AND key = 'patch_seen'").bind(g().patch_version()).bind(id).execute(&mut *tx).await?;
            id
        }
    };
    tx.commit().await?;
    let jar = jar.add(crate::auth::session_cookie(uid, st.cfg.cookie_secure));
    Ok((jar, axum::Json(json!({"ok": true}))).into_response())
}

fn fold(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'ą' => 'a', 'ć' => 'c', 'ę' => 'e', 'ł' => 'l', 'ń' => 'n', 'ó' => 'o', 'ś' => 's', 'ź' | 'ż' => 'z',
            c => c,
        })
        .collect()
}

#[derive(serde::Deserialize)]
pub struct CardsQuery {
    /// fragment nazwy (podpowiedzi, do 10 kart)
    q: Option<String>,
    /// dokładne id karty: odpowiedź z wariantami i wartościami
    id: Option<String>,
}

/// `GET /api/bot/cards?q=...` - podpowiedzi kart po nazwie; `?id=...` - karta z listą możliwych wariantów i wartością każdego.
/// Karty tajne i specjalne są pomijane (ich nazwy nie wychodzą z gry).
pub async fn cards(State(st): State<AppState>, headers: HeaderMap, axum::extract::Query(q): axum::extract::Query<CardsQuery>) -> Res {
    match authorized(&st, &headers) {
        None => return Ok(axum::http::StatusCode::NOT_FOUND.into_response()),
        Some(false) => return Ok(axum::http::StatusCode::UNAUTHORIZED.into_response()),
        Some(true) => {}
    }
    let cat = st.cat();
    let rarity = |key: &str| g().rarities.get(key).map_or(key.to_owned(), |r| r.name.clone());
    let listed = |p: &crate::catalog::Person| !p.is_secret() && !p.is_special();

    if let Some(id) = q.id.as_deref() {
        let Some(p) = cat.person(id).filter(|p| listed(p)) else { return ok(json!({"found": false})) };
        let variants: Vec<Value> = cat
            .possible_variants(p)
            .into_iter()
            .map(|v| json!({"key": v, "name": g().variant(&v).name, "value": p.value(&v)}))
            .collect();
        return ok(json!({"found": true, "id": p.id, "name": p.name, "rarity": rarity(&p.rarity), "rarityKey": p.rarity, "variants": variants}));
    }
    let needle = fold(q.q.as_deref().unwrap_or("").trim());
    let mut found: Vec<&std::sync::Arc<crate::catalog::Person>> =
        cat.people.values().filter(|p| listed(p) && fold(&p.name).contains(&needle)).collect();
    found.sort_by_key(|p| (!fold(&p.name).starts_with(&needle), fold(&p.name)));
    found.truncate(10);
    ok(json!({"cards": found.iter().map(|p| json!({"id": p.id, "name": p.name, "rarity": rarity(&p.rarity)})).collect::<Vec<_>>()}))
}

// ---------------------------------------------------------------- „Pochwal się” na Discordzie

/// Co ile można się pochwalić kartą (żeby nie zalać kanału)
const BRAG_GAP_SECS: f64 = 300.0;

#[derive(serde::Deserialize)]
pub struct BragReq {
    /// numer egzemplarza z ekwipunku
    item: i64,
}

/// `POST /api/discord/brag` {item} (gracz): wiadomość na kanale „pochwal się” o jego karcie. Tylko z połączonym
/// Discordem, tylko własna jawna karta (nie Tajna), raz na `BRAG_GAP_SECS`. Idzie przez kolejkę jak powiadomienia,
/// bot wyśle ją na kanał (nie na DM).
pub async fn discord_brag(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<BragReq>) -> Res {
    if st.cfg.bot_token.is_none() {
        return crate::error::bad("Discord nie jest włączony");
    }
    if me.hidden_from_ranking() {
        return crate::error::bad("Gracze poza rankingiem nie mogą się chwalić");
    }
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    crate::db::lock_me(&mut tx, me.id).await?;
    let linked: Option<String> = sqlx::query_scalar("SELECT discord_id FROM discord_links WHERE user_id = $1").bind(me.id).fetch_optional(&mut *tx).await?;
    if linked.is_none() {
        return crate::error::bad("Połącz konto z Discordem w Ustawieniach, żeby się chwalić");
    }
    let item: Option<(String, String)> =
        sqlx::query_as("SELECT person_id, variant FROM items WHERE id = $1 AND user_id = $2").bind(req.item).bind(me.id).fetch_optional(&mut *tx).await?;
    let Some((pid, variant)) = item else { return crate::error::bad("Nie masz takiej karty") };
    let Some(p) = cat.person(&pid) else { return crate::error::bad("Nie masz takiej karty") };
    if p.is_secret() {
        return crate::error::bad("Tajnej karty nie da się pokazać na Discordzie");
    }
    let t = now();
    let last: Option<f64> =
        sqlx::query_scalar("SELECT MAX(created_at) FROM discord_notifications WHERE user_id = $1 AND kind = 'brag'").bind(me.id).fetch_one(&mut *tx).await?;
    if let Some(l) = last.filter(|l| t - l < BRAG_GAP_SECS) {
        let left = (BRAG_GAP_SECS - (t - l)).ceil() as i64;
        return crate::error::bad(&format!("Chwalić się można raz na 5 minut. Spróbuj za {} s.", left));
    }
    let data = json!({
        "username": me.username, "personId": pid, "person": p.name, "variantKey": variant,
        "variant": if variant.is_empty() || variant == "normal" { Value::Null } else { json!(g().variant(&variant).name) },
        "rarity": g().rarities.get(&p.rarity).map_or(p.rarity.clone(), |r| r.name.clone()), "rarityKey": p.rarity,
        "value": p.value(&variant),
    });
    sqlx::query("INSERT INTO discord_notifications (user_id, kind, data, url, created_at) VALUES ($1, 'brag', $2, NULL, $3)")
        .bind(me.id)
        .bind(data.to_string())
        .bind(t)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}
