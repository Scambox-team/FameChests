// Snake: klasyczna plansza w kratkę, wąż i jabłka. Logika co krok (`step`), rysowanie na płótnie co klatkę.
// Wygląd od admina (/api/games/snake): kolor węża i tła, obrazki PNG głowy, ciała, jabłka i tła (głowa i ciało patrzą w prawo,
// gra je obraca w stronę ruchu). Bez obrazków wszystko rysuje się samo.

import { drawSkin, type Skin } from './skins';

export const COLS = 20, ROWS = 20;
type P = { x: number; y: number };
export type Dir = 'up' | 'down' | 'left' | 'right';
const VEC: Record<Dir, P> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPP: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const ANGLE: Record<Dir, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

export interface SnakeReward { perApple: number; minScore: number; perGame: number; daily: number; today: number }
export interface SnakeLook {
  color: string; background: string; images: Partial<Record<'head' | 'body' | 'apple' | 'bg', string | null>>;
  sounds?: { id: string; url: string }[]; maxSounds?: number; reward?: SnakeReward;
}
export interface SnakeHud { phase: 'idle' | 'play' | 'pause' | 'over'; score: number; length: number; best: number; record: boolean }
export interface SnakeEvents { eat?: (len: number) => void; over?: (record: boolean, score: number) => void; turn?: () => void }

const BEST_KEY = 'snakeBest';
const readBest = () => { try { return +(localStorage.getItem(BEST_KEY) || 0) || 0; } catch { return 0; } };
const START_MS = 140, MIN_MS = 65, FASTER = 3;   // czas kroku: krótszy o FASTER ms za każde jabłko, najkrócej MIN_MS

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

export function createSnake(canvas: HTMLCanvasElement, onHud: (h: SnakeHud) => void, ev: SnakeEvents = {}) {
  const ctx = canvas.getContext('2d')!;
  let look: SnakeLook = { color: '#4ade80', background: '#0d130f', images: {} };
  const imgs: Partial<Record<string, HTMLImageElement>> = {};
  let skin: Skin | null = null;   // motyw inny niż domyślny: własny wygląd rysuje skins.ts (look od admina nie obowiązuje)
  let prev: P[] = [], eatAt: P = { x: 0, y: 0 };
  let snake: P[] = [], dir: Dir = 'right', queue: Dir[] = [], apple: P = { x: 0, y: 0 };
  let phase: SnakeHud['phase'] = 'idle', score = 0, best = readBest(), record = false;
  let stepMs = START_MS, acc = 0, last = 0, raf = 0, eatFx = 0, size = 0;

  const hud = () => onHud({ phase, score, length: snake.length, best, record });

  function reset() {
    const y = Math.floor(ROWS / 2);
    snake = [{ x: 6, y }, { x: 5, y }, { x: 4, y }];
    dir = 'right'; queue = []; score = 0; record = false; stepMs = START_MS; acc = 0;
    prev = snake;
    placeApple();
  }
  function placeApple() {
    const free: P[] = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!snake.some(s => s.x === x && s.y === y)) free.push({ x, y });
    apple = free[Math.floor(Math.random() * free.length)] ?? { x: -1, y: -1 };
  }

  function step() {
    if (queue.length) dir = queue.shift()!;
    const v = VEC[dir], h = snake[0], next = { x: h.x + v.x, y: h.y + v.y };
    const eats = next.x === apple.x && next.y === apple.y;
    const body = eats ? snake : snake.slice(0, -1);   // ogon ucieka w tym samym kroku, więc można w niego wjechać, gdy nie jemy
    if (next.x < 0 || next.y < 0 || next.x >= COLS || next.y >= ROWS || body.some(s => s.x === next.x && s.y === next.y)) return gameOver();
    prev = snake;
    snake = snake.slice();
    snake.unshift(next);
    if (eats) {
      score++; eatFx = 1; eatAt = apple;
      stepMs = Math.max(MIN_MS, stepMs - FASTER);
      if (score > best) { best = score; record = true; try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* bez zapisu */ } }
      placeApple();
      ev.eat?.(snake.length);
      if (apple.x < 0) return gameOver();   // cała plansza zajęta
    } else snake.pop();
    hud();
  }
  function gameOver() {
    phase = 'over';
    hud();
    ev.over?.(record, score);
  }

  // ------------------------------------------------------------------ rysowanie
  function resize() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    size = Math.max(1, Math.round(r.width * dpr));
    canvas.width = canvas.height = size;
  }
  const cell = () => size / COLS;

  function drawImg(img: HTMLImageElement, p: P, angle: number, scale = 1) {
    const c = cell(), s = c * scale;
    ctx.save();
    ctx.translate((p.x + .5) * c, (p.y + .5) * c);
    if (angle) ctx.rotate(angle);
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
  const ready = (k: string) => { const i = imgs[k]; return i && i.complete && i.naturalWidth > 0 ? i : null; };
  const dirOf = (a: P, b: P): Dir => b.x > a.x ? 'left' : b.x < a.x ? 'right' : b.y > a.y ? 'up' : 'down';   // kierunek ruchu od b do a

  function draw(t: number) {
    if (skin) {
      drawSkin(skin, ctx, canvas, { size, cols: COLS, rows: ROWS, snake, prev, dir, apple, phase, prog: phase === 'play' ? Math.min(1, acc / stepMs) : 1, eatFx, eatAt, t });
      return;
    }
    const c = cell();
    ctx.fillStyle = look.background;
    ctx.fillRect(0, 0, size, size);
    const bg = ready('bg');
    if (bg) {   // tło jak object-fit: cover
      const k = Math.max(size / bg.naturalWidth, size / bg.naturalHeight), w = bg.naturalWidth * k, h = bg.naturalHeight * k;
      ctx.drawImage(bg, (size - w) / 2, (size - h) / 2, w, h);
    }
    // szachownica: co druga kratka odrobinę jaśniejsza
    ctx.fillStyle = 'rgba(255, 255, 255, .025)';
    for (let y = 0; y < ROWS; y++) for (let x = (y % 2); x < COLS; x += 2) ctx.fillRect(x * c, y * c, c, c);

    // jabłko (lekko pulsuje)
    if (apple.x >= 0) {
      const pulse = 1 + Math.sin(t / 220) * .05, ai = ready('apple');
      if (ai) drawImg(ai, apple, 0, .95 * pulse);
      else {
        const cx = (apple.x + .5) * c, cy = (apple.y + .55) * c, r = c * .36 * pulse;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.arc(cx - r * .35, cy, r * .78, 0, Math.PI * 2); ctx.arc(cx + r * .35, cy, r * .78, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, .35)';
        ctx.beginPath(); ctx.arc(cx - r * .45, cy - r * .3, r * .2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#6b3f1d'; ctx.lineWidth = Math.max(1, c * .07); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx, cy - r * .55); ctx.lineTo(cx + r * .15, cy - r * 1.05); ctx.stroke();
        ctx.fillStyle = '#22c55e';
        ctx.beginPath(); ctx.ellipse(cx + r * .45, cy - r * .95, r * .35, r * .16, -.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // wąż: od ogona do głowy, kolor ciemnieje ku ogonowi
    const bi = ready('body'), hi = ready('head'), n = snake.length;
    for (let i = n - 1; i >= 0; i--) {
      const p = snake[i];
      if (i === 0) continue;
      const d = snake[i + 1] ? dirOf(p, snake[i + 1]) : dirOf(snake[i - 1], p);
      if (bi) { drawImg(bi, p, ANGLE[d]); continue; }
      const pad = c * (.08 + .1 * (i / n));
      ctx.fillStyle = shade(look.color, -.35 * (i / n));
      round(p.x * c + pad, p.y * c + pad, c - pad * 2, c - pad * 2, c * .28);
      // łącznik z poprzednim segmentem, żeby wąż był ciągły
      const q = snake[i - 1], mx = Math.min(p.x, q.x) * c, my = Math.min(p.y, q.y) * c;
      if (q.x !== p.x) ctx.fillRect(mx + c * .5, p.y * c + pad, c, c - pad * 2);
      else ctx.fillRect(p.x * c + pad, my + c * .5, c - pad * 2, c);
    }
    if (n) {
      const h = snake[0], grow = 1 + eatFx * .15;
      if (hi) drawImg(hi, h, ANGLE[dir], 1.05 * grow);
      else {
        const pad = c * .04;
        ctx.fillStyle = shade(look.color, .12);
        round(h.x * c + pad, h.y * c + pad, c - pad * 2, c - pad * 2, c * .32);
        // oczy patrzą w stronę ruchu
        const v = VEC[dir], cx = (h.x + .5) * c, cy = (h.y + .5) * c, side = { x: -v.y, y: v.x };
        for (const s of [-1, 1]) {
          const ex = cx + v.x * c * .16 + side.x * s * c * .2, ey = cy + v.y * c * .16 + side.y * s * c * .2;
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, c * .12, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(ex + v.x * c * .04, ey + v.y * c * .04, c * .06, 0, Math.PI * 2); ctx.fill();
        }
        if (phase === 'over') {   // krzyżyki zamiast oczu
          ctx.strokeStyle = '#111'; ctx.lineWidth = c * .06;
          for (const s of [-1, 1]) {
            const ex = cx + v.x * c * .16 + side.x * s * c * .2, ey = cy + v.y * c * .16 + side.y * s * c * .2, k = c * .08;
            ctx.beginPath(); ctx.moveTo(ex - k, ey - k); ctx.lineTo(ex + k, ey + k); ctx.moveTo(ex + k, ey - k); ctx.lineTo(ex - k, ey + k); ctx.stroke();
          }
        }
      }
    }
    if (phase === 'over') { ctx.fillStyle = 'rgba(0, 0, 0, .35)'; ctx.fillRect(0, 0, size, size); }
  }
  function round(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(200, t - (last || t));
    last = t;
    if (phase === 'play') {
      acc += dt;
      while (acc >= stepMs && phase === 'play') { acc -= stepMs; step(); }
    }
    eatFx = Math.max(0, eatFx - dt / 180);
    draw(t);
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();
  reset();
  hud();
  raf = requestAnimationFrame(frame);

  return {
    start() { reset(); phase = 'play'; last = 0; hud(); },
    pause() { if (phase === 'play') { phase = 'pause'; hud(); } else if (phase === 'pause') { phase = 'play'; last = 0; hud(); } },
    turn(d: Dir) {
      if (phase !== 'play') return;
      const lastDir = queue.length ? queue[queue.length - 1] : dir;
      if (d === lastDir || d === OPP[lastDir] || queue.length >= 3) return;
      queue.push(d);
      ev.turn?.();
    },
    setSkin(k: Skin | null) { skin = k; },
    setLook(l: SnakeLook) {
      look = l;
      for (const k of ['head', 'body', 'apple', 'bg']) {
        const url = l.images[k as keyof SnakeLook['images']];
        if (!url) { delete imgs[k]; continue; }
        if (imgs[k]?.src.endsWith(url)) continue;
        const im = new Image();
        im.src = url;
        imgs[k] = im;
      }
    },
    get phase() { return phase; },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
export type SnakeGame = ReturnType<typeof createSnake>;
