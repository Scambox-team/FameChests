import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Figures } from './Figures';
import { Tabs } from '../../ui/Field';
import { useQuery } from '@tanstack/react-query';
import { Crown } from 'lucide-react';
import { PageHero } from '../../ui/PageHero';
import { api } from '../../api/client';
import { confetti } from '../../fx/effects';
import { S, touch, useGame } from '../../game/store';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Field';
import { toast } from '../../ui/Toaster';
import { SK, SK_PIECES, skDef, skinSvg, skLoad, skPreview } from './skins';

// Serwer zna zasady i zegar (server/src/chess.rs): tu rysujemy stan i wysyłamy ruchy.
// Partia z graczem jest odpytywana co 2 s, a w treningu odpowiedź bota przychodzi z ruchem.
const FILES = 'abcdefgh';
const BOTS: [number, string][] = [[1, 'Początkujący'], [2, 'Klubowy'], [3, 'Mistrz']];
const plainName = (s: string) => s.replace(/\p{Extended_Pictographic}️?\s*/gu, '');   // nazwa bota przychodzi z serwera z emotką
const CASTLE: Record<string, [string, string]> = { e1g1: ['h1', 'f1'], e1c1: ['a1', 'd1'], e8g8: ['h8', 'f8'], e8c8: ['a8', 'd8'] };
const pieceAt = (fen: string, sq: string) => squares(fen)[(8 - +sq[1]) * 8 + FILES.indexOf(sq[0])];
const html = (__html: string) => ({ dangerouslySetInnerHTML: { __html } });

const PinballPage = lazy(() => import('../pinball/PinballPage').then(m => ({ default: m.PinballPage })));

let openId: number | null = null;     // otwarta partia zostaje po wyjściu z ekranu
const rewarded = new Set<number>();   // nagrodę ogłaszamy raz

async function post(url: string, body: any = {}) {
  try { return await api(url, body); } catch (e: any) { toast(e.message, true); return null; }
}
function clockText(ms: number) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// FEN: tablica 64 pól od a8 do h1
function squares(fen: string) {
  const out: (string | null)[] = [];
  for (const c of fen.split(' ')[0].replaceAll('/', '')) {
    if (c >= '1' && c <= '8') out.push(...Array(+c).fill(null));
    else out.push(c);
  }
  return out;
}
const pieceHTML = (g: any, c: string) => {
  const white = c === c.toUpperCase(), p = c.toLowerCase(), skin = (white ? g.whiteSkins : g.blackSkins)?.[p];
  return `<span class="ch-pc ${white ? 'w' : 'b'}${skin ? ' sk' : ''}">${skinSvg(skin, p)}</span>`;
};

function endText(g: any) {
  if (g.result === 'draw') return `Remis: ${g.reason}`;
  if (!g.you) return `Wygrały ${g.result === 'white' ? 'białe' : 'czarne'}: ${g.reason}`;
  const mine = (g.result === 'white' && g.you === 'w') || (g.result === 'black' && g.you === 'b');
  return `${mine ? 'Wygrana' : 'Przegrana'}: ${g.reason}`;
}

function Player({ g, side }: { g: any; side: 'w' | 'b' }) {
  const p = side === 'w' ? g.white : g.black, on = g.status === 'active' && g.turn === side;
  return (
    <div className={`ch-player${on ? ' on' : ''}`}><span className="ch-who"><i className={`ch-dot ${side}`} />{plainName(p.name)}</span>
      {g.timed && <span className={`ch-clock${on ? ' on' : ''}`} data-chclock={side}>{clockText(side === 'w' ? g.whiteMs : g.blackMs)}</span>}</div>
  );
}

function Game({ id, onBack }: { id: number; onBack: () => void }) {
  const [g, setG] = useState<any>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [promo, setPromo] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = useRef({ g, busy });
  live.current = { g, busy };
  const list = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const seen = useRef<number | null>(null);   // ile półruchów już pokazaliśmy (dźwięk i animacja tylko dla nowych)
  const mineMoved = useRef('');   // ruch, który właśnie przesunęliśmy sami (nie animujemy go drugi raz)

  // nowy ruch: figura przesuwa się z poprzedniego pola (FLIP), roszada przesuwa też wieżę; dźwięk mocniejszy po ruchu rywala
  useLayoutEffect(() => {
    if (!g) return;
    const n = g.san.length;
    if (seen.current === null || n <= seen.current || !g.last) { seen.current = n; return; }
    seen.current = n;
    const glide = (from: string, to: string) => {
      const a = board.current?.querySelector<HTMLElement>(`[data-sq="${from}"]`), b = board.current?.querySelector<HTMLElement>(`[data-sq="${to}"]`);
      const pc = b?.querySelector<HTMLElement>('.ch-pc');
      if (!a || !b || !pc || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      pc.classList.remove('moving');
      pc.style.transform = `translate(${ra.left - rb.left}px, ${ra.top - rb.top}px)`;
      void pc.offsetWidth;
      pc.classList.add('moving');
      pc.style.transform = '';
      pc.addEventListener('transitionend', () => pc.classList.remove('moving'), { once: true });
    };
    const from = g.last.slice(0, 2), to = g.last.slice(2, 4);
    if (mineMoved.current === from + to) { mineMoved.current = ''; return; }   // mój ruch bez odpowiedzi bota: już przesunięty i zagrany
    mineMoved.current = '';
    glide(from, to);
    if (CASTLE[from + to] && g.san[n - 1]?.startsWith('O-O')) glide(...CASTLE[from + to]);
    const byMe = g.you && (n % 2 === 1 ? 'w' : 'b') === g.you;
    Sound.move(!!byMe);
  }, [g?.san.length]);

  useEffect(() => {
    let alive = true, poll: ReturnType<typeof setInterval>, tick: ReturnType<typeof setInterval>;
    (async () => {
      let d: any;
      try { d = await api(`/api/games/chess/${id}`); } catch (e: any) { toast(e.message, true); return onBack(); }
      if (!alive) return;
      setG(d);
      if (d.bot < 0) {   // partia testowa admina: serwer wykonuje kolejne ruchy z gotowego zapisu
        while (alive && d?.status === 'active') {
          await new Promise(r => setTimeout(r, 450));
          if (!alive) return;
          d = await post(`/api/games/chess/${id}/test-step`);
          if (d && alive) setG(d);
        }
        return;
      }
      poll = setInterval(async () => {
        const { g: cur, busy: wait } = live.current;
        if (wait || cur?.status === 'finished') return;
        try {
          const n = await api(`/api/games/chess/${id}`);
          if (!alive || live.current.busy) return;
          if (n.san.length !== cur.san.length) setSel(null);
          setG(n);
        } catch { /* serwer chwilowo niedostępny */ }
      }, 2000);
      tick = setInterval(() => {   // zegar idzie płynnie między odpowiedziami serwera
        const c = live.current.g;
        if (!c?.timed || c.status !== 'active') return;
        c[c.turn === 'w' ? 'whiteMs' : 'blackMs'] -= 250;
        document.querySelectorAll<HTMLElement>('[data-chclock]').forEach(e => { e.textContent = clockText(c[e.dataset.chclock === 'w' ? 'whiteMs' : 'blackMs']); });
      }, 250);
    })();
    return () => { alive = false; clearInterval(poll); clearInterval(tick); };
  }, [id]);

  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [g?.san.length]);
  useEffect(() => {
    if (g?.status !== 'finished' || !g.rewarded || rewarded.has(g.id)) return;
    rewarded.add(g.id);
    Sound.win();
    confetti(['#ffffff', '#111111', '#8a8a8a'], 140);
    api('/api/state').then(st => { S.chests = st.chests || S.chests; touch(); }).catch(() => {});
  }, [g?.status, g?.rewarded]);

  if (!g) return <p className="muted">Wczytuję partię</p>;

  // własny ruch: figura rusza od razu, a odpowiedź serwera (z ruchem bota) przychodzi w tym czasie
  const slide = (from: string, to: string) => new Promise<void>(done => {
    const a = board.current?.querySelector<HTMLElement>(`[data-sq="${from}"]`), b = board.current?.querySelector<HTMLElement>(`[data-sq="${to}"]`);
    const pc = a?.querySelector<HTMLElement>('.ch-pc');
    if (!a || !b || !pc || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    pc.classList.add('moving');
    pc.style.transform = `translate(${rb.left - ra.left}px, ${rb.top - ra.top}px)`;
    setTimeout(done, 270);
  });
  const move = async (uci: string) => {
    setSel(null); setPromo(null); setBusy(true);
    mineMoved.current = uci.slice(0, 4);
    Sound.move(true);
    try {
      const rook = CASTLE[uci.slice(0, 4)] && pieceAt(g.fen, uci.slice(0, 2))?.toLowerCase() === 'k' ? CASTLE[uci.slice(0, 4)] : null;
      const [res] = await Promise.all([api(`/api/games/chess/${id}/move`, { move: uci }), slide(uci.slice(0, 2), uci.slice(2, 4)), rook && slide(...rook)]);
      setG(res);
    } catch (e: any) { toast(e.message, true); mineMoved.current = ''; }
    board.current?.querySelectorAll<HTMLElement>('.ch-pc.moving').forEach(p => { p.classList.remove('moving'); p.style.transform = ''; });
    setBusy(false);
  };
  const click = (name: string) => {
    if (!g.legal?.length || busy || promo) return;
    if (sel && sel !== name) {
      const m = g.legal.filter((x: string) => x.startsWith(sel + name));
      if (m.length > 1) return setPromo(sel + name);
      if (m.length === 1) return void move(m[0]);
    }
    setSel(sel === name || !g.legal.some((x: string) => x.startsWith(name)) ? null : name);
  };
  const act = async (url: string, body?: any) => { const r = await post(url, body); if (r) setG(r); };

  const sq = squares(g.fen), bottomBlack = (g.you === 'b') !== flip;
  const order = [...Array(64).keys()];
  if (bottomBlack) order.reverse();
  const targets = new Set((g.legal || []).filter((m: string) => m.slice(0, 2) === sel).map((m: string) => m.slice(2, 4)));
  const last = g.last ? [g.last.slice(0, 2), g.last.slice(2, 4)] : [];
  const top = bottomBlack ? 'w' : 'b', bottom = top === 'w' ? 'b' : 'w';
  const playing = g.status === 'active' && g.you && g.bot >= 0;
  const status = g.status === 'finished' ? endText(g) : g.status === 'open' ? 'Czekam na rywala' : g.bot < 0 ? 'Partia testowa' : !g.you ? 'Oglądasz partię' : g.turn === g.you ? 'Twój ruch' : g.bot ? 'Bot myśli' : 'Ruch rywala';
  const moves: React.ReactNode[] = [];
  for (let i = 0; i < g.san.length; i += 2) moves.push(<div key={i} className="ch-mv"><i>{i / 2 + 1}.</i><b>{g.san[i]}</b><b>{g.san[i + 1] || ''}</b></div>);

  return (
    <div className="ch-game">
      <div className="ch-left">
        <div ref={board} className={`ch-board${busy ? ' wait' : ''}`}>
          {order.map(i => {
            const f = i % 8, r = 7 - Math.floor(i / 8), name = FILES[f] + (r + 1), c = sq[i];
            const cls = [(f + r) % 2 === 0 ? 'dk' : 'lt'];
            if (last.includes(name)) cls.push('last');
            if (name === sel) cls.push('sel');
            if (name === g.check) cls.push('check');
            if (targets.has(name)) cls.push(c ? 'take' : 'move');
            return (
              <div key={name} data-sq={name} className={`ch-sq ${cls.join(' ')}`} onPointerUp={() => click(name)}>
                {(bottomBlack ? r === 7 : r === 0) && <i className="ch-co f">{FILES[f]}</i>}
                {(bottomBlack ? f === 0 : f === 7) && <i className="ch-co r">{r + 1}</i>}
                {c && <span style={{ display: 'contents' }} {...html(pieceHTML(g, c))} />}
              </div>
            );
          })}
        </div>
      </div>
      <div className="ch-side panel">
        <Player g={g} side={top} />
        <div className="ch-status">{status}</div>
        {g.check && g.status === 'active' && <div className="ch-alert">Szach!</div>}
        {g.rewarded && <div className="ch-reward">Skrzynka daily i skrzynka {g.result === 'white' ? 'Białych' : 'Czarnych'} są w ekwipunku</div>}
        {g.drawOffer === 'them' && <div className="ch-offer">Rywal proponuje remis <Button kind="hue" onClick={() => act(`/api/games/chess/${id}/draw`, { action: 'accept' })}>Przyjmij</Button><Button onClick={() => act(`/api/games/chess/${id}/draw`, { action: 'decline' })}>Odrzuć</Button></div>}
        {g.drawOffer === 'me' && <div className="ch-offer muted">Czekasz na odpowiedź na propozycję remisu</div>}
        <div className="ch-moves" ref={list}>{moves.length ? moves : <p className="muted small">Jeszcze nie ma ruchów.</p>}</div>
        <div className="ch-btns">
          {playing && <>
            <Button onClick={() => { if (confirm('Na pewno chcesz się poddać?')) act(`/api/games/chess/${id}/resign`); }}>Poddaj się</Button>
            {!g.bot && !g.drawOffer && <Button onClick={() => act(`/api/games/chess/${id}/draw`, { action: 'offer' })}>Remis</Button>}
          </>}
          <Button onClick={() => setFlip(!flip)}>Obróć</Button>
          <Button onClick={onBack}>Lobby</Button>
        </div>
        <Player g={g} side={bottom} />
      </div>
      {promo && <div className="ch-promo"><div className="panel"><h3>Promocja piona</h3><div>
        {['q', 'r', 'b', 'n'].map(p => <button key={p} type="button" className="ch-pick" aria-label={SK_PIECES[p]} onClick={() => move(promo + p)}><span className={`ch-pc ${g.you}`} {...html(skinSvg((g.you === 'w' ? g.whiteSkins : g.blackSkins)?.[p], p))} /></button>)}
      </div></div></div>}
    </div>
  );
}

// co jest założone na każdej figurze
function SkinMenu({ onChange }: { onChange: () => void }) {
  const equip = async (piece: string, skin: string) => {
    try { SK.equipped = (await api('/api/games/chess/skins/equip', { piece, skin })).equipped; Sound.click(); }
    catch (e: any) { toast(e.message, true); }
    onChange();
  };
  return (
    <div className="panel"><h3>Twoje figury</h3><div className="sk-menu">
      {Object.keys(SK_PIECES).map(p => {
        const mine: string[] = [...new Set<string>(SK.owned.filter((o: any) => o.piece === p && skDef(o.skin)?.enabled !== false).map((o: any) => o.skin))], on = SK.equipped[p] || '';
        return (
          <label key={p} className="sk-slot">
            <span style={{ display: 'contents' }} {...html(skPreview(on, p))} /><span>{SK_PIECES[p]}</span>
            <Select value={on} disabled={!mine.length} onChange={e => equip(p, e.target.value)} aria-label={SK_PIECES[p]}>
              <option value="">Zwykła</option>
              {mine.map(id => <option key={id} value={id}>{skDef(id)?.name || id}</option>)}
            </Select>
          </label>
        );
      })}
    </div></div>
  );
}

function Lobby({ onOpen }: { onOpen: (id: number) => void }) {
  const { me } = useGame();
  const [minutes, setMinutes] = useState(10);
  const [invite, setInvite] = useState('');
  const [, redraw] = useState(0);
  const wasOpen = useRef<number | undefined>(undefined);
  const { data: d, error, refetch } = useQuery({
    queryKey: ['chess'],
    queryFn: async () => { const [lobby] = await Promise.all([api('/api/games/chess'), skLoad()]); return lobby; },
    refetchInterval: 4000
  });
  useEffect(() => {
    if (!d) return;
    if (wasOpen.current && d.active === wasOpen.current) onOpen(wasOpen.current);   // ktoś dołączył do mojej partii
    wasOpen.current = d.open.find((o: any) => o.mine)?.id;
  }, [d]);

  if (error) return <p className="muted">{error.message}</p>;
  if (!d) return <p className="muted">Wczytuję</p>;
  const mine = d.open.find((o: any) => o.mine), others = d.open.filter((o: any) => !o.mine);
  const start = async (url: string, body?: any) => { const r = await post(url, body); if (r) onOpen(r.id); };
  const create = async () => { if (await post('/api/games/chess/create', { minutes, invite })) { setInvite(''); refetch(); } };
  return (
    <div className="ch-lobby">
      <PageHero icon={Crown} title="Szachy" lead={<>Prawdziwe szachy: roszady, bicie w przelocie, promocje, mat, pat i remisy. Za wygraną z graczem dostajesz <b>skrzynkę daily</b> i <b>skrzynkę w kolorze, którym grałeś</b>: kartę w wariancie Biała albo Czarna oraz skin do figury. Kolor jest losowany przy starcie. Partia musi trwać co najmniej {d.minPlies} półruchów.</>}
        stats={[['Nagrody dziś', `${d.rewardsLeft} / ${d.rewardsPerDay}`]]} />
      {d.active && !mine && <div className="panel ch-resume"><b>Masz trwającą partię</b><Button kind="hue" onClick={() => onOpen(d.active)}>Wróć do gry</Button></div>}
      <div className="ch-grid">
        <div className="panel">
          <h3>Zagraj z graczem</h3>
          {mine ? <><p>Czekasz na rywala · {mine.minutes} min</p><Button onClick={async () => { await post(`/api/games/chess/${mine.id}/cancel`); refetch(); }}>Anuluj partię</Button></> : (
            <div className="ch-form">
              <label>Czas<Select value={minutes} onChange={e => setMinutes(+e.target.value)}>{d.minutes.map((m: number) => <option key={m} value={m}>{m} min + 2 s</option>)}</Select></label>
              <label className="wide">Zaproś gracza (puste = partia otwarta dla każdego)<input type="text" value={invite} maxLength={30} placeholder="nick" onChange={e => setInvite(e.target.value)} /></label>
              <Button kind="hue" className="wide" onClick={create}>Załóż partię</Button>
            </div>
          )}
        </div>
        <div className="panel">
          <h3>Trening z botem</h3>
          <p className="muted small">Bez zegara i bez nagród. Nowa partia zastępuje poprzednią.</p>
          <div className="ch-bots">{BOTS.map(([n, t]) => <Button key={n} onClick={() => start('/api/games/chess/create', { bot: n })}>{t}</Button>)}</div>
          {d.training && <Button onClick={() => onOpen(d.training)}>Dokończ trening</Button>}
          {me?.isAdmin && <Button title="Admin: partia rozgrywa się sama i wygrywasz ją matem. Daje prawdziwą nagrodę, bez limitu na dobę." onClick={() => start('/api/games/chess/test')}>Partia testowa</Button>}
        </div>
      </div>
      <SkinMenu onChange={() => redraw(n => n + 1)} />
      <div className="panel"><h3>Otwarte partie</h3>
        {others.length ? <div className="ch-list">{others.map((o: any) => <div key={o.id} className="ch-row"><span><b>{o.by}</b> · {o.minutes} min{o.invited && <> · <span className="pos-txt">zaproszenie dla ciebie</span></>}</span><Button kind="hue" onClick={() => start(`/api/games/chess/${o.id}/join`)}>Dołącz</Button></div>)}</div> : <p className="muted">Nikt teraz nie czeka. Załóż partię.</p>}
      </div>
      {d.history.length > 0 && <div className="panel"><h3>Ostatnie partie</h3><div className="ch-list">
        {d.history.map((h: any) => <div key={h.id} className="ch-row"><span>{h.outcome === 'win' ? 'Wygrana' : h.outcome === 'loss' ? 'Przegrana' : 'Remis'} · {h.rival} <small className="muted">{h.reason}</small></span>{h.rewarded && <small className="muted">nagroda</small>}<Button onClick={() => onOpen(h.id)}>Zobacz</Button></div>)}
      </div></div>}
    </div>
  );
}

export function ChessPage() {
  const [id, setId] = useState(openId);
  const { tab } = useParams();
  const navigate = useNavigate();
  const open = (n: number | null) => { openId = n; setId(n); };
  useEffect(() => { document.title = 'Gry · ScamBox'; }, []);
  const view = tab === 'figures' || tab === 'pinball' ? tab : 'games';
  if (id && view === 'games') return <div id="view-games"><Game key={id} id={id} onBack={() => open(null)} /></div>;
  return (
    <div id="view-games">
      <Tabs label="Gry" value={view} onChange={v => { Sound.click(); navigate(v === 'games' ? '/games' : `/games/${v}`); }}
        items={[{ id: 'games', label: 'Szachy' }, { id: 'figures', label: 'Figury' }, { id: 'pinball', label: 'Pinball' }]} />
      {view === 'figures' ? <Figures /> : view === 'pinball' ? <Suspense fallback={<p className="muted">Wczytuję</p>}><PinballPage /></Suspense> : <Lobby onOpen={open} />}
    </div>
  );
}
