import { api } from '../../api/client';
import { PickTile } from '../../cards/PickTile';
import { useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { timeAgo } from '../../lib/time';
import { Button } from '../../ui/Button';
import { UserLink } from '../../ui/UserLink';
import { ListingCard, revealOf, type MarketApi } from './MarketPage';
import styles from './MarketPage.module.css';

const STATUS: Record<string, string> = {
  sold: 'sprzedana', expired: 'bez ofert, wróciła', cancelled: 'wycofana', filled: 'zlecenie zrealizowane',
  pending: 'czeka na decyzję', accepted: 'przyjęta', declined: 'odrzucona', lost: 'przepadła, karta poszła do kogoś innego'
};
const KINDS: Record<string, string> = { auction: 'licytacja', wanted: 'zlecenie Szukam', fixed: 'stała cena' };

export function MineTab({ m, onAsk }: { m: MarketApi; onAsk: (a: any) => void }) {
  const { cfg } = useGame();
  const d = m.data;
  const mine = d.listings.filter((l: any) => l.mine), leading = d.listings.filter((l: any) => l.myTop), wants = d.wanted.filter((o: any) => o.mine);
  return (
    <div className={styles.mineCol}>
      <section className={styles.panel}>
        <h2>Twoje oferty na rynku ({mine.length}/{cfg.market.maxListings})</h2>
        {mine.length ? <div className={styles.grid}>{mine.map((l: any) => (
          <div key={l.id} className={styles.mineItem}>
            <ListingCard l={l} m={m} showSeller={false} onAsk={onAsk} />
            {l.offers.length > 0 && <div className={styles.offers}><b>Propozycje cen</b>{l.offers.map((o: any) => (
              <div key={o.id} className={styles.offer}>
                {o.buyer && <UserLink user={o.buyer} />} proponuje <b>{fmt(o.price)}</b> <span className="muted small">({Math.round(o.price / l.price * 100)}% ceny)</span>
                <Button kind="hue" onClick={() => { if (confirm('Sprzedać kartę za zaproponowaną cenę?')) m.act(() => api(`/api/market/offers/${o.id}/accept`, {}), 'Sprzedane'); }}>Sprzedaj</Button>
                <Button onClick={() => m.act(() => api(`/api/market/offers/${o.id}/decline`, {}), 'Propozycja odrzucona')}>Odrzuć</Button>
              </div>
            ))}</div>}
          </div>
        ))}</div> : <p className="muted">Nic nie wystawiasz. Karty wystawisz w zakładce Sprzedaj.</p>}
      </section>
      {leading.length > 0 && <section className={styles.panel}><h2>Licytacje, które prowadzisz</h2><div className={styles.grid}>{leading.map((l: any) => <ListingCard key={l.id} l={l} m={m} onAsk={onAsk} />)}</div></section>}
      <section className={styles.panel}>
        <h2>Twoje propozycje cen</h2>
        {d.myOffers.length ? d.myOffers.map((o: any) => (
          <div key={o.id} className={styles.hist}>
            <div className={styles.histTile}><PickTile item={{ person: o.person, variant: o.variant, value: o.value }} reveal={revealOf(o, `market=${o.listing}`)} /></div>
            <div className={styles.grow}>Proponujesz <b>{fmt(o.price)}</b> <span className="muted small">(cena {fmt(o.listPrice)})</span>{o.seller && <> · <UserLink user={o.seller} /></>}
              <div className="muted small">{STATUS[o.status] || o.status} · {timeAgo(o.at)}</div></div>
            {o.status === 'pending' && <Button onClick={() => m.act(() => api(`/api/market/offers/${o.id}/cancel`, {}), 'Propozycja wycofana, pieniądze wróciły')}>Wycofaj</Button>}
          </div>
        )) : <p className="muted">Brak propozycji.</p>}
      </section>
      <section className={styles.panel}>
        <h2>Twoje zlecenia Szukam ({wants.length}/{cfg.market.maxWanted})</h2>
        {wants.length ? wants.map((o: any) => (
          <div key={o.id} className={styles.hist}>
            <div className={styles.histTile}><PickTile item={{ person: o.person, variant: o.variant, value: o.value }} /></div>
            <div className={styles.grow}>Płacisz <b>{fmt(o.price)}</b><div className="muted small">{timeAgo(o.created)}</div></div>
            <Button onClick={() => m.act(() => api(`/api/market/wanted/${o.id}/cancel`, {}), 'Zlecenie wycofane, pieniądze wróciły')}>Wycofaj</Button>
          </div>
        )) : <p className="muted">Brak zleceń.</p>}
      </section>
      <section className={styles.panel}>
        <h2>Historia</h2>
        {d.history.length ? d.history.map((h: any, i: number) => {
          const done = h.status === 'sold' || h.status === 'filled';
          return (
            <div key={i} className={styles.hist}>
              <div className={styles.histTile}><PickTile item={{ person: h.person, variant: h.variant, value: h.value }} reveal={revealOf(h, h.type === 'wanted' ? '' : `market=${h.id}`)} /></div>
              <div className={styles.grow}><b>{h.role === 'seller' ? (done ? 'Sprzedano' : 'Twoja oferta') : 'Kupiono'}</b>{done ? <> za <b>{fmt(h.price)}</b></> : null}{h.other && <> · {h.role === 'seller' ? 'kupił(a)' : 'od'} <UserLink user={h.other} /></>}
                <div className="muted small">{KINDS[h.type] || KINDS.fixed} · {STATUS[h.status] || h.status} · {timeAgo(h.at)}</div></div>
            </div>
          );
        }) : <p className="muted">Jeszcze nic nie kupiłeś ani nie sprzedałeś.</p>}
      </section>
    </div>
  );
}
