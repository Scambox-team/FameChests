// Start gry i odświeżanie w tle: wczytuje gracza, konfigurację i ekwipunek, a potem co 30 s pyta /api/me
import { api, net } from '../api/client';
import { sleep } from '../lib/format';
import { applyCustomVariants } from '../cards/cardHtml';
import { person } from './rules';
import { S, touch } from './store';
import type { Config, StateResponse } from './types';

function applyStateResponse(st: StateResponse) {
  S.state = st.state;
  S.items = st.items;
  S.showcase = st.showcase ?? [];
  S.drawn = new Set(st.drawn ?? []);
  S.scratched = new Set(st.scratched ?? []);
  S.unwrapped = new Set(st.unwrapped ?? []);
  S.chests = st.chests ?? S.chests;
}

export function applyMe(me: any) {
  if (me.user) S.me = me.user;
  S.dailyClaimable = !!me.dailyClaimable;
  S.badges = { market: me.market || 0, casino: me.jackpotInvites || 0, friends: (me.incoming || 0) + (me.unread || 0) + (me.trades || 0) };
  S.jpLobby = me.jackpotLobby;
}

export async function refreshConfig() {
  S.cfg = await api<Config>('/api/config');
  applyCustomVariants();
  touch();
}

export async function boot() {
  for (let attempt = 0; ; attempt++) {
    try {
      const [me, cfg, st] = await Promise.all([api('/api/me'), api<Config>('/api/config'), api<StateResponse>('/api/state')]);
      S.cfg = cfg;
      applyMe(me);
      applyStateResponse(st);
      S.collected = new Set((st.collected ?? []).map(([p, v]) => `${p}|${v}`));
      S.crate = S.binderCrate = cfg.crateOrder[0];
      applyCustomVariants();
      touch();
      return me;
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(1000);
    }
  }
}

/** Akcja zmieniła saldo albo ekwipunek: nowy stan z odpowiedzi serwera */
export function applyState(state: S_State) {
  S.state = state;
  touch();
}
type S_State = typeof S.state;

// Ekwipunek zmieniony przez kogoś innego (wymiana, licytacja, jackpot): /api/me podaje odcisk ekwipunku i saldo
export async function syncInventory(me: any = null, force = false) {
  if (!force) {
    if (!me?.inv) return;
    const sum = S.items.reduce((a, i) => a + i.id, 0);
    if (S.items.length === me.inv[0] && sum === me.inv[1] && S.state.balance === me.balance) return;
  }
  const busy = () => net.inflight > 0 || !!S.opening || !!S.busy;
  if (busy()) return;
  const m = net.mutations;
  let st: StateResponse;
  try { st = await api<StateResponse>('/api/state'); } catch { return; }
  if (m !== net.mutations || busy()) return;
  applyStateResponse(st);
  S.items.forEach(i => S.collected.add(`${i.person}|${i.variant}`));
  if (S.items.some(i => !person(i.person) || person(i.person).masked)) await refreshConfig();   // nowe (tajne) karty
  touch();
}

export function startPolling(onMe: (me: any) => void) {
  // co 30 s, a w lobby jackpota co 5 s: wynik ma się pokazać od razu, gdziekolwiek w grze jest gracz
  let last = Date.now(), running = false;
  const timer = setInterval(async () => {
    if (document.hidden || running || Date.now() - last < (S.jpLobby ? 4500 : 29500)) return;
    last = Date.now();
    running = true;
    try {
      const me = await api('/api/me');
      applyMe(me);
      touch();
      await syncInventory(me);
      onMe(me);
    } catch { /* serwer chwilowo niedostępny */ }
    finally { running = false; }
  }, 5000);
  return () => clearInterval(timer);
}

export const refreshBadges = () => api('/api/me').then(me => { applyMe(me); touch(); }).catch(() => {});
