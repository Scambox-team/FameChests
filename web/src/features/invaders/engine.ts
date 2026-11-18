// Obrona Orbity: rysowanie na płótnie i pętla gry. Logikę (ruchy, trafienia, punkty) liczy wyłącznie rdzeń core.ts,
// tu tylko stały krok 60 na sekundę, klawisze, efekty (iskry, napisy, gwiazdy) i dźwięki. Efekty używają Math.random -
// nie wpływają na grę, którą serwer odtwarza z zapisu klawiszy.
import { LiveSeeds } from '../games/liveSeeds';
import { SEG, ACOLS, AH, AROWS, AW, FIRE, H, InvadersSim, LEFT, PH, PW, PY, RIGHT, SAUCER_H, SAUCER_W, SAUCER_Y, SC, SHIELD_COLS, SHIELD_ROWS, SHIELD_X, SHIELD_Y, TICK, W } from './core';

export type Phase = 'idle' | 'play' | 'pause' | 'over';
export interface InvHud { phase: Phase; score: number; lives: number; wave: number; best: number; record: boolean }
export interface InvRun { log: number[]; ticks: number; score: number }
export interface InvCallbacks { over: (run: InvRun, record: boolean) => void; sound: (k: string, n?: number) => void }

// Własne grafiki pikselowe (12 x 8, dwie klatki): dron z okiem, kolczasta kula, trójskrzydłowiec
const SPRITES: string[][][] = [
  [[
    '....####....',
    '..########..',
    '.##..##..##.',
    '############',
    '.#.##..##.#.',
    '#..........#',
    '.#........#.',
    '............',
  ], [
    '....####....',
    '..########..',
    '.##..##..##.',
    '############',
    '.#.##..##.#.',
    '.#........#.',
    '#..........#',
    '............',
  ]],
  [[
    '.#...##...#.',
    '..#.####.#..',
    '.##########.',
    '###.####.###',
    '############',
    '..###..###..',
    '.#........#.',
    '#..........#',
  ], [
    '#...####...#',
    '.#.######.#.',
    '.##########.',
    '###.####.###',
    '############',
    '..###..###..',
    '..#......#..',
    '...#....#...',
  ]],
  [[
    '#....##....#',
    '##..####..##',
    '.##########.',
    '..##.##.##..',
    '..########..',
    '...######...',
    '..#.#..#.#..',
    '.#........#.',
  ], [
    '.#...##...#.',
    '.##.####.##.',
    '############',
    '..##.##.##..',
    '..########..',
    '...######...',
    '...#.##.#...',
    '..#......#..',
  ]],
];
const ROW_SPRITE = [0, 1, 1, 2, 2];
const ROW_COLOR = ['#f472b6', '#a78bfa', '#a78bfa', '#38bdf8', '#38bdf8'];
const SHIP = [
  '.....##.....',
  '....####....',
  '....####....',
  '.##########.',
  '############',
  '############',
  '##.##..##.##',
];
const SAT = [
  '.....######.....',
  '##..########..##',
  '################',
  '##.##.####.##.##',
  '.....######.....',
  '......#..#......',
];

function sprite(rows: string[], color: string, scale: number) {
  const c = document.createElement('canvas');
  c.width = rows[0].length * scale; c.height = rows.length * scale;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') g.fillRect(x * scale, y * scale, scale, scale); }));
  return c;
}

const BEST_KEY = 'invaders.best';
const readBest = () => { try { return +(localStorage.getItem(BEST_KEY) || 0); } catch { return 0; } };

export function createInvaders(canvas: HTMLCanvasElement, onHud: (h: InvHud) => void, cb: InvCallbacks) {
  const ctx = canvas.getContext('2d')!;
  const alienImgs = ROW_SPRITE.map((s, r) => [0, 1].map(f => sprite(SPRITES[s][f], ROW_COLOR[r], 2)));
  const shipImg = sprite(SHIP, '#4ade80', 2);
  const satImg = sprite(SAT, '#facc15', 2);
  const stars = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 1.6 + 0.3, v: Math.random() * 0.25 + 0.05 }));
  const sparks: { x: number; y: number; vx: number; vy: number; life: number; c: string }[] = [];
  const texts: { x: number; y: number; t: string; life: number; c: string }[] = [];
  let sim: InvadersSim | null = null;
  let live = LiveSeeds.local(SEG);
  let phase: Phase = 'idle';
  let keys = 0;
  let acc = 0, last = performance.now(), raf = 0, shake = 0, flash = 0, banner = 0;
  let best = readBest(), record = false;

  const hud = () => onHud({ phase, score: sim?.score ?? 0, lives: sim?.lives ?? 3, wave: sim?.wave ?? 1, best, record });

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  };
  resize();

  const burst = (x: number, y: number, c: string, n: number, sp = 2.5) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = Math.random() * sp + 0.5;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c });
    }
  };

  const handleEvents = () => {
    if (!sim) return;
    for (const e of sim.events) {
      switch (e.k) {
        case 'shoot': cb.sound('shoot'); break;
        case 'kill': burst(e.x, e.y, '#f0abfc', 14); texts.push({ x: e.x, y: e.y, t: `+${e.n}`, life: 1, c: '#fff' }); cb.sound('kill'); break;
        case 'saucer': burst(e.x, e.y, '#facc15', 40, 3.5); texts.push({ x: e.x, y: e.y, t: `+${e.n}`, life: 1.6, c: '#facc15' }); cb.sound('saucer'); flash = 0.4; break;
        case 'hit': burst(e.x, e.y, '#4ade80', 50, 3.5); shake = 14; flash = 0.7; cb.sound('hit'); break;
        case 'shield': burst(e.x, e.y, '#22c55e', 4, 1.2); break;
        case 'clash': burst(e.x, e.y, '#fff', 8, 1.5); break;
        case 'march': cb.sound('march', e.n); break;
        case 'wave': banner = 2.5; cb.sound('wave'); break;
        case 'life': texts.push({ x: e.x, y: e.y - 30, t: '+1 ŻYCIE', life: 2, c: '#4ade80' }); cb.sound('life'); break;
        case 'ufo': cb.sound('ufo'); break;
        case 'invaded': shake = 20; flash = 1; break;
      }
    }
    sim.events.length = 0;
  };

  const finish = () => {
    if (!sim) return;
    phase = 'over';
    record = sim.score > best;
    if (record) { best = sim.score; try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* bez zapisu */ } }
    hud();
    cb.over({ log: sim.log.slice(), ticks: sim.tick, score: sim.score }, record);
  };

  const draw = (dt: number) => {
    const g = ctx;
    g.save();
    if (shake > 0) { g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake = Math.max(0, shake - dt * 60); }
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#05030f'); bg.addColorStop(1, '#0c0a24');
    g.fillStyle = bg; g.fillRect(-20, -20, W + 40, H + 40);
    for (const s of stars) {
      s.y += s.v * dt * 60; if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
      g.fillStyle = `rgba(200,210,255,${0.3 + s.s * 0.35})`; g.fillRect(s.x, s.y, s.s, s.s);
    }
    // planeta na dole
    g.fillStyle = '#123'; g.beginPath(); g.ellipse(W / 2, H + 380, 520, 400, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#4ade8040'; g.lineWidth = 2; g.beginPath(); g.ellipse(W / 2, H + 380, 520, 400, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();

    const s = sim;
    if (s) {
      // osłony
      g.fillStyle = '#22c55e';
      SHIELD_X.forEach((cx, k) => {
        const sx = cx - (SHIELD_COLS * SC) / 2, cells = s.shields[k];
        if (!cells) return;
        for (let r = 0; r < SHIELD_ROWS; r++) for (let c = 0; c < SHIELD_COLS; c++) if (cells[r * SHIELD_COLS + c]) g.fillRect(sx + c * SC, SHIELD_Y + r * SC, SC, SC);
      });
      // obcy
      const f = s.marches & 1;
      for (let i = 0; i < AROWS * ACOLS; i++) {
        if (!s.alive[i]) continue;
        const row = Math.floor(i / ACOLS);
        g.drawImage(alienImgs[row][f], s.alienX(i), s.alienY(i) + 1, AW, AH - 2);
      }
      // satelita
      if (s.saucer) {
        g.drawImage(satImg, s.saucer.x - SAUCER_W / 2, SAUCER_Y + 1, SAUCER_W, SAUCER_H - 2);
        if (Math.floor(performance.now() / 150) % 2) { g.fillStyle = '#f87171'; g.fillRect(s.saucer.x - 1, SAUCER_Y - 3, 2, 2); }
      }
      // pociski
      if (s.bullet) { g.fillStyle = '#e0f2fe'; g.shadowColor = '#7dd3fc'; g.shadowBlur = 8; g.fillRect(s.bullet.x - 1, s.bullet.y, 2, 8); g.shadowBlur = 0; }
      g.fillStyle = '#fb7185';
      for (const b of s.bombs) {
        const z = (Math.floor(b.y / 4) & 1) ? 1 : -1;
        g.fillRect(b.x - 1 + z, b.y, 2, 3); g.fillRect(b.x - 1 - z, b.y + 3, 2, 3); g.fillRect(b.x - 1 + z, b.y + 6, 2, 2);
      }
      // statek gracza (miga po powrocie)
      if (s.respawn === 0 && !s.over) g.drawImage(shipImg, s.px - PW / 2, PY, PW, PH);
      else if (s.respawn > 0 && s.respawn < 40 && Math.floor(s.respawn / 5) % 2) { g.globalAlpha = 0.5; g.drawImage(shipImg, W / 2 - PW / 2, PY, PW, PH); g.globalAlpha = 1; }
      // zapasowe statki
      for (let k = 0; k < Math.min(s.lives - 1, 5); k++) g.drawImage(shipImg, 12 + k * 22, H - 18, 18, 10);
    }
    // iskry i napisy
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.vy += 0.05 * dt * 60; p.life -= dt * 1.6;
      if (p.life <= 0) { sparks.splice(i, 1); continue; }
      g.globalAlpha = p.life; g.fillStyle = p.c; g.fillRect(p.x, p.y, 2, 2);
    }
    g.globalAlpha = 1;
    g.textAlign = 'center';
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt; t.y -= dt * 22;
      if (t.life <= 0) { texts.splice(i, 1); continue; }
      g.globalAlpha = Math.min(1, t.life * 2); g.fillStyle = t.c; g.font = '700 13px system-ui, sans-serif'; g.fillText(t.t, t.x, t.y);
    }
    g.globalAlpha = 1;
    // linia obrony i wynik
    g.fillStyle = '#4ade8055'; g.fillRect(0, PY + PH + 6, W, 1);
    if (s) {
      g.font = '700 16px system-ui, sans-serif'; g.fillStyle = '#e2e8f0';
      g.textAlign = 'left'; g.fillText(`WYNIK ${s.score}`, 12, 24);
      g.textAlign = 'right'; g.fillText(`FALA ${s.wave}`, W - 12, 24);
    }
    if (banner > 0 && s) {
      banner -= dt;
      g.globalAlpha = Math.min(1, banner);
      g.textAlign = 'center'; g.font = '800 34px system-ui, sans-serif'; g.fillStyle = '#facc15';
      g.fillText(`FALA ${s.wave}`, W / 2, H / 2);
      g.globalAlpha = 1;
    }
    g.restore();
    if (flash > 0) { g.fillStyle = `rgba(255,255,255,${flash * 0.25})`; g.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 2); }
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (phase === 'play' && sim) {
      acc += dt;
      let n = 0;
      while (acc >= TICK && n < 6 && !sim.over) {
        if (!live.canStep(sim.tick)) { acc = Math.min(acc, TICK); break; }   // czekamy na ziarno od serwera
        sim.step(keys); acc -= TICK; n++;
      }
      live.pump(sim.tick, sim.log);
      if (n === 6) acc = 0;
      handleEvents();
      if (sim.over) finish();
      else if (n) hud();
    }
    draw(dt);
  };
  raf = requestAnimationFrame(frame);
  hud();

  return {
    get phase() { return phase; },
    /** rdzeń bieżącej gry (do testów w trybie dev) */
    get sim() { return sim; },
    /** `seeds` = ziarna odcinków od serwera (features/games/liveSeeds.ts); bez nich gra bez nagrody */
    start(seeds?: LiveSeeds) {
      live = seeds ?? LiveSeeds.local(SEG);
      sim = new InvadersSim(live.seed);
      phase = 'play'; record = false; acc = 0; keys = 0; banner = 2; sparks.length = 0; texts.length = 0;
      last = performance.now();
      hud();
    },
    pause() {
      if (phase === 'play') phase = 'pause';
      else if (phase === 'pause') { phase = 'play'; last = performance.now(); acc = 0; }
      hud();
    },
    /** zakończ grę teraz (punkty zdobyte do tej chwili się liczą) */
    quit() { if (sim && (phase === 'play' || phase === 'pause')) { sim.over = true; finish(); } },
    setKey(bit: number, on: boolean) { keys = on ? keys | bit : keys & ~bit; },
    destroy() { cancelAnimationFrame(raf); },
  };
}
export type InvadersGame = ReturnType<typeof createInvaders>;
export { FIRE, LEFT, RIGHT };
