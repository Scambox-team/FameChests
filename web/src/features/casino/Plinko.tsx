import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { confetti, epicReveal } from '../../fx/effects';
import { announceFirsts, removeItems } from '../../game/actions';
import { plural } from '../../game/rules';
import { applyState } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import { fmt, sleep } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { CardPicker, SpecialHint, WonCards } from './parts';
import { addDuplicates, betOk, CS, csItems, csStake, dropMissing, isVabank, specialChance, togglePick } from './state';
import './plinko.css';

// Plinko: kulki spadają przez rzędy kołków do przegródek z mnożnikami. Drogi (lewo/prawo w każdym rzędzie) losuje SERWER
// (/api/casino/plinko, routes/casino.rs) - przeglądarka tylko je pokazuje. Jedno rzucenie może puścić kilka kulek naraz
// (stawka dzieli się po równo między kulki). Postawione karty zawsze przepadają, wraca stawka × średni mnożnik kulek
// (karty z kasyna + reszta w groszach).
interface PlinkoCfg { rows: number; risks: Record<string, number[]>; maxCards: number; maxBalls: number }
const RISKS: [string, string][] = [['low', 'Niskie'], ['mid', 'Średnie'], ['high', 'Wysokie']];
const BALLS = [1, 3, 5, 10, 20];
const VW = 560, VH = 520, TOP = 46, BOTTOM = 70;

/** mnożnik w dziesiątych (5 = ×0,5) albo setnych częściach (`hundredths`) */
const mult = (m: number, hundredths = false) => `×${(m / (hundredths ? 100 : 10)).toLocaleString('pl-PL', { maximumFractionDigits: hundredths ? 2 : 1 })}`;
/** kolor przegródki: od zielonego (zwrot części) po różowy (najwyższe mnożniki) */
function slotColor(m: number, max: number) {
  const t = Math.log(Math.max(m, 1)) / Math.log(Math.max(max, 2));
  return `hsl(${Math.round(150 - t * 190)}, 85%, ${Math.round(52 + t * 6)}%)`;
}

function geometry(rows: number) {
  const gap = (VW - 60) / (rows + 2), rowH = (VH - TOP - BOTTOM) / rows;
  const pegX = (r: number, i: number) => VW / 2 + (i - (r + 2) / 2) * gap;   // rząd r ma r + 3 kołki
  const pegY = (r: number) => TOP + r * rowH;
  const slotX = (k: number) => VW / 2 + (k - rows / 2) * gap;
  return { gap, rowH, pegX, pegY, slotX, slotY: TOP + rows * rowH + 6 };
}

interface Ball { path: number[]; slot: number; t0: number; seen?: number; landed?: boolean; jx: number }

export function Plinko() {
  const game = useGame();
  const PL = CS.pl, spinning = !!game.spinning;
  const { data: C } = useQuery({ queryKey: ['plinko-cfg'], queryFn: () => api<PlinkoCfg>('/api/casino/plinko'), staleTime: 300_000 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const balls = useRef<Ball[]>([]);
  /** przegródka -> chwila ostatniego trafienia (podskok i podświetlenie) */
  const hits = useRef<Map<number, number>>(new Map());
  const allDone = useRef<(() => void) | null>(null);
  const flashes = useRef<{ x: number; y: number; t: number }[]>([]);
  const [lit, setLit] = useState<Map<number, number>>(new Map());
  dropMissing(PL.sel);
  const stake = csStake(PL.sel), last = PL.last, maxCards = C?.maxCards ?? 10;
  const table = C?.risks[PL.risk] ?? [];
  const count = Math.min(PL.balls, C?.maxBalls ?? 20);

  // rysowanie planszy i kulek (pętla klatek, gdy strona jest otwarta)
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !C) return;
    const g = cv.getContext('2d')!, rows = C.rows, geo = geometry(rows);
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = VW * dpr; cv.height = VH * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const SEG = S.fast ? 0.07 : 0.14;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      g.clearRect(0, 0, VW, VH);
      const tbl = C.risks[CS.pl.risk] ?? [], max = Math.max(...tbl);
      // kołki
      for (let r = 0; r < rows; r++) for (let i = 0; i < r + 3; i++) {
        g.beginPath(); g.arc(geo.pegX(r, i), geo.pegY(r), 4, 0, Math.PI * 2);
        g.fillStyle = '#e2e8f0'; g.shadowColor = '#fff6'; g.shadowBlur = 6; g.fill();
      }
      g.shadowBlur = 0;
      for (let k = flashes.current.length - 1; k >= 0; k--) {
        const f = flashes.current[k], a = 1 - (now - f.t) / 350;
        if (a <= 0) { flashes.current.splice(k, 1); continue; }
        g.beginPath(); g.arc(f.x, f.y, 4 + (1 - a) * 10, 0, Math.PI * 2);
        g.fillStyle = `rgba(250,204,21,${a * 0.5})`; g.fill();
      }
      // przegródki: trafiona podskakuje i świeci przez chwilę
      const sw = geo.gap - 4;
      tbl.forEach((m, k) => {
        const hitAt = hits.current.get(k), age = hitAt === undefined ? 1 : Math.min(1, (now - hitAt) / 400);
        const bump = hitAt === undefined ? 0 : Math.sin(Math.PI * age) * 6, x = geo.slotX(k) - sw / 2, y = geo.slotY + bump;
        g.fillStyle = slotColor(m, max);
        g.globalAlpha = hitAt !== undefined ? 1 : 0.8;
        g.beginPath(); g.roundRect(x, y, sw, 30, 6); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = '#0b0b14'; g.font = `700 ${sw < 34 ? 10 : 12}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(mult(m).replace('×', ''), x + sw / 2, y + 15);
      });
      // kulki: odcinek 0 = spadek nad pierwszy kołek, odcinek k + 1 = odbicie od kołka w rzędzie k do następnego rzędu
      const segs = rows + 1;
      let falling = 0;
      for (const b of balls.current) {
        const t = (now - b.t0) / 1000 / SEG;
        if (t < 0) { falling++; continue; }   // jeszcze czeka na swoją kolej
        const s = Math.min(Math.floor(t), segs), f = Math.min(t - s, 1);
        // przesunięcie kulki po k rzędach: (2 * odbicia w prawo - k) * gap / 2
        const offAt = (k: number) => { let rr = 0; for (let j = 0; j < k; j++) rr += b.path[j] ?? 0; return (2 * rr - k) * geo.gap / 2; };
        const yAt = (k: number) => k < rows ? geo.pegY(k) - 9 : geo.slotY + 12;
        let x: number, y: number;
        if (s >= segs) {
          if (!b.landed) { b.landed = true; hits.current.set(b.slot, now); Sound.tick(1); }
          continue;   // kulka wpadła do przegródki i znika
        }
        falling++;
        if (s === 0) { x = VW / 2 + b.jx; y = TOP - 34 + (yAt(0) - TOP + 34) * f * f; }
        else {
          const k = s - 1, x0 = VW / 2 + offAt(k) + (k === 0 ? b.jx * (1 - f) : 0), x1 = VW / 2 + offAt(k + 1);
          x = x0 + (x1 - x0) * f;
          y = yAt(k) + (yAt(k + 1) - yAt(k)) * f * f - Math.sin(Math.PI * f) * geo.rowH * 0.35;
          if (b.seen !== s) {
            b.seen = s;
            flashes.current.push({ x: VW / 2 + offAt(k), y: geo.pegY(k), t: now });
            if (balls.current.length < 6 || Math.random() < 0.25) Sound.tick(k / rows);   // przy wielu kulkach rzadziej, żeby nie trzeszczało
          }
        }
        g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2);
        const gr = g.createRadialGradient(x - 3, y - 3, 1, x, y, 8);
        gr.addColorStop(0, '#fff7c2'); gr.addColorStop(1, '#f59e0b');
        g.fillStyle = gr; g.shadowColor = '#facc15'; g.shadowBlur = 16; g.fill(); g.shadowBlur = 0;
      }
      if (!falling && balls.current.length && allDone.current) { const d = allDone.current; allDone.current = null; d(); }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [C]);

  const drop = async () => {
    if (S.spinning || !PL.sel.size || !C) return;
    const ids = [...PL.sel];
    if (!betOk(ids, stake, maxCards, `Postawić ${ids.length} ${plural(ids.length, 'kartę', 'karty', 'kart')} o wartości ${fmt(stake)}?`)) return;
    S.spinning = true;
    touch();
    Sound.unlock();
    let res: any;
    try { res = await api('/api/casino/plinko', { ids, vabank: isVabank(ids.length, maxCards), risk: PL.risk, balls: count }); }
    catch (e: any) { S.spinning = false; Sound.error(); toast(e.message, true); return touch(); }
    Sound.click();
    // kulki wypadają jedna po drugiej, z lekkim przesunięciem w poziomie
    const now = performance.now(), gapMs = S.fast ? 70 : Math.max(90, 260 - res.paths.length * 9);
    hits.current = new Map();
    await new Promise<void>(done => {
      allDone.current = done;
      balls.current = res.paths.map((path: number[], i: number) => ({ path, slot: res.slots[i], t0: now + i * gapMs, jx: (Math.random() - 0.5) * 14 }));
    });
    // ile kulek wpadło do której przegródki (podświetlenie w tabeli mnożników)
    const per = new Map<number, number>();
    res.slots.forEach((s: number) => per.set(s, (per.get(s) ?? 0) + 1));
    setLit(per);
    // postawione karty przepadają, a wygrane (stawka × średni mnożnik) trafiają do ekwipunku
    removeItems(res.consumed);
    PL.sel.clear();
    if (res.items?.length) { S.items = [...res.items.slice().reverse(), ...S.items]; res.items.forEach((i: any) => S.collected.add(`${i.person}|${i.variant}`)); }
    if (res.special) { S.items = [res.special, ...S.items]; S.collected.add(`${res.special.person}|${res.special.variant}`); }
    CS.lost = !res.win;
    PL.last = res;
    PL.history = [{ avg: res.avg, n: res.paths.length, win: res.win }, ...PL.history].slice(0, 16);
    if (res.avg >= 500) { Sound.jackpot(); confetti(['#ffcf3f', '#ff3b5c', '#fff', '#3ddc84'], 220); }
    else if (res.win) { Sound.win(); confetti(['#ffcf3f', '#3ddc84', '#fff'], 90); }
    else Sound.fail();
    applyState(res.state);
    if (res.special) {
      await sleep(S.fast ? 300 : 700);
      await epicReveal(res.special, { fast: !!S.fast });
      announceFirsts([res.special]);
    }
    S.spinning = false;
    touch();
  };

  const best = last ? Math.max(...last.mults) : 0;
  return (
    <div className="rl-cols pl-cols">
      <div className="panel rl-left pl-left">
        <div className={`pl-board${spinning ? ' busy' : ''}`}>
          <canvas ref={canvas} className="pl-canvas" aria-label="Plansza Plinko" />
          {!C && <span className="pl-wait muted">Wczytuję</span>}
        </div>
        <div className="pl-risk" role="radiogroup" aria-label="Ryzyko">
          {RISKS.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={PL.risk === id} className={PL.risk === id ? 'on' : ''} disabled={spinning}
            onClick={() => { PL.risk = id; setLit(new Map()); hits.current = new Map(); Sound.click(); touch(); }}>{label}</button>)}
        </div>
        <div className="pl-risk pl-balls" role="radiogroup" aria-label="Liczba kulek">
          <span className="muted small">Kulki</span>
          {BALLS.filter(n => n <= (C?.maxBalls ?? 20)).map(n => <button key={n} type="button" role="radio" aria-checked={count === n} className={count === n ? 'on' : ''} disabled={spinning}
            onClick={() => { PL.balls = n; Sound.click(); touch(); }}>{n}</button>)}
        </div>
        <Button kind="hue" className="pl-drop" disabled={spinning || !PL.sel.size || !C} onClick={drop}>
          {PL.sel.size ? `${count > 1 ? `Puść ${count} kulek` : 'Puść kulkę'} · ${fmt(stake)}` : 'Wybierz karty na stawkę'}
        </Button>
        {count > 1 && stake > 0 && <span className="muted small">Każda kulka niesie {fmt(Math.floor(stake / count))} stawki ({`1/${count}`}).</span>}
        <div className="rl-result">
          {last ? <>
            <div className={`rl-res ${last.win ? 'win' : 'lose'}`}>
              <span className="pl-big">{mult(last.avg, true)}</span>
              <div>
                {last.mults.length > 1 && <small className="muted">średnio z {last.mults.length} kulek, najlepsza {mult(best)} · </small>}
                {last.payout ? <b className={last.win ? 'pos-txt' : ''}>Wraca {fmt(last.payout)} z {fmt(last.stake)}</b> : <b className="neg-txt">Przegrana: −{fmt(last.stake)}</b>}
              </div>
            </div>
            {last.items?.length > 0 && <WonCards r={last} />}
          </> : <span className="muted">Postaw karty, wybierz ryzyko i liczbę kulek, i puść.</span>}
        </div>
        <div className="rl-history">{PL.history.length ? PL.history.map((h, i) => <span key={i} className={`pl-h${h.win ? ' win' : ''}`} title={h.n > 1 ? `${h.n} kulek` : undefined}>{mult(h.avg, true)}{h.n > 1 ? ` ·${h.n}` : ''}</span>) : <span className="muted small">Tu pojawią się ostatnie wyniki</span>}</div>
      </div>
      <div className="rl-right">
        <div className="panel">
          <h3 className="sl-title">Mnożniki <small className="muted">{RISKS.find(r => r[0] === PL.risk)?.[1]} ryzyko</small></h3>
          <div className="pl-table">
            {table.map((m, k) => <span key={k} className={lit.has(k) ? 'lit' : ''} style={{ background: slotColor(m, Math.max(...table)) }}>{mult(m)}{(lit.get(k) ?? 0) > 1 && <i>{lit.get(k)}×</i>}</span>)}
          </div>
          {stake > 0 && <div className="rl-bet-info"><SpecialHint chance={specialChance(stake)} /></div>}
          <p className="muted small">Kulka w każdym rzędzie odbija się w lewo albo w prawo (drogi losuje serwer). Postawione karty przepadają, a wraca stawka × mnożnik przegródki: losowe karty o tej wartości i reszta w groszach. ×0,5 to zwrot połowy stawki. Przy kilku kulkach stawka dzieli się między nie po równo, więc wraca stawka × średni mnożnik.</p>
        </div>
        <CardPicker set={PL.sel} zone="pl" max={maxCards} q={PL.q} disabled={spinning} onQ={q => { PL.q = q; touch(); }} onPick={id => togglePick(PL.sel, id, maxCards)}
          onDupes={() => { const ids = addDuplicates([...PL.sel], maxCards, 'pl'); if (ids) { PL.sel = new Set(ids); Sound.click(); touch(); } }}
          onVabank={() => { PL.sel = new Set(csItems().map(i => i.id)); Sound.click(); touch(); }} onClear={() => { PL.sel.clear(); touch(); }} />
      </div>
    </div>
  );
}
