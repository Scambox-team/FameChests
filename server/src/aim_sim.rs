//! Strzelnica po stronie serwera: odtwarza rundę z ziarna i zapisu strzałów i sam liczy punkty (wynik z przeglądarki nie jest
//! brany na słowo). Port `web/src/features/aim/core.ts` bit w bit: ten sam stały krok, ten sam generator `Rng`, te same
//! działania w tej samej kolejności. Zmieniając rdzeń w jednym miejscu, zmień go w drugim i odtwórz nagrania
//! (`node web/scripts/aim-fixture.mjs`, test `cargo test aim_sim`).

const AW: f64 = 800.0;
const AH: f64 = 500.0;
pub const TICK: f64 = 1.0 / 60.0;
pub const ROUND_TICKS: u32 = 2700;
const COOLDOWN: i64 = 12;
const AIM_SLACK: f64 = 4.0;
const GOLD_CHANCE: f64 = 0.12;
const GOLD_POINTS: i64 = 100;
/// Najwięcej strzałów w zapisie jednej rundy (przy przerwie 12 ticków i 2700 tickach realnie ~225)
pub const MAX_SHOTS: usize = 400;

struct Row {
    y: f64,
    r: f64,
    v: f64,
    dir: f64,
    pts: i64,
    gap_min: f64,
    gap_max: f64,
}
const ROWS: [Row; 3] = [
    Row { y: 168.0, r: 20.0, v: 170.0, dir: 1.0, pts: 30, gap_min: 0.9, gap_max: 1.9 },
    Row { y: 282.0, r: 26.0, v: 120.0, dir: -1.0, pts: 20, gap_min: 1.0, gap_max: 2.1 },
    Row { y: 396.0, r: 34.0, v: 85.0, dir: 1.0, pts: 10, gap_min: 1.2, gap_max: 2.4 },
];

/// mulberry32 (jak `Rng` w core.ts)
struct Rng(u32);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6D2B79F5);
        let a = self.0;
        let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        f64::from(t ^ (t >> 14)) / 4294967296.0
    }
}

struct Duck {
    row: usize,
    x: f64,
    y: f64,
    r: f64,
    v: f64,
    dir: f64,
    pts: i64,
}

struct Sim {
    rng: Rng,
    tick: u32,
    over: bool,
    ducks: Vec<Duck>,
    next: Vec<f64>,
    score: i64,
    hits: i64,
    shots: i64,
    streak: i64,
    last_shot: i64,
}

impl Sim {
    fn new(seed: u32) -> Sim {
        Sim { rng: Rng(seed), tick: 0, over: false, ducks: vec![], next: vec![], score: 0, hits: 0, shots: 0, streak: 0, last_shot: -1000 }
    }

    fn spawn(&mut self, row: usize, x: f64) {
        let r = &ROWS[row];
        let gold = self.rng.next() < GOLD_CHANCE;
        self.ducks.push(Duck {
            row,
            x,
            y: r.y,
            r: if gold { r.r * 0.8 } else { r.r },
            v: if gold { r.v * 1.8 } else { r.v },
            dir: r.dir,
            pts: if gold { GOLD_POINTS } else { r.pts },
        });
    }

    fn start(&mut self) {
        for row in 0..ROWS.len() {
            let r = &ROWS[row];
            let step = r.v * 1.4;
            let mut x = 30.0 + self.rng.next() * 40.0;
            while x < AW {
                self.spawn(row, if r.dir > 0.0 { x } else { AW - x });
                x += step + self.rng.next() * 60.0;
            }
            let gap = r.gap_min + self.rng.next() * (r.gap_max - r.gap_min);
            self.next.push(gap);
        }
    }

    fn mult(&self) -> i64 {
        5.min(1 + self.streak / 3)
    }

    fn shoot(&mut self, x: f64, y: f64) {
        if self.over || i64::from(self.tick) - self.last_shot < COOLDOWN {
            return;
        }
        self.last_shot = i64::from(self.tick);
        self.shots += 1;
        for row in (0..ROWS.len()).rev() {
            for i in 0..self.ducks.len() {
                let d = &self.ducks[i];
                if d.row != row {
                    continue;
                }
                let (dx, dy) = (x - d.x, y - d.y);
                let rr = d.r + AIM_SLACK;
                if dx * dx + dy * dy <= rr * rr {
                    let pts = d.pts;
                    self.ducks.remove(i);
                    self.streak += 1;
                    self.hits += 1;
                    self.score += pts * self.mult();
                    return;
                }
            }
        }
        self.streak = 0;
    }

    fn step(&mut self) {
        if self.over {
            return;
        }
        self.tick += 1;
        let dt = TICK;
        for d in &mut self.ducks {
            d.x += d.dir * d.v * dt;
        }
        self.ducks.retain(|d| if d.dir > 0.0 { d.x < AW + d.r + 5.0 } else { d.x > -d.r - 5.0 });
        for row in 0..ROWS.len() {
            self.next[row] -= dt;
            if self.next[row] <= 0.0 {
                let r = &ROWS[row];
                self.spawn(row, if r.dir > 0.0 { -r.r - 4.0 } else { AW + r.r + 4.0 });
                self.next[row] = r.gap_min + self.rng.next() * (r.gap_max - r.gap_min);
            }
        }
        if self.tick >= ROUND_TICKS {
            self.over = true;
        }
    }
}

/// Wynik odtworzenia rundy
pub struct Outcome {
    pub score: i64,
    pub hits: i64,
    pub shots: i64,
}

/// Odtwarza rundę z ziarna i zapisu strzałów (`log` = po trzy liczby: tick, x, y). None = zapis nieprawidłowy.
pub fn replay(seed: u32, log: &[i64]) -> Option<Outcome> {
    if log.len() % 3 != 0 || log.len() / 3 > MAX_SHOTS {
        return None;
    }
    let mut shots = Vec::with_capacity(log.len() / 3);
    let mut last = 0i64;
    for s in log.chunks(3) {
        let (t, x, y) = (s[0], s[1], s[2]);
        if t < last || t > i64::from(ROUND_TICKS) || !(0.0..=AW).contains(&(x as f64)) || !(0.0..=AH).contains(&(y as f64)) {
            return None;
        }
        last = t;
        shots.push((t, x as f64, y as f64));
    }
    let mut sim = Sim::new(seed);
    sim.start();
    let mut idx = 0;
    while !sim.over {
        while idx < shots.len() && shots[idx].0 == i64::from(sim.tick) {
            sim.shoot(shots[idx].1, shots[idx].2);
            idx += 1;
        }
        sim.step();
    }
    // strzały zapisane na samym końcu rundy (tick == ROUND_TICKS) po ostatnim kroku już się nie liczą
    Some(Outcome { score: sim.score, hits: sim.hits, shots: sim.shots })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[test]
    fn rejects_bad_logs() {
        assert!(replay(1, &[0, 10]).is_none());
        assert!(replay(1, &[5, 10, 10, 3, 10, 10]).is_none());
        assert!(replay(1, &[0, 900, 10]).is_none());
        assert!(replay(1, &[0, 10, 10]).is_some());
    }

    #[test]
    fn empty_round_scores_nothing() {
        let o = replay(7, &[]).unwrap();
        assert_eq!((o.score, o.hits, o.shots), (0, 0, 0));
    }

    /// Nagrania botów z przeglądarki (rdzeń core.ts) muszą dać na serwerze dokładnie ten sam wynik, trafienia i strzały
    #[test]
    fn server_replays_match_the_browser() {
        #[derive(Deserialize)]
        struct Rec {
            seed: u32,
            log: Vec<i64>,
            score: i64,
            hits: i64,
            shots: i64,
        }
        let fixtures: Vec<Rec> = serde_json::from_str(include_str!("../tests/fixtures/aim_replays.json")).unwrap();
        assert!(!fixtures.is_empty());
        for f in fixtures {
            let o = replay(f.seed, &f.log).expect("zapis");
            assert_eq!((o.score, o.hits, o.shots), (f.score, f.hits, f.shots), "ziarno {}", f.seed);
            assert!(f.hits > 0, "bot powinien coś trafić");
        }
    }
}
