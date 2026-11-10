//! Eventy gry (zakładka Eventy w panelu admina): nazwa, opis, termin (daty RRRR-MM-DD, włącznie) i zawartość:
//! - `drops`: wariant wypada ze wszystkich skrzynek z podaną szansą w czasie eventu (np. Polska na Dzień Niepodległości) -
//!   zamieniane na zwykłe wydarzenia wariantu (`VariantEvent`, id `ge_<event>`), więc losowanie, /variants i klaser
//!   obsługują je bez zmian;
//! - `advent`: kalendarz adwentowy - dzień N eventu (od daty startu) daje nagrody z listy `days[N-1]` (te same co w
//!   osiągnięciach: karta, skrzynka, grosze), raz na gracza (tabela `advent_claims`).
//! Domyślne eventy: "gameEvents" w game.json; zmiany admina: wiersz `__events` w `catalog_variants` (`{"gameEvents": [...]}`).

use chrono::{Local, NaiveDate, TimeZone};
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::data::g;
use crate::text::clean;
use crate::variants::VariantEvent;

/// Wiersz catalog_variants z eventami
pub const EVENTS_ROW: &str = "__events";
pub const MAX_EVENTS: usize = 30;
pub const MAX_DROPS: usize = 8;
pub const ADVENT_DAYS_MAX: usize = 31;
const MAX_REWARDS: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventDrop {
    pub variant: String,
    /// szansa na kartę w tym wariancie (0-1)
    pub chance: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameEvent {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub start: String,
    pub end: String,
    pub enabled: bool,
    pub drops: Vec<EventDrop>,
    /// kalendarz adwentowy: nagrody na kolejne dni eventu (None = event bez kalendarza)
    pub advent: Option<Vec<Vec<Value>>>,
}

fn date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()
}

/// Początek dnia (czas lokalny serwera) jako sekundy unix
pub fn day_start(d: NaiveDate) -> i64 {
    Local.from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap_or_default()).earliest().map_or(0, |t| t.timestamp())
}

fn slug(s: &str) -> String {
    let out: String = s
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'ą' => 'a', 'ć' => 'c', 'ę' => 'e', 'ł' => 'l', 'ń' => 'n', 'ó' => 'o', 'ś' => 's', 'ź' | 'ż' => 'z',
            c if c.is_ascii_alphanumeric() => c,
            _ => '_',
        })
        .collect();
    out.trim_matches('_').chars().take(30).collect()
}

/// Nagroda jak w osiągnięciach: {"type": "money", "amount"} | {"type": "chest", "kind", "count"} | {"type": "card", "person", "variant", "count"}
pub fn clean_reward(r: &Value) -> Option<Value> {
    let s = |k: &str| r.get(k).and_then(Value::as_str).unwrap_or("").trim().to_owned();
    let n = |k: &str, d: i64, max: i64| r.get(k).and_then(|v| v.as_i64().or_else(|| v.as_str()?.trim().parse().ok())).unwrap_or(d).clamp(0, max);
    match s("type").as_str() {
        "money" => Some(json!({"type": "money", "amount": n("amount", 0, 10_000_000)})).filter(|v| v["amount"].as_i64() > Some(0)),
        "chest" if !s("kind").is_empty() => Some(json!({"type": "chest", "kind": s("kind"), "count": n("count", 1, 20).max(1)})),
        "card" if !s("person").is_empty() => {
            let v = s("variant");
            let variant = if v.is_empty() || !g().variants.contains_key(&v) { "normal".to_owned() } else { v };
            Some(json!({"type": "card", "person": s("person"), "variant": variant, "count": n("count", 1, 10).max(1)}))
        }
        _ => None,
    }
}

/// Lista eventów z panelu (albo z game.json) - sprawdzona: daty, warianty, szanse, nagrody kalendarza
pub fn clean_game_events(raw: &Value) -> Vec<GameEvent> {
    let g = g();
    let mut out: Vec<GameEvent> = Vec::new();
    for e in raw.as_array().into_iter().flatten().take(MAX_EVENTS) {
        let s = |k: &str| e.get(k).and_then(Value::as_str).unwrap_or("");
        let name = clean(s("name"), 60);
        if name.is_empty() {
            continue;
        }
        let (Some(start), Some(end)) = (date(s("start")), date(s("end"))) else { continue };
        if end < start {
            continue;
        }
        let mut id = slug(if s("id").is_empty() { &name } else { s("id") });
        if id.is_empty() {
            id = "event".into();
        }
        while out.iter().any(|x| x.id == id) {
            id.push('_');
        }
        let drops: Vec<EventDrop> = e
            .get("drops")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|d| {
                let v = d.get("variant").and_then(Value::as_str)?.to_owned();
                let x = g.variants.get(&v)?;
                if x.combo || x.special || x.always || v == "normal" {
                    return None;
                }
                let chance = d.get("chance").and_then(|c| c.as_f64().or_else(|| c.as_str()?.replace(',', ".").parse().ok()))?;
                Some(EventDrop { variant: v, chance: chance.clamp(0.0, g.variant_chance_max) })
            })
            .filter(|d| d.chance > 0.0)
            .take(MAX_DROPS)
            .collect();
        let advent = e.get("advent").and_then(Value::as_array).map(|days| {
            days.iter()
                .take(ADVENT_DAYS_MAX)
                .map(|day| day.as_array().into_iter().flatten().filter_map(clean_reward).take(MAX_REWARDS).collect())
                .collect::<Vec<Vec<Value>>>()
        });
        out.push(GameEvent {
            id,
            name,
            desc: clean(s("desc"), 600),
            start: start.format("%Y-%m-%d").to_string(),
            end: end.format("%Y-%m-%d").to_string(),
            enabled: e.get("enabled").and_then(Value::as_bool).unwrap_or(true),
            drops,
            advent,
        });
    }
    out
}

impl GameEvent {
    /// Termin w sekundach unix: [początek pierwszego dnia, początek dnia po ostatnim)
    pub fn span(&self) -> (i64, i64) {
        let s = date(&self.start).map_or(0, day_start);
        let e = date(&self.end).and_then(|d| d.succ_opt()).map_or(0, day_start);
        (s, e)
    }

    pub fn active(&self, now: i64) -> bool {
        let (s, e) = self.span();
        self.enabled && s <= now && now < e
    }

    /// Dzień kalendarza adwentowego dziś (1 = dzień startu eventu) - None poza eventem albo bez nagród na ten dzień
    pub fn advent_day(&self, today: NaiveDate) -> Option<usize> {
        let days = self.advent.as_ref()?;
        let start = date(&self.start)?;
        if !self.enabled || today < start || date(&self.end).is_some_and(|e| today > e) {
            return None;
        }
        let n = (today - start).num_days() as usize + 1;
        (n <= days.len()).then_some(n)
    }

    /// Dropy jako wydarzenia wariantów (wariant -> wydarzenie); szansa eventu = szansa wariantu × boost
    pub fn variant_events(&self) -> Vec<(String, VariantEvent)> {
        if !self.enabled {
            return vec![];
        }
        let (start, end) = self.span();
        let g = g();
        self.drops
            .iter()
            .map(|d| {
                let base = g.variant(&d.variant).chance;
                let boost = if base > 0.0 { d.chance / base } else { 1.0 };
                let ev = VariantEvent {
                    id: format!("ge_{}", self.id),
                    start,
                    end,
                    crates: vec![],
                    boost: (boost * 1e6).round() / 1e6,
                    note: format!("Event: {}", self.name),
                };
                (d.variant.clone(), ev)
            })
            .collect()
    }
}

/// Eventy z wiersza `__events` (Map z catalog_variants) albo domyślne z game.json
pub fn events_from_row(row: Option<&Map<String, Value>>) -> Vec<GameEvent> {
    match row.and_then(|d| d.get("gameEvents")) {
        Some(list) => clean_game_events(list),
        None => clean_game_events(&g().game_events),
    }
}

pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_events() {
        let raw = json!([
            {"name": "Dzień Niepodległości", "start": "2026-11-10", "end": "2026-11-12",
             "drops": [{"variant": "gold", "chance": "0,05"}, {"variant": "nie_ma", "chance": 1}, {"variant": "normal", "chance": 1}]},
            {"name": "Święta", "start": "2026-12-01", "end": "2026-12-24",
             "advent": [[{"type": "money", "amount": 500}, {"type": "zle"}], [{"type": "card", "person": "pl_curie", "variant": "brak"}]]},
            {"name": "Zła data", "start": "2026-12-10", "end": "2026-12-01"},
            {"name": "", "start": "2026-12-10", "end": "2026-12-11"}
        ]);
        let ev = clean_game_events(&raw);
        assert_eq!(ev.len(), 2);
        assert_eq!(ev[0].id, "dzien_niepodleglosci");
        assert_eq!(ev[0].drops.len(), 1);
        assert!((ev[0].drops[0].chance - 0.05).abs() < 1e-9);
        let a = ev[1].advent.as_ref().unwrap();
        assert_eq!(a[0].len(), 1);
        assert_eq!(a[1][0]["variant"], "normal");
        let d = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        assert_eq!(ev[1].advent_day(d("2026-12-01")), Some(1));
        assert_eq!(ev[1].advent_day(d("2026-12-02")), Some(2));
        assert_eq!(ev[1].advent_day(d("2026-12-03")), None);   // brak nagród na ten dzień
        assert_eq!(ev[1].advent_day(d("2026-11-30")), None);
        let (s, e) = ev[0].span();
        assert_eq!(e - s, 3 * 86400);
        let ve = ev[0].variant_events();
        assert_eq!(ve[0].1.id, "ge_dzien_niepodleglosci");
    }

    #[test]
    fn defaults_parse() {
        let ev = clean_game_events(&g().game_events);
        assert!(ev.iter().any(|e| e.advent.is_some()), "event świąteczny z kalendarzem");
        assert!(ev.iter().any(|e| e.drops.iter().any(|d| d.variant == "polska")), "Dzień Niepodległości z wariantem Polska");
    }
}
