//! Szachy (zakładka Gry): partie z graczami i trening z botem. Serwer zna zasady i pilnuje zegara - przeglądarka tylko
//! rysuje stan i wysyła ruchy. Stan partii to wiersz `chess_games` (ruchy w UCI po spacji), zegar rozliczamy przy każdym
//! zapytaniu: czas gracza na ruchu liczy się od `turn_at`. Za wygraną z graczem: daily + skrzynka szachów (limit w game.json).

use std::collections::BTreeMap;

use axum::extract::{Path, State};
use cozy_chess::{Color, Square};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{ok, JsonBody};
use crate::auth::{Admin, Me};
use crate::chess::{bot_move, can_mate, legal_uci, Finish, Position};
use crate::catalog::Crate;
use crate::data::{g, ChessSkin};
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, Res};
use crate::game::{add_chests, add_state, get_state, log_admin};
use rand::Rng;
use crate::state::AppState;

/// Partia testowa admina: `bot` = -1, ruchy obu stron z gotowego zapisu, kończy się matem na korzyść admina
const TEST_BOT: i32 = -1;
const TEST_WHITE_WINS: &str = "a2a3 a7a6 h2h3 h7h6 e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7";
const TEST_BLACK_WINS: &str = "a2a3 a7a6 h2h3 h7h6 a3a4 e7e5 b2b3 f8c5 a1a2 d8h4 a2a1 h4f2";

const INSERT_GAME: &str = "INSERT INTO chess_games (creator_id, white_id, black_id, bot, status, is_public, invite_id, creator_color, base_ms, inc_ms, white_ms, black_ms, turn_at, created_at, updated_at) \
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, $9, $11, $11, $11) RETURNING id";

#[derive(sqlx::FromRow, Clone)]
struct Game {
    id: i64,
    creator_id: i64,
    white_id: Option<i64>,
    black_id: Option<i64>,
    bot: i32,
    status: String,
    is_public: i32,
    invite_id: Option<i64>,
    creator_color: String,
    moves: String,
    base_ms: i64,
    inc_ms: i64,
    white_ms: i64,
    black_ms: i64,
    turn_at: f64,
    result: String,
    reason: String,
    draw_offer: Option<i64>,
    winner_id: Option<i64>,
    rewarded: i32,
}

impl Game {
    fn moves(&self) -> Vec<&str> {
        self.moves.split_whitespace().collect()
    }
    fn position(&self) -> Position {
        Position::replay(self.moves()).unwrap_or_else(Position::new)
    }
    fn player(&self, c: Color) -> Option<i64> {
        if c == Color::White { self.white_id } else { self.black_id }
    }
    fn color_of(&self, uid: i64) -> Option<Color> {
        if self.white_id == Some(uid) {
            Some(Color::White)
        } else if self.black_id == Some(uid) {
            Some(Color::Black)
        } else {
            None
        }
    }
    fn clock(&self, c: Color) -> i64 {
        if c == Color::White { self.white_ms } else { self.black_ms }
    }
    fn set_clock(&mut self, c: Color, ms: i64) {
        if c == Color::White { self.white_ms = ms } else { self.black_ms = ms }
    }
    /// Czas gracza na ruchu po odjęciu tego, co upłynęło od ostatniego ruchu
    fn clock_left(&self, side: Color, at: f64) -> i64 {
        self.clock(side) - ((at - self.turn_at) * 1000.0) as i64
    }
    fn timed(&self) -> bool {
        self.base_ms > 0
    }
}

async fn load(c: &mut Conn, id: i64, lock: bool) -> sqlx::Result<Option<Game>> {
    let sql = if lock { "SELECT * FROM chess_games WHERE id = $1 FOR UPDATE" } else { "SELECT * FROM chess_games WHERE id = $1" };
    sqlx::query_as(sql).bind(id).fetch_optional(c).await
}

async fn save(c: &mut Conn, x: &Game) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE chess_games SET white_id = $1, black_id = $2, status = $3, moves = $4, white_ms = $5, black_ms = $6, turn_at = $7, \
         result = $8, reason = $9, draw_offer = $10, winner_id = $11, rewarded = $12, updated_at = $13 WHERE id = $14",
    )
    .bind(x.white_id)
    .bind(x.black_id)
    .bind(&x.status)
    .bind(&x.moves)
    .bind(x.white_ms)
    .bind(x.black_ms)
    .bind(x.turn_at)
    .bind(&x.result)
    .bind(&x.reason)
    .bind(x.draw_offer)
    .bind(x.winner_id)
    .bind(x.rewarded)
    .bind(now())
    .bind(x.id)
    .execute(c)
    .await?;
    Ok(())
}

/// Nagroda tylko za partię z człowiekiem (i testową admina): trening z botem nie daje skrzynek ani groszy, nawet wygrany
fn earns_reward(bot: i32, plies: usize) -> bool {
    (bot == 0 || bot == TEST_BOT) && plies >= g().chess.min_plies
}

/// Koniec partii: wynik + nagroda dla zwycięzcy (tylko partia z człowiekiem, nie za krótka, w limicie na dobę)
async fn finish(c: &mut Conn, x: &mut Game, winner: Option<Color>, reason: &str) -> sqlx::Result<()> {
    x.status = "finished".into();
    x.reason = reason.into();
    x.draw_offer = None;
    x.result = match winner {
        Some(Color::White) => "white",
        Some(Color::Black) => "black",
        None => "draw",
    }
    .into();
    x.winner_id = winner.and_then(|w| x.player(w));
    if let Some(uid) = x.winner_id.filter(|_| earns_reward(x.bot, x.moves().len())) {
        let cfg = &g().chess;
        let won: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chess_games WHERE winner_id = $1 AND bot = 0 AND rewarded = 1 AND updated_at > $2")
            .bind(uid)
            .bind(now() - 86400.0)
            .fetch_one(&mut *c)
            .await?;
        if won < cfg.rewards_per_day || x.bot == TEST_BOT {
            add_chests(&mut *c, uid, "money_daily", 1).await?;
            let chest = if winner == Some(Color::White) { &cfg.crate_white } else { &cfg.crate_black };
            add_chests(&mut *c, uid, chest, 1).await?;
            x.rewarded = 1;
        }
    }
    save(c, x).await
}

/// Zegar: czy gracz na ruchu przekroczył czas. Przegrywa - chyba że rywal nie miałby czym dać mata (remis).
async fn check_flag(c: &mut Conn, x: &mut Game) -> sqlx::Result<()> {
    if x.status != "active" || !x.timed() {
        return Ok(());
    }
    let pos = x.position();
    let side = pos.board.side_to_move();
    if x.clock_left(side, now()) > 0 {
        return Ok(());
    }
    x.set_clock(side, 0);
    if can_mate(&pos.board, !side) {
        finish(c, x, Some(!side), "koniec czasu").await
    } else {
        finish(c, x, None, "koniec czasu, brak materiału").await
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Side {
    id: Option<i64>,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GameView {
    id: i64,
    status: String,
    white: Side,
    black: Side,
    bot: i32,
    you: Option<&'static str>,
    fen: String,
    turn: &'static str,
    /// legalne ruchy w UCI - tylko gdy to ruch tego gracza
    legal: Vec<String>,
    san: Vec<String>,
    last: Option<String>,
    check: Option<String>,
    white_ms: i64,
    black_ms: i64,
    timed: bool,
    result: String,
    reason: String,
    draw_offer: Option<&'static str>,
    rewarded: bool,
    /// założone skiny obu stron: figura -> skin
    white_skins: BTreeMap<String, String>,
    black_skins: BTreeMap<String, String>,
}

async fn name_of(c: &mut Conn, id: Option<i64>) -> sqlx::Result<String> {
    let Some(id) = id else { return Ok("?".into()) };
    Ok(sqlx::query_scalar("SELECT username FROM users WHERE id = $1").bind(id).fetch_optional(c).await?.unwrap_or_else(|| "?".to_owned()))
}

async fn view(c: &mut Conn, x: &Game, uid: i64) -> sqlx::Result<GameView> {
    let pos = x.position();
    let turn = pos.board.side_to_move();
    let you = x.color_of(uid);
    let side_name = |col: Color| if col == Color::White { "w" } else { "b" };
    let bot_name = if x.bot == TEST_BOT { "🧪 Rywal testowy".to_owned() } else { format!("🤖 Bot, poziom {}", x.bot) };
    let names = (
        if x.white_id.is_none() && x.bot != 0 { bot_name.clone() } else { name_of(c, x.white_id).await? },
        if x.black_id.is_none() && x.bot != 0 { bot_name.clone() } else { name_of(c, x.black_id).await? },
    );
    let running = x.status == "active" && x.timed();
    let left = |col: Color| if running && col == turn { x.clock_left(col, now()).max(0) } else { x.clock(col) };
    let king: Option<Square> = (!pos.board.checkers().is_empty()).then(|| pos.board.king(turn));
    Ok(GameView {
        id: x.id,
        status: x.status.clone(),
        white: Side { id: x.white_id, name: names.0 },
        black: Side { id: x.black_id, name: names.1 },
        bot: x.bot,
        you: you.map(side_name),
        fen: pos.board.to_string(),
        turn: side_name(turn),
        legal: if x.status == "active" && you == Some(turn) && x.bot != TEST_BOT { legal_uci(&pos.board) } else { vec![] },
        last: x.moves().last().map(|m| (*m).to_owned()),
        san: pos.san,
        check: king.map(|s| s.to_string()),
        white_ms: left(Color::White),
        black_ms: left(Color::Black),
        timed: x.timed(),
        result: x.result.clone(),
        reason: x.reason.clone(),
        draw_offer: x.draw_offer.map(|o| if o == uid { "me" } else { "them" }),
        rewarded: x.rewarded != 0,
        white_skins: equipped(&mut *c, x.white_id).await?,
        black_skins: equipped(&mut *c, x.black_id).await?,
    })
}

/// id, autor, nick autora, czas, kolor autora, zaproszony, publiczna
type OpenGame = (i64, i64, String, i64, String, Option<i64>, i32);

async fn my_game(c: &mut Conn, uid: i64) -> sqlx::Result<Option<i64>> {
    sqlx::query_scalar(
        "SELECT id FROM chess_games WHERE bot = 0 AND ((status = 'active' AND (white_id = $1 OR black_id = $1)) OR (status = 'open' AND creator_id = $1)) \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(uid)
    .fetch_optional(c)
    .await
}

/// Rozlicza zegary aktywnych partii gracza (porzucona partia kończy się, gdy ktoś do niej zajrzy)
async fn settle_mine(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    let ids: Vec<i64> =
        sqlx::query_scalar("SELECT id FROM chess_games WHERE status = 'active' AND bot = 0 AND (white_id = $1 OR black_id = $1)")
            .bind(uid)
            .fetch_all(&mut *c)
            .await?;
    for id in ids {
        if let Some(mut x) = load(c, id, true).await? {
            check_flag(c, &mut x).await?;
        }
    }
    Ok(())
}

pub async fn chess_lobby(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut tx = st.db.begin().await?;
    settle_mine(&mut tx, me.id).await?;
    let cfg = &g().chess;
    let since = now() - cfg.open_hours * 3600.0;
    let open: Vec<OpenGame> = sqlx::query_as(
        "SELECT g.id, g.creator_id, u.username, g.base_ms, g.creator_color, g.invite_id, g.is_public FROM chess_games g \
         JOIN users u ON u.id = g.creator_id WHERE g.status = 'open' AND g.created_at > $1 ORDER BY g.id DESC LIMIT 50",
    )
    .bind(since)
    .fetch_all(&mut *tx)
    .await?;
    let open: Vec<_> = open
        .into_iter()
        .filter(|o| o.6 != 0 || o.1 == me.id || o.5 == Some(me.id))
        .map(|o| json!({"id": o.0, "by": o.2, "mine": o.1 == me.id, "minutes": o.3 / 60000, "color": o.4, "invited": o.5 == Some(me.id)}))
        .collect();
    let active = my_game(&mut tx, me.id).await?;
    let training: Option<i64> =
        sqlx::query_scalar("SELECT id FROM chess_games WHERE status = 'active' AND bot > 0 AND creator_id = $1 ORDER BY id DESC LIMIT 1")
            .bind(me.id)
            .fetch_optional(&mut *tx)
            .await?;
    let rewarded: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chess_games WHERE winner_id = $1 AND bot = 0 AND rewarded = 1 AND updated_at > $2")
        .bind(me.id)
        .bind(now() - 86400.0)
        .fetch_one(&mut *tx)
        .await?;
    let past: Vec<Game> = sqlx::query_as(
        "SELECT * FROM chess_games WHERE status = 'finished' AND bot = 0 AND (white_id = $1 OR black_id = $1) ORDER BY updated_at DESC LIMIT 10",
    )
    .bind(me.id)
    .fetch_all(&mut *tx)
    .await?;
    let mut history = vec![];
    for x in &past {
        let rival = if x.white_id == Some(me.id) { x.black_id } else { x.white_id };
        let outcome = match x.winner_id {
            Some(w) if w == me.id => "win",
            Some(_) => "loss",
            None => "draw",
        };
        history.push(json!({"id": x.id, "rival": name_of(&mut tx, rival).await?, "outcome": outcome, "reason": x.reason, "rewarded": x.rewarded != 0}));
    }
    tx.commit().await?;
    ok(json!({"open": open, "active": active, "training": training, "history": history, "minutes": cfg.minutes,
              "rewardsLeft": (cfg.rewards_per_day - rewarded).max(0), "rewardsPerDay": cfg.rewards_per_day, "minPlies": cfg.min_plies}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct CreateRequest {
    bot: i32,
    minutes: i64,
    invite: Option<String>,
    private: bool,
}

/// Ruch bota, gdy to jego kolej (po starcie partii albo po ruchu gracza)
async fn bot_reply(c: &mut Conn, x: &mut Game) -> Res<()> {
    if x.bot <= 0 || x.status != "active" {
        return Ok(());
    }
    let pos = x.position();
    if x.player(pos.board.side_to_move()).is_some() {
        return Ok(());
    }
    let (board, level) = (pos.board.clone(), x.bot);
    let Some(mv) = tokio::task::spawn_blocking(move || bot_move(&board, level)).await.ok().flatten() else { return Ok(()) };
    apply(c, x, &mv).await?;
    Ok(())
}

/// Wykonanie sprawdzonego ruchu: zapis, zegar, koniec partii
async fn apply(c: &mut Conn, x: &mut Game, uci: &str) -> sqlx::Result<bool> {
    let mut pos = x.position();
    let side = pos.board.side_to_move();
    if pos.play(uci).is_none() {
        return Ok(false);
    }
    let at = now();
    if x.timed() {
        x.set_clock(side, x.clock_left(side, at) + x.inc_ms);
    }
    x.turn_at = at;
    x.moves = if x.moves.is_empty() { uci.to_owned() } else { format!("{} {uci}", x.moves) };
    x.draw_offer = None;
    match pos.finish() {
        Some(Finish::Mate(w)) => finish(c, x, Some(w), "mat").await?,
        Some(Finish::Draw(why)) => finish(c, x, None, why).await?,
        None => save(c, x).await?,
    }
    Ok(true)
}

pub async fn chess_create(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<CreateRequest>) -> Res {
    let cfg = &g().chess;
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let t = now();
    let color = "random".to_owned(); // kolor zawsze losowy
    if (1..=3).contains(&req.bot) {
        // trening bez zegara i bez nagród; nowa partia zastępuje poprzednią
        sqlx::query("UPDATE chess_games SET status = 'finished', result = 'draw', reason = 'porzucona', updated_at = $1 WHERE status = 'active' AND bot > 0 AND creator_id = $2")
            .bind(t)
            .bind(me.id)
            .execute(&mut *tx)
            .await?;
        let white: bool = rand::random();
        let id: i64 = sqlx::query_scalar(INSERT_GAME)
            .bind(me.id)
            .bind(white.then_some(me.id))
            .bind((!white).then_some(me.id))
            .bind(req.bot)
            .bind("active")
            .bind(0)
            .bind(None::<i64>)
            .bind(&color)
            .bind(0_i64)
            .bind(0_i64)
            .bind(t)
            .fetch_one(&mut *tx)
            .await?;
        let mut x = load(&mut tx, id, true).await?.expect("nowa partia");
        bot_reply(&mut tx, &mut x).await?;
        tx.commit().await?;
        return ok(json!({"id": id}));
    }
    if !cfg.minutes.contains(&req.minutes) {
        return bad("Nieprawidłowy czas gry");
    }
    if my_game(&mut tx, me.id).await?.is_some() {
        return bad("Masz już otwartą partię");
    }
    let invite = match req.invite.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(nick) => {
            let found: Option<i64> =
                sqlx::query_scalar("SELECT id FROM users WHERE LOWER(username) = LOWER($1)").bind(nick).fetch_optional(&mut *tx).await?;
            match found.filter(|id| *id != me.id) {
                Some(id) => Some(id),
                None => return bad("Nie ma takiego gracza"),
            }
        }
        None => None,
    };
    let id: i64 = sqlx::query_scalar(INSERT_GAME)
        .bind(me.id)
        .bind(None::<i64>)
        .bind(None::<i64>)
        .bind(0)
        .bind("open")
        .bind(i32::from(!req.private && invite.is_none()))
        .bind(invite)
        .bind(&color)
        .bind(req.minutes * 60_000)
        .bind(cfg.increment_ms)
        .bind(t)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    ok(json!({"id": id}))
}

/// Admin: partia testowa z losowym kolorem. Rusza od razu, ruchy wykonuje `chess_test_step`.
pub async fn chess_test(State(st): State<AppState>, Admin(me): Admin) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let t = now();
    sqlx::query("UPDATE chess_games SET status = 'finished', result = 'draw', reason = 'porzucona', updated_at = $1 WHERE status = 'active' AND bot = $2 AND creator_id = $3")
        .bind(t)
        .bind(TEST_BOT)
        .bind(me.id)
        .execute(&mut *tx)
        .await?;
    let white: bool = rand::random();
    let id: i64 = sqlx::query_scalar(INSERT_GAME)
        .bind(me.id)
        .bind(white.then_some(me.id))
        .bind((!white).then_some(me.id))
        .bind(TEST_BOT)
        .bind("active")
        .bind(0)
        .bind(None::<i64>)
        .bind("random")
        .bind(0_i64)
        .bind(0_i64)
        .bind(t)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    ok(json!({"id": id}))
}

/// Następny ruch partii testowej (ta sama droga co zwykły ruch: zapis, mat, nagroda)
pub async fn chess_test_step(State(st): State<AppState>, Admin(me): Admin, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    let Some(mut x) = load(&mut tx, id, true).await?.filter(|x| x.bot == TEST_BOT && x.creator_id == me.id && x.status == "active") else {
        return bad("Tej partii już nie ma");
    };
    let script = if x.white_id == Some(me.id) { TEST_WHITE_WINS } else { TEST_BLACK_WINS };
    let Some(mv) = script.split_whitespace().nth(x.moves().len()) else { return bad("Tej partii już nie ma") };
    apply(&mut tx, &mut x, mv).await?;
    let v = view(&mut tx, &x, me.id).await?;
    tx.commit().await?;
    ok(v)
}

pub async fn chess_join(State(st): State<AppState>, Me(me): Me, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let Some(mut x) = load(&mut tx, id, true).await?.filter(|x| x.status == "open") else { return bad("Tej partii już nie ma") };
    if x.creator_id == me.id {
        return bad("To twoja partia");
    }
    if x.is_public == 0 && x.invite_id != Some(me.id) {
        return bad("Ta partia jest tylko dla zaproszonego gracza");
    }
    if my_game(&mut tx, me.id).await?.is_some() {
        return bad("Masz już otwartą partię");
    }
    let creator_white: bool = rand::random();
    (x.white_id, x.black_id) = if creator_white { (Some(x.creator_id), Some(me.id)) } else { (Some(me.id), Some(x.creator_id)) };
    x.status = "active".into();
    x.turn_at = now();
    save(&mut tx, &x).await?;
    tx.commit().await?;
    ok(json!({"id": id}))
}

pub async fn chess_cancel(State(st): State<AppState>, Me(me): Me, Path(id): Path<i64>) -> Res {
    let mut c = st.db.acquire().await?;
    sqlx::query("DELETE FROM chess_games WHERE id = $1 AND creator_id = $2 AND status = 'open'").bind(id).bind(me.id).execute(&mut *c).await?;
    ok(json!({"ok": true}))
}

pub async fn chess_state(State(st): State<AppState>, Me(me): Me, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    let Some(mut x) = load(&mut tx, id, true).await? else { return bad("Tej partii już nie ma") };
    check_flag(&mut tx, &mut x).await?;
    let v = view(&mut tx, &x, me.id).await?;
    tx.commit().await?;
    ok(v)
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct MoveRequest {
    #[serde(rename = "move")]
    mv: String,
}

pub async fn chess_move(State(st): State<AppState>, Me(me): Me, Path(id): Path<i64>, JsonBody(req): JsonBody<MoveRequest>) -> Res {
    let mut tx = st.db.begin().await?;
    let Some(mut x) = load(&mut tx, id, true).await? else { return bad("Tej partii już nie ma") };
    check_flag(&mut tx, &mut x).await?;
    if x.status != "active" {
        let v = view(&mut tx, &x, me.id).await?;
        tx.commit().await?;
        return ok(v);
    }
    if x.color_of(me.id) != Some(x.position().board.side_to_move()) {
        return bad("Teraz ruch rywala");
    }
    if !apply(&mut tx, &mut x, &req.mv).await? {
        return bad("Nielegalny ruch");
    }
    bot_reply(&mut tx, &mut x).await?;
    let v = view(&mut tx, &x, me.id).await?;
    tx.commit().await?;
    ok(v)
}

pub async fn chess_resign(State(st): State<AppState>, Me(me): Me, Path(id): Path<i64>) -> Res {
    let mut tx = st.db.begin().await?;
    let Some(mut x) = load(&mut tx, id, true).await?.filter(|x| x.status == "active") else { return bad("Ta partia już się skończyła") };
    let Some(side) = x.color_of(me.id) else { return bad("To nie twoja partia") };
    finish(&mut tx, &mut x, Some(!side), "poddanie").await?;
    let v = view(&mut tx, &x, me.id).await?;
    tx.commit().await?;
    ok(v)
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct DrawRequest {
    action: String,
}

pub async fn chess_draw(State(st): State<AppState>, Me(me): Me, Path(id): Path<i64>, JsonBody(req): JsonBody<DrawRequest>) -> Res {
    let mut tx = st.db.begin().await?;
    let Some(mut x) = load(&mut tx, id, true).await?.filter(|x| x.status == "active") else { return bad("Ta partia już się skończyła") };
    if x.color_of(me.id).is_none() {
        return bad("To nie twoja partia");
    }
    if x.bot > 0 {
        return bad("Bot nie przyjmuje remisów");
    }
    match (req.action.as_str(), x.draw_offer) {
        ("offer", None) => {
            x.draw_offer = Some(me.id);
            save(&mut tx, &x).await?;
        }
        ("accept", Some(o)) if o != me.id => finish(&mut tx, &mut x, None, "zgoda").await?,
        ("decline", Some(_)) => {
            x.draw_offer = None;
            save(&mut tx, &x).await?;
        }
        _ => return bad("Nie ma takiej propozycji"),
    }
    let v = view(&mut tx, &x, me.id).await?;
    tx.commit().await?;
    ok(v)
}

// ---------------------------------------------------------------- skiny figur

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkinDrop {
    id: i64,
    skin: String,
    piece: String,
    name: String,
    rarity: String,
}

const SKIN_NAME_MAX: usize = 40;
const SKIN_DESC_MAX: usize = 200;
/// Rzadkości do wyboru w panelu admina: te, które losują się ze skrzynek (specjalna i tajna mają wagę 0)
const SKIN_RARITIES: [&str; 7] = ["green", "uncommon", "blue", "purple", "red", "gold", "ultra"];

/// Skiny z game.json ze zmianami z panelu admina (tabela chess_skin_settings)
pub async fn skin_list(c: &mut Conn) -> sqlx::Result<Vec<ChessSkin>> {
    let rows: Vec<(String, i32, String, String, String)> =
        sqlx::query_as("SELECT skin, enabled, name, rarity, description FROM chess_skin_settings").fetch_all(c).await?;
    let mut list = g().chess_skins.clone();
    for s in &mut list {
        let Some(r) = rows.iter().find(|r| r.0 == s.id) else { continue };
        s.enabled = r.1 != 0;
        if !r.2.is_empty() {
            s.name.clone_from(&r.2);
        }
        if !r.3.is_empty() {
            s.rarity.clone_from(&r.3);
        }
        if !r.4.is_empty() {
            s.desc.clone_from(&r.4);
        }
    }
    Ok(list)
}

/// Losowanie włączonego skina: rzadkość z wag skrzynki, potem równo wśród skinów tej rzadkości (każda figura skina liczy się osobno)
fn roll_skin<'a>(cr: &Crate, list: &'a [ChessSkin]) -> Option<(&'a ChessSkin, String)> {
    let on = || list.iter().filter(|s| s.enabled);
    let count = |r: &str| on().filter(|s| s.rarity == r).map(|s| s.pieces.len()).sum::<usize>() as f64;
    let entries: Vec<(&ChessSkin, &String)> = on().flat_map(|s| s.pieces.iter().map(move |p| (s, p))).collect();
    let weights: Vec<f64> = entries.iter().map(|(s, _)| cr.weight(&s.rarity) / count(&s.rarity)).collect();
    let total: f64 = weights.iter().sum();
    if total <= 0.0 {
        return None;
    }
    let mut x = rand::thread_rng().gen_range(0.0..total);
    for (e, w) in entries.iter().zip(&weights) {
        x -= w;
        if x <= 0.0 {
            return Some((e.0, e.1.clone()));
        }
    }
    entries.last().map(|e| (e.0, e.1.clone()))
}

/// Skrzynki szachów: każda otwarta skrzynka daje też skin. Inne skrzynki - nic.
pub async fn drop_skins(c: &mut Conn, uid: i64, cr: &Crate, count: i64) -> sqlx::Result<Vec<SkinDrop>> {
    let cfg = &g().chess;
    if cr.id != cfg.crate_white && cr.id != cfg.crate_black {
        return Ok(vec![]);
    }
    let skins = skin_list(&mut *c).await?;
    let mut out = vec![];
    for _ in 0..count {
        let Some((s, piece)) = roll_skin(cr, &skins) else { continue };
        let id: i64 = sqlx::query_scalar("INSERT INTO chess_skins (user_id, skin, piece, created_at) VALUES ($1, $2, $3, $4) RETURNING id")
            .bind(uid)
            .bind(&s.id)
            .bind(&piece)
            .bind(now())
            .fetch_one(&mut *c)
            .await?;
        out.push(SkinDrop { id, skin: s.id.clone(), piece, name: s.name.clone(), rarity: s.rarity.clone() });
    }
    Ok(out)
}

/// Założone skiny. Wyłączony przez admina się nie liczy (wiersz zostaje, po włączeniu wraca sam).
async fn equipped(c: &mut Conn, uid: Option<i64>) -> sqlx::Result<BTreeMap<String, String>> {
    let Some(uid) = uid else { return Ok(BTreeMap::new()) };
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT e.piece, e.skin FROM chess_equipped e LEFT JOIN chess_skin_settings s ON s.skin = e.skin \
         WHERE e.user_id = $1 AND COALESCE(s.enabled, 1) = 1",
    )
    .bind(uid)
    .fetch_all(c)
    .await?;
    Ok(rows.into_iter().collect())
}

fn skin_value(list: &[ChessSkin], skin: &str) -> i64 {
    let gd = g();
    list.iter().find(|s| s.id == skin).and_then(|s| gd.rarities.get(&s.rarity)).map_or(0, |r| r.value)
}

/// Katalog skinów, moje skiny i założone: ekwipunek (zakładka Figury) i menu szachów
pub async fn chess_skins(State(st): State<AppState>, Me(me): Me) -> Res {
    let mut c = st.db.acquire().await?;
    let rows: Vec<(i64, String, String)> =
        sqlx::query_as("SELECT id, skin, piece FROM chess_skins WHERE user_id = $1 ORDER BY id DESC").bind(me.id).fetch_all(&mut *c).await?;
    let list = skin_list(&mut c).await?;
    let owned: Vec<_> = rows.iter().map(|(id, s, p)| json!({"id": id, "skin": s, "piece": p, "value": skin_value(&list, s)})).collect();
    ok(json!({"catalog": list, "owned": owned, "equipped": equipped(&mut c, Some(me.id)).await?}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct EquipRequest {
    piece: String,
    /// puste = zwykła figura
    skin: Option<String>,
}

pub async fn chess_skin_equip(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<EquipRequest>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    match req.skin.as_deref().filter(|s| !s.is_empty()) {
        Some(skin) => {
            let has: Option<i64> = sqlx::query_scalar("SELECT id FROM chess_skins WHERE user_id = $1 AND skin = $2 AND piece = $3 LIMIT 1")
                .bind(me.id)
                .bind(skin)
                .bind(&req.piece)
                .fetch_optional(&mut *tx)
                .await?;
            if has.is_none() {
                return bad("Nie masz tego skina");
            }
            if !skin_list(&mut tx).await?.iter().any(|s| s.id == skin && s.enabled) {
                return bad("Ten skin jest wyłączony");
            }
            sqlx::query("INSERT INTO chess_equipped (user_id, piece, skin) VALUES ($1, $2, $3) ON CONFLICT (user_id, piece) DO UPDATE SET skin = excluded.skin")
                .bind(me.id)
                .bind(&req.piece)
                .bind(skin)
                .execute(&mut *tx)
                .await?;
        }
        None => {
            sqlx::query("DELETE FROM chess_equipped WHERE user_id = $1 AND piece = $2").bind(me.id).bind(&req.piece).execute(&mut *tx).await?;
        }
    }
    let on = equipped(&mut tx, Some(me.id)).await?;
    tx.commit().await?;
    ok(json!({"equipped": on}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct SellRequest {
    ids: Vec<i64>,
}

/// Sprzedaż skinów za wartość rzadkości. Założony skin schodzi z figury, gdy gracz nie ma już drugiego takiego.
pub async fn chess_skin_sell(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<SellRequest>) -> Res {
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    let sold: Vec<(String,)> = sqlx::query_as("DELETE FROM chess_skins WHERE user_id = $1 AND id = ANY($2) RETURNING skin")
        .bind(me.id)
        .bind(&req.ids)
        .fetch_all(&mut *tx)
        .await?;
    if sold.is_empty() {
        return bad("Nie masz tego skina");
    }
    let list = skin_list(&mut tx).await?;
    let total: i64 = sold.iter().map(|s| skin_value(&list, &s.0)).sum();
    add_state(&mut tx, me.id, "balance", total).await?;
    sqlx::query(
        "DELETE FROM chess_equipped e WHERE e.user_id = $1 AND NOT EXISTS \
         (SELECT 1 FROM chess_skins s WHERE s.user_id = e.user_id AND s.skin = e.skin AND s.piece = e.piece)",
    )
    .bind(me.id)
    .execute(&mut *tx)
    .await?;
    let state = get_state(&mut tx, me.id).await?;
    tx.commit().await?;
    ok(json!({"sold": sold.len(), "total": total, "state": state}))
}

/// Panel admina: wszystkie skiny z wartościami domyślnymi i tym, ile ich mają gracze
pub async fn admin_skins(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let mut c = st.db.acquire().await?;
    let owned: Vec<(String, i64, i64)> =
        sqlx::query_as("SELECT skin, COUNT(*), COUNT(DISTINCT user_id) FROM chess_skins GROUP BY skin").fetch_all(&mut *c).await?;
    let worn: Vec<(String, i64)> = sqlx::query_as("SELECT skin, COUNT(*) FROM chess_equipped GROUP BY skin").fetch_all(&mut *c).await?;
    let gd = g();
    let skins: Vec<_> = skin_list(&mut c)
        .await?
        .into_iter()
        .zip(&gd.chess_skins)
        .map(|(s, def)| {
            let own = owned.iter().find(|o| o.0 == s.id);
            json!({"id": s.id, "name": s.name, "rarity": s.rarity, "desc": s.desc, "enabled": s.enabled, "pieces": s.pieces,
                   "copies": own.map_or(0, |o| o.1), "players": own.map_or(0, |o| o.2),
                   "worn": worn.iter().find(|w| w.0 == s.id).map_or(0, |w| w.1),
                   "default": {"name": def.name, "rarity": def.rarity, "desc": def.desc}})
        })
        .collect();
    let rarities: Vec<_> = SKIN_RARITIES.iter().map(|r| json!({"id": r, "name": gd.rarities[*r].name, "value": gd.rarities[*r].value})).collect();
    ok(json!({"skins": skins, "rarities": rarities, "nameMax": SKIN_NAME_MAX, "descMax": SKIN_DESC_MAX}))
}

#[derive(Deserialize)]
pub struct SkinSave {
    id: String,
    name: String,
    rarity: String,
    desc: String,
    enabled: bool,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct SkinsSaveRequest {
    skins: Vec<SkinSave>,
}

fn clean_text(text: &str, max: usize, default: &str) -> String {
    let text: String = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect();
    if text == default { String::new() } else { text }
}

/// Zapis ustawień skinów: puste pole albo wartość domyślna = ustawienie z game.json
pub async fn admin_skins_save(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<SkinsSaveRequest>) -> Res {
    if req.skins.is_empty() {
        return bad("Brak listy skinów");
    }
    let gd = g();
    let mut tx = st.db.begin().await?;
    for r in &req.skins {
        let Some(def) = gd.chess_skins.iter().find(|s| s.id == r.id) else { return bad("Nie ma takiego skina") };
        if !SKIN_RARITIES.contains(&r.rarity.as_str()) {
            return bad("Nieprawidłowa rzadkość skina");
        }
        let rarity = if r.rarity == def.rarity { "" } else { r.rarity.as_str() };
        sqlx::query(
            "INSERT INTO chess_skin_settings (skin, enabled, name, rarity, description) VALUES ($1, $2, $3, $4, $5) \
             ON CONFLICT (skin) DO UPDATE SET enabled = excluded.enabled, name = excluded.name, rarity = excluded.rarity, description = excluded.description",
        )
        .bind(&r.id)
        .bind(i32::from(r.enabled))
        .bind(clean_text(&r.name, SKIN_NAME_MAX, &def.name))
        .bind(rarity)
        .bind(clean_text(&r.desc, SKIN_DESC_MAX, &def.desc))
        .execute(&mut *tx)
        .await?;
    }
    let list = skin_list(&mut tx).await?;
    let off = list.iter().filter(|s| !s.enabled).map(|s| s.name.as_str()).collect::<Vec<_>>().join(", ");
    log_admin(&mut tx, &me, "chess_skins_save", None, &format!("wyłączone: {}", if off.is_empty() { "brak" } else { &off })).await?;
    tx.commit().await?;
    ok(json!({"ok": true}))
}

/// Usuwanie gracza: jego partie i skiny znikają
pub async fn chess_forget_user(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM chess_skins WHERE user_id = $1").bind(uid).execute(&mut *c).await?;
    sqlx::query("DELETE FROM chess_equipped WHERE user_id = $1").bind(uid).execute(&mut *c).await?;
    sqlx::query("DELETE FROM chess_games WHERE creator_id = $1 OR white_id = $1 OR black_id = $1 OR invite_id = $1").bind(uid).execute(c).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skiny_maja_poprawne_dane() {
        let gd = g();
        for s in &gd.chess_skins {
            assert!(gd.rarities.contains_key(&s.rarity), "{}", s.id);
            assert!(s.pieces.iter().all(|p| ["k", "q", "r", "b", "n", "p"].contains(&p.as_str())), "{}", s.id);
            assert!(skin_value(&gd.chess_skins, &s.id) > 0);
            assert!(SKIN_RARITIES.contains(&s.rarity.as_str()), "{}", s.id);
        }
    }

    #[test]
    fn bot_nie_daje_nagrod() {
        let enough = g().chess.min_plies;
        for level in 1..=3 {
            assert!(!earns_reward(level, 200));
        }
        assert!(earns_reward(0, enough));
        assert!(!earns_reward(0, enough - 1));
    }

    #[test]
    fn partia_testowa_konczy_sie_matem_i_daje_nagrode() {
        for (script, winner) in [(TEST_WHITE_WINS, Color::White), (TEST_BLACK_WINS, Color::Black)] {
            let moves: Vec<&str> = script.split_whitespace().collect();
            let pos = Position::replay(moves.iter().copied()).expect("legalne ruchy");
            assert!(matches!(pos.finish(), Some(Finish::Mate(w)) if w == winner));
            assert!(earns_reward(TEST_BOT, moves.len()));
        }
    }
}
