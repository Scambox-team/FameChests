//! Arena: ustawienia meczu, słowniki (klasy, specjalizacje, ukryte cechy, układy), domyślne statystyki i statystyki
//! kart. Wszystko trzyma pamięć procesu (`data()`), wczytywane z tabel `arena_config` (wiersze `settings` i `meta`)
//! i `arena_cards` (statystyki karty zapisane w panelu admina). Karta bez wiersza dostaje statystyki z domyślnych
//! dla jej rzadkości (`derived`).

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};

use indexmap::IndexMap;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::catalog::{Catalog, Person};
use crate::db::Conn;

/// Ukryte cechy kart (nie widać ich na karcie ani w walce - działają przez układy)
pub const TRAITS: &[(&str, &str)] =
    &[("ideology", "Ideologia"), ("party", "Partia"), ("loyalty", "Lojalność"), ("era", "Epoka"), ("custom", "Niestandardowa")];

/// Rodzaje umiejętności i ich odmiany (`mode`)
pub type KindDef = (&'static str, &'static str, &'static [(&'static str, &'static str)]);
pub const KINDS: &[KindDef] = &[
    ("attack", "Atak", &[("normal", "Zwykły"), ("poison", "Trucizna (przez kilka rund)")]),
    ("shield", "Tarcza", &[("normal", "Zwykła")]),
    ("heal", "Leczenie", &[("normal", "Zwykłe"), ("regen", "Rozłożone w czasie"), ("drain", "Wysysające")]),
    ("eco", "Ekonomiczna", &[("normal", "Zwykła"), ("income", "Rozłożona w czasie"), ("steal", "Zabierająca rywalowi")]),
    ("special", "Specjalna", &[]),
];

/// Umiejętności specjalne: (klucz, nazwa, opis). Nowa = wpis tutaj + jej skutek w `engine.rs` (szukaj `special ==`).
pub const SPECIALS: &[(&str, &str, &str)] =
    &[("revive", "Powrót", "Pokonana karta wraca po kilku turach właściciela (ustawienia meczu) z pełnym HP. Raz na mecz.")];

pub fn kind_ok(kind: &str, mode: &str) -> bool {
    KINDS.iter().any(|(k, _, modes)| *k == kind && (kind == "special" || modes.iter().any(|(m, _)| *m == mode)))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// czas meczu w sekundach
    pub game_secs: i64,
    pub overtime_secs: i64,
    /// najwięcej dogrywek - potem remis
    pub max_overtimes: i64,
    pub moves: i64,
    pub turn_secs: i64,
    pub rows: usize,
    pub row_slots: usize,
    pub deck_size: usize,
    pub start_money: i64,
    pub money_per_turn: i64,
    pub max_money: i64,
    /// tury właściciela do powrotu karty z umiejętnością „Powrót”
    pub revive_turns: i64,
    /// punkty (i koszt wystawienia) za rzadkość
    pub points: IndexMap<String, i64>,
    /// grosze za wygraną z człowiekiem / z botem
    pub reward_pvp: i64,
    pub reward_bot: i64,
    /// najwięcej nagradzanych wygranych na dobę
    pub daily_pvp: i64,
    pub daily_bot: i64,
    /// mecz z człowiekiem zakończony poddaniem lub walkowerem daje nagrodę dopiero po tylu sekundach gry
    pub min_reward_secs: i64,
}

impl Default for Settings {
    fn default() -> Self {
        let points = [("green", 1), ("uncommon", 2), ("blue", 2), ("purple", 3), ("red", 4), ("gold", 5), ("special", 5), ("ultra", 6), ("secret", 8)]
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v))
            .collect();
        Settings {
            game_secs: 300,
            overtime_secs: 120,
            max_overtimes: 3,
            moves: 4,
            turn_secs: 40,
            rows: 3,
            row_slots: 3,
            deck_size: 8,
            start_money: 6,
            money_per_turn: 3,
            max_money: 20,
            revive_turns: 3,
            points,
            reward_pvp: 300,
            reward_bot: 80,
            daily_pvp: 10,
            daily_bot: 5,
            min_reward_secs: 120,
        }
    }
}

impl Settings {
    pub fn clean(mut self) -> Settings {
        let c = |v: i64, lo: i64, hi: i64| v.clamp(lo, hi);
        self.game_secs = c(self.game_secs, 60, 3600);
        self.overtime_secs = c(self.overtime_secs, 30, 900);
        self.max_overtimes = c(self.max_overtimes, 0, 10);
        self.moves = c(self.moves, 1, 10);
        self.turn_secs = c(self.turn_secs, 10, 300);
        self.rows = self.rows.clamp(1, 5);
        self.row_slots = self.row_slots.clamp(1, 5);
        self.deck_size = self.deck_size.clamp(3, 20);
        self.start_money = c(self.start_money, 0, 1000);
        self.money_per_turn = c(self.money_per_turn, 0, 1000);
        self.max_money = c(self.max_money, 1, 10_000);
        self.revive_turns = c(self.revive_turns, 1, 20);
        for v in self.points.values_mut() {
            *v = c(*v, 0, 1000);
        }
        self.reward_pvp = c(self.reward_pvp, 0, 1_000_000);
        self.reward_bot = c(self.reward_bot, 0, 1_000_000);
        self.daily_pvp = c(self.daily_pvp, 0, 1000);
        self.daily_bot = c(self.daily_bot, 0, 1000);
        self.min_reward_secs = c(self.min_reward_secs, 0, 3600);
        self
    }
}

/// Domyślne statystyki (rzadkości albo specjalizacji); puste = brak wartości z tego źródła
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct StatDefaults {
    pub hp: Option<i64>,
    pub atk: Option<i64>,
    pub range_min: Option<i64>,
    pub range_max: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct Named {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct Spec {
    pub id: String,
    pub name: String,
    pub defaults: StatDefaults,
}

/// Skutek układu
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ComboEffect {
    /// atk / hp (kartom układu albo wszystkim), money (pieniądze na turę), points (punkty za każdą pokonaną kartę)
    pub kind: String,
    pub amount: i64,
    /// true = premia atk / hp dla wszystkich kart gracza na planszy, false = tylko dla kart tworzących układ
    pub all: bool,
}

/// Układ: co najmniej `count` kart na planszy gracza z cechą `trait_` = `value` (pusta wartość = dowolna, byle ta sama)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Combo {
    pub id: String,
    pub name: String,
    #[serde(rename = "trait")]
    pub trait_: String,
    pub value: String,
    pub count: i64,
    pub effects: Vec<ComboEffect>,
}

/// Słowniki areny
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Meta {
    pub classes: Vec<Named>,
    pub specs: Vec<Spec>,
    /// cecha -> dozwolone wartości
    pub traits: IndexMap<String, Vec<String>>,
    pub combos: Vec<Combo>,
    pub rarity_defaults: IndexMap<String, StatDefaults>,
}

fn named(list: &[(&str, &str)]) -> Vec<Named> {
    list.iter().map(|(id, name)| Named { id: (*id).into(), name: (*name).into() }).collect()
}

fn sd(hp: i64, atk: i64, lo: i64, hi: i64) -> StatDefaults {
    StatDefaults { hp: Some(hp), atk: Some(atk), range_min: Some(lo), range_max: Some(hi) }
}

impl Default for Meta {
    fn default() -> Self {
        let specs = [
            ("boxer", "Bokser", sd(85, 45, 1, 1)),
            ("soldier", "Żołnierz", sd(95, 35, 1, 2)),
            ("mage", "Mag", sd(70, 40, 1, 4)),
            ("archer", "Łucznik", sd(65, 30, 2, 5)),
            ("medic", "Medyk", sd(80, 20, 1, 3)),
            ("trader", "Kupiec", sd(75, 25, 1, 3)),
        ]
        .into_iter()
        .map(|(id, name, defaults)| Spec { id: id.into(), name: name.into(), defaults })
        .collect();
        let traits = [
            ("ideology", vec!["Lewica", "Prawica", "Centrum", "Liberalizm", "Konserwatyzm"]),
            ("party", vec![]),
            ("loyalty", vec!["Lojalny", "Niezależny", "Zdrajca"]),
            ("era", vec!["Starożytność", "Średniowiecze", "XIX wiek", "XX wiek", "XXI wiek"]),
            ("custom", vec![]),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v.into_iter().map(String::from).collect()))
        .collect();
        let combos = vec![
            Combo {
                id: "same_party".into(),
                name: "Partyjna drużyna".into(),
                trait_: "party".into(),
                value: String::new(),
                count: 3,
                effects: vec![ComboEffect { kind: "atk".into(), amount: 10, all: false }],
            },
            Combo {
                id: "same_era".into(),
                name: "Ludzie epoki".into(),
                trait_: "era".into(),
                value: String::new(),
                count: 3,
                effects: vec![ComboEffect { kind: "hp".into(), amount: 15, all: false }],
            },
        ];
        let rarity_defaults = [
            ("green", sd(60, 20, 1, 2)),
            ("uncommon", sd(65, 22, 1, 2)),
            ("blue", sd(75, 26, 1, 3)),
            ("purple", sd(85, 30, 1, 3)),
            ("red", sd(100, 35, 1, 3)),
            ("gold", sd(120, 40, 1, 3)),
            ("special", sd(120, 40, 1, 3)),
            ("ultra", sd(140, 48, 1, 4)),
            ("secret", sd(160, 55, 1, 4)),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect();
        Meta {
            classes: named(&[
                ("politician", "Polityk"),
                ("artist", "Artysta"),
                ("athlete", "Sportowiec"),
                ("scientist", "Naukowiec"),
                ("celebrity", "Celebryta"),
                ("business", "Biznesmen"),
                ("clergy", "Duchowny"),
            ]),
            specs,
            traits,
            combos,
            rarity_defaults,
        }
    }
}

fn clean_id(s: &str) -> String {
    s.trim().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').take(40).collect::<String>().to_lowercase()
}

fn clean_text(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

fn clean_defaults(d: &StatDefaults) -> StatDefaults {
    let (lo, hi) = match (d.range_min, d.range_max) {
        (Some(a), Some(b)) => (Some(a.clamp(1, 10)), Some(b.clamp(a.clamp(1, 10), 10))),
        (a, b) => (a.map(|v| v.clamp(1, 10)), b.map(|v| v.clamp(1, 10))),
    };
    StatDefaults { hp: d.hp.map(|v| v.clamp(1, 10_000)), atk: d.atk.map(|v| v.clamp(0, 10_000)), range_min: lo, range_max: hi }
}

impl Meta {
    pub fn clean(self) -> Meta {
        let mut seen = std::collections::HashSet::new();
        let classes = self
            .classes
            .iter()
            .map(|c| Named { id: clean_id(&c.id), name: clean_text(&c.name, 40) })
            .filter(|c| !c.id.is_empty() && !c.name.is_empty() && seen.insert(c.id.clone()))
            .take(100)
            .collect();
        seen.clear();
        let specs = self
            .specs
            .iter()
            .map(|s| Spec { id: clean_id(&s.id), name: clean_text(&s.name, 40), defaults: clean_defaults(&s.defaults) })
            .filter(|s| !s.id.is_empty() && !s.name.is_empty() && seen.insert(s.id.clone()))
            .take(100)
            .collect();
        let traits = TRAITS
            .iter()
            .map(|(k, _)| {
                let mut vals: Vec<String> = vec![];
                for v in self.traits.get(*k).into_iter().flatten() {
                    let v = clean_text(v, 40);
                    if !v.is_empty() && !vals.contains(&v) && vals.len() < 200 {
                        vals.push(v);
                    }
                }
                ((*k).to_owned(), vals)
            })
            .collect();
        seen.clear();
        let combos = self
            .combos
            .iter()
            .map(|c| Combo {
                id: clean_id(&c.id),
                name: clean_text(&c.name, 60),
                trait_: c.trait_.clone(),
                value: clean_text(&c.value, 40),
                count: c.count.clamp(1, 15),
                effects: c
                    .effects
                    .iter()
                    .filter(|e| matches!(e.kind.as_str(), "atk" | "hp" | "money" | "points"))
                    .map(|e| ComboEffect { kind: e.kind.clone(), amount: e.amount.clamp(-1000, 1000), all: e.all })
                    .take(4)
                    .collect(),
            })
            .filter(|c| {
                !c.id.is_empty()
                    && (TRAITS.iter().any(|(k, _)| *k == c.trait_) || c.trait_ == "class" || c.trait_ == "spec")
                    && seen.insert(c.id.clone())
            })
            .take(100)
            .collect();
        let rarity_defaults = self.rarity_defaults.iter().map(|(k, v)| (k.clone(), clean_defaults(v))).collect();
        Meta { classes, specs, traits, combos, rarity_defaults }
    }

    pub fn spec(&self, id: &str) -> Option<&Spec> {
        self.specs.iter().find(|s| s.id == id)
    }
}

/// Umiejętność karty w Arenie
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Ability {
    pub name: String,
    /// attack / shield / heal / eco / special
    pub kind: String,
    /// odmiana (`KINDS`), przy specjalnej klucz z `SPECIALS`
    pub mode: String,
    /// atak: procent ataku karty; tarcza, leczenie, wysysanie: HP; ekonomiczna: pieniądze w meczu
    pub power: i64,
    /// obszarowa: kilka kart naraz
    pub area: bool,
    /// ile kart trafia obszarowa (0 = wszystkie możliwe)
    pub count: i64,
    /// skierowana (gracz wybiera cel) albo losowa
    pub aim: bool,
    /// trucizna / leczenie rozłożone / dochód: przez tyle tur; tarcza: tyle tur właściciela
    pub turns: i64,
    /// koszt w pieniądzach meczu
    pub cost: i64,
    /// wysysanie: skąd brać HP - "enemy" (karta rywala w zasięgu) albo "ally" (inna własna karta)
    pub from: String,
}

impl Default for Ability {
    fn default() -> Self {
        Ability {
            name: "Cios".into(),
            kind: "attack".into(),
            mode: "normal".into(),
            power: 100,
            area: false,
            count: 0,
            aim: true,
            turns: 0,
            cost: 0,
            from: "enemy".into(),
        }
    }
}

impl Ability {
    pub fn passive(&self) -> bool {
        self.kind == "special"
    }

    pub fn clean(&self) -> Option<Ability> {
        let mut a = self.clone();
        if a.kind == "special" {
            if !SPECIALS.iter().any(|(k, _, _)| *k == a.mode) {
                return None;
            }
        } else if !kind_ok(&a.kind, &a.mode) {
            return None;
        }
        a.name = clean_text(&a.name, 40);
        if a.name.is_empty() {
            a.name = KINDS.iter().find(|(k, _, _)| *k == a.kind).map(|(_, n, _)| (*n).to_owned()).unwrap_or_default();
        }
        a.power = a.power.clamp(0, 10_000);
        a.count = a.count.clamp(0, 15);
        a.turns = a.turns.clamp(0, 20);
        if matches!(a.mode.as_str(), "poison" | "regen" | "income") && a.turns == 0 {
            a.turns = 3;
        }
        if a.kind == "shield" && a.turns == 0 {
            a.turns = 2;
        }
        a.cost = a.cost.clamp(0, 1000);
        if a.from != "ally" {
            a.from = "enemy".into();
        }
        Some(a)
    }
}

/// Statystyki karty w Arenie
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CardStats {
    pub atk: i64,
    pub hp: i64,
    pub class: String,
    pub spec: String,
    /// zasięg: najbliższy i najdalszy rząd rywala liczony od karty (1 = rząd tuż przed nią, gdy stoi w pierwszej linii)
    pub range_min: i64,
    pub range_max: i64,
    pub abilities: Vec<Ability>,
    /// ukryte cechy: cecha -> wartość
    pub traits: IndexMap<String, String>,
    /// własne punkty (koszt) zamiast punktów rzadkości
    pub points: Option<i64>,
}

impl Default for CardStats {
    fn default() -> Self {
        CardStats {
            atk: 25,
            hp: 70,
            class: String::new(),
            spec: String::new(),
            range_min: 1,
            range_max: 2,
            abilities: vec![Ability::default()],
            traits: IndexMap::new(),
            points: None,
        }
    }
}

impl CardStats {
    pub fn clean(&self, meta: &Meta) -> CardStats {
        let mut s = self.clone();
        s.atk = s.atk.clamp(0, 10_000);
        s.hp = s.hp.clamp(1, 10_000);
        s.range_min = s.range_min.clamp(1, 10);
        s.range_max = s.range_max.clamp(s.range_min, 10);
        if !meta.classes.iter().any(|c| c.id == s.class) {
            s.class.clear();
        }
        if meta.spec(&s.spec).is_none() {
            s.spec.clear();
        }
        s.abilities = s.abilities.iter().filter_map(Ability::clean).take(4).collect();
        s.traits = s
            .traits
            .iter()
            .filter(|(k, v)| meta.traits.get(*k).is_some_and(|vals| vals.contains(v)))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        s.points = s.points.map(|p| p.clamp(0, 1000));
        s
    }

    /// Wartość cechy dla układów (także klasa i specjalizacja)
    pub fn trait_value(&self, key: &str) -> Option<&str> {
        let v = match key {
            "class" => self.class.as_str(),
            "spec" => self.spec.as_str(),
            k => self.traits.get(k).map_or("", String::as_str),
        };
        (!v.is_empty()).then_some(v)
    }
}

/// Stara zdolność z katalogu (off / def / heal / eco) -> umiejętność Areny
fn from_old(name: &str, kind: &str, value: i64) -> Ability {
    let mut a = Ability { name: name.to_owned(), ..Ability::default() };
    match kind {
        "def" => {
            a.kind = "shield".into();
            a.power = (value / 2).clamp(10, 60);
            a.turns = 2;
        }
        "heal" => {
            a.kind = "heal".into();
            a.power = (value / 2).clamp(10, 60);
        }
        "eco" => {
            a.kind = "eco".into();
            a.power = (value / 40).clamp(1, 4);
        }
        _ => {}
    }
    a
}

/// Statystyki karty bez wpisu z panelu: domyślne rzadkości + zdolności przeniesione z karty
pub fn derived(p: &Person, meta: &Meta) -> CardStats {
    let d = meta.rarity_defaults.get(&p.rarity).cloned().unwrap_or_default();
    let base = CardStats::default();
    let mut abilities = vec![];
    if let Some(name) = p.attack.as_deref().filter(|s| !s.is_empty()) {
        abilities.push(from_old(name, if p.kind1.is_empty() { "off" } else { &p.kind1 }, p.dmg));
    }
    if let Some(name) = p.attack2.as_deref().filter(|s| !s.is_empty()) {
        abilities.push(from_old(name, if p.kind2.is_empty() { "off" } else { &p.kind2 }, p.dmg2));
    }
    if abilities.is_empty() {
        abilities.push(Ability::default());
    }
    if p.is_secret() {
        abilities.push(Ability { name: "Powrót".into(), kind: "special".into(), mode: "revive".into(), power: 0, ..Ability::default() });
    }
    abilities.truncate(4);
    let range_min = d.range_min.unwrap_or(base.range_min);
    CardStats {
        atk: d.atk.unwrap_or(base.atk),
        hp: d.hp.unwrap_or(base.hp),
        range_min,
        range_max: d.range_max.unwrap_or(base.range_max).max(range_min),
        abilities,
        ..base
    }
}

/// Dane areny w pamięci procesu
#[derive(Debug, Clone, Default)]
pub struct ArenaData {
    pub settings: Settings,
    pub meta: Meta,
    /// statystyki zapisane w panelu (person_id -> statystyki)
    pub cards: HashMap<String, CardStats>,
    /// Arena dla wszystkich graczy (klucz `arena_public` w tabeli `state`)
    pub public: bool,
}

impl ArenaData {
    pub fn stats(&self, p: &Person) -> CardStats {
        self.cards.get(&p.id).cloned().unwrap_or_else(|| derived(p, &self.meta))
    }

    pub fn points(&self, p: &Person, stats: &CardStats) -> i64 {
        stats.points.unwrap_or_else(|| self.settings.points.get(&p.rarity).copied().unwrap_or(1))
    }
}

static DATA: LazyLock<RwLock<Arc<ArenaData>>> = LazyLock::new(|| RwLock::new(Arc::new(ArenaData::default())));

pub fn data() -> Arc<ArenaData> {
    DATA.read().clone()
}

pub fn set_data(d: ArenaData) {
    *DATA.write() = Arc::new(d);
}

pub const PUBLIC_KEY: &str = "arena_public";

pub async fn load(c: &mut Conn) -> sqlx::Result<Arc<ArenaData>> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, data FROM arena_config").fetch_all(&mut *c).await?;
    let get = |k: &str| rows.iter().find(|r| r.0 == k).and_then(|r| serde_json::from_str::<Value>(&r.1).ok());
    let settings = get("settings").and_then(|v| serde_json::from_value::<Settings>(v).ok()).unwrap_or_default().clean();
    let meta = get("meta").and_then(|v| serde_json::from_value::<Meta>(v).ok()).unwrap_or_default().clean();
    let cards: Vec<(String, String)> = sqlx::query_as("SELECT person_id, data FROM arena_cards").fetch_all(&mut *c).await?;
    let cards = cards
        .into_iter()
        .filter_map(|(pid, s)| serde_json::from_str::<CardStats>(&s).ok().map(|st| (pid, st.clean(&meta))))
        .collect();
    let public: Option<i64> = sqlx::query_scalar("SELECT value FROM state WHERE key = $1").bind(PUBLIC_KEY).fetch_optional(&mut *c).await?;
    set_data(ArenaData { settings, meta, cards, public: public.unwrap_or(0) != 0 });
    Ok(data())
}

pub async fn save_config(c: &mut Conn, key: &str, v: &Value) -> sqlx::Result<()> {
    sqlx::query("INSERT INTO arena_config (key, data) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET data = excluded.data")
        .bind(key)
        .bind(v.to_string())
        .execute(c)
        .await
        .map(|_| ())
}

pub async fn save_cards(c: &mut Conn, cards: &[(String, CardStats)]) -> sqlx::Result<()> {
    if cards.is_empty() {
        return Ok(());
    }
    let ids: Vec<String> = cards.iter().map(|c| c.0.clone()).collect();
    let data: Vec<String> = cards.iter().map(|c| serde_json::to_string(&c.1).unwrap_or_default()).collect();
    sqlx::query(
        "INSERT INTO arena_cards (person_id, data) SELECT * FROM UNNEST($1::text[], $2::text[])
         ON CONFLICT (person_id) DO UPDATE SET data = excluded.data",
    )
    .bind(&ids)
    .bind(&data)
    .execute(c)
    .await
    .map(|_| ())
}

/// Zastosowanie domyślnej statystyki (`hp`, `atk`, `range`) ze źródła (`rarity` albo `spec`) do wszystkich kart.
/// Karta, dla której źródło nie ma wartości (np. bez specjalizacji), zostaje bez zmian. Zwraca zmienione karty.
pub fn apply_defaults<'a>(
    people: impl Iterator<Item = &'a Person>,
    d: &ArenaData,
    stat: &str,
    source: &str,
) -> Vec<(String, CardStats)> {
    let mut out = vec![];
    for p in people {
        let mut s = d.stats(p);
        let src = match source {
            "rarity" => d.meta.rarity_defaults.get(&p.rarity),
            _ => d.meta.spec(&s.spec).map(|x| &x.defaults),
        };
        let Some(src) = src else { continue };
        let before = s.clone();
        match stat {
            "hp" => s.hp = src.hp.unwrap_or(s.hp),
            "atk" => s.atk = src.atk.unwrap_or(s.atk),
            "range" => {
                s.range_min = src.range_min.unwrap_or(s.range_min);
                s.range_max = src.range_max.unwrap_or(s.range_max).max(s.range_min);
            }
            _ => continue,
        }
        if s != before || !d.cards.contains_key(&p.id) {
            out.push((p.id.clone(), s));
        }
    }
    out
}

/// Ustawienia areny do eksportu katalogu
pub fn export_json() -> Value {
    let d = data();
    let mut cards: Vec<(&String, &CardStats)> = d.cards.iter().collect();
    cards.sort_by(|a, b| a.0.cmp(b.0));
    serde_json::json!({"settings": d.settings, "meta": d.meta, "cards": cards.into_iter().collect::<IndexMap<_, _>>()})
}

/// Import z eksportu katalogu (pusta baza): tylko gdy w bazie nie ma jeszcze ustawień areny
pub async fn import_json(c: &mut Conn, v: &Value) -> sqlx::Result<()> {
    let has: Option<String> = sqlx::query_scalar("SELECT key FROM arena_config LIMIT 1").fetch_optional(&mut *c).await?;
    if has.is_some() {
        return Ok(());
    }
    if let Some(s) = v.get("settings") {
        save_config(c, "settings", s).await?;
    }
    if let Some(m) = v.get("meta") {
        save_config(c, "meta", m).await?;
    }
    if let Some(cards) = v.get("cards").and_then(Value::as_object) {
        let list: Vec<(String, CardStats)> = cards
            .iter()
            .filter_map(|(k, v)| serde_json::from_value::<CardStats>(v.clone()).ok().map(|s| (k.clone(), s)))
            .collect();
        save_cards(c, &list).await?;
    }
    Ok(())
}

/// Lista kart z katalogu z ich statystykami (panel admina)
pub fn all_cards(cat: &Catalog, d: &ArenaData) -> Vec<Value> {
    cat.people
        .values()
        .map(|p| {
            let s = d.stats(p);
            serde_json::json!({"id": p.id, "name": p.name, "rarity": p.rarity, "crates": p.crates, "secret": p.is_secret(),
                "points": d.points(p, &s), "custom": d.cards.contains_key(&p.id), "stats": s})
        })
        .collect()
}
