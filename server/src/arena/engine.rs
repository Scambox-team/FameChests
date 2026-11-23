//! Silnik meczu Areny (czysta logika - bez bazy i katalogu, czas podawany z zewnątrz, więc da się go testować).
//!
//! Zasady: dwie strony (`Side::A` / `Side::B`), każda ma `rows` rzędów (0 = pierwsza linia) po `row_slots` miejsc.
//! Tura gracza: najwyżej `moves` ruchów i `turn_secs` sekund; ruch = wystawienie karty (koszt w pieniądzach meczu
//! = punkty karty), wycofanie karty do ręki albo użycie umiejętności (każda karta raz na turę). Pokonanie karty rywala
//! daje jej punkty. Mecz trwa `game_secs`; po czasie wygrywa strona z większą liczbą punktów, przy remisie dogrywka
//! `overtime_secs` (najwyżej `max_overtimes` razy, potem remis).
//!
//! Zasięg: karta w moim rzędzie `r` (0 = pierwsza linia) do karty w rzędzie rywala `e` ma odległość `r + e + 1`
//! (pierwsza linia na pierwszą linię = 1). Karta sięga rywali w odległości od `range_min` do `range_max`.

use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};

use super::rules::{Ability, CardStats, Combo, Settings};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    A,
    B,
}

impl Side {
    pub const BOTH: [Side; 2] = [Side::A, Side::B];

    pub fn other(self) -> Side {
        match self {
            Side::A => Side::B,
            Side::B => Side::A,
        }
    }

    pub fn idx(self) -> usize {
        self as usize
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Bot,
    Pvp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Won(Side),
    Draw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EndReason {
    /// koniec czasu (także po dogrywce)
    Time,
    Surrender,
    /// walkower za brak kontaktu
    Away,
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct ArenaError(pub String);

fn err<T>(msg: impl Into<String>) -> Result<T, ArenaError> {
    Err(ArenaError(msg.into()))
}

/// Karta z talii gracza
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeckCard {
    pub pid: String,
    pub variant: String,
}

/// Karta do meczu: wygląd + statystyki + punkty
#[derive(Debug, Clone)]
pub struct Entry {
    pub card: DeckCard,
    pub stats: CardStats,
    pub points: i64,
}

/// Efekt rozłożony w czasie (trucizna, leczenie, dochód) albo tarcza
#[derive(Debug, Clone, Serialize)]
pub struct Timed {
    pub value: i64,
    pub turns: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unit {
    pub uid: i64,
    pub pid: String,
    pub variant: String,
    #[serde(skip)]
    pub stats: CardStats,
    pub points: i64,
    pub hp: i64,
    pub max_hp: i64,
    /// premia HP z układów (wliczona w max_hp)
    #[serde(skip)]
    pub bonus_hp: i64,
    pub row: usize,
    pub slot: usize,
    pub shields: Vec<Timed>,
    pub poison: Vec<Timed>,
    pub regen: Vec<Timed>,
    pub acted: bool,
    /// „Powrót”: za tyle tur właściciela karta wraca (tylko w `ko`)
    pub revive_in: Option<i64>,
    #[serde(skip)]
    pub revived: bool,
}

impl Unit {
    fn shield(&self) -> i64 {
        self.shields.iter().map(|s| s.value).sum()
    }

    fn special(&self, key: &str) -> bool {
        self.stats.abilities.iter().any(|a| a.kind == "special" && a.mode == key)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub name: String,
    #[serde(skip)]
    pub user: Option<i64>,
    pub hand: Vec<Unit>,
    pub board: Vec<Unit>,
    pub ko: Vec<Unit>,
    pub money: i64,
    pub points: i64,
    pub moves: i64,
    pub income: Vec<Timed>,
    pub turns: i64,
    /// aktywne układy (id)
    pub combos: Vec<String>,
}

/// Zdarzenie do animacji
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Fx {
    Dmg { uid: i64, amount: i64 },
    Block { uid: i64, amount: i64 },
    Heal { uid: i64, amount: i64 },
    Shield { uid: i64, amount: i64 },
    Poison { uid: i64, amount: i64 },
    Ko { uid: i64, points: i64 },
    Revive { uid: i64 },
    Money { side: Side, amount: i64 },
    Place { uid: i64 },
}

/// Wpis dziennika meczu
#[derive(Debug, Clone, Serialize)]
pub struct Log {
    pub n: usize,
    pub side: Option<Side>,
    pub text: String,
    pub fx: Vec<Fx>,
}

#[derive(Debug, Clone)]
pub struct Game {
    pub mode: Mode,
    pub cfg: Settings,
    pub combos: Vec<Combo>,
    pub teams: [Team; 2],
    pub active: Side,
    pub started: f64,
    pub game_ends: f64,
    pub turn_ends: f64,
    pub overtimes: i64,
    pub over: Option<Outcome>,
    pub reason: Option<EndReason>,
    pub finished_at: Option<f64>,
    pub log: Vec<Log>,
    /// strona i karta, która ostatnio pokonała kartę rywala (osiągnięcia)
    pub last_ko: Option<(Side, String)>,
}

impl Game {
    pub fn new(mode: Mode, cfg: Settings, combos: Vec<Combo>, names: [(String, Option<i64>); 2], decks: [Vec<Entry>; 2], first: Side, now: f64) -> Game {
        let mut next_uid = 1;
        let [na, nb] = names;
        let [da, db] = decks;
        let mut team = |(name, user): (String, Option<i64>), deck: Vec<Entry>| Team {
            name,
            user,
            hand: deck
                .into_iter()
                .map(|e| {
                    let uid = next_uid;
                    next_uid += 1;
                    Unit {
                        uid,
                        pid: e.card.pid,
                        variant: e.card.variant,
                        hp: e.stats.hp,
                        max_hp: e.stats.hp,
                        bonus_hp: 0,
                        stats: e.stats,
                        points: e.points,
                        row: 0,
                        slot: 0,
                        shields: vec![],
                        poison: vec![],
                        regen: vec![],
                        acted: false,
                        revive_in: None,
                        revived: false,
                    }
                })
                .collect(),
            board: vec![],
            ko: vec![],
            money: cfg.start_money,
            points: 0,
            moves: 0,
            income: vec![],
            turns: 0,
            combos: vec![],
        };
        let teams = [team(na, da), team(nb, db)];
        let mut g = Game {
            mode,
            game_ends: now + cfg.game_secs as f64,
            turn_ends: now,
            cfg,
            combos,
            teams,
            active: first,
            started: now,
            overtimes: 0,
            over: None,
            reason: None,
            finished_at: None,
            log: vec![],
            last_ko: None,
        };
        g.note(None, "Mecz się zaczyna".into(), vec![]);
        g.begin_turn(first, now);
        g
    }

    pub fn team(&self, s: Side) -> &Team {
        &self.teams[s.idx()]
    }

    fn team_mut(&mut self, s: Side) -> &mut Team {
        &mut self.teams[s.idx()]
    }

    fn note(&mut self, side: Option<Side>, text: String, fx: Vec<Fx>) {
        let n = self.log.len() + 1;
        self.log.push(Log { n, side, text, fx });
    }

    /// Wszystkie karty w meczu (zdjęcia tajnych kart)
    pub fn pids(&self) -> Vec<&str> {
        self.teams.iter().flat_map(|t| t.hand.iter().chain(&t.board).chain(&t.ko)).map(|u| u.pid.as_str()).collect()
    }

    // ------------------------------------------------------------ czas

    /// Upływ czasu: koniec meczu albo dogrywka, koniec tury po czasie
    pub fn tick(&mut self, now: f64) {
        while self.over.is_none() {
            if now >= self.game_ends {
                self.time_up(now);
                continue;
            }
            if now >= self.turn_ends {
                let s = self.active;
                self.note(Some(s), format!("{}: koniec czasu tury", self.team(s).name), vec![]);
                self.pass(now);
                continue;
            }
            break;
        }
    }

    fn time_up(&mut self, now: f64) {
        let (a, b) = (self.teams[0].points, self.teams[1].points);
        if a != b {
            let w = if a > b { Side::A } else { Side::B };
            self.finish(Outcome::Won(w), EndReason::Time, now);
        } else if self.overtimes < self.cfg.max_overtimes {
            self.overtimes += 1;
            self.game_ends += self.cfg.overtime_secs as f64;
            self.note(None, format!("Remis {a}:{b} - dogrywka {} ({} s)", self.overtimes, self.cfg.overtime_secs), vec![]);
        } else {
            self.finish(Outcome::Draw, EndReason::Time, now);
        }
    }

    pub fn finish(&mut self, o: Outcome, reason: EndReason, now: f64) {
        if self.over.is_some() {
            return;
        }
        self.over = Some(o);
        self.reason = Some(reason);
        self.finished_at = Some(now);
        let text = match o {
            Outcome::Won(s) => format!("Wygrywa {}", self.team(s).name),
            Outcome::Draw => "Remis".into(),
        };
        self.note(None, text, vec![]);
    }

    pub fn surrender(&mut self, s: Side, now: f64) {
        self.note(Some(s), format!("{} się poddaje", self.team(s).name), vec![]);
        self.finish(Outcome::Won(s.other()), EndReason::Surrender, now);
    }

    // ------------------------------------------------------------ tury

    fn begin_turn(&mut self, s: Side, now: f64) {
        self.active = s;
        self.turn_ends = (now + self.cfg.turn_secs as f64).min(self.game_ends.max(now));
        let mut fx = vec![];
        let combo_money = self.combo_bonus(s, "money");
        let cfg_turn = self.cfg.money_per_turn;
        let max_money = self.cfg.max_money;
        let revive_turns_left = {
            let t = self.team_mut(s);
            t.turns += 1;
            t.moves = 0;
            let mut gain = cfg_turn + combo_money;
            for i in t.income.iter_mut() {
                gain += i.value;
                i.turns -= 1;
            }
            t.income.retain(|i| i.turns > 0);
            let before = t.money;
            t.money = (t.money + gain).clamp(0, max_money);
            if t.money != before {
                fx.push(Fx::Money { side: s, amount: t.money - before });
            }
            for u in t.board.iter_mut() {
                u.acted = false;
                for sh in u.shields.iter_mut() {
                    sh.turns -= 1;
                }
                u.shields.retain(|x| x.turns > 0 && x.value > 0);
            }
            // „Powrót”: odliczanie tur pokonanych kart
            let mut back = vec![];
            for u in t.ko.iter_mut() {
                if let Some(n) = u.revive_in.as_mut() {
                    *n -= 1;
                    if *n <= 0 {
                        back.push(u.uid);
                    }
                }
            }
            back
        };
        // trucizna i leczenie rozłożone w czasie - na początku tury właściciela karty
        let uids: Vec<i64> = self.team(s).board.iter().map(|u| u.uid).collect();
        for uid in uids {
            let Some(u) = self.unit_mut(s, uid) else { continue };
            let poison: i64 = u.poison.iter().map(|p| p.value).sum();
            let regen: i64 = u.regen.iter().map(|p| p.value).sum();
            for p in u.poison.iter_mut().chain(u.regen.iter_mut()) {
                p.turns -= 1;
            }
            u.poison.retain(|p| p.turns > 0);
            u.regen.retain(|p| p.turns > 0);
            if regen > 0 {
                let h = (u.max_hp - u.hp).min(regen).max(0);
                u.hp += h;
                fx.push(Fx::Heal { uid, amount: h });
            }
            if poison > 0 {
                fx.push(Fx::Poison { uid, amount: poison });
                self.hurt(s, uid, poison, true, s.other(), None, &mut fx);
            }
        }
        for uid in revive_turns_left {
            self.revive(s, uid, &mut fx);
        }
        self.refresh(s);
        self.refresh(s.other());
        self.team_mut(s).moves = self.cfg.moves;
        let name = self.team(s).name.clone();
        self.note(Some(s), format!("Tura: {name}"), fx);
    }

    /// Koniec tury (przycisk albo czas)
    fn pass(&mut self, now: f64) {
        let next = self.active.other();
        self.begin_turn(next, now);
    }

    pub fn end_turn(&mut self, s: Side, now: f64) -> Result<(), ArenaError> {
        self.check_turn(s)?;
        self.pass(now);
        Ok(())
    }

    fn check_turn(&self, s: Side) -> Result<(), ArenaError> {
        if self.over.is_some() {
            return err("Mecz już się skończył");
        }
        if self.active != s {
            return err("To nie twoja tura");
        }
        Ok(())
    }

    fn check_move(&self, s: Side) -> Result<(), ArenaError> {
        self.check_turn(s)?;
        if self.team(s).moves <= 0 {
            return err("Nie masz już ruchów w tej turze");
        }
        Ok(())
    }

    /// Ruch wykonany: po ostatnim ruchu tura kończy się sama
    fn spend(&mut self, s: Side, now: f64) {
        let t = self.team_mut(s);
        t.moves -= 1;
        if t.moves <= 0 && self.over.is_none() {
            self.pass(now);
        }
    }

    // ------------------------------------------------------------ ruchy

    pub fn free_slot(&self, s: Side, row: usize) -> Option<usize> {
        (0..self.cfg.row_slots).find(|i| !self.team(s).board.iter().any(|u| u.row == row && u.slot == *i))
    }

    pub fn place(&mut self, s: Side, uid: i64, row: usize, now: f64) -> Result<(), ArenaError> {
        self.check_move(s)?;
        if row >= self.cfg.rows {
            return err("Nie ma takiego rzędu");
        }
        let Some(i) = self.team(s).hand.iter().position(|u| u.uid == uid) else { return err("Tej karty nie ma w ręce") };
        let cost = self.team(s).hand[i].points;
        if self.team(s).money < cost {
            return err(format!("Za mało pieniędzy (potrzeba {cost})"));
        }
        let Some(slot) = self.free_slot(s, row) else { return err("Ten rząd jest pełny") };
        let t = self.team_mut(s);
        let mut u = t.hand.remove(i);
        t.money -= cost;
        u.row = row;
        u.slot = slot;
        u.acted = false;
        t.board.push(u);
        let name = format!("{}: wystawia kartę do rzędu {}", t.name, row + 1);
        self.refresh(s);
        self.note(Some(s), name, vec![Fx::Place { uid }, Fx::Money { side: s, amount: -cost }]);
        self.spend(s, now);
        Ok(())
    }

    pub fn retreat(&mut self, s: Side, uid: i64, now: f64) -> Result<(), ArenaError> {
        self.check_move(s)?;
        let Some(i) = self.team(s).board.iter().position(|u| u.uid == uid) else { return err("Tej karty nie ma na planszy") };
        let t = self.team_mut(s);
        let mut u = t.board.remove(i);
        u.shields.clear();
        u.poison.clear();
        u.regen.clear();
        t.hand.push(u);
        let text = format!("{}: wycofuje kartę", t.name);
        self.refresh(s);
        self.note(Some(s), text, vec![]);
        self.spend(s, now);
        Ok(())
    }

    fn unit(&self, s: Side, uid: i64) -> Option<&Unit> {
        self.team(s).board.iter().find(|u| u.uid == uid)
    }

    fn unit_mut(&mut self, s: Side, uid: i64) -> Option<&mut Unit> {
        self.team_mut(s).board.iter_mut().find(|u| u.uid == uid)
    }

    pub fn distance(own_row: usize, foe_row: usize) -> i64 {
        (own_row + foe_row + 1) as i64
    }

    /// Karty rywala w zasięgu karty
    pub fn in_range(&self, s: Side, uid: i64) -> Vec<i64> {
        let Some(u) = self.unit(s, uid) else { return vec![] };
        let (lo, hi) = (u.stats.range_min, u.stats.range_max);
        self.team(s.other())
            .board
            .iter()
            .filter(|f| (lo..=hi).contains(&Self::distance(u.row, f.row)))
            .map(|f| f.uid)
            .collect()
    }

    /// Atak karty z premią z układów
    pub fn attack_of(&self, s: Side, u: &Unit) -> i64 {
        (u.stats.atk + self.unit_bonus(s, u, "atk")).max(0)
    }

    /// Cele umiejętności: (strona celów, lista kart)
    pub fn targets(&self, s: Side, uid: i64, ab: &Ability) -> (Side, Vec<i64>) {
        match (ab.kind.as_str(), ab.mode.as_str()) {
            ("attack", _) => (s.other(), self.in_range(s, uid)),
            ("heal", "drain") if ab.from == "enemy" => (s.other(), self.in_range(s, uid)),
            ("heal", "drain") => (s, self.team(s).board.iter().filter(|u| u.uid != uid).map(|u| u.uid).collect()),
            ("shield" | "heal", _) => (s, self.team(s).board.iter().map(|u| u.uid).collect()),
            _ => (s, vec![]),
        }
    }

    /// Wybór celów: skierowana = wskazany cel (+ najbliżsi sąsiedzi przy obszarowej), losowa = losowe karty
    fn pick(&self, side: Side, pool: &[i64], ab: &Ability, target: Option<i64>, rng: &mut impl Rng) -> Result<Vec<i64>, ArenaError> {
        if pool.is_empty() {
            return err("Brak celu w zasięgu");
        }
        let n = if ab.area { if ab.count <= 0 { pool.len() } else { ab.count as usize } } else { 1 };
        if ab.aim {
            let Some(t) = target.filter(|t| pool.contains(t)) else { return err("Wybierz cel") };
            let Some(tu) = self.unit(side, t) else { return err("Wybierz cel") };
            let mut rest: Vec<&Unit> = pool.iter().filter(|u| **u != t).filter_map(|u| self.unit(side, *u)).collect();
            rest.sort_by_key(|u| (u.row.abs_diff(tu.row), u.slot.abs_diff(tu.slot), u.uid));
            Ok(std::iter::once(t).chain(rest.into_iter().map(|u| u.uid)).take(n).collect())
        } else {
            Ok(pool.choose_multiple(rng, n.min(pool.len())).copied().collect())
        }
    }

    pub fn use_ability(&mut self, s: Side, uid: i64, ab_idx: usize, target: Option<i64>, target2: Option<i64>, now: f64) -> Result<(), ArenaError> {
        self.use_with(s, uid, ab_idx, target, target2, now, &mut rand::thread_rng())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn use_with(&mut self, s: Side, uid: i64, ab_idx: usize, target: Option<i64>, target2: Option<i64>, now: f64, rng: &mut impl Rng) -> Result<(), ArenaError> {
        self.check_move(s)?;
        let Some(u) = self.unit(s, uid) else { return err("Karta musi być na planszy") };
        if u.acted {
            return err("Ta karta już działała w tej turze");
        }
        let Some(ab) = u.stats.abilities.get(ab_idx).cloned() else { return err("Nie ma takiej umiejętności") };
        if ab.passive() {
            return err("Ta umiejętność działa sama");
        }
        if self.team(s).money < ab.cost {
            return err(format!("Za mało pieniędzy (potrzeba {})", ab.cost));
        }
        let atk = self.attack_of(s, u);
        let mut fx = vec![];
        let (tside, pool) = self.targets(s, uid, &ab);
        match (ab.kind.as_str(), ab.mode.as_str()) {
            ("attack", mode) => {
                let hit = self.pick(tside, &pool, &ab, target, rng)?;
                let dmg = (atk * ab.power + 50) / 100;
                for t in hit {
                    if mode == "poison" {
                        if let Some(f) = self.unit_mut(tside, t) {
                            f.poison.push(Timed { value: dmg, turns: ab.turns });
                            fx.push(Fx::Poison { uid: t, amount: dmg });
                        }
                    } else {
                        self.hurt(tside, t, dmg, false, s, Some(uid), &mut fx);
                    }
                }
            }
            ("shield", _) => {
                for t in self.pick(tside, &pool, &ab, target, rng)? {
                    if let Some(f) = self.unit_mut(tside, t) {
                        f.shields.push(Timed { value: ab.power, turns: ab.turns.max(1) });
                        fx.push(Fx::Shield { uid: t, amount: ab.power });
                    }
                }
            }
            ("heal", "drain") => {
                let src = self.pick(tside, &pool, &Ability { area: false, ..ab.clone() }, target, rng)?[0];
                let own: Vec<i64> = self.team(s).board.iter().filter(|x| x.uid != src).map(|x| x.uid).collect();
                let to = if ab.aim {
                    match target2.filter(|t| own.contains(t)) {
                        Some(t) => t,
                        None => return err("Wybierz kartę, która dostanie HP"),
                    }
                } else {
                    let hurt: Vec<i64> = own.iter().copied().filter(|x| self.unit(s, *x).is_some_and(|u| u.hp < u.max_hp)).collect();
                    *hurt.choose(rng).or(own.choose(rng)).unwrap_or(&uid)
                };
                let taken = self.unit(tside, src).map_or(0, |x| x.hp.min(ab.power));
                self.hurt(tside, src, taken, true, s, Some(uid), &mut fx);
                if let Some(r) = self.unit_mut(s, to) {
                    let h = (r.max_hp - r.hp).min(taken).max(0);
                    r.hp += h;
                    fx.push(Fx::Heal { uid: to, amount: h });
                }
            }
            ("heal", mode) => {
                for t in self.pick(tside, &pool, &ab, target, rng)? {
                    if let Some(f) = self.unit_mut(tside, t) {
                        if mode == "regen" {
                            f.regen.push(Timed { value: ab.power, turns: ab.turns });
                            fx.push(Fx::Heal { uid: t, amount: 0 });
                        } else {
                            let h = (f.max_hp - f.hp).min(ab.power).max(0);
                            f.hp += h;
                            fx.push(Fx::Heal { uid: t, amount: h });
                        }
                    }
                }
            }
            ("eco", mode) => {
                let max = self.cfg.max_money;
                match mode {
                    "income" => self.team_mut(s).income.push(Timed { value: ab.power, turns: ab.turns }),
                    "steal" => {
                        let foe = self.team_mut(s.other());
                        let take = foe.money.min(ab.power).max(0);
                        foe.money -= take;
                        fx.push(Fx::Money { side: s.other(), amount: -take });
                        let me = self.team_mut(s);
                        me.money = (me.money + take).min(max);
                        fx.push(Fx::Money { side: s, amount: take });
                    }
                    _ => {
                        let me = self.team_mut(s);
                        let before = me.money;
                        me.money = (me.money + ab.power).min(max);
                        fx.push(Fx::Money { side: s, amount: me.money - before });
                    }
                }
            }
            _ => return err("Ta umiejętność działa sama"),
        }
        self.team_mut(s).money -= ab.cost;
        if let Some(u) = self.unit_mut(s, uid) {
            u.acted = true;
        }
        self.refresh(s);
        self.refresh(s.other());
        let text = format!("{}: {}", self.team(s).name, ab.name);
        self.note(Some(s), text, fx);
        self.spend(s, now);
        Ok(())
    }

    /// Obrażenia karcie strony `s`; `by` = strona, która dostaje punkty za pokonanie
    #[allow(clippy::too_many_arguments)]
    fn hurt(&mut self, s: Side, uid: i64, amount: i64, pierce: bool, by: Side, killer: Option<i64>, fx: &mut Vec<Fx>) {
        let Some(u) = self.unit_mut(s, uid) else { return };
        let mut left = amount.max(0);
        if !pierce {
            for sh in u.shields.iter_mut() {
                let take = sh.value.min(left);
                sh.value -= take;
                left -= take;
                if take > 0 {
                    fx.push(Fx::Block { uid, amount: take });
                }
            }
            u.shields.retain(|x| x.value > 0);
        }
        let hit = u.hp.min(left);
        u.hp -= hit;
        if left > 0 || amount == 0 {
            fx.push(Fx::Dmg { uid, amount: left });
        }
        if u.hp <= 0 {
            self.defeat(s, uid, by, killer, fx);
        }
    }

    fn defeat(&mut self, s: Side, uid: i64, by: Side, killer: Option<i64>, fx: &mut Vec<Fx>) {
        let revive_turns = self.cfg.revive_turns;
        let bonus = self.combo_bonus(by, "points");
        let t = self.team_mut(s);
        let Some(i) = t.board.iter().position(|u| u.uid == uid) else { return };
        let mut u = t.board.remove(i);
        u.hp = 0;
        u.shields.clear();
        u.poison.clear();
        u.regen.clear();
        if u.special("revive") && !u.revived {
            u.revive_in = Some(revive_turns);
        }
        let pts = (u.points + bonus).max(0);
        t.ko.push(u);
        self.team_mut(by).points += pts;
        fx.push(Fx::Ko { uid, points: pts });
        if let Some(k) = killer.and_then(|k| self.unit(by, k)) {
            self.last_ko = Some((by, k.pid.clone()));
        }
    }

    fn revive(&mut self, s: Side, uid: i64, fx: &mut Vec<Fx>) {
        let t = self.team_mut(s);
        let Some(i) = t.ko.iter().position(|u| u.uid == uid) else { return };
        let mut u = t.ko.remove(i);
        u.revive_in = None;
        u.revived = true;
        u.hp = u.stats.hp;
        u.acted = false;
        let row = u.row;
        if let Some(slot) = self.free_slot(s, row) {
            u.slot = slot;
            self.team_mut(s).board.push(u);
        } else {
            self.team_mut(s).hand.push(u);
        }
        fx.push(Fx::Revive { uid });
    }

    // ------------------------------------------------------------ układy

    /// Aktywne układy strony: (układ, karty, które go tworzą)
    pub fn active_combos(&self, s: Side) -> Vec<(&Combo, Vec<i64>)> {
        let board = &self.team(s).board;
        let mut out = vec![];
        for c in &self.combos {
            let mut groups: indexmap::IndexMap<&str, Vec<i64>> = indexmap::IndexMap::new();
            for u in board {
                if let Some(v) = u.stats.trait_value(&c.trait_) {
                    if c.value.is_empty() || c.value == v {
                        groups.entry(v).or_default().push(u.uid);
                    }
                }
            }
            let members: Vec<i64> = groups.into_values().filter(|g| g.len() as i64 >= c.count).flatten().collect();
            if !members.is_empty() {
                out.push((c, members));
            }
        }
        out
    }

    /// Premia strony z układów (money / points)
    fn combo_bonus(&self, s: Side, kind: &str) -> i64 {
        self.active_combos(s).iter().flat_map(|(c, _)| &c.effects).filter(|e| e.kind == kind).map(|e| e.amount).sum()
    }

    /// Premia karty z układów (atk / hp)
    fn unit_bonus(&self, s: Side, u: &Unit, kind: &str) -> i64 {
        self.active_combos(s)
            .iter()
            .flat_map(|(c, members)| c.effects.iter().filter(move |e| e.kind == kind && (e.all || members.contains(&u.uid))))
            .map(|e| e.amount)
            .sum()
    }

    /// Przelicza premie HP z układów i listę aktywnych układów
    fn refresh(&mut self, s: Side) {
        let bonus: Vec<(i64, i64)> = self.team(s).board.iter().map(|u| (u.uid, self.unit_bonus(s, u, "hp"))).collect();
        let ids: Vec<String> = self.active_combos(s).iter().map(|(c, _)| c.id.clone()).collect();
        let t = self.team_mut(s);
        t.combos = ids;
        for (uid, b) in bonus {
            let Some(u) = t.board.iter_mut().find(|u| u.uid == uid) else { continue };
            let diff = b - u.bonus_hp;
            u.bonus_hp = b;
            u.max_hp = (u.stats.hp + b).max(1);
            if diff > 0 {
                u.hp += diff;
            }
            u.hp = u.hp.min(u.max_hp);
        }
        for u in t.hand.iter_mut() {
            u.bonus_hp = 0;
            u.max_hp = u.stats.hp;
            u.hp = u.hp.min(u.max_hp);
        }
    }

    // ------------------------------------------------------------ bot

    /// Ruchy komputera w jego turze (wszystkie naraz)
    pub fn bot_turn(&mut self, s: Side, now: f64) {
        let mut rng = rand::thread_rng();
        let mut guard = 0;
        while self.over.is_none() && self.active == s && guard < 20 {
            guard += 1;
            if !self.bot_move(s, now, &mut rng) {
                if self.active == s && self.over.is_none() {
                    self.note(Some(s), format!("{}: koniec tury", self.team(s).name), vec![]);
                    self.pass(now);
                }
                break;
            }
        }
    }

    /// Jeden ruch komputera; false = nie ma sensownego ruchu
    fn bot_move(&mut self, s: Side, now: f64, rng: &mut impl Rng) -> bool {
        // (ocena, umiejętność, karta, cel, cel2)
        type Choice = (i64, usize, i64, Option<i64>, Option<i64>);
        let mut best: Option<Choice> = None;
        let foe = s.other();
        for u in self.team(s).board.iter().filter(|u| !u.acted) {
            let atk = self.attack_of(s, u);
            for (i, ab) in u.stats.abilities.iter().enumerate() {
                if ab.passive() || ab.cost > self.team(s).money {
                    continue;
                }
                let (tside, pool) = self.targets(s, u.uid, ab);
                let mut consider = |score: i64, t: Option<i64>, t2: Option<i64>| {
                    if best.as_ref().is_none_or(|b| score > b.0) {
                        best = Some((score, i, u.uid, t, t2));
                    }
                };
                match (ab.kind.as_str(), ab.mode.as_str()) {
                    ("attack", mode) if !pool.is_empty() => {
                        let dmg = (atk * ab.power + 50) / 100;
                        for t in &pool {
                            let Some(f) = self.unit(tside, *t) else { continue };
                            let real = (dmg - f.shield()).max(0);
                            let kill = mode != "poison" && real >= f.hp;
                            let n = if ab.area { if ab.count <= 0 { pool.len() } else { (ab.count as usize).min(pool.len()) } } else { 1 } as i64;
                            let score = if kill { 100 + f.points * 10 } else { real.min(f.hp) * n / 2 + if mode == "poison" { dmg * ab.turns / 3 } else { 0 } };
                            consider(score, Some(*t), None);
                        }
                    }
                    ("heal", "drain") if !pool.is_empty() => {
                        let own: Vec<&Unit> = self.team(s).board.iter().collect();
                        if let (Some(t), Some(r)) = (pool.first(), own.iter().min_by_key(|x| x.hp - x.max_hp)) {
                            if tside == foe {
                                consider(ab.power, Some(*t), Some(r.uid));
                            }
                        }
                    }
                    ("heal", _) => {
                        if let Some(w) = self.team(s).board.iter().filter(|x| x.hp < x.max_hp).min_by_key(|x| x.hp * 100 / x.max_hp.max(1)) {
                            consider((w.max_hp - w.hp).min(ab.power) + if ab.mode == "regen" { ab.power } else { 0 }, Some(w.uid), None);
                        }
                    }
                    ("shield", _) if !self.team(foe).board.is_empty() => {
                        if let Some(w) = self.team(s).board.iter().filter(|x| x.shield() == 0).max_by_key(|x| x.points) {
                            consider(ab.power / 2 + 5, Some(w.uid), None);
                        }
                    }
                    ("eco", _) => {
                        let m = self.team(s).money;
                        if m < self.cfg.max_money - ab.power {
                            consider(ab.power * 6 + if ab.mode == "steal" { self.team(foe).money.min(ab.power) * 4 } else { 0 }, None, None);
                        }
                    }
                    _ => {}
                }
            }
        }
        // wystawienie: najdroższa karta, na którą stać, w rzędzie dopasowanym do zasięgu
        let money = self.team(s).money;
        let place = self
            .team(s)
            .hand
            .iter()
            .filter(|u| u.points <= money)
            .max_by_key(|u| (u.points, u.stats.atk))
            .and_then(|u| {
                let want = (u.stats.range_min - 1).clamp(0, self.cfg.rows as i64 - 1) as usize;
                let rows: Vec<usize> = std::iter::once(want).chain(0..self.cfg.rows).collect();
                rows.into_iter().find(|r| self.free_slot(s, *r).is_some()).map(|r| (u.uid, r, u.points))
            });
        let ab_score = best.as_ref().map_or(0, |b| b.0);
        if let Some((uid, row, p)) = place {
            let score = 40 + p * 8 + if self.team(s).board.is_empty() { 200 } else { 0 };
            if score > ab_score {
                return self.place(s, uid, row, now).is_ok();
            }
        }
        if let Some((score, i, uid, t, t2)) = best {
            if score > 0 {
                return self.use_with(s, uid, i, t, t2, now, rng).is_ok();
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::arena::rules::{Ability, CardStats, Combo, ComboEffect, Meta, Settings};
    use rand::SeedableRng;

    fn stats(atk: i64, hp: i64, lo: i64, hi: i64, abilities: Vec<Ability>) -> CardStats {
        CardStats { atk, hp, range_min: lo, range_max: hi, abilities, ..CardStats::default() }
    }

    fn entry(pid: &str, s: CardStats, points: i64) -> Entry {
        Entry { card: DeckCard { pid: pid.into(), variant: "normal".into() }, stats: s, points }
    }

    fn atk(power: i64) -> Ability {
        Ability { power, ..Ability::default() }
    }

    fn cfg() -> Settings {
        Settings { start_money: 100, max_money: 1000, money_per_turn: 0, moves: 10, ..Settings::default() }
    }

    fn game(a: Vec<Entry>, b: Vec<Entry>) -> Game {
        let mut g = Game::new(Mode::Pvp, cfg(), vec![], [("A".into(), Some(1)), ("B".into(), Some(2))], [a, b], Side::A, 0.0);
        g.teams[1].money = 100;
        g
    }

    fn rng() -> rand::rngs::StdRng {
        rand::rngs::StdRng::seed_from_u64(7)
    }

    /// wystawia kartę strony bez zużywania tury testu
    fn put(g: &mut Game, s: Side, uid: i64, row: usize) {
        g.active = s;
        g.teams[s.idx()].moves = 10;
        g.place(s, uid, row, 1.0).unwrap();
        g.active = s;
        g.teams[s.idx()].moves = 10;
    }

    #[test]
    fn range_and_distance() {
        let mut g = game(vec![entry("a", stats(50, 100, 1, 1, vec![atk(100)]), 2)], vec![entry("b", stats(10, 100, 1, 1, vec![]), 3), entry("c", stats(10, 100, 1, 1, vec![]), 3)]);
        put(&mut g, Side::B, 2, 0);
        put(&mut g, Side::B, 3, 1);
        put(&mut g, Side::A, 1, 0);
        assert_eq!(Game::distance(0, 0), 1);
        assert_eq!(g.in_range(Side::A, 1), vec![2]);
        assert!(g.use_with(Side::A, 1, 0, Some(3), None, 1.0, &mut rng()).is_err()); // rząd 2 poza zasięgiem 1-1
        g.use_with(Side::A, 1, 0, Some(2), None, 1.0, &mut rng()).unwrap();
        assert_eq!(g.teams[1].board.iter().find(|u| u.uid == 2).unwrap().hp, 50);
        // ta sama karta drugi raz w turze nie działa
        assert!(g.use_with(Side::A, 1, 0, Some(2), None, 1.0, &mut rng()).is_err());
    }

    #[test]
    fn points_cost_and_kill() {
        let mut g = game(vec![entry("a", stats(200, 100, 1, 3, vec![atk(100)]), 2)], vec![entry("b", stats(10, 50, 1, 1, vec![]), 4)]);
        put(&mut g, Side::B, 2, 0);
        assert_eq!(g.teams[1].money, 96);
        put(&mut g, Side::A, 1, 0);
        g.use_with(Side::A, 1, 0, Some(2), None, 1.0, &mut rng()).unwrap();
        assert_eq!(g.teams[0].points, 4);
        assert!(g.teams[1].board.is_empty() && g.teams[1].ko.len() == 1);
        assert!(g.place(Side::A, 99, 0, 1.0).is_err());
        g.teams[0].money = 0;
    }

    #[test]
    fn shield_on_ally_and_area() {
        let sh = Ability { kind: "shield".into(), power: 30, area: true, count: 0, aim: false, turns: 2, ..Ability::default() };
        let mut g = game(
            vec![entry("a", stats(10, 100, 1, 3, vec![sh]), 1), entry("a2", stats(10, 100, 1, 3, vec![]), 1)],
            vec![entry("b", stats(50, 100, 1, 3, vec![atk(100)]), 1)],
        );
        put(&mut g, Side::A, 1, 0);
        put(&mut g, Side::A, 2, 1);
        put(&mut g, Side::B, 3, 0);
        g.active = Side::A;
        g.use_with(Side::A, 1, 0, None, None, 1.0, &mut rng()).unwrap();
        assert!(g.teams[0].board.iter().all(|u| u.shield() == 30));
        g.active = Side::B;
        g.use_with(Side::B, 3, 0, Some(2), None, 1.0, &mut rng()).unwrap();
        let u = g.teams[0].board.iter().find(|u| u.uid == 2).unwrap();
        assert_eq!((u.hp, u.shield()), (80, 0));
    }

    #[test]
    fn area_attack_hits_neighbours() {
        let area = Ability { power: 100, area: true, count: 2, aim: true, ..Ability::default() };
        let mut g = game(vec![entry("a", stats(20, 100, 1, 3, vec![area]), 1)], (0..3).map(|i| entry(&format!("b{i}"), stats(1, 100, 1, 1, vec![]), 1)).collect());
        for uid in 2..=4 {
            put(&mut g, Side::B, uid, 0);
        }
        put(&mut g, Side::A, 1, 0);
        g.use_with(Side::A, 1, 0, Some(2), None, 1.0, &mut rng()).unwrap();
        let hurt = g.teams[1].board.iter().filter(|u| u.hp < 100).count();
        assert_eq!(hurt, 2);
        assert_eq!(g.teams[1].board.iter().find(|u| u.uid == 2).unwrap().hp, 80);
    }

    #[test]
    fn poison_over_turns_gives_points() {
        let p = Ability { mode: "poison".into(), power: 100, turns: 3, ..Ability::default() };
        let mut g = game(vec![entry("a", stats(20, 100, 1, 3, vec![p]), 1)], vec![entry("b", stats(1, 50, 1, 1, vec![]), 5)]);
        put(&mut g, Side::B, 2, 0);
        put(&mut g, Side::A, 1, 0);
        g.use_with(Side::A, 1, 0, Some(2), None, 1.0, &mut rng()).unwrap();
        assert_eq!(g.teams[1].board[0].hp, 50); // trucizna działa dopiero od tury właściciela
        g.end_turn(Side::A, 2.0).unwrap(); // tura B: -20
        assert_eq!(g.teams[1].board[0].hp, 30);
        g.end_turn(Side::B, 3.0).unwrap();
        g.end_turn(Side::A, 4.0).unwrap(); // -20
        assert_eq!(g.teams[1].board[0].hp, 10);
        g.end_turn(Side::B, 5.0).unwrap();
        g.end_turn(Side::A, 6.0).unwrap(); // -20 -> pokonana, punkty dla A
        assert!(g.teams[1].board.is_empty());
        assert_eq!(g.teams[0].points, 5);
    }

    #[test]
    fn heal_regen_and_drain() {
        let heal = Ability { kind: "heal".into(), power: 30, ..Ability::default() };
        let regen = Ability { kind: "heal".into(), mode: "regen".into(), power: 10, turns: 2, ..Ability::default() };
        let drain = Ability { kind: "heal".into(), mode: "drain".into(), power: 25, from: "enemy".into(), ..Ability::default() };
        let mut g = game(
            vec![entry("a", stats(1, 100, 1, 3, vec![heal, regen]), 1), entry("d", stats(1, 100, 1, 3, vec![drain]), 1)],
            vec![entry("b", stats(1, 100, 1, 3, vec![]), 1)],
        );
        put(&mut g, Side::A, 1, 0);
        put(&mut g, Side::A, 2, 0);
        put(&mut g, Side::B, 3, 0);
        g.teams[0].board[0].hp = 40;
        g.active = Side::A;
        g.use_with(Side::A, 1, 0, Some(1), None, 1.0, &mut rng()).unwrap();
        assert_eq!(g.teams[0].board[0].hp, 70);
        // wysysanie: rywal -25, moja karta 1 +25
        g.use_with(Side::A, 2, 0, Some(3), Some(1), 1.0, &mut rng()).unwrap();
        assert_eq!(g.teams[1].board[0].hp, 75);
        assert_eq!(g.teams[0].board[0].hp, 95);
        // leczenie rozłożone: +10 na początku tury właściciela
        g.teams[0].board[0].hp = 50;
        g.teams[0].board[0].acted = false;
        g.use_with(Side::A, 1, 1, Some(1), None, 1.0, &mut rng()).unwrap();
        g.end_turn(Side::A, 2.0).unwrap();
        g.end_turn(Side::B, 3.0).unwrap();
        assert_eq!(g.teams[0].board[0].hp, 60);
    }

    #[test]
    fn economy_kinds() {
        let eco = Ability { kind: "eco".into(), power: 5, ..Ability::default() };
        let inc = Ability { kind: "eco".into(), mode: "income".into(), power: 2, turns: 2, ..Ability::default() };
        let steal = Ability { kind: "eco".into(), mode: "steal".into(), power: 7, ..Ability::default() };
        let mut g = game(
            vec![entry("a", stats(1, 100, 1, 3, vec![eco]), 0), entry("b", stats(1, 100, 1, 3, vec![inc]), 0), entry("c", stats(1, 100, 1, 3, vec![steal]), 0)],
            vec![],
        );
        for uid in 1..=3 {
            put(&mut g, Side::A, uid, 0);
        }
        g.teams[0].money = 10;
        g.teams[1].money = 4;
        g.use_with(Side::A, 1, 0, None, None, 1.0, &mut rng()).unwrap();
        assert_eq!(g.teams[0].money, 15);
        g.use_with(Side::A, 3, 0, None, None, 1.0, &mut rng()).unwrap();
        assert_eq!((g.teams[0].money, g.teams[1].money), (19, 0));
        g.use_with(Side::A, 2, 0, None, None, 1.0, &mut rng()).unwrap();
        g.end_turn(Side::A, 2.0).unwrap();
        g.end_turn(Side::B, 3.0).unwrap();
        assert_eq!(g.teams[0].money, 21);
        g.end_turn(Side::A, 4.0).unwrap();
        g.end_turn(Side::B, 5.0).unwrap();
        assert_eq!(g.teams[0].money, 23);
        g.end_turn(Side::A, 6.0).unwrap();
        g.end_turn(Side::B, 7.0).unwrap();
        assert_eq!(g.teams[0].money, 23); // dochód skończył się po 2 turach
    }

    #[test]
    fn revive_after_three_turns() {
        let rev = Ability { kind: "special".into(), mode: "revive".into(), ..Ability::default() };
        let mut g = game(vec![entry("a", stats(500, 100, 1, 3, vec![atk(100)]), 1)], vec![entry("s", stats(1, 80, 1, 1, vec![rev]), 6)]);
        put(&mut g, Side::B, 2, 1);
        put(&mut g, Side::A, 1, 0);
        g.active = Side::B;
        assert!(g.use_with(Side::B, 2, 0, None, None, 1.0, &mut rng()).is_err()); // specjalna działa sama
        g.active = Side::A;
        g.use_with(Side::A, 1, 0, Some(2), None, 1.0, &mut rng()).unwrap();
        assert_eq!(g.teams[0].points, 6);
        assert_eq!(g.teams[1].ko[0].revive_in, Some(3));
        for t in 0..3 {
            assert!(g.teams[1].board.is_empty(), "tura {t}");
            g.end_turn(Side::A, 2.0).unwrap();
            if t < 2 {
                g.end_turn(Side::B, 3.0).unwrap();
            }
        }
        let u = &g.teams[1].board[0];
        assert_eq!((u.hp, u.row), (80, 1));
        // drugi raz już nie wraca
        g.active = Side::A;
        g.teams[0].moves = 5;
        g.teams[0].board[0].acted = false;
        g.use_with(Side::A, 1, 0, Some(2), None, 1.0, &mut rng()).unwrap();
        assert_eq!(g.teams[1].ko[0].revive_in, None);
    }

    #[test]
    fn moves_and_turn_time() {
        let mut g = Game::new(
            Mode::Pvp,
            Settings { moves: 2, start_money: 50, ..Settings::default() },
            vec![],
            [("A".into(), None), ("B".into(), None)],
            [(0..4).map(|i| entry(&format!("a{i}"), stats(1, 10, 1, 1, vec![]), 1)).collect(), vec![]],
            Side::A,
            0.0,
        );
        g.place(Side::A, 1, 0, 1.0).unwrap();
        g.place(Side::A, 2, 0, 1.0).unwrap();
        assert_eq!(g.active, Side::B); // po 4 (tu: 2) ruchach tura kończy się sama
        assert!(g.place(Side::A, 3, 0, 1.0).is_err());
        g.tick(1.0 + g.cfg.turn_secs as f64 + 0.1);
        assert_eq!(g.active, Side::A); // 40 s minęło
        g.retreat(Side::A, 1, 50.0).unwrap();
        assert!(g.teams[0].hand.iter().any(|u| u.uid == 1));
    }

    #[test]
    fn time_up_and_overtime() {
        let mut g = game(vec![], vec![]);
        g.tick(299.0);
        assert!(g.over.is_none());
        g.tick(300.5);
        assert!(g.over.is_none() && g.overtimes == 1 && g.game_ends == 420.0); // remis 0:0 -> dogrywka +2 min
        g.teams[1].points = 3;
        g.tick(421.0);
        assert_eq!(g.over, Some(Outcome::Won(Side::B)));
        assert_eq!(g.reason, Some(EndReason::Time));
        let mut g = game(vec![], vec![]);
        g.tick(10_000.0);
        assert_eq!((g.over, g.overtimes), (Some(Outcome::Draw), 3)); // po 3 dogrywkach remis
    }

    #[test]
    fn combos_bonus() {
        let party = |pid: &str| {
            let mut s = stats(10, 100, 1, 3, vec![atk(100)]);
            s.traits.insert("party".into(), "X".into());
            entry(pid, s, 1)
        };
        let combo = Combo {
            id: "p".into(),
            name: "Partia".into(),
            trait_: "party".into(),
            value: String::new(),
            count: 3,
            effects: vec![ComboEffect { kind: "atk".into(), amount: 5, all: false }, ComboEffect { kind: "hp".into(), amount: 20, all: false }, ComboEffect { kind: "points".into(), amount: 2, all: false }],
        };
        let mut g = Game::new(Mode::Pvp, cfg(), vec![combo], [("A".into(), None), ("B".into(), None)], [vec![party("a"), party("b"), party("c")], vec![entry("z", stats(1, 15, 1, 1, vec![]), 1)]], Side::A, 0.0);
        g.teams[1].money = 10;
        put(&mut g, Side::A, 1, 0);
        put(&mut g, Side::A, 2, 0);
        assert!(g.teams[0].combos.is_empty());
        put(&mut g, Side::A, 3, 1);
        assert_eq!(g.teams[0].combos, vec!["p".to_owned()]);
        assert!(g.teams[0].board.iter().all(|u| u.max_hp == 120 && u.hp == 120));
        assert_eq!(g.attack_of(Side::A, &g.teams[0].board[0]), 15);
        put(&mut g, Side::B, 4, 0);
        g.active = Side::A;
        g.use_with(Side::A, 1, 0, Some(4), None, 1.0, &mut rng()).unwrap();
        assert_eq!(g.teams[0].points, 3); // 1 + premia 2
        // wycofanie rozbija układ
        g.retreat(Side::A, 3, 1.0).unwrap();
        assert!(g.teams[0].combos.is_empty() && g.teams[0].board.iter().all(|u| u.max_hp == 100 && u.hp == 100));
    }

    #[test]
    fn bot_plays_turn() {
        let mut g = Game::new(
            Mode::Bot,
            Settings::default(),
            Meta::default().combos,
            [("A".into(), Some(1)), ("Bot".into(), None)],
            [vec![entry("a", stats(10, 50, 1, 2, vec![atk(100)]), 2)], (0..4).map(|i| entry(&format!("b{i}"), stats(30, 60, 1, 3, vec![atk(100)]), 2)).collect()],
            Side::B,
            0.0,
        );
        g.bot_turn(Side::B, 1.0);
        assert_eq!(g.active, Side::A);
        assert!(!g.teams[1].board.is_empty());
        assert!(g.teams[1].money <= Settings::default().start_money + Settings::default().money_per_turn);
    }
}
