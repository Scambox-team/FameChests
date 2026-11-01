import { Select } from '../ui/Field';

// Sortowanie w listach do wyboru. Duplikaty mają sens tylko dla egzemplarzy gracza.
export const CARD_SORTS: [string, string][] = [
  ['value', 'Najdroższe'], ['valueAsc', 'Najtańsze'], ['rarity', 'Rzadkość'], ['variant', 'Wariant'], ['name', 'Nazwa'],
  ['new', 'Najnowsze'], ['dupes', 'Duplikaty: najwięcej'], ['dupesValue', 'Duplikaty: najdroższe']
];
export const UNIQUE_SORTS = CARD_SORTS.filter(([k]) => k !== 'new' && !k.startsWith('dupes'));

export function SortSelect({ value, onChange, options = CARD_SORTS }: { value: string; onChange: (v: string) => void; options?: [string, string][] }) {
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} aria-label="Sortowanie">
      {options.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
    </Select>
  );
}
