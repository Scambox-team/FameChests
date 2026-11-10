// Pinball (zakładka Gry -> Pinball): rysowanie, dźwięk i sterowanie na jednym płótnie 2D. Fizykę i zasady liczy core.ts (ten sam
// kod w Rust sprawdza wynik na serwerze: przeglądarka zapisuje wciśnięcia, serwer odtwarza grę i sam liczy punkty).
// Stół ma stały układ współrzędnych W x H (y w dół); płótno skaluje go do miejsca na ekranie.
// Warstwy: tło (niebo, słońce, góry) i stół (ściany, prowadnice) rysujemy raz do osobnych płócien,
// co klatkę dochodzą siatka, lampki, bumpery, łapy, kulki i iskry.
import { Sound } from '../../sound/sound';
import { baseTheme } from '../../styles/theme';
import { SKINS, type PinSkin } from './skins';
import { ARC, AXIS, BALLS, DIVIDERS, FR0, FR1, GATE, INPUT_CODES, LANE_X, R, Sim, TICK, W, geoOf, mirror, type Ball, type Flip, type Fx, type Input } from './core';

export { W };
const VH = 840;             // wysokość widoku: wyższy stół przewija się za kulką
const ZMAX = 2.6;            // największe przybliżenie

type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Pop = { x: number; y: number; text: string; life: number; color: string };

export type PinHud = { level: number; phase: 'attract' | 'play' | 'over'; score: number; ball: number; balls: number; mult: number; best: number; multiball: boolean; save: boolean; tilt: boolean };
/** Zapis gry do sprawdzenia przez serwer: ziarno od serwera, zdarzenia (tick, kod) i liczba ticków do końca gry */
export type PinRun = { seed: number; ticks: number; log: number[]; verified: boolean };
export type PinballGame = {
  destroy(): void; start(): void; resize(): void; zoom(delta: number): boolean; resetZoom(): void;
  getRun(): PinRun | null;
  state(): { balls: { x: number; y: number; vx: number; vy: number }[]; score: number; phase: string; ball: number; tick: number };
};
export type PinOptions = {
  /** Wołane przy starcie gry: zwraca ziarno od serwera (gra od razu po tym) albo null = gra bez weryfikacji i bez nagród */
  begin?: () => Promise<number | null>;
  /** Tylko do testów: stały generator czasu (ms) zamiast requestAnimationFrame */
  seed?: number;
};

// powtarzalny „losowy” układ gwiazd
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const FONT = '"Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif';

export function createPinball(canvas: HTMLCanvasElement, onHud: (h: PinHud) => void, level = 1, opts: PinOptions = {}): PinballGame {
  const geo = geoOf(level);
  const LV = geo.spec, H = geo.H, DY = geo.DY;
  const HORIZON = 520;
  const GUIDE_L = geo.guideL, GUIDE_R = geo.guideR, SLING_L = geo.slingL, SLING_R = geo.slingR, POSTS = geo.posts;
  const SAUCER = geo.saucer;
  const th = baseTheme();
  const SK: PinSkin | null = th === 'warm' || th === 'aero' || th === 'vapor' ? SKINS[th] : null;   // motyw inny niż domyślny: własny wygląd (skins.ts)
  const C: Record<string, string> = { ...LV.palette, ...(SK?.pal ?? {}) };
  const ctx = canvas.getContext('2d')!;
  const bestKey = level === 1 ? 'pinballBest' : `pinballBest${level}`;
  let k = 1;                                  // piksele urządzenia na jednostkę stołu
  let bg: HTMLCanvasElement, fg: HTMLCanvasElement;

  // ---------- efekty z rdzenia ----------
  let best = 0;
  try { best = +(localStorage.getItem(bestKey) ?? 0) || 0; } catch { /* prywatne okno */ }
  const sparks: Spark[] = [];
  const pops: Pop[] = [];
  let msg: { text: string; sub: string; t: number; dur: number; color: string } | null = null;
  let shake = 0, time = 0;
  const bump = (v: number) => { if (!reduced()) shake = Math.max(shake, v); };
  function burst(x: number, y: number, color: string, n = 14, speed = 260) {
    if (reduced()) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.35 + Math.random() * 0.4, color, size: 1.5 + Math.random() * 2 });
    }
  }
  const fx: Fx = {
    sound: (kind, p = 1) => Sound.pin(kind, p),
    burst: (x, y, color, n, speed) => burst(x, y, C[color] ?? color, n, speed),
    say: (text, sub, color, dur) => { msg = { text, sub, t: 0, dur, color: C[color] ?? color }; },
    clearMsg: () => { msg = null; },
    pop: (x, y, value, color) => { pops.push({ x, y, text: value.toLocaleString('pl-PL'), life: 1.1, color: C[color] ?? color }); },
    bump,
    over: score => {
      const record = score > best;
      if (record) { best = score; try { localStorage.setItem(bestKey, String(best)); } catch { /* bez zapisu */ } }
      msg = { text: record ? 'NOWY REKORD' : 'KONIEC GRY', sub: score.toLocaleString('pl-PL'), t: 0, dur: 99, color: record ? C.yellow : C.pink };
      if (run) run.ticks = sim.tick;
    },
  };

  // ---------- gra ----------
  let sim = new Sim(level, 0, fx);              // pusty stół na ekranie startowym; prawdziwa gra dostaje ziarno od serwera
  let run: PinRun | null = null;
  let starting = false, destroyed = false;
  const held = { l: false, r: false };           // klawisze naprawdę wciśnięte (żeby przenieść je do nowej gry)

  // lokalne odnośniki do stanu rdzenia (rysowanie czyta je jak zmienne); tablice dostają nowe wartości przy każdej grze
  let phase = sim.phase, score = 0, ballNo = 1, mult = 1, multiball = false, vhsDone = false, radDone = false, saveT = 0, tilted = false;
  let charge = 0, charging = false, plungerKick = 0, saucerFlash = 0;
  let balls: Ball[] = [];
  let fl: Flip, fr: Flip, ups: Sim['ups'], bumpers: Sim['bumpers'], slings: Sim['slings'], drops: Sim['drops'], stands: Sim['stands'], lanes: Sim['lanes'];
  let portals: Sim['portals'], holes: Sim['holes'], spinners: Sim['spinners'], movers: Sim['movers'], blades: Sim['blades'], fans: Sim['fans'], sticky: Sim['sticky'];
  function bind() {
    ({ fl, fr, ups, bumpers, slings, drops, stands, lanes, portals, holes, spinners, movers, blades, fans, sticky } = sim);
  }
  function sync() {
    ({ phase, score, mult, multiball, vhsDone, radDone, tilted, charge, charging, plungerKick, saucerFlash, balls, ballNo } = sim);
    saveT = sim.saveT;
  }
  bind(); sync();

  // kamera: bez przybliżenia stała (wyższy stół przewija się za kulką), z przybliżeniem jedzie za kulką
  let camY = Math.max(0, H - VH);               // góra widoku (stół wyższy niż okno przewija się)
  let zm = 1, zmTo = 1, camCX = W / 2, camCY = camY + VH / 2;

  // ---------- HUD ----------
  let hudSig = '';
  function hud() {
    const h: PinHud = { level, phase, score, ball: Math.min(ballNo, BALLS), balls: BALLS, mult, best, multiball, save: saveT > 0, tilt: tilted };
    const sig = JSON.stringify(h);
    if (sig !== hudSig) { hudSig = sig; onHud(h); }
  }

  /** Jedno zdarzenie gracza: trafia do rdzenia i do zapisu gry (serwer odtworzy je w tym samym ticku) */
  function inp(code: Input) {
    if (sim.phase !== 'play' || !run) return;
    run.log.push(sim.tick, INPUT_CODES.indexOf(code));
    sim.input(code);
  }
  function beginGame(seed: number, verified: boolean) {
    sim = new Sim(level, seed, fx);
    run = { seed, ticks: 0, log: [], verified };
    bind();
    sim.start();
    sparks.length = 0; pops.length = 0;
    // klawisze wciśnięte jeszcze przed startem działają od pierwszego ticku
    if (held.l) inp('l+');
    if (held.r) inp('r+');
    sync(); hud();
  }
  async function start() {
    if (sim.phase === 'play' || starting) return;
    starting = true;
    Sound.unlock();
    msg = { text: 'ŁĄCZĘ…', sub: '', t: 0, dur: 8, color: C.cyan };
    let seed: number | null = null;
    try { seed = opts.begin ? await opts.begin() : null; } catch { seed = null; }
    starting = false;
    if (destroyed) return;
    msg = null;
    beginGame(seed ?? (opts.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0, seed !== null);
  }

  // ---------- rysowanie ----------
  function tablePath(c: CanvasRenderingContext2D) {
    c.beginPath();
    c.moveTo(10, H);
    ARC.forEach(([x, y]) => c.lineTo(x, y));
    c.lineTo(450, H); c.closePath();
  }
  function stroke(c: CanvasRenderingContext2D, color: string, width: number, blur: number, core = 0.35) {
    if (SK?.stroke) return SK.stroke(c, color, width, blur, core, k);
    c.save();
    c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = color; c.lineWidth = width; c.shadowColor = color; c.shadowBlur = blur * k;
    c.stroke();
    c.shadowBlur = 0;
    if (core > 0) { c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = width * core; c.stroke(); }
    c.restore();
  }
  function line(c: CanvasRenderingContext2D, pts: number[][]) { c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); }
  function layer() { const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k); const c = cv.getContext('2d')!; c.setTransform(k, 0, 0, k, 0, 0); return [cv, c] as const; }

  // tła poziomów innych niż Neon Drive: kosmos, pizzeria, wesołe miasteczko, piekło
  function bgOther(c: CanvasRenderingContext2D) {
    const rnd = rng(LV.id * 977);
    const grad = (a: string, b: string, cc?: string) => {
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, a); if (cc) g.addColorStop(0.5, cc); g.addColorStop(1, b); return g;
    };
    c.fillStyle = '#05010c'; c.fillRect(0, 0, W, H);
    c.save(); tablePath(c); c.clip();
    if (LV.theme === 'space') {
      c.fillStyle = grad('#02030f', '#1a0a3a', '#0b0830'); c.fillRect(0, 0, W, H);
      for (let i = 0; i < 3 + H / 350; i++) {
        const x = rnd() * W, y = rnd() * H, g = c.createRadialGradient(x, y, 10, x, y, 230);
        g.addColorStop(0, [C.magenta, C.blue, C.pink][i % 3] + '33'); g.addColorStop(1, 'transparent');
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      }
      for (let i = 0; i < H / 5; i++) { const s0 = rnd() * 1.4 + 0.3; c.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.7})`; c.fillRect(rnd() * W, rnd() * H, s0, s0); }
      // planeta z pierścieniem i mały księżyc
      const py = H * 0.42, pg = c.createRadialGradient(AXIS + 90, py - 30, 8, AXIS + 110, py, 90);
      pg.addColorStop(0, '#ffd9a8'); pg.addColorStop(0.55, '#c0663d'); pg.addColorStop(1, '#3a1226');
      c.fillStyle = pg; c.beginPath(); c.arc(AXIS + 110, py, 80, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,224,168,.55)'; c.lineWidth = 6; c.beginPath(); c.ellipse(AXIS + 110, py, 140, 28, -0.35, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#9aa3c7'; c.beginPath(); c.arc(70, H * 0.7, 26, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(110,231,255,.25)'; c.lineWidth = 1;
      for (let i = 0; i < 3; i++) { c.beginPath(); let x = rnd() * W, y = rnd() * H; c.moveTo(x, y); for (let j = 0; j < 5; j++) { x += (rnd() - 0.5) * 120; y += (rnd() - 0.2) * 90; c.lineTo(x, y); } c.stroke(); }
    } else if (LV.theme === 'pizza') {
      c.fillStyle = grad('#2a0a06', '#4a1a0c'); c.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 44) for (let x = 0; x < W; x += 44) {
        if (((x / 44) + (y / 44)) % 2 === 0) { c.fillStyle = 'rgba(255,60,60,.09)'; c.fillRect(x, y, 44, 44); }
      }
      c.globalAlpha = 0.5;
      const cy = H * 0.5;
      c.fillStyle = '#b8731f'; c.beginPath(); c.arc(AXIS, cy, 200, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffc94d'; c.beginPath(); c.arc(AXIS, cy, 180, 0, Math.PI * 2); c.fill();
      for (let i = 0; i < 14; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * 150; c.fillStyle = '#c1272d'; c.beginPath(); c.arc(AXIS + Math.cos(a) * d, cy + Math.sin(a) * d, 17, 0, 6.28); c.fill(); }
      for (let i = 0; i < 10; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * 160; c.fillStyle = '#2f9e44'; c.beginPath(); c.ellipse(AXIS + Math.cos(a) * d, cy + Math.sin(a) * d, 9, 5, a, 0, 6.28); c.fill(); }
      c.globalAlpha = 1;
    } else if (LV.theme === 'carnival') {
      c.fillStyle = grad('#0d0538', '#2a0a4d'); c.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 46) { c.fillStyle = (x / 46) % 2 ? 'rgba(255,60,120,.1)' : 'rgba(255,255,255,.05)'; c.fillRect(x, 0, 46, H); }
      c.globalAlpha = 0.4; c.strokeStyle = C.cyan; c.lineWidth = 4;
      const cy = H * 0.5; c.beginPath(); c.arc(AXIS, cy, 170, 0, Math.PI * 2); c.stroke();
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6; c.beginPath(); c.moveTo(AXIS, cy); c.lineTo(AXIS + Math.cos(a) * 170, cy + Math.sin(a) * 170); c.stroke();
        c.fillStyle = [C.pink, C.yellow, C.cyan][i % 3]; c.beginPath(); c.arc(AXIS + Math.cos(a) * 170, cy + Math.sin(a) * 170, 12, 0, 6.28); c.fill();
      }
      c.globalAlpha = 1;
      for (let y = 250; y < H; y += 320) for (let x = 14; x < W; x += 24) {
        c.fillStyle = [C.yellow, C.pink, C.cyan, C.orange][(x / 24) % 4 | 0]; c.beginPath(); c.arc(x, y + Math.sin(x / W * Math.PI) * 24, 4, 0, 6.28); c.fill();
      }
    } else {
      c.fillStyle = grad('#0a0000', '#2a0010', '#14000a'); c.fillRect(0, 0, W, H);
      for (let i = 0; i < 5; i++) {
        const y = H * (0.1 + i * 0.2), g = c.createRadialGradient(AXIS, y, 10, AXIS, y, 260);
        g.addColorStop(0, 'rgba(255,45,85,.28)'); g.addColorStop(1, 'transparent'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      }
      c.strokeStyle = C.orange; c.lineWidth = 2; c.shadowColor = C.orange; c.shadowBlur = 10 * k; c.globalAlpha = 0.5;
      for (let i = 0; i < 9; i++) {
        let x = rnd() < 0.5 ? 12 : 448, y = rnd() * H; c.beginPath(); c.moveTo(x, y);
        for (let j = 0; j < 6; j++) { x += (x < 200 ? 1 : -1) * rnd() * 40; y += (rnd() - 0.5) * 70; c.lineTo(x, y); }
        c.stroke();
      }
      c.shadowBlur = 0; c.strokeStyle = C.pink; c.lineWidth = 3; c.globalAlpha = 0.4;
      const cy = H * 0.5; c.beginPath(); c.arc(AXIS, cy, 160, 0, 6.28); c.stroke();
      c.beginPath(); for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + i * 4 * Math.PI / 5; c.lineTo(AXIS + Math.cos(a) * 160, cy + Math.sin(a) * 160); } c.stroke();
      c.globalAlpha = 1;
    }
    // poświata dolnej części, żeby łapy i prowadnice się odcinały
    const fg2 = c.createLinearGradient(0, H - 240, 0, H); fg2.addColorStop(0, 'transparent'); fg2.addColorStop(1, 'rgba(0,0,0,.5)');
    c.fillStyle = fg2; c.fillRect(0, H - 240, W, 240);
    c.restore();
  }

  function drawBg() {
    const [cv, c] = layer();
    if (SK) {
      SK.bg(c, { W, H, AXIS, HORIZON, k, saucer: { x: SAUCER.x, y: SAUCER.y }, tablePath, rng, levelId: LV.id }, () => drawBg());
      bg = cv; return;
    }
    if (LV.theme !== 'neon') { bgOther(c); bg = cv; return; }
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
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(LANE_X, 200, 32, H - 200);
    // ściany
    line(c, [[10, H], ...ARC, [450, H]]); stroke(c, C.cyan, 3.5, 14);
    line(c, [[LANE_X, 206], [LANE_X, H]]); stroke(c, C.cyan, 3, 12);
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
    if (SK?.title) SK.title(c, LV.title, LV.tagline, AXIS, 596 + DY, C, k);
    else {
    c.save();
    c.font = `italic 800 38px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const tg = c.createLinearGradient(0, 578 + DY, 0, 612 + DY);
    tg.addColorStop(0, '#9be7ff'); tg.addColorStop(0.48, '#ffffff'); tg.addColorStop(0.5, '#3a1a6e'); tg.addColorStop(0.7, '#ff7ac6'); tg.addColorStop(1, '#ffd2ef');
    c.shadowColor = C.magenta; c.shadowBlur = 18 * k;
    c.fillStyle = tg; c.fillText(LV.title, AXIS, 596 + DY);
    c.shadowBlur = 0; c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.7)'; c.strokeText(LV.title, AXIS, 596 + DY);
    c.font = `600 9px ${FONT}`; c.fillStyle = C.cyan; c.fillText(LV.tagline, AXIS, 620 + DY);
    c.restore();
    }
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
    [2, 3, 4, 5].forEach((m, i) => L.push({ x: 169 + i * 30, y: 648 + DY, label: `x${m}`, color: C.yellow, on: chase ? Math.floor(t * 4 + i) % 4 === 0 : mult >= m, shape: 'tag' }));
    const sunLit = multiball || (vhsDone && radDone);
    L.push({ x: AXIS, y: SAUCER.y + 62, label: multiball ? 'JACKPOT' : sunLit ? 'MULTIBALL' : 'SŁOŃCE', color: C.yellow, on: chase ? Math.floor(t * 3) % 2 === 0 : sunLit ? Math.floor(t * 4) % 2 === 0 : false, shape: 'arrow' });
    L.push({ x: AXIS, y: H - 16, label: 'KULKA CHRONIONA', color: C.cyan, on: saveT > 0 && (saveT > 2 || Math.floor(t * 8) % 2 === 0), shape: 'tag' });
    return L;
  }
  function lamp(c: CanvasRenderingContext2D, l: Lamp, on: boolean) {
    if (SK?.lamp) return SK.lamp(c, { ...l, on }, k);
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
    if (SK?.flipper) return SK.flipper(c, f.x, f.y, f.ang, f.len, FR0, FR1, f.on, k, C);
    const ca = Math.cos(f.ang), sa = Math.sin(f.ang), nx = -sa, ny = ca;
    const tx = f.x + ca * f.len, ty = f.y + sa * f.len;
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
    if (SK?.ball) return SK.ball(c, b.x, b.y, R, b.trail, k);
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
    if (SK?.text) return SK.text(c, text, x, y, size, color, alpha, k);
    c.save();
    c.globalAlpha = alpha;
    c.font = `italic 900 ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = color; c.shadowBlur = 22 * k;
    c.lineWidth = 3; c.strokeStyle = color; c.strokeText(text, x, y);
    c.shadowBlur = 8 * k; c.fillStyle = '#fff'; c.fillText(text, x, y);
    c.restore();
  }

  // dodatki poziomów: wiatr, maź, teleporty, czarne dziury, wiatraczki, ruchome cele, pałeczki, trampoliny
  function drawExtras(c: CanvasRenderingContext2D) {
    const t = time;
    for (const z of sticky) {
      c.save();
      c.fillStyle = 'rgba(255,196,60,.22)'; c.strokeStyle = 'rgba(255,214,102,.75)'; c.lineWidth = 2;
      c.beginPath(); c.roundRect(z.x, z.y, z.w, z.h, 12); c.fill(); c.stroke();
      c.fillStyle = 'rgba(255,236,170,.6)';
      for (let i = 0; i < 6; i++) { const ph = (t * 0.35 + i / 6) % 1; c.beginPath(); c.arc(z.x + 10 + ((i * 37) % (z.w - 20)), z.y + z.h - ph * z.h, 2 + (i % 3), 0, 6.28); c.fill(); }
      c.restore();
    }
    for (const f of fans) {
      const mag = Math.hypot(f.fx, f.fy) || 1, dx = f.fx / mag, dy = f.fy / mag;
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2, len = Math.abs(dx) * f.w + Math.abs(dy) * f.h;
      c.save();
      c.beginPath(); c.roundRect(f.x, f.y, f.w, f.h, 10); c.fillStyle = 'rgba(45,226,230,.09)'; c.fill();
      c.clip();
      c.strokeStyle = C.cyan; c.lineWidth = 2.5; c.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const u = (t * 0.7 + i / 5) % 1, px = cx + dx * len * (u - 0.5), py = cy + dy * len * (u - 0.5);
        c.globalAlpha = Math.sin(u * Math.PI) * 0.8;
        c.beginPath(); c.moveTo(px - dy * 14 - dx * 8, py + dx * 14 - dy * 8); c.lineTo(px, py); c.lineTo(px + dy * 14 - dx * 8, py - dx * 14 - dy * 8); c.stroke();
      }
      c.restore();
    }
    for (const pd of geo.pads) {
      c.save(); c.beginPath(); c.moveTo(pd.a.x, pd.a.y); c.lineTo(pd.b.x, pd.b.y);
      stroke(c, C.orange, 8, 14, 0.3); c.restore();
    }
    for (const p of portals) {
      [[p.a, C.purple], [p.b, C.cyan]].forEach(([e, col]: any) => {
        c.save(); c.translate(e.x, e.y);
        const g = c.createRadialGradient(0, 0, 2, 0, 0, 24 + p.flash * 12);
        g.addColorStop(0, '#fff'); g.addColorStop(0.35, col); g.addColorStop(1, 'transparent');
        c.globalAlpha = 0.55 + p.flash * 0.4; c.fillStyle = g; c.beginPath(); c.arc(0, 0, 24 + p.flash * 12, 0, 6.28); c.fill();
        c.globalAlpha = 1; c.strokeStyle = col; c.lineWidth = 2.5; c.shadowColor = col; c.shadowBlur = 12 * k;
        for (let j = 0; j < 3; j++) { c.beginPath(); c.arc(0, 0, 17 - j * 4, t * (3 + j) + j * 2, t * (3 + j) + j * 2 + 2.2); c.stroke(); }
        c.restore();
      });
    }
    for (const h of holes) {
      c.save(); c.translate(h.x, h.y);
      const g = c.createRadialGradient(0, 0, 8, 0, 0, h.pull);
      g.addColorStop(0, 'rgba(247,6,207,.28)'); g.addColorStop(1, 'transparent'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, h.pull, 0, 6.28); c.fill();
      c.strokeStyle = C.magenta; c.lineWidth = 2; c.shadowColor = C.magenta; c.shadowBlur = 12 * k;
      for (let j = 0; j < 4; j++) { c.beginPath(); c.arc(0, 0, 18 + j * 7 + h.flash * 8, -t * (2 + j * 0.5) + j, -t * (2 + j * 0.5) + j + 1.8); c.stroke(); }
      c.shadowBlur = 0; c.fillStyle = '#000'; c.beginPath(); c.arc(0, 0, 14, 0, 6.28); c.fill();
      c.lineWidth = 2; c.strokeStyle = h.flash > 0 ? '#fff' : C.magenta; c.stroke();
      c.restore();
    }
    for (const s of spinners) {
      c.save(); c.translate(s.x, s.y);
      const th = 3 + 9 * Math.abs(Math.sin(s.ang));
      c.fillStyle = C.yellow; c.shadowColor = C.yellow; c.shadowBlur = (6 + Math.abs(s.spin)) * k;
      c.beginPath(); c.roundRect(-s.w / 2, -th / 2, s.w, th, 2); c.fill();
      c.shadowBlur = 0; c.fillStyle = '#fff'; c.beginPath(); c.arc(-s.w / 2, 0, 3, 0, 6.28); c.arc(s.w / 2, 0, 3, 0, 6.28); c.fill();
      c.restore();
    }
    for (const bl of blades) {
      const ca = Math.cos(bl.ang) * bl.len / 2, sa = Math.sin(bl.ang) * bl.len / 2;
      c.save(); c.beginPath(); c.moveTo(bl.x - ca, bl.y - sa); c.lineTo(bl.x + ca, bl.y + sa);
      stroke(c, bl.flash > 0 ? '#fff' : C.orange, 9, 16, 0.3);
      c.beginPath(); c.arc(bl.x, bl.y, 8, 0, 6.28); c.fillStyle = '#2a0b3e'; c.fill(); c.lineWidth = 2; c.strokeStyle = C.orange; c.stroke();
      c.restore();
    }
    for (const m of movers) {
      c.save(); c.translate(m.x, m.y);
      if (m.skin === 'duck') {
        c.fillStyle = m.flash > 0 ? '#fff' : C.yellow; c.shadowColor = C.yellow; c.shadowBlur = 10 * k;
        c.beginPath(); c.arc(0, 0, m.r, 0, 6.28); c.fill();
        c.shadowBlur = 0; const d = m.vx >= 0 ? 1 : -1;
        c.fillStyle = C.orange; c.beginPath(); c.moveTo(d * m.r * 0.8, -2); c.lineTo(d * (m.r + 8), 2); c.lineTo(d * m.r * 0.8, 5); c.fill();
        c.fillStyle = '#000'; c.beginPath(); c.arc(d * 3, -4, 2, 0, 6.28); c.fill();
      } else if (m.skin === 'rock') {
        c.rotate(t * 1.3); c.fillStyle = m.flash > 0 ? '#fff' : '#7d6b5d'; c.shadowColor = C.orange; c.shadowBlur = 8 * k;
        c.beginPath(); for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28, r = m.r * (0.82 + ((i * 5) % 3) * 0.1); c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill();
        c.shadowBlur = 0; c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(-4, -3, 3, 0, 6.28); c.arc(4, 4, 2.4, 0, 6.28); c.fill();
      } else {
        const g = c.createRadialGradient(-3, -3, 1, 0, 0, m.r);
        g.addColorStop(0, '#fff'); g.addColorStop(0.5, m.flash > 0 ? C.yellow : C.pink); g.addColorStop(1, '#2a0b3e');
        c.fillStyle = g; c.shadowColor = C.pink; c.shadowBlur = 12 * k; c.beginPath(); c.arc(0, 0, m.r, 0, 6.28); c.fill();
      }
      c.restore();
    }
  }

  function render() {
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
    c.setTransform(k * zm, 0, 0, k * zm, (sx + W / 2 - camCX * zm) * k, (sy + VH / 2 - camCY * zm) * k);
    c.drawImage(bg, 0, 0, W, H);
    if (LV.theme === 'neon' && (!SK || SK.grid)) drawGrid(c);
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
    c.fillStyle = SK?.dark ?? '#12001c'; c.fill();
    c.lineWidth = 3; c.strokeStyle = sunLit || saucerFlash > 0 ? '#fff' : C.yellow;
    c.shadowColor = C.yellow; c.shadowBlur = (12 + (sunLit ? 10 + Math.sin(time * 8) * 8 : 0) + saucerFlash * 30) * k; c.stroke();
    c.restore();
    if (saucerFlash > 0) { c.save(); c.globalAlpha = saucerFlash * 0.6; c.beginPath(); c.arc(SAUCER.x, SAUCER.y, 16 + (1 - saucerFlash) * 60, 0, Math.PI * 2); stroke(c, C.yellow, 3, 20, 0); c.restore(); }

    allLamps().forEach(l => { if (l.on) lamp(c, l, true); });

    drawExtras(c);

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
      const col = u.alt ? C.cyan : C.pink;
      if (SK?.bumper) return SK.bumper(c, u.x, u.y, u.r, u.flash, col, k);
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
    ups.forEach(u => drawFlipper(c, u.f));
    drawFlipper(c, fl); drawFlipper(c, fr);
    balls.forEach(b => drawBall(c, b));

    // fartuch na dole (kulka znika pod nim) i tłok
    c.save();
    c.beginPath(); c.moveTo(10, H - 32); c.lineTo(160, H - 32); c.lineTo(176, H); c.lineTo(252, H); c.lineTo(268, H - 32); c.lineTo(LANE_X, H - 32); c.lineTo(LANE_X, H); c.lineTo(10, H); c.closePath();
    const ag = c.createLinearGradient(0, H - 32, 0, H); ag.addColorStop(0, SK?.apronA ?? '#2a0b3e'); ag.addColorStop(1, SK?.apronB ?? '#0c0216');
    c.fillStyle = ag; c.fill();
    line(c, [[10, H - 32], [160, H - 32]]); stroke(c, C.purple, 2, 8, 0); line(c, [[268, H - 32], [LANE_X, H - 32]]); stroke(c, C.purple, 2, 8, 0);
    c.restore();
    const L = allLamps(); const save = L[L.length - 1]; lamp(c, save, save.on);
    const py = H - 40 + charge * 28 - plungerKick * 60;
    c.save();
    c.fillStyle = '#c9c9e8'; c.fillRect(424, py, 20, 6);
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1.5; c.beginPath();
    for (let y = py + 8; y < H - 2; y += (H - 2 - py) / 8) { c.moveTo(424, y); c.lineTo(444, y + 3); }
    c.stroke();
    if (charging) { c.fillStyle = C.yellow; c.shadowColor = C.yellow; c.shadowBlur = 12 * k; c.fillRect(422, H - charge * 120, 3, charge * 120); }
    c.restore();

    // iskry i liczby
    c.save(); c.globalCompositeOperation = SK?.sparkComp ?? 'lighter';
    for (const p of sparks) {
      const a = 1 - p.life / p.max;
      c.globalAlpha = a; c.fillStyle = p.color;
      c.beginPath(); c.arc(p.x, p.y, p.size * (0.5 + a), 0, Math.PI * 2); c.fill();
    }
    c.restore();
    for (const p of pops) neonText(c, p.text, p.x, p.y, 16, p.color, Math.min(1, p.life * 2));

    c.setTransform(k, 0, 0, k, sx * k, sy * k);   // napisy na ekranie: stały rozmiar mimo przybliżenia
    if (msg) {
      const m = msg, a = Math.min(1, m.t * 6, (m.dur - m.t) * 3);
      const z = 1 + Math.max(0, 0.25 - m.t) * 1.5;
      c.save(); c.translate(AXIS, 215); c.scale(z, z);
      c.globalAlpha = a; c.fillStyle = SK?.msgBg ?? 'rgba(8,0,20,.55)'; c.beginPath(); c.roundRect(-150, -36, 300, m.sub ? 82 : 64, 12); c.fill();
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
  /** Efekty, które nie wpływają na wynik: iskry, liczby, napisy, drżenie i kamera (rdzeń liczy tylko stałymi krokami) */
  function visuals(dt: number) {
    shake = Math.max(0, shake - dt * 40);
    for (const p of sparks) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy = p.vy * 0.96 + 300 * dt; }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life > sparks[i].max) sparks.splice(i, 1);
    for (const p of pops) { p.life -= dt; p.y -= 40 * dt; }
    for (let i = pops.length - 1; i >= 0; i--) if (pops[i].life <= 0) pops.splice(i, 1);
    if (msg) { msg.t += dt; if (msg.t > msg.dur) msg = null; }

    zm += (zmTo - zm) * Math.min(1, dt * 7);
    const live = balls.filter(b => !b.gone && b.held <= 0);
    let want = H - VH;
    if (phase === 'play' && live.length) want = live.reduce((t, b) => t + b.y + b.vy * 0.22, 0) / live.length - VH * 0.58;
    if (H > VH) { want = Math.max(0, Math.min(H - VH, want)); camY += (want - camY) * Math.min(1, dt * 5); } else camY = 0;
    // środek widoku: bez przybliżenia stały, z przybliżeniem podąża za kulką; widok nie wychodzi poza stół
    const hw = W / 2 / zm, hh = VH / 2 / zm;
    let tx = W / 2, ty = camY + VH / 2;
    if (zmTo > 1.001 || zm > 1.001) {
      const mix = Math.max(0, Math.min(1, (zm - 1) / 0.25));
      if (phase === 'play' && live.length) {
        const fx0 = live.reduce((t, b) => t + b.x + b.vx * 0.12, 0) / live.length, fy0 = live.reduce((t, b) => t + b.y + b.vy * 0.18, 0) / live.length;
        tx += (fx0 - tx) * mix; ty += (fy0 - ty) * mix;
      } else ty += ((H - hh) - ty) * mix;
    }
    tx = Math.max(hw, Math.min(W - hw, tx)); ty = Math.max(hh, Math.min(H - hh, ty));
    camCX += (tx - camCX) * Math.min(1, dt * 6); camCY += (ty - camCY) * Math.min(1, dt * 6);
  }

  let raf = 0, last = 0, acc = 0;
  function frame(now: number) {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    time += dt;
    // rdzeń idzie stałymi krokami TICK (ta sama liczba kroków, które odtworzy serwer)
    if (sim.phase !== 'attract') {
      acc += dt;
      let n = 0;
      while (acc >= TICK && n < 40) { sim.step(); acc -= TICK; n++; }
      if (n >= 40) acc = 0;
    } else acc = 0;
    visuals(dt);
    sync();
    hud();
    render();
    raf = requestAnimationFrame(frame);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const cssW = canvas.clientWidth || rect.width || W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    k = (cssW / W) * dpr;
    canvas.width = Math.round(W * k); canvas.height = Math.round(VH * k);
    // tło i stół rysujemy w wyższej rozdzielczości, żeby po przybliżeniu nie były rozmyte (z limitem rozmiaru płótna)
    const kv = k;
    k = Math.max(kv, Math.min(kv * 1.6, 8000 / H));
    drawBg(); drawFg();
    k = kv;
  }

  // ---------- sterowanie ----------
  const typing = (e: Event) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
  const LEFT = ['ArrowLeft', 'KeyZ', 'ShiftLeft', 'KeyA'], RIGHT = ['ArrowRight', 'Slash', 'ShiftRight', 'KeyL', 'KeyD'], PLUNGE = ['Space', 'ArrowDown', 'Enter', 'KeyS'];
  function setFlip(side: 'l' | 'r', on: boolean) {
    if (held[side] === on) return;
    held[side] = on;
    inp(`${side}${on ? '+' : '-'}` as Input);
  }
  function plunger(down: boolean) {
    if (down) { if (sim.phase !== 'play') { void start(); return; } inp('p+'); } else inp('p-');
  }
  function onKey(e: KeyboardEvent, down: boolean) {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (LEFT.includes(code)) setFlip('l', down);
    else if (RIGHT.includes(code)) setFlip('r', down);
    else if (PLUNGE.includes(code)) { if (down && !e.repeat) plunger(true); else if (!down) plunger(false); }
    else if (code === 'KeyN' && down && !e.repeat) inp('n');
    else return;
    e.preventDefault();
  }
  const kd = (e: KeyboardEvent) => onKey(e, true), ku = (e: KeyboardEvent) => onKey(e, false);
  const pointers = new Map<number, 'l' | 'r' | 'p'>();
  function pdown(e: PointerEvent) {
    e.preventDefault();
    Sound.unlock();
    if (sim.phase !== 'play') { void start(); return; }
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    let side: 'l' | 'r' | 'p' = x < 0.5 ? 'l' : 'r';
    if (x > 0.82 && y > 0.55 && sim.balls.some(b => sim.inLane(b) && !b.auto)) side = 'p';
    pointers.set(e.pointerId, side);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* stary Safari */ }
    if (side === 'p') inp('p+'); else setFlip(side, true);
  }
  function pup(e: PointerEvent) {
    const side = pointers.get(e.pointerId);
    if (!side) return;
    pointers.delete(e.pointerId);
    if (side === 'p') inp('p-');
    else if (![...pointers.values()].includes(side)) setFlip(side, false);
  }
  const blur = () => { setFlip('l', false); setFlip('r', false); inp('p-'); };

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
    start: () => { void start(); },
    resize,
    zoom(delta: number) {
      const to = Math.max(1, Math.min(ZMAX, zmTo * (1 + delta)));
      const moved = Math.abs(to - zmTo) > 1e-6;
      zmTo = to;
      return moved;
    },
    resetZoom() { zmTo = 1; },
    getRun: () => run,
    state: () => ({ balls: sim.balls.map(b => ({ x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy) })), score: sim.score, phase: sim.phase, ball: sim.ballNo, tick: sim.tick }),
    destroy() {
      destroyed = true;
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
