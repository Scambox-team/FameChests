// Stan kasyna zostaje między zakładkami i po wyjściu z ekranu (trwające rozdanie, historia, wybrane karty)
import { removeItems } from '../../game/actions';
import { dupKey, isSpecialCard, plural, sortCards } from '../../game/rules';
import { S, touch } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';

export const PICK_LIMIT = 240;

export const CS = {
  tab: 'roulette',
  sel: new Set<number>(),
  bet: 'red',
  q: '',
  angle: 0,
  history: [] as number[],
  last: null as any,
  lost: false,               // ostatnia runda przegrana: przy wyjściu z kasyna pytamy, czy na pewno
  sorts: { rl: 'value', jp: 'value', bj: 'value', bjd: 'value', sl: 'value', hr: 'value', upg: 'value' } as Record<string, string>,
  bj: { loaded: false, game: null as any, view: { player: [] as string[], dealer: [] as string[] }, end: null as any, sel: new Set<number>(), dsel: new Set<number>(), q: '', history: [] as any[], anim: null as any },
  jp: { data: null as any, q: '', sig: '', lastLobby: null as number | null, busy: false, newPublic: true, newInvites: '', shown: new Set<number>() },
  sl: { sel: new Set<number>(), q: '', last: null as any, reels: null as string[][] | null, history: [] as any[] },
  upg: { inputs: new Set<number>(), mult: 2, angle: 0, q: '', busy: false }
};

/** Karty, które można postawić: bez ulubionych i specjalnych */
export const csItems = () => S.items.filter(i => !i.fav && !isSpecialCard(i.person));
export const csStake = (set: Set<number>) => S.items.filter(i => set.has(i.id)).reduce((a, i) => a + i.value, 0);
export const csPct = (x: number) => (x * 100).toLocaleString('pl-PL', { maximumFractionDigits: x < .1 ? 1 : 0 }) + '%';

/** Szansa na kartę specjalną z kasyna przy wygranej (jak casino_special_drop na serwerze) */
export function specialChance(payout: number) {
  const C = S.cfg.casinoSpecial;
  return Object.values(S.cfg.people).some(p => isSpecialCard(p) && p.source === 'casino') ? Math.min(C.max, payout / C.per) : 0;
}

// Z każdej karty zostaje jeden egzemplarz: najstarszy, a gdy któryś jest ulubiony, zostają ulubione
export function duplicates(set: Set<number>, zone: string) {
  const keep = new Set<number>(), groups = new Map<string, any[]>();
  for (const i of [...S.items].sort((a, b) => a.id - b.id)) {
    const k = dupKey(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  for (const g of groups.values()) {
    const favs = g.filter(i => i.fav);
    (favs.length ? favs : [g[0]]).forEach(i => keep.add(i.id));
  }
  return sortCards(csItems().filter(i => !keep.has(i.id) && !set.has(i.id)), CS.sorts[zone]);
}

export function addDuplicates(ids: number[], max: number, zone: string) {
  const add = duplicates(new Set(ids), zone);
  if (!add.length) { Sound.error(); toast('Nie masz duplikatów do dodania', true); return null; }
  const room = Math.max(0, max - ids.length);
  if (!room) { Sound.error(); toast(`Najwyżej ${max} kart`, true); return null; }
  const picked = add.slice(0, room).map((i: any) => i.id);
  toast(`Dodano ${picked.length} ${plural(picked.length, 'duplikat', 'duplikaty', 'duplikatów')}${add.length > room ? ` (limit ${max} kart, zostało jeszcze ${add.length - room})` : ''}`);
  return [...ids, ...picked];
}

// VA BANK: stawką są wszystkie karty, które da się postawić. Znosi limit, a serwer sprawdza, że to naprawdę wszystkie.
export const isVabank = (n: number, max: number) => n > max;
export function betOk(ids: number[], stake: number, max: number, text: string) {
  if (isVabank(ids.length, max)) return confirm(`VA BANK. Stawiasz wszystkie swoje karty (${ids.length}, wartość ${fmt(stake)}). Przegrasz i stracisz je wszystkie. Na pewno?`);
  return stake < 5000 || confirm(text);
}

export function togglePick(set: Set<number>, id: number, max: number) {
  if (set.has(id)) set.delete(id);
  else if (set.size >= max) { Sound.error(); toast(`Najwyżej ${max} kart`, true); return; }
  else set.add(id);
  Sound.click();
  touch();
}

export function dropMissing(...sets: Set<number>[]) {
  const own = new Set(S.items.map(i => i.id));
  sets.forEach(set => [...set].forEach(id => { if (!own.has(id)) set.delete(id); }));
}

/** Wygrana lub przegrana rundy, wspólna dla ruletki i automatu */
export function settleRound(res: any, sel: Set<number>) {
  if (res.win) {
    S.items = [...res.items.slice().reverse(), ...S.items];
    res.items.forEach((i: any) => S.collected.add(`${i.person}|${i.variant}`));
  } else {
    removeItems(res.consumed);
    sel.clear();
  }
  if (res.special) { S.items = [res.special, ...S.items]; S.collected.add(`${res.special.person}|${res.special.variant}`); }
  CS.lost = !res.win;
}
