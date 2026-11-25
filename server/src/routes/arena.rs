//! Arena: mecze 1v1 i trening z komputerem. Zasady liczy serwer (arena/engine.rs) - przeglądarka wysyła ruchy
//! i pokazuje stan. Dostęp: admini zawsze, reszta graczy po włączeniu „Arena dla wszystkich” w panelu admina
//! (klucz `arena_public` w tabeli `state`, ekstraktor `ArenaUser`).

use std::collections::{HashMap, HashSet};

use axum::extract::{FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::http::StatusCode;
use indexmap::IndexMap;
use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::shop::today;
use super::{ok, JsonBody};
use crate::arena::engine::{ArenaError, EndReason, Entry, Outcome};
use crate::arena::rules::{self, ArenaData, KINDS, SPECIALS, TRAITS};
use crate::arena::view::BattleView;
use crate::arena::{token, Arena, Battle, ChallengeStatus, DeckCard, Game, Hero, Mode, Reward, Side};
use crate::auth::{find_user, user_by_id, AuthReject, Me, User};
use crate::catalog::{Catalog, Person};
use crate::data::g;
use crate::db::{lock_users, now, Conn};
use crate::error::{bad, fail, AppError, Res};
use crate::game::views::{public_person, PublicPerson};
use crate::game::{add_state, discovered};
use crate::state::AppState;

/// Gracz z dostępem do Areny
pub struct ArenaUser(pub User);

pub fn has_access(u: &User) -> bool {
    u.admin() || rules::data().public
}

impl FromRequestParts<AppState> for ArenaUser {
    type Rejection = AuthReject;

    async fn from_request_parts(parts: &mut Parts, st: &AppState) -> Result<Self, Self::Rejection> {
        let Me(u) = Me::from_request_parts(parts, st).await?;
        if !has_access(&u) {
            return Err(AuthReject::Forbidden(parts.uri.path().starts_with("/api/")));
        }
        Ok(ArenaUser(u))
    }
}

/// Ustawienia Areny w /api/config (tylko dla graczy z dostępem)
pub fn config_json() -> Value {
    let d = rules::data();
    let s = &d.settings;
    let points: HashMap<&String, i64> = d.cards.iter().filter_map(|(k, v)| v.points.map(|p| (k, p))).collect();
    json!({
        "public": d.public,
        "rules": {"deckSize": s.deck_size, "rows": s.rows, "rowSlots": s.row_slots, "moves": s.moves, "turnSecs": s.turn_secs,
                  "gameSecs": s.game_secs, "overtimeSecs": s.overtime_secs, "maxOvertimes": s.max_overtimes,
                  "startMoney": s.start_money, "moneyPerTurn": s.money_per_turn, "maxMoney": s.max_money, "points": s.points,
                  "rewardPvp": s.reward_pvp, "rewardBot": s.reward_bot, "dailyPvp": s.daily_pvp, "dailyBot": s.daily_bot,
                  "reviveTurns": s.revive_turns},
        "classes": d.meta.classes,
        "specs": d.meta.specs.iter().map(|x| json!({"id": x.id, "name": x.name})).collect::<Vec<_>>(),
        "kinds": kinds_json(),
        "specials": SPECIALS.iter().map(|(k, n, desc)| json!({"id": k, "name": n, "desc": desc})).collect::<Vec<_>>(),
        "combos": d.meta.combos.iter().map(|c| json!({"id": c.id, "name": c.name, "effects": c.effects})).collect::<Vec<_>>(),
        "pointsOverride": points,
    })
}

pub fn kinds_json() -> Value {
    json!(KINDS
        .iter()
        .map(|(k, n, modes)| json!({"id": k, "name": n, "modes": modes.iter().map(|(m, mn)| json!({"id": m, "name": mn})).collect::<Vec<_>>()}))
        .collect::<Vec<_>>())
}

fn deck_error(n: usize) -> String {
    format!("Talia musi mieć {n} różnych kart z twojej kolekcji")
}

fn gone() -> AppError {
    AppError::with_status(StatusCode::NOT_FOUND, "Ten mecz już się skończył")
}

fn hero(cat: &Catalog, u: &User) -> Hero {
    u.view(cat).into()
}

fn entry(d: &ArenaData, p: &Person, variant: String) -> Entry {
    let stats = d.stats(p);
    let points = d.points(p, &stats);
    Entry { card: DeckCard { pid: p.id.clone(), variant }, stats, points }
}

fn entries(cat: &Catalog, d: &ArenaData, deck: &[DeckCard]) -> Vec<Entry> {
    deck.iter().filter_map(|c| cat.person(&c.pid).map(|p| entry(d, p, c.variant.clone()))).collect()
}

/// Talia z moich kart: osoby bez powtórzeń, każda w najlepszym posiadanym wariancie (wariant to tylko wygląd)
async fn arena_deck(c: &mut Conn, cat: &Catalog, uid: i64, pids: &[String]) -> sqlx::Result<Option<Vec<DeckCard>>> {
    let n = rules::data().settings.deck_size;
    if pids.len() != n || pids.iter().collect::<HashSet<_>>().len() != n {
        return Ok(None);
    }
    let rows = sqlx::query!("SELECT person_id, variant FROM items WHERE user_id = $1 AND person_id = ANY($2)", uid, pids)
        .fetch_all(c)
        .await?;
    let mut best: HashMap<String, String> = HashMap::new();
    for r in rows {
        let Some(p) = cat.person(&r.person_id) else { continue };
        let variant = if g().is_variant(&r.variant) { r.variant } else { "normal".into() };
        let current = best.get(&p.id).map_or("normal", String::as_str);
        if g().variant_idx(&variant) >= g().variant_idx(current) {
            best.insert(p.id.clone(), variant);
        }
    }
    if best.len() != n {
        return Ok(None);
    }
    Ok(Some(pids.iter().map(|p| DeckCard { pid: p.clone(), variant: best[p].clone() }).collect()))
}

/// Talia komputera: te same rzadkości co talia gracza, losowe osoby (tajne tylko odkryte przez gracza)
fn bot_deck(cat: &Catalog, deck: &[DeckCard], allowed_secret: &HashSet<String>) -> Vec<DeckCard> {
    let g = g();
    let mut used: HashSet<&str> = deck.iter().map(|c| c.pid.as_str()).collect();
    let pool: Vec<&Person> = cat
        .people
        .values()
        .map(AsRef::as_ref)
        .filter(|p| p.source.is_none() && (!p.is_secret() || allowed_secret.contains(&p.id)))
        .collect();
    let looks: Vec<&String> = g.variant_order[1..].iter().filter(|v| !g.variants[*v].exclusive).collect();
    let mut rng = rand::thread_rng();
    let mut out = vec![];
    for c in deck {
        let rarity = &cat.people[&c.pid].rarity;
        let mut opts: Vec<&Person> = pool.iter().copied().filter(|p| &p.rarity == rarity && !used.contains(p.id.as_str())).collect();
        if opts.is_empty() {
            opts = pool.iter().copied().filter(|p| !used.contains(p.id.as_str())).collect();
        }
        let Some(p) = opts.choose(&mut rng).copied() else { break };
        used.insert(&p.id);
        let variant = if rng.gen::<f64>() < 0.7 { "normal".to_owned() } else { looks.choose(&mut rng).map(|v| (*v).clone()).unwrap_or_default() };
        out.push(DeckCard { pid: p.id.clone(), variant });
    }
    out
}

/// (wygrane z ludźmi, wygrane z botem) z nagrodą dziś
async fn wins_today(c: &mut Conn, uid: i64) -> sqlx::Result<(i64, i64)> {
    let row: Option<(i32, i32)> = sqlx::query_as("SELECT wins, bot_wins FROM arena_daily WHERE user_id = $1 AND day = $2")
        .bind(uid)
        .bind(today().to_string())
        .fetch_optional(c)
        .await?;
    Ok(row.map_or((0, 0), |(a, b)| (a.into(), b.into())))
}

/// Czy zwycięzca dostaje nagrodę: mecz skończony z czasem; z człowiekiem także po poddaniu / walkowerze rywala,
/// ale dopiero po `min_reward_secs` gry (żeby nie dało się nabijać nagród szybkim poddawaniem)
pub fn earns(mode: Mode, reason: Option<EndReason>, played: f64, min_secs: i64) -> bool {
    match (mode, reason) {
        (_, Some(EndReason::Time)) => true,
        (Mode::Pvp, Some(EndReason::Surrender | EndReason::Away)) => played >= min_secs as f64,
        _ => false,
    }
}

/// Koniec meczu: nagrody w groszach (w dziennym limicie), EXP i osiągnięcia. Pod zamkiem Areny, więc nagroda nie
/// zostanie przyznana dwa razy; zapis w jednej transakcji z blokadą graczy.
async fn arena_record(st: &AppState, b: &mut Battle) -> sqlx::Result<()> {
    if b.game.over.is_none() || b.recorded {
        return Ok(());
    }
    b.recorded = true;
    let s = rules::data().settings.clone();
    let day = today().to_string();
    let mode = b.game.mode;
    let played = b.game.finished_at.unwrap_or_else(now) - b.game.started;
    let ok_end = earns(mode, b.game.reason, played, s.min_reward_secs);
    let mut tx = st.db.begin().await?;
    lock_users(&mut tx, &b.users).await?;
    for k in Side::BOTH {
        let Some(uid) = b.user_of(k) else { continue };
        let (pvp, bot) = wins_today(&mut tx, uid).await?;
        let mut r = Reward::today(pvp, bot);
        if mode == Mode::Pvp && b.game.reason == Some(EndReason::Time) {
            crate::exp::award(&mut tx, uid, "arena_play", 1).await?;
        }
        if b.game.over == Some(Outcome::Won(k)) {
            if !ok_end {
                r.note = Some("Bez nagrody: mecz skończył się za szybko".into());
            } else {
                let (done, limit, money) = if mode == Mode::Pvp { (pvp, s.daily_pvp, s.reward_pvp) } else { (bot, s.daily_bot, s.reward_bot) };
                let finisher = b.game.last_ko.as_ref().filter(|(side, _)| *side == k).map(|(_, pid)| pid.as_str());
                crate::achievements::count_arena(&mut tx, uid, finisher).await?;
                crate::exp::award(&mut tx, uid, if mode == Mode::Pvp { "arena_win" } else { "arena_bot" }, 1).await?;
                r.exp = true;
                if done >= limit {
                    r.note = Some("Dzienny limit nagród w Arenie wyczerpany".into());
                } else {
                    let col = if mode == Mode::Pvp { 1 } else { 0 };
                    sqlx::query(
                        "INSERT INTO arena_daily (user_id, day, wins, bot_wins, earned) VALUES ($1, $2, $3, $4, $5)
                         ON CONFLICT (user_id, day) DO UPDATE SET wins = arena_daily.wins + $3, bot_wins = arena_daily.bot_wins + $4,
                         earned = arena_daily.earned + $5",
                    )
                    .bind(uid)
                    .bind(&day)
                    .bind(col)
                    .bind(1 - col)
                    .bind(money)
                    .execute(&mut *tx)
                    .await?;
                    if money > 0 {
                        add_state(&mut tx, uid, "balance", money).await?;
                        add_state(&mut tx, uid, "earned", money).await?;
                        crate::game::pay_game_euro(&mut tx, uid, money).await?;
                    }
                    r.money = money;
                    if mode == Mode::Pvp {
                        r.pvp_wins += 1;
                    } else {
                        r.bot_wins += 1;
                    }
                }
            }
        }
        b.rewards[k.idx()] = Some(r);
    }
    tx.commit().await
}

#[derive(Serialize)]
struct BattleReply<'a> {
    #[serde(flatten)]
    battle: BattleView<'a>,
    /// tajne karty widoczne w meczu - prawdziwe dane, choć gracz ich jeszcze nie odkrył
    reveal: IndexMap<String, PublicPerson>,
    #[serde(skip_serializing_if = "Option::is_none")]
    balance: Option<i64>,
}

/// Karty widoczne dla strony (bez ręki rywala)
fn visible_pids(game: &Game, me: Side) -> Vec<String> {
    let mine = game.team(me);
    let foe = game.team(me.other());
    mine.hand.iter().chain(&mine.board).chain(&mine.ko).chain(&foe.board).chain(&foe.ko).map(|u| u.pid.clone()).collect()
}

async fn arena_reply(st: &AppState, me: &User, b: &mut Battle, side: Side, since: usize) -> Res {
    let cat = st.cat();
    arena_record(st, b).await?;
    let mut c = st.db.acquire().await?;
    let found = discovered(&mut c, me.id).await?;
    let reveal = visible_pids(&b.game, side)
        .iter()
        .filter_map(|pid| cat.person(pid))
        .filter(|p| p.is_secret() && !found.contains(&p.id))
        .map(|p| (p.id.clone(), public_person(&st.images, &cat, p, true)))
        .collect();
    let balance = match b.rewards[side.idx()].as_ref().filter(|r| r.money > 0) {
        Some(_) => Some(crate::game::get_state(&mut c, me.id).await?.get("balance").copied().unwrap_or(0)),
        None => None,
    };
    ok(BattleReply { battle: b.view(side, since, now()), reveal, balance })
}

/// Nowy mecz kończy porzucony trening z komputerem (porażka, bez nagród). true = trwa pojedynek z graczem.
async fn arena_abandon(st: &AppState, arena: &mut Arena, uid: i64) -> sqlx::Result<bool> {
    while let Some(id) = arena.active_battle(uid).map(|b| b.id.clone()) {
        let b = arena.battles.get_mut(&id).expect("mecz z listy");
        if b.game.mode != Mode::Bot {
            return Ok(true);
        }
        if let Some(k) = b.side_of_user(uid) {
            b.game.surrender(k, now());
        }
        arena_record(st, b).await?;
    }
    Ok(false)
}

/// Sprawdzane co kilka sekund: wyzwania od innych graczy, odpowiedź na moje wyzwanie, trwający mecz
pub async fn arena_inbox(State(st): State<AppState>, ArenaUser(me): ArenaUser) -> Res {
    let (pvp, bot) = wins_today(&mut *st.db.acquire().await?, me.id).await?;
    let mut arena = st.arena.inner.lock().await;
    let active = arena.active_battle(me.id).map(|b| b.id.clone());
    let battle = active.and_then(|id| arena.battles.get_mut(&id)).map(|b| {
        if let Some(k) = b.side_of_user(me.id) {
            b.touch_seen(k);
        }
        json!({"id": b.id, "mode": b.game.mode})
    });
    let (incoming, outgoing) = arena.challenges_for(me.id);
    ok(json!({"incoming": incoming, "outgoing": outgoing, "battle": battle, "rewards": Reward::today(pvp, bot)}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct DeckRequest {
    deck: Vec<String>,
}

fn new_game(mode: Mode, names: [(String, Option<i64>); 2], decks: [Vec<Entry>; 2], first: Side) -> Game {
    let d = rules::data();
    Game::new(mode, d.settings.clone(), d.meta.combos.clone(), names, decks, first, now())
}

/// Trening z komputerem
pub async fn arena_start(State(st): State<AppState>, ArenaUser(me): ArenaUser, JsonBody(req): JsonBody<DeckRequest>) -> Res {
    let cat = st.cat();
    let d = rules::data();
    let mut c = st.db.acquire().await?;
    let deck = arena_deck(&mut c, &cat, me.id, &req.deck).await?.ok_or_else(|| AppError::bad(deck_error(d.settings.deck_size)))?;
    let found = discovered(&mut c, me.id).await?;
    drop(c);
    let mut arena = st.arena.inner.lock().await;
    if arena_abandon(&st, &mut arena, me.id).await? {
        return bad("Masz trwający pojedynek z graczem");
    }
    arena.cleanup();
    let bot = bot_deck(&cat, &deck, &found);
    let first = if rand::random::<bool>() { Side::A } else { Side::B };
    let game = new_game(
        Mode::Bot,
        [(me.username.clone(), Some(me.id)), ("Komputer".into(), None)],
        [entries(&cat, &d, &deck), entries(&cat, &d, &bot)],
        first,
    );
    let id = token();
    let mut b = Battle::new(id.clone(), game, [hero(&cat, &me), Hero::computer()], [Some(me.id), None]);
    b.advance();
    arena.battles.insert(id.clone(), b);
    let b = arena.battles.get_mut(&id).expect("nowy mecz");
    arena_reply(&st, &me, b, Side::A, 0).await
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct SinceQuery {
    since: usize,
}

pub async fn arena_battle(State(st): State<AppState>, ArenaUser(me): ArenaUser, Path(bid): Path<String>, Query(q): Query<SinceQuery>) -> Res {
    let mut arena = st.arena.inner.lock().await;
    let b = arena.battles.get_mut(&bid).ok_or_else(gone)?;
    let side = b.side_of_user(me.id).ok_or_else(gone)?;
    b.touch_seen(side);
    b.advance();
    arena_reply(&st, &me, b, side, q.since).await
}

/// Ruch gracza
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Move {
    Place { uid: i64, row: usize },
    Retreat { uid: i64 },
    Use { uid: i64, ab: usize, target: Option<i64>, target2: Option<i64> },
    End,
    Surrender,
}

#[derive(Deserialize)]
pub struct ActRequest {
    #[serde(flatten)]
    action: Move,
    /// wpisy dziennika, które przeglądarka już pokazała
    #[serde(default)]
    since: usize,
}

pub async fn arena_act(State(st): State<AppState>, ArenaUser(me): ArenaUser, Path(bid): Path<String>, JsonBody(req): JsonBody<ActRequest>) -> Res {
    let mut arena = st.arena.inner.lock().await;
    let b = arena.battles.get_mut(&bid).ok_or_else(gone)?;
    let side = b.side_of_user(me.id).ok_or_else(gone)?;
    b.touch_seen(side);
    b.advance();
    let t = now();
    let g = &mut b.game;
    let result: Result<(), ArenaError> = match req.action {
        Move::Surrender if g.over.is_none() => {
            g.surrender(side, t);
            Ok(())
        }
        _ if g.over.is_some() => Err(ArenaError("Mecz już się skończył".into())),
        Move::Surrender => Ok(()),
        Move::Place { uid, row } => g.place(side, uid, row, t),
        Move::Retreat { uid } => g.retreat(side, uid, t),
        Move::Use { uid, ab, target, target2 } => g.use_ability(side, uid, ab, target, target2, t),
        Move::End => g.end_turn(side, t),
    };
    result.map_err(|e| AppError::bad(e.0))?;
    b.advance();
    arena_reply(&st, &me, b, side, req.since).await
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ChallengeRequest {
    username: String,
    deck: Vec<String>,
}

/// Wyzwanie innego gracza na pojedynek (z jego profilu)
pub async fn arena_challenge(State(st): State<AppState>, ArenaUser(me): ArenaUser, JsonBody(req): JsonBody<ChallengeRequest>) -> Res {
    let cat = st.cat();
    let n = rules::data().settings.deck_size;
    let mut c = st.db.acquire().await?;
    let Some(target) = find_user(&mut c, &req.username).await?.filter(|t| t.banned == 0) else {
        return fail(StatusCode::NOT_FOUND, "Nie ma takiego gracza");
    };
    if target.id == me.id {
        return bad("Nie możesz wyzwać samego siebie");
    }
    if !has_access(&target) {
        return bad(format!("Arena jest na razie tylko dla adminów — {} nie ma do niej dostępu", target.username));
    }
    let deck = arena_deck(&mut c, &cat, me.id, &req.deck).await?.ok_or_else(|| AppError::bad(deck_error(n)))?;
    drop(c);
    let mut arena = st.arena.inner.lock().await;
    for uid in [me.id, target.id] {
        if arena.active_battle(uid).is_some_and(|b| b.game.mode == Mode::Pvp) {
            return bad(if uid == me.id { "Masz trwający pojedynek".to_owned() } else { format!("{} właśnie walczy z kimś innym", target.username) });
        }
    }
    let challenge = arena.new_challenge(me.id, target.id, hero(&cat, &me), hero(&cat, &target), deck);
    ok(challenge.view())
}

pub async fn arena_accept(State(st): State<AppState>, ArenaUser(me): ArenaUser, Path(cid): Path<String>, JsonBody(req): JsonBody<DeckRequest>) -> Res {
    let cat = st.cat();
    let d = rules::data();
    let mut arena = st.arena.inner.lock().await;
    arena.cleanup();
    let expired = || AppError::with_status(StatusCode::NOT_FOUND, "To wyzwanie już wygasło");
    let from = arena.challenges.get(&cid).filter(|c| c.to == me.id).map(|c| c.from).ok_or_else(expired)?;
    let mut c = st.db.acquire().await?;
    let deck = arena_deck(&mut c, &cat, me.id, &req.deck).await?.ok_or_else(|| AppError::bad(deck_error(d.settings.deck_size)))?;
    let rival = user_by_id(&mut c, from).await?;
    drop(c);
    if arena.challenges[&cid].status != ChallengeStatus::Pending {
        return bad("To wyzwanie jest już nieaktualne");
    }
    let Some(rival) = rival.filter(|r| r.banned == 0) else { return fail(StatusCode::NOT_FOUND, "Nie ma takiego gracza") };
    for uid in [me.id, rival.id] {
        if arena_abandon(&st, &mut arena, uid).await? {
            return bad("Ktoś z was ma już trwający pojedynek");
        }
    }
    let challenge = arena.challenges.get_mut(&cid).ok_or_else(expired)?;
    challenge.status = ChallengeStatus::Accepted;
    let rival_deck = challenge.deck.clone();
    let first = if rand::random::<bool>() { Side::A } else { Side::B };
    let game = new_game(
        Mode::Pvp,
        [(rival.username.clone(), Some(rival.id)), (me.username.clone(), Some(me.id))],
        [entries(&cat, &d, &rival_deck), entries(&cat, &d, &deck)],
        first,
    );
    let id = token();
    let b = Battle::new(id.clone(), game, [hero(&cat, &rival), hero(&cat, &me)], [Some(rival.id), Some(me.id)]);
    arena.battles.insert(id.clone(), b);
    if let Some(challenge) = arena.challenges.get_mut(&cid) {
        challenge.battle = Some(id.clone());
    }
    ok(json!({"battle": id}))
}

/// Odrzucenie wyzwania (przez wyzwanego) albo wycofanie (przez wyzywającego)
pub async fn arena_decline(State(st): State<AppState>, ArenaUser(me): ArenaUser, Path(cid): Path<String>) -> Res {
    let mut arena = st.arena.inner.lock().await;
    let challenge = arena
        .challenges
        .get_mut(&cid)
        .filter(|c| c.from == me.id || c.to == me.id)
        .ok_or_else(|| AppError::with_status(StatusCode::NOT_FOUND, "To wyzwanie już wygasło"))?;
    if challenge.status == ChallengeStatus::Pending {
        challenge.status = if me.id == challenge.to { ChallengeStatus::Declined } else { ChallengeStatus::Cancelled };
    }
    ok(challenge.view())
}

/// Jawne statystyki areny karty (podgląd karty). Admin widzi też ukryte cechy.
pub fn card_json(d: &ArenaData, p: &Person, admin: bool) -> Value {
    let s = d.stats(p);
    let class = d.meta.classes.iter().find(|c| c.id == s.class).map(|c| c.name.clone());
    let spec = d.meta.spec(&s.spec).map(|x| x.name.clone());
    let mut v = json!({
        "id": p.id, "atk": s.atk, "hp": s.hp, "class": class, "spec": spec, "range": [s.range_min, s.range_max],
        "points": d.points(p, &s), "abilities": s.abilities,
    });
    if admin {
        v["traits"] = json!(TRAITS
            .iter()
            .filter_map(|(k, n)| s.traits.get(*k).map(|val| json!({"trait": n, "value": val})))
            .collect::<Vec<_>>());
    }
    v
}

pub async fn arena_card(State(st): State<AppState>, ArenaUser(me): ArenaUser, Path(pid): Path<String>) -> Res {
    let cat = st.cat();
    let Some(p) = cat.person(&pid) else { return fail(StatusCode::NOT_FOUND, "Nie ma takiej karty") };
    // tajna karta, której gracz nie odkrył: bez statystyk
    if p.is_secret() && !me.admin() && !discovered(&mut *st.db.acquire().await?, me.id).await?.contains(&p.id) {
        return bad("Najpierw odkryj tę kartę");
    }
    ok(card_json(&rules::data(), p, me.admin()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves() {
        let r: ActRequest = serde_json::from_str(r#"{"type": "use", "uid": 3, "ab": 1, "target": 105, "since": 4}"#).unwrap();
        assert!(matches!(r.action, Move::Use { uid: 3, ab: 1, target: Some(105), target2: None }) && r.since == 4);
        let r: ActRequest = serde_json::from_str(r#"{"type": "place", "uid": 2, "row": 1}"#).unwrap();
        assert!(matches!(r.action, Move::Place { uid: 2, row: 1 }));
        assert!(serde_json::from_str::<ActRequest>(r#"{"type": "jump"}"#).is_err());
    }

    #[test]
    fn rewards_only_for_proper_end() {
        assert!(earns(Mode::Bot, Some(EndReason::Time), 10.0, 120));
        assert!(!earns(Mode::Bot, Some(EndReason::Surrender), 500.0, 120));
        assert!(!earns(Mode::Pvp, Some(EndReason::Surrender), 60.0, 120));
        assert!(earns(Mode::Pvp, Some(EndReason::Away), 130.0, 120));
    }
}
