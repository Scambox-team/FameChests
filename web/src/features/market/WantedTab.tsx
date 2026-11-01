import { useState } from 'react';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { PickTile } from '../../cards/PickTile';
import { SortSelect, UNIQUE_SORTS } from '../../cards/cardSorts';
import { removeItems } from '../../game/actions';
import { cardValue, isSpecial, person, possibleVariants, searchMatch, searchNorm, sortCards, variantName } from '../../game/rules';
import { S, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { timeAgo } from '../../lib/time';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { SearchField, Select } from '../../ui/Field';
import { toast } from '../../ui/Toaster';
import { UserLink } from '../../ui/UserLink';
import { FilterBar, matches, revealOf, type Filters, type MarketApi } from './MarketPage';
import styles from './MarketPage.module.css';

const ORDER_SORTS: [string, string][] = [['new', 'Najnowsze'], ['priceDesc', 'Najwyższa cena'], ['priceAsc', 'Najniższa cena'], ['rarity', 'Rzadkość'], ['name', 'Nazwa']];
const myItemFor = (pid: string, variant: string) => S.items.find(i => i.person === pid && i.variant === variant && !i.fav);

export function WantedTab({ m, f, set }: { m: MarketApi; f: Filters; set: (p: Partial<Filters>) => void }) {
  const game = useGame();
  const [w, setW] = useState({ q: '', person: null as string | null, variant: 'normal', price: '', onlyMine: false, sortFound: 'rarity', sortOrders: 'new' });
  const up = (p: Partial<typeof w>) => setW(x => ({ ...x, ...p }));
  const sel = w.person ? person(w.person) : null;
  const found = w.q.trim() ? sortCards(Object.values(game.cfg.people).filter(p => !p.masked && searchMatch(searchNorm(p.name), w.q)).map(p => ({ id: p.id, person: p.id, variant: 'normal', value: cardValue(p.id) })), w.sortFound).slice(0, 30) : [];
  const sortOrders = (list: any[]) => {
    if (w.sortOrders === 'new') return [...list].sort((a, b) => b.id - a.id);
    if (w.sortOrders === 'priceDesc') return [...list].sort((a, b) => b.price - a.price || b.id - a.id);
    if (w.sortOrders === 'priceAsc') return [...list].sort((a, b) => a.price - b.price || b.id - a.id);
    return sortCards(list, w.sortOrders);
  };
  const orders = sortOrders(m.data.wanted.filter((o: any) => matches(o, f) && (!w.onlyMine || (!o.mine && myItemFor(o.person, o.variant)))));
  const value = sel ? cardValue(sel.id, w.variant) : 0;
  const listed = sel ? m.data.listings.filter((l: any) => l.person === sel.id && l.variant === w.variant && !l.mine) : [];

  const add = async () => {
    const price = +(w.price || value);
    if (!w.person || !price) return;
    if (price > S.state.balance) { Sound.error(); return toast('Za mało pieniędzy', true); }
    const res = await m.act(() => api('/api/market/wanted', { person: w.person, variant: w.variant, price }), 'Zlecenie dodane, pieniądze czekają na sprzedającego');
    if (res) up({ person: null, price: '', q: '' });
  };
  const fill = async (o: any) => {
    const it = myItemFor(o.person, o.variant);
    if (!it) return toast('Nie masz tej karty (ulubionych nie sprzedajemy)', true);
    if (!confirm(`Sprzedać ${person(o.person).name}${isSpecial(o.variant) ? ` (${variantName(o.variant)})` : ''} graczowi ${o.buyer?.username || ''} za ${fmt(o.price)}?`)) return;
    const res = await m.act(() => api(`/api/market/wanted/${o.id}/fill`, { item: it.id }), `Sprzedano za ${fmt(o.price)}`);
    if (res) removeItems(res.consumed);
  };

  return (
    <div className={styles.cols}>
      <section className={styles.panel}>
        <h2>Szukam karty</h2>
        <p className="muted small">Ustal cenę, za którą kupisz kartę. Pieniądze są blokowane, a każdy, kto ma tę kartę, może ci ją od razu sprzedać.</p>
        <div className={styles.tools}>
          <SearchField value={w.q} onChange={e => up({ q: e.target.value })} placeholder="Wpisz nazwę karty" aria-label="Nazwa karty" />
          <SortSelect value={w.sortFound} onChange={v => up({ sortFound: v })} options={UNIQUE_SORTS.filter(([k]) => k !== 'variant')} />
        </div>
        {found.length > 0 && <div className={styles.picks}>{found.map(c => <PickTile key={c.person} item={c as any} selected={c.person === w.person} onClick={() => { up({ person: c.person, variant: 'normal', price: '' }); Sound.click(); }} />)}</div>}
        {sel && (
          <div className={styles.form}>
            <Card person={sel.id} variant={w.variant} className={styles.formCard} />
            <div className={styles.fields}>
              <label>Wariant<Select value={w.variant} onChange={e => up({ variant: e.target.value, price: '' })}>{possibleVariants(sel).map(v => <option key={v} value={v}>{variantName(v)} ({fmt(cardValue(sel.id, v))})</option>)}</Select></label>
              <label>Zapłacę<input type="number" min={1} value={w.price || value} onChange={e => up({ price: e.target.value })} /></label>
              <p className="muted small">Wartość karty: {fmt(value)}{listed.length ? `, na rynku od ${fmt(Math.min(...listed.map((l: any) => l.kind === 'auction' ? l.topBid || l.price : l.price)))}` : ''}</p>
              <Button kind="hue" onClick={add}>Dodaj zlecenie</Button>
            </div>
          </div>
        )}
      </section>
      <section className={styles.side}>
        <FilterBar f={f} set={set} listings={false} />
        <div className={styles.tools}>
          <label className={styles.check}><input type="checkbox" checked={w.onlyMine} onChange={e => up({ onlyMine: e.target.checked })} /> tylko te, które mogę od razu sprzedać</label>
          <SortSelect value={w.sortOrders} onChange={v => up({ sortOrders: v })} options={ORDER_SORTS} />
        </div>
        <div className={styles.wanted}>
          {orders.map((o: any) => {
            const mine = myItemFor(o.person, o.variant);
            return (
              <article key={o.id} className={styles.want}>
                <div className={styles.wantTile}><PickTile item={{ person: o.person, variant: o.variant, value: o.value }} reveal={revealOf(o, '')} /></div>
                <div className={styles.wantInfo}>
                  <div><b>{person(o.person).masked ? 'Tajna karta' : person(o.person).name}</b>{isSpecial(o.variant) ? ` · ${variantName(o.variant)}` : ''}</div>
                  <div>Płaci <b>{fmt(o.price)}</b> <span className="muted small">(wartość {fmt(o.value)})</span></div>
                  <div className={styles.seller}>{o.buyer && <UserLink user={o.buyer} />}<span className="muted small">{timeAgo(o.created)}</span></div>
                  <div className={styles.acts}>
                    {o.mine ? <Button onClick={() => m.act(() => api(`/api/market/wanted/${o.id}/cancel`, {}), 'Zlecenie wycofane, pieniądze wróciły')}>Wycofaj</Button>
                      : mine ? <Button kind="hue" onClick={() => fill(o)}>Sprzedaj za {fmt(o.price)}</Button>
                        : <span className="muted small">nie masz tej karty</span>}
                  </div>
                </div>
              </article>
            );
          })}
          {!orders.length && <p className="muted">Nikt teraz niczego nie szuka.</p>}
        </div>
      </section>
    </div>
  );
}
