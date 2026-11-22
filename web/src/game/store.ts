// Stan gry jednego gracza. Trzymany poza drzewem Reacta, bo korzystają z niego też czyste funkcje (rysowanie kart, zasady).
// Dane stron (rynek, ranking...) idą przez TanStack Query, tu jest tylko to, co gra musi mieć stale pod ręką.
import { useSyncExternalStore } from 'react';
import type { Config, GameState, Item, User } from './types';

export interface Store {
  cfg: Config;
  me: User | null;
  state: GameState;
  items: Item[];
  showcase: number[];
  shareCard?: { pid: string; variant: string } | null;
  reportCard?: { pid: string; variant: string } | null;
  chests: Record<string, number>;
  drawn: Set<number>;
  scratched: Set<number>;
  unwrapped: Set<number>;
  collected: Set<string>;
  badges: { market: number; casino: number; friends: number };
  dailyClaimable: boolean;
  /** odblokowane motywy interfejsu z /api/me (np. "aero") */
  themes: string[];
  [key: string]: any;
}

export const S: Store = {
  cfg: null as unknown as Config,
  me: null,
  state: null as unknown as GameState,
  items: [],
  showcase: [],
  chests: {},
  drawn: new Set(),
  scratched: new Set(),
  unwrapped: new Set(),
  collected: new Set(),
  badges: { market: 0, casino: 0, friends: 0 },
  dailyClaimable: false,
  themes: []
};

let version = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Po każdej zmianie w S: przerysowuje komponenty używające useGame() */
export function touch() {
  // karta wygrana w kasynie bywa dopisana lokalnie, a chwilę później przychodzi pełny ekwipunek z serwera
  // (odpytywanie w trakcie animacji) - bez tego ta sama karta (to samo id) pokazuje się dwa razy
  const items = S.items;
  if (items && items.length > 1) {
    const seen = new Set<number>();
    let dup = false;
    for (const i of items) { if (seen.has(i.id)) { dup = true; break; } seen.add(i.id); }
    if (dup) { seen.clear(); S.items = items.filter(i => !seen.has(i.id) && seen.add(i.id)); }
  }
  version++;
  listeners.forEach(fn => fn());
}

export function useGame(): Store {
  useSyncExternalStore(subscribe, () => version);
  return S;
}
