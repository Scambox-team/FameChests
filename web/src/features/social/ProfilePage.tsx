import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Crown, HelpCircle, ImagePlus, Pin, Trophy, UserCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { withReveal } from '../../game/reveal';
import { crateOf, seenCrateList, varRank } from '../../game/rules';
import { refreshBadges } from '../../game/session';
import { S, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Tabs } from '../../ui/Field';
import { toast } from '../../ui/Toaster';
import { Avatar } from '../../ui/UserLink';
import { arChallenge } from '../arena/arena';
import { Binder, collectedOwned, type BinderOwned } from '../binder/BinderPage';
import { PatchNotes } from '../notices/Notices';
import { AvatarPicker, EmailDialog, PasswordDialog } from './Account';
import { TradeBuilder } from './TradeBuilder';
import s from './social.module.css';

function AchTile({ a }: { a: any }) {
  const hidden = a.hidden && !a.earned, bars = !a.earned ? a.progress ?? [] : [];
  return (
    <div className={`${s.ach}${a.earned ? ` ${s.achGot}` : ''}`}>
      {hidden ? <HelpCircle size={26} aria-hidden="true" /> : <Trophy size={26} aria-hidden="true" />}
      <div className={s.achText}>
        <b>{a.name}</b><span className="muted">{a.desc}</span>
        {bars.map((p: any, i: number) => <div key={i} className={s.achBar} title={`${p.cur} / ${p.need}`}><i style={{ width: `${Math.round(p.cur / p.need * 100)}%` }} /><span>{p.cur} / {p.need}</span></div>)}
        {a.rewards?.length > 0 && <em>{a.rewards.join(' · ')}</em>}
        {a.earned && <small>{new Date(a.at * 1000).toLocaleDateString('pl-PL')}</small>}
      </div>
    </div>
  );
}

function Achievements({ username, mine }: { username: string; mine: boolean }) {
  const [tab, setTab] = useState<'normal' | 'hidden'>('normal');
  const { data } = useQuery({ queryKey: ['achievements', username], queryFn: () => api(`/api/users/${encodeURIComponent(username)}/achievements`) });
  if (!data) return null;
  const groups = { normal: data.list.filter((a: any) => !a.hidden), hidden: data.list.filter((a: any) => a.hidden) };
  const count = (l: any[]) => `${l.filter(a => a.earned).length}${mine ? ` / ${l.length}` : ''}`;
  const list = [...groups[tab]].sort((a: any, b: any) => b.earned - a.earned);
  const none = tab === 'hidden' ? (mine ? 'Brak ukrytych osiągnięć.' : 'Ten gracz nie odkrył jeszcze żadnego ukrytego osiągnięcia.') : (mine ? 'Brak osiągnięć w grze.' : 'Ten gracz nie ma jeszcze osiągnięć.');
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <h2>Osiągnięcia</h2>
        <Tabs label="Osiągnięcia" value={tab} onChange={v => { setTab(v); Sound.click(); }} items={[{ id: 'normal', label: <>Zwykłe <small>{count(groups.normal)}</small></> }, { id: 'hidden', label: <>Ukryte <small>{count(groups.hidden)}</small></> }]} />
      </div>
      {list.length ? <div className={s.achGrid}>{list.map((a: any, i: number) => <AchTile key={a.id ?? i} a={a} />)}</div> : <p className="muted">{none}</p>}
    </section>
  );
}

export function ProfilePage() {
  const game = useGame();
  const { name } = useParams();
  const username = name || game.me!.username;
  const [dialog, setDialog] = useState<null | 'avatar' | 'password' | 'email' | 'trade' | { notes: any[] }>(null);
  const [crate, setCrate] = useState<string>(() => seenCrateList()[0]?.id);
  const { data: d, error, refetch } = useQuery({ queryKey: ['user', username], queryFn: () => api(`/api/users/${encodeURIComponent(username)}`) });

  useEffect(() => { document.title = `${username} · ScamBox`; window.scrollTo(0, 0); }, [username]);

  const reveal = useMemo(() => d ? { map: d.reveal, imgq: `owner=${encodeURIComponent(d.user.username)}` } : undefined, [d]);
  const owned = useMemo(() => {
    const out: Record<string, BinderOwned> = collectedOwned(d?.collected || []);   // karty, które gracz kiedyś miał, zostają w klaserze
    for (const c of d?.collection ?? []) {
      const o = out[c.person]?.count ? out[c.person] : (out[c.person] = { best: c.variant, count: 0 });
      o.count += c.count;
      if (varRank(c.variant) > varRank(o.best)) o.best = c.variant;
    }
    return out;
  }, [d]);

  if (error) return <p className="muted">{error.message}</p>;
  if (!d) return <p className="muted">Ładowanie</p>;
  const u = d.user, mine = d.relation === 'me';
  const view = (it: any) => withReveal(reveal, () => openViewer(it.person, it.variant, it.id));
  const act = async (fn: () => Promise<any>, ok?: string) => {
    try { await fn(); if (ok) toast(ok); Sound.click(); } catch (e: any) { Sound.error(); toast(e.message, true); }
    refreshBadges();
    refetch();
  };
  const remove = () => { if (confirm(`Usunąć ${u.username} ze znajomych albo anulować zaproszenie?`)) act(() => api('/api/friends/remove', { username: u.username })); };
  const logout = async () => { try { await api('/api/logout', {}); } catch { /* i tak wracamy do logowania */ } location.href = '/login'; };
  const news = () => api('/api/patchnotes').then(r => setDialog({ notes: r.notes })).catch(e => toast(e.message, true));

  const stats: [string | number, string][] = [
    [fmt(u.value), 'wartość kolekcji'], [`${u.unique}/${Object.keys(S.cfg.people).length}`, 'unikalne karty'], [u.total, 'wszystkie karty'],
    [d.stats.opened, 'otwarte skrzynki'], [d.stats.contracts, 'kontrakty'], [`${d.stats.upgradesWon}/${d.stats.upgradesLost}`, 'ulepszenia W/P']
  ];
  const slots = Array.from({ length: S.cfg.showcaseSize }, (_, i) => d.showcase[i]);

  return (
    <div className={s.stack}>
      <section className={`${s.panel} ${s.head}`}>
        <button type="button" className={s.bigAvatar} disabled={!mine} aria-label={mine ? 'Zmień ikonę' : undefined} onClick={() => setDialog('avatar')}><Avatar user={u} size={96} /></button>
        <div className={s.info}>
          <h2>{u.username} {u.isAdmin && <Crown size={20} aria-label="Admin" />}</h2>
          <div className="muted small">gracz od {new Date(u.created * 1000).toLocaleDateString('pl-PL')}</div>
          <div className={s.stats}>{stats.map(([v, l]) => <span key={l}><b>{v}</b>{l}</span>)}</div>
        </div>
        <div className={s.headBtns}>
          {mine && <>
            <Button onClick={news}>Co nowego</Button>
            <Button onClick={() => setDialog('avatar')}>Zmień ikonę</Button>
            <Button onClick={() => setDialog('password')}>Zmień hasło</Button>
            <Button onClick={() => setDialog('email')}>Email</Button>
            <Button onClick={logout}>Wyloguj</Button>
          </>}
          {d.relation === 'none' && <Button kind="hue" onClick={() => act(() => api('/api/friends/request', { username: u.username }), 'Wysłano zaproszenie')}>Zaproś do znajomych</Button>}
          {d.relation === 'outgoing' && <><span className={s.tag}><Clock size={15} aria-hidden="true" /> Zaproszenie wysłane</span><Button onClick={remove}>Anuluj</Button></>}
          {d.relation === 'incoming' && <Button kind="hue" onClick={() => act(() => api('/api/friends/respond', { username: u.username, accept: true }), 'Nowy znajomy')}>Przyjmij zaproszenie</Button>}
          {d.relation === 'friend' && <><span className={s.tag}><UserCheck size={15} aria-hidden="true" /> Znajomi</span><Button kind="hue" onClick={() => setDialog('trade')}>Zaproponuj wymianę</Button><Button onClick={remove}>Usuń ze znajomych</Button></>}
          {!mine && S.cfg.arena && u.isAdmin && <Button title="Arena jest na razie tylko dla adminów" onClick={() => arChallenge(u.username)}>Wyzwij na pojedynek</Button>}
        </div>
      </section>

      <section className={s.panel}>
        <h2>Gablota</h2>
        {mine && <p className="muted small">Twoje najlepsze karty na pokaz. Dodasz je przyciskiem „Do gabloty” w podglądzie karty.</p>}
        <div className={s.showcase}>
          {slots.map((it: any, i) => it
            ? <button key={i} type="button" className={s.slot} aria-label="Podgląd karty" onClick={() => view(it)}><Card person={it.person} variant={it.variant} uid={it.id} reveal={reveal} tilt={false} /></button>
            : <div key={i} className={s.slotEmpty}>{mine && <Pin size={22} aria-hidden="true" />}</div>)}
        </div>
      </section>

      {d.drawings?.length > 0 && <section className={s.panel}>
        <h2><ImagePlus size={18} aria-hidden="true" /> Czyste kartki{!mine && ` gracza ${u.username}`}</h2>
        <div className={s.showcase}>{d.drawings.map((it: any) => <button key={it.id} type="button" className={s.slot} aria-label="Podgląd karty" onClick={() => view(it)}><Card person={it.person} variant={it.variant} uid={it.id} reveal={reveal} tilt={false} /></button>)}</div>
      </section>}

      <section className={s.panel}>
        <div className={s.panelHead}>
          <h2>Klaser{!mine && ` gracza ${u.username}`}</h2>
          <Tabs label="Skrzynka" value={crate} onChange={v => { setCrate(v); Sound.click(); }} items={seenCrateList().map((c: any) => ({ id: c.id, label: c.short }))} />
        </div>
        {crateOf(crate) && <Binder crateId={crate} owned={owned} mine={mine} reveal={reveal} onOpen={(id, o) => withReveal(reveal, () => openViewer(id, o.best))} />}
      </section>

      <Achievements username={u.username} mine={mine} />

      {dialog === 'avatar' && <AvatarPicker onClose={() => setDialog(null)} onChanged={refetch} />}
      {dialog === 'password' && <PasswordDialog onClose={() => setDialog(null)} />}
      {dialog === 'email' && <EmailDialog onClose={() => setDialog(null)} />}
      {dialog === 'trade' && <TradeBuilder username={u.username} onClose={() => setDialog(null)} onSent={() => {}} />}
      {dialog && typeof dialog === 'object' && <PatchNotes notes={dialog.notes} onClose={() => setDialog(null)} />}
    </div>
  );
}
