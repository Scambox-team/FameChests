import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Tag, Trophy } from 'lucide-react';

import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { cardMatches, crateList, filterVariants, isSpecial, person, plural, searchMatch, searchNorm, variantName } from '../../game/rules';
import { applyState, refreshBadges, refreshConfig } from '../../game/session';
import { S, touch, useGame } from '../../game/store';
import type { Reveal } from '../../game/reveal';
import { fmt } from '../../lib/format';
import { timeAgo } from '../../lib/time';
import { Sound } from '../../sound/sound';
import { AskAmount } from '../../ui/AskAmount';
import { Button } from '../../ui/Button';
import { SearchField, Select, Tabs } from '../../ui/Field';
import { toast } from '../../ui/Toaster';
import { UserLink } from '../../ui/UserLink';
import { noteMarketBonus } from './bonus';
import { MineTab } from './MineTab';
import { SellTab } from './SellTab';
import { WantedTab } from './WantedTab';
import styles from './MarketPage.module.css';

export const revealOf = (x: any, imgq: string): Reveal | undefined => x.reveal ? { map: { [x.person]: x.reveal }, imgq } : undefined;

export function timeLeft(end: number) {
  const s = Math.max(0, Math.round(end - Date.now() / 1000));
  if (s <= 0) return 'kończy się';
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} godz.`;
  if (h) return `${h} godz. ${m} min`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export interface Filters { q: string; rarity: string; variant: string; kind: string; sort: string; crate: string }
export function matches(x: any, f: Filters) {
  const p = person(x.person);
  if (f.q && !(p.masked ? searchMatch(searchNorm(`??? ${variantName(x.variant)} ${S.cfg.rarities[p.rarity].name}`), f.q) : cardMatches(x, f.q))) return false;
  if (f.rarity !== 'all' && p.rarity !== f.rarity) return false;
  if (f.variant === 'special' ? !isSpecial(x.variant) : f.variant !== 'all' && x.variant !== f.variant) return false;
  if (f.crate !== 'all' && !(p.crates || [p.crate]).includes(f.crate)) return false;
  return true;
}

export function FilterBar({ f, set, listings = true }: { f: Filters; set: (p: Partial<Filters>) => void; listings?: boolean }) {
  const { cfg } = useGame();
  return (
    <div className={styles.tools}>
      <SearchField value={f.q} onChange={e => set({ q: e.target.value })} placeholder="Szukaj karty" aria-label="Szukaj karty" />
      {listings && <Select value={f.kind} onChange={e => set({ kind: e.target.value })} aria-label="Rodzaj oferty"><option value="all">Wszystkie oferty</option><option value="fixed">Kup teraz</option><option value="auction">Licytacje</option></Select>}
      <Select value={f.rarity} onChange={e => set({ rarity: e.target.value })} aria-label="Rzadkość"><option value="all">Każda rzadkość</option>{cfg.rarityOrder.map(r => <option key={r} value={r}>{cfg.rarities[r].name}</option>)}</Select>
      <Select value={f.variant} onChange={e => set({ variant: e.target.value })} aria-label="Wariant"><option value="all">Każdy wariant</option><option value="special">Tylko specjalne</option>{filterVariants().map(v => <option key={v} value={v}>{variantName(v)}</option>)}</Select>
      <Select value={f.crate} onChange={e => set({ crate: e.target.value })} aria-label="Skrzynka"><option value="all">Każda skrzynka</option>{crateList().map(c => <option key={c.id} value={c.id}>{c.short}</option>)}</Select>
      {listings && <Select value={f.sort} onChange={e => set({ sort: e.target.value })} aria-label="Sortowanie"><option value="new">Najnowsze</option><option value="cheap">Najtańsze</option><option value="expensive">Najdroższe</option><option value="ending">Kończące się</option><option value="deal">Najlepsza okazja</option></Select>}
    </div>
  );
}

export interface MarketApi {
  data: any;
  act: (fn: () => Promise<any>, ok?: string) => Promise<any>;
  refresh: () => void;
}

export function ListingCard({ l, m, showSeller = true, onAsk }: { l: any; m: MarketApi; showSeller?: boolean; onAsk: (a: any) => void }) {
  const auction = l.kind === 'auction';
  const current = auction ? l.topBid || l.price : l.price;
  const diff = l.value ? Math.round((current / l.value - 1) * 100) : 0;
  const reveal = revealOf(l, `market=${l.id}`);
  const name = person(l.person).masked ? 'tajną kartę' : person(l.person).name;
  const buy = async () => {
    if (S.state.balance < l.price) { Sound.error(); return toast('Za mało pieniędzy', true); }
    if (!confirm(`Kupić ${name}${isSpecial(l.variant) ? ` (${variantName(l.variant)})` : ''} za ${fmt(l.price)}?`)) return;
    const res = await m.act(() => api(`/api/market/${l.id}/buy`, {}));
    refreshBadges();
    if (!res) return;
    S.items = [res.item, ...S.items].sort((a, b) => b.id - a.id);
    S.collected.add(`${res.item.person}|${res.item.variant}`);
    if (person(res.item.person).masked) await refreshConfig();
    touch();
    Sound.win();
    toast(`Kupiono: ${person(res.item.person).name}, karta jest w ekwipunku`);
    noteMarketBonus(res.bonus);
  };
  const cancel = async () => {
    if (!confirm('Wycofać ofertę? Karta wróci do ekwipunku.')) return;
    const res = await m.act(() => api(`/api/market/${l.id}/cancel`, {}), 'Oferta wycofana, karta wróciła do ekwipunku');
    if (res?.item) { S.items = [res.item, ...S.items].sort((a, b) => b.id - a.id); touch(); }
  };
  return (
    <article className={`${styles.item}${l.mine ? ` ${styles.mine}` : ''}`}>
      <button className={styles.card} type="button" onClick={() => openViewer(l.person, l.variant, l.item)} aria-label={`Podgląd: ${name}`}><Card person={l.person} variant={l.variant} uid={l.item} reveal={reveal} tilt={false} /></button>
      <div className={styles.info}>
        <div className={styles.kind}>{auction ? <><Gavel size={15} aria-hidden="true" />Licytacja · {timeLeft(l.endsAt)}</> : <><Tag size={15} aria-hidden="true" />Kup teraz</>}</div>
        <div className={styles.price}>{auction ? (l.topBid ? <><small>Najwyższa oferta</small>{fmt(l.topBid)}<small> {l.topBidder || ''}</small></> : <><small>Cena wywoławcza</small>{fmt(l.price)}</>) : fmt(l.price)}</div>
        <div className="muted small">wartość karty {fmt(l.value)} <span className={diff > 0 ? styles.up : styles.down}>{diff > 0 ? '+' : ''}{diff}%</span>{auction ? ` · ${l.bids} ${plural(l.bids, 'oferta', 'oferty', 'ofert')} · przebicie min. ${fmt(l.step)}` : ''}</div>
        {showSeller && l.seller && <div className={styles.seller}><UserLink user={l.seller} /><span className="muted small">{timeAgo(l.created)}</span></div>}
        <div className={styles.acts}>
          {l.mine ? <>
            <span className="muted small">Twoja oferta</span>
            {(!auction || !l.topBid) && <Button onClick={cancel}>Wycofaj</Button>}
          </> : auction ? (l.myTop ? <span className={styles.lead}><Trophy size={15} aria-hidden="true" />Prowadzisz</span> : <Button kind="hue" onClick={() => onAsk({ type: 'bid', l })}>Licytuj</Button>) : <>
            <Button kind="hue" onClick={buy}>Kup</Button>
            {l.myOffer
              ? <><span className="muted small">Twoja propozycja: {fmt(l.myOffer.price)}</span><Button onClick={() => m.act(() => api(`/api/market/offers/${l.myOffer.id}/cancel`, {}), 'Propozycja wycofana, pieniądze wróciły')}>Wycofaj</Button></>
              : <Button onClick={() => onAsk({ type: 'offer', l })}>Zaproponuj cenę</Button>}
          </>}
        </div>
      </div>
    </article>
  );
}

function BuyTab({ m, f, set, onAsk }: { m: MarketApi; f: Filters; set: (p: Partial<Filters>) => void; onAsk: (a: any) => void }) {
  const cur = (l: any) => l.kind === 'auction' ? l.topBid || l.price : l.price;
  const by: Record<string, (a: any, b: any) => number> = {
    new: (a, b) => b.id - a.id, cheap: (a, b) => cur(a) - cur(b), expensive: (a, b) => cur(b) - cur(a),
    ending: (a, b) => (a.endsAt || 9e12) - (b.endsAt || 9e12), deal: (a, b) => cur(a) / a.value - cur(b) / b.value
  };
  const list = m.data.listings.filter((l: any) => !l.mine && (f.kind === 'all' || l.kind === f.kind) && matches(l, f)).sort(by[f.sort]);
  return (
    <>
      <FilterBar f={f} set={set} />
      <p className="muted small">Kup teraz: kupujesz od razu albo proponujesz niższą cenę, a pieniądze czekają na decyzję sprzedającego. Licytacja: wygrywa najwyższa oferta, przebity gracz od razu dostaje pieniądze z powrotem.</p>
      <div className={styles.grid}>
        {list.map((l: any) => <ListingCard key={l.id} l={l} m={m} onAsk={onAsk} />)}
        {!list.length && <p className="muted">{m.data.listings.some((l: any) => !l.mine) ? 'Brak ofert pasujących do filtrów.' : 'Na rynku nie ma jeszcze żadnych ofert. Wystaw swoją kartę w zakładce Sprzedaj.'}</p>}
      </div>
    </>
  );
}

export function MarketPage() {
  const client = useQueryClient();
  const { data, refetch, error } = useQuery({ queryKey: ['market'], queryFn: () => api('/api/market'), refetchInterval: 30_000 });
  const [tab, setTab] = useState<'buy' | 'wanted' | 'sell' | 'mine'>('buy');
  const [f, setF] = useState<Filters>({ q: '', rarity: 'all', variant: 'all', kind: 'all', sort: 'new', crate: 'all' });
  const [ask, setAsk] = useState<any>(null);
  const [, tick] = useState(0);
  const set = (p: Partial<Filters>) => setF(x => ({ ...x, ...p }));

  useEffect(() => { document.title = 'Rynek · ScamBox'; S.badges.market = 0; touch(); }, []);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, []);   // odliczanie licytacji

  const m: MarketApi = useMemo(() => ({
    data,
    refresh: () => { refetch(); client.invalidateQueries({ queryKey: ['market'] }); },
    act: async (fn, ok) => {
      try {
        const res = await fn();
        if (res?.state) applyState(res.state);
        if (ok) toast(ok);
        Sound.coin(1);
        return res;
      } catch (e: any) { Sound.error(); toast(e.message, true); return null; }
      finally { refetch(); }
    }
  }), [data]);

  if (error) return <p className="muted">{(error as Error).message}</p>;
  if (!data) return <p className="muted">Wczytuję rynek</p>;
  const pending = data.listings.filter((l: any) => l.mine).reduce((a: number, l: any) => a + l.offers.length, 0);

  const closeAsk = async (v: number | null) => {
    const a = ask;
    setAsk(null);
    if (!v) return;
    if (a.type === 'offer') await m.act(() => api(`/api/market/${a.l.id}/offer`, { price: v }), 'Propozycja wysłana, pieniądze są zablokowane');
    else await m.act(() => api(`/api/market/${a.l.id}/bid`, { amount: v }), 'Prowadzisz w licytacji');
  };
  const bidMin = ask?.type === 'bid' ? (ask.l.topBid ? ask.l.topBid + Math.max(1, ask.l.step) : ask.l.price) : 0;

  return (
    <>
      <Tabs label="Rynek" value={tab} onChange={v => { setTab(v); Sound.click(); }} items={[
        { id: 'buy', label: 'Kupuj', count: data.listings.filter((l: any) => !l.mine).length },
        { id: 'wanted', label: 'Szukam', count: data.wanted.length },
        { id: 'sell', label: 'Sprzedaj' },
        { id: 'mine', label: 'Moje', count: pending || undefined }
      ]} />
      {tab === 'buy' && <BuyTab m={m} f={f} set={set} onAsk={setAsk} />}
      {tab === 'wanted' && <WantedTab m={m} f={f} set={set} />}
      {tab === 'sell' && <SellTab m={m} />}
      {tab === 'mine' && <MineTab m={m} onAsk={setAsk} />}
      {ask?.type === 'offer' && <AskAmount title="Zaproponuj cenę" min={1} value={Math.max(1, Math.round(ask.l.price * .85))} ok="Wyślij propozycję" onClose={closeAsk}>Cena: <b>{fmt(ask.l.price)}</b>, wartość karty {fmt(ask.l.value)}. Kwota zostanie zablokowana, dopóki sprzedający jej nie przyjmie albo nie odrzuci. Możesz ją też wycofać.</AskAmount>}
      {ask?.type === 'bid' && <AskAmount title="Licytuj" min={bidMin} value={bidMin} ok="Licytuj" onClose={closeAsk}>{ask.l.topBid ? `Najwyższa oferta: ${fmt(ask.l.topBid)}` : `Cena wywoławcza: ${fmt(ask.l.price)}`}, najmniej możesz dać {fmt(bidMin)}. Jeśli ktoś cię przebije, kwota od razu wróci na twoje konto.</AskAmount>}
    </>
  );
}

