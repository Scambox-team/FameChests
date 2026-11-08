//! Polecenia (reflinki). Każdy gracz ma stały kod i link `/r/<kod>`.
//!
//! Jak w programach poleceń dużych serwisów:
//! - atrybucja przez ciasteczko (podpisane, HttpOnly) na `WINDOW_DAYS` dni, pierwsze kliknięcie wygrywa (kolejny link
//!   go nie nadpisuje); gdy przeglądarka blokuje ciasteczka, kod przychodzi też w treści rejestracji,
//! - nagroda nie za samo założenie konta, tylko po "aktywacji": najpierw polecony musi mieć POTWIERDZONY email
//!   (`user_auth.verified_at`; `account::on_email_verified` woła `settle_referred`), potem otworzyć `min_opened`
//!   skrzynek i mieć konto od `min_hours` godzin - zakładanie pustych kont dla nagrody się nie opłaca,
//! - ochrona przed nadużyciami: polecenie z tego samego IP co polecający (skrót IP z solą, bez zapisywania adresów)
//!   albo kolejne konto z jednego IP ponad `per_ip_limit` czeka na decyzję admina (`flagged`); polecający dostaje
//!   najwyżej `monthly_cap` nagród w 30 dni (polecony dostaje swoją zawsze),
//! - unikalne wejścia liczone raz na (kod, skrót IP), statystyki dla gracza (wejścia, konta, czekające, nagrodzone).
//!
//! Nagrodę (skrzynka + ile + grosze, osobno dla polecającego i poleconego) ustawia admin (`/admin/referrals`).

use std::net::SocketAddr;

use axum::extract::{ConnectInfo, Path, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Redirect};
use axum_extra::extract::cookie::{Cookie, SameSite};
use axum_extra::extract::SignedCookieJar;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use super::{ok, JsonBody};
use crate::auth::{client_ip, Admin, MaybeUser, Me, UserView};
use crate::catalog::Catalog;
use crate::data::g;
use crate::db::{now, Conn};
use crate::error::{bad, Res};
use crate::game::{add_chests, add_state, get_state, log_admin, users_by_id, valid_chest_kind};
use crate::state::AppState;
use crate::text::fmt_money;

pub const REF_COOKIE: &str = "scambox_ref";
/// jak długo po kliknięciu w link rejestracja liczy się jako polecona
const WINDOW_DAYS: i64 = 30;
/// bez 0/O, 1/I/L - kod da się przepisać z ekranu
const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 8;

// ---------------------------------------------------------------- ustawienia (admin)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RefConfig {
    pub enabled: bool,
    /// nagroda polecającego: skrzynka (id albo money_*), ile sztuk, grosze
    pub referrer_crate: String,
    pub referrer_count: i64,
    pub referrer_money: i64,
    /// nagroda poleconego
    pub referred_crate: String,
    pub referred_count: i64,
    pub referred_money: i64,
    /// aktywacja: tyle otwartych skrzynek i tyle godzin od założenia konta
    pub min_opened: i64,
    pub min_hours: f64,
    /// najwięcej nagród polecającego w 30 dni (0 = bez limitu)
    pub monthly_cap: i64,
    /// tyle kont z jednego IP przechodzi samo, kolejne czekają na admina
    pub per_ip_limit: i64,
}

impl Default for RefConfig {
    fn default() -> Self {
        RefConfig {
            enabled: false,
            referrer_crate: String::new(),
            referrer_count: 1,
            referrer_money: 0,
            referred_crate: String::new(),
            referred_count: 1,
            referred_money: 0,
            min_opened: 5,
            min_hours: 0.0,
            monthly_cap: 20,
            per_ip_limit: 1,
        }
    }
}

/// Same nagrody (bez progów i limitów): globalne z `RefConfig` albo własny zestaw admina
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RewardSet {
    pub referrer_crate: String,
    pub referrer_count: i64,
    pub referrer_money: i64,
    pub referred_crate: String,
    pub referred_count: i64,
    pub referred_money: i64,
}

impl RefConfig {
    pub fn rewards(&self) -> RewardSet {
        RewardSet {
            referrer_crate: self.referrer_crate.clone(),
            referrer_count: self.referrer_count,
            referrer_money: self.referrer_money,
            referred_crate: self.referred_crate.clone(),
            referred_count: self.referred_count,
            referred_money: self.referred_money,
        }
    }
}

/// Wybór zestawu nagród dla polecenia z linku danego gracza (czysta decyzja, do testów): admin z własnym zestawem
/// używa go dla obu stron, każdy inny (też były admin) - zestawu globalnego
pub fn pick_rewards(cfg: &RefConfig, referrer_is_admin: bool, own: Option<RewardSet>) -> RewardSet {
    match own {
        Some(set) if referrer_is_admin => set,
        _ => cfg.rewards(),
    }
}

/// Zestaw nagród dla polecenia z linku tego gracza
pub async fn rewards_for(c: &mut Conn, cfg: &RefConfig, referrer: i64) -> sqlx::Result<RewardSet> {
    let is_admin: Option<i32> = sqlx::query_scalar("SELECT is_admin FROM users WHERE id = $1").bind(referrer).fetch_optional(&mut *c).await?;
    let is_admin = is_admin.unwrap_or(0) != 0;
    let own = if is_admin { own_set(c, referrer).await? } else { None };
    Ok(pick_rewards(cfg, is_admin, own))
}

async fn own_set(c: &mut Conn, admin: i64) -> sqlx::Result<Option<RewardSet>> {
    let row: Option<String> = sqlx::query_scalar("SELECT data FROM referral_admin_rewards WHERE admin_id = $1").bind(admin).fetch_optional(c).await?;
    Ok(row.and_then(|d| serde_json::from_str(&d).ok()))
}

pub async fn config(c: &mut Conn) -> sqlx::Result<RefConfig> {
    let row: Option<String> = sqlx::query_scalar("SELECT data FROM referral_config WHERE id = 1").fetch_optional(c).await?;
    Ok(row.and_then(|d| serde_json::from_str(&d).ok()).unwrap_or_default())
}

/// Nazwa nagrody dla graczy, np. "2× Skrzynka PRL + 500 gr"
fn reward_text(cat: &Catalog, kind: &str, count: i64, money: i64) -> String {
    let mut parts = vec![];
    if !kind.is_empty() && count > 0 {
        let name = match g().money_kind(kind) {
            Some(m) => g().money_chests[m].name.clone(),
            None => cat.crates.get(kind).map(|c| c.name.clone()).unwrap_or_else(|| kind.to_owned()),
        };
        parts.push(if count > 1 { format!("{count}× {name}") } else { name });
    }
    if money > 0 {
        parts.push(fmt_money(money));
    }
    parts.join(" + ")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RewardView {
    referrer: String,
    referred: String,
    referrer_crate: String,
    referred_crate: String,
    min_opened: i64,
    min_hours: f64,
}

fn reward_view(cat: &Catalog, cfg: &RefConfig, set: &RewardSet) -> RewardView {
    RewardView {
        referrer: reward_text(cat, &set.referrer_crate, set.referrer_count, set.referrer_money),
        referred: reward_text(cat, &set.referred_crate, set.referred_count, set.referred_money),
        referrer_crate: set.referrer_crate.clone(),
        referred_crate: set.referred_crate.clone(),
        min_opened: cfg.min_opened,
        min_hours: cfg.min_hours,
    }
}

// ---------------------------------------------------------------- kody, IP

fn new_code() -> String {
    let mut rng = rand::thread_rng();
    (0..CODE_LEN).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect()
}

fn clean_code(code: &str) -> Option<String> {
    let c: String = code.trim().to_uppercase();
    (c.len() == CODE_LEN && c.bytes().all(|b| ALPHABET.contains(&b))).then_some(c)
}

/// Skrót IP z solą (sekretem serwera): da się porównać dwa wejścia, ale nie odczytać adresu
pub fn ip_hash(st: &AppState, ip: &str) -> String {
    if ip.is_empty() {
        return String::new();
    }
    let mut h = Sha256::new();
    h.update(st.cfg.secret_key.as_bytes());
    h.update(b":ref-ip:");
    h.update(ip.as_bytes());
    hex::encode(&h.finalize()[..16])
}

/// Zapamiętuje skrót IP gracza (polecający z tego samego IP = podejrzane polecenie)
pub async fn note_ip(c: &mut Conn, uid: i64, hash: &str) -> sqlx::Result<()> {
    if hash.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO user_ips (user_id, ip_hash, last_seen) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, ip_hash) DO UPDATE SET last_seen = excluded.last_seen",
    )
    .bind(uid)
    .bind(hash)
    .bind(now())
    .execute(c)
    .await?;
    Ok(())
}

/// Mój kod (powstaje przy pierwszym użyciu)
async fn my_code(c: &mut Conn, uid: i64) -> sqlx::Result<String> {
    if let Some(code) = sqlx::query_scalar::<_, String>("SELECT code FROM referral_codes WHERE user_id = $1").bind(uid).fetch_optional(&mut *c).await? {
        return Ok(code);
    }
    loop {
        let code = new_code();
        let done = sqlx::query("INSERT INTO referral_codes (user_id, code, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
            .bind(uid)
            .bind(&code)
            .bind(now())
            .execute(&mut *c)
            .await?
            .rows_affected();
        if done > 0 {
            return Ok(code);
        }
        // zajęty kod albo równoległe zapytanie tego samego gracza
        if let Some(code) = sqlx::query_scalar::<_, String>("SELECT code FROM referral_codes WHERE user_id = $1").bind(uid).fetch_optional(&mut *c).await? {
            return Ok(code);
        }
    }
}

async fn code_owner(c: &mut Conn, code: &str) -> sqlx::Result<Option<i64>> {
    sqlx::query_scalar(
        "SELECT r.user_id FROM referral_codes r JOIN users u ON u.id = r.user_id WHERE r.code = $1 AND u.banned = 0",
    )
    .bind(code)
    .fetch_optional(c)
    .await
}

// ---------------------------------------------------------------- link i rejestracja

/// `/r/<kod>`: liczymy wejście, zapisujemy ciasteczko (jeśli nie ma już innego) i prowadzimy do rejestracji
pub async fn ref_landing(
    State(st): State<AppState>,
    MaybeUser(u): MaybeUser,
    addr: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: SignedCookieJar,
    Path(code): Path<String>,
) -> Res {
    if u.is_some() {
        return Ok(Redirect::to("/").into_response());
    }
    let Some(code) = clean_code(&code) else { return Ok(Redirect::to("/login").into_response()) };
    let mut c = st.db.acquire().await?;
    if !config(&mut c).await?.enabled || code_owner(&mut c, &code).await?.is_none() {
        return Ok(Redirect::to("/login").into_response());
    }
    let hash = ip_hash(&st, &client_ip(&st, &headers, Some(&addr)));
    let fresh = sqlx::query("INSERT INTO referral_clicks (code, ip_hash, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(&code)
        .bind(&hash)
        .bind(now())
        .execute(&mut *c)
        .await?
        .rows_affected();
    if fresh > 0 {
        sqlx::query("UPDATE referral_codes SET clicks = clicks + 1 WHERE code = $1").bind(&code).execute(&mut *c).await?;
    }
    // pierwsze kliknięcie wygrywa: ważne ciasteczko z innym kodem zostaje
    let kept = jar.get(REF_COOKIE).and_then(|c| clean_code(c.value()));
    let code = kept.unwrap_or(code);
    let cookie = Cookie::build((REF_COOKIE, code.clone()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(st.cfg.cookie_secure)
        .max_age(time::Duration::days(WINDOW_DAYS))
        .build();
    Ok((jar.add(cookie), Redirect::to(&format!("/login?ref={code}"))).into_response())
}

/// Kod polecenia przy rejestracji: z ciasteczka, a gdy go nie ma - z formularza
pub fn ref_code(jar: &SignedCookieJar, body: &str) -> Option<String> {
    jar.get(REF_COOKIE).and_then(|c| clean_code(c.value())).or_else(|| clean_code(body))
}

pub fn clear_cookie(jar: SignedCookieJar) -> SignedCookieJar {
    jar.remove(Cookie::build(REF_COOKIE).path("/"))
}

/// Nowe konto z polecenia (w transakcji rejestracji). Podejrzane polecenia czekają na admina.
pub async fn attach(c: &mut Conn, new_id: i64, code: &str, hash: &str) -> sqlx::Result<()> {
    let cfg = config(c).await?;
    if !cfg.enabled {
        return Ok(());
    }
    let Some(referrer) = code_owner(c, code).await? else { return Ok(()) };
    if referrer == new_id {
        return Ok(());
    }
    let mut reason = String::new();
    if !hash.is_empty() {
        let same: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM user_ips WHERE user_id = $1 AND ip_hash = $2)")
            .bind(referrer)
            .bind(hash)
            .fetch_one(&mut *c)
            .await?;
        let from_ip: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM referrals WHERE ip_hash = $1 AND created_at > $2")
            .bind(hash)
            .bind(now() - 30.0 * 86400.0)
            .fetch_one(&mut *c)
            .await?;
        if same {
            reason = "to samo IP co polecający".into();
        } else if cfg.per_ip_limit > 0 && from_ip >= cfg.per_ip_limit {
            reason = format!("{} kont z tego IP w 30 dni", from_ip + 1);
        }
    }
    let status = if reason.is_empty() { "pending" } else { "flagged" };
    sqlx::query(
        "INSERT INTO referrals (referred_id, referrer_id, code, ip_hash, status, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (referred_id) DO NOTHING",
    )
    .bind(new_id)
    .bind(referrer)
    .bind(code)
    .bind(hash)
    .bind(status)
    .bind(reason)
    .bind(now())
    .execute(c)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------- nagrody

#[derive(sqlx::FromRow)]
struct RefRow {
    referred_id: i64,
    referrer_id: i64,
    status: String,
    reason: String,
    created_at: f64,
    rewarded_at: Option<f64>,
}

macro_rules! ref_cols {
    () => {
        "referred_id, referrer_id, status, reason, created_at, rewarded_at"
    };
}

/// Czego brakuje poleconemu do nagrody (kolejność = kolejność warunków: najpierw email)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gap {
    Ready,
    /// konto bez emaila w ogóle
    NoEmail,
    /// email podany, ale niepotwierdzony
    Unverified,
    Opened,
    Young,
    Banned,
}

impl Gap {
    fn key(self) -> &'static str {
        match self {
            Gap::Ready => "ready",
            Gap::NoEmail => "noEmail",
            Gap::Unverified => "email",
            Gap::Opened => "opened",
            Gap::Young => "young",
            Gap::Banned => "banned",
        }
    }
}

/// Czysta decyzja o gotowości polecenia do nagrody (bez bazy, do testów)
pub fn readiness(has_email: bool, verified: bool, opened: i64, min_opened: i64, age_secs: f64, min_hours: f64, banned: bool) -> Gap {
    if banned {
        Gap::Banned
    } else if !has_email {
        Gap::NoEmail
    } else if !verified {
        Gap::Unverified
    } else if opened < min_opened {
        Gap::Opened
    } else if age_secs < min_hours * 3600.0 {
        Gap::Young
    } else {
        Gap::Ready
    }
}

/// (ma email, email potwierdzony) - konto bez wiersza `user_auth` albo z pustym emailem nie ma emaila
async fn email_state(c: &mut Conn, uid: i64) -> sqlx::Result<(bool, bool)> {
    let row: Option<(String, bool)> = sqlx::query_as("SELECT email, verified_at IS NOT NULL FROM user_auth WHERE user_id = $1")
        .bind(uid)
        .fetch_optional(c)
        .await?;
    Ok(row.map(|(e, v)| (!e.is_empty(), v)).unwrap_or((false, false)))
}

async fn gap_of(c: &mut Conn, cfg: &RefConfig, r: &RefRow) -> sqlx::Result<Gap> {
    let (has_email, verified) = email_state(c, r.referred_id).await?;
    let banned: i32 = sqlx::query_scalar("SELECT banned FROM users WHERE id = $1").bind(r.referred_id).fetch_optional(&mut *c).await?.unwrap_or(1);
    // skrzynki liczymy dopiero, gdy email jest w porządku
    let opened = if has_email && verified { opened(c, r.referred_id).await? } else { 0 };
    Ok(readiness(has_email, verified, opened, cfg.min_opened, now() - r.created_at, cfg.min_hours, banned != 0))
}

/// Polecenia z udziałem gracza, które czekają na aktywację: gdy polecony ją spełnił (email potwierdzony, skrzynki,
/// wiek konta), obaj dostają nagrody
pub async fn settle(c: &mut Conn, cat: &Catalog, uid: i64) -> sqlx::Result<()> {
    let pending: Vec<RefRow> = sqlx::query_as(concat!(
        "SELECT ", ref_cols!(), " FROM referrals ",
        "WHERE status = 'pending' AND (referred_id = $1 OR referrer_id = $1)"
    ))
    .bind(uid)
    .fetch_all(&mut *c)
    .await?;
    if pending.is_empty() {
        return Ok(());
    }
    let cfg = config(c).await?;
    if !cfg.enabled {
        return Ok(());
    }
    for r in pending {
        if gap_of(c, &cfg, &r).await? == Gap::Ready {
            reward(c, cat, &cfg, &r).await?;
        }
    }
    Ok(())
}

/// Po potwierdzeniu emaila (`account::on_email_verified`): rozlicza polecenia tego gracza (przy zerowych progach
/// nagroda przychodzi od razu)
pub async fn settle_referred(c: &mut Conn, cat: &Catalog, uid: i64) -> sqlx::Result<()> {
    settle(c, cat, uid).await
}

async fn opened(c: &mut Conn, uid: i64) -> sqlx::Result<i64> {
    Ok(get_state(c, uid).await?["opened"])
}

async fn give(c: &mut Conn, cat: &Catalog, uid: i64, kind: &str, count: i64, money: i64) -> sqlx::Result<String> {
    if !kind.is_empty() && count > 0 && valid_chest_kind(cat, kind) {
        add_chests(c, uid, kind, count).await?;
    }
    if money > 0 {
        add_state(c, uid, "balance", money).await?;
    }
    Ok(reward_text(cat, kind, count, money))
}

async fn reward(c: &mut Conn, cat: &Catalog, cfg: &RefConfig, r: &RefRow) -> sqlx::Result<()> {
    // zajmujemy wiersz - równoległe zapytanie drugiego gracza nie da nagrody drugi raz
    let taken = sqlx::query("UPDATE referrals SET status = 'rewarded', rewarded_at = $1 WHERE referred_id = $2 AND status = 'pending'")
        .bind(now())
        .bind(r.referred_id)
        .execute(&mut *c)
        .await?
        .rows_affected();
    if taken == 0 {
        return Ok(());
    }
    let set = rewards_for(c, cfg, r.referrer_id).await?;
    let referred = give(c, cat, r.referred_id, &set.referred_crate, set.referred_count, set.referred_money).await?;
    let month: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM referrals WHERE referrer_id = $1 AND referrer_reward != '' AND rewarded_at > $2",
    )
    .bind(r.referrer_id)
    .bind(now() - 30.0 * 86400.0)
    .fetch_one(&mut *c)
    .await?;
    let referrer = if cfg.monthly_cap > 0 && month >= cfg.monthly_cap {
        String::new() // limit polecającego - polecony i tak dostaje swoją nagrodę
    } else {
        give(c, cat, r.referrer_id, &set.referrer_crate, set.referrer_count, set.referrer_money).await?
    };
    sqlx::query(
        "UPDATE referrals SET referrer_reward = $1, referred_reward = $2, seen_referrer = $3, seen_referred = 0 WHERE referred_id = $4",
    )
    .bind(&referrer)
    .bind(&referred)
    .bind(i32::from(referrer.is_empty()))
    .bind(r.referred_id)
    .execute(&mut *c)
    .await?;
    metrics::counter!("scambox_referrals_rewarded_total").increment(1);
    Ok(())
}

/// Nieobejrzane nagrody za polecenia (dla /api/me): kto, co dostałem, jako kto
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefNote {
    referred_id: i64,
    role: &'static str,
    other: Option<UserView>,
    reward: String,
}

pub async fn notes(c: &mut Conn, cat: &Catalog, uid: i64) -> sqlx::Result<Vec<RefNote>> {
    settle(c, cat, uid).await?;
    let rows: Vec<(i64, i64, String, String, i32, i32)> = sqlx::query_as(
        "SELECT referred_id, referrer_id, referrer_reward, referred_reward, seen_referrer, seen_referred FROM referrals
         WHERE status = 'rewarded' AND ((referrer_id = $1 AND seen_referrer = 0) OR (referred_id = $1 AND seen_referred = 0))",
    )
    .bind(uid)
    .fetch_all(&mut *c)
    .await?;
    if rows.is_empty() {
        return Ok(vec![]);
    }
    let users = users_by_id(c, cat, rows.iter().flat_map(|r| [Some(r.0), Some(r.1)])).await?;
    Ok(rows
        .into_iter()
        .filter_map(|(referred, referrer, rr, rd, _, _)| {
            if referrer == uid {
                Some(RefNote { referred_id: referred, role: "referrer", other: users.get(&referred).cloned(), reward: rr })
            } else if referred == uid {
                Some(RefNote { referred_id: referred, role: "referred", other: users.get(&referrer).cloned(), reward: rd })
            } else {
                None
            }
        })
        .filter(|n| !n.reward.is_empty())
        .collect())
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct SeenRequest {
    ids: Vec<i64>,
}

pub async fn referral_seen(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<SeenRequest>) -> Res {
    let mut c = st.db.acquire().await?;
    sqlx::query("UPDATE referrals SET seen_referrer = 1 WHERE referrer_id = $1 AND referred_id = ANY($2)")
        .bind(me.id)
        .bind(&req.ids)
        .execute(&mut *c)
        .await?;
    sqlx::query("UPDATE referrals SET seen_referred = 1 WHERE referred_id = $1 AND referred_id = ANY($2)")
        .bind(me.id)
        .bind(&req.ids)
        .execute(&mut *c)
        .await?;
    ok(json!({"ok": true}))
}

// ---------------------------------------------------------------- gracz

fn site_url(st: &AppState, headers: &HeaderMap) -> String {
    let host = headers.get("host").and_then(|h| h.to_str().ok()).unwrap_or("localhost");
    let proto = if st.cfg.cookie_secure { "https" } else { "http" };
    format!("{proto}://{host}")
}

/// Mój link, nagrody i statystyki
pub async fn my_referral(
    State(st): State<AppState>,
    Me(me): Me,
    addr: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let cfg = config(&mut c).await?;
    if !cfg.enabled {
        return ok(json!({"enabled": false}));
    }
    note_ip(&mut c, me.id, &ip_hash(&st, &client_ip(&st, &headers, Some(&addr)))).await?;
    settle(&mut c, &cat, me.id).await?;
    let code = my_code(&mut c, me.id).await?;
    let clicks: i64 = sqlx::query_scalar("SELECT clicks FROM referral_codes WHERE user_id = $1").bind(me.id).fetch_one(&mut *c).await?;
    let rows: Vec<RefRow> = sqlx::query_as(concat!("SELECT ", ref_cols!(), " FROM referrals WHERE referrer_id = $1 ORDER BY created_at DESC LIMIT 100"))
        .bind(me.id)
        .fetch_all(&mut *c)
        .await?;
    let users = users_by_id(&mut c, &cat, rows.iter().map(|r| Some(r.referred_id))).await?;
    let mut list = vec![];
    for r in &rows {
        let (gap, opened) = if r.status == "pending" || r.status == "flagged" {
            let gap = gap_of(&mut c, &cfg, r).await?;
            let o = if matches!(gap, Gap::Opened | Gap::Young | Gap::Ready) { opened(&mut c, r.referred_id).await? } else { 0 };
            (gap.key(), o)
        } else {
            ("ready", 0)
        };
        list.push(json!({
            "user": users.get(&r.referred_id),
            "status": if r.status == "flagged" { "pending" } else { r.status.as_str() }, // graczowi nie mówimy o podejrzeniach
            "missing": gap,
            "opened": opened.min(cfg.min_opened),
            "readyAt": r.created_at + cfg.min_hours * 3600.0,
            "created": r.created_at,
            "rewarded": r.rewarded_at,
        }));
    }
    // kto mnie polecił (nick na bieżąco po stałym id)
    let mine: Option<RefRow> = sqlx::query_as(concat!("SELECT ", ref_cols!(), " FROM referrals WHERE referred_id = $1"))
        .bind(me.id)
        .fetch_optional(&mut *c)
        .await?;
    let referred_by = match mine {
        Some(r) => {
            let u = users_by_id(&mut c, &cat, [Some(r.referrer_id)]).await?;
            let open = r.status == "pending" || r.status == "flagged";
            let missing = if open { gap_of(&mut c, &cfg, &r).await?.key() } else { "ready" };
            let set = rewards_for(&mut c, &cfg, r.referrer_id).await?;
            u.get(&r.referrer_id).map(|user| {
                json!({"user": user, "status": if r.status == "flagged" { "pending" } else { r.status.as_str() }, "missing": missing,
                       "reward": reward_view(&cat, &cfg, &set)})
            })
        }
        None => None,
    };
    let count = |s: &str| rows.iter().filter(|r| r.status == s).count();
    let mine_set = rewards_for(&mut c, &cfg, me.id).await?;
    ok(json!({
        "enabled": true,
        "code": code,
        "url": format!("{}/r/{code}", site_url(&st, &headers)),
        "clicks": clicks,
        "signups": rows.len(),
        "pending": count("pending") + count("flagged"),
        "rewarded": count("rewarded"),
        "reward": reward_view(&cat, &cfg, &mine_set),
        "ownRewards": mine_set != cfg.rewards(),
        "monthlyCap": cfg.monthly_cap,
        "list": list,
        "referredBy": referred_by,
    }))
}

// ---------------------------------------------------------------- wpisanie kodu w profilu

/// Tyle godzin od założenia konta można jeszcze wpisać kod polecenia
const CLAIM_HOURS: f64 = 24.0;

/// Kod z tego, co wpisał gracz: sam kod (wielkość liter i spacje bez znaczenia) albo link (`https://.../r/KOD`,
/// `/r/KOD`, z parametrami, `#` albo ukośnikiem na końcu)
pub fn extract_code(input: &str) -> Option<String> {
    let input = input.trim();
    if input.is_empty() || input.len() > 300 {
        return None;
    }
    if let Some(pos) = input.to_ascii_lowercase().rfind("/r/") {
        let rest = &input[pos + 3..];
        let end = rest.find(|ch: char| matches!(ch, '/' | '?' | '#' | '&') || ch.is_whitespace()).unwrap_or(rest.len());
        return clean_code(&rest[..end]);
    }
    let plain: String = input.trim_matches('/').chars().filter(|ch| !ch.is_whitespace()).collect();
    clean_code(&plain)
}

/// Ile godzin zostało na wpisanie kodu (None = konto ma już 24 h albo więcej)
pub fn claim_hours_left(age_secs: f64) -> Option<f64> {
    let left = CLAIM_HOURS - age_secs / 3600.0;
    (left > 0.0).then_some(left)
}

/// Stan pola „wpisz kod” w profilu: czy można wpisać, ile czasu zostało, kto poleca i jakie będą nagrody
async fn claim_state(st: &AppState, me: &crate::auth::User) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let cfg = config(&mut c).await?;
    let by: Option<i64> = sqlx::query_scalar("SELECT referrer_id FROM referrals WHERE referred_id = $1").bind(me.id).fetch_optional(&mut *c).await?;
    let left = claim_hours_left(now() - me.created_at);
    let by_view = match by {
        Some(rid) => {
            let users = users_by_id(&mut c, &cat, [Some(rid)]).await?;
            let set = rewards_for(&mut c, &cfg, rid).await?;
            users.get(&rid).map(|u| json!({"user": u, "reward": reward_view(&cat, &cfg, &set)}))
        }
        None => None,
    };
    ok(json!({
        "enabled": cfg.enabled,
        "canClaim": cfg.enabled && by.is_none() && left.is_some(),
        "hoursLeft": left,
        "referredBy": by_view,
    }))
}

pub async fn claim_info(State(st): State<AppState>, Me(me): Me) -> Res {
    claim_state(&st, &me).await
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ClaimRequest {
    code: String,
}

/// Gracz bez polecenia i z kontem młodszym niż 24 h wpisuje kod albo link polecający (ta sama ochrona IP co przy rejestracji)
pub async fn claim(
    State(st): State<AppState>,
    Me(me): Me,
    addr: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    JsonBody(req): JsonBody<ClaimRequest>,
) -> Res {
    let ip = client_ip(&st, &headers, Some(&addr));
    // limit prób (zgadywanie kodów): jak nieudane logowania, osobne klucze
    let (who, from) = (format!("refclaim:{}", me.id), format!("refclaim:{ip}"));
    let wait = st.login.blocked(&who, &from);
    if wait > 0 {
        return bad(format!("Za dużo prób. Spróbuj ponownie za {} min.", wait / 60 + 1));
    }
    let mut tx = st.db.begin().await?;
    crate::db::lock_me(&mut tx, me.id).await?;
    let cfg = config(&mut tx).await?;
    if !cfg.enabled {
        return bad("Polecenia są teraz wyłączone");
    }
    if sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM referrals WHERE referred_id = $1)").bind(me.id).fetch_one(&mut *tx).await? {
        return bad("Twoje konto ma już polecenie");
    }
    if claim_hours_left(now() - me.created_at).is_none() {
        return bad("Kod można wpisać tylko do 24 godzin od założenia konta");
    }
    let owner = match extract_code(&req.code) {
        Some(code) => code_owner(&mut tx, &code).await?.map(|o| (code, o)),
        None => None,
    };
    let Some((code, owner)) = owner else {
        st.login.note(&who, &from, false);
        return bad("Nie ma takiego kodu");
    };
    if owner == me.id {
        return bad("Nie możesz użyć własnego kodu");
    }
    let hash = ip_hash(&st, &ip);
    note_ip(&mut tx, me.id, &hash).await?;
    attach(&mut tx, me.id, &code, &hash).await?;
    settle(&mut tx, &st.cat(), me.id).await?;
    tx.commit().await?;
    claim_state(&st, &me).await
}

/// Kto zaprasza (strona rejestracji, bez logowania)
pub async fn ref_invite(State(st): State<AppState>, Path(code): Path<String>) -> Res {
    let Some(code) = clean_code(&code) else { return bad("Nieprawidłowy kod") };
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let cfg = config(&mut c).await?;
    let Some(owner) = code_owner(&mut c, &code).await?.filter(|_| cfg.enabled) else { return bad("Ten link polecający nie działa") };
    let users = users_by_id(&mut c, &cat, [Some(owner)]).await?;
    let set = rewards_for(&mut c, &cfg, owner).await?;
    ok(json!({"user": users.get(&owner), "reward": reward_view(&cat, &cfg, &set)}))
}

// ---------------------------------------------------------------- admin

pub async fn admin_referrals(State(st): State<AppState>, Admin(me): Admin) -> Res {
    admin_view(&st, me.id).await
}

async fn admin_view(st: &AppState, me_id: i64) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let cfg = config(&mut c).await?;
    let rows: Vec<RefRow> = sqlx::query_as(concat!(
        "SELECT ", ref_cols!(), " FROM referrals ORDER BY (status = 'flagged') DESC, created_at DESC LIMIT 200"
    ))
    .fetch_all(&mut *c)
    .await?;
    let users = users_by_id(&mut c, &cat, rows.iter().flat_map(|r| [Some(r.referred_id), Some(r.referrer_id)])).await?;
    let stats: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT COALESCE((SELECT SUM(clicks) FROM referral_codes), 0)::BIGINT, COUNT(*),
                COUNT(*) FILTER (WHERE status = 'rewarded'), COUNT(*) FILTER (WHERE status = 'flagged') FROM referrals",
    )
    .fetch_one(&mut *c)
    .await?;
    let verified: std::collections::HashSet<i64> = sqlx::query_scalar::<_, i64>(
        "SELECT user_id FROM user_auth WHERE verified_at IS NOT NULL AND user_id = ANY($1)",
    )
    .bind(rows.iter().map(|r| r.referred_id).collect::<Vec<_>>())
    .fetch_all(&mut *c)
    .await?
    .into_iter()
    .collect();
    let top: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT referrer_id, COUNT(*) FROM referrals WHERE status = 'rewarded' GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
    )
    .fetch_all(&mut *c)
    .await?;
    let top_users = users_by_id(&mut c, &cat, top.iter().map(|t| Some(t.0))).await?;
    let mut crates: Vec<serde_json::Value> =
        cat.crates.values().filter(|k| !k.special).map(|k| json!({"id": k.id, "name": k.name, "mode": k.mode})).collect();
    for (k, m) in &g().money_chests {
        crates.push(json!({"id": format!("money_{k}"), "name": m.name, "mode": "money"}));
    }
    // własne zestawy nagród adminów (tylko obecnych adminów; były admin wraca do globalnych)
    let sets: Vec<(i64, String, f64)> = sqlx::query_as(
        "SELECT a.admin_id, a.data, a.updated_at FROM referral_admin_rewards a JOIN users u ON u.id = a.admin_id
         WHERE u.is_admin != 0 ORDER BY a.updated_at DESC",
    )
    .fetch_all(&mut *c)
    .await?;
    let set_users = users_by_id(&mut c, &cat, sets.iter().map(|s| Some(s.0))).await?;
    let admin_sets: Vec<serde_json::Value> = sets
        .iter()
        .filter_map(|(id, data, at)| {
            let set: RewardSet = serde_json::from_str(data).ok()?;
            let v = reward_view(&cat, &cfg, &set);
            Some(json!({"user": set_users.get(id), "mine": *id == me_id, "set": set, "referrer": v.referrer, "referred": v.referred, "updated": at}))
        })
        .collect();
    let mine_set: Option<RewardSet> = sets.iter().find(|s| s.0 == me_id).and_then(|s| serde_json::from_str(&s.1).ok());
    ok(json!({
        "config": cfg,
        "reward": reward_view(&cat, &cfg, &cfg.rewards()),
        "mine": mine_set,
        "adminSets": admin_sets,
        "crates": crates,
        "stats": {"clicks": stats.0, "signups": stats.1, "rewarded": stats.2, "flagged": stats.3},
        "top": top.iter().map(|(u, n)| json!({"user": top_users.get(u), "count": n})).collect::<Vec<_>>(),
        "list": rows.iter().map(|r| json!({
            "referredId": r.referred_id,
            "referred": users.get(&r.referred_id),
            "referrer": users.get(&r.referrer_id),
            "status": r.status,
            "emailVerified": verified.contains(&r.referred_id),
            "reason": r.reason,
            "created": r.created_at,
            "rewarded": r.rewarded_at,
        })).collect::<Vec<_>>(),
    }))
}

pub async fn admin_referral_config(State(st): State<AppState>, Admin(me): Admin, JsonBody(mut cfg): JsonBody<RefConfig>) -> Res {
    let cat = st.cat();
    for kind in [&cfg.referrer_crate, &cfg.referred_crate] {
        if !kind.is_empty() && !valid_chest_kind(&cat, kind) {
            return bad(format!("Nie ma skrzynki „{kind}”"));
        }
    }
    cfg.referrer_count = cfg.referrer_count.clamp(0, 100);
    cfg.referred_count = cfg.referred_count.clamp(0, 100);
    cfg.referrer_money = cfg.referrer_money.clamp(0, 100_000_000);
    cfg.referred_money = cfg.referred_money.clamp(0, 100_000_000);
    cfg.min_opened = cfg.min_opened.clamp(0, 10_000);
    cfg.min_hours = cfg.min_hours.clamp(0.0, 24.0 * 90.0);
    cfg.monthly_cap = cfg.monthly_cap.clamp(0, 10_000);
    cfg.per_ip_limit = cfg.per_ip_limit.clamp(0, 1000);
    if cfg.enabled && reward_text(&cat, &cfg.referrer_crate, cfg.referrer_count, cfg.referrer_money).is_empty()
        && reward_text(&cat, &cfg.referred_crate, cfg.referred_count, cfg.referred_money).is_empty()
    {
        return bad("Ustaw nagrodę przed włączeniem poleceń");
    }
    let data = serde_json::to_string(&cfg).map_err(anyhow::Error::from)?;
    sqlx::query("INSERT INTO referral_config (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = excluded.data")
        .bind(data)
        .execute(&st.db)
        .await?;
    admin_view(&st, me.id).await
}

/// Własny zestaw nagród admina: zapis zawsze dotyczy zalogowanego admina (`me.id`), cudzych zestawów nie da się zmienić
pub async fn admin_referral_mine(State(st): State<AppState>, Admin(me): Admin, JsonBody(mut set): JsonBody<RewardSet>) -> Res {
    let cat = st.cat();
    for kind in [&set.referrer_crate, &set.referred_crate] {
        if !kind.is_empty() && !valid_chest_kind(&cat, kind) {
            return bad(format!("Nie ma skrzynki „{kind}”"));
        }
    }
    set.referrer_count = set.referrer_count.clamp(0, 100);
    set.referred_count = set.referred_count.clamp(0, 100);
    set.referrer_money = set.referrer_money.clamp(0, 100_000_000);
    set.referred_money = set.referred_money.clamp(0, 100_000_000);
    let referrer = reward_text(&cat, &set.referrer_crate, set.referrer_count, set.referrer_money);
    let referred = reward_text(&cat, &set.referred_crate, set.referred_count, set.referred_money);
    if referrer.is_empty() && referred.is_empty() {
        return bad("Ustaw jakąś nagrodę albo użyj globalnych");
    }
    let data = serde_json::to_string(&set).map_err(anyhow::Error::from)?;
    let mut tx = st.db.begin().await?;
    sqlx::query(
        "INSERT INTO referral_admin_rewards (admin_id, data, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (admin_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
    )
    .bind(me.id)
    .bind(data)
    .bind(now())
    .execute(&mut *tx)
    .await?;
    let details = format!("polecający: {}; polecony: {}", if referrer.is_empty() { "nic" } else { &referrer }, if referred.is_empty() { "nic" } else { &referred });
    log_admin(&mut tx, &me, "referral_own_rewards", None, &details).await?;
    tx.commit().await?;
    admin_view(&st, me.id).await
}

/// „Użyj globalnych”: usuwa własny zestaw zalogowanego admina
pub async fn admin_referral_mine_clear(State(st): State<AppState>, Admin(me): Admin) -> Res {
    let mut tx = st.db.begin().await?;
    let gone = sqlx::query("DELETE FROM referral_admin_rewards WHERE admin_id = $1").bind(me.id).execute(&mut *tx).await?.rows_affected();
    if gone > 0 {
        log_admin(&mut tx, &me, "referral_own_rewards", None, "wrócił do nagród globalnych").await?;
    }
    tx.commit().await?;
    admin_view(&st, me.id).await
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct DecideRequest {
    approve: bool,
}

/// Podejrzane polecenie: zatwierdź (czeka na aktywację jak zwykłe) albo odrzuć (bez nagród)
pub async fn admin_referral_decide(
    State(st): State<AppState>,
    Admin(me): Admin,
    Path(referred): Path<i64>,
    JsonBody(req): JsonBody<DecideRequest>,
) -> Res {
    let mut c = st.db.acquire().await?;
    let status = if req.approve { "pending" } else { "rejected" };
    sqlx::query("UPDATE referrals SET status = $1 WHERE referred_id = $2 AND status IN ('flagged', 'pending')")
        .bind(status)
        .bind(referred)
        .execute(&mut *c)
        .await?;
    if req.approve {
        settle(&mut c, &st.cat(), referred).await?;
    }
    drop(c);
    admin_view(&st, me.id).await
}

/// Usuwany gracz: jego kod i polecenia
pub async fn referral_forget_user(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM referral_codes WHERE user_id = $1").bind(uid).execute(&mut *c).await?;
    sqlx::query("DELETE FROM referrals WHERE referred_id = $1 OR referrer_id = $1").bind(uid).execute(&mut *c).await?;
    sqlx::query("DELETE FROM user_ips WHERE user_id = $1").bind(uid).execute(c).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes() {
        for _ in 0..50 {
            let c = new_code();
            assert_eq!(clean_code(&c).as_deref(), Some(c.as_str()));
            assert_eq!(clean_code(&c.to_lowercase()).as_deref(), Some(c.as_str()));
        }
        assert!(clean_code("ABC").is_none());
        assert!(clean_code("ABCDEFG0").is_none(), "0 nie ma w alfabecie");
        assert!(clean_code("../../x").is_none());
    }

    #[test]
    fn extract_forms() {
        let code = new_code();
        let low = code.to_lowercase();
        assert_eq!(extract_code(&code).as_deref(), Some(code.as_str()));
        assert_eq!(extract_code(&format!("  {low} ")).as_deref(), Some(code.as_str()));
        let spaced = format!("{} {}", &code[..4], &code[4..]);
        assert_eq!(extract_code(&spaced).as_deref(), Some(code.as_str()));
        for link in [
            format!("https://scambox.pl/r/{code}"),
            format!("https://scambox.pl/r/{code}/"),
            format!("http://localhost:8080/r/{low}?utm=x&a=b"),
            format!("/r/{code}"),
            format!("scambox.pl/r/{code}#top"),
            format!("  https://SCAMBOX.pl/R/{code} "),
            format!("{code}/"),
        ] {
            assert_eq!(extract_code(&link).as_deref(), Some(code.as_str()), "{link}");
        }
        for junk in ["", "   ", "ABC", "https://scambox.pl/", "https://scambox.pl/r/", "https://scambox.pl/r/ZZZ", "../../etc", "ABCDEFG0", "<script>"] {
            assert!(extract_code(junk).is_none(), "{junk}");
        }
        assert!(extract_code(&"A".repeat(500)).is_none());
        assert!(extract_code(&format!("https://x.pl/r/{code}{code}")).is_none(), "za długi kod");
    }

    #[test]
    fn reward_set_choice() {
        let cfg = RefConfig { referrer_crate: "a".into(), referrer_count: 2, referred_crate: "b".into(), referred_count: 1, ..Default::default() };
        let own = RewardSet { referrer_crate: "x".into(), referrer_count: 5, referrer_money: 100, referred_crate: "y".into(), referred_count: 3, referred_money: 0 };
        assert_eq!(pick_rewards(&cfg, true, Some(own.clone())), own, "admin z zestawem: jego zestaw dla obu stron");
        assert_eq!(pick_rewards(&cfg, true, None), cfg.rewards(), "admin bez zestawu: globalny");
        assert_eq!(pick_rewards(&cfg, false, None), cfg.rewards(), "zwykły gracz: globalny");
        assert_eq!(pick_rewards(&cfg, false, Some(own)), cfg.rewards(), "były admin: zestaw nie działa");
    }

    #[test]
    fn claim_window() {
        assert!(claim_hours_left(0.0).is_some());
        let left = claim_hours_left(19.0 * 3600.0).unwrap();
        assert!((left - 5.0).abs() < 1e-9);
        assert!(claim_hours_left(24.0 * 3600.0 - 1.0).is_some());
        assert!(claim_hours_left(24.0 * 3600.0).is_none());
        assert!(claim_hours_left(1e9).is_none());
    }

    #[test]
    fn readiness_order() {
        // (ma email, potwierdzony, otwarte, min otwarte, wiek s, min godzin, zablokowany)
        let r = |e, v, o, mo, age, mh, b| readiness(e, v, o, mo, age, mh, b);
        assert_eq!(r(false, false, 99, 5, 1e9, 0.0, false), Gap::NoEmail, "bez emaila nie ma nagrody");
        assert_eq!(r(true, false, 99, 5, 1e9, 0.0, false), Gap::Unverified, "niepotwierdzony email blokuje mimo progów");
        assert_eq!(r(true, true, 4, 5, 1e9, 0.0, false), Gap::Opened);
        assert_eq!(r(true, true, 5, 5, 3599.0, 1.0, false), Gap::Young);
        assert_eq!(r(true, true, 5, 5, 3600.0, 1.0, false), Gap::Ready);
        assert_eq!(r(true, true, 0, 0, 0.0, 0.0, false), Gap::Ready, "zerowe progi: nagroda zaraz po potwierdzeniu");
        assert_eq!(r(true, true, 5, 5, 1e9, 0.0, true), Gap::Banned);
    }
}
