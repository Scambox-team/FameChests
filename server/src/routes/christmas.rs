//! Wspólna choinka eventu świątecznego (event `swieta`, od 1 do 24 grudnia; razem z kalendarzem adwentowym z `events.rs`).
//!
//! Każdego dnia eventu każdy gracz może POWIESIĆ na choince jedną kartę ze swojego ekwipunku. Powieszona karta trafia do ESCROW
//! (tabela `tree_cards` pamięta właściciela) i NIE WRACA do gracza: do końca TEGO SAMEGO dnia można ją jeszcze zdjąć (wtedy
//! slot dnia znów jest wolny), potem jest już w puli choinki. Choinka zapełnia się wspólnie, a karty wszystkich graczy widać po
//! kliknięciu w nią.
//!
//! Po ostatnim dniu eventu (rozliczenie leniwie przy pierwszym zapytaniu `/api/me` po północy, raz: tabela `tree_settled`):
//! 1. PULA: wszystkie powieszone karty trafiają do INNYCH graczy, którzy coś powiesili (`assign_pool`: każda karta losuje
//!    odbiorcę z wagą = łączna wartość kart, które powiesił; własna karta nie wraca do właściciela, o ile jest ktoś inny). Im
//!    więcej wartych kart powiesisz, tym większa szansa na więcej i lepszych kart z puli.
//! 2. ZWROT: każdy gracz dostaje dodatkowo `BONUS_PCT` (110%) wartości swoich powieszonych kart w losowych kartach w wariantach z
//!    listy dropów eventu (`drops`: Śnieżny, Sugar Cane, Lodowy, Choinka, Świąteczny, Prezentowy; waga wariantu = jego szansa w
//!    evencie), spośród kart dostępnych w grze (`Person::forge`). Wartość kart jest zawsze NIE MNIEJSZA niż 110% (zaokrąglenie w
//!    górę: `draw_rewards` dobiera ostatnią kartę z nadwyżką), więc nikt nie wychodzi na minus, nawet gdy pula mu nic nie da.
//! 3. KARTA SPECJALNA Z CHOINKI: każdy gracz z wkładem dostaje po jednym egzemplarzu każdej karty specjalnej ze źródłem
//!    `tree` (`specialSources` w game.json; dziś Święty Mikołaj z Miry w wariancie Jolly, `sp_mikolaj_z_miry`). Nowa taka
//!    karta (admin: źródło „Choinka”) trafia do graczy sama, bez zmian w kodzie.
//!
//! Funkcja jest WYŁĄCZONA dla graczy (ustawienie `christmas_enabled` w tabeli `state`, domyślnie 0), admini widzą ją zawsze.
//! Admin może w panelu (Eventy) ustawić datę testową (`christmas_test_date`, RRRRMMDD), którą widzi tylko on, wymusić rozliczenie
//! i wyczyścić choinkę po próbach (karty wracają do właścicieli, bez nagród).

use std::sync::atomic::{AtomicBool, Ordering};

use axum::extract::State;
use chrono::NaiveDate;
use rand::Rng;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{ok, JsonBody};
use crate::auth::{Admin, Me, User};
use crate::catalog::Catalog;
use crate::data::g;
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, Res};
use crate::events::{day_start, today as real_today, GameEvent};
use crate::game::{give_items, insert_for, log_admin, ESCROW};
use crate::state::AppState;

pub const EVENT_ID: &str = "swieta";
/// Ile procent wartości swoich powieszonych kart gracz dostaje (co najmniej) w losowych kartach z wariantów eventu
pub const BONUS_PCT: i64 = 110;
/// Do tylu kart zwrot losuje „normalnie” (karta ważona ceną), potem dopełnia najdroższymi, na które starcza budżetu
const SOFT_CAP: usize = 120;
/// Absolutny limit kart zwrotu dla jednego gracza
const HARD_CAP: usize = 400;
/// Przechył losowania ku droższym kartom (waga karty = wartość^wykładnik)
const PRICE_EXP: f64 = 0.6;
/// Ile kart pokazać na choince (najnowsze)
const LIST_MAX: usize = 400;
/// Źródło kart specjalnych wydawanych z choinki (klucz w `specialSources`)
pub const SPECIAL_SOURCE: &str = "tree";

const ENABLED: &str = "christmas_enabled";
const TEST_DATE: &str = "christmas_test_date";

static DONE: AtomicBool = AtomicBool::new(false);

fn parse_day(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()
}

fn fmt_day(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

pub fn event(cat: &Catalog) -> Option<&GameEvent> {
    cat.vs.game_events.iter().find(|e| e.id == EVENT_ID && e.enabled)
}

async fn setting(c: &mut Conn, key: &str) -> sqlx::Result<i64> {
    super::snake::setting(c, key, 0).await
}

/// Czy choinka i kalendarz są włączone dla graczy
pub async fn enabled(c: &mut Conn) -> sqlx::Result<bool> {
    Ok(setting(c, ENABLED).await? == 1)
}

/// Funkcja dostępna dla tego gracza: włączona dla wszystkich albo gracz jest adminem
pub async fn available(c: &mut Conn, me: &User) -> sqlx::Result<bool> {
    Ok(me.admin() || enabled(c).await?)
}

async fn test_day(c: &mut Conn) -> sqlx::Result<Option<NaiveDate>> {
    let v = setting(c, TEST_DATE).await?;
    Ok(if v > 0 { NaiveDate::from_ymd_opt((v / 10_000) as i32, (v / 100 % 100) as u32, (v % 100) as u32) } else { None })
}

/// „Dziś” dla gracza: prawdziwa data, a dla admina z ustawioną datą testową - ona
pub async fn today_for(c: &mut Conn, me: &User) -> sqlx::Result<NaiveDate> {
    if me.admin() {
        if let Some(d) = test_day(c).await? {
            return Ok(d);
        }
    }
    Ok(real_today())
}

/// Czy dzień `d` mieści się w evencie
fn within(e: &GameEvent, d: NaiveDate) -> bool {
    matches!((parse_day(&e.start), parse_day(&e.end)), (Some(s), Some(en)) if s <= d && d <= en)
}

/// Numer dnia eventu (1 = dzień startu)
pub fn day_number(e: &GameEvent, d: NaiveDate) -> i64 {
    parse_day(&e.start).map_or(0, |s| (d - s).num_days() + 1)
}

/// Stan dla kafelka eventu na stronie startowej: (dostępne dla mnie, trwa wg mojego „dziś”)
pub async fn tile_state(c: &mut Conn, cat: &Catalog, me: &User) -> sqlx::Result<Value> {
    let Some(e) = event(cat) else { return Ok(json!({"available": false, "running": false})) };
    let on = enabled(c).await?;
    let avail = on || me.admin();
    let d = today_for(c, me).await?;
    Ok(json!({"available": avail, "adminOnly": avail && !on, "running": within(e, d), "tree": true}))
}

// ---------------------------------------------------------------- losowanie nagród

#[derive(Debug, Clone)]
pub struct Cand {
    pub pid: String,
    pub variant: String,
    pub value: i64,
}

/// Wybór indeksu z wagami (wagi > 0)
fn pick_weighted(weights: &[f64], rng: &mut impl Rng) -> usize {
    let total: f64 = weights.iter().sum();
    let mut roll = rng.gen_range(0.0..total.max(f64::MIN_POSITIVE));
    for (i, w) in weights.iter().enumerate() {
        if roll < *w {
            return i;
        }
        roll -= w;
    }
    weights.len().saturating_sub(1)
}

/// Budżet zwrotu: `BONUS_PCT` procent wartości, zaokrąglone w górę
pub fn bonus_budget(value: i64) -> i64 {
    (value.max(0) * BONUS_PCT + 99) / 100
}

/// Losuje karty o łącznej wartości NIE MNIEJSZEJ niż `budget` groszy (zaokrąglenie w górę): najpierw wariant (waga = szansa
/// wariantu w evencie), potem karta spośród tych, na które starcza reszty budżetu, z wagą wartość^PRICE_EXP (drożej = częściej).
/// Po `SOFT_CAP` kartach reszta budżetu idzie w najdroższe karty, na które starcza, a gdy nic już nie starcza, a coś zostało,
/// dochodzi najtańsza karta losowego wariantu - to ona daje nadwyżkę. Zwraca indeksy w `cands`.
pub fn draw_rewards(cands: &[Cand], variants: &[(String, f64)], budget: i64, rng: &mut impl Rng) -> Vec<usize> {
    let mut out = Vec::new();
    let mut left = budget;
    while left > 0 && out.len() < SOFT_CAP {
        let aff: Vec<usize> = (0..cands.len()).filter(|i| cands[*i].value <= left && cands[*i].value > 0).collect();
        if aff.is_empty() {
            break;
        }
        // warianty, w których coś jeszcze starcza
        let vs: Vec<&(String, f64)> = variants.iter().filter(|(v, _)| aff.iter().any(|i| &cands[*i].variant == v)).collect();
        if vs.is_empty() {
            break;
        }
        let v = &vs[pick_weighted(&vs.iter().map(|x| x.1).collect::<Vec<_>>(), rng)].0;
        let mine: Vec<usize> = aff.into_iter().filter(|i| &cands[*i].variant == v).collect();
        let pick = mine[pick_weighted(&mine.iter().map(|i| (cands[*i].value as f64).powf(PRICE_EXP)).collect::<Vec<_>>(), rng)];
        left -= cands[pick].value;
        out.push(pick);
    }
    while left > 0 && out.len() < HARD_CAP {
        let best = (0..cands.len()).filter(|i| cands[*i].value > 0 && cands[*i].value <= left).max_by_key(|i| cands[*i].value);
        let Some(i) = best else { break };
        left -= cands[i].value;
        out.push(i);
    }
    if left > 0 && !variants.is_empty() {
        let v = &variants[pick_weighted(&variants.iter().map(|x| x.1).collect::<Vec<_>>(), rng)].0;
        let cheapest = (0..cands.len()).filter(|i| &cands[*i].variant == v && cands[*i].value > 0).min_by_key(|i| cands[*i].value);
        out.extend(cheapest);
    }
    out
}

/// Pula choinki: każda powieszona karta (właściciel) trafia do jednego z INNYCH graczy z wkładem. `weights` = (gracz, łączna
/// wartość jego powieszonych kart); szansa na kartę jest proporcjonalna do wagi. Jeśli poza właścicielem nie ma nikogo, karta
/// zostaje przy nim. Zwraca odbiorców w kolejności `owners`.
pub fn assign_pool(owners: &[i64], weights: &[(i64, f64)], rng: &mut impl Rng) -> Vec<i64> {
    owners
        .iter()
        .map(|owner| {
            let others: Vec<&(i64, f64)> = weights.iter().filter(|(u, w)| u != owner && *w > 0.0).collect();
            if others.is_empty() {
                *owner
            } else {
                others[pick_weighted(&others.iter().map(|x| x.1).collect::<Vec<_>>(), rng)].0
            }
        })
        .collect()
}

/// Pula losowania: karty dostępne w grze (nie tajne, nie specjalne) w wariantach z dropów eventu
fn pool(cat: &Catalog, e: &GameEvent) -> (Vec<Cand>, Vec<(String, f64)>) {
    let variants: Vec<(String, f64)> =
        e.drops.iter().filter(|d| d.chance > 0.0 && g().variants.contains_key(&d.variant)).map(|d| (d.variant.clone(), d.chance)).collect();
    let mut cands = Vec::new();
    for p in cat.people.values().filter(|p| p.forge && !p.is_special() && !p.is_secret()) {
        for (v, _) in &variants {
            cands.push(Cand { pid: p.id.clone(), variant: v.clone(), value: p.value(v) });
        }
    }
    cands.sort_by(|a, b| (&a.pid, &a.variant).cmp(&(&b.pid, &b.variant)));
    (cands, variants)
}

// ---------------------------------------------------------------- rozliczenie

/// Rozlicza event raz: karty z choinki rozdaje innym graczom, a każdemu z wkładem dodaje zwrot 110%. true = rozliczone teraz.
async fn settle_event(c: &mut Conn, cat: &Catalog, e: &GameEvent) -> sqlx::Result<bool> {
    let fresh = sqlx::query("INSERT INTO tree_settled (event_id, at) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(&e.id)
        .bind(now())
        .execute(&mut *c)
        .await?
        .rows_affected();
    if fresh == 0 {
        return Ok(false);
    }
    let rows: Vec<(i64, i64, String, String, i64)> = sqlx::query_as(
        "SELECT item_id, user_id, person_id, variant, value FROM tree_cards WHERE event_id = $1 AND returned = 0 ORDER BY item_id",
    )
    .bind(&e.id)
    .fetch_all(&mut *c)
    .await?;
    // wkład graczy
    let mut totals: Vec<(i64, i64, i64)> = Vec::new(); // (gracz, liczba kart, wartość)
    for r in &rows {
        match totals.iter_mut().find(|t| t.0 == r.1) {
            Some(t) => {
                t.1 += 1;
                t.2 += r.4;
            }
            None => totals.push((r.1, 1, r.4)),
        }
    }
    totals.sort_by_key(|t| t.0);
    let names: std::collections::HashMap<i64, String> = sqlx::query_as::<_, (i64, String)>("SELECT id, username FROM users WHERE id = ANY($1)")
        .bind(totals.iter().map(|t| t.0).collect::<Vec<_>>())
        .fetch_all(&mut *c)
        .await?
        .into_iter()
        .collect();
    // pula: karta -> inny gracz z wkładem, im większy wkład, tym większa szansa
    let weights: Vec<(i64, f64)> = totals.iter().map(|t| (t.0, t.2 as f64)).collect();
    let owners: Vec<i64> = rows.iter().map(|r| r.1).collect();
    let recipients = {
        let mut rng = rand::thread_rng();
        assign_pool(&owners, &weights, &mut rng)
    };
    let mut pool_for: std::collections::HashMap<i64, Vec<Value>> = std::collections::HashMap::new();
    for (r, to) in rows.iter().zip(&recipients) {
        give_items(c, cat, &[r.0], *to, "transfer").await?;
        pool_for.entry(*to).or_default().push(json!({
            "person": r.2, "variant": r.3, "value": r.4, "from": names.get(&r.1).cloned().unwrap_or_default(),
        }));
    }
    sqlx::query("UPDATE tree_cards SET returned = 1 WHERE event_id = $1").bind(&e.id).execute(&mut *c).await?;
    // zwrot 110% w losowych kartach z wariantów eventu (+ karta specjalna)
    let (cands, variants) = pool(cat, e);
    for (uid, count, value) in totals {
        let budget = bonus_budget(value);
        let picks = {
            let mut rng = rand::thread_rng();
            draw_rewards(&cands, &variants, budget, &mut rng)
        };
        let mut bonus: Vec<Value> = Vec::new();
        for i in picks {
            let cd = &cands[i];
            insert_for(c, cat, uid, false, &cd.pid, &cd.variant, "advent").await?;
            bonus.push(json!({"person": cd.pid, "variant": cd.variant, "value": cd.value}));
        }
        for cd in special_cards(cat) {
            insert_for(c, cat, uid, false, &cd.pid, &cd.variant, "tree").await?;
            bonus.push(json!({"person": cd.pid, "variant": cd.variant, "value": cd.value, "special": true}));
        }
        let cards = json!({"bonus": bonus, "pool": pool_for.remove(&uid).unwrap_or_default()});
        sqlx::query(
            "INSERT INTO tree_results (event_id, user_id, hung, value, budget, cards, settled_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING",
        )
        .bind(&e.id)
        .bind(uid)
        .bind(count)
        .bind(value)
        .bind(budget)
        .bind(cards.to_string())
        .bind(now())
        .execute(&mut *c)
        .await?;
    }
    Ok(true)
}

/// Karty specjalne z choinki: każda karta rzadkości Specjalnej ze źródłem `tree` w swoim jedynym wariancie (kolejność stała)
pub fn special_cards(cat: &Catalog) -> Vec<Cand> {
    let mut out: Vec<Cand> = cat
        .people
        .values()
        .filter(|p| p.is_special() && p.source.as_deref() == Some(SPECIAL_SOURCE))
        .map(|p| Cand { pid: p.id.clone(), variant: p.fixed().to_owned(), value: p.value(p.fixed()) })
        .collect();
    out.sort_by(|a, b| a.pid.cmp(&b.pid));
    out
}

/// Po zakończeniu eventu rozlicza choinkę (raz; woła /api/me). Błędy nie przerywają zapytania gracza.
pub async fn settle_due(st: &AppState) {
    if DONE.load(Ordering::Relaxed) {
        return;
    }
    let cat = st.cat();
    let Some(e) = event(&cat) else { return };
    if (now() as i64) < e.span().1 {
        return;
    }
    let res: anyhow::Result<()> = async {
        let mut tx = st.db.begin().await?;
        settle_event(&mut tx, &cat, e).await?;
        tx.commit().await?;
        Ok(())
    }
    .await;
    match res {
        Ok(()) => DONE.store(true, Ordering::Relaxed),
        Err(err) => tracing::warn!("choinka: rozliczenie nie powiodło się: {err:#}"),
    }
}

/// Nierozliczone powiadomienie o wyniku choinki (dla /api/me): ile powieszono, co wróciło i co wylosowano
pub async fn notes(c: &mut Conn, cat: &Catalog, uid: i64) -> sqlx::Result<Option<Value>> {
    let row: Option<(String, i64, i64, i64, String)> =
        sqlx::query_as("SELECT event_id, hung, value, budget, cards FROM tree_results WHERE user_id = $1 AND seen = 0 ORDER BY settled_at LIMIT 1")
            .bind(uid)
            .fetch_optional(&mut *c)
            .await?;
    Ok(row.map(|(event, hung, value, budget, cards)| result_json(cat, &event, hung, value, budget, &cards)))
}

fn result_json(cat: &Catalog, event: &str, hung: i64, value: i64, budget: i64, cards: &str) -> Value {
    let v: Value = serde_json::from_str(cards).unwrap_or_default();
    let list = |k: &str| -> Vec<Value> { v.get(k).and_then(Value::as_array).cloned().unwrap_or_default() };
    let view = |r: &Value| {
        let pid = r["person"].as_str().unwrap_or("");
        let var = r["variant"].as_str().unwrap_or("normal");
        json!({"person": pid, "variant": var, "name": cat.person(pid).map(|p| p.name.clone()).unwrap_or_default(),
               "variantName": g().variant(var).name, "value": r["value"], "special": r["special"].as_bool().unwrap_or(false),
               "from": r["from"].as_str().unwrap_or("")})
    };
    let (bonus, pool) = (list("bonus"), list("pool"));
    let sum = |l: &[Value]| l.iter().filter_map(|r| r["value"].as_i64()).sum::<i64>();
    json!({"event": event, "hung": hung, "value": value, "budget": budget,
           "rewards": bonus.iter().map(view).collect::<Vec<_>>(), "rewardsValue": sum(&bonus),
           "pool": pool.iter().map(view).collect::<Vec<_>>(), "poolValue": sum(&pool)})
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct SeenRequest {}

pub async fn christmas_seen(State(st): State<AppState>, Me(me): Me, JsonBody(_): JsonBody<SeenRequest>) -> Res {
    sqlx::query("UPDATE tree_results SET seen = 1 WHERE user_id = $1").bind(me.id).execute(&st.db).await?;
    ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- choinka dla graczy

pub async fn tree_view(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    ok(view(&mut c, &cat, &me).await?)
}

async fn view(c: &mut Conn, cat: &Catalog, me: &User) -> sqlx::Result<Value> {
    let on = enabled(c).await?;
    let Some(e) = event(cat).filter(|_| on || me.admin()) else { return Ok(json!({"available": false})) };
    let d = today_for(c, me).await?;
    let (cards, players, value): (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COUNT(DISTINCT user_id), COALESCE(SUM(value), 0)::BIGINT FROM tree_cards WHERE event_id = $1",
    )
    .bind(&e.id)
    .fetch_one(&mut *c)
    .await?;
    let mine: Vec<(i64, String, String, String, i64, i32)> = sqlx::query_as(
        "SELECT item_id, person_id, variant, day, value, returned FROM tree_cards WHERE event_id = $1 AND user_id = $2 ORDER BY day DESC, item_id DESC",
    )
    .bind(&e.id)
    .bind(me.id)
    .fetch_all(&mut *c)
    .await?;
    let today = fmt_day(d);
    let my_value: i64 = mine.iter().map(|m| m.4).sum();
    let all: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT t.person_id, t.variant, u.username, t.day FROM tree_cards t JOIN users u ON u.id = t.user_id WHERE t.event_id = $1
         ORDER BY t.hung_at DESC LIMIT $2",
    )
    .bind(&e.id)
    .bind(LIST_MAX as i64)
    .fetch_all(&mut *c)
    .await?;
    let settled: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM tree_settled WHERE event_id = $1)").bind(&e.id).fetch_one(&mut *c).await?;
    let result: Option<(i64, i64, i64, String)> = sqlx::query_as("SELECT hung, value, budget, cards FROM tree_results WHERE event_id = $1 AND user_id = $2")
        .bind(&e.id)
        .bind(me.id)
        .fetch_optional(&mut *c)
        .await?;
    let variants: Vec<_> = e.drops.iter().filter(|x| g().variants.contains_key(&x.variant)).collect();
    Ok(json!({
        "available": true, "adminPreview": !on, "testDate": me.admin() && test_day(c).await?.is_some(),
        "event": {"id": e.id, "name": e.name, "start": e.start, "end": e.end},
        "today": today, "running": within(e, d), "day": day_number(e, d), "days": parse_day(&e.start).zip(parse_day(&e.end)).map_or(0, |(s, en)| (en - s).num_days() + 1),
        "endsAt": day_start(d.succ_opt().unwrap_or(d)),
        "sharePct": BONUS_PCT, "settled": settled,
        "pool": variants.iter().map(|x| json!({"variant": x.variant, "name": g().variant(&x.variant).name})).collect::<Vec<_>>(),
        "tree": {"cards": cards, "players": players, "value": value},
        "mine": {
            "count": mine.iter().filter(|m| m.5 == 0).count(), "value": my_value, "budget": bonus_budget(my_value),
            "hungToday": mine.iter().any(|m| m.3 == today && m.5 == 0),
            "hung": mine.iter().map(|m| json!({"item": m.0, "person": m.1, "variant": m.2, "day": m.3, "value": m.4,
                                               "canTake": m.3 == today && m.5 == 0 && !settled})).collect::<Vec<_>>(),
        },
        "cards": all.iter().map(|a| json!({"person": a.0, "variant": a.1, "user": a.2, "day": a.3})).collect::<Vec<_>>(),
        "cardsShown": all.len(),
        "result": result.map(|(hung, value, budget, cards)| result_json(cat, &e.id, hung, value, budget, &cards)),
    }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ItemRequest {
    item: i64,
}

pub async fn tree_hang(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<ItemRequest>) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if !available(&mut tx, &me).await? {
        return bad("Choinka jeszcze nie jest dostępna");
    }
    let Some(e) = event(&cat) else { return bad("Choinki teraz nie ma") };
    let d = today_for(&mut tx, &me).await?;
    if !within(e, d) {
        return bad("Choinka jest dostępna tylko w czasie eventu");
    }
    let settled: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM tree_settled WHERE event_id = $1)").bind(&e.id).fetch_one(&mut *tx).await?;
    if settled {
        return bad("Choinka została już rozliczona");
    }
    let today = fmt_day(d);
    let used: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tree_cards WHERE event_id = $1 AND user_id = $2 AND day = $3 AND returned = 0")
        .bind(&e.id)
        .bind(me.id)
        .bind(&today)
        .fetch_one(&mut *tx)
        .await?;
    if used > 0 {
        return bad("Dziś już powiesiłeś kartę na choince. Możesz ją zdjąć do końca dnia i powiesić inną.");
    }
    let row: Option<(String, String, i32)> =
        sqlx::query_as("SELECT person_id, variant, favorite FROM items WHERE id = $1 AND user_id = $2 FOR UPDATE").bind(req.item).bind(me.id).fetch_optional(&mut *tx).await?;
    let Some((pid, variant, fav)) = row else { return bad("Nie masz tej karty") };
    let Some(p) = cat.person(&pid) else { return bad("Nie ma takiej karty") };
    if p.is_special() {
        return bad("Kart specjalnych nie można powiesić na choince");
    }
    if fav != 0 {
        return bad("Ulubionej karty nie można powiesić. Najpierw zdejmij ją z ulubionych.");
    }
    let value = p.value(&variant);
    sqlx::query("UPDATE items SET user_id = $2 WHERE id = $1").bind(req.item).bind(ESCROW).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO tree_cards (item_id, user_id, event_id, day, person_id, variant, value, hung_at, returned) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)",
    )
    .bind(req.item)
    .bind(me.id)
    .bind(&e.id)
    .bind(&today)
    .bind(&pid)
    .bind(&variant)
    .bind(value)
    .bind(now())
    .execute(&mut *tx)
    .await?;
    let v = view(&mut tx, &cat, &me).await?;
    tx.commit().await?;
    ok(v)
}

pub async fn tree_take(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<ItemRequest>) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, me.id).await?;
    if !available(&mut tx, &me).await? {
        return bad("Choinka jeszcze nie jest dostępna");
    }
    let Some(e) = event(&cat) else { return bad("Choinki teraz nie ma") };
    let today = fmt_day(today_for(&mut tx, &me).await?);
    let gone = sqlx::query("DELETE FROM tree_cards WHERE item_id = $1 AND user_id = $2 AND event_id = $3 AND day = $4 AND returned = 0")
        .bind(req.item)
        .bind(me.id)
        .bind(&e.id)
        .bind(&today)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if gone == 0 {
        return bad("Zdjąć można tylko kartę powieszoną dziś");
    }
    sqlx::query("UPDATE items SET user_id = $2 WHERE id = $1 AND user_id = $3").bind(req.item).bind(me.id).bind(ESCROW).execute(&mut *tx).await?;
    let v = view(&mut tx, &cat, &me).await?;
    tx.commit().await?;
    ok(v)
}

/// Usuwany gracz: jego powieszone karty znikają razem z nim, wyniki i wpisy choinki też
pub async fn christmas_forget_user(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM items WHERE user_id = $2 AND id IN (SELECT item_id FROM tree_cards WHERE user_id = $1 AND returned = 0)")
        .bind(uid)
        .bind(ESCROW)
        .execute(&mut *c)
        .await?;
    sqlx::query("DELETE FROM tree_cards WHERE user_id = $1").bind(uid).execute(&mut *c).await?;
    sqlx::query("DELETE FROM tree_results WHERE user_id = $1").bind(uid).execute(&mut *c).await?;
    Ok(())
}

// ---------------------------------------------------------------- panel admina (zakładka Eventy)

async fn admin_view(c: &mut Conn, cat: &Catalog) -> sqlx::Result<Value> {
    let (cards, players, value): (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COUNT(DISTINCT user_id), COALESCE(SUM(value), 0)::BIGINT FROM tree_cards WHERE event_id = $1 AND returned = 0",
    )
    .bind(EVENT_ID)
    .fetch_one(&mut *c)
    .await?;
    let settled: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM tree_settled WHERE event_id = $1)").bind(EVENT_ID).fetch_one(&mut *c).await?;
    Ok(json!({
        "enabled": enabled(c).await?,
        "testDate": test_day(c).await?.map(fmt_day).unwrap_or_default(),
        "event": event(cat).map(|e| json!({"name": e.name, "start": e.start, "end": e.end})),
        "tree": {"cards": cards, "players": players, "value": value},
        "settled": settled, "sharePct": BONUS_PCT, "specialCards": special_cards(cat).iter().map(|c| json!({"person": c.pid, "name": cat.person(&c.pid).map(|p| p.name.clone()), "variant": c.variant})).collect::<Vec<_>>(),
    }))
}

pub async fn admin_christmas(State(st): State<AppState>, Admin(_): Admin) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    ok(admin_view(&mut c, &cat).await?)
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AdminRequest {
    enabled: Option<bool>,
    /// RRRR-MM-DD albo pusty = bez daty testowej
    test_date: Option<String>,
    /// "settle" = rozlicz teraz, "reset" = zwróć wszystkie karty i wyczyść choinkę
    action: Option<String>,
}

pub async fn admin_christmas_save(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<AdminRequest>) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    let mut log = Vec::new();
    if let Some(on) = req.enabled {
        super::snake::put_setting(&mut tx, ENABLED, on as i64).await?;
        log.push(format!("włączona dla graczy: {}", if on { "tak" } else { "nie" }));
    }
    if let Some(s) = &req.test_date {
        let v = if s.trim().is_empty() {
            0
        } else {
            let Some(d) = parse_day(s) else { return bad("Data testowa: podaj RRRR-MM-DD") };
            d.format("%Y%m%d").to_string().parse::<i64>().unwrap_or(0)
        };
        super::snake::put_setting(&mut tx, TEST_DATE, v).await?;
        log.push(format!("data testowa: {}", if v == 0 { "brak".to_owned() } else { s.trim().to_owned() }));
    }
    match req.action.as_deref() {
        Some("settle") => {
            let Some(e) = event(&cat) else { return bad("Event świąteczny jest wyłączony albo go nie ma") };
            if !settle_event(&mut tx, &cat, e).await? {
                return bad("Choinka jest już rozliczona");
            }
            log.push("rozliczenie choinki teraz".into());
        }
        Some("reset") => {
            sqlx::query("UPDATE items SET user_id = t.user_id FROM tree_cards t WHERE items.id = t.item_id AND items.user_id = $1 AND t.returned = 0")
                .bind(ESCROW)
                .execute(&mut *tx)
                .await?;
            sqlx::query("DELETE FROM tree_cards").execute(&mut *tx).await?;
            sqlx::query("DELETE FROM tree_results").execute(&mut *tx).await?;
            sqlx::query("DELETE FROM tree_settled").execute(&mut *tx).await?;
            log.push("wyczyszczenie choinki (karty wróciły do graczy, bez nagród)".into());
        }
        Some(_) => return bad("Nieznana akcja"),
        None => {}
    }
    if !log.is_empty() {
        log_admin(&mut tx, &me, "christmas", None, &log.join(", ")).await?;
    }
    let v = admin_view(&mut tx, &cat).await?;
    tx.commit().await?;
    DONE.store(false, Ordering::Relaxed);
    ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    fn cands() -> Vec<Cand> {
        let mut v = Vec::new();
        for (i, value) in [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120].into_iter().enumerate() {
            for var in ["snow", "tree"] {
                v.push(Cand { pid: format!("p{i}"), variant: var.into(), value });
            }
        }
        v
    }

    fn weights() -> Vec<(String, f64)> {
        vec![("snow".into(), 3.0), ("tree".into(), 1.0)]
    }

    /// Karta specjalna z choinki (Święty Mikołaj z Miry, Jolly) jest w katalogu, a Gwiazdkowa z kalendarza nie trafia do choinki
    #[test]
    fn tree_special_card_comes_from_the_catalog() {
        let cat = crate::catalog::build_on(&[], &[], &[], NaiveDate::from_ymd_opt(2026, 12, 10).unwrap(), 3);
        let cards = special_cards(&cat);
        assert_eq!(cards.len(), 1, "dokładnie jedna karta ze źródłem tree");
        assert_eq!((cards[0].pid.as_str(), cards[0].variant.as_str()), ("sp_mikolaj_z_miry", "jolly"));
        let advent = cat.person("sp_mikolaj").expect("karta Mikołaja z kalendarza");
        assert_eq!((advent.source.as_deref(), advent.fixed()), (Some("advent"), "gwiazdkowy"));
        // dzień 24 kalendarza: ta karta + Świąteczna skrzynka z pieniędzmi 50 000 - 100 000 gr
        let e = cat.vs.game_events.iter().find(|e| e.id == EVENT_ID).expect("event swieta");
        let day24 = &e.advent.as_ref().expect("kalendarz")[23];
        assert!(day24.iter().any(|r| r["type"] == "card" && r["person"] == "sp_mikolaj" && r["variant"] == "gwiazdkowy"));
        assert!(day24.iter().any(|r| r["type"] == "chest" && r["kind"] == "money_swiateczna"));
        let m = &g().money_chests["swiateczna"];
        assert_eq!((m.min, m.max), (50_000, 100_000));
        assert_eq!(e.end, "2026-12-24");
        assert_eq!(e.advent.as_ref().unwrap().len(), 24);
    }

    #[test]
    fn budget_rounds_up() {
        assert_eq!(bonus_budget(100), 110);
        assert_eq!(bonus_budget(15), 17); // 16,5 -> 17
        assert_eq!(bonus_budget(1), 2); // 1,1 -> 2
        assert_eq!(bonus_budget(0), 0);
    }

    #[test]
    fn rewards_are_never_below_the_budget() {
        let c = cands();
        let mut rng = StdRng::seed_from_u64(7);
        for budget in [1, 5, 11, 100, 111, 1000, 7777, 100_000, 1_000_000] {
            for _ in 0..50 {
                let picks = draw_rewards(&c, &weights(), budget, &mut rng);
                let sum: i64 = picks.iter().map(|i| c[*i].value).sum();
                assert!(sum >= budget, "budżet {budget}, wylosowano tylko {sum}");
                // nadwyżka to co najwyżej jedna najtańsza karta (zaokrąglenie w górę), poza limitem kart przy ogromnych budżetach
                if budget < 1_000_000 {
                    assert!(sum - budget < 10 + 5120, "za duża nadwyżka: budżet {budget}, suma {sum}");
                }
            }
        }
        assert!(draw_rewards(&c, &weights(), 0, &mut rng).is_empty());
    }

    #[test]
    fn overshoot_is_small_for_big_budgets() {
        let c = cands();
        let mut rng = StdRng::seed_from_u64(11);
        for _ in 0..100 {
            let picks = draw_rewards(&c, &weights(), 20_000, &mut rng);
            let sum: i64 = picks.iter().map(|i| c[*i].value).sum();
            assert!(sum >= 20_000 && sum - 20_000 <= 10, "suma {sum}");
        }
    }

    #[test]
    fn bigger_budget_means_more_and_pricier_cards() {
        let c = cands();
        let stats = |budget: i64| {
            let mut rng = StdRng::seed_from_u64(42);
            let (mut n, mut best) = (0usize, 0i64);
            for _ in 0..300 {
                let p = draw_rewards(&c, &weights(), budget, &mut rng);
                n += p.len();
                best += p.iter().map(|i| c[*i].value).max().unwrap_or(0);
            }
            (n as f64 / 300.0, best as f64 / 300.0)
        };
        let (n1, best1) = stats(200);
        let (n2, best2) = stats(5000);
        assert!(n2 > n1, "więcej kart: {n1} -> {n2}");
        assert!(best2 > best1, "droższa najlepsza karta: {best1} -> {best2}");
    }

    #[test]
    fn variant_weights_matter() {
        let c = cands();
        let mut rng = StdRng::seed_from_u64(3);
        let (mut snow, mut tree) = (0, 0);
        for _ in 0..400 {
            for i in draw_rewards(&c, &weights(), 400, &mut rng) {
                if c[i].variant == "snow" { snow += 1 } else { tree += 1 }
            }
        }
        assert!(snow > tree, "częstszy wariant wypada częściej: {snow} vs {tree}");
    }

    #[test]
    fn card_cap_is_respected() {
        let c = vec![Cand { pid: "p".into(), variant: "snow".into(), value: 1 }];
        let mut rng = StdRng::seed_from_u64(9);
        // po limicie kart dochodzi najwyżej jedna karta zaokrąglenia
        let n = draw_rewards(&c, &[("snow".into(), 1.0)], 1_000_000, &mut rng).len();
        assert!(n == HARD_CAP || n == HARD_CAP + 1, "{n} kart");
    }

    #[test]
    fn pool_never_returns_own_card_when_there_are_others() {
        let mut rng = StdRng::seed_from_u64(5);
        let owners: Vec<i64> = (0..300).map(|i| 1 + i % 3).collect();
        let w = vec![(1, 100.0), (2, 100.0), (3, 100.0)];
        let to = assign_pool(&owners, &w, &mut rng);
        assert!(owners.iter().zip(&to).all(|(o, r)| o != r));
        // jedyny gracz zatrzymuje swoje karty
        assert_eq!(assign_pool(&[7, 7], &[(7, 5.0)], &mut rng), vec![7, 7]);
    }

    #[test]
    fn pool_favours_bigger_contributors() {
        let mut rng = StdRng::seed_from_u64(21);
        // karty gracza 9 trafiają do 1 (wkład 10 000) i 2 (wkład 100) proporcjonalnie do wkładu
        let owners = vec![9; 4000];
        let to = assign_pool(&owners, &[(1, 10_000.0), (2, 100.0), (9, 500.0)], &mut rng);
        let big = to.iter().filter(|u| **u == 1).count();
        let small = to.iter().filter(|u| **u == 2).count();
        assert!(big > small * 20, "duży wkład dostaje wyraźnie więcej: {big} vs {small}");
        assert!(to.iter().all(|u| *u != 9));
    }
}
