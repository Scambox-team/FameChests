import { memo, useEffect, useMemo, useState } from 'react';
import { Maximize2, Repeat, ShoppingCart, Star } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import { Backpack } from 'lucide-react';
import { PageHero } from '../../ui/PageHero';

import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { dupesOf, ownedMap, sellIds, setFavorite } from '../../game/actions';
import { withReveal } from '../../game/reveal';
import { cardMatches, filterVariants, isSpecial, person, plural, rarityIdx, seenCrateList, sellableCard, sortCards, varRank } from '../../game/rules';
import { S, touch, useGame } from '../../game/store';
import type { Item } from '../../game/types';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { SearchField, Select } from '../../ui/Field';
import { toast } from '../../ui/Toaster';
import { ChestShelf } from './ChestShelf';
import { StickersTab } from '../stickers/StickersTab';
import { Tabs } from '../../ui/Field';
import { ufoAbduct, ufoArrive, ufoLeave } from './ufo';
import { VariantPicker, variantMatches, type VariantValue } from '../../ui/VariantPicker';
import styles from './InventoryPage.module.css';

const PAGE = 120;
const SORTS: [string, string][] = [['new', 'Najnowsze'], ['value', 'Wartość'], ['rarity', 'Rzadkość'], ['name', 'Nazwa'], ['dupes', 'Duplikaty: najwięcej'], ['dupesValue', 'Duplikaty: najdroższe']];

interface Filters { crate: string; rarity: string; variant: VariantValue; sort: string; q: string }
const savedSort = () => { try { const s = localStorage.getItem('invSort'); return SORTS.some(x => x[0] === s) ? s! : 'new'; } catch { return 'new'; } };
const filters: Filters = { crate: 'all', rarity: '', variant: { base: 'all', layer: null }, sort: savedSort(), q: '' };   // zostają po wyjściu z ekranu

function filtered(f: Filters, items: Item[] = S.items) {
  const list = items.filter(i => {
    const p = person(i.person);
    return (f.crate === 'all' || (p.crates || [p.crate]).includes(f.crate)) && (!f.rarity || p.rarity === f.rarity) && cardMatches(i, f.q) &&
      (f.variant.base === 'fav' ? i.fav : f.variant.base === 'special' ? isSpecial(i.variant) : variantMatches(i.variant, f.variant));
  });
  const byName = (a: Item, b: Item) => person(a.person).name.localeCompare(person(b.person).name, 'pl');
  if (f.sort.startsWith('dupes')) return sortCards(list, f.sort);
  const by: Record<string, (a: Item, b: Item) => number> = {
    new: (a, b) => b.id - a.id,
    value: (a, b) => b.value - a.value || b.id - a.id,
    rarity: (a, b) => rarityIdx(person(b.person).rarity) - rarityIdx(person(a.person).rarity) || varRank(b.variant) - varRank(a.variant) || byName(a, b),
    name: (a, b) => byName(a, b) || varRank(b.variant) - varRank(a.variant)
  };
  return list.sort(by[f.sort]);
}

// `fav` idzie osobnym propem: setFavorite zmienia `item.fav` w miejscu (ten sam obiekt), więc samo porównanie item.fav w memo nigdy by nie zobaczyło zmiany
const Tile = memo(function Tile({ item, selected, fav: isFav, onToggle }: { item: Item; selected: boolean; fav: boolean; onToggle: (id: number) => void }) {
  const fav = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { await setFavorite([item.id], !isFav); } catch (err: any) { Sound.error(); toast(err.message, true); }
  };
  const zoom = (e: React.MouseEvent) => { e.stopPropagation(); openViewer(item.person, item.variant, item.id); };
  return (
    <div className={`${styles.tile}${selected ? ` ${styles.sel}` : ''}`} role="button" tabIndex={0} aria-pressed={selected}
      onClick={() => onToggle(item.id)} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(item.id); } }}
      onContextMenu={e => { e.preventDefault(); openViewer(item.person, item.variant, item.id); }}>
      <Card person={item.person} variant={item.variant} uid={item.id} />
      <button className={`${styles.pin} ${styles.fav}${isFav ? ` ${styles.on}` : ''}`} type="button" onClick={fav} aria-label={isFav ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'} title={isFav ? 'Ulubiona: nie da się jej sprzedać ani zużyć' : 'Dodaj do ulubionych'}>
        <Star size={15} fill={isFav ? 'currentColor' : 'none'} />
      </button>
      <button className={`${styles.pin} ${styles.zoom}`} type="button" onClick={zoom} aria-label="Powiększ"><Maximize2 size={15} /></button>
    </div>
  );
}, (a, b) => a.selected === b.selected && a.fav === b.fav && a.item.id === b.item.id);

function RarityCounts({ value, onChange, items }: { value: string; onChange: (r: string) => void; items: Item[] }) {
  const { cfg } = useGame();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    items.forEach(i => { const r = person(i.person)?.rarity; c[r] = (c[r] || 0) + 1; });
    return c;
  }, [items]);
  return (
    <div className={styles.counts} role="group" aria-label="Rzadkość">
      <button type="button" aria-pressed={!value} onClick={() => onChange('')}><span>Wszystkie</span><b>{items.length.toLocaleString('pl-PL')}</b></button>
      {cfg.rarityOrder.map(r => (
        <button key={r} type="button" aria-pressed={value === r} onClick={() => onChange(value === r ? '' : r)}>
          <span><i style={{ background: cfg.rarities[r].color }} />{cfg.rarities[r].name}</span><b>{(counts[r] || 0).toLocaleString('pl-PL')}</b>
        </button>
      ))}
    </div>
  );
}

function SellBar({ selected, shown, clear, all }: { selected: Set<number>; shown: Item[]; clear: () => void; all: () => void }) {
  const { items } = useGame();
  const sel = items.filter(i => selected.has(i.id) && !i.fav && sellableCard(i.person));
  const value = sel.reduce((a, i) => a + i.value, 0);
  const sellSelected = async () => {
    const rare = sel.filter(i => rarityIdx(person(i.person).rarity) >= rarityIdx('gold'));
    if ((rare.length || value >= 1000) && !confirm(`Sprzedać ${sel.length} ${plural(sel.length, 'kartę', 'karty', 'kart')} za ${fmt(value)}?${rare.length ? `\nW tym ${rare.length} legendarnych lub lepszych.` : ''}`)) return;
    try { await sellIds(sel.map(i => i.id)); clear(); } catch (e: any) { Sound.error(); toast(e.message, true); }
  };
  const sellDupes = async (perVariant: boolean) => {
    const ids = Object.values(ownedMap()).flatMap(o => dupesOf(o, perVariant));
    if (!ids.length) return toast(perVariant ? 'Nie masz duplikatów w tym samym wariancie.' : 'Nie masz duplikatów.');
    const sold = new Set(ids), val = S.items.filter(i => sold.has(i.id)).reduce((a, i) => a + i.value, 0);
    if (!confirm(`Sprzedać ${ids.length} ${plural(ids.length, 'duplikat', 'duplikaty', 'duplikatów')} za ${fmt(val)}?\n(Z każdej osoby zostanie ${perVariant ? 'po 1 karcie w każdym wariancie, także bez wariantu' : '1 karta w najlepszym wariancie'}.)`)) return;
    try { await sellIds(ids); } catch (e: any) { Sound.error(); toast(e.message, true); }
  };
  return (
    <div className={styles.sellbar}>
      <span className={styles.selInfo}>Zaznaczono {sel.length}{sel.length ? ` (${fmt(value)})` : ''}</span>
      <Button onClick={all} disabled={!shown.length}>Zaznacz wszystkie</Button>
      <Button onClick={clear} disabled={!sel.length}>Odznacz</Button>
      <Button onClick={() => sellDupes(false)} title="Z każdej osoby zostaje 1 karta w najlepszym wariancie i ulubione">Sprzedaj duplikaty</Button>
      <Button onClick={() => sellDupes(true)} title="Z każdej osoby zostaje po 1 karcie w każdym wariancie i ulubione">Zostaw po 1 z wariantu</Button>
      <Button kind="hue" onClick={sellSelected} disabled={!sel.length}>Sprzedaj zaznaczone</Button>
    </div>
  );
}

/** Karta cudzego gracza w trybie „cudzy ekwipunek”: te same kafelki co we własnym, ale bez zaznaczania, ulubionych i sprzedaży; zamiast tego podgląd i wymiana */
export interface OtherMode {
  reveal: { map?: Record<string, any>; imgq?: string };
  canTrade: boolean;
  onTrade: (item: Item) => void;
  onBuy?: (item: Item) => void;
}

const OtherTile = memo(function OtherTile({ item, other }: { item: Item; other: OtherMode }) {
  const zoom = () => withReveal(other.reveal, () => openViewer(item.person, item.variant));
  return (
    <div className={styles.tile} role="button" tabIndex={0} onClick={zoom} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); zoom(); } }}>
      <Card person={item.person} variant={item.variant} reveal={other.reveal} />
      <button className={`${styles.pin} ${styles.zoom}`} type="button" onClick={e => { e.stopPropagation(); zoom(); }} aria-label="Podgląd karty" title="Podgląd karty"><Maximize2 size={15} /></button>
      {other.canTrade && <button className={`${styles.pin} ${styles.trade}`} type="button" onClick={e => { e.stopPropagation(); other.onTrade(item); }} aria-label="Zaproponuj wymianę za tę kartę" title="Zaproponuj wymianę za tę kartę"><Repeat size={15} /></button>}
      {other.canTrade && other.onBuy && <button className={`${styles.pin} ${styles.buy}`} type="button" onClick={e => { e.stopPropagation(); other.onBuy!(item); }} aria-label="Kup tę kartę" title="Zlecenie kupna tej karty"><ShoppingCart size={15} /></button>}
    </div>
  );
}, (a, b) => a.item.id === b.item.id && a.other === b.other);

/** Karty (własne albo, z `other`, cudzego gracza): chmura rzadkości, wyszukiwarka, filtry, sortowanie i siatka - jeden komponent dla obu trybów */
export function CardsView({ items, other }: { items: Item[]; other?: OtherMode }) {
  const game = useGame();
  const [, redraw] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const set = (patch: Partial<Filters>) => { Object.assign(filters, patch); setLimit(PAGE); redraw(n => n + 1); };
  const list = useMemo(() => withReveal(other?.reveal, () => filtered(filters, items)), [items, other, filters.crate, filters.rarity, filters.variant.base, filters.variant.layer, filters.sort, filters.q]);
  const total = useMemo(() => list.reduce((a, i) => a + i.value, 0), [list]);
  const inCrate = (id: string) => items.filter(i => { const p = person(i.person); return (p.crates || [p.crate]).includes(id); }).length;
  const toggle = (id: number) => {
    Sound.click();
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const ufo = !other && game.ufo?.shown && !game.ufo.abducting ? person(game.ufo.pid) : null;

  return (
    <>
      {!other && <ChestShelf />}
      <RarityCounts value={filters.rarity} onChange={r => set({ rarity: r })} items={items} />
      <div className={styles.tools}>
        <SearchField value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Szukaj: nazwa, wariant, rzadkość" aria-label="Szukaj kart" />
        <Select value={filters.crate} onChange={e => set({ crate: e.target.value })} aria-label="Skrzynka">
          <option value="all">Wszystkie skrzynki ({items.length})</option>
          {seenCrateList().map(c => <option key={c.id} value={c.id}>{c.short} ({inCrate(c.id)})</option>)}
        </Select>
        <VariantPicker value={filters.variant} onChange={v => set({ variant: v })} variants={filterVariants(items)} extra={other ? [['special', 'Tylko specjalne']] : [['fav', 'Tylko ulubione'], ['special', 'Tylko specjalne']]} />
        <Select className={styles.sort} value={filters.sort} aria-label="Sortowanie" onChange={e => {
          set({ sort: e.target.value });
          try { localStorage.setItem('invSort', e.target.value); } catch { /* bez zapamiętania */ }
        }}>
          {SORTS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </Select>
      </div>
      <p className="muted">Kart: <b>{list.length.toLocaleString('pl-PL')}</b>, wartość: <b>{fmt(total)}</b>{list.length !== items.length ? ` (wszystkich: ${items.length.toLocaleString('pl-PL')})` : ''}</p>
      <section className={styles.grid} aria-label="Karty">
        {ufo && <div className={`${styles.tile} ufo-item`} role="button" tabIndex={0} onClick={e => ufoAbduct(e.currentTarget)}><Card person={ufo.id} variant={ufo.fixedVariant || 'ufo'} /></div>}
        {list.slice(0, limit).map(i => other ? <OtherTile key={i.id} item={i} other={other} /> : <Tile key={i.id} item={i} selected={selected.has(i.id)} fav={i.fav} onToggle={toggle} />)}
        {!list.length && <p className={styles.empty}>{items.length ? 'Brak kart pasujących do filtrów.' : other ? 'Ten gracz nie ma żadnych kart.' : 'Ekwipunek jest pusty. Otwórz jakąś skrzynkę.'}</p>}
      </section>
      {list.length > limit && <div className={styles.more}><Button onClick={() => setLimit(l => l + PAGE)}>Pokaż więcej ({(list.length - limit).toLocaleString('pl-PL')})</Button></div>}
      {!other && game.items.length > 0 && <SellBar selected={selected} shown={list} clear={() => setSelected(new Set())} all={() => setSelected(new Set(list.map(i => i.id)))} />}
    </>
  );
}

function MyCards() {
  const game = useGame();
  return <CardsView items={game.items} />;
}

// wybrana zakładka zostaje po wyjściu z ekranu
let invTab: 'cards' | 'stickers' = 'cards';

export function InventoryPage() {
  const { pathname } = useLocation();
  const game = useGame();
  const [tab, setTab] = useState(invTab);
  invTab = tab;
  useEffect(() => {
    document.title = 'Ekwipunek · ScamBox';
    ufoArrive();
    touch();
    return ufoLeave;
  }, []);
  // Hall of Fame jest teraz w rankingu, a figury w szachach
  if (pathname.endsWith('/hall-of-fame')) return <Navigate to="/ranking/hall-of-fame" replace />;
  if (pathname.endsWith('/figures')) return <Navigate to="/games/figures" replace />;
  return (
    <>
      <PageHero icon={Backpack} title="Twoje karty" lead="Wszystko, co masz: karty i skrzynki do otwarcia. Kliknij kartę, żeby ją zaznaczyć, ikoną obok, żeby ją obejrzeć."
        stats={[['Karty', game.items.length.toLocaleString('pl-PL')], ['Wartość', fmt(game.items.reduce((a, i) => a + i.value, 0))], ['Ulubione', String(game.items.filter(i => i.fav).length)]]} />
      <Tabs label="Ekwipunek" value={tab} onChange={setTab} items={[{ id: 'cards', label: 'Karty' }, { id: 'stickers', label: 'Naklejki', count: game.stk?.items.length }]} />
      {tab === 'cards' ? <MyCards /> : <><ChestShelf /><StickersTab /></>}
    </>
  );
}
