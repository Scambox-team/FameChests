// Super Turbo AIMPULSE 3D: deterministyczny rdzeń rundy (bez rysowania). Ten sam rdzeń w Rust (server/src/aimpulse_sim.rs)
// ODTWARZA rundę na serwerze z ziarna, poziomu, czasu i zapisu strzałów (krok, kierunek), więc punkty liczy serwer.
// Stały krok 1/60 s, losowanie tylko z `Rng`, liczby: + - * / sqrt floor (bez sin/cos - silniki JS i Rust potrafią
// się w nich różnić w ostatnim bicie); kierunek strzału przychodzi jako liczby całkowite (×1e6), a punkty liczą się na
// liczbach całkowitych. Zmieniając ten plik, zmień aimpulse_sim.rs w tej samej kolejności działań i losowań, a potem
// odtwórz nagrania: node web/scripts/aimpulse-fixture.mjs (test `cargo test aimpulse_sim`).

export const TICK = 1 / 60;
export const DURS = [30, 60, 120];
/** najkrótsza przerwa między strzałami (kroki); szybsze kliknięcia gra pomija */
export const SHOT_GAP = 4;
export const QUANT = 1_000_000;
export const EYE = { x: 0, y: 1.7, z: 8 };

export interface Diff { name: string; radius: number; life: number; maxGood: number; gap: [number, number]; badEvery: [number, number]; maxBad: number; badLife: number; gold: number }
export const DIFFS: Diff[] = [
  { name: 'ŁATWY', radius: 0.82, life: 3.0, maxGood: 3, gap: [0.22, 0.55], badEvery: [2.6, 4.2], maxBad: 1, badLife: 3.2, gold: 0.05 },
  { name: 'NORMALNY', radius: 0.62, life: 2.3, maxGood: 3, gap: [0.14, 0.42], badEvery: [1.5, 2.8], maxBad: 2, badLife: 2.8, gold: 0.07 },
  { name: 'TRUDNY', radius: 0.46, life: 1.6, maxGood: 4, gap: [0.08, 0.30], badEvery: [0.9, 1.8], maxBad: 3, badLife: 2.6, gold: 0.09 },
];

export const GOOD = 0, BAD = 1, GOLD = 2;
export type TType = 0 | 1 | 2;

/** mulberry32: 32-bitowy generator z ziarnem; liczy tak samo w JS i w Rust */
/** kroków w odcinku losowania (`SEG` w aimpulse_sim.rs) - 2 s gry */
export const SEG = 120;

export class Rng {
  private a: number;
  constructor(seed: number) { this.a = seed | 0; }
  next(): number {
    this.a = (this.a + 0x6D2B79F5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + this.next() * (b - a); }
}

export interface Target {
  id: number; type: TType;
  /** współrzędne płaszczyzny widoku (u - w bok, v - w górę), odległość i promień kątowy */
  u: number; v: number; dist: number; ang: number;
  /** kierunek od oka (jednostkowy) i środek */
  dx: number; dy: number; dz: number;
  x: number; y: number; z: number;
  radius: number; hitR: number;
  /** życie i wiek w krokach */
  life: number; age: number;
}

export type AimEvent =
  | { k: 'spawn'; t: Target }
  | { k: 'expire'; t: Target }
  | { k: 'hit'; t: Target; pts: number; perfect: boolean; combo: number }
  | { k: 'bad'; t: Target }
  | { k: 'miss'; x: number; y: number; z: number };

const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v;

export class AimSim {
  readonly diff: Diff;
  readonly total: number;
  tick = 0;
  over = false;
  score = 0;
  combo = 0;
  maxCombo = 0;
  shots = 0;
  hits = 0;
  perfects = 0;
  badHits = 0;
  expired = 0;
  golds = 0;
  /** suma czasów reakcji w krokach */
  rtSum = 0;
  targets: Target[] = [];
  log: number[] = [];
  events: AimEvent[] = [];
  private spawnT = 6;
  private badT: number;
  private lastShot = -1000;
  private nextId = 1;
  private rng: Rng;
  private seeds: (k: number) => number;

  /** `seeds(k)` = ziarno odcinka `k` (po SEG kroków; features/games/liveSeeds.ts) */
  constructor(seeds: (k: number) => number, diff: number, dur: number) {
    this.seeds = seeds; this.rng = new Rng(seeds(0));
    this.diff = DIFFS[diff];
    this.total = dur * 60;
    this.badT = Math.floor(this.rng.range(1.5, 3) * 60);
  }

  makeSpot(u: number, v: number, dist: number, r: number) {
    const len = Math.sqrt(u * u + v * v + 1), dx = u / len, dy = v / len, dz = -1 / len, ang = r / dist;
    for (const t of this.targets) {
      const ex = dx - t.dx, ey = dy - t.dy, ez = dz - t.dz;
      if (Math.sqrt(ex * ex + ey * ey + ez * ez) < (ang + t.ang) * 1.3 + 0.012) return null;
    }
    return { u, v, dist, ang, dx, dy, dz, x: EYE.x + dx * dist, y: EYE.y + dy * dist, z: EYE.z + dz * dist };
  }

  private pickSpot(r: number) {
    for (let i = 0; i < 30; i++) {
      const u = this.rng.range(-0.62, 0.62), v = this.rng.range(-0.13, 0.40), d = this.rng.range(12, 17);
      const s = this.makeSpot(u, v, d, r);
      if (s) return s;
    }
    return null;
  }

  /** pułapki lubią stać tuż obok prawdziwego celu */
  private spotNear(r: number) {
    const c = this.targets.filter(t => t.type !== BAD);
    if (!c.length) return null;
    const b = c[Math.floor(this.rng.next() * c.length)];
    for (let i = 0; i < 10; i++) {
      const dist = clamp(b.dist + this.rng.range(-1.5, 1.5), 11.5, 17.5);
      const off = (r / dist + b.ang) * this.rng.range(1.5, 2.6) + 0.012;
      let cx = this.rng.range(-1, 1), cy = this.rng.range(-1, 1);
      const l = Math.sqrt(cx * cx + cy * cy);
      if (l < 0.001) { cx = 1; cy = 0; } else { cx = cx / l; cy = cy / l; }
      const s = this.makeSpot(clamp(b.u + cx * off, -0.64, 0.64), clamp(b.v + cy * off, -0.15, 0.42), dist, r);
      if (s) return s;
    }
    return null;
  }

  private spawn(type: TType) {
    const D = this.diff, r = D.radius * (type === GOLD ? 0.62 : type === BAD ? 0.9 : 1);
    let spot: ReturnType<AimSim['makeSpot']> = null;
    if (type === BAD && this.rng.next() < 0.6) spot = this.spotNear(r);
    if (!spot) spot = this.pickSpot(r);
    if (!spot) return;
    const prog = this.tick / this.total;
    const life = type === GOLD ? D.life * 0.62 : type === BAD ? D.badLife * this.rng.range(0.8, 1.15) : D.life * (1 - 0.22 * prog);
    const t: Target = {
      id: this.nextId++, type, ...spot, radius: r, hitR: r * (type === GOOD ? 1.05 : type === BAD ? 1.0 : 0.95),
      life: Math.max(1, Math.floor(life * 60)), age: 0,
    };
    this.targets.push(t);
    this.events.push({ k: 'spawn', t });
  }

  private nextGap() {
    const D = this.diff;
    this.spawnT = Math.max(this.spawnT, Math.floor(this.rng.range(D.gap[0], D.gap[1]) * 60));
  }

  private breakCombo() { this.combo = 0; }

  /** Jeden krok rundy (1/60 s) */
  step() {
    this.stepInner();
    // nowy odcinek losowania (jak w aimpulse_sim.rs)
    if (!this.over && this.tick % SEG === 0) this.rng = new Rng(this.seeds(this.tick / SEG));
  }

  private stepInner() {
    if (this.over) return;
    this.tick++;
    if (this.tick >= this.total) { this.over = true; return; }
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      t.age++;
      if (t.age < t.life) continue;
      this.targets.splice(i, 1);
      i--;
      this.events.push({ k: 'expire', t });
      if (t.type === GOOD) { this.expired++; this.breakCombo(); this.nextGap(); }
    }
    const D = this.diff;
    let good = 0, bad = 0;
    for (const t of this.targets) if (t.type === BAD) bad++; else good++;
    this.spawnT--;
    if (this.spawnT <= 0 && good < D.maxGood) {
      const roll = this.rng.next();
      this.spawn(roll < D.gold && this.tick > 180 ? GOLD : GOOD);
      this.spawnT = Math.floor(this.rng.range(D.gap[0], D.gap[1]) * 60);
    }
    this.badT--;
    if (this.badT <= 0) {
      if (bad < D.maxBad) this.spawn(BAD);
      this.badT = Math.floor(this.rng.range(D.badEvery[0], D.badEvery[1]) * 60);
    }
  }

  /** Czy strzał w tej chwili się liczy (przerwa między strzałami, koniec rundy) */
  canShoot() { return !this.over && this.tick - this.lastShot >= SHOT_GAP; }

  /** Strzał w kierunku (qx, qy, qz) - liczby całkowite (kierunek × QUANT); trafia do zapisu */
  shoot(qx: number, qy: number, qz: number) {
    if (!this.canShoot()) return false;
    qx = Math.round(qx); qy = Math.round(qy); qz = Math.round(qz);
    const len = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (len === 0) return false;
    this.log.push(this.tick, qx, qy, qz);
    this.lastShot = this.tick;
    this.shots++;
    const dx = qx / len, dy = qy / len, dz = qz / len;
    let best: Target | null = null, bestT = Infinity, bestD = 0;
    for (const t of this.targets) {
      const vx = t.x - EYE.x, vy = t.y - EYE.y, vz = t.z - EYE.z;
      const tca = vx * dx + vy * dy + vz * dz;
      if (tca <= 0) continue;
      const d2 = vx * vx + vy * vy + vz * vz - tca * tca, R = t.hitR;
      if (d2 <= R * R) {
        const th = tca - Math.sqrt(R * R - d2);
        if (th < bestT) { bestT = th; best = t; bestD = Math.sqrt(Math.max(d2, 0)) / R; }
      }
    }
    if (!best) {
      this.breakCombo();
      this.events.push({ k: 'miss', x: dx, y: dy, z: dz });
      return true;
    }
    this.targets.splice(this.targets.indexOf(best), 1);
    if (best.type === BAD) {
      this.badHits++;
      this.score = Math.max(0, this.score - 300);
      this.breakCombo();
      this.events.push({ k: 'bad', t: best });
      return true;
    }
    let base: number, perfect = false;
    if (best.type === GOLD) { base = 500; this.golds++; }
    else {
      base = 100 + Math.floor((200 * (best.life - best.age) + best.life) / (2 * best.life));
      if (bestD < 0.38) { base += 50; perfect = true; this.perfects++; }
    }
    const pts = Math.floor((base * (10 + Math.min(this.combo, 30)) + 25) / 50) * 5;
    this.score += pts;
    this.hits++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.rtSum += best.age;
    this.nextGap();
    this.events.push({ k: 'hit', t: best, pts, perfect, combo: this.combo });
    return true;
  }
}
