import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Medal } from 'lucide-react';

import { api } from '../../api/client';
import { openViewer } from '../../fx/effects';
import { crateList, crateOf, imgUrl, isSpecial, person, rarityIdx, varRank, variantName, vtClass } from '../../game/rules';
import { S } from '../../game/store';
import { SearchField, Select } from '../../ui/Field';
import { timeAgo } from '../../lib/time';
import styles from './InventoryPage.module.css';

const SOURCES: Record<string, string> = { crate: 'Skrzynka', contract: 'Kontrakt', upgrade: 'Ulepszacz', casino: 'Kasyno', market: 'Rynek', trade: 'Wymiana', reward: 'Nagroda', link: 'Link', pinball: 'Pinball' };

function Thumb({ pid }: { pid: string }) {
  const p = person(pid);
  return (
    <button className={styles.thumb} type="button" disabled={p.masked} onClick={() => openViewer(pid, 'normal')} style={{ '--rc': S.cfg.rarities[p.rarity].color } as React.CSSProperties} aria-label={p.masked ? 'Tajna karta' : `Podgląd: ${p.name}`}>
      <img src={p.masked ? `/img/${pid}` : imgUrl(pid, null, true)} alt="" loading="lazy" />
    </button>
  );
}

export function HallOfFame() {
  const { data, error } = useQuery({ queryKey: ['halloffame'], queryFn: () => api('/api/halloffame'), staleTime: 30_000 });
  const [crate, setCrate] = useState('all');
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [sort, setSort] = useState('number');

  const by = useMemo(() => {
    const m: Record<string, any[]> = {};
    data?.rows.forEach((r: any) => (m[r.p] ||= []).push(r));
    return m;
  }, [data]);

  if (error) return <p className="muted">{(error as Error).message}</p>;
  if (!data) return <p className="muted">Wczytuję Hall of Fame</p>;

  const user = (id: number) => {
    if (!id) return <span className="muted">brak</span>;
    const u = data.users[id];
    return u ? <Link to={`/player/${encodeURIComponent(u.username)}`} reloadDocument>{u.username}</Link> : <span className="muted">usunięty gracz</span>;
  };
  const known = data.rows.filter((r: any) => S.cfg.people[r.p]);
  const recent = [...known].sort((a, b) => b.t - a.t).slice(0, 8);
  const cards = new Set(known.map((r: any) => r.p)).size, total = Object.values(S.cfg.people).filter(p => p.source !== 'ufo').length;
  const sum = (id: string) => (by[id] || []).reduce((a, r) => a + r.n, 0);
  const latest = (id: string) => Math.max(0, ...(by[id] || []).map(r => r.t));
  const sorts: Record<string, (a: string, b: string) => number> = {
    number: () => 0,
    rarity: (a, b) => rarityIdx(person(b).rarity) - rarityIdx(person(a).rarity),
    most: (a, b) => sum(b) - sum(a),
    least: (a, b) => sum(a) - sum(b),
    recent: (a, b) => latest(b) - latest(a)
  };
  const needle = q.trim().toLowerCase();
  const ids = [...new Set(crate === 'all' ? crateList().flatMap(c => c.people) : crateOf(crate).people)].filter(id => {
    const p = person(id), got = !!by[id];
    if (p.source === 'ufo' || (show === 'got' && !got) || (show === 'none' && got)) return false;
    return !needle || (!p.masked && p.name.toLowerCase().includes(needle));
  }).sort(sorts[sort]);

  return (
    <>
      <section className={styles.hofHead}>
        <p className="muted">Kto pierwszy zdobył każdą kartę i każdy jej wariant, kiedy to było i ile takich kart wypadło do dziś. Zdobyte karty: <b>{cards}/{total}</b>, warianty: <b>{known.length}</b>, wszystkich kart w grze: <b>{known.reduce((a: number, r: any) => a + r.n, 0).toLocaleString('pl-PL')}</b>.</p>
        {recent.length > 0 && <>
          <h3>Najnowsze odkrycia</h3>
          <div className={styles.recent}>
            {recent.map(r => {
              const p = person(r.p);
              return (
                <div key={`${r.p}|${r.v}`} className={styles.recentItem}>
                  <Thumb pid={r.p} />
                  <div style={{ minWidth: 0 }}>
                    <b>{p.masked ? '???' : p.name}</b>{isSpecial(r.v) && <span className="muted small"> {variantName(r.v)}</span>}
                    <div className="small"><Medal size={13} aria-hidden="true" style={{ verticalAlign: -2 }} /> {user(r.u)}</div>
                    <div className="muted small">{timeAgo(r.t)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>}
      </section>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <SearchField value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj karty" aria-label="Szukaj karty" />
        <Select value={crate} onChange={e => setCrate(e.target.value)} aria-label="Skrzynka">
          <option value="all">Wszystkie skrzynki</option>
          {crateList().map(c => <option key={c.id} value={c.id}>{c.short}</option>)}
        </Select>
        <Select value={show} onChange={e => setShow(e.target.value)} aria-label="Pokaż">
          <option value="all">Wszystkie karty</option><option value="got">Już zdobyte</option><option value="none">Jeszcze niezdobyte</option>
        </Select>
        <Select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sortowanie">
          <option value="number">Kolejność w skrzynce</option><option value="rarity">Najrzadsze</option><option value="most">Najwięcej zdobytych</option><option value="least">Najmniej zdobytych</option><option value="recent">Najnowsze odkrycia</option>
        </Select>
      </div>
      <section className={styles.hofGrid}>
        {ids.map(id => {
          const p = person(id), R = S.cfg.rarities[p.rarity], c = crateOf(p.crate);
          const vars = [...(by[id] || [])].sort((a, b) => varRank(a.v) - varRank(b.v));
          return (
            <article key={id} className={`${styles.hofCard}${vars.length ? '' : ` ${styles.hofNone}`}`}>
              <Thumb pid={id} />
              <div className={styles.hofInfo}>
                <div><b>{p.masked ? '???' : p.name}</b> <small className="muted">{c.code} {String(p.number).padStart(3, '0')}</small></div>
                <div className="small"><span style={{ color: R.color }}>{R.name}</span>{vars.length > 0 && <span className="muted"> · zdobyto łącznie {sum(id).toLocaleString('pl-PL')}×</span>}</div>
                {vars.map(r => (
                  <div key={r.v} className={styles.hofVar} title={`${SOURCES[r.s] || ''} · ${new Date(r.t * 1000).toLocaleString('pl-PL')}`}>
                    <span><span className={`vdot ${vtClass(r.v)}`} />{variantName(r.v)}</span>
                    <span>{user(r.u)}</span>
                    <span className="muted">{new Date(r.t * 1000).toLocaleDateString('pl-PL')}</span>
                    <span>×{r.n.toLocaleString('pl-PL')}</span>
                  </div>
                ))}
                {!vars.length && <span className="muted small">Jeszcze nikt jej nie zdobył.</span>}
              </div>
            </article>
          );
        })}
        {!ids.length && <p className="muted">Brak kart dla tych filtrów.</p>}
      </section>
    </>
  );
}
