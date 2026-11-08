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
  dailyClaimable: false
};

let version = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Po każdej zmianie w S: przerysowuje komponenty używające useGame() */
export function touch() {
  version++;
  listeners.forEach(fn => fn());
}

export function useGame(): Store {
  useSyncExternalStore(subscribe, () => version);
  return S;
}
