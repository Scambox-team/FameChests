// Tryb wydajności (Ustawienia -> „Tryb wydajności”, localStorage `liteFx` = 1): gra zachowuje się tak, jak przy systemowym
// „ogranicz ruch”, plus bez kurzu w tle i bez rozmyć szkła (backdrop-filter), które najbardziej obciążają kartę graficzną.
//
// Jak to działa:
// - JS: kod gry pyta `matchMedia('(prefers-reduced-motion: reduce)')` w wielu miejscach (sceny 3D, odsłonięcie kart,
//   kasyno, gry). `installLite` podmienia odpowiedź na „tak”, więc wszystkie te miejsca przechodzą na prostsze wersje.
// - CSS: wtyczka `liteMotion` w vite.config.ts kopiuje każdą regułę z `@media (prefers-reduced-motion: reduce)` pod
//   `:root[data-lite]`, a `installLite` ustawia ten atrybut na <html>. Nowe reguły „ogranicz ruch” działają więc same.
// Zmiana wymaga przeładowania strony (sceny i moduły czytają to raz).

const KEY = 'liteFx';
const QUERY = /prefers-reduced-motion\s*:\s*reduce/;

export function liteOn(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setLite(on: boolean) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* prywatne okno */ }
  location.reload();
}

/** Wywoływane raz, przed pierwszym renderem */
export function installLite() {
  if (!liteOn()) return;
  document.documentElement.dataset.lite = '';
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q: string) => {
    const m = real(q);
    if (!QUERY.test(q)) return m;
    // odpowiedź „tak, ogranicz ruch”; reszta (nasłuchiwanie zmian) jak w prawdziwym obiekcie
    return new Proxy(m, { get: (t, k) => (k === 'matches' ? true : (Reflect.get(t, k, t) as unknown)) }) as MediaQueryList;
  };
}
