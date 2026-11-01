import { useState } from 'react';
import { PickTile } from '../../cards/PickTile';
import { SortSelect } from '../../cards/cardSorts';
import { openViewer } from '../../fx/effects';
import { cardMatches, person, plural, sortCards, variantName } from '../../game/rules';
import { useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Button } from '../../ui/Button';
import { SearchField } from '../../ui/Field';
import { CS, csItems, csStake, duplicates, isVabank, PICK_LIMIT } from './state';

interface PickerProps {
  set: Set<number>;
  zone: string;
  max: number;
  q: string;
  onQ: (q: string) => void;
  onPick: (id: number) => void;
  onDupes: () => void;
  onVabank?: () => void;
  onClear: () => void;
  tip?: string;
  disabled?: boolean;
}

/** Siatka moich kart do postawienia, wspólna dla wszystkich gier */
export function CardPicker({ set, zone, max, q, onQ, onPick, onDupes, onVabank, onClear, tip = 'Dodaj karty, które masz podwójnie. Z każdej zostaje jeden egzemplarz, ulubione zostają.', disabled }: PickerProps) {
  useGame();
  const [, redraw] = useState(0);
  const items = csItems();
  const sorted = sortCards(items.filter(i => cardMatches(i, q)), CS.sorts[zone]);
  const list = [...sorted.filter(i => set.has(i.id)), ...sorted.filter(i => !set.has(i.id))];   // wybrane na początku
  const dupes = duplicates(set, zone).length;
  return (
    <div className="panel cs-pick">
      <div className="cs-pick-head">
        <SearchField value={q} onChange={e => onQ(e.target.value)} placeholder="Szukaj: nazwa, wariant, rzadkość" aria-label="Szukaj kart" />
        <SortSelect value={CS.sorts[zone]} onChange={v => { CS.sorts[zone] = v; redraw(n => n + 1); }} />
        <span className="muted small">{isVabank(set.size, max) ? `VA BANK: ${set.size}` : `${set.size}/${max}`} kart · {fmt(csStake(set))}</span>
        {onVabank && items.length > 0 && <Button disabled={disabled} onClick={onVabank} title={`Postaw wszystkie swoje karty. Limit ${max} kart nie obowiązuje.`}>VA BANK ({items.length})</Button>}
        {dupes > 0 && <Button disabled={disabled} onClick={onDupes} title={tip}>Dodaj duplikaty ({dupes})</Button>}
        {set.size > 0 && <Button disabled={disabled} onClick={onClear}>Wyczyść</Button>}
      </div>
      <div className="pick-grid cs-grid">
        {list.slice(0, PICK_LIMIT).map(i => <PickTile key={i.id} item={i} selected={set.has(i.id)} onClick={disabled ? undefined : () => onPick(i.id)} />)}
        {!list.length && <p className="muted">Nie masz kart do postawienia (ulubionych i specjalnych nie można postawić).</p>}
      </div>
    </div>
  );
}

/** Wygrane karty pod stołem: kliknięcie otwiera podgląd */
export function WonCards({ r, label = true }: { r: any; label?: boolean }) {
  const list = [...(r.special ? [r.special] : []), ...(r.items ?? [])];
  return (
    <>
      {label && <div className="muted small">{r.items.length} {plural(r.items.length, 'karta', 'karty', 'kart')}{r.money ? ` + ${fmt(r.money)}` : ''}. Kliknij kartę, aby ją obejrzeć.</div>}
      {r.special && <div className="rl-special"><b>Karta specjalna:</b> {person(r.special.person).name}, {variantName(r.special.variant)}</div>}
      {list.length > 0 && <div className="pick-grid rl-won">{list.map(i => <PickTile key={i.id} item={i} onClick={() => openViewer(i.person, i.variant, i.id)} />)}</div>}
    </>
  );
}

export function SpecialHint({ chance }: { chance: number }) {
  return chance ? <span className="rl-joker" title="Karta specjalna z kasyna wypada przy wygranej, szansa rośnie z wygraną">Przy wygranej szansa na kartę specjalną: <b>{(chance * 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%</b></span> : null;
}
