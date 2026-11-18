// Mgła: rekord gracza w tej przeglądarce (localStorage `mglaBest`). Bez three.js, więc strona gry może go czytać bez ładowania sceny.
export interface HorrorBest { tapes: number; escape: number | null }
const KEY = 'mglaBest';

export function readBest(): HorrorBest {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v.tapes === 'number') return { tapes: v.tapes, escape: typeof v.escape === 'number' ? v.escape : null };
  } catch { /* bez zapisu */ }
  return { tapes: 0, escape: null };
}

/** Zapisuje wynik gry; zwraca, czy to nowy rekord (więcej kaset albo szybsza ucieczka) */
export function saveBest(tapes: number, escaped: boolean, seconds: number): boolean {
  const b = readBest();
  let rec = false;
  if (tapes > b.tapes) { b.tapes = tapes; rec = true; }
  if (escaped && (b.escape == null || seconds < b.escape)) { b.escape = Math.round(seconds); rec = true; }
  if (rec) try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* prywatne okno */ }
  return rec;
}

export const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
