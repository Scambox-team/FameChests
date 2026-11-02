import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { withReveal } from '../../game/reveal';
import { isSpecial, person, variantName } from '../../game/rules';
import { refreshBadges } from '../../game/session';
import { S, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { timeAgo } from '../../lib/time';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { Avatar, UserLink } from '../../ui/UserLink';
import { TradeBuilder } from './TradeBuilder';
import { TradesPanel } from './Trades';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { PageHero } from '../../ui/PageHero';
import s from './social.module.css';

const VERBS: Record<string, string> = { drop: 'trafia ze skrzynki', contract: 'wytwarza w kontrakcie', upgrade: 'wygrywa w ulepszaczu', casino: 'wygrywa w ruletce', blackjack: 'wygrywa w blackjacku', joker: 'wygrywa w kasynie kartę specjalną', link: 'dostaje kartę specjalną z linku' };

function feedText(f: any) {
  if (f.kind !== 'show') return VERBS[f.kind] || 'zdobywa';
  if (f.mine) return f.to ? <>pokazujesz kartę: <b>{f.to}</b></> : 'pokazujesz kartę znajomym';
  return f.to ? 'pokazuje ci kartę' : 'chwali się kartą';
}

function FeedItem({ f, seen }: { f: any; seen: number }) {
  const reveal = f.reveal ? { map: { [f.person]: f.reveal }, imgq: `feed=${f.id}` } : undefined;
  const p = f.reveal || person(f.person), R = S.cfg.rarities[person(f.person).rarity];
  return (
    <article className={`${s.feedItem}${!f.mine && f.id > seen ? ` ${s.unread}` : ''}`}>
      <div className={s.feedHead}>
        {f.mine ? <span className={s.me}><Avatar user={S.me!} />Ty</span> : <UserLink user={f.author} />}
        <span className="muted">{feedText(f)}</span><span className={s.time}>{timeAgo(f.created)}</span>
      </div>
      <div className={s.feedBody}>
        <button type="button" className={s.feedCard} aria-label={`Podgląd karty ${p.name}`} onClick={() => withReveal(reveal, () => openViewer(f.person, f.variant))}>
          <Card person={f.person} variant={f.variant} reveal={reveal} tilt={false} />
        </button>
        <div className={s.feedSide}>
          {f.message && <div className={s.quote}>„{f.message}”</div>}
          <b>{p.name}</b>
          <span className="small"><span style={{ color: R.color }}>{R.name}</span>{isSpecial(f.variant) && ` · ${variantName(f.variant)}`}</span>
          <span className={s.value}>{fmt(f.value)}</span>
        </div>
      </div>
    </article>
  );
}

export function FriendsPage() {
  const game = useGame();
  const [name, setName] = useState('');
  const [hints, setHints] = useState<string[]>([]);
  const [trade, setTrade] = useState<string | null>(null);
  const firstSeen = useRef<number | null>(null);
  const { data, error, refetch } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => { const [fr, fd, tr] = await Promise.all([api('/api/friends'), api('/api/feed'), api('/api/trades')]); return { fr, fd, tr }; }
  });

  useEffect(() => { document.title = 'Znajomi · ScamBox'; }, []);
  useEffect(() => { refetch(); }, [game.badges.friends]);   // zaproszenia, oferty i aktywność widoczne bez odświeżania
  useEffect(() => {
    if (!data) return;
    firstSeen.current ??= data.fd.seen;
    if (data.fd.feed.some((f: any) => !f.mine && f.id > data.fd.seen)) api('/api/feed/seen', {}).then(refreshBadges).catch(() => {});
  }, [data]);
  useEffect(() => {
    const q = name.trim();
    if (!q) return setHints([]);
    const t = setTimeout(() => {
      api(`/api/users/search?q=${encodeURIComponent(q)}`).then(r => setHints(r.users.map((u: any) => u.username).filter((u: string) => u !== S.me?.username))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [name]);

  if (error) return <p className="muted">{error.message}</p>;
  if (!data) return <p className="muted">Ładowanie</p>;
  const { fr, fd, tr } = data;

  const act = async (fn: () => Promise<any>, ok?: string) => {
    try { await fn(); if (ok) toast(ok); Sound.click(); } catch (e: any) { Sound.error(); toast(e.message, true); }
    refreshBadges();
    refetch();
  };
  const invite = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    act(async () => {
      const r = await api('/api/friends/request', { username: n });
      toast(r.status === 'friend' ? `Jesteście teraz znajomymi z ${n}` : `Wysłano zaproszenie do ${n}`);
      setName('');
    });
  };
  const remove = (u: string) => { if (confirm(`Usunąć ${u} ze znajomych albo anulować zaproszenie?`)) act(() => api('/api/friends/remove', { username: u })); };
  const row = (u: any, actions: ReactNode) => (
    <div key={u.username} className={s.friend}>
      <UserLink user={u} />
      <span className={s.friendStats}>{fmt(u.value)} · {u.unique} kart</span>
      <span className={s.friendBtns}>{actions}</span>
    </div>
  );

  return (
    <>
    <PageHero icon={Users} title="Znajomi i wymiany" lead="Zapraszaj graczy, wymieniaj się kartami i zobacz, co trafili znajomi."
      stats={[['Znajomi', String(fr.friends.length)], ['Zaproszenia', String(fr.incoming.length)], ['Oferty dla ciebie', String(tr.incoming.length)]]} />
    <div className={s.cols}>
      <div className={s.stack}>
        <section className={s.panel}>
          <h2>Znajomi</h2>
          <form className={s.addFriend} onSubmit={invite} autoComplete="off">
            <input type="text" value={name} maxLength={20} list="userSuggest" placeholder="Nazwa gracza" aria-label="Nazwa gracza" onChange={e => setName(e.target.value)} />
            <datalist id="userSuggest">{hints.map(u => <option key={u} value={u} />)}</datalist>
            <Button kind="hue" type="submit">Zaproś</Button>
          </form>
          {fr.incoming.length > 0 && <div className={s.section}><h3>Zaproszenia ({fr.incoming.length})</h3>
            {fr.incoming.map((u: any) => row(u, <>
              <Button kind="hue" onClick={() => act(() => api('/api/friends/respond', { username: u.username, accept: true }), 'Nowy znajomy')}>Przyjmij</Button>
              <Button onClick={() => act(() => api('/api/friends/respond', { username: u.username, accept: false }))}>Odrzuć</Button>
            </>))}</div>}
          <div className={s.section}><h3>Twoi znajomi ({fr.friends.length})</h3>
            {fr.friends.length ? fr.friends.map((u: any) => row(u, <>
              <Button onClick={() => setTrade(u.username)}>Wymiana</Button>
              <Link className={s.linkBtn} to={`/player/${encodeURIComponent(u.username)}`}>Klaser</Link>
              <Button onClick={() => remove(u.username)}>Usuń</Button>
            </>)) : <p className="muted small">Nie masz jeszcze znajomych. Zaproś kogoś po nazwie albo z rankingu.</p>}
          </div>
          {fr.outgoing.length > 0 && <div className={s.section}><h3>Wysłane</h3>{fr.outgoing.map((u: any) => row(u, <Button onClick={() => remove(u.username)}>Anuluj</Button>))}</div>}
        </section>
        <TradesPanel tr={tr} done={refetch} />
      </div>
      <section className={s.panel}>
        <h2>Aktywność</h2>
        <p className="muted small">Karty, które pokazują ci znajomi, i ich legendarne dropy. Swoją kartę pokażesz przyciskiem w podglądzie karty.</p>
        <div className={s.feed}>
          {fd.feed.length ? fd.feed.map((f: any) => <FeedItem key={f.id} f={f} seen={firstSeen.current ?? fd.seen} />) : <p className="muted">Na razie cisza. Gdy znajomi coś pokażą albo trafią legendę, zobaczysz to tutaj.</p>}
        </div>
      </section>
      {trade && <TradeBuilder username={trade} onClose={() => setTrade(null)} onSent={refetch} />}
    </div>
    </>
  );
}
