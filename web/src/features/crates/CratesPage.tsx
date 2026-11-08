import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, Lock, Minus, Plus, Zap, Repeat } from 'lucide-react';

import { api } from '../../api/client';
import { crateList, crateOf, plural, testCrates } from '../../game/rules';
import { applyState } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import type { Crate } from '../../game/types';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import SpotlightCardJs from '../../ui/reactbits/SpotlightCard/SpotlightCard';
import { CrateCarousel } from './CrateCarousel';
import { CrateStage } from './CrateStage';
import { applyHue } from './crateLook';
import { OddsLadder } from './OddsLadder';
import { QuestBox } from './QuestBox';
import { TopDrops } from './TopDrops';
import { openCrates, openTestCrate } from './opening';
import styles from './CratesPage.module.css';

const SpotlightCard = SpotlightCardJs as any;
const COUNTS = [1, 2, 3, 5, 10, 15, 20];

// skrzynki dla wybranych widzą tylko gracze z dostępem, posiadane z ekwipunku zawsze da się otworzyć;
// admini mają na końcu skrzynki testowe (rules.ts: testCrates)
const shopCrates = () => [...crateList()
  .filter(c => !c.special && ((c.shop && (!c.restricted || c.canBuy)) || (S.chests[c.id] || 0) > 0 || S.me?.isAdmin))
  .sort((a, b) => Number(b.shop) - Number(a.shop)), ...Object.values(testCrates()) as Crate[]];
const kart = (n: number) => `${n} ${plural(n, 'karta', 'karty', 'kart')}`;
/** Jak długo skrzynka zostanie w sklepie: rotacyjna do północy, sezonowa do końca sezonu */
const crateWhen = (c: Crate) =>
  c.mode === 'rotation' ? 'W dzisiejszej rotacji, zniknie ze sklepu o północy.'
    : c.mode === 'seasonal' && c.seasonTo ? `Skrzynka sezonowa, w sklepie do ${new Date(`${c.seasonTo}T00:00`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}.`
      : '';

function BuyPanel({ crate }: { crate: Crate }) {
  const game = useGame();
  const ownedAll = game.chests[crate.id] || 0;
  const count: number = game.count;
  const owned = Math.min(ownedAll, count), toBuy = count - owned, cost = toBuy * crate.price;
  const blocked = toBuy > 0 && !crate.canBuy, after = game.state.balance - cost;
  const openLabel = crate.test ? `Otwórz ${count} (test)` : blocked ? `Otwórz ${count}` : owned ? `Otwórz ${count}${cost ? ` za ${fmt(cost)}` : ' z ekwipunku'}` : `Otwórz za ${fmt(cost)}`;

  const setCount = (n: number) => { S.count = Math.max(1, Math.min(S.cfg.maxOpen, n)); touch(); };
  const setFlag = (k: 'fast' | 'auto', v: boolean) => {
    S[k] = v;
    if (k === 'fast') { try { localStorage.setItem('fast', v ? '1' : '0'); } catch { /* bez zapamiętania */ } }
    touch();
  };
  const buy = async () => {
    if (S.opening) return;
    try {
      const res = await api('/api/chests/buy', { crate: crate.id, count: S.count });
      S.chests = res.chests;
      applyState(res.state);
      Sound.coin(2);
      toast(`Kupiono ${S.count} × ${crate.name}, czekają w ekwipunku`);
    } catch (e: any) {
      Sound.error();
      toast(e.message, true);
    }
  };

  return (
    <div className={styles.info}>
      <h2>{crate.name}</h2>
      <p className="muted">{crate.desc ? `${crate.desc}. ` : ''}{kart(crate.people.length)}{ownedAll ? `, w ekwipunku masz ${ownedAll} ${plural(ownedAll, 'taką skrzynkę', 'takie skrzynki', 'takich skrzynek')}` : ''}.</p>
      {crate.shop && crateWhen(crate) && <p className={styles.when}><CalendarClock size={15} aria-hidden="true" />{crateWhen(crate)}</p>}
      {!crate.canBuy && (
        <p className={styles.lock}><Lock size={15} aria-hidden="true" />{crate.shop ? 'Tę skrzynkę mogą kupować tylko wybrani gracze.' : 'Tej skrzynki nie ma teraz w sklepie.'}{ownedAll ? ` Możesz otworzyć swoje (najwyżej ${ownedAll}).` : ''}</p>
      )}
      <div className={styles.qty} role="group" aria-label="Ilość skrzynek">
        <span>Ilość</span>
        {COUNTS.map(n => <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}
        <span className={styles.step}>
          <button type="button" aria-label="O jedną skrzynkę mniej" disabled={count <= 1} onClick={() => setCount(count - 1)}><Minus size={15} aria-hidden="true" /></button>
          <input type="number" inputMode="numeric" min={1} max={game.cfg.maxOpen} value={count} aria-label="Dokładna ilość skrzynek"
            onChange={e => setCount(Math.floor(+e.target.value) || 1)} onFocus={e => e.target.select()} />
          <button type="button" aria-label="O jedną skrzynkę więcej" disabled={count >= game.cfg.maxOpen} onClick={() => setCount(count + 1)}><Plus size={15} aria-hidden="true" /></button>
        </span>
      </div>
      <div className={styles.switches}>
        <label><input type="checkbox" checked={!!game.fast} onChange={e => setFlag('fast', e.target.checked)} /><Zap size={15} aria-hidden="true" />Ultraszybko</label>
        <label title="Otwiera raz za razem, dopóki starcza pieniędzy. Zatrzymuje się na tajnej karcie."><input type="checkbox" checked={!!game.auto} onChange={e => setFlag('auto', e.target.checked)} /><Repeat size={15} aria-hidden="true" />Auto</label>
      </div>
      <div className={styles.acts}>
        <Button kind="hue" big disabled={!!game.opening || !crate.people.length || blocked} onClick={openCrates}>{openLabel}</Button>
        {crate.canBuy && !crate.test && <Button big disabled={!!game.opening} onClick={buy}>Kup {count} do ekwipunku</Button>}
      </div>
      <p className={styles.after}>{crate.test ? 'Skrzynka testowa: wynik losuje przeglądarka, karty nie trafiają do ekwipunku.' : after < 0 ? `Brakuje ${fmt(-after)}.` : `Po otwarciu zostanie ${fmt(after)}.`}</p>
    </div>
  );
}

function Stats() {
  const { state: st, items } = useGame();
  const profit = st.earned - st.spent;
  const rows: [string, string][] = [
    ['Otwarte skrzynki', String(st.opened)], ['Wydano', fmt(st.spent)], ['Ze sprzedaży', fmt(st.earned)],
    ['Wartość ekwipunku', fmt(items.reduce((a, i) => a + i.value, 0))], ['Bilans sprzedaży', `${profit >= 0 ? '+' : ''}${fmt(profit)}`],
    ['Z codziennych skrzynek', fmt(st.daily_total || 0)], ['Kontrakty', String(st.contracts || 0)], ['Ulepszenia udane / nieudane', `${st.upgrades_won || 0} / ${st.upgrades_lost || 0}`]
  ];
  return (
    <section className={styles.sec}>
      <h2>Twoje statystyki</h2>
      <dl className={styles.stats}>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}

export function CratesPage() {
  const game = useGame();
  const hero = useRef<HTMLElement>(null);
  const crates = shopCrates();
  if (!crates.some(c => c.id === game.crate)) S.crate = (crates.find(c => c.canBuy) ?? crates[0])?.id;
  if (!S.cratePicked && !crateOf(S.crate)?.shop) S.crate = crates.find(c => c.shop)?.id ?? S.crate;
  if (!S.count) S.count = 1;
  if (S.fast === undefined) { try { S.fast = localStorage.getItem('fast') === '1'; } catch { S.fast = false; } }
  const crate = crateOf(S.crate);

  useEffect(() => { document.title = 'Skrzynki · ScamBox'; }, []);
  // panel admina: /crates?test=<id>&n=<ile> = testowe otwarcie (prawdziwe losowanie serwera, bez zapisu)
  const [qs, setQs] = useSearchParams();
  useEffect(() => {
    const id = qs.get('test');
    if (!id) return;
    setQs({}, { replace: true });
    if (shopCrates().some(c => c.id === id)) { S.crate = id; S.cratePicked = true; touch(); }
    if (S.me?.isAdmin && crateOf(id)) void openTestCrate({ crate: id, count: Math.max(1, Math.min(10, +(qs.get('n') ?? 1) || 1)) });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (crate) applyHue(crate); }, [crate?.id]);

  if (!crate) return <p className="muted">Sklep jest pusty, na razie nie ma żadnych skrzynek.</p>;
  const pick = (c: Crate) => { if (S.opening) return; Sound.click(); S.crate = c.id; S.cratePicked = true; S.count = 1; touch(); };

  return (
    <>
      <QuestBox />
      <CrateCarousel crates={crates} active={crate.id} onPick={pick} />
      <section ref={hero} className={styles.hero} aria-label={`Wybrana skrzynka: ${crate.name}`}>
        <CrateStage crate={crate} hero={hero} onOpen={openCrates} count={game.count} label={`Otwórz: ${crate.name}, kliknij dwa razy`} />
        <BuyPanel crate={crate} />
        {!crate.test && <SpotlightCard className={styles.ladderBox} spotlightColor="#ffffff" intensity={.08} borderGlow={.35} style={{ '--spotlight-card-surface': '#000000a8', '--spotlight-card-shadow': 'none', '--spotlight-card-border': 'transparent' } as React.CSSProperties}>
          <OddsLadder crate={crate} />
        </SpotlightCard>}
      </section>
      <TopDrops crate={crate} />
      <Stats />
    </>
  );
}
