import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { useGame } from '../../game/store';
import type { Crate } from '../../game/types';
import { fmt } from '../../lib/format';
import { timeAgo } from '../../lib/time';
import { UserLink } from '../../ui/UserLink';
import styles from './CratesPage.module.css';

const MULT = 10;   // jak TOP_DROP_MULT w server/src/routes/shop.rs

/** Ostatnie najlepsze dropy z tej skrzynki: karty graczy warte co najmniej 10 cen skrzynki (zapisuje je /api/open) */
export function TopDrops({ crate }: { crate: Crate }) {
  const { state } = useGame();
  // klucz z liczbą otwartych skrzynek: po każdym otwarciu lista się odświeża, poza tym co minutę
  const { data, error } = useQuery({
    queryKey: ['topDrops', crate.id, state.opened],
    queryFn: () => api(`/api/crates/${encodeURIComponent(crate.id)}/top-drops`),
    enabled: !crate.test && crate.price > 0,
    refetchInterval: 60_000
  });
  if (crate.test || crate.price <= 0) return null;
  const drops: any[] = data?.drops ?? [];
  const zoom = (e: React.MouseEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (c) openViewer(c.dataset.pid, c.dataset.variant);
  };
  return (
    <section className={styles.sec} aria-labelledby="topDropsHead">
      <div className={styles.secHead}>
        <h2 id="topDropsHead">Ostatnie najlepsze dropy</h2>
        <span className="muted small">Karty warte co najmniej {fmt(MULT * crate.price)}, czyli {MULT} cen skrzynki</span>
      </div>
      {error ? <p className="muted">{error.message}</p>
        : !data ? <p className="muted">Ładowanie</p>
        : !drops.length ? <p className="muted">Z tej skrzynki nikt jeszcze nie wylosował karty za co najmniej {fmt(MULT * crate.price)}. Może ty będziesz pierwszy.</p>
        : (
          <div className={styles.cards} onClick={zoom}>
            {drops.map((d, i) => (
              <figure key={`${d.at}-${i}`} className={styles.drop}>
                <Card person={d.person} variant={d.variant} />
                <figcaption>
                  <UserLink user={d.user} />
                  <span><b>{fmt(d.value)}</b><span className="muted small">{timeAgo(d.at)}</span></span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
    </section>
  );
}
