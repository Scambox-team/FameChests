// Intro leci raz na sesję przeglądarki (karta/okno), a gracz może je wyłączyć w ustawieniach.
const SEEN = 'casinoIntroSeen';
const OFF = 'casinoIntroOff';

export function casinoIntroOff() {
  try { return localStorage.getItem(OFF) === '1'; } catch { return false; }
}
export function setCasinoIntroOff(off: boolean) {
  try { if (off) localStorage.setItem(OFF, '1'); else localStorage.removeItem(OFF); } catch { /* bez pamięci przeglądarki */ }
}
/** Czy pokazać intro przy tym wejściu do kasyna */
export function casinoIntroWanted() {
  if (casinoIntroOff()) return false;
  try { return sessionStorage.getItem(SEEN) !== '1'; } catch { return true; }
}
export function markCasinoIntroSeen() {
  try { sessionStorage.setItem(SEEN, '1'); } catch { /* bez pamięci przeglądarki */ }
}
