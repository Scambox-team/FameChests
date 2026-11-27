import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Eye, UserRound } from 'lucide-react';
import { api } from '../../api/client';
import { cardValue, person } from '../../game/rules';
import { withReveal } from '../../game/reveal';
import { refreshBadges } from '../../game/session';
import { S, useGame } from '../../game/store';
import type { Item } from '../../game/types';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import { Avatar } from '../../ui/UserLink';
import { ServiceBadge } from '../exp/LevelPage';
import { TradeBuilder } from '../social/TradeBuilder';
import { CardsView, type OtherMode } from './InventoryPage';
import o from './otherInventory.module.css';

// Ekwipunek innego gracza (`/player/<nazwa>/inventory`): TEN SAM ekran co własny ekwipunek (`CardsView` z InventoryPage.tsx: chmura rzadkości,
// wyszukiwarka, filtry skrzynki / wariantu, sortowanie, siatka kart), tylko z kartami z serwera (`GET /api/users/<nazwa>/inventory`, serwer sprawdza
// prywatność: publiczny / tylko znajomi / prywatny, admin widzi wszystko) i bez akcji na własnych kartach (sprzedaż, ulubione, naklejanie).
// Z karty: podgląd (openViewer) i - tylko dla znajomych - propozycja wymiany albo zlecenie kupna.
interface Group { person: string; variant: string; count: number; id: number }
interface Data {
  username: string; user: { username: string; icon?: string; [k: string]: any }; level: number;
  badge: { year: number; tier: number } | null; relation: string; collection: Group[]; reveal: Record<string, any>; canTrade: boolean;
}

/** Grupy (osoba + wariant + liczba) -> pojedyncze karty jak w własnym ekwipunku. Numer: prawdziwy numer najnowszej karty grupy, pozostałe z ułamkiem
 *  (nie zderzy się z numerem żadnej prawdziwej karty, a sortowanie „Najnowsze” zostaje sensowne). */
export function expand(groups: Group[]): Item[] {
  const out: Item[] = [];
  for (const g of groups) {
    if (!S.cfg.people[g.person]) continue;
    const value = cardValue(g.person, g.variant);
    for (let k = 0; k < g.count; k++) out.push({ id: k === 0 ? g.id : g.id - k / 1000, person: g.person, variant: g.variant, value, fav: false, created: 0 });
  }
  return out;
}

export function OtherInventoryPage() {
  const { name = '' } = useParams();
  const game = useGame();
  const { data, error } = useQuery({ queryKey: ['inventory', name], queryFn: () => api<Data>(`/api/users/${encodeURIComponent(name)}/inventory`), retry: false, staleTime: 0 });
  const [trade, setTrade] = useState<Item | null>(null);
  const [buying, setBuying] = useState<Item | null>(null);
  useEffect(() => { document.title = `Ekwipunek: ${name} · ScamBox`; window.scrollTo(0, 0); }, [name]);
  const reveal = useMemo(() => ({ map: data?.reveal || {}, imgq: `owner=${encodeURIComponent(name)}` }), [data, name]);
  // rysowanie kart z tajnymi kartami znajomego wymaga podmiany danych na czas listy: expand liczy tylko wartości
  const items = useMemo(() => (data ? withReveal(reveal, () => expand(data.collection)) : []), [data, reveal, game.cfg]);
  const total = items.reduce((a, i) => a + i.value, 0);
  const mode: OtherMode | undefined = useMemo(() => data && ({
    reveal, canTrade: data.canTrade, onTrade: (it: Item) => { Sound.click(); setTrade(it); }, onBuy: (it: Item) => { Sound.click(); setBuying(it); },
  }), [data, reveal]);

  if (error) {
    return (
      <section className={o.oiDenied}>
        <Eye size={28} aria-hidden="true" />
        <h2>{`Ekwipunek gracza ${name}`}</h2>
        <p className="muted">{(error as Error).message}</p>
        <Link className={o.oiBack} to={`/player/${encodeURIComponent(name)}`}>Wróć do profilu</Link>
      </section>
    );
  }
  if (!data || !mode) return <p className="muted">Ładowanie</p>;

  return (
    <>
      <section className={o.oiOwner} aria-label="Czyj to ekwipunek">
        <span className={o.oiEye}><Eye size={14} aria-hidden="true" /> Oglądasz cudzy ekwipunek</span>
        <div className={o.oiWho}>
          <Avatar user={data.user as any} size={56} />
          <div className={o.oiNames}>
            <h1><Link to={`/player/${encodeURIComponent(data.username)}`}>{data.username}</Link></h1>
            <span className={o.oiLine}>
              <span className={o.oiLv}>{`Level ${data.level}`}</span>
              {data.badge && <ServiceBadge year={data.badge.year} tier={data.badge.tier} className={o.oiSvc} />}
              <span>{`${items.length.toLocaleString('pl-PL')} kart · wartość ${fmt(total)}`}</span>
            </span>
          </div>
          <Link className={o.oiBack} to={`/player/${encodeURIComponent(data.username)}`}><UserRound size={15} aria-hidden="true" /> Profil</Link>
        </div>
        <p className="muted small">
          <span>Kliknij kartę, żeby ją obejrzeć.</span>{' '}
          <span>{data.canTrade ? 'Ikoną wymiany przy karcie zaproponujesz wymianę, ikoną koszyka złożysz zlecenie kupna.' : 'Wymianę możesz zaproponować tylko znajomemu - zaproś tego gracza do znajomych na jego profilu.'}</span>{' '}
          <span>To tylko podgląd: nie możesz sprzedawać, zaznaczać ani zmieniać tych kart.</span>
        </p>
      </section>
      <CardsView items={items} other={mode} />
      {trade && <TradeBuilder username={data.username} initialWant={[{ person: trade.person, variant: trade.variant }]} onClose={() => setTrade(null)} onSent={() => setTrade(null)} />}
      {buying && <BuyDialog username={data.username} item={buying} reveal={reveal} onClose={() => setBuying(null)} />}
    </>
  );
}

/** Zlecenie kupna skierowane tylko do tego gracza (pieniądze są blokowane, aż je przyjmie albo wycofasz - jak w „Szukam”) */
function BuyDialog({ username, item, reveal, onClose }: { username: string; item: Item; reveal: { map?: Record<string, any>; imgq?: string }; onClose: () => void }) {
  const game = useGame();
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const name = withReveal(reveal, () => person(item.person).name);
  const buy = async () => {
    const gr = Math.round(+(price || item.value));
    if (!(gr > 0)) return toast('Podaj cenę', true);
    if (gr > game.state.balance) { Sound.error(); return toast('Za mało pieniędzy', true); }
    setBusy(true);
    try {
      const r = await api('/api/market/wanted', { person: item.person, variant: item.variant, price: gr, target: username });
      if (r.state) Object.assign(S.state, r.state);
      Sound.win();
      toast(`Wysłano zlecenie kupna do ${username}`);
      refreshBadges();
      onClose();
    } catch (e: any) { Sound.error(); toast(e.message, true); }
    setBusy(false);
  };
  return (
    <Modal title={`Kup od ${username}: ${name}`} onClose={onClose}>
      <p className="muted small">{`Pieniądze zostaną zablokowane, dopóki ${username} nie sprzeda karty albo ty nie wycofasz zlecenia (zakładka Rynek, Szukam). Wartość karty: ${fmt(item.value)}.`}</p>
      <label className={o.oiPrice}>Cena (gr)
        <input type="number" min={1} inputMode="numeric" value={price} placeholder={String(item.value)} onChange={e => setPrice(e.target.value)} aria-label="Cena kupna w groszach" />
      </label>
      <div className={o.oiBtns}><Button kind="hue" disabled={busy} onClick={buy}>Złóż zlecenie</Button><Button onClick={onClose}>Anuluj</Button></div>
    </Modal>
  );
}
