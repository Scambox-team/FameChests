//! Quest (domyślnie wyłączony, włącza admin w panelu): jeden wspólny cel dla wszystkich graczy - zdobyć konkretną kartę
//! od Epickiej wzwyż w wariancie o mnożniku wartości co najmniej `MIN_MULT[rzadkość]` (im rzadsza karta, tym mniejszy
//! wymagany mnożnik; ULTRA LEGENDARNA od 2x). Pasuje każdy wariant z takim mnożnikiem, także połączony (`flag+gold`).
//! Kto pierwszy, dostaje tę samą kartę w wariancie Wanted i tyle groszy, ile jest warta; dla reszty zadanie przepada.
//!
//! Quest trwa `DURATION` (24 h), potem losuje się nowy; wypełniony - nowy po `AFTER_WIN` (4 h) od wypełnienia.
//! Jedno konto może wykonać najwyżej `DAILY_LIMIT_KEY` questów (domyślnie 4) w ostatnich 24 h, OSOBNO dla każdego rodzaju questa (`Kind`: Wanted,
//! CTF): po limicie nie może już wygrać kolejnego tego rodzaju (ani karty, ani pieniędzy; quest zostaje dla innych), żeby jedna osoba
//! nie zbierała wszystkich. Nowy rodzaj questa = nowy wariant `Kind` z zapytaniem o jego wygrane w `done_today`.
//! Losuje się przy pierwszym zapytaniu po tym czasie (`daily_quests`, klucz = kolejny numer `q<n>`). Liczą się tylko karty, które
//! dopiero powstają (skrzynki, kuźnia, ulepszacz, kasyno) - kupno na rynku albo wymiana nie wypełnia questa, inaczej
//! wygrywałby ten, kto akurat ma najwięcej pieniędzy.

use std::collections::{BTreeSet, HashMap, HashSet};

use axum::extract::State;
use rand::seq::SliceRandom;
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
/// rzadkości kart do questa i najmniejszy mnożnik wariantu (`mult`), w którym trzeba taką kartę zdobyć
const MIN_MULT: [(&str, f64); 4] = [("purple", 4.0), ("red", 3.0), ("gold", 2.5), ("ultra", 2.0)];
fn min_mult(rarity: &str) -> Option<f64> {
    MIN_MULT.iter().find(|(r, _)| *r == rarity).map(|(_, m)| *m)
}
/// najmniejsza szansa na trafienie celu z jednej skrzynki - niżej quest byłby praktycznie niewykonalny
const MIN_ODDS: f64 = 1e-5;
const HISTORY: i64 = 14;
/// jak długo trwa quest i po jakim czasie od wypełnienia pojawia się nowy (sekundy)
const DURATION: f64 = 24.0 * 3600.0;
const AFTER_WIN: f64 = 4.0 * 3600.0;

/// Limit wykonanych questów na konto w ostatnich 24 h, osobno dla każdego rodzaju questa (ustawienie w `state`, panel admina „Questy”, 0 = bez limitu)
pub const DAILY_LIMIT_KEY: &str = "quests_daily_limit";
pub const DEFAULT_DAILY_LIMIT: i64 = 4;
pub const MAX_DAILY_LIMIT: i64 = 1000;

pub async fn daily_limit(c: &mut Conn) -> sqlx::Result<i64> {
    let v: Option<i64> = sqlx::query_scalar("SELECT value FROM state WHERE key = $1").bind(DAILY_LIMIT_KEY).fetch_optional(c).await?;
    Ok(v.unwrap_or(DEFAULT_DAILY_LIMIT).clamp(0, MAX_DAILY_LIMIT))
}

/// Rodzaj questa (każdy ma własny licznik limitu)
#[derive(Clone, Copy, Debug)]
pub enum Kind {
    Wanted,
    Ctf,
}

/// Ile questów danego rodzaju gracz wykonał w ostatnich 24 h
async fn done_today(c: &mut Conn, uid: i64, kind: Kind) -> sqlx::Result<i64> {
    let sql = match kind {
        Kind::Wanted => "SELECT COUNT(*) FROM daily_quests WHERE winner_id = $1 AND won_at > $2",
        Kind::Ctf => "SELECT COUNT(*) FROM ctf_quests WHERE winner_id = $1 AND won_at > $2",
    };
    sqlx::query_scalar(sql).bind(uid).bind(now() - 86400.0).fetch_one(c).await
}

/// Czy gracz wykonał już dzienny limit questów tego rodzaju (konto 0 = bot / podgląd bez gracza: nigdy)
pub async fn limit_reached(c: &mut Conn, uid: i64, kind: Kind) -> sqlx::Result<bool> {
    if uid <= 0 {
        return Ok(false);
    }
    let limit = daily_limit(c).await?;
    Ok(limit > 0 && done_today(c, uid, kind).await? >= limit)
}

#[derive(sqlx::FromRow)]
struct QuestRow {
    day: String,
    person_id: Option<String>,
    variant: Option<String>,
    min_mult: Option<f64>,
    winner_id: Option<i64>,
    won_at: Option<f64>,
    won_person: Option<String>,
    money: i64,
    starts_at: Option<f64>,
    ends_at: Option<f64>,
}

impl QuestRow {
    /// Kiedy pojawi się następny quest: 4 h po wypełnieniu albo po końcu tego (stare questy dzienne bez czasu - od razu)
    fn next_at(&self) -> f64 {
        match self.won_at.filter(|_| self.winner_id.is_some()) {
            Some(at) => at + AFTER_WIN,
            None => self.ends_at.unwrap_or(0.0),
        }
    }
}

const COLUMNS: &str = "day, person_id, variant, min_mult, winner_id, won_at, won_person, money, starts_at, ends_at";
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

/// Warianty, które liczą się do questa z danym mnożnikiem i naprawdę wypadają z tej skrzynki dla tej karty
fn qualifying(cat: &Catalog, cr: &Crate, p: &Person, min: f64) -> Vec<String> {
    let gd = g();
    cat.drop_variants(cr, Some(p))
        .0
        .into_iter()
        .filter(|v| {
            let x = gd.variant(v);
            !x.combo && !x.special && !x.layer && !x.always && x.extra_source.as_deref() != Some("quest") && x.mult >= min
        })
        .collect()
}

/// Karty, o które może być quest (z mnożnikiem i wariantami, które się liczą): skrzynka jest w sklepie, karta w niej jest,
/// a szansa na trafienie karty w pasującym wariancie nie jest niemal zerowa (MIN_ODDS) - niżej quest byłby niewykonalny.
fn candidates(cat: &Catalog) -> Vec<(String, f64, Vec<String>)> {
    let gd = g();
    let shop: Vec<_> = cat.crates.values().filter(|c| c.shop && !c.restricted).collect();
    let mut out = vec![];
    for p in cat.people.values() {
        let Some(min) = min_mult(&p.rarity) else { continue };
        let (mut best, mut variants) = (0.0_f64, vec![]);
        for cr in shop.iter().filter(|c| p.crates.contains(&c.id)) {
            let vs = qualifying(cat, cr, p, min);
            let chance: f64 = vs.iter().map(|v| gd.variant(v).chance).sum();
            best = best.max(card_odds(cat, cr, p) * chance);
            variants.extend(vs);
        }
        variants.sort();
        variants.dedup();
        if best >= MIN_ODDS {
            out.push((p.id.clone(), min, variants));
        }
    }
    out
}

/// Skrzynki z teraz otwartego sklepu (dla wszystkich graczy), z których ta karta w tym wariancie naprawdę może wypaść
fn drop_crates<'a>(cat: &'a Catalog, pid: &str, variant: Option<&str>, min: Option<f64>) -> Vec<&'a Crate> {
    let Some(p) = cat.person(pid) else { return vec![] };
    cat.crates
        .values()
        .filter(|c| c.shop && !c.restricted && p.crates.contains(&c.id))
        .filter(|c| card_odds(cat, c, p) >= MIN_ODDS)
        .filter(|c| variant.is_none_or(|v| cat.drop_variants(c, Some(p)).0.iter().any(|x| x == v)))
        .filter(|c| min.is_none_or(|m| !qualifying(cat, c, p, m).is_empty()))
        .collect()
}

/// Cel questa: konkretna karta i najmniejszy mnożnik wariantu dla jej rzadkości
fn pick(cat: &Catalog) -> Option<(String, f64)> {
    let list = candidates(cat);
    let (pid, min, _) = list.choose(&mut rand::thread_rng())?;
    Some((pid.clone(), *min))
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
    if let Some(r) = prev.as_ref().filter(|r| now < r.next_at()) {
        // quest musi dać się wykonać w sklepie: gdy cel zniknął (rotacja skrzynek, zmiana liczby skrzynek, wyłączony
        // wariant), zamykamy go i losujemy nowy - dopóki ktoś go nie wykonał
        let possible = r.person_id.as_deref().is_none_or(|p| !drop_crates(cat, p, r.variant.as_deref(), r.min_mult).is_empty());
        if r.winner_id.is_some() || possible {
            return Ok(prev);
        }
        sqlx::query("UPDATE daily_quests SET ends_at = $1 WHERE day = $2 AND winner_id IS NULL")
            .bind(now)
            .bind(&r.day)
            .execute(&mut *c)
            .await?;
    }
    let Some((person, min)) = pick(cat) else { return Ok(None) };
    sqlx::query(
        "INSERT INTO daily_quests (day, person_id, min_mult, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (day) DO NOTHING",
    )
    .bind(next_key(prev.as_ref()))
    .bind(person)
    .bind(min)
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
    /// najmniejszy mnożnik wartości wariantu, w którym trzeba zdobyć kartę (None = stary quest na konkretny wariant)
    min_mult: Option<f64>,
    /// nagroda w groszach (karta w dowolnym wariancie: dopiero po zdobyciu wiadomo, która)
    reward: Option<i64>,
    done: bool,
    mine: bool,
    /// skrzynki ze sklepu (id), z których cel teraz wypada
    crates: Vec<String>,
    winner: Option<String>,
    won_person: Option<String>,
    money: i64,
    /// czasy w sekundach: start, koniec (bez wypełnienia), wypełnienie, następny quest
    starts_at: Option<f64>,
    ends_at: Option<f64>,
    won_at: Option<f64>,
    next_at: f64,
    /// ten gracz wykonał już dzienny limit questów i nie może wygrać tego (quest zostaje dla innych)
    limit_reached: bool,
}

fn reward_for(cat: &Catalog, pid: &str) -> Option<i64> {
    cat.person(pid).map(|p| p.value(REWARD_VARIANT))
}

async fn view(c: &mut Conn, cat: &Catalog, r: QuestRow, uid: i64) -> sqlx::Result<QuestView> {
    let winner: Option<String> = match r.winner_id {
        Some(id) => sqlx::query_scalar("SELECT username FROM users WHERE id = $1").bind(id).fetch_optional(&mut *c).await?,
        None => None,
    };
    let limit_reached = r.winner_id.is_none() && limit_reached(&mut *c, uid, Kind::Wanted).await?;
    Ok(QuestView {
        reward: r.person_id.as_deref().and_then(|p| reward_for(cat, p)),
        done: r.winner_id.is_some(),
        mine: r.winner_id == Some(uid),
        crates: match (&r.person_id, r.winner_id) {
            (Some(p), None) => drop_crates(cat, p, r.variant.as_deref(), r.min_mult).iter().map(|c| c.id.clone()).collect(),
            _ => vec![],
        },
        next_at: r.next_at(),
        day: r.day,
        person: r.person_id,
        variant: r.variant,
        min_mult: r.min_mult,
        winner,
        won_person: r.won_person,
        money: r.money,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        won_at: r.won_at,
        limit_reached,
    })
}

/// Aktualny quest dla /api/me
pub async fn quest_view(c: &mut Conn, cat: &Catalog, uid: i64) -> sqlx::Result<Option<QuestView>> {
    match current(&mut *c, cat).await? {
        Some(r) => Ok(Some(view(c, cat, r, uid).await?)),
        None => Ok(None),
    }
}

/// Aktualny quest dla bota Discorda (bez gracza: `mine` zawsze false)
pub async fn bot_view(c: &mut Conn, cat: &Catalog) -> sqlx::Result<Option<QuestView>> {
    quest_view(c, cat, 0).await
}

/// Po każdej nowej karcie: czy to cel trwającego, jeszcze niewypełnionego questa. Pierwszy wygrywa - `UPDATE` z warunkiem
/// `winner_id IS NULL` zadziała tylko dla jednego gracza, nawet gdy dwóch trafi kartę w tej samej chwili.
pub async fn after_item(c: &mut Conn, cx: &Ctx, pid: &str, variant: &str, source: &str) -> sqlx::Result<()> {
    if !SOURCES.contains(&source) || variant == REWARD_VARIANT {
        return Ok(());
    }
    type Open = (String, Option<String>, Option<String>, Option<f64>);
    let open: Option<Open> = sqlx::query_as(
        "SELECT day, person_id, variant, min_mult FROM daily_quests WHERE winner_id IS NULL AND ends_at > $1 ORDER BY starts_at DESC LIMIT 1",
    )
    .bind(now())
    .fetch_optional(&mut *c)
    .await?;
    let Some((key, want_person, want_variant, want_mult)) = open else { return Ok(()) };
    let fits = want_person.as_deref().is_none_or(|p| p == pid)
        && want_variant.as_deref().is_none_or(|v| parts(variant).contains(&v))
        && want_mult.is_none_or(|m| g().variant(variant).mult >= m);
    let Some(money) = reward_for(&cx.cat, pid).filter(|_| fits) else { return Ok(()) };
    if limit_reached(&mut *c, cx.uid(), Kind::Wanted).await? {
        return Ok(());   // dzienny limit questów Wanted na konto: wygra ktoś inny
    }
    let won = sqlx::query(
        "UPDATE daily_quests SET winner_id = $1, won_at = $2, won_person = $3, money = $4 WHERE day = $5 AND winner_id IS NULL",
    )
    .bind(cx.uid())
    .bind(now())
    .bind(pid)
    .bind(money)
    .bind(&key)
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
        (Some(p), None) => {
            let name = names.get(p.as_str()).copied().unwrap_or(p);
            q.min_mult.map_or_else(|| name.to_owned(), |m| format!("{name} z mnożnikiem co najmniej {m}x"))
        }
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
        "dailyLimit": daily_limit(&mut c).await?,
    }))
}

#[derive(Deserialize)]
pub struct QuestSettings {
    enabled: Option<bool>,
    #[serde(default)]
    reroll: bool,
    /// dzienny limit wykonanych questów na konto, osobno dla każdego rodzaju (0 = bez limitu)
    #[serde(default, rename = "dailyLimit")]
    daily_limit: Option<i64>,
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
    if let Some(limit) = req.daily_limit {
        if !(0..=MAX_DAILY_LIMIT).contains(&limit) {
            return bad(format!("Limit questów: liczba od 0 do {MAX_DAILY_LIMIT}"));
        }
        sqlx::query("INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
            .bind(DAILY_LIMIT_KEY)
            .bind(limit)
            .execute(&mut *tx)
            .await?;
        log_admin(&mut tx, &me, "quests", None, &format!("limit wykonanych questów na konto na dobę (każdy rodzaj osobno): {limit}")).await?;
    } else if let Some(on) = req.enabled {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rarer_cards_need_a_lower_multiplier() {
        let order = ["purple", "red", "gold", "ultra"];
        let m: Vec<f64> = order.iter().map(|r| min_mult(r).unwrap()).collect();
        assert!(m.windows(2).all(|w| w[0] > w[1]), "{m:?}");
        assert_eq!(min_mult("ultra"), Some(2.0));
        assert_eq!(min_mult("green"), None);
        // każdy cel z listy ma wymagany mnożnik swojej rzadkości i co najmniej jeden pasujący wariant
        let cat = crate::catalog::build(&[], &[]);
        let list = candidates(&cat);
        assert!(!list.is_empty(), "brak celów questa przy domyślnym katalogu");
        for (pid, min, variants) in list {
            assert_eq!(Some(min), min_mult(&cat.person(&pid).unwrap().rarity));
            assert!(variants.iter().all(|v| g().variant(v).mult >= min));
        }
    }

    #[test]
    fn quest_target_must_drop_from_the_shop() {
        let cat = crate::catalog::build(&[], &[]);
        // karta ze stałej Skrzynki Polskiej (zawsze w sklepie) wypada z niej
        let from = drop_crates(&cat, "pl_lewandowski", None, None);
        assert!(from.iter().all(|c| c.shop && !c.restricted) && from.iter().any(|c| c.id == "pl"));
        // nieznanej karty nie da się zdobyć; karty z ukrytej skrzynki kart specjalnych też nie
        assert!(drop_crates(&cat, "nie_ma_takiej", None, None).is_empty());
        // wariant, którego skrzynka nie wylosuje, nie jest możliwy
        assert!(drop_crates(&cat, "pl_lewandowski", Some("wariant_ktorego_nie_ma"), None).is_empty());
    }
}
