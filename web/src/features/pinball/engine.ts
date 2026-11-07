// Pinball „Neon Drive” (zakładka Gry -> Pinball): fizyka, zasady i rysowanie na jednym płótnie 2D.
// Wszystko liczy przeglądarka, bez serwera i bez nagród - rekord zostaje w localStorage (`pinballBest`).
// Stół ma stały układ współrzędnych W x H (y w dół); płótno skaluje go do miejsca na ekranie.
// Warstwy: tło (niebo, słońce, góry) i stół (ściany, prowadnice) rysujemy raz do osobnych płócien,
// co klatkę dochodzą siatka, lampki, bumpery, łapy, kulki i iskry.
import { Sound } from '../../sound/sound';

export const W = 460, H = 840;
const R = 9;                 // promień kulki
const G = 1450;              // grawitacja wzdłuż pochylonego stołu, px/s²
const SUB = 8;               // pod-kroki fizyki na klatkę (bez przelatywania przez ściany)
const VMAX = 2600;
const AXIS = 214;            // oś symetrii pola gry (bez toru wyrzutni)
const HORIZON = 520;
const LANE_X = 418;          // ściana toru wyrzutni
const BALLS = 3;
const SAVE_TIME = 9;         // s ochrony kulki po wyrzucie

const C = { cyan: '#2de2e6', pink: '#ff3cac', magenta: '#f706cf', purple: '#9d4edd', yellow: '#ffd319', orange: '#ff901f', blue: '#3a86ff' };

type P = { x: number; y: number };
type Seg = { a: P; b: P; r: number };
type Ball = { x: number; y: number; vx: number; vy: number; trail: P[]; held: number; cool: number; auto: number; gone: boolean; still: number };
type Flip = { x: number; y: number; rest: number; up: number; ang: number; w: number; on: boolean };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Pop = { x: number; y: number; text: string; life: number; color: string };

export type PinHud = { phase: 'attract' | 'play' | 'over'; score: number; ball: number; balls: number; mult: number; best: number; multiball: boolean; save: boolean; tilt: boolean };
export type PinballGame = { destroy(): void; start(): void; resize(): void; state(): { balls: { x: number; y: number; vx: number; vy: number }[]; score: number; phase: string; ball: number } };

// ---------- układ stołu ----------
const pt = (x: number, y: number): P => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number, r = 3): Seg => ({ a: pt(ax, ay), b: pt(bx, by), r });
const polyline = (pts: number[][], r = 3) => pts.slice(1).map((p, i) => seg(pts[i][0], pts[i][1], p[0], p[1], r));
const mirror = (pts: number[][]) => pts.map(([x, y]) => [AXIS * 2 - x, y]);

const ARC = Array.from({ length: 33 }, (_, i) => { const t = Math.PI + Math.PI * i / 32; return [230 + 220 * Math.cos(t), 230 + 220 * Math.sin(t)]; });
// koniec prowadnicy leży tuż nad górną krawędzią łapy w spoczynku - niżej kulka klinowała się przy osi łapy
const GUIDE_L = [[45, 590], [45, 676], [128, 720]], GUIDE_R = mirror(GUIDE_L);
const SLING_L = [[78, 612], [78, 662], [110, 680]], SLING_R = mirror(SLING_L);   // pod procą zostaje >= 24 px przejścia do łapy
const DIVIDERS = [114, 164, 214, 264, 314].map(x => seg(x, 92, x, 132, 4));
const GATE = seg(449, 188, LANE_X, 206, 2);   // przepuszcza kulkę z wyrzutni, nie wpuszcza z powrotem

const WALLS: Seg[] = [
  ...polyline(ARC), seg(10, 230, 10, 900), seg(450, 230, 450, 900), seg(LANE_X, 206, LANE_X, 900),
  ...polyline(GUIDE_L), ...polyline(GUIDE_R),
  ...polyline(SLING_L.slice(0, 2)), ...polyline(SLING_L.slice(1)), ...polyline(SLING_R.slice(0, 2)), ...polyline(SLING_R.slice(1)),
  ...DIVIDERS,
];
const POSTS = [pt(45, 590), pt(383, 590)].map(p => ({ ...p, r: 5 }));

function slingOf(pts: number[][]) {
  const s = seg(pts[0][0], pts[0][1], pts[2][0], pts[2][1], 3);
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, l = Math.hypot(dx, dy);
  let nx = dy / l, ny = -dx / l;
  if (nx * (AXIS - s.a.x) < 0) { nx = -nx; ny = -ny; }
  return { s, nx, ny, flash: 0 };
}

const LEN = 70, FR0 = 11, FR1 = 6;
const SAUCER = pt(AXIS, 470);
const ORBIT = pt(230, 24);
const LANES = [139, 189, 239, 289];
const LANE_Y = 112;

// ---------- pomocnicze ----------
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function closest(p: P, a: P, b: P): P {
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

// powtarzalny „losowy” układ gwiazd
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const FONT = '"Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif';

export function createPinball(canvas: HTMLCanvasElement, onHud: (h: PinHud) => void): PinballGame {
  const ctx = canvas.getContext('2d')!;
  let k = 1;                                  // piksele urządzenia na jednostkę stołu
  let bg: HTMLCanvasElement, fg: HTMLCanvasElement;

  // ---------- stan gry ----------
  let phase: PinHud['phase'] = 'attract';
  let score = 0, ballNo = 1, mult = 1, extra = 0;
  let best = 0;
  try { best = +(localStorage.getItem('pinballBest') ?? 0) || 0; } catch { /* prywatne okno */ }
  let balls: Ball[] = [];
  let queue = 0, queueT = 0;                  // kulki multiballa do wyrzucenia
  let saveT = 0, saveArmed = false;
  let multiball = false, jackpots = 0;
  let tilted = false, nudges: number[] = [];
  let charge = 0, charging = false, plungerKick = 0;
  let shake = 0, time = 0, overT = 0;
  let wallSnd = 0;
  const keys = { l: false, r: false };
  const pointers = new Map<number, 'l' | 'r' | 'p'>();

  const fl: Flip = { x: 134, y: 735, rest: 0.52, up: -0.52, ang: 0.52, w: 0, on: false };
  const fr: Flip = { x: 294, y: 735, rest: Math.PI - 0.52, up: Math.PI + 0.52, ang: Math.PI - 0.52, w: 0, on: false };
  const bumpers = [pt(154, 290), pt(274, 290), pt(AXIS, 360)].map(p => ({ ...p, r: 22, flash: 0 }));
  const slings = [slingOf(SLING_L), slingOf(SLING_R)];
  const drops = [380, 420, 460].map((y, i) => ({ s: seg(30, y - 13, 30, y + 13, 4), down: false, label: 'VHS'[i], flash: 0 }));
  const stands = [380, 420, 460].map((y, i) => ({ s: seg(404, y - 13, 404, y + 13, 4), lit: false, label: 'RAD'[i], flash: 0 }));
  const lanes = LANES.map((x, i) => ({ x, lit: false, label: 'NEON'[i], cool: 0, flash: 0 }));
  let dropsReset = 0, vhsDone = false, radDone = false;
  let saucerFlash = 0, orbitCool = 0;
  const sparks: Spark[] = [];
  const pops: Pop[] = [];
  let msg: { text: string; sub: string; t: number; dur: number; color: string } | null = null;

  // ---------- HUD ----------
  let hudSig = '';
  function hud() {
    const h: PinHud = { phase, score, ball: Math.min(ballNo, BALLS), balls: BALLS, mult, best, multiball, save: saveT > 0, tilt: tilted };
    const sig = JSON.stringify(h);
    if (sig !== hudSig) { hudSig = sig; onHud(h); }
  }

  const say = (text: string, sub = '', color = C.pink, dur = 2) => { msg = { text, sub, t: 0, dur, color }; };
  function add(pts: number, x?: number, y?: number, color = C.yellow) {
    if (phase !== 'play' || tilted) return;
    const v = pts * mult;
    score += v;
    if (x !== undefined && y !== undefined && v >= 1000) pops.push({ x, y, text: v.toLocaleString('pl-PL'), life: 1.1, color });
  }
  function burst(x: number, y: number, color: string, n = 14, speed = 260) {
    if (reduced()) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.35 + Math.random() * 0.4, color, size: 1.5 + Math.random() * 2 });
    }
  }
  const bump = (v: number) => { if (!reduced()) shake = Math.max(shake, v); };

  // ---------- przebieg gry ----------
  function newBall(): Ball { return { x: 434, y: 780, vx: 0, vy: 0, trail: [], held: 0, cool: 0, auto: 0, gone: false, still: 0 }; }
  function serve() { balls = [newBall()]; saveArmed = true; tilted = false; nudges = []; }
  function start() {
    if (phase === 'play') return;
    phase = 'play'; score = 0; ballNo = 1; mult = 1; extra = 0; jackpots = 0; multiball = false; queue = 0;
    lanes.forEach(l => l.lit = false); drops.forEach(d => d.down = false); stands.forEach(s => s.lit = false);
    vhsDone = radDone = false;
    serve();
    Sound.unlock(); Sound.pin('start');
    say('START', 'wyrzuć kulkę: spacja', C.cyan, 2.2);
    hud();
  }
  function endBall() {
    if (extra > 0) { extra--; say('JESZCZE RAZ', 'dodatkowa kulka', C.cyan); serve(); return; }
    ballNo++;
    mult = 1;
    if (ballNo > BALLS) {
      phase = 'over'; overT = 0;
      const record = score > best;
      if (record) { best = score; try { localStorage.setItem('pinballBest', String(best)); } catch { /* bez zapisu */ } }
      Sound.pin('over');
      say(record ? 'NOWY REKORD' : 'KONIEC GRY', score.toLocaleString('pl-PL'), record ? C.yellow : C.pink, 99);
    } else {
      Sound.pin('drain');
      say(`KULKA ${ballNo}`, '', C.cyan, 1.6);
      serve();
    }
  }
  function drained(b: Ball) {
    b.gone = true;
    const left = balls.filter(x => !x.gone).length + queue;
    if (multiball && left <= 1) { multiball = false; say('KONIEC MULTIBALLA', `jackpoty: ${jackpots}`, C.purple); }
    if (left > 0) return;
    if (saveT > 0 && !tilted) {
      Sound.pin('save'); say('KULKA URATOWANA', '', C.cyan, 1.5);
      queue = 1; queueT = 0.5; saveT = 0;
      return;
    }
    endBall();
  }
  function startMultiball() {
    multiball = true; jackpots = 0; vhsDone = radDone = false;
    stands.forEach(s => s.lit = false);
    queue += 2; queueT = 1.2; saveT = Math.max(saveT, 15);
    Sound.pin('jackpot'); bump(10);
    say('MULTIBALL', 'strzelaj w słońce: JACKPOT', C.yellow, 2.6);
    burst(SAUCER.x, SAUCER.y, C.yellow, 50, 500);
  }
  function launch(b: Ball, power: number) {
    b.vy = -(950 + 1650 * power) - Math.random() * 40; b.vx = 0;
    plungerKick = 0.18;
    Sound.pin('launch', power);
    if (saveArmed) { saveT = SAVE_TIME; saveArmed = false; }
  }
  const inLane = (b: Ball) => b.x > LANE_X && b.y > 560;

  function flipperPressed(side: 'l' | 'r') {
    if (phase !== 'play' || tilted) return;
    Sound.pin('flip');
    // tory NEON przesuwają się łapami, jak w automatach
    const lit = lanes.map(l => l.lit);
    if (side === 'l') lit.push(lit.shift()!); else lit.unshift(lit.pop()!);
    lanes.forEach((l, i) => l.lit = lit[i]);
  }
  function setFlip(side: 'l' | 'r', on: boolean) {
    if (keys[side] === on) return;
    keys[side] = on;
    if (on) flipperPressed(side);
  }
  function nudge() {
    if (phase !== 'play' || tilted) return;
    const now = time;
    nudges = nudges.filter(t => now - t < 4); nudges.push(now);
    balls.forEach(b => { if (!b.held && !inLane(b)) { b.vx += (Math.random() - 0.5) * 160; b.vy -= 90; } });
    bump(7);
    if (nudges.length === 3) { say('UWAGA', 'jeszcze raz i TILT', C.orange, 1.4); Sound.pin('target', 0.6); }
    if (nudges.length >= 4) { tilted = true; Sound.pin('tilt'); say('TILT', 'łapy nie działają do końca kulki', C.orange, 3); }
  }
  function plungerDown() {
    if (phase !== 'play') { start(); return; }
    if (balls.some(b => inLane(b) && !b.auto)) charging = true; else nudge();
  }
  function plungerUp() {
    if (!charging) return;
    charging = false;
    const b = balls.find(x => inLane(x) && !x.gone && !x.auto);
    if (b && b.y > 740) launch(b, charge);
    charge = 0;
  }

  // ---------- zasady przy trafieniach ----------
  function laneHit(i: number) {
    const l = lanes[i];
    if (l.cool > 0) return;
    l.cool = 0.5; l.flash = 1;
    if (l.lit) { add(100); Sound.pin('target', 0.8); return; }
    l.lit = true; add(500, l.x, LANE_Y + 20, C.cyan); Sound.pin('lane', 1 + i * 0.06);
    if (lanes.every(x => x.lit)) {
      lanes.forEach(x => x.lit = false);
      if (mult < 5) { mult++; say(`MNOŻNIK x${mult}`, 'tory N E O N', C.cyan); } else { add(10000); say('NEON MAX', '+10 000', C.cyan); }
      Sound.pin('bank'); burst(AXIS, LANE_Y, C.cyan, 30, 400);
    }
  }
  function bankCheck() {
    if (!vhsDone && drops.every(d => d.down)) {
      vhsDone = true; add(5000, 60, 420, C.pink); Sound.pin('bank'); dropsReset = 1.6;
      say('V H S', radDone ? 'słońce: MULTIBALL' : 'cel: R A D', C.pink);
    }
    if (!radDone && stands.every(s => s.lit)) {
      radDone = true; add(5000, 370, 420, C.cyan); Sound.pin('bank');
      say('R A D', vhsDone ? 'słońce: MULTIBALL' : 'cel: V H S', C.cyan);
    }
  }
  function saucerHit(b: Ball) {
    b.held = 1.3; b.vx = b.vy = 0; b.x = SAUCER.x; b.y = SAUCER.y;
    saucerFlash = 1; Sound.pin('saucer'); bump(4);
    if (multiball) {
      jackpots++;
      const v = 25000 * jackpots;
      add(v, SAUCER.x, SAUCER.y - 30, C.yellow);
      say('JACKPOT', (v * mult).toLocaleString('pl-PL'), C.yellow, 2.2);
      Sound.pin('jackpot'); bump(12); burst(SAUCER.x, SAUCER.y, C.yellow, 60, 600);
    } else if (vhsDone && radDone && phase === 'play' && !tilted) {
      b.held = 2.2;
      startMultiball();
    } else {
      add(2500, SAUCER.x, SAUCER.y - 30, C.orange);
      say('SŁOŃCE', vhsDone || radDone ? 'skończ V H S i R A D' : 'zbij V H S i R A D: multiball', C.orange, 1.6);
      burst(SAUCER.x, SAUCER.y, C.orange, 20, 300);
    }
  }

  // ---------- fizyka ----------
  function stepFlip(f: Flip, on: boolean, dt: number) {
    f.on = on;
    const target = on ? f.up : f.rest, sp = on ? 24 : 14, prev = f.ang;
    f.ang = f.ang < target ? Math.min(target, f.ang + sp * dt) : Math.max(target, f.ang - sp * dt);
    f.w = (f.ang - prev) / dt;
  }
  function flipHit(b: Ball, f: Flip) {
    const tip = pt(f.x + Math.cos(f.ang) * LEN, f.y + Math.sin(f.ang) * LEN);
    const c = closest(b, f, tip);
    const t = Math.hypot(c.x - f.x, c.y - f.y) / LEN;
    const rad = FR0 + (FR1 - FR0) * t;
    const svx = -f.w * (c.y - f.y), svy = f.w * (c.x - f.x);
    collide(b, c.x, c.y, rad, 0.28, 0, svx, svy);
  }
  function stepBall(b: Ball, dt: number) {
    if (b.gone) return;
    if (b.held > 0) return;
    b.vy += G * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > VMAX) { b.vx *= VMAX / sp; b.vy *= VMAX / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;

    for (const s of WALLS) {
      const hit = segHit(b, s, 0.45);
      if (hit > 380 && time - wallSnd > 0.06) { wallSnd = time; Sound.pin('wall', hit / 400); }
    }
    for (const p of POSTS) collide(b, p.x, p.y, p.r, 0.6);
    if (b.vy > 0 && b.y < 206 && b.x > LANE_X - R) segHit(b, GATE, 0.3);
    // tłok wyrzutni
    if (b.x > LANE_X && b.y > 800 + charge * 28 - R) { b.y = 800 + charge * 28 - R; if (b.vy > 0) b.vy = 0; b.vx = 0; b.x = 434; }

    bumpers.forEach((u, i) => {
      if (collide(b, u.x, u.y, u.r, 0.6, 420) > 0) {
        u.flash = 1; add(100); Sound.pin('bumper', 0.85 + i * 0.18); burst(b.x, b.y, i === 2 ? C.cyan : C.pink, 10, 240); bump(3);
      }
    });
    for (const s of slings) {
      const hit = segHit(b, s.s, 0.4);
      if (hit > 60) {
        b.vx += s.nx * 520; b.vy += s.ny * 520;
        s.flash = 1; add(10); Sound.pin('sling'); bump(2);
      }
    }
    for (const d of drops) {
      if (d.down) continue;
      if (segHit(b, d.s, 0.35) > 40) { d.down = true; d.flash = 1; add(1000, 50, d.s.a.y + 13, C.pink); Sound.pin('drop'); burst(32, d.s.a.y + 13, C.pink, 8); bankCheck(); }
    }
    for (const s of stands) {
      if (segHit(b, s.s, 0.35) > 40) {
        s.flash = 1;
        if (!s.lit) { s.lit = true; add(750, 380, s.s.a.y + 13, C.cyan); Sound.pin('target', 1.2); bankCheck(); } else { add(150); Sound.pin('target', 0.9); }
      }
    }
    flipHit(b, fl); flipHit(b, fr);   // po TILT łapy leżą, ale dalej są przeszkodą

    // czujniki
    lanes.forEach((l, i) => { if (Math.abs(b.x - l.x) < 14 && Math.abs(b.y - LANE_Y) < 12) laneHit(i); });
    if (b.cool <= 0 && Math.hypot(b.x - SAUCER.x, b.y - SAUCER.y) < 14 && sp < 900) saucerHit(b);
    if (orbitCool <= 0 && Math.hypot(b.x - ORBIT.x, b.y - ORBIT.y) < 22 && Math.abs(b.vx) > 250) {
      orbitCool = 1.2; add(1500, ORBIT.x, 60, C.purple); Sound.pin('lane', 1.4); say('ORBITA', '', C.purple, 1.1);
    }
    if (b.y > H + 30) drained(b);
  }
  function ballsCollide() {
    const live = balls.filter(b => !b.gone && b.held <= 0);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= R * 2 || d === 0) continue;
      const nx = dx / d, ny = dy / d, o = (R * 2 - d) / 2;
      a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) { a.vx += rv * nx * 0.95; a.vy += rv * ny * 0.95; b.vx -= rv * nx * 0.95; b.vy -= rv * ny * 0.95; }
    }
  }

  function update(dt: number) {
    time += dt;
    const on = phase === 'play' && !tilted;
    const dts = dt / SUB;
    for (let s = 0; s < SUB; s++) {
      stepFlip(fl, on && keys.l, dts);
      stepFlip(fr, on && keys.r, dts);
      for (const b of balls) stepBall(b, dts);
      ballsCollide();
    }
    balls = balls.filter(b => !b.gone);

    for (const b of balls) {
      if (b.cool > 0) b.cool -= dt;
      if (b.held > 0) {
        b.held -= dt;
        if (b.held <= 0) { b.cool = 0.7; b.vx = (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 160); b.vy = 520; Sound.pin('sling'); }
      }
      if (b.auto > 0) { b.auto -= dt; if (b.auto <= 0 && inLane(b)) launch(b, 0.85 + Math.random() * 0.15); }
      b.trail.push(pt(b.x, b.y)); if (b.trail.length > 10) b.trail.shift();
      // kulka zaklinowana gdzieś na stole: po chwili sama dostaje szturchnięcie
      if (b.held <= 0 && !inLane(b) && !keys.l && !keys.r && Math.hypot(b.vx, b.vy) < 15) {
        b.still += dt;
        if (b.still > 2.5) { b.still = 0; b.vx += (b.x < AXIS ? 1 : -1) * (80 + Math.random() * 80); b.vy -= 220; bump(5); }
      } else b.still = 0;
    }
    if (queue > 0) {
      queueT -= dt;
      if (queueT <= 0 && !balls.some(inLane)) { const nb = newBall(); nb.auto = 0.45; balls.push(nb); queue--; queueT = 0.9; }
    }
    if (charging) { const c0 = charge; charge = Math.min(1, charge + dt * 1.1); if (Math.floor(c0 * 8) !== Math.floor(charge * 8)) Sound.pin('charge', charge); }
    if (saveT > 0 && !balls.some(inLane)) saveT -= dt;
    if (dropsReset > 0) { dropsReset -= dt; if (dropsReset <= 0) drops.forEach(d => d.down = false); }
    if (orbitCool > 0) orbitCool -= dt;
    plungerKick = Math.max(0, plungerKick - dt);
    shake = Math.max(0, shake - dt * 40);
    bumpers.forEach(u => u.flash = Math.max(0, u.flash - dt * 4));
    slings.forEach(s => s.flash = Math.max(0, s.flash - dt * 5));
    drops.forEach(d => d.flash = Math.max(0, d.flash - dt * 3));
    stands.forEach(d => d.flash = Math.max(0, d.flash - dt * 3));
    lanes.forEach(l => { l.flash = Math.max(0, l.flash - dt * 3); l.cool -= dt; });
    saucerFlash = Math.max(0, saucerFlash - dt * 1.5);
    for (const p of sparks) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy = p.vy * 0.96 + 300 * dt; }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life > sparks[i].max) sparks.splice(i, 1);
    for (const p of pops) { p.life -= dt; p.y -= 40 * dt; }
    for (let i = pops.length - 1; i >= 0; i--) if (pops[i].life <= 0) pops.splice(i, 1);
    if (msg) { msg.t += dt; if (msg.t > msg.dur) msg = null; }
    if (phase === 'over') { overT += dt; if (overT > 5) { phase = 'attract'; msg = null; } }
    hud();
  }

  // ---------- rysowanie ----------
  function tablePath(c: CanvasRenderingContext2D) {
    c.beginPath();
    c.moveTo(10, 840);
    ARC.forEach(([x, y]) => c.lineTo(x, y));
    c.lineTo(450, 840); c.closePath();
  }
  function stroke(c: CanvasRenderingContext2D, color: string, width: number, blur: number, core = 0.35) {
    c.save();
    c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = color; c.lineWidth = width; c.shadowColor = color; c.shadowBlur = blur * k;
    c.stroke();
    c.shadowBlur = 0;
    if (core > 0) { c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = width * core; c.stroke(); }
    c.restore();
  }
  function line(c: CanvasRenderingContext2D, pts: number[][]) { c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); }
  function layer() { const cv = document.createElement('canvas'); cv.width = canvas.width; cv.height = canvas.height; const c = cv.getContext('2d')!; c.setTransform(k, 0, 0, k, 0, 0); return [cv, c] as const; }

  function drawBg() {
    const [cv, c] = layer();
    c.fillStyle = '#05010c'; c.fillRect(0, 0, W, H);
    c.save(); tablePath(c); c.clip();
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#07001a'); g.addColorStop(0.35, '#16063a'); g.addColorStop(HORIZON / H - 0.01, '#4a0d5e');
    g.addColorStop(HORIZON / H, '#160428'); g.addColorStop(1, '#060010');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // gwiazdy
    const rnd = rng(1986);
    for (let i = 0; i < 140; i++) {
      const x = rnd() * W, y = rnd() * (HORIZON - 40), s = rnd() * 1.3 + 0.3;
      c.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.6})`; c.fillRect(x, y, s, s);
    }
    // poświata i słońce w paski
    const glow = c.createRadialGradient(AXIS, 460, 30, AXIS, 460, 230);
    glow.addColorStop(0, 'rgba(255,60,172,.45)'); glow.addColorStop(1, 'rgba(255,60,172,0)');
    c.fillStyle = glow; c.fillRect(0, 200, W, HORIZON - 200);
    const sun = document.createElement('canvas'); sun.width = sun.height = Math.ceil(240 * k);
    const s = sun.getContext('2d')!; s.setTransform(k, 0, 0, k, 0, 0);
    const sg = s.createLinearGradient(0, 10, 0, 230);
    sg.addColorStop(0, C.yellow); sg.addColorStop(0.45, C.orange); sg.addColorStop(0.75, C.pink); sg.addColorStop(1, C.magenta);
    s.fillStyle = sg; s.beginPath(); s.arc(120, 120, 110, 0, Math.PI * 2); s.fill();
    s.globalCompositeOperation = 'destination-out';
    for (let i = 0, y = 128; y < 240; i++) { const h = 2 + i * 1.4; s.fillRect(0, y, 240, h); y += h + 9 - i * 0.6; }
    c.save(); c.beginPath(); c.rect(0, 0, W, HORIZON); c.clip();
    c.drawImage(sun, AXIS - 120, 470 - 120, 240, 240);
    c.restore();
    // góry z siatki
    const mountain = (pts: number[][], col: string) => {
      line(c, pts); c.lineTo(pts[pts.length - 1][0], HORIZON); c.lineTo(pts[0][0], HORIZON); c.closePath();
      const mg = c.createLinearGradient(0, 420, 0, HORIZON); mg.addColorStop(0, '#1d0636'); mg.addColorStop(1, '#0b0118');
      c.fillStyle = mg; c.fill();
      line(c, pts); stroke(c, col, 1.6, 8, 0);
      // grzbiety
      c.globalAlpha = 0.35;
      for (let i = 1; i < pts.length - 1; i++) { line(c, [pts[i], [pts[i][0] + (i % 2 ? 14 : -14), HORIZON]]); stroke(c, col, 1, 0, 0); }
      c.globalAlpha = 1;
    };
    const ML = [[10, 500], [38, 462], [62, 486], [96, 424], [132, 480], [150, 468], [176, 520]];
    mountain(ML, C.cyan);
    mountain(mirror(ML).reverse(), C.cyan);
    line(c, [[10, HORIZON], [LANE_X, HORIZON]]); stroke(c, C.magenta, 2, 14);
    c.restore();
    bg = cv;
  }

  function drawFg() {
    const [cv, c] = layer();
    // tor wyrzutni ciemniejszy
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(LANE_X, 200, 32, 640);
    // ściany
    line(c, [[10, 840], ...ARC, [450, 840]]); stroke(c, C.cyan, 3.5, 14);
    line(c, [[LANE_X, 206], [LANE_X, 840]]); stroke(c, C.cyan, 3, 12);
    line(c, [[GATE.a.x, GATE.a.y], [GATE.b.x, GATE.b.y]]); stroke(c, C.purple, 2, 8);
    line(c, GUIDE_L); stroke(c, C.pink, 4, 14); line(c, GUIDE_R); stroke(c, C.pink, 4, 14);
    POSTS.forEach(p => { c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fillStyle = '#fff'; c.shadowColor = C.pink; c.shadowBlur = 10 * k; c.fill(); c.shadowBlur = 0; });
    // procy
    for (const S of [SLING_L, SLING_R]) {
      line(c, S); c.closePath();
      c.fillStyle = 'rgba(255,60,172,.14)'; c.fill(); stroke(c, C.pink, 3, 10);
    }
    // przegródki torów
    DIVIDERS.forEach(d => { line(c, [[d.a.x, d.a.y], [d.b.x, d.b.y]]); stroke(c, C.purple, 7, 10, 0.25); });
    // napis i strzałki
    c.save();
    c.font = `italic 800 38px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const tg = c.createLinearGradient(0, 578, 0, 612);
    tg.addColorStop(0, '#9be7ff'); tg.addColorStop(0.48, '#ffffff'); tg.addColorStop(0.5, '#3a1a6e'); tg.addColorStop(0.7, '#ff7ac6'); tg.addColorStop(1, '#ffd2ef');
    c.shadowColor = C.magenta; c.shadowBlur = 18 * k;
    c.fillStyle = tg; c.fillText('SCAMBOX', AXIS, 596);
    c.shadowBlur = 0; c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.7)'; c.strokeText('SCAMBOX', AXIS, 596);
    c.font = `600 9px ${FONT}`; c.fillStyle = C.cyan; c.fillText('N E O N   D R I V E   ·   1 9 8 6', AXIS, 620);
    c.restore();
    // zgaszone lampki
    allLamps().forEach(l => lamp(c, l, false));
    fg = cv;
  }

  type Lamp = { x: number; y: number; label: string; color: string; on: boolean; shape: 'dot' | 'arrow' | 'tag' };
  function allLamps(): Lamp[] {
    const t = time;
    const chase = phase !== 'play';
    const L: Lamp[] = [];
    lanes.forEach((l, i) => L.push({ x: l.x, y: 154, label: l.label, color: C.cyan, on: chase ? Math.floor(t * 6 + i) % 4 === 0 : l.lit || l.flash > 0.5, shape: 'dot' }));
    drops.forEach((d, i) => L.push({ x: 58, y: d.s.a.y + 13, label: d.label, color: C.pink, on: chase ? Math.floor(t * 5 + i) % 3 === 0 : d.down, shape: 'dot' }));
    stands.forEach((s, i) => L.push({ x: 376, y: s.s.a.y + 13, label: s.label, color: C.cyan, on: chase ? Math.floor(t * 5 + i + 1) % 3 === 0 : s.lit, shape: 'dot' }));
    [2, 3, 4, 5].forEach((m, i) => L.push({ x: 169 + i * 30, y: 648, label: `x${m}`, color: C.yellow, on: chase ? Math.floor(t * 4 + i) % 4 === 0 : mult >= m, shape: 'tag' }));
    const sunLit = multiball || (vhsDone && radDone);
    L.push({ x: AXIS, y: 532, label: multiball ? 'JACKPOT' : sunLit ? 'MULTIBALL' : 'SŁOŃCE', color: C.yellow, on: chase ? Math.floor(t * 3) % 2 === 0 : sunLit ? Math.floor(t * 4) % 2 === 0 : false, shape: 'arrow' });
    L.push({ x: AXIS, y: 824, label: 'KULKA CHRONIONA', color: C.cyan, on: saveT > 0 && (saveT > 2 || Math.floor(t * 8) % 2 === 0), shape: 'tag' });
    return L;
  }
  function lamp(c: CanvasRenderingContext2D, l: Lamp, on: boolean) {
    c.save();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const col = on ? l.color : 'rgba(255,255,255,.14)';
    if (on) { c.shadowColor = l.color; c.shadowBlur = 16 * k; }
    if (l.shape === 'dot') {
      c.beginPath(); c.arc(l.x, l.y, 9, 0, Math.PI * 2);
      c.fillStyle = on ? l.color : 'rgba(30,10,50,.85)'; c.fill();
      c.lineWidth = 1.5; c.strokeStyle = on ? '#fff' : 'rgba(255,255,255,.18)'; c.stroke();
      c.shadowBlur = 0; c.font = `800 10px ${FONT}`; c.fillStyle = on ? '#14001f' : 'rgba(255,255,255,.35)'; c.fillText(l.label, l.x, l.y + 0.5);
    } else if (l.shape === 'tag') {
      c.font = `800 10px ${FONT}`;
      const w = c.measureText(l.label).width + 12;
      c.beginPath(); c.roundRect(l.x - w / 2, l.y - 8, w, 16, 4);
      c.fillStyle = on ? l.color : 'rgba(30,10,50,.8)'; c.fill();
      c.shadowBlur = 0; c.fillStyle = on ? '#14001f' : 'rgba(255,255,255,.3)'; c.fillText(l.label, l.x, l.y + 0.5);
    } else {
      c.beginPath(); c.moveTo(l.x, l.y - 22); c.lineTo(l.x + 16, l.y - 4); c.lineTo(l.x - 16, l.y - 4); c.closePath();
      c.fillStyle = on ? l.color : 'rgba(30,10,50,.8)'; c.fill();
      c.lineWidth = 1.2; c.strokeStyle = on ? '#fff' : 'rgba(255,255,255,.2)'; c.stroke();
      c.shadowBlur = on ? 10 * k : 0; c.font = `800 9px ${FONT}`; c.fillStyle = col; c.fillText(l.label, l.x, l.y + 8);
    }
    c.restore();
  }

  function drawGrid(c: CanvasRenderingContext2D) {
    c.save(); c.beginPath(); c.rect(10, HORIZON, LANE_X - 10, H - HORIZON); c.clip();
    c.strokeStyle = 'rgba(247,6,207,.35)'; c.lineWidth = 1.2;
    c.beginPath();
    for (let i = -14; i <= 14; i++) { c.moveTo(AXIS + i * 5, HORIZON); c.lineTo(AXIS + i * 62, H); }
    const phase0 = reduced() ? 0 : (time * 0.5) % 1;
    for (let j = 0; j < 14; j++) {
      const t = (j + phase0) / 14, y = HORIZON + (H - HORIZON) * t * t;
      c.moveTo(10, y); c.lineTo(LANE_X, y);
    }
    c.stroke();
    c.restore();
  }
  function drawFlipper(c: CanvasRenderingContext2D, f: Flip) {
    const ca = Math.cos(f.ang), sa = Math.sin(f.ang), nx = -sa, ny = ca;
    const tx = f.x + ca * LEN, ty = f.y + sa * LEN;
    c.save();
    c.beginPath();
    c.arc(f.x, f.y, FR0, f.ang + Math.PI / 2, f.ang - Math.PI / 2);
    c.lineTo(tx - nx * FR1, ty - ny * FR1);
    c.arc(tx, ty, FR1, f.ang - Math.PI / 2, f.ang + Math.PI / 2);
    c.closePath();
    const g = c.createLinearGradient(f.x - nx * FR0, f.y - ny * FR0, f.x + nx * FR0, f.y + ny * FR0);
    g.addColorStop(0, '#ffd2ef'); g.addColorStop(0.5, C.pink); g.addColorStop(1, '#7a0a5c');
    c.fillStyle = g; c.shadowColor = C.pink; c.shadowBlur = (f.on ? 26 : 14) * k; c.fill();
    c.shadowBlur = 0; c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke();
    c.beginPath(); c.arc(f.x, f.y, 4, 0, Math.PI * 2); c.fillStyle = '#2a0636'; c.fill();
    c.restore();
  }
  function drawBall(c: CanvasRenderingContext2D, b: Ball) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    b.trail.forEach((p, i) => {
      const a = (i / b.trail.length) * 0.35;
      c.beginPath(); c.arc(p.x, p.y, R * (0.4 + i / b.trail.length * 0.6), 0, Math.PI * 2);
      c.fillStyle = `rgba(45,226,230,${a})`; c.fill();
    });
    c.restore();
    c.save();
    const g = c.createRadialGradient(b.x - 3, b.y - 4, 1, b.x, b.y, R);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#d9d9ff'); g.addColorStop(0.7, '#6d5a9e'); g.addColorStop(1, '#2a1f45');
    c.shadowColor = 'rgba(160,240,255,.9)'; c.shadowBlur = 12 * k;
    c.beginPath(); c.arc(b.x, b.y, R, 0, Math.PI * 2); c.fillStyle = g; c.fill();
    c.shadowBlur = 0;
    // odbicie neonów na chromie
    c.beginPath(); c.arc(b.x, b.y, R - 1.5, 0.2, 1.2); c.strokeStyle = 'rgba(255,60,172,.85)'; c.lineWidth = 1.5; c.stroke();
    c.beginPath(); c.arc(b.x, b.y, R - 1.5, 3.4, 4.2); c.strokeStyle = 'rgba(45,226,230,.8)'; c.stroke();
    c.restore();
  }
  function neonText(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, alpha = 1) {
    c.save();
    c.globalAlpha = alpha;
    c.font = `italic 900 ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = color; c.shadowBlur = 22 * k;
    c.lineWidth = 3; c.strokeStyle = color; c.strokeText(text, x, y);
    c.shadowBlur = 8 * k; c.fillStyle = '#fff'; c.fillText(text, x, y);
    c.restore();
  }

  function render() {
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
    c.setTransform(k, 0, 0, k, sx * k, sy * k);
    c.drawImage(bg, 0, 0, W, H);
    drawGrid(c);
    c.drawImage(fg, 0, 0, W, H);

    // procy błyskają przy kopnięciu
    slings.forEach(s => {
      if (s.flash <= 0) return;
      c.save(); c.globalAlpha = s.flash; line(c, [[s.s.a.x, s.s.a.y], [s.s.b.x, s.s.b.y]]); stroke(c, '#fff', 5, 22); c.restore();
    });
    // tarcza słońca
    const sunLit = multiball || (vhsDone && radDone);
    c.save();
    c.beginPath(); c.arc(SAUCER.x, SAUCER.y, 16, 0, Math.PI * 2);
    c.fillStyle = '#12001c'; c.fill();
    c.lineWidth = 3; c.strokeStyle = sunLit || saucerFlash > 0 ? '#fff' : C.yellow;
    c.shadowColor = C.yellow; c.shadowBlur = (12 + (sunLit ? 10 + Math.sin(time * 8) * 8 : 0) + saucerFlash * 30) * k; c.stroke();
    c.restore();
    if (saucerFlash > 0) { c.save(); c.globalAlpha = saucerFlash * 0.6; c.beginPath(); c.arc(SAUCER.x, SAUCER.y, 16 + (1 - saucerFlash) * 60, 0, Math.PI * 2); stroke(c, C.yellow, 3, 20, 0); c.restore(); }

    allLamps().forEach(l => { if (l.on) lamp(c, l, true); });

    // cele
    drops.forEach(d => {
      c.save();
      const { a, b } = d.s;
      if (d.down) { c.globalAlpha = 0.3; line(c, [[a.x - 4, a.y], [a.x - 4, b.y]]); stroke(c, C.pink, 2, 0, 0); }
      else {
        c.beginPath(); c.roundRect(a.x - 8, a.y, 12, b.y - a.y, 3);
        c.fillStyle = d.flash ? '#fff' : C.pink; c.shadowColor = C.pink; c.shadowBlur = 14 * k; c.fill();
      }
      c.restore();
    });
    stands.forEach(s => {
      c.save();
      const { a, b } = s.s;
      c.beginPath(); c.roundRect(a.x - 4, a.y, 10, b.y - a.y, 3);
      c.fillStyle = s.flash > 0.3 ? '#fff' : s.lit ? C.cyan : '#1e3a5a';
      c.shadowColor = C.cyan; c.shadowBlur = (s.lit ? 16 : 4) * k; c.fill();
      c.restore();
    });
    // bumpery
    bumpers.forEach((u, i) => {
      const col = i === 2 ? C.cyan : C.pink;
      c.save();
      c.beginPath(); c.arc(u.x, u.y + 3, u.r + 2, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,.5)'; c.fill();
      c.beginPath(); c.arc(u.x, u.y, u.r, 0, Math.PI * 2);
      const g = c.createRadialGradient(u.x - 6, u.y - 8, 2, u.x, u.y, u.r);
      g.addColorStop(0, u.flash > 0 ? '#fff' : '#ffd2ef'); g.addColorStop(0.5, u.flash > 0 ? col : '#3a0a4e'); g.addColorStop(1, '#14001f');
      c.fillStyle = g; c.shadowColor = col; c.shadowBlur = (14 + u.flash * 30) * k; c.fill();
      c.shadowBlur = 0; c.lineWidth = 3; c.strokeStyle = col; c.stroke();
      c.beginPath(); c.arc(u.x, u.y, u.r - 8, 0, Math.PI * 2); c.lineWidth = 2; c.strokeStyle = u.flash > 0 ? '#fff' : 'rgba(255,255,255,.5)'; c.stroke();
      if (u.flash > 0) { c.globalAlpha = u.flash; c.beginPath(); c.arc(u.x, u.y, u.r + (1 - u.flash) * 22, 0, Math.PI * 2); c.lineWidth = 2; c.strokeStyle = col; c.stroke(); }
      c.restore();
    });
    drawFlipper(c, fl); drawFlipper(c, fr);
    balls.forEach(b => drawBall(c, b));

    // fartuch na dole (kulka znika pod nim) i tłok
    c.save();
    c.beginPath(); c.moveTo(10, 808); c.lineTo(160, 808); c.lineTo(176, 840); c.lineTo(252, 840); c.lineTo(268, 808); c.lineTo(LANE_X, 808); c.lineTo(LANE_X, 840); c.lineTo(10, 840); c.closePath();
    const ag = c.createLinearGradient(0, 808, 0, 840); ag.addColorStop(0, '#2a0b3e'); ag.addColorStop(1, '#0c0216');
    c.fillStyle = ag; c.fill();
    line(c, [[10, 808], [160, 808]]); stroke(c, C.purple, 2, 8, 0); line(c, [[268, 808], [LANE_X, 808]]); stroke(c, C.purple, 2, 8, 0);
    c.restore();
    const L = allLamps(); const save = L[L.length - 1]; lamp(c, save, save.on);
    const py = 800 + charge * 28 - plungerKick * 60;
    c.save();
    c.fillStyle = '#c9c9e8'; c.fillRect(424, py, 20, 6);
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1.5; c.beginPath();
    for (let y = py + 8; y < 838; y += (838 - py) / 8) { c.moveTo(424, y); c.lineTo(444, y + 3); }
    c.stroke();
    if (charging) { c.fillStyle = C.yellow; c.shadowColor = C.yellow; c.shadowBlur = 12 * k; c.fillRect(422, 840 - charge * 120, 3, charge * 120); }
    c.restore();

    // iskry i liczby
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const p of sparks) {
      const a = 1 - p.life / p.max;
      c.globalAlpha = a; c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, p.size * (0.5 + a), 0, Math.PI * 2); c.fill();
    }
    c.restore();
    for (const p of pops) neonText(c, p.text, p.x, p.y, 16, p.color, Math.min(1, p.life * 2));

    if (msg) {
      const m = msg, a = Math.min(1, m.t * 6, (m.dur - m.t) * 3);
      const z = 1 + Math.max(0, 0.25 - m.t) * 1.5;
      c.save(); c.translate(AXIS, 215); c.scale(z, z);
      c.fillStyle = `rgba(8,0,20,${0.55 * a})`; c.beginPath(); c.roundRect(-150, -36, 300, m.sub ? 82 : 64, 12); c.fill();
      neonText(c, m.text, 0, -4, m.text.length > 12 ? 26 : 38, m.color, a);
      if (m.sub) { c.globalAlpha = a; c.font = `700 13px ${FONT}`; c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText(m.sub, 0, 30); }
      c.restore();
    }
    if (phase === 'attract' && !msg) {
      const a = 0.6 + Math.sin(time * 4) * 0.4;
      neonText(c, 'WCIŚNIJ START', AXIS, 215, 30, C.pink, a);
      c.save(); c.font = `700 12px ${FONT}`; c.textAlign = 'center'; c.fillStyle = `rgba(255,255,255,${a})`; c.fillText('spacja albo dotknij stołu', AXIS, 245); c.restore();
    }
    if (tilted) neonText(c, 'TILT', AXIS, 420, 70, C.orange, 0.5 + Math.sin(time * 10) * 0.3);
  }

  // ---------- pętla ----------
  let raf = 0, last = 0;
  function frame(now: number) {
    const dt = Math.min(1 / 30, (now - (last || now)) / 1000);
    last = now;
    update(dt);
    render();
    raf = requestAnimationFrame(frame);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const cssW = canvas.clientWidth || rect.width || W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    k = (cssW / W) * dpr;
    canvas.width = Math.round(W * k); canvas.height = Math.round(H * k);
    drawBg(); drawFg();
  }

  // ---------- sterowanie ----------
  const typing = (e: Event) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
  const LEFT = ['ArrowLeft', 'KeyZ', 'ShiftLeft', 'KeyA'], RIGHT = ['ArrowRight', 'Slash', 'ShiftRight', 'KeyL', 'KeyD'], PLUNGE = ['Space', 'ArrowDown', 'Enter', 'KeyS'];
  function onKey(e: KeyboardEvent, down: boolean) {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (LEFT.includes(code)) setFlip('l', down);
    else if (RIGHT.includes(code)) setFlip('r', down);
    else if (PLUNGE.includes(code)) { if (down && !e.repeat) plungerDown(); else if (!down) plungerUp(); }
    else if (code === 'KeyN' && down && !e.repeat) nudge();
    else return;
    e.preventDefault();
  }
  const kd = (e: KeyboardEvent) => onKey(e, true), ku = (e: KeyboardEvent) => onKey(e, false);
  function pdown(e: PointerEvent) {
    e.preventDefault();
    Sound.unlock();
    if (phase !== 'play') { start(); return; }
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    let side: 'l' | 'r' | 'p' = x < 0.5 ? 'l' : 'r';
    if (x > 0.82 && y > 0.55 && balls.some(b => inLane(b) && !b.auto)) side = 'p';
    pointers.set(e.pointerId, side);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* stary Safari */ }
    if (side === 'p') charging = true; else setFlip(side, true);
  }
  function pup(e: PointerEvent) {
    const side = pointers.get(e.pointerId);
    if (!side) return;
    pointers.delete(e.pointerId);
    if (side === 'p') plungerUp();
    else if (![...pointers.values()].includes(side)) setFlip(side, false);
  }
  const blur = () => { setFlip('l', false); setFlip('r', false); plungerUp(); };

  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', blur);
  canvas.addEventListener('pointerdown', pdown);
  canvas.addEventListener('pointerup', pup);
  canvas.addEventListener('pointercancel', pup);
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();
  hud();
  raf = requestAnimationFrame(frame);

  return {
    start,
    resize,
    state: () => ({ balls: balls.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy) })), score, phase, ball: ballNo }),
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      canvas.removeEventListener('pointerdown', pdown);
      canvas.removeEventListener('pointerup', pup);
      canvas.removeEventListener('pointercancel', pup);
    },
  };
}
