//! Pinball po stronie serwera: odtwarza grę z zapisu wciśnięć i sam liczy punkty, więc wynik z przeglądarki nie jest brany
//! na słowo. To port `web/src/features/pinball/core.ts` BIT W BIT: te same operacje w tej samej kolejności, stały krok
//! `TICK`, generator `Rng` z ziarnem od serwera, własne `fsin` / `fcos` / `fexp` zamiast libm. Z f64 używamy tylko + - * /
//! sqrt floor abs min max (IEEE daje wszędzie ten sam wynik). Zmieniając rdzeń w jednym miejscu, zmień go w drugim i
//! uruchom test zgodności (`cargo test pinball_sim`, fixture `tests/fixtures/pinball_replays.json`).
//! Dźwięki, iskry, napisy i kamera nie wpływają na wynik, więc ich tu nie ma.

use std::f64::consts::PI;
use std::sync::LazyLock;

use serde::Deserialize;
use serde_json::Value;

const R: f64 = 9.0;
const G: f64 = 1450.0;
const SUB: usize = 4;
pub const TICK: f64 = 1.0 / 120.0;
const VMAX: f64 = 2600.0;
const AXIS: f64 = 214.0;
const LANE_X: f64 = 418.0;
const BALLS: i64 = 3;
const SAVE_TIME: f64 = 9.0;
const LEN: f64 = 70.0;
const FR0: f64 = 11.0;
const FR1: f64 = 6.0;
const LANE_Y: f64 = 112.0;
const LANES: [f64; 4] = [139.0, 189.0, 239.0, 289.0];
const ORBIT_X: f64 = 230.0;
const ORBIT_Y: f64 = 24.0;
const TAU: f64 = 2.0 * PI;

// ---------- matematyka deterministyczna ----------
fn hyp(a: f64, b: f64) -> f64 {
    (a * a + b * b).sqrt()
}
fn fsin(x: f64) -> f64 {
    let r = x - TAU * (x / TAU + 0.5).floor();
    let r2 = r * r;
    let (mut t, mut s) = (r, r);
    for i in 1..=10 {
        let i = i as f64;
        t = -t * r2 / ((2.0 * i) * (2.0 * i + 1.0));
        s += t;
    }
    s
}
fn fcos(x: f64) -> f64 {
    let r = x - TAU * (x / TAU + 0.5).floor();
    let r2 = r * r;
    let (mut t, mut s) = (1.0, 1.0);
    for i in 1..=10 {
        let i = i as f64;
        t = -t * r2 / ((2.0 * i - 1.0) * (2.0 * i));
        s += t;
    }
    s
}
fn fexp(x: f64) -> f64 {
    let (mut t, mut s) = (1.0, 1.0);
    for i in 1..=14 {
        t = t * x / i as f64;
        s += t;
    }
    s
}
fn clamp(v: f64, a: f64, b: f64) -> f64 {
    a.max(b.min(v))
}

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

// ---------- poziomy (te same dane co w przeglądarce: web/src/features/pinball/levels.json) ----------
#[derive(Deserialize)]
struct Targets {
    labels: String,
    ys: Vec<f64>,
}
#[derive(Deserialize)]
struct Pad {
    a: [f64; 2],
    b: [f64; 2],
}
#[derive(Deserialize)]
struct Upper {
    x: f64,
    y: f64,
    side: String,
    len: Option<f64>,
}
#[derive(Deserialize)]
struct PortalSpec {
    a: [f64; 2],
    b: [f64; 2],
}
#[derive(Deserialize)]
struct HoleSpec {
    x: f64,
    y: f64,
    pull: Option<f64>,
}
#[derive(Deserialize)]
struct SpinnerSpec {
    x: f64,
    y: f64,
    w: f64,
}
#[derive(Deserialize)]
struct MoverSpec {
    cx: f64,
    cy: f64,
    ax: f64,
    ay: Option<f64>,
    period: f64,
    phase: Option<f64>,
    r: f64,
    skin: String,
}
#[derive(Deserialize)]
struct Fan {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    fx: f64,
    fy: f64,
}
#[derive(Deserialize)]
struct Sticky {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}
#[derive(Deserialize)]
struct BladeSpec {
    x: f64,
    y: f64,
    len: f64,
    w: f64,
}
#[derive(Deserialize)]
struct Spec {
    id: u32,
    #[serde(rename = "H")]
    h: f64,
    saucer: f64,
    bumpers: Vec<Vec<Value>>,
    drops: Targets,
    stands: Targets,
    #[serde(default)]
    walls: Vec<Vec<[f64; 2]>>,
    #[serde(default)]
    posts: Vec<Vec<f64>>,
    #[serde(default)]
    pads: Vec<Pad>,
    #[serde(default)]
    uppers: Vec<Upper>,
    #[serde(default)]
    portals: Vec<PortalSpec>,
    #[serde(default)]
    holes: Vec<HoleSpec>,
    #[serde(default)]
    spinners: Vec<SpinnerSpec>,
    #[serde(default)]
    movers: Vec<MoverSpec>,
    #[serde(default)]
    fans: Vec<Fan>,
    #[serde(default)]
    sticky: Vec<Sticky>,
    #[serde(default)]
    blades: Vec<BladeSpec>,
}

static LEVELS: LazyLock<Vec<Spec>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../web/src/features/pinball/levels.json")).expect("pinball levels.json: nieprawidłowe dane")
});

pub fn level_count() -> usize {
    LEVELS.len()
}

// ---------- geometria ----------
#[derive(Clone, Copy)]
struct P {
    x: f64,
    y: f64,
}
#[derive(Clone, Copy)]
struct Seg {
    a: P,
    b: P,
    r: f64,
}
fn seg(ax: f64, ay: f64, bx: f64, by: f64, r: f64) -> Seg {
    Seg { a: P { x: ax, y: ay }, b: P { x: bx, y: by }, r }
}
fn polyline(pts: &[[f64; 2]], r: f64) -> Vec<Seg> {
    (1..pts.len()).map(|i| seg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r)).collect()
}
fn mirror(pts: &[[f64; 2]]) -> Vec<[f64; 2]> {
    pts.iter().map(|p| [AXIS * 2.0 - p[0], p[1]]).collect()
}

fn closest(p: P, a: P, b: P) -> P {
    let (abx, aby) = (b.x - a.x, b.y - a.y);
    let t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby), 0.0, 1.0);
    P { x: a.x + abx * t, y: a.y + aby * t }
}

#[derive(Clone)]
struct Ball {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    held: f64,
    cool: f64,
    auto: f64,
    gone: bool,
    still: f64,
    blast: bool,
}

/// kulka o okrąg (cx, cy, rad), który może się ruszać z prędkością (svx, svy); zwraca siłę uderzenia albo -1
#[allow(clippy::too_many_arguments)]
fn collide(b: &mut Ball, cx: f64, cy: f64, rad: f64, rest: f64, kick: f64, svx: f64, svy: f64) -> f64 {
    let (dx, dy) = (b.x - cx, b.y - cy);
    let min = R + rad;
    let d2 = dx * dx + dy * dy;
    if d2 >= min * min {
        return -1.0;
    }
    let d = d2.sqrt();
    let d = if d == 0.0 { 1e-4 } else { d };
    let (nx, ny) = (dx / d, dy / d);
    b.x = cx + nx * min;
    b.y = cy + ny * min;
    let (rvx, rvy) = (b.vx - svx, b.vy - svy);
    let vn = rvx * nx + rvy * ny;
    if vn >= 0.0 {
        return 0.0;
    }
    let (tx, ty) = (-ny, nx);
    let vt = (rvx * tx + rvy * ty) * 0.985;
    let out = -vn * rest + kick;
    b.vx = svx + nx * out + tx * vt;
    b.vy = svy + ny * out + ty * vt;
    -vn
}
fn seg_hit(b: &mut Ball, s: &Seg, rest: f64, kick: f64) -> f64 {
    let c = closest(P { x: b.x, y: b.y }, s.a, s.b);
    collide(b, c.x, c.y, s.r, rest, kick, 0.0, 0.0)
}

struct Geo {
    h: f64,
    walls: Vec<Seg>,
    posts: Vec<(f64, f64, f64)>,
    pads: Vec<Seg>,
    sling_l: Vec<[f64; 2]>,
    sling_r: Vec<[f64; 2]>,
    saucer: P,
}

fn build_geo(spec: &Spec) -> Geo {
    let h = spec.h;
    let dy = h - 840.0;
    let arc: Vec<[f64; 2]> = (0..33)
        .map(|i| {
            let t = PI + PI * f64::from(i) / 32.0;
            [230.0 + 220.0 * fcos(t), 230.0 + 220.0 * fsin(t)]
        })
        .collect();
    let guide_l = vec![[45.0, 590.0 + dy], [45.0, 676.0 + dy], [128.0, 720.0 + dy]];
    let guide_r = mirror(&guide_l);
    let sling_l = vec![[78.0, 612.0 + dy], [78.0, 662.0 + dy], [110.0, 680.0 + dy]];
    let sling_r = mirror(&sling_l);
    let mut walls = polyline(&arc, 3.0);
    walls.push(seg(10.0, 230.0, 10.0, h + 60.0, 3.0));
    walls.push(seg(450.0, 230.0, 450.0, h + 60.0, 3.0));
    walls.push(seg(LANE_X, 206.0, LANE_X, h + 60.0, 3.0));
    walls.extend(polyline(&guide_l, 3.0));
    walls.extend(polyline(&guide_r, 3.0));
    for s in [&sling_l, &sling_r] {
        walls.extend(polyline(&s[0..2], 3.0));
        walls.extend(polyline(&s[1..], 3.0));
    }
    for x in [114.0, 164.0, 214.0, 264.0, 314.0] {
        walls.push(seg(x, 92.0, x, 132.0, 4.0));
    }
    for w in &spec.walls {
        walls.extend(polyline(w, 4.0));
    }
    let mut posts = vec![(45.0, 590.0 + dy, 5.0), (383.0, 590.0 + dy, 5.0)];
    for p in &spec.posts {
        posts.push((p[0], p[1], p.get(2).copied().unwrap_or(6.0)));
    }
    let pads = spec.pads.iter().map(|p| seg(p.a[0], p.a[1], p.b[0], p.b[1], 5.0)).collect();
    Geo { h, walls, posts, pads, sling_l, sling_r, saucer: P { x: AXIS, y: spec.saucer } }
}

// ---------- stan gry ----------
struct Flip {
    x: f64,
    y: f64,
    rest: f64,
    up: f64,
    ang: f64,
    w: f64,
    len: f64,
}
struct Sling {
    s: Seg,
    nx: f64,
    ny: f64,
}
struct Bumper {
    x: f64,
    y: f64,
    r: f64,
}
struct Drop {
    s: Seg,
    down: bool,
}
struct Stand {
    s: Seg,
    lit: bool,
}
struct Lane {
    x: f64,
    lit: bool,
    cool: f64,
}
struct Portal {
    a: P,
    b: P,
}
struct Hole {
    x: f64,
    y: f64,
    pull: f64,
}
struct Spinner {
    x: f64,
    y: f64,
    w: f64,
    spin: f64,
    cool: f64,
}
struct Mover {
    cx: f64,
    cy: f64,
    ax: f64,
    ay: f64,
    period: f64,
    phase: f64,
    r: f64,
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    duck: bool,
}
struct Blade {
    x: f64,
    y: f64,
    len: f64,
    w: f64,
    ang: f64,
    cool: f64,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Phase {
    Attract,
    Play,
    Over,
}

pub struct Sim {
    geo: Geo,
    rng: Rng,
    pub tick: u32,
    time: f64,
    pub phase: Phase,
    pub score: f64,
    ball_no: i64,
    mult: f64,
    extra: i64,
    balls: Vec<Ball>,
    queue: i64,
    queue_t: f64,
    save_t: f64,
    save_armed: bool,
    multiball: bool,
    jackpots: f64,
    tilted: bool,
    nudges: Vec<f64>,
    charge: f64,
    charging: bool,
    over_t: f64,
    keys: [bool; 2],
    fl: Flip,
    fr: Flip,
    ups: Vec<(bool, Flip)>,   // (lewa?, łapa)
    bumpers: Vec<Bumper>,
    slings: Vec<Sling>,
    drops: Vec<Drop>,
    stands: Vec<Stand>,
    lanes: Vec<Lane>,
    drops_reset: f64,
    vhs_done: bool,
    rad_done: bool,
    orbit_cool: f64,
    portals: Vec<Portal>,
    holes: Vec<Hole>,
    spinners: Vec<Spinner>,
    movers: Vec<Mover>,
    blades: Vec<Blade>,
    fans: Vec<Fan>,
    sticky: Vec<Sticky>,
}

/// Kody zdarzeń w zapisie gry (jak `INPUT_CODES` w core.ts)
#[derive(Clone, Copy)]
pub enum Input {
    LeftDown,
    LeftUp,
    RightDown,
    RightUp,
    PlungerDown,
    PlungerUp,
    Nudge,
}
impl Input {
    pub fn from_code(c: u32) -> Option<Input> {
        Some(match c {
            0 => Input::LeftDown,
            1 => Input::LeftUp,
            2 => Input::RightDown,
            3 => Input::RightUp,
            4 => Input::PlungerDown,
            5 => Input::PlungerUp,
            6 => Input::Nudge,
            _ => return None,
        })
    }
}

fn sling_of(pts: &[[f64; 2]]) -> Sling {
    let s = seg(pts[0][0], pts[0][1], pts[2][0], pts[2][1], 3.0);
    let (dx, dy) = (s.b.x - s.a.x, s.b.y - s.a.y);
    let l = hyp(dx, dy);
    let (mut nx, mut ny) = (dy / l, -dx / l);
    if nx * (AXIS - s.a.x) < 0.0 {
        nx = -nx;
        ny = -ny;
    }
    Sling { s, nx, ny }
}

impl Sim {
    pub fn new(level: usize, seed: u32) -> Option<Sim> {
        let spec = LEVELS.get(level.checked_sub(1)?)?;
        let geo = build_geo(spec);
        let dy = geo.h - 840.0;
        let mk_upper = |u: &Upper| {
            let left = u.side == "l";
            let f = Flip {
                x: u.x,
                y: u.y,
                rest: if left { 0.52 } else { PI - 0.52 },
                up: if left { -0.52 } else { PI + 0.52 },
                ang: if left { 0.52 } else { PI - 0.52 },
                w: 0.0,
                len: u.len.unwrap_or(56.0),
            };
            (left, f)
        };
        let num = |v: &Vec<Value>, i: usize| v.get(i).and_then(Value::as_f64);
        let sim = Sim {
            rng: Rng(seed),
            tick: 0,
            time: 0.0,
            phase: Phase::Attract,
            score: 0.0,
            ball_no: 1,
            mult: 1.0,
            extra: 0,
            balls: vec![],
            queue: 0,
            queue_t: 0.0,
            save_t: 0.0,
            save_armed: false,
            multiball: false,
            jackpots: 0.0,
            tilted: false,
            nudges: vec![],
            charge: 0.0,
            charging: false,
            over_t: 0.0,
            keys: [false, false],
            fl: Flip { x: 134.0, y: 735.0 + dy, rest: 0.52, up: -0.52, ang: 0.52, w: 0.0, len: LEN },
            fr: Flip { x: 294.0, y: 735.0 + dy, rest: PI - 0.52, up: PI + 0.52, ang: PI - 0.52, w: 0.0, len: LEN },
            ups: spec.uppers.iter().map(mk_upper).collect(),
            bumpers: spec.bumpers.iter().map(|b| Bumper { x: num(b, 0).unwrap_or(0.0), y: num(b, 1).unwrap_or(0.0), r: num(b, 2).unwrap_or(22.0) }).collect(),
            slings: vec![sling_of(&geo.sling_l), sling_of(&geo.sling_r)],
            drops: spec.drops.ys.iter().map(|y| Drop { s: seg(30.0, y - 13.0, 30.0, y + 13.0, 4.0), down: false }).collect(),
            stands: spec.stands.ys.iter().map(|y| Stand { s: seg(404.0, y - 13.0, 404.0, y + 13.0, 4.0), lit: false }).collect(),
            lanes: LANES.iter().map(|x| Lane { x: *x, lit: false, cool: 0.0 }).collect(),
            drops_reset: 0.0,
            vhs_done: false,
            rad_done: false,
            orbit_cool: 0.0,
            portals: spec.portals.iter().map(|p| Portal { a: P { x: p.a[0], y: p.a[1] }, b: P { x: p.b[0], y: p.b[1] } }).collect(),
            holes: spec.holes.iter().map(|h| Hole { x: h.x, y: h.y, pull: h.pull.unwrap_or(90.0) }).collect(),
            spinners: spec.spinners.iter().map(|s| Spinner { x: s.x, y: s.y, w: s.w, spin: 0.0, cool: 0.0 }).collect(),
            movers: spec
                .movers
                .iter()
                .map(|m| Mover {
                    cx: m.cx,
                    cy: m.cy,
                    ax: m.ax,
                    ay: m.ay.unwrap_or(0.0),
                    period: m.period,
                    phase: m.phase.unwrap_or(0.0),
                    r: m.r,
                    x: m.cx,
                    y: m.cy,
                    vx: 0.0,
                    vy: 0.0,
                    duck: m.skin == "duck",
                })
                .collect(),
            blades: spec.blades.iter().map(|b| Blade { x: b.x, y: b.y, len: b.len, w: b.w, ang: 0.0, cool: 0.0 }).collect(),
            fans: spec.fans.iter().map(|f| Fan { x: f.x, y: f.y, w: f.w, h: f.h, fx: f.fx, fy: f.fy }).collect(),
            sticky: spec.sticky.iter().map(|z| Sticky { x: z.x, y: z.y, w: z.w, h: z.h }).collect(),
            geo,
        };
        let _ = (spec.id, &spec.drops.labels, &spec.stands.labels);   // etykiety i id służą tylko przeglądarce
        Some(sim)
    }

    // ---------- zasady ----------
    fn add(&mut self, pts: f64) {
        if self.phase != Phase::Play || self.tilted {
            return;
        }
        self.score += pts * self.mult;
    }

    fn in_lane(&self, b: &Ball) -> bool {
        b.x > LANE_X && b.y > self.geo.h - 280.0
    }
    fn new_ball(&self) -> Ball {
        Ball { x: 434.0, y: self.geo.h - 60.0, vx: 0.0, vy: 0.0, held: 0.0, cool: 0.0, auto: 0.0, gone: false, still: 0.0, blast: false }
    }
    fn serve(&mut self) {
        self.balls = vec![self.new_ball()];
        self.save_armed = true;
        self.tilted = false;
        self.nudges.clear();
    }
    pub fn start(&mut self) {
        if self.phase == Phase::Play {
            return;
        }
        self.phase = Phase::Play;
        self.score = 0.0;
        self.ball_no = 1;
        self.mult = 1.0;
        self.extra = 0;
        self.jackpots = 0.0;
        self.multiball = false;
        self.queue = 0;
        for l in &mut self.lanes {
            l.lit = false;
        }
        for d in &mut self.drops {
            d.down = false;
        }
        for s in &mut self.stands {
            s.lit = false;
        }
        self.vhs_done = false;
        self.rad_done = false;
        self.serve();
    }
    fn end_ball(&mut self) {
        if self.extra > 0 {
            self.extra -= 1;
            self.serve();
            return;
        }
        self.ball_no += 1;
        self.mult = 1.0;
        if self.ball_no > BALLS {
            self.phase = Phase::Over;
            self.over_t = 0.0;
        } else {
            self.serve();
        }
    }
    fn drained(&mut self, i: usize) {
        self.balls[i].gone = true;
        let left = self.balls.iter().filter(|x| !x.gone).count() as i64 + self.queue;
        if self.multiball && left <= 1 {
            self.multiball = false;
        }
        if left > 0 {
            return;
        }
        if self.save_t > 0.0 && !self.tilted {
            self.queue = 1;
            self.queue_t = 0.5;
            self.save_t = 0.0;
            return;
        }
        self.end_ball();
    }
    fn start_multiball(&mut self) {
        self.multiball = true;
        self.jackpots = 0.0;
        self.vhs_done = false;
        self.rad_done = false;
        for s in &mut self.stands {
            s.lit = false;
        }
        self.queue += 2;
        self.queue_t = 1.2;
        self.save_t = self.save_t.max(15.0);
    }
    fn launch(&mut self, i: usize, power: f64) {
        let jitter = self.rng.next();
        let b = &mut self.balls[i];
        b.vy = -(950.0 + 1650.0 * power) - jitter * 40.0;
        b.vx = 0.0;
        if self.save_armed {
            self.save_t = SAVE_TIME;
            self.save_armed = false;
        }
    }

    // ---------- wejście gracza ----------
    fn flipper_pressed(&mut self, left: bool) {
        if self.phase != Phase::Play || self.tilted {
            return;
        }
        let mut lit: Vec<bool> = self.lanes.iter().map(|l| l.lit).collect();
        if left {
            let f = lit.remove(0);
            lit.push(f);
        } else {
            let l = lit.pop().unwrap_or(false);
            lit.insert(0, l);
        }
        for (l, v) in self.lanes.iter_mut().zip(lit) {
            l.lit = v;
        }
    }
    fn set_flip(&mut self, left: bool, on: bool) {
        let k = usize::from(!left);
        if self.keys[k] == on {
            return;
        }
        self.keys[k] = on;
        if on {
            self.flipper_pressed(left);
        }
    }
    fn nudge(&mut self) {
        if self.phase != Phase::Play || self.tilted {
            return;
        }
        let now = self.time;
        self.nudges.retain(|t| now - t < 4.0);
        self.nudges.push(now);
        for i in 0..self.balls.len() {
            let (held, lane) = (self.balls[i].held, self.in_lane(&self.balls[i]));
            if !(held != 0.0) && !lane {
                let r = self.rng.next();
                let b = &mut self.balls[i];
                b.vx += (r - 0.5) * 160.0;
                b.vy -= 90.0;
            }
        }
        if self.nudges.len() >= 4 {
            self.tilted = true;
        }
    }
    fn plunger_down(&mut self) {
        if self.balls.iter().any(|b| self.in_lane(b) && !(b.auto != 0.0)) {
            self.charging = true;
        } else {
            self.nudge();
        }
    }
    fn plunger_up(&mut self) {
        if !self.charging {
            return;
        }
        self.charging = false;
        let h = self.geo.h;
        let idx = self.balls.iter().position(|x| self.in_lane(x) && !x.gone && !(x.auto != 0.0));
        if let Some(i) = idx {
            if self.balls[i].y > h - 100.0 {
                let c = self.charge;
                self.launch(i, c);
            }
        }
        self.charge = 0.0;
    }
    pub fn input(&mut self, code: Input) {
        if self.phase != Phase::Play {
            return;
        }
        match code {
            Input::LeftDown => self.set_flip(true, true),
            Input::LeftUp => self.set_flip(true, false),
            Input::RightDown => self.set_flip(false, true),
            Input::RightUp => self.set_flip(false, false),
            Input::PlungerDown => self.plunger_down(),
            Input::PlungerUp => self.plunger_up(),
            Input::Nudge => self.nudge(),
        }
    }

    // ---------- zasady przy trafieniach ----------
    fn lane_hit(&mut self, i: usize) {
        if self.lanes[i].cool > 0.0 {
            return;
        }
        self.lanes[i].cool = 0.5;
        if self.lanes[i].lit {
            self.add(100.0);
            return;
        }
        self.lanes[i].lit = true;
        self.add(500.0);
        if self.lanes.iter().all(|x| x.lit) {
            for x in &mut self.lanes {
                x.lit = false;
            }
            if self.mult < 5.0 {
                self.mult += 1.0;
            } else {
                self.add(10000.0);
            }
        }
    }
    fn bank_check(&mut self) {
        if !self.vhs_done && self.drops.iter().all(|d| d.down) {
            self.vhs_done = true;
            self.add(5000.0);
            self.drops_reset = 1.6;
        }
        if !self.rad_done && self.stands.iter().all(|s| s.lit) {
            self.rad_done = true;
            self.add(5000.0);
        }
    }
    fn saucer_hit(&mut self, i: usize) {
        let sa = self.geo.saucer;
        {
            let b = &mut self.balls[i];
            b.held = 1.3;
            b.vx = 0.0;
            b.vy = 0.0;
            b.x = sa.x;
            b.y = sa.y;
        }
        if self.multiball {
            self.jackpots += 1.0;
            let v = 25000.0 * self.jackpots;
            self.add(v);
        } else if self.vhs_done && self.rad_done && self.phase == Phase::Play && !self.tilted {
            self.balls[i].held = 2.2;
            self.start_multiball();
        } else {
            self.add(2500.0);
        }
    }

    // ---------- fizyka ----------
    fn step_flip(f: &mut Flip, on: bool, dt: f64) {
        let target = if on { f.up } else { f.rest };
        let sp = if on { 24.0 } else { 14.0 };
        let prev = f.ang;
        f.ang = if f.ang < target { target.min(f.ang + sp * dt) } else { target.max(f.ang - sp * dt) };
        f.w = (f.ang - prev) / dt;
    }
    fn flip_hit(b: &mut Ball, f: &Flip) {
        let tip = P { x: f.x + fcos(f.ang) * f.len, y: f.y + fsin(f.ang) * f.len };
        let c = closest(P { x: b.x, y: b.y }, P { x: f.x, y: f.y }, tip);
        let t = hyp(c.x - f.x, c.y - f.y) / f.len;
        let rad = FR0 + (FR1 - FR0) * t;
        let (svx, svy) = (-f.w * (c.y - f.y), f.w * (c.x - f.x));
        collide(b, c.x, c.y, rad, 0.28, 0.0, svx, svy);
    }

    fn extras(&mut self, i: usize, dt: f64) {
        if self.balls[i].held > 0.0 {
            return;
        }
        for f in &self.fans {
            let b = &mut self.balls[i];
            if b.x > f.x && b.x < f.x + f.w && b.y > f.y && b.y < f.y + f.h {
                b.vx += f.fx * dt;
                b.vy += f.fy * dt;
            }
        }
        for z in &self.sticky {
            let b = &mut self.balls[i];
            if b.x > z.x && b.x < z.x + z.w && b.y > z.y && b.y < z.y + z.h {
                let d = fexp(-5.0 * dt);
                b.vx *= d;
                b.vy *= d;
            }
        }
        for pi in 0..self.portals.len() {
            if self.balls[i].cool > 0.0 {
                break;
            }
            let (pa, pb) = (self.portals[pi].a, self.portals[pi].b);
            for (from, to) in [(pa, pb), (pb, pa)] {
                let b = &self.balls[i];
                if hyp(b.x - from.x, b.y - from.y) < 15.0 {
                    let b = &mut self.balls[i];
                    b.x = to.x;
                    b.y = to.y;
                    b.cool = 0.6;
                    self.add(250.0);
                    break;
                }
            }
        }
        for hi in 0..self.holes.len() {
            let (hx, hy, pull) = (self.holes[hi].x, self.holes[hi].y, self.holes[hi].pull);
            let (dx, dy) = (hx - self.balls[i].x, hy - self.balls[i].y);
            let d = hyp(dx, dy);
            if d < pull && d > 1.0 {
                let q = 1.0 - d / pull;
                let a = 3200.0 * (q * q.sqrt());
                let b = &mut self.balls[i];
                b.vx += (dx / d) * a * dt;
                b.vy += (dy / d) * a * dt;
            }
            if d < 13.0 && self.balls[i].cool <= 0.0 {
                let b = &mut self.balls[i];
                b.held = 1.4;
                b.blast = true;
                b.vx = 0.0;
                b.vy = 0.0;
                b.x = hx;
                b.y = hy;
                self.add(1000.0);
            }
        }
        for si in 0..self.spinners.len() {
            let (sx, sy, sw, scool) = (self.spinners[si].x, self.spinners[si].y, self.spinners[si].w, self.spinners[si].cool);
            let b = &self.balls[i];
            if scool <= 0.0 && (b.x - sx).abs() < sw / 2.0 && (b.y - sy).abs() < 10.0 {
                let v = hyp(b.vx, b.vy);
                if v > 150.0 {
                    let dir = if b.vx >= 0.0 { 1.0 } else { -1.0 };
                    let s = &mut self.spinners[si];
                    s.cool = 0.12;
                    s.spin = 26.0_f64.min(6.0 + v / 70.0) * dir;
                    self.add(50.0);
                }
            }
        }
        for mi in 0..self.movers.len() {
            let (mx, my, mr, mvx, mvy, duck) = {
                let m = &self.movers[mi];
                (m.x, m.y, m.r, m.vx, m.vy, m.duck)
            };
            let hit = collide(&mut self.balls[i], mx, my, mr, 0.7, 260.0, mvx, mvy);
            if hit > 60.0 {
                self.add(if duck { 300.0 } else { 150.0 });
            }
        }
        for bi in 0..self.blades.len() {
            let bl = &self.blades[bi];
            let ca = fcos(bl.ang) * bl.len / 2.0;
            let sa = fsin(bl.ang) * bl.len / 2.0;
            let (bx, by, bw, bcool) = (bl.x, bl.y, bl.w, bl.cool);
            let c = closest(P { x: self.balls[i].x, y: self.balls[i].y }, P { x: bx - ca, y: by - sa }, P { x: bx + ca, y: by + sa });
            let hit = collide(&mut self.balls[i], c.x, c.y, 5.0, 0.8, 120.0, -bw * (c.y - by), bw * (c.x - bx));
            if hit > 80.0 && bcool <= 0.0 {
                self.blades[bi].cool = 0.15;
                self.add(200.0);
            }
        }
        for pi in 0..self.geo.pads.len() {
            let pd = self.geo.pads[pi];
            let hit = seg_hit(&mut self.balls[i], &pd, 0.5, 420.0);
            if hit > 80.0 {
                self.add(75.0);
            }
        }
    }

    fn step_ball(&mut self, i: usize, dt: f64) {
        if self.balls[i].gone || self.balls[i].held > 0.0 {
            return;
        }
        let h = self.geo.h;
        let sa = self.geo.saucer;
        let sp = {
            let b = &mut self.balls[i];
            b.vy += G * dt;
            let sp = hyp(b.vx, b.vy);
            if sp > VMAX {
                b.vx *= VMAX / sp;
                b.vy *= VMAX / sp;
            }
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            sp
        };
        for k in 0..self.geo.walls.len() {
            let s = self.geo.walls[k];
            seg_hit(&mut self.balls[i], &s, 0.45, 0.0);
        }
        for k in 0..self.geo.posts.len() {
            let (px, py, pr) = self.geo.posts[k];
            collide(&mut self.balls[i], px, py, pr, 0.6, 0.0, 0.0, 0.0);
        }
        {
            let b = &mut self.balls[i];
            if b.vy > 0.0 && b.y < 206.0 && b.x > LANE_X - R {
                seg_hit(b, &seg(449.0, 188.0, LANE_X, 206.0, 2.0), 0.3, 0.0);
            }
            // tłok wyrzutni
            if b.x > LANE_X && b.y > h - 40.0 + self.charge * 28.0 - R {
                b.y = h - 40.0 + self.charge * 28.0 - R;
                if b.vy > 0.0 {
                    b.vy = 0.0;
                }
                b.vx = 0.0;
                b.x = 434.0;
            }
        }
        for k in 0..self.bumpers.len() {
            let u = &self.bumpers[k];
            let (ux, uy, ur) = (u.x, u.y, u.r);
            if collide(&mut self.balls[i], ux, uy, ur, 0.6, 420.0, 0.0, 0.0) > 0.0 {
                self.add(100.0);
            }
        }
        self.extras(i, dt);
        for k in 0..self.slings.len() {
            let (s, nx, ny) = (self.slings[k].s, self.slings[k].nx, self.slings[k].ny);
            let hit = seg_hit(&mut self.balls[i], &s, 0.4, 0.0);
            if hit > 60.0 {
                let b = &mut self.balls[i];
                b.vx += nx * 520.0;
                b.vy += ny * 520.0;
                self.add(10.0);
            }
        }
        for k in 0..self.drops.len() {
            if self.drops[k].down {
                continue;
            }
            let s = self.drops[k].s;
            if seg_hit(&mut self.balls[i], &s, 0.35, 0.0) > 40.0 {
                self.drops[k].down = true;
                self.add(1000.0);
                self.bank_check();
            }
        }
        for k in 0..self.stands.len() {
            let s = self.stands[k].s;
            if seg_hit(&mut self.balls[i], &s, 0.35, 0.0) > 40.0 {
                if !self.stands[k].lit {
                    self.stands[k].lit = true;
                    self.add(750.0);
                    self.bank_check();
                } else {
                    self.add(150.0);
                }
            }
        }
        for k in 0..self.ups.len() {
            Self::flip_hit(&mut self.balls[i], &self.ups[k].1);
        }
        Self::flip_hit(&mut self.balls[i], &self.fl);
        Self::flip_hit(&mut self.balls[i], &self.fr);

        // czujniki
        for li in 0..self.lanes.len() {
            let (lx, b) = (self.lanes[li].x, &self.balls[i]);
            if (b.x - lx).abs() < 14.0 && (b.y - LANE_Y).abs() < 12.0 {
                self.lane_hit(li);
            }
        }
        let b = &self.balls[i];
        if b.cool <= 0.0 && hyp(b.x - sa.x, b.y - sa.y) < 14.0 && sp < 900.0 {
            self.saucer_hit(i);
        }
        let b = &self.balls[i];
        if self.orbit_cool <= 0.0 && hyp(b.x - ORBIT_X, b.y - ORBIT_Y) < 22.0 && b.vx.abs() > 250.0 {
            self.orbit_cool = 1.2;
            self.add(1500.0);
        }
        if self.balls[i].y > h + 30.0 {
            self.drained(i);
        }
    }

    fn balls_collide(&mut self) {
        let live: Vec<usize> = (0..self.balls.len()).filter(|&k| !self.balls[k].gone && self.balls[k].held <= 0.0).collect();
        for x in 0..live.len() {
            for y in (x + 1)..live.len() {
                let (ia, ib) = (live[x], live[y]);
                let (dx, dy) = (self.balls[ib].x - self.balls[ia].x, self.balls[ib].y - self.balls[ia].y);
                let d = hyp(dx, dy);
                if d >= R * 2.0 || d == 0.0 {
                    continue;
                }
                let (nx, ny) = (dx / d, dy / d);
                let o = (R * 2.0 - d) / 2.0;
                self.balls[ia].x -= nx * o;
                self.balls[ia].y -= ny * o;
                self.balls[ib].x += nx * o;
                self.balls[ib].y += ny * o;
                let rv = (self.balls[ib].vx - self.balls[ia].vx) * nx + (self.balls[ib].vy - self.balls[ia].vy) * ny;
                if rv < 0.0 {
                    self.balls[ia].vx += rv * nx * 0.95;
                    self.balls[ia].vy += rv * ny * 0.95;
                    self.balls[ib].vx -= rv * nx * 0.95;
                    self.balls[ib].vy -= rv * ny * 0.95;
                }
            }
        }
    }

    /// Jeden stały krok symulacji (jak `Sim.step` w core.ts)
    pub fn step(&mut self) {
        let dt = TICK;
        self.tick += 1;
        self.time += dt;
        let on = self.phase == Phase::Play && !self.tilted;
        let dts = dt / SUB as f64;
        for m in &mut self.movers {
            let w = TAU / m.period;
            let a = w * self.time + m.phase;
            let (sn, cs) = (fsin(a), fcos(a));
            m.x = m.cx + m.ax * sn;
            m.y = m.cy + m.ay * sn;
            m.vx = m.ax * w * cs;
            m.vy = m.ay * w * cs;
        }
        for bl in &mut self.blades {
            bl.ang += bl.w * dt;
        }
        for _ in 0..SUB {
            let (kl, kr) = (self.keys[0], self.keys[1]);
            Self::step_flip(&mut self.fl, on && kl, dts);
            Self::step_flip(&mut self.fr, on && kr, dts);
            for (left, f) in &mut self.ups {
                Self::step_flip(f, on && if *left { kl } else { kr }, dts);
            }
            for i in 0..self.balls.len() {
                self.step_ball(i, dts);
            }
            self.balls_collide();
        }
        self.balls.retain(|b| !b.gone);

        let h = self.geo.h;
        for i in 0..self.balls.len() {
            if self.balls[i].cool > 0.0 {
                self.balls[i].cool -= dt;
            }
            if self.balls[i].held > 0.0 {
                self.balls[i].held -= dt;
                if self.balls[i].held <= 0.0 {
                    self.balls[i].cool = 0.7;
                    if self.balls[i].blast {
                        let a = self.rng.next() * TAU;
                        let b = &mut self.balls[i];
                        b.vx = fcos(a) * 820.0;
                        b.vy = fsin(a) * 820.0;
                        b.blast = false;
                    } else {
                        let sign = if self.rng.next() < 0.5 { -1.0 } else { 1.0 };
                        let r = self.rng.next();
                        let b = &mut self.balls[i];
                        b.vx = sign * (120.0 + r * 160.0);
                        b.vy = 520.0;
                    }
                }
            }
            if self.balls[i].auto > 0.0 {
                self.balls[i].auto -= dt;
                if self.balls[i].auto <= 0.0 && self.in_lane(&self.balls[i]) {
                    let power = 0.85 + self.rng.next() * 0.15;
                    self.launch(i, power);
                }
            }
            // kulka zaklinowana gdzieś na stole: po chwili sama dostaje szturchnięcie
            let (held, in_lane, y, speed) = (self.balls[i].held, self.in_lane(&self.balls[i]), self.balls[i].y, hyp(self.balls[i].vx, self.balls[i].vy));
            if held <= 0.0 && !in_lane && ((!self.keys[0] && !self.keys[1]) || y < h - 230.0) && speed < 15.0 {
                self.balls[i].still += dt;
                if self.balls[i].still > 2.5 {
                    self.balls[i].still = 0.0;
                    let r = self.rng.next();
                    let b = &mut self.balls[i];
                    b.vx += (if b.x < AXIS { 1.0 } else { -1.0 }) * (80.0 + r * 80.0);
                    b.vy -= 220.0;
                }
            } else {
                self.balls[i].still = 0.0;
            }
        }
        if self.queue > 0 {
            self.queue_t -= dt;
            if self.queue_t <= 0.0 && !self.balls.iter().any(|b| self.in_lane(b)) {
                let mut nb = self.new_ball();
                nb.auto = 0.45;
                self.balls.push(nb);
                self.queue -= 1;
                self.queue_t = 0.9;
            }
        }
        if self.charging {
            self.charge = 1.0_f64.min(self.charge + dt * 1.1);
        }
        if self.save_t > 0.0 && !self.balls.iter().any(|b| self.in_lane(b)) {
            self.save_t -= dt;
        }
        if self.drops_reset > 0.0 {
            self.drops_reset -= dt;
            if self.drops_reset <= 0.0 {
                for d in &mut self.drops {
                    d.down = false;
                }
            }
        }
        if self.orbit_cool > 0.0 {
            self.orbit_cool -= dt;
        }
        for l in &mut self.lanes {
            l.cool -= dt;
        }
        for bl in &mut self.blades {
            bl.cool -= dt;
        }
        for s in &mut self.spinners {
            s.spin *= fexp(-1.6 * dt);
            s.cool -= dt;
        }
        if self.phase == Phase::Over {
            self.over_t += dt;
            if self.over_t > 5.0 {
                self.phase = Phase::Attract;
            }
        }
    }
}

/// Wynik odtworzenia gry
pub struct Outcome {
    /// punkty policzone przez serwer
    pub score: i64,
    /// liczba ticków do końca gry
    pub ticks: u32,
    /// czy gra doszła do końca (wszystkie kulki) przed limitem ticków
    pub over: bool,
}

/// Najwięcej zdarzeń w zapisie jednej gry
pub const MAX_EVENTS: usize = 60_000;
/// Najdłuższa gra (ticki): 60 minut
pub const MAX_TICKS: u32 = 60 * 60 * 120;

/// Odtwarza grę z ziarna i zapisu (`log` = naprzemiennie: tick, kod zdarzenia). None = zapis nieprawidłowy.
pub fn replay(level: usize, seed: u32, log: &[u64]) -> Option<Outcome> {
    if !log.len().is_multiple_of(2) || log.len() / 2 > MAX_EVENTS {
        return None;
    }
    let mut events = Vec::with_capacity(log.len() / 2);
    let mut last = 0u64;
    for pair in log.chunks(2) {
        let (t, c) = (pair[0], pair[1]);
        if t < last || t > u64::from(MAX_TICKS) {
            return None;
        }
        last = t;
        events.push((t as u32, Input::from_code(u32::try_from(c).ok()?)?));
    }
    let mut sim = Sim::new(level, seed)?;
    sim.start();
    let mut idx = 0;
    while sim.tick < MAX_TICKS {
        while idx < events.len() && events[idx].0 == sim.tick {
            sim.input(events[idx].1);
            idx += 1;
        }
        sim.step();
        if sim.phase == Phase::Over {
            return Some(Outcome { score: sim.score as i64, ticks: sim.tick, over: true });
        }
    }
    Some(Outcome { score: sim.score as i64, ticks: sim.tick, over: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_load() {
        assert_eq!(level_count(), 5);
        for l in 1..=level_count() {
            assert!(Sim::new(l, 1).is_some());
        }
        assert!(Sim::new(0, 1).is_none() && Sim::new(99, 1).is_none());
    }

    #[test]
    fn math_is_close_to_libm() {
        for i in -50..50 {
            let x = f64::from(i) * 0.37;
            assert!((fsin(x) - x.sin()).abs() < 1e-6, "sin {x}");
            assert!((fcos(x) - x.cos()).abs() < 1e-6, "cos {x}");
        }
        assert!((fexp(-0.01) - (-0.01_f64).exp()).abs() < 1e-12);
    }

    #[test]
    fn invalid_logs_are_rejected() {
        assert!(replay(1, 1, &[0]).is_none());
        assert!(replay(1, 1, &[5, 0, 3, 1]).is_none());
        assert!(replay(1, 1, &[0, 99]).is_none());
        assert!(replay(9, 1, &[]).is_none());
    }

    /// Nagrania botów z przeglądarki (rdzeń core.ts) muszą dać na serwerze dokładnie ten sam wynik i tę samą długość gry
    #[test]
    fn server_replays_match_the_browser() {
        #[derive(Deserialize)]
        struct Rec {
            level: usize,
            seed: u32,
            log: Vec<u64>,
            score: i64,
            ticks: u32,
        }
        let fixtures: Vec<Rec> = serde_json::from_str(include_str!("../tests/fixtures/pinball_replays.json")).unwrap();
        assert!(!fixtures.is_empty());
        for f in fixtures {
            let o = replay(f.level, f.seed, &f.log).expect("zapis");
            assert!(o.over, "poziom {}: gra nie doszła do końca", f.level);
            assert_eq!((o.score, o.ticks), (f.score, f.ticks), "poziom {} seed {}", f.level, f.seed);
        }
    }
}
