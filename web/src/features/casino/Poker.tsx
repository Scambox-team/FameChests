import { useEffect, useRef, useState } from 'react';
import { Crown, DoorOpen, Eye, Plus, Users } from 'lucide-react';
import { api } from '../../api/client';
import { PickTile } from '../../cards/PickTile';
import { confetti, GOLDS, openViewer } from '../../fx/effects';
import { plural } from '../../game/rules';
import { applyState } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { Avatar } from '../../ui/UserLink';
import { CardPicker } from './parts';
import { addDuplicates, CS, csStake, dropMissing, togglePick } from './state';
import './poker.css';

// Texas Hold'em dla 2-6 graczy. Grę prowadzi serwer (routes/poker.rs): talia, karty innych, czas tury.
// Stawką są karty z kolekcji - każdy przynosi do stołu swój stos i wypycha z niego karty na stół, więc widać,
// kto co postawił. Stół odpytujemy co chwilę; wygrane karty trafiają na stos, a po wstaniu - do ekwipunku.

const SUITS: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const PHASES: Record<string, string> = { waiting: 'Czekamy na graczy', preflop: 'Przed flopem', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Wyniki' };
// miejsca dookoła stołu: 0 = dół (ja), dalej zgodnie z ruchem wskazówek zegara
const SPOTS: [number, number][] = [[50, 100], [6, 74], [6, 26], [50, 0], [94, 26], [94, 74]];
// gdzie leżą postawione karty gracza z danego miejsca (na suknie, obok ręki i z dala od kart stołu)
const BET_SPOTS: [number, number][] = [[67, 74], [22, 64], [22, 36], [33, 26], [78, 36], [78, 64]];
const POLL_MS = 1200;

const P = {
  lobby: null as any,
  table: null as any,
  tid: null as number | null,
  at: 0,              // kiedy przyszedł stan stołu (do odliczania czasu tury)
  sel: new Set<number>(),     // karty z ekwipunku do przyniesienia
  bet: new Set<number>(),     // karty ze stosu do postawienia
  q: '',
  name: '',
  busy: false,
  creating: false
};
CS.sorts.pk ??= 'value';

/** Karta do gry */
function PlayingCard({ c, best, small, delay = 0 }: { c: string; best?: boolean; small?: boolean; delay?: number }) {
  if (c === '??') return <div className={`pk-card back${small ? ' sm' : ''}`} style={{ animationDelay: `${delay}ms` }} />;
  const r = c[0] === 'T' ? '10' : c[0], s = SUITS[c[1]];
  return (
    <div className={`pk-card${'HD'.includes(c[1]) ? ' red' : ''}${best ? ' best' : ''}${small ? ' sm' : ''}`} style={{ animationDelay: `${delay}ms` }}>
      <span className="pk-c-tl">{r}<i>{s}</i></span>
      <span className="pk-c-mid">{s}</span>
      <span className="pk-c-br">{r}<i>{s}</i></span>
    </div>
  );
}

/** Karty z kolekcji postawione przez gracza - wachlarz przed jego miejscem */
function BetFan({ seat, street }: { seat: any; street: number }) {
  const list: any[] = seat.bet;
  if (!list.length) return null;
  const show = list.slice(-7);
  return (
    <div className="pk-fan" title={`${seat.user.username}: ${list.length} ${plural(list.length, 'karta', 'karty', 'kart')}, ${fmt(seat.committed)}`}>
      <div className="pk-fan-cards">
        {show.map((c, k) => (
          <div key={c.id} className={`pk-fan-c${c.street === street ? ' now' : ''}`} style={{ '--k': k, '--n': show.length } as React.CSSProperties}>
            <PickTile item={c} reveal={c.reveal ? { map: { [c.person]: c.reveal } } : undefined} onClick={() => openViewer(c.person, c.variant, c.id)} />
          </div>
        ))}
      </div>
      <span className="pk-fan-sum">{list.length > show.length && <small>+{list.length - show.length} </small>}{fmt(seat.committed)}</span>
    </div>
  );
}

function useNow(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set(n => n + 1), 250);
    return () => clearInterval(t);
  }, [on]);
}

function SeatBox({ s, T, pos }: { s: any; T: any; pos: number }) {
  const turn = T.toAct === s.seat;
  useNow(turn);
  const left = turn ? Math.max(0, T.timeLeft - (Date.now() - P.at) / 1000) : 0;
  const win = T.phase === 'showdown' && T.result?.winners.find((w: any) => w.seat === s.seat);
  const shown = T.result?.shown.find((x: any) => x.seat === s.seat);
  const bestSet = new Set<string>(shown?.best ?? win?.best ?? []);
  const me = s.seat === T.mySeat;
  return (
    <div className={`pk-seat pos-${pos}${turn ? ' turn' : ''}${s.folded ? ' folded' : ''}${win ? ' won' : ''}${me ? ' me' : ''}${s.away ? ' away' : ''}`}
      style={{ left: `${SPOTS[pos][0]}%`, top: `${SPOTS[pos][1]}%` }}>
      <div className="pk-hole">{s.hole.map((c: string, k: number) => <PlayingCard key={`${T.handNo}-${k}-${c}`} c={c} best={bestSet.has(c)} small={!me} delay={k * 120} />)}</div>
      <div className="pk-plate">
        <div className="pk-ava" style={{ '--t': turn ? left / T.turnSecs : 0 } as React.CSSProperties}>
          <Avatar user={s.user} size={42} />
          {T.dealer === s.seat && T.phase !== 'waiting' && <span className="pk-dealer" title="Rozdający">D</span>}
        </div>
        <div className="pk-who">
          <b>{s.user.username}{me ? ' (ty)' : ''}</b>
          <span>{s.left ? 'wstał' : `${fmt(s.stackValue)} · ${s.stackCount} ${plural(s.stackCount, 'karta', 'karty', 'kart')}`}</span>
        </div>
      </div>
      {(s.last || s.hand || s.allIn) && (
        <div className={`pk-last${s.allIn ? ' allin' : ''}`}>{s.allIn && !s.folded ? 'ALL-IN' : s.last}{s.hand && !s.folded ? <em>{s.hand}</em> : null}</div>
      )}
      {turn && <div className="pk-timer">{Math.ceil(left)} s</div>}
      {win && <div className="pk-win"><Crown size={14} /> +{fmt(win.value)}</div>}
    </div>
  );
}

function Felt({ T }: { T: any }) {
  const base = T.mySeat ?? 0;
  const street = ({ preflop: 0, flop: 1, turn: 2, river: 3 } as Record<string, number>)[T.phase] ?? -1;
  const winners: any[] = T.phase === 'showdown' ? T.result?.winners ?? [] : [];
  const best = new Set<string>(winners.flatMap(w => w.best));
  return (
    <div className={`pk-table ph-${T.phase}`}>
      <div className="pk-rim">
        <div className="pk-felt">
          <div className="pk-logo">SCAMBOX · HOLD'EM</div>
          <div className="pk-center">
            <div className="pk-pot">
              <span>{PHASES[T.phase]}{T.handNo ? ` · #${T.handNo}` : ''}</span>
              <b>{T.pot ? `Pula ${fmt(T.pot)}` : T.phase === 'waiting' ? T.seats.filter(Boolean).length < 2 ? 'Potrzeba co najmniej 2 graczy' : 'Zaraz rozdanie' : ' '}</b>
            </div>
            <div className="pk-board">
              {[0, 1, 2, 3, 4].map(k => T.board[k]
                ? <PlayingCard key={`${T.handNo}-b${k}`} c={T.board[k]} best={best.has(T.board[k])} delay={(k < 3 ? k : 0) * 140} />
                : <div key={k} className="pk-slot" />)}
            </div>
            {winners.length > 0 && (
              <div className="pk-banner">
                {winners.map(w => <div key={w.seat}><Crown size={16} /> <b>{w.user.username}</b> bierze {fmt(w.value)}{w.hand ? <em> · {w.hand}</em> : T.result.byFold ? <em> · reszta spasowała</em> : null}</div>)}
              </div>
            )}
          </div>
          {T.seats.map((s: any, i: number) => {
            if (!s) return null;
            const pos = (i - base + 6) % 6, [x, y] = BET_SPOTS[pos];
            return <div key={i} className={`pk-betspot bp-${pos}`} style={{ left: `${x}%`, top: `${y}%` }}><BetFan seat={s} street={street} /></div>;
          })}
        </div>
      </div>
      {T.seats.map((s: any, i: number) => s && <SeatBox key={i} s={s} T={T} pos={(i - base + 6) % 6} />)}
    </div>
  );
}

// ---------------------------------------------------------------- zapytania

let timer = 0;
let lastVer = -1;
let lastPhase = '';
let lastBoard = 0;
let lastTurn: number | null = null;

function onTable(T: any) {
  const prev = P.table;
  P.table = T;
  P.at = Date.now();
  if (!T) return;
  if (prev?.id === T.id && T.ver !== lastVer) {
    if (T.board.length > lastBoard) Sound.deal();
    else if (T.phase === 'preflop' && lastPhase !== 'preflop') Sound.deal();
    if (T.phase === 'showdown' && lastPhase !== 'showdown') {
      const mine = T.result?.winners.find((w: any) => w.seat === T.mySeat);
      if (mine) { Sound.win(); confetti(GOLDS, 120); } else if (T.mySeat != null && T.seats[T.mySeat]?.inHand) Sound.fail();
    } else if (T.toAct === T.mySeat && T.mySeat != null && lastTurn !== T.mySeat) Sound.pop();
    else if (T.pot > (prev?.pot ?? 0)) Sound.coin();
  }
  if (T.toAct !== T.mySeat) P.bet.clear();
  const mine = T.mySeat != null ? T.seats[T.mySeat] : null;
  if (mine) { const own = new Set(mine.stack.map((c: any) => c.id)); [...P.bet].forEach(id => { if (!own.has(id)) P.bet.delete(id); }); }
  lastVer = T.ver; lastPhase = T.phase; lastBoard = T.board.length; lastTurn = T.toAct;
}

async function poll() {
  clearTimeout(timer);
  try {
    if (P.tid != null) {
      const res = await api(`/api/casino/poker/${P.tid}`);
      onTable(res.table);
    } else {
      P.lobby = await api('/api/casino/poker');
      if (P.lobby.current != null) { P.tid = P.lobby.current; return poll(); }
    }
    touch();
  } catch (e: any) {
    if (P.tid != null) { toast(e.message, true); P.tid = null; P.table = null; touch(); }
  }
  if (CS.tab === 'poker') timer = window.setTimeout(poll, document.hidden ? POLL_MS * 4 : POLL_MS);
}

async function call(path: string, body?: any) {
  if (P.busy) return null;
  P.busy = true;
  try {
    const res = await api(path, body ?? {});
    if (res.items) S.items = res.items;
    if (res.state) applyState(res.state);
    if (res.table) onTable(res.table);
    return res;
  } catch (e: any) { Sound.error(); toast(e.message, true); return null; }
  finally { P.busy = false; touch(); }
}

async function sit(tid: number | null) {
  const ids = [...P.sel];
  if (!ids.length) { Sound.error(); return toast('Wybierz karty, z którymi siadasz do stołu', true); }
  const v = csStake(P.sel);
  if (v >= 5000 && !confirm(`Siadasz do stołu z ${ids.length} ${plural(ids.length, 'kartą', 'kartami', 'kartami')} o wartości ${fmt(v)}. Karty, które przegrasz, przejdą do innych graczy. Dalej?`)) return;
  const res = tid == null ? await call('/api/casino/poker', { ids, name: P.name }) : await call(`/api/casino/poker/${tid}/join`, { ids });
  if (!res) return;
  P.sel.clear();
  P.creating = false;
  P.tid = res.table.id;
  Sound.cash();
  poll();
}

async function rebuy() {
  const ids = [...P.sel];
  if (!ids.length) { Sound.error(); return toast('Wybierz karty do dołożenia', true); }
  if (await call(`/api/casino/poker/${P.tid}/rebuy`, { ids })) { P.sel.clear(); Sound.cash(); }
}

async function act(kind: string, ids: number[] = []) {
  if (await call(`/api/casino/poker/${P.tid}/act`, { kind, ids })) { P.bet.clear(); Sound.click(); }
}

async function leave() {
  const T = P.table, me = T?.seats[T.mySeat];
  if (me?.inHand && !me.folded && T.phase !== 'showdown' && T.phase !== 'waiting' && !confirm('Trwa rozdanie: wstając, spasujesz, a karty postawione w tym rozdaniu zostaną w puli. Wstać?')) return;
  if (await call(`/api/casino/poker/${P.tid}/leave`)) {
    toast('Wstajesz od stołu. Karty ze stosu wróciły do ekwipunku');
    P.tid = null; P.table = null; P.bet.clear();
    poll();
  }
}

// ---------------------------------------------------------------- panele

function Picker({ title, children }: { title: string; children?: React.ReactNode }) {
  const max = P.table?.maxBuy ?? P.lobby?.maxBuy ?? 40;
  return <>
    <div className="panel pk-side-panel"><h3>{title}</h3>{children}</div>
    <CardPicker set={P.sel} zone="pk" max={max} q={P.q} disabled={P.busy}
      tip="Dodaj karty, które masz podwójnie. Z każdej zostaje jeden egzemplarz, ulubione zostają."
      onQ={q => { P.q = q; touch(); }} onPick={id => togglePick(P.sel, id, max)}
      onDupes={() => { const ids = addDuplicates([...P.sel], max, 'pk'); if (ids) { P.sel = new Set(ids); Sound.click(); touch(); } }}
      onClear={() => { P.sel.clear(); touch(); }} />
  </>;
}

function Actions({ T }: { T: any }) {
  const me = T.seats[T.mySeat];
  const myTurn = T.toAct === T.mySeat && T.phase !== 'showdown';
  const stack: any[] = me.stack;
  const selV = stack.filter(c => P.bet.has(c.id)).reduce((a, c) => a + c.value, 0);
  const total = me.street + selV, allSel = P.bet.size > 0 && P.bet.size === stack.length;
  const betLabel = !P.bet.size ? 'Wybierz karty ze stosu' : allSel ? `All-in ${fmt(selV)}` : total > T.maxBet ? (T.maxBet > 0 ? `Podbij do ${fmt(total)}` : `Postaw ${fmt(selV)}`) : total === T.maxBet ? `Sprawdź ${fmt(selV)}` : `Za mało (brakuje ${fmt(T.maxBet - total)})`;
  const betOk = P.bet.size > 0 && (total >= T.maxBet || allSel);
  const stackV = stack.reduce((a, c) => a + c.value, 0);
  return (
    <div className="panel pk-actions">
      <div className="pk-act-head">
        <div>
          <h3>{myTurn ? 'Twój ruch' : me.inHand && !me.folded && T.phase !== 'waiting' && T.phase !== 'showdown' ? 'Czekasz na ruch innych' : 'Twój stos'}</h3>
          <p className="muted small">
            Stos: <b>{fmt(stackV)}</b> · {stack.length} {plural(stack.length, 'karta', 'karty', 'kart')}
            {myTurn && T.toCall > 0 && <> · do sprawdzenia <b className="pk-tocall">{fmt(T.toCall)}</b></>}
            {myTurn ? ' · kliknij karty, które chcesz wypchnąć na stół' : ''}
          </p>
        </div>
        <Button kind="quiet" onClick={leave} disabled={P.busy}><DoorOpen size={16} /> Wstań od stołu</Button>
      </div>
      {myTurn && (
        <div className="pk-btns">
          <Button big onClick={() => act('fold')} disabled={P.busy}>Pas</Button>
          {T.toCall > 0
            ? <Button big onClick={() => act('call')} disabled={P.busy} title="Serwer dobierze najtańsze karty ze stosu, które wystarczą">Sprawdź {fmt(T.toCall)}</Button>
            : <Button big onClick={() => act('check')} disabled={P.busy}>Czekaj</Button>}
          <Button big kind="hue" onClick={() => act('bet', [...P.bet])} disabled={P.busy || !betOk}>{betLabel}</Button>
          <Button big className="pk-allin" onClick={() => confirm(`All-in: cały stos (${fmt(stackV)}) na stół?`) && act('allin')} disabled={P.busy || !stack.length}>All-in</Button>
        </div>
      )}
      <div className="pick-grid pk-stack">
        {stack.map(c => <PickTile key={c.id} item={c} selected={P.bet.has(c.id)} onClick={myTurn ? () => { P.bet.has(c.id) ? P.bet.delete(c.id) : P.bet.add(c.id); Sound.click(); touch(); } : () => openViewer(c.person, c.variant, c.id)} />)}
        {!stack.length && <p className="muted small">Pusty stos. Dołóż karty, żeby grać dalej.</p>}
      </div>
    </div>
  );
}

function Log({ T }: { T: any }) {
  return (
    <div className="panel pk-log">
      <h3>Przebieg</h3>
      <ol>{T.log.map((l: string, k: number) => <li key={`${T.ver}-${k}`}>{l}</li>)}</ol>
    </div>
  );
}

function TableView() {
  const T = P.table;
  if (!T) return <div className="panel muted">Ładowanie stołu</div>;
  const me = T.mySeat != null ? T.seats[T.mySeat] : null;
  const free = T.seats.filter((s: any) => !s).length;
  return (
    <div className="pk-wrap">
      <div className="pk-top">
        <div><h2 className="pk-title">{T.name}</h2><span className="muted small">{T.seats.filter(Boolean).length}/{T.seats.length} graczy · ciemne: najtańsza karta ze stosu</span></div>
        {!me && <Button onClick={() => { P.tid = null; P.table = null; poll(); }}>Wróć do stołów</Button>}
      </div>
      <Felt T={T} />
      <div className="pk-cols">
        <div className="pk-main">
          {me ? <Actions T={T} /> : <div className="panel"><h3><Eye size={16} /> Oglądasz stół</h3><p className="muted small">{free ? 'Wybierz karty poniżej i usiądź, żeby zagrać od następnego rozdania.' : 'Wszystkie miejsca są zajęte.'}</p></div>}
          <Log T={T} />
        </div>
        <div className="pk-aside">
          {me && T.canRebuy && <Picker title="Dołóż karty na stos"><p className="muted small">Możesz dokładać karty między rozdaniami albo po spasowaniu.</p><Button kind="hue" disabled={!P.sel.size || P.busy} onClick={rebuy}><Plus size={16} /> Dołóż {P.sel.size ? `${P.sel.size} (${fmt(csStake(P.sel))})` : ''}</Button></Picker>}
          {me && !T.canRebuy && <div className="panel"><h3>Zasady</h3><Rules /></div>}
          {!me && free > 0 && <Picker title="Usiądź do stołu"><Button kind="hue" disabled={!P.sel.size || P.busy} onClick={() => sit(T.id)}>Usiądź z {P.sel.size} {plural(P.sel.size, 'kartą', 'kartami', 'kartami')} ({fmt(csStake(P.sel))})</Button></Picker>}
        </div>
      </div>
    </div>
  );
}

function Rules() {
  return (
    <ul className="pk-rules small">
      <li>Texas Hold'em: 2 karty w ręku, 5 na stole, liczy się najlepszy układ z pięciu.</li>
      <li>Stawką są twoje karty. Przynosisz je do stołu jako stos i wypychasz z niego na stół. Każdy widzi, kto co postawił.</li>
      <li>Ciemne: dwie osoby za rozdającym wykładają najtańszą kartę ze stosu.</li>
      <li>Karty są niepodzielne: żeby sprawdzić, postaw co najmniej tyle, ile najwyższa stawka. Kogo nie stać, gra all-in o pulę, na którą go stać.</li>
      <li>Wygrane karty trafiają na twój stos. Wstając od stołu, zabierasz cały stos do ekwipunku.</li>
      <li>Na ruch masz 35 s. Kto dwa razy z rzędu się nie ruszy, wstaje od stołu po rozdaniu.</li>
    </ul>
  );
}

function LobbyView() {
  const L = P.lobby;
  if (!L) return <div className="panel muted">Ładowanie stołów</div>;
  return (
    <div className="pk-cols">
      <div className="pk-main">
        <div className="panel">
          <div className="pk-lobby-head"><h3><Users size={18} /> Stoły</h3><Button kind="hue" onClick={() => { P.creating = !P.creating; Sound.click(); touch(); }}><Plus size={16} /> Nowy stół</Button></div>
          {!L.tables.length && <p className="muted">Nikt jeszcze nie gra. Załóż stół i zaproś znajomych.</p>}
          <div className="pk-tables">
            {L.tables.map((t: any) => (
              <button key={t.id} type="button" className="pk-tile" onClick={() => { P.tid = t.id; Sound.click(); poll(); }}>
                <div className="pk-tile-felt"><b>{t.name}</b><span>{PHASES[t.phase]}{t.handNo ? ` · rozdanie #${t.handNo}` : ''}</span></div>
                <div className="pk-tile-who">{t.players.map((u: any) => <Avatar key={u.id} user={u} size={26} />)}<span className="muted small">{t.players.length}/{t.seats}</span></div>
                <div className="muted small">Na stole {fmt(t.stacks)}{t.pot ? ` · pula ${fmt(t.pot)}` : ''}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="panel"><h3>Zasady</h3><Rules /></div>
      </div>
      <div className="pk-aside">
        {P.creating ? (
          <Picker title="Nowy stół">
            <input className="pk-name" value={P.name} maxLength={30} placeholder="Nazwa stołu (opcjonalnie)" aria-label="Nazwa stołu" onChange={e => { P.name = e.target.value; touch(); }} />
            <p className="muted small">Wybierz karty, z którymi siadasz (najwyżej {L.maxBuy}). Ulubionych i specjalnych nie można postawić.</p>
            <Button kind="hue" disabled={!P.sel.size || P.busy} onClick={() => sit(null)}>Załóż stół i usiądź ({fmt(csStake(P.sel))})</Button>
          </Picker>
        ) : <div className="panel"><h3>Jak zagrać</h3><p className="muted small">Wejdź do stołu, żeby go obejrzeć, wybierz karty i usiądź. Rozdanie zaczyna się samo, gdy przy stole są co najmniej dwie osoby z kartami.</p></div>}
      </div>
    </div>
  );
}

export function Poker() {
  useGame();
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) { started.current = true; poll(); }
    const vis = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
  }, []);
  dropMissing(P.sel);
  return P.tid != null ? <TableView /> : <LobbyView />;
}
