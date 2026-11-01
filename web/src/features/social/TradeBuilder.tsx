import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { PickTile } from '../../cards/PickTile';
import { CARD_SORTS, SortSelect } from '../../cards/cardSorts';
import { withReveal } from '../../game/reveal';
import { cardMatches, cardValue, isBlank, sortCards } from '../../game/rules';
import { S, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { SearchField } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import s from './social.module.css';

const SORTS = CARD_SORTS.filter(([k]) => k !== 'new');
const count = (n: number) => <span className="pc">×{n}</span>;

function Builder({ username, prof, onClose, onSent }: { username: string; prof: any; onClose: () => void; onSent: () => void }) {
  useGame();
  const reveal = useMemo(() => ({ map: prof.reveal || {}, imgq: `owner=${encodeURIComponent(username)}` }), [prof, username]);
  const [give, setGive] = useState<number[]>([]);
  const [want, setWant] = useState<Record<string, number>>({});
  const [q, setQ] = useState({ mine: '', theirs: '' });
  const [sort, setSort] = useState({ mine: 'rarity', theirs: 'rarity' });
  const [message, setMessage] = useState('');

  // moje karty grupami: każda czysta kartka osobno, bo ma inny rysunek; najpierw egzemplarze spoza gabloty
  const mine = useMemo(() => {
    const out: Record<string, any> = {}, show = new Set(S.showcase);
    S.items.forEach(i => {
      const key = `${i.person}|${i.variant}${isBlank(i.variant) ? `|${i.id}` : ''}`;
      (out[key] ||= { key, person: i.person, variant: i.variant, value: i.value, ids: [], draw: isBlank(i.variant) ? i.id : 0 }).ids.push(i.id);
    });
    Object.values(out).forEach(g => g.ids.sort((a: number, b: number) => Number(show.has(a)) - Number(show.has(b))));
    return out;
  }, []);
  const theirs = useMemo(() => {
    const out: Record<string, any> = {};
    prof.collection.forEach((c: any) => { const key = `${c.person}|${c.variant}`; out[key] = { key, person: c.person, variant: c.variant, count: c.count, value: cardValue(c.person, c.variant) }; });
    return out;
  }, [prof]);

  const picked: Record<string, number> = {};
  give.forEach(id => { const g = Object.values(mine).find(x => x.ids.includes(id)); picked[g.key] = (picked[g.key] || 0) + 1; });
  const giveValue = give.reduce((a, id) => a + S.items.find(i => i.id === id)!.value, 0);
  const wantValue = Object.entries(want).reduce((a, [k, n]) => a + theirs[k].value * n, 0);

  const addMine = (k: string) => { const id = mine[k].ids.find((x: number) => !give.includes(x)); if (id) { setGive([...give, id]); Sound.click(); } };
  const dropMine = (k: string) => { const i = give.findLastIndex(x => mine[k].ids.includes(x)); if (i >= 0) { setGive(give.filter((_, n) => n !== i)); Sound.click(); } };
  const addTheirs = (k: string) => { setWant({ ...want, [k]: (want[k] || 0) + 1 }); Sound.click(); };
  const dropTheirs = (k: string) => { setWant({ ...want, [k]: Math.max(0, (want[k] || 0) - 1) }); Sound.click(); };

  const mineList = sortCards(Object.values(mine), sort.mine).filter((g: any) => g.ids.length > (picked[g.key] || 0) && cardMatches(g, q.mine));
  const theirList = withReveal(reveal, () => sortCards(Object.values(theirs), sort.theirs).filter((g: any) => g.count > (want[g.key] || 0) && cardMatches(g, q.theirs)));

  const send = async () => {
    try {
      await api('/api/trades', { to: username, give, message, want: Object.entries(want).filter(([, n]) => n > 0).map(([k, n]) => ({ person: theirs[k].person, variant: theirs[k].variant, count: n })) });
      Sound.win();
      toast(`Wysłano ofertę wymiany do ${username}`);
      onSent();
      onClose();
    } catch (e: any) { Sound.error(); toast(e.message, true); }
  };

  return (
    <Modal title={`Wymiana z ${username}`} onClose={onClose} wide>
      <div className={s.builder}>
        <div className={s.column}>
          <div className={s.colHead}><b>Dajesz</b><span className="muted">{fmt(giveValue)}</span></div>
          <div className={s.chosen}>
            {Object.entries(picked).map(([k, n]) => <PickTile key={k} item={mine[k]} extra={n > 1 ? count(n) : undefined} onClick={() => dropMine(k)} />)}
            {!give.length && <span className="muted small">Kliknij swoje karty poniżej</span>}
          </div>
          <div className={s.colTools}>
            <SearchField value={q.mine} onChange={e => setQ({ ...q, mine: e.target.value })} placeholder="Szukaj w swoich kartach" aria-label="Szukaj w swoich kartach" />
            <SortSelect value={sort.mine} options={SORTS} onChange={v => setSort({ ...sort, mine: v })} />
          </div>
          <div className={`pick-grid ${s.pickGrid}`}>
            {mineList.slice(0, 200).map((g: any) => <PickTile key={g.key} item={g} extra={count(g.ids.length - (picked[g.key] || 0))} onClick={() => addMine(g.key)} />)}
            {!mineList.length && <p className="muted">Brak kart</p>}
          </div>
        </div>
        <div className={s.column}>
          <div className={s.colHead}><b>Chcesz od {username}</b><span className="muted">{fmt(wantValue)}</span></div>
          <div className={s.chosen}>
            {Object.entries(want).filter(([, n]) => n > 0).map(([k, n]) => <PickTile key={k} item={theirs[k]} reveal={reveal} extra={n > 1 ? count(n) : undefined} onClick={() => dropTheirs(k)} />)}
            {!Object.values(want).some(Boolean) && <span className="muted small">Kliknij karty znajomego poniżej</span>}
          </div>
          <div className={s.colTools}>
            <SearchField value={q.theirs} onChange={e => setQ({ ...q, theirs: e.target.value })} placeholder="Szukaj w kartach znajomego" aria-label="Szukaj w kartach znajomego" />
            <SortSelect value={sort.theirs} options={SORTS} onChange={v => setSort({ ...sort, theirs: v })} />
          </div>
          <div className={`pick-grid ${s.pickGrid}`}>
            {theirList.slice(0, 200).map((g: any) => <PickTile key={g.key} item={g} reveal={reveal} extra={count(g.count - (want[g.key] || 0))} onClick={() => addTheirs(g.key)} />)}
            {!theirList.length && <p className="muted">Brak kart</p>}
          </div>
        </div>
      </div>
      <div className={s.form}><input type="text" value={message} maxLength={140} placeholder="Wiadomość (opcjonalnie)" aria-label="Wiadomość" onChange={e => setMessage(e.target.value)} /></div>
      <div className={s.btns}><Button kind="hue" onClick={send}>Wyślij ofertę</Button><Button onClick={onClose}>Anuluj</Button></div>
    </Modal>
  );
}

/** Okno budowania oferty wymiany ze znajomym */
export function TradeBuilder({ username, onClose, onSent }: { username: string; onClose: () => void; onSent: () => void }) {
  const { data, error } = useQuery({ queryKey: ['user', username], queryFn: () => api(`/api/users/${encodeURIComponent(username)}`) });
  if (error) { toast(error.message, true); onClose(); return null; }
  if (!data) return null;
  if (data.relation !== 'friend') { toast('Wymieniać się możesz tylko ze znajomymi', true); onClose(); return null; }
  return <Builder username={username} prof={data} onClose={onClose} onSent={onSent} />;
}
