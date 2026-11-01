import { memo, type ReactNode } from 'react';
import { withReveal, type Reveal } from '../game/reveal';
import { imgUrl, isBlank, isSpecial, person, variantName, vClass, vtClass } from '../game/rules';
import { S } from '../game/store';
import type { Item } from '../game/types';
import { fmt } from '../lib/format';
import { drawingVersions } from './drawingVersions';

interface Props {
  item: Pick<Item, 'person' | 'variant' | 'value'> & { id?: number; draw?: number };
  selected?: boolean;
  onClick?: () => void;
  extra?: ReactNode;
  title?: string;
  reveal?: Reveal;
}

/** Mały kafelek karty do list wyboru (kuźnia, kasyno, rynek, wymiany) */
export const PickTile = memo(function PickTile({ item, selected, onClick, extra, title, reveal }: Props) {
  const v = item.variant || 'normal';
  const [p, img] = withReveal(reveal, () => {
    const x = person(item.person);
    return [x, x && (x.rarity === 'secret' && x.masked ? `/img/${x.id}` : imgUrl(x.id, v, true))];
  });
  if (!p) return null;
  const draw = item.draw ?? item.id;
  return (
    <button type="button" className={`pick r-${p.rarity} ${vClass(v)}${selected ? ' sel' : ''}`} style={{ '--rc': S.cfg.rarities[p.rarity].color } as React.CSSProperties} onClick={onClick} title={title ?? p.name}>
      <img src={img} alt="" loading="lazy" draggable={false} />
      {isSpecial(v) && <span className={`ph ${vtClass(v)}`}>{variantName(v).slice(0, 6)}</span>}
      {isBlank(v) && +(draw ?? 0) > 0 && <img className="dr-tile" src={`/drawing/${draw}/photo?v=${drawingVersions[draw!] || 0}`} alt="" loading="lazy" draggable={false} />}
      <span className="pn">{p.name}</span>
      <span className="pv">{fmt(item.value)}</span>
      {extra}
    </button>
  );
});
