// Jackpot: wynik pokazywany gdziekolwiek gracz jest, raz na grę, po animacji losowania
import { api } from '../../api/client';
import { confetti, epicOpen, GOLDS, RAINBOW } from '../../fx/effects';
import { isSpecial, person, variantName, vClass, imgUrl } from '../../game/rules';
import { withReveal } from '../../game/reveal';
import { syncInventory } from '../../game/session';
import { S, touch } from '../../game/store';
import { esc, fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { CS, csPct } from './state';

function pickHTML(c: any) {
  const p = person(c.person);
  const img = p.rarity === 'secret' && p.masked ? `/img/${p.id}` : imgUrl(p.id, c.variant, true);
  return `<div class="pick r-${p.rarity} ${vClass(c.variant)}" style="--rc:${S.cfg.rarities[p.rarity].color}"><img src="${img}" alt="" draggable="false">${isSpecial(c.variant) ? `<span class="ph">${esc(variantName(c.variant).slice(0, 6))}</span>` : ''}<span class="pn">${esc(p.name)}</span><span class="pv">${fmt(c.value)}</span></div>`;
}

function anim(t: any) {
  return new Promise<void>(resolve => {
    const pa = t.valueA / (t.valueA + t.valueB), iWon = t.winner === t.side;
    const winner = t.winner === 'a' ? t.creator : t.joiner;
    const mine = t.side === 'a' ? t.valueA : t.valueB, theirs = t.side === 'a' ? t.valueB : t.valueA;
    const cards = [...t.a, ...t.b];
    const el = document.createElement('div');
    el.className = 'jp-anim';
    el.innerHTML = `<div class="jp-anim-box">
      <h2>Jackpot</h2>
      <div class="jp-anim-players">
        <div class="jp-p jp-pa"><b>${esc(t.creator?.username || '?')}</b><span>${fmt(t.valueA)} · ${csPct(pa)}</span></div>
        <div class="jp-vs">vs</div>
        <div class="jp-p jp-pb"><b>${esc(t.joiner?.username || '?')}</b><span>${fmt(t.valueB)} · ${csPct(1 - pa)}</span></div>
      </div>
      <div class="jp-track"><i class="jp-a" style="width:${pa * 100}%"></i><i class="jp-b" style="width:${(1 - pa) * 100}%"></i><div class="jp-marker"></div></div>
      <div class="jp-anim-res" hidden></div>
      <div class="pick-grid jp-anim-cards" hidden></div>
      <div class="jp-anim-ok"><button class="ms-btn hue" data-jclose hidden>OK</button></div>
    </div>`;
    document.body.appendChild(el);
    Sound.unlock();
    const marker = el.querySelector('.jp-marker') as HTMLElement;
    const fast = !!S.fast, D = fast ? 2200 : 5200, passes = fast ? 3 : 6, t0 = performance.now();
    let lastSide: string | null = null;
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      const p = e * (2 * passes + t.roll), m = p % 2, x = m <= 1 ? m : 2 - m;
      marker.style.left = `${x * 100}%`;
      const side = x < pa ? 'a' : 'b';
      if (side !== lastSide) { if (lastSide) Sound.tick(1 - k); lastSide = side; }
      if (k < 1) { requestAnimationFrame(frame); return; }
      marker.style.left = `${t.roll * 100}%`;
      el.querySelector(`.jp-p${t.winner}`)!.classList.add('won');
      const res = el.querySelector('.jp-anim-res') as HTMLElement;
      res.hidden = false;
      res.innerHTML = iWon
        ? `<b class="pos-txt">Wygrywasz ${fmt(mine + theirs)}</b><div class="muted">Twoje karty wracają, a do tego karty rywala za ${fmt(theirs)}. Wszystko jest w ekwipunku.</div>`
        : `<b class="neg-txt">Wygrywa ${esc(winner?.username || '?')}</b><div class="muted">Twoje karty (${fmt(mine)}) przechodzą do zwycięzcy.</div>`;
      const grid = el.querySelector('.jp-anim-cards') as HTMLElement;
      grid.hidden = false;
      grid.innerHTML = cards.map(c => withReveal(c.reveal ? { map: { [c.person]: c.reveal }, imgq: `jackpot=${t.id}` } : undefined, () => pickHTML(c))).join('');
      (el.querySelector('[data-jclose]') as HTMLElement).hidden = false;
      CS.lost = !iWon;
      if (iWon) { Sound.win(); confetti(GOLDS.concat(RAINBOW), 240); } else Sound.fail();
    };
    requestAnimationFrame(frame);
    el.addEventListener('click', e => {
      if (!(e.target as HTMLElement).closest('[data-jclose]')) return;
      el.remove();
      resolve();
    });
  });
}

export async function showJackpotResult(t: any) {
  const jp = CS.jp;
  if (!t?.side || jp.shown.has(t.id)) return;
  if (S.opening || epicOpen() || document.querySelector('.jp-anim')) return;   // spróbujemy przy następnym odświeżeniu
  jp.shown.add(t.id);
  S.animHold = (S.animHold || 0) + 1;   // osiągnięcia z tej gry dopiero po animacji
  try {
    api(`/api/casino/jackpot/${t.id}/seen`, {}).catch(() => {});
    await syncInventory(null, true);
    await anim(t);
  } finally { S.animHold--; touch(); }
}
