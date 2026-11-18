// @ts-nocheck -- grafika i dźwięk przeniesione z oryginalnej gry AIMPULSE (jeden plik HTML) prawie bez zmian; typy dojdą przy porządkach
// Super Turbo AIMPULSE 3D (Gry Super Turbo): trener celności w kontenerze. Logikę rundy (cele, trafienia, punkty) liczy WYŁĄCZNIE
// features/turbo/aimCore.ts ze stałym krokiem i ziarnem od serwera (hooks.onStart); po rundzie serwer dostaje zapis strzałów
// (hooks.onOver) i sam ją odtwarza (aimpulse_sim.rs). Tu: scena, broń, efekty, muzyka, menu. Efekty i tryb pokazowy w menu
// używają Math.random - nie wpływają na rundę.
// Ładować tylko dynamicznym import() po sprawdzeniu use3D() (features/turbo/AimpulsePage.tsx). Styl: features/turbo/aimpulse.css.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { LiveSeeds } from '../features/games/liveSeeds';
import { SEG, AimSim, BAD, DIFFS, DURS, EYE as EYE0, GOLD, GOOD, QUANT, TICK } from '../features/turbo/aimCore';

export interface AimOver { score: number; hits: number; shots: number; diff: number; dur: number; log: number[]; record: boolean }
export interface AimHooks {
  /** start rundy: ziarno od serwera (undefined = runda bez nagrody) */
  onStart: (diff: number, dur: number) => Promise<LiveSeeds | undefined>;
  /** koniec rundy: zwraca napis z nagrodą do pokazania na ekranie wyników */
  onOver: (r: AimOver) => Promise<string | undefined>;
  volume: () => number;
  soundOn: () => boolean;
}
export interface Aim3D { pause: () => void; destroy: () => void }

const HTML = `
<canvas class="ap-c" tabindex="0"></canvas>
<div id="ap-vig" class="ov"></div><div id="ap-edge" class="ov"></div><div id="ap-flash" class="ov"></div><div id="ap-floaters" class="ov"></div>
<div id="ap-hud" class="hidden">
  <div class="hud-top">
    <div class="hbox"><div class="lbl">WYNIK</div><div id="ap-score" class="val">0</div></div>
    <div class="hbox c"><div class="lbl">CZAS</div><div><span id="ap-timer" class="val">60.0</span></div><div class="tbar"><i id="ap-tbar"></i></div></div>
    <div class="hbox">
      <div class="pair"><span class="lbl">CELNOŚĆ</span><span id="ap-acc" class="val">—</span></div>
      <div class="pair"><span class="lbl">REAKCJA</span><span id="ap-rt" class="val">—</span></div>
    </div>
  </div>
  <div id="ap-combo"><div id="ap-combo-num">0</div><div class="lbl">COMBO</div><div id="ap-mult">×1.0</div><div class="cbar"><i id="ap-combo-fill"></i></div></div>
</div>
<div id="ap-cross" class="hidden"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="d"></i><div id="ap-hm"><i></i><i></i><i></i><i></i></div></div>
<div id="ap-ann"></div><div id="ap-cd"></div><div id="ap-toast"></div>
<div id="ap-menu" class="screen hidden">
  <div class="frame"><div class="panel"><div class="inner" style="width:min(620px,92cqw)">
    <h1>AIMPULSE</h1>
    <div class="sub">SUPER TURBO · TRENER CELNOŚCI 3D</div>
    <div class="legend">
      <div class="lg"><div class="ic good"></div><b>STRZELAJ</b><span>im szybciej trafisz,<br>tym więcej punktów</span></div>
      <div class="lg"><div class="ic bad"></div><b>NIE STRZELAJ</b><span>−300 pkt<br>i koniec combo</span></div>
      <div class="lg"><div class="ic gold"></div><b>BONUS</b><span>+500 pkt,<br>znika błyskawicznie</span></div>
    </div>
    <div class="row"><div class="lbl">POZIOM</div><div class="seg" id="ap-seg-diff"><button data-v="0">ŁATWY</button><button data-v="1">NORMALNY</button><button data-v="2">TRUDNY</button></div></div>
    <div class="row"><div class="lbl">CZAS</div><div class="seg" id="ap-seg-dur"><button data-v="30">30 s</button><button data-v="60">60 s</button><button data-v="120">120 s</button></div></div>
    <div class="row"><div class="lbl">CZUŁOŚĆ</div><input id="ap-sens" type="range" min="0.2" max="8" step="0.05"><output id="ap-sens-o"></output></div>
    <div class="row"><div class="lbl">GŁOŚNOŚĆ</div><input id="ap-vol" type="range" min="0" max="100" step="1"><output id="ap-vol-o"></output></div>
    <div class="row"><div class="lbl">MUZYKA</div><div class="seg" id="ap-seg-music"><button data-v="1">WŁĄCZONA</button><button data-v="0">WYCISZONA</button></div></div>
    <div class="actions"><button class="btn" id="ap-start">START</button><div class="best">REKORD<b id="ap-menu-best">—</b></div></div>
    <div class="hint">MYSZ — CELOWANIE · LPM — STRZAŁ · R — RESTART · M — MUZYKA · F — PEŁNY EKRAN · ESC — PAUZA</div>
  </div></div></div>
</div>
<div id="ap-pause" class="screen hidden">
  <div class="frame"><div class="panel"><div class="inner" style="width:min(520px,90cqw)">
    <h2>PAUZA</h2>
    <div class="note" id="ap-pause-note">Kliknij „Wznów”, żeby wrócić do gry.</div>
    <div class="actions"><button class="btn" id="ap-resume">WZNÓW</button><button class="btn ghost" id="ap-p-restart">RESTART</button><button class="btn ghost" id="ap-p-menu">MENU</button></div>
    <button class="mini" id="ap-p-music">♪ MUZYKA: WŁĄCZONA</button>
  </div></div></div>
</div>
<div id="ap-results" class="screen hidden">
  <div class="frame"><div class="panel"><div class="inner" style="width:min(700px,92cqw)">
    <div class="lbl" id="ap-r-mode">NORMALNY · 60 s</div>
    <h2>KONIEC RUNDY</h2>
    <div class="res">
      <div><div class="rank" id="ap-r-rank">A</div><div class="lbl rank-lbl">RANGA</div></div>
      <div>
        <div class="lbl">WYNIK</div>
        <div><span class="final" id="ap-r-score">0</span><span class="record hidden" id="ap-r-rec">NOWY REKORD!</span></div>
        <div class="lbl" id="ap-r-best" style="margin-top:4px">Rekord: 0</div>
        <div class="stats">
          <div class="st"><span>TRAFIENIA</span><b id="ap-r-hits">0</b></div>
          <div class="st"><span>CELNOŚĆ</span><b id="ap-r-acc">0%</b></div>
          <div class="st"><span>ŚR. REAKCJA</span><b id="ap-r-rt">—</b></div>
          <div class="st"><span>MAKS. COMBO</span><b id="ap-r-combo">0</b></div>
          <div class="st"><span>PERFEKCYJNE</span><b id="ap-r-perf">0</b></div>
          <div class="st"><span>BONUSY</span><b id="ap-r-gold">0</b></div>
          <div class="st"><span>PUŁAPKI</span><b id="ap-r-bad">0</b></div>
          <div class="st"><span>PRZEGAPIONE</span><b id="ap-r-exp">0</b></div>
        </div>
        <div class="ap-reward" id="ap-r-reward"></div>
      </div>
    </div>
    <div class="actions" id="ap-r-actions"><button class="btn" id="ap-again">JESZCZE RAZ</button><button class="btn ghost" id="ap-r-menu">MENU</button></div>
  </div></div></div>
</div>
<canvas id="ap-confetti" class="ov"></canvas>`;

export function createAimpulse(root: HTMLElement, hooks: AimHooks): Aim3D {
  root.classList.add('ap-root');
  root.innerHTML = HTML;
  const $ = id => root.querySelector('#ap-' + id);
  const cleanups = [];
  const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); cleanups.push(() => target.removeEventListener(ev, fn, opts)); };
  const W = () => Math.max(root.clientWidth, 16), H = () => Math.max(root.clientHeight, 16);

  /* ===================================================================== helpers */
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const fmt = n => Math.round(n).toLocaleString('pl-PL');
  const show = el => el.classList.remove('hidden'), hide = el => el.classList.add('hidden');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('aimpulse.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('aimpulse.' + k, JSON.stringify(v)); } catch { /* bez zapisu */ } },
  };

  /* ===================================================================== config + state */
  const MILESTONES = { 5: ['NIEŹLE!', ''], 10: ['W OGNIU!', 'gold'], 15: ['DOMINACJA!', 'gold'], 20: ['NIE DO ZATRZYMANIA!', 'mg'], 30: ['BÓG CELOWANIA!', 'mg'] };
  const TIER_CSS = ['#19e6ff', '#ffc93c', '#ff2d78'];
  const TIER_EDGE = ['rgba(25,230,255,.55)', 'rgba(255,190,60,.6)', 'rgba(255,45,120,.65)'];
  const G = {
    state: 'boot', prev: 'playing',
    diff: store.get('diffIdx', 1), dur: store.get('dur', 60), sens: store.get('sens', 2),
    yaw: 0, pitch: 0, clock: 0, shown: 0, cdT: 0, cdShown: 0, lastTick: 99, energy: 0,
  };
  if (![0, 1, 2].includes(G.diff)) G.diff = 1;
  if (!DURS.includes(G.dur)) G.dur = 60;
  G.sens = clamp(+G.sens || 2, 0.2, 8);
  /** runda (rdzeń liczący punkty) i runda pokazowa w menu */
  let live = LiveSeeds.local(SEG);
  let sim = null, demo = null, acc = 0, starting = 0;

  /* ===================================================================== audio (synteza, bez plików) */
  const Sfx = (() => {
    let ctx = null, master = null, nbuf = null, vol = clamp(store.get('vol', 60), 0, 100) / 100, musicTimer = 0;
    const level = () => vol * (hooks.soundOn() ? hooks.volume() : 0);
    function ensure() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); master.gain.value = level(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      try {
        ctx = new AC(); master = ctx.createGain(); master.gain.value = level();
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.12;
        master.connect(comp); comp.connect(ctx.destination);
        nbuf = ctx.createBuffer(1, (ctx.sampleRate * 0.6) | 0, ctx.sampleRate);
        const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch { ctx = null; return; }
      try { musicInit(); } catch { mGain = null; mFilter = null; }
    }
    function tone(type, f, f2, dur, g, t = 0) {
      if (!ctx) return;
      const t0 = ctx.currentTime + t, o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(g, t0 + 0.006); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn); gn.connect(master); o.start(t0); o.stop(t0 + dur + 0.03);
    }
    function noise(f, f2, dur, g, q = 0.8, type = 'bandpass', t = 0) {
      if (!ctx) return;
      const t0 = ctx.currentTime + t, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), gn = ctx.createGain();
      s.buffer = nbuf; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t0);
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      gn.gain.setValueAtTime(g, t0); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(fl); fl.connect(gn); gn.connect(master); s.start(t0); s.stop(t0 + dur + 0.03);
    }
    const PENTA = [0, 2, 4, 7, 9];
    const note = i => 523.25 * Math.pow(2, (PENTA[i % 5] + 12 * Math.floor(i / 5)) / 12);
    const semi = (b, s) => b * Math.pow(2, s / 12);
    // muzyka: krótka pętla synthwave na zegarze audio
    const ST = 60 / 112 / 4, LEVEL = 0.55;
    const CHORDS = [{ r: 45, n: [57, 60, 64, 69] }, { r: 41, n: [53, 57, 60, 65] }, { r: 48, n: [55, 60, 64, 67] }, { r: 43, n: [55, 59, 62, 67] },
      { r: 45, n: [57, 60, 64, 69] }, { r: 41, n: [53, 57, 60, 65] }, { r: 38, n: [53, 57, 62, 65] }, { r: 40, n: [55, 59, 64, 67] }];
    const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 2, 1];
    const LEAD = [[[0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 69, 4]], [[0, 69, 8], [8, 72, 4], [12, 74, 4]], [[0, 76, 6], [6, 79, 6], [12, 76, 4]], [[0, 74, 8], [8, 71, 8]],
      [[0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 69, 4]], [[0, 72, 8], [8, 69, 4], [12, 72, 4]], [[0, 74, 6], [6, 77, 6], [12, 74, 4]], [[0, 76, 8], [8, 79, 8]]];
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    let mOn = store.get('music', true) !== false, mMode = 'menu', mHeat = 0, mStep = 0, mNext = 0, mGain = null, mFilter = null, mDuck = null, mDrums = null, mEcho = null;
    const mLevel = () => mOn ? (mMode === 'playing' || mMode === 'countdown' ? LEVEL : LEVEL * 0.8) : 0;
    const hold = (p, now) => { p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); };
    function musicInit() {
      mGain = ctx.createGain(); mGain.gain.value = mLevel();
      mFilter = ctx.createBiquadFilter(); mFilter.type = 'lowpass'; mFilter.Q.value = 0.6; mFilter.frequency.value = 650;
      mDuck = ctx.createGain(); mDrums = ctx.createGain(); mEcho = ctx.createGain();
      const delay = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain();
      delay.delayTime.value = ST * 3; fb.gain.value = 0.34; wet.gain.value = 0.3;
      mEcho.connect(mDuck); mEcho.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(mDuck);
      mDuck.connect(mFilter); mDrums.connect(mFilter); mFilter.connect(mGain); mGain.connect(master);
      mNext = ctx.currentTime + 0.1;
      musicTimer = setInterval(musicTick, 25);
      musicMode(mMode);
    }
    function voice(dest, type, f, t0, dur, g, cut, cutEnd, attack = 0.008) {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0);
      gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(g, t0 + attack); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      if (cut) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 2; fl.frequency.setValueAtTime(cut, t0); fl.frequency.exponentialRampToValueAtTime(cutEnd, t0 + dur); o.connect(fl); fl.connect(gn); }
      else o.connect(gn);
      gn.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    function drumNoise(t0, dur, g, f, type) {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), gn = ctx.createGain();
      s.buffer = nbuf; fl.type = type; fl.frequency.value = f; fl.Q.value = 0.8;
      gn.gain.setValueAtTime(g, t0); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(fl); fl.connect(gn); gn.connect(mDrums); s.start(t0, Math.random() * 0.4); s.stop(t0 + dur + 0.02);
    }
    function kick(t0) {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(45, t0 + 0.11);
      gn.gain.setValueAtTime(0.4, t0); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
      o.connect(gn); gn.connect(mDrums); o.start(t0); o.stop(t0 + 0.26);
      mDuck.gain.setValueAtTime(0.4, t0); mDuck.gain.linearRampToValueAtTime(1, t0 + ST * 2.6);
    }
    function pad(ch, t0) {
      const dur = ST * 16, fl = ctx.createBiquadFilter(), gn = ctx.createGain();
      fl.type = 'lowpass'; fl.frequency.value = 900; fl.Q.value = 0.5;
      gn.gain.setValueAtTime(0.0001, t0); gn.gain.linearRampToValueAtTime(0.035, t0 + 0.35); gn.gain.setValueAtTime(0.035, t0 + dur - 0.15); gn.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.25);
      fl.connect(gn); gn.connect(mDuck);
      for (let i = 0; i < 3; i++) for (const det of [-7, 7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(ch.n[i]); o.detune.value = det; o.connect(fl); o.start(t0); o.stop(t0 + dur + 0.3); }
    }
    function musicStep(i, t) {
      const bar = i >> 4, s = i & 15, ch = CHORDS[bar % 8];
      if (s === 0) pad(ch, t);
      if (s % 4 === 0) kick(t);
      if (s === 4 || s === 12) drumNoise(t, 0.14, 0.1, 1700, 'bandpass');
      if (s % 4 === 2) drumNoise(t, 0.04, 0.05, 8500, 'highpass');
      else if (mHeat > 0.35 && s % 2 === 1) drumNoise(t, 0.025, 0.022, 9500, 'highpass');
      if (s % 2 === 0) { const f = hz(ch.r + (s === 14 ? 12 : 0)); voice(mDuck, 'sawtooth', f, t, ST * 1.7, 0.1, 1100, 220); voice(mDuck, 'sine', f, t, ST * 1.8, 0.11); }
      const n = ch.n[ARP[s]];
      voice(mEcho, 'square', hz(n + 12), t, ST * 1.5, 0.026, 2600, 500);
      if (mHeat > 0.6) voice(mEcho, 'triangle', hz(n + 24), t, ST * 1.2, 0.018);
      if (bar % 16 >= 8) for (const [ls, nt, len] of LEAD[bar % 8]) if (ls === s) {
        voice(mEcho, 'triangle', hz(nt), t, ST * len * 0.95, 0.06, 0, 0, 0.02); voice(mEcho, 'sine', hz(nt) * 1.005, t, ST * len * 0.95, 0.03, 0, 0, 0.02);
      }
    }
    function musicTick() {
      if (!ctx || !mGain || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      master.gain.value = level();
      if (!mOn) { mNext = now + 0.1; return; }
      if (mNext < now - 0.2) { mNext = now + 0.06; mStep = (mStep + 15) & ~15; }
      while (mNext < now + 0.14) { musicStep(mStep, mNext); mStep++; mNext += ST; }
    }
    function musicMode(m) {
      mMode = m; if (!mFilter) return;
      const now = ctx.currentTime, p = mFilter.frequency, open = m === 'playing' || m === 'countdown';
      hold(p, now);
      if (m === 'countdown') p.exponentialRampToValueAtTime(17000, now + 2.8);
      else p.setTargetAtTime(open ? 17000 : 650, now, open ? 0.1 : 0.25);
      hold(mGain.gain, now); mGain.gain.setTargetAtTime(mLevel(), now, 0.15);
    }
    function musicSet(v) {
      mOn = !!v; store.set('music', mOn); if (!mGain) return;
      const now = ctx.currentTime;
      if (mOn) { mStep = (mStep + 15) & ~15; mNext = now + 0.08; }
      hold(mGain.gain, now); mGain.gain.setTargetAtTime(mLevel(), now, 0.06);
    }
    return {
      ensure,
      music: { isOn: () => mOn, set: musicSet, mode: musicMode, heat(v) { mHeat = v; } },
      setVol(v) { vol = v; if (master) master.gain.value = level(); },
      destroy() { clearInterval(musicTimer); try { ctx?.close(); } catch { /* już zamknięty */ } ctx = null; },
      shot() { tone('sine', 190, 52, 0.11, 0.30); tone('triangle', 980, 240, 0.07, 0.07); noise(3400, 700, 0.07, 0.13); },
      hit(combo, perfect) {
        const i = Math.max(0, combo <= 10 ? combo - 1 : 5 + ((combo - 1) % 5)), f = note(i);
        tone('sine', f, 0, 0.26, 0.22); tone('triangle', f * 2, 0, 0.14, 0.07); noise(6000, 3000, 0.03, 0.06, 0.7, 'highpass');
        if (perfect) { tone('sine', f * 3, 0, 0.30, 0.06, 0.03); tone('sine', f * 4, 0, 0.34, 0.035, 0.06); }
      },
      gold() { [0, 4, 7, 12, 16].forEach((s, i) => tone('triangle', semi(1046.5, s), 0, 0.17, 0.13, i * 0.045)); noise(5000, 9000, 0.25, 0.05, 0.7, 'highpass'); },
      bad() { tone('sawtooth', 150, 55, 0.42, 0.26); tone('square', 98, 40, 0.42, 0.14); noise(900, 200, 0.3, 0.25, 0.7, 'lowpass'); },
      expire() { tone('sine', 260, 130, 0.14, 0.07); },
      comboBreak() { tone('triangle', 420, 110, 0.3, 0.13); },
      count() { tone('sine', 440, 0, 0.16, 0.2); },
      go() { tone('sine', 880, 0, 0.4, 0.22); tone('triangle', 1320, 0, 0.4, 0.08); },
      tick(urgent) { tone('square', urgent ? 1500 : 1100, 0, 0.045, 0.05); },
      milestone(l) { const b = semi(392, Math.min(l, 6) * 2); [0, 4, 7, 12].forEach((s, i) => tone('triangle', semi(b, s), 0, 0.22, 0.12, i * 0.055)); noise(500, 5000, 0.4, 0.07, 1.2); },
      end() { [0, 4, 7, 12].forEach((s, i) => tone('triangle', semi(523.25, s), 0, 0.35, 0.14, i * 0.12)); tone('sine', 1046.5, 0, 0.9, 0.12, 0.5); tone('sine', 1318.5, 0, 0.9, 0.08, 0.5); tone('sine', 1568, 0, 0.9, 0.07, 0.5); },
      stamp(t) { tone('sine', 140, 45, 0.25, 0.35, t); noise(1200, 300, 0.15, 0.2, 0.7, 'lowpass', t); },
      spawn(type) { tone('sine', type === BAD ? 330 : type === GOLD ? 1400 : rand(760, 900), 0, 0.06, type === GOLD ? 0.05 : 0.02); },
      ui() { tone('sine', 700, 900, 0.06, 0.06); },
    };
  })();

  /* ===================================================================== renderer, scene, post-processing */
  const canvas = root.querySelector('canvas.ap-c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let PR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PR); renderer.setSize(W(), H(), false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;

  const FOG = 0x04050b, BASE_FOV = 76;
  const EYE = new THREE.Vector3(EYE0.x, EYE0.y, EYE0.z), UP = new THREE.Vector3(0, 1, 0);
  const ROOM = { x0: -22, x1: 22, y0: -4, y1: 13, z0: -32, z1: 14 };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG); scene.fog = new THREE.FogExp2(FOG, 0.016);
  const camera = new THREE.PerspectiveCamera(BASE_FOV, W() / H(), 0.03, 220);
  camera.rotation.order = 'YXZ'; camera.position.copy(EYE); scene.add(camera);

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W() * PR, H() * PR, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.6, 0.5, 0.8);
  composer.addPass(bloom); composer.addPass(new OutputPass());

  (function buildEnv() {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(40, 24, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
      vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vD; void main(){ float y=normalize(vD).y;
        vec3 c=mix(vec3(0.02,0.05,0.08),vec3(0.10,0.30,0.42),smoothstep(-1.0,0.05,y));
        c=mix(c,vec3(0.50,0.62,0.80),smoothstep(0.0,0.9,y)); gl_FragColor=vec4(c,1.0); }` })));
    const panel = (color, k, w, h, x, y, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
    };
    panel(0x19e6ff, 6, 9, 3, 7, 1.5, -2); panel(0xff2d78, 3, 9, 4, -8, -2, -5); panel(0xffffff, 4, 7, 7, 0, 9, 0); panel(0xbfe9ff, 4, 14, 3, 0, 6, -9); panel(0xffffff, 2, 6, 3, -2, 3, 8);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.03).texture; pmrem.dispose();
  })();

  const COL = { cy: new THREE.Color(0x19e6ff), mg: new THREE.Color(0xff2d78), gd: new THREE.Color(0xffb62e), red: new THREE.Color(0xff2440), white: new THREE.Color(0xffffff) };
  const TCOL = { [GOOD]: COL.cy, [BAD]: COL.red, [GOLD]: COL.gd };
  const TIER_COL = [COL.cy, COL.gd, COL.mg];
  const U = { energy: { value: 0 }, pulse: { value: 1 }, center: { value: new THREE.Vector2() }, wave: { value: new THREE.Color(0x19e6ff) } };

  /* ===================================================================== arena */
  function gridMaterial(o) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(o.color) }, uBase: { value: new THREE.Color(o.base ?? 0x05070e) }, uFog: { value: new THREE.Color(FOG) },
        uSize: { value: new THREE.Vector2(o.size[0], o.size[1]) }, uCell: { value: o.cell }, uMajor: { value: o.major }, uInt: { value: o.intensity },
        uUseWave: { value: o.wave ? 1 : 0 }, uEnergy: U.energy, uPulse: U.pulse, uCenter: U.center, uWave: U.wave,
      },
      vertexShader: `
        uniform vec2 uSize; varying vec2 vP; varying vec3 vView;
        void main(){ vP=(uv-0.5)*uSize; vec4 mv=modelViewMatrix*vec4(position,1.0); vView=mv.xyz; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `
        uniform vec3 uColor,uBase,uFog,uWave; uniform float uCell,uMajor,uInt,uUseWave,uEnergy,uPulse; uniform vec2 uCenter;
        varying vec2 vP; varying vec3 vView;
        float gridLine(vec2 p,float w){
          vec2 fw=max(fwidth(p),vec2(1e-5));
          vec2 f=abs(fract(p-0.5)-0.5)/fw;
          float l=1.0-min(min(f.x,f.y)/w,1.0);
          return l*(1.0-smoothstep(0.2,0.6,max(fw.x,fw.y)));
        }
        void main(){
          float g1=gridLine(vP/uCell,1.0);
          float g2=gridLine(vP/(uCell*uMajor),1.5);
          float lines=g1*0.3+g2*0.9;
          vec3 col=uBase+uColor*lines*uInt*(0.7+uEnergy*0.9);
          if(uUseWave>0.5){
            float d=length(vP-uCenter);
            float band=smoothstep(4.0,0.0,abs(d-uPulse*48.0))*(1.0-uPulse);
            col+=uWave*band*(0.12+lines*2.4);
          }
          float dist=length(vView);
          float fog=1.0-exp(-dist*dist*0.000256);
          gl_FragColor=vec4(mix(col,uFog,fog),1.0);
        }`,
    });
  }
  const neonMats = [];
  function neon(color, k, extra) {
    const m = new THREE.MeshBasicMaterial(Object.assign({ color: 0xffffff }, extra || {}));
    m.userData = { base: new THREE.Color(color), k }; m.color.copy(m.userData.base).multiplyScalar(k);
    neonMats.push(m); return m;
  }
  function addBox(w, h, d, mat, x, y, z, parent = scene) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; }
  function addPlane(w, h, mat, x, y, z, rx = 0, ry = 0) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); scene.add(m); return m; }

  let dust, dustSpeed;
  (function buildArena() {
    const Wd = ROOM.x1 - ROOM.x0, Hd = ROOM.y1 - ROOM.y0, Dp = ROOM.z1 - ROOM.z0, cy = (ROOM.y0 + ROOM.y1) / 2, cz = (ROOM.z0 + ROOM.z1) / 2;
    addPlane(100, 100, gridMaterial({ color: 0x19e6ff, cell: 2, major: 5, intensity: 1.0, size: [100, 100], wave: true }), 0, ROOM.y0, 0, -Math.PI / 2);
    addPlane(100, 100, gridMaterial({ color: 0x7a3cff, cell: 4, major: 4, intensity: 0.32, size: [100, 100] }), 0, ROOM.y1, 0, Math.PI / 2);
    const wall = (w, h) => gridMaterial({ color: 0x3d6bff, cell: 2, major: 4, intensity: 0.38, size: [w, h], base: 0x04060c });
    addPlane(Wd, Hd, wall(Wd, Hd), 0, cy, ROOM.z0);
    addPlane(Wd, Hd, wall(Wd, Hd), 0, cy, ROOM.z1, 0, Math.PI);
    addPlane(Dp, Hd, wall(Dp, Hd), ROOM.x0, cy, cz, 0, Math.PI / 2);
    addPlane(Dp, Hd, wall(Dp, Hd), ROOM.x1, cy, cz, 0, -Math.PI / 2);
    const nCy = neon(0x19e6ff, 2.0), nMg = neon(0xff2d78, 2.3), nWh = neon(0x9fc8ff, 0.8), nDim = neon(0x2f6dff, 0.55);
    addBox(Wd, 0.12, 0.12, nCy, 0, -1.2, ROOM.z0 + 0.08); addBox(Wd, 0.12, 0.12, nMg, 0, 10.4, ROOM.z0 + 0.08);
    for (const sx of [-1, 1]) {
      addBox(0.12, 0.12, Dp, nCy, sx * (ROOM.x1 - 0.08), -1.2, cz); addBox(0.12, 0.12, Dp, nMg, sx * (ROOM.x1 - 0.08), 10.4, cz);
      addBox(0.16, Hd, 0.16, nWh, sx * (ROOM.x1 - 0.1), cy, ROOM.z0 + 0.1);
      addBox(0.3, 0.08, 36, nWh, sx * 7, ROOM.y1 - 0.06, -10);
    }
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0b0f1c, metalness: 0.7, roughness: 0.45, envMapIntensity: 0.35 });
    [-27, -17, -7, 3].forEach((z, i) => { for (const sx of [-1, 1]) {
      addBox(1.8, Hd, 1.8, pillarMat, sx * 16, cy, z);
      addBox(0.1, Hd - 1.5, 0.1, i % 2 ? nMg : nCy, sx * (16 - 0.92), cy, z + 0.92);
    } });
    for (const z of [-13, -21, -29]) { const g = new THREE.Mesh(new THREE.TorusGeometry(11, 0.06, 6, 6), nDim); g.position.set(0, 3, z); scene.add(g); }
    const platMat = new THREE.MeshStandardMaterial({ color: 0x0e1320, metalness: 0.8, roughness: 0.4, flatShading: true, envMapIntensity: 0.4 });
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 0.5, 6), platMat); plat.position.set(EYE.x, -0.25, EYE.z); scene.add(plat);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 3.5, 6), platMat); stem.position.set(EYE.x, -2.25, EYE.z); scene.add(stem);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(3.23, 3.23, 0.07, 6, 1, true), neon(0x19e6ff, 1.4, { side: THREE.DoubleSide })); rim.position.set(EYE.x, -0.03, EYE.z); scene.add(rim);
    const emblem = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.63, 6), neon(0x19e6ff, 1.6, { side: THREE.DoubleSide })); emblem.rotation.x = -Math.PI / 2; emblem.position.set(EYE.x, 0.01, EYE.z); scene.add(emblem);
    addBox(2.4, 0.3, 3.2, platMat, EYE.x, -0.15, ROOM.z1 - 1.6);
    scene.add(new THREE.HemisphereLight(0x9cc4ff, 0x05060d, 0.9));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(3, 10, 6); scene.add(dl);
    const n = 340, pos = new Float32Array(n * 3); dustSpeed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = rand(ROOM.x0, ROOM.x1); pos[i * 3 + 1] = rand(ROOM.y0, ROOM.y1); pos[i * 3 + 2] = rand(ROOM.z0, ROOM.z1); dustSpeed[i] = rand(0.08, 0.35); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dc = document.createElement('canvas'); dc.width = dc.height = 32; const dx = dc.getContext('2d'), dg = dx.createRadialGradient(16, 16, 0, 16, 16, 16);
    dg.addColorStop(0, 'rgba(255,255,255,1)'); dg.addColorStop(1, 'rgba(255,255,255,0)'); dx.fillStyle = dg; dx.fillRect(0, 0, 32, 32);
    dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x6fb7ff, size: 0.09, map: new THREE.CanvasTexture(dc), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(dust);
  })();
  const hitLight = new THREE.PointLight(0x19e6ff, 0, 40, 2); scene.add(hitLight);
  let hitLightI = 0;

  /* ===================================================================== target visuals */
  const ORB_VS = 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }';
  function orbMaterial(color, rim, gain) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uRim: { value: new THREE.Color(rim) }, uGain: { value: gain } },
      vertexShader: ORB_VS,
      fragmentShader: `uniform vec3 uColor,uRim; uniform float uGain; varying vec3 vN; varying vec3 vV;
        void main(){ vec3 n=normalize(vN); float ndv=clamp(dot(n,normalize(vV)),0.0,1.0); float f=1.0-ndv;
          float light=0.5+0.5*n.y;
          vec3 col=uColor*(0.42+0.5*light+0.38*pow(ndv,4.0))+uRim*pow(f,2.2)*1.5;
          gl_FragColor=vec4(col*uGain,1.0); }`,
    });
  }
  function haloMaterial(color, gain) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(gain) } },
      vertexShader: ORB_VS,
      fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
        void main(){ float f=1.0-clamp(dot(normalize(vN),normalize(vV)),0.0,1.0); float a=f*f*(1.0-f)*5.0; gl_FragColor=vec4(uColor,a); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
  }
  const ringMat = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const GEO = {
    sphere: new THREE.SphereGeometry(1, 40, 28), sphereLow: new THREE.SphereGeometry(1, 20, 14),
    ico: new THREE.IcosahedronGeometry(0.74, 0), cone: new THREE.ConeGeometry(0.2, 0.6, 5), octa: new THREE.OctahedronGeometry(1, 0),
    ring: new THREE.RingGeometry(0.94, 1, 64), tracer: new THREE.CylinderGeometry(3, 1, 1, 6, 1, true),
  };
  const MAT = {
    good: orbMaterial(0x12bfff, 0xc8f7ff, 1.2), haloGood: haloMaterial(0x19e6ff, 1.0), ringGood: ringMat(0x19e6ff, 1.4),
    bad: orbMaterial(0xff1f3d, 0xff9aa8, 1.9), spike: orbMaterial(0xff3355, 0xffc0c8, 2.1), haloBad: haloMaterial(0xff2440, 1.2), ringBad: ringMat(0xff2440, 2.0),
    gold: orbMaterial(0xffb21a, 0xfff2b0, 1.8), haloGold: haloMaterial(0xffc23c, 1.4), ringGold: ringMat(0xffc23c, 1.8),
  };
  const PHI = (1 + Math.sqrt(5)) / 2, ICO_DIRS = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) ICO_DIRS.push(new THREE.Vector3(0, a, b * PHI).normalize(), new THREE.Vector3(a, b * PHI, 0).normalize(), new THREE.Vector3(a * PHI, 0, b).normalize());

  function makeVisual(type) {
    const g = new THREE.Group(), v = { group: g, ring: null, spin: null };
    if (type === GOOD) {
      g.add(new THREE.Mesh(GEO.sphere, MAT.good));
      const h = new THREE.Mesh(GEO.sphere, MAT.haloGood); h.scale.setScalar(1.24); g.add(h);
      v.ring = new THREE.Mesh(GEO.ring, MAT.ringGood);
    } else if (type === BAD) {
      v.spin = new THREE.Group(); g.add(v.spin);
      v.spin.add(new THREE.Mesh(GEO.ico, MAT.bad));
      for (const d of ICO_DIRS) { const c = new THREE.Mesh(GEO.cone, MAT.spike); c.position.copy(d).multiplyScalar(0.92); c.quaternion.setFromUnitVectors(UP, d); v.spin.add(c); }
      const h = new THREE.Mesh(GEO.sphereLow, MAT.haloBad); h.scale.setScalar(1.3); g.add(h);
      v.ring = new THREE.Mesh(GEO.ring, MAT.ringBad);
    } else {
      v.spin = new THREE.Group(); g.add(v.spin);
      const o = new THREE.Mesh(GEO.octa, MAT.gold); o.scale.set(0.8, 1.15, 0.8); v.spin.add(o);
      const h = new THREE.Mesh(GEO.sphereLow, MAT.haloGold); h.scale.setScalar(1.35); g.add(h);
      v.ring = new THREE.Mesh(GEO.ring, MAT.ringGold);
    }
    g.add(v.ring);
    return v;
  }

  /* ===================================================================== effects: particles, rings, pops, tracers */
  const PN = 2200;
  const pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 4), pSize = new Float32Array(PN), pVel = new Float32Array(PN * 3);
  const pLife = new Float32Array(PN), pMax = new Float32Array(PN), pBase = new Float32Array(PN), pGrav = new Float32Array(PN);
  let pCur = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 4));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: `attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC;
      void main(){ vC=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize*uScale/max(-mv.z,0.1); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.08,d); gl_FragColor=vec4(vC.rgb,a*vC.a); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pPoints = new THREE.Points(pGeo, pMat); pPoints.frustumCulled = false; scene.add(pPoints);
  function emit(x, y, z, vx, vy, vz, r, g, b, size, life, grav) {
    const i = pCur; pCur = (pCur + 1) % PN;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z; pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
    pCol[i * 4] = r; pCol[i * 4 + 1] = g; pCol[i * 4 + 2] = b; pCol[i * 4 + 3] = 1;
    pBase[i] = size; pSize[i] = size; pLife[i] = life; pMax[i] = life; pGrav[i] = grav;
  }
  function burst(p, c, n, speed, size, life, grav, gain) {
    for (let k = 0; k < n; k++) {
      const u = rand(-1, 1), th = rand(0, Math.PI * 2), s = Math.sqrt(1 - u * u), sp = speed * rand(0.2, 1), w = Math.random() * 0.45;
      emit(p.x, p.y, p.z, s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp, lerp(c.r, 1, w) * gain, lerp(c.g, 1, w) * gain, lerp(c.b, 1, w) * gain, size * rand(0.5, 1.2), life * rand(0.55, 1.1), grav);
    }
  }
  function updateParticles(dt) {
    const drag = Math.exp(-dt * 3.2);
    for (let i = 0; i < PN; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      if (pLife[i] <= 0) { pSize[i] = 0; pCol[i * 4 + 3] = 0; continue; }
      const k = pLife[i] / pMax[i], j = i * 3;
      pVel[j] *= drag; pVel[j + 1] = pVel[j + 1] * drag - pGrav[i] * dt; pVel[j + 2] *= drag;
      pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
      pCol[i * 4 + 3] = k; pSize[i] = pBase[i] * (0.35 + 0.65 * k);
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.aColor.needsUpdate = true; pGeo.attributes.aSize.needsUpdate = true;
  }
  class FxPool {
    constructor(geo, n, billboard) {
      this.items = []; this.i = 0; this.bb = billboard;
      for (let k = 0; k < n; k++) {
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
        const mesh = new THREE.Mesh(geo, mat); mesh.visible = false; scene.add(mesh);
        this.items.push({ mesh, mat, t: 0, dur: 1, s0: 1, s1: 1, on: false });
      }
    }
    fire(pos, color, s0, s1, dur, gain) {
      const it = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
      it.on = true; it.t = 0; it.dur = dur; it.s0 = s0; it.s1 = s1;
      it.mesh.position.copy(pos); it.mesh.scale.setScalar(s0); it.mesh.visible = true;
      it.mat.color.copy(color).multiplyScalar(gain); it.mat.opacity = 1;
      if (this.bb) it.mesh.quaternion.copy(camera.quaternion);
    }
    update(dt) {
      for (const it of this.items) {
        if (!it.on) continue;
        it.t += dt; const k = it.t / it.dur;
        if (k >= 1) { it.on = false; it.mesh.visible = false; continue; }
        it.mesh.scale.setScalar(lerp(it.s0, it.s1, 1 - Math.pow(1 - k, 3))); it.mat.opacity = 1 - k;
        if (this.bb) it.mesh.quaternion.copy(camera.quaternion);
      }
    }
  }
  const ringFx = new FxPool(GEO.ring, 18, true), popFx = new FxPool(GEO.sphereLow, 8, false);
  const tracers = []; let tracerI = 0;
  for (let k = 0; k < 6; k++) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(GEO.tracer, mat); mesh.visible = false; mesh.frustumCulled = false; scene.add(mesh);
    tracers.push({ mesh, mat, t: 0, len: 1, on: false });
  }
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3();
  function fireTracer(a, b, color) {
    const it = tracers[tracerI]; tracerI = (tracerI + 1) % tracers.length;
    _v1.subVectors(b, a); const len = _v1.length(); if (len < 0.01) return;
    it.mesh.position.copy(a).addScaledVector(_v1, 0.5); it.mesh.quaternion.setFromUnitVectors(UP, _v1.multiplyScalar(1 / len));
    it.len = len; it.t = 0; it.on = true; it.mesh.visible = true; it.mesh.scale.set(0.004, len, 0.004); it.mat.opacity = 1;
    it.mat.color.copy(color).lerp(COL.white, 0.35).multiplyScalar(2.6);
  }
  const tracerQueue = [];
  function flushTracers() { for (const q of tracerQueue) { gun.muzzle.getWorldPosition(_v3); fireTracer(_v3, q.end, q.color); } tracerQueue.length = 0; }
  function updateTracers(dt) {
    for (const it of tracers) {
      if (!it.on) continue;
      it.t += dt; const k = it.t / 0.12;
      if (k >= 1) { it.on = false; it.mesh.visible = false; continue; }
      const r = 0.0034 * (1 - k) + 0.0008; it.mesh.scale.set(r, it.len, r); it.mat.opacity = 1 - k;
    }
  }

  /* ===================================================================== broń (prawy dolny róg) */
  const gunPivot = new THREE.Group(); camera.add(gunPivot);
  const gun = {};
  (function buildGun() {
    const g = new THREE.Group(); g.scale.setScalar(0.9); gunPivot.add(g);
    const metal = new THREE.MeshStandardMaterial({ color: 0x66748f, metalness: 0.7, roughness: 0.32, envMapIntensity: 1.0 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x262e3d, metalness: 0.55, roughness: 0.48, envMapIntensity: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x031418, emissive: 0x19e6ff, emissiveIntensity: 2.2, roughness: 0.4 });
    const accent2 = new THREE.MeshStandardMaterial({ color: 0x180410, emissive: 0xff2d78, emissiveIntensity: 2.0, roughness: 0.4 });
    const slide = new THREE.Group(); g.add(slide);
    addBox(0.062, 0.058, 0.40, metal, 0, 0.060, -0.13, slide);
    addBox(0.066, 0.012, 0.30, dark, 0, 0.094, -0.13, slide);
    addBox(0.026, 0.022, 0.018, dark, 0, 0.108, 0.045, slide);
    addBox(0.010, 0.020, 0.012, accent, 0, 0.108, -0.30, slide);
    addBox(0.066, 0.008, 0.27, accent, 0, 0.060, -0.12, slide);
    addBox(0.040, 0.030, 0.006, accent2, 0, 0.062, 0.072, slide);
    for (let i = 0; i < 5; i++) addBox(0.064, 0.022, 0.008, dark, 0, 0.078, -0.20 - i * 0.022, slide);
    addBox(0.058, 0.050, 0.30, dark, 0, 0.010, -0.11, g);
    addBox(0.060, 0.022, 0.13, metal, 0, -0.014, -0.20, g);
    addBox(0.062, 0.006, 0.10, accent, 0, -0.014, -0.20, g);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.10, 16), dark); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.060, -0.37); g.add(barrel);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.016, 16), accent); tip.rotation.x = Math.PI / 2; tip.position.set(0, 0.060, -0.415); g.add(tip);
    const grip = addBox(0.052, 0.17, 0.068, dark, 0, -0.085, 0.035, g); grip.rotation.x = -0.28;
    addBox(0.054, 0.012, 0.07, accent2, 0, -0.165, 0.058, g).rotation.x = -0.28;
    addBox(0.012, 0.008, 0.09, dark, 0, -0.060, -0.045, g); addBox(0.012, 0.05, 0.008, dark, 0, -0.036, -0.088, g);
    addBox(0.008, 0.03, 0.01, metal, 0, -0.03, -0.04, g).rotation.x = -0.3;
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.060, -0.435); g.add(muzzle);
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const rg = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.2, 'rgba(170,245,255,.9)'); rg.addColorStop(0.5, 'rgba(25,230,255,.35)'); rg.addColorStop(1, 'rgba(25,230,255,0)');
    x.fillStyle = rg; x.fillRect(0, 0, 128, 128); x.globalCompositeOperation = 'lighter'; x.translate(64, 64);
    for (let i = 0; i < 6; i++) { x.rotate(Math.PI / 3); const lg = x.createLinearGradient(0, 0, 62, 0); lg.addColorStop(0, 'rgba(255,255,255,.9)'); lg.addColorStop(1, 'rgba(120,240,255,0)'); x.fillStyle = lg; x.beginPath(); x.moveTo(0, -5); x.lineTo(62, 0); x.lineTo(0, 5); x.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    flash.position.set(0, 0.060, -0.47); flash.visible = false; g.add(flash);
    const mLight = new THREE.PointLight(0x8ff3ff, 0, 6, 2); mLight.position.set(0, 0.08, -0.5); g.add(mLight);
    const fill = new THREE.PointLight(0xa8e6ff, 0.6, 3, 2); fill.position.set(-0.12, 0.26, 0.05); camera.add(fill);
    Object.assign(gun, { group: g, slide, muzzle, flash, mLight, accent, accent2 });
  })();
  const sway = { x: 0, y: 0, tx: 0, ty: 0 }, recoil = { p: 0, v: 0 };
  let prevYaw = 0, prevPitch = 0, gunRaise = 0, flashT = 0, gunGlow = 0, T = 0;
  const accentTarget = new THREE.Color(0x19e6ff);
  function updateGun(dt) {
    const dy = G.yaw - prevYaw, dp = G.pitch - prevPitch; prevYaw = G.yaw; prevPitch = G.pitch;
    sway.tx = clamp(sway.tx + dy * 1.4, -0.14, 0.14); sway.ty = clamp(sway.ty + dp * 1.4, -0.11, 0.11);
    const dec = Math.exp(-dt * 6.5); sway.tx *= dec; sway.ty *= dec;
    const f = 1 - Math.exp(-dt * 13); sway.x += (sway.tx - sway.x) * f; sway.y += (sway.ty - sway.y) * f;
    recoil.v += (-300 * recoil.p - 24 * recoil.v) * dt; recoil.p += recoil.v * dt;
    gunRaise += (1 - gunRaise) * (1 - Math.exp(-dt * 6));
    const low = 1 - gunRaise, bx = 0.215 * Math.min(camera.aspect, 2.3);
    gunPivot.position.set(bx + sway.x * 0.22 + Math.cos(T * 0.9) * 0.0025, -0.285 - sway.y * 0.18 + Math.sin(T * 1.8) * 0.003 - low * 0.36, -0.47 + recoil.p * 0.055);
    gunPivot.rotation.set(0.04 - sway.y * 0.75 + recoil.p * 0.2 - low * 0.55, 0.15 - sway.x * 0.85, -sway.x * 0.6 + Math.sin(T * 1.2) * 0.004);
    gun.slide.position.z = Math.max(0, recoil.p) * 0.05;
    if (flashT > 0) { flashT -= dt; const k = Math.max(0, flashT / 0.06); gun.flash.material.opacity = k; gun.mLight.intensity = k * 2.5; if (flashT <= 0) gun.flash.visible = false; }
    gunGlow *= Math.exp(-dt * 9);
    gun.accent.emissive.lerp(accentTarget, 1 - Math.exp(-dt * 6));
    gun.accent.emissiveIntensity = 2.0 + G.energy * 1.4 + gunGlow * 3.5;
  }

  /* ===================================================================== DOM + małe efekty */
  const hudEl = $('hud'), crossEl = $('cross'), scoreEl = $('score'), timerEl = $('timer'), tbarEl = $('tbar'), accEl = $('acc'), rtEl = $('rt');
  const comboEl = $('combo'), comboNum = $('combo-num'), multEl = $('mult'), comboFill = $('combo-fill');
  const flashEl = $('flash'), edgeEl = $('edge'), hmEl = $('hm'), annEl = $('ann'), cdEl = $('cd'), floatersEl = $('floaters'), toastEl = $('toast');
  const menuEl = $('menu'), pauseEl = $('pause'), resultsEl = $('results');
  const cancelAnims = el => el.getAnimations().forEach(a => a.cancel());
  function flash(inner, outer, strength, dur) {
    flashEl.style.background = `radial-gradient(ellipse at center,${inner} 25%,${outer} 115%)`;
    cancelAnims(flashEl); flashEl.animate([{ opacity: strength }, { opacity: 0 }], { duration: dur, easing: 'ease-out' });
  }
  function hitmark(color, big) {
    hmEl.style.setProperty('--hc', color); cancelAnims(hmEl);
    hmEl.animate([{ opacity: 1, transform: `scale(${big ? 1.75 : 1.35})` }, { opacity: 1, transform: 'scale(1)', offset: 0.4 }, { opacity: 0, transform: 'scale(.9)' }], { duration: big ? 330 : 230, easing: 'ease-out' });
  }
  function announce(text, cls) {
    annEl.textContent = text; annEl.className = cls || ''; cancelAnims(annEl);
    annEl.animate([
      { opacity: 0, transform: 'translate(-50%,0) scale(.5)' },
      { opacity: 1, transform: 'translate(-50%,0) scale(1.16)', offset: 0.14 },
      { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: 0.28 },
      { opacity: 1, transform: 'translate(-50%,0) scale(1)', offset: 0.75 },
      { opacity: 0, transform: 'translate(-50%,-22px) scale(1.04)' }], { duration: 1300, easing: 'ease-out' });
  }
  function showCd(text) {
    cdEl.textContent = text; cancelAnims(cdEl);
    cdEl.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(1.9)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.25 }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.6 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(.85)' }], { duration: 900, easing: 'ease-out' });
  }
  let toastTimer = 0;
  function toast(text) { toastEl.textContent = text; toastEl.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600); }
  const floaters = [];
  function floater(pos, text, cls, sub) {
    const el = document.createElement('div'); el.className = 'floater ' + cls;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s); }
    const b = document.createElement('b'); b.textContent = text; el.appendChild(b);
    el.style.opacity = '0'; floatersEl.appendChild(el);
    floaters.push({ el, pos: pos.clone(), t: 0, dur: cls === 'miss' ? 0.7 : 1.0 });
  }
  function updateFloaters(dt) {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]; f.t += dt; const k = f.t / f.dur;
      if (k >= 1) { f.el.remove(); floaters.splice(i, 1); continue; }
      _v3.copy(f.pos).project(camera);
      if (_v3.z > 1) { f.el.style.opacity = '0'; continue; }
      const x = (_v3.x * 0.5 + 0.5) * W(), y = (-_v3.y * 0.5 + 0.5) * H() - 34 - k * 64;
      const sc = k < 0.12 ? lerp(0.4, 1.3, k / 0.12) : lerp(1.3, 1, Math.min((k - 0.12) / 0.12, 1));
      f.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${sc.toFixed(3)})`;
      f.el.style.opacity = k < 0.6 ? '1' : (1 - (k - 0.6) / 0.4).toFixed(2);
    }
  }
  function clearFloaters() { for (const f of floaters) f.el.remove(); floaters.length = 0; }
  function tierOf(c) { return c >= 20 ? 2 : c >= 10 ? 1 : 0; }
  function updateComboUI(pop) {
    const combo = sim ? sim.combo : 0;
    comboNum.textContent = combo;
    multEl.textContent = '×' + ((10 + Math.min(combo, 30)) / 10).toFixed(1);
    comboEl.classList.toggle('on', combo > 0);
    const tier = tierOf(combo);
    comboEl.style.setProperty('--cc', TIER_CSS[tier]); edgeEl.style.setProperty('--ec', TIER_EDGE[tier]);
    accentTarget.copy(TIER_COL[tier]);
    comboFill.style.width = (combo > 0 && combo % 5 === 0 ? 100 : (combo % 5) * 20) + '%';
    if (pop) { cancelAnims(comboNum); comboNum.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'cubic-bezier(.2,1.4,.4,1)' }); }
  }
  /** combo przerwane: rdzeń już je wyzerował, tu tylko efekt */
  function comboBroken(before) {
    if (before >= 5) {
      announce('COMBO PRZERWANE', 'red'); Sfx.comboBreak();
      comboEl.animate([{ transform: 'translate(0,-50%)' }, { transform: 'translate(-12px,-50%)' }, { transform: 'translate(9px,-50%)' }, { transform: 'translate(0,-50%)' }], { duration: 260 });
    }
    updateComboUI(false);
  }

  /* ===================================================================== cele: widoki celów z rdzenia (id -> obiekt 3D) */
  const views = new Map();   // cel z rdzenia (obiekt) -> { t, vis, dying, demo, phase }
  function addView(t, quiet) {
    const vis = makeVisual(t.type);
    vis.group.position.set(t.x, t.y, t.z); vis.group.scale.setScalar(1e-4); scene.add(vis.group);
    views.set(t, { t, vis, dying: 0, demo: quiet, phase: rand(0, 6.28), pos: new THREE.Vector3(t.x, t.y, t.z) });
    ringFx.fire(vis.group.position, TCOL[t.type], t.radius * 0.5, t.radius * 2.1, 0.26, 1.3);
    if (!quiet) Sfx.spawn(t.type);
  }
  function dropView(t) { const v = views.get(t); if (v) { scene.remove(v.vis.group); views.delete(t); } }
  function clearViews() { for (const v of views.values()) scene.remove(v.vis.group); views.clear(); }
  let shake = 0, fovKick = 0, crossKick = 0, envFlash = 0;
  function pulseFloor(pos, color) { U.pulse.value = 0; U.center.value.set(pos.x, -pos.z); U.wave.value.copy(color); }
  function explode(t, pos, perfect, quiet) {
    const c = TCOL[t.type], r = t.radius, gold = t.type === GOLD;
    burst(pos, c, gold ? 90 : perfect ? 64 : 44, gold ? 13 : 9.5, 0.17, 0.6, 7, 2.4);
    burst(pos, COL.white, 14, 5, 0.1, 0.35, 2, 1.6);
    ringFx.fire(pos, c, r * 0.9, r * (perfect || gold ? 5 : 3.6), 0.4, 2.2);
    if (perfect || gold) ringFx.fire(pos, COL.white, r * 0.5, r * 2.6, 0.28, 1.8);
    popFx.fire(pos, c, r, r * 1.9, 0.13, 1.6);
    hitLight.color.copy(c); hitLight.position.copy(pos); hitLightI = quiet ? 20 : 55;
    pulseFloor(pos, c);
  }
  /** Zdarzenia z rdzenia -> efekty. `quiet` = runda pokazowa w menu (bez dźwięków i napisów) */
  function handleEvents(s, quiet) {
    for (const e of s.events) {
      if (e.k === 'spawn') addView(e.t, quiet);
      else if (e.k === 'expire') {
        const v = views.get(e.t);
        if (v && !v.dying) v.dying = 1e-4;
        if (!quiet && e.t.type === GOOD) { Sfx.expire(); floater(v ? v.pos : new THREE.Vector3(e.t.x, e.t.y, e.t.z), 'ZA WOLNO', 'miss'); comboBroken(prevCombo); prevCombo = 0; }
      } else if (e.k === 'hit') {
        const v = views.get(e.t), pos = v ? v.vis.group.position.clone() : new THREE.Vector3(e.t.x, e.t.y, e.t.z), gold = e.t.type === GOLD;
        explode(e.t, pos, e.perfect, quiet); dropView(e.t);
        if (quiet) continue;
        prevCombo = e.combo;
        tracerQueue.push({ end: pos.clone(), color: TCOL[e.t.type] });
        floater(pos, '+' + fmt(e.pts), gold ? 'gold' : e.perfect ? 'perfect' : 'good', gold ? 'BONUS' : e.perfect ? 'PERFEKT' : null);
        hitmark(gold ? '#ffc93c' : '#19e6ff', e.perfect || gold);
        if (gold) { Sfx.gold(); flash('rgba(255,200,60,.12)', 'rgba(255,190,60,.75)', 0.7, 420); shake = 1.1; }
        else { Sfx.hit(e.combo, e.perfect); flash('transparent', 'rgba(25,230,255,.6)', e.perfect ? 0.5 : 0.3, 220); }
        fovKick = -(e.perfect || gold ? 2.2 : 1.3); envFlash = Math.max(envFlash, gold ? 1 : 0.35);
        cancelAnims(scoreEl); scoreEl.animate([{ transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
        updateComboUI(true);
        const ms = MILESTONES[e.combo] || (e.combo >= 40 && e.combo % 10 === 0 ? ['LEGENDA! ×' + e.combo, 'mg'] : null);
        if (ms) { announce(ms[0], ms[1]); Sfx.milestone(e.combo / 5); envFlash = 1; flash('transparent', 'rgba(255,255,255,.45)', 0.6, 380); }
      } else if (e.k === 'bad') {
        const v = views.get(e.t), p = v ? v.vis.group.position.clone() : new THREE.Vector3(e.t.x, e.t.y, e.t.z);
        dropView(e.t);
        burst(p, COL.red, 70, 11, 0.2, 0.7, 6, 2.4); ringFx.fire(p, COL.red, e.t.radius, e.t.radius * 5, 0.45, 2.5); popFx.fire(p, COL.red, e.t.radius, e.t.radius * 2.4, 0.18, 2);
        hitLight.color.copy(COL.red); hitLight.position.copy(p); hitLightI = 70; pulseFloor(p, COL.red);
        tracerQueue.push({ end: p.clone(), color: COL.red });
        floater(p, '−300', 'bad', 'PUŁAPKA!'); hitmark('#ff3355', true);
        Sfx.bad(); flash('rgba(255,30,60,.22)', 'rgba(255,30,60,.95)', 0.95, 520);
        shake = 2.2; fovKick = 3;
        comboBroken(prevCombo); prevCombo = 0;
      } else if (e.k === 'miss') {
        _dir.set(e.x, e.y, e.z);
        const end = wallPoint(_dir, _v2).clone();
        tracerQueue.push({ end, color: COL.cy });
        burst(end, COL.cy, 10, 3, 0.09, 0.3, 4, 1.6); ringFx.fire(end, COL.cy, 0.08, 0.7, 0.2, 1.2);
        comboBroken(prevCombo); prevCombo = 0;
      }
    }
    s.events.length = 0;
  }
  let prevCombo = 0;
  function updateViews(dt) {
    const frac = acc / TICK;
    for (const [key, v] of views) {
      const t = v.t, g = v.vis.group;
      let s;
      if (v.dying) {
        v.dying += dt; const k = v.dying / 0.16;
        if (k >= 1) { dropView(key); continue; }
        s = t.radius * (1 - k);
      } else {
        const age = (t.age + (v.demo ? 0 : frac)) / 60;
        s = t.radius * easeOutBack(Math.min(age / 0.2, 1));
      }
      g.scale.setScalar(Math.max(s, 1e-4)); g.position.y = t.y + Math.sin(G.clock * 2.2 + v.phase) * 0.045;
      v.vis.ring.quaternion.copy(camera.quaternion);
      if (t.type === BAD) v.vis.ring.scale.setScalar(1.55 + Math.sin(G.clock * 9 + v.phase) * 0.08);
      else v.vis.ring.scale.setScalar(1.15 + 1.7 * clamp(1 - t.age / t.life, 0, 1));
      if (t.type === BAD) { v.vis.spin.rotation.x += dt * 0.9; v.vis.spin.rotation.y += dt * 1.4; }
      else if (t.type === GOLD) {
        v.vis.spin.rotation.y += dt * 4.5;
        if (Math.random() < dt * 16) emit(g.position.x + rand(-1, 1) * t.radius, g.position.y + rand(-1, 1) * t.radius, g.position.z, 0, rand(0.3, 0.9), 0, COL.gd.r * 2, COL.gd.g * 2, COL.gd.b * 2, 0.09, 0.5, -0.4);
      }
    }
  }

  /* ===================================================================== strzał */
  function wallPoint(d, out) {
    let t = 1e9;
    if (d.x > 1e-6) t = Math.min(t, (ROOM.x1 - EYE.x) / d.x); else if (d.x < -1e-6) t = Math.min(t, (ROOM.x0 - EYE.x) / d.x);
    if (d.y > 1e-6) t = Math.min(t, (ROOM.y1 - EYE.y) / d.y); else if (d.y < -1e-6) t = Math.min(t, (ROOM.y0 - EYE.y) / d.y);
    if (d.z > 1e-6) t = Math.min(t, (ROOM.z1 - EYE.z) / d.z); else if (d.z < -1e-6) t = Math.min(t, (ROOM.z0 - EYE.z) / d.z);
    return out.copy(EYE).addScaledVector(d, t - 0.06);
  }
  function shoot() {
    if (G.state !== 'playing' || !sim) return;
    recoil.v += 9; shake = Math.min(shake + 0.35, 1.2); crossKick = 1; gunGlow = 1;
    flashT = 0.06; gun.flash.visible = true; gun.flash.rotation.z = rand(0, 6.28); gun.flash.scale.setScalar(rand(0.2, 0.3));
    Sfx.shot();
    // kierunek z prawdziwego yaw/pitch (drgania kamery są tylko ozdobą), jako liczby całkowite - tak samo liczy serwer
    const cp = Math.cos(G.pitch);
    const q = [-Math.sin(G.yaw) * cp, Math.sin(G.pitch), -Math.cos(G.yaw) * cp].map(v => Math.round(v * QUANT));
    if (!sim.shoot(q[0], q[1], q[2])) return;   // za szybko po poprzednim strzale: tylko błysk
    handleEvents(sim, false);
  }

  /* ===================================================================== przebieg rundy */
  function setState(s) {
    G.state = s;
    const inGame = s === 'playing' || s === 'countdown';
    root.classList.toggle('playing', inGame);
    hudEl.classList.toggle('hidden', !(inGame || s === 'paused'));
    crossEl.classList.toggle('hidden', !(inGame || s === 'paused'));
    Sfx.music.mode(s);
  }
  function wrapYaw() { G.yaw = ((G.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; prevYaw = G.yaw; }
  async function startRound() {
    const token = ++starting;
    clearViews(); clearFloaters(); stopConfetti();
    demo = null; sim = null; acc = 0; prevCombo = 0;
    Object.assign(G, { shown: 0, cdT: 3, cdShown: 4, lastTick: 99, yaw: 0, pitch: 0 });
    prevYaw = 0; prevPitch = 0; sway.x = sway.y = sway.tx = sway.ty = 0; gunRaise = 0; shake = 0; fovKick = 0;
    hide(menuEl); hide(resultsEl); hide(pauseEl);
    timerEl.classList.remove('low'); updateComboUI(false);
    setState('countdown');
    // odliczanie trwa, a w tym czasie serwer losuje ziarno rundy
    let seed;
    try { seed = await hooks.onStart(G.diff, G.dur); } catch { seed = undefined; }
    if (token !== starting) return;
    if (!(seed instanceof LiveSeeds) || !seed.online) toast('Runda bez nagrody: serwer nie przyjął startu');
    live = seed instanceof LiveSeeds ? seed : LiveSeeds.local(SEG);
    sim = new AimSim(live.seed, G.diff, G.dur);
  }
  function updateCountdown(dt) {
    G.cdT -= dt; const n = Math.ceil(G.cdT);
    if (n !== G.cdShown) {
      G.cdShown = n;
      if (n > 0) { showCd(String(n)); Sfx.count(); }
    }
    if (G.cdT <= 0 && sim) { showCd('START!'); Sfx.go(); acc = 0; setState('playing'); }
  }
  function updateGame(dt) {
    acc += dt;
    let n = 0;
    while (acc >= TICK && n < 8 && !sim.over) {
      if (!live.canStep(sim.tick)) { acc = Math.min(acc, TICK); break; }   // czekamy na ziarno od serwera
      sim.step(); acc -= TICK; n++;
    }
    live.pump(sim.tick, sim.log, 4);
    if (n === 8) acc = 0;
    handleEvents(sim, false);
    const remaining = Math.max(0, (sim.total - sim.tick) * TICK - acc);
    if (remaining <= 10) {
      timerEl.classList.add('low');
      const s = Math.ceil(remaining); if (s !== G.lastTick && s > 0) { G.lastTick = s; Sfx.tick(s <= 3); }
    }
    if (sim.over) endRound();
  }
  function rankOf(score, dur) {
    const s = score * 60 / dur;
    if (s >= 60000) return ['S+', '#ffd45e']; if (s >= 42000) return ['S', '#ffd45e']; if (s >= 28000) return ['A', '#19e6ff'];
    if (s >= 16000) return ['B', '#7dffb0']; if (s >= 8000) return ['C', '#c9d4e6']; return ['D', '#8a93a6'];
  }
  function countUp(el, to, dur) {
    const t0 = performance.now();
    (function step(now) { const k = clamp((now - t0) / dur, 0, 1); el.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); })(t0);
  }
  const bestKey = () => 'best.' + G.diff + '.' + G.dur;
  function endRound() {
    const s = sim;
    setState('results');
    for (const v of views.values()) if (!v.dying) v.dying = 1e-4;
    wrapYaw();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    Sfx.end(); Sfx.stamp(0.6);
    const best = store.get(bestKey(), 0), isRec = s.score > best && s.score > 0;
    if (isRec) store.set(bestKey(), s.score);
    const accPct = s.shots ? s.hits / s.shots * 100 : 0, rt = s.hits ? s.rtSum / s.hits / 60 * 1000 : 0, [rk, rc] = rankOf(s.score, G.dur);
    const rankEl = $('r-rank'); rankEl.textContent = rk; rankEl.style.setProperty('--rc', rc);
    rankEl.classList.remove('stamp'); void rankEl.offsetWidth; rankEl.classList.add('stamp');
    countUp($('r-score'), s.score, 1100);
    $('r-mode').textContent = DIFFS[G.diff].name + ' · ' + G.dur + ' s';
    $('r-hits').textContent = s.hits; $('r-acc').textContent = accPct.toFixed(1).replace('.', ',') + '%';
    $('r-rt').textContent = rt ? Math.round(rt) + ' ms' : '—'; $('r-combo').textContent = s.maxCombo;
    $('r-perf').textContent = s.perfects; $('r-gold').textContent = s.golds; $('r-bad').textContent = s.badHits; $('r-exp').textContent = s.expired;
    $('r-rec').classList.toggle('hidden', !isRec); $('r-best').textContent = 'Rekord: ' + fmt(Math.max(best, s.score));
    const rw = $('r-reward'); rw.textContent = 'Serwer sprawdza wynik…';
    hooks.onOver({ score: s.score, hits: s.hits, shots: s.shots, diff: G.diff, dur: G.dur, log: s.log.slice(), record: isRec })
      .then(msg => { if (sim === s) rw.textContent = msg || ''; }).catch(() => { if (sim === s) rw.textContent = ''; });
    const act = $('r-actions'); act.classList.add('locked'); setTimeout(() => act.classList.remove('locked'), 1000);
    show(resultsEl);
    if (isRec || rk[0] === 'S' || rk === 'A') setTimeout(confetti, 650);
  }
  function pause() {
    if (G.state !== 'playing' && G.state !== 'countdown') return;
    G.prev = G.state; setState('paused');
    $('pause-note').textContent = 'Kliknij „Wznów”, żeby wrócić do gry.';
    show(pauseEl);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  function resume() { Sfx.ensure(); requestLock(() => { hide(pauseEl); setState(G.prev); }); }
  function goMenu() {
    starting++;
    clearViews(); clearFloaters(); stopConfetti(); wrapYaw();
    sim = null;
    hide(pauseEl); hide(resultsEl); setState('menu'); refreshMenu(); show(menuEl);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  // tryb pokazowy za menu: osobna runda bez zapisu, cele znikają same
  let demoPop = 1.5, demoAcc = 0;
  function updateDemo(dt) {
    const f = 1 - Math.exp(-dt * 1.5);
    G.yaw += (Math.sin(T * 0.17) * 0.2 - G.yaw) * f; G.pitch += (0.06 + Math.sin(T * 0.11) * 0.035 - G.pitch) * f;
    if (!demo || demo.over) demo = new AimSim(LiveSeeds.local(SEG).seed, 0, 120);
    demoAcc += dt;
    while (demoAcc >= TICK) { demo.step(); demoAcc -= TICK; }
    handleEvents(demo, true);
    demoPop -= dt;
    if (demoPop <= 0) {
      demoPop = rand(0.6, 1.2);
      const c = demo.targets.filter(t => t.type !== BAD && t.age > 20);
      if (c.length) {
        const t = c[(Math.random() * c.length) | 0];
        demo.targets.splice(demo.targets.indexOf(t), 1);
        const v = views.get(t);
        if (v) { explode(t, v.vis.group.position.clone(), false, true); dropView(t); }
      }
    }
  }

  /* ===================================================================== sterowanie + blokada kursora */
  let everLocked = false, pending = null, promiseMode = false;
  function requestLock(cb, tries = 0) {
    pending = cb;
    if (document.pointerLockElement === canvas) { pending = null; cb(); return; }
    const fail = () => {
      if (!pending) return;
      if (everLocked) {
        if (tries < 5) setTimeout(() => { if (pending) requestLock(pending, tries + 1); }, 300);
        else { pending = null; toast('Przeglądarka chwilowo blokuje kursor — kliknij jeszcze raz.'); }
        return;
      }
      const f = pending; pending = null; f();
    };
    requestLock.fail = fail;
    const plain = () => { try { const q = canvas.requestPointerLock(); if (q && q.then) { promiseMode = true; q.catch(fail); } } catch { fail(); } };
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.then) { promiseMode = true; p.catch(plain); }
    } catch { plain(); }
  }
  on(document, 'pointerlockchange', () => {
    if (document.pointerLockElement === canvas) { everLocked = true; if (pending) { const f = pending; pending = null; f(); } }
    else if (G.state === 'playing' || G.state === 'countdown') pause();
  });
  on(document, 'pointerlockerror', () => { if (!promiseMode && requestLock.fail) requestLock.fail(); });
  // bez blokady kursora (np. telefon, odmowa przeglądarki) celujemy, przeciągając myszą / palcem po planszy
  let drag = null;
  on(canvas, 'pointerdown', e => { if (document.pointerLockElement !== canvas && e.pointerType !== 'mouse') drag = { x: e.clientX, y: e.clientY }; });
  on(window, 'pointerup', () => { drag = null; });
  on(document, 'mousemove', e => {
    if (G.state !== 'playing' && G.state !== 'countdown') return;
    if (document.pointerLockElement !== canvas) return;
    const k = G.sens * 0.000384;
    G.yaw -= e.movementX * k; G.pitch = clamp(G.pitch - e.movementY * k, -1.45, 1.45);
  });
  on(canvas, 'pointermove', e => {
    if (!drag || (G.state !== 'playing' && G.state !== 'countdown')) return;
    const k = G.sens * 0.0012;
    G.yaw -= (e.clientX - drag.x) * k; G.pitch = clamp(G.pitch - (e.clientY - drag.y) * k, -1.45, 1.45);
    drag = { x: e.clientX, y: e.clientY };
  });
  function softLock() {
    if (document.pointerLockElement === canvas || pending) return;
    try { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => {}); } catch { /* bez blokady */ }
  }
  on(canvas, 'mousedown', e => { if (e.button === 0 && G.state === 'playing') { e.preventDefault(); shoot(); softLock(); } });
  on(canvas, 'contextmenu', e => e.preventDefault());
  const modal = () => document.querySelector('[aria-modal="true"]');
  function toggleFullscreen() { if (document.fullscreenElement) document.exitFullscreen?.(); else root.requestFullscreen?.().catch(() => {}); }
  on(window, 'keydown', e => {
    const el = e.target;
    if (el?.closest?.('input, textarea, select, [contenteditable]') || modal()) return;
    if (G.state === 'boot') return;
    if (e.code === 'KeyR' && ['playing', 'countdown', 'paused', 'results'].includes(G.state)) { e.preventDefault(); Sfx.ensure(); requestLock(startRound); }
    else if (e.code === 'Escape' && document.pointerLockElement !== canvas && (G.state === 'playing' || G.state === 'countdown')) pause();
    else if (e.code === 'KeyM' && !e.repeat && G.state !== 'menu') { setMusic(!Sfx.music.isOn()); toast('Muzyka: ' + (Sfx.music.isOn() ? 'włączona' : 'wyciszona')); }
    else if (e.code === 'KeyF' && !e.repeat && G.state !== 'menu') toggleFullscreen();
  });
  on(window, 'blur', pause);
  on(document, 'visibilitychange', () => { if (document.hidden) pause(); });

  /* ===================================================================== menu */
  function refreshMenu() {
    for (const b of $('seg-diff').children) b.classList.toggle('on', +b.dataset.v === G.diff);
    for (const b of $('seg-dur').children) b.classList.toggle('on', +b.dataset.v === G.dur);
    const best = store.get(bestKey(), 0); $('menu-best').textContent = best ? fmt(best) : '—';
    refreshMusicUI();
  }
  function refreshMusicUI() {
    const isOn = Sfx.music.isOn();
    for (const b of $('seg-music').children) b.classList.toggle('on', (b.dataset.v === '1') === isOn);
    $('p-music').textContent = '♪ MUZYKA: ' + (isOn ? 'WŁĄCZONA' : 'WYCISZONA');
  }
  function setMusic(v) { Sfx.ensure(); Sfx.music.set(v); refreshMusicUI(); }
  on($('seg-music'), 'click', e => { const v = e.target.dataset && e.target.dataset.v; if (v === undefined) return; setMusic(v === '1'); Sfx.ui(); });
  on($('p-music'), 'click', () => setMusic(!Sfx.music.isOn()));
  on($('seg-diff'), 'click', e => { const v = e.target.dataset && e.target.dataset.v; if (!v) return; G.diff = +v; store.set('diffIdx', G.diff); Sfx.ensure(); Sfx.ui(); refreshMenu(); });
  on($('seg-dur'), 'click', e => { const v = e.target.dataset && e.target.dataset.v; if (!v) return; G.dur = +v; store.set('dur', G.dur); Sfx.ensure(); Sfx.ui(); refreshMenu(); });
  const sensIn = $('sens'), volIn = $('vol');
  sensIn.value = G.sens; $('sens-o').textContent = G.sens.toFixed(2);
  on(sensIn, 'input', () => { G.sens = +sensIn.value; $('sens-o').textContent = G.sens.toFixed(2); store.set('sens', G.sens); });
  volIn.value = clamp(store.get('vol', 60), 0, 100); $('vol-o').textContent = volIn.value + '%';
  on(volIn, 'input', () => { $('vol-o').textContent = volIn.value + '%'; store.set('vol', +volIn.value); Sfx.ensure(); Sfx.setVol(volIn.value / 100); });
  on(volIn, 'change', () => Sfx.hit(3, false));
  const begin = () => { Sfx.ensure(); Sfx.ui(); requestLock(startRound); };
  on($('start'), 'click', begin); on($('again'), 'click', begin); on($('p-restart'), 'click', begin);
  on($('resume'), 'click', resume);
  on($('p-menu'), 'click', goMenu); on($('r-menu'), 'click', goMenu);

  /* ===================================================================== konfetti na ekranie wyników */
  const cf = $('confetti'), cx = cf.getContext('2d'); let cfParts = [], cfOn = false, cfLast = 0;
  function confetti() {
    if (G.state !== 'results') return;
    cf.width = W(); cf.height = H(); cfParts = [];
    const cols = ['#19e6ff', '#ff2d78', '#ffc93c', '#ffffff', '#7dffb0'];
    for (let i = 0; i < 180; i++) { const side = i % 2; cfParts.push({ x: side ? W() + 10 : -10, y: H() * rand(0.35, 0.8), vx: (side ? -1 : 1) * rand(300, 1000), vy: rand(-1000, -250), w: rand(6, 12), h: rand(8, 18), r: rand(0, 6.28), vr: rand(-9, 9), c: cols[i % cols.length], life: rand(2.2, 3.8) }); }
    if (!cfOn) { cfOn = true; cfLast = performance.now(); requestAnimationFrame(cfStep); }
  }
  function cfStep(now) {
    const dt = Math.min((now - cfLast) / 1000, 0.05); cfLast = now; cx.clearRect(0, 0, cf.width, cf.height); let alive = 0;
    for (const p of cfParts) {
      p.life -= dt; if (p.life <= 0) continue; alive++;
      p.vy += 1300 * dt; p.vx *= Math.exp(-dt * 1.2); p.vy *= Math.exp(-dt * 0.5); p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      const flip = Math.abs(Math.cos(p.r * 1.7));
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.globalAlpha = Math.min(1, p.life); cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h * flip / 2, p.w, p.h * flip); cx.restore();
    }
    if (alive && !destroyed) requestAnimationFrame(cfStep); else { cfOn = false; cx.clearRect(0, 0, cf.width, cf.height); }
  }
  function stopConfetti() { cfParts = []; }

  /* ===================================================================== co klatkę */
  function updateCamera(dt) {
    shake *= Math.exp(-dt * 13); fovKick *= Math.exp(-dt * 10); crossKick *= Math.exp(-dt * 12); envFlash *= Math.exp(-dt * 5);
    const a = shake * 0.0055;
    camera.rotation.set(G.pitch + (Math.random() - 0.5) * a, G.yaw + (Math.random() - 0.5) * a, (Math.random() - 0.5) * a * 0.6);
    const fov = BASE_FOV + fovKick;
    if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  let edgeShown = -1;
  function updateEnv(dt) {
    const combo = sim ? sim.combo : 0;
    const target = G.state === 'playing' ? clamp(combo / 25, 0, 1) : 0.12;
    G.energy += (target - G.energy) * (1 - Math.exp(-dt * 3));
    U.energy.value = G.energy + envFlash * 0.5;
    Sfx.music.heat(G.state === 'playing' ? G.energy : 0);
    U.pulse.value = Math.min(1, U.pulse.value + dt * 0.85);
    const k = 1 + G.energy * 0.6 + envFlash * 0.8;
    for (const m of neonMats) m.color.copy(m.userData.base).multiplyScalar(m.userData.k * k);
    hitLightI *= Math.exp(-dt * 9); hitLight.intensity = hitLightI;
    bloom.strength = 0.58 + G.energy * 0.2 + envFlash * 0.2;
    const pos = dust.geometry.attributes.position;
    for (let i = 0; i < dustSpeed.length; i++) { let y = pos.array[i * 3 + 1] + dustSpeed[i] * dt; if (y > ROOM.y1) y = ROOM.y0; pos.array[i * 3 + 1] = y; }
    pos.needsUpdate = true;
    const e = G.state === 'playing' ? Math.round(clamp(combo / 25, 0, 1) * 40) / 40 * 0.85 : 0;
    if (e !== edgeShown) { edgeShown = e; edgeEl.style.opacity = e; }
  }
  const hc = {};
  function setText(el, key, v) { if (hc[key] !== v) { hc[key] = v; el.textContent = v; } }
  function updateHud(dt) {
    if (G.state === 'menu' || G.state === 'results') return;
    const score = sim ? sim.score : 0, total = sim ? sim.total : G.dur * 60, tick = sim ? sim.tick : 0;
    const remaining = Math.max(0, (total - tick) * TICK - (G.state === 'playing' ? acc : 0));
    G.shown += (score - G.shown) * (1 - Math.exp(-dt * 14)); if (Math.abs(score - G.shown) < 1) G.shown = score;
    setText(scoreEl, 's', fmt(G.shown)); setText(timerEl, 't', remaining.toFixed(1));
    const k = Math.round(remaining / G.dur * 500) / 500; if (hc.k !== k) { hc.k = k; tbarEl.style.transform = `scaleX(${k})`; }
    setText(accEl, 'a', sim && sim.shots ? Math.round(sim.hits / sim.shots * 100) + '%' : '—');
    setText(rtEl, 'r', sim && sim.hits ? Math.round(sim.rtSum / sim.hits / 60 * 1000) + ' ms' : '—');
    const gap = (5 + crossKick * 8).toFixed(1); if (hc.g !== gap) { hc.g = gap; crossEl.style.setProperty('--gap', gap + 'px'); }
  }
  function resize() {
    const w = W(), h = H();
    renderer.setPixelRatio(PR); renderer.setSize(w, h, false); composer.setPixelRatio(PR); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    pMat.uniforms.uScale.value = h * PR / (2 * Math.tan(THREE.MathUtils.degToRad(BASE_FOV) / 2));
  }
  const ro = new ResizeObserver(resize); ro.observe(root);
  let fpsAcc = 0, fpsN = 0, downs = 0;
  function perf(real) {
    if (real > 0.25) { fpsAcc = 0; fpsN = 0; return; }
    fpsAcc += real; fpsN++;
    if (fpsAcc >= 2) {
      if (fpsN / fpsAcc < 40 && downs < 3 && T > 3 && PR > 0.6) { downs++; PR = Math.max(0.6, PR * 0.8); resize(); }
      fpsAcc = 0; fpsN = 0;
    }
  }
  let lastT = performance.now(), raf = 0, destroyed = false;
  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    const real = (now - lastT) / 1000; lastT = now; const dt = clamp(real, 0, 0.05);
    perf(real); T += dt;
    if (G.state === 'countdown') updateCountdown(dt);
    if (G.state === 'playing' && sim) updateGame(dt);
    if (G.state === 'menu' || G.state === 'results') updateDemo(dt);
    const step = G.state === 'paused' ? 0 : dt; G.clock += step;
    updateCamera(dt); updateGun(dt); camera.updateMatrixWorld(true); flushTracers();
    if (step > 0) { updateViews(step); ringFx.update(step); popFx.update(step); updateTracers(step); updateParticles(step); updateFloaters(step); }
    updateEnv(dt); updateHud(dt);
    composer.render();
  }

  resize(); refreshMenu(); setState('menu'); show(menuEl);
  if (import.meta.env.DEV) window.__aim = { get sim() { return sim; }, get state() { return G.state; }, shoot, startRound };   // podgląd w testach (tylko npm run dev)
  raf = requestAnimationFrame(frame);

  return {
    pause,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      starting++;
      cleanups.forEach(f => f());
      ro.disconnect();
      clearTimeout(toastTimer);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      if (document.fullscreenElement === root) document.exitFullscreen?.();
      Sfx.destroy();
      clearFloaters();
      scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => { x.map?.dispose?.(); x.dispose?.(); }); });
      composer.dispose?.();
      renderer.dispose();
      root.innerHTML = '';
      root.classList.remove('ap-root', 'playing');
    },
  };
}
