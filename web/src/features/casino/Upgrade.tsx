import { useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { PickTile } from '../../cards/PickTile';
import { SortSelect } from '../../cards/cardSorts';
import { confetti, epicReveal, fx, openViewer, RAINBOW } from '../../fx/effects';
import { announceFirsts, removeItems } from '../../game/actions';
import { cardMatches, cardValue, houseVariant, isSpecial, isSpecialCard, person, plural, rarityIdx, sortCards, variantOn } from '../../game/rules';
import { applyState, refreshConfig } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import { fmt, sleep } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { SearchField } from '../../ui/Field';
import { toast } from '../../ui/Toaster';
import { CS, specialChance, csPct } from './state';

// Ulepszacz "w ciemno": gracz wybiera tylko mnożnik. Cel to losowa karta o najniższej wartości >= wkład × mnożnik;
// losuje ją serwer, a przeglądarka zna tylko jej wartość i szansę.
const pct = (x: number) => (x * 100).toLocaleString('pl-PL', { maximumFractionDigits: x < .01 ? 2 : 1 }) + '%';
const items = () => S.items.filter(i => !i.fav && !isSpecialCard(i.person));
const chanceOf = (stake: number, goal: number) => !stake || !goal || goal <= stake ? 0 : Math.min(S.cfg.upgradeMax, stake / goal * S.cfg.upgradeEdge);

function poolValues() {
  const vs = S.cfg.variantOrder.filter(v => v === 'normal' || (isSpecial(v) && houseVariant(v) && variantOn(v) && !S.cfg.variants[v].combo && !S.cfg.variants[v].special && !S.cfg.variants[v].cards));
  const out = new Set<number>();
  Object.values(S.cfg.people).filter(p => p.forge && p.rarity !== 'secret' && p.rarity !== 'special').forEach(p => {
    vs.forEach(v => out.add(cardValue(p.id, v)));
    S.cfg.variantOrder.filter(v => { const V = S.cfg.variants[v]; return V.cards?.includes(p.id) && !V.exclusive && !V.crateOnly && variantOn(v) && houseVariant(v); }).forEach(v => out.add(cardValue(p.id, v)));
  });
  return [...out].sort((a, b) => a - b);
}
const goalOf = (stake: number, mult: number, values: number[]) => stake ? values.find(v => v >= stake * mult && v > stake) || 0 : 0;
const arcStart = (chance: number) => -chance * 180;   // łuk wyśrodkowany u góry
const CIRC = 2 * Math.PI * 128;

export function Upgrade() {
  const game = useGame();
  const U = CS.upg, cfg = game.cfg;
  const wheel = useRef<HTMLDivElement>(null), arc = useRef<SVGCircleElement>(null), pointer = useRef<HTMLDivElement>(null), pctBox = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState<any>(null);
  const owned = new Set(items().map(i => i.id));
  [...U.inputs].forEach(id => { if (!owned.has(id) && !U.busy) U.inputs.delete(id); });
  const stake = game.items.filter(i => U.inputs.has(i.id)).reduce((a, i) => a + i.value, 0);
  const values = useMemo(poolValues, [cfg]);
  const goal = goalOf(stake, U.mult, values), chance = chanceOf(stake, goal), joker = goal ? specialChance(goal) : 0;
  const shown = useRef(0);   // w trakcie próby łuk zostaje taki, jak przy jej starcie
  if (!U.busy) shown.current = chance;
  const max = cfg.upgradeMaxItems;
  const mine = sortCards(items().filter(i => U.inputs.has(i.id) || cardMatches(i, U.q)), CS.sorts.upg);
  const [selCount, kart] = [U.inputs.size, plural(U.inputs.size, 'karta', 'karty', 'kart')];

  const finish = () => {
    if (!U.busy) return;
    U.busy = false;
    S.spinning = false;
    setOutcome(null);
    wheel.current?.classList.remove('won', 'lost', 'in-arc');
    touch();
  };

  const run = async () => {
    if (U.busy || !U.inputs.size) return;
    const ids = [...U.inputs];
    if (ids.some(id => rarityIdx(person(S.items.find(i => i.id === id)!.person).rarity) >= rarityIdx('gold')) && !confirm(`Stawiasz karty legendarne (${fmt(stake)}). Na pewno?`)) return;
    U.busy = true;
    S.spinning = true;
    touch();
    Sound.unlock();
    let res: any;
    try {
      res = await api('/api/upgrade', { ids, mult: U.mult });
      if (res.discovered?.length) await refreshConfig();
    } catch (e: any) { U.busy = false; S.spinning = false; Sound.error(); toast(e.message, true); return touch(); }
    const w = wheel.current!, ch = res.chance, a0 = arcStart(ch);
    w.classList.add('spinning');
    arc.current!.style.strokeDasharray = `${ch * CIRC} ${CIRC}`;
    arc.current!.setAttribute('transform', `rotate(${a0 - 90} 150 150)`);
    pctBox.current!.textContent = pct(ch);
    const finalAngle = a0 + res.roll * 360, start = U.angle, base = start - (((start % 360) + 360) % 360), fast = !!S.fast;
    const end = base + 360 * (fast ? 3 : 6) + ((finalAngle % 360) + 360) % 360, D = fast ? 1600 : 5200, t0 = performance.now();
    const inArc = (a: number) => (((a - a0) % 360) + 360) % 360 < ch * 360;
    let lastTick = Math.floor(start / 10);
    await new Promise<void>(done => {
      const frame = (now: number) => {
        const t = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - t, 4), ang = start + (end - start) * e;
        if (pointer.current) pointer.current.style.transform = `rotate(${ang}deg)`;
        const tk = Math.floor(ang / 10);
        if (tk !== lastTick) { lastTick = tk; Sound.tick(1 - t); }
        w.classList.toggle('in-arc', inArc(ang));
        if (t < 1) requestAnimationFrame(frame); else done();
      };
      requestAnimationFrame(frame);
    });
    U.angle = end;
    w.classList.remove('spinning');
    removeItems(res.consumed);
    U.inputs.clear();
    if (res.win) {
      S.items = [...(res.special ? [res.special] : []), res.item, ...S.items];
      [res.item, ...(res.special ? [res.special] : [])].forEach(i => S.collected.add(`${i.person}|${i.variant}`));
    }
    applyState(res.state);
    CS.lost = !res.win;
    const b = w.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    if (res.win) {
      w.classList.add('won');
      Sound.win();
      const rr = person(res.item.person).rarity;
      fx().burst(cx, cy, 180, rr === 'ultra' ? RAINBOW : ['#3ddc84', '#b6ff5c', '#ffffff', S.cfg.rarities[rr].color], { speed: 14 });
      if (rarityIdx(rr) >= rarityIdx('gold')) { await sleep(600); await epicReveal(res.item, { fast }); }
      else confetti(['#3ddc84', '#b6ff5c', '#fff', S.cfg.rarities[rr].color], 120);
      if (res.special) { await sleep(300); await epicReveal(res.special, { fast }); }
      announceFirsts([res.item, ...(res.special ? [res.special] : [])]);
    } else {
      w.classList.add('lost');
      Sound.fail();
      fx().burst(cx, cy, 90, ['#ff5468', '#ff9a9a', '#552'], { speed: 9, g: .3 });
    }
    setOutcome({ ...res, stakeLost: stake });
    setTimeout(finish, res.win ? 2600 : 1600);   // wynik znika sam i ulepszacz jest od razu gotowy do kolejnej próby
  };

  return (
    <>
      <p className="muted">Postaw swoje karty i wybierz, ile razy droższą kartę chcesz wygrać. Jaka to będzie karta, losuje serwer i zobaczysz ją dopiero po wygranej. Im wyższy mnożnik, tym mniejsza szansa. Przegrane karty przepadają.</p>
      <div className="upg-cols blind">
        <div className="panel upg-side">
          <h3>Twoje karty <small className="muted">najwyżej {max}</small></h3>
          <div className="upg-sum">Wkład: <b>{fmt(stake)}</b> · {selCount} {kart} {selCount > 0 && <Button disabled={U.busy} onClick={() => { U.inputs.clear(); Sound.click(); touch(); }}>Wyczyść</Button>}</div>
          <div className="upg-filters">
            <SearchField value={U.q} onChange={e => { U.q = e.target.value; touch(); }} placeholder="Szukaj" aria-label="Szukaj kart" />
            <SortSelect value={CS.sorts.upg} onChange={v => { CS.sorts.upg = v; touch(); }} />
          </div>
          <div className="pick-grid upg-mine">
            {mine.slice(0, 300).map(i => <PickTile key={i.id} item={i} selected={U.inputs.has(i.id)} onClick={U.busy ? undefined : () => {
              if (U.inputs.has(i.id)) U.inputs.delete(i.id);
              else if (U.inputs.size >= max) { Sound.error(); return toast(`Najwyżej ${max} kart`, true); }
              else U.inputs.add(i.id);
              Sound.click();
              touch();
            }} />)}
            {!mine.length && <p className="muted">{U.q.trim() ? 'Żadna karta nie pasuje do wyszukiwania.' : 'Nie masz kart do postawienia.'}</p>}
          </div>
        </div>
        <div className="panel upg-mid">
          <div className="upg-wheel" ref={wheel}>
            <svg viewBox="0 0 300 300">
              <defs><linearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3ddc84" /><stop offset="1" stop-color="#b6ff5c" /></linearGradient></defs>
              <circle className="upg-track" cx="150" cy="150" r="128" />
              <circle className="upg-arc" ref={arc} cx="150" cy="150" r="128" style={{ strokeDasharray: `${shown.current * CIRC} ${CIRC}` }} transform={`rotate(${arcStart(shown.current) - 90} 150 150)`} />
              {Array.from({ length: 60 }, (_, k) => <line key={k} className={`upg-tick${k % 5 ? '' : ' big'}`} x1="150" y1="44" x2="150" y2={k % 5 ? 50 : 56} transform={`rotate(${k * 6} 150 150)`} />)}
            </svg>
            <div className="upg-pointer" ref={pointer} style={{ transform: `rotate(${U.angle}deg)` }}><i /></div>
            <div className="upg-readout">
              <div className="upg-pct" ref={pctBox}>{pct(shown.current)}</div>
              <div className="muted small">szansa</div>
              <div className="upg-mult">×{String(U.mult).replace('.', ',')}</div>
            </div>
            {outcome && (
              <div className="upg-result" onClick={e => { if (!(e.target as HTMLElement).closest('.card')) finish(); }}>
                {outcome.win ? <>
                  <div className="upg-res-label win">Wygrana</div>
                  <div onClick={() => openViewer(outcome.item.person, outcome.item.variant, outcome.item.id)}><Card person={outcome.item.person} variant={outcome.item.variant} tilt={false} /></div>
                  {outcome.special && <div className="upg-res-special">+ {person(outcome.special.person).name}</div>}
                </> : <>
                  <div className="upg-res-label lose">Przegrana</div>
                  <div className="upg-lost">−{fmt(outcome.stakeLost)}</div>
                </>}
              </div>
            )}
          </div>
          <div className="upg-pair">
            <div className="upg-stake"><b>{fmt(stake)}</b><small>{selCount} {kart}</small></div>
            <div className="upg-arrow"><ArrowRight size={22} aria-hidden="true" /></div>
            <div className={`upg-mystery${goal ? '' : ' empty'}`}><b>?</b><span>{goal ? fmt(goal) : 'brak'}</span></div>
          </div>
          <div className="upg-quick">
            {cfg.upgradeMults.map((m: number) => <button key={m} type="button" className={`chip${m === U.mult ? ' active' : ''}`} disabled={U.busy || (stake > 0 && !goalOf(stake, m, values))} onClick={() => { U.mult = m; Sound.click(); touch(); }}>×{String(m).replace('.', ',')}</button>)}
          </div>
          <div className="muted small upg-note">{!stake ? 'Wybierz karty do postawienia.' : goal ? <>Wygrasz losową kartę wartą <b>{fmt(goal)}</b>. Jaką, zobaczysz dopiero po wygranej.{joker > 0 && <><br />Szansa na kartę specjalną przy wygranej: <b>{csPct(joker)}</b></>}</> : 'Nie ma tak drogiej karty, wybierz mniejszy mnożnik.'}</div>
          <Button kind="hue" big disabled={U.busy || !goal || !chance} onClick={run}>Ulepsz{chance ? ` (${pct(chance)})` : ''}</Button>
        </div>
      </div>
    </>
  );
}
