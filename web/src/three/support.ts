// Jedno miejsce decyduje, czy w ogóle używamy grafiki 3D (Three.js / WebGL).
// Moduły z `three/` wolno importować tylko dynamicznie i tylko po sprawdzeniu `use3D()`,
// inaczej przy wyłączonej grafice 3D przeglądarka i tak pobierałaby bibliotekę.

const KEY = 'no3d';

/** Czy gracz wyłączył grafikę 3D w ustawieniach (domyślnie nie) */
export function user3DOff(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setUser3DOff(off: boolean) {
  try { if (off) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* bez zapisu */ }
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
