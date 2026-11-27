// Animacja losowania skrzynki z naklejkami: te same bębny co przy skrzynkach z kartami (poziomy pasek z kafelkami przesuwa się z hamowaniem i staje na
// wylosowanej naklejce, tyknięcia przy każdym kafelku, dźwięk lądowania zależny od rzadkości, „Pomiń” kończy od razu). Wynik losowania jest już znany
// z serwera (`drops`), bębny tylko go odgrywają; pasek układa się z zawartości skrzynki (`pool`) z wagami jej szans.
// Po animacji wołający pokazuje okno z wynikiem (`StickerRevealHost`).
import { rarityIdx } from '../../game/rules';
import { S } from '../../game/store';
import { esc } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { loadCrateIcon } from '../crates/crateIcon';
import { crateLook3d } from '../crates/crateLook';
import type { Crate } from '../../game/types';
import { stickerTileHTML, type StkDrop } from './stickers';
import './stickerOpening.css';

export interface PoolItem { sticker: string; name: string; rarity: string; v: number; chance: number }

const STRIP = 54, WIN = 46;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Odgrywa losowanie; rozwiązuje się po zatrzymaniu wszystkich bębnów (albo po „Pomiń”) i zamknięciu nakładki */
export function playStickerOpening(crate: { id: string; name: string; emoji: string; color1: string; color2: string }, drops: StkDrop[], pool: PoolItem[]): Promise<void> {
  const fast = !!S.fast;
  if (!drops.length || fast || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  return new Promise<void>(done => {
    const n = drops.length;
    const root = document.createElement('div');
    root.className = 'sko';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Losowanie naklejek');
    root.innerHTML = `
      <div class="sko-head"><img class="sko-crate" alt="" hidden><b>${esc(crate.name)}${n > 1 ? ` × ${n}` : ''}</b><button type="button" class="sko-skip">Pomiń</button></div>
      <div class="sko-reels"></div>`;
    document.body.appendChild(root);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const img = root.querySelector<HTMLImageElement>('.sko-crate')!;
    loadCrateIcon(crateLook3d(crate as unknown as Crate)).then(src => { if (src && root.isConnected) { img.src = src; img.hidden = false; } });

    const reels = root.querySelector<HTMLElement>('.sko-reels')!;
    const cols = Math.min(n <= 2 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, Math.max(1, Math.floor((innerWidth - 40) / 230)));
    reels.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    reels.style.maxWidth = n <= 2 ? '900px' : '1200px';
    const cellW = (Math.min(reels.clientWidth || innerWidth - 40, 1200) - 12 * (cols - 1)) / cols;
    const mw = Math.max(64, Math.min(130, cellW / 4.2)), gap = Math.max(6, Math.round(mw * .08)), rh = Math.round(mw * 1.2 + 26);
    const color = (r: string) => S.cfg.rarities[r]?.color ?? '#9aa3ad';
    const weights = pool.map(p => Math.max(p.chance, 1e-6)), sum = weights.reduce((a, b) => a + b, 0);
    const pick = () => { let t = Math.random() * sum; for (let i = 0; i < pool.length; i++) { t -= weights[i]; if (t <= 0) return pool[i]; } return pool[pool.length - 1]; };
    const tile = (p: { sticker: string; rarity: string; v: number }, variant: string) =>
      `<span class="sko-tile" style="--rc:${color(p.rarity)}">${stickerTileHTML(p.sticker, variant, p.v)}</span>`;

    const now = performance.now();
    const list = drops.map((d, i) => {
      const tiles = Array.from({ length: STRIP }, (_, k) => (k === WIN ? tile(d, d.variant) : tile(pool.length ? pick() : d, 'normal')));
      const el = document.createElement('div');
      el.className = 'sko-reel';
      el.style.setProperty('--rh', `${rh}px`);
      el.style.setProperty('--mw', `${mw}px`);
      el.style.setProperty('--gap', `${gap}px`);
      el.innerHTML = `<div class="sko-strip">${tiles.join('')}</div><div class="sko-mark"></div>`;
      reels.appendChild(el);
      const strip = el.firstElementChild as HTMLElement, step = mw + gap, center = cellW / 2;
      const from = rand(0, step * .8), to = -(WIN * step + mw / 2 + rand(-.38, .38) * mw) + center;
      strip.style.transform = `translate3d(${from}px, -50%, 0)`;
      return { el, strip, rarity: d.rarity, from, to, step, center, dur: rand(4600, 5600), start: now + i * 70, lastIdx: -1, done: false };
    });

    Sound.open();
    let finished = false, lastLand = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('keydown', key, true);
      document.body.style.overflow = prevOverflow;
      root.remove();
      done();
    };
    const settle = () => setTimeout(finish, document.hidden ? 100 : 750);
    const ease = (t: number) => 1 - Math.pow(1 - t, 4.2);
    const next = () => (document.hidden ? setTimeout(() => frame(performance.now()), 50) : requestAnimationFrame(frame));
    const frame = (ts: number) => {
      if (finished) return;
      if (document.hidden) list.forEach(r => { r.start = Math.min(r.start, ts - r.dur); });
      let all = true;
      for (const r of list) {
        if (r.done) continue;
        const t = Math.max(0, Math.min(1, (ts - r.start) / r.dur)), x = r.from + (r.to - r.from) * ease(t);
        r.strip.style.transform = `translate3d(${x.toFixed(1)}px, -50%, 0)`;
        const idx = Math.floor((r.center - x) / r.step);
        if (idx !== r.lastIdx) { if (r.lastIdx >= 0) Sound.tick(1 - t); r.lastIdx = idx; }
        if (t >= 1) {
          r.done = true;
          r.el.classList.add('landed');
          if (rarityIdx(r.rarity) >= rarityIdx('gold')) r.el.classList.add('jackpot');
          r.el.style.setProperty('--rc', color(r.rarity));
          if (ts - lastLand > 60) { Sound.land(r.rarity === 'secret' ? 'ultra' : r.rarity); lastLand = ts; }
        } else all = false;
      }
      if (all) { img.classList.remove('sko-shake'); root.querySelector('.sko-skip')?.setAttribute('hidden', ''); settle(); } else next();
    };
    // „Pomiń” i Esc: bębny od razu na miejscu
    const skip = () => {
      if (finished) return;
      list.forEach(r => { r.strip.style.transform = `translate3d(${r.to}px, -50%, 0)`; r.el.classList.add('landed'); r.el.style.setProperty('--rc', color(r.rarity)); r.done = true; });
      finished = true;
      setTimeout(() => { finished = false; finish(); }, 250);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); skip(); } };
    window.addEventListener('keydown', key, true);
    root.querySelector('.sko-skip')!.addEventListener('click', skip);
    img.classList.add('sko-shake');
    next();
  });
}
