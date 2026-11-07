// Strzelnica (zakładka Gry): rdzeń gry, bez rysowania i dźwięku. Tak samo jak w Pinballu serwer odtwarza grę z zapisu strzałów
// (server/src/aim_sim.rs) i sam liczy punkty, więc rdzeń musi być DETERMINISTYCZNY, bit w bit tak samo w JS i w Rust:
// stały krok `TICK`, losowość tylko z `Rng` (ziarno daje serwer), z liczb zmiennoprzecinkowych tylko + - * / floor.
// Zmieniając cokolwiek tutaj, zmień ten sam krok w aim_sim.rs i odtwórz nagrania: `node web/scripts/aim-fixture.mjs`.

export const AW = 800, AH = 500;          // pole gry (jednostki logiczne; płótno skaluje je do ekranu)
export const TICK = 1 / 60;
export const ROUND_TICKS = 2700;          // 45 s
export const COOLDOWN = 12;               // najkrótsza przerwa między strzałami (ticki)
export const AIM_SLACK = 4;               // zapas przy trafieniu (jednostki)

/** Rzędy kaczek, od najdalszego (mała, szybka, najwięcej punktów) do najbliższego (duża, wolna) */
export const ROWS = [
  { y: 168, r: 20, v: 170, dir: 1, pts: 30, gapMin: 0.9, gapMax: 1.9 },
  { y: 282, r: 26, v: 120, dir: -1, pts: 20, gapMin: 1.0, gapMax: 2.1 },
  { y: 396, r: 34, v: 85, dir: 1, pts: 10, gapMin: 1.2, gapMax: 2.4 },
];
export const GOLD_CHANCE = 0.12;           // szansa, że nowa kaczka jest złota: mała, szybka, 100 pkt
export const GOLD_POINTS = 100;

export type Duck = { id: number; row: number; x: number; y: number; r: number; v: number; dir: number; pts: number; gold: boolean };
export type Fx = {
  shot(): void;
  hit(duck: Duck, points: number, mult: number): void;
  miss(x: number, y: number): void;
  over(score: number): void;
};
const NOFX: Fx = { shot() {}, hit() {}, miss() {}, over() {} };

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

export class Sim {
  readonly rng: Rng;
  fx: Fx;
  tick = 0;
  phase: 'attract' | 'play' | 'over' = 'attract';
  ducks: Duck[] = [];
  next: number[] = [];                    // czas (s) do następnej kaczki w rzędzie
  score = 0; hits = 0; shots = 0; streak = 0; best = 0;
  lastShot = -1000;
  private ids = 0;

  constructor(seed: number, fx: Fx = NOFX) { this.rng = new Rng(seed); this.fx = fx; }

  get mult() { return Math.min(5, 1 + Math.floor(this.streak / 3)); }

  private spawn(row: number, x: number) {
    const R = ROWS[row];
    const gold = this.rng.next() < GOLD_CHANCE;
    this.ducks.push({
      id: this.ids++, row, x, y: R.y,
      r: gold ? R.r * 0.8 : R.r, v: gold ? R.v * 1.8 : R.v, dir: R.dir, pts: gold ? GOLD_POINTS : R.pts, gold,
    });
  }

  /** Początek rundy: kaczki od razu płyną po całej szerokości, potem dochodzą nowe */
  start() {
    if (this.phase === 'play') return;
    this.phase = 'play'; this.tick = 0; this.score = 0; this.hits = 0; this.shots = 0; this.streak = 0; this.best = 0;
    this.lastShot = -1000; this.ducks = []; this.next = [];
    ROWS.forEach((R, row) => {
      const step = R.v * 1.4;
      for (let x = 30 + this.rng.next() * 40; x < AW; x += step + this.rng.next() * 60) this.spawn(row, R.dir > 0 ? x : AW - x);
      this.next.push(R.gapMin + this.rng.next() * (R.gapMax - R.gapMin));
    });
  }

  /** Strzał w punkt (x, y) pola gry. Zwraca trafioną kaczkę albo null; w czasie przerwy między strzałami nic się nie dzieje. */
  shoot(x: number, y: number): Duck | null {
    if (this.phase !== 'play' || this.tick - this.lastShot < COOLDOWN) return null;
    this.lastShot = this.tick; this.shots++;
    this.fx.shot();
    // najpierw kaczki z przodu (bliższe rzędy), w obrębie rzędu - starsza pierwsza
    for (let row = ROWS.length - 1; row >= 0; row--) {
      for (let i = 0; i < this.ducks.length; i++) {
        const d = this.ducks[i];
        if (d.row !== row) continue;
        const dx = x - d.x, dy = y - d.y, rr = d.r + AIM_SLACK;
        if (dx * dx + dy * dy <= rr * rr) {
          this.ducks.splice(i, 1);
          this.streak++; this.hits++;
          const m = this.mult, pts = d.pts * m;
          this.score += pts;
          if (this.streak > this.best) this.best = this.streak;
          this.fx.hit(d, pts, m);
          return d;
        }
      }
    }
    this.streak = 0;
    this.fx.miss(x, y);
    return null;
  }

  /** Jeden stały krok symulacji (TICK) */
  step() {
    if (this.phase !== 'play') return;
    this.tick++;
    const dt = TICK;
    for (const d of this.ducks) d.x += d.dir * d.v * dt;
    this.ducks = this.ducks.filter(d => d.dir > 0 ? d.x < AW + d.r + 5 : d.x > -d.r - 5);
    ROWS.forEach((R, row) => {
      this.next[row] -= dt;
      if (this.next[row] <= 0) {
        this.spawn(row, R.dir > 0 ? -R.r - 4 : AW + R.r + 4);
        this.next[row] = R.gapMin + this.rng.next() * (R.gapMax - R.gapMin);
      }
    });
    if (this.tick >= ROUND_TICKS) { this.phase = 'over'; this.fx.over(this.score); }
  }
}
