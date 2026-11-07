// Strzelnica (zakładka Gry -> Strzelnica): rysowanie, dźwięk i sterowanie. Zasady liczy core.ts (ten sam kod w Rust sprawdza
// wynik na serwerze: przeglądarka zapisuje strzały jako (tick, x, y), serwer odtwarza rundę i sam liczy punkty).
// Klimat: jarmarczna strzelnica nocą - namiot w pasy, żarówki, drewniana ścianka z trzema szynami i blaszane kaczki.
import { Sound } from '../../sound/sound';
import { AH, AW, COOLDOWN, ROUND_TICKS, ROWS, Sim, TICK, type Duck, type Fx } from './core';

export type AimHud = { phase: 'attract' | 'play' | 'over'; score: number; hits: number; shots: number; streak: number; mult: number; left: number; best: number };
/** Zapis rundy do sprawdzenia przez serwer: ziarno od serwera i strzały po trzy liczby (tick, x, y) */
export type AimRun = { seed: number; log: number[]; verified: boolean };
export type AimGame = { start(): void; resize(): void; destroy(): void; getRun(): AimRun | null; state(): { score: number; hits: number; shots: number; tick: number; phase: string } };
export type AimOptions = {
  /** Wołane przy starcie rundy: ziarno od serwera (runda od razu po tym) albo null = gra bez weryfikacji i bez rankingu */
  begin?: () => Promise<number | null>;
};

type Fall = { x: number; y: number; vx: number; vy: number; r: number; dir: number; rot: number; spin: number; gold: boolean; life: number };
type Pop = { x: number; y: number; text: string; life: number; color: string };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Hole = { x: number; y: number; life: number };

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const FONT = '"Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif';
const TENT = 92;       // wysokość daszku namiotu

export function createAim(canvas: HTMLCanvasElement, onHud: (h: AimHud) => void, opts: AimOptions = {}): AimGame {
  const ctx = canvas.getContext('2d')!;
  let k = 1;
  let bg: HTMLCanvasElement;
  let best = 0;
  try { best = +(localStorage.getItem('aimBest') ?? 0) || 0; } catch { /* prywatne okno */ }

  // ---------- efekty (nie wpływają na wynik) ----------
  const falls: Fall[] = [], pops: Pop[] = [], sparks: Spark[] = [], holes: Hole[] = [];
  let flash = 0, shake = 0, time = 0, kick = 0;
  let msg: { text: string; sub: string; t: number; dur: number } | null = null;
  const cursor = { x: AW / 2, y: AH / 2, in: false };

  function burst(x: number, y: number, color: string, n: number, speed: number) {
    if (reduced()) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0, max: 0.35 + Math.random() * 0.4, color, size: 1.5 + Math.random() * 2.5 });
    }
  }
  const fx: Fx = {
    shot: () => { flash = 1; kick = 1; Sound.pin('shot'); },
    hit: (d: Duck, points, mult) => {
      falls.push({ x: d.x, y: d.y, vx: d.dir * d.v * 0.6, vy: -170, r: d.r, dir: d.dir, rot: 0, spin: (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 4), gold: d.gold, life: 1 });
      pops.push({ x: d.x, y: d.y - d.r, text: `+${points}${mult > 1 ? ` x${mult}` : ''}`, life: 1.1, color: d.gold ? '#ffd319' : '#ffffff' });
      burst(d.x, d.y, d.gold ? '#ffe066' : '#ffd1a0', d.gold ? 26 : 12, 260);
      if (!reduced()) shake = Math.max(shake, d.gold ? 7 : 3);
      Sound.pin(d.gold ? 'goldduck' : 'clang', 0.9 + Math.min(0.6, mult * 0.12));
    },
    miss: (x, y) => { holes.push({ x, y, life: 1 }); Sound.pin('miss'); },
    over: score => {
      const record = score > best;
      if (record) { best = score; try { localStorage.setItem('aimBest', String(best)); } catch { /* bez zapisu */ } }
      msg = { text: record ? 'NOWY REKORD' : 'KONIEC RUNDY', sub: `${score.toLocaleString('pl-PL')} pkt`, t: 0, dur: 99 };
      Sound.pin('over');
    },
  };

  // ---------- gra ----------
  let sim = new Sim(0, fx);
  let run: AimRun | null = null;
  let starting = false, destroyed = false;

  async function start() {
    if (sim.phase === 'play' || starting) return;
    starting = true;
    Sound.unlock();
    msg = { text: 'ŁĄCZĘ…', sub: '', t: 0, dur: 8 };
    let seed: number | null = null;
    try { seed = opts.begin ? await opts.begin() : null; } catch { seed = null; }
    starting = false;
    if (destroyed) return;
    msg = null;
    const verified = seed !== null;
    const s = (seed ?? Math.floor(Math.random() * 4294967296)) >>> 0;
    sim = new Sim(s, fx);
    run = { seed: s, log: [], verified };
    falls.length = 0; pops.length = 0; sparks.length = 0; holes.length = 0;
    sim.start();
    msg = { text: 'STRZELAJ!', sub: 'celuj w kaczki, seria trafień mnoży punkty', t: 0, dur: 2.2 };
    Sound.pin('start');
  }

  function fire(x: number, y: number) {
    if (sim.phase !== 'play' || !run || sim.tick - sim.lastShot < COOLDOWN) return;
    const sx = Math.max(0, Math.min(AW, Math.round(x))), sy = Math.max(0, Math.min(AH, Math.round(y)));
    run.log.push(sim.tick, sx, sy);
    sim.shoot(sx, sy);
  }

  // ---------- HUD ----------
  let hudSig = '';
  function hud() {
    const left = Math.max(0, Math.ceil((ROUND_TICKS - sim.tick) * TICK));
    const h: AimHud = { phase: sim.phase, score: sim.score, hits: sim.hits, shots: sim.shots, streak: sim.streak, mult: sim.mult, left: sim.phase === 'attract' ? ROUND_TICKS * TICK : left, best };
    const sig = JSON.stringify(h);
    if (sig !== hudSig) { hudSig = sig; onHud(h); }
  }

  // ---------- rysowanie ----------
  function layer() { const cv = document.createElement('canvas'); cv.width = canvas.width; cv.height = canvas.height; const c = cv.getContext('2d')!; c.setTransform(k, 0, 0, k, 0, 0); return [cv, c] as const; }

  function drawBg() {
    const [cv, c] = layer();
    const sky = c.createLinearGradient(0, 0, 0, AH);
    sky.addColorStop(0, '#0b0a2a'); sky.addColorStop(0.5, '#2a1050'); sky.addColorStop(1, '#4a1a3a');
    c.fillStyle = sky; c.fillRect(0, 0, AW, AH);
    // ścianka z desek
    const wall = c.createLinearGradient(0, TENT, 0, AH);
    wall.addColorStop(0, '#3a2414'); wall.addColorStop(1, '#241408');
    c.fillStyle = wall; c.fillRect(0, TENT - 6, AW, AH);
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2;
    for (let y = TENT + 20; y < AH; y += 34) { c.beginPath(); c.moveTo(0, y); c.lineTo(AW, y); c.stroke(); }
    for (let x = 0; x < AW; x += 100) for (let y = TENT; y < AH; y += 68) { c.beginPath(); c.moveTo(x + ((y / 68) % 2) * 50, y); c.lineTo(x + ((y / 68) % 2) * 50, y + 34); c.stroke(); }
    // półki-szyny pod kaczkami
    ROWS.forEach(R => {
      const y = R.y + R.r * 0.9;
      const g = c.createLinearGradient(0, y, 0, y + 14);
      g.addColorStop(0, '#c58a4a'); g.addColorStop(1, '#6b4220');
      c.fillStyle = g; c.fillRect(0, y, AW, 14);
      c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(0, y, AW, 2);
      c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, y + 14, AW, 6);
    });
    // daszek namiotu: pasy i falbanka
    const stripes = 14, sw = AW / stripes;
    for (let i = 0; i < stripes; i++) {
      c.fillStyle = i % 2 ? '#f4ead2' : '#d6283a';
      c.beginPath(); c.moveTo(i * sw, 0); c.lineTo((i + 1) * sw, 0); c.lineTo((i + 1) * sw, TENT - 18); c.arc((i + 0.5) * sw, TENT - 18, sw / 2, 0, Math.PI); c.closePath(); c.fill();
    }
    const shade = c.createLinearGradient(0, 0, 0, TENT);
    shade.addColorStop(0, 'rgba(0,0,0,.45)'); shade.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = shade; c.fillRect(0, 0, AW, TENT);
    // lada
    const bar = c.createLinearGradient(0, AH - 56, 0, AH);
    bar.addColorStop(0, '#8a5a2e'); bar.addColorStop(1, '#3a2210');
    c.fillStyle = bar; c.fillRect(0, AH - 56, AW, 56);
    c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(0, AH - 56, AW, 3);
    for (let i = 0; i < 20; i++) { c.fillStyle = i % 2 ? '#f4ead2' : '#d6283a'; c.beginPath(); c.moveTo(i * 40, AH - 53); c.lineTo(i * 40 + 40, AH - 53); c.lineTo(i * 40 + 20, AH - 24); c.closePath(); c.fill(); }
    bg = cv;
  }

  function drawDuck(c: CanvasRenderingContext2D, x: number, y: number, r: number, dir: number, gold: boolean, t: number) {
    c.save();
    c.translate(x, y + Math.sin(t * 6 + x * 0.02) * 1.6); c.scale(dir, 1);
    const body = c.createLinearGradient(0, -r, 0, r);
    if (gold) { body.addColorStop(0, '#fff2a8'); body.addColorStop(0.5, '#ffc61a'); body.addColorStop(1, '#b97a00'); } else { body.addColorStop(0, '#fff09a'); body.addColorStop(0.55, '#ffd23a'); body.addColorStop(1, '#d99a12'); }
    if (gold) { c.shadowColor = '#ffd319'; c.shadowBlur = 16 * k; }
    // ciało i głowa
    c.fillStyle = body; c.strokeStyle = gold ? '#fff7c9' : '#fff4c0'; c.lineWidth = 1.6;
    c.beginPath(); c.ellipse(-r * 0.1, r * 0.2, r * 0.95, r * 0.7, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.arc(r * 0.55, -r * 0.45, r * 0.46, 0, Math.PI * 2); c.fill(); c.stroke();
    c.shadowBlur = 0;
    // dziób, oko, skrzydło, ogon
    c.fillStyle = '#ff8a1f'; c.beginPath(); c.moveTo(r * 0.92, -r * 0.5); c.quadraticCurveTo(r * 1.5, -r * 0.45, r * 1.42, -r * 0.28); c.quadraticCurveTo(r * 1.1, -r * 0.2, r * 0.92, -r * 0.32); c.closePath(); c.fill();
    c.fillStyle = '#1a0f05'; c.beginPath(); c.arc(r * 0.66, -r * 0.55, r * 0.07, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(120,70,0,.7)'; c.lineWidth = 1.4; c.beginPath(); c.arc(-r * 0.2, r * 0.15, r * 0.5, Math.PI * 0.15, Math.PI * 1.1); c.stroke();
    c.fillStyle = body; c.beginPath(); c.moveTo(-r * 0.95, r * 0.05); c.lineTo(-r * 1.3, -r * 0.2); c.lineTo(-r * 0.9, r * 0.35); c.closePath(); c.fill();
    // blaszany połysk i bita „tarcza” trafienia
    c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.ellipse(-r * 0.35, -r * 0.05, r * 0.28, r * 0.12, -0.5, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function render() {
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
    c.setTransform(k, 0, 0, k, sx * k, sy * k);
    c.drawImage(bg, 0, 0, AW, AH);

    // żarówki pod daszkiem
    for (let i = 0; i < 20; i++) {
      const x = 20 + i * 40.5, y = TENT + 4 + Math.sin((i / 19) * Math.PI) * 7, on = (Math.floor(time * 3 + i) % 3) !== 0 || reduced();
      c.fillStyle = on ? ['#ffd319', '#ff4f6e', '#4fd6ff', '#9cff57'][i % 4] : '#4a3a30';
      c.shadowColor = c.fillStyle as string; c.shadowBlur = on ? 14 * k : 0;
      c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
    }
    c.shadowBlur = 0;

    // dziury po kulach
    for (const h of holes) {
      c.globalAlpha = Math.min(1, h.life * 1.5);
      c.fillStyle = '#0b0603'; c.beginPath(); c.arc(h.x, h.y, 4.5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,220,160,.5)'; c.lineWidth = 1; c.beginPath(); c.arc(h.x, h.y, 6.5, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;

    // kaczki: tylne rzędy najpierw
    for (let row = 0; row < ROWS.length; row++) for (const d of sim.ducks) if (d.row === row) drawDuck(c, d.x, d.y, d.r, d.dir, d.gold, time + d.id * 0.3);
    // trafione kaczki spadają
    for (const f of falls) { c.save(); c.globalAlpha = Math.max(0, f.life); c.translate(f.x, f.y); c.rotate(f.rot); drawDuck(c, 0, 0, f.r, f.dir, f.gold, 0); c.restore(); }

    // iskry
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const p of sparks) { const a = 1 - p.life / p.max; c.globalAlpha = a; c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (0.5 + a), 0, Math.PI * 2); c.fill(); }
    c.restore();
    // punkty
    for (const p of pops) {
      c.save(); c.globalAlpha = Math.min(1, p.life * 2); c.font = `900 22px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 4; c.strokeStyle = '#2a0b3e'; c.strokeText(p.text, p.x, p.y); c.fillStyle = p.color; c.fillText(p.text, p.x, p.y); c.restore();
    }

    // błysk wystrzału na ladzie i celownik
    if (cursor.in || sim.phase === 'play') {
      const cx = cursor.x, cy = cursor.y, rad = 18 + kick * 6;
      c.save(); c.strokeStyle = '#ff3b4e'; c.lineWidth = 2.5; c.shadowColor = '#ff3b4e'; c.shadowBlur = 10 * k;
      c.beginPath(); c.arc(cx, cy, rad, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(cx - rad - 8, cy); c.lineTo(cx - 5, cy); c.moveTo(cx + 5, cy); c.lineTo(cx + rad + 8, cy); c.moveTo(cx, cy - rad - 8); c.lineTo(cx, cy - 5); c.moveTo(cx, cy + 5); c.lineTo(cx, cy + rad + 8); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(cx, cy, 2, 0, Math.PI * 2); c.fill();
      // wskaźnik przerwy między strzałami: łuk wokół celownika
      if (sim.phase === 'play') {
        const ready = Math.min(1, (sim.tick - sim.lastShot) / COOLDOWN);
        if (ready < 1) { c.strokeStyle = '#ffd319'; c.beginPath(); c.arc(cx, cy, rad + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ready); c.stroke(); }
      }
      c.restore();
    }
    if (flash > 0) { c.fillStyle = `rgba(255,240,200,${flash * 0.12})`; c.fillRect(0, 0, AW, AH); }

    // czas na ostatnie sekundy
    if (sim.phase === 'play' && (ROUND_TICKS - sim.tick) * TICK < 5) {
      c.save(); c.globalAlpha = 0.25 + 0.2 * Math.sin(time * 10); c.strokeStyle = '#ff3b4e'; c.lineWidth = 10; c.strokeRect(0, 0, AW, AH); c.restore();
    }

    // napisy
    if (msg) {
      const a = Math.min(1, msg.t * 6, (msg.dur - msg.t) * 3), z = 1 + Math.max(0, 0.25 - msg.t) * 1.2;
      c.save(); c.translate(AW / 2, AH / 2 - 10); c.scale(z, z); c.globalAlpha = a;
      c.fillStyle = 'rgba(12,2,28,.65)'; c.beginPath(); c.roundRect(-230, -52, 460, msg.sub ? 112 : 84, 16); c.fill();
      c.font = `900 46px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 5; c.strokeStyle = '#d6283a'; c.strokeText(msg.text, 0, -8); c.fillStyle = '#fff'; c.fillText(msg.text, 0, -8);
      if (msg.sub) { c.font = `700 18px ${FONT}`; c.fillStyle = '#ffe9b0'; c.fillText(msg.sub, 0, 36); }
      c.restore();
    }
    if (sim.phase === 'attract' && !msg) {
      const a = 0.6 + Math.sin(time * 4) * 0.4;
      c.save(); c.globalAlpha = a; c.font = `900 40px ${FONT}`; c.textAlign = 'center'; c.lineWidth = 5; c.strokeStyle = '#d6283a'; c.strokeText('KLIKNIJ, ŻEBY ZACZĄĆ', AW / 2, AH / 2); c.fillStyle = '#fff'; c.fillText('KLIKNIJ, ŻEBY ZACZĄĆ', AW / 2, AH / 2); c.restore();
    }
  }

  // ---------- pętla ----------
  let raf = 0, last = 0, acc = 0;
  function frame(now: number) {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now; time += dt;
    if (sim.phase === 'play') {
      acc += dt;
      let n = 0;
      while (acc >= TICK && n < 20) {
        const before = sim.tick;
        sim.step(); acc -= TICK; n++;
        // sygnał na ostatnie 5 sekund (co sekundę)
        const left = (ROUND_TICKS - sim.tick) * TICK;
        if (sim.tick !== before && left < 5 && Math.floor(left) !== Math.floor(left + TICK)) Sound.pin('tick');
      }
      if (n >= 20) acc = 0;
    } else acc = 0;
    // efekty
    flash = Math.max(0, flash - dt * 8); kick = Math.max(0, kick - dt * 7); shake = Math.max(0, shake - dt * 40);
    for (const f of falls) { f.vy += 900 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.spin * dt; f.life -= dt * 0.9; }
    for (let i = falls.length - 1; i >= 0; i--) if (falls[i].life <= 0 || falls[i].y > AH + 80) falls.splice(i, 1);
    for (const p of sparks) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy = p.vy * 0.96 + 300 * dt; }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life > sparks[i].max) sparks.splice(i, 1);
    for (const p of pops) { p.life -= dt; p.y -= 40 * dt; }
    for (let i = pops.length - 1; i >= 0; i--) if (pops[i].life <= 0) pops.splice(i, 1);
    for (const h of holes) h.life -= dt * 0.3;
    for (let i = holes.length - 1; i >= 0; i--) if (holes[i].life <= 0) holes.splice(i, 1);
    if (msg) { msg.t += dt; if (msg.t > msg.dur) msg = null; }
    hud();
    render();
    raf = requestAnimationFrame(frame);
  }

  function resize() {
    const cssW = canvas.clientWidth || AW;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    k = (cssW / AW) * dpr;
    canvas.width = Math.round(AW * k); canvas.height = Math.round(AH * k);
    drawBg();
  }

  // ---------- sterowanie ----------
  function pos(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    cursor.x = ((e.clientX - r.left) / r.width) * AW; cursor.y = ((e.clientY - r.top) / r.height) * AH;
  }
  const pmove = (e: PointerEvent) => { pos(e); cursor.in = true; };
  const pleave = () => { cursor.in = false; };
  function pdown(e: PointerEvent) {
    e.preventDefault();
    pos(e); cursor.in = true;
    Sound.unlock();
    if (sim.phase !== 'play') { void start(); return; }
    fire(cursor.x, cursor.y);
  }
  const kd = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat && sim.phase !== 'play') { e.preventDefault(); void start(); }
  };
  canvas.addEventListener('pointermove', pmove);
  canvas.addEventListener('pointerleave', pleave);
  canvas.addEventListener('pointerdown', pdown);
  window.addEventListener('keydown', kd);
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();
  hud();
  raf = requestAnimationFrame(frame);

  return {
    start: () => { void start(); },
    resize,
    getRun: () => run,
    state: () => ({ score: sim.score, hits: sim.hits, shots: sim.shots, tick: sim.tick, phase: sim.phase }),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointermove', pmove); canvas.removeEventListener('pointerleave', pleave); canvas.removeEventListener('pointerdown', pdown);
      window.removeEventListener('keydown', kd);
    },
  };
}
