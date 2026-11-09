// Jedno miejsce decyduje, czy w ogóle używamy grafiki 3D (Three.js / WebGL).
// Moduły z `three/` wolno importować tylko dynamicznie i tylko po sprawdzeniu `use3D()`,
// inaczej przy wyłączonej grafice 3D przeglądarka i tak pobierałaby bibliotekę.

import { defaultsTo2D, getTheme } from '../styles/theme';

const KEY = 'no3d';

/** Motywy Warm Editorial i Frutiger Aero mają własne, stylizowane ilustracje 2D, więc grafika 3D jest w nich domyślnie
 *  wyłączona. Gracz może ją włączyć w ustawieniach: wybór „włączona” zapamiętujemy tylko dla tych motywów (`no3d` = 0). */
export const deepDefault2D = () => defaultsTo2D(getTheme());

/** Wybór gracza (1 = wyłączona, 0 = włączona) jest zapisany OSOBNO dla dwóch rodzin motywów: zwykłych (domyślny, Y2K: klucz `no3d`,
 *  domyślnie 3D) i głębokich (Warm, Aero: klucz `no3d_deep`, domyślnie 2D). Dzięki temu decyzja podjęta w jednej rodzinie nie
 *  zostaje po przejściu do drugiej (wcześniej jeden wspólny klucz zostawiał 2D tam, gdzie miało być 3D, i odwrotnie). */
const keyFor = () => deepDefault2D() ? KEY + '_deep' : KEY;

/** Czy grafika 3D jest wyłączona: wybór gracza w tej rodzinie motywów, a bez wyboru domyślne ustawienie rodziny */
export function user3DOff(): boolean {
  try {
    const v = localStorage.getItem(keyFor());
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* bez zapisu */ }
  return deepDefault2D();
}

/** Zapamiętuje wybór gracza dla bieżącej rodziny motywów (wybór równy jej domyślnemu ustawieniu kasuje zapis) */
export function setUser3DOff(off: boolean) {
  try {
    if (off === deepDefault2D()) localStorage.removeItem(keyFor());
    else localStorage.setItem(keyFor(), off ? '1' : '0');
  } catch { /* bez zapisu */ }
}

let webgl: boolean | undefined;
/** Czy przeglądarka daje WebGL (sprawdzane raz, na próbnym płótnie) */
export function hasWebGL(): boolean {
  if (webgl !== undefined) return webgl;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    webgl = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webgl = false; }
  return webgl;
}

/** Grafika 3D jest dostępna i gracz jej nie wyłączył */
export function use3D(): boolean {
  return !user3DOff() && hasWebGL();
}
export const can3D = use3D;
