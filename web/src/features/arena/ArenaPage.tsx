// Arena: lobby (talia, trening z komputerem, wyzwania) i plansza meczu. Zasady, czas, bota i nagrody liczy serwer -
// tu tylko wysyłamy ruchy i pokazujemy stan (`/api/arena/battle/<id>`).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3, Bot, Coins, Crosshair, Flag, Flame, Heart, Hourglass, Info, ScrollText, Shield, Shuffle, SkipForward, Skull, Sparkles, Swords, Undo2, X
} from 'lucide-react';
import { api } from '../../api/client';
import { cardHTML } from '../../cards/cardHtml';
import { cardMatches, person, varRank } from '../../game/rules';
import { S, touch, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { abilityText, KIND_NAMES, rangeText, type Ability } from './abilities';
import {
  acceptChallenge, arNav, declineChallenge, deckReady, deckSize, inbox as firstInbox, onInbox, refreshInbox, returnButton, savedDeck, saveDeck,
  type Inbox, type RewardView
} from './arena';
import './arena.css';

// ================================================================ typy odpowiedzi serwera

interface UnitView {
  uid: number; pid: string; variant: string; hp: number; maxHp: number; row: number; slot: number; atk: number; points: number;
  acted: boolean; range: [number, number]; class: string; spec: string; abilities: Ability[]; shield: number; poison: number;
  regen: number; reviveIn: number | null; targets?: { side: 'me' | 'foe'; uids: number[] }[];
}
interface SideView {
  name: string; money: number; points: number; moves: number; board: UnitView[]; hand: UnitView[] | number;
  ko: { uid: number; pid: string; variant: string; reviveIn: number | null }[];
  combos: { id: string; name: string; members: number[]; effects: { kind: string; amount: number; all: boolean }[] }[];
  income: { value: number; turns: number }[];
}
interface Fx { kind: string; uid?: number; amount?: number; points?: number; side?: 'me' | 'foe' }
interface LogEntry { n: number; side: 'me' | 'foe' | null; text: string; fx: Fx[] }
interface BattleView {
  id: string; mode: 'bot' | 'pvp'; seen: number; log: LogEntry[]; active: 'me' | 'foe'; gameLeft: number; turnLeft: number; overtimes: number;
  over: 'me' | 'foe' | 'draw' | null; reason: 'time' | 'surrender' | 'away' | null;
  rules: { rows: number; rowSlots: number; moves: number; turnSecs: number; gameSecs: number; overtimeSecs: number; maxOvertimes: number; maxMoney: number };
  sides: { me: SideView; foe: SideView }; heroes: Record<'me' | 'foe', { username: string; bot?: boolean }>;
  rewards: RewardView | null; reveal?: Record<string, any>; balance?: number;
}

// ================================================================ pomocnicze

const arenaCfg = () => S.cfg.arena;
export function pointsOf(pid: string) {
  const a = arenaCfg(), p = person(pid);
  return a?.pointsOverride?.[pid] ?? a?.rules?.points?.[p?.rarity] ?? 1;
}
const specName = (id: string) => arenaCfg()?.specs?.find((s: any) => s.id === id)?.name ?? '';
const className = (id: string) => arenaCfg()?.classes?.find((s: any) => s.id === id)?.name ?? '';
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** Twarz karty (HTML z cardHTML liczony raz dla danej karty i wariantu) */
const Face = memo(function Face({ pid, variant }: { pid: string; variant: string }) {
  return <div className="ar-face" dangerouslySetInnerHTML={{ __html: cardHTML(pid, variant) }} />;
});

// tajne karty rywala, których gracz jeszcze nie odkrył - w meczu widać ich prawdziwe dane (do wyjścia z meczu)
const revealed = new Map<string, any>();
function applyReveal(map: Record<string, any> | undefined, bid: string) {
  for (const [pid, p] of Object.entries(map || {})) {
    if (!revealed.has(pid)) revealed.set(pid, S.cfg.people[pid]);
    S.cfg.people[pid] = { ...p, imgq: `battle=${bid}` };
  }
}
function restoreReveal() {
  for (const [pid, p] of revealed) S.cfg.people[pid] = p;
  revealed.clear();
}

// ================================================================ strona

export function ArenaPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const battleId = params.get('battle');
  useEffect(() => {
    document.title = 'Arena · ScamBox';
    arNav.go = navigate;
    returnButton();
    return () => { setTimeout(returnButton); };
  }, [navigate]);
  const open = useCallback((id: string | null) => setParams(id ? { battle: id } : {}), [setParams]);
  if (!S.cfg.arena) return <p className="ar-empty">Arena jest niedostępna.</p>;
  return battleId ? <Match key={battleId} id={battleId} onLeave={() => open(null)} onOpen={open} /> : <Lobby onOpen={open} />;
}

// ================================================================ lobby

function useInbox() {
  const [box, setBox] = useState<Inbox | null>(firstInbox);
  useEffect(() => { refreshInbox(); return onInbox(setBox); }, []);
  return box;
}

function Lobby({ onOpen }: { onOpen: (id: string) => void }) {
  const game = useGame();
  const [params] = useSearchParams();
  const challenge = params.get('challenge'), accept = params.get('accept');
  const box = useInbox();
  const size = deckSize();
  const [deck, setDeck] = useState<string[]>(() => savedDeck().slice(0, size));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const rules = game.cfg.arena.rules;

  // moje osoby: każda raz, w najlepszym posiadanym wariancie
  const pool = useMemo(() => {
    const best = new Map<string, string>();
    for (const it of game.items) {
      if (!game.cfg.people[it.person]) continue;
      const cur = best.get(it.person);
      if (!cur || varRank(it.variant) > varRank(cur)) best.set(it.person, it.variant);
    }
    return [...best].map(([pid, variant]) => ({ person: pid, variant, points: pointsOf(pid) }))
      .sort((a, b) => b.points - a.points || person(a.person).name.localeCompare(person(b.person).name, 'pl'));
  }, [game.items, game.cfg.people]);
  const variantOf = (pid: string) => pool.find(x => x.person === pid)?.variant ?? 'normal';
  const shown = pool.filter(x => cardMatches(x, q)).slice(0, 240);

  const toggle = (pid: string) => {
    setDeck(d => {
      const next = d.includes(pid) ? d.filter(x => x !== pid) : d.length >= size ? d : [...d, pid];
      if (next === d && !d.includes(pid)) toast(`Talia ma ${size} kart`, true);
      saveDeck(next);
      return next;
    });
    Sound.click();
  };
  const random = () => {
    const pick = [...pool].sort(() => Math.random() - .5).slice(0, size).map(x => x.person);
    setDeck(pick);
    saveDeck(pick);
  };
  const ready = deckReady(deck);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { toast((e as Error).message, true); Sound.error(); } finally { setBusy(false); }
  };
  const startBot = () => run(async () => { const r = await api<BattleView>('/api/arena/start', { deck }); onOpen(r.id); });
  const sendChallenge = () => run(async () => {
    await api('/api/arena/challenge', { username: challenge, deck });
    toast(`Wysłano wyzwanie do: ${challenge}`);
    refreshInbox();
  });
  const r = box?.rewards;
  const totalPts = deck.reduce((a, p) => a + pointsOf(p), 0);

  return (
    <div className="ar-page ar-tavern">
      <header className="ar-hall">
        <div className="ar-hall-crest"><Swords size={44} strokeWidth={1.6} aria-hidden="true" /></div>
        <div>
          <h2>Arena</h2>
          <p>Wystaw karty w trzech liniach, pokonuj karty rywala i zbieraj punkty. Po upływie czasu wygrywa ten, kto ma ich więcej.</p>
        </div>
        <div className="ar-hall-stats">
          <div><b>{clock(rules.gameSecs)}</b><small>Czas meczu</small></div>
          <div><b>{rules.moves}</b><small>Ruchy w turze</small></div>
          <div><b>{`${rules.turnSecs} s`}</b><small>Czas tury</small></div>
        </div>
      </header>
      {!game.cfg.arena.public && <p className="ar-note">Arena jest na razie dostępna tylko dla adminów.</p>}
      <div className="ar-lobby">
        <section className="ar-panel ar-deckpanel" aria-label="Talia">
          <header className="ar-panel-head">
            <h3>Talia <span className="ar-muted">{deck.length} / {size}</span></h3>
            <span className="ar-muted">Punkty talii: {totalPts}</span>
            <Button kind="quiet" onClick={random} disabled={pool.length < size}><Shuffle size={16} /> Losowa</Button>
          </header>
          <div className="ar-deck">
            {Array.from({ length: size }, (_, i) => deck[i]).map((pid, i) => pid
              ? <button key={pid} type="button" className="ar-tile on" onClick={() => toggle(pid)} title="Usuń z talii">
                  <Face pid={pid} variant={variantOf(pid)} /><span className="ar-cost"><Coins size={12} /> {pointsOf(pid)}</span>
                </button>
              : <div key={`e${i}`} className="ar-tile empty" aria-hidden="true">{i + 1}</div>)}
          </div>
          <div className="ar-search">
            <input type="search" placeholder="Szukaj karty" value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj karty" />
          </div>
          {pool.length < size && <p className="ar-note">{`Potrzebujesz co najmniej ${size} różnych kart.`}</p>}
          <div className="ar-pool">
            {shown.map(x => (
              <div key={x.person} className={`ar-tile${deck.includes(x.person) ? ' on' : ''}`}>
                <button type="button" className="ar-tile-btn" onClick={() => toggle(x.person)} aria-pressed={deck.includes(x.person)} title={person(x.person).name}>
                  <Face pid={x.person} variant={x.variant} />
                </button>
                <span className="ar-cost"><Coins size={12} /> {x.points}</span>
                <button type="button" className="ar-info" aria-label="Statystyki areny" title="Statystyki areny" onClick={() => { S.arenaCard = x.person; touch(); }}><Info size={14} /></button>
              </div>
            ))}
          </div>
        </section>
        <aside className="ar-side-col">
          <section className="ar-panel">
            <h3>Graj</h3>
            {accept && <Button kind="hue" big disabled={!ready || busy} onClick={() => acceptChallenge(accept, deck)}><Swords size={18} /> Przyjmij wyzwanie</Button>}
            {challenge && <Button kind="hue" big disabled={!ready || busy} onClick={sendChallenge}><Swords size={18} /> Wyzwij: {challenge}</Button>}
            <Button kind={accept || challenge ? 'plain' : 'hue'} big disabled={!ready || busy} onClick={startBot}><Bot size={18} /> Trening z komputerem</Button>
            {!ready && <p className="ar-muted">{`Wybierz ${size} kart do talii.`}</p>}
            <p className="ar-muted">Pojedynek z graczem: przycisk „Wyzwij na pojedynek” na jego profilu.</p>
            {box?.battle && <Button onClick={() => onOpen(box.battle!.id)}>Wróć do trwającego meczu</Button>}
          </section>
          {!!box?.incoming.length && (
            <section className="ar-panel">
              <h3>Wyzwania</h3>
              {box.incoming.map(c => (
                <div key={c.id} className="ar-challenge">
                  <span><b>{c.from.username}</b> <span className="ar-muted">({c.left} s)</span></span>
                  <Button kind="hue" disabled={!ready} onClick={() => acceptChallenge(c.id, deck)}>Przyjmij</Button>
                  <Button kind="quiet" onClick={() => declineChallenge(c.id)}>Odrzuć</Button>
                </div>
              ))}
            </section>
          )}
          {box?.outgoing && box.outgoing.status === 'pending' && (
            <section className="ar-panel">
              <h3>Twoje wyzwanie</h3>
              <p>Czekasz na odpowiedź: <b>{box.outgoing.to.username}</b> ({box.outgoing.left} s)</p>
              <Button kind="quiet" onClick={() => declineChallenge(box.outgoing!.id)}>Wycofaj</Button>
            </section>
          )}
          <section className="ar-panel">
            <h3>Nagrody dziś</h3>
            <p>Wygrana z człowiekiem: <b>{fmt(rules.rewardPvp)}</b> <span className="ar-muted">({r?.pvpWins ?? 0} / {rules.dailyPvp})</span></p>
            <p>Wygrany trening: <b>{fmt(rules.rewardBot)}</b> <span className="ar-muted">({r?.botWins ?? 0} / {rules.dailyBot})</span></p>
          </section>
          <section className="ar-panel ar-rules">
            <h3>Zasady</h3>
            <ul>
              <li>{`Każdy gracz ma ${rules.rows} linie po ${rules.rowSlots} miejsca. Linia 1 stoi najbliżej rywala.`}</li>
              <li>{`Tura: najwyżej ${rules.moves} ruchy i ${rules.turnSecs} s. Ruch to wystawienie karty, wycofanie karty albo użycie umiejętności (każda karta raz na turę).`}</li>
              <li>{`Wystawienie kosztuje tyle pieniędzy meczu, ile karta ma punktów. Na start ${rules.startMoney}, co turę +${rules.moneyPerTurn} (najwyżej ${rules.maxMoney}).`}</li>
              <li>{`Za pokonanie karty rywala dostajesz jej punkty. Po ${clock(rules.gameSecs)} wygrywa ten, kto ma więcej punktów; przy remisie dogrywka ${clock(rules.overtimeSecs)} (najwyżej ${rules.maxOvertimes} razy, potem remis).`}</li>
              <li>Zasięg: 1 = linia rywala tuż naprzeciw twojej pierwszej linii; każda linia dalej to +1.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

// ================================================================ mecz

type Sel = { kind: 'hand' | 'unit'; uid: number } | null;
type Pending = { uid: number; ab: number; step: 1 | 2; target?: number } | null;
interface Float { id: number; uid?: number; side?: 'me' | 'foe'; text: string; cls: string }

let floatId = 0;

function Match({ id, onLeave, onOpen }: { id: string; onLeave: () => void; onOpen: (id: string) => void }) {
  const [b, setB] = useState<BattleView | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Sel>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [floats, setFloats] = useState<Float[]>([]);
  const [now, setNow] = useState(Date.now());
  const [logOpen, setLogOpen] = useState(false);
  const got = useRef({ at: Date.now(), seen: 0, busy: false, over: false });
  const [log, setLog] = useState<LogEntry[]>([]);
  const [focus, setFocus] = useState<UnitView | null>(null);
  const [banner, setBanner] = useState<{ text: string; key: number } | null>(null);

  const take = useCallback((res: BattleView, fresh = false) => {
    got.current.at = Date.now();
    applyReveal(res.reveal, res.id);
    if (res.balance != null) { S.state.balance = res.balance; touch(); }
    const news = res.log.filter(l => l.n > got.current.seen);
    got.current.seen = Math.max(got.current.seen, res.seen);
    if (news.length) setLog(l => [...l, ...news].slice(-80));
    if (!fresh) showFx(news);
    if (res.over && !got.current.over) {
      got.current.over = true;
      if (res.over === 'me') Sound.win(); else if (res.over === 'foe') Sound.fail();
    }
    setB(res);
  }, []);

  const showFx = (entries: LogEntry[]) => {
    const add: Float[] = [];
    let snd = '';
    for (const e of entries) for (const f of e.fx) {
      const base = { id: ++floatId, uid: f.uid, side: f.side };
      if (f.kind === 'dmg' && f.amount) { add.push({ ...base, text: `-${f.amount}`, cls: 'dmg' }); snd ||= 'zap'; }
      else if (f.kind === 'block' && f.amount) add.push({ ...base, text: `-${f.amount}`, cls: 'block' });
      else if (f.kind === 'heal') { add.push({ ...base, text: f.amount ? `+${f.amount}` : 'leczenie', cls: 'heal' }); snd ||= 'pickup'; }
      else if (f.kind === 'shield') add.push({ ...base, text: `tarcza ${f.amount}`, cls: 'block' });
      else if (f.kind === 'poison') add.push({ ...base, text: `trucizna ${f.amount}`, cls: 'poison' });
      else if (f.kind === 'ko') { add.push({ ...base, text: `+${f.points} pkt`, cls: 'ko' }); snd = 'boom'; }
      else if (f.kind === 'revive') add.push({ ...base, text: 'powrót', cls: 'heal' });
      else if (f.kind === 'money' && f.amount) { add.push({ ...base, text: `${f.amount > 0 ? '+' : ''}${f.amount}`, cls: 'money' }); snd ||= 'coin'; }
    }
    if (snd) (Sound as any)[snd]?.();
    if (!add.length) return;
    setFloats(fl => [...fl, ...add]);
    setTimeout(() => setFloats(fl => fl.filter(f => !add.includes(f))), 1400);
  };

  // pierwsze wczytanie i odpytywanie (czas tury, ruchy rywala)
  useEffect(() => {
    let alive = true, t = 0;
    const poll = async (first = false) => {
      if (!got.current.busy) {
        try {
          const res = await api<BattleView>(`/api/arena/battle/${id}?since=${first ? 0 : got.current.seen}`);
          if (alive) take(res, first);
        } catch (e) {
          if (alive && first) setError((e as Error).message);
        }
      }
      if (alive && !got.current.over) t = window.setTimeout(poll, document.hidden ? 5000 : 1500);
    };
    poll(true);
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => { alive = false; clearTimeout(t); clearInterval(tick); restoreReveal(); };
  }, [id, take]);

  const act = async (body: Record<string, unknown>) => {
    if (got.current.busy) return;
    got.current.busy = true;
    try {
      const res = await api<BattleView>(`/api/arena/battle/${id}/act`, { ...body, since: got.current.seen });
      take(res);
    } catch (e) {
      toast((e as Error).message, true);
      Sound.error();
    } finally {
      got.current.busy = false;
      setSel(null);
      setPending(null);
    }
  };

  // baner przy zmianie tury
  const turnKey = b ? `${b.active}${b.over ?? ''}` : '';
  useEffect(() => {
    if (!b || b.over) return;
    setBanner({ text: b.active === 'me' ? 'Twoja tura' : 'Tura rywala', key: Date.now() });
    const t = setTimeout(() => setBanner(null), 1700);
    return () => clearTimeout(t);
  }, [turnKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="ar-page"><p className="ar-note">{error}</p><Button onClick={onLeave}>Wróć do lobby</Button></div>;
  if (!b) return <div className="ar-page"><p className="ar-muted">Wczytywanie meczu</p></div>;

  const me = b.sides.me, foe = b.sides.foe;
  const hand = Array.isArray(me.hand) ? me.hand : [];
  const mine = b.active === 'me' && !b.over;
  const elapsed = (now - got.current.at) / 1000;
  const gameLeft = b.over ? b.gameLeft : b.gameLeft - elapsed, turnLeft = b.over ? 0 : b.turnLeft - elapsed;
  const unit = sel?.kind === 'unit' ? me.board.find(u => u.uid === sel.uid) : undefined;
  const handSel = sel?.kind === 'hand' ? hand.find(u => u.uid === sel.uid) : undefined;
  const pUnit = pending ? me.board.find(u => u.uid === pending.uid) : undefined;
  const pAb = pUnit && pending ? pUnit.abilities[pending.ab] : undefined;
  // cele przy wyborze: krok 1 = cel z listy serwera, krok 2 (wysysanie) = moja karta, która dostaje HP
  const targets: { side: 'me' | 'foe'; uids: number[] } | null = pending && pUnit && pAb
    ? pending.step === 1 ? pUnit.targets?.[pending.ab] ?? null : { side: 'me', uids: me.board.map(u => u.uid).filter(x => x !== pending.target) }
    : null;

  const clickUnit = (side: 'me' | 'foe', u: UnitView) => {
    if (pending && targets?.side === side && targets.uids.includes(u.uid)) {
      if (pAb?.kind === 'heal' && pAb.mode === 'drain' && pAb.aim && pending.step === 1) { setPending({ ...pending, step: 2, target: u.uid }); Sound.click(); return; }
      return act(pending.step === 2 ? { type: 'use', uid: pending.uid, ab: pending.ab, target: pending.target, target2: u.uid } : { type: 'use', uid: pending.uid, ab: pending.ab, target: u.uid });
    }
    if (pending) { setPending(null); return; }
    if (side === 'me') { setSel(sel?.kind === 'unit' && sel.uid === u.uid ? null : { kind: 'unit', uid: u.uid }); Sound.click(); }
    else { S.arenaCard = u.pid; touch(); }
  };
  const fireAbility = (u: UnitView, i: number) => {
    const ab = u.abilities[i];
    if (ab.aim && ab.kind !== 'eco') {
      if (!u.targets?.[i]?.uids.length) { toast('Brak celu w zasięgu', true); return Sound.error(); }
      setPending({ uid: u.uid, ab: i, step: 1 });
      setSel(null);
      return Sound.click();
    }
    act({ type: 'use', uid: u.uid, ab: i });
  };
  const placeIn = (row: number) => { if (handSel) act({ type: 'place', uid: handSel.uid, row }); };
  const canAfford = (u: UnitView) => u.points <= me.money;

  const rows = Array.from({ length: b.rules.rows }, (_, i) => i);
  const LANE_ICONS = [Swords, Crosshair, Flame];
  const laneSum = (side: 'me' | 'foe', row: number) => b.sides[side].board.filter(u => u.row === row).reduce((a, u) => a + u.atk, 0);
  const total = (side: 'me' | 'foe') => b.sides[side].board.reduce((a, u) => a + u.atk, 0);

  const renderUnit = (side: 'me' | 'foe', u: UnitView) => {
    const target = !!targets && targets.side === side && targets.uids.includes(u.uid);
    const fl = floats.filter(f => f.uid === u.uid);
    return (
      <div key={u.uid} className={`ar-unit ${side}${u.acted && side === 'me' ? ' acted' : ''}${sel?.uid === u.uid ? ' sel' : ''}${target ? ' target' : ''}${pending?.uid === u.uid ? ' source' : ''}`}
        onMouseEnter={() => setFocus(u)} onMouseLeave={() => setFocus(f => f?.uid === u.uid ? null : f)}>
        <button type="button" className="ar-unit-btn" onClick={e => { e.stopPropagation(); clickUnit(side, u); }} aria-label={`${person(u.pid)?.name ?? ''}: ${u.hp} z ${u.maxHp} HP`}>
          <Face pid={u.pid} variant={u.variant} />
        </button>
        <span className="ar-gem atk" title="Atak">{u.atk}</span>
        <span className={`ar-gem hp${u.hp < u.maxHp ? ' hurt' : ''}`} title="HP">{u.hp}</span>
        <div className="ar-badges">
          {u.shield > 0 && <span className="b-shield" title="Tarcza"><Shield size={11} />{u.shield}</span>}
          {u.poison > 0 && <span className="b-poison" title="Trucizna na turę"><Skull size={11} />{u.poison}</span>}
          {u.regen > 0 && <span className="b-regen" title="Leczenie na turę"><Sparkles size={11} />{u.regen}</span>}
        </div>
        {fl.map(f => <span key={f.id} className={`ar-float ${f.cls}`}>{f.text}</span>)}
      </div>
    );
  };

  const renderLane = (side: 'me' | 'foe', row: number) => {
    const units = b.sides[side].board.filter(u => u.row === row).sort((x, y) => x.slot - y.slot);
    const free = b.rules.rowSlots - units.length;
    const placing = side === 'me' && mine && !!handSel && free > 0;
    const Icon = LANE_ICONS[row] ?? Swords;
    return (
      <div key={`${side}${row}`} className={`ar-lane ${side}${placing ? ' drop' : ''}`} onClick={placing ? () => placeIn(row) : undefined}
        role={placing ? 'button' : undefined} aria-label={placing ? `Wystaw do linii ${row + 1}` : `Linia ${row + 1}`}>
        <div className="ar-lane-tag" title={`Linia ${row + 1}: suma ataku`}>
          <Icon size={15} aria-hidden="true" />
          <b>{laneSum(side, row)}</b>
          <small>{row + 1}</small>
        </div>
        <div className="ar-lane-cards">
          {units.map(u => renderUnit(side, u))}
          {Array.from({ length: free }, (_, i) => <div key={`e${i}`} className={`ar-socket${placing ? ' drop' : ''}`} />)}
        </div>
      </div>
    );
  };

  const plate = (side: 'me' | 'foe') => {
    const s = b.sides[side], h = b.heroes[side] as { username: string; bot?: boolean; avatarCard?: string | null };
    const active = b.active === side && !b.over;
    const moneyFl = floats.filter(f => !f.uid && f.side === side);
    return (
      <section className={`ar-plate ${side}${active ? ' active' : ''}`} aria-label={side === 'me' ? 'Ty' : 'Rywal'}>
        <div className="ar-portrait">
          {h.bot ? <Bot size={30} /> : h.avatarCard ? <img src={`/avatar/${encodeURIComponent(h.username)}?c=${encodeURIComponent(h.avatarCard)}`} alt="" />
            : <span>{(h.username || '?').slice(0, 1).toUpperCase()}</span>}
        </div>
        <div className="ar-plate-body">
          <div className="ar-plate-name">{h.username}</div>
          <div className="ar-plate-stats">
            <span className="ar-coin" title="Pieniądze w meczu"><Coins size={14} />{s.money}{moneyFl.map(f => <span key={f.id} className={`ar-float ${f.cls}`}>{f.text}</span>)}</span>
            <span title="Karty w ręce">{`ręka ${typeof s.hand === 'number' ? s.hand : s.hand.length}`}</span>
            <span title="Pokonane karty">{`pokonane ${s.ko.length}`}</span>
          </div>
          {active && <div className="ar-pips" title={`Ruchy: ${s.moves}`}>{Array.from({ length: b.rules.moves }, (_, i) => <i key={i} className={i < s.moves ? 'on' : ''} />)}</div>}
          {!!s.combos.length && <div className="ar-combos">{s.combos.map(c => <span key={c.id} title={c.effects.map(e => `${e.kind} ${e.amount > 0 ? '+' : ''}${e.amount}`).join(', ')}>{c.name}</span>)}</div>}
        </div>
        <div className="ar-medal" title="Punkty"><b>{s.points}</b><small>pkt</small></div>
      </section>
    );
  };

  const reasonText = b.reason === 'surrender' ? 'poddanie' : b.reason === 'away' ? 'walkower' : 'koniec czasu';
  const shown = focus ?? unit ?? handSel ?? null;
  const ringLen = 2 * Math.PI * 26, turnFrac = Math.max(0, Math.min(1, turnLeft / b.rules.turnSecs));

  return (
    <div className={`ar-page ar-match ar-table${mine ? ' my-turn' : ''}`}>
      <aside className="ar-left">
        {plate('foe')}
        <div className="ar-clock" aria-live="polite">
          <svg viewBox="0 0 60 60" className="ar-ring" aria-hidden="true">
            <circle cx="30" cy="30" r="26" className="track" />
            <circle cx="30" cy="30" r="26" className={`prog${mine ? ' mine' : ''}${turnLeft < 10 ? ' late' : ''}`} strokeDasharray={ringLen} strokeDashoffset={ringLen * (1 - turnFrac)} />
          </svg>
          <div className="ar-clock-in">
            <Hourglass size={14} aria-hidden="true" />
            <b>{clock(gameLeft)}</b>
            {!b.over && <small>{`${Math.ceil(Math.max(0, turnLeft))} s`}</small>}
          </div>
          {b.overtimes > 0 && <span className="ar-ot">{`dogrywka ${b.overtimes}`}</span>}
        </div>
        {plate('me')}
      </aside>

      <main className={`ar-field${pending ? ' picking' : ''}`}>
        <div className="ar-status" aria-live="polite">
          <span>{pending ? (pending.step === 2 ? 'Wybierz kartę, która dostanie HP' : 'Wybierz cel') : handSel ? 'Wybierz linię dla karty' : mine ? 'Twoja tura' : 'Czekaj na ruch rywala'}</span>
          {(pending || handSel) && <button type="button" className="ar-btn" onClick={() => { setPending(null); setSel(null); }}><X size={14} /> Anuluj</button>}
        </div>
        <div className="ar-side-rows foe">{[...rows].reverse().map(r => renderLane('foe', r))}</div>
        <div className="ar-divider" aria-hidden="true"><span>{total('foe')}</span><i /><span>{total('me')}</span></div>
        <div className="ar-side-rows me">{rows.map(r => renderLane('me', r))}</div>
        <div className="ar-hand" aria-label="Ręka">
          {hand.map((u, i) => (
            <button key={u.uid} type="button" style={{ '--i': i - (hand.length - 1) / 2 } as CSSProperties}
              className={`ar-hand-card${sel?.uid === u.uid ? ' on' : ''}${canAfford(u) ? '' : ' poor'}`}
              onMouseEnter={() => setFocus(u)} onMouseLeave={() => setFocus(f => f?.uid === u.uid ? null : f)}
              onClick={() => { if (!mine) return toast('To nie twoja tura', true); setPending(null); setSel(sel?.uid === u.uid ? null : { kind: 'hand', uid: u.uid }); Sound.click(); }}
              title={`${person(u.pid)?.name ?? ''}: koszt ${u.points}`}>
              <Face pid={u.pid} variant={u.variant} />
              <span className="ar-cost"><Coins size={11} />{u.points}</span>
              {u.hp < u.maxHp && <span className="ar-handhp">{u.hp}/{u.maxHp}</span>}
            </button>
          ))}
          {!hand.length && <p className="ar-muted">Wszystkie karty są na planszy albo pokonane.</p>}
        </div>
      </main>

      <aside className="ar-right">
        <section className="ar-focus" aria-label="Wybrana karta">
          {shown ? (
            <>
              <div className="ar-focus-card"><Face pid={shown.pid} variant={shown.variant} /></div>
              <h3>{person(shown.pid)?.name}</h3>
              <div className="ar-focus-stats">
                <span title="Atak"><Swords size={13} />{shown.atk}</span><span title="HP"><Heart size={13} />{shown.hp}/{shown.maxHp}</span>
                <span title="Zasięg"><Crosshair size={13} />{rangeText(shown.range)}</span><span title="Punkty i koszt"><Coins size={13} />{shown.points}</span>
              </div>
              {(shown.spec || shown.class) && <p className="ar-muted">{[specName(shown.spec), className(shown.class)].filter(Boolean).join(' · ')}</p>}
              <div className="ar-abs">
                {shown.abilities.map((a, i) => unit && unit.uid === shown.uid ? (
                  <button key={i} type="button" className="ar-ab" disabled={!mine || unit.acted || a.kind === 'special' || a.cost > me.money} onClick={() => fireAbility(unit, i)}>
                    <b>{a.name}</b> <span className="ar-kind">{KIND_NAMES[a.kind] ?? a.kind}</span>
                    <small>{abilityText(a, shown.atk, arenaCfg()?.specials)}</small>
                  </button>
                ) : (
                  <div key={i} className="ar-ab ro"><b>{a.name}</b> <span className="ar-kind">{KIND_NAMES[a.kind] ?? a.kind}</span><small>{abilityText(a, shown.atk, arenaCfg()?.specials)}</small></div>
                ))}
              </div>
              {unit && unit.uid === shown.uid && (
                <div className="ar-row-btns">
                  <Button disabled={!mine} onClick={() => act({ type: 'retreat', uid: unit.uid })}><Undo2 size={16} /> Wycofaj</Button>
                  <Button kind="quiet" onClick={() => { S.arenaCard = unit.pid; touch(); }}><BarChart3 size={16} /> Statystyki</Button>
                </div>
              )}
              {handSel && handSel.uid === shown.uid && <p>{`Koszt wystawienia: ${handSel.points} (masz ${me.money}). Kliknij linię na planszy.`}</p>}
            </>
          ) : (
            <div className="ar-focus-empty"><Swords size={64} strokeWidth={1.2} aria-hidden="true" /><p>Wybierz kartę z ręki, żeby ją wystawić, albo swoją kartę na planszy, żeby użyć umiejętności. Najedź na kartę, żeby ją obejrzeć.</p></div>
          )}
        </section>
        <div className="ar-controls">
          <button type="button" className="ar-end" disabled={!mine} onClick={() => act({ type: 'end' })}><SkipForward size={18} /> Koniec tury</button>
          <div className="ar-row-btns">
            {!b.over && <Button kind="quiet" onClick={() => { if (confirm('Poddać mecz?')) act({ type: 'surrender' }); }}><Flag size={16} /> Poddaj się</Button>}
            <Button kind="quiet" onClick={() => setLogOpen(o => !o)} aria-expanded={logOpen}><ScrollText size={16} /> Dziennik</Button>
          </div>
          {logOpen && <ol className="ar-log">{[...log].reverse().map(l => <li key={l.n} className={l.side ?? ''}>{l.text}</li>)}</ol>}
        </div>
      </aside>

      {banner && <div key={banner.key} className={`ar-banner${banner.text === 'Twoja tura' ? ' mine' : ''}`} aria-hidden="true"><span>{banner.text}</span></div>}

      {b.over && (
        <div className="ar-result" role="dialog" aria-modal="true" aria-label="Wynik meczu">
          <div className={`ar-result-box ${b.over}`}>
            <h2>{b.over === 'me' ? 'Wygrana' : b.over === 'foe' ? 'Przegrana' : 'Remis'}</h2>
            <p className="ar-score"><span>{me.points}</span><i>:</i><span>{foe.points}</span></p>
            <p className="ar-muted">{reasonText}</p>
            {b.rewards && (
              <div className="ar-reward">
                {b.rewards.money > 0 && <p>Nagroda: <b>{fmt(b.rewards.money)}</b></p>}
                {b.rewards.note && <p className="ar-muted">{b.rewards.note}</p>}
                <p className="ar-muted">{`Dziś: wygrane z ludźmi ${b.rewards.pvpWins} / ${b.rewards.dailyPvp}, treningi ${b.rewards.botWins} / ${b.rewards.dailyBot}`}</p>
              </div>
            )}
            <div className="ar-row-btns">
              {b.mode === 'bot' && <Button kind="hue" onClick={async () => {
                try { const r = await api<BattleView>('/api/arena/start', { deck: savedDeck() }); onOpen(r.id); } catch (e) { toast((e as Error).message, true); }
              }}><Bot size={16} /> Jeszcze raz</Button>}
              <Button onClick={onLeave}>Wróć do lobby</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
