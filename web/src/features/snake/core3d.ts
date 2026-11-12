// Super Turbo Snake 3D: deterministyczny rdzeń gry (kratki, jedzenie, złoto, kolizje; bez rysowania i punktów za combo).
// Scena (three/snakeScene.ts) tylko go woła i rysuje. Ten sam rdzeń w Rust (server/src/snake3d_sim.rs) ODTWARZA grę z ziarna
// i zapisu skrętów, więc serwer sam liczy zjedzone kule. Zmieniając ten plik, zmień snake3d_sim.rs w tej samej kolejności
// działań i losowań i odtwórz nagrania: node web/scripts/snake-fixture.mjs (test `cargo test snake3d_sim`).

export const N = 22;
/** turbo przyspiesza węża najwyżej tyle razy (najkrótszy możliwy czas kroku liczy serwer z tej wartości) */
export const BOOST_MULT = 1.85;
/** złota kula znika po tylu krokach węża */
export const GOLD_TICKS = 45;
export type Cell = { x: number; z: number };
export type Food = { cell: Cell; active: boolean; life: number };

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

/** kule na sekundę przy danej liczbie zjedzonych */
export const speedOf = (foods: number) => Math.min(5.0 + foods * 0.17, 12.5);
const rot = (d: Cell, t: number): Cell => t > 0 ? { x: -d.z, z: d.x } : { x: d.z, z: -d.x };

export type TickResult = { hit: boolean; ateFood: Cell | null; ateGold: Cell | null; goldSpawned: boolean; goldExpired: boolean };

export class Snake3DSim {
  cells: Cell[];
  tailHist: Cell[];
  exitDir: Cell = { x: 0, z: -1 };
  pendingGrow = 0;
  food: Food = { cell: { x: -1, z: -1 }, active: false, life: 0 };
  gold: Food = { cell: { x: -1, z: -1 }, active: false, life: 0 };
  /** zjedzone kule (zwykłe i złote) */
  foods = 0;
  ticks = 0;
  over = false;
  /** zapis skrętów dla serwera: (numer kroku, przed którym skręt działa; 1 = w prawo, 0 = w lewo) */
  log: number[] = [];
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    const sx = Math.floor(N / 2), sz = Math.floor(N / 2) + 3;
    this.cells = [];
    for (let i = 0; i < 4; i++) this.cells.push({ x: sx, z: sz + i });
    this.tailHist = [{ x: sx, z: sz + 4 }, { x: sx, z: sz + 5 }, { x: sx, z: sz + 6 }];
    this.spawn(this.food);
  }

  occupied(x: number, z: number) {
    for (const c of this.cells) if (c.x === x && c.z === z) return true;
    return false;
  }

  /** Nowa kula w wolnej kratce, nie przy głowie (do 800 prób) */
  private spawn(f: Food): boolean {
    const h = this.cells[0];
    for (let a = 0; a < 800; a++) {
      const x = (this.rng.next() * N) | 0, z = (this.rng.next() * N) | 0;
      if (this.occupied(x, z)) continue;
      if (f === this.food && this.gold.active && this.gold.cell.x === x && this.gold.cell.z === z) continue;
      if (f === this.gold && this.food.active && this.food.cell.x === x && this.food.cell.z === z) continue;
      if (Math.abs(x - h.x) + Math.abs(z - h.z) < 3) continue;
      f.cell = { x, z }; f.active = true;
      return true;
    }
    f.active = false;
    return false;
  }

  /** Skręt (t > 0 w prawo): działa przed następnym krokiem */
  turn(t: number) {
    if (this.over) return;
    this.exitDir = rot(this.exitDir, t);
    this.log.push(this.ticks, t > 0 ? 1 : 0);
  }

  /** Jeden krok węża o kratkę */
  tick(): TickResult {
    const res: TickResult = { hit: false, ateFood: null, ateGold: null, goldSpawned: false, goldExpired: false };
    if (this.over) { res.hit = true; return res; }
    const g = this.gold;
    if (g.active) { g.life--; if (g.life <= 0) { g.active = false; res.goldExpired = true; } }
    const h = this.cells[0];
    const nx = h.x + this.exitDir.x, nz = h.z + this.exitDir.z;
    const eatF = this.food.active && this.food.cell.x === nx && this.food.cell.z === nz;
    const eatG = g.active && g.cell.x === nx && g.cell.z === nz;
    const grow = this.pendingGrow > 0 || eatF || eatG;
    let hit = nx < 0 || nz < 0 || nx >= N || nz >= N;
    if (!hit) { const lim = grow ? this.cells.length : this.cells.length - 1; for (let i = 0; i < lim; i++) if (this.cells[i].x === nx && this.cells[i].z === nz) { hit = true; break; } }
    if (hit) { this.over = true; res.hit = true; return res; }
    this.cells.unshift({ x: nx, z: nz });
    if (eatF) this.pendingGrow += 1;
    if (eatG) this.pendingGrow += 3;
    if (this.pendingGrow > 0) this.pendingGrow--; else { this.tailHist.unshift(this.cells.pop()!); if (this.tailHist.length > 6) this.tailHist.length = 6; }
    this.ticks++;
    if (eatF) {
      res.ateFood = this.food.cell;
      this.foods++;
      this.spawn(this.food);
      if (!g.active && this.foods > 2 && this.rng.next() < 0.22) { if (this.spawn(g)) { g.life = GOLD_TICKS; res.goldSpawned = true; } }
    }
    if (eatG) {
      res.ateGold = g.cell;
      this.foods++;
      g.active = false;
    }
    return res;
  }
}
