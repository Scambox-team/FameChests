// @ts-nocheck
// Super Turbo Run 3D: bieg po neonowym tunelu, gra z gotowego pliku (Downloads/index (3).html) przeniesiona do kontenera .rn3 zamiast całej strony
// (ta sama metoda co snakeScene.ts). Wszystko jest tu: scena three.js z bloomem, HUD (z HTML poniżej), dźwięk z syntezatora Web Audio i wejście.
// Wynik w punktach (REKORD w localStorage `superTurboRun3D.best`); serwerowi po grze idzie przebiegnięty dystans w metrach (hooks.onOver).
// Ładować tylko dynamicznym import() po sprawdzeniu use3D() (features/turbo/RunPage.tsx). Styl: features/turbo/run3d.css (klasy rn-*, ids rn_*).
// Kolory: three od r152 zarządza przestrzenią barw, a oryginał liczył na surowych wartościach, więc światła są mnożone przez PI (dawne jednostki),
// tekstury w sRGB, a kolory kafli (liczone w przestrzeni wyświetlacza) zamieniane na liniowe; na końcu OutputPass koduje obraz do sRGB.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface RunOver { distance: number; score: number; gems: number; zone: number; record: boolean }
export interface RunHooks {
  onStart: () => void;
  onOver: (r: RunOver) => void;
  volume: () => number;
  soundOn: () => boolean;
}
export interface Run3D { pause: () => void; destroy: () => void }

const HTML = `<div id="rn_hud" class="rn-hidden">
  <div class="rn-tl"><div id="rn_zoneName">STREFA 1</div><div id="rn_distTxt">0 m</div></div>
  <div class="rn-tc">
    <div id="rn_score">0</div>
    <div id="rn_comboWrap"><span id="rn_mult">x1</span><div id="rn_comboBar"><i></i></div></div>
  </div>
  <div class="rn-tr">
    <div id="rn_gemTxt"><span class="rn-gemico"></span><span id="rn_gemVal">0</span></div>
    <div id="rn_bestTxt">REKORD 0</div>
    <div id="rn_powers">
      <div class="rn-chip" id="rn_chShield" style="color:#4df3ff">TARCZA</div>
      <div class="rn-chip" id="rn_chMagnet" style="color:#ff6bd6">MAGNES<i></i></div>
      <div class="rn-chip" id="rn_chX2" style="color:#b6ff4d">PUNKTY ×2<i></i></div>
    </div>
  </div>
  <div id="rn_speedo"><span id="rn_speedVal">0</span><small>KM/H</small><div id="rn_turboBar"><i></i></div></div>
</div>
<div id="rn_popups"></div>
<div id="rn_banner"><b></b><span></span></div>

<div id="rn_btns">
  <button type="button" class="rn-ibtn" id="rn_bFs" title="Pełny ekran (F)">F</button>
  <button type="button" class="rn-ibtn" id="rn_bMute" title="Dźwięk (M)">M</button>
  <button type="button" class="rn-ibtn rn-hidden" id="rn_bPause" title="Pauza (P)">II</button>
</div>

<div id="rn_menu" class="rn-screen">
  <h1 class="rn-title"><span class="rn-l1">SUPER</span><span class="rn-l2">TURBO RUN</span><span class="rn-l3">3D</span></h1>
  <div class="rn-tag">BIEGNIJ · SKACZ · OBRACAJ TUNEL</div>
  <button type="button" class="rn-btn" id="rn_bStart">START</button>
  <div class="rn-menuBest" id="rn_menuBest"></div>
  <div class="rn-keys">
    <div><kbd>←</kbd><kbd>→</kbd> lub <kbd>A</kbd><kbd>D</kbd> bieg po ścianach</div>
    <div><kbd>SPACJA</kbd> skok, przytrzymaj, by skoczyć wyżej</div>
    <div><kbd>P</kbd> pauza &nbsp; <kbd>M</kbd> dźwięk &nbsp; <kbd>F</kbd> pełny ekran</div>
  </div>
  <div class="rn-hint">NACIŚNIJ SPACJĘ, ABY WYSTARTOWAĆ</div>
</div>

<div id="rn_over" class="rn-screen rn-hidden">
  <h2>KONIEC BIEGU</h2>
  <div id="rn_overCause"></div>
  <div id="rn_overScore">0</div>
  <div id="rn_newRec" class="rn-hidden">★ NOWY REKORD! ★</div>
  <div class="rn-stats">
    <div><b id="rn_stDist">0</b><span>DYSTANS</span></div>
    <div><b id="rn_stGems">0</b><span>KRYSZTAŁY</span></div>
    <div><b id="rn_stCombo">0</b><span>MAKS. COMBO</span></div>
    <div><b id="rn_stZone">1</b><span>STREFA</span></div>
  </div>
  <button type="button" class="rn-btn" id="rn_bAgain">JESZCZE RAZ</button>
  <div class="rn-hint">SPACJA = SZYBKI RESTART</div>
</div>

<div id="rn_pause" class="rn-screen rn-hidden"><h2>PAUZA</h2><div class="rn-hint">NACIŚNIJ P, ABY WRÓCIĆ DO BIEGU</div></div>

<div id="rn_touch">
  <div class="rn-tbtn" id="rn_tL">←</div><div class="rn-tbtn" id="rn_tR">→</div><div class="rn-tbtn" id="rn_tJ">SKOK</div>
</div>`;

export function createRun3D(root: HTMLElement, hooks: RunHooks): Run3D {
root.classList.add('rn3');
root.innerHTML = HTML;
let VW = Math.max(1, root.clientWidth), VH = Math.max(1, root.clientHeight);
const $ = id => root.querySelector('#rn_' + id);
let raf = 0, dead = false;
const offs = [];
const on = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); offs.push(() => t.removeEventListener(type, fn, opts)); };
/* =====================================================================
   STAŁE I POMOCNICZE
   ===================================================================== */
const TAU = Math.PI * 2;
const N = 12;                       // liczba ścian tunelu
const APO = 5.2;                    // odległość środka ściany od osi tunelu
const DTH = TAU / N;
const TW = 2 * APO * Math.tan(Math.PI / N);   // szerokość kafla
const TL = 3.2, TT = 0.3;           // długość i grubość kafla
const ROWS_AHEAD = 60, ROWS_BEHIND = 4, RB = 128;
const GRAV = 16, JUMP_V = 9.4, PAD_V = 10.7;   // niska grawitacja: skoki wysokie i długie
const JUMP_T = 2 * JUMP_V / GRAV, PAD_T = 2 * PAD_V / GRAV;
const ZONE_LEN = 700, TURBO_DIST = 95, V0 = 17;

const rand = (a, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mod = (a, n) => ((a % n) + n) % n;
const wrapPi = a => mod(a + Math.PI, TAU) - Math.PI;
// spokojny start, wyraźny skok prędkości z każdą kolejną strefą
const speedAt = d => { const z = d / ZONE_LEN, zi = Math.floor(z); return Math.min(46, V0 + zi * 2.6 + (z - zi) * 1.0); };
const latSpeed = v => 10.5 + (v - 24) * 0.2;
const rowsPerLane = v => Math.ceil(TW * v / (TL * latSpeed(v) * 0.7));
const LC = new Float32Array(N), LS = new Float32Array(N);
for (let l = 0; l < N; l++) { LC[l] = Math.cos(l * DTH); LS[l] = Math.sin(l * DTH); }

const ZONES = [
  { name: 'NEONOWA ORBITA',   a: 0x1fc8ff, b: 0x7a5cff, fog: 0x04040f, glow: 0x66e8ff, n1: 0x2b4bff, n2: 0x8a2be2 },
  { name: 'RÓŻOWA MGŁAWICA',  a: 0xd24dff, b: 0xff5cc8, fog: 0x0c0312, glow: 0xff8ae6, n1: 0xff2e97, n2: 0x5a1bff },
  { name: 'SZMARAGDOWY WIR',  a: 0x2dffb3, b: 0x18a8ff, fog: 0x020d0c, glow: 0x7dffd0, n1: 0x00c9a7, n2: 0x1b6bff },
  { name: 'SŁONECZNA KORONA', a: 0xffc93c, b: 0xff8a2a, fog: 0x100702, glow: 0xffe08a, n1: 0xff7a1a, n2: 0xb3003b },
  { name: 'LODOWY PIERŚCIEŃ', a: 0xcfefff, b: 0x4f9dff, fog: 0x030814, glow: 0xdff4ff, n1: 0x3a8dff, n2: 0x7fe0ff },
  { name: 'SERCE KWAZARA',    a: 0xa66bff, b: 0x4dffe1, fog: 0x08031a, glow: 0xd0a6ff, n1: 0x7a2bff, n2: 0x00d0ff },
];
const TRAIL = [0x4df3ff, 0x4dffa6, 0xc8ff4d, 0xffd23c, 0xff9a3c, 0xff6b6b, 0xff4fd8, 0xc77dff, 0xfff27a];

/* =====================================================================
   DŹWIĘK — proceduralna muzyka i efekty (Web Audio)
   ===================================================================== */
const Snd = (() => {
  let ctx = null, master, mFilter, mGain, duck, drums, delayIn, delayNode, sfx, noise;
  let step = 0, nextT = 0, bpm = 124, transpose = 0, mode = 'menu', muted = !hooks.soundOn(), tickTimer = 0;
  let energy = 0;
  const beats = [];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const PROG = [{ r: 45, m: 1 }, { r: 41, m: 0 }, { r: 48, m: 0 }, { r: 43, m: 0 }];
  const ARP = [0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 3, 4, 2, 3, 1];
  const LEAD = {};
  [[0,76,3],[3,74,1],[4,76,2],[6,79,2],[8,81,4],[12,79,2],[14,76,2],
   [16,77,3],[19,76,1],[20,72,4],[24,69,2],[26,72,2],[28,76,4],
   [32,79,3],[35,76,1],[36,79,2],[38,84,2],[40,83,2],[42,79,2],[44,76,4],
   [48,74,3],[51,79,3],[54,83,2],[56,81,2],[58,79,2],[60,74,2],[62,76,2],
   [64,81,2],[66,79,2],[68,76,2],[70,79,2],[72,81,2],[74,84,2],[76,81,4],
   [80,84,3],[83,81,1],[84,77,4],[88,81,2],[90,84,2],[92,81,4],
   [96,79,2],[98,76,2],[100,79,2],[102,84,2],[104,88,4],[108,86,2],[110,84,2],
   [112,86,3],[115,83,3],[118,79,2],[120,83,2],[122,86,2],[124,79,4]].forEach(n => LEAD[n[0]] = n);

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { ctx = new AC(); } catch (e) { ctx = null; return; }
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9 * hooks.volume(); master.connect(comp); comp.connect(ctx.destination);
    mFilter = ctx.createBiquadFilter(); mFilter.type = 'lowpass'; mFilter.frequency.value = 1100; mFilter.Q.value = 0.6;
    mGain = ctx.createGain(); mGain.gain.value = 0.62; mFilter.connect(mGain); mGain.connect(master);
    duck = ctx.createGain(); duck.connect(mFilter);
    drums = ctx.createGain(); drums.connect(mFilter);
    delayNode = ctx.createDelay(1); delayNode.delayTime.value = 60 / bpm * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.36; const wet = ctx.createGain(); wet.gain.value = 0.32;
    delayIn = ctx.createGain(); delayIn.connect(delayNode); delayNode.connect(fb); fb.connect(delayNode); delayNode.connect(wet); wet.connect(duck);
    sfx = ctx.createGain(); sfx.gain.value = 0.75; sfx.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    nextT = ctx.currentTime + 0.1;
    tickTimer = setInterval(tick, 25);
    setMode(mode);
  }
  function osc(type, freq, t, dur, vol, dest, o) {
    o = o || {};
    const os = ctx.createOscillator(), g = ctx.createGain();
    os.type = type; os.frequency.setValueAtTime(freq, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + (o.sweep || dur));
    if (o.detune) os.detune.value = o.detune;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + (o.att || 0.004));
    if (o.sus) g.gain.setValueAtTime(vol, t + dur * o.sus);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    os.connect(g); let out = g;
    if (o.lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(o.lp, t);
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, t + dur);
      f.Q.value = o.q || 1; g.connect(f); out = f;
    }
    out.connect(dest); if (o.send) out.connect(o.send);
    os.start(t); os.stop(t + dur + 0.05);
  }
  function nz(t, dur, vol, dest, type, f0, f1, q) {
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q || 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  function schedule(s, t) {
    const bar = Math.floor(s / 16), pos = s % 16, ch = PROG[bar % 4];
    const root = ch.r + transpose, third = ch.m ? 3 : 4, st = 60 / bpm / 4;
    const game = mode === 'game';
    if (pos % 4 === 0) beats.push(t);
    if (pos === 0) {
      [root + 12, root + 12 + third, root + 19].forEach(m => {
        osc('sawtooth', mtof(m), t, st * 16.5, 0.04, duck, { att: 0.3, sus: 0.6, lp: 1200, detune: -8 });
        osc('sawtooth', mtof(m), t, st * 16.5, 0.04, duck, { att: 0.3, sus: 0.6, lp: 1200, detune: 8 });
      });
    }
    const tones = [0, third, 7, 12, 12 + third, 19, 24];
    osc('square', mtof(root + 24 + tones[ARP[pos]]), t, 0.17, game ? 0.06 : 0.05, duck,
      { lp: 1000 + energy * 3800 + (pos % 4 === 0 ? 900 : 0), lpTo: 450, q: 3, send: delayIn });
    if (!game) return;
    if (pos % 4 === 0) {
      osc('sine', 165, t, 0.34, 0.95, drums, { to: 42, sweep: 0.13 });
      nz(t, 0.02, 0.25, drums, 'highpass', 3000);
      duck.gain.setValueAtTime(0.35, t); duck.gain.linearRampToValueAtTime(1, t + st * 3.2);
    } else {
      const bm = root + ((pos % 8 === 6) ? 12 : 0);
      osc('sawtooth', mtof(bm), t, st * 0.95, 0.2, duck, { lp: 800, lpTo: 200, q: 2 });
      osc('sine', mtof(bm - 12), t, st * 0.95, 0.24, duck);
    }
    if (pos === 4 || pos === 12) { nz(t, 0.19, 0.42, drums, 'bandpass', 1900, 1300, 0.7); nz(t + 0.012, 0.1, 0.25, drums, 'highpass', 5000); }
    if (pos % 4 === 2) nz(t, 0.07, 0.2, drums, 'highpass', 8500);
    else if (pos % 2 === 1 && energy > 0.2) nz(t, 0.03, 0.07, drums, 'highpass', 9500);
    if (Math.floor(bar / 8) % 2 === 1) {
      const n = LEAD[s % 128];
      if (n) {
        const f = mtof(n[1] + transpose), dur = n[2] * st * 1.05;
        osc('sawtooth', f, t, dur, 0.055, duck, { att: 0.012, sus: 0.6, lp: 3200, lpTo: 1300, detune: -7, send: delayIn });
        osc('square', f, t, dur, 0.03, duck, { att: 0.012, sus: 0.6, lp: 2400, lpTo: 1100, detune: 7 });
      }
    }
  }
  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    if (nextT < ctx.currentTime - 0.3) nextT = ctx.currentTime + 0.05;
    while (nextT < ctx.currentTime + 0.14) { schedule(step, nextT); nextT += 60 / bpm / 4; step++; }
  }
  function setMode(m) {
    mode = m; if (!ctx) return;
    const f = { menu: 1100, game: 17000, dead: 380, pause: 520 }[m] || 1100;
    mFilter.frequency.cancelScheduledValues(ctx.currentTime);
    mFilter.frequency.setTargetAtTime(f, ctx.currentTime, m === 'game' ? 0.12 : 0.3);
  }
  const now = () => ctx.currentTime;
  const ok = () => ctx && ctx.state === 'running';
  return {
    init, setMode,
    dispose() { clearInterval(tickTimer); try { if (ctx) ctx.close(); } catch (e) {} ctx = null; },
    setZone(z) { transpose = [0, 2, 3, 5, 3, 2, 0, -2][z % 8]; bpm = Math.min(150, 124 + z * 3); if (ctx) delayNode.delayTime.setTargetAtTime(60 / bpm * 0.75, ctx.currentTime, 0.3); },
    setEnergy(e) { energy = e; },
    toggleMute() { muted = !muted; if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.9 * hooks.volume(), ctx.currentTime, 0.03); return muted; },
    pollBeat() { if (!ok()) return false; let b = false; while (beats.length && beats[0] <= ctx.currentTime) { beats.shift(); b = true; } return b; },
    get live() { return ok(); },
    gem(n) { if (!ok()) return; const sc = [0, 3, 5, 7, 10], t = now();
      const m = 81 + transpose + sc[n % 5] + 12 * (Math.floor(n / 5) % 2);
      osc('triangle', mtof(m), t, 0.17, 0.24, sfx); osc('sine', mtof(m + 12), t + 0.018, 0.22, 0.1, sfx); },
    jump() { if (!ok()) return; osc('sine', 290, now(), 0.16, 0.22, sfx, { to: 640, sweep: 0.13 }); },
    land() { if (!ok()) return; const t = now(); osc('sine', 130, t, 0.1, 0.3, sfx, { to: 55 }); nz(t, 0.05, 0.08, sfx, 'lowpass', 900); },
    pad() { if (!ok()) return; const t = now(); osc('square', 220, t, 0.45, 0.16, sfx, { to: 1320, sweep: 0.35, lp: 3000 }); osc('sine', 440, t, 0.5, 0.2, sfx, { to: 1760, sweep: 0.4 }); },
    boost() { if (!ok()) return; const t = now(); nz(t, 0.9, 0.4, sfx, 'bandpass', 300, 6000, 1.2);
      osc('sawtooth', 110, t, 0.8, 0.2, sfx, { to: 880, sweep: 0.6, lp: 2500 });
      [0, 4, 7, 12, 16].forEach((s, i) => osc('square', mtof(69 + transpose + s), t + i * 0.05, 0.25, 0.1, sfx, { lp: 4000 })); },
    smash() { if (!ok()) return; const t = now(); nz(t, 0.25, 0.5, sfx, 'bandpass', 2400, 500, 0.6); osc('square', 420, t, 0.2, 0.2, sfx, { to: 70, lp: 2000 }); },
    near() { if (!ok()) return; nz(now(), 0.2, 0.3, sfx, 'bandpass', 600, 4200, 2.5); },
    combo(m) { if (!ok()) return; const t = now(); [0, 7, 12].forEach((s, i) => osc('triangle', mtof(76 + transpose + m + s), t + i * 0.045, 0.3, 0.16, sfx)); },
    power() { if (!ok()) return; const t = now(); [0, 4, 7, 12, 16, 19].forEach((s, i) => osc('square', mtof(72 + transpose + s), t + i * 0.055, 0.22, 0.11, sfx, { lp: 5000 })); },
    zone() { if (!ok()) return; const t = now(); nz(t, 1.1, 0.3, sfx, 'highpass', 400, 9000);
      [0, 4, 7, 12].forEach(s => { osc('sawtooth', mtof(57 + transpose + s), t, 1.2, 0.09, sfx, { att: 0.02, sus: 0.3, lp: 4000, lpTo: 800 }); }); },
    crash() { if (!ok()) return; const t = now(); nz(t, 0.8, 0.8, sfx, 'lowpass', 4000, 90); osc('sawtooth', 190, t, 0.7, 0.4, sfx, { to: 28, lp: 1200 }); osc('sine', 90, t, 0.6, 0.6, sfx, { to: 30 }); },
    fall() { if (!ok()) return; osc('sine', 880, now(), 0.9, 0.3, sfx, { to: 70, sweep: 0.8 }); },
    shieldBreak() { if (!ok()) return; const t = now(); nz(t, 0.3, 0.35, sfx, 'highpass', 2500); osc('triangle', 1200, t, 0.35, 0.2, sfx, { to: 200 }); },
    click() { if (!ok()) return; osc('triangle', 660, now(), 0.09, 0.18, sfx, { to: 990 }); },
  };
})();

/* =====================================================================
   STAN GRY
   ===================================================================== */
const G = { state: 'menu', dist: 0, jp: 0, speed: 14, score: 0, gems: 0, combo: 0, comboT: 0, mult: 1, maxCombo: 0, zone: 0,
  turbo: 0, shield: false, magnet: 0, x2: 0, inv: 0, shake: 0, flash: 0, beat: 0, camTh: 0, camH: 0, energy: 0, time: 0,
  deadT: 0, fallT: 0, cause: '', best: 0, popAcc: 0, popT: 0, scorePunch: 0, multPunch: 0, overT: 0, finalScore: 0, fakeBeat: 0 };
const P = { th: 0, vth: 0, h: 0, vy: 0, grounded: true, fallen: false, coyote: 0, jumpBuf: 0, pad: false, air: 0, airHoles: 0, squash: 0, phase: 0 };
const input = { left: false, right: false, jump: false };
try { G.best = parseInt(localStorage.getItem('superTurboRun3D.best') || '0', 10) || 0; } catch (e) {}

/* =====================================================================
   GENERATOR TUNELU
   ===================================================================== */
const rows = [];
for (let i = 0; i < RB; i++) rows.push({ j: -1, tile: new Uint8Array(N), obs: new Uint8Array(N), item: new Uint8Array(N),
  itemH: new Float32Array(N), glow: new Float32Array(N), nobs: 0, nitem: 0, special: 0 });
const getRow = j => { if (j < 0) return null; const r = rows[j % RB]; return r.j === j ? r : null; };
const gen = { j: 0, menu: true, left: 0, seg: null, path: 0, prev: '', sinceItem: 0, sinceBoost: 0, rest: 0, holeLeft: new Int8Array(N) };

function resetGen(menu) {
  gen.j = 0; gen.menu = menu; gen.left = 0; gen.seg = null; gen.path = 0; gen.prev = ''; gen.sinceItem = 70; gen.sinceBoost = 0; gen.rest = 0;
  gen.holeLeft.fill(0); gen.hintL = null; gen.gp = { mode: 'none', left: 4, i: 0, dir: 1, step: 3, n: 0 };
  for (const r of rows) r.j = -1;
}
function setObs(r, l, v) { l = mod(l, N); if (r.tile[l] === 1) { if (!r.obs[l]) r.nobs++; r.obs[l] = v; } }
function setGem(r, l, h) { l = mod(l, N); if (!r.item[l]) r.nitem++; r.item[l] = 1; r.itemH[l] = h || 0.9; }
const gemOK = (r, l) => { l = mod(l, N); return r.tile[l] === 1 && !r.obs[l]; };
const groundGem = (r, l) => gemOK(r, l) ? (setGem(r, l), true) : false;
const hint = l => { gen.hintL = l; };                    // "bezpieczny" pas w tym rzędzie — baza dla wzorów kryształów
const holeMin = v => Math.max(2, Math.ceil((v * 0.18 + 0.7) / TL));   // najkrótsza dziura, której nie da się przebiec
function band(r, lo, hi) {
  if (hi - lo + 1 >= N) return;
  for (let l = 0; l < N; l++) {
    if (mod(l - lo, N) <= hi - lo) continue;
    r.tile[l] = 0; if (r.obs[l]) { r.obs[l] = 0; r.nobs--; } if (r.item[l]) { r.item[l] = 0; r.nitem--; }
  }
}
// losowe "plamy" dziur (2+ rzędów, czasem szerokie na 2 pasy); pasy z listy prot zostają całe
function scatter(r, p, v, prot, obsP, allowStart) {
  const hm = holeMin(v);
  for (let l = 0; l < N; l++) {
    if (prot.indexOf(l) >= 0) { gen.holeLeft[l] = 0; continue; }
    if (gen.holeLeft[l] > 0) { r.tile[l] = 0; gen.holeLeft[l]--; continue; }
    if (allowStart && Math.random() < p) {
      const len = randi(hm, hm + 2); gen.holeLeft[l] = len - 1; r.tile[l] = 0;
      if (l < N - 1 && gen.holeLeft[l + 1] <= 0 && Math.random() < 0.38) gen.holeLeft[l + 1] = len;
    } else if (obsP && Math.random() < obsP) setObs(r, l, Math.random() < 0.5 ? 1 : 2);
  }
}
function holesBody(r, s, i, len, p, d, v, minP, maxP) {
  if (i > 0 && i % 5 === 0) { s.from = gen.path; let np = gen.path + pick([-1, 0, 1]); if (minP !== undefined) np = clamp(np, minP, maxP); gen.path = np; }
  scatter(r, p, v, [mod(gen.path, N), mod(s.from, N)], 0.03 + 0.05 * d, i < len - 1);
  hint(gen.path);
}
const SEG = {
  open(v, d) {
    const len = randi(9, 15), p = gen.j < 30 ? 0.025 : 0.05 + 0.05 * d;
    return { len, fn(r, s, i) {
      scatter(r, p, v, [mod(gen.path, N)], 0, i < len - 1);
      hint(gen.path);
      if (i % 3 === 1) { const n = 1 + Math.floor(rand(0, 1.5 + d * 4)); for (let k = 0; k < n; k++) setObs(r, gen.path + randi(2, N - 2), Math.random() < 0.6 ? 1 : 2); }
    } };
  },
  holes(v, d) {
    const len = randi(14, 22), p = 0.12 + 0.1 * d;
    return { len, from: gen.path, fn(r, s, i) { holesBody(r, s, i, len, p, d, v); } };
  },
  gaps(v, d) {
    const gmax = clamp(Math.floor(0.45 * v * JUMP_T / TL), 2, 7), gmin = Math.min(holeMin(v), gmax), lo = Math.ceil(v * JUMP_T / TL), hm = holeMin(v);
    const plan = [], n = randi(2, 3);
    for (let k = 0; k < n; k++) { const so = randi(lo, lo + 2), g = randi(gmin, gmax), arc = Math.random() < 0.6; for (let q = 0; q < so; q++) plan.push(0); for (let q = 0; q < g; q++) plan.push([q, g, arc]); }
    plan.push(0, 0);
    const far = k => { if (k + hm + 5 >= plan.length) return false; for (let q = 0; q <= hm + 5; q++) if (plan[k + q]) return false; return true; };
    return { len: plan.length, fn(r, s, i) {
      const p = plan[i];
      if (p) { r.tile.fill(0); if (p[2]) setGem(r, gen.path, 0.9 + 2.0 * Math.sin(Math.PI * (p[0] + 0.5) / p[1])); }
      else { scatter(r, 0.04, v, [mod(gen.path, N)], 0, far(i)); hint(gen.path); if (Math.random() < 0.3 * d) setObs(r, gen.path + randi(2, N - 2), 2); }
    } };
  },
  mega(v, d) {
    const flight = v * PAD_T / TL, gap = clamp(Math.floor(0.55 * flight), 4, 10), post = Math.max(6, Math.ceil(flight - gap)), apex = PAD_V * PAD_V / (2 * GRAV);
    return { len: 7 + gap + post, rest: 4, fn(r, s, i) {
      if (i === 5 || i === 6) r.tile.fill(4); else if (i >= 7 && i < 7 + gap) r.tile.fill(0);
      if (i < 5) { hint(gen.path); return; }
      const t = (i + 0.5 - 5.3) / flight;
      if (t > 0.04 && t < 0.96) { if (i % 2 === 0) setGem(r, gen.path, 0.75 + 4 * apex * t * (1 - t)); }
      else if (i >= 7 + gap) hint(gen.path);
    } };
  },
  spiral(v, d) {
    const w = d < 0.3 ? 3 : pick([2, 3, 3]), dir = pick([-1, 1]), rpl = rowsPerLane(v), k = w === 3 ? Math.max(2, rpl - 1) : rpl;
    const lead = 5 * rpl + 2, turns = randi(7, 13), base = gen.path;
    return { len: lead + turns * k, fn(r, s, i) {
      const sh = i < lead ? 0 : Math.floor((i - lead) / k) + 1, c = base + dir * sh;
      let lo, hi; if (w === 3) { lo = c - 1; hi = c + 1; } else if (dir > 0) { lo = c; hi = c + 1; } else { lo = c - 1; hi = c; }
      if (i < lead) { const e = Math.ceil((N - w) / 2 * (1 - (i + 1) / lead)); lo -= e; hi += e; }
      gen.path = c; hint(c); band(r, lo, hi);
    } };
  },
  half(v, d) {
    const hw = d < 0.5 ? 3 : 2, w = 2 * hw + 1, rpl = rowsPerLane(v), lead = Math.ceil((N - w) / 2) * rpl + 2, base = gen.path, body = randi(12, 20);
    return { len: lead + body, from: base, fn(r, s, i) {
      if (i >= lead) holesBody(r, s, i - lead, body, 0.1 + 0.1 * d, d, v, base - (hw - 1), base + (hw - 1)); else hint(gen.path);
      const e = i < lead ? Math.ceil((N - w) / 2 * (1 - (i + 1) / lead)) : 0;
      band(r, base - hw - e, base + hw + e);
    } };
  },
  stripes(v, d) {
    // odstęp barierek > długość pełnego skoku, żeby nie lądować prosto w następnej
    const jr = Math.ceil(v * JUMP_T / TL), base = gen.path, len = randi(2, 3) * (jr + 4) + 4; let nextBar = randi(4, 6);
    return { len, fn(r, s, i) {
      if (i >= 2 && i < len - 1) for (let l = 0; l < N; l++) if (mod(l - base, 2) === 1) r.tile[l] = 0;
      if (i === nextBar && i < len - 2) { setObs(r, base, 1); if (Math.random() < 0.5) setGem(r, base, 2.2); nextBar += jr + randi(2, 4); }
      else hint(base);
      if (i >= 3 && Math.random() < 0.18 + 0.25 * d) setObs(r, base + 2 * randi(1, 5), pick([1, 2]));
    } };
  },
  gates(v, d) {
    const rpl = rowsPerLane(v), q = Math.max(6, 2 * rpl + 2, Math.ceil(v * JUMP_T / TL) + 3), n = randi(3, 4); let c = gen.path, pc = c;
    return { len: n * q + 2, fn(r, s, i) {
      const k = i % q;
      if (k === 0 && i > 0 && i < n * q) { pc = c; c += randi(-2, 2); }
      gen.path = c;
      const prot = []; for (let o = -1; o <= 1; o++) prot.push(mod(c + o, N), mod(pc + o, N));
      scatter(r, 0.035, v, prot, 0, i < n * q);
      if (i < n * q && k === q - 1) {
        for (let l = 0; l < N; l++) { let off = mod(l - c, N); if (off > N / 2) off -= N; const ao = Math.abs(off); if (ao <= 1) continue;
          setObs(r, l, (ao % 2 === 1 && Math.random() < 0.25 + d) ? 2 : 1); }
      }
      if (k >= 1 || i === 0) hint(c);
    } };
  },
  boost(v, d) {
    return { len: 30, rest: 5, fn(r, s, i) {
      if (i === 2 || i === 3) { r.tile.fill(3); if (i === 2) r.special = 3; return; }
      if (i >= 6 && i < 23 && i % 2 === 0) {
        const n = randi(3, 5); for (let k = 0; k < n; k++) setObs(r, randi(0, N - 1), pick([1, 2]));
        if (i % 4 === 0) setObs(r, gen.path + pick([-1, 0, 1]), pick([1, 2]));
      }
      if (i > 4 && i < 26) { if (Math.random() < 0.5) setGem(r, gen.path + randi(-2, 2)); } else hint(gen.path);
    } };
  },
};
function nextSegment(j) {
  const dist = j * TL, v = speedAt(dist), d = Math.min(1, dist / 8000);
  let pool;
  if (dist < 120) pool = ['open', 'gaps', 'holes'];
  else if (dist < 450) pool = ['open', 'gaps', 'holes', 'holes', 'holes', 'gates', 'boost'];
  else if (dist < 950) pool = ['open', 'gaps', 'holes', 'holes', 'holes', 'gates', 'spiral', 'stripes', 'mega', 'boost'];
  else pool = ['open', 'gaps', 'holes', 'holes', 'holes', 'gates', 'spiral', 'spiral', 'half', 'half', 'stripes', 'mega', 'boost'];
  gen.sinceBoost++;
  let name, guard = 0;
  do { name = pick(pool); } while ((name === gen.prev || (name === 'boost' && gen.sinceBoost < 6)) && guard++ < 20);
  if (j < 14) name = 'open';
  if (name === 'boost') gen.sinceBoost = 0;
  gen.holeLeft.fill(0);
  gen.prev = name; gen.seg = SEG[name](v, d); gen.left = gen.seg.len;
}
// kryształy: krótkie grupki w różnych układach zamiast jednej ciągłej linii
function placeGems(r, j) {
  if (gen.hintL === null) return;
  const gp = gen.gp, base = gen.hintL;
  if (gp.left <= 0) {
    if (gp.mode !== 'none') { gp.mode = 'none'; gp.left = randi(5, 11); }
    else {
      const v = speedAt(j * TL);
      gp.step = Math.max(2, rowsPerLane(v)); gp.dir = pick([-1, 1]);
      gp.mode = pick(['line', 'line', 'side', 'side', 'zig', 'arc', 'fan', 'diag']);
      gp.n = clamp(Math.round(v * JUMP_T / TL * 0.75), 4, 12);
      gp.left = { line: randi(3, 5), side: randi(3, 4), zig: 4 * gp.step, arc: gp.n, fan: 1, diag: randi(3, 4) * gp.step }[gp.mode];
    }
    gp.i = 0;
  }
  const i = gp.i++; gp.left--;
  switch (gp.mode) {
    case 'line': groundGem(r, base); break;
    case 'side': groundGem(r, base + gp.dir) || groundGem(r, base); break;
    case 'zig': if (i % gp.step === 0) groundGem(r, base + [0, 1, 0, -1][(i / gp.step) % 4] * gp.dir) || groundGem(r, base); break;
    case 'arc': if ((gp.n <= 7 || i % 2 === 0) && gemOK(r, base)) setGem(r, base, 0.9 + 2.0 * Math.sin(Math.PI * (i + 0.5) / gp.n)); break;
    case 'fan': groundGem(r, base - 1); groundGem(r, base); groundGem(r, base + 1); break;
    case 'diag': if (i % gp.step === 0) groundGem(r, base + gp.dir * (i / gp.step)) || groundGem(r, base); break;
  }
}
function tryPower(r) {
  gen.sinceItem++;
  if (gen.sinceItem < 115 || gen.hintL === null) return;
  const l = mod(gen.hintL, N);
  if (r.tile[l] === 1 && !r.obs[l]) { if (!r.item[l]) r.nitem++; r.item[l] = 10 + randi(0, 2); r.itemH[l] = 1.15; gen.sinceItem = 0; }
}
function genRow() {
  const j = gen.j++, r = rows[j % RB];
  r.j = j; r.tile.fill(1); r.obs.fill(0); r.item.fill(0); r.glow.fill(0); r.nobs = 0; r.nitem = 0; r.special = 0;
  gen.hintL = null;
  if (gen.menu) return;
  if (j < 12) { if (j >= 5) hint(gen.path); }
  else if (gen.rest > 0) { gen.rest--; hint(gen.path); }
  else {
    if (!gen.seg || gen.left <= 0) nextSegment(j);
    const s = gen.seg; s.fn(r, s, s.len - gen.left, j); gen.left--;
    if (gen.left <= 0) gen.rest = s.rest || 3;
  }
  placeGems(r, j); tryPower(r);
}
function ensureRows() { while (gen.j < G.jp + ROWS_AHEAD + 2) genRow(); }

/* =====================================================================
   RENDERER I SCENA
   ===================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const PR = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(PR);
renderer.setSize(VW, VH);
root.prepend(renderer.domElement);
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x04040f, 55, ROWS_AHEAD * TL - 6);
const camera = new THREE.PerspectiveCamera(72, VW / VH, 0.1, 2500);
const world = new THREE.Group(); scene.add(world);
scene.add(new THREE.AmbientLight(0xffffff, 0.42 * Math.PI));
const sun = new THREE.DirectionalLight(0xffffff, 0.7 * Math.PI); sun.position.set(2, 6, 8); scene.add(sun);
const pLight = new THREE.PointLight(0x66e8ff, 0.55 * Math.PI, 14, 1); world.add(pLight);

function makeTex(draw, w, h) {
  const c = document.createElement('canvas'); c.width = w || 128; c.height = h || w || 128;
  draw(c.getContext('2d'), c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.anisotropy = maxAniso; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const tileTex = makeTex((g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s * 0.75); gr.addColorStop(0, '#4a4a4a'); gr.addColorStop(1, '#151515');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#fff'; g.lineWidth = 9; g.strokeRect(4, 4, s - 8, s - 8);
  g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 2; g.strokeRect(20, 20, s - 40, s - 40);
  g.fillStyle = 'rgba(255,255,255,.75)'; [[26, 26], [s - 26, 26], [26, s - 26], [s - 26, s - 26]].forEach(p => { g.beginPath(); g.arc(p[0], p[1], 3.5, 0, TAU); g.fill(); });
});
const boostTex = makeTex((g, s) => {
  g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(4, 4, s - 8, s - 8);
  g.lineWidth = 13; g.lineJoin = 'miter';
  for (let k = 0; k < 3; k++) { const y = 34 + k * 34; g.beginPath(); g.moveTo(26, y + 16); g.lineTo(s / 2, y - 12); g.lineTo(s - 26, y + 16); g.stroke(); }
});
const padTex = makeTex((g, s) => {
  g.fillStyle = '#333'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(4, 4, s - 8, s - 8);
  g.lineWidth = 7; [44, 28, 12].forEach(r => { g.beginPath(); g.arc(s / 2, s / 2, r, 0, TAU); g.stroke(); });
});
const hazTex = makeTex((g, s) => {
  g.fillStyle = '#555'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#fff'; g.lineWidth = 16;
  for (let x = -s; x < s * 2; x += 40) { g.beginPath(); g.moveTo(x, s); g.lineTo(x + s, 0); g.stroke(); }
  g.lineWidth = 8; g.strokeRect(4, 4, s - 8, s - 8);
});
const glowTex = makeTex((g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});

/* ---- kafle, przeszkody, kryształy (instancje) ---- */
function inst(geo, mat, cap, colors) {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0;
  if (colors) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
  world.add(m); return m;
}
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const CAP_T = (ROWS_AHEAD + ROWS_BEHIND + 3) * N;
const tilesM = inst(boxGeo, new THREE.MeshBasicMaterial({ map: tileTex }), CAP_T, true);
const boostM = inst(boxGeo, new THREE.MeshBasicMaterial({ map: boostTex, color: 0xffc21a }), 96);
const padM = inst(boxGeo, new THREE.MeshBasicMaterial({ map: padTex, color: 0x7dff5a }), 96);
const barM = inst(boxGeo, new THREE.MeshBasicMaterial({ map: hazTex, color: 0xff3558 }), 320);
const spikeM = inst(new THREE.ConeGeometry(0.5, 1, 4), new THREE.MeshPhongMaterial({ color: 0xff4466, emissive: 0x8a0a2a, shininess: 60, flatShading: true }), 320);
const gemM = inst(new THREE.OctahedronGeometry(0.4, 0), new THREE.MeshPhongMaterial({ color: 0xffe07a, emissive: 0xb37a00, shininess: 80, flatShading: true }), 420);
boostTex.wrapT = THREE.RepeatWrapping;

const powerMeshes = {};
[[10, 0x4df3ff, new THREE.IcosahedronGeometry(0.48, 0)], [11, 0xff5cd0, new THREE.TorusGeometry(0.36, 0.15, 8, 18)], [12, 0xb6ff4d, new THREE.OctahedronGeometry(0.52, 0)]].forEach(([id, col, geo]) => {
  const g = new THREE.Group();
  const core = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.55, flatShading: true }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.04, 6, 32), new THREE.MeshBasicMaterial({ color: col }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.7, depthWrite: false, fog: false }));
  halo.scale.setScalar(3.6); g.add(core, ring, halo); g.visible = false; g.userData = { core, ring }; world.add(g); powerMeshes[id] = g;
});

/* ---- postać: mały kosmo-biegacz ---- */
const player = new THREE.Group(), rig = new THREE.Group(); player.add(rig); world.add(player);
const PM = {};
(() => {
  const white = new THREE.MeshLambertMaterial({ color: 0xd5dcf5, emissive: 0x141a33 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2c3170, emissive: 0x0c0e2a });
  const neon = new THREE.MeshBasicMaterial({ color: 0x4df3ff }), pink = new THREE.MeshBasicMaterial({ color: 0xff4fd8 });
  PM.neon = neon; PM.pink = pink;
  const add = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); (parent || rig).add(m); return m; };
  const body = add(new THREE.SphereGeometry(0.42, 20, 16), white, 0, 0.8, 0); body.scale.set(1, 1.15, 0.9);
  add(new THREE.BoxGeometry(0.48, 0.52, 0.26), dark, 0, 0.86, 0.36);
  add(new THREE.CylinderGeometry(0.07, 0.11, 0.18, 10), neon, -0.13, 0.54, 0.4);
  add(new THREE.CylinderGeometry(0.07, 0.11, 0.18, 10), neon, 0.13, 0.54, 0.4);
  add(new THREE.BoxGeometry(0.3, 0.07, 0.03), pink, 0, 0.95, 0.495);
  PM.head = new THREE.Group(); PM.head.position.set(0, 1.48, 0); rig.add(PM.head);
  add(new THREE.SphereGeometry(0.36, 20, 16), white, 0, 0, 0, PM.head);
  const visor = add(new THREE.SphereGeometry(0.29, 16, 12), neon, 0, 0, -0.2, PM.head); visor.scale.set(1, 0.7, 0.6);
  const bandM = add(new THREE.TorusGeometry(0.365, 0.035, 8, 24), neon, 0, 0.04, 0, PM.head); bandM.rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.015, 0.015, 0.36, 6), dark, 0.12, 0.5, 0.05, PM.head);
  PM.ball = add(new THREE.SphereGeometry(0.075, 10, 8), pink, 0.12, 0.7, 0.05, PM.head);
  const limb = (x, y, w, h, d, mat, foot) => {
    const p = new THREE.Group(); p.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.y = -h / 2; p.add(m);
    if (foot) { const f = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.09, d + 0.12), neon); f.position.set(0, -h, -0.05); p.add(f); }
    rig.add(p); return p;
  };
  PM.legL = limb(-0.17, 0.5, 0.17, 0.46, 0.2, dark, true); PM.legR = limb(0.17, 0.5, 0.17, 0.46, 0.2, dark, true);
  PM.armL = limb(-0.5, 1.06, 0.13, 0.42, 0.15, white); PM.armR = limb(0.5, 1.06, 0.13, 0.42, 0.15, white);
  rig.scale.setScalar(0.85);
})();
const shieldM = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), new THREE.MeshBasicMaterial({ color: 0x4df3ff, wireframe: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
shieldM.position.y = 0.95; shieldM.visible = false; player.add(shieldM);
const shadow = new THREE.Group();
(() => { const c = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false })); c.rotation.x = -Math.PI / 2; shadow.add(c); shadow.userData.c = c; world.add(shadow); })();

/* ---- cząsteczki ---- */
const PMAX = 2200;
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pSize = new Float32Array(PMAX);
const pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pMaxL = new Float32Array(PMAX), pSize0 = new Float32Array(PMAX);
let pHead = 0;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('pcolor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('psize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
const pMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: VH * PR * 0.75 } },
  vertexShader: 'attribute vec3 pcolor; attribute float psize; varying vec3 vC; uniform float uScale; void main(){ vC=pcolor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=psize*uScale/max(0.5,-mv.z); gl_Position=projectionMatrix*mv; }',
  fragmentShader: 'varying vec3 vC; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.05,d); gl_FragColor=vec4(vC*a,a); }',
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
const pPoints = new THREE.Points(pGeo, pMat); pPoints.frustumCulled = false; world.add(pPoints);
const tc = new THREE.Color();
function emit(x, y, z, vx, vy, vz, hex, size, life) {
  const i = pHead; pHead = (pHead + 1) % PMAX; const o = i * 3; tc.setHex(hex);
  pPos[o] = x; pPos[o + 1] = y; pPos[o + 2] = z; pVel[o] = vx; pVel[o + 1] = vy; pVel[o + 2] = vz;
  pCol[o] = tc.r; pCol[o + 1] = tc.g; pCol[o + 2] = tc.b; pSize0[i] = size; pLife[i] = life; pMaxL[i] = life;
}
function burst(x, y, z, hex, n, spd, size, life) {
  for (let k = 0; k < n; k++) {
    const u = Math.random() * 2 - 1, a = Math.random() * TAU, s = Math.sqrt(1 - u * u), v = spd * (0.25 + Math.random() * 0.75);
    emit(x, y, z, s * Math.cos(a) * v, s * Math.sin(a) * v, u * v, hex, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6));
  }
}
function updateParticles(dt, scroll) {
  const drag = Math.pow(0.05, dt);
  for (let i = 0; i < PMAX; i++) {
    if (pLife[i] <= 0) { pSize[i] = 0; continue; }
    pLife[i] -= dt; const o = i * 3;
    pPos[o] += pVel[o] * dt; pPos[o + 1] += pVel[o + 1] * dt; pPos[o + 2] += pVel[o + 2] * dt + scroll;
    pVel[o] *= drag; pVel[o + 1] *= drag; pVel[o + 2] *= drag;
    pSize[i] = pSize0[i] * Math.max(0, pLife[i] / pMaxL[i]);
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.pcolor.needsUpdate = true; pGeo.attributes.psize.needsUpdate = true;
}

/* ---- kosmos: gwiazdy, mgławice, planety, pył, smugi prędkości ---- */
const stars = (() => {
  const n = 3200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * TAU, s = Math.sqrt(1 - u * u), r = rand(500, 1100);
    pos[i * 3] = s * Math.cos(a) * r; pos[i * 3 + 1] = s * Math.sin(a) * r; pos[i * 3 + 2] = u * r;
    const b = rand(0.35, 1), t = Math.random();
    col[i * 3] = b * (t < 0.2 ? 1 : 0.8); col[i * 3 + 1] = b * 0.85; col[i * 3 + 2] = b * (t > 0.7 ? 1 : 0.85);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ size: 2 * PR, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: true }));
  m.frustumCulled = false; scene.add(m); return m;
})();
const nebulae = [];
for (let i = 0; i < 9; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x4466ff, blending: THREE.AdditiveBlending, transparent: true, opacity: rand(0.22, 0.4), depthWrite: false, fog: false }));
  const a = rand(0, TAU), r = rand(260, 620);
  sp.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.8, rand(-950, -350)); sp.scale.setScalar(rand(420, 820)); sp.userData.k = i % 2;
  scene.add(sp); nebulae.push(sp);
}
const planet = (() => {
  const tex = makeTex((g, w, h) => {
    for (let y = 0; y < h; y++) { const t = y / h, v = 0.5 + 0.5 * Math.sin(t * 34 + Math.sin(t * 9) * 3);
      g.fillStyle = `rgb(${90 + v * 120 | 0},${60 + v * 70 | 0},${150 + v * 90 | 0})`; g.fillRect(0, y, w, 1); }
    for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(255,255,255,${rand(0.03, 0.1)})`; g.beginPath(); g.ellipse(rand(0, w), rand(0, h), rand(8, 40), rand(2, 6), 0, 0, TAU); g.fill(); }
  }, 256, 128);
  const grp = new THREE.Group();
  const p = new THREE.Mesh(new THREE.SphereGeometry(80, 40, 28), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x2a1a55, fog: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(105, 160, 72), new THREE.MeshBasicMaterial({ color: 0xc9b6ff, transparent: true, opacity: 0.42, side: THREE.DoubleSide, fog: false, depthWrite: false }));
  ring.rotation.x = 1.25; ring.rotation.y = 0.3; grp.add(p, ring); grp.position.set(-330, 190, -820); grp.userData.p = p; scene.add(grp);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(26, 24, 16), new THREE.MeshLambertMaterial({ color: 0x6fd8ff, emissive: 0x0a2a44, fog: false }));
  moon.position.set(300, -170, -640); scene.add(moon);
  return grp;
})();
const endGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x66e8ff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
endGlow.position.set(0, 0, -(ROWS_AHEAD * TL) + 4); endGlow.scale.setScalar(50); scene.add(endGlow);

const DUST_N = 500, dustPos = new Float32Array(DUST_N * 3);
for (let i = 0; i < DUST_N; i++) { const a = rand(0, TAU), r = rand(9, 50); dustPos[i * 3] = Math.cos(a) * r; dustPos[i * 3 + 1] = Math.sin(a) * r; dustPos[i * 3 + 2] = rand(-340, 20); }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3).setUsage(THREE.DynamicDrawUsage));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glowTex, size: 0.9, color: 0xbfd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
dust.frustumCulled = false; scene.add(dust);

const LINE_N = 110, linePos = new Float32Array(LINE_N * 6), lineXYZ = new Float32Array(LINE_N * 3);
for (let i = 0; i < LINE_N; i++) { const a = rand(0, TAU), r = i % 3 === 0 ? rand(1.2, 4.2) : rand(7, 22); lineXYZ[i * 3] = Math.cos(a) * r; lineXYZ[i * 3 + 1] = Math.sin(a) * r; lineXYZ[i * 3 + 2] = rand(-150, 10); }
const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
const lineMat = new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const lines = new THREE.LineSegments(lineGeo, lineMat); lines.frustumCulled = false; scene.add(lines);

/* ---- postprocessing: bloom + aberracja + rozmycie prędkości ---- */
const composer = new EffectComposer(renderer);
composer.setPixelRatio(PR);
composer.setSize(VW, VH);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(VW, VH), 0.7, 0.5, 0.34));
const pass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uCA: { value: 0.003 }, uBlur: { value: 0 }, uVig: { value: 0.55 }, uFlash: { value: new THREE.Color(0xffffff) }, uFlashA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uCA,uBlur,uVig,uFlashA; uniform vec3 uFlash; varying vec2 vUv;
        void main(){ vec2 c=vUv-0.5; float d=length(c); vec2 off=c*d*uCA*4.0; vec3 col=vec3(0.0);
          for(int i=0;i<5;i++){ float f=float(i)/4.0; vec2 uv=vUv-c*uBlur*f*d*2.0;
            col.r+=texture2D(tDiffuse,uv+off).r; col.g+=texture2D(tDiffuse,uv).g; col.b+=texture2D(tDiffuse,uv-off).b; }
          col/=5.0; col*=1.0-uVig*smoothstep(0.3,0.9,d); col+=uFlash*uFlashA; gl_FragColor=vec4(col,1.0); }` });
    composer.addPass(pass);
composer.addPass(new OutputPass());
const fx = pass.uniforms;


const ro = new ResizeObserver(() => {
  VW = Math.max(1, root.clientWidth); VH = Math.max(1, root.clientHeight);
  renderer.setSize(VW, VH); composer.setSize(VW, VH);
  camera.aspect = VW / VH; camera.updateProjectionMatrix();
});
ro.observe(root);

/* =====================================================================
   HUD / UI
   ===================================================================== */
const ui = { hud: $('hud'), score: $('score'), mult: $('mult'), comboWrap: $('comboWrap'), comboBar: $('comboBar').firstElementChild, gem: $('gemVal'), best: $('bestTxt'),
  zone: $('zoneName'), dist: $('distTxt'), speed: $('speedVal'), turbo: $('turboBar'), turboI: $('turboBar').firstElementChild, popups: $('popups'), banner: $('banner'),
  chShield: $('chShield'), chMagnet: $('chMagnet'), chX2: $('chX2'), menu: $('menu'), over: $('over'), pause: $('pause') };
const cache = {};
function setTxt(el, key, v) { if (cache[key] !== v) { cache[key] = v; el.textContent = v; } }
function popup(text, cls, x, y) {
  const d = document.createElement('div'); d.className = 'rn-pop ' + (cls || '').split(' ').filter(Boolean).map(c => 'rn-' + c).join(' '); d.textContent = text;
  d.style.left = (x === undefined ? 50 + rand(-9, 9) : x) + '%'; d.style.top = (y === undefined ? 60 + rand(-4, 4) : y) + '%';
  ui.popups.appendChild(d); while (ui.popups.childElementCount > 12) ui.popups.firstElementChild.remove();
  setTimeout(() => d.remove(), 900);
}
function banner(title, sub, color) {
  const b = ui.banner; b.style.setProperty('--bc', color || '#4df3ff');
  b.children[0].textContent = title; b.children[1].textContent = sub || '';
  b.classList.remove('rn-show'); void b.offsetWidth; b.classList.add('rn-show');
}
function flash(hex, a) { G.flash = Math.max(G.flash, a); if (fx) fx.uFlash.value.setHex(hex); }
const fmt = n => Math.floor(n).toLocaleString('pl-PL');
function hexCss(h) { return '#' + h.toString(16).padStart(6, '0'); }

/* =====================================================================
   LOGIKA GRY
   ===================================================================== */
const floorR = th => APO / Math.cos(th - Math.round(th / DTH) * DTH);
function tileAt(th, z) { const r = getRow(Math.floor(z / TL)); if (!r) return 1; return r.tile[mod(Math.round(th / DTH), N)]; }
function support() {
  const c = tileAt(P.th, G.dist); if (c) return c;
  const a = 0.3 / APO;
  return tileAt(P.th - a, G.dist) || tileAt(P.th + a, G.dist) || tileAt(P.th, G.dist + 0.35) || tileAt(P.th, G.dist - 0.35);
}
const pp = { x: 0, y: 0, ux: 0, uy: 0 };
function playerXY(up) { const rho = floorR(P.th) - P.h - (up || 0), s = Math.sin(P.th), c = Math.cos(P.th); pp.x = rho * s; pp.y = -rho * c; pp.ux = -s; pp.uy = c; return pp; }
const itemX = (l, h) => (APO - h) * LS[l], itemY = (l, h) => -(APO - h) * LC[l];
const flyers = [];
const MULT_AT = [0, 5, 12, 21, 32, 45, 60, 78, 98], COMBO_T = 3.2;

function startGame() {
  hooks.onStart();
  Snd.init(); Snd.setMode('game'); Snd.setZone(0); Snd.click();
  resetGen(false);
  Object.assign(G, { state: 'playing', dist: 0, jp: 0, speed: 9, score: 0, gems: 0, combo: 0, comboT: 0, mult: 1, maxCombo: 0, zone: 0, turbo: 0, shield: false,
    magnet: 0, x2: 0, inv: 0, shake: 0, deadT: 0, fallT: 0, camTh: 0, camH: 0, popAcc: 0, popT: 0, energy: 0 });
  Object.assign(P, { th: 0, vth: 0, h: 0, vy: 0, grounded: true, fallen: false, coyote: 0, jumpBuf: 0, pad: false, air: 0, airHoles: 0, squash: 0 });
  flyers.length = 0; pLife.fill(0);
  ensureRows(); setPalette(0, true);
  player.visible = true; rig.visible = true;
  ui.menu.classList.add('rn-hidden'); ui.over.classList.add('rn-hidden'); ui.pause.classList.add('rn-hidden'); ui.hud.classList.remove('rn-hidden');
  $('bPause').classList.remove('rn-hidden'); $('touch').classList.add('rn-live');
  root.querySelectorAll('.rn-confetti').forEach(e => e.remove());
  flash(0xffffff, 0.5); banner('START!', ZONES[0].name, hexCss(ZONES[0].glow));
}
function addScore(p) { G.score += p; }
function comboUp() {
  G.combo++; G.comboT = COMBO_T; if (G.combo > G.maxCombo) G.maxCombo = G.combo;
  let m = 1; while (m < 9 && G.combo >= MULT_AT[m]) m++;
  if (m > G.mult) { G.mult = m; G.multPunch = 1; popup('COMBO ×' + m + '!', 'big pk', 50, 40); Snd.combo(m); flash(TRAIL[m - 1], 0.12); G.shake = Math.max(G.shake, 0.2); }
}
function collectGem(x, y, z) {
  G.gems++; comboUp();
  const pts = 15 * G.mult * (G.x2 > 0 ? 2 : 1); addScore(pts); G.popAcc += pts; G.scorePunch = Math.min(1, G.scorePunch + 0.45);
  Snd.gem(G.combo); burst(x, y, z, 0xffd23c, 7, 8, 0.36, 0.42); burst(x, y, z, 0xffffff, 2, 3, 0.4, 0.22);
}
function collectPower(it) {
  const p = playerXY(0.8);
  if (it === 10) { G.shield = true; banner('TARCZA', 'JEDNO ZDERZENIE GRATIS', '#4df3ff'); burst(p.x, p.y, 0, 0x4df3ff, 50, 12, 0.6, 0.7); }
  else if (it === 11) { G.magnet = 9; banner('MAGNES', 'KRYSZTAŁY LECĄ DO CIEBIE', '#ff5cd0'); burst(p.x, p.y, 0, 0xff5cd0, 50, 12, 0.6, 0.7); }
  else { G.x2 = 10; banner('PUNKTY ×2', 'PRZEZ 10 SEKUND', '#b6ff4d'); burst(p.x, p.y, 0, 0xb6ff4d, 50, 12, 0.6, 0.7); }
  Snd.power(); flash(0xffffff, 0.3); addScore(100 * G.mult); comboUp();
}
function startTurbo() {
  G.turbo = TURBO_DIST; banner('TURBO!', 'ROZBIJAJ PRZESZKODY', '#ffd23c'); Snd.boost(); flash(0xffd23c, 0.45); G.shake = Math.max(G.shake, 0.6);
  const p = playerXY(0.8); burst(p.x, p.y, 0, 0xffd23c, 60, 16, 0.7, 0.8);
}
function smash(r, l, j, bonus) {
  const hh = r.obs[l] === 1 ? 0.6 : 1.8; r.obs[l] = 0; r.nobs--;
  const x = itemX(l, hh), y = itemY(l, hh), z = -((j + 0.5) * TL - G.dist);
  burst(x, y, z, 0xff3558, 26, 14, 0.7, 0.6); burst(x, y, z, 0xffffff, 10, 9, 0.6, 0.4); burst(x, y, z, 0xffa13c, 12, 11, 0.6, 0.5);
  G.shake = Math.max(G.shake, 0.45); Snd.smash();
  if (bonus) { const pts = 100 * G.mult * (G.x2 > 0 ? 2 : 1); addScore(pts); comboUp(); popup('ROZBITE! +' + pts, 'cy'); }
}
function die(cause) {
  if (G.state !== 'playing') return;
  G.state = 'dying'; G.deadT = 0; G.cause = cause; Snd.setMode('dead');
  if (cause === 'crash') {
    Snd.crash(); G.shake = 1.4; flash(0xff3558, 0.7);
    const p = playerXY(0.8); burst(p.x, p.y, 0, 0x4df3ff, 70, 18, 0.8, 1.1); burst(p.x, p.y, 0, 0xffffff, 40, 12, 0.7, 0.9); burst(p.x, p.y, 0, 0xff4fd8, 40, 15, 0.8, 1.0);
    rig.visible = false; shieldM.visible = false;
  } else { flash(0x8f6bff, 0.4); }
}
function gameOver() {
  G.state = 'over'; G.overT = 0; G.finalScore = Math.floor(G.score);
  const rec = G.finalScore > G.best;
  if (rec) { G.best = G.finalScore; try { localStorage.setItem('superTurboRun3D.best', String(G.best)); } catch (e) {} }
  $('overCause').textContent = G.cause === 'crash' ? 'ZDERZENIE Z PRZESZKODĄ' : 'POCHŁONĘŁA CIĘ PRÓŻNIA';
  $('stDist').textContent = fmt(G.dist) + ' m'; $('stGems').textContent = fmt(G.gems); $('stCombo').textContent = fmt(G.maxCombo); $('stZone').textContent = G.zone + 1;
  $('newRec').classList.toggle('rn-hidden', !rec || G.finalScore === 0);
  ui.over.classList.remove('rn-hidden'); ui.hud.classList.add('rn-hidden'); $('bPause').classList.add('rn-hidden'); $('touch').classList.remove('rn-live');
  if (rec && G.finalScore > 0) { confetti(); Snd.power(); }
  hooks.onOver({ distance: Math.floor(G.dist), score: G.finalScore, gems: G.gems, zone: G.zone + 1, record: rec && G.finalScore > 0 });
}
function confetti() {
  const cols = ['#4df3ff', '#ff4fd8', '#ffd23c', '#8f6bff', '#b6ff4d', '#fff'];
  for (let i = 0; i < 90; i++) { const d = document.createElement('div'); d.className = 'rn-confetti'; d.style.left = rand(0, 100) + '%'; d.style.background = pick(cols);
    d.style.animationDuration = rand(1.6, 3.6) + 's'; d.style.animationDelay = rand(0, 0.9) + 's'; d.style.transform = `rotate(${rand(0, 360)}deg)`; root.appendChild(d);
    setTimeout(() => d.remove(), 5000); }
}
function newZone(z) {
  G.zone = z; const Z = ZONES[z % ZONES.length];
  banner('STREFA ' + (z + 1), Z.name, hexCss(Z.glow)); Snd.zone(); Snd.setZone(z); flash(Z.glow, 0.5); setPalette(z, false);
  const pts = 250 * z; addScore(pts); popup('BONUS +' + pts, 'big', 50, 46); G.shake = Math.max(G.shake, 0.4);
}
function nearMiss(pr) {
  if (G.turbo > 0) return;
  for (let l = 0; l < N; l++) {
    if (!pr.obs[l]) continue;
    const dl = Math.abs(wrapPi(l * DTH - P.th)) * APO;
    if (dl < TW * 1.02) {
      const pts = 50 * G.mult * (G.x2 > 0 ? 2 : 1); addScore(pts); G.comboT = COMBO_T; popup('O WŁOS! +' + pts, 'cy', 50 + rand(-6, 6), 52); Snd.near(); G.scorePunch = 1;
      return;
    }
  }
}
function enterRow(j) {
  const r = getRow(j);
  if (r && r.special === 3 && G.turbo < TURBO_DIST - 15) startTurbo();
  if (!P.grounded && !tileAt(P.th, (j + 0.5) * TL)) P.airHoles++;
  const pr = getRow(j - 1); if (pr && pr.nobs > 0 && !P.fallen) nearMiss(pr);
  const z = Math.floor(G.dist / ZONE_LEN); if (z > G.zone) newZone(z);
}
function launch(v, pad) {
  P.vy = v; P.grounded = false; P.pad = pad; P.coyote = 0; P.jumpBuf = 0; P.air = 0; P.airHoles = 0; if (P.h < 0) P.h = 0;
  const p = playerXY(0.1);
  if (pad) { Snd.pad(); banner('MEGA SKOK!', '', '#7dff5a'); burst(p.x, p.y, 0, 0x7dff5a, 40, 12, 0.6, 0.7); flash(0x7dff5a, 0.25); G.shake = Math.max(G.shake, 0.35); }
  else { Snd.jump(); burst(p.x, p.y, 0, 0xbfe8ff, 8, 5, 0.4, 0.35); }
  P.squash = -0.7;
}
function land(sup) {
  P.h = 0; P.vy = 0; P.grounded = true; P.pad = false; P.squash = 1; Snd.land();
  const p = playerXY(0.05); burst(p.x, p.y, 0, 0xbfe8ff, 10, 6, 0.4, 0.35);
  if (P.airHoles >= 2) { const pts = P.airHoles * 15 * G.mult; addScore(pts); popup('CZYSTY SKOK +' + pts, '', 50 + rand(-6, 6), 56); }
  P.airHoles = 0;
  if (sup === 4) launch(PAD_V, true);
}
function hitObstacles() {
  for (let j = G.jp - 1; j <= G.jp + 1; j++) {
    const r = getRow(j); if (!r || !r.nobs) continue;
    if (Math.abs(G.dist - (j + 0.5) * TL) > 0.85) continue;
    for (let l = 0; l < N; l++) {
      const o = r.obs[l]; if (!o) continue;
      if (Math.abs(wrapPi(l * DTH - P.th)) * APO > TW * 0.46 + 0.28) continue;
      if (P.h > (o === 1 ? 1.15 : 4.4) - 0.25) continue;
      if (G.turbo > 0) smash(r, l, j, true);
      else if (G.inv > 0) smash(r, l, j, false);
      else if (G.shield) { G.shield = false; G.inv = 1.3; smash(r, l, j, false); Snd.shieldBreak(); flash(0x4df3ff, 0.5); popup('TARCZA PĘKŁA!', 'cy', 50, 48); }
      else { die('crash'); return; }
    }
  }
}
function collectItems() {
  const jr = G.magnet > 0 ? 7 : 1;
  for (let j = G.jp - 1; j <= G.jp + jr; j++) {
    const r = getRow(j); if (!r || !r.nitem) continue;
    const zc = (j + 0.5) * TL, dz = zc - G.dist;
    for (let l = 0; l < N; l++) {
      const it = r.item[l]; if (!it) continue;
      const dl = Math.abs(wrapPi(l * DTH - P.th)) * APO, dh = Math.abs(r.itemH[l] - (P.h + 0.75));
      if (Math.abs(dz) < 1.35 && dl < 1.35 && dh < 1.45) {
        r.item[l] = 0; r.nitem--;
        if (it === 1) collectGem(itemX(l, r.itemH[l]), itemY(l, r.itemH[l]), -dz); else collectPower(it);
      } else if (G.magnet > 0 && it === 1 && dz > -1 && dl < TW * 3.3) {
        r.item[l] = 0; r.nitem--; flyers.push({ x: itemX(l, r.itemH[l]), y: itemY(l, r.itemH[l]), s: zc, t: 0 });
      }
    }
  }
}
function stepPlay(dt) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  P.vth += (dir * latSpeed(G.speed) / APO - P.vth) * Math.min(1, dt * (P.grounded ? 16 : 11));
  P.th += P.vth * dt;
  G.dist += G.speed * dt;
  P.jumpBuf -= dt; P.coyote -= dt;
  if (P.jumpBuf > 0 && !P.fallen && (P.grounded || P.coyote > 0)) launch(JUMP_V, false);
  if (!P.grounded) {
    let g = GRAV; if (P.vy > 0 && !input.jump && !P.pad) g *= 2;
    P.vy -= g * dt; P.h += P.vy * dt; P.air += dt;
  }
  const sup = P.fallen ? 0 : support();
  if (P.grounded) {
    if (!sup) { P.grounded = false; P.coyote = 0.1; P.vy = 0; P.pad = false; P.air = 0; P.airHoles = 0; }
    else if (sup === 4) launch(PAD_V, true);
  } else if (!P.fallen && P.vy <= 0 && P.h <= 0) {
    if (sup && P.h > -0.25) land(sup);
    else if (P.h < -0.25) { P.fallen = true; G.fallT = 0; Snd.fall(); }
  }
  if (P.fallen) { G.fallT += dt; if (G.fallT > 0.7) { die('void'); return; } }
  const nj = Math.floor(G.dist / TL);
  while (G.jp < nj) { G.jp++; enterRow(G.jp); }
  if (!P.fallen) { hitObstacles(); if (G.state === 'playing') collectItems(); }
}
function update(dt) {
  G.time += dt;
  if (G.state === 'menu') {
    G.speed = 15; G.dist += G.speed * dt; P.th += dt * 0.22; P.vth = 0.6; G.jp = Math.floor(G.dist / TL); ensureRows(); return;
  }
  if (G.state === 'playing') {
    const target = speedAt(G.dist) * (G.turbo > 0 ? 1.35 : 1);
    G.speed += (target - G.speed) * Math.min(1, dt * (G.turbo > 0 ? 5 : 1.6));
    const n = Math.max(1, Math.ceil(G.speed * dt / 0.55));
    for (let k = 0; k < n && G.state === 'playing'; k++) stepPlay(dt / n);
    ensureRows();
    addScore(G.speed * dt * 0.4 * (G.x2 > 0 ? 2 : 1));
    if (G.turbo > 0) G.turbo -= G.speed * dt;
    G.magnet -= dt; G.x2 -= dt; G.inv -= dt;
    if (G.combo > 0) { G.comboT -= dt; if (G.comboT <= 0) { if (G.mult > 1) popup('COMBO PRZERWANE', 'lost', 50, 30); G.combo = 0; G.mult = 1; } }
    G.popT -= dt; if (G.popAcc > 0 && G.popT <= 0) { popup('+' + G.popAcc); G.popAcc = 0; G.popT = 0.3; }
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i], p = playerXY(0.8), k = 1 - Math.exp(-dt * (10 + f.t * 40));
      f.t += dt; f.x += (p.x - f.x) * k; f.y += (p.y - f.y) * k; f.s += (G.dist - f.s) * k;
      if (f.t > 0.5 || (Math.abs(f.s - G.dist) < 1 && Math.hypot(f.x - p.x, f.y - p.y) < 1)) { flyers.splice(i, 1); collectGem(p.x, p.y, 0); }
    }
  } else if (G.state === 'dying') {
    G.deadT += dt;
    if (G.cause === 'crash') G.speed *= Math.exp(-dt * 3.5);
    else { P.vy -= GRAV * dt; P.h += P.vy * dt; }
    G.dist += G.speed * dt; G.jp = Math.floor(G.dist / TL); ensureRows();
    if (G.deadT > (G.cause === 'crash' ? 0.75 : 0.45)) gameOver();
  } else if (G.state === 'over') {
    G.speed *= Math.exp(-dt * 2); G.dist += G.speed * dt; G.jp = Math.floor(G.dist / TL); ensureRows();
  }
}

/* =====================================================================
   SYNCHRONIZACJA SCENY
   ===================================================================== */
const pal = { a: new THREE.Color(), b: new THREE.Color(), fog: new THREE.Color(), glow: new THREE.Color(), n1: new THREE.Color(), n2: new THREE.Color() };
const palT = { a: new THREE.Color(), b: new THREE.Color(), fog: new THREE.Color(), glow: new THREE.Color(), n1: new THREE.Color(), n2: new THREE.Color() };
function setPalette(z, snap) {
  const Z = ZONES[z % ZONES.length];
  for (const k in palT) { palT[k].setHex(Z[k]); if (snap) pal[k].copy(palT[k]); }
  ui.zone.style.color = hexCss(Z.glow);
}
setPalette(0, true);

function putBox(arr, idx, l, zc, rc, sx, sy, sz) {
  const o = idx * 16, c = LC[l], s = LS[l];
  arr[o] = c * sx; arr[o + 1] = s * sx; arr[o + 2] = 0; arr[o + 3] = 0;
  arr[o + 4] = -s * sy; arr[o + 5] = c * sy; arr[o + 6] = 0; arr[o + 7] = 0;
  arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = sz; arr[o + 11] = 0;
  arr[o + 12] = s * rc; arr[o + 13] = -c * rc; arr[o + 14] = zc; arr[o + 15] = 1;
}
const dummy = new THREE.Object3D(); dummy.rotation.order = 'ZYX';
let trailAcc = 0;

function syncScene(dt) {
  const t = G.time, playing = G.state === 'playing';
  // paleta
  const pk = Math.min(1, dt * 1.6);
  for (const k in pal) pal[k].lerp(palT[k], pk);
  scene.fog.color.copy(pal.fog); renderer.setClearColor(pal.fog);
  // rytm
  if (Snd.live) { if (Snd.pollBeat()) G.beat = 1; } else { G.fakeBeat += dt; if (G.fakeBeat > 0.484) { G.fakeBeat = 0; G.beat = 1; } }
  G.beat = Math.max(0, G.beat - dt * 2.3);
  G.energy += ((G.mult - 1) / 8 - G.energy) * Math.min(1, dt * 3); Snd.setEnergy(G.energy);
  const wavePos = (1 - G.beat) * 30;

  // ---- kafle ----
  let nT = 0, nB = 0, nP = 0, nO = 0, nS = 0, nG = 0;
  const TA = tilesM.instanceMatrix.array, TC = tilesM.instanceColor.array, BA = boostM.instanceMatrix.array, PA = padM.instanceMatrix.array,
    OA = barM.instanceMatrix.array, SA = spikeM.instanceMatrix.array;
  const enc = x => x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055, lin = x => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  const ar = enc(pal.a.r), ag = enc(pal.a.g), ab = enc(pal.a.b), br = enc(pal.b.r), bg = enc(pal.b.g), bb = enc(pal.b.b);   // paleta w przestrzeni wyświetlacza: kolor kafla liczony jak w oryginale, potem do liniowej
  const j0 = Math.max(0, G.jp - ROWS_BEHIND), j1 = G.jp + ROWS_AHEAD;
  const obsPulse = 1 + 0.12 * Math.sin(t * 9);
  for (const id in powerMeshes) powerMeshes[id].visible = false;
  for (let j = j0; j <= j1; j++) {
    const r = getRow(j); if (!r) continue;
    const zc = -((j + 0.5) * TL - G.dist), ahead = j - G.jp;
    let s = clamp((ROWS_AHEAD - ahead) / 12, 0, 1); s = 1 - (1 - s) * (1 - s);
    const off = (1 - s) * 7;
    const wave = Math.max(0, 1 - Math.abs(ahead - wavePos) / 8) * (0.35 + G.beat * 0.65) * clamp((ahead - 2) / 12, 0, 1);   // łagodna fala, wygaszona przy graczu
    const bright = 0.56 + 0.2 * G.energy + 0.35 * wave;
    for (let l = 0; l < N; l++) {
      const tt = r.tile[l];
      if (tt) {
        if (tt === 1 && nT < CAP_T) {
          let gl = r.glow[l]; if (gl > 0) r.glow[l] = gl = Math.max(0, gl - dt * 4.5);
          const f = 0.5 + 0.5 * Math.sin(l * DTH * 2 + j * 0.2 + t * 0.7), bq = bright * (((l + j) & 1) ? 1 : 0.78), o = nT * 3;
          const cr = ar + (br - ar) * f, cg = ag + (bg - ag) * f, cb = ab + (bb - ab) * f, gk = bq + gl * 0.9;
          TC[o] = lin(cr * gk + gl * 0.12); TC[o + 1] = lin(cg * gk + gl * 0.12); TC[o + 2] = lin(cb * gk + gl * 0.12);
          putBox(TA, nT++, l, zc, APO + TT / 2 + off, TW * 0.955 * s, TT, TL * 0.955 * s);
        } else if (tt === 3 && nB < 96) putBox(BA, nB++, l, zc, APO + TT / 2 + off, TW * 0.955 * s, TT * 1.3, TL * 0.955 * s);
        else if (tt === 4 && nP < 96) putBox(PA, nP++, l, zc, APO + TT / 2 + off - 0.06, TW * 0.955 * s, TT * 1.3, TL * 0.955 * s);
      }
      const o = r.obs[l];
      if (o === 1 && nO < 320) putBox(OA, nO++, l, zc, APO - 0.575 * s, TW * 0.9 * s, 1.15 * s * obsPulse, 0.9 * s);
      else if (o === 2 && nS < 320) putBox(SA, nS++, l, zc, APO - 2.2 * s, TW * 0.82 * s, 4.4 * s, 1.5 * s);
      const it = r.item[l];
      if (it === 1 && nG < 420) {
        const h = r.itemH[l] + Math.sin(t * 4 + j * 0.7) * 0.1;
        dummy.position.set(itemX(l, h), itemY(l, h), zc); dummy.rotation.set(0, t * 3 + j * 0.5, l * DTH); dummy.scale.setScalar(s * (1 + G.beat * 0.25));
        dummy.updateMatrix(); dummy.matrix.toArray(gemM.instanceMatrix.array, nG++ * 16);
      } else if (it >= 10) {
        const m = powerMeshes[it], h = r.itemH[l] + Math.sin(t * 3) * 0.15;
        m.visible = true; m.position.set(itemX(l, h), itemY(l, h), zc); m.rotation.z = l * DTH;
        m.userData.core.rotation.set(t * 1.7, t * 2.3, 0); m.userData.ring.rotation.set(Math.PI / 2 + Math.sin(t * 2) * 0.5, t * 1.5, 0); m.scale.setScalar(s * (1 + G.beat * 0.15));
      }
    }
  }
  for (const f of flyers) { if (nG >= 420) break; dummy.position.set(f.x, f.y, -(f.s - G.dist)); dummy.rotation.set(t * 9, t * 7, 0); dummy.scale.setScalar(0.8); dummy.updateMatrix(); dummy.matrix.toArray(gemM.instanceMatrix.array, nG++ * 16); }
  tilesM.count = nT; boostM.count = nB; padM.count = nP; barM.count = nO; spikeM.count = nS; gemM.count = nG;
  tilesM.instanceMatrix.needsUpdate = true; tilesM.instanceColor.needsUpdate = true; boostM.instanceMatrix.needsUpdate = true; padM.instanceMatrix.needsUpdate = true;
  barM.instanceMatrix.needsUpdate = true; spikeM.instanceMatrix.needsUpdate = true; gemM.instanceMatrix.needsUpdate = true;
  boostTex.offset.y = (t * 2.2) % 1;
  boostM.material.color.setHex(0xffc21a).multiplyScalar(0.85 + 0.35 * Math.abs(Math.sin(t * 8)));
  padM.material.color.setHex(0x7dff5a).multiplyScalar(0.8 + 0.4 * Math.abs(Math.sin(t * 6)));
  barM.material.color.setHex(0xff3558).multiplyScalar(0.85 + 0.3 * G.beat);

  // ---- postać ----
  const p = playerXY(0);
  player.position.set(p.x, p.y, 0); player.rotation.z = P.th;
  const run = G.state === 'menu' || playing;
  if (run) P.phase += dt * (6 + G.speed * 0.42);
  P.squash += (0 - P.squash) * Math.min(1, dt * 11);
  const sq = P.squash, base = 0.85;
  rig.scale.set(base * (1 + sq * 0.22), base * (1 - sq * 0.28), base * (1 + sq * 0.22));
  rig.rotation.z += (-P.vth * 0.22 - rig.rotation.z) * Math.min(1, dt * 12);
  rig.rotation.x = -0.18 - Math.min(0.2, (G.speed - V0) * 0.006) + (P.grounded ? 0 : -P.vy * 0.012);
  const sw = Math.sin(P.phase);
  if (P.grounded) {
    PM.legL.rotation.x = sw * 1.0; PM.legR.rotation.x = -sw * 1.0; PM.armL.rotation.x = -sw * 0.9; PM.armR.rotation.x = sw * 0.9;
    PM.armL.rotation.z = -0.12; PM.armR.rotation.z = 0.12; rig.position.y = Math.abs(Math.cos(P.phase)) * 0.07;
    if (playing) { const r = getRow(G.jp); if (r) r.glow[mod(Math.round(P.th / DTH), N)] = 1; }
  } else {
    PM.legL.rotation.x += (0.7 - PM.legL.rotation.x) * 0.3; PM.legR.rotation.x += (-0.5 - PM.legR.rotation.x) * 0.3;
    PM.armL.rotation.x = PM.armR.rotation.x = -0.4; PM.armL.rotation.z += (-2.3 - PM.armL.rotation.z) * 0.3; PM.armR.rotation.z += (2.3 - PM.armR.rotation.z) * 0.3; rig.position.y = 0;
  }
  PM.head.rotation.z = -P.vth * 0.1; PM.ball.scale.setScalar(1 + G.beat * 0.9);
  const tcol = G.turbo > 0 ? 0xffd23c : TRAIL[G.mult - 1];
  PM.neon.color.setHex(tcol);
  shieldM.visible = G.shield && rig.visible; shieldM.rotation.set(t * 0.8, t * 1.3, 0); shieldM.material.opacity = 0.35 + 0.25 * Math.sin(t * 6);
  if (playing && G.inv > 0) rig.visible = Math.floor(t * 20) % 2 === 0; else if (playing) rig.visible = true;
  const supNow = !P.fallen && tileAt(P.th, G.dist);
  shadow.visible = !!supNow && rig.visible && P.h >= 0;
  if (shadow.visible) { const fr = floorR(P.th) - 0.03; shadow.position.set(fr * Math.sin(P.th), -fr * Math.cos(P.th), 0.05); shadow.rotation.z = P.th; const ss = 1 / (1 + P.h * 0.45); shadow.scale.setScalar(ss); shadow.userData.c.material.opacity = 0.5 * ss; }
  pLight.position.set(p.x + p.ux * 1.6, p.y + p.uy * 1.6, 0.5); pLight.color.copy(pal.glow);

  // ---- cząsteczki: ślad plecaka ----
  if (run && rig.visible) {
    trailAcc += dt * (G.turbo > 0 ? 150 : 38 + G.energy * 40);
    const q = playerXY(0.5);
    while (trailAcc >= 1) {
      trailAcc--;
      const side = (Math.random() < 0.5 ? -1 : 1) * 0.12, tx = Math.cos(P.th), ty = Math.sin(P.th);
      emit(q.x + tx * side + rand(-0.05, 0.05), q.y + ty * side + rand(-0.05, 0.05), 0.4 + rand(0, 0.5), rand(-0.6, 0.6), rand(-0.6, 0.6), rand(0, 2), Math.random() < 0.15 ? 0xffffff : tcol, G.turbo > 0 ? 0.36 : 0.2, rand(0.2, 0.42));
    }
  }
  updateParticles(dt, G.speed * dt * 0.85);

  // ---- kamera ----
  G.camTh += (P.th - G.camTh) * (1 - Math.exp(-dt * 7));
  world.rotation.z = -G.camTh;
  G.camH += (Math.max(0, P.h) - G.camH) * (1 - Math.exp(-dt * 6));
  const portrait = Math.max(0, 1 - camera.aspect);
  const fovT = 72 + portrait * 34 + (G.speed - V0) * 0.5 + (G.turbo > 0 ? 13 : 0);
  camera.fov += (fovT - camera.fov) * (1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix();
  pMat.uniforms.uScale.value = VH * PR * 0.55 / Math.tan(camera.fov * Math.PI / 360);
  G.shake = Math.max(0, G.shake - dt * 2.2);
  const sh = G.shake * G.shake, sx = (Math.random() - 0.5) * sh * 0.9, sy = (Math.random() - 0.5) * sh * 0.9;
  const menu = G.state === 'menu';
  camera.position.set(sx + (menu ? Math.sin(t * 0.4) * 1.6 : 0), -APO + 2.55 + G.camH * 0.45 + sy + (menu ? 0.5 : 0), 6.4 + (G.turbo > 0 ? 0.8 : 0));
  camera.lookAt(sx * 0.3, -APO + 1.5 + G.camH * 0.35, -16);
  camera.rotateZ(-P.vth * 0.035 + (Math.random() - 0.5) * sh * 0.06);

  // ---- kosmos ----
  stars.rotation.z = -G.camTh * 0.25 + t * 0.004;
  for (const nb of nebulae) { nb.material.color.copy(nb.userData.k ? pal.n1 : pal.n2); }
  planet.userData.p.rotation.y = t * 0.03;
  endGlow.material.color.copy(pal.glow); endGlow.scale.setScalar(46 + G.beat * 22);
  const dz = G.speed * dt * 1.1;
  for (let i = 0; i < DUST_N; i++) { let z = dustPos[i * 3 + 2] + dz; if (z > 20) z -= 360; dustPos[i * 3 + 2] = z; }
  dustGeo.attributes.position.needsUpdate = true;
  const turboK = G.turbo > 0 ? 1 : 0, ll = 1.5 + G.speed * 0.22 * (1 + turboK * 1.2), lz = G.speed * dt * 2.2;
  for (let i = 0; i < LINE_N; i++) {
    let z = lineXYZ[i * 3 + 2] + lz; if (z > 12) z -= 165; lineXYZ[i * 3 + 2] = z;
    const o = i * 6, x = lineXYZ[i * 3], y = lineXYZ[i * 3 + 1];
    linePos[o] = x; linePos[o + 1] = y; linePos[o + 2] = z; linePos[o + 3] = x; linePos[o + 4] = y; linePos[o + 5] = z - ll;
  }
  lineGeo.attributes.position.needsUpdate = true;
  lineMat.opacity += (clamp((G.speed - 14) / 45, 0.06, 0.4) + turboK * 0.45 - lineMat.opacity) * Math.min(1, dt * 5);

  // ---- efekty ekranowe ----
  G.flash = Math.max(0, G.flash - dt * 1.9);
  if (fx) {
    fx.uFlashA.value = G.flash * 0.6;
    fx.uCA.value += ((0.003 + turboK * 0.012 + sh * 0.03 + G.beat * 0.002) - fx.uCA.value) * Math.min(1, dt * 8);
    fx.uBlur.value += ((turboK * 0.09 + clamp((G.speed - 34) / 16, 0, 1) * 0.03) - fx.uBlur.value) * Math.min(1, dt * 5);
  }
}

function syncHud(dt) {
  if (G.state === 'over') {
    G.overT += dt; const k = clamp(G.overT / 0.9, 0, 1), e = 1 - Math.pow(1 - k, 3);
    setTxt($('overScore'), 'os', fmt(G.finalScore * e));
    return;
  }
  if (G.state !== 'playing' && G.state !== 'dying') return;
  setTxt(ui.score, 'sc', fmt(G.score));
  G.scorePunch = Math.max(0, G.scorePunch - dt * 5); G.multPunch = Math.max(0, G.multPunch - dt * 3);
  ui.score.style.transform = `scale(${1 + G.scorePunch * 0.16})`;
  ui.mult.style.transform = `scale(${1 + G.multPunch * 0.9}) rotate(${-G.multPunch * 10}deg)`;
  setTxt(ui.mult, 'mu', '×' + G.mult);
  const mc = hexCss(TRAIL[G.mult - 1]); if (cache.mc !== mc) { cache.mc = mc; ui.mult.style.color = mc; }
  const on = G.combo > 0; if (cache.con !== on) { cache.con = on; ui.comboWrap.classList.toggle('rn-on', on); }
  ui.comboBar.style.width = (on ? clamp(G.comboT / COMBO_T, 0, 1) * 100 : 0) + '%';
  setTxt(ui.gem, 'ge', fmt(G.gems));
  setTxt(ui.best, 'be', 'REKORD ' + fmt(Math.max(G.best, G.score)));
  setTxt(ui.zone, 'zo', 'STREFA ' + (G.zone + 1) + ' · ' + ZONES[G.zone % ZONES.length].name);
  setTxt(ui.dist, 'di', fmt(G.dist) + ' m');
  setTxt(ui.speed, 'sp', Math.round(G.speed * 5));
  const tb = G.turbo > 0; if (cache.tb !== tb) { cache.tb = tb; ui.turbo.classList.toggle('rn-on', tb); }
  if (tb) ui.turboI.style.width = clamp(G.turbo / TURBO_DIST, 0, 1) * 100 + '%';
  if (cache.sh !== G.shield) { cache.sh = G.shield; ui.chShield.classList.toggle('rn-on', G.shield); }
  const mg = G.magnet > 0; if (cache.mg !== mg) { cache.mg = mg; ui.chMagnet.classList.toggle('rn-on', mg); }
  if (mg) ui.chMagnet.firstElementChild.style.width = G.magnet / 9 * 100 + '%';
  const x2 = G.x2 > 0; if (cache.x2 !== x2) { cache.x2 = x2; ui.chX2.classList.toggle('rn-on', x2); }
  if (x2) ui.chX2.firstElementChild.style.width = G.x2 / 10 * 100 + '%';
}

/* =====================================================================
   STEROWANIE
   ===================================================================== */
function pressJump() { input.jump = true; P.jumpBuf = 0.14; }
function primary() {
  if (G.state === 'menu') startGame();
  else if (G.state === 'over' && G.overT > 0.55) startGame();
  else if (G.state === 'playing') pressJump();
}
function togglePause() {
  if (G.state === 'playing') { G.state = 'paused'; ui.pause.classList.remove('rn-hidden'); Snd.setMode('pause'); }
  else if (G.state === 'paused') { G.state = 'playing'; ui.pause.classList.add('rn-hidden'); Snd.setMode('game'); last = performance.now(); }
}
function toggleFullscreen() { if (document.fullscreenElement) document.exitFullscreen?.(); else root.requestFullscreen?.().catch(() => {}); }
function toggleMute() { Snd.init(); const m = Snd.toggleMute(); $('bMute').classList.toggle('rn-off', m); }
on(window, 'keydown', e => {
  const k = e.code;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  if (k === 'ArrowLeft' || k === 'KeyA') input.left = true;
  else if (k === 'ArrowRight' || k === 'KeyD') input.right = true;
  else if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') primary();
  else if (k === 'Enter') { if (G.state === 'menu' || G.state === 'over') primary(); }
  else if (k === 'KeyP' || k === 'Escape') togglePause();
  else if (k === 'KeyM') toggleMute();
  else if (k === 'KeyF') toggleFullscreen();
});
on(window, 'keyup', e => {
  const k = e.code;
  if (k === 'ArrowLeft' || k === 'KeyA') input.left = false;
  else if (k === 'ArrowRight' || k === 'KeyD') input.right = false;
  else if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW') input.jump = false;
});
on(window, 'blur', () => { input.left = input.right = input.jump = false; });
on(document, 'visibilitychange', () => { if (document.hidden && G.state === 'playing') togglePause(); });
$('bStart').addEventListener('click', e => { e.stopPropagation(); startGame(); });
$('bAgain').addEventListener('click', e => { e.stopPropagation(); startGame(); });
$('bFs').addEventListener('click', e => { e.stopPropagation(); toggleFullscreen(); e.currentTarget.blur(); });
$('bMute').addEventListener('click', e => { e.stopPropagation(); toggleMute(); e.currentTarget.blur(); });
$('bPause').addEventListener('click', e => { e.stopPropagation(); togglePause(); e.currentTarget.blur(); });
ui.pause.addEventListener('click', togglePause);
on(window, 'pointerdown', () => Snd.init(), { once: true });
on(window, 'keydown', () => Snd.init(), { once: true });
const bindTouch = (id, down, up) => {
  const el = $(id);
  el.addEventListener('pointerdown', e => { e.preventDefault(); el.classList.add('rn-act'); down(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => el.addEventListener(n, () => { el.classList.remove('rn-act'); up(); }));
};
bindTouch('tL', () => input.left = true, () => input.left = false);
bindTouch('tR', () => input.right = true, () => input.right = false);
bindTouch('tJ', () => { if (G.state === 'playing') pressJump(); }, () => input.jump = false);
root.addEventListener('contextmenu', e => e.preventDefault());

/* =====================================================================
   PĘTLA
   ===================================================================== */
if (G.best > 0) $('menuBest').textContent = '★ REKORD: ' + fmt(G.best) + ' ★';
resetGen(true); ensureRows();
let last = performance.now();
function frame(now) {
  if (dead) return;
  raf = requestAnimationFrame(frame);
  const raw = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  if (G.state !== 'paused') {
    const dt = raw * (G.state === 'dying' ? 0.4 : 1);
    update(dt); syncScene(dt); syncHud(raw);
  }
  composer.render();
}
raf = requestAnimationFrame(frame);

return {
  pause() { if (G.state === 'playing') togglePause(); },
  destroy() {
    dead = true; cancelAnimationFrame(raf); ro.disconnect();
    offs.forEach(f => f());
    if (document.fullscreenElement === root) document.exitFullscreen?.();
    Snd.dispose();
    composer.dispose?.();
    renderer.dispose(); renderer.forceContextLoss();
    root.innerHTML = '';
    root.classList.remove('rn3');
  },
};
}
