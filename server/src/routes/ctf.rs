//! Quest CTF (capture the flag, domyślnie wyłączony, włącza admin w panelu „Questy”): drugi quest obok Wanted.
//! Wszyscy gracze dostają to samo zadanie w stylu TryHackMe (strona z dziurą, ciasteczko, robots.txt, zakodowana
//! wiadomość...), a kto pierwszy wpisze flagę, dostaje kartę w wariancie Cyfrowa (`digital`) i jej wartość w groszach.
//!
//! Czas jak w Wanted: quest trwa `DURATION` (24 h), wypełniony - nowy po `AFTER_WIN` (6 h). Co jakiś czas bez rozwiązania
//! odsłania się kolejna podpowiedź (`HINTS_AT`). Flaga i wszystko, co z niej wynika, jest losowane przy każdym queście
//! (ziarno `seed` w `ctf_quests`), więc rozwiązanie z poprzedniego razu nie pasuje. Strony zadań to zwykły HTML pod
//! `/ctf/<token>/` (bez logowania, po polsku - jak napisy na płótnie), flagę sprawdza tylko serwer.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use axum::extract::{Path, RawQuery, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use base64::Engine;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use super::{ok, JsonBody};
use crate::achievements;
use crate::auth::{Admin, Me};
use crate::catalog::Catalog;
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, Res};
use crate::game::{add_state, insert_plain, log_admin, Ctx};
use crate::state::AppState;

pub const REWARD_VARIANT: &str = "digital";
const ENABLED_KEY: &str = "ctf_enabled";
const DURATION: f64 = 24.0 * 3600.0;
const AFTER_WIN: f64 = 6.0 * 3600.0;
/// po ilu sekundach od startu odsłania się kolejna podpowiedź
const HINTS_AT: [f64; 3] = [3.0 * 3600.0, 8.0 * 3600.0, 14.0 * 3600.0];
/// rzadkości karty-nagrody
const REWARD_RARITIES: [&str; 3] = ["purple", "red", "gold"];
/// ile prób na gracza w oknie `TRY_WINDOW` sekund (zgadywanie flagi na ślepo nie ma sensu)
const MAX_TRIES: usize = 8;
const TRY_WINDOW: f64 = 600.0;
/// tyle ostatnich zadań się nie powtarza
const NO_REPEAT: i64 = 4;
const HISTORY: i64 = 14;

pub struct Challenge {
    pub id: &'static str,
    pub title: &'static str,
    pub category: &'static str,
    /// trudność 1-3
    pub level: u8,
    pub brief: &'static str,
    /// zadanie ma stronę pod /ctf/<token>/
    pub page: bool,
    /// `{0}` = wartość z zadania (`hint_arg`)
    pub hints: [&'static str; 3],
}

pub const CHALLENGES: [Challenge; 9] = [
    Challenge {
        id: "source",
        title: "Zapomniany komentarz",
        category: "Web",
        level: 1,
        brief: "Firma Kebab-Soft chwali się nowym intranetem. Programista wdrażał go w pośpiechu o trzeciej w nocy i podobno coś po sobie zostawił. Znajdź flagę na ich serwerze.",
        page: true,
        hints: [
            "Strona to nie tylko to, co widać. Przeglądarka pokaże ci jej źródło (Ctrl+U).",
            "Programiści zostawiają w kodzie notatki. Szukaj fragmentu zaczynającego się od <!--",
            "Komentarz zdradza adres starego panelu. Otwórz go w przeglądarce.",
        ],
    },
    Challenge {
        id: "cookie",
        title: "Tylko dla admina",
        category: "Web",
        level: 2,
        brief: "Panel Kebab-Soft wpuszcza wyłącznie administratora. Ale jak właściwie strona sprawdza, kim jesteś?",
        page: true,
        hints: [
            "Strona coś o tobie zapamiętała - w twojej własnej przeglądarce.",
            "Narzędzia deweloperskie (F12) -> Aplikacja / Storage -> Ciasteczka (Cookies).",
            "Zmień wartość ciasteczka rola na admin i odśwież stronę.",
        ],
    },
    Challenge {
        id: "robots",
        title: "Roboty wiedzą więcej",
        category: "Web",
        level: 1,
        brief: "Ta strona robi wszystko, żeby nie trafić do wyszukiwarek. Co takiego chce ukryć przed robotami?",
        page: true,
        hints: [
            "Roboty wyszukiwarek, zanim odwiedzą stronę, czytają jeden specjalny plik z instrukcjami.",
            "Ten plik nazywa się robots.txt i leży w folderze zadania.",
            "Linia Disallow wskazuje katalog, którego roboty mają nie odwiedzać. Ty możesz.",
        ],
    },
    Challenge {
        id: "headers",
        title: "Gadatliwy serwer",
        category: "Web",
        level: 2,
        brief: "Serwer tej strony mówi więcej, niż pokazuje na ekranie. Podsłuchaj, co odpowiada przeglądarce.",
        page: true,
        hints: [
            "Odpowiedź serwera to nie tylko treść strony. Ma też nagłówki.",
            "F12 -> Sieć (Network), odśwież stronę, kliknij pierwsze zapytanie i zobacz nagłówki odpowiedzi.",
            "Nagłówek X-Sekret jest zakodowany w Base64. Zdekoduj go, np. w CyberChef.",
        ],
    },
    Challenge {
        id: "idor",
        title: "Cudze notatki",
        category: "Web",
        level: 2,
        brief: "Notatnik online trzyma notatki wszystkich użytkowników na jednym serwerze. Masz dostęp tylko do swojej... prawda?",
        page: true,
        hints: [
            "Sprawdź, skąd strona pobiera twoją notatkę (F12 -> Sieć).",
            "Adres zapytania zawiera numer notatki. Co się stanie, gdy go zmienisz?",
            "Pierwsze konto w systemie to zwykle admin. Spróbuj id=1.",
        ],
    },
    Challenge {
        id: "jscheck",
        title: "Sejf w przeglądarce",
        category: "Web",
        level: 3,
        brief: "Sejf na stronie otwiera się hasłem. Jego twórca był pewny, że nikt go nie zgadnie. Nie musisz zgadywać.",
        page: true,
        hints: [
            "Hasło sprawdza przeglądarka, nie serwer. Cały kod jest w źródle strony.",
            "Hasło jest zapisane jako liczby - to kody znaków ASCII, w odwrotnej kolejności.",
            "Wpisz w konsoli (F12): String.fromCharCode(...k.slice().reverse())",
        ],
    },
    Challenge {
        id: "encoded",
        title: "Przechwycona transmisja",
        category: "Krypto",
        level: 2,
        brief: "Przechwyciliśmy krótką wiadomość z serwera rywali. Wygląda na bełkot, ale to nie szyfr z kluczem - tylko kodowanie.",
        page: false,
        hints: [
            "Znak = na końcu to typowy ślad jednego bardzo popularnego kodowania.",
            "Najpierw Base64. Wynik dalej jest nieczytelny, ale litery wyglądają na przesunięte.",
            "Druga warstwa to ROT13. W CyberChef: From Base64, potem ROT13.",
        ],
    },
    Challenge {
        id: "caesar",
        title: "Notatka szpiega",
        category: "Krypto",
        level: 1,
        brief: "Na serwerze leżała notatka zapisana dziwnymi literami. Wiemy, że jest w niej flaga, a flagi zaczynają się od SB{",
        page: false,
        hints: [
            "Każda litera jest przesunięta w alfabecie o tę samą liczbę miejsc.",
            "Wiesz, że flaga zaczyna się od SB. Policz, o ile przesunięto literę S.",
            "To szyfr Cezara z przesunięciem o {0}. Cofnij każdą literę o tyle miejsc.",
        ],
    },
    Challenge {
        id: "hash",
        title: "Wyciek bazy",
        category: "Krypto",
        level: 2,
        brief: "Z bazy danych serwisu wyciekła tabela użytkowników. Odgadnij hasło administratora. Flaga to SB{hasło}.",
        page: false,
        hints: [
            "Ten ciąg to skrót (hash). Nie da się go odwrócić, ale popularne hasła da się po prostu sprawdzić.",
            "64 znaki szesnastkowe to SHA-256. Słabe hasła są w gotowych tabelach skrótów.",
            "Wklej skrót admina na crackstation.net. Flaga to SB{znalezione hasło}.",
        ],
    },
];

pub fn challenge(id: &str) -> Option<&'static Challenge> {
    CHALLENGES.iter().find(|c| c.id == id)
}

const WORDS: [&str; 24] = [
    "kebab", "haker", "sejf", "pingwin", "bajt", "terminal", "skrzynka", "klucz", "szyfr", "duch", "pakiet", "serwer", "admin",
    "bufor", "konsola", "proxy", "token", "root", "kabel", "modem", "pirat", "smok", "kot", "tost",
];
/// słabe hasła, które zna każda tabela skrótów (zadanie `hash`)
const LEAKED: [&str; 30] = [
    "sunshine",
    "dragon",
    "monkey",
    "football",
    "letmein",
    "princess",
    "shadow",
    "superman",
    "batman",
    "trustno1",
    "iloveyou",
    "starwars",
    "pokemon",
    "master",
    "michael",
    "jennifer",
    "baseball",
    "computer",
    "whatever",
    "freedom",
    "hello123",
    "cookie",
    "cheese",
    "pepper",
    "summer",
    "winter",
    "banana",
    "chocolate",
    "password1",
    "qwerty",
];

/// Wszystko, co zadanie losuje z ziarna questa (zawsze w tej samej kolejności)
struct Secrets {
    /// kawałek adresu ukrytej strony
    code: String,
    /// numer notatki gracza (idor)
    note: u32,
    /// hasło sejfu (jscheck)
    password: String,
    /// przesunięcie Cezara
    shift: u8,
    leaked: &'static str,
    flag: String,
}

fn secrets(seed: i64) -> Secrets {
    let mut r = ChaCha8Rng::seed_from_u64(seed as u64);
    let code = format!("{:06x}", r.gen_range(0..0x100_0000u32));
    let note = r.gen_range(40..90);
    let password = format!("{}{}", WORDS.choose(&mut r).unwrap(), r.gen_range(10..100));
    let shift = r.gen_range(3..=23);
    let leaked = *LEAKED.choose(&mut r).unwrap();
    let (a, b) = (WORDS.choose(&mut r).unwrap(), WORDS.choose(&mut r).unwrap());
    let flag = format!("SB{{{a}_{b}_{:04x}}}", r.gen_range(0..0x1_0000u32));
    Secrets { code, note, password, shift, leaked, flag }
}

fn flag_for(challenge: &str, seed: i64) -> String {
    let s = secrets(seed);
    if challenge == "hash" {
        format!("SB{{{}}}", s.leaked)
    } else {
        s.flag
    }
}

/// Wpis gracza i flaga w jednej postaci: bez wielkości liter i spacji, `SB{...}` można pominąć
fn normalize(s: &str) -> String {
    let t = s.trim().to_lowercase();
    let inner = t.strip_prefix("sb{").and_then(|x| x.strip_suffix('}')).unwrap_or(&t);
    format!("sb{{{}}}", inner.trim())
}

fn rot13(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' => (((c as u8 - b'a' + 13) % 26) + b'a') as char,
            'A'..='Z' => (((c as u8 - b'A' + 13) % 26) + b'A') as char,
            _ => c,
        })
        .collect()
}

fn caesar(s: &str, shift: u8) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' => (((c as u8 - b'a' + shift) % 26) + b'a') as char,
            'A'..='Z' => (((c as u8 - b'A' + shift) % 26) + b'A') as char,
            _ => c,
        })
        .collect()
}

fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

/// Dane zadania pokazywane graczowi w questach bez strony (szyfrogram, wyciek)
fn task_data(challenge: &str, seed: i64, flag: &str) -> Option<String> {
    let s = secrets(seed);
    match challenge {
        "encoded" => Some(base64::engine::general_purpose::STANDARD.encode(rot13(&format!("Wiadomosc odebrana. Flaga: {flag}")))),
        "caesar" => Some(caesar(&format!("Gratulacje, odczytales notatke. Twoja flaga to {flag}"), s.shift)),
        "hash" => {
            let mut r = ChaCha8Rng::seed_from_u64(seed as u64 ^ 0x5eed);
            let noise = |r: &mut ChaCha8Rng| (0..32).map(|_| format!("{:02x}", r.gen_range(0..=255u8))).collect::<String>();
            Some(format!(
                "id | login   | sha256\n 1 | admin   | {}\n 2 | ania_k  | {}\n 3 | marek99 | {}",
                sha256_hex(s.leaked),
                noise(&mut r),
                noise(&mut r)
            ))
        }
        _ => None,
    }
}

fn hint_arg(challenge: &str, seed: i64) -> String {
    match challenge {
        "caesar" => secrets(seed).shift.to_string(),
        _ => String::new(),
    }
}

#[derive(sqlx::FromRow)]
struct CtfRow {
    key: String,
    challenge: String,
    token: String,
    flag: String,
    seed: i64,
    person_id: Option<String>,
    starts_at: f64,
    ends_at: f64,
    winner_id: Option<i64>,
    won_at: Option<f64>,
    money: i64,
    attempts: i64,
}

impl CtfRow {
    fn next_at(&self) -> f64 {
        match self.won_at.filter(|_| self.winner_id.is_some()) {
            Some(at) => at + AFTER_WIN,
            None => self.ends_at,
        }
    }
    /// ile podpowiedzi już widać (po wypełnieniu - wszystkie)
    fn hints_open(&self, now: f64) -> usize {
        if self.winner_id.is_some() {
            return HINTS_AT.len();
        }
        HINTS_AT.iter().filter(|&&t| now >= self.starts_at + t).count()
    }
}

const COLUMNS: &str = "key, challenge, token, flag, seed, person_id, starts_at, ends_at, winner_id, won_at, money, attempts";

async fn enabled(c: &mut Conn) -> sqlx::Result<bool> {
    let v: Option<i64> = sqlx::query_scalar("SELECT value FROM state WHERE key = $1").bind(ENABLED_KEY).fetch_optional(c).await?;
    Ok(v.unwrap_or(0) != 0)
}

async fn latest(c: &mut Conn) -> sqlx::Result<Option<CtfRow>> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!("SELECT {COLUMNS} FROM ctf_quests ORDER BY n DESC LIMIT 1")))
        .fetch_optional(c)
        .await
}

/// Karta-nagroda: od Epickiej do Legendarnej, ze skrzynki, która jest teraz w sklepie
fn pick_reward(cat: &Catalog) -> Option<String> {
    let list: Vec<&str> = cat
        .people
        .values()
        .filter(|p| REWARD_RARITIES.contains(&p.rarity.as_str()) && !p.is_secret() && !p.is_special())
        .filter(|p| cat.crates.values().any(|c| c.shop && !c.restricted && p.crates.contains(&c.id)))
        .map(|p| p.id.as_str())
        .collect();
    list.choose(&mut rand::thread_rng()).map(|s| (*s).to_owned())
}

/// Nowy quest (losowe zadanie spoza ostatnich `NO_REPEAT`, albo wybrane przez admina). Dwa zapytania naraz liczą ten sam
/// klucz, więc `ON CONFLICT` zostawia jeden.
async fn create(c: &mut Conn, cat: &Catalog, forced: Option<&str>) -> sqlx::Result<()> {
    let Some(person) = pick_reward(cat) else { return Ok(()) };
    let n: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(n), 0) FROM ctf_quests").fetch_one(&mut *c).await?;
    let recent: Vec<String> = sqlx::query_scalar("SELECT challenge FROM ctf_quests ORDER BY n DESC LIMIT $1")
        .bind(NO_REPEAT)
        .fetch_all(&mut *c)
        .await?;
    // ThreadRng nie może przetrwać .await (handler musi być Send)
    let (ch, seed, token) = {
        let mut rng = rand::thread_rng();
        let ch = match forced.and_then(challenge) {
            Some(ch) => ch,
            None => {
                let fresh: Vec<&Challenge> = CHALLENGES.iter().filter(|ch| !recent.iter().any(|r| r == ch.id)).collect();
                let pool: Vec<&Challenge> = if fresh.is_empty() { CHALLENGES.iter().collect() } else { fresh };
                pool.choose(&mut rng).copied().unwrap_or(&CHALLENGES[0])
            }
        };
        let seed: i64 = rng.gen_range(1..i64::MAX);
        let token: String = (0..8).map(|_| format!("{:02x}", rng.gen_range(0..=255u8))).collect();
        (ch, seed, token)
    };
    let now = now();
    sqlx::query(
        "INSERT INTO ctf_quests (key, n, challenge, token, flag, seed, person_id, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (key) DO NOTHING",
    )
    .bind(format!("c{}", n + 1))
    .bind(n + 1)
    .bind(ch.id)
    .bind(token)
    .bind(flag_for(ch.id, seed))
    .bind(seed)
    .bind(person)
    .bind(now)
    .bind(now + DURATION)
    .execute(c)
    .await?;
    Ok(())
}

/// Aktualny quest CTF; po jego czasie pierwsze zapytanie losuje nowy. None = wyłączony.
async fn current(c: &mut Conn, cat: &Catalog) -> sqlx::Result<Option<CtfRow>> {
    if !enabled(&mut *c).await? {
        return Ok(None);
    }
    let prev = latest(&mut *c).await?;
    if prev.as_ref().is_some_and(|r| now() < r.next_at()) {
        return Ok(prev);
    }
    create(&mut *c, cat, None).await?;
    latest(c).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CtfView {
    key: String,
    challenge: String,
    title: String,
    category: String,
    level: u8,
    /// karta-nagroda (w wariancie Cyfrowa)
    person: Option<String>,
    reward: Option<i64>,
    done: bool,
    mine: bool,
    winner: Option<String>,
    money: i64,
    starts_at: f64,
    ends_at: f64,
    won_at: Option<f64>,
    next_at: f64,
    hints_open: usize,
    hints_total: usize,
    /// kiedy odsłoni się następna podpowiedź (None = wszystkie widać)
    next_hint_at: Option<f64>,
}

async fn view(c: &mut Conn, cat: &Catalog, r: &CtfRow, uid: i64) -> sqlx::Result<CtfView> {
    let ch = challenge(&r.challenge);
    let winner: Option<String> = match r.winner_id {
        Some(id) => sqlx::query_scalar("SELECT username FROM users WHERE id = $1").bind(id).fetch_optional(c).await?,
        None => None,
    };
    let open = r.hints_open(now());
    Ok(CtfView {
        key: r.key.clone(),
        challenge: r.challenge.clone(),
        title: ch.map_or(r.challenge.as_str(), |c| c.title).to_owned(),
        category: ch.map_or("", |c| c.category).to_owned(),
        level: ch.map_or(1, |c| c.level),
        reward: r.person_id.as_deref().and_then(|p| cat.person(p)).map(|p| p.value(REWARD_VARIANT)),
        person: r.person_id.clone(),
        done: r.winner_id.is_some(),
        mine: r.winner_id == Some(uid),
        winner,
        money: r.money,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        won_at: r.won_at,
        next_at: r.next_at(),
        hints_open: open,
        hints_total: HINTS_AT.len(),
        next_hint_at: HINTS_AT.get(open).map(|t| r.starts_at + t).filter(|_| r.winner_id.is_none()),
    })
}

/// Skrót questa CTF dla /api/me
pub async fn ctf_view(c: &mut Conn, cat: &Catalog, uid: i64) -> sqlx::Result<Option<CtfView>> {
    match current(&mut *c, cat).await? {
        Some(r) => Ok(Some(view(c, cat, &r, uid).await?)),
        None => Ok(None),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CtfDetail {
    #[serde(flatten)]
    view: CtfView,
    brief: String,
    /// dane do rozszyfrowania (zadania bez strony)
    data: Option<String>,
    /// adres strony zadania
    url: Option<String>,
    hints: Vec<String>,
    /// flaga po zakończeniu questa (do sprawdzenia, jak to było)
    flag: Option<String>,
    tries_left: usize,
}

fn tries_used(uid: i64, now: f64) -> usize {
    let mut map = TRIES.lock().unwrap_or_else(|e| e.into_inner());
    let list = map.entry(uid).or_default();
    list.retain(|&t| now - t < TRY_WINDOW);
    list.len()
}

static TRIES: LazyLock<Mutex<HashMap<i64, Vec<f64>>>> = LazyLock::new(Mutex::default);

/// Pełne zadanie: opis, dane, podpowiedzi, które już się odsłoniły
pub async fn ctf_detail(State(st): State<AppState>, Me(me): Me) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let Some(r) = current(&mut c, &cat).await? else { return bad("Quest CTF jest teraz wyłączony") };
    let v = view(&mut c, &cat, &r, me.id).await?;
    let ch = challenge(&r.challenge);
    let arg = hint_arg(&r.challenge, r.seed);
    let hints = ch.map(|ch| ch.hints[..v.hints_open].iter().map(|h| h.replace("{0}", &arg)).collect()).unwrap_or_default();
    let done = v.done;
    ok(CtfDetail {
        brief: ch.map_or("", |c| c.brief).to_owned(),
        data: task_data(&r.challenge, r.seed, &r.flag),
        url: ch.filter(|c| c.page).map(|_| format!("/ctf/{}/", r.token)),
        hints,
        flag: done.then(|| r.flag.clone()),
        tries_left: MAX_TRIES.saturating_sub(tries_used(me.id, now())),
        view: v,
    })
}

#[derive(Deserialize)]
pub struct Submit {
    flag: String,
}

/// Sprawdzenie flagi. Pierwszy wygrywa - `UPDATE ... WHERE winner_id IS NULL` przejdzie tylko raz.
pub async fn ctf_submit(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<Submit>) -> Res {
    let guess = req.flag.trim();
    if guess.is_empty() || guess.len() > 200 {
        return bad("Wpisz flagę");
    }
    let t = now();
    if tries_used(me.id, t) >= MAX_TRIES {
        return bad("Za dużo prób - odczekaj kilka minut");
    }
    TRIES.lock().unwrap_or_else(|e| e.into_inner()).entry(me.id).or_default().push(t);
    let cx = Ctx::new(st, me);
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let Some(r) = current(&mut tx, &cx.cat).await? else { return bad("Quest CTF jest teraz wyłączony") };
    if r.winner_id.is_some() {
        return bad("Ktoś już zdobył tę flagę - nowe zadanie pojawi się niedługo");
    }
    sqlx::query("UPDATE ctf_quests SET attempts = attempts + 1 WHERE key = $1").bind(&r.key).execute(&mut *tx).await?;
    if normalize(guess) != normalize(&r.flag) {
        tx.commit().await?;
        let left = MAX_TRIES.saturating_sub(tries_used(cx.uid(), t));
        return bad(format!("Zła flaga. Zostało prób: {left}"));
    }
    let pid = r.person_id.clone().unwrap_or_default();
    let money = cx.cat.person(&pid).map_or(0, |p| p.value(REWARD_VARIANT));
    let won = sqlx::query("UPDATE ctf_quests SET winner_id = $1, won_at = $2, money = $3 WHERE key = $4 AND winner_id IS NULL")
        .bind(cx.uid())
        .bind(now())
        .bind(money)
        .bind(&r.key)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if won != 1 {
        return bad("Ktoś był szybszy o ułamek sekundy");
    }
    if cx.cat.person(&pid).is_some() {
        insert_plain(&mut tx, &cx, &pid, REWARD_VARIANT, "quest").await?;
    }
    add_state(&mut tx, cx.uid(), "balance", money).await?;
    achievements::count_quest(&mut tx, cx.uid()).await?;
    tx.commit().await?;
    ok(json!({"ok": true, "person": pid, "money": money}))
}

// ---------- strony zadań (/ctf/<token>/...) ----------

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Html(page_html("404", "<h1>404</h1><p>Nie ma tu niczego. Na pewno?</p>", ""))).into_response()
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Wspólny wygląd stron zadań: tania strona firmowa z lat 2000
fn page_html(title: &str, body: &str, head: &str) -> String {
    format!(
        r#"<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>{title}</title>{head}<style>
body{{margin:0;font:15px/1.5 Verdana,Tahoma,sans-serif;background:#d7dde6;color:#1b2430}}
.top{{background:linear-gradient(#2d5f9a,#1d3f6b);color:#fff;padding:14px 22px;font:bold 20px Tahoma,sans-serif;letter-spacing:.5px}}
.top small{{display:block;font:12px Verdana;opacity:.8}}
main{{max-width:640px;margin:28px auto;padding:22px 26px;background:#fff;border:1px solid #9aa8bb;box-shadow:0 2px 0 #b8c3d2}}
h1{{margin:0 0 12px;font:bold 22px Tahoma,sans-serif;color:#1d3f6b}}
input,button{{font:inherit;padding:6px 10px;border:1px solid #7f8da1;border-radius:3px}}
button{{background:linear-gradient(#f4f6f9,#d9dfe7);cursor:pointer}}
code,pre{{font-family:Consolas,monospace;background:#eef1f5;padding:2px 6px}}
.flag{{margin-top:14px;padding:12px;border:2px dashed #2f8f46;background:#effaf1;font:bold 17px Consolas,monospace;color:#1e6b33;word-break:break-all}}
.muted{{color:#5d6b7d;font-size:13px}} footer{{text-align:center;color:#5d6b7d;font-size:12px;margin:18px}}
a{{color:#1d4f8f}}
</style></head><body><div class="top">Kebab-Soft Sp. z o.o.<small>Systemy, które prawie działają</small></div><main>{body}</main>
<footer>&copy; 2004 Kebab-Soft. Strona najlepiej wygląda w rozdzielczości 1024x768.</footer></body></html>"#
    )
}

fn html_resp(body: String) -> Response {
    let mut res = Html(body).into_response();
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

fn text_resp(body: String) -> Response {
    let mut res = ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], body).into_response();
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

fn flag_box(flag: &str) -> String {
    format!(r#"<div class="flag">{}</div>"#, esc(flag))
}

fn cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.trim().to_owned())
}

fn query_id(q: Option<&str>) -> Option<u32> {
    q?.split('&').filter_map(|kv| kv.split_once('=')).find(|(k, _)| *k == "id")?.1.parse().ok()
}

fn render(r: &CtfRow, rest: &str, query: Option<&str>, headers: &HeaderMap) -> Response {
    let s = secrets(r.seed);
    let base = format!("/ctf/{}", r.token);
    let flag = r.flag.as_str();
    match (r.challenge.as_str(), rest) {
        ("source", "") => html_resp(page_html(
            "Intranet Kebab-Soft",
            &format!(
                r#"<h1>Intranet - logowanie</h1>
<!-- TODO: usunac przed wdrozeniem!!! stary panel nadal dziala: {base}/panel-{code}/ -->
<p>Witamy w nowym intranecie Kebab-Soft. Zaloguj się danymi firmowymi.</p>
<form onsubmit="alert('Logowanie chwilowo nie działa. Spróbuj jutro.');return false">
<p><input placeholder="login"> <input type="password" placeholder="hasło"> <button>Zaloguj</button></p></form>
<p class="muted">Wersja 2.0 - całkowicie bezpieczna.</p>"#,
                code = s.code
            ),
            "",
        )),
        ("source", p) if p == format!("panel-{}/", s.code) || p == format!("panel-{}", s.code) => html_resp(page_html(
            "Stary panel",
            &format!("<h1>Stary panel administratora</h1><p>Ups. Ten panel miał zniknąć.</p>{}", flag_box(flag)),
            "",
        )),
        ("cookie", "") => {
            if cookie(headers, "rola").as_deref() == Some("admin") {
                return html_resp(page_html(
                    "Panel",
                    &format!("<h1>Witaj, administratorze</h1><p>Oto tajne dane firmy:</p>{}", flag_box(flag)),
                    "",
                ));
            }
            let mut res = html_resp(page_html(
                "Panel",
                "<h1>Panel firmowy</h1><p>Witaj, <b>gościu</b>. Tylko administrator może zobaczyć tajne dane.</p><p class=\"muted\">Twoja rola została zapamiętana.</p>",
                "",
            ));
            if let Ok(v) = HeaderValue::from_str(&format!("rola=gosc; Path={base}/; SameSite=Lax")) {
                res.headers_mut().insert(header::SET_COOKIE, v);
            }
            res
        }
        ("robots", "") => html_resp(page_html(
            "Kebab-Soft",
            "<h1>Strona w budowie</h1><p>Tej strony nie znajdziesz w Google. Roboty wyszukiwarek dostały od nas specjalne instrukcje.</p>",
            "",
        )),
        ("robots", "robots.txt") => {
            text_resp(format!("User-agent: *\nDisallow: {base}/archiwum-{}/\n# nikt tu nie zajrzy\n", s.code))
        }
        ("robots", p) if p == format!("archiwum-{}/", s.code) || p == format!("archiwum-{}", s.code) => html_resp(page_html(
            "Index of archiwum",
            &format!(
                r#"<h1>Index of /archiwum-{code}/</h1><pre>
<a href="{base}/archiwum-{code}/faktury-2003.xls">faktury-2003.xls</a>      12-Mar-2004  48K
<a href="{base}/archiwum-{code}/flaga.txt">flaga.txt</a>             01-Apr-2004   1K
<a href="{base}/archiwum-{code}/zdjecia-z-wigilii.zip">zdjecia-z-wigilii.zip</a> 24-Dec-2003  3M</pre>"#,
                code = s.code
            ),
            "",
        )),
        ("robots", p) if p == format!("archiwum-{}/flaga.txt", s.code) => text_resp(format!("{flag}\n")),
        ("headers", "") => {
            let mut res = html_resp(page_html(
                "Kebab-Soft",
                "<h1>Nic tu nie ma</h1><p>Naprawdę. Na tej stronie nie ma żadnej flagi.</p><p class=\"muted\">Serwer: KebabHTTPd/0.9 (bardzo gadatliwy)</p>",
                "",
            ));
            let enc = base64::engine::general_purpose::STANDARD.encode(flag);
            if let Ok(v) = HeaderValue::from_str(&enc) {
                res.headers_mut().insert("x-sekret", v);
            }
            res.headers_mut().insert("x-powered-by", HeaderValue::from_static("KebabHTTPd/0.9"));
            res
        }
        ("idor", "") => html_resp(page_html(
            "Notatnik",
            &format!(
                r#"<h1>Mój notatnik</h1><p>Twoja notatka:</p><pre id="note">Wczytywanie...</pre>
<script>
fetch("api/notatki?id={note}").then(r => r.json()).then(n => {{
  document.getElementById("note").textContent = n.tresc || n.blad;
}});
</script>"#,
                note = s.note
            ),
            "",
        )),
        ("idor", "api/notatki") => {
            let id = query_id(query);
            let body = match id {
                Some(1) => json!({"id": 1, "autor": "admin", "tresc": format!("Hasło do wszystkiego: {flag}")}),
                Some(n) if n == s.note => json!({"id": n, "autor": "ty", "tresc": "Kupić mleko. Nie zapomnieć, że admin trzyma hasła w notatce numer... zapomniałem."}),
                Some(n @ 2..=6) => json!({"id": n, "autor": format!("user{n}"), "tresc": "Spotkanie przeniesione na piątek."}),
                Some(n) => json!({"id": n, "blad": "Brak notatki"}),
                None => json!({"blad": "Podaj id"}),
            };
            let mut res = axum::Json(body).into_response();
            res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            res
        }
        ("jscheck", "") => {
            let codes: Vec<String> = s.password.bytes().rev().map(|b| b.to_string()).collect();
            let key = s.password.as_bytes();
            let locked: String = flag.bytes().enumerate().map(|(i, b)| format!("{:02x}", b ^ key[i % key.len()])).collect();
            html_resp(page_html(
                "Sejf",
                &format!(
                    r#"<h1>Sejf Kebab-Soft</h1><p>Wpisz hasło, aby otworzyć sejf.</p>
<form id="f"><input id="p" type="password" placeholder="hasło"> <button>Otwórz</button></form><div id="out"></div>
<script>
// hasło zaszyfrowane - nikt go nie odczyta ;)
const k = [{codes}];
const s = "{locked}";
document.getElementById("f").onsubmit = e => {{
  e.preventDefault();
  const p = document.getElementById("p").value;
  const out = document.getElementById("out");
  if (p !== String.fromCharCode(...k.slice().reverse())) {{ out.textContent = "Złe hasło."; return; }}
  let f = "";
  for (let i = 0; i < s.length; i += 2) f += String.fromCharCode(parseInt(s.substr(i, 2), 16) ^ p.charCodeAt((i / 2) % p.length));
  out.innerHTML = '<div class="flag"></div>';
  out.firstChild.textContent = f;
}};
</script>"#,
                    codes = codes.join(", ")
                ),
                "",
            ))
        }
        _ => not_found(),
    }
}

async fn by_token(st: &AppState, token: &str) -> Res<Option<CtfRow>> {
    let mut c = st.db.acquire().await?;
    if !enabled(&mut c).await? || token.len() != 16 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Ok(None);
    }
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!("SELECT {COLUMNS} FROM ctf_quests WHERE token = $1")))
        .bind(token)
        .fetch_optional(&mut *c)
        .await?)
}

pub async fn ctf_root(Path(token): Path<String>) -> Response {
    Redirect::permanent(&format!("/ctf/{}/", esc(&token))).into_response()
}

pub async fn ctf_index(State(st): State<AppState>, Path(token): Path<String>, RawQuery(q): RawQuery, headers: HeaderMap) -> Res {
    Ok(match by_token(&st, &token).await? {
        Some(r) => render(&r, "", q.as_deref(), &headers),
        None => not_found(),
    })
}

pub async fn ctf_page(
    State(st): State<AppState>,
    Path((token, rest)): Path<(String, String)>,
    RawQuery(q): RawQuery,
    headers: HeaderMap,
) -> Res {
    Ok(match by_token(&st, &token).await? {
        Some(r) => render(&r, &rest, q.as_deref(), &headers),
        None => not_found(),
    })
}

// ---------- panel admina ----------

pub async fn admin_ctf(State(st): State<AppState>, Admin(_me): Admin) -> Res {
    let cat = st.cat();
    let mut c = st.db.acquire().await?;
    let on = enabled(&mut c).await?;
    let cur = if on { current(&mut c, &cat).await? } else { None };
    let rows: Vec<CtfRow> =
        sqlx::query_as(sqlx::AssertSqlSafe(format!("SELECT {COLUMNS} FROM ctf_quests ORDER BY n DESC LIMIT {HISTORY}")))
            .fetch_all(&mut *c)
            .await?;
    let mut history = vec![];
    for r in &rows {
        let winner: Option<String> = match r.winner_id {
            Some(id) => sqlx::query_scalar("SELECT username FROM users WHERE id = $1").bind(id).fetch_optional(&mut *c).await?,
            None => None,
        };
        history.push(json!({
            "key": r.key, "title": challenge(&r.challenge).map_or(r.challenge.as_str(), |c| c.title),
            "startsAt": r.starts_at, "wonAt": r.won_at, "winner": winner, "money": r.money, "attempts": r.attempts,
            "person": r.person_id.as_deref().and_then(|p| cat.person(p)).map(|p| p.name.clone()),
        }));
    }
    ok(json!({
        "enabled": on,
        "current": cur.as_ref().map(|r| json!({
            "title": challenge(&r.challenge).map_or(r.challenge.as_str(), |c| c.title),
            "flag": r.flag, "nextAt": r.next_at(), "done": r.winner_id.is_some(), "attempts": r.attempts,
            "url": challenge(&r.challenge).filter(|c| c.page).map(|_| format!("/ctf/{}/", r.token)),
        })),
        "challenges": CHALLENGES.iter().map(|c| json!({"id": c.id, "title": c.title, "category": c.category, "level": c.level})).collect::<Vec<_>>(),
        "history": history,
    }))
}

#[derive(Deserialize)]
pub struct CtfSettings {
    enabled: Option<bool>,
    #[serde(default)]
    reroll: bool,
    /// zadanie wybrane przez admina przy losowaniu (puste = losowe)
    challenge: Option<String>,
}

async fn drop_open(c: &mut Conn) -> sqlx::Result<()> {
    if let Some(r) = latest(&mut *c).await?.filter(|r| r.winner_id.is_none()) {
        sqlx::query("DELETE FROM ctf_quests WHERE key = $1 AND winner_id IS NULL").bind(r.key).execute(c).await?;
    }
    Ok(())
}

pub async fn admin_ctf_save(State(st): State<AppState>, Admin(me): Admin, JsonBody(req): JsonBody<CtfSettings>) -> Res {
    let cat = st.cat();
    let mut tx = st.db.begin().await?;
    if let Some(on) = req.enabled {
        sqlx::query("INSERT INTO state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
            .bind(ENABLED_KEY)
            .bind(i64::from(on))
            .execute(&mut *tx)
            .await?;
        if !on {
            drop_open(&mut tx).await?;
        }
        log_admin(&mut tx, &me, "ctf", None, if on { "włączony" } else { "wyłączony" }).await?;
    } else if req.reroll {
        if !enabled(&mut tx).await? {
            return bad("Najpierw włącz quest CTF");
        }
        if latest(&mut tx).await?.is_some_and(|r| r.winner_id.is_some() && now() < r.next_at()) {
            return bad("Ten quest jest już wypełniony - nowy pojawi się sam");
        }
        let forced = req.challenge.as_deref().filter(|c| !c.is_empty());
        if forced.is_some_and(|c| challenge(c).is_none()) {
            return bad("Nie ma takiego zadania");
        }
        drop_open(&mut tx).await?;
        create(&mut tx, &cat, forced).await?;
        log_admin(&mut tx, &me, "ctf", None, &format!("nowe zadanie {}", forced.unwrap_or("losowe"))).await?;
    }
    tx.commit().await?;
    ok(json!({"ok": true}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_are_random_and_stable() {
        assert_eq!(flag_for("source", 42), flag_for("source", 42));
        assert_ne!(flag_for("source", 42), flag_for("source", 43));
        assert!(flag_for("idor", 7).starts_with("SB{") && flag_for("idor", 7).ends_with('}'));
        let h = flag_for("hash", 9);
        assert!(LEAKED.iter().any(|w| h == format!("SB{{{w}}}")));
    }

    #[test]
    fn answers_are_forgiving() {
        assert_eq!(normalize(" SB{Kebab_Kot_12ab} "), normalize("sb{kebab_kot_12ab}"));
        assert_eq!(normalize("kebab_kot_12ab"), normalize("SB{kebab_kot_12ab}"));
        assert_ne!(normalize("kebab"), normalize("SB{kebab_kot_12ab}"));
    }

    #[test]
    fn crypto_tasks_decode_back_to_the_flag() {
        let seed = 12345;
        let flag = flag_for("caesar", seed);
        let shift = secrets(seed).shift;
        let data = task_data("caesar", seed, &flag).unwrap();
        assert!(caesar(&data, 26 - shift).ends_with(&flag));
        let data = task_data("encoded", seed, &flag).unwrap();
        let raw = base64::engine::general_purpose::STANDARD.decode(data).unwrap();
        assert!(rot13(&String::from_utf8(raw).unwrap()).ends_with(&flag));
        let flag = flag_for("hash", seed);
        let data = task_data("hash", seed, &flag).unwrap();
        let word = flag.trim_start_matches("SB{").trim_end_matches('}');
        assert!(data.contains(&sha256_hex(word)));
    }

    #[test]
    fn every_challenge_has_three_hints_and_unique_id() {
        let mut ids: Vec<_> = CHALLENGES.iter().map(|c| c.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), CHALLENGES.len());
        assert!(CHALLENGES.iter().all(|c| c.hints.iter().all(|h| !h.is_empty()) && (1..=3).contains(&c.level)));
    }
}
