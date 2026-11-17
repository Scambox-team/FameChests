import s from './RewardsEditor.module.css';

// Edytor nagród w formacie osiągnięć / kalendarza adwentowego / paszportu (server/src/events.rs `clean_reward`): jedna karta (dowolny wariant),
// jedna skrzynka (z kartami albo z pieniędzmi) i grosze - można łączyć. Używany przez panel „EXP i levele”.
export type Reward = { type: 'card' | 'chest' | 'money'; person?: string; variant?: string; kind?: string; count?: number; amount?: number };
export interface RewardOptions {
  variants: { key: string; name: string; enabled: boolean }[];
  cards: { id: string; name: string; rarity: string }[];
  chests: { kind: string; name: string }[];
}

/** Krótki opis nagród („10 000 gr, Skrzynka Polska ×2, Adam Małysz (Srebrna)”) */
export function rewardsText(list: Reward[], o: RewardOptions): string {
  if (!list.length) return '-';
  return list.map(r => {
    if (r.type === 'money') return `${(r.amount || 0).toLocaleString('pl-PL')} gr`;
    if (r.type === 'chest') return `${o.chests.find(c => c.kind === r.kind)?.name || r.kind}${(r.count || 1) > 1 ? ` ×${r.count}` : ''}`;
    const v = r.variant && r.variant !== 'normal' ? ` (${o.variants.find(x => x.key === r.variant)?.name || r.variant})` : '';
    return `${o.cards.find(c => c.id === r.person)?.name || r.person}${v}${(r.count || 1) > 1 ? ` ×${r.count}` : ''}`;
  }).join(', ');
}

/** `listId` = id elementu <datalist> z kartami na stronie (jedna lista na całą stronę) */
export function RewardsEditor({ value, onChange, options, listId, label }: { value: Reward[]; onChange: (v: Reward[]) => void; options: RewardOptions; listId: string; label: string }) {
  const card = value.find(r => r.type === 'card'), chest = value.find(r => r.type === 'chest'), money = value.find(r => r.type === 'money');
  const set = (type: Reward['type'], r: Reward | null) => onChange([...value.filter(x => x.type !== type), ...(r ? [r] : [])]);
  const known = card?.person ? options.cards.find(c => c.id === card.person)?.name : undefined;
  return (
    <div className={s.reward} role="group" aria-label={label}>
      <label>Karta (id)<input list={listId} value={card?.person || ''} placeholder="brak" onChange={e => set('card', e.target.value ? { type: 'card', person: e.target.value.trim(), variant: card?.variant || 'normal', count: card?.count || 1 } : null)} />
        {card?.person && <small className={known ? 'muted' : s.bad}>{known || 'nie ma takiej karty'}</small>}</label>
      <label>Wariant<select value={card?.variant || 'normal'} disabled={!card} onChange={e => set('card', { ...card!, variant: e.target.value })}>
        <option value="normal">Zwykła</option>{options.variants.map(v => <option key={v.key} value={v.key}>{v.name}{v.enabled ? '' : ' (wyłączony)'}</option>)}</select></label>
      <label>Ile kart<input type="number" min={1} max={10} value={card?.count || 1} disabled={!card} onChange={e => set('card', { ...card!, count: Math.max(1, +e.target.value || 1) })} /></label>
      <label>Skrzynka<select value={chest?.kind || ''} onChange={e => set('chest', e.target.value ? { type: 'chest', kind: e.target.value, count: chest?.count || 1 } : null)}>
        <option value="">brak</option>{options.chests.map(c => <option key={c.kind} value={c.kind}>{c.name}</option>)}</select></label>
      <label>Ile skrzynek<input type="number" min={1} max={20} value={chest?.count || 1} disabled={!chest} onChange={e => set('chest', { ...chest!, count: Math.max(1, +e.target.value || 1) })} /></label>
      <label>Grosze<input type="number" min={0} step={100} value={money?.amount || ''} placeholder="0" onChange={e => set('money', +e.target.value > 0 ? { type: 'money', amount: +e.target.value } : null)} /></label>
    </div>
  );
}
