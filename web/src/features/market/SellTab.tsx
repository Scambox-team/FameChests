import { useState } from 'react';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { PickTile } from '../../cards/PickTile';
import { SortSelect } from '../../cards/cardSorts';
import { removeItems } from '../../game/actions';
import { cardMatches, plural, sortCards } from '../../game/rules';
import { useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { SearchField, Select, Tabs } from '../../ui/Field';
import { toast } from '../../ui/Toaster';
import { UserLink } from '../../ui/UserLink';
import type { MarketApi } from './MarketPage';
import styles from './MarketPage.module.css';

const PICK_LIMIT = 240;

export function SellTab({ m }: { m: MarketApi }) {
  const game = useGame();
  const [s, setS] = useState({ item: null as number | null, kind: 'fixed', price: '', step: '', hours: 24, q: '', sort: 'value' });
  const up = (p: Partial<typeof s>) => setS(x => ({ ...x, ...p }));
  const items = game.items.filter(i => !i.fav);
  const it = items.find(i => i.id === s.item);
  const list = sortCards(items.filter(i => cardMatches(i, s.q)), s.sort);
  const mk = game.cfg.market;

  const go = async () => {
    if (!it) return;
    const price = +(s.price || it.value), step = +(s.step || Math.max(1, Math.round(it.value * .05)));
    if (price < it.value * .5 && !confirm(`Cena ${fmt(price)} to mniej niż połowa wartości karty (${fmt(it.value)}). Na pewno?`)) return;
    try {
      const res = await api('/api/market/list', { item: it.id, kind: s.kind, price, step, hours: s.hours });
      removeItems(res.consumed);
      Sound.coin(1);
      toast(s.kind === 'auction' ? 'Licytacja rozpoczęta' : 'Karta jest na rynku');
      up({ item: null, price: '', step: '' });
    } catch (e: any) { Sound.error(); toast(e.message, true); }
    m.refresh();
  };
  const fill = async (o: any) => {
    if (!it || !confirm(`Sprzedać graczowi ${o.buyer?.username || ''} za ${fmt(o.price)}?`)) return;
    const res = await m.act(() => api(`/api/market/wanted/${o.id}/fill`, { item: it.id }), `Sprzedano za ${fmt(o.price)}`);
    if (res) removeItems(res.consumed);
  };

  const wanted = it ? m.data.wanted.filter((o: any) => !o.mine && o.person === it.person && o.variant === it.variant).sort((a: any, b: any) => b.price - a.price) : [];
  const same = it ? m.data.listings.filter((l: any) => l.person === it.person && l.variant === it.variant) : [];

  return (
    <div className={styles.cols}>
      <section className={styles.panel}>
        <h2>Twoje karty <small className="muted">bez ulubionych</small></h2>
        <div className={styles.tools}>
          <SearchField value={s.q} onChange={e => up({ q: e.target.value })} placeholder="Szukaj" aria-label="Szukaj karty" />
          <SortSelect value={s.sort} onChange={v => up({ sort: v })} />
        </div>
        <div className={styles.picks}>
          {list.slice(0, PICK_LIMIT).map(i => <PickTile key={i.id} item={i} selected={i.id === s.item} onClick={() => { up({ item: i.id, price: '', step: '' }); Sound.click(); }} />)}
          {!list.length && <p className="muted">Nie masz kart do sprzedania.</p>}
        </div>
      </section>
      <section className={styles.panel}>
        {!it ? <p className="muted">Wybierz kartę z listy, aby ją wystawić.</p> : (
          <div className={styles.form}>
            <Card person={it.person} variant={it.variant} className={styles.formCard} />
            <div className={styles.fields}>
              <p className="muted small">Wartość karty: <b>{fmt(it.value)}</b>{same.length ? `, na rynku ${same.length} ${plural(same.length, 'taka karta', 'takie karty', 'takich kart')}` : ''}</p>
              {wanted.length > 0 && <p className={styles.hint}>{wanted[0].buyer && <UserLink user={wanted[0].buyer} />} szuka tej karty i płaci <b>{fmt(wanted[0].price)}</b> <Button onClick={() => fill(wanted[0])}>Sprzedaj od razu</Button></p>}
              <Tabs label="Rodzaj oferty" value={s.kind} onChange={k => { up({ kind: k }); Sound.click(); }} items={[{ id: 'fixed', label: 'Stała cena' }, { id: 'auction', label: 'Licytacja' }]} />
              <label>{s.kind === 'auction' ? 'Cena wywoławcza (minimalna)' : 'Cena'}<input type="number" min={1} value={s.price || it.value} onChange={e => up({ price: e.target.value })} /></label>
              {s.kind === 'auction' ? <>
                <label>Minimalne przebicie<input type="number" min={1} value={s.step || Math.max(1, Math.round(it.value * .05))} onChange={e => up({ step: e.target.value })} /></label>
                <label>Czas licytacji<Select value={s.hours} onChange={e => up({ hours: +e.target.value })}>{mk.auctionHours.map((h: number) => <option key={h} value={h}>{h} godz.</option>)}</Select></label>
                <p className="muted small">Licytacji, w której ktoś już licytuje, nie da się wycofać. Oferta w ostatnich {Math.round(mk.snipeSeconds / 60)} min. przedłuża czas.</p>
              </> : <p className="muted small">Kupujący mogą też zaproponować niższą cenę. Zdecydujesz w zakładce Moje.</p>}
              {mk.fee > 0 && <p className="muted small">Prowizja rynku: {Math.round(mk.fee * 100)}%</p>}
              <Button kind="hue" big onClick={go}>{s.kind === 'auction' ? 'Rozpocznij licytację' : 'Wystaw na rynek'}</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
