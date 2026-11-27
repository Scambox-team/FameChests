import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../game/store';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { use3D } from '../../three/support';
import type { Crate } from '../../game/types';
import { MoneyChestArt } from '../crates/CrateArt';
import { crateLook3d } from '../crates/crateLook';
import { stickerTileHTML, VARIANT_NAME } from './stickers';
import { openStickerViewer } from './stickerViewer';
import s from './StickerCrate.module.css';

// Skrzynka z naklejkami w Sklepie: model 3D taki sam jak skrzynek z kartami (ikona z modelu w kafelku, żywa scena w oknie) i podgląd zawartości:
// wszystkie naklejki, które mogą wypaść, z szansą, a kliknięcie naklejki otwiera jej podgląd.
export interface StickerCrateInfo {
  id: string; name: string; emoji: string; color1: string; color2: string; desc: string; price: number; canBuy: boolean;
  weights: Record<string, number>;
  contents: { sticker: string; name: string; rarity: string; v: number; chance: number }[];
}

/** Wygląd 3D z kolorów i emblematu skrzynki z naklejkami (te same pola co skrzynka z kartami) */
export const stickerCrateLook = (c: Pick<StickerCrateInfo, 'color1' | 'color2' | 'emoji'>) => crateLook3d(c as unknown as Crate);

/** Ikona skrzynki w kafelku (obrazek modelu 3D; bez WebGL płaski rysunek) */
export function StickerCrateIcon({ crate, className }: { crate: StickerCrateInfo; className?: string }) {
  return <MoneyChestArt look={stickerCrateLook(crate)} className={className} />;
}

/** Żywy model 3D skrzynki (Three.js wczytuje się dopiero tu); myszą można go lekko obrócić. Bez WebGL: ikona. */
function Live({ crate }: { crate: StickerCrateInfo }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<{ setCrate: (l: any) => void; pointer: (x: number, y: number, on: boolean) => void } | null>(null);
  const [flat, setFlat] = useState(() => !use3D());
  useEffect(() => {
    if (flat) return;
    let alive = true, destroy = () => {};
    import('../../three/crateScene').then(({ createCrateScene }) => {
      if (!alive || !canvas.current) return;
      try {
        const sc = createCrateScene(canvas.current, { sideShift: 0 });
        sc.setCrate(stickerCrateLook(crate));
        sc.setCount(1);
        scene.current = sc;
        destroy = () => { scene.current = null; sc.destroy(); };
      } catch { setFlat(true); }
    }).catch(() => setFlat(true));
    return () => { alive = false; destroy(); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scene.current?.setCrate(stickerCrateLook(crate)); }, [crate.id, crate.color1, crate.color2, crate.emoji]);
  const move = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    scene.current?.pointer(Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / r.width)), Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / r.height)), true);
  };
  return (
    <div ref={box} className={s.scStage} onPointerMove={move} onPointerLeave={() => scene.current?.pointer(0, 0, false)}>
      {flat ? <StickerCrateIcon crate={crate} className={s.scFlat} /> : <canvas ref={canvas} className={s.scCanvas} aria-label={`Skrzynka: ${crate.name}`} />}
    </div>
  );
}

const pct = (x: number) => (x >= .1 ? `${(x * 100).toFixed(0)}%` : x >= .001 ? `${(x * 100).toFixed(1).replace('.', ',')}%` : '<0,1%');

export function StickerCrateDialog({ crate, euro, onBuy, onClose }: { crate: StickerCrateInfo; euro: number; onBuy?: () => void; onClose: () => void }) {
  const game = useGame();
  const color = (r: string) => game.cfg.rarities[r]?.color ?? '#9aa3ad';
  const total = Object.values(crate.weights).reduce((a, b) => a + b, 0) || 1;
  const variants = Object.entries(crate.weights).filter(([, w]) => w > 0);
  return (
    <Modal title={`Skrzynka: ${crate.name}`} onClose={onClose} wide>
      <div className={s.scTop}>
        <Live crate={crate} />
        <div className={s.scInfo}>
          <p className="muted">{crate.desc || 'Po zakupie skrzynka trafia do ekwipunku, otwierasz ją stamtąd. Z każdej wypada jedna naklejka.'}</p>
          <div className={s.scLine}><span className="muted">Cena</span><b>{crate.price > 0 ? `${crate.price.toLocaleString('pl-PL')} €` : 'brak ceny'}</b></div>
          <div className={s.scLine}><span className="muted">Naklejek w środku</span><b>{crate.contents.length}</b></div>
          <div className={s.scVars} aria-label="Szanse wariantów naklejki">
            <span className="muted small">Wariant naklejki:</span>
            {variants.map(([k, w]) => <span key={k} className={s.scChip}>{VARIANT_NAME[k] ?? k} {pct(w / total)}</span>)}
          </div>
          <div className={s.scBtns}>
            {onBuy && <Button kind="hue" disabled={!crate.canBuy || euro < crate.price} onClick={onBuy}>{euro < crate.price ? 'Za mało euro' : 'Kup'}</Button>}
            <Button onClick={onClose}>Zamknij</Button>
          </div>
        </div>
      </div>
      <h3 className={s.scH}>Co jest w środku</h3>
      <p className="muted small">Szansa dotyczy jednego losowania. Kliknij naklejkę, żeby ją obejrzeć.</p>
      <div className={s.scGrid}>
        {crate.contents.map(c => (
          <button key={c.sticker} type="button" className={s.scCell} style={{ '--rc': color(c.rarity) } as React.CSSProperties} title={`Podgląd: ${c.name}`}
            onClick={() => openStickerViewer({ sticker: c.sticker, variant: 'normal', name: c.name, rarity: c.rarity, v: c.v })}>
            <span className={s.scArt} dangerouslySetInnerHTML={{ __html: stickerTileHTML(c.sticker, 'normal', c.v) }} />
            <b>{c.name}</b>
            <span className={s.scRar}>{game.cfg.rarities[c.rarity]?.name ?? c.rarity}</span>
            <small className="muted">{pct(c.chance)}</small>
          </button>
        ))}
        {!crate.contents.length && <p className="muted">Ta skrzynka jest na razie pusta - admin nie dodał do niej żadnych naklejek.</p>}
      </div>
    </Modal>
  );
}
