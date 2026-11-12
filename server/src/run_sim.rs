//! Super Turbo Run 3D po stronie serwera: port `web/src/features/turbo/runCore.ts` BIT W BIT (generator tunelu z ziarnem, fizyka
//! w stałym kroku `TICK`, przeszkody, tarcza, turbo). Serwer odtwarza bieg z ziarna i zapisu klawiszy i sam liczy dystans do
//! chwili śmierci, więc wynik z przeglądarki się nie liczy. Punkty, combo i kryształy liczy tylko przeglądarka - tu ich nie ma,
//! ale kolejność losowań generatora (także dla kryształów) musi być identyczna. Zmieniając rdzeń w jednym miejscu, zmień go
//! w drugim i odtwórz nagrania (`node web/scripts/snake-fixture.mjs`, test `cargo test run_sim`).

use std::f64::consts::PI;

use crate::det::{fmod, jround, Rng};

const TAU: f64 = PI * 2.0;
const N: usize = 12;
const NI: i32 = 12;
const APO: f64 = 5.2;
const DTH: f64 = TAU / 12.0;
const TW: f64 = 2.7866716012836763;
const TL: f64 = 3.2;
const ROWS_AHEAD: i64 = 60;
const RB: usize = 128;
const GRAV: f64 = 16.0;
const JUMP_V: f64 = 9.4;
const PAD_V: f64 = 10.7;
const JUMP_T: f64 = 2.0 * JUMP_V / GRAV;
const PAD_T: f64 = 2.0 * PAD_V / GRAV;
const ZONE_LEN: f64 = 700.0;
const TURBO_DIST: f64 = 95.0;
const V0: f64 = 17.0;
pub const TICK: f64 = 1.0 / 120.0;
/// najdłuższy odtwarzany bieg (15 minut); dłuższy kończy się na tym dystansie
const MAX_TICKS: u64 = 120 * 60 * 15;
const MAX_EVENTS: usize = 200_000;

pub struct Outcome {
    /// dystans w chwili śmierci (m)
    pub dist: f64,
    pub ticks: u64,
}

fn imod(a: i32, n: i32) -> i32 {
    a.rem_euclid(n)
}
fn wrap_pi(a: f64) -> f64 {
    fmod(a + PI, TAU) - PI
}
fn speed_at(d: f64) -> f64 {
    let z = d / ZONE_LEN;
    let zi = z.floor();
    (V0 + zi * 2.6 + (z - zi) * 1.0).min(46.0)
}
fn lat_speed(v: f64) -> f64 {
    10.5 + (v - 24.0) * 0.2
}
fn rows_per_lane(v: f64) -> i32 {
    (TW * v / (TL * lat_speed(v) * 0.7)).ceil() as i32
}
fn hole_min(v: f64) -> i32 {
    2.max(((v * 0.18 + 0.7) / TL).ceil() as i32)
}
fn iclamp(x: i32, a: i32, b: i32) -> i32 {
    a.max(b.min(x))
}

#[derive(Clone)]
struct Row {
    j: i64,
    tile: [u8; N],
    obs: [u8; N],
    item: [u8; N],
    item_h: [f32; N],
    nobs: i32,
    nitem: i32,
    special: u8,
}

impl Row {
    fn empty() -> Self {
        Row { j: -1, tile: [1; N], obs: [0; N], item: [0; N], item_h: [0.0; N], nobs: 0, nitem: 0, special: 0 }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Name {
    Open,
    Gaps,
    Holes,
    Gates,
    Boost,
    Spiral,
    Stripes,
    Mega,
    Half,
    None,
}

enum Kind {
    Open { p: f64, d: f64, v: f64 },
    Holes { p: f64, d: f64, v: f64 },
    /// plan: None = zwykły rząd, Some((q, g, arc)) = dziura
    Gaps { plan: Vec<Option<(i32, i32, bool)>>, hm: i32, d: f64, v: f64 },
    Mega { flight: f64, gap: i32, apex: f64 },
    Spiral { w: i32, dir: i32, k: i32, lead: i32, base: i32 },
    Half { hw: i32, w: i32, lead: i32, base: i32, body: i32, d: f64, v: f64 },
    Stripes { jr: i32, base: i32, next_bar: i32, d: f64 },
    Gates { q: i32, n: i32, c: i32, pc: i32, d: f64, v: f64 },
    Boost,
}

struct Seg {
    len: i32,
    rest: i32,
    from: i32,
    kind: Kind,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    None,
    Line,
    Side,
    Zig,
    Arc,
    Fan,
    Diag,
}

struct Gp {
    mode: Mode,
    left: i32,
    i: i32,
    dir: i32,
    step: i32,
    n: i32,
}

struct Gen {
    j: i64,
    left: i32,
    seg: Option<Seg>,
    path: i32,
    prev: Name,
    since_item: i32,
    since_boost: i32,
    rest: i32,
    hole_left: [i8; N],
    hint: Option<i32>,
    gp: Gp,
}

struct Sim {
    rng: Rng,
    rows: Vec<Row>,
    gen: Gen,
    // stan gry (G)
    dist: f64,
    jp: i64,
    speed: f64,
    turbo: f64,
    shield: bool,
    magnet: f64,
    x2: f64,
    inv: f64,
    fall_t: f64,
    dead: bool,
    // biegacz (P)
    th: f64,
    vth: f64,
    h: f64,
    vy: f64,
    grounded: bool,
    fallen: bool,
    coyote: f64,
    jump_buf: f64,
    pad: bool,
    air: f64,
    air_holes: i32,
    // klawisze
    left: bool,
    right: bool,
    jump: bool,
}

impl Sim {
    fn new(seed: u32) -> Self {
        Sim {
            rng: Rng::new(seed),
            rows: vec![Row::empty(); RB],
            gen: Gen {
                j: 0,
                left: 0,
                seg: None,
                path: 0,
                prev: Name::None,
                since_item: 70,
                since_boost: 0,
                rest: 0,
                hole_left: [0; N],
                hint: None,
                gp: Gp { mode: Mode::None, left: 4, i: 0, dir: 1, step: 3, n: 0 },
            },
            dist: 0.0,
            jp: 0,
            speed: 9.0,
            turbo: 0.0,
            shield: false,
            magnet: 0.0,
            x2: 0.0,
            inv: 0.0,
            fall_t: 0.0,
            dead: false,
            th: 0.0,
            vth: 0.0,
            h: 0.0,
            vy: 0.0,
            grounded: true,
            fallen: false,
            coyote: 0.0,
            jump_buf: 0.0,
            pad: false,
            air: 0.0,
            air_holes: 0,
            left: false,
            right: false,
            jump: false,
        }
    }

    // ---------- losowanie (tylko generator) ----------
    fn rand(&mut self, a: f64, b: f64) -> f64 {
        a + self.rng.next() * (b - a)
    }
    fn randi(&mut self, a: i32, b: i32) -> i32 {
        self.rand(a as f64, (b + 1) as f64).floor() as i32
    }
    fn pick<T: Copy>(&mut self, a: &[T]) -> T {
        a[(self.rng.next() * a.len() as f64).floor() as usize]
    }

    // ---------- wiersze ----------
    fn row_idx(&self, j: i64) -> Option<usize> {
        if j < 0 {
            return None;
        }
        let i = (j as usize) % RB;
        (self.rows[i].j == j).then_some(i)
    }
    fn set_obs(&mut self, ri: usize, l: i32, v: u8) {
        let l = imod(l, NI) as usize;
        let r = &mut self.rows[ri];
        if r.tile[l] == 1 {
            if r.obs[l] == 0 {
                r.nobs += 1;
            }
            r.obs[l] = v;
        }
    }
    fn set_gem(&mut self, ri: usize, l: i32, h: f64) {
        let l = imod(l, NI) as usize;
        let r = &mut self.rows[ri];
        if r.item[l] == 0 {
            r.nitem += 1;
        }
        r.item[l] = 1;
        r.item_h[l] = if h == 0.0 { 0.9 } else { h as f32 };
    }
    fn gem_ok(&self, ri: usize, l: i32) -> bool {
        let l = imod(l, NI) as usize;
        self.rows[ri].tile[l] == 1 && self.rows[ri].obs[l] == 0
    }
    fn ground_gem(&mut self, ri: usize, l: i32) -> bool {
        if self.gem_ok(ri, l) {
            self.set_gem(ri, l, 0.0);
            true
        } else {
            false
        }
    }
    fn band(&mut self, ri: usize, lo: i32, hi: i32) {
        if hi - lo + 1 >= NI {
            return;
        }
        let r = &mut self.rows[ri];
        for l in 0..NI {
            if imod(l - lo, NI) <= hi - lo {
                continue;
            }
            let u = l as usize;
            r.tile[u] = 0;
            if r.obs[u] != 0 {
                r.obs[u] = 0;
                r.nobs -= 1;
            }
            if r.item[u] != 0 {
                r.item[u] = 0;
                r.nitem -= 1;
            }
        }
    }
    fn scatter(&mut self, ri: usize, p: f64, v: f64, prot: &[i32], obs_p: f64, allow_start: bool) {
        let hm = hole_min(v);
        for l in 0..N {
            if prot.contains(&(l as i32)) {
                self.gen.hole_left[l] = 0;
                continue;
            }
            if self.gen.hole_left[l] > 0 {
                self.rows[ri].tile[l] = 0;
                self.gen.hole_left[l] -= 1;
                continue;
            }
            if allow_start && self.rng.next() < p {
                let len = self.randi(hm, hm + 2);
                self.gen.hole_left[l] = (len - 1) as i8;
                self.rows[ri].tile[l] = 0;
                if l < N - 1 && self.gen.hole_left[l + 1] <= 0 && self.rng.next() < 0.38 {
                    self.gen.hole_left[l + 1] = len as i8;
                }
            } else if obs_p != 0.0 && self.rng.next() < obs_p {
                let o = if self.rng.next() < 0.5 { 1 } else { 2 };
                self.set_obs(ri, l as i32, o);
            }
        }
    }
    /// `holesBody`; zwraca nowe `from` segmentu
    #[allow(clippy::too_many_arguments)]
    fn holes_body(&mut self, ri: usize, from: i32, i: i32, len: i32, p: f64, d: f64, v: f64, lim: Option<(i32, i32)>) -> i32 {
        let mut from = from;
        if i > 0 && i % 5 == 0 {
            from = self.gen.path;
            let mut np = self.gen.path + self.pick(&[-1, 0, 1]);
            if let Some((a, b)) = lim {
                np = iclamp(np, a, b);
            }
            self.gen.path = np;
        }
        let prot = [imod(self.gen.path, NI), imod(from, NI)];
        self.scatter(ri, p, v, &prot, 0.03 + 0.05 * d, i < len - 1);
        self.gen.hint = Some(self.gen.path);
        from
    }

    fn make_seg(&mut self, name: Name, v: f64, d: f64) -> Seg {
        let path = self.gen.path;
        let seg = |len, rest, kind| Seg { len, rest, from: path, kind };
        match name {
            Name::Open => {
                let len = self.randi(9, 15);
                let p = if self.gen.j < 30 { 0.025 } else { 0.05 + 0.05 * d };
                seg(len, 3, Kind::Open { p, d, v })
            }
            Name::Holes => {
                let len = self.randi(14, 22);
                seg(len, 3, Kind::Holes { p: 0.12 + 0.1 * d, d, v })
            }
            Name::Gaps => {
                let gmax = iclamp((0.45 * v * JUMP_T / TL).floor() as i32, 2, 7);
                let gmin = hole_min(v).min(gmax);
                let lo = (v * JUMP_T / TL).ceil() as i32;
                let hm = hole_min(v);
                let mut plan = Vec::new();
                let n = self.randi(2, 3);
                for _ in 0..n {
                    let so = self.randi(lo, lo + 2);
                    let g = self.randi(gmin, gmax);
                    let arc = self.rng.next() < 0.6;
                    plan.extend(std::iter::repeat_n(None, so as usize));
                    for q in 0..g {
                        plan.push(Some((q, g, arc)));
                    }
                }
                plan.push(None);
                plan.push(None);
                seg(plan.len() as i32, 3, Kind::Gaps { plan, hm, d, v })
            }
            Name::Mega => {
                let flight = v * PAD_T / TL;
                let gap = iclamp((0.55 * flight).floor() as i32, 4, 10);
                let post = 6.max((flight - gap as f64).ceil() as i32);
                let apex = PAD_V * PAD_V / (2.0 * GRAV);
                seg(7 + gap + post, 4, Kind::Mega { flight, gap, apex })
            }
            Name::Spiral => {
                let w = if d < 0.3 { 3 } else { self.pick(&[2, 3, 3]) };
                let dir = self.pick(&[-1, 1]);
                let rpl = rows_per_lane(v);
                let k = if w == 3 { 2.max(rpl - 1) } else { rpl };
                let lead = 5 * rpl + 2;
                let turns = self.randi(7, 13);
                seg(lead + turns * k, 3, Kind::Spiral { w, dir, k, lead, base: path })
            }
            Name::Half => {
                let hw = if d < 0.5 { 3 } else { 2 };
                let w = 2 * hw + 1;
                let rpl = rows_per_lane(v);
                let lead = (f64::from(NI - w) / 2.0).ceil() as i32 * rpl + 2;
                let body = self.randi(12, 20);
                seg(lead + body, 3, Kind::Half { hw, w, lead, base: path, body, d, v })
            }
            Name::Stripes => {
                let jr = (v * JUMP_T / TL).ceil() as i32;
                let len = self.randi(2, 3) * (jr + 4) + 4;
                let next_bar = self.randi(4, 6);
                seg(len, 3, Kind::Stripes { jr, base: path, next_bar, d })
            }
            Name::Gates => {
                let rpl = rows_per_lane(v);
                let q = 6.max(2 * rpl + 2).max((v * JUMP_T / TL).ceil() as i32 + 3);
                let n = self.randi(3, 4);
                seg(n * q + 2, 3, Kind::Gates { q, n, c: path, pc: path, d, v })
            }
            Name::Boost => seg(30, 5, Kind::Boost),
            Name::None => unreachable!(),
        }
    }

    /// Wiersz `i` segmentu (seg wyjęty z gen na czas wywołania)
    fn seg_row(&mut self, s: &mut Seg, ri: usize, i: i32) {
        let len = s.len;
        match &mut s.kind {
            Kind::Open { p, d, v } => {
                let (p, d, v) = (*p, *d, *v);
                self.scatter(ri, p, v, &[imod(self.gen.path, NI)], 0.0, i < len - 1);
                self.gen.hint = Some(self.gen.path);
                if i % 3 == 1 {
                    let n = 1 + self.rand(0.0, 1.5 + d * 4.0).floor() as i32;
                    for _ in 0..n {
                        let l = self.gen.path + self.randi(2, NI - 2);
                        let o = if self.rng.next() < 0.6 { 1 } else { 2 };
                        self.set_obs(ri, l, o);
                    }
                }
            }
            Kind::Holes { p, d, v } => {
                let (p, d, v) = (*p, *d, *v);
                s.from = self.holes_body(ri, s.from, i, len, p, d, v, None);
            }
            Kind::Gaps { plan, hm, d, v } => {
                let (hm, d, v) = (*hm, *d, *v);
                let k = i as usize;
                match plan[k] {
                    Some((q, g, arc)) => {
                        self.rows[ri].tile = [0; N];
                        if arc {
                            let h = 0.9 + 2.0 * (PI * (f64::from(q) + 0.5) / f64::from(g)).sin();
                            self.set_gem(ri, self.gen.path, h);
                        }
                    }
                    None => {
                        let far = {
                            let span = (hm + 5) as usize;
                            if k + span >= plan.len() { false } else { (0..=span).all(|q| plan[k + q].is_none()) }
                        };
                        self.scatter(ri, 0.04, v, &[imod(self.gen.path, NI)], 0.0, far);
                        self.gen.hint = Some(self.gen.path);
                        if self.rng.next() < 0.3 * d {
                            let l = self.gen.path + self.randi(2, NI - 2);
                            self.set_obs(ri, l, 2);
                        }
                    }
                }
            }
            Kind::Mega { flight, gap, apex } => {
                let (flight, gap, apex) = (*flight, *gap, *apex);
                if i == 5 || i == 6 {
                    self.rows[ri].tile = [4; N];
                } else if i >= 7 && i < 7 + gap {
                    self.rows[ri].tile = [0; N];
                }
                if i < 5 {
                    self.gen.hint = Some(self.gen.path);
                    return;
                }
                let t = (f64::from(i) + 0.5 - 5.3) / flight;
                if t > 0.04 && t < 0.96 {
                    if i % 2 == 0 {
                        self.set_gem(ri, self.gen.path, 0.75 + 4.0 * apex * t * (1.0 - t));
                    }
                } else if i >= 7 + gap {
                    self.gen.hint = Some(self.gen.path);
                }
            }
            Kind::Spiral { w, dir, k, lead, base } => {
                let (w, dir, k, lead, base) = (*w, *dir, *k, *lead, *base);
                let sh = if i < lead { 0 } else { (i - lead).div_euclid(k) + 1 };
                let c = base + dir * sh;
                let (mut lo, mut hi) = if w == 3 { (c - 1, c + 1) } else if dir > 0 { (c, c + 1) } else { (c - 1, c) };
                if i < lead {
                    let e = (f64::from(NI - w) / 2.0 * (1.0 - f64::from(i + 1) / f64::from(lead))).ceil() as i32;
                    lo -= e;
                    hi += e;
                }
                self.gen.path = c;
                self.gen.hint = Some(c);
                self.band(ri, lo, hi);
            }
            Kind::Half { hw, w, lead, base, body, d, v } => {
                let (hw, w, lead, base, body, d, v) = (*hw, *w, *lead, *base, *body, *d, *v);
                if i >= lead {
                    s.from = self.holes_body(ri, s.from, i - lead, body, 0.1 + 0.1 * d, d, v, Some((base - (hw - 1), base + (hw - 1))));
                } else {
                    self.gen.hint = Some(self.gen.path);
                }
                let e = if i < lead { (f64::from(NI - w) / 2.0 * (1.0 - f64::from(i + 1) / f64::from(lead))).ceil() as i32 } else { 0 };
                self.band(ri, base - hw - e, base + hw + e);
            }
            Kind::Stripes { jr, base, next_bar, d } => {
                let (jr, base, d) = (*jr, *base, *d);
                if i >= 2 && i < len - 1 {
                    for l in 0..NI {
                        if imod(l - base, 2) == 1 {
                            self.rows[ri].tile[l as usize] = 0;
                        }
                    }
                }
                if i == *next_bar && i < len - 2 {
                    self.set_obs(ri, base, 1);
                    if self.rng.next() < 0.5 {
                        self.set_gem(ri, base, 2.2);
                    }
                    *next_bar += jr + self.randi(2, 4);
                } else {
                    self.gen.hint = Some(base);
                }
                if i >= 3 && self.rng.next() < 0.18 + 0.25 * d {
                    let l = base + 2 * self.randi(1, 5);
                    let o = self.pick(&[1u8, 2]);
                    self.set_obs(ri, l, o);
                }
            }
            Kind::Gates { q, n, c, pc, d, v } => {
                let (q, n, d, v) = (*q, *n, *d, *v);
                let k = i % q;
                if k == 0 && i > 0 && i < n * q {
                    *pc = *c;
                    *c += self.randi(-2, 2);
                }
                let (c, pc) = (*c, *pc);
                self.gen.path = c;
                let mut prot = Vec::with_capacity(6);
                for o in -1..=1 {
                    prot.push(imod(c + o, NI));
                    prot.push(imod(pc + o, NI));
                }
                self.scatter(ri, 0.035, v, &prot, 0.0, i < n * q);
                if i < n * q && k == q - 1 {
                    for l in 0..NI {
                        let mut off = imod(l - c, NI);
                        if off > NI / 2 {
                            off -= NI;
                        }
                        let ao = off.abs();
                        if ao <= 1 {
                            continue;
                        }
                        let o = if ao % 2 == 1 && self.rng.next() < 0.25 + d { 2 } else { 1 };
                        self.set_obs(ri, l, o);
                    }
                }
                if k >= 1 || i == 0 {
                    self.gen.hint = Some(c);
                }
            }
            Kind::Boost => {
                if i == 2 || i == 3 {
                    self.rows[ri].tile = [3; N];
                    if i == 2 {
                        self.rows[ri].special = 3;
                    }
                    return;
                }
                if (6..23).contains(&i) && i % 2 == 0 {
                    let n = self.randi(3, 5);
                    for _ in 0..n {
                        let l = self.randi(0, NI - 1);
                        let o = self.pick(&[1u8, 2]);
                        self.set_obs(ri, l, o);
                    }
                    if i % 4 == 0 {
                        let l = self.gen.path + self.pick(&[-1, 0, 1]);
                        let o = self.pick(&[1u8, 2]);
                        self.set_obs(ri, l, o);
                    }
                }
                if i > 4 && i < 26 {
                    if self.rng.next() < 0.5 {
                        let l = self.gen.path + self.randi(-2, 2);
                        self.set_gem(ri, l, 0.0);
                    }
                } else {
                    self.gen.hint = Some(self.gen.path);
                }
            }
        }
    }

    fn next_segment(&mut self, j: i64) {
        use Name::*;
        let dist = j as f64 * TL;
        let v = speed_at(dist);
        let d = (dist / 8000.0).min(1.0);
        let pool: &[Name] = if dist < 120.0 {
            &[Open, Gaps, Holes]
        } else if dist < 450.0 {
            &[Open, Gaps, Holes, Holes, Holes, Gates, Boost]
        } else if dist < 950.0 {
            &[Open, Gaps, Holes, Holes, Holes, Gates, Spiral, Stripes, Mega, Boost]
        } else {
            &[Open, Gaps, Holes, Holes, Holes, Gates, Spiral, Spiral, Half, Half, Stripes, Mega, Boost]
        };
        self.gen.since_boost += 1;
        let mut guard = 0;
        let mut name;
        loop {
            name = self.pick(pool);
            if !(name == self.gen.prev || (name == Boost && self.gen.since_boost < 6)) {
                break;
            }
            let g = guard;
            guard += 1;
            if g >= 20 {
                break;
            }
        }
        if j < 14 {
            name = Open;
        }
        if name == Boost {
            self.gen.since_boost = 0;
        }
        self.gen.hole_left = [0; N];
        self.gen.prev = name;
        let seg = self.make_seg(name, v, d);
        self.gen.left = seg.len;
        self.gen.seg = Some(seg);
    }

    fn place_gems(&mut self, ri: usize, j: i64) {
        let Some(base) = self.gen.hint else { return };
        if self.gen.gp.left <= 0 {
            if self.gen.gp.mode != Mode::None {
                self.gen.gp.mode = Mode::None;
                self.gen.gp.left = self.randi(5, 11);
            } else {
                let v = speed_at(j as f64 * TL);
                self.gen.gp.step = 2.max(rows_per_lane(v));
                self.gen.gp.dir = self.pick(&[-1, 1]);
                use Mode::*;
                self.gen.gp.mode = self.pick(&[Line, Line, Side, Side, Zig, Arc, Fan, Diag]);
                self.gen.gp.n = iclamp(jround(v * JUMP_T / TL * 0.75) as i32, 4, 12);
                let line = self.randi(3, 5);
                let side = self.randi(3, 4);
                let diag = self.randi(3, 4) * self.gen.gp.step;
                let gp = &mut self.gen.gp;
                gp.left = match gp.mode {
                    Line => line,
                    Side => side,
                    Zig => 4 * gp.step,
                    Arc => gp.n,
                    Fan => 1,
                    Diag => diag,
                    None => unreachable!(),
                };
            }
            self.gen.gp.i = 0;
        }
        let i = self.gen.gp.i;
        self.gen.gp.i += 1;
        self.gen.gp.left -= 1;
        let (step, dir, n) = (self.gen.gp.step, self.gen.gp.dir, self.gen.gp.n);
        match self.gen.gp.mode {
            Mode::Line => {
                self.ground_gem(ri, base);
            }
            Mode::Side => {
                if !self.ground_gem(ri, base + dir) {
                    self.ground_gem(ri, base);
                }
            }
            Mode::Zig => {
                if i % step == 0 && !self.ground_gem(ri, base + [0, 1, 0, -1][((i / step) % 4) as usize] * dir) {
                    self.ground_gem(ri, base);
                }
            }
            Mode::Arc => {
                if (n <= 7 || i % 2 == 0) && self.gem_ok(ri, base) {
                    let h = 0.9 + 2.0 * (PI * (f64::from(i) + 0.5) / f64::from(n)).sin();
                    self.set_gem(ri, base, h);
                }
            }
            Mode::Fan => {
                self.ground_gem(ri, base - 1);
                self.ground_gem(ri, base);
                self.ground_gem(ri, base + 1);
            }
            Mode::Diag => {
                if i % step == 0 && !self.ground_gem(ri, base + dir * (i / step)) {
                    self.ground_gem(ri, base);
                }
            }
            Mode::None => {}
        }
    }

    fn try_power(&mut self, ri: usize) {
        self.gen.since_item += 1;
        let Some(hint) = self.gen.hint.filter(|_| self.gen.since_item >= 115) else { return };
        let l = imod(hint, NI) as usize;
        if self.rows[ri].tile[l] == 1 && self.rows[ri].obs[l] == 0 {
            if self.rows[ri].item[l] == 0 {
                self.rows[ri].nitem += 1;
            }
            let it = 10 + self.randi(0, 2);
            self.rows[ri].item[l] = it as u8;
            self.rows[ri].item_h[l] = 1.15;
            self.gen.since_item = 0;
        }
    }

    fn gen_row(&mut self) {
        let j = self.gen.j;
        self.gen.j += 1;
        let ri = (j as usize) % RB;
        self.rows[ri] = Row { j, ..Row::empty() };
        self.gen.hint = None;
        if j < 12 {
            if j >= 5 {
                self.gen.hint = Some(self.gen.path);
            }
        } else if self.gen.rest > 0 {
            self.gen.rest -= 1;
            self.gen.hint = Some(self.gen.path);
        } else {
            if self.gen.seg.is_none() || self.gen.left <= 0 {
                self.next_segment(j);
            }
            let mut s = self.gen.seg.take().expect("segment");
            let i = s.len - self.gen.left;
            self.seg_row(&mut s, ri, i);
            self.gen.left -= 1;
            if self.gen.left <= 0 {
                self.gen.rest = s.rest;
            }
            self.gen.seg = Some(s);
        }
        self.place_gems(ri, j);
        self.try_power(ri);
    }

    fn ensure_rows(&mut self) {
        while self.gen.j < self.jp + ROWS_AHEAD + 2 {
            self.gen_row();
        }
    }

    // ---------- gra ----------
    fn tile_at(&self, th: f64, z: f64) -> u8 {
        match self.row_idx((z / TL).floor() as i64) {
            None => 1,
            Some(ri) => self.rows[ri].tile[fmod(jround(th / DTH), 12.0) as usize],
        }
    }
    fn support(&self) -> u8 {
        let c = self.tile_at(self.th, self.dist);
        if c != 0 {
            return c;
        }
        let a = 0.3 / APO;
        for t in [
            self.tile_at(self.th - a, self.dist),
            self.tile_at(self.th + a, self.dist),
            self.tile_at(self.th, self.dist + 0.35),
            self.tile_at(self.th, self.dist - 0.35),
        ] {
            if t != 0 {
                return t;
            }
        }
        0
    }
    fn launch(&mut self, v: f64, pad: bool) {
        self.vy = v;
        self.grounded = false;
        self.pad = pad;
        self.coyote = 0.0;
        self.jump_buf = 0.0;
        self.air = 0.0;
        self.air_holes = 0;
        if self.h < 0.0 {
            self.h = 0.0;
        }
    }
    fn land(&mut self, sup: u8) {
        self.h = 0.0;
        self.vy = 0.0;
        self.grounded = true;
        self.pad = false;
        self.air_holes = 0;
        if sup == 4 {
            self.launch(PAD_V, true);
        }
    }
    fn enter_row(&mut self, j: i64) {
        if let Some(ri) = self.row_idx(j) {
            if self.rows[ri].special == 3 && self.turbo < TURBO_DIST - 15.0 {
                self.turbo = TURBO_DIST;
            }
        }
        if !self.grounded && self.tile_at(self.th, (j as f64 + 0.5) * TL) == 0 {
            self.air_holes += 1;
        }
    }
    fn hit_obstacles(&mut self) {
        for j in self.jp - 1..=self.jp + 1 {
            let Some(ri) = self.row_idx(j) else { continue };
            if self.rows[ri].nobs == 0 {
                continue;
            }
            if (self.dist - (j as f64 + 0.5) * TL).abs() > 0.85 {
                continue;
            }
            for l in 0..N {
                let o = self.rows[ri].obs[l];
                if o == 0 {
                    continue;
                }
                if wrap_pi(l as f64 * DTH - self.th).abs() * APO > TW * 0.46 + 0.28 {
                    continue;
                }
                if self.h > (if o == 1 { 1.15 } else { 4.4 }) - 0.25 {
                    continue;
                }
                let smash = |s: &mut Sim| {
                    s.rows[ri].obs[l] = 0;
                    s.rows[ri].nobs -= 1;
                };
                if self.turbo > 0.0 || self.inv > 0.0 {
                    smash(self);
                } else if self.shield {
                    self.shield = false;
                    self.inv = 1.3;
                    smash(self);
                } else {
                    self.dead = true;
                    return;
                }
            }
        }
    }
    /// Moce (tarcza, magnes, x2); kryształy nie wpływają na bieg, ale znikają z tego samego wiersza tak samo
    fn collect_items(&mut self) {
        let jr = if self.magnet > 0.0 { 7 } else { 1 };
        for j in self.jp - 1..=self.jp + jr {
            let Some(ri) = self.row_idx(j) else { continue };
            if self.rows[ri].nitem == 0 {
                continue;
            }
            let dz = (j as f64 + 0.5) * TL - self.dist;
            for l in 0..N {
                let it = self.rows[ri].item[l];
                if it == 0 {
                    continue;
                }
                let dl = wrap_pi(l as f64 * DTH - self.th).abs() * APO;
                let dh = (f64::from(self.rows[ri].item_h[l]) - (self.h + 0.75)).abs();
                if dz.abs() < 1.35 && dl < 1.35 && dh < 1.45 {
                    self.rows[ri].item[l] = 0;
                    self.rows[ri].nitem -= 1;
                    match it {
                        10 => self.shield = true,
                        11 => self.magnet = 9.0,
                        12 => self.x2 = 10.0,
                        _ => {}
                    }
                } else if self.magnet > 0.0 && it == 1 && dz > -1.0 && dl < TW * 3.3 {
                    self.rows[ri].item[l] = 0;
                    self.rows[ri].nitem -= 1;
                }
            }
        }
    }
    fn step_play(&mut self, dt: f64) {
        let dir = f64::from(i32::from(self.right) - i32::from(self.left));
        self.vth += (dir * lat_speed(self.speed) / APO - self.vth) * 1.0f64.min(dt * if self.grounded { 16.0 } else { 11.0 });
        self.th += self.vth * dt;
        self.dist += self.speed * dt;
        self.jump_buf -= dt;
        self.coyote -= dt;
        if self.jump_buf > 0.0 && !self.fallen && (self.grounded || self.coyote > 0.0) {
            self.launch(JUMP_V, false);
        }
        if !self.grounded {
            let mut g = GRAV;
            if self.vy > 0.0 && !self.jump && !self.pad {
                g *= 2.0;
            }
            self.vy -= g * dt;
            self.h += self.vy * dt;
            self.air += dt;
        }
        let sup = if self.fallen { 0 } else { self.support() };
        if self.grounded {
            if sup == 0 {
                self.grounded = false;
                self.coyote = 0.1;
                self.vy = 0.0;
                self.pad = false;
                self.air = 0.0;
                self.air_holes = 0;
            } else if sup == 4 {
                self.launch(PAD_V, true);
            }
        } else if !self.fallen && self.vy <= 0.0 && self.h <= 0.0 {
            if sup != 0 && self.h > -0.25 {
                self.land(sup);
            } else if self.h < -0.25 {
                self.fallen = true;
                self.fall_t = 0.0;
            }
        }
        if self.fallen {
            self.fall_t += dt;
            if self.fall_t > 0.7 {
                self.dead = true;
                return;
            }
        }
        let nj = (self.dist / TL).floor() as i64;
        while self.jp < nj {
            self.jp += 1;
            self.enter_row(self.jp);
        }
        if !self.fallen {
            self.hit_obstacles();
            if !self.dead {
                self.collect_items();
            }
        }
    }
    fn tick(&mut self) {
        let dt = TICK;
        let target = speed_at(self.dist) * if self.turbo > 0.0 { 1.35 } else { 1.0 };
        self.speed += (target - self.speed) * 1.0f64.min(dt * if self.turbo > 0.0 { 5.0 } else { 1.6 });
        let n = 1.0f64.max((self.speed * dt / 0.55).ceil());
        let mut k = 0.0;
        while k < n && !self.dead {
            self.step_play(dt / n);
            k += 1.0;
        }
        self.ensure_rows();
        if self.dead {
            return;
        }
        if self.turbo > 0.0 {
            self.turbo -= self.speed * dt;
        }
        self.magnet -= dt;
        self.x2 -= dt;
        self.inv -= dt;
    }
}

/// Odtwarza bieg: `log` = naprzemiennie numer kroku i kod klawisza (0/1 lewo w dół / w górę, 2/3 prawo, 4/5 skok).
/// None = zapis nie do przyjęcia.
pub fn replay(seed: u32, log: &[u64]) -> Option<Outcome> {
    if !log.len().is_multiple_of(2) || log.len() / 2 > MAX_EVENTS {
        return None;
    }
    let mut s = Sim::new(seed);
    s.ensure_rows();
    let (mut ticks, mut ev) = (0u64, 0usize);
    while ticks < MAX_TICKS {
        while ev < log.len() && log[ev] == ticks {
            match log[ev + 1] {
                0 => s.left = true,
                1 => s.left = false,
                2 => s.right = true,
                3 => s.right = false,
                4 => {
                    s.jump = true;
                    s.jump_buf = 0.14;
                }
                5 => s.jump = false,
                _ => return None,
            }
            ev += 2;
        }
        if ev < log.len() && log[ev] < ticks {
            return None;
        }
        s.tick();
        ticks += 1;
        if s.dead {
            return Some(Outcome { dist: s.dist, ticks });
        }
    }
    Some(Outcome { dist: s.dist, ticks })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Rec {
        seed: u32,
        log: Vec<u64>,
        dist: f64,
        ticks: u64,
    }

    #[test]
    fn server_replays_match_the_browser() {
        let fixtures: Vec<Rec> = serde_json::from_str(include_str!("../tests/fixtures/run_replays.json")).unwrap();
        assert!(!fixtures.is_empty());
        for f in fixtures {
            let o = replay(f.seed, &f.log).expect("zapis");
            assert_eq!((o.dist.to_bits(), o.ticks), (f.dist.to_bits(), f.ticks), "ziarno {}: {} vs {}", f.seed, o.dist, f.dist);
        }
    }

    #[test]
    fn recording_from_the_real_scene_replays_the_same() {
        // nagranie z prawdziwej sceny (three/runScene.ts): skręt w prawo i skok w 16. kroku, bieg skończony po 841 krokach na 114 m
        let o = replay(12345, &[16, 2, 16, 3, 16, 4, 16, 5]).unwrap();
        assert_eq!((o.ticks, o.dist.floor() as i64), (841, 114));
    }

    #[test]
    fn bad_logs_are_rejected() {
        assert!(replay(1, &[5]).is_none());
        assert!(replay(1, &[10, 0, 3, 1]).is_none());
        assert!(replay(1, &[0, 9]).is_none());
        // bez klawiszy biegacz w końcu wpada w dziurę albo przeszkodę
        let o = replay(7, &[]).unwrap();
        assert!(o.ticks < MAX_TICKS && o.dist > 0.0);
    }
}
