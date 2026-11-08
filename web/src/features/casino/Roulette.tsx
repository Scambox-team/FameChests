import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Minus, Plus, RotateCcw, Square } from 'lucide-react';
import { PickTile } from '../../cards/PickTile';
import type { RouletteScene } from '../../three/rouletteScene';
import { use3D } from '../../three/support';
import { api } from '../../api/client';
import { announceFirsts } from '../../game/actions';
import { confetti, epicReveal } from '../../fx/effects';
import { plural, rand } from '../../game/rules';
import { applyState } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import { fmt, sleep } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import { CardPicker, SpecialHint, WonCards } from './parts';
import { addDuplicates, betOk, CS, csItems, csPct, csStake, dropMissing, isVabank, settleRound, specialChance, togglePick } from './state';

const color = (n: number) => n === 0 ? 'green' : S.cfg.roulette.red.includes(n) ? 'red' : 'black';

function Wheel() {
  const svg = useMemo(() => {
    const W: number[] = S.cfg.roulette.wheel, step = 360 / W.length, rad = (a: number) => a * Math.PI / 180;
    const pt = (r: number, a: number) => `${(150 + r * Math.sin(rad(a))).toFixed(2)} ${(150 - r * Math.cos(rad(a))).toFixed(2)}`;
    const fills: Record<string, string> = { green: '#0f9d58', red: '#c62828', black: '#16181d' };
    const segs = W.map((n, i) => {
      const a0 = (i - .5) * step, a1 = (i + .5) * step;
      return `<path d="M ${pt(96, a0)} L ${pt(142, a0)} A 142 142 0 0 1 ${pt(142, a1)} L ${pt(96, a1)} A 96 96 0 0 0 ${pt(96, a0)} Z" fill="${fills[color(n)]}" stroke="#3a3a42" stroke-width=".8"/>
        <text x="150" y="24" transform="rotate(${i * step} 150 150)" text-anchor="middle" dominant-baseline="middle" class="rl-num">${n}</text>`;
    }).join('');
    return `<svg viewBox="0 0 300 300" class="rl-svg"><circle cx="150" cy="150" r="148" fill="#1f1f24" stroke="#4a4a52" stroke-width="3"/>${segs}<circle cx="150" cy="150" r="96" fill="#131316" stroke="#4a4a52" stroke-width="2"/><circle cx="150" cy="150" r="70" fill="#1f1f24"/>${[0, 45, 90, 135].map(a => `<rect x="146" y="88" width="8" height="124" rx="4" fill="#4a4a52" transform="rotate(${a} 150 150)"/>`).join('')}<circle cx="150" cy="150" r="14" fill="#b8b8c0"/></svg>`;
  }, []);
  return <div dangerouslySetInnerHTML={{ __html: svg }} style={{ display: 'contents' }} />;
}

function Board({ disabled }: { disabled: boolean }) {
  const bets = S.cfg.roulette.bets, hit = CS.last?.number;
  const cell = (key: string, label: string | number, cls: string, area: string) => {
    const nums: number[] = bets[key].numbers;
    return (
      <button key={key} type="button" className={`rl-cell ${cls}${CS.bet === key ? ' sel' : ''}${hit != null && nums.length === 1 && nums[0] === hit ? ' hit' : ''}`} style={{ gridArea: area }} disabled={disabled}
        onClick={() => { CS.bet = key; Sound.click(); touch(); }} title={`${bets[key].name}, wypłata ${bets[key].pays}:1`}>{label}</button>
    );
  };
  const cells = [cell('green', '0', 'c-green', '1 / 1 / 4 / 2')];
  for (let col = 0; col < 12; col++) for (let row = 0; row < 3; row++) {
    const n = col * 3 + (3 - row);
    cells.push(cell(`n${n}`, n, `c-${color(n)}`, `${row + 1} / ${col + 2}`));
  }
  cells.push(cell('col3', '2:1', 'c-out', '1 / 14'), cell('col2', '2:1', 'c-out', '2 / 14'), cell('col1', '2:1', 'c-out', '3 / 14'));
  cells.push(cell('dozen1', '1–12', 'c-out', '4 / 2 / 5 / 6'), cell('dozen2', '13–24', 'c-out', '4 / 6 / 5 / 10'), cell('dozen3', '25–36', 'c-out', '4 / 10 / 5 / 14'));
  ([['low', '1–18'], ['even', 'Parz.'], ['red', 'Czerw.'], ['black', 'Czarne'], ['odd', 'Nieparz.'], ['high', '19–36']] as [string, string][]).forEach(([k, l], i) => {
    cells.push(cell(k, l, `c-out${k === 'red' ? ' c-redbet' : k === 'black' ? ' c-blackbet' : ''}`, `5 / ${2 + i * 2} / 6 / ${4 + i * 2}`));
  });
  return <div className="rl-board">{cells}</div>;
}

// widok koła wybrany przez gracza (domyślnie 3D), zapamiętany w przeglądarce
const VIEW_KEY = 'rouletteView';
const savedView3d = () => { try { return localStorage.getItem(VIEW_KEY) !== '2d'; } catch { return true; } };

/** Koło 3D (Three.js wczytuje się dopiero tutaj); w widoku 2D albo bez WebGL płaskie koło z SVG */
function useWheel3d(canvas: React.RefObject<HTMLCanvasElement | null>, spot: React.RefObject<HTMLDivElement | null>, want3d: boolean) {
  const scene = useRef<RouletteScene | null>(null);
  const [failed, setFailed] = useState(false);
  const flat = failed || !want3d || !use3D();
  useEffect(() => {
    if (!want3d || !use3D()) return;
    let alive = true;
    import('../../three/rouletteScene').then(({ createRouletteScene }) => {
      if (!alive || !canvas.current) return;
      try {
        scene.current = createRouletteScene(canvas.current, S.cfg.roulette.wheel, S.cfg.roulette.red, () => spot.current?.getBoundingClientRect() ?? null);
        if (CS.last) scene.current.result(CS.last.win);
      } catch { setFailed(true); }
    }).catch(() => setFailed(true));
    return () => { alive = false; scene.current?.destroy(); scene.current = null; };
  }, [want3d]);
  // kamera gracza: przeciąganie obraca, kółko przybliża (na granicy zoomu strona przewija się dalej), dwuklik wraca do widoku
  useEffect(() => {
    const el = spot.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { if (scene.current?.zoom(Math.sign(e.deltaY) * .12)) e.preventDefault(); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [flat]);
  return { scene, flat };
}

function useOrbit(scene: React.RefObject<RouletteScene | null>) {
  return {
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (!scene.current || (e.target as HTMLElement).closest('button')) return;
      const el = e.currentTarget;
      let x = e.clientX, y = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const move = (ev: PointerEvent) => {
        scene.current?.orbit(-(ev.clientX - x) * .008, (ev.clientY - y) * .006);
        x = ev.clientX; y = ev.clientY;
      };
      const up = () => {
        el.classList.remove('dragging');
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    },
    onDoubleClick() { scene.current?.resetView(); }
  };
}

export function Roulette() {
  const game = useGame();
  const rot = useRef<HTMLDivElement>(null), ball = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), spot = useRef<HTMLDivElement>(null);
  const [view3d, setView3d] = useState(savedView3d);
  const { scene, flat } = useWheel3d(canvas, spot, view3d);
  const pickView = (v: boolean) => {
    if (S.spinning || v === view3d) return;
    try { localStorage.setItem(VIEW_KEY, v ? '3d' : '2d'); } catch { /* bez zapamiętania */ }
    Sound.click();
    setView3d(v);
  };
  const [picking, setPicking] = useState(false);
  const orbit = useOrbit(scene);
  dropMissing(CS.sel);
  const spinning = !!game.spinning, max = game.cfg.roulette.maxCards;
  const bet = game.cfg.roulette.bets[CS.bet], stake = csStake(CS.sel), last = CS.last;

  const spinFlat = async (number: number, fast: boolean) => {
    // koło kręci się w prawo, kulka w lewo; obie stają tak, że wylosowane pole jest pod wskaźnikiem u góry
    const W: number[] = S.cfg.roulette.wheel, step = 360 / W.length, idx = W.indexOf(number);
    const D = fast ? 1800 : 5200, turns = fast ? 3 : 6;
    const start = CS.angle, target = -idx * step + rand(-.3, .3) * step;
    const end = start + turns * 360 + ((((target - start) % 360) + 360) % 360);
    const t0 = performance.now();
    let lastPocket: number | null = null;
    await new Promise<void>(done => {
      const frame = (now: number) => {
        const t = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - t, 3.6), a = start + (end - start) * e;
        if (rot.current) rot.current.style.transform = `rotate(${a}deg)`;
        if (ball.current) ball.current.style.transform = `rotate(${-(1 - e) * 360 * (turns + 2)}deg)`;
        const pocket = Math.round(((-a % 360) + 360) % 360 / step);
        if (pocket !== lastPocket) { if (lastPocket != null) Sound.tick(1 - t); lastPocket = pocket; }
        if (t < 1) requestAnimationFrame(frame); else done();
      };
      requestAnimationFrame(frame);
    });
    CS.angle = end % 360;
  };

  const spin = async () => {
    if (S.spinning || !CS.sel.size) return;
    const ids = [...CS.sel];
    if (!betOk(ids, stake, max, `Postawić ${ids.length} ${plural(ids.length, 'kartę', 'karty', 'kart')} o wartości ${fmt(stake)} na „${bet.name}”?`)) return;
    S.spinning = true;
    touch();
    Sound.unlock();
    let res: any;
    try { res = await api('/api/casino/roulette', { ids, bet: CS.bet, vabank: isVabank(ids.length, max) }); }
    catch (e: any) { S.spinning = false; Sound.error(); toast(e.message, true); return touch(); }
    const fast = !!S.fast;
    if (scene.current) await scene.current.spin(res.number, { fast, onTick: k => Sound.tick(k) });
    else await spinFlat(res.number, fast);
    CS.history = [res.number, ...CS.history].slice(0, 14);
    CS.last = res;
    settleRound(res, CS.sel);
    scene.current?.result(res.win);
    if (res.win) { Sound.win(); confetti(['#0f9d58', '#ffcf3f', '#c62828', '#fff'], res.payout >= stake * 2 ? 220 : 110); } else Sound.fail();
    applyState(res.state);
    if (res.special) {
      await sleep(fast ? 300 : 700);
      await epicReveal(res.special, { fast });
      announceFirsts([res.special]);
    }
    S.spinning = false;
    touch();
  };

  return (
    <div className="rl-cols">
      <div className="panel rl-left">
        {use3D() && <div className="hr-view rl-view" role="group" aria-label="Widok koła">
          <button type="button" className={view3d ? 'on' : ''} aria-pressed={view3d} disabled={spinning} onClick={() => pickView(true)}><Box size={15} aria-hidden="true" />3D</button>
          <button type="button" className={view3d ? '' : 'on'} aria-pressed={!view3d} disabled={spinning} onClick={() => pickView(false)}><Square size={15} aria-hidden="true" />2D</button>
        </div>}
        {flat ? <div className="rl-wheel-wrap">
          <div className="rl-rot" ref={rot} style={{ transform: `rotate(${CS.angle}deg)` }}><Wheel /></div>
          <div className="rl-ball-rot" ref={ball}><i /></div>
          <div className="rl-pointer" />
        </div> : <div ref={spot} className={`rl-spot${last ? (last.win ? ' won' : ' lost') : ''}`} {...orbit} title="Przeciągnij, żeby obrócić koło. Kółko myszy przybliża, dwuklik wraca do widoku.">
          <div className="rl-bg"><canvas ref={canvas} aria-label="Koło ruletki" /></div>
          <div className="rl-cam" role="group" aria-label="Kamera">
            <button type="button" aria-label="Przybliż" onClick={() => scene.current?.zoom(-.18)}><Plus size={16} /></button>
            <button type="button" aria-label="Oddal" onClick={() => scene.current?.zoom(.18)}><Minus size={16} /></button>
            <button type="button" aria-label="Wróć do widoku" onClick={() => scene.current?.resetView()}><RotateCcw size={15} /></button>
          </div>
        </div>}
        <div className="rl-result">
          {last ? <>
            <div className={`rl-res ${last.win ? 'win' : 'lose'}`}>
              <span className={`rl-big c-${color(last.number)}`}>{last.number}</span>
              <div>{last.win ? <b className="pos-txt">Wygrana: +{fmt(last.payout)}</b> : <b className="neg-txt">Przegrana: −{fmt(last.stake)}</b>}</div>
            </div>
            {last.win && <WonCards r={last} />}
          </> : <span className="muted">Postaw karty, wybierz pole na stole i zakręć.</span>}
        </div>
        <div className="rl-history">{CS.history.length ? CS.history.map((n, i) => <span key={i} className={`rl-h c-${color(n)}`}>{n}</span>) : <span className="muted small">Tu pojawią się ostatnie wyniki</span>}</div>
      </div>
      <div className="rl-right">
        <div className="panel">
          <Board disabled={spinning} />
          <div className="rl-bet-info">
            <span>Zakład: <b>{bet.name}</b></span>
            <span>Wypłata: <b>{bet.pays}:1</b> (karty wracają + {fmt(stake * bet.pays)} w kartach)</span>
            <span>Szansa: <b>{csPct(bet.numbers.length / 37)}</b></span>
            {stake > 0 && <SpecialHint chance={specialChance(stake * bet.pays)} />}
          </div>
          <div className="rl-stake">
            <div className="rl-stake-head">
              <span>{CS.sel.size ? <>Postawione karty: <b>{isVabank(CS.sel.size, max) ? `VA BANK, ${CS.sel.size}` : `${CS.sel.size}/${max}`}</b> · {fmt(stake)}</> : <span className="muted">Nie wybrano jeszcze kart do postawienia.</span>}</span>
              <Button disabled={spinning} onClick={() => { Sound.click(); setPicking(true); }}><Plus size={16} aria-hidden="true" />Dodaj karty</Button>
            </div>
            {CS.sel.size > 0 && <div className="pick-grid rl-sel">
              {csItems().filter(i => CS.sel.has(i.id)).map(i => <PickTile key={i.id} item={i} selected onClick={spinning ? undefined : () => togglePick(CS.sel, i.id, max)} />)}
            </div>}
          </div>
          <Button kind="hue" big className="rl-spin" disabled={!CS.sel.size || spinning} onClick={spin}>Zakręć{stake ? `, stawka ${fmt(stake)}` : ''}</Button>
          <p className="muted small">Wygrana: twoje karty zostają, a dostajesz losowe karty o wartości stawki × wypłata (przy większych wygranych w droższych wariantach, końcówka w groszach). Przegrana: postawione karty przepadają.</p>
        </div>
      </div>
      {picking && (
        <Modal title="Dodaj karty do stawki" onClose={() => setPicking(false)} huge>
          <div className="rl-picker">
            <CardPicker set={CS.sel} zone="rl" max={max} q={CS.q} disabled={spinning}
              onQ={q => { CS.q = q; touch(); }}
              onPick={id => togglePick(CS.sel, id, max)}
              onDupes={() => { const ids = addDuplicates([...CS.sel], max, 'rl'); if (ids) { CS.sel = new Set(ids); Sound.click(); touch(); } }}
              onVabank={() => { CS.sel = new Set(csItems().map(i => i.id)); Sound.click(); touch(); }}
              onClear={() => { CS.sel.clear(); touch(); }} />
          </div>
          <Button kind="hue" big onClick={() => setPicking(false)}>Gotowe{CS.sel.size ? `, stawka ${fmt(stake)}` : ''}</Button>
        </Modal>
      )}
    </div>
  );
}
