// Ikony skrzynek z modelu 3D: Three.js wczytuje się dopiero przy pierwszej ikonie, do tego czasu (i bez WebGL) zostaje płaski rysunek
import { useEffect, useState } from 'react';
import type { CrateLook } from '../../three/crateModel';

const key = (l: CrateLook) => `${l.c1}|${l.c2}|${l.hue}|${l.emoji || l.d}`;
const ready = new Map<string, string>();
let failed = false;

/** Gotowa ikona, jeśli już ją narysowano */
export const crateIconSrc = (look: CrateLook) => ready.get(key(look));

export function loadCrateIcon(look: CrateLook): Promise<string | null> {
  const k = key(look);
  if (ready.has(k)) return Promise.resolve(ready.get(k)!);
  if (failed) return Promise.resolve(null);
  return import('../../three/crateIcons').then(m => {
    const url = m.renderCrateIcon(look);
    ready.set(k, url);
    return url;
  }).catch(() => { failed = true; return null; });
}

export function useCrateIcon(look: CrateLook) {
  const k = key(look);
  const [src, setSrc] = useState(() => ready.get(k));
  useEffect(() => {
    if (ready.has(k)) { setSrc(ready.get(k)); return; }
    let alive = true;
    loadCrateIcon(look).then(url => { if (alive && url) setSrc(url); });
    return () => { alive = false; };
  }, [k]);
  return src;
}
