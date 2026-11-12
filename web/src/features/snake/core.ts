// Snake 2D: deterministyczny rdzeń gry (bez rysowania). Ten sam rdzeń w Rust (server/src/snake_sim.rs) ODTWARZA grę na serwerze
// z ziarna i zapisu skrętów, więc serwer sam liczy jabłka - wynik z przeglądarki się nie liczy. Zmieniając ten plik, zmień
// snake_sim.rs w tej samej kolejności działań i losowań, a potem odtwórz nagrania: node web/scripts/snake-fixture.mjs
// (test `cargo test snake_sim`).

export const COLS = 20, ROWS = 20;
/** czas kroku: krótszy o FASTER ms za każde jabłko, najkrócej MIN_MS */
export const START_MS = 140, MIN_MS = 65, FASTER = 3;
export type P = { x: number; y: number };
export type Dir = 'up' | 'down' | 'left' | 'right';
/** kody kierunków w zapisie gry */
export const DIRS: Dir[] = ['right', 'down', 'left', 'up'];
export const VEC: Record<Dir, P> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** mulberry32: 32-bitowy generator z ziarnem; liczy tak samo w JS i w Rust */
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

/** Jedna gra: `step()` = jeden krok węża; `log` = zapis zmian kierunku (krok, kod kierunku) dla serwera */
export class SnakeSim {
  snake: P[] = [];
  dir: Dir = 'right';
  apple: P = { x: -1, y: -1 };
  score = 0;
  stepMs = START_MS;
  steps = 0;
  /** suma czasów kroków w ms (najkrótszy możliwy czas gry) */
  minMs = 0;
  over = false;
  log: number[] = [];
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    const y = Math.floor(ROWS / 2);
    this.snake = [{ x: 6, y }, { x: 5, y }, { x: 4, y }];
    this.placeApple();
  }

  private placeApple() {
    const free: P[] = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!this.snake.some(s => s.x === x && s.y === y)) free.push({ x, y });
    this.apple = free.length ? free[Math.floor(this.rng.next() * free.length)] : { x: -1, y: -1 };
  }

  /** Krok węża w kierunku `next` (zmiana kierunku trafia do zapisu); zwraca 'eat' | 'move' | 'over' */
  step(next: Dir = this.dir): 'eat' | 'move' | 'over' {
    if (this.over) return 'over';
    if (next !== this.dir) { this.log.push(this.steps, DIRS.indexOf(next)); this.dir = next; }
    this.minMs += this.stepMs;
    this.steps++;
    const v = VEC[this.dir], h = this.snake[0], n = { x: h.x + v.x, y: h.y + v.y };
    const eats = n.x === this.apple.x && n.y === this.apple.y;
    const body = eats ? this.snake : this.snake.slice(0, -1);   // ogon ucieka w tym samym kroku, więc można w niego wjechać, gdy nie jemy
    if (n.x < 0 || n.y < 0 || n.x >= COLS || n.y >= ROWS || body.some(s => s.x === n.x && s.y === n.y)) { this.over = true; return 'over'; }
    this.snake = [n, ...this.snake];
    if (eats) {
      this.score++;
      this.stepMs = Math.max(MIN_MS, this.stepMs - FASTER);
      this.placeApple();
      if (this.apple.x < 0) { this.over = true; return 'over'; }   // cała plansza zajęta
      return 'eat';
    }
    this.snake.pop();
    return 'move';
  }
}
