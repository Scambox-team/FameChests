import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Lock, Zap, Repeat } from 'lucide-react';

import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { crateList, plural } from '../../game/rules';
import { applyState } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import type { Crate } from '../../game/types';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import SpotlightCardJs from '../../ui/reactbits/SpotlightCard/SpotlightCard';
import { CrateArt } from './CrateArt';
import { CrateStage } from './CrateStage';
import { applyHue, crateHue } from './crateLook';
import { OddsLadder } from './OddsLadder';
import { QuestBox } from './QuestBox';
import { openCrates } from './opening';
import styles from './CratesPage.module.css';

const SpotlightCard = SpotlightCardJs as any;
const COUNTS = [1, 2, 3, 5, 10, 15, 20];

// skrzynki dla wybranych widzą tylko gracze z dostępem, posiadane z ekwipunku zawsze da się otworzyć
const shopCrates = () => crateList()
  .filter(c => !c.special && ((c.shop && (!c.restricted || c.canBuy)) || (S.chests[c.id] || 0) > 0 || S.me?.isAdmin))
  .sort((a, b) => Number(b.shop) - Number(a.shop));
const kart = (n: number) => `${n} ${plural(n, 'karta', 'karty', 'kart')}`;

function CrateTile({ crate, active, onPick }: { crate: Crate; active: boolean; onPick: () => void }) {
  const owned = S.chests[crate.id] || 0;
  return (
    <button className={styles.tile} type="button" aria-pressed={active} style={{ '--th': crateHue(crate).hue } as React.CSSProperties} onClick={onPick}>
      <CrateArt crate={crate} className={styles.tileArt} />
      <span className={styles.tileText}>
        <b>{crate.short}</b>
        <span className="muted small">{kart(crate.people.length)} · {fmt(crate.price)}</span>
      </span>
      {owned > 0 && <span className={styles.owned} aria-label={`Masz ${owned} w ekwipunku`}>{owned}</span>}
    </button>
  );
}

function BuyPanel({ crate }: { crate: Crate }) {
  const game = useGame();
  const ownedAll = game.chests[crate.id] || 0;
  const count: number = game.count;
  const owned = Math.min(ownedAll, count), toBuy = count - owned, cost = toBuy * crate.price;
  const blocked = toBuy > 0 && !crate.canBuy, after = game.state.balance - cost;
  const openLabel = blocked ? `Otwórz ${count}` : owned ? `Otwórz ${count}${cost ? ` za ${fmt(cost)}` : ' z ekwipunku'}` : `Otwórz za ${fmt(cost)}`;

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
      {!crate.canBuy && (
        <p className={styles.lock}><Lock size={15} aria-hidden="true" />{crate.shop ? 'Tę skrzynkę mogą kupować tylko wybrani gracze.' : 'Tej skrzynki nie ma teraz w sklepie.'}{ownedAll ? ` Możesz otworzyć swoje (najwyżej ${ownedAll}).` : ''}</p>
      )}
      <div className={styles.qty} role="group" aria-label="Ilość skrzynek">
        <span>Ilość</span>
        {COUNTS.map(n => <button key={n} type="button" aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}
      </div>
      <div className={styles.switches}>
        <label><input type="checkbox" checked={!!game.fast} onChange={e => setFlag('fast', e.target.checked)} /><Zap size={15} aria-hidden="true" />Ultraszybko</label>
        <label title="Otwiera raz za razem, dopóki starcza pieniędzy. Zatrzymuje się na tajnej karcie."><input type="checkbox" checked={!!game.auto} onChange={e => setFlag('auto', e.target.checked)} /><Repeat size={15} aria-hidden="true" />Auto</label>
      </div>
      <div className={styles.acts}>
        <Button kind="hue" big disabled={!!game.opening || !crate.people.length || blocked} onClick={openCrates}>{openLabel}</Button>
        {crate.canBuy && <Button big disabled={!!game.opening} onClick={buy}>Kup {count} do ekwipunku</Button>}
      </div>
      <p className={styles.after}>{after < 0 ? `Brakuje ${fmt(-after)}.` : `Po otwarciu zostanie ${fmt(after)}.`}</p>
    </div>
  );
}

function Contents({ crate }: { crate: Crate }) {
  const [all, setAll] = useState(false);
  const people = crate.people;
  const shown = useMemo(() => {
    if (all) return people;
    const order = S.cfg.rarityOrder, pick: string[] = [];
    for (const r of [...order].reverse()) {
      const hit = people.find(id => S.cfg.people[id].rarity === r);
      if (hit) pick.push(hit);
      if (pick.length === 6) break;
    }
    return pick;
  }, [people, all]);
  if (!people.length) return <section className={styles.sec}><h2>Zawartość</h2><p className="muted">W tej skrzynce nie ma jeszcze kart.</p></section>;
  const zoom = (e: React.MouseEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (c) openViewer(c.dataset.pid, c.dataset.variant);
  };
  return (
    <section className={styles.sec}>
      <div className={styles.secHead}>
        <h2>{all ? `Wszystkie karty: ${crate.name}` : 'Po jednej karcie z każdej rzadkości'}</h2>
        {people.length > 6 && <Button kind="quiet" onClick={() => setAll(!all)}>{all ? 'Zwiń' : `Pokaż wszystkie (${people.length})`}<ChevronDown size={16} aria-hidden="true" style={{ transform: all ? 'rotate(180deg)' : undefined }} /></Button>}
      </div>
      <div className={styles.cards} onClick={zoom}>
        {shown.map(id => <Card key={id} person={id} />)}
      </div>
    </section>
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
  if (!S.cratePicked && !S.cfg.crates[S.crate]?.shop) S.crate = crates.find(c => c.shop)?.id ?? S.crate;
  if (!S.count) S.count = 1;
  if (S.fast === undefined) { try { S.fast = localStorage.getItem('fast') === '1'; } catch { S.fast = false; } }
  const crate = S.cfg.crates[S.crate];

  useEffect(() => { document.title = 'Skrzynki · ScamBox'; }, []);
  useEffect(() => { if (crate) applyHue(crate); }, [crate?.id]);

  if (!crate) return <p className="muted">Sklep jest pusty, na razie nie ma żadnych skrzynek.</p>;
  const pick = (c: Crate) => { if (S.opening) return; Sound.click(); S.crate = c.id; S.cratePicked = true; S.count = 1; touch(); };

  return (
    <>
      <QuestBox />
      <section className={styles.tiles} aria-label="Wybór skrzynki">
        {crates.map(c => <CrateTile key={c.id} crate={c} active={c.id === crate.id} onPick={() => pick(c)} />)}
      </section>
      <section ref={hero} className={styles.hero} aria-label={`Wybrana skrzynka: ${crate.name}`}>
        <CrateStage crate={crate} hero={hero} onOpen={openCrates} label={`Otwórz: ${crate.name}`} />
        <BuyPanel crate={crate} />
        <SpotlightCard className={styles.ladderBox} spotlightColor="#ffffff" intensity={.08} borderGlow={.35} style={{ '--spotlight-card-surface': '#000000a8', '--spotlight-card-shadow': 'none', '--spotlight-card-border': 'transparent' } as React.CSSProperties}>
          <OddsLadder crate={crate} />
        </SpotlightCard>
      </section>
      <Contents crate={crate} />
      <Stats />
    </>
  );
}
