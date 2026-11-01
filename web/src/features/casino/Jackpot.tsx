import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Lock, Globe, Trophy, X } from 'lucide-react';
import { api, net } from '../../api/client';
import { PickTile } from '../../cards/PickTile';
import { plural } from '../../game/rules';
import { applyState } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { timeAgo } from '../../lib/time';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Tabs } from '../../ui/Field';
import { toast } from '../../ui/Toaster';
import { Avatar, UserLink } from '../../ui/UserLink';
import { showJackpotResult } from './jackpotResult';
import { CardPicker } from './parts';
import { addDuplicates, CS, csItems, csPct, isVabank } from './state';

// Lobby dla dwóch graczy. Karty nie są blokowane: serwer sprawdza przy losowaniu, czy gracze nadal je mają.
const reveal = (c: any, id: number) => c.reveal ? { map: { [c.person]: c.reveal }, imgq: `jackpot=${id}` } : undefined;

function Cards({ t, side, max = 10, own, onRemove }: { t: any; side: 'a' | 'b'; max?: number; own?: boolean; onRemove?: (id: number) => void }) {
  const cards = t[side];
  if (!cards.length) return <div className="muted small jp-nocards">jeszcze bez kart</div>;
  return (
    <div className="jp-cards">
      {cards.slice(0, max).map((c: any) => <div key={c.id} className="jp-c" title={own ? 'Kliknij, aby zdjąć kartę' : undefined}><PickTile item={c} reveal={reveal(c, t.id)} onClick={own ? () => onRemove?.(c.id) : undefined} /></div>)}
      {cards.length > max && <span className="jp-more">+{cards.length - max}</span>}
    </div>
  );
}

function Odds({ a, b, nameA, nameB }: { a: number; b: number; nameA: string; nameB: string }) {
  const pa = a + b ? a / (a + b) : .5;
  return (
    <div className="jp-odds">
      <div className="jp-bar"><i className="jp-a" style={{ width: `${pa * 100}%` }} /><i className="jp-b" style={{ width: `${(1 - pa) * 100}%` }} /></div>
      <div className="jp-odds-txt"><span>{nameA} <b>{a + b ? csPct(pa) : 'brak'}</b></span><span><b>{a + b ? csPct(1 - pa) : 'brak'}</b> {nameB}</span></div>
    </div>
  );
}

function Room({ L, call, reload }: { L: any; call: (path: string, body?: any, ok?: string) => Promise<any>; reload: () => void }) {
  const me: 'a' | 'b' = L.side, opp = me === 'a' ? 'b' : 'a', creator = me === 'a';
  const ready = { a: L.readyA, b: L.readyB }, value = { a: L.valueA, b: L.valueB };
  const [invite, setInvite] = useState('');
  const max = S.cfg.jackpot.maxCards;
  const myIds: number[] = L[me].map((c: any) => c.id);

  const setCards = async (ids: number[]) => {
    if (CS.jp.busy) return;
    const res = await call(`/api/casino/jackpot/${L.id}/cards`, { ids, vabank: isVabank(ids.length, max) });
    if (res) Sound.click();
    touch();
  };
  const accept = async (on: boolean) => {
    if (CS.jp.busy) return;
    CS.jp.busy = true;
    net.inflight++; net.mutations++;
    let res: { status: number; body: any };
    try {   // własne zapytanie: przy 409 (karty zniknęły) serwer zwraca też poprawione lobby
      res = await fetch(`/api/casino/jackpot/${L.id}/ready`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ready: on }) })
        .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    } catch { res = { status: 0, body: { error: 'Błąd połączenia' } }; }
    finally { net.inflight--; CS.jp.busy = false; }
    const b = res.body;
    if (res.status === 409 && b.jackpot) { CS.jp.data.current = b.jackpot; Sound.error(); toast(b.error, true); return touch(); }
    if (res.status !== 200) { Sound.error(); toast(b.error || 'Błąd serwera', true); return reload(); }
    if (b.jackpot.status === 'done') {   // zaakceptowałem jako drugi: losowanie już się odbyło
      CS.jp.lastLobby = null;
      S.jpLobby = null;
      if (b.items) S.items = b.items;
      if (b.state) applyState(b.state);
      await showJackpotResult(b.jackpot);
      return reload();
    }
    CS.jp.data.current = b.jackpot;
    Sound.click();
    touch();
  };
  const seat = (side: 'a' | 'b') => {
    const u = side === 'a' ? L.creator : L.joiner;
    if (!u) return <div className="jp-seat empty"><div className="jp-seat-wait"><Clock size={16} aria-hidden="true" /> Czekamy na drugiego gracza</div><div className="muted small">{L.public ? 'Lobby jest publiczne, każdy może dołączyć.' : 'Lobby jest prywatne, dołączyć mogą tylko zaproszeni.'}</div></div>;
    return (
      <div className={`jp-seat jp-s${side}${side === me ? ' me' : ''}${ready[side] ? ' ready' : ''}`}>
        <div className="jp-seat-head"><Avatar user={u} /><b>{u.username}{side === me ? ' (ty)' : ''}</b>
          <span className="jp-ready-tag">{ready[side] ? 'Akceptuje' : 'Wybiera karty'}</span>
          {creator && side === 'b' && <Button onClick={() => { if (confirm('Wyprosić drugiego gracza z lobby?')) call(`/api/casino/jackpot/${L.id}/kick`, {}, 'Gracz wyproszony').then(() => touch()); }}>Wyproś</Button>}
        </div>
        <div className="jp-seat-val"><b>{fmt(value[side])}</b> · {L[side].length} {plural(L[side].length, 'karta', 'karty', 'kart')}</div>
        <Cards t={L} side={side} max={40} own={side === me} onRemove={id => setCards(myIds.filter(x => x !== id))} />
      </div>
    );
  };
  const canReady = L.joiner && L[me].length;
  const hint = !L.joiner ? 'Poczekaj, aż ktoś dołączy.' : !L[me].length ? 'Wybierz swoje karty poniżej.'
    : ready[opp] && !ready[me] ? 'Rywal już zaakceptował. Gdy ty zaakceptujesz, od razu losujemy.'
    : ready[me] && !ready[opp] ? 'Czekamy, aż rywal zaakceptuje.' : 'Gdy obaj zaakceptujecie, od razu losujemy zwycięzcę.';
  const leave = () => {
    if (!confirm(creator ? 'Zamknąć lobby?' : 'Opuścić lobby?')) return;
    CS.jp.lastLobby = null;
    S.jpLobby = null;
    call(`/api/casino/jackpot/${L.id}/leave`, {}).then(() => { CS.jp.data.current = null; reload(); });
  };
  const sendInvite = () => {
    const name = invite.trim();
    if (!name) return;
    call(`/api/casino/jackpot/${L.id}/settings`, { invite: name }, `Zaproszono: ${name}`).then(() => { setInvite(''); touch(); });
  };
  return (
    <div className="jp-room">
      <div className="panel jp-room-head">
        <div className="jp-room-title"><h3>Lobby #{L.id}</h3>
          <span className="mk-tag">{L.public ? <Globe size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />} {L.public ? 'Publiczne' : 'Prywatne'}</span>
          {creator && <Button onClick={() => call(`/api/casino/jackpot/${L.id}/settings`, { public: !L.public }, L.public ? 'Lobby jest teraz prywatne' : 'Lobby jest teraz publiczne').then(() => touch())}>{L.public ? 'Zmień na prywatne' : 'Zmień na publiczne'}</Button>}
          <Button onClick={leave}>{creator ? 'Zamknij lobby' : 'Opuść lobby'}</Button>
        </div>
        <div className="jp-invites">Zaproszeni: {L.invites.length ? L.invites.map((u: any) => <span key={u.id} className="jp-inv">{u.username}{creator && <button type="button" aria-label="Usuń zaproszenie" onClick={() => call(`/api/casino/jackpot/${L.id}/settings`, { uninvite: u.id }).then(() => touch())}><X size={12} /></button>}</span>) : <span className="muted small">nikt</span>}
          {creator && <span className="jp-inv-add"><input type="text" value={invite} placeholder="nick gracza" aria-label="Nick gracza" onChange={e => setInvite(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendInvite(); } }} /><Button onClick={sendInvite}>Zaproś</Button></span>}
        </div>
      </div>
      <div className="jp-seats">{seat('a')}<div className="jp-vs-big">vs</div>{seat('b')}</div>
      <Odds a={L.valueA} b={L.valueB} nameA={L.creator?.username || '?'} nameB={L.joiner?.username || '?'} />
      <div className="cs-btns"><Button kind="hue" big disabled={!ready[me] && !canReady} onClick={() => accept(!ready[me])}>{ready[me] ? 'Cofnij akceptację' : 'Akceptuję, gramy'}</Button></div>
      <p className="muted small jp-hint">{hint} Zmiana kart cofa akceptację obu graczy. Zwycięzca bierze wszystkie karty z lobby.</p>
      <h3>Twoje karty <small className="muted">kliknij, aby dodać do lobby albo zdjąć</small></h3>
      <CardPicker set={new Set(myIds)} zone="jp" max={max} q={CS.jp.q} onQ={q => { CS.jp.q = q; touch(); }}
        onPick={id => {
          if (myIds.includes(id)) return setCards(myIds.filter(x => x !== id));
          if (myIds.length >= max) { Sound.error(); return toast(`Najwyżej ${max} kart`, true); }
          setCards([...myIds, id]);
        }}
        onDupes={() => { const ids = addDuplicates(myIds, max, 'jp'); if (ids) setCards(ids); }}
        onVabank={() => setCards(csItems().map(i => i.id))} onClear={() => setCards([])} />
    </div>
  );
}

function Lobby({ t, onJoin }: { t: any; onJoin: (id: number) => void }) {
  return (
    <div className={`jp-table${t.invited ? ' invite' : ''}`}>
      <div className="jp-head">{t.creator && <UserLink user={t.creator} />}
        <span className="mk-tag">{t.public ? 'publiczne' : 'prywatne'}</span>
        {t.invited && <span className="mk-tag lead">zaproszenie dla ciebie</span>}
        <span className="muted small">{t.joiner ? '2/2' : '1/2'}</span>
        <span className="muted small">{timeAgo(t.created)}</span></div>
      {t.a.length ? <><div className="small">stawia <b>{fmt(t.valueA)}</b></div><Cards t={t} side="a" max={8} /></> : <div className="muted small">jeszcze nie wybrał kart</div>}
      <div className="mk-actions">{t.joiner ? <span className="muted small">Lobby pełne</span> : <Button kind="hue" onClick={() => onJoin(t.id)}>Dołącz</Button>}</div>
    </div>
  );
}

function Recent({ t }: { t: any }) {
  const pa = t.valueA / ((t.valueA + t.valueB) || 1), win = t.winner === 'a' ? t.creator : t.joiner;
  return (
    <div className={`jp-recent${t.side ? ' mine' : ''}`}>
      <span>{t.creator && <UserLink user={t.creator} />} <small className="muted">{fmt(t.valueA)} · {csPct(pa)}</small></span>
      <span className="jp-vs">vs</span>
      <span>{t.joiner && <UserLink user={t.joiner} />} <small className="muted">{fmt(t.valueB)} · {csPct(1 - pa)}</small></span>
      <span className="jp-win"><Trophy size={14} aria-hidden="true" /> {win?.username || '?'} · {fmt(t.valueA + t.valueB)}</span>
      <span className="muted small">{timeAgo(t.finished)}</span>
    </div>
  );
}

export function Jackpot() {
  useGame();
  const jp = CS.jp;
  const alive = useRef(true);

  const reload = useCallback(async (quiet = false) => {
    let data: any;
    try { data = await api('/api/casino/jackpot'); }
    catch (e: any) { if (!quiet) toast(e.message, true); return; }
    if (!alive.current) return;
    // lobby, w którym byłem, już się skończyło: wynik gry albo zamknięte / wyproszony
    const prev = jp.lastLobby, cur = data.current;
    if (prev && cur?.id !== prev) {
      const old = data.mine.find((t: any) => t.id === prev);
      if (old?.status === 'done') showJackpotResult(old);
      else if (old?.status === 'cancelled') toast('Założyciel zamknął lobby');
      else if (old?.status === 'expired') toast('Lobby zamknęło się po długim czasie bez ruchu');
      else if (!old) toast('Założyciel wyprosił cię z lobby');
    }
    jp.lastLobby = cur?.id || null;
    S.jpLobby = jp.lastLobby;
    jp.data = data;
    // przerysowanie tylko po zmianie i nie w trakcie pisania, inaczej wybór kart by migał
    const sig = JSON.stringify([data.current, data.lobbies.map((l: any) => [l.id, l.joiner?.id, l.valueA, l.public]), data.recent.map((t: any) => t.id)]);
    if (!quiet || (sig !== jp.sig && !document.querySelector('.rl-cols input:focus, .jp-room input:focus'))) { jp.sig = sig; touch(); }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(async () => {   // w lobby co 2 s (akceptacje, karty rywala, wynik), poza lobby co 8 s
        if (!document.hidden && !document.querySelector('.jp-anim') && !jp.busy) await reload(true);
        if (alive.current) tick();
      }, jp.lastLobby ? 2000 : 8000);
    };
    tick();
    return () => { alive.current = false; clearTimeout(timer); };
  }, [reload]);

  const call = useCallback(async (path: string, body: any = {}, ok?: string) => {
    jp.busy = true;
    try {
      const res = await api(path, body);
      if (res.jackpot?.status === 'open' && jp.data) { jp.data.current = res.jackpot; jp.lastLobby = res.jackpot.id; S.jpLobby = jp.lastLobby; }
      if (ok) toast(ok);
      return res;
    } catch (e: any) { Sound.error(); toast(e.message, true); return null; }
    finally { jp.busy = false; }
  }, []);

  const d = jp.data;
  if (!d) return <div className="panel muted">Ładowanie lobby</div>;
  if (d.current) return <Room L={d.current} call={call} reload={() => reload()} />;
  const lobbies = [...d.lobbies].sort((a, b) => (b.invited - a.invited) || (Number(!!a.joiner) - Number(!!b.joiner)) || b.id - a.id);
  const create = async () => {
    const res = await call('/api/casino/jackpot', { public: jp.newPublic, invites: jp.newInvites });
    if (res) { jp.newInvites = ''; Sound.click(); toast('Lobby gotowe, wybierz karty'); }
    reload();
  };
  return (
    <div className="jp-cols">
      <div className="panel jp-left">
        <h3>Nowe lobby</h3>
        <p className="muted small">Załóż lobby i zaproś graczy. W lobby obaj wybieracie karty, a gdy obaj zaakceptujecie, losujemy zwycięzcę. Szansa = wartość twoich kart / wartość wszystkich kart. Zwycięzca bierze wszystkie karty.</p>
        <Tabs label="Widoczność" value={jp.newPublic ? 'pub' : 'priv'} onChange={v => { jp.newPublic = v === 'pub'; Sound.click(); touch(); }} items={[{ id: 'pub', label: 'Publiczne' }, { id: 'priv', label: 'Prywatne' }]} />
        <p className="muted small">{jp.newPublic ? 'Każdy może dołączyć.' : 'Dołączyć mogą tylko zaproszeni.'} Możesz to zmienić później w lobby.</p>
        <label className="jp-invite">Zaproś graczy (nicki, oddzielone przecinkami)<input type="text" value={jp.newInvites} placeholder="np. ala, bartek" onChange={e => { jp.newInvites = e.target.value; touch(); }} /></label>
        <div className="cs-btns"><Button kind="hue" big onClick={create}>Utwórz lobby</Button></div>
      </div>
      <div className="jp-right">
        <div className="panel"><h3>Lobby ({lobbies.length})</h3>{lobbies.length ? lobbies.map(t => <Lobby key={t.id} t={t} onJoin={id => call(`/api/casino/jackpot/${id}/join`, {}, 'Dołączyłeś do lobby, wybierz karty').then(() => reload())} />) : <p className="muted">Nie ma otwartych lobby. Załóż własne.</p>}</div>
        <div className="panel"><h3>Ostatnie gry</h3>{d.recent.length ? d.recent.map((t: any) => <Recent key={t.id} t={t} />) : <p className="muted">Jeszcze nikt nie grał.</p>}</div>
      </div>
    </div>
  );
}
