// Snake w motywach: każdy motyw ma własną planszę, węża i jabłko rysowane na płótnie (kolory i obrazki z panelu admina
// dotyczą tylko motywu domyślnego). Ruch jest płynny: pozycje segmentów interpoluje `prog` (0..1 kroku).
import type { Dir } from './engine';

export type Skin = 'warm' | 'aero' | 'vapor';
type P = { x: number; y: number };
export interface SkinState {
  size: number; cols: number; rows: number; snake: P[]; prev: P[]; dir: Dir; apple: P; phase: 'idle' | 'play' | 'pause' | 'over';
  prog: number; eatFx: number; eatAt: P; t: number;
}
const VEC: Record<Dir, P> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const TAU = Math.PI * 2;

function points(s: SkinState): P[] {
  const c = s.size / s.cols;
  return s.snake.map((p, j) => {
    const a = s.prev[Math.min(j, s.prev.length - 1)] ?? p;
    return { x: (a.x + (p.x - a.x) * s.prog + .5) * c, y: (a.y + (p.y - a.y) * s.prog + .5) * c };
  });
}
function path(ctx: CanvasRenderingContext2D, pts: P[], dx = 0, dy = 0) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x + dx, p.y + dy) : ctx.moveTo(p.x + dx, p.y + dy)));
}
function stroke(ctx: CanvasRenderingContext2D, pts: P[], w: number, color: string, dx = 0, dy = 0) {
  if (pts.length < 2) return;
  path(ctx, pts, dx, dy);
  ctx.lineWidth = w; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
/** oczy: dwa kółka po bokach głowy, patrzą w stronę ruchu */
function eyes(ctx: CanvasRenderingContext2D, h: P, dir: Dir, c: number, white: string, pupil: string, dead: boolean, r = .13) {
  const v = VEC[dir], side = { x: -v.y, y: v.x };
  for (const k of [-1, 1]) {
    const ex = h.x + v.x * c * .14 + side.x * k * c * .2, ey = h.y + v.y * c * .14 + side.y * k * c * .2;
    if (dead) {
      ctx.strokeStyle = pupil; ctx.lineWidth = c * .07; ctx.lineCap = 'round';
      const q = c * .08; ctx.beginPath(); ctx.moveTo(ex - q, ey - q); ctx.lineTo(ex + q, ey + q); ctx.moveTo(ex + q, ey - q); ctx.lineTo(ex - q, ey + q); ctx.stroke();
      continue;
    }
    ctx.fillStyle = white; circle(ctx, ex, ey, c * r); ctx.fill();
    ctx.fillStyle = pupil; circle(ctx, ex + v.x * c * .05, ey + v.y * c * .05, c * r * .5); ctx.fill();
  }
}

// ---------------------------------------------------------------------------------------------- Warm: papier, tusz, naklejki
function warm(ctx: CanvasRenderingContext2D, s: SkinState) {
  const { size, cols, rows } = s, c = size / cols, ink = '#2b1a0d', over = s.phase === 'over';
  ctx.fillStyle = '#eedcbd'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#e5cfa7';
  for (let y = 0; y < rows; y++) for (let x = y % 2; x < cols; x += 2) ctx.fillRect(x * c, y * c, c, c);
  ctx.fillStyle = 'rgba(43,26,13,.22)';   // kropki w rogach kratek jak na papierze do notatek
  for (let y = 1; y < rows; y++) for (let x = 1; x < cols; x++) { circle(ctx, x * c, y * c, Math.max(1, c * .035)); ctx.fill(); }
  // jabłko: pomarańcza-naklejka z obrysem i twardym cieniem
  if (s.apple.x >= 0) {
    const pulse = 1 + Math.sin(s.t / 260) * .05, cx = (s.apple.x + .5) * c, cy = (s.apple.y + .54) * c, r = c * .36 * pulse;
    ctx.fillStyle = ink; circle(ctx, cx + c * .07, cy + c * .09, r + c * .05); ctx.fill();
    ctx.fillStyle = '#e8803a'; circle(ctx, cx, cy, r); ctx.fill();
    ctx.lineWidth = c * .06; ctx.strokeStyle = ink; ctx.stroke();
    ctx.fillStyle = '#f6c58a'; circle(ctx, cx - r * .35, cy - r * .35, r * .22); ctx.fill();
    ctx.fillStyle = '#5b7a3a'; ctx.beginPath(); ctx.ellipse(cx + r * .3, cy - r * 1.02, r * .42, r * .2, -.45, 0, TAU); ctx.fill(); ctx.lineWidth = c * .04; ctx.stroke();
  }
  const pts = points(s), n = pts.length;
  if (n) {
    stroke(ctx, pts, c * .86, ink, c * .08, c * .1);                 // cień
    stroke(ctx, pts, c * .86, ink);                                   // obrys
    stroke(ctx, pts, c * .64, over ? '#9a7a5a' : '#b5553a');          // ciało
    ctx.save(); ctx.setLineDash([0, c * .5]); stroke(ctx, pts, c * .16, '#f6e9d2'); ctx.restore();   // kropki na grzbiecie
    const h = pts[0];
    ctx.fillStyle = ink; circle(ctx, h.x, h.y, c * .5); ctx.fill();
    ctx.fillStyle = over ? '#a98a68' : '#c8633f'; circle(ctx, h.x, h.y, c * .42); ctx.fill();
    const v = VEC[s.dir], side = { x: -v.y, y: v.x };
    ctx.fillStyle = 'rgba(232,180,106,.75)';   // rumieńce
    for (const k of [-1, 1]) { circle(ctx, h.x - v.x * c * .08 + side.x * k * c * .3, h.y - v.y * c * .08 + side.y * k * c * .3, c * .07); ctx.fill(); }
    eyes(ctx, h, s.dir, c, '#f6e9d2', ink, over);
    if (!over && Math.floor(s.t / 700) % 3 === 0) {   // język
      ctx.strokeStyle = '#b5402a'; ctx.lineWidth = c * .06; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(h.x + v.x * c * .45, h.y + v.y * c * .45); ctx.lineTo(h.x + v.x * c * .7, h.y + v.y * c * .7); ctx.stroke();
    }
  }
  if (s.eatFx > 0) {   // pierścień po zjedzeniu
    const k = 1 - s.eatFx; ctx.strokeStyle = `rgba(43,26,13,${s.eatFx})`; ctx.lineWidth = c * .08;
    circle(ctx, (s.eatAt.x + .5) * c, (s.eatAt.y + .5) * c, c * (.4 + k * 1.1)); ctx.stroke();
  }
  if (over) { ctx.fillStyle = 'rgba(238,220,189,.55)'; ctx.fillRect(0, 0, size, size); }
}

// ---------------------------------------------------------------------------------------------- Aero: szklana rurka w basenie z bąbelkami
const bubbles = Array.from({ length: 14 }, (_, i) => ({ x: ((i * 37) % 100) / 100, o: ((i * 53) % 100) / 100, r: .12 + ((i * 29) % 10) / 40, sp: .04 + ((i * 17) % 10) / 160 }));
function aero(ctx: CanvasRenderingContext2D, s: SkinState) {
  const { size, cols, rows } = s, c = size / cols, over = s.phase === 'over';
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#7fd0f5'); g.addColorStop(.55, '#bfe9fb'); g.addColorStop(1, '#e9f9ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,.2)';
  for (let y = 0; y < rows; y++) for (let x = y % 2; x < cols; x += 2) ctx.fillRect(x * c, y * c, c, c);
  const ray = ctx.createRadialGradient(size * .8, -size * .1, 0, size * .8, -size * .1, size);   // promienie słońca z góry
  ray.addColorStop(0, 'rgba(255,255,255,.65)'); ray.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = ray; ctx.fillRect(0, 0, size, size);
  for (const b of bubbles) {   // bąbelki płyną w górę
    const y = (1 - ((s.t / 1000 * b.sp + b.o) % 1)) * size, x = (b.x + Math.sin(s.t / 1500 + b.o * 9) * .02) * size, r = c * b.r * 1.6;
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1, c * .04); circle(ctx, x, y, r); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.8)'; circle(ctx, x - r * .35, y - r * .35, r * .22); ctx.fill();
  }
  if (s.apple.x >= 0) {   // zielona kula z połyskiem
    const pulse = 1 + Math.sin(s.t / 240) * .06, cx = (s.apple.x + .5) * c, cy = (s.apple.y + .5) * c, r = c * .38 * pulse;
    ctx.save(); ctx.shadowColor = 'rgba(80,220,80,.8)'; ctx.shadowBlur = c * .5;
    const o = ctx.createRadialGradient(cx - r * .35, cy - r * .4, r * .1, cx, cy, r);
    o.addColorStop(0, '#e6ffa8'); o.addColorStop(.45, '#52c83c'); o.addColorStop(1, '#1b7d2c');
    ctx.fillStyle = o; circle(ctx, cx, cy, r); ctx.fill(); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.ellipse(cx - r * .3, cy - r * .45, r * .42, r * .2, -.5, 0, TAU); ctx.fill();
  }
  const pts = points(s), n = pts.length;
  if (n) {
    stroke(ctx, pts, c * .84, 'rgba(10,70,110,.28)', 0, c * .12);   // cień na dnie
    stroke(ctx, pts, c * .8, over ? '#6b8aa0' : '#0e6aa0');
    stroke(ctx, pts, c * .66, over ? '#9ab6c8' : '#2fb6f2');
    stroke(ctx, pts, c * .36, over ? '#cfe2ee' : '#9fe6ff', 0, -c * .1);
    stroke(ctx, pts, c * .1, 'rgba(255,255,255,.9)', -c * .03, -c * .2);
    const h = pts[0];
    ctx.save(); ctx.shadowColor = 'rgba(47,182,242,.8)'; ctx.shadowBlur = c * .35;
    const o = ctx.createRadialGradient(h.x - c * .15, h.y - c * .18, c * .05, h.x, h.y, c * .5);
    o.addColorStop(0, '#e9fbff'); o.addColorStop(.5, over ? '#9ab6c8' : '#37bdf5'); o.addColorStop(1, over ? '#4a6a80' : '#0a6aa6');
    ctx.fillStyle = o; circle(ctx, h.x, h.y, c * .48); ctx.fill(); ctx.restore();
    eyes(ctx, h, s.dir, c, '#fff', '#05324a', over, .13);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.ellipse(h.x - c * .12, h.y - c * .3, c * .2, c * .08, -.4, 0, TAU); ctx.fill();
  }
  if (s.eatFx > 0) { const k = 1 - s.eatFx; ctx.strokeStyle = `rgba(255,255,255,${s.eatFx})`; ctx.lineWidth = c * .1; circle(ctx, (s.eatAt.x + .5) * c, (s.eatAt.y + .5) * c, c * (.4 + k * 1.3)); ctx.stroke(); }
  if (over) { ctx.fillStyle = 'rgba(233,249,255,.5)'; ctx.fillRect(0, 0, size, size); }
}

// ---------------------------------------------------------------------------------------------- Vapor: neonowy wąż w siatce przed zachodem słońca
let scan: CanvasPattern | null = null;
function scanPattern(ctx: CanvasRenderingContext2D) {
  if (scan) return scan;
  const p = document.createElement('canvas'); p.width = 4; p.height = 4;
  const x = p.getContext('2d')!; x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(0, 2, 4, 1);
  scan = ctx.createPattern(p, 'repeat'); return scan;
}
function mix(a: number[], b: number[], k: number) { return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`; }
function vapor(ctx: CanvasRenderingContext2D, s: SkinState, canvas: HTMLCanvasElement) {
  const { size, cols, rows } = s, c = size / cols, over = s.phase === 'over';
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#12063a'); g.addColorStop(.6, '#2a0f66'); g.addColorStop(1, '#5b1aa6');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const sun = ctx.createLinearGradient(0, size * .18, 0, size * .62);   // słońce w paski za planszą
  sun.addColorStop(0, '#fffb96'); sun.addColorStop(1, '#ff71ce');
  ctx.save(); ctx.globalAlpha = .3; ctx.fillStyle = sun;
  circle(ctx, size / 2, size * .4, size * .22); ctx.clip();   // słońce przycięte do kółka i do pasów (dolne pasy coraz cieńsze)
  ctx.beginPath();
  let y = size * .18;
  for (let i = 0; i < 7; i++) { const lit = size * (.1 - i * .012), gap = size * (.004 + i * .006); ctx.rect(0, y, size, Math.max(lit, size * .006)); y += Math.max(lit, size * .006) + gap; }
  ctx.clip(); ctx.fillRect(0, 0, size, size);
  ctx.restore();
  ctx.strokeStyle = 'rgba(1,205,254,.2)'; ctx.lineWidth = Math.max(1, c * .03);
  ctx.beginPath(); for (let i = 0; i <= cols; i++) { ctx.moveTo(i * c, 0); ctx.lineTo(i * c, size); } for (let j = 0; j <= rows; j++) { ctx.moveTo(0, j * c); ctx.lineTo(size, j * c); } ctx.stroke();
  if (s.apple.x >= 0) {   // kryształ: obracający się romb z poświatą
    const cx = (s.apple.x + .5) * c, cy = (s.apple.y + .5) * c, r = c * .34 * (1 + Math.sin(s.t / 200) * .06), w = Math.abs(Math.cos(s.t / 500));
    ctx.save(); ctx.shadowColor = '#01cdfe'; ctx.shadowBlur = c * .7;
    ctx.fillStyle = '#fffb96'; ctx.beginPath(); ctx.moveTo(cx, cy - r * 1.2); ctx.lineTo(cx + r * Math.max(.25, w), cy); ctx.lineTo(cx, cy + r * 1.2); ctx.lineTo(cx - r * Math.max(.25, w), cy); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#01cdfe'; ctx.lineWidth = c * .05; ctx.stroke();
  }
  const pts = points(s), n = pts.length;
  if (n > 1) {
    const A = over ? [120, 100, 150] : [255, 113, 206], B = over ? [70, 60, 100] : [1, 205, 254];
    ctx.save(); ctx.lineCap = 'round';
    for (let i = n - 1; i > 0; i--) {
      const col = mix(A, B, i / (n - 1));
      ctx.shadowColor = col; ctx.shadowBlur = c * .6; ctx.strokeStyle = col; ctx.lineWidth = c * .62;
      ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i - 1].x, pts[i - 1].y); ctx.stroke();
    }
    ctx.shadowBlur = 0; stroke(ctx, pts, c * .16, 'rgba(255,255,255,.55)');   // żarzący się rdzeń
    ctx.restore();
  }
  if (n) {
    const h = pts[0], v = VEC[s.dir];
    ctx.save(); ctx.shadowColor = '#ff71ce'; ctx.shadowBlur = c * .8;
    ctx.fillStyle = over ? '#8a7aa8' : '#fff5fe'; ctx.beginPath(); ctx.roundRect(h.x - c * .42, h.y - c * .42, c * .84, c * .84, c * .24); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#1b0b33';   // wizjer
    const side = { x: -v.y, y: v.x };
    ctx.save(); ctx.translate(h.x + v.x * c * .1, h.y + v.y * c * .1); ctx.rotate(Math.atan2(side.y, side.x));
    ctx.fillRect(-c * .32, -c * .09, c * .64, c * .18);
    ctx.fillStyle = over ? '#8a7aa8' : '#ff71ce'; ctx.fillRect(-c * .2 + (v.x + v.y) * c * .08 * Math.sin(s.t / 120), -c * .04, c * .08, c * .08); ctx.restore();
  }
  if (s.eatFx > 0) { const k = 1 - s.eatFx; ctx.save(); ctx.shadowColor = '#01cdfe'; ctx.shadowBlur = c * .4; ctx.strokeStyle = `rgba(1,205,254,${s.eatFx})`; ctx.lineWidth = c * .08; circle(ctx, (s.eatAt.x + .5) * c, (s.eatAt.y + .5) * c, c * (.4 + k * 1.4)); ctx.stroke(); ctx.restore(); }
  const sp = scanPattern(ctx); if (sp) { ctx.fillStyle = sp; ctx.fillRect(0, 0, size, size); }
  if (over && (Math.floor(s.t / 90) % 3 !== 2)) {   // glitch po przegranej: przesunięte pasy obrazu
    for (let i = 0; i < 5; i++) {
      const y = Math.floor(((Math.sin(s.t / 70 + i * 3.1) + 1) / 2) * (size - c * 2)), h = Math.floor(c * (.4 + (i % 3) * .5)), dx = Math.round(Math.sin(s.t / 55 + i * 7) * c * .7);
      ctx.drawImage(canvas, 0, y, size, h, dx, y, size, h);
    }
  }
}

export function drawSkin(skin: Skin, ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, s: SkinState) {
  if (skin === 'warm') warm(ctx, s); else if (skin === 'aero') aero(ctx, s); else vapor(ctx, s, canvas);
}
