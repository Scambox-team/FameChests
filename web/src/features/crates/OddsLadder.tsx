import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { crateVariants, isExclusive, person, plural, variantEvent, vChance } from '../../game/rules';
import { S } from '../../game/store';
import type { Crate } from '../../game/types';
import { fmt } from '../../lib/format';
import styles from './CratesPage.module.css';

const pct = (x: number) => (x * 100).toLocaleString('pl-PL', { maximumFractionDigits: x < .001 ? 3 : 2, minimumFractionDigits: x < .001 ? 3 : 2 }) + '%';

export const crateRarities = (c: Crate) => {
  const present = new Set(c.people.map(id => person(id).rarity));
  return S.cfg.rarityOrder.filter(r => present.has(r) && c.weights[r] > 0);
};

function VariantRows({ crate }: { crate: Crate }) {
  const list = crateVariants(crate);
  const always = list.filter(v => S.cfg.variants[v].always);
  const weight = (v: string) => (S.cfg.variants[v].weight || 1) * (variantEvent(v, crate.id)?.boost || 1);
  const sum = always.reduce((a, v) => a + weight(v), 0);
  return (
    <ul className={styles.variants}>
      {list.map(v => {
        const V = S.cfg.variants[v], ev = variantEvent(v, crate.id);
        return (
          <li key={v}>
            <span>{V.name}{ev ? ` (do ${new Date(ev.end * 1000).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })})` : ''}</span>
            <span className={styles.vMeta}>{V.always ? `${pct(always.length > 1 ? weight(v) / sum : 1)} kart` : pct(vChance(v, crate))} · ×{String(V.mult).replace('.', ',')}{isExclusive(v) && !ev ? ' · tylko tutaj' : ''}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Jawne szanse: główny element sklepu, który zastępuje dawne reklamowe hasła */
export function OddsLadder({ crate }: { crate: Crate }) {
  const [more, setMore] = useState(false);
  const rs = crateRarities(crate), total = rs.reduce((a, r) => a + crate.weights[r], 0) || 1;
  const top = Math.max(...rs.map(r => crate.weights[r]), 1);
  const hasVariants = crateVariants(crate).length > 0;
  return (
    <div className={styles.ladder}>
      <h3>Co wypada ze skrzynki</h3>
      {rs.map(r => {
        const R = S.cfg.rarities[r], share = crate.weights[r] / total;
        const n = crate.people.filter(id => person(id).rarity === r).length;
        return (
          <div key={r} className={styles.row} title={`${n} ${plural(n, 'karta', 'karty', 'kart')}, wartość ${fmt(R.value)}`}>
            <span className={styles.rName}><i style={{ background: R.color }} />{R.name}</span>
            <span className={styles.rEvery}>{share >= 1 ? 'zawsze' : `co ${Math.round(1 / share)}.`}</span>
            <span className={styles.rPct}>{pct(share)}</span>
            <u className={styles.rBar}><s style={{ width: `${Math.max(crate.weights[r] / top * 100, 1.2)}%`, background: R.color }} /></u>
          </div>
        );
      })}
      {hasVariants && (
        <>
          <button className={styles.more} type="button" aria-expanded={more} onClick={() => setMore(!more)}>
            Warianty w tej skrzynce<ChevronDown size={15} aria-hidden="true" style={{ transform: more ? 'rotate(180deg)' : undefined }} />
          </button>
          {more && <VariantRows crate={crate} />}
        </>
      )}
    </div>
  );
}
