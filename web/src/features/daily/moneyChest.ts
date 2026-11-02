// Skrzynka z pieniędzmi z codziennej nagrody: trzęsie się, bęben z kwotami, licznik i deszcz monet.
// Działa nad całą stroną, tak jak wielkie odsłonięcie karty.
import { api } from '../../api/client';
import { coinRain, confetti, epicOpen, GOLDS, makeParticles } from '../../fx/effects';
import { rand } from '../../game/rules';
import { applyState } from '../../game/session';
import { S, touch } from '../../game/store';
import { esc, fmt, sleep } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import { crateIconSrc } from '../crates/crateIcon';
import { moneyLook3d } from '../crates/crateLook';
import './moneyStage.css';

const TIERS: [number, string][] = [[.15, '#4fc34f'], [.35, '#4b8bff'], [.6, '#a35bff'], [.85, '#ff4040'], [1.01, '#ffc531']];

function tier(kind: string, v: number) {
  const m = S.cfg.moneyChests[kind], f = (v - m.min) / (m.max - m.min);
  return TIERS.find(([lim]) => f < lim)![1];
}
const cosmetic = (kind: string) => {
  const m = S.cfg.moneyChests[kind];
  return Math.round((m.min + (m.max - m.min) * Math.random() ** m.curve) / 100) * 100;
};
function tile(kind: string, v: number, win = false) {
  const short = v >= 10000 ? `${Math.round(v / 1000)}k` : `${(v / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}k`;
  return `<div class="mini money-tile${win ? ' win' : ''}" style="--rc:${tier(kind, v)}"><div class="mt-val"><b>${short}</b></div><div class="mn">${fmt(v)}</div></div>`;
}

/** Skrzynka z pieniędzmi jako HTML: obrazek modelu 3D, gdy jest już narysowany, inaczej płaski rysunek */
export function moneyChestHTML(kind: string, cls = '') {
  const m = S.cfg.moneyChests[kind];
  const src = crateIconSrc(moneyLook3d(m));
  if (src) return `<img class="${cls}" src="${src}" alt="" draggable="false">`;
  return `<svg class="${cls}" viewBox="0 0 120 100" aria-hidden="true"><rect x="10" y="38" width="100" height="54" rx="4" fill="${m.color2}"/><path d="M8 40 14 16q1-4 5-4h82q4 0 5 4l6 24z" fill="${m.color1}"/><rect x="10" y="40" width="100" height="4" fill="#00000033"/><circle cx="60" cy="63" r="15" fill="${m.color1}"/><path d="M60 54v18M65 57h-7a3.5 3.5 0 0 0 0 7h4a3.5 3.5 0 0 1 0 7h-8" fill="none" stroke="${m.color2}" stroke-width="2.4" stroke-linecap="round"/></svg>`;
}

export async function openMoneyChest(kind: string) {
  if (S.opening || epicOpen() || document.querySelector('.money-stage')) return;
  const M = S.cfg.moneyChests[kind];
  Sound.unlock();
  let res: any;
  try { res = await api('/api/chests/money', { kind }); } catch (e: any) { Sound.error(); return toast(e.message, true); }
  S.chests = res.chests;
  touch();
  const fast = !!S.fast;
  const el = document.createElement('div');
  el.className = `money-stage mk-${kind}`;
  el.style.setProperty('--m1', M.color1);
  el.innerHTML = `
    <div class="ms-bg"></div>
    <canvas class="ms-canvas"></canvas>
    <div class="ms-title">${esc(M.name)}</div>
    <div class="ms-chest-wrap">${moneyChestHTML(kind, 'ms-chest-svg')}</div>
    <div class="fa-reel reel ms-reel" hidden><div class="strip"></div><div class="reel-marker"></div></div>
    <div class="ms-result" hidden></div>
    <div class="flash fa-flash"></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  const P = makeParticles(el.querySelector('.ms-canvas'));
  const chest = el.querySelector('.ms-chest-svg')!;
  const cx = () => innerWidth / 2, cy = () => innerHeight / 2;

  // Spacja/Enter/Esc: w trakcie bębna przewija do wyniku, na wyniku = Odbierz
  let skip = false, t0 = 0, D = 0;
  const finish = (again = false) => {
    window.removeEventListener('keydown', onKey, true);
    P.stop();
    el.remove();
    document.body.style.overflow = '';
    if (again) openMoneyChest(kind);
  };
  function onKey(e: KeyboardEvent) {
    if (![' ', 'Enter', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!el.querySelector('.ms-result')!.hasAttribute('hidden')) return finish();
    skip = true;
    t0 = performance.now() - D;
  }
  window.addEventListener('keydown', onKey, true);

  chest.classList.add('shaking');
  Sound.charge(fast ? .5 : 1.1, kind === 'mega');
  await sleep(fast ? 500 : 1100);
  chest.classList.remove('shaking');
  Sound.open();
  P.burst(cx(), cy(), kind === 'mega' ? 160 : 90, [M.color1, '#ffe58a', '#fff'], { speed: 13 });
  await sleep(fast ? 250 : 450);
  el.querySelector('.ms-chest-wrap')!.remove();

  const reel = el.querySelector('.ms-reel') as HTMLElement;
  reel.hidden = false;
  const strip = reel.querySelector('.strip') as HTMLElement;
  const MW = Math.min(130, innerWidth / 6), GAP = 8, N = 46, WIN = 38;
  reel.style.setProperty('--mw', `${MW}px`);
  reel.style.setProperty('--gap', `${GAP}px`);
  reel.style.setProperty('--rh', `${Math.round(MW * 1.05 + 45)}px`);
  const vals = Array.from({ length: N }, () => cosmetic(kind));
  vals[WIN] = res.amount;
  if (Math.random() < .35) vals[WIN + (Math.random() < .5 ? -1 : 1)] = Math.round((M.max - Math.random() * (M.max - M.min) * .1) / 100) * 100;
  strip.innerHTML = vals.map((v, i) => tile(kind, v, i === WIN)).join('');
  await sleep(50);
  const step = MW + GAP, center = reel.clientWidth / 2, to = -(WIN * step + MW / 2 + rand(-.4, .4) * MW) + center;
  D = skip ? 1 : fast ? 1000 : 4300;
  t0 = performance.now();
  let lastIdx = -1;
  await new Promise<void>(done => {
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / D), x = to * (1 - Math.pow(1 - t, 4.2));
      strip.style.transform = `translate3d(${x}px, -50%, 0)`;
      const idx = Math.floor((center - x) / step);
      if (idx !== lastIdx) { if (lastIdx >= 0) Sound.tick(1 - t); lastIdx = idx; }
      if (t < 1) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  });
  const color = tier(kind, res.amount);
  reel.classList.add('landed');
  reel.style.setProperty('--rc', color);
  await sleep(fast ? 250 : 600);

  const f = (res.amount - M.min) / (M.max - M.min);
  reel.hidden = true;
  const box = el.querySelector('.ms-result') as HTMLElement;
  box.hidden = false;
  const more = S.chests[`money_${kind}`] || 0;
  box.innerHTML = `
    <div class="ms-label">${f >= .85 ? 'Wielka wygrana' : f >= .6 ? 'Świetnie' : f >= .35 ? 'Nieźle' : 'Wygrywasz'}</div>
    <div class="ms-amount" style="--rc:${color}">+<span id="msCount">0</span> gr</div>
    <div class="fa-result-btns">
      ${more ? `<button class="ms-btn hue" data-act="again">Otwórz kolejną (${more})</button>` : ''}
      <button class="ms-btn" data-act="ok">Odbierz</button>
    </div>`;
  applyState(res.state);
  Sound.cash();
  coinRain(Math.min(180, 30 + Math.round(f * 150)));
  if (f >= .6 || kind === 'mega') {
    const fl = el.querySelector('.fa-flash') as HTMLElement;
    fl.style.background = `radial-gradient(circle, #fff, ${color}88 40%, transparent 75%)`;
    fl.classList.add('go');
    P.burst(cx(), cy(), 200 + Math.round(f * 250), [color, '#ffe58a', '#fff', M.color1], { speed: 18, stars: .35 });
    if (f >= .85) { (Sound as any).boom(false); Sound.gold(); el.classList.add('shake'); setTimeout(() => confetti(GOLDS, 200), 300); }
    else Sound.win();
  }
  const counter = box.querySelector('#msCount') as HTMLElement, c0 = performance.now(), CD = fast ? 500 : 1300;
  const count = (now: number) => {
    const t = Math.min(1, (now - c0) / CD);
    counter.textContent = Math.round(res.amount * (1 - Math.pow(1 - t, 3))).toLocaleString('pl-PL');
    if (t < 1 && document.body.contains(counter)) requestAnimationFrame(count);
  };
  requestAnimationFrame(count);

  box.addEventListener('click', e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) finish(act === 'again');
  });
}
