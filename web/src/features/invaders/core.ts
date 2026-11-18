// Obrona Orbity: deterministyczny rdzeń gry (bez rysowania). Ten sam rdzeń w Rust (server/src/invaders_sim.rs) ODTWARZA grę
// na serwerze z ziarna i zapisu klawiszy, więc punkty liczy serwer - wynik z przeglądarki się nie liczy. Rdzeń liczy tylko na
// liczbach całkowitych (losowanie: floor(rng * n)), więc JS i Rust dają ten sam wynik bez kłopotów z ułamkami. Zmieniając ten plik,
// zmień invaders_sim.rs w tej samej kolejności działań i losowań, a potem odtwórz nagrania: node web/scripts/invaders-fixture.mjs
// (test `cargo test invaders_sim`).

export const W = 480, H = 540;
export const TICK = 1 / 60;
/** najdłuższa gra (kroków): 40 minut */
export const MAX_TICKS = 60 * 60 * 40;
/** bity klawiszy w zapisie */
export const LEFT = 1, RIGHT = 2, FIRE = 4;

export const PY = 500, PW = 26, PH = 14, PSPEED = 3;
export const AROWS = 5, ACOLS = 10, CELL_W = 36, CELL_H = 30, AW = 24, AH = 18;
export const ROW_PTS = [30, 20, 20, 10, 10];
export const SHIELD_Y = 420, SHIELD_COLS = 11, SHIELD_ROWS = 8, SC = 4;
export const SHIELD_X = [74, 181, 287, 394];
export const SAUCER_Y = 50, SAUCER_W = 34, SAUCER_H = 14;
const SAUCER_PTS = [50, 100, 150, 300];
const INVADE_Y = 470;
const EXTRA_LIFE = 1500;

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
  int(n: number): number { return Math.floor(this.next() * n); }
}

export interface Shot { x: number; y: number }
export interface Saucer { x: number; dir: number; pts: number }

const overlap = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) =>
  ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;

/** kształt osłony: łuk wycięty od dołu i ścięte górne rogi */
function shieldCell(r: number, c: number) {
  if (r === 0 && (c < 2 || c > 8)) return false;
  if (r === 1 && (c < 1 || c > 9)) return false;
  if (r >= 5 && c >= 3 && c <= 7) return false;
  return true;
}

export class InvadersSim {
  tick = 0;
  over = false;
  score = 0;
  lives = 3;
  wave = 1;
  px = W / 2;
  /** kroki do powrotu statku po trafieniu (0 = statek w grze) */
  respawn = 0;
  cooldown = 0;
  /** przerwa między falami */
  waveDelay = 0;
  extraGiven = false;
  alive: boolean[] = [];
  ox = 0;
  oy = 0;
  dir = 1;
  marchT = 0;
  marches = 0;
  bullet: Shot | null = null;
  bombs: Shot[] = [];
  bombT = 0;
  shields: boolean[][] = [];
  saucer: Saucer | null = null;
  saucerT = 0;
  saucerDir = 1;
  kills = 0;
  mask = 0;
  log: number[] = [];
  /** zdarzenia dla dźwięku i efektów (przeglądarka je zbiera i czyści) */
  events: { k: string; x: number; y: number; n?: number }[] = [];
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.saucerT = 900 + this.rng.int(900);
    this.setupWave();
  }

  private setupWave() {
    this.alive = new Array(AROWS * ACOLS).fill(true);
    this.ox = 66;
    this.oy = 80 + Math.min(this.wave - 1, 6) * 12;
    this.dir = 1;
    this.marchT = this.stepTicks();
    this.bullet = null;
    this.bombs = [];
    this.bombT = 60 + this.rng.int(60);
    this.shields = SHIELD_X.map(() => {
      const cells: boolean[] = [];
      for (let r = 0; r < SHIELD_ROWS; r++) for (let c = 0; c < SHIELD_COLS; c++) cells.push(shieldCell(r, c));
      return cells;
    });
  }

  aliveCount() { let n = 0; for (const a of this.alive) if (a) n++; return n; }

  /** co ile kroków formacja robi krok: im mniej obcych, tym szybciej */
  stepTicks() { return Math.max(2, Math.floor(this.aliveCount() * 36 / 50) + 2 - Math.min(this.wave - 1, 5) * 2); }

  alienX(i: number) { return this.ox + (i % ACOLS) * CELL_W; }
  alienY(i: number) { return this.oy + Math.floor(i / ACOLS) * CELL_H; }

  private bombSpeed() { return Math.min(6, 3 + Math.floor(this.wave / 2)); }

  /** pocisk (x - środek, y - góra, szerokość 2/4, wysokość 8) w osłonie: niszczy trafioną kratkę i sąsiednią w kierunku lotu */
  private hitShield(x: number, y: number, w: number, down: boolean): boolean {
    for (let s = 0; s < SHIELD_X.length; s++) {
      const sx = SHIELD_X[s] - (SHIELD_COLS * SC) / 2;
      if (!overlap(x - w / 2, y, w, 8, sx, SHIELD_Y, SHIELD_COLS * SC, SHIELD_ROWS * SC)) continue;
      const cells = this.shields[s];
      // kratki sprawdzamy od strony, z której leci pocisk
      for (let k = 0; k < SHIELD_ROWS; k++) {
        const r = down ? k : SHIELD_ROWS - 1 - k;
        for (let c = 0; c < SHIELD_COLS; c++) {
          if (!cells[r * SHIELD_COLS + c]) continue;
          if (!overlap(x - w / 2, y, w, 8, sx + c * SC, SHIELD_Y + r * SC, SC, SC)) continue;
          cells[r * SHIELD_COLS + c] = false;
          const r2 = down ? r + 1 : r - 1;
          if (r2 >= 0 && r2 < SHIELD_ROWS) cells[r2 * SHIELD_COLS + c] = false;
          this.events.push({ k: 'shield', x: sx + c * SC + 2, y: SHIELD_Y + r * SC + 2 });
          return true;
        }
      }
    }
    return false;
  }

  private addScore(n: number) {
    this.score += n;
    if (!this.extraGiven && this.score >= EXTRA_LIFE) { this.extraGiven = true; this.lives++; this.events.push({ k: 'life', x: this.px, y: PY }); }
  }

  /** Jeden krok gry (1/60 s) z wciśniętymi klawiszami `mask` (zmiana trafia do zapisu) */
  step(mask: number) {
    if (this.over) return;
    if (mask !== this.mask) { this.log.push(this.tick, mask); this.mask = mask; }
    this.tick++;
    if (this.tick >= MAX_TICKS) { this.over = true; return; }

    if (this.respawn > 0) { this.respawn--; if (this.respawn === 0) this.px = W / 2; }
    const ship = this.respawn === 0;
    if (ship) {
      const d = ((mask & RIGHT) ? 1 : 0) - ((mask & LEFT) ? 1 : 0);
      this.px = Math.max(16, Math.min(W - 16, this.px + d * PSPEED));
    }
    if (this.waveDelay > 0) {
      this.waveDelay--;
      if (this.waveDelay === 0) this.setupWave();
      return;
    }

    // strzał gracza: jeden pocisk naraz
    if (this.cooldown > 0) this.cooldown--;
    if (ship && (mask & FIRE) && !this.bullet && this.cooldown === 0) {
      this.bullet = { x: this.px, y: PY - 12 };
      this.cooldown = 8;
      this.events.push({ k: 'shoot', x: this.px, y: PY });
    }
    if (this.bullet) {
      const b = this.bullet;
      b.y -= 10;
      let gone = b.y < 30;
      if (!gone) {
        for (let i = 0; i < this.alive.length; i++) {
          if (!this.alive[i]) continue;
          const ax = this.alienX(i), ay = this.alienY(i);
          if (!overlap(b.x - 1, b.y, 2, 8, ax, ay, AW, AH)) continue;
          this.alive[i] = false;
          this.kills++;
          const pts = ROW_PTS[Math.floor(i / ACOLS)];
          this.addScore(pts);
          this.events.push({ k: 'kill', x: ax + AW / 2, y: ay + AH / 2, n: pts });
          gone = true;
          break;
        }
      }
      if (!gone && this.saucer && overlap(b.x - 1, b.y, 2, 8, this.saucer.x - SAUCER_W / 2, SAUCER_Y, SAUCER_W, SAUCER_H)) {
        this.addScore(this.saucer.pts);
        this.events.push({ k: 'saucer', x: this.saucer.x, y: SAUCER_Y + 7, n: this.saucer.pts });
        this.saucer = null;
        gone = true;
      }
      if (!gone) {
        for (let k = 0; k < this.bombs.length; k++) {
          const e = this.bombs[k];
          if (!overlap(b.x - 1, b.y, 2, 8, e.x - 2, e.y, 4, 8)) continue;
          this.bombs.splice(k, 1);
          this.events.push({ k: 'clash', x: b.x, y: b.y });
          gone = true;
          break;
        }
      }
      if (!gone && this.hitShield(b.x, b.y, 2, false)) gone = true;
      if (gone) this.bullet = null;
    }

    // marsz formacji
    this.marchT--;
    if (this.marchT <= 0) {
      let minX = W, maxX = 0, bottom = 0;
      for (let i = 0; i < this.alive.length; i++) {
        if (!this.alive[i]) continue;
        minX = Math.min(minX, this.alienX(i));
        maxX = Math.max(maxX, this.alienX(i) + AW);
      }
      if ((this.dir > 0 && maxX + 6 > W - 8) || (this.dir < 0 && minX - 6 < 8)) { this.oy += 12; this.dir = -this.dir; }
      else this.ox += 6 * this.dir;
      this.marches++;
      this.marchT = this.stepTicks();
      this.events.push({ k: 'march', x: 0, y: 0, n: this.marches & 3 });
      for (let i = 0; i < this.alive.length; i++) {
        if (!this.alive[i]) continue;
        const ax = this.alienX(i), ay = this.alienY(i);
        bottom = Math.max(bottom, ay + AH);
        // obcy zjadają osłony, przez które przechodzą
        if (ay + AH < SHIELD_Y) continue;
        for (let s = 0; s < SHIELD_X.length; s++) {
          const sx = SHIELD_X[s] - (SHIELD_COLS * SC) / 2, cells = this.shields[s];
          for (let r = 0; r < SHIELD_ROWS; r++) for (let c = 0; c < SHIELD_COLS; c++) {
            if (cells[r * SHIELD_COLS + c] && overlap(ax, ay, AW, AH, sx + c * SC, SHIELD_Y + r * SC, SC, SC)) cells[r * SHIELD_COLS + c] = false;
          }
        }
      }
      if (bottom >= INVADE_Y) { this.over = true; this.events.push({ k: 'invaded', x: this.px, y: PY }); return; }
    }

    // bomby obcych: strzela najniższy obcy z losowej kolumny
    this.bombT--;
    if (this.bombT <= 0) {
      this.bombT = Math.max(20, 70 - this.wave * 6) + this.rng.int(40);
      if (this.bombs.length < 4) {
        const cols: number[] = [];
        for (let c = 0; c < ACOLS; c++) for (let r = 0; r < AROWS; r++) if (this.alive[r * ACOLS + c]) { cols.push(c); break; }
        if (cols.length) {
          const c = cols[this.rng.int(cols.length)];
          let r = AROWS - 1;
          while (!this.alive[r * ACOLS + c]) r--;
          const i = r * ACOLS + c;
          this.bombs.push({ x: this.alienX(i) + AW / 2, y: this.alienY(i) + AH });
          this.events.push({ k: 'bomb', x: this.alienX(i) + AW / 2, y: this.alienY(i) + AH });
        }
      }
    }
    const sp = this.bombSpeed();
    for (let k = this.bombs.length - 1; k >= 0; k--) {
      const e = this.bombs[k];
      e.y += sp;
      let gone = e.y > H;
      if (!gone && this.hitShield(e.x, e.y, 4, true)) gone = true;
      if (!gone && this.respawn === 0 && overlap(e.x - 2, e.y, 4, 8, this.px - PW / 2, PY, PW, PH)) {
        gone = true;
        this.lives--;
        this.events.push({ k: 'hit', x: this.px, y: PY + 7 });
        if (this.lives <= 0) { this.over = true; return; }
        this.respawn = 90;
        this.bombs = [];
        break;
      }
      if (gone) this.bombs.splice(k, 1);
    }

    // satelita z bonusem przelatuje górą
    if (this.saucer) {
      this.saucer.x += 2 * this.saucer.dir;
      if (this.saucer.x < -SAUCER_W || this.saucer.x > W + SAUCER_W) this.saucer = null;
    } else if (--this.saucerT <= 0) {
      this.saucerT = 1200 + this.rng.int(900);
      this.saucer = { x: this.saucerDir > 0 ? -SAUCER_W / 2 : W + SAUCER_W / 2, dir: this.saucerDir, pts: SAUCER_PTS[this.rng.int(4)] };
      this.saucerDir = -this.saucerDir;
      this.events.push({ k: 'ufo', x: this.saucer.x, y: SAUCER_Y });
    }

    if (this.aliveCount() === 0) {
      this.wave++;
      this.waveDelay = 90;
      this.bullet = null;
      this.bombs = [];
      this.saucer = null;
      this.events.push({ k: 'wave', x: W / 2, y: H / 2, n: this.wave });
    }
  }
}
