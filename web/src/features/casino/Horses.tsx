import { useEffect, useRef, useState } from 'react';
import { Box, Car, CircleX, Skull, Square, Trophy, Wrench } from 'lucide-react';
import { Horses3D } from './Horses3D';
import { use3D } from '../../three/support';
import { plural } from '../../game/rules';
import { touch, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { CardPicker, SpecialHint, WonCards } from './parts';
import { addDuplicates, csItems, csStake, dropMissing, specialChance, togglePick } from './state';
import { HR, HR_SIZE, hrBet, hrBetsOpen, hrCancel, hrClockText, hrDebug, hrFetch, hrHorses, hrNow, hrSkip, hrSolo, hrStart, hrStop } from './horsesEngine';

function ResultBox({ r }: { r: any }) {
  if (!r) return <span className="muted">Wybierz konia, postaw karty i kibicuj.</span>;
  if (r.kind === 'debug') return <div className="rl-res"><span className="sl-big"><Wrench size={28} aria-hidden="true" /></span><div><b>Wyścig testowy zakończony</b><div className="muted small">{r.winner >= 0 ? `Wygrał: ${hrHorses()[r.winner].name}` : 'Nikt nie wygrał'}, bez stawki</div></div></div>;
  const h = hrHorses()[r.horse];
  const name = <><i className="hr-dot" style={{ background: h.color }} /> <b>{h.name}</b></>;
  if (r.status === 'won') return <>
    <div className="rl-res win"><span className="sl-big"><Trophy size={28} aria-hidden="true" /></span><div><b className="pos-txt">Wygrana: +{fmt(r.payout)}</b><div className="muted small">{name}</div></div></div>
    <WonCards r={r} />
  </>;
  if (r.status === 'refund') return <div className="rl-res"><span className="sl-big"><Car size={28} aria-hidden="true" /></span><div><b>Nikt nie wygrał</b><div className="muted small">Stawka {fmt(r.stake)} wróciła do ciebie.</div></div></div>;
  return <div className="rl-res lose"><span className="sl-big"><Skull size={28} aria-hidden="true" /></span><div><b className="neg-txt">Przegrana: −{fmt(r.stake)}</b><div className="muted small">{name} nie wygrał{r.why ? ` (${r.why})` : ''}</div></div></div>;
}

export function Horses() {
  const game = useGame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, tick] = useState(0);
  const [view3d, setView3d] = useState<boolean>((HR.view3d ?? true) && use3D());
  const betsOff = game.cfg.horses?.race?.enabled === false;   // wyścigi wyłączone: tylko podgląd (admin, tryb dev)
  const C = game.cfg.horses.race, d = HR.d;
  dropMissing(HR.sel);

  useEffect(() => {
    if (!HR.d) hrFetch().then(() => { hrStart(); touch(); }); else if (Date.now() - HR.fetchedAt > 3000) hrFetch();
    const t = setInterval(() => tick(n => n + 1), 1000);   // odliczanie na przycisku
    return () => { clearInterval(t); hrStop(); };
  }, []);
  useEffect(() => { HR.canvas = canvas.current; HR.bg = null; HR.lastPos = ''; hrStart(); }, [!!d]);

  if (!d) return <div className="panel muted">Ładowanie wyścigów</div>;
  const H = hrHorses(), stake = csStake(HR.sel), open = hrBetsOpen(), busy = !!game.spinning || !!HR.solo;
  const mine = d.mine.filter((b: any) => b.race === d.next.id), mineLive = d.live ? d.mine.filter((b: any) => b.race === d.live.id) : [];
  const others = d.others.filter((b: any) => b.race === d.next.id);
  const sel = HR.horse != null ? H[HR.horse] : null;
  const left = hrClockText(d.next.start - hrNow());

  return (
    <div className={`rl-cols hr-cols${view3d ? ' hr-3d' : ''}`}>
      <div className="panel rl-left hr-left">
        <div className="hr-view" role="group" aria-label="Widok wyścigu">
          {use3D() && <button type="button" className={view3d ? 'on' : ''} aria-pressed={view3d} onClick={() => { HR.view3d = true; setView3d(true); }}><Box size={15} aria-hidden="true" />3D</button>}
          {use3D() && <button type="button" className={view3d ? '' : 'on'} aria-pressed={!view3d} onClick={() => { HR.view3d = false; setView3d(false); }}><Square size={15} aria-hidden="true" />Z góry 2D</button>}
          {betsOff && <span className="hr-test">Podgląd testowy: zakłady wyłączone</span>}
        </div>
        <div className="hr-stage">
          {view3d && <Horses3D onFail={() => { HR.view3d = false; setView3d(false); }} />}
          <canvas ref={canvas} id="hrCanvas" width={HR_SIZE * 2} height={HR_SIZE * 2} style={view3d ? { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' } : undefined} />
          {HR.solo && <Button className="hr-skip" onClick={hrSkip}>Przewiń do końca</Button>}
        </div>
        <div className="rl-result"><ResultBox r={HR.last} /></div>
        <div className="rl-history hr-last">{d.last.length ? d.last.map((l: any) => <span key={l.id} className="hr-h" title={new Date(l.start * 1000).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} style={l.winner >= 0 ? { background: H[l.winner].color } : undefined}>{l.winner >= 0 ? l.winner + 1 : <Car size={14} aria-label="samochód" />}</span>) : <span className="muted small">Tu pojawią się wyniki ostatnich wyścigów</span>}</div>
      </div>
      <div className="rl-right">
        <div className="panel">
          <h3 className="sl-title">Konie <small className="muted">wygrana = stawka × mnożnik</small></h3>
          <div className="hr-rows">
            {H.map((h: any) => (
              <button key={h.id} type="button" className={`hr-row${HR.horse === h.id ? ' sel' : ''}`} disabled={busy} onClick={() => { HR.horse = h.id; Sound.click(); Sound.neigh(h.pitch, .06, .6); touch(); }}>
                <i className="hr-dot" style={{ background: h.color }}>{h.id + 1}</i>
                <span className="hr-name">{h.name}</span>
                <span className="hr-state" data-hrstate={h.id} />
                <span className="hr-pos" data-hrpos={h.id} />
                <span className="hr-pays">×{h.pays}</span>
                <span className="hr-bets">
                  {mine.filter((b: any) => b.horse === h.id).map((b: any) => <b key={b.id} className="hr-chip mine" title="Twój zakład">{fmt(b.stake)}</b>)}
                  {mineLive.filter((b: any) => b.horse === h.id).map((b: any) => <b key={b.id} className="hr-chip mine live" title="Twój zakład w trwającym wyścigu">{fmt(b.stake)}</b>)}
                  {others.filter((b: any) => b.horse === h.id).map((b: any, i: number) => <b key={i} className="hr-chip" title={b.user}>{b.user} {fmt(b.stake)}</b>)}
                </span>
              </button>
            ))}
          </div>
          {mine.length > 0 && <div className="hr-mybets"><b>Twoje zakłady na ten wyścig:</b> {mine.map((b: any) => {
            const h = H[b.horse];
            return <span key={b.id} className="hr-chip mine"><i className="hr-dot sm" style={{ background: h.color }} />{h.name} · {b.cards} {plural(b.cards, 'karta', 'karty', 'kart')} · {fmt(b.stake)}{open && <button type="button" className="hr-x" aria-label="Wycofaj zakład" onClick={() => hrCancel(b.id)}><CircleX size={14} /></button>}</span>;
          })}</div>}
          <div className="hr-actions">
            <Button kind="hue" big disabled={betsOff || !sel || !HR.sel.size || !open || busy} onClick={hrBet}>{open ? 'Postaw na wyścig' : 'Zakłady zamknięte'}, start za {left}{stake ? `, ${fmt(stake)}` : ''}</Button>
            <Button big disabled={betsOff || !sel || !HR.sel.size || busy} onClick={hrSolo}>Wyścig solo{stake ? `, ${fmt(stake)}` : ''}</Button>
          </div>
          {game.me?.isAdmin && <div className="hr-debug"><b>Debug (admin)</b>
            {([['car', 'samochód'], ['turbo', 'turbo'], ['turn', 'ucieczka'], ['die', 'śmierć']] as [string, string][]).map(([k, n]) => <label key={k}><input type="checkbox" defaultChecked={HR.force.has(k)} onChange={e => { if (e.target.checked) HR.force.add(k); else HR.force.delete(k); }} /> {n} 100%</label>)}
            <Button disabled={busy} onClick={hrDebug}>Wyścig testowy (bez stawki)</Button></div>}
          <div className="rl-bet-info">{sel ? <>Wybrany: <b>{sel.name}</b> ×{sel.pays}{stake ? `, wygrana ${fmt(Math.round(stake * sel.pays))}` : ''}</> : 'Kliknij konia, na którego stawiasz.'}
            {stake > 0 && <SpecialHint chance={specialChance(Math.round(stake * (sel?.pays || 1)))} />}</div>
          <p className="muted small">Wspólny wyścig startuje co {Math.round(C.period / 60)} min (zakłady przyjmujemy do {C.betClose} s przed startem), solo od razu. Trwa 1–3 minuty. Konie zbierają skrzynki „?” i używają przedmiotów: skórek od banana, rakiet, grzybów, ślimaków, piorunów i gwiazd. Uwaga na tęczowe turbo, konie, które zawracają, potykają się i padają, oraz na samochód: gdy wjedzie na tor, nikt nie wygrywa, a stawki wracają. Przegrana: postawione karty przepadają.</p>
        </div>
        <CardPicker set={HR.sel} zone="hr" max={C.maxCards} q={HR.q} disabled={busy} onQ={q => { HR.q = q; touch(); }} onPick={id => togglePick(HR.sel, id, C.maxCards)}
          onDupes={() => { const ids = addDuplicates([...HR.sel], C.maxCards, 'hr'); if (ids) { HR.sel = new Set(ids); Sound.click(); touch(); } }}
          onVabank={() => { HR.sel = new Set(csItems().map(i => i.id)); Sound.click(); touch(); }} onClear={() => { HR.sel.clear(); touch(); }} />
      </div>
    </div>
  );
}
