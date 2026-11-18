//! Super Turbo AIMPULSE 3D po stronie serwera: port `web/src/features/turbo/aimCore.ts` bit w bit (ten sam stały krok,
//! te same losowania w tej samej kolejności, tylko + - * / sqrt floor). Serwer odtwarza rundę z ziarna, poziomu, czasu i
//! zapisu strzałów (krok, kierunek ×1e6) i sam liczy punkty. Zmieniając rdzeń w jednym miejscu, zmień go w drugim i odtwórz
//! nagrania (`node web/scripts/aimpulse-fixture.mjs`, test `cargo test aimpulse_sim`).

use crate::det::Rng;

pub const DURS: [u32; 3] = [30, 60, 120];
const SHOT_GAP: i64 = 4;
/// najwięcej strzałów w zapisie (120 s, co 4 kroki)
const MAX_SHOTS: usize = 120 * 60 / 4 + 1;
const EYE: (f64, f64, f64) = (0.0, 1.7, 8.0);

struct Diff {
    radius: f64,
    life: f64,
    max_good: usize,
    gap: (f64, f64),
    bad_every: (f64, f64),
    max_bad: usize,
    bad_life: f64,
    gold: f64,
}

static DIFFS: [Diff; 3] = [
    Diff { radius: 0.82, life: 3.0, max_good: 3, gap: (0.22, 0.55), bad_every: (2.6, 4.2), max_bad: 1, bad_life: 3.2, gold: 0.05 },
    Diff { radius: 0.62, life: 2.3, max_good: 3, gap: (0.14, 0.42), bad_every: (1.5, 2.8), max_bad: 2, bad_life: 2.8, gold: 0.07 },
    Diff { radius: 0.46, life: 1.6, max_good: 4, gap: (0.08, 0.30), bad_every: (0.9, 1.8), max_bad: 3, bad_life: 2.6, gold: 0.09 },
];

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Good,
    Bad,
    Gold,
}

#[derive(Clone, Copy)]
struct Spot {
    u: f64,
    v: f64,
    dist: f64,
    ang: f64,
    dx: f64,
    dy: f64,
    dz: f64,
    x: f64,
    y: f64,
    z: f64,
}

struct Target {
    kind: Kind,
    s: Spot,
    hit_r: f64,
    life: i64,
    age: i64,
}

pub struct Outcome {
    pub score: i64,
    pub hits: i64,
    pub shots: i64,
}

fn clamp(v: f64, a: f64, b: f64) -> f64 {
    if v < a {
        a
    } else if v > b {
        b
    } else {
        v
    }
}

fn range(rng: &mut Rng, a: f64, b: f64) -> f64 {
    a + rng.next() * (b - a)
}

struct Sim {
    d: &'static Diff,
    total: i64,
    tick: i64,
    over: bool,
    score: i64,
    combo: i64,
    shots: i64,
    hits: i64,
    targets: Vec<Target>,
    spawn_t: i64,
    bad_t: i64,
    last_shot: i64,
    rng: Rng,
}

impl Sim {
    fn new(seed: u32, diff: usize, dur: u32) -> Sim {
        let mut rng = Rng::new(seed);
        let bad_t = (range(&mut rng, 1.5, 3.0) * 60.0).floor() as i64;
        Sim {
            d: &DIFFS[diff],
            total: i64::from(dur) * 60,
            tick: 0,
            over: false,
            score: 0,
            combo: 0,
            shots: 0,
            hits: 0,
            targets: vec![],
            spawn_t: 6,
            bad_t,
            last_shot: -1000,
            rng,
        }
    }

    fn make_spot(&self, u: f64, v: f64, dist: f64, r: f64) -> Option<Spot> {
        let len = (u * u + v * v + 1.0).sqrt();
        let (dx, dy, dz, ang) = (u / len, v / len, -1.0 / len, r / dist);
        for t in &self.targets {
            let (ex, ey, ez) = (dx - t.s.dx, dy - t.s.dy, dz - t.s.dz);
            if (ex * ex + ey * ey + ez * ez).sqrt() < (ang + t.s.ang) * 1.3 + 0.012 {
                return None;
            }
        }
        Some(Spot { u, v, dist, ang, dx, dy, dz, x: EYE.0 + dx * dist, y: EYE.1 + dy * dist, z: EYE.2 + dz * dist })
    }

    fn pick_spot(&mut self, r: f64) -> Option<Spot> {
        for _ in 0..30 {
            let u = range(&mut self.rng, -0.62, 0.62);
            let v = range(&mut self.rng, -0.13, 0.40);
            let d = range(&mut self.rng, 12.0, 17.0);
            if let Some(s) = self.make_spot(u, v, d, r) {
                return Some(s);
            }
        }
        None
    }

    fn spot_near(&mut self, r: f64) -> Option<Spot> {
        let c: Vec<Spot> = self.targets.iter().filter(|t| t.kind != Kind::Bad).map(|t| t.s).collect();
        if c.is_empty() {
            return None;
        }
        let b = c[(self.rng.next() * c.len() as f64).floor() as usize];
        for _ in 0..10 {
            let dist = clamp(b.dist + range(&mut self.rng, -1.5, 1.5), 11.5, 17.5);
            let off = (r / dist + b.ang) * range(&mut self.rng, 1.5, 2.6) + 0.012;
            let mut cx = range(&mut self.rng, -1.0, 1.0);
            let mut cy = range(&mut self.rng, -1.0, 1.0);
            let l = (cx * cx + cy * cy).sqrt();
            if l < 0.001 {
                cx = 1.0;
                cy = 0.0;
            } else {
                cx /= l;
                cy /= l;
            }
            if let Some(s) = self.make_spot(clamp(b.u + cx * off, -0.64, 0.64), clamp(b.v + cy * off, -0.15, 0.42), dist, r) {
                return Some(s);
            }
        }
        None
    }

    fn spawn(&mut self, kind: Kind) {
        let d = self.d;
        let r = d.radius
            * match kind {
                Kind::Gold => 0.62,
                Kind::Bad => 0.9,
                Kind::Good => 1.0,
            };
        let mut spot = None;
        if kind == Kind::Bad && self.rng.next() < 0.6 {
            spot = self.spot_near(r);
        }
        if spot.is_none() {
            spot = self.pick_spot(r);
        }
        let Some(s) = spot else { return };
        let prog = self.tick as f64 / self.total as f64;
        let life = match kind {
            Kind::Gold => d.life * 0.62,
            Kind::Bad => d.bad_life * range(&mut self.rng, 0.8, 1.15),
            Kind::Good => d.life * (1.0 - 0.22 * prog),
        };
        let hit_r = r * match kind {
            Kind::Good => 1.05,
            Kind::Bad => 1.0,
            Kind::Gold => 0.95,
        };
        self.targets.push(Target { kind, s, hit_r, life: 1.max((life * 60.0).floor() as i64), age: 0 });
    }

    fn next_gap(&mut self) {
        let g = (range(&mut self.rng, self.d.gap.0, self.d.gap.1) * 60.0).floor() as i64;
        self.spawn_t = self.spawn_t.max(g);
    }

    fn step(&mut self) {
        if self.over {
            return;
        }
        self.tick += 1;
        if self.tick >= self.total {
            self.over = true;
            return;
        }
        let mut i = 0;
        while i < self.targets.len() {
            self.targets[i].age += 1;
            if self.targets[i].age < self.targets[i].life {
                i += 1;
                continue;
            }
            let t = self.targets.remove(i);
            if t.kind == Kind::Good {
                self.combo = 0;
                self.next_gap();
            }
        }
        let d = self.d;
        let bad = self.targets.iter().filter(|t| t.kind == Kind::Bad).count();
        let good = self.targets.len() - bad;
        self.spawn_t -= 1;
        if self.spawn_t <= 0 && good < d.max_good {
            let roll = self.rng.next();
            self.spawn(if roll < d.gold && self.tick > 180 { Kind::Gold } else { Kind::Good });
            self.spawn_t = (range(&mut self.rng, d.gap.0, d.gap.1) * 60.0).floor() as i64;
        }
        self.bad_t -= 1;
        if self.bad_t <= 0 {
            if bad < d.max_bad {
                self.spawn(Kind::Bad);
            }
            self.bad_t = (range(&mut self.rng, d.bad_every.0, d.bad_every.1) * 60.0).floor() as i64;
        }
    }

    /// false = strzał nie do przyjęcia (za szybko, po końcu rundy, zerowy kierunek)
    fn shoot(&mut self, qx: i64, qy: i64, qz: i64) -> bool {
        if self.over || self.tick - self.last_shot < SHOT_GAP {
            return false;
        }
        let (fx, fy, fz) = (qx as f64, qy as f64, qz as f64);
        let len = (fx * fx + fy * fy + fz * fz).sqrt();
        if len == 0.0 {
            return false;
        }
        self.last_shot = self.tick;
        self.shots += 1;
        let (dx, dy, dz) = (fx / len, fy / len, fz / len);
        let (mut best, mut best_t, mut best_d) = (None, f64::INFINITY, 0.0);
        for (k, t) in self.targets.iter().enumerate() {
            let (vx, vy, vz) = (t.s.x - EYE.0, t.s.y - EYE.1, t.s.z - EYE.2);
            let tca = vx * dx + vy * dy + vz * dz;
            if tca <= 0.0 {
                continue;
            }
            let d2 = vx * vx + vy * vy + vz * vz - tca * tca;
            let r = t.hit_r;
            if d2 <= r * r {
                let th = tca - (r * r - d2).sqrt();
                if th < best_t {
                    best_t = th;
                    best = Some(k);
                    best_d = d2.max(0.0).sqrt() / r;
                }
            }
        }
        let Some(k) = best else {
            self.combo = 0;
            return true;
        };
        let t = self.targets.remove(k);
        if t.kind == Kind::Bad {
            self.score = (self.score - 300).max(0);
            self.combo = 0;
            return true;
        }
        let base = if t.kind == Kind::Gold {
            500
        } else {
            let b = 100 + (200 * (t.life - t.age) + t.life) / (2 * t.life);
            if best_d < 0.38 {
                b + 50
            } else {
                b
            }
        };
        self.score += (base * (10 + self.combo.min(30)) + 25) / 50 * 5;
        self.hits += 1;
        self.combo += 1;
        self.next_gap();
        true
    }
}

/// Odtwarza rundę: `log` = po cztery liczby (krok, x, y, z kierunku ×1e6). None = zapis nie do przyjęcia.
pub fn replay(seed: u32, diff: usize, dur: u32, log: &[i64]) -> Option<Outcome> {
    if diff >= DIFFS.len() || !DURS.contains(&dur) || !log.len().is_multiple_of(4) || log.len() / 4 > MAX_SHOTS {
        return None;
    }
    let mut sim = Sim::new(seed, diff, dur);
    let mut ev = 0;
    while !sim.over {
        while ev < log.len() && log[ev] == sim.tick {
            let q = &log[ev..ev + 4];
            if q[1..].iter().any(|v| v.abs() > 2_000_000) || !sim.shoot(q[1], q[2], q[3]) {
                return None;
            }
            ev += 4;
        }
        if ev < log.len() && log[ev] < sim.tick {
            return None;
        }
        sim.step();
    }
    if ev < log.len() {
        return None;
    }
    Some(Outcome { score: sim.score, hits: sim.hits, shots: sim.shots })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Rec {
        seed: u32,
        diff: usize,
        dur: u32,
        log: Vec<i64>,
        score: i64,
        hits: i64,
    }

    #[test]
    fn server_replays_match_the_browser() {
        let fixtures: Vec<Rec> = serde_json::from_str(include_str!("../tests/fixtures/aimpulse_replays.json")).unwrap();
        assert!(!fixtures.is_empty());
        for f in fixtures {
            let o = replay(f.seed, f.diff, f.dur, &f.log).expect("zapis");
            assert_eq!((o.score, o.hits), (f.score, f.hits), "ziarno {}", f.seed);
        }
    }

    #[test]
    fn bad_logs_are_rejected() {
        assert!(replay(1, 3, 60, &[]).is_none());
        assert!(replay(1, 1, 45, &[]).is_none());
        assert!(replay(1, 1, 30, &[5, 0, 0]).is_none());
        // dwa strzały w odstępie krótszym niż SHOT_GAP
        assert!(replay(1, 1, 30, &[10, 0, 0, -1_000_000, 11, 0, 0, -1_000_000]).is_none());
        // strzał po końcu rundy
        assert!(replay(1, 1, 30, &[30 * 60, 0, 0, -1_000_000]).is_none());
        assert_eq!(replay(1, 1, 30, &[]).unwrap().score, 0);
    }
}
