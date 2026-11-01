// Działania na kartach gracza używane przez wiele ekranów
import { api } from '../api/client';
import { Sound } from '../sound/sound';
import { toast } from '../ui/Toaster';
import { fmt } from '../lib/format';
import { dupKey, isSpecialCard, person, plural, varRank } from './rules';
import { applyState } from './session';
import { S, touch } from './store';

export function removeItems(ids: number[]) {
  const set = new Set(ids);
  S.items.filter(i => set.has(i.id)).forEach(i => S.collected.add(`${i.person}|${i.variant}`));
  S.items = S.items.filter(i => !set.has(i.id));
  touch();
}

export async function setFavorite(ids: number[], fav: boolean) {
  await api('/api/favorite', { ids, fav });
  const set = new Set(ids);
  S.items.forEach(i => { if (set.has(i.id)) i.fav = fav; });
  Sound.click();
  touch();
}

export async function sellIds(ids: number[]) {
  if (!ids.length) return 0;
  // ulubionych i kart specjalnych nie sprzedajemy (serwer też je pomija)
  const keep = new Set(S.items.filter(i => i.fav || isSpecialCard(i.person)).map(i => i.id));
  const sell = ids.filter(id => !keep.has(id));
  if (!sell.length) { toast('Ulubionych i specjalnych kart nie da się sprzedać'); return 0; }
  const res = await api('/api/sell', { ids: sell });
  removeItems(res.sold);
  applyState(res.state);
  Sound.coin(Math.ceil(res.sold.length / 4));
  toast(`Sprzedano ${res.sold.length} ${plural(res.sold.length, 'kartę', 'karty', 'kart')} za ${fmt(res.total)}`);
  return res.total as number;
}

export interface Owned { ids: number[]; byVar: Record<string, number[]>; best: string }

export function ownedMap() {
  const m: Record<string, Owned> = {};
  for (const it of S.items) {
    const e = (m[it.person] ||= { ids: [], byVar: {}, best: 'normal' });
    e.ids.push(it.id);
    (e.byVar[it.variant] ||= []).push(it.id);
    if (varRank(it.variant) > varRank(e.best)) e.best = it.variant;
  }
  for (const e of Object.values(m)) if (!e.byVar[e.best]) e.best = Object.keys(e.byVar)[0];
  return m;
}

// Zostaje jedna karta w najlepszym wariancie albo (perVariant) po jednej w każdym wariancie, także zwykłym.
// Ulubione i specjalne zostają zawsze; czystych kartek z rysunkiem nie sprzedajemy nigdy.
export function dupesOf(o: Owned, perVariant = false) {
  if (isSpecialCard(S.items.find(i => i.id === o.ids[0])?.person)) return [];
  const favs = new Set(S.items.filter(i => i.fav).map(i => i.id));
  const keepOne = (ids: number[]) => ids.find(id => favs.has(id)) ?? ids[0];
  const drawn = o.ids.filter(id => S.drawn.has(id));
  const items = new Map(S.items.map(i => [i.id, i]));
  const free = o.ids.filter(id => !S.drawn.has(id));
  const byKey = new Map<string, number[]>();
  free.forEach(id => { const k = dupKey(items.get(id)); byKey.set(k, [...(byKey.get(k) || []), id]); });
  const best = (o.byVar[o.best] || []).filter(id => !S.drawn.has(id));
  const keep = new Set([...drawn, ...(perVariant ? [...byKey.values()].map(keepOne) : drawn.length ? [] : [keepOne(best.length ? best : free)])]);
  return o.ids.filter(id => !keep.has(id) && !favs.has(id));
}

export const personName = (id: string) => person(id)?.name ?? '';
