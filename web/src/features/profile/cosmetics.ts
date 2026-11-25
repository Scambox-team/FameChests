import { useEffect, useState } from 'react';

/** Kosmetyk profilu w odpowiedziach serwera (src/cosmetics.rs `Cosmetic::view`): tło miniprofilu `mini`, obramówka `frame`, tło profilu `bg` */
export interface CosmeticView { id: string; kind: 'mini' | 'frame' | 'bg' | 'avatar'; name: string; url: string; animated: boolean }
/** Wygląd gracza widziany przez innych (null = standardowy) */
export interface ProfileStyle { mini: CosmeticView | null; frame: CosmeticView | null; bg: CosmeticView | null; avatar?: CosmeticView | null }

export const NO_STYLE: ProfileStyle = { mini: null, frame: null, bg: null };

/** Ograniczony ruch / tryb wydajności (`installLite` podmienia matchMedia na „tak”): animacje stoją w miejscu */
export const calmMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const stills = new Map<string, Promise<string>>();

/** Pierwsza klatka animowanego obrazka jako zwykły obrazek (adres data:) - dla trybu wydajności i ograniczonego ruchu */
function stillOf(url: string): Promise<string> {
  let p = stills.get(url);
  if (!p) {
    p = new Promise<string>(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d')!.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/webp', 0.9));
        } catch { resolve(url); }
      };
      img.onerror = () => resolve(url);
      img.src = url;
    });
    stills.set(url, p);
  }
  return p;
}

/** Adres obrazka kosmetyku do pokazania: animowany zamienia się na pierwszą klatkę, gdy gracz ogranicza ruch albo ma tryb wydajności */
export function useCosmeticSrc(c: CosmeticView | null | undefined): string | undefined {
  const still = !!c?.animated && calmMotion();
  const [src, setSrc] = useState<string | undefined>(still ? undefined : c?.url);
  useEffect(() => {
    if (!c) return setSrc(undefined);
    if (!still) return setSrc(c.url);
    let live = true;
    stillOf(c.url).then(s => { if (live) setSrc(s); });
    return () => { live = false; };
  }, [c?.url, still]);   // eslint-disable-line react-hooks/exhaustive-deps
  return src;
}

/** Opis „jak zdobyć” źródeł automatycznych (zgodny z `cosmetics::AUTO` na serwerze) */
export const AUTO_LABEL: Record<string, string> = {
  quest_wanted: 'Wygraj quest Wanted', quest_ctf: 'Wygraj quest CTF', service: 'Odznaka „za służbę” (level 100)'
};
