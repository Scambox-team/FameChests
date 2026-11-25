import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Crown, Medal, Trophy, Users } from 'lucide-react';
import { PageHero } from '../../ui/PageHero';
import { api } from '../../api/client';
import { plural } from '../../game/rules';
import { fmt, fmtNum } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { SearchField, Tabs } from '../../ui/Field';
import { UserLink } from '../../ui/UserLink';
import { HallOfFame } from './HallOfFame';
import { TopCards } from './TopCards';
import { ServiceBadge } from '../exp/LevelPage';
import s from './social.module.css';

type By = 'value' | 'cards' | 'opened' | 'level';
const KEY: Record<By, string> = { value: 'value', cards: 'unique', opened: 'opened', level: 'level' };
const MEDALS = ['#e5b94a', '#c2c6cf', '#c98a55'];

// wybór zostaje po powrocie na ekran
let saved: { by: By; scope: 'all' | 'friends' } = { by: 'value', scope: 'all' };

export function RankingPage() {
  const tab = useParams().tab;
  const view = tab === 'hall-of-fame' ? 'hof' : tab === 'cards' ? 'cards' : 'players';
  const navigate = useNavigate();
  return (
    <>
      <Tabs label="Ranking" value={view} onChange={v => { Sound.click(); navigate(v === 'hof' ? '/ranking/hall-of-fame' : v === 'cards' ? '/ranking/cards' : '/ranking'); }}
        items={[{ id: 'players', label: 'Gracze' }, { id: 'cards', label: 'Najdroższe karty' }, { id: 'hof', label: 'Hall of Fame' }]} />
      {view === 'hof' ? <HallOfFame /> : view === 'cards' ? <TopCards /> : <PlayersRanking />}
    </>
  );
}

function PlayersRanking() {
  const [by, setBy] = useState(saved.by);
  const [scope, setScope] = useState(saved.scope);
  const [search, setSearch] = useState('');
  const [others, setOthers] = useState<{ q: string; users: any[] } | null>(null);
  const { data: r, error } = useQuery({ queryKey: ['ranking'], queryFn: () => api('/api/ranking') });
  saved = { by, scope };

  useEffect(() => { document.title = 'Ranking · ScamBox'; }, []);

  const q = search.trim().toLowerCase();
  // gracze spoza listy (poza rankingiem albo nie-znajomi przy „Znajomi”) szukani na serwerze, z opóźnieniem
  useEffect(() => {
    if (!q) return;
    const t = setTimeout(() => { api(`/api/users/search?q=${encodeURIComponent(q)}`).then(res => setOthers({ q, users: res.users })).catch(() => {}); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const ranked = useMemo(() => {
    if (!r) return [];
    const key = KEY[by];
    return r.players.filter((p: any) => scope === 'all' || p.friend || p.me)
      .sort((a: any, b: any) => b[key] - a[key] || a.username.localeCompare(b.username, 'pl'))
      .map((p: any, i: number) => ({ p, i }));   // miejsce liczone przed wyszukiwaniem: znaleziony gracz ma swoje prawdziwe miejsce
  }, [r, by, scope]);

  if (error) return <p className="muted">{error.message}</p>;
  if (!r) return <p className="muted">Ładowanie</p>;
  const list = q ? ranked.filter(({ p }: any) => p.username.toLowerCase().includes(q)) : ranked;
  const shown = new Set(ranked.map(({ p }: any) => p.username));
  const rest = q && others?.q === q ? others.users.filter(u => !shown.has(u.username)) : [];
  const total = Math.max(1, r.totalCards);
  const value = (p: any) => by === 'value' ? fmt(p.value)
    : by === 'cards' ? <>{p.unique} / {r.totalCards} <span className="muted">({Math.round(p.unique / total * 100)}%)</span></>
    : by === 'level' ? `Level ${p.level}`
    : `${fmtNum(p.opened)} ${plural(p.opened, 'skrzynka', 'skrzynki', 'skrzynek')}`;

  return (
    <>
      <PageHero icon={Trophy} title="Najlepsi gracze" lead="Ranking według wartości kolekcji, zebranych kart albo otwartych skrzynek. Wyszukasz tu każdego gracza, także spoza rankingu."
        stats={[['Online', <><i className={s.online} /> {fmtNum(r.online)}</>], [plural(r.accounts, 'Konto', 'Konta', 'Kont') + ' w grze', fmtNum(r.accounts)]]} />
      <div className={s.rankTools}>
        <Tabs label="Ranking według" value={by} onChange={v => { setBy(v); Sound.click(); }} items={[{ id: 'value', label: 'Wartość kolekcji' }, { id: 'cards', label: 'Zebrane karty' }, { id: 'opened', label: 'Otwarte skrzynki' }, { id: 'level', label: 'Poziom' }]} />
        <Tabs label="Zakres" value={scope} onChange={v => { setScope(v); Sound.click(); }} items={[{ id: 'all', label: 'Wszyscy' }, { id: 'friends', label: 'Znajomi' }]} />
        <SearchField value={search} onChange={e => setSearch(e.target.value)} placeholder="Szukaj gracza" aria-label="Szukaj gracza" />
      </div>
      <div className={s.rankList}>
        {list.map(({ p, i }: any) => (
          <div key={p.username} className={`${s.rankRow}${p.me ? ` ${s.rankMe}` : ''}`}>
            <span className={s.rankPos}>{i < 3 ? <Medal size={22} color={MEDALS[i]} aria-label={`${i + 1}. miejsce`} /> : i + 1}</span>
            <UserLink user={p} />
            {by !== 'level' && p.level > 1 && <span className={s.rankLv} title={`Level ${p.level}`}>Lv {p.level}</span>}
            {p.serviceBadge && <ServiceBadge year={p.serviceBadge.year} tier={p.serviceBadge.tier} className={s.rankSvc} />}
            {p.friend && <Users size={15} className={s.rankTag} aria-label="Znajomy" />}
            {p.isAdmin && <Crown size={15} className={s.rankTag} aria-label="Admin" />}
            <span className={s.rankValue}>{value(p)}</span>
            {by === 'cards' && <div className={s.rankBar}><div style={{ width: `${p.unique / total * 100}%` }} /></div>}
          </div>
        ))}
        {rest.length > 0 && <h3 className={s.rankOthers}>Pozostali gracze</h3>}
        {rest.map(u => (
          <div key={u.username} className={`${s.rankRow} ${s.rankOther}`}>
            <span className={s.rankPos}>–</span>
            <UserLink user={u} />
            <span className={`${s.rankValue} muted small`}>{scope === 'friends' ? 'nie jest znajomym' : 'poza rankingiem'}</span>
          </div>
        ))}
        {!list.length && !rest.length && <p className="muted">{q ? `Nie ma gracza „${search.trim()}”.` : 'Brak graczy.'}</p>}
      </div>
    </>
  );
}
