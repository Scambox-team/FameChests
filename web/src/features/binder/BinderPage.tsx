import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BookOpen } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { HallOfFame } from '../inventory/HallOfFame';
import { PageHero } from '../../ui/PageHero';

import { Card } from '../../cards/Card';
import { ownedMap } from '../../game/actions';
import { crateOf, isSpecial, person, seenCrateList, varRank } from '../../game/rules';
import type { Reveal } from '../../game/reveal';
import { S, useGame } from '../../game/store';
import { Sound } from '../../sound/sound';
import { Tabs } from '../../ui/Field';
import { OwnedCardDialog } from '../inventory/OwnedCardDialog';
import { openViewer } from '../../fx/effects';
import './binder.css';

export interface BinderOwned { best: string; count: number }

// karty, które gracz kiedyś miał: zostają w klaserze jako przygaszone (count 0)
export function collectedOwned(pairs: string[][]) {
  const out: Record<string, BinderOwned> = {};
  for (const [pid, v] of pairs) {
    if (!S.cfg.people[pid]) continue;
    const o = (out[pid] ||= { best: v, count: 0 });
    if (varRank(v) > varRank(o.best)) o.best = v;
  }
  return out;
}

export function Pocket({ id, crateId, owned, onOpen, reveal }: { id: string | null; crateId: string; owned: Record<string, BinderOwned>; reveal?: Reveal; onOpen: (id: string, o: BinderOwned) => void }) {
  if (!id) return <div className="pocket" />;
  const p = person(id), o = owned[id], crate = crateOf(crateId);
  if (!o) {
    const secret = p.rarity === 'secret';
    return (
      <div className={`pocket${secret ? ' secret-pocket' : ''}`}>
        <div className={`card-back${secret ? ' secret-back' : ''}`}><div><div className="q">{secret ? '★' : '?'}</div><div className="n">{secret ? 'TAJNA' : `#${String(crate.people.indexOf(id) + 1).padStart(3, '0')}`}</div></div></div>
      </div>
    );
  }
  return (
    <button className={`pocket owned${o.count ? '' : ' gone'}${p.rarity === 'secret' ? ' secret-pocket' : ''}`} type="button" onClick={() => onOpen(id, o)} aria-label={p.name} title={o.count ? undefined : 'Ta karta jest w kolekcji, ale już jej nie masz'}>
      <Card person={id} variant={o.best} tilt={false} reveal={reveal} />
      {o.count > 1 && <span className="count">×{o.count}</span>}
    </button>
  );
}

/** Dwie strony klasera i postęp zbierania: używane też na profilu gracza */
export function Binder({ crateId, owned, mine, onOpen, reveal }: { crateId: string; owned: Record<string, BinderOwned>; mine: boolean; reveal?: Reveal; onOpen: (id: string, o: BinderOwned) => void }) {
  const crate = crateOf(crateId);
  const [spread, setSpread] = useState(0);
  const book = useRef<HTMLDivElement>(null);
  const ids = crate.people.filter(id => person(id)?.source !== 'ufo' || owned[id]);   // karta z UFO to niespodzianka
  const pages: string[][] = [];
  for (let i = 0; i < ids.length; i += 9) pages.push(ids.slice(i, i + 9));
  if (!pages.length) pages.push([]);
  const spreads = Math.ceil(pages.length / 2), cur = Math.max(0, Math.min(spread, spreads - 1));
  const have = ids.filter(id => owned[id]).length, special = ids.filter(id => owned[id] && isSpecial(owned[id].best)).length;

  useEffect(() => { setSpread(0); }, [crateId]);

  const flip = (dir: number) => {
    const next = Math.max(0, Math.min(cur + dir, spreads - 1));
    if (next === cur) return;
    setSpread(next);
    Sound.page();
    const b = book.current;
    if (b) { b.classList.remove('flip-next', 'flip-prev'); void b.offsetWidth; b.classList.add(dir > 0 ? 'flip-next' : 'flip-prev'); }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') flip(-1); if (e.key === 'ArrowRight') flip(1); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const page = (list: string[] | undefined, side: string) => {
    const slots: (string | null)[] = [...(list ?? [])];
    while (slots.length < 9) slots.push(null);
    return <div className={`bpage ${side}`}>{slots.map((id, i) => <Pocket key={id ?? i} id={id} crateId={crateId} owned={owned} onOpen={onOpen} reveal={reveal} />)}</div>;
  };
  const a = cur * 2 + 1, b = Math.min(a + 1, pages.length);

  return (
    <>
      <div className="binder-progress">
        <span>{mine ? 'Zebrano' : 'Zebrane'} <b>{have}/{ids.length}</b></span>
        <div className="pbar"><div style={{ width: `${ids.length ? have / ids.length * 100 : 0}%` }} /></div>
        {S.cfg.rarityOrder.map(r => {
          const all = ids.filter(id => person(id).rarity === r);
          return all.length ? <span key={r} className="rar-count" style={{ '--rc': S.cfg.rarities[r].color } as React.CSSProperties}><i />{all.filter(id => owned[id]).length}/{all.length}</span> : null;
        })}
        <span>warianty {special}/{ids.length}</span>
      </div>
      <div className="binder-wrap">
        <button className="page-arrow" type="button" aria-label="Poprzednie strony" disabled={cur === 0} onClick={() => flip(-1)}><ChevronLeft size={26} /></button>
        <div className="binder" ref={book}>
          {page(pages[cur * 2], 'left')}
          {page(pages[cur * 2 + 1], 'right')}
          <div className="binder-rings"><span /><span /><span /><span /></div>
        </div>
        <button className="page-arrow" type="button" aria-label="Następne strony" disabled={cur >= spreads - 1} onClick={() => flip(1)}><ChevronRight size={26} /></button>
      </div>
      <div className="page-indicator">Strony {a}–{b} z {pages.length}</div>
    </>
  );
}

export function BinderPage() {
  const game = useGame();
  const hof = useParams().tab === 'hall-of-fame';
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<string | null>(null);
  const crates = seenCrateList();
  if (!crates.some(c => c.id === game.binderCrate)) S.binderCrate = crates[0]?.id;
  const [crate, setCrate] = useState<string>(S.binderCrate);

  useEffect(() => { document.title = 'Klaser · ScamBox'; }, []);

  const owned = useMemo(() => {
    game.items.forEach(i => S.collected.add(`${i.person}|${i.variant}`));
    const out = collectedOwned([...S.collected].map(k => k.split('|')));
    for (const [pid, o] of Object.entries(ownedMap())) out[pid] = { best: o.best, count: o.ids.length };
    return out;
  }, [game.items]);

  const open = (id: string, o: BinderOwned) => { if (o.count) setDialog(id); else openViewer(id, o.best); };
  const pick = (id: string) => { S.binderCrate = id; setCrate(id); Sound.click(); };

  const all = crates.reduce((a, c) => a + c.people.filter(id => person(id)?.source !== 'ufo').length, 0);
  const have = crates.reduce((a, c) => a + c.people.filter(id => owned[id]).length, 0);
  return (
    <>
      <Tabs label="Klaser" value={hof ? 'hof' : 'binder'} onChange={v => { Sound.click(); navigate(v === 'hof' ? '/binder/hall-of-fame' : '/binder'); }}
        items={[{ id: 'binder', label: 'Klaser' }, { id: 'hof', label: 'Hall of Fame' }]} />
      {hof ? <HallOfFame /> : <>
      <PageHero icon={BookOpen} title="Twoja kolekcja" lead="Każda karta ma swoje miejsce w klaserze. Karty, które kiedyś miałeś, zostają w nim przygaszone."
        stats={[['Zebrane karty', `${have} / ${all}`], ['Kolekcja', `${all ? Math.round(have / all * 100) : 0}%`]]} />
      <Tabs label="Skrzynka" value={crate} onChange={pick} items={crates.map(c => ({ id: c.id, label: c.short }))} />
      {crateOf(crate) && <Binder crateId={crate} owned={owned} mine onOpen={open} />}
      {dialog && <OwnedCardDialog pid={dialog} onClose={() => setDialog(null)} />}
      </>}
    </>
  );
}
