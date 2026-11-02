import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { joinVariant, splitVariant, variantName, vtClass } from '../game/rules';
import { Sound } from '../sound/sound';
import styles from './VariantPicker.module.css';

export interface VariantValue { base: string; layer: string | null }

/** Czy wariant karty pasuje do filtra: sama baza (każda warstwa), sama warstwa (każda baza) albo oba naraz */
export function variantMatches(v: string, f: VariantValue) {
  const s = splitVariant(v);
  return (!f.layer || s.layer === f.layer) && (f.base === 'all' || s.base === f.base);
}

interface Props {
  value: VariantValue;
  onChange: (v: VariantValue) => void;
  variants: string[];                      // warianty do wyboru (np. filterVariants()), połączenia rozkładamy na kafelki
  extra?: [string, string][];              // dodatkowe pozycje bazy, np. „Tylko ulubione”
  allLabel?: string;
}

/** Rozwijany wybór wariantu kafelkami: warstwa (flaga, Halloween...) i wariant zaznaczają się osobno i razem dają połączenie */
export function VariantPicker({ value, onChange, variants, extra = [], allLabel = 'Wszystkie warianty' }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const layers = [...new Set(variants.map(v => splitVariant(v).layer).filter(Boolean))] as string[];
  const bases = [...new Set(variants.map(v => splitVariant(v).base))];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  const ext = extra.find(([id]) => id === value.base);
  const label = ext ? ext[1] : value.base === 'all' && !value.layer ? allLabel
    : value.base === 'all' ? `${variantName(value.layer)} + każdy` : variantName(joinVariant(value.layer, value.base));
  const pick = (v: VariantValue) => { Sound.click(); onChange(v); };
  const chip = (id: string, text: string, on: boolean, click: () => void, v?: string) => (
    <button key={id} type="button" className={`${styles.chip}${on ? ` ${styles.on}` : ''}`} aria-pressed={on} onClick={click}>
      {v && <span className={`vdot ${vtClass(v)}`} />}{text}
    </button>
  );

  return (
    <div className={styles.wrap} ref={box}>
      <button type="button" className={styles.trigger} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        {!ext && value.base !== 'all' && <span className={`vdot ${vtClass(joinVariant(value.layer, value.base))}`} />}
        <span className={styles.label}>{label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.panel} role="dialog" aria-label="Wybór wariantu">
          {layers.length > 0 && <>
            <div className={styles.head}>Warstwa <span>łączy się z wariantem poniżej</span></div>
            <div className={styles.chips}>{layers.map(l => chip(l, variantName(l), value.layer === l, () => pick({ ...value, base: ext ? 'all' : value.base, layer: value.layer === l ? null : l }), l))}</div>
          </>}
          <div className={styles.head}>Wariant</div>
          <div className={styles.chips}>
            {chip('all', 'Każdy', value.base === 'all', () => pick({ ...value, base: 'all' }))}
            {extra.map(([id, text]) => chip(id, text, value.base === id, () => pick({ base: id, layer: null })))}
            {bases.map(b => chip(b, variantName(b), value.base === b, () => pick({ ...value, base: value.base === b ? 'all' : b }), b))}
          </div>
          {(value.base !== 'all' || value.layer) && <button type="button" className={styles.reset} onClick={() => { pick({ base: 'all', layer: null }); setOpen(false); }}>Wyczyść wybór</button>}
        </div>
      )}
    </div>
  );
}
