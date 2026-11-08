//! Poker (Texas Hold'em) dla 2-6 graczy. Stawką są karty z kolekcji - nie zamieniają się na żetony.
//!
//! Gracz siada do stołu z wybranymi kartami ("stos", najwyżej `MAX_BUY` kart). Karty są wtedy w ESCROW, a tabela
//! `poker_escrow` pamięta, do kogo należą (po restarcie serwera `restore` oddaje je właścicielom). Licytuje się,
//! wypychając na stół konkretne karty ze stosu - wszyscy widzą, kto co postawił. Ciemne: każda z dwóch pozycji
//! wykłada najtańszą kartę ze stosu. Sprawdzenie = postawione na tej ulicy warte co najmniej tyle, co najwyższa
//! stawka (karty są niepodzielne, więc można przepłacić); kto nie ma tyle, wchodzi all-in. Pule poboczne liczone
//! są po wartości; niepodzielna karta trafia do tej z pul, w które wpada jej wartość, gdzie najlepiej wyrównuje pulę. Wygrane karty trafiają na stos
//! zwycięzcy, a po wstaniu od stołu cały stos wraca do ekwipunku.
//!
//! Stoły i rozdania są w pamięci procesu (jak walki Areny), czas tury rozlicza `tick` przy każdym zapytaniu
//! i co sekundę w tle (`run_ticker`).

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::LazyLock;

use axum::extract::{Path, State};
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Mutex;

use super::{ok, JsonBody};
use crate::auth::{Me, UserView};
use crate::catalog::Catalog;
use crate::db::{lock_me, now, Conn};
use crate::error::{bad, Res};
use crate::game::views::CardJson;
use crate::game::*;
use crate::state::AppState;
use crate::text::fmt_money;

pub const MAX_SEATS: usize = 6;
/// najwięcej kart przynoszonych do stołu za jednym razem
pub const MAX_BUY: usize = 40;
const MAX_TABLES: usize = 30;
/// czas na ruch (s); dwa przegapione ruchy z rzędu = gracz wstaje od stołu po rozdaniu
const TURN_SECS: f64 = 35.0;
/// pokazanie wyniku rozdania przed następnym
const SHOWDOWN_SECS: f64 = 7.0;
/// przerwa przed pierwszym rozdaniem, gdy przy stole są już dwie osoby
const START_SECS: f64 = 3.0;
/// kolejne karty stołu, gdy nikt już nie może licytować (all-in)
const RUNOUT_SECS: f64 = 1.6;
/// gracz, który nie odpytuje stołu tyle sekund (zamknięta karta), wstaje, gdy nie gra w rozdaniu
const IDLE_SECS: f64 = 90.0;
const GONE: &str = "Tego stołu już nie ma";

// ---------------------------------------------------------------- karty do gry i siła układu

/// Karta do gry: ranga (23456789TJQKA) + kolor (SHDC), np. "TS"
fn rank_of(c: &str) -> u8 {
    match c.as_bytes().first() {
        Some(b'A') => 14,
        Some(b'K') => 13,
        Some(b'Q') => 12,
        Some(b'J') => 11,
        Some(b'T') => 10,
        Some(d @ b'2'..=b'9') => d - b'0',
        _ => 0,
    }
}

fn suit_of(c: &str) -> u8 {
    c.as_bytes().get(1).copied().unwrap_or(0)
}

fn new_deck() -> Vec<String> {
    let mut deck: Vec<String> =
        "23456789TJQKA".chars().flat_map(|r| "SHDC".chars().map(move |s| format!("{r}{s}"))).collect();
    deck.shuffle(&mut rand::thread_rng());
    deck
}

/// Siła 5 kart: kategoria << 20 | rozstrzygające rangi po 4 bity (większa = lepsza)
fn score5(cs: &[&str]) -> u32 {
    let mut r: Vec<u8> = cs.iter().map(|c| rank_of(c)).collect();
    r.sort_unstable_by(|a, b| b.cmp(a));
    let flush = cs.iter().all(|c| suit_of(c) == suit_of(cs[0]));
    let mut uniq = r.clone();
    uniq.dedup();
    let straight = if uniq.len() == 5 {
        if r[0] - r[4] == 4 {
            Some(r[0])
        } else if r == [14, 5, 4, 3, 2] {
            Some(5)
        } else {
            None
        }
    } else {
        None
    };
    let mut groups: Vec<(usize, u8)> = uniq.iter().map(|&x| (r.iter().filter(|&&y| y == x).count(), x)).collect();
    groups.sort_unstable_by(|a, b| b.cmp(a));
    let by_groups: Vec<u8> = groups.iter().map(|g| g.1).collect();
    let (cat, tb): (u32, Vec<u8>) = match (flush, straight, groups[0].0, groups.get(1).map_or(0, |g| g.0)) {
        (true, Some(h), _, _) => (8, vec![h]),
        (_, _, 4, _) => (7, by_groups),
        (_, _, 3, 2) => (6, by_groups),
        (true, None, _, _) => (5, r),
        (false, Some(h), _, _) => (4, vec![h]),
        (_, _, 3, _) => (3, by_groups),
        (_, _, 2, 2) => (2, by_groups),
        (_, _, 2, _) => (1, by_groups),
        _ => (0, r),
    };
    let mut s = cat << 20;
    for (i, &x) in tb.iter().take(5).enumerate() {
        s |= u32::from(x) << (16 - 4 * i);
    }
    s
}

/// Najlepsze 5 z 5-7 kart: siła i te karty
fn best_hand(cards: &[String]) -> (u32, Vec<String>) {
    let n = cards.len();
    if n < 5 {
        return (0, vec![]);
    }
    let mut best = (0u32, vec![]);
    let idx: Vec<usize> = (0..n).collect();
    let mut pick = vec![0usize; 5];
    fn rec(idx: &[usize], start: usize, depth: usize, pick: &mut Vec<usize>, cards: &[String], best: &mut (u32, Vec<String>)) {
        if depth == 5 {
            let five: Vec<&str> = pick.iter().map(|&i| cards[i].as_str()).collect();
            let s = score5(&five);
            if s > best.0 || best.1.is_empty() {
                *best = (s, five.iter().map(|c| (*c).to_owned()).collect());
            }
            return;
        }
        for k in start..idx.len() {
            pick[depth] = idx[k];
            rec(idx, k + 1, depth + 1, pick, cards, best);
        }
    }
    rec(&idx, 0, 0, &mut pick, cards, &mut best);
    best
}

const HAND_NAMES: [&str; 9] = ["Wysoka karta", "Para", "Dwie pary", "Trójka", "Strit", "Kolor", "Full", "Kareta", "Poker"];

fn hand_name(score: u32) -> &'static str {
    let cat = (score >> 20) as usize;
    if cat == 8 && (score >> 16) & 0xF == 14 {
        return "Poker królewski";
    }
    HAND_NAMES.get(cat).copied().unwrap_or("")
}

// ---------------------------------------------------------------- stół

/// Karta z kolekcji postawiona przy stole (wartość z chwili, gdy trafiła na stół)
#[derive(Debug, Clone, PartialEq)]
struct Chip {
    id: i64,
    person: String,
    variant: String,
    value: i64,
}

/// Polska odmiana: 1 karta, 2-4 karty, 5 kart
fn plural(n: usize, one: &'static str, few: &'static str, many: &'static str) -> &'static str {
    if n == 1 {
        one
    } else if (2..=4).contains(&(n % 10)) && !(12..=14).contains(&(n % 100)) {
        few
    } else {
        many
    }
}

fn sum(chips: &[Chip]) -> i64 {
    chips.iter().map(|c| c.value).sum()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Waiting,
    Preflop,
    Flop,
    Turn,
    River,
    Showdown,
}

impl Phase {
    fn betting(self) -> bool {
        matches!(self, Phase::Preflop | Phase::Flop | Phase::Turn | Phase::River)
    }

    fn street(self) -> u8 {
        match self {
            Phase::Flop => 1,
            Phase::Turn => 2,
            Phase::River => 3,
            _ => 0,
        }
    }
}

#[derive(Debug, Clone)]
struct Seat {
    uid: i64,
    user: UserView,
    stack: Vec<Chip>,
    /// karty postawione w tym rozdaniu + ulica (0 = przed flopem)
    bet: Vec<(Chip, u8)>,
    /// wartość postawiona na tej ulicy
    street: i64,
    hole: Vec<String>,
    in_hand: bool,
    folded: bool,
    all_in: bool,
    acted: bool,
    last: Option<String>,
    timeouts: u8,
    seen: f64,
    /// wstał w trakcie rozdania - zostaje jako "duch", póki rozdanie trwa (jego karty są w puli)
    left: bool,
}

impl Seat {
    fn new(user: UserView, stack: Vec<Chip>, now: f64) -> Seat {
        Seat {
            uid: user.id,
            user,
            stack,
            bet: vec![],
            street: 0,
            hole: vec![],
            in_hand: false,
            folded: false,
            all_in: false,
            acted: false,
            last: None,
            timeouts: 0,
            seen: now,
            left: false,
        }
    }

    fn live(&self) -> bool {
        self.in_hand && !self.folded
    }

    fn can_act(&self) -> bool {
        self.live() && !self.all_in
    }

    fn committed(&self) -> i64 {
        self.bet.iter().map(|(c, _)| c.value).sum()
    }

    fn sort_stack(&mut self) {
        self.stack.sort_by(|a, b| b.value.cmp(&a.value).then(a.id.cmp(&b.id)));
    }
}

/// Karty, które dobieramy do sprawdzenia `need`: najtańsza karta, która sama wystarczy, a jeśli żadna - najdroższa
/// i szukamy dalej. Brak kart na całość = wszystkie (all-in).
fn auto_pick(stack: &[Chip], need: i64) -> Vec<i64> {
    let mut left: Vec<&Chip> = stack.iter().collect();
    left.sort_by_key(|c| c.value);
    let (mut out, mut rest) = (vec![], need);
    while rest > 0 && !left.is_empty() {
        if let Some(k) = left.iter().position(|c| c.value >= rest) {
            out.push(left.remove(k).id);
            break;
        }
        let c = left.pop().expect("niepusta");
        rest -= c.value;
        out.push(c.id);
    }
    out
}

/// Udział w puli: karty w kolejności stawiania, czy gracz jeszcze gra, siła ręki
struct Contrib {
    chips: Vec<Chip>,
    live: bool,
    score: u32,
}

/// Podział kart z puli. Pule po wartości (jak pule poboczne): poziomy = sumy wkładów; karta należy do puli, w której
/// wpada jej wartość (najlepiej wyrównując wartość puli). Pulę bierze najsilniejsza ręka spośród graczy, którzy dołożyli do niej całość; przy
/// remisie karty są rozdzielane od najdroższej do tego, kto dostał dotąd najmniej. Zwraca wygrane karty każdego.
fn distribute(cs: &[Contrib]) -> Vec<Vec<Chip>> {
    let totals: Vec<i64> = cs.iter().map(|c| sum(&c.chips)).collect();
    let mut levels: Vec<i64> = totals.iter().copied().filter(|&t| t > 0).collect();
    levels.sort_unstable();
    levels.dedup();
    let mut out = vec![vec![]; cs.len()];
    if levels.is_empty() {
        for (k, c) in cs.iter().enumerate() {
            out[k] = c.chips.clone();
        }
        return out;
    }
    // ile każda pula powinna być warta, gdyby karty dało się dzielić
    let mut want: Vec<i64> = levels
        .iter()
        .enumerate()
        .map(|(li, &l)| {
            let prev = if li == 0 { 0 } else { levels[li - 1] };
            totals.iter().map(|&t| t.min(l) - t.min(prev)).sum()
        })
        .collect();
    // pule, w które wpada wartość karty (od-do w sumie wkładu właściciela)
    let mut spans: Vec<(Chip, Vec<usize>)> = vec![];
    for c in cs {
        let mut start = 0;
        for ch in &c.chips {
            let end = start + ch.value;
            let mut over: Vec<usize> = (0..levels.len())
                .filter(|&li| {
                    let prev = if li == 0 { 0 } else { levels[li - 1] };
                    prev < end && levels[li] > start
                })
                .collect();
            if over.is_empty() {
                over.push(levels.iter().position(|&l| start < l).unwrap_or(levels.len() - 1));
            }
            spans.push((ch.clone(), over));
            start = end;
        }
    }
    // najpierw karty z jednej puli, potem pozostałe od najdroższej tam, gdzie najlepiej wyrównują wartość puli
    let mut pots: Vec<Vec<Chip>> = vec![vec![]; levels.len()];
    let (single, mut multi): (Vec<_>, Vec<_>) = spans.into_iter().partition(|(_, o)| o.len() == 1);
    for (ch, o) in single {
        want[o[0]] -= ch.value;
        pots[o[0]].push(ch);
    }
    multi.sort_by(|a, b| b.0.value.cmp(&a.0.value).then(a.0.id.cmp(&b.0.id)));
    for (ch, o) in multi {
        let li = *o.iter().min_by_key(|&&li| ((want[li] - ch.value).abs() - want[li].abs(), li)).expect("pula");
        want[li] -= ch.value;
        pots[li].push(ch);
    }
    let mut got = vec![0i64; cs.len()];
    for (li, &level) in levels.iter().enumerate() {
        let mut chips = std::mem::take(&mut pots[li]);
        if chips.is_empty() {
            continue;
        }
        let mut elig: Vec<usize> = (0..cs.len()).filter(|&k| cs[k].live && totals[k] >= level).collect();
        if elig.is_empty() {
            elig = (0..cs.len()).filter(|&k| cs[k].live).collect();
        }
        if elig.is_empty() {
            elig = (0..cs.len()).collect();
        }
        let best = elig.iter().map(|&k| cs[k].score).max().unwrap_or(0);
        let winners: Vec<usize> = elig.into_iter().filter(|&k| cs[k].score == best).collect();
        chips.sort_by(|a, b| b.value.cmp(&a.value).then(a.id.cmp(&b.id)));
        for ch in chips {
            let w = *winners.iter().min_by_key(|&&k| (got[k], k)).expect("zwycięzca");
            got[w] += ch.value;
            out[w].push(ch);
        }
    }
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Winner {
    seat: usize,
    user: UserView,
    value: i64,
    hand: Option<String>,
    best: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Shown {
    seat: usize,
    hole: Vec<String>,
    hand: String,
    best: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HandResult {
    hand_no: u64,
    winners: Vec<Winner>,
    shown: Vec<Shown>,
    /// wszyscy poza zwycięzcą spasowali - kart nie pokazujemy
    by_fold: bool,
}

/// Rozdanie dla osiągnięć: gracz, wygrał / przegrał / wyszedł na zero, postawione karty (osoba, wariant)
type Play = (i64, Option<bool>, Vec<(String, String)>);

/// Zmiany do zapisania w bazie po ruchu na stole
#[derive(Default)]
struct Pending {
    /// karty wracają do ekwipunku gracza
    releases: Vec<(i64, Vec<i64>)>,
    /// karty zmieniają właściciela przy stole (wygrana)
    moves: Vec<(i64, Vec<i64>)>,
    /// osiągnięcia: gracz, wygrał / przegrał / wyszedł na zero, postawione karty
    plays: Vec<Play>,
}

struct Table {
    id: i64,
    name: String,
    host: i64,
    seats: Vec<Option<Seat>>,
    phase: Phase,
    dealer: usize,
    board: Vec<String>,
    deck: Vec<String>,
    to_act: Option<usize>,
    deadline: f64,
    /// Waiting: najwcześniej start rozdania; Showdown: koniec pokazu; licytacja bez ruchu (all-in): kolejna karta stołu
    next_at: f64,
    hand_no: u64,
    result: Option<HandResult>,
    log: VecDeque<String>,
    ver: u64,
    pending: Pending,
}

impl Table {
    fn new(id: i64, name: String, host: i64, now: f64) -> Table {
        Table {
            id,
            name,
            host,
            seats: vec![None; MAX_SEATS],
            phase: Phase::Waiting,
            dealer: MAX_SEATS - 1,
            board: vec![],
            deck: vec![],
            to_act: None,
            deadline: 0.0,
            next_at: now + START_SECS,
            hand_no: 0,
            result: None,
            log: VecDeque::new(),
            ver: 0,
            pending: Pending::default(),
        }
    }

    fn note(&mut self, line: String) {
        self.log.push_front(line);
        self.log.truncate(40);
        self.ver += 1;
    }

    fn seat_of(&self, uid: i64) -> Option<usize> {
        self.seats.iter().position(|s| s.as_ref().is_some_and(|s| s.uid == uid && !s.left))
    }

    fn seat(&mut self, i: usize) -> &mut Seat {
        self.seats[i].as_mut().expect("zajęte miejsce")
    }

    fn name(&self, i: usize) -> String {
        self.seats[i].as_ref().map(|s| s.user.username.clone()).unwrap_or_default()
    }

    fn count(&self, f: impl Fn(&Seat) -> bool) -> usize {
        self.seats.iter().flatten().filter(|s| f(s)).count()
    }

    fn players(&self) -> usize {
        self.count(|s| !s.left)
    }

    fn next_seat(&self, from: usize, f: impl Fn(&Seat) -> bool) -> Option<usize> {
        (1..=MAX_SEATS).map(|k| (from + k) % MAX_SEATS).find(|&i| self.seats[i].as_ref().is_some_and(&f))
    }

    fn max_street(&self) -> i64 {
        self.seats.iter().flatten().filter(|s| s.in_hand).map(|s| s.street).max().unwrap_or(0)
    }

    fn pot(&self) -> i64 {
        self.seats.iter().flatten().map(Seat::committed).sum()
    }

    fn eligible(&self) -> Vec<usize> {
        (0..MAX_SEATS).filter(|&i| self.seats[i].as_ref().is_some_and(|s| !s.left && !s.stack.is_empty())).collect()
    }

    /// Karty ze stosu na stół
    fn put(&mut self, i: usize, ids: &[i64]) -> i64 {
        let street = self.phase.street();
        let s = self.seat(i);
        let mut added = 0;
        for id in ids {
            if let Some(k) = s.stack.iter().position(|c| c.id == *id) {
                let c = s.stack.remove(k);
                added += c.value;
                s.bet.push((c, street));
            }
        }
        s.street += added;
        if s.stack.is_empty() {
            s.all_in = true;
        }
        added
    }

    fn blind(&mut self, i: usize, what: &str) {
        let Some(cheap) = self.seats[i].as_ref().and_then(|s| s.stack.iter().min_by_key(|c| (c.value, c.id)).map(|c| c.id))
        else {
            return;
        };
        let v = self.put(i, &[cheap]);
        let all_in = self.seat(i).all_in;
        self.seat(i).last = Some(format!("{what}{}", if all_in { ", all-in" } else { "" }));
        let name = self.name(i);
        self.note(format!("{name}: {} ({})", what.to_lowercase(), fmt_money(v)));
    }

    fn start_hand(&mut self, now: f64) {
        let eligible = self.eligible();
        if eligible.len() < 2 {
            self.phase = Phase::Waiting;
            return;
        }
        self.hand_no += 1;
        self.board.clear();
        self.result = None;
        self.deck = new_deck();
        for i in 0..MAX_SEATS {
            if let Some(s) = self.seats[i].as_mut() {
                s.bet.clear();
                s.street = 0;
                s.hole.clear();
                s.folded = false;
                s.all_in = false;
                s.acted = false;
                s.last = None;
                s.in_hand = eligible.contains(&i);
            }
        }
        self.dealer = self.next_seat(self.dealer, |s| s.in_hand).unwrap_or(eligible[0]);
        let order: Vec<usize> = (1..=MAX_SEATS)
            .map(|k| (self.dealer + k) % MAX_SEATS)
            .filter(|&i| self.seats[i].as_ref().is_some_and(|s| s.in_hand))
            .collect();
        for _ in 0..2 {
            for &i in &order {
                let c = self.deck.pop().unwrap_or_default();
                self.seat(i).hole.push(c);
            }
        }
        let in_hand = |s: &Seat| s.in_hand;
        let (sb, bb) = if order.len() == 2 {
            (self.dealer, self.next_seat(self.dealer, in_hand).unwrap_or(self.dealer))
        } else {
            let sb = self.next_seat(self.dealer, in_hand).unwrap_or(self.dealer);
            (sb, self.next_seat(sb, in_hand).unwrap_or(sb))
        };
        self.phase = Phase::Preflop;
        self.note(format!("Rozdanie #{}: rozdaje {}", self.hand_no, self.name(self.dealer)));
        self.blind(sb, "Mała ciemna");
        self.blind(bb, "Duża ciemna");
        self.to_act = None;
        self.pick_next(bb, now);
    }

    /// Następny gracz do ruchu po `from` albo koniec ulicy
    fn pick_next(&mut self, from: usize, now: f64) {
        let max = self.max_street();
        match self.next_seat(from, |s| s.can_act() && (!s.acted || s.street < max)) {
            Some(i) => {
                self.to_act = Some(i);
                self.deadline = now + TURN_SECS;
                self.ver += 1;
            }
            None => self.end_street(now),
        }
    }

    fn deal_board(&mut self, n: usize) {
        for _ in 0..n {
            let c = self.deck.pop().unwrap_or_default();
            self.board.push(c);
        }
    }

    /// Koniec licytacji na ulicy: kolejne karty stołu albo pokazanie kart
    fn end_street(&mut self, now: f64) {
        for s in self.seats.iter_mut().flatten() {
            s.street = 0;
            s.acted = false;
        }
        self.to_act = None;
        let next = match self.phase {
            Phase::Preflop => Some((Phase::Flop, 3, "Flop")),
            Phase::Flop => Some((Phase::Turn, 1, "Turn")),
            Phase::Turn => Some((Phase::River, 1, "River")),
            _ => None,
        };
        let Some((phase, n, label)) = next else {
            self.finish(now);
            return;
        };
        self.phase = phase;
        self.deal_board(n);
        let cards = self.board[self.board.len() - n..].join(" ");
        self.note(format!("{label}: {cards}"));
        if self.count(Seat::can_act) >= 2 {
            self.pick_next(self.dealer, now);
        } else {
            // nikt już nie licytuje (all-in) - karty stołu wychodzą po kolei
            self.next_at = now + RUNOUT_SECS;
        }
    }

    /// Koniec rozdania: podział puli, karty trafiają na stosy zwycięzców
    fn finish(&mut self, now: f64) {
        let live: Vec<usize> = (0..MAX_SEATS).filter(|&i| self.seats[i].as_ref().is_some_and(Seat::live)).collect();
        let showdown = live.len() > 1;
        let mut scores: HashMap<usize, (u32, Vec<String>)> = HashMap::new();
        if showdown {
            for &i in &live {
                let s = self.seats[i].as_ref().expect("gracz");
                let cards: Vec<String> = s.hole.iter().chain(&self.board).cloned().collect();
                scores.insert(i, best_hand(&cards));
            }
        }
        let parts: Vec<usize> = (0..MAX_SEATS).filter(|&i| self.seats[i].as_ref().is_some_and(|s| s.in_hand)).collect();
        let contribs: Vec<Contrib> = parts
            .iter()
            .map(|&i| {
                let s = self.seats[i].as_ref().expect("gracz");
                Contrib {
                    chips: s.bet.iter().map(|(c, _)| c.clone()).collect(),
                    live: s.live(),
                    score: scores.get(&i).map_or(0, |x| x.0),
                }
            })
            .collect();
        let won = distribute(&contribs);
        let mut winners = vec![];
        for (k, &i) in parts.iter().enumerate() {
            let chips = won[k].clone();
            let value = sum(&chips);
            let s = self.seats[i].as_mut().expect("gracz");
            let staked: Vec<(String, String)> = s.bet.iter().map(|(c, _)| (c.person.clone(), c.variant.clone())).collect();
            let net = value - s.committed();
            self.pending.plays.push((s.uid, (net != 0).then_some(net > 0), staked));
            s.bet.clear();
            if chips.is_empty() {
                continue;
            }
            self.pending.moves.push((s.uid, chips.iter().map(|c| c.id).collect()));
            s.stack.extend(chips);
            s.sort_stack();
            s.all_in = false;
            let (hand, best) = match scores.get(&i) {
                Some((sc, best)) => (Some(hand_name(*sc).to_owned()), best.clone()),
                None => (None, vec![]),
            };
            winners.push(Winner { seat: i, user: s.user.clone(), value, hand, best });
        }
        let shown = if showdown {
            live.iter()
                .map(|&i| {
                    let (sc, best) = scores[&i].clone();
                    Shown { seat: i, hole: self.seats[i].as_ref().expect("gracz").hole.clone(), hand: hand_name(sc).to_owned(), best }
                })
                .collect()
        } else {
            vec![]
        };
        winners.sort_by_key(|w| std::cmp::Reverse(w.value));
        for w in &winners {
            let how = w.hand.as_deref().map(|h| format!(" ({h})")).unwrap_or_default();
            self.note(format!("{} bierze {}{how}", w.user.username, fmt_money(w.value)));
        }
        self.result = Some(HandResult { hand_no: self.hand_no, winners, shown, by_fold: !showdown });
        self.phase = Phase::Showdown;
        self.to_act = None;
        self.next_at = now + SHOWDOWN_SECS;
        metrics::counter!("scambox_casino_games_total", "game" => "poker", "result" => "done").increment(1);
    }

    /// Po ruchu gracza `i`
    fn after(&mut self, i: usize, now: f64) {
        if self.count(Seat::live) <= 1 {
            self.finish(now);
        } else {
            self.pick_next(i, now);
        }
    }

    fn act(&mut self, i: usize, act: &Act, now: f64) -> Result<(), String> {
        if !self.phase.betting() || self.to_act != Some(i) {
            return Err("Teraz nie twój ruch".into());
        }
        let max = self.max_street();
        let (street, stack) = {
            let s = self.seats[i].as_ref().expect("gracz");
            (s.street, s.stack.clone())
        };
        let to_call = max - street;
        let name = self.name(i);
        let (last, line) = match act {
            Act::Fold => {
                self.seat(i).folded = true;
                ("Pas".to_owned(), format!("{name}: pas"))
            }
            Act::Check if to_call > 0 => return Err(format!("Nie możesz czekać - do sprawdzenia {}", fmt_money(to_call))),
            Act::Check => ("Czeka".into(), format!("{name}: czeka")),
            Act::Call if to_call <= 0 => ("Czeka".into(), format!("{name}: czeka")),
            Act::Call => {
                let ids = auto_pick(&stack, to_call);
                let v = self.put(i, &ids);
                let all_in = self.seat(i).all_in;
                let txt = if all_in && self.seat(i).street < max { "All-in" } else { "Sprawdza" };
                (txt.into(), format!("{name}: {} ({})", txt.to_lowercase(), fmt_money(v)))
            }
            Act::Bet(ids) | Act::AllIn(ids) => {
                let ids: Vec<i64> = if matches!(act, Act::AllIn(_)) {
                    stack.iter().map(|c| c.id).collect()
                } else {
                    let mut seen = HashSet::new();
                    ids.iter().copied().filter(|id| seen.insert(*id)).collect()
                };
                if ids.is_empty() {
                    return Err("Wybierz karty ze swojego stosu".into());
                }
                if ids.iter().any(|id| !stack.iter().any(|c| c.id == *id)) {
                    return Err("Tych kart nie ma na twoim stosie".into());
                }
                let add: i64 = stack.iter().filter(|c| ids.contains(&c.id)).map(|c| c.value).sum();
                let all = ids.len() == stack.len();
                if street + add < max && !all {
                    return Err(format!(
                        "Za mało, żeby sprawdzić: brakuje {}. Dołóż karty albo idź all-in",
                        fmt_money(max - street - add)
                    ));
                }
                let v = self.put(i, &ids);
                let new = self.seat(i).street;
                let txt = if all {
                    "All-in".to_owned()
                } else if new > max && max > 0 {
                    "Podbija".to_owned()
                } else if new > max {
                    "Stawia".to_owned()
                } else {
                    "Sprawdza".to_owned()
                };
                if new > max {
                    // podbicie: pozostali muszą odpowiedzieć
                    for (k, s) in self.seats.iter_mut().enumerate() {
                        if let Some(s) = s.as_mut().filter(|_| k != i) {
                            s.acted = false;
                        }
                    }
                }
                let n = ids.len();
                (txt.clone(), format!("{name}: {} {} ({n} {})", txt.to_lowercase(), fmt_money(v), plural(n, "karta", "karty", "kart")))
            }
        };
        let s = self.seat(i);
        s.acted = true;
        s.last = Some(last);
        self.note(line);
        self.after(i, now);
        Ok(())
    }

    /// Gracz wstaje: stos wraca do ekwipunku. W trakcie rozdania pasuje, a jego postawione karty zostają w puli.
    fn stand_up(&mut self, i: usize, now: f64) {
        let Some(s) = self.seats[i].as_mut() else { return };
        let ids: Vec<i64> = s.stack.drain(..).map(|c| c.id).collect();
        let uid = s.uid;
        let name = s.user.username.clone();
        if !ids.is_empty() {
            self.pending.releases.push((uid, ids));
        }
        let betting = self.phase.betting();
        let s = self.seat(i);
        if s.in_hand && betting {
            s.left = true;
            let was_live = s.live();
            s.folded = true;
            s.last = Some("Wstał".into());
            self.note(format!("{name} wstaje od stołu"));
            if was_live {
                if self.to_act == Some(i) {
                    self.after(i, now);
                } else if self.count(Seat::live) <= 1 {
                    self.finish(now);
                }
            }
        } else {
            self.seats[i] = None;
            self.note(format!("{name} wstaje od stołu"));
        }
    }

    /// Upływ czasu: przegapiony ruch, kolejne karty przy all-in, koniec pokazu, nowe rozdanie, nieobecni gracze
    fn tick(&mut self, now: f64) {
        if self.phase.betting() {
            match self.to_act {
                Some(i) if now > self.deadline => {
                    let can_check = self.seats[i].as_ref().is_some_and(|s| s.street >= self.max_street());
                    let s = self.seat(i);
                    s.timeouts += 1;
                    let _ = self.act(i, if can_check { &Act::Check } else { &Act::Fold }, now);
                    if let Some(s) = self.seats[i].as_mut() {
                        s.last = Some(if can_check { "Czas minął, czeka" } else { "Czas minął, pas" }.into());
                    }
                }
                None if now >= self.next_at => self.end_street(now),
                _ => {}
            }
        }
        if self.phase == Phase::Showdown && now >= self.next_at {
            for i in 0..MAX_SEATS {
                let Some(s) = self.seats[i].as_mut() else { continue };
                s.in_hand = false;
                s.folded = false;
                s.all_in = false;
                s.hole.clear();
                if s.left {
                    self.seats[i] = None;
                } else if s.timeouts >= 2 {
                    let name = s.user.username.clone();
                    self.stand_up(i, now);
                    self.log.pop_front(); // zamiast zwykłego "wstaje od stołu"
                    self.note(format!("{name} nie odpowiada - wstaje od stołu"));
                }
            }
            self.phase = Phase::Waiting;
            self.next_at = now + 1.0;
            self.ver += 1;
        }
        // nieobecni (zamknięta karta) wstają, gdy nie grają w rozdaniu
        for i in 0..MAX_SEATS {
            let idle = self.seats[i].as_ref().is_some_and(|s| !s.left && now - s.seen > IDLE_SECS && !(s.live() && self.phase.betting()));
            if idle {
                self.stand_up(i, now);
            }
        }
        if self.phase == Phase::Waiting && now >= self.next_at && self.eligible().len() >= 2 {
            self.start_hand(now);
        }
    }
}

enum Act {
    Fold,
    Check,
    Call,
    Bet(Vec<i64>),
    AllIn(Vec<i64>),
}

// ---------------------------------------------------------------- stan w pamięci i baza

#[derive(Default)]
struct Poker {
    tables: HashMap<i64, Table>,
    next_id: i64,
}

impl Poker {
    fn table_of(&self, uid: i64) -> Option<i64> {
        self.tables.values().find(|t| t.seat_of(uid).is_some()).map(|t| t.id)
    }
}

static POKER: LazyLock<Mutex<Poker>> = LazyLock::new(Default::default);

/// Start serwera: stoły były w pamięci - karty przy stołach wracają do tych, do których należały
pub async fn restore(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    let n = sqlx::query(
        "UPDATE items SET user_id = pe.user_id FROM poker_escrow pe WHERE items.id = pe.item_id AND items.user_id = $1",
    )
    .bind(ESCROW)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    sqlx::query("DELETE FROM poker_escrow").execute(&mut *tx).await?;
    tx.commit().await?;
    if n > 0 {
        tracing::info!("poker: {n} kart ze stołów wróciło do graczy");
    }
    Ok(())
}

/// Zapis zmian ze stołów: karty wracają do ekwipunku, zmieniają właściciela, liczniki osiągnięć
async fn flush(c: &mut Conn, cat: &Catalog, t: &mut Table) -> sqlx::Result<()> {
    let p = std::mem::take(&mut t.pending);
    for (uid, ids) in p.releases {
        sqlx::query("DELETE FROM poker_escrow WHERE item_id = ANY($1)").bind(&ids).execute(&mut *c).await?;
        give_items(c, cat, &ids, uid, "poker").await?;
    }
    for (uid, ids) in p.moves {
        sqlx::query("UPDATE poker_escrow SET user_id = $1 WHERE item_id = ANY($2)").bind(uid).bind(&ids).execute(&mut *c).await?;
    }
    for (uid, won, staked) in p.plays {
        crate::achievements::count_casino(c, uid, "poker", won, &staked).await?;
    }
    Ok(())
}

async fn tick_all(c: &mut Conn, cat: &Catalog, pk: &mut Poker) -> sqlx::Result<()> {
    let t = now();
    for table in pk.tables.values_mut() {
        table.tick(t);
        flush(c, cat, table).await?;
    }
    pk.tables.retain(|_, t| t.players() > 0 || t.count(|s| s.left) > 0);
    Ok(())
}

/// Co sekundę: czas tury i kolejne rozdania także wtedy, gdy nikt nie odpytuje stołu
pub async fn run_ticker(st: AppState) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
    loop {
        tick.tick().await;
        let mut pk = POKER.lock().await;
        if pk.tables.is_empty() {
            continue;
        }
        let cat = st.cat();
        let res = async {
            let mut tx = st.db.begin().await?;
            tick_all(&mut tx, &cat, &mut pk).await?;
            tx.commit().await
        }
        .await;
        if let Err(e) = res {
            tracing::warn!("poker: {e:#}");
        }
    }
}

/// Usuwany gracz: wstaje od stołu, a jego stos znika razem z nim
pub async fn poker_forget_user(c: &mut Conn, cat: &Catalog, uid: i64) -> Res<()> {
    let mut pk = POKER.lock().await;
    for t in pk.tables.values_mut() {
        let Some(i) = t.seat_of(uid) else { continue };
        t.stand_up(i, now());
        let mine: Vec<i64> = t.pending.releases.iter().filter(|r| r.0 == uid).flat_map(|r| r.1.clone()).collect();
        t.pending.releases.retain(|r| r.0 != uid);
        sqlx::query("DELETE FROM items WHERE user_id = $1 AND id = ANY($2)").bind(ESCROW).bind(&mine).execute(&mut *c).await?;
        sqlx::query("DELETE FROM poker_escrow WHERE item_id = ANY($1)").bind(&mine).execute(&mut *c).await?;
        flush(c, cat, t).await?;
    }
    Ok(())
}

// ---------------------------------------------------------------- widok dla przeglądarki

#[derive(Serialize)]
struct ChipJson {
    #[serde(flatten)]
    card: CardJson,
    id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    street: Option<u8>,
}

fn chip_json(cx: &Ctx, found: &HashSet<String>, c: &Chip, street: Option<u8>) -> Option<ChipJson> {
    if !cx.cat.has(&c.person) {
        return None;
    }
    let mut card = CardJson::new(&cx.st.images, &cx.cat, &c.person, &c.variant, found);
    card.value = c.value;
    Some(ChipJson { card, id: c.id, street })
}

fn table_view(cx: &Ctx, found: &HashSet<String>, t: &Table) -> serde_json::Value {
    let me = cx.uid();
    let now = now();
    let mine = t.seat_of(me);
    let max = t.max_street();
    let shown: HashMap<usize, &Shown> = t.result.iter().flat_map(|r| r.shown.iter().map(|s| (s.seat, s))).collect();
    let seats: Vec<serde_json::Value> = t
        .seats
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let Some(s) = s else { return serde_json::Value::Null };
            let own = s.uid == me && !s.left;
            let hole: Vec<String> = if own || (t.phase == Phase::Showdown && shown.contains_key(&i)) {
                s.hole.clone()
            } else if s.in_hand && !s.folded && t.phase.betting() {
                vec!["??".into(); s.hole.len()]
            } else {
                vec![]
            };
            // aktualny układ gracza (tylko dla niego)
            let hand = if own && t.phase.betting() && !s.folded && t.board.len() >= 3 {
                let cards: Vec<String> = s.hole.iter().chain(&t.board).cloned().collect();
                Some(hand_name(best_hand(&cards).0))
            } else if own && t.phase.betting() && s.hole.len() == 2 && rank_of(&s.hole[0]) == rank_of(&s.hole[1]) {
                Some("Para")
            } else {
                shown.get(&i).map(|x| x.hand.as_str())
            };
            json!({
                "seat": i,
                "user": s.user,
                "stackCount": s.stack.len(),
                "stackValue": sum(&s.stack),
                "stack": if own { s.stack.iter().filter_map(|c| chip_json(cx, found, c, None)).collect::<Vec<_>>() } else { vec![] },
                "bet": s.bet.iter().filter_map(|(c, st)| chip_json(cx, found, c, Some(*st))).collect::<Vec<_>>(),
                "committed": s.committed(),
                "street": s.street,
                "inHand": s.in_hand,
                "folded": s.folded,
                "allIn": s.all_in,
                "left": s.left,
                "hole": hole,
                "hand": hand,
                "last": s.last,
                "away": now - s.seen > 20.0,
            })
        })
        .collect();
    let my = mine.and_then(|i| t.seats[i].as_ref());
    json!({
        "id": t.id,
        "name": t.name,
        "host": t.host,
        "phase": t.phase,
        "handNo": t.hand_no,
        "board": t.board,
        "dealer": t.dealer,
        "toAct": t.to_act,
        "timeLeft": if t.to_act.is_some() { (t.deadline - now).max(0.0) } else { 0.0 },
        "turnSecs": TURN_SECS,
        "nextIn": (t.next_at - now).max(0.0),
        "pot": t.pot(),
        "maxBet": max,
        "mySeat": mine,
        "toCall": my.map_or(0, |s| (max - s.street).max(0)),
        "canRebuy": my.is_some_and(|s| !(s.live() && t.phase.betting())),
        "seats": seats,
        "result": t.result,
        "log": t.log,
        "ver": t.ver,
        "maxBuy": MAX_BUY,
    })
}

fn table_brief(t: &Table) -> serde_json::Value {
    json!({
        "id": t.id,
        "name": t.name,
        "phase": t.phase,
        "players": t.seats.iter().flatten().filter(|s| !s.left).map(|s| &s.user).collect::<Vec<_>>(),
        "seats": MAX_SEATS,
        "pot": t.pot(),
        "stacks": t.seats.iter().flatten().map(|s| sum(&s.stack) + s.committed()).sum::<i64>(),
        "handNo": t.hand_no,
    })
}

// ---------------------------------------------------------------- adresy

/// Lobby: stoły i stół, przy którym siedzę
pub async fn poker_lobby(State(st): State<AppState>, Me(me): Me) -> Res {
    let cx = Ctx::new(st, me);
    let mut pk = POKER.lock().await;
    let mut tx = cx.st.db.begin().await?;
    tick_all(&mut tx, &cx.cat, &mut pk).await?;
    tx.commit().await?;
    let mut tables: Vec<&Table> = pk.tables.values().collect();
    tables.sort_by_key(|t| std::cmp::Reverse(t.id));
    ok(json!({
        "tables": tables.iter().map(|t| table_brief(t)).collect::<Vec<_>>(),
        "current": pk.table_of(cx.uid()),
        "maxBuy": MAX_BUY,
        "maxSeats": MAX_SEATS,
    }))
}

/// Stół (odpytywany co chwilę przez graczy i widzów)
pub async fn poker_table(State(st): State<AppState>, Me(me): Me, Path(tid): Path<i64>) -> Res {
    let cx = Ctx::new(st, me);
    let mut c = cx.st.db.acquire().await?;
    let found = discovered(&mut c, cx.uid()).await?;
    drop(c);
    let mut pk = POKER.lock().await;
    let mut tx = cx.st.db.begin().await?;
    tick_all(&mut tx, &cx.cat, &mut pk).await?;
    tx.commit().await?;
    let Some(t) = pk.tables.get_mut(&tid) else { return bad(GONE) };
    if let Some(i) = t.seat_of(cx.uid()) {
        t.seat(i).seen = now();
    }
    ok(json!({"table": table_view(&cx, &found, t)}))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct JoinRequest {
    ids: Vec<i64>,
    name: String,
    seat: Option<usize>,
}

/// Karty do stołu: z mojego ekwipunku do ESCROW (`poker_escrow` pamięta, że są moje)
async fn bring(c: &mut Conn, cx: &Ctx, tid: i64, ids: &[i64]) -> Res<Vec<Chip>> {
    if ids.is_empty() || ids.len() > MAX_BUY {
        return bad(format!("Przynieś do stołu od 1 do {MAX_BUY} kart"));
    }
    let mut uniq = ids.to_vec();
    uniq.sort_unstable();
    uniq.dedup();
    let rows = take_my_items(c, &cx.cat, cx.uid(), &uniq, Use::Stake).await?;
    escrow_items(c, cx.uid(), &uniq).await?;
    sqlx::query("INSERT INTO poker_escrow (item_id, user_id, table_id) SELECT i, $2, $3 FROM UNNEST($1::bigint[]) AS i ON CONFLICT (item_id) DO UPDATE SET user_id = excluded.user_id, table_id = excluded.table_id")
        .bind(&uniq)
        .bind(cx.uid())
        .bind(tid)
        .execute(&mut *c)
        .await?;
    Ok(rows.iter().map(|r| Chip { id: r.id, person: r.person_id.clone(), variant: r.variant.clone(), value: row_value(&cx.cat, r) }).collect())
}

async fn reply(cx: &Ctx, t: &Table, with_items: bool) -> Res {
    let mut c = cx.st.db.acquire().await?;
    let found = discovered(&mut c, cx.uid()).await?;
    let mut out = json!({"table": table_view(cx, &found, t)});
    if with_items {
        out["items"] = serde_json::to_value(my_items(&mut c, &cx.cat, cx.uid()).await?).unwrap_or_default();
        out["state"] = serde_json::to_value(get_state(&mut c, cx.uid()).await?).unwrap_or_default();
    }
    ok(out)
}

/// Nowy stół - zakładający od razu siada z wybranymi kartami
pub async fn poker_create(State(st): State<AppState>, Me(me): Me, JsonBody(req): JsonBody<JoinRequest>) -> Res {
    let cx = Ctx::new(st, me);
    let mut pk = POKER.lock().await;
    if pk.table_of(cx.uid()).is_some() {
        return bad("Siedzisz już przy stole - najpierw od niego wstań");
    }
    if pk.tables.len() >= MAX_TABLES {
        return bad("Wszystkie stoły są zajęte - dosiądź się do któregoś");
    }
    pk.next_id += 1;
    let tid = pk.next_id;
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let chips = bring(&mut tx, &cx, tid, &req.ids).await?;
    tx.commit().await?;
    let name: String = req.name.trim().chars().take(30).collect();
    let name = if name.is_empty() { format!("Stół {}", cx.me.username) } else { name };
    let now = now();
    let mut t = Table::new(tid, name, cx.uid(), now);
    let mut seat = Seat::new(cx.me.view(&cx.cat), chips, now);
    seat.sort_stack();
    t.seats[0] = Some(seat);
    t.note(format!("{} zakłada stół", cx.me.username));
    let out = reply(&cx, &t, true).await;
    pk.tables.insert(tid, t);
    out
}

/// Dosiadam się do stołu z wybranymi kartami
pub async fn poker_join(State(st): State<AppState>, Me(me): Me, Path(tid): Path<i64>, JsonBody(req): JsonBody<JoinRequest>) -> Res {
    let cx = Ctx::new(st, me);
    let mut pk = POKER.lock().await;
    if pk.table_of(cx.uid()).is_some() {
        return bad("Siedzisz już przy stole - najpierw od niego wstań");
    }
    let Some(t) = pk.tables.get_mut(&tid) else { return bad(GONE) };
    let free: Vec<usize> = (0..MAX_SEATS).filter(|&i| t.seats[i].is_none()).collect();
    let Some(seat_no) = req.seat.filter(|s| free.contains(s)).or(free.first().copied()) else {
        return bad("Przy tym stole nie ma już miejsc");
    };
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let chips = bring(&mut tx, &cx, tid, &req.ids).await?;
    tx.commit().await?;
    let now = now();
    let mut seat = Seat::new(cx.me.view(&cx.cat), chips, now);
    seat.sort_stack();
    t.seats[seat_no] = Some(seat);
    t.note(format!("{} siada do stołu", cx.me.username));
    if t.phase == Phase::Waiting {
        t.next_at = t.next_at.max(now + START_SECS);
    }
    reply(&cx, t, true).await
}

/// Dokładam karty na stos (gdy nie gram w trwającym rozdaniu)
pub async fn poker_rebuy(State(st): State<AppState>, Me(me): Me, Path(tid): Path<i64>, JsonBody(req): JsonBody<JoinRequest>) -> Res {
    let cx = Ctx::new(st, me);
    let mut pk = POKER.lock().await;
    let Some(t) = pk.tables.get_mut(&tid) else { return bad(GONE) };
    let Some(i) = t.seat_of(cx.uid()) else { return bad("Nie siedzisz przy tym stole") };
    if t.seats[i].as_ref().is_some_and(|s| s.live() && t.phase.betting()) {
        return bad("Karty dołożysz po tym rozdaniu");
    }
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    let chips = bring(&mut tx, &cx, tid, &req.ids).await?;
    tx.commit().await?;
    let n = chips.len();
    let v = sum(&chips);
    let s = t.seat(i);
    s.stack.extend(chips);
    s.sort_stack();
    s.seen = now();
    t.note(format!("{} dokłada {n} {} ({})", cx.me.username, plural(n, "kartę", "karty", "kart"), fmt_money(v)));
    if t.phase == Phase::Waiting {
        t.next_at = t.next_at.max(now() + 1.5);
    }
    reply(&cx, t, true).await
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ActRequest {
    kind: String,
    ids: Vec<i64>,
}

/// Ruch: fold / check / call / bet (wybrane karty) / allin
pub async fn poker_act(State(st): State<AppState>, Me(me): Me, Path(tid): Path<i64>, JsonBody(req): JsonBody<ActRequest>) -> Res {
    let cx = Ctx::new(st, me);
    let mut pk = POKER.lock().await;
    let Some(t) = pk.tables.get_mut(&tid) else { return bad(GONE) };
    let now = now();
    t.tick(now);
    let Some(i) = t.seat_of(cx.uid()) else { return bad("Nie siedzisz przy tym stole") };
    let act = match req.kind.as_str() {
        "fold" => Act::Fold,
        "check" => Act::Check,
        "call" => Act::Call,
        "bet" => Act::Bet(req.ids),
        "allin" => Act::AllIn(vec![]),
        _ => return bad("Nieznany ruch"),
    };
    let res = t.act(i, &act, now);
    if let Some(s) = t.seats[i].as_mut() {
        s.seen = now;
        s.timeouts = 0;
    }
    let mut tx = cx.st.db.begin().await?;
    flush(&mut tx, &cx.cat, t).await?;
    tx.commit().await?;
    if let Err(e) = res {
        return bad(e);
    }
    reply(&cx, t, false).await
}

/// Wstaję od stołu: stos wraca do ekwipunku (karty już postawione w rozdaniu zostają w puli)
pub async fn poker_leave(State(st): State<AppState>, Me(me): Me, Path(tid): Path<i64>) -> Res {
    let cx = Ctx::new(st, me);
    let mut pk = POKER.lock().await;
    let Some(t) = pk.tables.get_mut(&tid) else { return bad(GONE) };
    let Some(i) = t.seat_of(cx.uid()) else { return bad("Nie siedzisz przy tym stole") };
    let mut tx = cx.st.db.begin().await?;
    lock_me(&mut tx, cx.uid()).await?;
    t.stand_up(i, now());
    flush(&mut tx, &cx.cat, t).await?;
    tx.commit().await?;
    let mut c = cx.st.db.acquire().await?;
    let items = my_items(&mut c, &cx.cat, cx.uid()).await?;
    let state = get_state(&mut c, cx.uid()).await?;
    pk.tables.retain(|_, t| t.players() > 0 || t.count(|s| s.left) > 0);
    ok(json!({"ok": true, "items": items, "state": state}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(cards: &str) -> u32 {
        let v: Vec<String> = cards.split(' ').map(str::to_owned).collect();
        best_hand(&v).0
    }

    fn chip(id: i64, value: i64) -> Chip {
        Chip { id, person: "p".into(), variant: "normal".into(), value }
    }

    #[test]
    fn hand_ranking() {
        assert_eq!(hand_name(s("AS KS QS JS TS 2D 3C")), "Poker królewski");
        assert_eq!(hand_name(s("5S 4S 3S 2S AS KD KC")), "Poker");
        assert_eq!(hand_name(s("9S 9H 9D 9C 2S 3D 4C")), "Kareta");
        assert_eq!(hand_name(s("9S 9H 9D 2C 2S 3D 4C")), "Full");
        assert_eq!(hand_name(s("2H 7H 9H JH KH 3D 4C")), "Kolor");
        assert_eq!(hand_name(s("AS 2H 3D 4C 5S 9D KC")), "Strit");
        assert_eq!(hand_name(s("7S 7H 7D 2C 9S 3D KC")), "Trójka");
        assert_eq!(hand_name(s("7S 7H 2D 2C 9S 3D KC")), "Dwie pary");
        assert_eq!(hand_name(s("7S 7H 2D 4C 9S 3D KC")), "Para");
        assert_eq!(hand_name(s("7S 8H 2D 4C 9S 3D KC")), "Wysoka karta");
        // strit od szóstki bije strit od piątki (koło), kolor bije strit, kicker rozstrzyga parę
        assert!(s("2S 3H 4D 5C 6S 9D KC") > s("AS 2H 3D 4C 5S 9D KC"));
        assert!(s("2H 7H 9H JH KH 3D 4C") > s("2S 3H 4D 5C 6S 9D KC"));
        assert!(s("AS AH KD 4C 9S 3D 2C") > s("AS AH QD 4C 9S 3D 2C"));
        assert_eq!(s("AS AH KD 4C 9S 3D 2C"), s("AC AD KH 4D 9H 3S 2S"));
        // full: liczy się najpierw trójka
        assert!(s("3S 3H 3D 2C 2S") > s("2S 2H 2D AC AS"));
    }

    #[test]
    fn auto_pick_cards() {
        let stack = vec![chip(1, 100), chip(2, 50), chip(3, 10), chip(4, 300)];
        assert_eq!(auto_pick(&stack, 40), vec![2]);
        assert_eq!(auto_pick(&stack, 120), vec![4]);
        assert_eq!(auto_pick(&stack, 350), vec![4, 2]);
        assert_eq!(auto_pick(&stack, 10_000).len(), 4);
    }

    #[test]
    fn side_pots() {
        // A all-in za 100, B i C po 300; A ma najlepszą rękę, B drugą
        let cs = vec![
            Contrib { chips: vec![chip(1, 100)], live: true, score: 30 },
            Contrib { chips: vec![chip(2, 100), chip(3, 200)], live: true, score: 20 },
            Contrib { chips: vec![chip(4, 300)], live: true, score: 10 },
        ];
        let won = distribute(&cs);
        let val = |k: usize| sum(&won[k]);
        assert_eq!(val(0) + val(1) + val(2), 700);
        assert_eq!(val(2), 0);
        assert!(val(0) >= 100 && val(0) <= 400, "A bierze tylko z puli głównej: {}", val(0));
        // spasowany nie wygrywa, a nadwyżka bez sprawdzenia wraca do stawiającego
        let cs = vec![
            Contrib { chips: vec![chip(1, 50)], live: false, score: 0 },
            Contrib { chips: vec![chip(2, 500)], live: true, score: 0 },
        ];
        let won = distribute(&cs);
        assert_eq!(sum(&won[1]), 550);
        assert!(won[0].is_empty());
    }

    #[test]
    fn heads_up_hand() {
        let user = |id: i64| UserView { id, username: format!("u{id}"), avatar: String::new(), is_admin: false, avatar_card: None, avatar_rarity: None, avatar_variant: None };
        let mut t = Table::new(1, "t".into(), 1, 0.0);
        t.seats[0] = Some(Seat::new(user(1), vec![chip(1, 10), chip(2, 100)], 0.0));
        t.seats[3] = Some(Seat::new(user(2), vec![chip(3, 20), chip(4, 100)], 0.0));
        t.tick(10.0);
        assert_eq!(t.phase, Phase::Preflop);
        let first = t.to_act.unwrap();
        assert_eq!(first, t.dealer, "heads-up: przed flopem pierwszy rusza się rozdający (mała ciemna)");
        t.act(first, &Act::Fold, 11.0).unwrap();
        assert_eq!(t.phase, Phase::Showdown);
        let r = t.result.as_ref().unwrap();
        assert!(r.by_fold);
        assert_eq!(r.winners[0].value, 30);
        // 4 karty łącznie nadal przy stole
        let total: usize = t.seats.iter().flatten().map(|s| s.stack.len()).sum();
        assert_eq!(total, 4);
    }
}
