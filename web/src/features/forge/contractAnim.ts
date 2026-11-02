// Animacja kontraktu: karty z wachlarza po kolei wjeżdżają do stosu na środku, stos gaśnie w linię światła
// w kolorze rzadkości wyniku, potem bęben i odsłonięcie wyniku (ten sam język co epicReveal)
import { api } from '../../api/client';
import { cardHTML } from '../../cards/cardHtml';
import { confetti, epicReveal, makeParticles, RAINBOW, SECRET_COLORS } from '../../fx/effects';
import { announceFirsts, removeItems, sellIds } from '../../game/actions';
import { crateOf, isSpecial, person, rand, rarityIdx, variantName } from '../../game/rules';
import { applyState, refreshConfig } from '../../game/session';
import { S, touch } from '../../game/store';
import type { Item } from '../../game/types';
import { esc, fmt, sleep } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import { miniHTML } from '../crates/opening';
import './contract.css';

interface Options { items: Item[]; next: string; canAgain: () => boolean; onDone: (again: boolean) => void }

export async function runContractAnim({ items, next, canAgain, onDone }: Options) {
  const NR = S.cfg.rarities[next], fast = !!S.fast;
  Sound.unlock();
  const resP = api('/api/contract', { ids: items.map(i => i.id) }).catch(e => ({ error: e.message }));
  const el = document.createElement('div');
  el.className = 'forge-anim';
  el.style.setProperty('--nc', NR.color);
  el.innerHTML = `
    <div class="fa-bg"></div>
    <canvas class="fa-canvas"></canvas>
    <div class="fa-title"><span>Kontrakt</span><b>${esc(NR.name)}</b></div>
    <div class="fa-line"></div>
    <div class="fa-ring">${items.map(i => `<div class="fa-card">${cardHTML(i.person, i.variant, i.id)}</div>`).join('')}</div>
    <div class="fa-reel reel" hidden><div class="strip fa-strip"></div><div class="reel-marker"></div></div>
    <div class="fa-result" hidden></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  const finish = (again = false) => { P.stop(); el.remove(); document.body.style.overflow = ''; onDone(again); };
  const P = makeParticles(el.querySelector('.fa-canvas'));
  const cards = [...el.querySelectorAll<HTMLElement>('.fa-card')];
  const colors = next === 'ultra' ? RAINBOW : next === 'secret' ? SECRET_COLORS : [NR.color, '#ffffff', NR.color];

  const D1 = fast ? 1100 : 2600, t0 = performance.now(), n = cards.length;
  const ease = (u: number) => 1 - Math.pow(1 - u, 3);
  const tilt = cards.map(() => rand(-4, 4));
  Sound.charge(D1 / 1000, rarityIdx(next) >= rarityIdx('ultra'));
  requestAnimationFrame(() => el.classList.add('charging'));
  await new Promise<void>(done => {
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / D1), w = innerWidth, h = innerHeight;
      const spread = Math.min(w * .78, n * 120) / Math.max(1, n - 1);
      cards.forEach((c, k) => {
        // wachlarz u dołu ekranu, potem karta po karcie do stosu na środku
        const off = k - (n - 1) / 2, fanX = off * spread, fanY = h * .2 + off * off * 3, fanR = off * 4;
        const u = ease(Math.max(0, Math.min(1, (t - k / n * .45) / .38)));
        const x = fanX * (1 - u), y = fanY * (1 - u) - u * k * .6, r = fanR * (1 - u) + tilt[k] * u;
        const squash = t > .82 ? 1 - ease((t - .82) / .18) : 1;   // stos gaśnie w linię
        const sc = .9 - u * .12;
        c.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${r}deg) scale(${sc}, ${sc * Math.max(.02, squash)})`;
        c.style.opacity = String(t > .82 ? squash : Math.min(1, t * 6));
      });
      if (t > .3 && Math.random() < .35) P.implode(w / 2, h / 2, 3, colors, Math.min(w, h) * .45);
      if (t < 1) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  });
  el.classList.remove('charging');
  el.classList.add('lit');

  const res: any = await resP;
  if (!res.error && res.discovered?.length) await refreshConfig();
  P.burst(innerWidth / 2, innerHeight / 2, 120, colors, { speed: 12 });
  Sound.whoosh();
  el.querySelector('.fa-ring')!.remove();
  if (res.error) {
    Sound.error();
    toast(res.error, true);
    await sleep(500);
    return finish();
  }

  removeItems(res.consumed);
  S.items = [res.item, ...S.items];
  applyState(res.state);

  const candidates = crateOf(res.crate).people.filter(id => person(id).rarity === next && person(id).forge);
  if (!candidates.includes(res.item.person)) candidates.push(res.item.person);
  const reel = el.querySelector('.fa-reel') as HTMLElement;
  reel.hidden = false;
  const strip = reel.querySelector('.fa-strip') as HTMLElement;
  const MW = Math.min(130, innerWidth / 6), GAP = 8, N = 40, WIN = 33;
  reel.style.setProperty('--mw', `${MW}px`);
  reel.style.setProperty('--gap', `${GAP}px`);
  reel.style.setProperty('--rh', `${Math.round(MW * 1.05 + 45)}px`);
  const ids = Array.from({ length: N }, () => candidates[Math.floor(Math.random() * candidates.length)]);
  ids[WIN] = res.item.person;
  strip.innerHTML = ids.map((id, k) => miniHTML(id, k === WIN)).join('');
  await sleep(50);
  const step = MW + GAP, center = reel.clientWidth / 2, to = -(WIN * step + MW / 2 + rand(-.4, .4) * MW) + center;
  const D2 = fast ? 900 : 3200, t1 = performance.now();
  let lastIdx = -1;
  await new Promise<void>(done => {
    const frame = (now: number) => {
      const t = Math.min(1, (now - t1) / D2), x = to * (1 - Math.pow(1 - t, 4));
      strip.style.transform = `translate3d(${x}px, -50%, 0)`;
      const idx = Math.floor((center - x) / step);
      if (idx !== lastIdx) { if (lastIdx >= 0) Sound.tick(1 - t); lastIdx = idx; }
      if (t < 1) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  });
  reel.classList.add('landed');
  reel.style.setProperty('--rc', NR.color);
  await sleep(fast ? 200 : 500);

  if (rarityIdx(next) >= rarityIdx('gold')) await epicReveal(res.item, { fast });
  else {
    Sound.reveal(next);
    P.burst(innerWidth / 2, innerHeight / 2, 120, colors, { speed: 12 });
    if (isSpecial(res.item.variant)) confetti(['#9ff6ff', '#ff9ff3', '#fff'], 80);
  }
  announceFirsts([res.item]);
  reel.hidden = true;
  const box = el.querySelector('.fa-result') as HTMLElement;
  box.hidden = false;
  box.innerHTML = `
    <div class="fa-result-label">${esc(NR.name)}</div>
    <div class="fa-result-card">${cardHTML(res.item.person, res.item.variant)}</div>
    <div class="fa-result-name">${esc(person(res.item.person).name)}</div>
    <div class="fa-result-meta">${isSpecial(res.item.variant) ? `<span>${esc(variantName(res.item.variant))}</span>` : ''}<b>${fmt(res.item.value)}</b></div>
    <div class="fa-result-btns">
      <button class="ms-btn" data-act="sell">Sprzedaj za ${fmt(res.item.value)}</button>
      ${canAgain() ? '<button class="ms-btn hue" data-act="again">Kolejny kontrakt</button>' : ''}
      <button class="ms-btn" data-act="ok">Odbierz</button>
    </div>`;
  touch();
  box.addEventListener('click', async e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'sell') {
      if (rarityIdx(next) >= rarityIdx('gold') && !confirm(`Na pewno sprzedać ${person(res.item.person).name}?`)) return;
      try { await sellIds([res.item.id]); } catch (err: any) { toast(err.message, true); return; }
    }
    finish(act === 'again');
  });
}
