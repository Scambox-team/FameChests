import { useEffect, useRef, useState } from 'react';
import type { SlotsScene } from '../../three/slotsScene';
import { use3D } from '../../three/support';
import { Bell, Cherry, Citrus, Gem, Star, type LucideIcon } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api } from '../../api/client';
import { confetti, epicReveal } from '../../fx/effects';
import { announceFirsts } from '../../game/actions';
import { plural } from '../../game/rules';
import { applyState } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import { fmt, sleep } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import { CardPicker, SpecialHint, WonCards } from './parts';
import { addDuplicates, betOk, CS, csItems, csStake, dropMissing, isVabank, settleRound, specialChance, togglePick } from './state';

// Trzy bębny, liczy się środkowy rząd. Grę zaczyna tylko pociągnięcie dźwigni w dół (przeciąganie albo strzałka w dół).
const ROWS = 3, STRIP = 34, TRAVEL = 110, PULL = .75;
const ICONS: Record<string, LucideIcon> = { cherry: Cherry, lemon: Citrus, bell: Bell, star: Star, diamond: Gem };

const symHTML = (() => {
  const cache: Record<string, string> = {};
  return (id: string) => cache[id] ??= `<i class="sl-sym sl-${id}">${ICONS[id] ? renderToStaticMarkup(<span className="sl-ic">{(() => { const I = ICONS[id]; return <I size="1em" strokeWidth={1.8} />; })()}</span>) : '7'}</i>`;
})();

// kolory symboli jak w casino-theme.css (.sl-cherry itd.)
const COLORS: Record<string, string> = { cherry: '#e5484d', lemon: '#f5c518', bell: '#e5a93b', star: '#ffd76a', diamond: '#55c7ff', seven: '#ff5cf0' };
const hueNow = () => getComputedStyle(document.documentElement).getPropertyValue('--hue').trim() || '#e0264a';

/** Automat 3D (Three.js wczytuje się dopiero tutaj); bez WebGL zostaje płaski automat z DOM-u */
function useMachine3d(canvas: React.RefObject<HTMLCanvasElement | null>) {
  const scene = useRef<SlotsScene | null>(null);
  const [state, setState] = useState<'load' | '3d' | 'flat'>(() => use3D() ? 'load' : 'flat');
  useEffect(() => {
    if (!use3D()) return;
    let alive = true;
    const syms = S.cfg.slots.symbols.map((s: any) => {
      const I = ICONS[s.id];
      return { id: s.id, color: COLORS[s.id] ?? '#fff', svg: I ? renderToStaticMarkup(<I size={176} color={COLORS[s.id]} strokeWidth={1.7} xmlns="http://www.w3.org/2000/svg" />) : undefined };
    });
    const weights = Object.fromEntries(S.cfg.slots.symbols.map((s: any) => [s.id, s.weight]));
    import('../../three/slotsScene').then(({ createSlotsScene }) => {
      if (!alive || !canvas.current) return;
      return createSlotsScene(canvas.current, syms, weights, hueNow()).then(sc => {
        if (!alive) return sc.destroy();
        scene.current = sc;
        setState('3d');
      });
    }).catch(() => { if (alive) setState('flat'); });
    return () => { alive = false; scene.current?.destroy(); scene.current = null; };
  }, []);
  return { scene, state };
}

function Sym({ id }: { id: string }) {
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: symHTML(id) }} />;
}

function random() {
  const syms = S.cfg.slots.symbols, sum = syms.reduce((a: number, s: any) => a + s.weight, 0);
  let r = Math.random() * sum;
  for (const s of syms) if ((r -= s.weight) < 0) return s.id as string;
  return syms[0].id as string;
}
function strip(result: string, len = STRIP) {
  const ids = Array.from({ length: len }, random);
  ids[len - 2] = result;
  return ids;
}

export function Slots() {
  const game = useGame();
  const SL = CS.sl, C = game.cfg.slots, spinning = !!game.spinning;
  const machine = useRef<HTMLDivElement>(null);
  const strips = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const canvas = useRef<HTMLCanvasElement>(null);
  const { scene, state } = useMachine3d(canvas);
  useEffect(() => { scene.current?.setHue(hueNow()); scene.current?.setArmed(SL.sel.size > 0 && !game.spinning); });
  dropMissing(SL.sel);
  SL.reels ||= [0, 1, 2].map(() => strip(random(), ROWS));
  const stake = csStake(SL.sel), last = SL.last, armed = SL.sel.size > 0 && !spinning;

  const spinFlat = async (full: string[][], fast: boolean) => {
    const els = strips.map(s => s.current!);
    els.forEach((el, k) => { el.innerHTML = full[k].map(symHTML).join(''); });
    const symH = els[0].firstElementChild!.getBoundingClientRect().height, endY = -(STRIP - ROWS) * symH;
    const durs = fast ? [700, 900, 1100] : [1500, 2100, 2700], t0 = performance.now();
    const ticks = [-1, -1, -1], stopped = [false, false, false];
    await new Promise<void>(done => {
      const frame = (now: number) => {
        let all = true;
        els.forEach((el, k) => {
          const t = Math.min(1, (now - t0) / durs[k]), e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1, y = endY * e;
          el.style.transform = `translateY(${y.toFixed(1)}px)`;
          const sym = Math.floor(-y / symH);
          if (sym !== ticks[k] && k === els.findIndex((_, i) => !stopped[i])) { ticks[k] = sym; Sound.tick(1 - t); }
          if (t >= 1 && !stopped[k]) { stopped[k] = true; el.parentElement!.classList.add('stop'); Sound.land('blue'); }
          if (t < 1) all = false;
        });
        if (all) done(); else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  };

  const spin = async () => {
    if (S.spinning || !SL.sel.size || (state === 'load' && !scene.current)) { scene.current?.setPull(0); return; }
    const ids = [...SL.sel];
    if (!betOk(ids, stake, C.maxCards, `Postawić ${ids.length} ${plural(ids.length, 'kartę', 'karty', 'kart')} o wartości ${fmt(stake)}?`)) { scene.current?.setPull(0); return; }
    S.spinning = true;
    touch();
    Sound.unlock();
    let res: any;
    try { res = await api('/api/casino/slots', { ids, vabank: isVabank(ids.length, C.maxCards) }); }
    catch (e: any) { S.spinning = false; scene.current?.setPull(0); Sound.error(); toast(e.message, true); return touch(); }
    const fast = !!S.fast, full: string[][] = res.reels.map((r: string) => strip(r));
    if (scene.current) await scene.current.spin(res.reels, { fast, onTick: (_, k) => Sound.tick(k), onStop: () => Sound.land('blue') });
    else await spinFlat(full, fast);
    SL.last = res;
    SL.history = [{ reels: res.reels, win: res.win }, ...SL.history].slice(0, 12);
    SL.reels = full.map(x => x.slice(-ROWS));
    settleRound(res, SL.sel);
    if (res.win) {
      if (res.pays >= 14) Sound.jackpot(); else Sound.win();
      machine.current?.classList.add('won');
      scene.current?.win(res.pays);
      confetti(['#ffcf3f', '#ff3b5c', '#fff', '#3ddc84'], res.pays >= 14 ? 240 : 110);
    } else Sound.fail();
    applyState(res.state);
    if (res.special) {
      await sleep(fast ? 300 : 700);
      await epicReveal(res.special, { fast });
      announceFirsts([res.special]);
    }
    await sleep(fast ? 150 : 500);
    S.spinning = false;
    scene.current?.win(null);
    machine.current?.classList.remove('won');
    strips.forEach(s => { const el = s.current; if (el) { el.style.transform = ''; el.parentElement!.classList.remove('stop'); el.innerHTML = SL.reels![strips.indexOf(s)].map(symHTML).join(''); } });
    touch();
  };

  // dźwignia: chwyć kulkę i pociągnij w dół; puszczona za wysoko wraca na miejsce
  const grab = (e: React.PointerEvent<HTMLButtonElement>) => {
    const lever = e.currentTarget;
    if (S.spinning || lever.disabled) return;
    e.preventDefault();
    const y0 = e.clientY;
    let pull = 0;
    lever.setPointerCapture(e.pointerId);
    lever.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      pull = Math.max(0, Math.min(1, (ev.clientY - y0) / TRAVEL));
      lever.style.setProperty('--pull', pull.toFixed(3));
    };
    const up = () => {
      lever.removeEventListener('pointermove', move);
      lever.removeEventListener('pointerup', up);
      lever.removeEventListener('pointercancel', up);
      lever.classList.remove('dragging');
      lever.style.removeProperty('--pull');
      if (pull >= PULL) spin();
      else if (pull > .1) toast('Pociągnij dźwignię do samego dołu');
    };
    lever.addEventListener('pointermove', move);
    lever.addEventListener('pointerup', up);
    lever.addEventListener('pointercancel', up);
  };

  // dźwignia 3D: chwyć ją na scenie i pociągnij w dół
  const grab3d = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sc = scene.current, el = e.currentTarget;
    if (!sc || S.spinning || !armed || !sc.hitLever(e.clientX, e.clientY)) return;
    e.preventDefault();
    const y0 = e.clientY;
    let pull = 0;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const move = (ev: PointerEvent) => { pull = Math.max(0, Math.min(1, (ev.clientY - y0) / (TRAVEL * 1.4))); sc.setPull(pull); };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      if (pull >= PULL) { sc.setPull(1); Sound.click(); spin(); }
      else { sc.setPull(0); if (pull > .1) toast('Pociągnij dźwignię do samego dołu'); }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const hover3d = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons) return;
    e.currentTarget.classList.toggle('grab', !!scene.current && armed && scene.current.hitLever(e.clientX, e.clientY));
  };
  const lever = <button type="button" className={`sl-lever${armed ? ' ready' : ''}${state !== 'flat' ? ' sl-lever-sr' : ''}`} title="Chwyć kulkę i pociągnij dźwignię w dół" aria-label="Dźwignia automatu (strzałka w dół)" disabled={!armed} onPointerDown={grab} onKeyDown={e => { if (e.key === 'ArrowDown' && armed) { e.preventDefault(); scene.current?.setPull(1); spin(); } }}><i /><b /></button>;

  return (
    <div className="rl-cols">
      <div className="panel rl-left">
        {state === 'flat' ? <div ref={machine} className={`sl-machine${spinning ? ' spinning' : ''}`}>
          <div className="sl-top"><b>Jednoręki bandyta</b><span className="sl-bulbs" /></div>
          <div className="sl-window">
            {[0, 1, 2].map(k => <div key={k} className="sl-reel"><div className="sl-strip" ref={strips[k]} dangerouslySetInnerHTML={spinning ? undefined : { __html: SL.reels![k].slice(-ROWS).map(symHTML).join('') }} /></div>)}
            <i className="sl-line" />
          </div>
          {lever}
        </div> : <div className={`cs-stage sl-stage${spinning ? ' busy' : ''}${armed ? ' armed' : ''}`}>
          <canvas ref={canvas} aria-label="Automat do gry" onPointerDown={grab3d} onPointerMove={hover3d} />
          {armed && <span className="sl-pull-hint">Chwyć dźwignię i pociągnij w dół</span>}
          {lever}
        </div>}
        <div className="rl-result">
          {last ? <>
            <div className={`rl-res ${last.win ? 'win' : 'lose'}`}>
              <span className="sl-big">{last.reels.map((id: string, i: number) => <Sym key={i} id={id} />)}</span>
              <div>{last.win ? <b className="pos-txt">Wygrana ×{last.pays}: +{fmt(last.payout)}</b> : <b className="neg-txt">Przegrana: −{fmt(last.stake)}</b>}</div>
            </div>
            {last.win && <WonCards r={last} />}
          </> : <span className="muted">Postaw karty i pociągnij za dźwignię.</span>}
        </div>
        <div className="rl-history">{SL.history.length ? SL.history.map((h, i) => <span key={i} className={`sl-h ${h.win ? 'win' : ''}`}>{h.reels.map((id: string, k: number) => <Sym key={k} id={id} />)}</span>) : <span className="muted small">Tu pojawią się ostatnie wyniki</span>}</div>
      </div>
      <div className="rl-right">
        <div className="panel">
          <h3 className="sl-title">Wypłaty <small className="muted">środkowa linia</small></h3>
          <div className="sl-pays">
            {[...C.symbols].reverse().map((s: any) => <div key={s.id}><span><Sym id={s.id} /><Sym id={s.id} /><Sym id={s.id} /></span><b>×{s.pays}</b>{stake > 0 && <small>{fmt(stake * s.pays)}</small>}</div>)}
            <div><span><Sym id={C.pair} /><Sym id={C.pair} /><i className="sl-sym sl-any">?</i></span><b>×{C.pairPays}</b>{stake > 0 && <small>{fmt(stake * C.pairPays)}</small>}</div>
          </div>
          {stake > 0 && <div className="rl-bet-info"><SpecialHint chance={specialChance(stake)} /></div>}
          <div className={`sl-howto${SL.sel.size ? ' ready' : ''}`}>{SL.sel.size ? <>Pociągnij dźwignię w dół, żeby zagrać. Stawka <b>{fmt(stake)}</b></> : 'Wybierz karty na stawkę, potem pociągnij dźwignię automatu'}</div>
          <p className="muted small">Wygrana: twoje karty zostają, a dostajesz losowe karty o wartości stawki × mnożnik. Przegrana: postawione karty przepadają.</p>
        </div>
        <CardPicker set={SL.sel} zone="sl" max={C.maxCards} q={SL.q} disabled={spinning} onQ={q => { SL.q = q; touch(); }} onPick={id => togglePick(SL.sel, id, C.maxCards)}
          onDupes={() => { const ids = addDuplicates([...SL.sel], C.maxCards, 'sl'); if (ids) { SL.sel = new Set(ids); Sound.click(); touch(); } }}
          onVabank={() => { SL.sel = new Set(csItems().map(i => i.id)); Sound.click(); touch(); }} onClear={() => { SL.sel.clear(); touch(); }} />
      </div>
    </div>
  );
}
