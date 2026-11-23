import { useQuery } from '@tanstack/react-query';
import { Gem, Medal } from 'lucide-react';
import { api } from '../../api/client';
import { PickTile } from '../../cards/PickTile';
import { openViewer } from '../../fx/effects';
import { person, variantName } from '../../game/rules';
import { fmt } from '../../lib/format';
import { timeAgo } from '../../lib/time';
import { PageHero } from '../../ui/PageHero';
import { UserLink, type UserRef } from '../../ui/UserLink';
import s from './social.module.css';

interface Top { id: number; person: string; variant: string; value: number; since: number; owner: UserRef }
const MEDALS = ['#e5b94a', '#c2c6cf', '#c98a55'];

/** Ranking „Najdroższe karty”: 10 najdroższych egzemplarzy, które teraz istnieją u graczy (server: ranking_top_cards), i kto je ma */
export function TopCards() {
  const { data, error } = useQuery({ queryKey: ['top-cards'], queryFn: () => api<{ cards: Top[] }>('/api/ranking/top-cards'), staleTime: 30_000 });
  if (error) return <p className="muted">{(error as Error).message}</p>;
  if (!data) return <p className="muted">Ładowanie</p>;
  return (
    <>
      <PageHero icon={Gem} title="Najdroższe karty" lead="Dziesięć najdroższych kart, które teraz leżą w kolekcjach graczy, razem z ich właścicielami. Wartość zależy od rzadkości karty i jej wariantu. Karty wystawione na rynku i gracze spoza rankingu się nie liczą." />
      <div className={s.topCards}>
        {data.cards.map((c, i) => {
          const p = person(c.person);
          return (
            <div key={c.id} className={s.topRow}>
              <span className={s.rankPos}>{i < 3 ? <Medal size={22} color={MEDALS[i]} aria-label={`${i + 1}. miejsce`} /> : i + 1}</span>
              <div className={s.topTile}><PickTile item={{ person: c.person, variant: c.variant, value: c.value }} onClick={() => { if (!p?.masked) openViewer(c.person, c.variant); }} /></div>
              <div className={s.topInfo}>
                <b>{p?.name ?? c.person}</b>
                {c.variant !== 'normal' && <span className="muted small">{variantName(c.variant)}</span>}
                <span className={s.topValue}>{fmt(c.value)}</span>
              </div>
              <div className={s.topOwner}>
                <UserLink user={c.owner} />
                <span className="muted small">Zdobyta: {timeAgo(c.since)}</span>
              </div>
            </div>
          );
        })}
        {!data.cards.length && <p className="muted">Nikt jeszcze nie ma kart.</p>}
      </div>
    </>
  );
}
