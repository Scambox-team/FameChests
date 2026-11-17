// Dźwięki Obrony Orbity: mały syntezator Web Audio (bez plików), głośność i wyciszenie jak w całej grze (Sound)
import { Sound } from '../../sound/sound';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
const MARCH = [98, 87, 78, 73];

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    out = ctx.createGain();
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  out!.gain.value = 0.35 * Sound.volume;
  return ctx;
}

function tone(type: OscillatorType, f: number, f2: number, dur: number, vol: number, delay = 0) {
  const c = ac(), t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out!);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number) {
  const c = ac(), t = c.currentTime;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
  s.connect(f).connect(g).connect(out!);
  s.start(t);
}

export function invSound(k: string, n = 0) {
  if (!Sound.enabled) return;
  try {
    switch (k) {
      case 'shoot': tone('square', 1200, 300, 0.09, 0.08); break;
      case 'kill': noise(0.18, 0.5, 2400); tone('triangle', 440, 110, 0.15, 0.1); break;
      case 'bomb': break;
      case 'march': tone('square', MARCH[n & 3], 0, 0.07, 0.12); break;
      case 'hit': noise(0.6, 0.8, 900); tone('sawtooth', 220, 40, 0.6, 0.15); break;
      case 'saucer': [0, 4, 7, 12].forEach((s, i) => tone('triangle', 660 * 2 ** (s / 12), 0, 0.12, 0.12, i * 0.06)); break;
      case 'ufo': tone('sine', 900, 1300, 0.25, 0.05); tone('sine', 1300, 900, 0.25, 0.05, 0.25); break;
      case 'wave': [0, 3, 7, 12].forEach((s, i) => tone('square', 330 * 2 ** (s / 12), 0, 0.14, 0.07, i * 0.09)); break;
      case 'life': [0, 7, 12].forEach((s, i) => tone('triangle', 520 * 2 ** (s / 12), 0, 0.16, 0.1, i * 0.08)); break;
      case 'start': tone('square', 220, 880, 0.3, 0.07); break;
      case 'over': [0, -3, -7, -12].forEach((s, i) => tone('triangle', 330 * 2 ** (s / 12), 0, 0.3, 0.12, i * 0.2)); break;
    }
  } catch { /* bez dźwięku */ }
}
