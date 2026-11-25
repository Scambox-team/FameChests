//! Doświadczenie (EXP) i levele konta 1-100.
//!
//! - EXP dają zdarzenia w grze (skrzynki, kasyno, gry, rynek, questy...). Jedno miejsce przyznawania: [`award`], wołane z haków zdarzeń
//!   (tam, gdzie liczą się też osiągnięcia: `achievements::count_*`, a także w endpointach gier). Tabela źródeł [`SOURCES`] to wartości
//!   domyślne; admin zmienia w panelu ile EXP daje źródło, dzienny PRÓG EXP z danego źródła i globalny mnożnik. Po przekroczeniu progu EXP
//!   za każde kolejne zdarzenie z tego źródła maleje (wzór w [`decayed`]) aż do 1 EXP. Przeglądarka NIGDY nie podaje EXP ani levelu:
//!   liczy tylko serwer, ze zdarzeń, które sam zweryfikował.
//! - Krzywa: EXP na przejście z levelu L na L+1 = `base + scale * L^power` (zaokrąglone do 5), parametry i pojedyncze poziomy
//!   admin może nadpisać. Level liczymy z sumy EXP (`user_exp.exp`), maksimum [`MAX_LEVEL`].
//! - Nagrody za level: mała (każdy level), specjalna (opcjonalna) i duże domyślnie co 10. level; format jak w osiągnięciach
//!   (`events::clean_reward`), przyznawane RAZ na level przez [`settle`] (tabela `level_claims`, klucz główny user+level).
//!   `settle` woła warstwa `achievements::layer` po zapytaniu (i `/api/me`), więc haki zdarzeń tylko dopisują EXP.
//! - Duże nagrody (domyślnie co 10. level): 4 opcje (skrzynka z pieniędzmi, 2 karty Mityczne+, slot dodatkowy), gracz wybiera 2 (`level_choices`).
//! - Level 100 daje odznakę „za służbę w roku RRRR” (`exp_badges`; poziom odznaki rośnie z liczbą dojść do 100 w roku) i RESETUJE level do 1
//!   (`user_exp.cycle` + 1; nagrody leveli liczą się od nowa).
//! - Stare konta: EXP z historii liczy się raz, leniwie, przy pierwszym rozliczeniu (`user_exp.bf`), z ograniczeniem
//!   i BEZ nagród za przeskoczone levele (patrz `backfill`).
//!
//! Ustawienia: tabela `exp_config` (wiersz `main` z JSON-em) + `exp_level_rewards` (tylko levele z nagrodami różnymi od domyślnych);
//! trzymane w pamięci procesu (`config()`), odświeżane przy zapisie z panelu.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::{Arc, LazyLock};

use chrono::{Datelike, Local};
use parking_lot::RwLock;
use serde_json::{json, Map, Value};

use crate::auth::User;
use crate::catalog::Catalog;
use crate::db::{lock_me, now, Conn};
use crate::events::clean_reward;
use crate::game::{valid_chest_kind, Ctx};
use crate::state::AppState;

/// Najwyższy level
pub const MAX_LEVEL: i64 = 100;
/// Najwięcej pozycji w puli „ekskluzywne z leveli” (kart i skrzynek osobno)
pub const MAX_EXCLUSIVE: usize = 50;
/// Najwięcej nagród w jednej puli (mała / specjalna) jednego levelu
pub const MAX_REWARDS: usize = 4;
/// Starym kontom z historii liczymy EXP najwyżej do tego levelu
pub const BACKFILL_MAX_LEVEL: i64 = 50;
/// Domyślny procent EXP z historii dla starych kont
pub const DEFAULT_BACKFILL_PCT: i64 = 50;
/// Duża nagroda: tyle opcji, z tylu gracz wybiera `CHOICE_PICKS`
pub const CHOICE_OPTIONS: usize = 4;
pub const CHOICE_PICKS: usize = 2;
/// Domyślna szybkość spadku EXP po przekroczeniu dziennego progu (wykładnik: EXP × (próg / zdobyte dziś)^wykładnik)
pub const DEFAULT_DECAY: f64 = 2.0;
/// Poziomy odznaki za służbę: 1 dojście do levelu 100 w roku = zwykła, kolejne podnoszą poziom
pub const BADGE_TIERS: &[&str] = &["Zwykła", "Brązowa", "Srebrna", "Złota", "Platynowa", "Szmaragdowa", "Ametystowa", "Rubinowa", "Szafirowa", "Diamentowa", "Czarny diament", "Papieska"];
/// Ile razy w roku trzeba dojść do 100, żeby mieć odznakę poziomu `tier` (1-based)
pub fn badge_tier(count: i64) -> usize {
    (count.max(1) as usize).min(BADGE_TIERS.len())
}
const CONFIG_ROW: &str = "main";

// ---------------------------------------------------------------- źródła EXP

pub struct Src {
    pub key: &'static str,
    pub group: &'static str,
    pub name: &'static str,
    /// EXP za jedno zdarzenie
    pub exp: i64,
    /// dzienny próg EXP z tego źródła na gracza: po jego przekroczeniu EXP za zdarzenie maleje do 1 (0 = bez spadku)
    pub cap: i64,
}

const fn src(key: &'static str, group: &'static str, name: &'static str, exp: i64, cap: i64) -> Src {
    Src { key, group, name, exp, cap }
}

pub const SOURCES: &[Src] = &[
    src("open", "Skrzynki", "Otwarcie skrzynki (za sztukę, tylko skrzynki płatne)", 5, 1000),
    src("open_money", "Skrzynki", "Otwarcie skrzynki z pieniędzmi (Codzienna, MEGA)", 5, 100),
    src("open_stickers", "Skrzynki", "Otwarcie skrzynki z naklejkami", 5, 100),
    src("daily", "Skrzynki", "Odebranie codziennej skrzynki", 20, 20),
    src("contract", "Kuźnia i kasyno", "Kontrakt w kuźni", 15, 600),
    src("upgrade", "Kuźnia i kasyno", "Ulepszacz", 12, 600),
    src("casino_roulette", "Kuźnia i kasyno", "Ruletka (za rozegraną grę ze stawką)", 8, 400),
    src("casino_slots", "Kuźnia i kasyno", "Bandyta", 4, 200),
    src("casino_blackjack", "Kuźnia i kasyno", "Blackjack", 8, 400),
    src("casino_horses", "Kuźnia i kasyno", "Wyścigi konne", 8, 400),
    src("casino_poker", "Kuźnia i kasyno", "Poker (rozdanie)", 15, 600),
    src("casino_jackpot", "Kuźnia i kasyno", "Jackpot", 15, 450),
    src("casino_win", "Kuźnia i kasyno", "Premia za wygraną w kasynie (do powyższych)", 6, 300),
    src("chess_win", "Gry", "Szachy: wygrana z człowiekiem", 40, 200),
    src("chess_play", "Gry", "Szachy: skończona partia z człowiekiem (obie strony)", 15, 150),
    src("chess_bot", "Gry", "Szachy: skończona partia z botem (trening)", 5, 30),
    src("pinball", "Gry", "Pinball: poprawnie zakończona gra", 15, 150),
    src("snake", "Gry", "Snake: zakończona gra z wynikiem", 10, 100),
    src("snake3d", "Gry", "Super Turbo Snake 3D: zakończona gra z wynikiem", 12, 120),
    src("run", "Gry", "Super Turbo Run 3D: zakończony bieg", 12, 120),
    src("aim", "Gry", "Strzelnica: sprawdzona runda", 10, 100),
    src("market_buy", "Rynek i wymiany", "Rynek: kupno (oferta, propozycja, licytacja, „Szukam”)", 10, 100),
    src("market_sell", "Rynek i wymiany", "Rynek: sprzedaż", 10, 100),
    src("trade", "Rynek i wymiany", "Przyjęta wymiana (obie strony)", 12, 120),
    src("quest_wanted", "Questy i inne", "Quest Wanted wykonany", 100, 600),
    src("quest_ctf", "Questy i inne", "Quest CTF wykonany", 150, 600),
    src("achievement", "Questy i inne", "Zdobyte osiągnięcie", 50, 0),
    src("advent", "Questy i inne", "Okienko kalendarza adwentowego", 20, 20),
    src("passport", "Questy i inne", "Nowy stempel w paszporcie", 30, 300),
    src("arena_win", "Arena", "Arena: wygrany mecz z człowiekiem", 40, 200),
    src("arena_play", "Arena", "Arena: mecz z człowiekiem rozegrany do końca czasu (obie strony)", 10, 100),
    src("arena_bot", "Arena", "Arena: wygrany trening z komputerem", 10, 50),
];

pub fn src_def(key: &str) -> Option<&'static Src> {
    SOURCES.iter().find(|s| s.key == key)
}

// ---------------------------------------------------------------- krzywa

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Curve {
    pub base: f64,
    pub scale: f64,
    pub power: f64,
}

/// Do levelu 10 ok. 650 EXP, do 50 ok. 20 000, do 100 ok. 107 000 - ok. 7 miesięcy aktywnej gry przy ~500 EXP na dobę
pub const DEFAULT_CURVE: Curve = Curve { base: 40.0, scale: 2.6, power: 1.5 };

impl Curve {
    /// EXP potrzebne, żeby przejść z `level` na `level + 1`
    pub fn need(&self, level: i64) -> i64 {
        let x = self.base + self.scale * (level.max(1) as f64).powf(self.power);
        (((x / 5.0).round() as i64) * 5).max(5)
    }
}

// ---------------------------------------------------------------- nagrody domyślne

#[derive(Clone, Debug, Default, PartialEq)]
pub struct LevelRewards {
    /// nagroda standardowa (każdy level)
    pub small: Vec<Value>,
    /// nagroda specjalna (opcjonalna, osobne pole)
    pub special: Vec<Value>,
}

/// Domyślne nagrody levelu: level 1 = start (bez nagrody); mała = grosze rosnące z levelem, co 5. level dodatkowo skrzynki.
/// Specjalnych domyślnie nie ma. Duże nagrody (wybór 2 z 4) to osobny mechanizm: [`ExpConfig::choice_levels`].
pub fn default_rewards(level: i64) -> LevelRewards {
    if !(2..=MAX_LEVEL).contains(&level) {
        return LevelRewards::default();
    }
    let money = |a: i64| json!({"type": "money", "amount": a});
    let chest = |k: &str, n: i64| json!({"type": "chest", "kind": k, "count": n});
    let mut small = vec![money(500 + 50 * level)];
    if level % 5 == 0 {
        small.push(chest("pl", 2 + level / 30));
    }
    LevelRewards { small, special: vec![] }
}

// ---------------------------------------------------------------- konfiguracja

#[derive(Clone, Debug)]
pub struct ExpConfig {
    /// globalny mnożnik EXP
    pub mult: f64,
    pub backfill_pct: i64,
    pub curve: Curve,
    /// nadpisane „EXP na przejście z levelu L na L+1”
    pub needs: BTreeMap<i64, i64>,
    /// źródło -> (EXP, dzienny próg)
    pub sources: HashMap<String, (i64, i64)>,
    /// szybkość spadku EXP po przekroczeniu progu
    pub decay: f64,
    /// levele z dużą nagrodą (wybór 2 z 4); domyślnie co 10.
    pub choice_levels: BTreeSet<i64>,
    /// szansa, że slot dodatkowy dużej nagrody to coś z puli „ekskluzywne z leveli” (gdy pula nie jest pusta)
    pub exclusive_chance: f64,
    /// pula ekskluzywnych kart z leveli: (osoba, wariant)
    pub excl_cards: Vec<(String, String)>,
    /// pula ekskluzywnych skrzynek z leveli (rodzaj skrzynki)
    pub excl_chests: Vec<String>,
    /// levele z nagrodami zmienionymi w panelu (reszta = domyślne)
    pub rewards: BTreeMap<i64, LevelRewards>,
    /// thr[l] = łączny EXP potrzebny do levelu l (thr[1] = 0)
    thr: Vec<i64>,
}

impl Default for ExpConfig {
    fn default() -> Self {
        ExpConfig {
            mult: 1.0,
            backfill_pct: DEFAULT_BACKFILL_PCT,
            curve: DEFAULT_CURVE,
            needs: BTreeMap::new(),
            sources: SOURCES.iter().map(|s| (s.key.to_owned(), (s.exp, s.cap))).collect(),
            decay: DEFAULT_DECAY,
            choice_levels: (1..=MAX_LEVEL / 10).map(|i| i * 10).collect(),
            exclusive_chance: 0.2,
            excl_cards: vec![],
            // domyślnie w puli „ekskluzywne z leveli” jest skrzynka z naklejkami (jeśli istnieje - `usable` pilnuje)
            excl_chests: vec![format!("{}{}", crate::stickers::KIND_PREFIX, crate::stickers::DEFAULT_CRATE)],
            rewards: BTreeMap::new(),
            thr: vec![],
        }
        .finish()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Progress {
    pub exp: i64,
    pub level: i64,
    /// EXP zdobyty na bieżącym levelu i potrzebny do następnego (0 na maksimum)
    pub into: i64,
    pub need: i64,
    pub max: bool,
}

impl ExpConfig {
    fn finish(mut self) -> Self {
        let mut thr = vec![0, 0];
        for l in 1..MAX_LEVEL {
            let t = thr[l as usize] + self.need(l);
            thr.push(t);
        }
        self.thr = thr;
        self
    }

    /// EXP na przejście z levelu `l` na `l + 1`
    pub fn need(&self, l: i64) -> i64 {
        self.needs.get(&l).copied().unwrap_or_else(|| self.curve.need(l)).max(1)
    }

    /// Łączny EXP potrzebny do levelu `l`
    pub fn total_for(&self, l: i64) -> i64 {
        self.thr[l.clamp(1, MAX_LEVEL) as usize]
    }

    pub fn level_for(&self, exp: i64) -> i64 {
        (self.thr[1..].partition_point(|t| *t <= exp.max(0)) as i64).clamp(1, MAX_LEVEL)
    }

    pub fn progress(&self, exp: i64) -> Progress {
        let exp = exp.max(0);
        let level = self.level_for(exp);
        if level >= MAX_LEVEL {
            return Progress { exp, level, into: 0, need: 0, max: true };
        }
        Progress { exp, level, into: exp - self.total_for(level), need: self.need(level), max: false }
    }

    pub fn rewards_for(&self, l: i64) -> LevelRewards {
        self.rewards.get(&l).cloned().unwrap_or_else(|| default_rewards(l))
    }

    /// (EXP, dzienny limit) źródła po uwzględnieniu mnożnika; None = nieznane źródło
    fn source(&self, key: &str) -> Option<(i64, i64)> {
        self.sources.get(key).copied()
    }

    pub fn to_json(&self) -> Value {
        json!({
            "mult": self.mult,
            "backfillPct": self.backfill_pct,
            "curve": {"base": self.curve.base, "scale": self.curve.scale, "power": self.curve.power},
            "needs": self.needs.iter().map(|(l, n)| (l.to_string(), json!(n))).collect::<Map<_, _>>(),
            "sources": self.sources.iter().map(|(k, (e, c))| (k.clone(), json!({"exp": e, "cap": c}))).collect::<Map<_, _>>(),
            "decay": self.decay,
            "choiceLevels": self.choice_levels.iter().collect::<Vec<_>>(),
            "exclusiveChance": self.exclusive_chance,
            "exclusiveCards": self.excl_cards.iter().map(|(p, v)| json!({"person": p, "variant": v})).collect::<Vec<_>>(),
            "exclusiveChests": self.excl_chests,
        })
    }
}

fn num(v: Option<&Value>) -> Option<f64> {
    let v = v?;
    v.as_f64().or_else(|| v.as_str()?.trim().replace(',', ".").parse().ok())
}

fn int(v: Option<&Value>) -> Option<i64> {
    num(v).filter(|x| x.is_finite()).map(|x| x.round() as i64)
}

/// Nagrody z formularza: tylko takie, które da się przyznać (karta i skrzynka muszą istnieć), najwyżej `MAX_REWARDS`
pub fn clean_rewards(raw: Option<&Value>, cat: &Catalog) -> Vec<Value> {
    raw.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(clean_reward)
        .filter(|r| usable(cat, r))
        .take(MAX_REWARDS)
        .collect()
}

pub fn usable(cat: &Catalog, r: &Value) -> bool {
    let s = |k: &str| r.get(k).and_then(Value::as_str).unwrap_or("");
    match s("type") {
        "card" => cat.has(s("person")),
        "chest" => valid_chest_kind(cat, s("kind")),
        "cosmetic" => crate::cosmetics::exists(s("id")),
        _ => true,
    }
}

/// Ustawienia z JSON-a (panel albo baza): liczby poza zakresem są przycinane, nieznane źródła pomijane, wszystko, czego brak,
/// wraca do wartości domyślnych. `rewards` to {"<level>": {"small": [...], "special": [...]}}; zostają tylko różne od domyślnych.
pub fn clean_config(raw: &Value, rewards: Option<&Value>, cat: &Catalog) -> ExpConfig {
    let mut c = ExpConfig::default();
    if let Some(m) = num(raw.get("mult")) {
        c.mult = m.clamp(0.0, 100.0);
    }
    if let Some(p) = int(raw.get("backfillPct")) {
        c.backfill_pct = p.clamp(0, 100);
    }
    let cv = raw.get("curve");
    let pick = |k: &str, d: f64, lo: f64, hi: f64| num(cv.and_then(|v| v.get(k))).map_or(d, |x| x.clamp(lo, hi));
    c.curve = Curve {
        base: pick("base", DEFAULT_CURVE.base, 1.0, 100_000.0),
        scale: pick("scale", DEFAULT_CURVE.scale, 0.0, 100_000.0),
        power: pick("power", DEFAULT_CURVE.power, 0.0, 4.0),
    };
    if let Some(m) = raw.get("needs").and_then(Value::as_object) {
        for (k, v) in m {
            let (Ok(l), Some(n)) = (k.parse::<i64>(), int(Some(v))) else { continue };
            if (1..MAX_LEVEL).contains(&l) && n > 0 && n != c.curve.need(l) {
                c.needs.insert(l, n.min(100_000_000));
            }
        }
    }
    if let Some(m) = raw.get("sources").and_then(Value::as_object) {
        for (k, v) in m {
            if src_def(k).is_none() {
                continue;
            }
            let d = src_def(k).unwrap();
            let exp = int(v.get("exp")).unwrap_or(d.exp).clamp(0, 100_000);
            let cap = int(v.get("cap")).unwrap_or(d.cap).clamp(0, 10_000_000);
            c.sources.insert(k.clone(), (exp, cap));
        }
    }
    if let Some(d) = num(raw.get("decay")) {
        c.decay = d.clamp(0.5, 8.0);
    }
    if let Some(e) = num(raw.get("exclusiveChance")) {
        c.exclusive_chance = e.clamp(0.0, 1.0);
    }
    if let Some(l) = raw.get("choiceLevels").and_then(Value::as_array) {
        c.choice_levels = l.iter().filter_map(|v| int(Some(v))).filter(|l| (2..=MAX_LEVEL).contains(l)).collect();
    }
    let g = crate::data::g();
    if let Some(l) = raw.get("exclusiveCards").and_then(Value::as_array) {
        for e in l.iter().take(MAX_EXCLUSIVE) {
            let s = |k: &str| e.get(k).and_then(Value::as_str).unwrap_or("").trim().to_owned();
            let (p, v) = (s("person"), s("variant"));
            let v = if v.is_empty() || !g.variants.contains_key(&v) { "normal".to_owned() } else { v };
            if cat.has(&p) && !c.excl_cards.contains(&(p.clone(), v.clone())) {
                c.excl_cards.push((p, v));
            }
        }
    }
    if let Some(l) = raw.get("exclusiveChests").and_then(Value::as_array) {
        c.excl_chests.clear();   // zapisana lista zastępuje domyślną (skrzynka z naklejkami)
        for k in l.iter().filter_map(Value::as_str).take(MAX_EXCLUSIVE) {
            if valid_chest_kind(cat, k) && !c.excl_chests.iter().any(|x| x == k) {
                c.excl_chests.push(k.to_owned());
            }
        }
    }
    if let Some(m) = rewards.and_then(Value::as_object) {
        for (k, v) in m {
            let Ok(l) = k.parse::<i64>() else { continue };
            if !(2..=MAX_LEVEL).contains(&l) {
                continue;
            }
            let r = LevelRewards { small: clean_rewards(v.get("small"), cat), special: clean_rewards(v.get("special"), cat) };
            if r != default_rewards(l) {
                c.rewards.insert(l, r);
            }
        }
    }
    c.finish()
}

static CONFIG: LazyLock<RwLock<Arc<ExpConfig>>> = LazyLock::new(|| RwLock::new(Arc::new(ExpConfig::default())));

pub fn config() -> Arc<ExpConfig> {
    CONFIG.read().clone()
}

pub fn set_config(c: ExpConfig) {
    *CONFIG.write() = Arc::new(c);
}

/// Wczytuje ustawienia z bazy do pamięci procesu (start serwera, zapis z panelu)
pub async fn load(c: &mut Conn, cat: &Catalog) -> sqlx::Result<Arc<ExpConfig>> {
    let main: Option<String> = sqlx::query_scalar("SELECT data FROM exp_config WHERE key = $1").bind(CONFIG_ROW).fetch_optional(&mut *c).await?;
    let rows: Vec<(i32, String, String)> = sqlx::query_as("SELECT level, small, special FROM exp_level_rewards").fetch_all(&mut *c).await?;
    let raw: Value = main.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    let mut rw = Map::new();
    for (l, small, special) in rows {
        let parse = |s: &str| serde_json::from_str::<Value>(s).unwrap_or(json!([]));
        rw.insert(l.to_string(), json!({"small": parse(&small), "special": parse(&special)}));
    }
    set_config(clean_config(&raw, Some(&Value::Object(rw)), cat));
    Ok(config())
}

/// Zapisuje ustawienia (wiersz `main` + tylko nagrody różne od domyślnych) i odświeża pamięć procesu
pub async fn save(c: &mut Conn, cfg: &ExpConfig) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO exp_config (key, data) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET data = excluded.data")
        .bind(CONFIG_ROW)
        .bind(cfg.to_json().to_string())
        .execute(&mut *c)
        .await?;
    sqlx::query("DELETE FROM exp_level_rewards").execute(&mut *c).await?;
    if !cfg.rewards.is_empty() {
        let (mut ls, mut sm, mut sp) = (vec![], vec![], vec![]);
        for (l, r) in &cfg.rewards {
            ls.push(*l as i32);
            sm.push(Value::Array(r.small.clone()).to_string());
            sp.push(Value::Array(r.special.clone()).to_string());
        }
        sqlx::query("INSERT INTO exp_level_rewards (level, small, special) SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[])")
            .bind(&ls)
            .bind(&sm)
            .bind(&sp)
            .execute(&mut *c)
            .await?;
    }
    Ok(())
}

/// Przywraca ustawienia domyślne (usuwa wiersze z bazy)
pub async fn reset(c: &mut Conn) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM exp_config").execute(&mut *c).await?;
    sqlx::query("DELETE FROM exp_level_rewards").execute(&mut *c).await?;
    Ok(())
}

pub async fn init(c: &mut Conn, cat: &Catalog) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM exp_daily WHERE day < $1").bind(day_key(-3)).execute(&mut *c).await?;
    load(c, cat).await.map(|_| ())
}

// ---------------------------------------------------------------- przyznawanie EXP

/// Dzień (czas lokalny serwera) przesunięty o `shift` dni, RRRR-MM-DD
pub fn day_key(shift: i64) -> String {
    (Local::now().date_naive() + chrono::Duration::days(shift)).format("%Y-%m-%d").to_string()
}

/// EXP za jedno zdarzenie po uwzględnieniu dziennego progu: do progu pełna wartość, potem `base × (próg / zdobyte dziś)^wykładnik`
/// (płynnie od 1×), nie mniej niż 1 EXP. `cap <= 0` = bez spadku.
pub fn decayed(base: f64, cap: i64, used: i64, power: f64) -> i64 {
    let per = if cap <= 0 || used < cap { base } else { base * (cap as f64 / used.max(1) as f64).powf(power) };
    (per.round() as i64).max(if base > 0.0 { 1 } else { 0 })
}

/// Suma za `units` zdarzeń z jednego źródła (każde następne liczone od już zdobytego dziś EXP): (przyznano, zdobyte dziś po)
pub fn decayed_total(base: f64, cap: i64, used: i64, power: f64, units: i64) -> (i64, i64) {
    let (mut total, mut u) = (0, used);
    for _ in 0..units.clamp(0, 1000) {
        let one = decayed(base, cap, u, power);
        total += one;
        u += one;
    }
    (total, u)
}

/// EXP za `units` zdarzeń źródła `source` dla gracza `uid`. Jedyne miejsce, które dopisuje EXP: stosuje mnożnik i dzienny próg
/// (`exp_daily`, po jego przekroczeniu EXP za zdarzenie maleje do 1), zapisuje w tej samej transakcji co zdarzenie i zgłasza
/// przyznany EXP warstwie `achievements::layer` (nagłówek X-Exp). Zwraca przyznany EXP (0 = nieznane źródło albo 0 EXP w ustawieniach).
/// Level i nagrody rozlicza później [`settle`] - hak zdarzenia nie musi nic więcej robić. Żadna wartość EXP nie pochodzi od przeglądarki.
pub async fn award(c: &mut Conn, uid: i64, source: &str, units: i64) -> sqlx::Result<i64> {
    if uid <= 0 || units <= 0 {
        return Ok(0);
    }
    let cfg = config();
    let Some((exp, cap)) = cfg.source(source) else { return Ok(0) };
    let base = exp as f64 * cfg.mult;
    if base <= 0.0 {
        return Ok(0);
    }
    let day = day_key(0);
    let used: i64 = if cap > 0 {
        sqlx::query_scalar("SELECT exp FROM exp_daily WHERE user_id = $1 AND source = $2 AND day = $3")
            .bind(uid)
            .bind(source)
            .bind(&day)
            .fetch_optional(&mut *c)
            .await?
            .unwrap_or(0)
    } else {
        0
    };
    let (amount, _) = decayed_total(base, cap, used, cfg.decay, units);
    if amount <= 0 {
        return Ok(0);
    }
    if cap > 0 {
        sqlx::query(
            "INSERT INTO exp_daily (user_id, source, day, exp) VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, source, day) DO UPDATE SET exp = exp_daily.exp + excluded.exp",
        )
        .bind(uid)
        .bind(source)
        .bind(&day)
        .bind(amount)
        .execute(&mut *c)
        .await?;
    }
    add_exp(c, uid, amount).await?;
    crate::achievements::mark_exp(uid, amount);
    Ok(amount)
}

/// Gra w kasynie rozegrana: EXP za grę ze stawką (bez postawionych kart nic) i premia za wygraną. Wołane z `achievements::count_casino`.
pub async fn casino(c: &mut Conn, uid: i64, game: &str, won: Option<bool>, staked: bool) -> sqlx::Result<()> {
    if !staked {
        return Ok(());
    }
    award(&mut *c, uid, &format!("casino_{game}"), 1).await?;
    if won == Some(true) {
        award(c, uid, "casino_win", 1).await?;
    }
    Ok(())
}

/// Zakup na rynku (kupno, przyjęta propozycja, wygrana licytacja, wypełnione zlecenie „Szukam”): kupujący i sprzedający.
/// Transakcja z samym sobą nic nie daje.
pub async fn market_trade(c: &mut Conn, buyer: i64, seller: i64) -> sqlx::Result<()> {
    if buyer == seller {
        return Ok(());
    }
    award(&mut *c, buyer, "market_buy", 1).await?;
    award(c, seller, "market_sell", 1).await?;
    Ok(())
}

/// Przyjęta wymiana: obie strony (wymiana z samym sobą nic nie daje)
pub async fn trade_done(c: &mut Conn, a: i64, b: i64) -> sqlx::Result<()> {
    if a == b {
        return Ok(());
    }
    award(&mut *c, a, "trade", 1).await?;
    award(c, b, "trade", 1).await?;
    Ok(())
}

async fn add_exp(c: &mut Conn, uid: i64, amount: i64) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO user_exp (user_id, exp) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET exp = user_exp.exp + excluded.exp")
        .bind(uid)
        .bind(amount)
        .execute(c)
        .await?;
    Ok(())
}

/// Poziomy do rozliczenia: od następnego po `settled` do `level` włącznie
pub fn new_levels(settled: i64, level: i64) -> std::ops::RangeInclusive<i64> {
    (settled.max(1) + 1)..=level.min(MAX_LEVEL)
}

// ---------------------------------------------------------------- duże nagrody (wybór 2 z 4)

/// Cztery opcje dużej nagrody: skrzynka z pieniędzmi (losowa spośród WSZYSTKICH skrzynek z pieniędzmi w grze), dwie karty Mityczne lub
/// wyższe (też w wariantach; bez kart i wariantów ekskluzywnych gdziekolwiek, bez kart specjalnych i tajnych, bez puli „ekskluzywne
/// z leveli”) i slot dodatkowy: z szansą `exclusive_chance` coś z puli ekskluzywnej z leveli (karta albo skrzynka), zwykle po prostu
/// trzecia losowa karta Mityczna+. Opcja: {"slot", "exclusive", "reward"}.
pub fn generate_options(cat: &Catalog, cfg: &ExpConfig) -> Vec<Value> {
    use rand::seq::SliceRandom;
    use rand::Rng;
    let g = crate::data::g();
    let mut rng = rand::thread_rng();
    let pool_people: HashSet<&str> = cfg.excl_cards.iter().map(|(p, _)| p.as_str()).collect();
    let min = g.rarity_idx("red");
    let people: Vec<&crate::catalog::Person> = cat
        .people
        .values()
        .map(|p| &**p)
        .filter(|p| g.rarity_idx(&p.rarity) >= min && !matches!(p.rarity.as_str(), "special" | "secret"))
        .filter(|p| p.forge && p.exclusive.is_empty() && !p.is_special() && !p.is_secret() && !pool_people.contains(p.id.as_str()))
        .collect();
    let variants = cat.base_variants();
    let mut picked: Vec<&crate::catalog::Person> = people.choose_multiple(&mut rng, 3).copied().collect();
    let mut card = |rng: &mut rand::rngs::ThreadRng| -> Value {
        match picked.pop() {
            Some(p) => {
                let variant = crate::game::roll::roll_variant(&variants, &HashMap::new(), 1.0);
                json!({"type": "card", "person": p.id, "variant": variant, "count": 1})
            }
            None => json!({"type": "money", "amount": 50_000 + rng.gen_range(0..10_000)}),
        }
    };
    let kinds: Vec<&String> = g.money_chests.keys().collect();
    let chest = match kinds.choose(&mut rng) {
        Some(k) => json!({"type": "chest", "kind": format!("money_{k}"), "count": 1}),
        None => json!({"type": "money", "amount": 20_000}),
    };
    let (c1, c2) = (card(&mut rng), card(&mut rng));
    let extras: Vec<Value> = cfg
        .excl_cards
        .iter()
        .map(|(p, v)| json!({"type": "card", "person": p, "variant": v, "count": 1}))
        .chain(cfg.excl_chests.iter().map(|k| json!({"type": "chest", "kind": k, "count": 1})))
        .filter(|r| usable(cat, r))
        .collect();
    let exclusive = !extras.is_empty() && rng.gen::<f64>() < cfg.exclusive_chance;
    let bonus = if exclusive { extras.choose(&mut rng).cloned().unwrap_or_else(|| card(&mut rng)) } else { card(&mut rng) };
    vec![
        json!({"slot": "chest", "exclusive": false, "reward": chest}),
        json!({"slot": "card", "exclusive": false, "reward": c1}),
        json!({"slot": "card", "exclusive": false, "reward": c2}),
        json!({"slot": if exclusive { "exclusive" } else { "card" }, "exclusive": exclusive, "reward": bonus}),
    ]
}

/// Wylosowane opcje dużej nagrody czekają na wybór gracza (do `exp_choose` w routes/exp.rs); raz na (gracz, cykl, level)
async fn create_choice(c: &mut Conn, cat: &Catalog, cfg: &ExpConfig, uid: i64, cycle: i64, level: i64) -> sqlx::Result<()> {
    let options = Value::Array(generate_options(cat, cfg)).to_string();
    sqlx::query("INSERT INTO level_choices (user_id, cycle, level, options, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING")
        .bind(uid)
        .bind(cycle as i32)
        .bind(level as i32)
        .bind(options)
        .bind(now())
        .execute(c)
        .await?;
    Ok(())
}

/// Czekające na wybór duże nagrody gracza: (cykl, level, opcje)
pub async fn pending_choices(c: &mut Conn, uid: i64) -> sqlx::Result<Vec<(i64, i64, Vec<Value>)>> {
    let rows: Vec<(i32, i32, String)> =
        sqlx::query_as("SELECT cycle, level, options FROM level_choices WHERE user_id = $1 AND done = 0 ORDER BY created_at, level").bind(uid).fetch_all(c).await?;
    Ok(rows
        .into_iter()
        .map(|(cy, l, o)| (i64::from(cy), i64::from(l), serde_json::from_str::<Vec<Value>>(&o).unwrap_or_default()))
        .collect())
}

// ---------------------------------------------------------------- rozliczanie leveli i nagród

struct Row {
    exp: i64,
    settled: i64,
    bf: bool,
    cycle: i64,
}

async fn row(c: &mut Conn, uid: i64) -> sqlx::Result<Option<Row>> {
    let r: Option<(i64, i32, i16, i32)> =
        sqlx::query_as("SELECT exp, settled, bf, cycle FROM user_exp WHERE user_id = $1").bind(uid).fetch_optional(c).await?;
    Ok(r.map(|(exp, settled, bf, cycle)| Row { exp, settled: settled.into(), bf: bf != 0, cycle: cycle.into() }))
}

/// Rozlicza level gracza: nowe levele dostają nagrody (raz na level w danym cyklu, w transakcji), duże nagrody to wybór 2 z 4
/// (czeka na gracza), level 100 daje odznakę i RESETUJE level do 1 (nowy cykl); stare konto przy pierwszym wywołaniu dostaje EXP
/// z historii (bez nagród za przeskoczone levele). Tanie, gdy nic się nie zmieniło (jedno zapytanie). Zwraca true, gdy przyznano
/// nagrody za nowe levele.
pub async fn settle(st: &AppState, user: &User) -> anyhow::Result<bool> {
    let cfg = config();
    if let Some(r) = row(&mut *st.db.acquire().await?, user.id).await? {
        if r.bf && r.settled >= cfg.level_for(r.exp) {
            return Ok(false);
        }
    }
    let cx = Ctx::new(st.clone(), user.clone());
    let mut tx = st.db.begin().await?;
    lock_me(&mut tx, user.id).await?;
    let mut paid = false;
    let mut r = row(&mut tx, user.id).await?.unwrap_or(Row { exp: 0, settled: 0, bf: false, cycle: 0 });
    if !r.bf {
        let hist = backfill(&mut tx, &cfg, user.id).await?;
        r.exp += hist;
        // przeskoczone levele zapisujemy jako odebrane BEZ nagrody
        let level = cfg.level_for(r.exp);
        mark_skipped(&mut tx, user.id, r.cycle, 2, level).await?;
        sqlx::query(
            "INSERT INTO user_exp (user_id, exp, level, settled, bf) VALUES ($1, $2, $3, $3, 1)
             ON CONFLICT (user_id) DO UPDATE SET exp = $2, level = $3, settled = $3, bf = 1",
        )
        .bind(user.id)
        .bind(r.exp)
        .bind(level as i32)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(false);
    }
    let level = cfg.level_for(r.exp);
    let mut finished = false;
    for l in new_levels(r.settled, level) {
        let fresh = sqlx::query("INSERT INTO level_claims (user_id, cycle, level, claimed_at, seen, paid) VALUES ($1, $2, $3, $4, 0, 1) ON CONFLICT DO NOTHING")
            .bind(user.id)
            .bind(r.cycle as i32)
            .bind(l as i32)
            .bind(now())
            .execute(&mut *tx)
            .await?
            .rows_affected();
        if fresh == 1 {
            let rw = cfg.rewards_for(l);
            let list: Vec<Value> = rw.small.iter().chain(&rw.special).filter(|r| usable(&cx.cat, r)).cloned().collect();
            crate::achievements::grant_rewards(&mut tx, &cx, &list, "level").await?;
            if cfg.choice_levels.contains(&l) {
                create_choice(&mut tx, &cx.cat, &cfg, user.id, r.cycle, l).await?;
            }
            if l >= MAX_LEVEL {
                give_badge(&mut tx, user.id).await?;
                finished = true;
            }
            paid = true;
        }
    }
    if finished || level >= MAX_LEVEL {
        // koniec cyklu: odznaka odebrana, level wraca do 1 (od zera), nagrody leveli liczą się od nowa
        sqlx::query("UPDATE user_exp SET exp = 0, level = 1, settled = 1, cycle = cycle + 1 WHERE user_id = $1").bind(user.id).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE user_exp SET level = $2, settled = GREATEST(settled, $2) WHERE user_id = $1")
            .bind(user.id)
            .bind(level as i32)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(paid)
}

/// Levele `from..=to` bieżącego cyklu jako odebrane bez nagrody (stare konta, ręczne ustawienie levelu przez admina); już odebrane zostają
async fn mark_skipped(c: &mut Conn, uid: i64, cycle: i64, from: i64, to: i64) -> sqlx::Result<()> {
    if to < from {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO level_claims (user_id, cycle, level, claimed_at, seen, paid)
         SELECT $1, $5, g, $4, 1, 0 FROM generate_series($2::int, $3::int) AS g ON CONFLICT DO NOTHING",
    )
    .bind(uid)
    .bind(from as i32)
    .bind(to as i32)
    .bind(now())
    .bind(cycle as i32)
    .execute(c)
    .await?;
    Ok(())
}

/// Odznaka „za służbę w roku RRRR”: jedna na gracza i rok; każde kolejne dojście do levelu 100 w tym samym roku podnosi jej poziom
async fn give_badge(c: &mut Conn, uid: i64) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO exp_badges (user_id, year, at, count) VALUES ($1, $2, $3, 1)
         ON CONFLICT (user_id, year) DO UPDATE SET count = exp_badges.count + 1, at = excluded.at",
    )
    .bind(uid)
    .bind(Local::now().year())
    .bind(now())
    .execute(&mut *c)
    .await?;
    // kosmetyki profilu przypisane do odznaki służby
    crate::cosmetics::grant_auto(c, uid, "service").await?;
    Ok(())
}

/// Ręczne ustawienie EXP przez admina. `set_level`: ustawia level (najwyżej 99) na podanej wartości (EXP = próg levelu), przeskoczone
/// levele bez nagród. `add` / `set_exp` zmieniają sam EXP, a nagrody (także za level 100 i reset) wypłaci zwykłe rozliczenie przy
/// następnym /api/me gracza.
pub async fn admin_change(c: &mut Conn, uid: i64, mode: &str, value: i64) -> sqlx::Result<(i64, i64)> {
    let cfg = config();
    lock_me(c, uid).await?;
    let cur = row(&mut *c, uid).await?;
    let (cycle, now_exp) = cur.map_or((0, 0), |r| (r.cycle, r.exp));
    let (exp, level_mode) = match mode {
        "add" => ((now_exp + value).max(0), false),
        "set_exp" => (value.max(0), false),
        _ => (cfg.total_for(value.clamp(1, MAX_LEVEL - 1)), true),
    };
    let level = cfg.level_for(exp);
    // admin jawnie nadaje EXP: historii nie dolicza się już z góry na dół (bf = 1)
    sqlx::query(
        "INSERT INTO user_exp (user_id, exp, level, settled, bf) VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (user_id) DO UPDATE SET exp = $2, level = $3, bf = 1, settled = CASE WHEN $5 THEN GREATEST(user_exp.settled, $3) ELSE user_exp.settled END",
    )
    .bind(uid)
    .bind(exp)
    .bind(level as i32)
    .bind(if level_mode { level as i32 } else { 1 })
    .bind(level_mode)
    .execute(&mut *c)
    .await?;
    if level_mode {
        mark_skipped(c, uid, cycle, 2, level).await?;
    }
    Ok((exp, level))
}

// ---------------------------------------------------------------- stare konta

async fn counter(c: &mut Conn, uid: i64, key: &str) -> sqlx::Result<i64> {
    sqlx::query_scalar("SELECT COALESCE(SUM(value), 0)::BIGINT FROM user_counters WHERE user_id = $1 AND key = $2").bind(uid).bind(key).fetch_one(c).await
}

/// EXP z historii gracza (liczony raz): otwarte skrzynki, osiągnięcia, stemple, kontrakty i ulepszacz, gry w kasynie, questy,
/// wygrane w szachach z ludźmi i wymiany. Mnożony przez `backfill_pct` i ograniczony do progu levelu `BACKFILL_MAX_LEVEL`.
async fn backfill(c: &mut Conn, cfg: &ExpConfig, uid: i64) -> sqlx::Result<i64> {
    if cfg.backfill_pct <= 0 {
        return Ok(0);
    }
    let one = |sql: &'static str| sqlx::query_scalar::<_, i64>(sql);
    let state: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>(
        "SELECT key, value FROM user_state WHERE user_id = $1 AND key IN ('opened', 'contracts', 'upgrades_won', 'upgrades_lost')",
    )
    .bind(uid)
    .fetch_all(&mut *c)
    .await?
    .into_iter()
    .collect();
    let ach = one("SELECT COUNT(*) FROM user_achievements WHERE user_id = $1").bind(uid).fetch_one(&mut *c).await?;
    let stamps = one("SELECT COUNT(*) FROM passport_stamps WHERE user_id = $1").bind(uid).fetch_one(&mut *c).await?;
    let chess = one("SELECT COUNT(*) FROM chess_games WHERE winner_id = $1 AND bot = 0 AND status = 'finished'").bind(uid).fetch_one(&mut *c).await?;
    let trades = one("SELECT COUNT(*) FROM trades WHERE (from_id = $1 OR to_id = $1) AND status = 'accepted'").bind(uid).fetch_one(&mut *c).await?;
    let plays = counter(&mut *c, uid, "play:any").await?;
    let quests = counter(&mut *c, uid, "quest:win").await?;
    let s = |k: &str| state.get(k).copied().unwrap_or(0);
    let e = |k: &str| cfg.source(k).map_or(0, |x| x.0);
    let raw = s("opened") * e("open")
        + ach * e("achievement")
        + stamps * e("passport")
        + s("contracts") * e("contract")
        + (s("upgrades_won") + s("upgrades_lost")) * e("upgrade")
        + plays * e("casino_roulette")
        + chess * e("chess_win")
        + trades * e("trade") * 2
        + quests * e("quest_wanted");
    let capped = ((raw as f64 * cfg.backfill_pct as f64 / 100.0).round() as i64).min(cfg.total_for(BACKFILL_MAX_LEVEL));
    Ok(capped.max(0))
}

// ---------------------------------------------------------------- widoki dla graczy

/// Postęp gracza do `/api/me` i strony poziomu: EXP, level, pasek do następnego, cykl, nieobejrzane nowe levele, duże nagrody do wybrania
/// i najwyższa odznaka za służbę
pub async fn me_view(c: &mut Conn, uid: i64) -> sqlx::Result<Value> {
    let cfg = config();
    let (exp, cycle) = row(&mut *c, uid).await?.map_or((0, 0), |r| (r.exp, r.cycle));
    let unseen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM level_claims WHERE user_id = $1 AND seen = 0").bind(uid).fetch_one(&mut *c).await?;
    let choices: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM level_choices WHERE user_id = $1 AND done = 0").bind(uid).fetch_one(&mut *c).await?;
    let badge = best_badge(c, uid).await?;
    Ok(progress_json(&cfg, exp, unseen, badge, cycle, choices))
}

pub fn progress_json(cfg: &ExpConfig, exp: i64, unseen: i64, badge: Option<Value>, cycle: i64, choices: i64) -> Value {
    let p = cfg.progress(exp);
    json!({"exp": p.exp, "level": p.level, "into": p.into, "need": p.need, "max": p.max, "maxLevel": MAX_LEVEL, "unseen": unseen,
           "badge": badge, "cycle": cycle, "choices": choices})
}

/// {"year", "tier" (1-12), "name", "count"} odznaki zdobytej w danym roku
pub fn badge_json(year: i32, count: i32) -> Value {
    let tier = badge_tier(i64::from(count));
    json!({"year": year, "tier": tier, "name": BADGE_TIERS[tier - 1], "count": count})
}

/// Najwyższa odznaka gracza (najwyższy poziom, przy remisie najnowszy rok) - zostaje na zawsze
pub async fn best_badge(c: &mut Conn, uid: i64) -> sqlx::Result<Option<Value>> {
    let r: Option<(i32, i32)> =
        sqlx::query_as("SELECT year, count FROM exp_badges WHERE user_id = $1 ORDER BY count DESC, year DESC LIMIT 1").bind(uid).fetch_optional(c).await?;
    Ok(r.map(|(y, n)| badge_json(y, n)))
}

/// Wszystkie odznaki gracza (po latach, od najnowszej)
pub async fn all_badges(c: &mut Conn, uid: i64) -> sqlx::Result<Vec<Value>> {
    let rows: Vec<(i32, i32)> = sqlx::query_as("SELECT year, count FROM exp_badges WHERE user_id = $1 ORDER BY year DESC").bind(uid).fetch_all(c).await?;
    Ok(rows.into_iter().map(|(y, n)| badge_json(y, n)).collect())
}

/// Level i najwyższa odznaka wielu graczy naraz (profile, ranking): id -> (level, odznaka)
pub async fn levels_of(c: &mut Conn, ids: &[i64]) -> sqlx::Result<HashMap<i64, (i64, Option<Value>)>> {
    let cfg = config();
    let rows: Vec<(i64, i64)> = sqlx::query_as("SELECT user_id, exp FROM user_exp WHERE user_id = ANY($1)").bind(ids).fetch_all(&mut *c).await?;
    let badges: HashMap<i64, Value> = sqlx::query_as::<_, (i64, i32, i32)>(
        "SELECT DISTINCT ON (user_id) user_id, year, count FROM exp_badges WHERE user_id = ANY($1) ORDER BY user_id, count DESC, year DESC",
    )
    .bind(ids)
    .fetch_all(&mut *c)
    .await?
    .into_iter()
    .map(|(u, y, n)| (u, badge_json(y, n)))
    .collect();
    let have: HashSet<i64> = rows.iter().map(|r| r.0).collect();
    let mut out: HashMap<i64, (i64, Option<Value>)> = rows.into_iter().map(|(u, e)| (u, (cfg.level_for(e), badges.get(&u).cloned()))).collect();
    for u in ids.iter().filter(|u| !have.contains(u)) {
        out.insert(*u, (1, badges.get(u).cloned()));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curve_and_levels() {
        let c = ExpConfig::default();
        assert_eq!(c.total_for(1), 0);
        assert_eq!(c.level_for(0), 1);
        let t2 = c.total_for(2);
        assert!(t2 > 0);
        assert_eq!(c.level_for(t2 - 1), 1);
        assert_eq!(c.level_for(t2), 2);
        // rosnąca krzywa, maksimum 100
        assert!((1..MAX_LEVEL - 1).all(|l| c.need(l) <= c.need(l + 1)));
        assert_eq!(c.level_for(i64::MAX / 2), MAX_LEVEL);
        let p = c.progress(c.total_for(100) + 5);
        assert!(p.max && p.level == 100);
        // cele krzywej: level 10 po paru dniach, 100 po wielu miesiącach (przy ~500 EXP na dobę)
        let (t10, t50, t100) = (c.total_for(10), c.total_for(50), c.total_for(100));
        assert!((400..1500).contains(&t10), "level 10: {t10}");
        assert!((10_000..40_000).contains(&t50), "level 50: {t50}");
        assert!((80_000..200_000).contains(&t100), "level 100: {t100}");
        println!("EXP do levelu 10 / 50 / 100: {t10} / {t50} / {t100}");
    }

    #[test]
    fn needs_override_changes_thresholds() {
        let raw = json!({"needs": {"1": 7, "2": 7, "500": 5}, "curve": {"base": 40, "scale": 2.6, "power": 1.5}});
        let cat = crate::catalog::build(&[], &[]);
        let c = clean_config(&raw, None, &cat);
        assert_eq!(c.total_for(3), 14);
        assert_eq!(c.need(3), DEFAULT_CURVE.need(3));
        assert!(!c.needs.contains_key(&500));
    }

    #[test]
    fn default_rewards_shape() {
        assert_eq!(default_rewards(1), LevelRewards::default());
        for l in 2..=MAX_LEVEL {
            let r = default_rewards(l);
            assert!(!r.small.is_empty(), "level {l} ma nagrodę");
            assert!(r.special.is_empty());
            assert!(r.small.iter().all(|x| clean_reward(x).is_some()), "level {l}: poprawny format nagrody");
        }
        // duże nagrody (wybór 2 z 4) są domyślnie co 10. level
        let c = ExpConfig::default();
        assert_eq!(c.choice_levels.iter().copied().collect::<Vec<_>>(), (1..=10).map(|i| i * 10).collect::<Vec<_>>());
        // wszystko, co domyślnie przyznajemy, istnieje w grze (karty, warianty, skrzynki)
        let cat = crate::catalog::build(&[], &[]);
        for l in 2..=MAX_LEVEL {
            assert!(default_rewards(l).small.iter().all(|r| usable(&cat, r)), "level {l}: nagroda nie do przyznania");
        }
    }

    #[test]
    fn xp_decays_after_the_daily_threshold_down_to_one() {
        // do progu pełna wartość
        assert_eq!(decayed(10.0, 100, 0, 2.0), 10);
        assert_eq!(decayed(10.0, 100, 99, 2.0), 10);
        // za progiem maleje, nigdy poniżej 1 i nigdy rośnie
        let mut prev = i64::MAX;
        for used in (100..5000).step_by(50) {
            let v = decayed(10.0, 100, used, 2.0);
            assert!(v >= 1 && v <= prev, "used {used}: {v}");
            prev = v;
        }
        assert_eq!(decayed(10.0, 100, 100_000, 2.0), 1);
        // bez progu bez spadku, 0 EXP zostaje 0
        assert_eq!(decayed(10.0, 0, 1_000_000, 2.0), 10);
        assert_eq!(decayed(0.0, 100, 1000, 2.0), 0);
        // seria zdarzeń: każde następne liczone od już zdobytego EXP, a na końcu same jedynki
        let (total, used) = decayed_total(10.0, 50, 0, 2.0, 200);
        assert_eq!(used, total);
        assert!(total < 200 * 10 && total > 200, "suma {total}");
        assert_eq!(decayed_total(10.0, 50, used, 2.0, 3).0, 3);
        // szybszy spadek przy większym wykładniku
        assert!(decayed_total(10.0, 50, 0, 4.0, 100).0 < decayed_total(10.0, 50, 0, 1.0, 100).0);
    }

    #[test]
    fn badge_tiers_rise_with_repeats_in_a_year() {
        assert_eq!(BADGE_TIERS.len(), 12);
        assert_eq!(BADGE_TIERS[0], "Zwykła");
        assert_eq!(BADGE_TIERS[11], "Papieska");
        assert_eq!(badge_tier(0), 1);
        assert_eq!(badge_tier(1), 1);
        assert_eq!(badge_tier(2), 2);
        assert_eq!(badge_tier(12), 12);
        assert_eq!(badge_tier(40), 12);
        assert_eq!(badge_json(2026, 3)["name"], "Srebrna");
    }

    #[test]
    fn choice_options_follow_the_rules() {
        let cat = crate::catalog::build(&[], &[]);
        let g = crate::data::g();
        let cfg = ExpConfig::default();
        for _ in 0..40 {
            let o = generate_options(&cat, &cfg);
            assert_eq!(o.len(), CHOICE_OPTIONS);
            // 1: skrzynka z pieniędzmi (któraś z istniejących)
            assert_eq!(o[0]["reward"]["type"], "chest");
            let kind = o[0]["reward"]["kind"].as_str().unwrap();
            assert!(g.money_kind(kind).is_some(), "{kind}");
            // 2-3 (i 4 bez puli): karty Mityczne+ bez kart ekskluzywnych, specjalnych i tajnych, w dozwolonych wariantach
            let allowed = cat.base_variants();
            for r in [&o[1]["reward"], &o[2]["reward"], &o[3]["reward"]] {
                assert_eq!(r["type"], "card");
                let p = cat.person(r["person"].as_str().unwrap()).unwrap();
                assert!(g.rarity_idx(&p.rarity) >= g.rarity_idx("red"), "{}", p.rarity);
                assert!(p.exclusive.is_empty() && !p.is_special() && !p.is_secret() && p.forge);
                let v = r["variant"].as_str().unwrap();
                assert!(v == "normal" || v.split('+').all(|x| x == "normal" || allowed.iter().any(|a| a == x || a.split('+').any(|y| y == x))), "wariant {v}");
                assert!(usable(&cat, r));
            }
            assert_ne!(o[1]["reward"]["person"], o[2]["reward"]["person"]);
            assert!(!o[3]["exclusive"].as_bool().unwrap());
        }
        // pula ekskluzywna z szansą 1: slot dodatkowy zawsze z niej, a karty z puli nie wypadają w pozostałych slotach
        let raw = json!({"exclusiveChance": 1, "exclusiveCards": [{"person": "pl_malysz", "variant": "silver"}], "exclusiveChests": ["nie_ma_takiej"]});
        let cfg = clean_config(&raw, None, &cat);
        assert_eq!(cfg.excl_cards, vec![("pl_malysz".to_owned(), "silver".to_owned())]);
        assert!(cfg.excl_chests.is_empty(), "nieistniejąca skrzynka odpada");
        for _ in 0..20 {
            let o = generate_options(&cat, &cfg);
            assert!(o[3]["exclusive"].as_bool().unwrap());
            assert_eq!(o[3]["reward"]["person"], "pl_malysz");
            assert!(o[1]["reward"]["person"] != "pl_malysz" && o[2]["reward"]["person"] != "pl_malysz");
        }
    }

    #[test]
    fn choice_levels_are_configurable() {
        let cat = crate::catalog::build(&[], &[]);
        let c = clean_config(&json!({"choiceLevels": [5, "20", 1, 500, 100], "decay": 99}), None, &cat);
        assert_eq!(c.choice_levels.iter().copied().collect::<Vec<_>>(), vec![5, 20, 100]);
        assert_eq!(c.decay, 8.0);
        assert!(clean_config(&json!({"choiceLevels": []}), None, &cat).choice_levels.is_empty());
        assert_eq!(clean_config(&json!({}), None, &cat).choice_levels.len(), 10);
        let again = clean_config(&c.to_json(), None, &cat);
        assert_eq!(again.choice_levels, c.choice_levels);
    }

    #[test]
    fn levels_to_settle_once() {
        assert_eq!(new_levels(1, 1).count(), 0);
        assert_eq!(new_levels(1, 4).collect::<Vec<_>>(), vec![2, 3, 4]);
        assert_eq!(new_levels(4, 4).count(), 0);
        assert_eq!(new_levels(98, 200).collect::<Vec<_>>(), vec![99, 100]);
        assert_eq!(new_levels(0, 2).collect::<Vec<_>>(), vec![2]);
    }

    #[test]
    fn sources_are_unique_and_sane() {
        let mut seen = HashSet::new();
        for s in SOURCES {
            assert!(seen.insert(s.key), "powtórzone źródło {}", s.key);
            assert!(s.exp > 0);
            assert!(s.cap == 0 || s.cap >= s.exp, "limit {} mniejszy niż jedno zdarzenie", s.key);
        }
    }

    #[test]
    fn panel_payload_keeps_only_changes() {
        let cat = crate::catalog::build(&[], &[]);
        // panel wysyła nagrody wszystkich leveli; zapisują się tylko te różne od domyślnych
        let mut rw = Map::new();
        for l in 1..=MAX_LEVEL {
            let d = default_rewards(l);
            rw.insert(l.to_string(), json!({"small": d.small, "special": d.special}));
        }
        rw.insert("5".into(), json!({"small": default_rewards(5).small, "special": [{"type": "card", "person": "pl_malysz", "variant": "silver", "count": 1}]}));
        rw.insert("10".into(), json!({"small": [], "special": []}));   // admin usunął dużą nagrodę
        rw.insert("11".into(), json!({"small": [{"type": "card", "person": "nie_ma_takiej", "variant": "normal", "count": 1}], "special": []}));
        let c = clean_config(&json!({"needs": {"7": "123", "8": ""}}), Some(&Value::Object(rw)), &cat);
        assert_eq!(c.rewards.keys().copied().collect::<Vec<_>>(), vec![5, 10, 11]);
        assert_eq!(c.rewards_for(5).special.len(), 1);
        assert!(c.rewards_for(10).small.is_empty());
        assert!(c.rewards_for(11).small.is_empty(), "nieistniejąca karta odpada");
        assert_eq!(c.rewards_for(12), default_rewards(12));
        assert_eq!(c.need(7), 123);
        assert_eq!(c.need(8), DEFAULT_CURVE.need(8));
    }

    #[test]
    fn config_roundtrip_and_clamps() {
        let cat = crate::catalog::build(&[], &[]);
        let raw = json!({"mult": 2.5, "backfillPct": 500, "curve": {"base": -5, "scale": "3,5", "power": 9},
                         "sources": {"open": {"exp": "20", "cap": -1}, "nie_ma": {"exp": 5}}});
        let c = clean_config(&raw, None, &cat);
        assert_eq!(c.mult, 2.5);
        assert_eq!(c.backfill_pct, 100);
        assert_eq!(c.curve, Curve { base: 1.0, scale: 3.5, power: 4.0 });
        assert_eq!(c.source("open"), Some((20, 0)));
        assert_eq!(c.source("nie_ma"), None);
        let again = clean_config(&c.to_json(), None, &cat);
        assert_eq!(again.source("open"), Some((20, 0)));
        assert_eq!(again.total_for(100), c.total_for(100));
    }
}
