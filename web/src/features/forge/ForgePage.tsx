import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, Minus, Plus, X } from 'lucide-react';
import { Hammer } from 'lucide-react';
import { PageHero } from '../../ui/PageHero';

import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { PickTile } from '../../cards/PickTile';
import { SortSelect } from '../../cards/cardSorts';
import { confetti, GOLDS, RAINBOW } from '../../fx/effects';
import { announceFirsts, removeItems, sellIds } from '../../game/actions';
import { cardMatches, crateOf, houseVariant, imgUrl, isSpecial, isSpecialCard, person, plural, rarityIdx, sortCards, varRank, variantOn } from '../../game/rules';
import { applyState, refreshConfig } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import type { Item } from '../../game/types';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { SearchField } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import { runContractAnim } from './contractAnim';
import styles from './ForgePage.module.css';

const MAX_BULK = 50, PICK_LIMIT = 300;
const pct = (x: number) => (x * 100).toLocaleString('pl-PL', { maximumFractionDigits: x < .01 ? 2 : 1 }) + '%';
const kontrakt = (n: number) => plural(n, 'kontrakt', 'kontrakty', 'kontraktów');
// ulubione i specjalne nie trafiają do kuźni
const forgeItems = () => S.items.filter(i => !i.fav && !isSpecialCard(i.person));

function variantChance(specials: number) {
  const base = S.cfg.variantOrder.filter(v => isSpecial(v) && houseVariant(v) && variantOn(v)).reduce((a, v) => a + S.cfg.variants[v].chance, 0);
  return Math.min(.9, base * (1 + S.cfg.contractVariantBonus * specials));
}
// wynik kontraktu jak na serwerze: tylko karty ze skrzynek w sklepie, nie droższe niż najtańsza włożona
function candidates(crateId: string | null, target: string, maxMult: number) {
  const ids = crateId ? crateOf(crateId)?.people || [] : Object.keys(S.cfg.people);
  return ids.filter(id => { const p = person(id); return p.rarity === target && p.forge && (p.valueMult || 1) <= maxMult; });
}
const crateFor = (p: any, target: string, maxMult: number) => (p.crates || [p.crate]).find((c: string) => candidates(c, target, maxMult).length) ?? null;

function outcomes(items: Item[], next: string) {
  const maxMult = Math.min(...items.map(i => person(i.person).valueMult || 1));
  const pool = items.map(i => crateFor(person(i.person), next, maxMult)).filter(c => candidates(c, next, maxMult).length);
  const share: Record<string, number> = {};
  pool.forEach(c => { share[c ?? ''] = (share[c ?? ''] || 0) + 1 / pool.length; });
  const chance: Record<string, number> = {};
  Object.entries(share).forEach(([c, sh]) => {
    const ids = candidates(c || null, next, maxMult);
    ids.forEach(id => { chance[id] = (chance[id] || 0) + sh / ids.length; });
  });
  return Object.entries(chance).sort((a, b) => b[1] - a[1]);
}

// karty dobierane automatycznie: nigdy ulubione ani z gabloty, najpierw najtańsze
function bulkPool(tier: string, dupes: boolean, keepSpecial: boolean) {
  const show = new Set(S.showcase), byPerson: Record<string, Item[]> = {};
  S.items.filter(i => person(i.person).rarity === tier).forEach(i => (byPerson[i.person] ||= []).push(i));
  const out: Item[] = [];
  for (const list of Object.values(byPerson)) {
    list.sort((a, b) => Number(b.fav) - Number(a.fav) || Number(show.has(b.id)) - Number(show.has(a.id)) || varRank(b.variant) - varRank(a.variant) || a.id - b.id);
    list.forEach((it, k) => { if (!((dupes && k === 0) || it.fav || show.has(it.id) || (keepSpecial && isSpecial(it.variant)))) out.push(it); });
  }
  return out.sort((a, b) => a.value - b.value || a.id - b.id);
}

function BulkResults({ got, stake, onClose }: { got: Item[]; stake: number; onClose: () => void }) {
  const gain = got.reduce((a, i) => a + i.value, 0);
  const sorted = [...got].sort((a, b) => rarityIdx(person(b.person).rarity) - rarityIdx(person(a.person).rarity) || varRank(b.variant) - varRank(a.variant) || b.value - a.value);
  const sell = async () => {
    if (got.some(i => rarityIdx(person(i.person).rarity) >= rarityIdx('gold')) && !confirm('Wśród nich są karty legendarne lub lepsze. Sprzedać wszystkie?')) return;
    try { await sellIds(got.map(i => i.id)); onClose(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <Modal title={`${got.length} ${kontrakt(got.length)}`} onClose={onClose} wide>
      <p className="muted">Oddane karty: {fmt(stake)}, otrzymane: <b>{fmt(gain)}</b></p>
      <div className="bulk-grid">{sorted.map((it, k) => <div key={it.id} className={`bulk-card${isSpecial(it.variant) ? ' special' : ''}`} style={{ animationDelay: `${Math.min(k, 30) * 70}ms` }}><Card person={it.person} variant={it.variant} uid={it.id} tilt={false} /></div>)}</div>
      <div className={styles.row}><Button onClick={sell}>Sprzedaj wszystkie ({fmt(gain)})</Button><Button kind="hue" onClick={onClose}>Odbierz</Button></div>
    </Modal>
  );
}

export function ForgePage() {
  const game = useGame();
  const cfg = game.cfg;
  const tiers = useMemo(() => cfg.rarityOrder.filter(r => r in cfg.contractSize && cfg.contractNext[r] && Object.values(cfg.people).some(p => p.rarity === r)), [cfg]);
  const [tierRaw, setTier] = useState(tiers[0]);
  const [slotsRaw, setSlots] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState('valueAsc');
  const [q, setQ] = useState('');
  const [bulk, setBulk] = useState({ n: 1, dupes: true, keepSpecial: true });
  const [results, setResults] = useState<{ got: Item[]; stake: number } | null>(null);

  useEffect(() => { document.title = 'Kuźnia · ScamBox'; }, []);

  const tier = tiers.includes(tierRaw) ? tierRaw : tiers[0];
  const need: number = cfg.contractSize[tier], next: string = cfg.contractNext[tier];
  const R = cfg.rarities[tier], NR = cfg.rarities[next];
  const byId = new Map(forgeItems().map(i => [i.id, i]));
  const slots = slotsRaw.filter(id => byId.has(id) && person(byId.get(id)!.person).rarity === tier).slice(0, need);
  const slotItems = slots.map(id => byId.get(id)!), inSlots = new Set(slots);
  const eligible = sortCards(forgeItems().filter(i => person(i.person).rarity === tier && !inSlots.has(i.id) && cardMatches(i, q)), sort);
  const specials = slotItems.filter(i => isSpecial(i.variant)).length, stake = slotItems.reduce((a, i) => a + i.value, 0);
  const ways = slotItems.length ? outcomes(slotItems, next) : null;

  const pool = bulkPool(tier, bulk.dupes, bulk.keepSpecial), maxBulk = Math.min(MAX_BULK, Math.floor(pool.length / need));
  const bulkN = Math.max(0, Math.min(bulk.n, maxBulk));
  const groups = Array.from({ length: bulkN }, (_, k) => pool.slice(k * need, (k + 1) * need)), bulkItems = groups.flat();
  const bulkValue = bulkItems.reduce((a, i) => a + i.value, 0);

  const add = (id: number) => {
    if (slots.length >= need) { Sound.error(); return toast('Kontrakt jest pełny', true); }
    setSlots([...slots, id]);
    Sound.click();
  };
  const autoFill = (start: number[] = slots) => {
    const taken = new Set(start);
    const list = forgeItems().filter(i => person(i.person).rarity === tier && !taken.has(i.id) && !S.drawn.has(i.id));
    const count: Record<string, number> = {};
    S.items.forEach(i => { count[i.person] = (count[i.person] || 0) + 1; });
    start.forEach(id => { const it = S.items.find(i => i.id === id); if (it) count[it.person]--; });
    list.sort((a, b) => varRank(a.variant) - varRank(b.variant) || count[b.person] - count[a.person]);
    const picked: number[] = [];
    for (const it of list) {
      if (start.length + picked.length >= need) break;
      if (count[it.person] > 1) { picked.push(it.id); count[it.person]--; }
    }
    if (start.length + picked.length < need) toast(picked.length ? 'Za mało duplikatów, dodano tyle, ile się dało.' : 'Brak duplikatów tej rzadkości.', !picked.length);
    setSlots([...start, ...picked]);
    Sound.click();
  };
  const sign = async () => {
    if (busy || slotItems.length !== need) return;
    if (slotItems.some(i => rarityIdx(person(i.person).rarity) >= rarityIdx('gold')) && !confirm('W kontrakcie są karty legendarne. Na pewno?')) return;
    setBusy(true);
    S.busy = true;
    await runContractAnim({
      items: slotItems, next,
      canAgain: () => forgeItems().filter(i => person(i.person).rarity === tier).length >= need,
      onDone: again => { S.busy = false; setBusy(false); setSlots([]); touch(); if (again) setTimeout(() => autoFill([]), 0); }
    });
  };
  const runBulk = async () => {
    if (busy || !bulkN) return;
    const warn = rarityIdx(tier) >= rarityIdx('gold') ? '\nUwaga: to karty legendarne!' : '';
    if (!confirm(`Wykonać ${bulkN} ${kontrakt(bulkN)}? Zużyjesz ${bulkItems.length} kart o wartości ${fmt(bulkValue)}.${warn}`)) return;
    setBusy(true);
    try {
      const res = await api('/api/contracts', { groups: groups.map(g => g.map(i => i.id)) });
      if (res.discovered?.length) await refreshConfig();
      removeItems(res.consumed);
      const got: Item[] = res.results.map((r: any) => r.item);
      S.items = [...got.slice().reverse(), ...S.items];
      applyState(res.state);
      setSlots([]);
      const best = [...got].sort((a, b) => rarityIdx(person(b.person).rarity) - rarityIdx(person(a.person).rarity))[0];
      const bestR = person(best.person).rarity;
      Sound.reveal(bestR);
      if (rarityIdx(bestR) >= rarityIdx('gold') || got.some(i => isSpecial(i.variant))) confetti(GOLDS.concat(RAINBOW), 160);
      announceFirsts(got);
      setResults({ got, stake: bulkValue });
    } catch (e: any) { Sound.error(); toast(e.message, true); }
    setBusy(false);
  };

  return (
    <>
      <PageHero icon={Hammer} title="Kontrakty" lead={<>Połącz kilka kart tej samej rzadkości w jedną kartę wyższej rzadkości. Karty w specjalnych wariantach zwiększają szansę na wariant. Ulubione i karty specjalne nie trafiają do kuźni. Ulepszacz jest w Kasynie.</>} />
      <div className={styles.cols}>
        <section className={styles.panel} aria-label="Twoje karty">
          <div className={styles.tiers} role="group" aria-label="Rzadkość">
            {tiers.map(t => (
              <button key={t} type="button" aria-pressed={t === tier} onClick={() => { setTier(t); setSlots([]); Sound.click(); }}>
                <i style={{ background: cfg.rarities[t].color }} />{cfg.rarities[t].name}<small>{forgeItems().filter(i => person(i.person).rarity === t).length}</small>
              </button>
            ))}
          </div>
          <div className={styles.tools}>
            <SearchField value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj karty" aria-label="Szukaj karty" />
            <SortSelect value={sort} onChange={setSort} />
          </div>
          <div className={`pick-grid ${styles.picks}`}>
            {eligible.slice(0, PICK_LIMIT).map(i => <PickTile key={i.id} item={i} onClick={() => add(i.id)} />)}
            {!eligible.length && <p className="muted">{q.trim() ? 'Żadna karta nie pasuje do wyszukiwania.' : `Nie masz więcej kart rzadkości ${R.name}.`}</p>}
          </div>
        </section>

        <section className={styles.panel} aria-label="Kontrakt">
          <h2 className={styles.title}>{need} × <span style={{ color: R.color }}>{R.name}</span> daje 1 × <span style={{ color: NR.color }}>{NR.name}</span></h2>
          <div className={styles.slots}>
            {Array.from({ length: need }, (_, k) => slotItems[k]
              ? <button key={slotItems[k].id} type="button" className={styles.slot} onClick={() => { setSlots(slots.filter(id => id !== slotItems[k].id)); Sound.click(); }} aria-label="Wyjmij z kontraktu"><Card person={slotItems[k].person} variant={slotItems[k].variant} tilt={false} /><X className={styles.remove} size={18} aria-hidden="true" /></button>
              : <div key={k} className={styles.empty}>{k + 1}</div>)}
          </div>
          <div className={styles.flow}><ArrowDown size={20} aria-hidden="true" /><span style={{ color: NR.color }}>{NR.name}</span></div>
          <dl className={styles.facts}>
            <div><dt>Wkład</dt><dd>{fmt(stake)}</dd></div>
            <div><dt>Wynik</dt><dd>{fmt(NR.value)}+</dd></div>
            <div><dt>Szansa na wariant</dt><dd>{pct(variantChance(specials))}</dd></div>
          </dl>
          <div className={styles.row}>
            <Button onClick={() => autoFill()}>Uzupełnij duplikatami</Button>
            <Button disabled={!slots.length} onClick={() => { setSlots([]); Sound.click(); }}>Wyczyść</Button>
            <Button kind="hue" big disabled={busy || slotItems.length !== need} onClick={sign}>Podpisz kontrakt</Button>
          </div>
          <div className={styles.bulk}>
            <h3>Wiele kontraktów naraz</h3>
            <div className={styles.stepper}>
              <button type="button" aria-label="Mniej" disabled={bulkN <= 1} onClick={() => setBulk({ ...bulk, n: Math.max(1, bulkN - 1) })}><Minus size={16} /></button>
              <b>{bulkN}</b>
              <button type="button" aria-label="Więcej" disabled={bulkN >= maxBulk} onClick={() => setBulk({ ...bulk, n: Math.min(maxBulk, bulkN + 1) })}><Plus size={16} /></button>
              <Button kind="quiet" disabled={!maxBulk} onClick={() => setBulk({ ...bulk, n: maxBulk })}>Najwięcej ({maxBulk})</Button>
            </div>
            <label><input type="checkbox" checked={bulk.dupes} onChange={e => setBulk({ ...bulk, dupes: e.target.checked })} /> tylko duplikaty (zostaje po 1 karcie każdej osoby)</label>
            <label><input type="checkbox" checked={bulk.keepSpecial} onChange={e => setBulk({ ...bulk, keepSpecial: e.target.checked })} /> pomiń karty w specjalnych wariantach</label>
            <p className="muted small">{maxBulk ? `Zużyjesz ${bulkItems.length} ${plural(bulkItems.length, 'kartę', 'karty', 'kart')} (${fmt(bulkValue)}), najpierw najtańsze. Ulubione i karty z gabloty zostają.` : 'Za mało kart tej rzadkości przy tych ustawieniach.'}</p>
            <Button disabled={busy || !bulkN} onClick={runBulk}>Wykonaj {bulkN} {kontrakt(bulkN)}</Button>
          </div>
          {ways && (
            <div>
              <h3 className={styles.sub}>Możliwe wyniki</h3>
              {ways.length ? <div className={styles.ways}>{ways.map(([id, ch]) => <span key={id} title={person(id).name}><img src={person(id).masked ? `/img/${id}` : imgUrl(id, null, true)} alt={person(id).name} loading="lazy" /><small>{pct(ch)}</small></span>)}</div>
                : <p className="muted small">W skrzynkach ze sklepu nie ma kart wyższej rzadkości.</p>}
            </div>
          )}
        </section>
      </div>
      {results && <BulkResults got={results.got} stake={results.stake} onClose={() => setResults(null)} />}
    </>
  );
}
