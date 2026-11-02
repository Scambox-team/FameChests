import { useEffect } from 'react';
import { api } from '../../api/client';
import { PickTile } from '../../cards/PickTile';
import { confetti, epicReveal, GOLDS, RAINBOW } from '../../fx/effects';
import { announceFirsts, removeItems } from '../../game/actions';
import { plural } from '../../game/rules';
import { applyState } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import { fmt, sleep } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { CardPicker, SpecialHint, WonCards } from './parts';
import { addDuplicates, betOk, CS, csItems, csStake, dropMissing, duplicates, isVabank, specialChance, togglePick } from './state';

// Gracz przeciw krupierowi. Rozdanie prowadzi serwer (talia, zakryta karta) i czeka, aż gracz je dokończy;
// postawione karty są w tym czasie poza ekwipunkiem, po remisie albo wygranej wracają.
const SUITS: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

function total(hand: string[]) {
  let sum = 0, aces = 0;
  for (const c of hand) {
    if (c === '??') continue;
    sum += c[0] === 'A' ? 11 : 'TJQK'.includes(c[0]) ? 10 : +c[0];
    if (c[0] === 'A') aces++;
  }
  while (sum > 21 && aces) { sum -= 10; aces--; }
  return { total: sum, soft: aces > 0 };
}
const isBJ = (hand: string[]) => hand.length === 2 && total(hand).total === 21;
const paysTxt = () => { const p = S.cfg.blackjack.blackjackPays; return ({ 1.5: '3:2', 1.2: '6:5', 2: '2:1' } as Record<number, string>)[p] || `${p}:1`; };

function PlayingCard({ c, cls = '' }: { c: string; cls?: string }) {
  if (c === '??') return <div className={`bj-card back ${cls}`} />;
  const r = c[0] === 'T' ? '10' : c[0], s = SUITS[c[1]];
  return (
    <div className={`bj-card${'HD'.includes(c[1]) ? ' red' : ''} ${cls}`}>
      <span className="bj-c bj-c-tl">{r}<i>{s}</i></span>
      <span className="bj-c-mid">{'JQK'.includes(r) ? r : s}</span>
      <span className="bj-c bj-c-br">{r}<i>{s}</i></span>
    </div>
  );
}

function Total({ hand, done }: { hand: string[]; done: boolean }) {
  if (!hand.length) return null;
  const { total: t, soft } = total(hand), bj = isBJ(hand);
  return <b className={`bj-total${t > 21 ? ' bust' : bj ? ' bj' : ''}`}>{bj ? 'BJ' : soft && t < 21 && !done ? `${t - 10} / ${t}` : t}</b>;
}

function Result({ E }: { E: any }) {
  const p = total(E.player).total, d = total(E.dealer).total;
  const why = E.result === 'blackjack' ? 'Blackjack' : p > 21 ? `Za dużo, masz ${p}` : isBJ(E.dealer) ? (E.result === 'push' ? 'Obaj macie blackjacka' : 'Krupier ma blackjacka') : d > 21 ? `Krupier ma za dużo (${d})` : `${p} : ${d}`;
  return (
    <div className={`bj-res ${E.result}`}>
      {E.result === 'blackjack' && <b className="pos-txt">Blackjack: +{fmt(E.payout)}</b>}
      {E.result === 'win' && <b className="pos-txt">Wygrana: +{fmt(E.payout)}</b>}
      {E.result === 'push' && <b>Remis</b>}
      {E.result === 'lose' && <b className="neg-txt">Przegrana: −{fmt(E.stake)}</b>}
      <div className="small">{why}{E.result === 'push' ? ', karty wracają' : ''}</div>
    </div>
  );
}

function Table({ spinning }: { spinning: boolean }) {
  const B = CS.bj, v = B.view, done = !B.game, anim = B.anim;
  const hand = (side: 'player' | 'dealer') => v[side].map((c, i) => <PlayingCard key={i} c={c} cls={anim?.[0] === side && anim[1] === i ? `bj-${anim[2]}` : ''} />);
  const stake = B.game ? B.game.stake + B.game.doubleStake : B.end?.stake;
  return (
    <div className="bj-felt">
      <div className="bj-seat"><div className="bj-label">Krupier <Total hand={v.dealer} done={done} /></div><div className="bj-hand">{hand('dealer')}</div></div>
      <div className="bj-mid">{B.end && !spinning ? <Result E={B.end} /> : <span className="bj-rules">Blackjack płaci {paysTxt()}, krupier staje na 17</span>}</div>
      <div className="bj-seat"><div className="bj-hand">{hand('player')}</div>
        <div className="bj-label">Ty <Total hand={v.player} done={done} />{stake ? <span className="bj-chip">{fmt(stake)}{B.game?.doubleStake || B.end?.doubled ? ', podwojone' : ''}</span> : null}</div></div>
    </div>
  );
}

async function animate(target: any) {
  const v = CS.bj.view, gap = S.fast ? 150 : 420;
  const put = async (side: 'player' | 'dealer', i: number, card: string, flip = false) => {
    if (flip) v.dealer[1] = card; else v[side].push(card);
    CS.bj.anim = [side, i, flip ? 'flip' : 'new'];
    touch();
    Sound.deal();
    await sleep(gap);
  };
  while (v.player.length < 2 || v.dealer.length < 2) {
    if (v.player.length <= v.dealer.length) await put('player', v.player.length, target.player[v.player.length]);
    else await put('dealer', v.dealer.length, target.dealer[v.dealer.length]);
  }
  while (v.player.length < target.player.length) await put('player', v.player.length, target.player[v.player.length]);
  if (v.dealer[1] === '??' && target.dealer[1] !== '??') await put('dealer', 1, target.dealer[1], true);
  while (v.dealer.length < target.dealer.length) await put('dealer', v.dealer.length, target.dealer[v.dealer.length]);
  CS.bj.anim = null;
}

async function action(kind: 'deal' | 'hit' | 'stand' | 'double') {
  const B = CS.bj, G = B.game, max = S.cfg.blackjack.maxCards;
  if (S.spinning) return;
  const ids = kind === 'deal' ? [...B.sel] : kind === 'double' ? [...B.dsel] : [];
  if (kind === 'deal') {
    const stake = csStake(B.sel);
    if (!ids.length || !betOk(ids, stake, max, `Postawić ${ids.length} ${plural(ids.length, 'kartę', 'karty', 'kart')} o wartości ${fmt(stake)} w blackjacku?`)) return;
  }
  if (kind === 'double') {
    if (!ids.length) { Sound.error(); return toast(`Wybierz karty do podwojenia, razem najwyżej ${fmt(G.stake)}`, true); }
    if (csStake(B.dsel) > G.stake) { Sound.error(); return toast(`Dołożone karty mogą być warte najwyżej ${fmt(G.stake)}`, true); }
  }
  S.spinning = true;
  Sound.unlock();
  let res: any;
  try { res = await api(`/api/casino/blackjack/${kind}`, ids.length ? { ids, vabank: kind === 'deal' && isVabank(ids.length, max) } : {}); }
  catch (e: any) { S.spinning = false; Sound.error(); toast(e.message, true); return load(); }
  removeItems(ids);
  if (kind === 'deal') { B.sel.clear(); B.view = { player: [], dealer: [] }; }
  B.dsel.clear();
  B.game = res.game;
  B.end = res.end && { ...res.end, doubled: kind === 'double' };
  touch();
  await animate(res.game || res.end);
  const E = res.end;
  if (E) {
    if (E.returned) S.items = [...S.items, ...E.returned].sort((a, b) => b.id - a.id);
    S.items = [...(E.special ? [E.special] : []), ...E.items.slice().reverse(), ...S.items];
    [...E.items, ...(E.special ? [E.special] : [])].forEach((i: any) => S.collected.add(`${i.person}|${i.variant}`));
    B.history = [{ result: E.result, p: total(E.player).total, d: total(E.dealer).total }, ...B.history].slice(0, 14);
    if (E.result === 'blackjack') { Sound.win(); confetti(GOLDS.concat(RAINBOW), 220); }
    else if (E.result === 'win') { Sound.win(); confetti(['#0f9d58', '#ffcf3f', '#c62828', '#fff'], 110); }
    else if (E.result === 'lose') Sound.fail();
    else Sound.click();
    CS.lost = E.result === 'lose';
  }
  applyState(res.state);
  if (E?.special) {
    await sleep(S.fast ? 300 : 700);
    await epicReveal(E.special, { fast: S.fast });
    announceFirsts([E.special]);
  }
  S.spinning = false;
  touch();
}

// rozdanie w trakcie z serwera (np. po odświeżeniu strony): pokazujemy je bez animacji
async function load() {
  const B = CS.bj;
  if (S.spinning) return;
  try {
    const res = await api('/api/casino/blackjack');
    if (S.spinning) return;
    B.loaded = true;
    B.game = res.game;
    if (res.game) { B.view = { player: [...res.game.player], dealer: [...res.game.dealer] }; B.end = null; } else B.dsel.clear();
    touch();
  } catch (e: any) { toast(e.message, true); }
}

function fillDouble() {
  const B = CS.bj, max = S.cfg.blackjack.maxCards;
  let left = B.game.stake - csStake(B.dsel), added = 0;
  for (const i of duplicates(B.dsel, 'bjd').sort((a: any, b: any) => b.value - a.value)) {
    if (B.dsel.size >= max) break;
    if (i.value <= left) { B.dsel.add(i.id); left -= i.value; added++; }
  }
  if (!added) { Sound.error(); return toast('Żaden duplikat nie mieści się już w stawce', true); }
  toast(`Dodano ${added} ${plural(added, 'duplikat', 'duplikaty', 'duplikatów')}, razem ${fmt(csStake(B.dsel))} z ${fmt(B.game.stake)}`);
  Sound.click();
  touch();
}

function Side({ spinning }: { spinning: boolean }) {
  const B = CS.bj, G = B.game, C = S.cfg.blackjack, max = C.maxCards;
  if (G && !G.canDouble) return <div className="panel"><h3>Twój ruch</h3><p className="muted">Dobierz kartę albo stój. Wtedy krupier odkrywa kartę i dobiera do 16.</p></div>;
  if (G) {
    const pick = (id: number) => {
      if (!B.dsel.has(id) && csStake(B.dsel) + (S.items.find(i => i.id === id)?.value || 0) > G.stake) { Sound.error(); return toast(`Dołożone karty mogą być warte najwyżej ${fmt(G.stake)}`, true); }
      togglePick(B.dsel, id, max);
    };
    return <>
      <div className="panel"><h3>Podwojenie</h3>
        <p className="small">Dołóż karty warte najwyżej {fmt(G.stake)} i kliknij Podwój. Dostaniesz dokładnie jedną kartę. Wybrano: <b>{fmt(csStake(B.dsel))}</b> z {fmt(G.stake)}.</p>
        <p className="muted small">Nie chcesz podwajać? Po prostu dobierz albo stój.</p></div>
      <CardPicker set={B.dsel} zone="bjd" max={max} q={B.q} disabled={spinning} tip="Dodaj duplikaty: najdroższe, które zmieszczą się w stawce" onQ={q => { B.q = q; touch(); }} onPick={pick} onDupes={fillDouble} onClear={() => { B.dsel.clear(); touch(); }} />
    </>;
  }
  const stake = csStake(B.sel);
  return <>
    <div className="panel">
      <div className="rl-bet-info">
        <span>Wygrana: <b>1:1</b>{stake ? ` (+${fmt(stake)} w kartach)` : ''}</span>
        <span>Blackjack: <b>{paysTxt()}</b>{stake ? ` (+${fmt(Math.floor(stake * C.blackjackPays))})` : ''}</span>
        <span>Remis: <b>karty wracają</b></span>
        {stake > 0 && <SpecialHint chance={specialChance(stake)} />}
      </div>
      <p className="muted small">Zbierz bliżej 21 niż krupier, nie przekraczając 21. Krupier dobiera do 16 i staje na 17. Wygrana: twoje karty zostają, a dostajesz losowe karty o wartości wygranej. Przegrana: postawione karty przepadają. Na dwóch pierwszych kartach możesz podwoić.</p>
    </div>
    <CardPicker set={B.sel} zone="bj" max={max} q={B.q} disabled={spinning} onQ={q => { B.q = q; touch(); }} onPick={id => togglePick(B.sel, id, max)}
      onDupes={() => { const ids = addDuplicates([...B.sel], max, 'bj'); if (ids) { B.sel = new Set(ids); Sound.click(); touch(); } }}
      onVabank={() => { B.sel = new Set(csItems().map(i => i.id)); Sound.click(); touch(); }} onClear={() => { B.sel.clear(); touch(); }} />
  </>;
}

export function Blackjack() {
  const game = useGame();
  const B = CS.bj, G = B.game, spinning = !!game.spinning, E = spinning ? null : B.end;
  useEffect(() => { load(); }, []);
  dropMissing(B.sel, B.dsel);
  if (!B.loaded) return <div className="panel muted">Ładowanie stołu</div>;
  const stake = csStake(B.sel), extra = csStake(B.dsel);
  const staked = G ? [...G.doubleItems, ...G.items] : [];
  return (
    <div className="rl-cols">
      <div className="panel rl-left bj-left">
        <Table spinning={spinning} />
        <div className="bj-actions">
          {!G ? <Button kind="hue" big disabled={!B.sel.size || spinning} onClick={() => action('deal')}>Rozdaj{stake ? `, stawka ${fmt(stake)}` : ''}</Button> : <>
            <Button kind="hue" big disabled={spinning} onClick={() => action('hit')}>Dobierz</Button>
            <Button big disabled={spinning} onClick={() => action('stand')}>Stój</Button>
            <Button big disabled={spinning || !G.canDouble} title="Dokładasz karty warte najwyżej tyle, co stawka, i dostajesz dokładnie jedną kartę" onClick={() => action('double')}>Podwój{extra ? ` +${fmt(extra)}` : ''}</Button>
          </>}
        </div>
        {G && <div className="bj-staked"><div className="muted small">Na stole: {staked.length} {plural(staked.length, 'karta', 'karty', 'kart')}</div>
          <div className="jp-cards">{staked.slice(0, 16).map((i: any) => <PickTile key={i.id} item={i} />)}{staked.length > 16 && <span className="jp-more">+{staked.length - 16}</span>}</div></div>}
        {!G && E && (E.items.length > 0 || E.special) && <WonCards r={E} />}
        <div className="rl-history">{B.history.length ? B.history.map((h, i) => <span key={i} className={`rl-h bj-h ${h.result}`} title={`Ty ${h.p} : krupier ${h.d}`}>{h.result === 'blackjack' ? 'BJ' : `${h.p}:${h.d}`}</span>) : <span className="muted small">Tu pojawią się ostatnie wyniki</span>}</div>
      </div>
      <div className="rl-right"><Side spinning={spinning} /></div>
    </div>
  );
}
