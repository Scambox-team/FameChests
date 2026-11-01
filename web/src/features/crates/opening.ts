// Otwieranie skrzynek. Bębny lecą w requestAnimationFrame po elementach sceny (Stage.tsx), żeby React nie przerysowywał
// dziesiątek kafelków 60 razy na sekundę. W trybie ultraszybkim nie ma bębnów: wieko 3D od razu pokazuje wynik.
import { api } from '../../api/client';
import { cardHTML, cvColors } from '../../cards/cardHtml';
import { confetti, epicOpen, epicReveal, GOLDS, receiptReveal } from '../../fx/effects';
import { VARIANT_COLORS } from '../../fx/variantColors';
import { baseVariant, crateOf, imgUrl, isSpecial, person, plural, rand, rarityIdx, varRank, variantName, variantParts } from '../../game/rules';
import { announceFirsts } from '../../game/actions';
import { applyState, refreshConfig } from '../../game/session';
import { S, touch } from '../../game/store';
import { esc, fmt, sleep } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import type { CrateScene } from '../../three/crateScene';

const STRIP = 54, WIN = 46, EGG_EDGE = 6;
const $ = (s: string) => document.querySelector(s) as HTMLElement;

/** Scena 3D aktualnie widocznego sklepu: wieko otwiera się przed bębnami */
export const crate3d: { scene: CrateScene | null } = { scene: null };

/** Elementy gry, które dojdą razem ze swoimi ekranami (figury szachów, Hall of Fame, osiągnięcia) */
export const openingHooks: Record<string, (...a: any[]) => any> = {};

export interface Drop { id: number; person: string; variant: string; value: number; fav?: boolean; sold?: boolean; first?: boolean }
export interface Opening {
  crate: string; count: number; fast: boolean;
  drops?: Drop[]; skins?: any[]; reels?: any[]; ownedBefore?: Set<string>;
  spinning?: boolean; showingResults?: boolean; shown?: boolean;
}

function weightedPerson(crateId: string) {
  const crate = crateOf(crateId), byR: Record<string, string[]> = {};
  crate.people.forEach(id => (byR[person(id).rarity] ||= []).push(id));
  const rs = Object.keys(byR), total = rs.reduce((a, r) => a + crate.weights[r], 0);
  let x = Math.random() * total;
  for (const r of rs) {
    x -= crate.weights[r];
    if (x <= 0) return byR[r][Math.floor(Math.random() * byR[r].length)];
  }
  return crate.people[0];
}

// Easter egg (obrazek od admina): kafelek przejeżdża, gdy bęben już hamuje, i znika za lewą krawędzią tuż przed zatrzymaniem
function eggSpot(step: number, mw: number, center: number, win: number, off: number): [number, number] {
  for (let k = win - 1; k > 0; k--) {
    const o = (k - win) * step + mw / 2 + center + EGG_EDGE;
    if (Math.abs(o) <= .42 * mw) return [o, k];
    if (o < -.42 * mw) break;
  }
  const to = -(win * step + mw / 2 + off) + center;
  return [off, Math.floor((-to - mw - EGG_EDGE) / step)];
}

export function miniHTML(pid: string, win = false) {
  const p = person(pid);
  if (p.rarity === 'secret') {
    return `<div class="mini r-secret mini-secret${win ? ' win' : ''}" style="--rc:${S.cfg.rarities.secret.color}"><div class="ms-star">★</div><div class="mn">??? TAJNA</div></div>`;
  }
  return `<div class="mini r-${p.rarity}${win ? ' win' : ''}" style="--rc:${S.cfg.rarities[p.rarity].color}"><img src="${imgUrl(p.id, null, true)}" alt="" draggable="false"><div class="mn">${esc(p.name)}</div></div>`;
}

// ---------------------------------------------------------------- autootwieranie

function stopAuto(msg?: string) {
  if (!S.autoRun) return;
  const r = S.autoRun;
  S.autoRun = null;
  S.auto = false;
  touch();
  if (msg) toast(`${msg} (rund: ${r.rounds}, wydano ${fmt(r.spent)})`);
}
export const stopAutoRun = () => stopAuto();

function autoNext(o: Opening) {
  if (!S.autoRun) return;
  const crate = crateOf(o.crate), owned = Math.min(S.chests[o.crate] || 0, o.count), cost = (o.count - owned) * (crate?.price || 0);
  if (!crate || S.state.balance < cost) return stopAuto('Auto zatrzymane, skończyły się pieniądze');
  if (owned < o.count && !crate.canBuy) return stopAuto('Auto zatrzymane, tej skrzynki nie można już kupić');
  setTimeout(() => { if (S.autoRun && S.opening === o && !epicOpen()) openAgain(); }, o.fast ? 800 : 1500);
}

// ---------------------------------------------------------------- przebieg

export async function openCrates() {
  if (S.opening) return;
  const crate = crateOf(S.crate);
  if (!crate) return;
  const cost = (S.count - Math.min(S.chests[crate.id] || 0, S.count)) * crate.price;
  if (S.state.balance < cost) {
    Sound.error();
    const msg = `Brakuje ci ${fmt(cost - S.state.balance)}, żeby otworzyć ${S.count} ${plural(S.count, 'skrzynkę', 'skrzynki', 'skrzynek')}.`;
    if (S.dailyClaimable) { toast(`${msg} Odbierz nagrodę dzienną.`, true); S.openDaily?.(); }
    else toast(`${msg} Sprzedaj kilka kart albo wróć jutro po nagrodę dzienną.`, true);
    return;
  }
  Sound.unlock();
  if (!S.autoRun && S.auto) S.autoRun = { rounds: 0, spent: 0 };
  if (S.autoRun) { S.autoRun.rounds++; S.autoRun.spent += cost; }
  const o: Opening = { crate: S.crate, count: S.count, fast: S.fast };
  S.opening = o;
  touch();
  const ownedBefore = new Set(S.items.map(i => i.person));
  let res: any;
  try {
    Sound.open();
    [res] = await Promise.all([api('/api/open', { crate: S.crate, count: S.count }), lidBeforeResult(o)]);
    if (res.discovered.length) await refreshConfig();
  } catch (e: any) {
    S.opening = null;
    crate3d.scene?.close();
    touch();
    Sound.error();
    toast(e.message, true);
    stopAuto();
    return;
  }
  S.items = [...res.drops.slice().reverse(), ...S.items];
  S.chests = res.chests || S.chests;
  applyState(res.state);
  o.drops = res.drops;
  o.skins = res.skins;
  o.ownedBefore = ownedBefore;
  if (res.skins?.length) await openingHooks.skLoad?.();
  if (o.fast) await revealFast(o);
  else runStage();
}

// przed wynikiem: w zwykłym trybie wieko uchyla się w kolorze skrzynki, a o karcie decydują dopiero bębny
async function lidBeforeResult(o: Opening) {
  const scene = crate3d.scene;
  if (o.fast || !scene) return sleep(o.fast ? 120 : 450);
  await scene.open(getComputedStyle(document.documentElement).getPropertyValue('--hue').trim(), .3);
}

// ultraszybko: bez bębnów, światło od razu ma kolor najlepszej karty
async function revealFast(o: Opening) {
  const best = bestDrop(o.drops!), r = person(best.person).rarity;
  const power: Record<string, number> = { green: .1, uncommon: .15, blue: .25, purple: .45, red: .65, gold: .85 };
  await crate3d.scene?.open(S.cfg.rarities[r].color, power[r] ?? 1);
  showStage(o);
  $('#reels').hidden = true;
  await afterSpin(o);
}

function bestDrop(drops: Drop[]) {
  let best = drops[0];
  for (const d of drops) {
    const a = rarityIdx(person(d.person).rarity), b = rarityIdx(person(best.person).rarity);
    if (a > b || (a === b && varRank(d.variant) > varRank(best.variant))) best = d;
  }
  return best;
}

function showStage(o: Opening) {
  const stage = $('#stage');
  stage.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#stageTitle').textContent = `${crateOf(o.crate).name} × ${o.drops!.length}${S.autoRun ? `, runda ${S.autoRun.rounds}` : ''}`;
  $('#autoStopBtn').hidden = !S.autoRun;
  if (S.autoRun) $('#autoStopBtn').textContent = `Zatrzymaj auto (runda ${S.autoRun.rounds})`;
  $('#reels').hidden = false;
  $('#results').hidden = true;
  $('#results').innerHTML = '';
  $('#skipBtn').hidden = false;
  ['#sellAllBtn', '#againBtn', '#closeBtn'].forEach(s => { $(s).hidden = true; });
  $('#stageSum').textContent = '';
}

function runStage() {
  const o: Opening = S.opening, drops = o.drops!, n = drops.length;
  showStage(o);
  const reels = $('#reels');
  const fitW = window.innerWidth - 40;
  const cols = Math.min(n <= 2 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5, Math.max(1, Math.floor(fitW / 230)));
  const skins = o.skins || [];
  const rows = Math.ceil(n / cols) * (skins.length ? 2 : 1), gap = 12;
  reels.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  reels.style.maxWidth = n <= 2 ? '1100px' : '';
  reels.style.width = '100%';
  reels.style.margin = '0 auto';
  const W = Math.min(reels.clientWidth || window.innerWidth - 40, n <= 2 ? 1100 : 9999);
  const H = reels.clientHeight || window.innerHeight - 160;
  const cellW = (W - gap * (cols - 1)) / cols;
  const rowH = Math.min((H - gap * (rows - 1)) / rows, 280);
  const mw = Math.max(54, Math.min(150, cellW / 5, (rowH - 20) / 1.4));
  const mgap = Math.max(4, Math.round(mw * .06));
  const rh = Math.round(mw * 1.05 + (mw >= 70 ? 22 : 18) + 5 + 18);
  const rare = crateOf(o.crate).people.filter(id => rarityIdx(person(id).rarity) >= rarityIdx('gold'));
  reels.innerHTML = '';
  const now = performance.now();
  const addReel = (tiles: string, rarity: string, i: number, isCard: boolean) => {
    const el = document.createElement('div');
    el.className = 'reel';
    el.style.setProperty('--rh', `${rh}px`);
    el.style.setProperty('--mw', `${mw}px`);
    el.style.setProperty('--gap', `${mgap}px`);
    el.innerHTML = `<div class="strip">${tiles}</div><div class="reel-marker"></div>`;
    reels.appendChild(el);
    const strip = el.firstElementChild as HTMLElement, step = mw + mgap, center = cellW / 2;
    let off = rand(-.42, .42) * mw, egg = 0;
    if (isCard && S.cfg.easterEgg && Math.random() < S.cfg.easterEgg.chance) [off, egg] = eggSpot(step, mw, center, WIN, off);
    const from = rand(0, step * .8), to = -(WIN * step + mw / 2 + off) + center;
    strip.style.transform = `translate3d(${from}px, -50%, 0)`;
    if (egg >= 1 && strip.children[egg]) strip.children[egg].outerHTML = `<div class="mini mini-egg"><img src="${esc(S.cfg.easterEgg.url)}" alt="" draggable="false"></div>`;
    return { el, strip, rarity, isCard, from, to, step, center, dur: rand(5200, 6200), start: now + i * 70, lastIdx: -1, done: false };
  };
  o.reels = drops.map((drop, i) => {
    const ids = Array.from({ length: STRIP }, () => weightedPerson(o.crate));
    ids[WIN] = drop.person;
    if (rare.length && Math.random() < .28) ids[WIN + (Math.random() < .5 ? -1 : 1)] = rare[Math.floor(Math.random() * rare.length)];
    return addReel(ids.map((id, k) => miniHTML(id, k === WIN)).join(''), person(drop.person).rarity, i, true);
  });
  skins.forEach((s, i) => o.reels!.push(addReel(openingHooks.skStripHTML?.(s, o.crate, STRIP, WIN) ?? '', s.rarity, i, false)));
  o.spinning = true;
  const ease = (t: number) => 1 - Math.pow(1 - t, 4.2);
  let lastLand = 0;
  const frame = (ts: number) => {
    if (S.opening !== o) return;
    let all = true;
    for (const r of o.reels!) {
      if (r.done) continue;
      const t = Math.max(0, Math.min(1, (ts - r.start) / r.dur)), x = r.from + (r.to - r.from) * ease(t);
      r.strip.style.transform = `translate3d(${x.toFixed(1)}px, -50%, 0)`;
      const idx = Math.floor((r.center - x) / r.step);
      if (idx !== r.lastIdx) { if (r.lastIdx >= 0 && r.isCard) Sound.tick(1 - t); r.lastIdx = idx; }
      if (t >= 1) {
        r.done = true;
        r.el.classList.add('landed', `r-${r.rarity}`);
        if (rarityIdx(r.rarity) >= rarityIdx('gold')) r.el.classList.add('jackpot');
        r.el.style.setProperty('--rc', S.cfg.rarities[r.rarity].color);
        if (ts - lastLand > 60) { Sound.land(r.rarity === 'secret' ? 'ultra' : r.rarity); lastLand = ts; }
      } else all = false;
    }
    if (all) { o.spinning = false; $('#skipBtn').hidden = true; afterSpin(o); }
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function afterSpin(o: Opening) {
  await sleep(o.fast ? 150 : 700);
  if (S.opening !== o) return;
  const drops = o.drops!;
  if (S.autoRun && drops.some(d => person(d.person).rarity === 'secret')) stopAuto('Tajna karta! Auto zatrzymane');
  const rankOf = (d: Drop) => rarityIdx(person(d.person).rarity);
  const epics = drops.filter(d => rankOf(d) >= rarityIdx('gold')).sort((a, b) => rankOf(b) - rankOf(a) || varRank(b.variant) - varRank(a.variant));
  for (const d of epics) {
    await epicReveal(d, { fast: o.fast, auto: !!S.autoRun });
    if (S.opening !== o) return;
  }
  for (const d of drops.filter(d => variantParts(d.variant).includes('receipt') && !epics.includes(d))) {
    await receiptReveal(d, { fast: o.fast, auto: !!S.autoRun });
    if (S.opening !== o) return;
  }
  showResults(o, epics.length > 0);
}

export function skipSpin() {
  const o: Opening = S.opening;
  if (!o?.spinning) return;
  const now = performance.now();
  o.reels!.forEach(r => { r.start = Math.min(r.start, now - r.dur); });
}

function flash(bg: string) {
  const f = $('#flash');
  f.style.background = bg;
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
}

function showResults(o: Opening, afterEpic: boolean) {
  const drops = o.drops!, n = drops.length;
  o.spinning = false;
  o.showingResults = true;
  announceFirsts(drops);
  $('#reels').hidden = true;
  const results = $('#results');
  results.hidden = false;
  const avail = results.clientWidth || window.innerWidth - 40;
  const cols = Math.min(n <= 5 ? n : n <= 10 ? 5 : n <= 12 ? 6 : 7, Math.max(1, Math.floor(avail / 150)));
  const rcw = Math.min(n === 1 ? 320 : n <= 3 ? 260 : 220, (avail - 18 * (cols - 1) - 12) / cols);
  results.style.setProperty('--cols', String(cols));
  results.style.setProperty('--rcw', `${rcw}px`);
  const seenNew = new Set<string>();
  results.innerHTML = drops.map((d, i) => {
    const p = person(d.person), isNew = !o.ownedBefore!.has(d.person) && !seenNew.has(d.person);
    if (isNew) seenNew.add(d.person);
    const big = rarityIdx(p.rarity) >= rarityIdx('gold');
    return `<div class="result r-${p.rarity}${big ? ' big' : ''}" data-id="${d.id}" style="--rc:${S.cfg.rarities[p.rarity].color}; animation-delay:${i * (o.fast ? 25 : 70)}ms">
      ${isNew ? '<span class="new-badge">NOWA</span>' : ''}
      ${cardHTML(d.person, d.variant, d.id)}
      <div class="rbtns"><button class="fav-btn${d.fav ? ' on' : ''}" data-fav="${d.id}" title="${d.fav ? 'Ulubiona: nie da się jej sprzedać ani zużyć' : 'Dodaj do ulubionych'}">${d.fav ? '★' : '☆'}</button><button class="rsell" data-id="${d.id}" ${d.fav ? 'disabled' : ''}>Sprzedaj za ${fmt(d.value)}</button></div>
    </div>`;
  }).join('') + (o.skins?.length ? `<div class="sk-res-head">Figury</div>${o.skins.map((s, i) => openingHooks.skResultHTML?.(s, i) ?? '').join('')}` : '');

  const best = bestDrop(drops), bestR = person(best.person).rarity;
  if (afterEpic) {
    flash(`radial-gradient(circle, ${S.cfg.rarities[bestR].color}55, transparent 70%)`);
    Sound.reveal('purple');
  } else {
    Sound.reveal(bestR);
    if (bestR === 'red') flash('radial-gradient(circle, #ff404066, transparent 70%)');
  }
  const specials = drops.filter(d => isSpecial(d.variant));
  if (specials.length && !afterEpic) {
    const top = specials.reduce((a, d) => varRank(d.variant) > varRank(a.variant) ? d : a), topBase = baseVariant(top.variant);
    const colors = VARIANT_COLORS[topBase] || cvColors(topBase) || GOLDS;
    if (topBase === 'mlg') setTimeout(() => Sound.airhorn(), 250);
    const rare = varRank(top.variant) >= varRank('gold');
    setTimeout(() => confetti(colors, topBase === 'negative' ? 360 : varRank(top.variant) > varRank('gold') ? 260 : rare ? 140 : 60), 300);
    if (rare) toast(`${variantName(top.variant)}: ${person(top.person).name}`);
  }
  o.shown = true;
  openingHooks.bibiPlay?.();
  openingHooks.achPump?.();
  updateStageBar();
  autoNext(o);
}

export function updateStageBar() {
  const o: Opening = S.opening;
  const unsold = o.drops!.filter(d => !d.sold), sellable = unsold.filter(d => !d.fav);
  $('#stageSum').textContent = unsold.length ? `Wartość: ${fmt(unsold.reduce((a, d) => a + d.value, 0))}` : 'Wszystko sprzedane';
  const sellAll = $('#sellAllBtn');
  sellAll.hidden = !sellable.length;
  sellAll.textContent = `Sprzedaj ${sellable.length < unsold.length ? 'resztę' : 'wszystko'} (${fmt(sellable.reduce((a, d) => a + d.value, 0))})`;
  const again = $('#againBtn');
  again.hidden = false;
  again.textContent = `Otwórz ponownie (${o.count} × ${fmt(crateOf(o.crate).price)})`;
  $('#closeBtn').hidden = false;
  $('#closeBtn').textContent = unsold.length ? 'Zatrzymaj i zamknij' : 'Zamknij';
}

export async function sellDrops(ids: number[]) {
  const o: Opening = S.opening, rare = o.drops!.filter(d => ids.includes(d.id) && rarityIdx(person(d.person).rarity) >= rarityIdx('gold'));
  if (rare.length && !confirm(`Na pewno sprzedać ${rare.length > 1 ? 'legendarne karty' : person(rare[0].person).name}?`)) return;
  try {
    const keep = new Set(S.items.filter(i => i.fav || person(i.person)?.rarity === 'special').map(i => i.id));
    const sell = ids.filter(id => !keep.has(id));
    if (!sell.length) return toast('Ulubionych i specjalnych kart nie da się sprzedać');
    const res = await api('/api/sell', { ids: sell }), sold = new Set<number>(res.sold);
    S.items.filter(i => sold.has(i.id)).forEach(i => S.collected.add(`${i.person}|${i.variant}`));
    S.items = S.items.filter(i => !sold.has(i.id));
    applyState(res.state);
    Sound.coin(Math.ceil(res.sold.length / 4));
    toast(`Sprzedano ${res.sold.length} ${plural(res.sold.length, 'kartę', 'karty', 'kart')} za ${fmt(res.total)}`);
  } catch (e: any) { Sound.error(); toast(e.message, true); return; }
  ids.forEach(id => {
    const d = o.drops!.find(x => x.id === id);
    if (d) d.sold = true;
    document.querySelector(`.result[data-id="${id}"]`)?.classList.add('sold');
  });
  updateStageBar();
}

export async function setDropFavorite(id: number) {
  const o: Opening = S.opening, d = o?.drops?.find(x => x.id === id);
  if (!d) return;
  const fav = !d.fav;
  await api('/api/favorite', { ids: [id], fav });
  d.fav = fav;
  S.items.forEach(i => { if (i.id === id) i.fav = fav; });
  Sound.click();
  const box = document.querySelector(`.result[data-id="${id}"]`);
  const btn = box?.querySelector('.fav-btn'), sell = box?.querySelector('.rsell') as HTMLButtonElement | null;
  if (btn) { btn.classList.toggle('on', fav); btn.textContent = fav ? '★' : '☆'; }
  if (sell) sell.disabled = fav;
  updateStageBar();
}

export function closeStage() {
  stopAuto();
  $('#stage').hidden = true;
  document.body.style.overflow = '';
  $('#reels').innerHTML = '';
  $('#results').innerHTML = '';
  S.opening = null;
  crate3d.scene?.close();
  touch();
}

export async function openAgain() {
  const o: Opening = S.opening;
  S.crate = o.crate;
  S.count = o.count;
  S.opening = null;
  $('#stage').hidden = true;
  document.body.style.overflow = '';
  crate3d.scene?.close();
  await openCrates();
  if (!S.opening) touch();
}
