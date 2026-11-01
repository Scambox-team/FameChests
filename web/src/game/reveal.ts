import { S } from './store';

export interface Reveal { map?: Record<string, any>; imgq?: string }

// Tajna karta innego gracza (rynek, profil, aktywność): na czas rysowania podmieniamy zamaskowane dane na prawdziwe
export function withReveal<T>(reveal: Reveal | undefined, fn: () => T): T {
  const ids = Object.keys(reveal?.map ?? {});
  if (!ids.length) return fn();
  const orig: Record<string, any> = {};
  ids.forEach(id => { orig[id] = S.cfg.people[id]; S.cfg.people[id] = { ...reveal!.map![id], imgq: reveal!.imgq }; });
  try { return fn(); } finally { ids.forEach(id => { S.cfg.people[id] = orig[id]; }); }
}
