// Kolor przewodni skrzynki: bierzemy bardziej nasycony z jej dwóch kolorów, więc działa też dla skrzynek z panelu admina
import type { Crate } from '../../game/types';
import { crateIconPath } from '../../icons/crateIcons';
import type { CrateLook } from '../../three/crateModel';

function hsl(hex: string) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return { s, l };
}
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => { const c = v / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
  return .2126 * ch(n >> 16 & 255) + .7152 * ch(n >> 8 & 255) + .0722 * ch(n & 255);
};

export function crateHue(c: Pick<Crate, 'color1' | 'color2'>) {
  const score = (hex: string) => { const { s, l } = hsl(hex); return s * (1 - Math.abs(l - .55) * 1.4); };
  const hue = score(c.color1) >= score(c.color2) ? c.color1 : c.color2;
  const mild = hsl(hue).s < .12 ? '#b8b8c0' : hue;   // czarno-biała skrzynka szachów: szary zamiast czerni
  return { hue: mild, on: luminance(mild) > .2 ? '#000' : '#fff' };
}

const DOLLAR = 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6';

/** Wygląd modelu 3D skrzynki z kartami */
export const crateLook3d = (c: Crate): CrateLook => ({ c1: c.color1, c2: c.color2, hue: crateHue(c).hue, d: crateIconPath(c.emoji) });
/** Wygląd modelu 3D skrzynki z pieniędzmi (codzienna, MEGA) */
export const moneyLook3d = (m: { color1: string; color2: string }): CrateLook => ({ c1: m.color1, c2: m.color2, hue: m.color1, d: DOLLAR });

export function applyHue(c: Crate) {
  const { hue, on } = crateHue(c), root = document.documentElement.style;
  root.setProperty('--hue', hue);
  root.setProperty('--on-hue', on);
}
