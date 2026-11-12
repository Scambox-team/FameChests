// @ts-nocheck
// Super Turbo Run 3D: deterministyczny rdzeń gry (generator tunelu, fizyka biegacza, przeszkody, moce, punkty) bez rysowania.
// Scena (three/runScene.ts) tworzy go przez createRunCore(fx) i tylko rysuje jego stan; efekty (dźwięk, iskry, napisy) idą przez `fx`.
// Grę liczy się w STAŁYM kroku TICK = 1/120 s, tunel losuje generator z ziarnem od serwera (`rng`, tylko generator!), a cos w
// fizyce to własne `fcos` - dzięki temu serwer (server/src/run_sim.rs, ten sam rdzeń w Rust) odtwarza bieg z ziarna i zapisu
// klawiszy (`log`) i sam liczy dystans. Efekty losowe biorą Math.random (`vrand`), nigdy `rng`. Zmieniając generator albo fizykę,
// zmień run_sim.rs w tej samej kolejności działań i losowań i odtwórz nagrania: node web/scripts/snake-fixture.mjs
// (test `cargo test run_sim`). Punkty, combo i kryształy liczy tylko przeglądarka (serwer płaci za dystans).

export const TAU = Math.PI * 2;
export const N = 12;                       // liczba ścian tunelu
export const APO = 5.2;                    // odległość środka ściany od osi tunelu
export const DTH = TAU / N;
export const TW = 2.7866716012836763;      // szerokość kafla = 2 * APO * tan(PI / N), stała liczba (tan z różnych silników bywa inny w ostatnim bicie)
export const TL = 3.2, TT = 0.3;           // długość i grubość kafla
export const ROWS_AHEAD = 60, ROWS_BEHIND = 4, RB = 128;
export const GRAV = 16, JUMP_V = 9.4, PAD_V = 10.7;   // niska grawitacja: skoki wysokie i długie
export const JUMP_T = 2 * JUMP_V / GRAV, PAD_T = 2 * PAD_V / GRAV;
export const ZONE_LEN = 700, TURBO_DIST = 95, V0 = 17;
export const TICK = 1 / 120;
export const MULT_AT = [0, 5, 12, 21, 32, 45, 60, 78, 98], COMBO_T = 3.2;
/** kody zdarzeń w zapisie: lewo w dół / w górę, prawo w dół / w górę, skok wciśnięty / puszczony */
export const INPUTS = { left: [0, 1], right: [2, 3], jump: [4, 5] };

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const mod = (a, n) => ((a % n) + n) % n;
export const wrapPi = a => mod(a + Math.PI, TAU) - Math.PI;
export const jround = x => Math.floor(x + 0.5);
export const vrand = (a, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
// spokojny start, wyraźny skok prędkości z każdą kolejną strefą
export const speedAt = d => { const z = d / ZONE_LEN, zi = Math.floor(z); return Math.min(46, V0 + zi * 2.6 + (z - zi) * 1.0); };
export const latSpeed = v => 10.5 + (v - 24) * 0.2;
export const rowsPerLane = v => Math.ceil(TW * v / (TL * latSpeed(v) * 0.7));
export function fsin(x) {
  const r = x - TAU * Math.floor(x / TAU + 0.5), r2 = r * r;
  let t = r, s = r;
  for (let i = 1; i <= 10; i++) { t = -t * r2 / ((2 * i) * (2 * i + 1)); s += t; }
  return s;
}
export function fcos(x) {
  const r = x - TAU * Math.floor(x / TAU + 0.5), r2 = r * r;
  let t = 1, s = 1;
  for (let i = 1; i <= 10; i++) { t = -t * r2 / ((2 * i - 1) * (2 * i)); s += t; }
  return s;
}
/** mulberry32: 32-bitowy generator z ziarnem; liczy tak samo w JS i w Rust */
export class Rng {
  constructor(seed) { this.a = seed | 0; }
  next() {
    this.a = (this.a + 0x6D2B79F5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
export const LC = new Float32Array(N), LS = new Float32Array(N);
for (let l = 0; l < N; l++) { LC[l] = Math.cos(l * DTH); LS[l] = Math.sin(l * DTH); }

const NOFX = new Proxy({}, { get: () => () => {} });

/** Rdzeń jednej sceny. `fx`: efekty (snd(nazwa, ...), burst, popup, banner, flash, started, died, zone, over) - wszystkie opcjonalne. */
export function createRunCore(fx = NOFX) {
  const F = new Proxy(fx, { get: (o, k) => o[k] || (() => {}) });
  let rng = new Rng(1);
  const rand = (a, b) => b === undefined ? rng.next() * a : a + rng.next() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = a => a[Math.floor(rng.next() * a.length)];

  const G = { state: 'menu', dist: 0, jp: 0, speed: 14, score: 0, gems: 0, combo: 0, comboT: 0, mult: 1, maxCombo: 0, zone: 0,
    turbo: 0, shield: false, magnet: 0, x2: 0, inv: 0, shake: 0, flash: 0, beat: 0, camTh: 0, camH: 0, energy: 0, time: 0,
    deadT: 0, fallT: 0, cause: '', best: 0, popAcc: 0, popT: 0, scorePunch: 0, multPunch: 0, overT: 0, finalScore: 0, fakeBeat: 0,
    deathDist: 0 };
  const P = { th: 0, vth: 0, h: 0, vy: 0, grounded: true, fallen: false, coyote: 0, jumpBuf: 0, pad: false, air: 0, airHoles: 0, squash: 0, phase: 0 };
  const input = { left: false, right: false, jump: false };
  /** numer kroku gry i zapis zdarzeń (krok, kod) dla serwera */
  const run = { tick: 0, log: [], acc: 0 };

  /* ---------------- generator tunelu ---------------- */
  const rows = [];
  for (let i = 0; i < RB; i++) rows.push({ j: -1, tile: new Uint8Array(N), obs: new Uint8Array(N), item: new Uint8Array(N),
    itemH: new Float32Array(N), glow: new Float32Array(N), nobs: 0, nitem: 0, special: 0 });
  const getRow = j => { if (j < 0) return null; const r = rows[j % RB]; return r.j === j ? r : null; };
  const gen = { j: 0, menu: true, left: 0, seg: null, path: 0, prev: '', sinceItem: 0, sinceBoost: 0, rest: 0, holeLeft: new Int8Array(N) };

  function resetGen(menu) {
    gen.j = 0; gen.menu = menu; gen.left = 0; gen.seg = null; gen.path = 0; gen.prev = ''; gen.sinceItem = 70; gen.sinceBoost = 0; gen.rest = 0;
    gen.holeLeft.fill(0); gen.hintL = null; gen.gp = { mode: 'none', left: 4, i: 0, dir: 1, step: 3, n: 0 };
    for (const r of rows) r.j = -1;
  }
  function setObs(r, l, v) { l = mod(l, N); if (r.tile[l] === 1) { if (!r.obs[l]) r.nobs++; r.obs[l] = v; } }
  function setGem(r, l, h) { l = mod(l, N); if (!r.item[l]) r.nitem++; r.item[l] = 1; r.itemH[l] = h || 0.9; }
  const gemOK = (r, l) => { l = mod(l, N); return r.tile[l] === 1 && !r.obs[l]; };
  const groundGem = (r, l) => gemOK(r, l) ? (setGem(r, l), true) : false;
  const hint = l => { gen.hintL = l; };                    // "bezpieczny" pas w tym rzędzie - baza dla wzorów kryształów
  const holeMin = v => Math.max(2, Math.ceil((v * 0.18 + 0.7) / TL));   // najkrótsza dziura, której nie da się przebiec
  function band(r, lo, hi) {
    if (hi - lo + 1 >= N) return;
    for (let l = 0; l < N; l++) {
      if (mod(l - lo, N) <= hi - lo) continue;
      r.tile[l] = 0; if (r.obs[l]) { r.obs[l] = 0; r.nobs--; } if (r.item[l]) { r.item[l] = 0; r.nitem--; }
    }
  }
  // losowe "plamy" dziur (2+ rzędów, czasem szerokie na 2 pasy); pasy z listy prot zostają całe
  function scatter(r, p, v, prot, obsP, allowStart) {
    const hm = holeMin(v);
    for (let l = 0; l < N; l++) {
      if (prot.indexOf(l) >= 0) { gen.holeLeft[l] = 0; continue; }
      if (gen.holeLeft[l] > 0) { r.tile[l] = 0; gen.holeLeft[l]--; continue; }
      if (allowStart && rng.next() < p) {
        const len = randi(hm, hm + 2); gen.holeLeft[l] = len - 1; r.tile[l] = 0;
        if (l < N - 1 && gen.holeLeft[l + 1] <= 0 && rng.next() < 0.38) gen.holeLeft[l + 1] = len;
      } else if (obsP && rng.next() < obsP) setObs(r, l, rng.next() < 0.5 ? 1 : 2);
    }
  }
  function holesBody(r, s, i, len, p, d, v, minP, maxP) {
    if (i > 0 && i % 5 === 0) { s.from = gen.path; let np = gen.path + pick([-1, 0, 1]); if (minP !== undefined) np = clamp(np, minP, maxP); gen.path = np; }
    scatter(r, p, v, [mod(gen.path, N), mod(s.from, N)], 0.03 + 0.05 * d, i < len - 1);
    hint(gen.path);
  }
  const SEG = {
    open(v, d) {
      const len = randi(9, 15), p = gen.j < 30 ? 0.025 : 0.05 + 0.05 * d;
      return { len, fn(r, s, i) {
        scatter(r, p, v, [mod(gen.path, N)], 0, i < len - 1);
        hint(gen.path);
        if (i % 3 === 1) { const n = 1 + Math.floor(rand(0, 1.5 + d * 4)); for (let k = 0; k < n; k++) { const l = gen.path + randi(2, N - 2); setObs(r, l, rng.next() < 0.6 ? 1 : 2); } }
      } };
    },
    holes(v, d) {
      const len = randi(14, 22), p = 0.12 + 0.1 * d;
      return { len, from: gen.path, fn(r, s, i) { holesBody(r, s, i, len, p, d, v); } };
    },
    gaps(v, d) {
      const gmax = clamp(Math.floor(0.45 * v * JUMP_T / TL), 2, 7), gmin = Math.min(holeMin(v), gmax), lo = Math.ceil(v * JUMP_T / TL), hm = holeMin(v);
      const plan = [], n = randi(2, 3);
      for (let k = 0; k < n; k++) { const so = randi(lo, lo + 2), g = randi(gmin, gmax), arc = rng.next() < 0.6; for (let q = 0; q < so; q++) plan.push(0); for (let q = 0; q < g; q++) plan.push([q, g, arc]); }
      plan.push(0, 0);
      const far = k => { if (k + hm + 5 >= plan.length) return false; for (let q = 0; q <= hm + 5; q++) if (plan[k + q]) return false; return true; };
      return { len: plan.length, fn(r, s, i) {
        const p = plan[i];
        if (p) { r.tile.fill(0); if (p[2]) setGem(r, gen.path, 0.9 + 2.0 * Math.sin(Math.PI * (p[0] + 0.5) / p[1])); }
        else { scatter(r, 0.04, v, [mod(gen.path, N)], 0, far(i)); hint(gen.path); if (rng.next() < 0.3 * d) setObs(r, gen.path + randi(2, N - 2), 2); }
      } };
    },
    mega(v, d) {
      const flight = v * PAD_T / TL, gap = clamp(Math.floor(0.55 * flight), 4, 10), post = Math.max(6, Math.ceil(flight - gap)), apex = PAD_V * PAD_V / (2 * GRAV);
      return { len: 7 + gap + post, rest: 4, fn(r, s, i) {
        if (i === 5 || i === 6) r.tile.fill(4); else if (i >= 7 && i < 7 + gap) r.tile.fill(0);
        if (i < 5) { hint(gen.path); return; }
        const t = (i + 0.5 - 5.3) / flight;
        if (t > 0.04 && t < 0.96) { if (i % 2 === 0) setGem(r, gen.path, 0.75 + 4 * apex * t * (1 - t)); }
        else if (i >= 7 + gap) hint(gen.path);
      } };
    },
    spiral(v, d) {
      const w = d < 0.3 ? 3 : pick([2, 3, 3]), dir = pick([-1, 1]), rpl = rowsPerLane(v), k = w === 3 ? Math.max(2, rpl - 1) : rpl;
      const lead = 5 * rpl + 2, turns = randi(7, 13), base = gen.path;
      return { len: lead + turns * k, fn(r, s, i) {
        const sh = i < lead ? 0 : Math.floor((i - lead) / k) + 1, c = base + dir * sh;
        let lo, hi; if (w === 3) { lo = c - 1; hi = c + 1; } else if (dir > 0) { lo = c; hi = c + 1; } else { lo = c - 1; hi = c; }
        if (i < lead) { const e = Math.ceil((N - w) / 2 * (1 - (i + 1) / lead)); lo -= e; hi += e; }
        gen.path = c; hint(c); band(r, lo, hi);
      } };
    },
    half(v, d) {
      const hw = d < 0.5 ? 3 : 2, w = 2 * hw + 1, rpl = rowsPerLane(v), lead = Math.ceil((N - w) / 2) * rpl + 2, base = gen.path, body = randi(12, 20);
      return { len: lead + body, from: base, fn(r, s, i) {
        if (i >= lead) holesBody(r, s, i - lead, body, 0.1 + 0.1 * d, d, v, base - (hw - 1), base + (hw - 1)); else hint(gen.path);
        const e = i < lead ? Math.ceil((N - w) / 2 * (1 - (i + 1) / lead)) : 0;
        band(r, base - hw - e, base + hw + e);
      } };
    },
    stripes(v, d) {
      // odstęp barierek > długość pełnego skoku, żeby nie lądować prosto w następnej
      const jr = Math.ceil(v * JUMP_T / TL), base = gen.path, len = randi(2, 3) * (jr + 4) + 4; let nextBar = randi(4, 6);
      return { len, fn(r, s, i) {
        if (i >= 2 && i < len - 1) for (let l = 0; l < N; l++) if (mod(l - base, 2) === 1) r.tile[l] = 0;
        if (i === nextBar && i < len - 2) { setObs(r, base, 1); if (rng.next() < 0.5) setGem(r, base, 2.2); nextBar += jr + randi(2, 4); }
        else hint(base);
        if (i >= 3 && rng.next() < 0.18 + 0.25 * d) { const l = base + 2 * randi(1, 5); setObs(r, l, pick([1, 2])); }
      } };
    },
    gates(v, d) {
      const rpl = rowsPerLane(v), q = Math.max(6, 2 * rpl + 2, Math.ceil(v * JUMP_T / TL) + 3), n = randi(3, 4); let c = gen.path, pc = c;
      return { len: n * q + 2, fn(r, s, i) {
        const k = i % q;
        if (k === 0 && i > 0 && i < n * q) { pc = c; c += randi(-2, 2); }
        gen.path = c;
        const prot = []; for (let o = -1; o <= 1; o++) prot.push(mod(c + o, N), mod(pc + o, N));
        scatter(r, 0.035, v, prot, 0, i < n * q);
        if (i < n * q && k === q - 1) {
          for (let l = 0; l < N; l++) { let off = mod(l - c, N); if (off > N / 2) off -= N; const ao = Math.abs(off); if (ao <= 1) continue;
            setObs(r, l, (ao % 2 === 1 && rng.next() < 0.25 + d) ? 2 : 1); }
        }
        if (k >= 1 || i === 0) hint(c);
      } };
    },
    boost(v, d) {
      return { len: 30, rest: 5, fn(r, s, i) {
        if (i === 2 || i === 3) { r.tile.fill(3); if (i === 2) r.special = 3; return; }
        if (i >= 6 && i < 23 && i % 2 === 0) {
          const n = randi(3, 5); for (let k = 0; k < n; k++) { const l = randi(0, N - 1); setObs(r, l, pick([1, 2])); }
          if (i % 4 === 0) { const l = gen.path + pick([-1, 0, 1]); setObs(r, l, pick([1, 2])); }
        }
        if (i > 4 && i < 26) { if (rng.next() < 0.5) setGem(r, gen.path + randi(-2, 2)); } else hint(gen.path);
      } };
    },
  };
  function nextSegment(j) {
    const dist = j * TL, v = speedAt(dist), d = Math.min(1, dist / 8000);
    let pool;
    if (dist < 120) pool = ['open', 'gaps', 'holes'];
    else if (dist < 450) pool = ['open', 'gaps', 'holes', 'holes', 'holes', 'gates', 'boost'];
    else if (dist < 950) pool = ['open', 'gaps', 'holes', 'holes', 'holes', 'gates', 'spiral', 'stripes', 'mega', 'boost'];
    else pool = ['open', 'gaps', 'holes', 'holes', 'holes', 'gates', 'spiral', 'spiral', 'half', 'half', 'stripes', 'mega', 'boost'];
    gen.sinceBoost++;
    let name, guard = 0;
    do { name = pick(pool); } while ((name === gen.prev || (name === 'boost' && gen.sinceBoost < 6)) && guard++ < 20);
    if (j < 14) name = 'open';
    if (name === 'boost') gen.sinceBoost = 0;
    gen.holeLeft.fill(0);
    gen.prev = name; gen.seg = SEG[name](v, d); gen.left = gen.seg.len;
  }
  // kryształy: krótkie grupki w różnych układach zamiast jednej ciągłej linii
  function placeGems(r, j) {
    if (gen.hintL === null) return;
    const gp = gen.gp, base = gen.hintL;
    if (gp.left <= 0) {
      if (gp.mode !== 'none') { gp.mode = 'none'; gp.left = randi(5, 11); }
      else {
        const v = speedAt(j * TL);
        gp.step = Math.max(2, rowsPerLane(v)); gp.dir = pick([-1, 1]);
        gp.mode = pick(['line', 'line', 'side', 'side', 'zig', 'arc', 'fan', 'diag']);
        gp.n = clamp(jround(v * JUMP_T / TL * 0.75), 4, 12);
        // jak w oryginale: wszystkie trzy losowania długości są wykonywane, bierze się jedną
        const L = { line: randi(3, 5), side: randi(3, 4), diag: randi(3, 4) * gp.step };
        gp.left = { line: L.line, side: L.side, zig: 4 * gp.step, arc: gp.n, fan: 1, diag: L.diag }[gp.mode];
      }
      gp.i = 0;
    }
    const i = gp.i++; gp.left--;
    switch (gp.mode) {
      case 'line': groundGem(r, base); break;
      case 'side': groundGem(r, base + gp.dir) || groundGem(r, base); break;
      case 'zig': if (i % gp.step === 0) groundGem(r, base + [0, 1, 0, -1][(i / gp.step) % 4] * gp.dir) || groundGem(r, base); break;
      case 'arc': if ((gp.n <= 7 || i % 2 === 0) && gemOK(r, base)) setGem(r, base, 0.9 + 2.0 * Math.sin(Math.PI * (i + 0.5) / gp.n)); break;
      case 'fan': groundGem(r, base - 1); groundGem(r, base); groundGem(r, base + 1); break;
      case 'diag': if (i % gp.step === 0) groundGem(r, base + gp.dir * (i / gp.step)) || groundGem(r, base); break;
    }
  }
  function tryPower(r) {
    gen.sinceItem++;
    if (gen.sinceItem < 115 || gen.hintL === null) return;
    const l = mod(gen.hintL, N);
    if (r.tile[l] === 1 && !r.obs[l]) { if (!r.item[l]) r.nitem++; r.item[l] = 10 + randi(0, 2); r.itemH[l] = 1.15; gen.sinceItem = 0; }
  }
  function genRow() {
    const j = gen.j++, r = rows[j % RB];
    r.j = j; r.tile.fill(1); r.obs.fill(0); r.item.fill(0); r.glow.fill(0); r.nobs = 0; r.nitem = 0; r.special = 0;
    gen.hintL = null;
    if (gen.menu) return;
    if (j < 12) { if (j >= 5) hint(gen.path); }
    else if (gen.rest > 0) { gen.rest--; hint(gen.path); }
    else {
      if (!gen.seg || gen.left <= 0) nextSegment(j);
      const s = gen.seg; s.fn(r, s, s.len - gen.left, j); gen.left--;
      if (gen.left <= 0) gen.rest = s.rest || 3;
    }
    placeGems(r, j); tryPower(r);
  }
  function ensureRows() { while (gen.j < G.jp + ROWS_AHEAD + 2) genRow(); }

  /* ---------------- logika gry ---------------- */
  const floorR = th => APO / fcos(th - jround(th / DTH) * DTH);
  function tileAt(th, z) { const r = getRow(Math.floor(z / TL)); if (!r) return 1; return r.tile[mod(jround(th / DTH), N)]; }
  function support() {
    const c = tileAt(P.th, G.dist); if (c) return c;
    const a = 0.3 / APO;
    return tileAt(P.th - a, G.dist) || tileAt(P.th + a, G.dist) || tileAt(P.th, G.dist + 0.35) || tileAt(P.th, G.dist - 0.35);
  }
  const pp = { x: 0, y: 0, ux: 0, uy: 0 };
  function playerXY(up) { const rho = floorR(P.th) - P.h - (up || 0), s = Math.sin(P.th), c = Math.cos(P.th); pp.x = rho * s; pp.y = -rho * c; pp.ux = -s; pp.uy = c; return pp; }
  const itemX = (l, h) => (APO - h) * LS[l], itemY = (l, h) => -(APO - h) * LC[l];
  const flyers = [];

  /** Start biegu z ziarnem tunelu (od serwera albo losowym) */
  function start(seed) {
    rng = new Rng(seed);
    resetGen(false);
    Object.assign(G, { state: 'playing', dist: 0, jp: 0, speed: 9, score: 0, gems: 0, combo: 0, comboT: 0, mult: 1, maxCombo: 0, zone: 0, turbo: 0, shield: false,
      magnet: 0, x2: 0, inv: 0, shake: 0, deadT: 0, fallT: 0, camTh: 0, camH: 0, popAcc: 0, popT: 0, energy: 0, deathDist: 0 });
    Object.assign(P, { th: 0, vth: 0, h: 0, vy: 0, grounded: true, fallen: false, coyote: 0, jumpBuf: 0, pad: false, air: 0, airHoles: 0, squash: 0 });
    flyers.length = 0;
    run.tick = 0; run.log = []; run.acc = 0;
    // klawisze trzymane już przy starcie też idą do zapisu
    input.jump = false;
    if (input.left) run.log.push(0, INPUTS.left[0]);
    if (input.right) run.log.push(0, INPUTS.right[0]);
    ensureRows();
    F.started();
  }
  const live = () => G.state === 'playing' || G.state === 'paused';
  /** Klawisz w dół / w górę (lewo, prawo, skok); skok w dół = podskok z buforem 0,14 s */
  function setKey(key, down) {
    if (key === 'jump' && down) {
      if (G.state !== 'playing') return;
      input.jump = true; P.jumpBuf = 0.14; run.log.push(run.tick, INPUTS.jump[0]);
      return;
    }
    if (input[key] === down) return;
    input[key] = down;
    if (live()) run.log.push(run.tick, INPUTS[key][down ? 0 : 1]);
  }
  function addScore(p) { G.score += p; }
  function comboUp() {
    G.combo++; G.comboT = COMBO_T; if (G.combo > G.maxCombo) G.maxCombo = G.combo;
    let m = 1; while (m < 9 && G.combo >= MULT_AT[m]) m++;
    if (m > G.mult) { G.mult = m; G.multPunch = 1; F.combo(m); G.shake = Math.max(G.shake, 0.2); }
  }
  function collectGem(x, y, z) {
    G.gems++; comboUp();
    const pts = 15 * G.mult * (G.x2 > 0 ? 2 : 1); addScore(pts); G.popAcc += pts; G.scorePunch = Math.min(1, G.scorePunch + 0.45);
    F.gem(x, y, z);
  }
  function collectPower(it) {
    if (it === 10) G.shield = true; else if (it === 11) G.magnet = 9; else G.x2 = 10;
    F.power(it, playerXY(0.8));
    addScore(100 * G.mult); comboUp();
  }
  function startTurbo() {
    G.turbo = TURBO_DIST; G.shake = Math.max(G.shake, 0.6);
    F.turbo(playerXY(0.8));
  }
  function smash(r, l, j, bonus) {
    const hh = r.obs[l] === 1 ? 0.6 : 1.8; r.obs[l] = 0; r.nobs--;
    G.shake = Math.max(G.shake, 0.45);
    F.smash(itemX(l, hh), itemY(l, hh), -((j + 0.5) * TL - G.dist));
    if (bonus) { const pts = 100 * G.mult * (G.x2 > 0 ? 2 : 1); addScore(pts); comboUp(); F.popup('ROZBITE! +' + pts, 'cy'); }
  }
  function die(cause) {
    if (G.state !== 'playing') return;
    G.state = 'dying'; G.deadT = 0; G.cause = cause; G.deathDist = G.dist;
    if (cause === 'crash') G.shake = 1.4;
    F.died(cause, playerXY(0.8));
  }
  function newZone(z) {
    G.zone = z;
    const pts = 250 * z; addScore(pts); G.shake = Math.max(G.shake, 0.4);
    F.zone(z, pts);
  }
  function nearMiss(pr) {
    if (G.turbo > 0) return;
    for (let l = 0; l < N; l++) {
      if (!pr.obs[l]) continue;
      const dl = Math.abs(wrapPi(l * DTH - P.th)) * APO;
      if (dl < TW * 1.02) {
        const pts = 50 * G.mult * (G.x2 > 0 ? 2 : 1); addScore(pts); G.comboT = COMBO_T; G.scorePunch = 1;
        F.popup('O WŁOS! +' + pts, 'cy', 50 + vrand(-6, 6), 52); F.snd('near');
        return;
      }
    }
  }
  function enterRow(j) {
    const r = getRow(j);
    if (r && r.special === 3 && G.turbo < TURBO_DIST - 15) startTurbo();
    if (!P.grounded && !tileAt(P.th, (j + 0.5) * TL)) P.airHoles++;
    const pr = getRow(j - 1); if (pr && pr.nobs > 0 && !P.fallen) nearMiss(pr);
    const z = Math.floor(G.dist / ZONE_LEN); if (z > G.zone) newZone(z);
  }
  function launch(v, pad) {
    P.vy = v; P.grounded = false; P.pad = pad; P.coyote = 0; P.jumpBuf = 0; P.air = 0; P.airHoles = 0; if (P.h < 0) P.h = 0;
    if (pad) G.shake = Math.max(G.shake, 0.35);
    F.launch(pad, playerXY(0.1));
    P.squash = -0.7;
  }
  function land(sup) {
    P.h = 0; P.vy = 0; P.grounded = true; P.pad = false; P.squash = 1;
    F.land(playerXY(0.05));
    if (P.airHoles >= 2) { const pts = P.airHoles * 15 * G.mult; addScore(pts); F.popup('CZYSTY SKOK +' + pts, '', 50 + vrand(-6, 6), 56); }
    P.airHoles = 0;
    if (sup === 4) launch(PAD_V, true);
  }
  function hitObstacles() {
    for (let j = G.jp - 1; j <= G.jp + 1; j++) {
      const r = getRow(j); if (!r || !r.nobs) continue;
      if (Math.abs(G.dist - (j + 0.5) * TL) > 0.85) continue;
      for (let l = 0; l < N; l++) {
        const o = r.obs[l]; if (!o) continue;
        if (Math.abs(wrapPi(l * DTH - P.th)) * APO > TW * 0.46 + 0.28) continue;
        if (P.h > (o === 1 ? 1.15 : 4.4) - 0.25) continue;
        if (G.turbo > 0) smash(r, l, j, true);
        else if (G.inv > 0) smash(r, l, j, false);
        else if (G.shield) { G.shield = false; G.inv = 1.3; smash(r, l, j, false); F.shieldBreak(); }
        else { die('crash'); return; }
      }
    }
  }
  function collectItems() {
    const jr = G.magnet > 0 ? 7 : 1;
    for (let j = G.jp - 1; j <= G.jp + jr; j++) {
      const r = getRow(j); if (!r || !r.nitem) continue;
      const zc = (j + 0.5) * TL, dz = zc - G.dist;
      for (let l = 0; l < N; l++) {
        const it = r.item[l]; if (!it) continue;
        const dl = Math.abs(wrapPi(l * DTH - P.th)) * APO, dh = Math.abs(r.itemH[l] - (P.h + 0.75));
        if (Math.abs(dz) < 1.35 && dl < 1.35 && dh < 1.45) {
          r.item[l] = 0; r.nitem--;
          if (it === 1) collectGem(itemX(l, r.itemH[l]), itemY(l, r.itemH[l]), -dz); else collectPower(it);
        } else if (G.magnet > 0 && it === 1 && dz > -1 && dl < TW * 3.3) {
          r.item[l] = 0; r.nitem--; flyers.push({ x: itemX(l, r.itemH[l]), y: itemY(l, r.itemH[l]), s: zc, t: 0 });
        }
      }
    }
  }
  function stepPlay(dt) {
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    P.vth += (dir * latSpeed(G.speed) / APO - P.vth) * Math.min(1, dt * (P.grounded ? 16 : 11));
    P.th += P.vth * dt;
    G.dist += G.speed * dt;
    P.jumpBuf -= dt; P.coyote -= dt;
    if (P.jumpBuf > 0 && !P.fallen && (P.grounded || P.coyote > 0)) launch(JUMP_V, false);
    if (!P.grounded) {
      let g = GRAV; if (P.vy > 0 && !input.jump && !P.pad) g *= 2;
      P.vy -= g * dt; P.h += P.vy * dt; P.air += dt;
    }
    const sup = P.fallen ? 0 : support();
    if (P.grounded) {
      if (!sup) { P.grounded = false; P.coyote = 0.1; P.vy = 0; P.pad = false; P.air = 0; P.airHoles = 0; }
      else if (sup === 4) launch(PAD_V, true);
    } else if (!P.fallen && P.vy <= 0 && P.h <= 0) {
      if (sup && P.h > -0.25) land(sup);
      else if (P.h < -0.25) { P.fallen = true; G.fallT = 0; F.snd('fall'); }
    }
    if (P.fallen) { G.fallT += dt; if (G.fallT > 0.7) { die('void'); return; } }
    const nj = Math.floor(G.dist / TL);
    while (G.jp < nj) { G.jp++; enterRow(G.jp); }
    if (!P.fallen) { hitObstacles(); if (G.state === 'playing') collectItems(); }
  }
  /** Jeden krok gry (TICK) - to samo odtwarza serwer */
  function tick() {
    const dt = TICK;
    const target = speedAt(G.dist) * (G.turbo > 0 ? 1.35 : 1);
    G.speed += (target - G.speed) * Math.min(1, dt * (G.turbo > 0 ? 5 : 1.6));
    const n = Math.max(1, Math.ceil(G.speed * dt / 0.55));
    for (let k = 0; k < n && G.state === 'playing'; k++) stepPlay(dt / n);
    ensureRows();
    run.tick++;
    if (G.state !== 'playing') return;
    if (G.turbo > 0) G.turbo -= G.speed * dt;
    G.magnet -= dt; G.x2 -= dt; G.inv -= dt;
    // dalej tylko przeglądarka: punkty, combo i kryształy przyciągane magnesem
    addScore(G.speed * dt * 0.4 * (G.x2 > 0 ? 2 : 1));
    if (G.combo > 0) { G.comboT -= dt; if (G.comboT <= 0) { if (G.mult > 1) F.popup('COMBO PRZERWANE', 'lost', 50, 30); G.combo = 0; G.mult = 1; } }
    G.popT -= dt; if (G.popAcc > 0 && G.popT <= 0) { F.popup('+' + G.popAcc); G.popAcc = 0; G.popT = 0.3; }
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i], p = playerXY(0.8), k = 1 - Math.exp(-dt * (10 + f.t * 40));
      f.t += dt; f.x += (p.x - f.x) * k; f.y += (p.y - f.y) * k; f.s += (G.dist - f.s) * k;
      if (f.t > 0.5 || (Math.abs(f.s - G.dist) < 1 && Math.hypot(f.x - p.x, f.y - p.y) < 1)) { flyers.splice(i, 1); collectGem(p.x, p.y, 0); }
    }
  }
  /** Klatka obrazu: w biegu tyle kroków TICK, ile się zebrało; menu, upadek i ekran końca bez stałego kroku (nie liczą się do wyniku) */
  function update(dt) {
    G.time += dt;
    if (G.state === 'menu') {
      G.speed = 15; G.dist += G.speed * dt; P.th += dt * 0.22; P.vth = 0.6; G.jp = Math.floor(G.dist / TL); ensureRows(); return;
    }
    if (G.state === 'playing') {
      run.acc += dt;
      while (run.acc >= TICK && G.state === 'playing') { run.acc -= TICK; tick(); }
    } else if (G.state === 'dying') {
      G.deadT += dt;
      if (G.cause === 'crash') G.speed *= Math.exp(-dt * 3.5);
      else { P.vy -= GRAV * dt; P.h += P.vy * dt; }
      G.dist += G.speed * dt; G.jp = Math.floor(G.dist / TL); ensureRows();
      if (G.deadT > (G.cause === 'crash' ? 0.75 : 0.45)) { G.state = 'over'; G.overT = 0; F.over(); }
    } else if (G.state === 'over') {
      G.speed *= Math.exp(-dt * 2); G.dist += G.speed * dt; G.jp = Math.floor(G.dist / TL); ensureRows();
    }
  }

  return { G, P, input, run, rows, getRow, gen, flyers, resetGen, ensureRows, start, setKey, tick, update, floorR, tileAt, playerXY, itemX, itemY };
}
