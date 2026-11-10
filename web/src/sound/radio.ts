// Radio (funkcje eksperymentalne): muzyka z albumów dodanych przez admina (`/api/radio`), grana w pętli w losowej kolejności albo
// po kolei (tak, jak ułożył ją admin). Ma własną głośność i wyciszenie, niezależne od efektów dźwiękowych (`Sound`); wyciszenie
// całej gry (ikona dźwięku) wycisza też radio. Wybór gracza (włączone, album, tryb, głośność) jest w localStorage.
// Przeglądarka nie pozwala grać przed pierwszym kliknięciem, więc po odmowie radio rusza przy pierwszej interakcji ze stroną.
import { useSyncExternalStore } from 'react';
import { api } from '../api/client';
import { Sound } from './sound';

export interface RadioTrack { id: number; title: string; credit: string; sourceUrl: string; url: string }
export interface RadioAlbum { id: number; name: string; description: string; shuffle: boolean; tracks: RadioTrack[] }
export type RadioMode = 'shuffle' | 'order';

export interface RadioState {
  on: boolean;
  albums: RadioAlbum[];
  loaded: boolean;
  albumId: number | null;
  mode: RadioMode;
  volume: number;      // 0-1, tylko muzyka
  muted: boolean;      // wyciszona tylko muzyka
  playing: boolean;
  blocked: boolean;    // przeglądarka czeka na kliknięcie
  track: RadioTrack | null;
}

const KEY = { on: 'radioOn', album: 'radioAlbum', mode: 'radioMode', vol: 'radioVol', mute: 'radioMute' };
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* bez zapisu */ } };

const volStored = parseFloat(read(KEY.vol) ?? '');
let state: RadioState = {
  on: read(KEY.on) === '1', albums: [], loaded: false,
  albumId: read(KEY.album) ? +read(KEY.album)! : null,
  mode: read(KEY.mode) === 'order' ? 'order' : 'shuffle',
  volume: volStored >= 0 && volStored <= 1 ? volStored : 0.5,
  muted: read(KEY.mute) === '1', playing: false, blocked: false, track: null,
};
let modeChosen = read(KEY.mode) !== null;   // gracz sam wybrał tryb; inaczej obowiązuje domyślny z albumu
const listeners = new Set<() => void>();
const set = (p: Partial<RadioState>) => { state = { ...state, ...p }; listeners.forEach(l => l()); };

let audio: HTMLAudioElement | null = null;
let queue: number[] = [];     // indeksy utworów w kolejce
let pos = -1;                 // miejsce w kolejce
let history: number[] = [];   // ostatnio grane (do „poprzedni”)
let started = false, fails = 0, poll = 0;

const album = () => state.albums.find(a => a.id === state.albumId) ?? null;

function shuffled(n: number, avoid: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (n > 1 && a[0] === avoid) [a[0], a[1]] = [a[1], a[0]];   // po przetasowaniu nie powtarzamy utworu, który właśnie grał
  return a;
}
function buildQueue(current = -1) {
  const n = album()?.tracks.length ?? 0;
  queue = state.mode === 'order' ? Array.from({ length: n }, (_, i) => i) : shuffled(n, current);
  pos = state.mode === 'order' && current >= 0 ? current - 1 : -1;
}

function apply() {
  if (!audio) return;
  audio.volume = state.volume;
  audio.muted = state.muted || !Sound.enabled;
}

function el(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('ended', () => { if (!started) return; fails = 0; next(); });
  audio.addEventListener('playing', () => set({ playing: true, blocked: false }));
  audio.addEventListener('pause', () => { if (!audio?.ended) set({ playing: false }); });
  audio.addEventListener('error', () => {
    if (!started) return;   // po wyłączeniu radia czyszczenie src też zgłasza błąd
    if (++fails > 3) { set({ playing: false }); return; }   // uszkodzony plik: przeskakujemy, ale bez pętli błędów
    setTimeout(next, 800);
  });
  apply();
  return audio;
}

async function play(index: number) {
  const a = album();
  const t = a?.tracks[index];
  if (!a || !t) return;
  const e = el();
  const abs = new URL(t.url, location.href).href;
  if (e.src !== abs) e.src = abs;
  set({ track: t });
  apply();
  try { await e.play(); } catch (err: any) {
    if (err?.name === 'NotAllowedError') { set({ playing: false, blocked: true }); waitForGesture(); }
  }
}

function waitForGesture() {
  const go = () => {
    window.removeEventListener('pointerdown', go, true); window.removeEventListener('keydown', go, true);
    if (state.on && state.blocked) audio?.play().catch(() => {});
  };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}

export function next() {
  const a = album();
  if (!a || !a.tracks.length) return;
  const cur = queue[pos] ?? -1;
  if (pos + 1 >= queue.length) { buildQueue(cur); pos = -1; }   // koniec kolejki: pętla (po przetasowaniu od nowa albo od pierwszego)
  pos++;
  const idx = queue[pos];
  if (cur >= 0) history.push(cur);
  if (history.length > 50) history.shift();
  void play(idx);
}

export function prev() {
  const e = audio;
  if (e && e.currentTime > 4) { e.currentTime = 0; return; }   // jak w odtwarzaczach: najpierw początek utworu
  const idx = history.pop();
  if (idx === undefined) { if (e) e.currentTime = 0; return; }
  pos = Math.max(-1, pos - 1);
  void play(idx);
}

function begin() {
  if (started || !state.on) return;
  const a = album();
  if (!a) return;
  started = true;
  buildQueue();
  next();
  clearInterval(poll);
  poll = window.setInterval(apply, 700);   // wyciszenie całej gry (Sound) nie ma zdarzenia
}

function halt() {
  started = false;
  clearInterval(poll);
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  history = []; queue = []; pos = -1;
  set({ playing: false, blocked: false, track: null });
}

/** Pobiera albumy i (jeśli gracz włączył radio) zaczyna grać. Wołane raz po zalogowaniu. */
export async function initRadio() {
  if (state.loaded) return;
  try {
    const r = await api<{ albums: RadioAlbum[] }>('/api/radio');
    const albums = r.albums;
    let albumId = state.albumId;
    if (!albums.some(a => a.id === albumId)) albumId = albums[0]?.id ?? null;
    set({ albums, loaded: true, albumId });
    if (!modeChosen) { const a = albums.find(x => x.id === albumId); if (a) set({ mode: a.shuffle ? 'shuffle' : 'order' }); }
    if (state.on) begin();
  } catch { set({ loaded: true }); }
}

export function setRadioOn(on: boolean) {
  write(KEY.on, on ? '1' : '0');
  set({ on });
  if (on) { if (!state.albumId && state.albums[0]) set({ albumId: state.albums[0].id }); begin(); } else halt();
}

export function setRadioAlbum(id: number) {
  write(KEY.album, String(id));
  const a = state.albums.find(x => x.id === id);
  set({ albumId: id });
  if (a && !modeChosen) set({ mode: a.shuffle ? 'shuffle' : 'order' });
  if (state.on) { halt(); begin(); }
}

export function setRadioMode(mode: RadioMode) {
  modeChosen = true;
  write(KEY.mode, mode);
  set({ mode });
  if (started) { const cur = queue[pos] ?? -1; buildQueue(cur); if (mode === 'order') pos = cur; }   // bieżący utwór dogrywa się do końca
}

export function setRadioVolume(v: number) {
  const volume = Math.max(0, Math.min(1, v));
  write(KEY.vol, String(volume));
  set({ volume });
  apply();
}

export function setRadioMuted(muted: boolean) {
  write(KEY.mute, muted ? '1' : '0');
  set({ muted });
  apply();
}

export function toggleRadioPause() {
  if (!state.on) return;
  if (!started) { begin(); return; }
  const e = el();
  if (e.paused) e.play().catch(() => { set({ blocked: true }); waitForGesture(); }); else e.pause();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useRadio = () => useSyncExternalStore(subscribe, () => state);
