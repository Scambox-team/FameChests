import { useMemo, useState } from 'react';
import { Button } from '../../ui/Button';
import { SearchField, Select } from '../../ui/Field';
import { useGame } from '../../game/store';
import { openStickerEditor, stickerTileHTML, VARIANT_NAME, type StkData } from './stickers';
import s from './Stickers.module.css';

/** Zakładka „Naklejki” w ekwipunku: naklejki, które jeszcze nie leżą na kartach (skrzynki z naklejkami są na półce skrzynek) */
export function StickersTab() {
  const g = useGame();
  const stk = g.stk as StkData | null;
  const [q, setQ] = useState('');
  const [rarity, setRarity] = useState('');
  const [variant, setVariant] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (stk?.items ?? []).filter(i => {
      const c = stk!.catalog[i.sticker];
      return (!rarity || c.rarity === rarity) && (!variant || i.variant === variant) && (!t || c.name.toLowerCase().includes(t));
    }).sort((a, b) => g.cfg.rarityOrder.indexOf(stk!.catalog[b.sticker].rarity) - g.cfg.rarityOrder.indexOf(stk!.catalog[a.sticker].rarity) || b.id - a.id);
  }, [stk, q, rarity, variant, g.cfg.rarityOrder]);
  if (!stk) return <p className="muted">Naklejki nie są teraz dostępne.</p>;
  const placed = Object.values(stk.placed).reduce((n, l) => n + l.length, 0);
  const color = (r: string) => g.cfg.rarities[r]?.color ?? '#9aa3ad';
  return (
    <>
      <div className={s.counts}>
        <span>W ekwipunku: <b>{stk.items.length}</b></span>
        <span>Naklejone na karty: <b>{placed}</b></span>
        <span className="muted">Na jednej karcie może być najwyżej {stk.max} naklejek.</span>
      </div>
      <div className={s.line}>
        <SearchField value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj naklejki" aria-label="Szukaj naklejki" />
        <Select value={rarity} onChange={e => setRarity(e.target.value)} aria-label="Rzadkość">
          <option value="">Wszystkie rzadkości</option>
          {g.cfg.rarityOrder.filter((r: string) => r !== 'special').map((r: string) => <option key={r} value={r}>{g.cfg.rarities[r].name}</option>)}
        </Select>
        <Select value={variant} onChange={e => setVariant(e.target.value)} aria-label="Wariant naklejki">
          <option value="">Wszystkie warianty</option>
          {stk.variants.map(v => <option key={v.key} value={v.key}>{v.name}</option>)}
        </Select>
        <Button onClick={() => openStickerEditor()} disabled={!g.items.length}>Naklej na kartę</Button>
      </div>
      <section className={s.list} aria-label="Naklejki">
        {list.map(i => {
          const c = stk.catalog[i.sticker];
          return (
            <div key={i.id} className={s.item} style={{ '--rc': color(c.rarity) } as React.CSSProperties}>
              {i.variant !== 'normal' && <span className={s.varTag}>{VARIANT_NAME[i.variant]}</span>}
              <span className={s.art} dangerouslySetInnerHTML={{ __html: stickerTileHTML(i.sticker, i.variant, c.v) }} />
              <b>{c.name}</b>
              <span className={s.rar}>{g.cfg.rarities[c.rarity]?.name ?? c.rarity}</span>
              <Button onClick={() => openStickerEditor(null, i.id)}>Naklej</Button>
            </div>
          );
        })}
        {!list.length && <p className={s.empty}>{stk.items.length ? 'Brak naklejek pasujących do filtrów.' : 'Nie masz wolnych naklejek. Dostaniesz je ze skrzynek z naklejkami (ekwipunek, półka ze skrzynkami).'}</p>}
      </section>
    </>
  );
}
