//! Quest (domyślnie wyłączony, włącza admin w panelu): jeden wspólny cel dla wszystkich graczy - zdobyć konkretną kartę
//! od Epickiej wzwyż: Epicką zawsze w rzadkim wariancie, wyższą zwykłą albo w wariancie (losowo). Kto pierwszy, dostaje
//! tę samą kartę w wariancie Wanted i tyle groszy, ile jest warta; dla reszty zadanie przepada.
//!
//! Quest trwa `DURATION` (24 h), potem losuje się nowy; wypełniony - nowy po `AFTER_WIN` (6 h) od wypełnienia.
//! Losuje się przy pierwszym zapytaniu po tym czasie (`daily_quests`, klucz = kolejny numer `q<n>`). Liczą się tylko karty, które
//! dopiero powstają (skrzynki, kuźnia, ulepszacz, kasyno) - kupno na rynku albo wymiana nie wypełnia questa, inaczej
//! wygrywałby ten, kto akurat ma najwięcej pieniędzy.

use std::collections::{BTreeSet, HashMap, HashSet};

use axum::extract::State;
use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{ok, JsonBody};
use crate::achievements::{self, parts};
use crate::auth::Admin;
use crate::catalog::{Catalog, Crate, Person};
use crate::data::g;
use crate::db::{now, Conn};
use crate::error::{bad, Res};
use crate::game::{add_state, insert_plain, log_admin, Ctx};
use crate::state::AppState;

pub const REWARD_VARIANT: &str = "wanted";
const ENABLED_KEY: &str = "quests_enabled";
/// karty, które wypełniają questa: nowe, nie z rynku, wymiany ani nagród
const SOURCES: [&str; 4] = ["drop", "contract", "upgrade", "casino"];
/// rzadkości kart do questa; Epicka tylko w wariancie
const RARITIES: [&str; 4] = ["purple", "red", "gold", "ultra"];
const EPIC: &str = "purple";
/// najmniejsza szansa na trafienie celu z jednej skrzynki - niżej quest byłby praktycznie niewykonalny
const MIN_ODDS: f64 = 1e-5;
/// „rzadki wariant”: szansa na wariant przy wypadnięciu karty
const VARIANT_CHANCE: (f64, f64) = (0.002, 0.02);
const HISTORY: i64 = 14;
/// jak długo trwa quest i po jakim czasie od wypełnienia pojawia się nowy (sekundy)
const DURATION: f64 = 24.0 * 3600.0;
const AFTER_WIN: f64 = 6.0 * 3600.0;

#[derive(sqlx::FromRow)]
struct QuestRow {
    day: String,
    person_id: Option<String>,
    variant: Option<String>,
    winner_id: Option<i64>,
    won_at: Option<f64>,
    won_person: Option<String>,
    money: i64,
    starts_at: Option<f64>,
    ends_at: Option<f64>,
}

impl QuestRow {
    /// Kiedy pojawi się następny quest: 6 h po wypełnieniu albo po końcu tego (stare questy dzienne bez czasu - od razu)
    fn next_at(&self) -> f64 {
        match self.won_at.filter(|_| self.winner_id.is_some()) {
            Some(at) => at + AFTER_WIN,
            None => self.ends_at.unwrap_or(0.0),
        }
    }
}

const COLUMNS: &str = "day, person_id, variant, winner_id, won_at, won_person, money, starts_at, ends_at";
/// najnowszy quest (stare dzienne nie mają starts_at - idą na koniec)
const LATEST: &str = "ORDER BY starts_at DESC NULLS LAST, day DESC";

async fn enabled(c: &mut Conn) -> sqlx::Result<bool> {
    let v: Option<i64> = sqlx::query_scalar("SELECT value FROM state WHERE key = $1").bind(ENABLED_KEY).fetch_optional(c).await?;
    Ok(v.unwrap_or(0) != 0)
}

/// Szansa na tę kartę z jednej skrzynki (wśród kart tej rzadkości wszystkie są równie prawdopodobne)
fn card_odds(cat: &Catalog, cr: &Crate, p: &Person) -> f64 {
    let people: Vec<_> = cat.crate_people(cr).filter(|x| !x.is_special()).collect();
    let present: HashSet<&str> = people.iter().map(|x| x.rarity.as_str()).collect();
    let total: f64 = present.iter().map(|r| cr.weight(r)).sum();
    let same = people.iter().filter(|x| x.rarity == p.rarity).count() as f64;
    if total > 0.0 && same > 0.0 { cr.weight(&p.rarity) / total / same } else { 0.0 }
}

/// Karty, o które może być quest, z wariantami, w których teraz naprawdę wypadają: skrzynka jest w sklepie, karta w niej jest,
/// wariant włączony i przypięty do tej skrzynki, a szansa na trafienie nie jest niemal zerowa (MIN_ODDS).
fn candidates(cat: &Catalog) -> Vec<(String, bool, Vec<String>)> {
    let gd = g();
    let shop: Vec<_> = cat.crates.values().filter(|c| c.shop && !c.restricted).collect();
    let (lo, hi) = VARIANT_CHANCE;
    let mut out = vec![];
    for p in cat.people.values().filter(|p| RARITIES.contains(&p.rarity.as_str())) {
        let (mut best, mut variants) = (0.0_f64, vec![]);
        for cr in shop.iter().filter(|c| p.crates.contains(&c.id)) {
            let odds = card_odds(cat, cr, p);
            best = best.max(odds);
            variants.extend(cat.drop_variants(cr, Some(p)).0.into_iter().filter(|v| {
                let x = gd.variant(v);
                !x.combo
                    && !x.special
                    && !x.layer
                    && !x.always
                    && x.extra_source.as_deref() != Some("quest")
                    && (lo..=hi).contains(&x.chance)
                    && odds * x.chance >= MIN_ODDS
            }));
        }
        variants.sort();
        variants.dedup();
        // epicka sama w sobie to za mało: bez wariantu quest byłby za łatwy
        let plain = p.rarity != EPIC && best >= MIN_ODDS;
        if plain || !variants.is_empty() {
            out.push((p.id.clone(), plain, variants));
        }
    }
    out
}

/// Cel questa: konkretna karta; epicka zawsze w rzadkim wariancie, wyższe zwykłe albo w wariancie (losowo)
fn pick(cat: &Catalog) -> Option<(Option<String>, Option<String>)> {
    let list = candidates(cat);
    let mut rng = rand::thread_rng();
    let (pid, plain, variants) = list.choose(&mut rng)?;
    let variant = if *plain && rng.gen_bool(0.5) { None } else { variants.choose(&mut rng).cloned() };
    Some((Some(pid.clone()), variant))
}

async fn latest(c: &mut Conn) -> sqlx::Result<Option<QuestRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!("SELECT {COLUMNS} FROM daily_quests {LATEST} LIMIT 1"))).fetch_optional(c).await
}

/// Klucz następnego questa: q<n+1> po q<n> (po starych dziennych - q1). Dwa zapytania naraz liczą ten sam klucz,
/// więc `ON CONFLICT` zostawia jeden quest.
fn next_key(prev: Option<&QuestRow>) -> String {
    let n = prev.and_then(|r| r.day.strip_prefix('q')?.parse::<u64>().ok()).unwrap_or(0);
    format!("q{}", n + 1)
}

/// Aktualny quest (trwający albo wypełniony, dopóki nie minie AFTER_WIN); po jego czasie pierwsze zapytanie losuje nowy.
/// None = questy wyłączone albo nie ma czego losować.
async fn current(c: &mut Conn, cat: &Catalog) -> sqlx::Result<Option<QuestRow>> {
    if !enabled(&mut *c).await? {
        return Ok(None);
    }
    let prev = latest(&mut *c).await?;
    let now = now();
    if prev.as_ref().is_some_and(|r| now < r.next_at()) {
        return Ok(prev);
    }
    let Some((person, variant)) = pick(cat) else { return Ok(None) };
    sqlx::query(
        "INSERT INTO daily_quests (day, person_id, variant, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (day) DO NOTHING",
    )
    .bind(next_key(prev.as_ref()))
    .bind(person)
    .bind(variant)
    .bind(now)
    .bind(now + DURATION)
    .execute(&mut *c)
    .await?;
    latest(c).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestView {
    day: String,
    person: Option<String>,
    variant: Option<String>,
    /// nagroda w groszach (karta w dowolnym wariancie: dopiero po zdobyciu wiadomo, która)
    reward: Option<i64>,
    done: bool,
    mine: bool,
    winner: Option<String>,
    won_person: Option<String>,
    money: i64,
    /// czasy w sekundach: start, koniec (bez wypełnienia), wypełnienie, następny quest
    starts_at: Option<f64>,
    ends_at: Option<f64>,
    won_at: Option<f64>,
    next_at: f64,
}

fn reward_for(cat: &Catalog, pid: &str) -> Option<i64> {
    cat.person(pid).map(|p| p.value(REWARD_VARIANT))
}

async fn view(c: &mut Conn, cat: &Catalog, r: QuestRow, uid: i64) -> sqlx::Result<QuestView> {
    let winner: Option<String> = match r.winner_id {
        Some(id) => sqlx::query_scalar("SELECT username FROM users WHERE id = $1").bind(id).fetch_optional(c).await?,
        None => None,
    };
    Ok(QuestView {
        reward: r.person_id.as_deref().and_then(|p| reward_for(cat, p)),
        done: r.winner_id.is_some(),
        mine: r.winner_id == Some(uid),
        next_at: r.next_at(),
        day: r.day,
        person: r.person_id,
        variant: r.variant,
        winner,
        won_person: r.won_person,
        money: r.money,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        won_at: r.won_at,
    })
}

/// Aktualny quest dla /api/me
pub async fn quest_view(c: &mut Conn, cat: &Catalog, uid: i64) -> sqlx::Result<Option<QuestView>> {
    match current(&mut *c, cat).await? {
        Some(r) => Ok(Some(view(c, cat, r, uid).await?)),
        None => Ok(None),
    }
}

/// Po każdej nowej karcie: czy to cel trwającego, jeszcze niewypełnionego questa. Pierwszy wygrywa - `UPDATE` z warunkiem
/// `winner_id IS NULL` zadziała tylko dla jednego gracza, nawet gdy dwóch trafi kartę w tej samej chwili.
pub async fn after_item(c: &mut Conn, cx: &Ctx, pid: &str, variant: &str, source: &str) -> sqlx::Result<()> {
    if !SOURCES.contains(&source) || variant == REWARD_VARIANT {
        return Ok(());
    }
    let open: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT day, person_id, variant FROM daily_quests WHERE winner_id IS NULL AND ends_at > $1 ORDER BY starts_at DESC LIMIT 1",
    )
    .bind(now())
    .fetch_optional(&mut *c)
    .await?;
    let Some((key, want_person, want_variant)) = open else { return Ok(()) };
    let fits =
        want_person.as_deref().is_none_or(|p| p == pid) && want_variant.as_deref().is_none_or(|v| parts(variant).contains(&v));
    let Some(money) = reward_for(&cx.cat, pid).filter(|_| fits) else { return Ok(()) };
    let won = sqlx::query(
        "UPDATE daily_quests SET winner_id = $1, won_at = $2, won_person = $3, money = $4 WHERE day = $5 AND winner_id IS NULL",
    )
    .bind(cx.uid())
    .bind(now())
    .bind(pid)
    .bind(money)
    .bind(key)
    .execute(&mut *c)
    .await?
    .rows_affected();
    if won == 1 {
        insert_plain(c, cx, pid, REWARD_VARIANT, "quest").await?;
        add_state(c, cx.uid(), "balance", money).await?;
        achievements::count_quest(c, cx.uid()).await?;
    }
    Ok(())
}

async fn history(c: &mut Conn, cat: &Catalog, uid: i64) -> sqlx::Result<Vec<QuestView>> {
    let rows: Vec<QuestRow> =
        sqlx::query_as(sqlx::AssertSqlSafe(format!("SELECT {COLUMNS} FROM daily_quests {LATEST} LIMIT {HISTORY}")))
            .fetch_all(&mut *c)
            .await?;
    let mut out = vec![];
    for r in rows {
        out.push(view(c, cat, r, uid).await?);
    }
    Ok(out)
}

pub async fn admin_quests(State(st): State<AppState>, Admin(me): Admin) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let on = enabled(&mut c).await?;
    let now_quest = if on { current(&mut c, &cat).await? } else { None };
    let list = candidates(&cat);
    let (cards, variants): (usize, BTreeSet<&String>) = (list.len(), list.iter().flat_map(|c| &c.2).collect());
    let names: HashMap<&str, &str> = cat.people.values().map(|p| (p.id.as_str(), p.name.as_str())).collect();
    let list = history(&mut c, &cat, me.id).await?;
    let label = |q: &QuestView| match (&q.person, &q.variant) {
        (Some(p), Some(v)) => format!("{} w wariancie {}", names.get(p.as_str()).copied().unwrap_or(p), g().variant(v).name),
        (Some(p), None) => names.get(p.as_str()).copied().unwrap_or(p).to_owned(),
        (_, Some(v)) => format!("dowolna karta w wariancie {}", g().variant(v).name),
        _ => String::new(),
    };
    let history: Vec<_> = list
        .iter()
        .map(|q| {
            json!({"day": q.day, "startsAt": q.starts_at, "wonAt": q.won_at, "target": label(q), "winner": q.winner, "money": q.money})
        })
        .collect();
    ok(json!({
        "enabled": on,
        "nextAt": now_quest.as_ref().map(QuestRow::next_at),
        "done": now_quest.as_ref().is_some_and(|q| q.winner_id.is_some()),
        "history": history,
        "cards": cards,
        "variants": variants.len(),
    }))
}

#[derive(Deserialize)]
pub struct QuestSettings {
    enabled: Option<bool>,
    #[serde(default)]
    reroll: bool,
}

/// Usuwa trwający, niewypełniony quest (następne zapytanie losuje nowy)
async fn drop_open(c: &mut Conn) -> sqlx::Result<()> {
    if let Some(r) = latest(&mut *c).await?.filter(|r| r.winner_id.is_none()) {
        sqlx::query("DELETE FROM daily_quests WHERE day = $1 AND winner_id IS NULL").bind(r.day).execute(c).await?;
    }
    Ok(())
}

pub async fn admin_quests_save(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<QuestSettings>) -> Res {
    let mut tx = st.db.begin().await?;
    if let Some(on) = req.enabled {
        sqlx::query("INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
            .bind(ENABLED_KEY)
            .bind(i64::from(on))
            .execute(&mut *tx)
            .await?;
        if !on {
            drop_open(&mut tx).await?; // po wyłączeniu nikt nie może już wypełnić trwającego questa
        }
        log_admin(&mut tx, &me, "quests", None, if on { "włączone" } else { "wyłączone" }).await?;
    } else if req.reroll {
        if latest(&mut tx).await?.is_some_and(|r| r.winner_id.is_some() && now() < r.next_at()) {
            return bad("Ten quest jest już wypełniony - nowy pojawi się sam");
        }
        drop_open(&mut tx).await?;
        log_admin(&mut tx, &me, "quests", None, "nowy cel").await?;
    }
    tx.commit().await?;
    ok(json!({"ok": true}))
}
