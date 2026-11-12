//! Super Turbo Snake 3D po stronie serwera: port `web/src/features/snake/core3d.ts` (ten sam porządek działań i losowań).
//! Serwer odtwarza grę z ziarna i zapisu skrętów, sam liczy zjedzone kule i najkrótszy możliwy czas gry (każdy krok najwyżej
//! z prędkością turbo). Zmieniając rdzeń w jednym miejscu, zmień go w drugim i odtwórz nagrania
//! (`node web/scripts/snake-fixture.mjs`, test `cargo test snake3d_sim`).

use crate::det::Rng;

const N: i32 = 22;
const BOOST_MULT: f64 = 1.85;
const GOLD_TICKS: i32 = 45;
const MAX_TICKS: u64 = 400_000;
const MAX_EVENTS: usize = 200_000;

pub struct Outcome {
    /// zjedzone kule (zwykłe i złote)
    pub foods: i64,
    pub ticks: u64,
    /// najkrótszy możliwy czas gry w sekundach
    pub min_secs: f64,
}

#[derive(Clone, Copy, PartialEq)]
struct Cell {
    x: i32,
    z: i32,
}

struct Food {
    cell: Cell,
    active: bool,
    life: i32,
}

fn speed_of(foods: i64) -> f64 {
    (5.0 + foods as f64 * 0.17).min(12.5)
}

struct Sim {
    rng: Rng,
    cells: Vec<Cell>,
    dir: Cell,
    pending: i32,
    food: Food,
    gold: Food,
    foods: i64,
}

impl Sim {
    fn occupied(&self, x: i32, z: i32) -> bool {
        self.cells.iter().any(|c| c.x == x && c.z == z)
    }

    /// `spawn` z core3d.ts: `gold` = złota kula, inaczej zwykła
    fn spawn(&mut self, gold: bool) -> bool {
        let h = self.cells[0];
        for _ in 0..800 {
            let x = (self.rng.next() * N as f64) as i32;
            let z = (self.rng.next() * N as f64) as i32;
            if self.occupied(x, z) {
                continue;
            }
            let other = if gold { &self.food } else { &self.gold };
            if other.active && other.cell.x == x && other.cell.z == z {
                continue;
            }
            if (x - h.x).abs() + (z - h.z).abs() < 3 {
                continue;
            }
            let f = if gold { &mut self.gold } else { &mut self.food };
            f.cell = Cell { x, z };
            f.active = true;
            return true;
        }
        if gold { self.gold.active = false } else { self.food.active = false }
        false
    }

    /// false = zderzenie
    fn tick(&mut self) -> bool {
        if self.gold.active {
            self.gold.life -= 1;
            if self.gold.life <= 0 {
                self.gold.active = false;
            }
        }
        let h = self.cells[0];
        let n = Cell { x: h.x + self.dir.x, z: h.z + self.dir.z };
        let eat_f = self.food.active && self.food.cell == n;
        let eat_g = self.gold.active && self.gold.cell == n;
        let grow = self.pending > 0 || eat_f || eat_g;
        let mut hit = n.x < 0 || n.z < 0 || n.x >= N || n.z >= N;
        if !hit {
            let lim = if grow { self.cells.len() } else { self.cells.len() - 1 };
            hit = self.cells[..lim].contains(&n);
        }
        if hit {
            return false;
        }
        self.cells.insert(0, n);
        if eat_f {
            self.pending += 1;
        }
        if eat_g {
            self.pending += 3;
        }
        if self.pending > 0 {
            self.pending -= 1;
        } else {
            self.cells.pop();
        }
        if eat_f {
            self.foods += 1;
            self.spawn(false);
            if !self.gold.active && self.foods > 2 && self.rng.next() < 0.22 && self.spawn(true) {
                self.gold.life = GOLD_TICKS;
            }
        }
        if eat_g {
            self.foods += 1;
            self.gold.active = false;
        }
        true
    }
}

/// Odtwarza grę: `log` = naprzemiennie numer kroku i skręt (1 = w prawo, 0 = w lewo). None = zapis nie do przyjęcia.
pub fn replay(seed: u32, log: &[u64]) -> Option<Outcome> {
    if !log.len().is_multiple_of(2) || log.len() / 2 > MAX_EVENTS {
        return None;
    }
    let (sx, sz) = (N / 2, N / 2 + 3);
    let mut s = Sim {
        rng: Rng::new(seed),
        cells: (0..4).map(|i| Cell { x: sx, z: sz + i }).collect(),
        dir: Cell { x: 0, z: -1 },
        pending: 0,
        food: Food { cell: Cell { x: -1, z: -1 }, active: false, life: 0 },
        gold: Food { cell: Cell { x: -1, z: -1 }, active: false, life: 0 },
        foods: 0,
    };
    s.spawn(false);
    let (mut ticks, mut min_secs, mut ev) = (0u64, 0.0f64, 0usize);
    loop {
        while ev < log.len() && log[ev] == ticks {
            let d = s.dir;
            s.dir = match log[ev + 1] {
                1 => Cell { x: -d.z, z: d.x },
                0 => Cell { x: d.z, z: -d.x },
                _ => return None,
            };
            ev += 2;
        }
        if ev < log.len() && log[ev] < ticks {
            return None;
        }
        min_secs += 1.0 / (speed_of(s.foods) * BOOST_MULT);
        if !s.tick() {
            break;
        }
        ticks += 1;
        if ticks > MAX_TICKS {
            return None;
        }
    }
    Some(Outcome { foods: s.foods, ticks, min_secs })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Rec {
        seed: u32,
        log: Vec<u64>,
        foods: i64,
        ticks: u64,
    }

    #[test]
    fn server_replays_match_the_browser() {
        let fixtures: Vec<Rec> = serde_json::from_str(include_str!("../tests/fixtures/snake3d_replays.json")).unwrap();
        assert!(!fixtures.is_empty());
        for f in fixtures {
            let o = replay(f.seed, &f.log).expect("zapis");
            assert_eq!((o.foods, o.ticks), (f.foods, f.ticks), "ziarno {}", f.seed);
        }
    }

    #[test]
    fn going_straight_hits_the_wall() {
        let o = replay(3, &[]).unwrap();
        assert_eq!(o.ticks, 14); // z = 14 do ściany z = -1
        assert!(replay(3, &[2, 5]).is_none());
    }
}
