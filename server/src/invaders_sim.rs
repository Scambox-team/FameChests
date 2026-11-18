//! Obrona Orbity (zakładka Gry) po stronie serwera: port `web/src/features/invaders/core.ts` (ten sam porządek działań i
//! losowań, same liczby całkowite). Serwer odtwarza grę z ziarna i zapisu klawiszy i sam liczy punkty, więc wyniku z
//! przeglądarki nie bierze na słowo. Zmieniając rdzeń w jednym miejscu, zmień go w drugim i odtwórz nagrania
//! (`node web/scripts/invaders-fixture.mjs`, test `cargo test invaders_sim`).

use crate::det::Rng;

const W: i32 = 480;
const H: i32 = 540;
pub const MAX_TICKS: u64 = 60 * 60 * 40;
const LEFT: u64 = 1;
const RIGHT: u64 = 2;
const FIRE: u64 = 4;

const PY: i32 = 500;
const PW: i32 = 26;
const PH: i32 = 14;
const PSPEED: i32 = 3;
const AROWS: usize = 5;
const ACOLS: usize = 10;
const CELL_W: i32 = 36;
const CELL_H: i32 = 30;
const AW: i32 = 24;
const AH: i32 = 18;
const ROW_PTS: [i64; AROWS] = [30, 20, 20, 10, 10];
const SHIELD_Y: i32 = 420;
const SHIELD_COLS: usize = 11;
const SHIELD_ROWS: usize = 8;
const SC: i32 = 4;
const SHIELD_X: [i32; 4] = [74, 181, 287, 394];
const SAUCER_Y: i32 = 50;
const SAUCER_W: i32 = 34;
const SAUCER_H: i32 = 14;
const SAUCER_PTS: [i64; 4] = [50, 100, 150, 300];
const INVADE_Y: i32 = 470;
const EXTRA_LIFE: i64 = 1500;
const MAX_EVENTS: usize = 200_000;

pub struct Outcome {
    pub score: i64,
    pub ticks: u64,
    pub wave: i64,
}

#[allow(clippy::too_many_arguments)]
fn overlap(ax: i32, ay: i32, aw: i32, ah: i32, bx: i32, by: i32, bw: i32, bh: i32) -> bool {
    ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah
}

fn shield_cell(r: usize, c: usize) -> bool {
    if r == 0 && !(2..=8).contains(&c) {
        return false;
    }
    if r == 1 && !(1..=9).contains(&c) {
        return false;
    }
    !(r >= 5 && (3..=7).contains(&c))
}

fn rint(rng: &mut Rng, n: usize) -> usize {
    (rng.next() * n as f64).floor() as usize
}

struct Shot {
    x: i32,
    y: i32,
}

struct Saucer {
    x: i32,
    dir: i32,
    pts: i64,
}

struct Sim {
    rng: Rng,
    tick: u64,
    over: bool,
    score: i64,
    lives: i64,
    wave: i64,
    px: i32,
    respawn: i32,
    cooldown: i32,
    wave_delay: i32,
    extra_given: bool,
    alive: Vec<bool>,
    ox: i32,
    oy: i32,
    dir: i32,
    march_t: i32,
    bullet: Option<Shot>,
    bombs: Vec<Shot>,
    bomb_t: i32,
    shields: Vec<Vec<bool>>,
    saucer: Option<Saucer>,
    saucer_t: i32,
    saucer_dir: i32,
}

impl Sim {
    fn new(seed: u32) -> Sim {
        let mut s = Sim {
            rng: Rng::new(seed),
            tick: 0,
            over: false,
            score: 0,
            lives: 3,
            wave: 1,
            px: W / 2,
            respawn: 0,
            cooldown: 0,
            wave_delay: 0,
            extra_given: false,
            alive: vec![],
            ox: 0,
            oy: 0,
            dir: 1,
            march_t: 0,
            bullet: None,
            bombs: vec![],
            bomb_t: 0,
            shields: vec![],
            saucer: None,
            saucer_t: 0,
            saucer_dir: 1,
        };
        s.saucer_t = 900 + rint(&mut s.rng, 900) as i32;
        s.setup_wave();
        s
    }

    fn setup_wave(&mut self) {
        self.alive = vec![true; AROWS * ACOLS];
        self.ox = 66;
        self.oy = 80 + (self.wave - 1).min(6) as i32 * 12;
        self.dir = 1;
        self.march_t = self.step_ticks();
        self.bullet = None;
        self.bombs.clear();
        self.bomb_t = 60 + rint(&mut self.rng, 60) as i32;
        self.shields = SHIELD_X
            .iter()
            .map(|_| {
                let mut cells = Vec::with_capacity(SHIELD_ROWS * SHIELD_COLS);
                for r in 0..SHIELD_ROWS {
                    for c in 0..SHIELD_COLS {
                        cells.push(shield_cell(r, c));
                    }
                }
                cells
            })
            .collect();
    }

    fn alive_count(&self) -> i32 {
        self.alive.iter().filter(|a| **a).count() as i32
    }

    fn step_ticks(&self) -> i32 {
        2.max(self.alive_count() * 36 / 50 + 2 - (self.wave - 1).min(5) as i32 * 2)
    }

    fn alien_x(&self, i: usize) -> i32 {
        self.ox + (i % ACOLS) as i32 * CELL_W
    }

    fn alien_y(&self, i: usize) -> i32 {
        self.oy + (i / ACOLS) as i32 * CELL_H
    }

    fn bomb_speed(&self) -> i32 {
        6.min(3 + (self.wave / 2) as i32)
    }

    fn hit_shield(&mut self, x: i32, y: i32, w: i32, down: bool) -> bool {
        for (s, cx) in SHIELD_X.iter().enumerate() {
            let sx = cx - (SHIELD_COLS as i32 * SC) / 2;
            if !overlap(x - w / 2, y, w, 8, sx, SHIELD_Y, SHIELD_COLS as i32 * SC, SHIELD_ROWS as i32 * SC) {
                continue;
            }
            let cells = &mut self.shields[s];
            for k in 0..SHIELD_ROWS {
                let r = if down { k } else { SHIELD_ROWS - 1 - k };
                for c in 0..SHIELD_COLS {
                    if !cells[r * SHIELD_COLS + c] {
                        continue;
                    }
                    if !overlap(x - w / 2, y, w, 8, sx + c as i32 * SC, SHIELD_Y + r as i32 * SC, SC, SC) {
                        continue;
                    }
                    cells[r * SHIELD_COLS + c] = false;
                    let r2 = if down { r as i32 + 1 } else { r as i32 - 1 };
                    if (0..SHIELD_ROWS as i32).contains(&r2) {
                        cells[r2 as usize * SHIELD_COLS + c] = false;
                    }
                    return true;
                }
            }
        }
        false
    }

    fn add_score(&mut self, n: i64) {
        self.score += n;
        if !self.extra_given && self.score >= EXTRA_LIFE {
            self.extra_given = true;
            self.lives += 1;
        }
    }

    fn step(&mut self, mask: u64) {
        if self.over {
            return;
        }
        self.tick += 1;
        if self.tick >= MAX_TICKS {
            self.over = true;
            return;
        }

        if self.respawn > 0 {
            self.respawn -= 1;
            if self.respawn == 0 {
                self.px = W / 2;
            }
        }
        let ship = self.respawn == 0;
        if ship {
            let d = i32::from(mask & RIGHT != 0) - i32::from(mask & LEFT != 0);
            self.px = 16.max((W - 16).min(self.px + d * PSPEED));
        }
        if self.wave_delay > 0 {
            self.wave_delay -= 1;
            if self.wave_delay == 0 {
                self.setup_wave();
            }
            return;
        }

        if self.cooldown > 0 {
            self.cooldown -= 1;
        }
        if ship && mask & FIRE != 0 && self.bullet.is_none() && self.cooldown == 0 {
            self.bullet = Some(Shot { x: self.px, y: PY - 12 });
            self.cooldown = 8;
        }
        if let Some(mut b) = self.bullet.take() {
            b.y -= 10;
            let mut gone = b.y < 30;
            if !gone {
                for i in 0..self.alive.len() {
                    if !self.alive[i] {
                        continue;
                    }
                    let (ax, ay) = (self.alien_x(i), self.alien_y(i));
                    if !overlap(b.x - 1, b.y, 2, 8, ax, ay, AW, AH) {
                        continue;
                    }
                    self.alive[i] = false;
                    self.add_score(ROW_PTS[i / ACOLS]);
                    gone = true;
                    break;
                }
            }
            if !gone {
                if let Some(sa) = &self.saucer {
                    if overlap(b.x - 1, b.y, 2, 8, sa.x - SAUCER_W / 2, SAUCER_Y, SAUCER_W, SAUCER_H) {
                        let pts = sa.pts;
                        self.add_score(pts);
                        self.saucer = None;
                        gone = true;
                    }
                }
            }
            if !gone {
                if let Some(k) = self.bombs.iter().position(|e| overlap(b.x - 1, b.y, 2, 8, e.x - 2, e.y, 4, 8)) {
                    self.bombs.remove(k);
                    gone = true;
                }
            }
            if !gone && self.hit_shield(b.x, b.y, 2, false) {
                gone = true;
            }
            if !gone {
                self.bullet = Some(b);
            }
        }

        // marsz formacji
        self.march_t -= 1;
        if self.march_t <= 0 {
            let (mut min_x, mut max_x, mut bottom) = (W, 0, 0);
            for i in 0..self.alive.len() {
                if !self.alive[i] {
                    continue;
                }
                min_x = min_x.min(self.alien_x(i));
                max_x = max_x.max(self.alien_x(i) + AW);
            }
            if (self.dir > 0 && max_x + 6 > W - 8) || (self.dir < 0 && min_x - 6 < 8) {
                self.oy += 12;
                self.dir = -self.dir;
            } else {
                self.ox += 6 * self.dir;
            }
            self.march_t = self.step_ticks();
            for i in 0..self.alive.len() {
                if !self.alive[i] {
                    continue;
                }
                let (ax, ay) = (self.alien_x(i), self.alien_y(i));
                bottom = bottom.max(ay + AH);
                if ay + AH < SHIELD_Y {
                    continue;
                }
                for (cx, cells) in SHIELD_X.iter().zip(self.shields.iter_mut()) {
                    let sx = cx - (SHIELD_COLS as i32 * SC) / 2;
                    for r in 0..SHIELD_ROWS {
                        for c in 0..SHIELD_COLS {
                            if cells[r * SHIELD_COLS + c]
                                && overlap(ax, ay, AW, AH, sx + c as i32 * SC, SHIELD_Y + r as i32 * SC, SC, SC)
                            {
                                cells[r * SHIELD_COLS + c] = false;
                            }
                        }
                    }
                }
            }
            if bottom >= INVADE_Y {
                self.over = true;
                return;
            }
        }

        // bomby obcych
        self.bomb_t -= 1;
        if self.bomb_t <= 0 {
            self.bomb_t = 20.max(70 - self.wave as i32 * 6) + rint(&mut self.rng, 40) as i32;
            if self.bombs.len() < 4 {
                let cols: Vec<usize> = (0..ACOLS).filter(|&c| (0..AROWS).any(|r| self.alive[r * ACOLS + c])).collect();
                if !cols.is_empty() {
                    let c = cols[rint(&mut self.rng, cols.len())];
                    let mut r = AROWS - 1;
                    while !self.alive[r * ACOLS + c] {
                        r -= 1;
                    }
                    let i = r * ACOLS + c;
                    self.bombs.push(Shot { x: self.alien_x(i) + AW / 2, y: self.alien_y(i) + AH });
                }
            }
        }
        let sp = self.bomb_speed();
        let mut k = self.bombs.len();
        while k > 0 {
            k -= 1;
            self.bombs[k].y += sp;
            let (ex, ey) = (self.bombs[k].x, self.bombs[k].y);
            let mut gone = ey > H;
            if !gone && self.hit_shield(ex, ey, 4, true) {
                gone = true;
            }
            if !gone && self.respawn == 0 && overlap(ex - 2, ey, 4, 8, self.px - PW / 2, PY, PW, PH) {
                self.lives -= 1;
                if self.lives <= 0 {
                    self.over = true;
                    return;
                }
                self.respawn = 90;
                self.bombs.clear();
                break;
            }
            if gone {
                self.bombs.remove(k);
            }
        }

        // satelita z bonusem
        if let Some(sa) = &mut self.saucer {
            sa.x += 2 * sa.dir;
            if sa.x < -SAUCER_W || sa.x > W + SAUCER_W {
                self.saucer = None;
            }
        } else {
            self.saucer_t -= 1;
            if self.saucer_t <= 0 {
                self.saucer_t = 1200 + rint(&mut self.rng, 900) as i32;
                let x = if self.saucer_dir > 0 { -SAUCER_W / 2 } else { W + SAUCER_W / 2 };
                let pts = SAUCER_PTS[rint(&mut self.rng, 4)];
                self.saucer = Some(Saucer { x, dir: self.saucer_dir, pts });
                self.saucer_dir = -self.saucer_dir;
            }
        }

        if self.alive_count() == 0 {
            self.wave += 1;
            self.wave_delay = 90;
            self.bullet = None;
            self.bombs.clear();
            self.saucer = None;
        }
    }
}

/// kroków w odcinku losowania (`live.rs`; to samo `SEG` w core.ts) - 2 s gry
pub const SEG: u64 = 120;

/// Odtwarza grę: `log` = naprzemiennie numer kroku i maska klawiszy (bity: 1 lewo, 2 prawo, 4 strzał), `ticks` = ile kroków
/// zrobiła przeglądarka (gra kończy się wcześniej, jeśli statek zginął). None = zapis nie do przyjęcia.
///
/// `seeds` = ziarna odcinków po `SEG` kroków (`live.rs`); gra, która doszła do odcinka bez ziarna, jest odrzucana.
pub fn replay(seeds: &[u32], log: &[u64], ticks: u64) -> Option<Outcome> {
    if !log.len().is_multiple_of(2) || log.len() / 2 > MAX_EVENTS || ticks > MAX_TICKS {
        return None;
    }
    let mut sim = Sim::new(*seeds.first()?);
    let (mut ev, mut mask) = (0, 0u64);
    while !sim.over && sim.tick < ticks {
        while ev < log.len() && log[ev] == sim.tick {
            if log[ev + 1] > 7 {
                return None;
            }
            mask = log[ev + 1];
            ev += 2;
        }
        if ev < log.len() && log[ev] < sim.tick {
            return None;
        }
        sim.step(mask);
        // nowy odcinek losowania (jak koniec `step` w core.ts)
        if !sim.over && sim.tick.is_multiple_of(SEG) {
            sim.rng = Rng::new(*seeds.get((sim.tick / SEG) as usize)?);
        }
    }
    // zmiany klawiszy po końcu gry: zapis się nie zgadza
    if ev < log.len() {
        return None;
    }
    Some(Outcome { score: sim.score, ticks: sim.tick, wave: sim.wave })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Rec {
        seed: u32,
        log: Vec<u64>,
        ticks: u64,
        score: i64,
        wave: i64,
    }

    #[test]
    fn server_replays_match_the_browser() {
        let fixtures: Vec<Rec> = serde_json::from_str(include_str!("../tests/fixtures/invaders_replays.json")).unwrap();
        assert!(!fixtures.is_empty());
        for f in fixtures {
            let o = replay(&crate::live::test_seeds(f.seed, f.ticks / SEG + 1), &f.log, f.ticks).expect("zapis");
            assert_eq!((o.score, o.ticks, o.wave), (f.score, f.ticks, f.wave), "ziarno {}", f.seed);
        }
    }

    #[test]
    fn bad_logs_are_rejected() {
        let seeds = crate::live::test_seeds(1, 6);
        assert!(replay(&seeds, &[5], 100).is_none());
        assert!(replay(&seeds, &[3, 9], 100).is_none());
        assert!(replay(&seeds, &[10, 1, 5, 2], 100).is_none());
        // klawisze po końcu zapisanej gry
        assert!(replay(&seeds, &[500, 1], 100).is_none());
        let idle = replay(&seeds, &[], 600).unwrap();
        assert_eq!((idle.score, idle.ticks), (0, 600));
        // gra dłuższa niż wydane ziarna
        assert!(replay(&seeds[..2], &[], 600).is_none());
    }
}
