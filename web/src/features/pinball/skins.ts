// Pinball w motywach: Warm (papier i tusz), Aero (szkło, woda, bąbelki), Vapor (zachód słońca, szachownica, marmurowa głowa).
// Motyw domyślny (i Y2K) zostaje neonowym synthwave z engine.ts. Skórka podmienia kolory palety poziomu oraz rysowanie tła,
// kresek, łap, kulki, bumperów, lampek i napisów; fizyka i zasady (core.ts) są te same, więc wynik sprawdzany przez serwer się nie zmienia.
import heliosUrl from '../../styles/vapor/helios.webp';

export type SkinId = 'warm' | 'aero' | 'vapor';
type Ctx = CanvasRenderingContext2D;
export interface SkinEnv {
  W: number; H: number; AXIS: number; HORIZON: number; k: number; saucer: { x: number; y: number };
  tablePath(c: Ctx): void; rng(seed: number): () => number; levelId: number;
}
export interface SkinLamp { x: number; y: number; label: string; color: string; on: boolean; shape: 'dot' | 'arrow' | 'tag' }
export interface PinSkin {
  id: SkinId;
  pal: Record<string, string>;
  /** tło rysowane raz do osobnej warstwy (wewnątrz obrysu stołu) */
  bg(c: Ctx, e: SkinEnv, onLoad: () => void): void;
  /** kreska ściany / prowadnicy; null = domyślna neonowa */
  stroke: ((c: Ctx, color: string, width: number, blur: number, core: number, k: number) => void) | null;
  flipper: ((c: Ctx, x: number, y: number, ang: number, len: number, r0: number, r1: number, on: boolean, k: number, pal: Record<string, string>) => void) | null;
  ball: ((c: Ctx, x: number, y: number, r: number, trail: { x: number; y: number }[], k: number) => void) | null;
  bumper: ((c: Ctx, x: number, y: number, r: number, flash: number, col: string, k: number) => void) | null;
  lamp: ((c: Ctx, l: SkinLamp, k: number) => void) | null;
  text: ((c: Ctx, text: string, x: number, y: number, size: number, color: string, alpha: number, k: number) => void) | null;
  title: ((c: Ctx, title: string, tagline: string, x: number, y: number, pal: Record<string, string>, k: number) => void) | null;
  msgBg: string; apronA: string; apronB: string; dark: string;
  /** iskry: 'lighter' świeci na ciemnym, na jasnym tle trzeba zwykłego rysowania */
  sparkComp: GlobalCompositeOperation;
  grid: boolean;
}

const TAU = Math.PI * 2;
const SERIF = '"Newsreader", Georgia, "Times New Roman", serif';
const SANS = '"Hanken Grotesk", "Segoe UI", system-ui, sans-serif';
const circ = (c: Ctx, x: number, y: number, r: number) => { c.beginPath(); c.arc(x, y, r, 0, TAU); };

function flipperPath(c: Ctx, x: number, y: number, ang: number, len: number, r0: number, r1: number) {
  const ca = Math.cos(ang), sa = Math.sin(ang), nx = -sa, ny = ca, tx = x + ca * len, ty = y + sa * len;
  c.beginPath();
  c.arc(x, y, r0, ang + Math.PI / 2, ang - Math.PI / 2);
  c.lineTo(tx - nx * r1, ty - ny * r1);
  c.arc(tx, ty, r1, ang - Math.PI / 2, ang + Math.PI / 2);
  c.closePath();
  return { nx, ny };
}

// ====================================================================================================== Warm
const INK = '#2b1a0d';
export const warmSkin: PinSkin = {
  id: 'warm',
  pal: { cyan: '#5b7a3a', pink: '#b5553a', magenta: '#9a3f2a', purple: '#8a5a22', yellow: '#e8b46a', orange: '#d9822f', blue: '#4a7a8a' },
  bg(c, e) {
    c.fillStyle = INK; c.fillRect(0, 0, e.W, e.H);
    c.save(); e.tablePath(c); c.clip();
    c.fillStyle = '#eedcbd'; c.fillRect(0, 0, e.W, e.H);
    // słońce jak z papierowego wycinanka: koncentryczne kręgi wokół tarczy
    const { x, y } = e.saucer;
    [150, 118, 88].forEach((r, i) => { c.fillStyle = ['#e9c98f', '#e8b46a', '#e39a55'][i]; circ(c, x, y, r); c.fill(); });
    c.strokeStyle = 'rgba(43,26,13,.35)'; c.lineWidth = 1.5;
    for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; c.beginPath(); c.moveTo(x + Math.cos(a) * 156, y + Math.sin(a) * 156); c.lineTo(x + Math.cos(a) * 176, y + Math.sin(a) * 176); c.stroke(); }
    // kropki jak w zeszycie
    c.fillStyle = 'rgba(43,26,13,.22)';
    for (let yy = 16; yy < e.H; yy += 26) for (let xx = 16; xx < e.W; xx += 26) { circ(c, xx, yy, 1.4); c.fill(); }
    // pastelowe plamy
    const rnd = e.rng(e.levelId * 311 + 7);
    for (let i = 0; i < 7; i++) { c.fillStyle = ['rgba(181,85,58,.12)', 'rgba(91,122,58,.14)', 'rgba(232,180,106,.2)'][i % 3]; circ(c, rnd() * e.W, 80 + rnd() * (e.H - 260), 24 + rnd() * 34); c.fill(); }
    const g = c.createLinearGradient(0, e.H - 260, 0, e.H); g.addColorStop(0, 'rgba(43,26,13,0)'); g.addColorStop(1, 'rgba(43,26,13,.28)');
    c.fillStyle = g; c.fillRect(0, e.H - 260, e.W, 260);
    c.restore();
  },
  stroke(c, color, width, _blur, core) {
    c.save(); c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = INK; c.lineWidth = width + 3.4; c.stroke();
    c.strokeStyle = color; c.lineWidth = width; c.stroke();
    if (core > 0) { c.strokeStyle = 'rgba(246,233,210,.7)'; c.lineWidth = Math.max(1, width * core * .6); c.stroke(); }
    c.restore();
  },
  flipper(c, x, y, ang, len, r0, r1, on, _k, pal) {
    c.save();
    c.translate(2.5, 3.5); flipperPath(c, x, y, ang, len, r0, r1); c.fillStyle = INK; c.fill(); c.translate(-2.5, -3.5);
    const { nx, ny } = flipperPath(c, x, y, ang, len, r0, r1);
    const g = c.createLinearGradient(x - nx * r0, y - ny * r0, x + nx * r0, y + ny * r0);
    g.addColorStop(0, on ? '#f0a070' : '#d98a62'); g.addColorStop(1, pal.pink);
    c.fillStyle = g; c.fill(); c.lineWidth = 2.6; c.strokeStyle = INK; c.stroke();
    c.beginPath(); c.moveTo(x + Math.cos(ang) * r0 * .5 - nx * r0 * .35, y + Math.sin(ang) * r0 * .5 - ny * r0 * .35); c.lineTo(x + Math.cos(ang) * len * .8 - nx * r1 * .35, y + Math.sin(ang) * len * .8 - ny * r1 * .35);
    c.strokeStyle = 'rgba(246,233,210,.75)'; c.lineWidth = 2; c.lineCap = 'round'; c.stroke();
    circ(c, x, y, 4.5); c.fillStyle = '#f6e9d2'; c.fill(); c.lineWidth = 1.6; c.strokeStyle = INK; c.stroke();
    c.restore();
  },
  ball(c, x, y, r, trail) {
    c.save();
    trail.forEach((p, i) => { circ(c, p.x, p.y, r * (.35 + i / trail.length * .5)); c.fillStyle = `rgba(43,26,13,${(i / trail.length) * .16})`; c.fill(); });
    circ(c, x + 1.8, y + 2.6, r); c.fillStyle = 'rgba(43,26,13,.5)'; c.fill();
    const g = c.createRadialGradient(x - 3, y - 4, 1, x, y, r);
    g.addColorStop(0, '#fffaf0'); g.addColorStop(.45, '#d9c9aa'); g.addColorStop(1, '#8a7050');
    circ(c, x, y, r); c.fillStyle = g; c.fill(); c.lineWidth = 1.8; c.strokeStyle = INK; c.stroke();
    c.restore();
  },
  bumper(c, x, y, r, flash, col) {
    c.save();
    circ(c, x + 3, y + 4.5, r + 2); c.fillStyle = INK; c.fill();
    circ(c, x, y, r + 1); c.fillStyle = flash > 0 ? '#e8b46a' : col; c.fill(); c.lineWidth = 3; c.strokeStyle = INK; c.stroke();
    circ(c, x, y, r - 7); c.fillStyle = flash > 0 ? '#fff4d8' : '#f6e9d2'; c.fill(); c.lineWidth = 2; c.stroke();
    circ(c, x, y, r - 15 > 3 ? r - 15 : 3); c.fillStyle = flash > 0 ? '#d9822f' : col; c.fill();
    if (flash > 0) { c.globalAlpha = flash; circ(c, x, y, r + (1 - flash) * 20); c.lineWidth = 3; c.strokeStyle = INK; c.stroke(); }
    c.restore();
  },
  lamp(c, l) {
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
    const on = l.on, fill = on ? l.color : '#e3cba3', line = on ? INK : 'rgba(43,26,13,.45)', txt = on ? INK : 'rgba(43,26,13,.5)';
    if (l.shape === 'dot') {
      circ(c, l.x, l.y, 9); c.fillStyle = fill; c.fill(); c.lineWidth = 2; c.strokeStyle = line; c.stroke();
      c.font = `800 10px ${SANS}`; c.fillStyle = txt; c.fillText(l.label, l.x, l.y + .5);
    } else if (l.shape === 'tag') {
      c.font = `800 10px ${SANS}`; const w = c.measureText(l.label).width + 12;
      c.beginPath(); c.roundRect(l.x - w / 2, l.y - 8, w, 16, 5); c.fillStyle = fill; c.fill(); c.lineWidth = 1.8; c.strokeStyle = line; c.stroke();
      c.fillStyle = txt; c.fillText(l.label, l.x, l.y + .5);
    } else {
      c.beginPath(); c.moveTo(l.x, l.y - 22); c.lineTo(l.x + 16, l.y - 4); c.lineTo(l.x - 16, l.y - 4); c.closePath();
      c.fillStyle = fill; c.fill(); c.lineWidth = 1.8; c.strokeStyle = line; c.stroke();
      c.font = `800 9px ${SANS}`; c.fillStyle = on ? INK : 'rgba(43,26,13,.55)'; c.fillText(l.label, l.x, l.y + 8);
    }
    c.restore();
  },
  text(c, text, x, y, size, color, alpha) {
    c.save(); c.globalAlpha = alpha; c.font = `italic 700 ${size}px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = Math.max(3, size / 6); c.strokeStyle = INK; c.strokeText(text, x, y);
    c.fillStyle = '#f6e9d2'; c.fillText(text, x, y);
    c.restore(); void color;
  },
  title(c, title, tagline, x, y) {
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `italic 600 40px ${SERIF}`; c.fillStyle = 'rgba(43,26,13,.9)'; c.fillText(title, x + 2, y + 3);
    c.fillStyle = '#b5553a'; c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = INK; c.strokeText(title, x, y); c.fillText(title, x, y);
    c.font = `600 9px ${SANS}`; c.fillStyle = INK; c.fillText(tagline, x, y + 25);
    c.restore();
  },
  msgBg: 'rgba(43,26,13,.88)', apronA: '#4a2a14', apronB: '#25140a', dark: '#2b1a0d', sparkComp: 'source-over', grid: false,
};

// ====================================================================================================== Aero
const SKY_D = '#06304d';
export const aeroSkin: PinSkin = {
  id: 'aero',
  pal: { cyan: '#1aa7e8', pink: '#2fc95a', magenta: '#0a7fd0', purple: '#3a70e0', yellow: '#ffd84a', orange: '#ff9a2e', blue: '#0b5fa5' },
  bg(c, e) {
    c.fillStyle = SKY_D; c.fillRect(0, 0, e.W, e.H);
    c.save(); e.tablePath(c); c.clip();
    const g = c.createLinearGradient(0, 0, 0, e.H);
    g.addColorStop(0, '#6ec6f3'); g.addColorStop(.28, '#b9e8fb'); g.addColorStop(.46, '#e6f8ff'); g.addColorStop(.5, '#58c2ee'); g.addColorStop(.78, '#1a86c4'); g.addColorStop(1, '#0a4f80');
    c.fillStyle = g; c.fillRect(0, 0, e.W, e.H);
    const rnd = e.rng(e.levelId * 131 + 3);
    // chmury
    c.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 5; i++) { const cx = 30 + rnd() * (e.W - 60), cy = 40 + rnd() * (e.H * .36); for (let j = 0; j < 4; j++) { c.beginPath(); c.ellipse(cx + j * 22 - 33, cy + (j % 2) * 5, 26 + rnd() * 10, 13 + rnd() * 5, 0, 0, TAU); c.fill(); } }
    // promienie słońca z rogu
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) { const a = .25 + i * .13; c.fillStyle = 'rgba(255,255,255,.09)'; c.beginPath(); c.moveTo(e.W + 20, -20); c.lineTo(e.W - Math.sin(a) * e.H * 1.2, Math.cos(a) * e.H * 1.2); c.lineTo(e.W - Math.sin(a + .05) * e.H * 1.2, Math.cos(a + .05) * e.H * 1.2); c.closePath(); c.fill(); }
    c.restore();
    // fale na wodzie
    c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 1.6;
    for (let i = 0; i < 22; i++) { const x0 = rnd() * e.W, y0 = e.H * .52 + rnd() * (e.H * .46), w = 24 + rnd() * 40; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x0 + w / 2, y0 - 6, x0 + w, y0); c.stroke(); }
    // bąbelki
    for (let i = 0; i < 26; i++) {
      const bx = rnd() * e.W, by = e.H * .1 + rnd() * e.H * .88, br = 4 + rnd() * 16;
      c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.4; circ(c, bx, by, br); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.14)'; c.fill();
      c.fillStyle = 'rgba(255,255,255,.75)'; circ(c, bx - br * .35, by - br * .38, br * .2); c.fill();
    }
    c.restore();
  },
  stroke(c, color, width, blur, core, k) {
    c.save(); c.lineCap = c.lineJoin = 'round';
    c.strokeStyle = 'rgba(6,48,77,.6)'; c.lineWidth = width + 2.6; c.stroke();
    c.strokeStyle = color; c.lineWidth = width; c.shadowColor = color; c.shadowBlur = Math.min(blur, 8) * k * .5; c.stroke();
    c.shadowBlur = 0;
    if (core > 0) { c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = Math.max(1, width * core * .7); c.translate(0, -width * .12); c.stroke(); }
    c.restore();
  },
  flipper(c, x, y, ang, len, r0, r1, on, k, pal) {
    c.save();
    const { nx, ny } = flipperPath(c, x, y, ang, len, r0, r1);
    const g = c.createLinearGradient(x - nx * r0, y - ny * r0, x + nx * r0, y + ny * r0);
    g.addColorStop(0, '#e6fbff'); g.addColorStop(.48, on ? '#6fe0ff' : '#3cbcf2'); g.addColorStop(.52, pal.blue); g.addColorStop(1, '#0a4f80');
    c.fillStyle = g; c.shadowColor = '#37bdf5'; c.shadowBlur = (on ? 18 : 8) * k; c.fill();
    c.shadowBlur = 0; c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,.95)'; c.stroke();
    c.beginPath(); c.moveTo(x + Math.cos(ang) * r0 * .6 - nx * r0 * .55, y + Math.sin(ang) * r0 * .6 - ny * r0 * .55); c.lineTo(x + Math.cos(ang) * len * .82 - nx * r1 * .5, y + Math.sin(ang) * len * .82 - ny * r1 * .5);
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2.4; c.lineCap = 'round'; c.stroke();
    circ(c, x, y, 4.5); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.4; c.strokeStyle = pal.blue; c.stroke();
    c.restore();
  },
  ball(c, x, y, r, trail, k) {
    c.save();
    trail.forEach((p, i) => { circ(c, p.x, p.y, r * (.4 + i / trail.length * .5)); c.fillStyle = `rgba(255,255,255,${(i / trail.length) * .3})`; c.fill(); });
    const g = c.createRadialGradient(x - 3, y - 4, 1, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.4, '#cdeeff'); g.addColorStop(.8, '#4a9fd0'); g.addColorStop(1, '#0e5a8f');
    c.shadowColor = 'rgba(6,48,77,.6)'; c.shadowBlur = 8 * k; circ(c, x, y, r); c.fillStyle = g; c.fill(); c.shadowBlur = 0;
    c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.9)'; c.beginPath(); c.ellipse(x - r * .3, y - r * .45, r * .42, r * .2, -.5, 0, TAU); c.fill();
    c.restore();
  },
  bumper(c, x, y, r, flash, col, k) {
    c.save();
    circ(c, x, y + 4, r + 2); c.fillStyle = 'rgba(6,48,77,.4)'; c.fill();
    const g = c.createRadialGradient(x - r * .35, y - r * .4, 2, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.35, flash > 0 ? '#fff6a8' : '#bff0d0'); g.addColorStop(.7, flash > 0 ? '#ffd84a' : col); g.addColorStop(1, '#0a4f80');
    c.shadowColor = flash > 0 ? '#ffd84a' : col; c.shadowBlur = (10 + flash * 26) * k; circ(c, x, y, r); c.fillStyle = g; c.fill(); c.shadowBlur = 0;
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.ellipse(x - r * .25, y - r * .45, r * .5, r * .22, -.4, 0, TAU); c.fill();
    if (flash > 0) { c.globalAlpha = flash; circ(c, x, y, r + (1 - flash) * 22); c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); }
    c.restore();
  },
  lamp(c, l, k) {
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
    const on = l.on, base = on ? l.color : 'rgba(255,255,255,.35)';
    if (on) { c.shadowColor = l.color; c.shadowBlur = 12 * k; }
    if (l.shape === 'dot') {
      const g = c.createRadialGradient(l.x - 3, l.y - 3, 1, l.x, l.y, 10); g.addColorStop(0, '#fff'); g.addColorStop(.5, base); g.addColorStop(1, on ? '#0a6aa6' : 'rgba(6,48,77,.5)');
      circ(c, l.x, l.y, 9); c.fillStyle = g; c.fill(); c.shadowBlur = 0; c.lineWidth = 1.5; c.strokeStyle = on ? '#fff' : 'rgba(6,48,77,.5)'; c.stroke();
      c.font = `800 10px ${SANS}`; c.fillStyle = on ? SKY_D : 'rgba(6,48,77,.7)'; c.fillText(l.label, l.x, l.y + .5);
    } else if (l.shape === 'tag') {
      c.font = `800 10px ${SANS}`; const w = c.measureText(l.label).width + 12;
      c.beginPath(); c.roundRect(l.x - w / 2, l.y - 8, w, 16, 8); c.fillStyle = on ? l.color : 'rgba(255,255,255,.4)'; c.fill(); c.shadowBlur = 0; c.lineWidth = 1.3; c.strokeStyle = on ? '#fff' : 'rgba(6,48,77,.4)'; c.stroke();
      c.fillStyle = on ? SKY_D : 'rgba(6,48,77,.65)'; c.fillText(l.label, l.x, l.y + .5);
    } else {
      c.beginPath(); c.moveTo(l.x, l.y - 22); c.lineTo(l.x + 16, l.y - 4); c.lineTo(l.x - 16, l.y - 4); c.closePath();
      c.fillStyle = on ? l.color : 'rgba(255,255,255,.4)'; c.fill(); c.shadowBlur = 0; c.lineWidth = 1.4; c.strokeStyle = on ? '#fff' : 'rgba(6,48,77,.4)'; c.stroke();
      c.font = `800 9px ${SANS}`; c.fillStyle = on ? '#fff' : 'rgba(6,48,77,.7)'; c.strokeStyle = 'rgba(6,48,77,.7)'; c.lineWidth = 2; c.strokeText(l.label, l.x, l.y + 8); c.fillText(l.label, l.x, l.y + 8);
    }
    c.restore();
  },
  text(c, text, x, y, size, color, alpha, k) {
    c.save(); c.globalAlpha = alpha; c.font = `800 ${size}px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    c.shadowColor = 'rgba(6,48,77,.6)'; c.shadowBlur = 8 * k; c.lineWidth = Math.max(3, size / 5); c.strokeStyle = '#0b5fa5'; c.strokeText(text, x, y);
    c.shadowBlur = 0; c.fillStyle = '#fff'; c.fillText(text, x, y); void color;
    c.restore();
  },
  title(c, title, tagline, x, y, _pal, k) {
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    c.font = `800 38px ${SANS}`;
    c.shadowColor = 'rgba(6,48,77,.7)'; c.shadowBlur = 6 * k; c.lineWidth = 6; c.strokeStyle = '#0b5fa5'; c.strokeText(title, x, y);
    c.shadowBlur = 0; const g = c.createLinearGradient(0, y - 18, 0, y + 18); g.addColorStop(0, '#fff'); g.addColorStop(.5, '#e6f8ff'); g.addColorStop(.52, '#9fe0ff'); g.addColorStop(1, '#e6f8ff');
    c.fillStyle = g; c.fillText(title, x, y);
    c.font = `700 9px ${SANS}`; c.fillStyle = '#fff'; c.strokeStyle = 'rgba(6,48,77,.7)'; c.lineWidth = 2.4; c.strokeText(tagline, x, y + 26); c.fillText(tagline, x, y + 26);
    c.restore();
  },
  msgBg: 'rgba(6,48,77,.72)', apronA: '#0b4f7a', apronB: '#06304d', dark: '#06304d', sparkComp: 'lighter', grid: false,
};

// ====================================================================================================== Vapor
let helios: HTMLImageElement | null = null;
export const vaporSkin: PinSkin = {
  id: 'vapor',
  pal: { cyan: '#01cdfe', pink: '#ff71ce', magenta: '#ff2fa8', purple: '#b967ff', yellow: '#fffb96', orange: '#ff9e5e', blue: '#6a7bff' },
  bg(c, e, onLoad) {
    if (!helios) { helios = new Image(); helios.onload = onLoad; helios.src = heliosUrl; }
    c.fillStyle = '#05010c'; c.fillRect(0, 0, e.W, e.H);
    c.save(); e.tablePath(c); c.clip();
    const g = c.createLinearGradient(0, 0, 0, e.H);
    g.addColorStop(0, '#12063a'); g.addColorStop(.3, '#4b1a8f'); g.addColorStop(e.HORIZON / e.H - .02, '#ff71ce'); g.addColorStop(e.HORIZON / e.H, '#1b0b33'); g.addColorStop(1, '#0a0220');
    c.fillStyle = g; c.fillRect(0, 0, e.W, e.H);
    const rnd = e.rng(1991);
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(255,255,255,${.2 + rnd() * .6})`; const s0 = rnd() * 1.4 + .3; c.fillRect(rnd() * e.W, rnd() * (e.HORIZON - 120), s0, s0); }
    // słońce w paski
    const sun = document.createElement('canvas'); sun.width = sun.height = Math.ceil(240 * e.k);
    const s = sun.getContext('2d')!; s.setTransform(e.k, 0, 0, e.k, 0, 0);
    const sg = s.createLinearGradient(0, 10, 0, 230); sg.addColorStop(0, '#fffb96'); sg.addColorStop(.5, '#ff9e5e'); sg.addColorStop(1, '#ff2fa8');
    s.fillStyle = sg; circ(s, 120, 120, 110); s.fill(); s.globalCompositeOperation = 'destination-out';
    for (let i = 0, y = 128; y < 240; i++) { const h = 2 + i * 1.4; s.fillRect(0, y, 240, h); y += h + 9 - i * .6; }
    c.save(); c.beginPath(); c.rect(0, 0, e.W, e.HORIZON); c.clip(); c.drawImage(sun, e.AXIS - 120, e.HORIZON - 190, 240, 240); c.restore();
    // marmurowa głowa przed słońcem
    if (helios.complete && helios.naturalWidth) {
      const hh = 250, ww = hh * helios.naturalWidth / helios.naturalHeight;
      c.save(); c.beginPath(); c.rect(0, 0, e.W, e.HORIZON + 4); c.clip(); c.globalAlpha = .55;
      c.drawImage(helios, e.AXIS - ww / 2, e.HORIZON - hh + 6, ww, hh); c.restore();
    }
    // szachownica w perspektywie
    c.save(); c.beginPath(); c.rect(0, e.HORIZON, e.W, e.H - e.HORIZON); c.clip();
    const rows = 14;
    for (let j = 0; j < rows; j++) {
      const t0 = j / rows, t1 = (j + 1) / rows, y0 = e.HORIZON + (e.H - e.HORIZON) * t0 * t0, y1 = e.HORIZON + (e.H - e.HORIZON) * t1 * t1;
      for (let i = -12; i < 12; i++) {
        if ((i + j) % 2) continue;
        const xa0 = e.AXIS + i * 5 + (i * 57) * t0 * t0, xb0 = e.AXIS + (i + 1) * 5 + ((i + 1) * 57) * t0 * t0;
        const xa1 = e.AXIS + i * 5 + (i * 57) * t1 * t1, xb1 = e.AXIS + (i + 1) * 5 + ((i + 1) * 57) * t1 * t1;
        c.fillStyle = 'rgba(1,205,254,.2)'; c.beginPath(); c.moveTo(xa0, y0); c.lineTo(xb0, y0); c.lineTo(xb1, y1); c.lineTo(xa1, y1); c.closePath(); c.fill();
      }
    }
    c.restore();
    c.restore();
  },
  stroke: null, flipper: null, ball: null, bumper: null, lamp: null, title: null,
  text: null,
  msgBg: 'rgba(18,6,58,.72)', apronA: '#3a0f8a', apronB: '#12063a', dark: '#12001c', sparkComp: 'lighter', grid: true,
};

export const SKINS: Record<SkinId, PinSkin> = { warm: warmSkin, aero: aeroSkin, vapor: vaporSkin };
