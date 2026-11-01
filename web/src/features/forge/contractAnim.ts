// Animacja kontraktu: karty krążą i zlewają się w kulę energii, potem bęben i odsłonięcie wyniku
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
    <div class="fa-title">Kontrakt</div>
    <div class="fa-orb"></div>
    <div class="fa-ring">${items.map(i => `<div class="fa-card">${cardHTML(i.person, i.variant, i.id)}</div>`).join('')}</div>
    <div class="fa-reel reel" hidden><div class="strip fa-strip"></div><div class="reel-marker"></div></div>
    <div class="fa-result" hidden></div>
    <div class="flash fa-flash"></div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  const finish = (again = false) => { P.stop(); el.remove(); document.body.style.overflow = ''; onDone(again); };
  const P = makeParticles(el.querySelector('.fa-canvas'));
  const cards = [...el.querySelectorAll<HTMLElement>('.fa-card')], orb = el.querySelector('.fa-orb') as HTMLElement;
  const colors = next === 'ultra' ? RAINBOW : next === 'secret' ? SECRET_COLORS : [NR.color, '#ffffff', NR.color];

  const D1 = fast ? 1000 : 2300, t0 = performance.now();
  Sound.charge(D1 / 1000, rarityIdx(next) >= rarityIdx('ultra'));
  await new Promise<void>(done => {
    const R0 = Math.min(innerWidth, innerHeight) * .32;
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / D1), e = t * t * t, cx = innerWidth / 2, cy = innerHeight / 2;
      cards.forEach((c, k) => {
        const ang = (k / cards.length) * 6.283 + e * 6.283 * 3 - 1.57, r = R0 * (1 - e);
        c.style.transform = `translate(-50%, -50%) translate(${Math.cos(ang) * r}px, ${Math.sin(ang) * r}px) rotate(${e * 720}deg) scale(${1 - e * .8})`;
        c.style.opacity = String(1 - Math.max(0, (t - .85) / .15));
        c.style.filter = `brightness(${1 + e * 2}) drop-shadow(0 0 ${10 + e * 30}px ${NR.color})`;
      });
      orb.style.transform = `translate(-50%, -50%) scale(${.2 + e * 1.3})`;
      orb.style.opacity = String(.3 + e * .7);
      if (Math.random() < .6) P.implode(cx, cy, 5, colors, R0 * 1.3);
      if (t < 1) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  });

  const res: any = await resP;
  if (!res.error && res.discovered?.length) await refreshConfig();
  const fl = el.querySelector('.fa-flash') as HTMLElement;
  fl.style.background = `radial-gradient(circle, #fff, ${NR.color}88 40%, transparent 75%)`;
  fl.classList.add('go');
  P.burst(innerWidth / 2, innerHeight / 2, 160, colors, { speed: 14 });
  Sound.whoosh();
  el.querySelector('.fa-ring')!.remove();
  orb.classList.add('pop');
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
    <div class="fa-result-card">${cardHTML(res.item.person, res.item.variant)}</div>
    <div class="fa-result-name">${esc(person(res.item.person).name)}${isSpecial(res.item.variant) ? ` <span class="holo-txt">${variantName(res.item.variant)}</span>` : ''}</div>
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
