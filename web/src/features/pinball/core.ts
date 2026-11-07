// Rdzeń Pinballa: cała fizyka i zasady gry, bez rysowania i bez dźwięku (te robi engine.ts przez `Fx`).
// To samo liczy serwer (server/src/pinball_sim.rs), żeby sprawdzić wynik gracza: przeglądarka wysyła tylko zapis wciśnięć
// (tick + zdarzenie), a serwer odtwarza grę od początku i sam wylicza punkty. Dlatego rdzeń musi być DETERMINISTYCZNY, bit w bit
// tak samo w JavaScripcie i w Rust:
//  - stały krok czasu (`TICK`), żadnego `performance.now()` ani zmiennego dt,
//  - losowość tylko z `Rng` (ziarno daje serwer przy starcie gry); wołanie `rng.next()` nigdy nie zależy od dźwięków ani efektów,
//  - z funkcji matematycznych tylko + - * / sqrt floor abs min max (IEEE daje identyczny wynik wszędzie); sin / cos / exp
//    mają własne wielomiany (`fsin` / `fcos` / `fexp`), bo Math.sin i libm różnią się w ostatnich bitach; zamiast hypot - `hyp`,
//    zamiast x ** 1.5 - x * sqrt(x).
// Zmieniając cokolwiek tutaj, zmień też pinball_sim.rs w tej samej kolejności działań i uruchom test zgodności (cargo test pinball_sim).
import { LEVELS, type Spec } from './levels';

export const W = 460;
export const R = 9;                 // promień kulki
export const G = 1450;              // grawitacja wzdłuż pochylonego stołu, px/s²
export const SUB = 4;               // pod-kroki fizyki na tick (bez przelatywania przez ściany)
export const TICK = 1 / 120;        // stały krok symulacji, s
export const VMAX = 2600;
export const AXIS = 214;            // oś symetrii pola gry (bez toru wyrzutni)
export const LANE_X = 418;          // ściana toru wyrzutni
export const BALLS = 3;
export const SAVE_TIME = 9;         // s ochrony kulki po wyrzucie
export const LEN = 70, FR0 = 11, FR1 = 6;
export const LANE_Y = 112;
export const LANES = [139, 189, 239, 289];
const ORBIT_X = 230, ORBIT_Y = 24;

export type P = { x: number; y: number };
export type Seg = { a: P; b: P; r: number };
export type Ball = { x: number; y: number; vx: number; vy: number; trail: P[]; held: number; cool: number; auto: number; gone: boolean; still: number; blast: number };
export type Flip = { x: number; y: number; rest: number; up: number; ang: number; w: number; on: boolean; len: number };

/** Co rdzeń „mówi” światu: dźwięki i efekty. Serwer podstawia puste funkcje. Kolory to nazwy z palety poziomu (cyan, pink...). */
export type Fx = {
  sound(kind: string, p?: number): void;
  burst(x: number, y: number, color: string, n?: number, speed?: number): void;
  say(text: string, sub: string, color: string, dur: number): void;
  clearMsg(): void;
  pop(x: number, y: number, value: number, color: string): void;
  bump(v: number): void;
  over(score: number): void;
};
const NOFX: Fx = { sound() {}, burst() {}, say() {}, clearMsg() {}, pop() {}, bump() {}, over() {} };

// ---------- matematyka deterministyczna ----------
const TAU = 2 * Math.PI;
export const hyp = (a: number, b: number) => Math.sqrt(a * a + b * b);
export function fsin(x: number) {
  const r = x - TAU * Math.floor(x / TAU + 0.5), r2 = r * r;
  let t = r, s = r;
  for (let i = 1; i <= 10; i++) { t = -t * r2 / ((2 * i) * (2 * i + 1)); s += t; }
  return s;
}
export function fcos(x: number) {
  const r = x - TAU * Math.floor(x / TAU + 0.5), r2 = r * r;
  let t = 1, s = 1;
  for (let i = 1; i <= 10; i++) { t = -t * r2 / ((2 * i - 1) * (2 * i)); s += t; }
  return s;
}
/** e^x dla małych |x| (kroki czasu) */
export function fexp(x: number) {
  let t = 1, s = 1;
  for (let i = 1; i <= 14; i++) { t = t * x / i; s += t; }
  return s;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** mulberry32: 32-bitowy generator z ziarnem; liczby całkowite liczą się tak samo w JS i w Rust */
export class Rng {
  private a: number;
  constructor(seed: number) { this.a = seed | 0; }
  next(): number {
    this.a = (this.a + 0x6D2B79F5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

// ---------- układ stołu ----------
const pt = (x: number, y: number): P => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number, r = 3): Seg => ({ a: pt(ax, ay), b: pt(bx, by), r });
const polyline = (pts: number[][], r = 3) => pts.slice(1).map((p, i) => seg(pts[i][0], pts[i][1], p[0], p[1], r));
export const mirror = (pts: number[][]) => pts.map(([x, y]) => [AXIS * 2 - x, y]);

export const ARC = Array.from({ length: 33 }, (_, i) => { const t = Math.PI + Math.PI * i / 32; return [230 + 220 * fcos(t), 230 + 220 * fsin(t)]; });
export const DIVIDERS = [114, 164, 214, 264, 314].map(x => seg(x, 92, x, 132, 4));
export const GATE = seg(449, 188, LANE_X, 206, 2);   // przepuszcza kulkę z wyrzutni, nie wpuszcza z powrotem

export type Geo = {
  spec: Spec; H: number; DY: number;
  walls: Seg[]; posts: { x: number; y: number; r: number }[]; pads: Seg[];
  guideL: number[][]; guideR: number[][]; slingL: number[][]; slingR: number[][];
  saucer: P;
};
const geos = new Map<number, Geo>();
/** Układ stołu danego poziomu (z levels.json); koniec prowadnicy leży tuż nad górną krawędzią łapy w spoczynku - niżej kulka klinowała się przy osi łapy */
export function geoOf(level: number): Geo {
  const spec = LEVELS[clamp(level, 1, LEVELS.length) - 1];
  let g = geos.get(spec.id);
  if (g) return g;
  const H = spec.H, DY = H - 840;
  const guideL = [[45, 590 + DY], [45, 676 + DY], [128, 720 + DY]], guideR = mirror(guideL);
  const slingL = [[78, 612 + DY], [78, 662 + DY], [110, 680 + DY]], slingR = mirror(slingL);   // pod procą zostaje >= 24 px przejścia do łapy
  const walls: Seg[] = [
    ...polyline(ARC), seg(10, 230, 10, H + 60), seg(450, 230, 450, H + 60), seg(LANE_X, 206, LANE_X, H + 60),
    ...polyline(guideL), ...polyline(guideR),
    ...polyline(slingL.slice(0, 2)), ...polyline(slingL.slice(1)), ...polyline(slingR.slice(0, 2)), ...polyline(slingR.slice(1)),
    ...DIVIDERS,
    ...(spec.walls ?? []).flatMap(w => polyline(w, 4)),
  ];
  const posts = [pt(45, 590 + DY), pt(383, 590 + DY)].map(p => ({ ...p, r: 5 }))
    .concat((spec.posts ?? []).map(([x, y, r = 6]) => ({ x, y, r })));
  const pads = (spec.pads ?? []).map(p => seg(p.a[0], p.a[1], p.b[0], p.b[1], 5));
  g = { spec, H, DY, walls, posts, pads, guideL, guideR, slingL, slingR, saucer: pt(AXIS, spec.saucer) };
  geos.set(spec.id, g);
  return g;
}

function slingOf(pts: number[][]) {
  const s = seg(pts[0][0], pts[0][1], pts[2][0], pts[2][1], 3);
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, l = hyp(dx, dy);
  let nx = dy / l, ny = -dx / l;
  if (nx * (AXIS - s.a.x) < 0) { nx = -nx; ny = -ny; }
  return { s, nx, ny, flash: 0 };
}

// ---------- pomocnicze ----------
export function closest(p: P, a: P, b: P): P {
  const abx = b.x - a.x, aby = b.y - a.y;
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby), 0, 1);
  return pt(a.x + abx * t, a.y + aby * t);
}
// kulka o okrąg (cx, cy, rad), który może się ruszać z prędkością (svx, svy); zwraca siłę uderzenia albo -1
function collide(b: Ball, cx: number, cy: number, rad: number, rest: number, kick = 0, svx = 0, svy = 0): number {
  const dx = b.x - cx, dy = b.y - cy, min = R + rad, d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return -1;
  const d = Math.sqrt(d2) || 1e-4, nx = dx / d, ny = dy / d;
  b.x = cx + nx * min; b.y = cy + ny * min;
  const rvx = b.vx - svx, rvy = b.vy - svy, vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  const tx = -ny, ty = nx, vt = (rvx * tx + rvy * ty) * 0.985;
  const out = -vn * rest + kick;
  b.vx = svx + nx * out + tx * vt; b.vy = svy + ny * out + ty * vt;
  return -vn;
}
const segHit = (b: Ball, s: Seg, rest: number, kick = 0) => { const c = closest(b, s.a, s.b); return collide(b, c.x, c.y, s.r, rest, kick); };

export type Input = 'l+' | 'l-' | 'r+' | 'r-' | 'p+' | 'p-' | 'n';
/** Kody zdarzeń w zapisie gry (kolejność ma znaczenie: serwer czyta te same liczby) */
export const INPUT_CODES: Input[] = ['l+', 'l-', 'r+', 'r-', 'p+', 'p-', 'n'];

export class Sim {
  readonly geo: Geo;
  readonly spec: Spec;
  readonly H: number;
  readonly DY: number;
  readonly rng: Rng;
  fx: Fx;
  tick = 0;
  time = 0;

  phase: 'attract' | 'play' | 'over' = 'attract';
  score = 0; ballNo = 1; mult = 1; extra = 0;
  balls: Ball[] = [];
  queue = 0; queueT = 0;
  saveT = 0; saveArmed = false;
  multiball = false; jackpots = 0;
  tilted = false; nudges: number[] = [];
  charge = 0; charging = false; plungerKick = 0;
  overT = 0;
  keys = { l: false, r: false };

  fl: Flip; fr: Flip;
  ups: { side: 'l' | 'r'; f: Flip }[];
  bumpers; slings; drops; stands; lanes;
  dropsReset = 0; vhsDone = false; radDone = false;
  saucerFlash = 0; orbitCool = 0;
  portals; holes; spinners; movers; blades;
  fans; sticky;
  dTxt: string; sTxt: string; lTxt: string;
  wallSnd = 0; fanSnd = 0; gooSnd = 0; padSnd = 0;

  constructor(level: number, seed: number, fx: Fx = NOFX) {
    const geo = this.geo = geoOf(level);
    const spec = this.spec = geo.spec;
    this.H = geo.H; this.DY = geo.DY; this.fx = fx; this.rng = new Rng(seed);
    this.fl = { x: 134, y: 735 + geo.DY, rest: 0.52, up: -0.52, ang: 0.52, w: 0, on: false, len: LEN };
    this.fr = { x: 294, y: 735 + geo.DY, rest: Math.PI - 0.52, up: Math.PI + 0.52, ang: Math.PI - 0.52, w: 0, on: false, len: LEN };
    // dodatkowe łapy wyżej na stole (te same klawisze co dolne)
    this.ups = (spec.uppers ?? []).map(u => {
      const left = u.side === 'l';
      const f: Flip = { x: u.x, y: u.y, rest: left ? 0.52 : Math.PI - 0.52, up: left ? -0.52 : Math.PI + 0.52, ang: left ? 0.52 : Math.PI - 0.52, w: 0, on: false, len: u.len ?? 56 };
      return { side: u.side, f };
    });
    this.bumpers = spec.bumpers.map(b => ({ x: b[0], y: b[1], r: b[2] ?? 22, alt: !!b[3], flash: 0 }));
    this.slings = [slingOf(geo.slingL), slingOf(geo.slingR)];
    this.drops = spec.drops.ys.map((y, i) => ({ s: seg(30, y - 13, 30, y + 13, 4), down: false, label: spec.drops.labels[i], flash: 0 }));
    this.stands = spec.stands.ys.map((y, i) => ({ s: seg(404, y - 13, 404, y + 13, 4), lit: false, label: spec.stands.labels[i], flash: 0 }));
    this.lanes = LANES.map((x, i) => ({ x, lit: false, label: spec.lanes[i], cool: 0, flash: 0 }));
    this.dTxt = spec.drops.labels.split('').join(' '); this.sTxt = spec.stands.labels.split('').join(' '); this.lTxt = spec.lanes.split('').join(' ');
    this.portals = (spec.portals ?? []).map(p => ({ a: pt(p.a[0], p.a[1]), b: pt(p.b[0], p.b[1]), cool: 0, flash: 0 }));
    this.holes = (spec.holes ?? []).map(h => ({ x: h.x, y: h.y, pull: h.pull ?? 90, flash: 0 }));
    this.spinners = (spec.spinners ?? []).map(s => ({ ...s, ang: 0, spin: 0, cool: 0 }));
    this.movers = (spec.movers ?? []).map(m => ({ ...m, x: m.cx, y: m.cy, vx: 0, vy: 0, flash: 0 }));
    this.fans = spec.fans ?? [];
    this.sticky = spec.sticky ?? [];
    this.blades = (spec.blades ?? []).map(b => ({ ...b, ang: 0, flash: 0, cool: 0 }));
  }

  // ---------- zasady ----------
  private say(text: string, sub = '', color = 'pink', dur = 2) { this.fx.say(text, sub, color, dur); }
  private add(pts: number, x?: number, y?: number, color = 'yellow') {
    if (this.phase !== 'play' || this.tilted) return;
    const v = pts * this.mult;
    this.score += v;
    if (x !== undefined && y !== undefined && v >= 1000) this.fx.pop(x, y, v, color);
  }

  newBall(): Ball { return { x: 434, y: this.H - 60, vx: 0, vy: 0, trail: [], held: 0, cool: 0, auto: 0, gone: false, still: 0, blast: 0 }; }
  private serve() { this.balls = [this.newBall()]; this.saveArmed = true; this.tilted = false; this.nudges = []; }

  /** Początek gry (od razu gra się toczy; ziarno jest w konstruktorze) */
  start() {
    if (this.phase === 'play') return;
    this.phase = 'play'; this.score = 0; this.ballNo = 1; this.mult = 1; this.extra = 0; this.jackpots = 0; this.multiball = false; this.queue = 0;
    this.lanes.forEach(l => l.lit = false); this.drops.forEach(d => d.down = false); this.stands.forEach(s => s.lit = false);
    this.vhsDone = this.radDone = false;
    this.serve();
    this.fx.sound('start');
    this.say(this.spec.name.toUpperCase(), 'wyrzuć kulkę: spacja', 'cyan', 2.6);
    if (this.spec.id > 1) this.fx.sound('level', this.spec.id);
  }
  private endBall() {
    if (this.extra > 0) { this.extra--; this.say('JESZCZE RAZ', 'dodatkowa kulka', 'cyan'); this.serve(); return; }
    this.ballNo++;
    this.mult = 1;
    if (this.ballNo > BALLS) {
      this.phase = 'over'; this.overT = 0;
      this.fx.sound('over');
      this.fx.over(this.score);
    } else {
      this.fx.sound('drain');
      this.say(`KULKA ${this.ballNo}`, '', 'cyan', 1.6);
      this.serve();
    }
  }
  private drained(b: Ball) {
    b.gone = true;
    const left = this.balls.filter(x => !x.gone).length + this.queue;
    if (this.multiball && left <= 1) { this.multiball = false; this.say('KONIEC MULTIBALLA', `jackpoty: ${this.jackpots}`, 'purple'); }
    if (left > 0) return;
    if (this.saveT > 0 && !this.tilted) {
      this.fx.sound('save'); this.say('KULKA URATOWANA', '', 'cyan', 1.5);
      this.queue = 1; this.queueT = 0.5; this.saveT = 0;
      return;
    }
    this.endBall();
  }
  private startMultiball() {
    const sa = this.geo.saucer;
    this.multiball = true; this.jackpots = 0; this.vhsDone = this.radDone = false;
    this.stands.forEach(s => s.lit = false);
    this.queue += 2; this.queueT = 1.2; this.saveT = Math.max(this.saveT, 15);
    this.fx.sound('jackpot'); this.fx.bump(10);
    this.say('MULTIBALL', 'strzelaj w słońce: JACKPOT', 'yellow', 2.6);
    this.fx.burst(sa.x, sa.y, 'yellow', 50, 500);
  }
  private launch(b: Ball, power: number) {
    b.vy = -(950 + 1650 * power) - this.rng.next() * 40; b.vx = 0;
    this.plungerKick = 0.18;
    this.fx.sound('launch', power);
    if (this.saveArmed) { this.saveT = SAVE_TIME; this.saveArmed = false; }
  }
  inLane = (b: Ball) => b.x > LANE_X && b.y > this.H - 280;

  // ---------- wejście gracza (to trafia do zapisu gry) ----------
  private flipperPressed(side: 'l' | 'r') {
    if (this.phase !== 'play' || this.tilted) return;
    this.fx.sound('flip');
    // tory NEON przesuwają się łapami, jak w automatach
    const lit = this.lanes.map(l => l.lit);
    if (side === 'l') lit.push(lit.shift()!); else lit.unshift(lit.pop()!);
    this.lanes.forEach((l, i) => l.lit = lit[i]);
  }
  setFlip(side: 'l' | 'r', on: boolean) {
    if (this.keys[side] === on) return;
    this.keys[side] = on;
    if (on) this.flipperPressed(side);
  }
  nudge() {
    if (this.phase !== 'play' || this.tilted) return;
    const now = this.time;
    this.nudges = this.nudges.filter(t => now - t < 4); this.nudges.push(now);
    this.balls.forEach(b => { if (!b.held && !this.inLane(b)) { b.vx += (this.rng.next() - 0.5) * 160; b.vy -= 90; } });
    this.fx.bump(7);
    if (this.nudges.length === 3) { this.say('UWAGA', 'jeszcze raz i TILT', 'orange', 1.4); this.fx.sound('target', 0.6); }
    if (this.nudges.length >= 4) { this.tilted = true; this.fx.sound('tilt'); this.say('TILT', 'łapy nie działają do końca kulki', 'orange', 3); }
  }
  plungerDown() {
    if (this.balls.some(b => this.inLane(b) && !b.auto)) this.charging = true; else this.nudge();
  }
  plungerUp() {
    if (!this.charging) return;
    this.charging = false;
    const b = this.balls.find(x => this.inLane(x) && !x.gone && !x.auto);
    if (b && b.y > this.H - 100) this.launch(b, this.charge);
    this.charge = 0;
  }
  /** Jedno zdarzenie z zapisu gry (klawisz, dotyk) */
  input(code: Input) {
    if (this.phase !== 'play') return;
    switch (code) {
      case 'l+': this.setFlip('l', true); break;
      case 'l-': this.setFlip('l', false); break;
      case 'r+': this.setFlip('r', true); break;
      case 'r-': this.setFlip('r', false); break;
      case 'p+': this.plungerDown(); break;
      case 'p-': this.plungerUp(); break;
      case 'n': this.nudge(); break;
    }
  }

  // ---------- zasady przy trafieniach ----------
  private laneHit(i: number) {
    const l = this.lanes[i];
    if (l.cool > 0) return;
    l.cool = 0.5; l.flash = 1;
    if (l.lit) { this.add(100); this.fx.sound('target', 0.8); return; }
    l.lit = true; this.add(500, l.x, LANE_Y + 20, 'cyan'); this.fx.sound('lane', 1 + i * 0.06);
    if (this.lanes.every(x => x.lit)) {
      this.lanes.forEach(x => x.lit = false);
      if (this.mult < 5) { this.mult++; this.say(`MNOŻNIK x${this.mult}`, `tory ${this.lTxt}`, 'cyan'); } else { this.add(10000); this.say('NEON MAX', '+10 000', 'cyan'); }
      this.fx.sound('bank'); this.fx.burst(AXIS, LANE_Y, 'cyan', 30, 400);
    }
  }
  private bankCheck() {
    if (!this.vhsDone && this.drops.every(d => d.down)) {
      this.vhsDone = true; this.add(5000, 60, 420, 'pink'); this.fx.sound('bank'); this.dropsReset = 1.6;
      this.say(this.dTxt, this.radDone ? 'słońce: MULTIBALL' : `cel: ${this.sTxt}`, 'pink');
    }
    if (!this.radDone && this.stands.every(s => s.lit)) {
      this.radDone = true; this.add(5000, 370, 420, 'cyan'); this.fx.sound('bank');
      this.say(this.sTxt, this.vhsDone ? 'słońce: MULTIBALL' : `cel: ${this.dTxt}`, 'cyan');
    }
  }
  private saucerHit(b: Ball) {
    const sa = this.geo.saucer;
    b.held = 1.3; b.vx = b.vy = 0; b.x = sa.x; b.y = sa.y;
    this.saucerFlash = 1; this.fx.sound('saucer'); this.fx.bump(4);
    if (this.multiball) {
      this.jackpots++;
      const v = 25000 * this.jackpots;
      this.add(v, sa.x, sa.y - 30, 'yellow');
      this.say('JACKPOT', (v * this.mult).toLocaleString('pl-PL'), 'yellow', 2.2);
      this.fx.sound('jackpot'); this.fx.bump(12); this.fx.burst(sa.x, sa.y, 'yellow', 60, 600);
    } else if (this.vhsDone && this.radDone && this.phase === 'play' && !this.tilted) {
      b.held = 2.2;
      this.startMultiball();
    } else {
      this.add(2500, sa.x, sa.y - 30, 'orange');
      this.say('SŁOŃCE', this.vhsDone || this.radDone ? `skończ ${this.dTxt} i ${this.sTxt}` : `zbij ${this.dTxt} i ${this.sTxt}: multiball`, 'orange', 1.6);
      this.fx.burst(sa.x, sa.y, 'orange', 20, 300);
    }
  }

  // ---------- fizyka ----------
  private stepFlip(f: Flip, on: boolean, dt: number) {
    f.on = on;
    const target = on ? f.up : f.rest, sp = on ? 24 : 14, prev = f.ang;
    f.ang = f.ang < target ? Math.min(target, f.ang + sp * dt) : Math.max(target, f.ang - sp * dt);
    f.w = (f.ang - prev) / dt;
  }
  private flipHit(b: Ball, f: Flip) {
    const tip = pt(f.x + fcos(f.ang) * f.len, f.y + fsin(f.ang) * f.len);
    const c = closest(b, f, tip);
    const t = hyp(c.x - f.x, c.y - f.y) / f.len;
    const rad = FR0 + (FR1 - FR0) * t;
    const svx = -f.w * (c.y - f.y), svy = f.w * (c.x - f.x);
    collide(b, c.x, c.y, rad, 0.28, 0, svx, svy);
  }

  // pole siły, lepka maź, teleporty, czarne dziury, wiatraczki, ruchome cele, pałeczki i trampoliny
  private extras(b: Ball, dt: number) {
    if (b.held > 0) return;
    for (const f of this.fans) {
      if (b.x > f.x && b.x < f.x + f.w && b.y > f.y && b.y < f.y + f.h) {
        b.vx += f.fx * dt; b.vy += f.fy * dt;
        if (this.time - this.fanSnd > 0.9) { this.fanSnd = this.time; this.fx.sound('fan'); }
      }
    }
    for (const z of this.sticky) {
      if (b.x > z.x && b.x < z.x + z.w && b.y > z.y && b.y < z.y + z.h) {
        const d = fexp(-5 * dt); b.vx *= d; b.vy *= d;
        if (this.time - this.gooSnd > 0.7) { this.gooSnd = this.time; this.fx.sound('goo'); }
      }
    }
    for (const p of this.portals) {
      if (b.cool > 0) break;
      for (const [from, to] of [[p.a, p.b], [p.b, p.a]] as const) {
        if (hyp(b.x - from.x, b.y - from.y) < 15) {
          b.x = to.x; b.y = to.y; b.cool = 0.6; p.flash = 1;
          this.add(250, to.x, to.y - 20, 'purple'); this.fx.sound('portal'); this.fx.burst(from.x, from.y, 'purple', 16, 300); this.fx.burst(to.x, to.y, 'cyan', 16, 300);
          break;
        }
      }
    }
    for (const h of this.holes) {
      const dx = h.x - b.x, dy = h.y - b.y, d = hyp(dx, dy);
      if (d < h.pull && d > 1) {
        const q = 1 - d / h.pull;
        const a = 3200 * (q * Math.sqrt(q));
        b.vx += (dx / d) * a * dt; b.vy += (dy / d) * a * dt;
      }
      if (d < 13 && b.cool <= 0) {
        b.held = 1.4; b.blast = 1; b.vx = b.vy = 0; b.x = h.x; b.y = h.y; h.flash = 1;
        this.add(1000, h.x, h.y - 24, 'magenta'); this.fx.sound('hole'); this.fx.bump(5); this.fx.burst(h.x, h.y, 'magenta', 24, 380);
      }
    }
    for (const s of this.spinners) {
      if (s.cool <= 0 && Math.abs(b.x - s.x) < s.w / 2 && Math.abs(b.y - s.y) < 10) {
        const v = hyp(b.vx, b.vy);
        if (v > 150) {
          s.cool = 0.12; s.spin = Math.min(26, 6 + v / 70) * (b.vx >= 0 ? 1 : -1);
          this.add(50, s.x, s.y - 14, 'yellow'); this.fx.sound('spinner', 0.8 + Math.min(0.8, v / 1500));
        }
      }
    }
    for (const m of this.movers) {
      const hit = collide(b, m.x, m.y, m.r, 0.7, 260, m.vx, m.vy);
      if (hit > 60) {
        m.flash = 1; this.add(m.skin === 'duck' ? 300 : 150, m.x, m.y - 16, m.skin === 'duck' ? 'yellow' : 'orange');
        this.fx.sound(m.skin === 'duck' ? 'quack' : 'rock', 1); this.fx.burst(m.x, m.y, m.skin === 'duck' ? 'yellow' : 'orange', 8, 220);
      }
    }
    for (const bl of this.blades) {
      const ca = fcos(bl.ang) * bl.len / 2, sa = fsin(bl.ang) * bl.len / 2;
      const c = closest(b, pt(bl.x - ca, bl.y - sa), pt(bl.x + ca, bl.y + sa));
      const hit = collide(b, c.x, c.y, 5, 0.8, 120, -bl.w * (c.y - bl.y), bl.w * (c.x - bl.x));
      if (hit > 80 && bl.cool <= 0) {
        bl.cool = 0.15; bl.flash = 1; this.add(200, c.x, c.y - 14, 'orange'); this.fx.sound('blade'); this.fx.burst(c.x, c.y, 'orange', 6, 260);
      }
    }
    for (const pd of this.geo.pads) {
      const hit = segHit(b, pd, 0.5, 420);
      if (hit > 80) {
        this.add(75); if (this.time - this.padSnd > 0.1) { this.padSnd = this.time; this.fx.sound('boing', 1); } this.fx.bump(2);
      }
    }
  }

  private stepBall(b: Ball, dt: number) {
    if (b.gone) return;
    if (b.held > 0) return;
    const g = this.geo, sa = g.saucer;
    b.vy += G * dt;
    const sp = hyp(b.vx, b.vy);
    if (sp > VMAX) { b.vx *= VMAX / sp; b.vy *= VMAX / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;

    for (const s of g.walls) {
      const hit = segHit(b, s, 0.45);
      if (hit > 380 && this.time - this.wallSnd > 0.06) { this.wallSnd = this.time; this.fx.sound('wall', hit / 400); }
    }
    for (const p of g.posts) collide(b, p.x, p.y, p.r, 0.6);
    if (b.vy > 0 && b.y < 206 && b.x > LANE_X - R) segHit(b, GATE, 0.3);
    // tłok wyrzutni
    if (b.x > LANE_X && b.y > this.H - 40 + this.charge * 28 - R) { b.y = this.H - 40 + this.charge * 28 - R; if (b.vy > 0) b.vy = 0; b.vx = 0; b.x = 434; }

    this.bumpers.forEach((u, i) => {
      if (collide(b, u.x, u.y, u.r, 0.6, 420) > 0) {
        u.flash = 1; this.add(100); this.fx.sound('bumper', 0.85 + (i % 4) * 0.18); this.fx.burst(b.x, b.y, u.alt ? 'cyan' : 'pink', 10, 240); this.fx.bump(3);
      }
    });
    this.extras(b, dt);
    for (const s of this.slings) {
      const hit = segHit(b, s.s, 0.4);
      if (hit > 60) {
        b.vx += s.nx * 520; b.vy += s.ny * 520;
        s.flash = 1; this.add(10); this.fx.sound('sling'); this.fx.bump(2);
      }
    }
    for (const d of this.drops) {
      if (d.down) continue;
      if (segHit(b, d.s, 0.35) > 40) { d.down = true; d.flash = 1; this.add(1000, 50, d.s.a.y + 13, 'pink'); this.fx.sound('drop'); this.fx.burst(32, d.s.a.y + 13, 'pink', 8); this.bankCheck(); }
    }
    for (const s of this.stands) {
      if (segHit(b, s.s, 0.35) > 40) {
        s.flash = 1;
        if (!s.lit) { s.lit = true; this.add(750, 380, s.s.a.y + 13, 'cyan'); this.fx.sound('target', 1.2); this.bankCheck(); } else { this.add(150); this.fx.sound('target', 0.9); }
      }
    }
    for (const u of this.ups) this.flipHit(b, u.f);
    this.flipHit(b, this.fl); this.flipHit(b, this.fr);   // po TILT łapy leżą, ale dalej są przeszkodą

    // czujniki
    this.lanes.forEach((l, i) => { if (Math.abs(b.x - l.x) < 14 && Math.abs(b.y - LANE_Y) < 12) this.laneHit(i); });
    if (b.cool <= 0 && hyp(b.x - sa.x, b.y - sa.y) < 14 && sp < 900) this.saucerHit(b);
    if (this.orbitCool <= 0 && hyp(b.x - ORBIT_X, b.y - ORBIT_Y) < 22 && Math.abs(b.vx) > 250) {
      this.orbitCool = 1.2; this.add(1500, ORBIT_X, 60, 'purple'); this.fx.sound('lane', 1.4); this.say('ORBITA', '', 'purple', 1.1);
    }
    if (b.y > this.H + 30) this.drained(b);
  }
  private ballsCollide() {
    const live = this.balls.filter(b => !b.gone && b.held <= 0);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j], dx = b.x - a.x, dy = b.y - a.y, d = hyp(dx, dy);
      if (d >= R * 2 || d === 0) continue;
      const nx = dx / d, ny = dy / d, o = (R * 2 - d) / 2;
      a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) { a.vx += rv * nx * 0.95; a.vy += rv * ny * 0.95; b.vx -= rv * nx * 0.95; b.vy -= rv * ny * 0.95; }
    }
  }

  /** Jeden stały krok symulacji (TICK) */
  step() {
    const dt = TICK;
    this.tick++;
    this.time += dt;
    const on = this.phase === 'play' && !this.tilted;
    const dts = dt / SUB;
    for (const m of this.movers) {
      const w = TAU / m.period, a = w * this.time + (m.phase ?? 0);
      const sn = fsin(a), cs = fcos(a);
      m.x = m.cx + m.ax * sn; m.y = m.cy + (m.ay ?? 0) * sn;
      m.vx = m.ax * w * cs; m.vy = (m.ay ?? 0) * w * cs;
    }
    for (const bl of this.blades) bl.ang += bl.w * dt;
    for (let s = 0; s < SUB; s++) {
      this.stepFlip(this.fl, on && this.keys.l, dts);
      this.stepFlip(this.fr, on && this.keys.r, dts);
      for (const u of this.ups) this.stepFlip(u.f, on && this.keys[u.side], dts);
      for (const b of this.balls) this.stepBall(b, dts);
      this.ballsCollide();
    }
    this.balls = this.balls.filter(b => !b.gone);

    const H = this.H;
    for (const b of this.balls) {
      if (b.cool > 0) b.cool -= dt;
      if (b.held > 0) {
        b.held -= dt;
        if (b.held <= 0) {
          b.cool = 0.7;
          if (b.blast) { const a = this.rng.next() * TAU; b.vx = fcos(a) * 820; b.vy = fsin(a) * 820; b.blast = 0; this.fx.sound('holeout'); this.fx.bump(6); }
          else { b.vx = (this.rng.next() < 0.5 ? -1 : 1) * (120 + this.rng.next() * 160); b.vy = 520; this.fx.sound('sling'); }
        }
      }
      if (b.auto > 0) { b.auto -= dt; if (b.auto <= 0 && this.inLane(b)) this.launch(b, 0.85 + this.rng.next() * 0.15); }
      if (this.tick % 2 === 0) { b.trail.push(pt(b.x, b.y)); if (b.trail.length > 10) b.trail.shift(); }
      // kulka zaklinowana gdzieś na stole: po chwili sama dostaje szturchnięcie
      if (b.held <= 0 && !this.inLane(b) && ((!this.keys.l && !this.keys.r) || b.y < H - 230) && hyp(b.vx, b.vy) < 15) {
        b.still += dt;
        if (b.still > 2.5) { b.still = 0; b.vx += (b.x < AXIS ? 1 : -1) * (80 + this.rng.next() * 80); b.vy -= 220; this.fx.bump(5); }
      } else b.still = 0;
    }
    if (this.queue > 0) {
      this.queueT -= dt;
      if (this.queueT <= 0 && !this.balls.some(this.inLane)) { const nb = this.newBall(); nb.auto = 0.45; this.balls.push(nb); this.queue--; this.queueT = 0.9; }
    }
    if (this.charging) { const c0 = this.charge; this.charge = Math.min(1, this.charge + dt * 1.1); if (Math.floor(c0 * 8) !== Math.floor(this.charge * 8)) this.fx.sound('charge', this.charge); }
    if (this.saveT > 0 && !this.balls.some(this.inLane)) this.saveT -= dt;
    if (this.dropsReset > 0) { this.dropsReset -= dt; if (this.dropsReset <= 0) this.drops.forEach(d => d.down = false); }
    if (this.orbitCool > 0) this.orbitCool -= dt;
    this.plungerKick = Math.max(0, this.plungerKick - dt);
    this.bumpers.forEach(u => u.flash = Math.max(0, u.flash - dt * 4));
    this.slings.forEach(s => s.flash = Math.max(0, s.flash - dt * 5));
    this.drops.forEach(d => d.flash = Math.max(0, d.flash - dt * 3));
    this.stands.forEach(d => d.flash = Math.max(0, d.flash - dt * 3));
    this.lanes.forEach(l => { l.flash = Math.max(0, l.flash - dt * 3); l.cool -= dt; });
    this.portals.forEach(p => p.flash = Math.max(0, p.flash - dt * 2));
    this.holes.forEach(h => h.flash = Math.max(0, h.flash - dt * 2));
    this.movers.forEach(m => m.flash = Math.max(0, m.flash - dt * 4));
    this.blades.forEach(bl => { bl.flash = Math.max(0, bl.flash - dt * 4); bl.cool -= dt; });
    this.spinners.forEach(s => { s.ang += s.spin * dt; s.spin *= fexp(-1.6 * dt); s.cool -= dt; });
    this.saucerFlash = Math.max(0, this.saucerFlash - dt * 1.5);
    if (this.phase === 'over') { this.overT += dt; if (this.overT > 5) { this.phase = 'attract'; this.fx.clearMsg(); } }
  }
}
