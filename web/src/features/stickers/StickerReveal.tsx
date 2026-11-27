import { closeStickerReveal, openStickerEditor, stickerTileHTML, VARIANT_NAME, type StkDrop } from './stickers';
import { useGame } from '../../game/store';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { openStickerViewer } from './stickerViewer';
import s from './Stickers.module.css';

/** Wynik otwarcia skrzynek z naklejkami (renderowany w App; otwiera go `openStickerCrate`) */
export function StickerRevealHost() {
  const g = useGame();
  const drops = g.stickerReveal as StkDrop[] | null;
  if (!drops?.length) return null;
  const color = (r: string) => g.cfg.rarities[r]?.color ?? '#9aa3ad';
  return (
    <Modal title={drops.length > 1 ? `Wypadło ${drops.length} naklejek` : 'Wypadła naklejka'} onClose={closeStickerReveal} wide>
      <div className={s.revealGrid}>
        {drops.map((d, i) => (
          <div key={d.id} className={s.drop} style={{ '--i': i, '--rc': color(d.rarity) } as React.CSSProperties}>
            {d.variant !== 'normal' && <span className={s.varTag}>{VARIANT_NAME[d.variant]}</span>}
            <button type="button" className={`${s.art} ${s.artBtn}`} aria-label={`Podgląd: ${d.name}`} title="Kliknij, żeby obejrzeć naklejkę" onClick={() => openStickerViewer({ sticker: d.sticker, variant: d.variant, name: d.name, rarity: d.rarity, v: d.v })} dangerouslySetInnerHTML={{ __html: stickerTileHTML(d.sticker, d.variant, d.v) }} />
            <b>{d.name}</b>
            <span className={s.rar}>{g.cfg.rarities[d.rarity]?.name ?? d.rarity}</span>
          </div>
        ))}
      </div>
      <div className={s.line}>
        <Button kind="hue" onClick={() => { closeStickerReveal(); openStickerEditor(); }}>Naklej na kartę</Button>
        <Button onClick={closeStickerReveal}>Zamknij</Button>
      </div>
    </Modal>
  );
}
