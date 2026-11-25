import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Repeat, ShoppingCart } from 'lucide-react';
import { api } from '../../api/client';
import { PickTile } from '../../cards/PickTile';
import { CARD_SORTS, SortSelect } from '../../cards/cardSorts';
import { withReveal } from '../../game/reveal';
import { cardMatches, cardValue, person, sortCards, variantName } from '../../game/rules';
import { refreshBadges } from '../../game/session';
import { S, useGame } from '../../game/store';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { SearchField, Select } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/Toaster';
import { TradeBuilder } from '../social/TradeBuilder';
import s from './friendInventory.module.css';

const SORTS = CARD_SORTS.filter(([k]) => k !== 'new');

interface Row { key: string; person: string; variant: string; count: number; value: number }

/** Cały ekwipunek znajomego: wyszukiwarka, filtr rzadkości i wariantu, sortowanie. Z wybranej karty od razu zaproponujesz wymianę
 *  (kreator wymiany ma ją już zaznaczoną) albo kupno: zlecenie „Szukam” skierowane tylko do tego znajomego (pieniądze są blokowane, aż je przyjmie
 *  albo je wycofasz - jak w zwykłym „Szukam”). Serwer pokazuje ekwipunek tylko znajomym, którzy tego nie wyłączyli w ustawieniach konta. */
export function FriendInventory({ username, onClose }: { username: string; onClose: () => void }) {
  const game = useGame();
  const { data, error } = useQuery({ queryKey: ['inventory', username], queryFn: () => api(`/api/users/${encodeURIComponent(username)}/inventory`), retry: false });
  const [q, setQ] = useState('');
  const [rarity, setRarity] = useState('');
  const [variant, setVariant] = useState('');
  const [sort, setSort] = useState('rarity');
  const [pick, setPick] = useState<string | null>(null);
  const [trade, setTrade] = useState<Row | null>(null);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const reveal = useMemo(() => ({ map: data?.reveal || {}, imgq: `owner=${encodeURIComponent(username)}` }), [data, username]);

  const rows: Row[] = useMemo(() => (data?.collection ?? []).map((c: any) => ({ key: `${c.person}|${c.variant}`, person: c.person, variant: c.variant, count: c.count, value: cardValue(c.person, c.variant) })), [data]);
  const variants = useMemo(() => [...new Set(rows.map(r => r.variant))].sort((a, b) => S.cfg.variantOrder.indexOf(a) - S.cfg.variantOrder.indexOf(b)), [rows]);
  const list = withReveal(reveal, () => sortCards(rows.filter(r => (!rarity || person(r.person)?.rarity === rarity) && (!variant || r.variant === variant) && cardMatches(r, q)), sort)) as Row[];
  const chosen = rows.find(r => r.key === pick) ?? null;
  const total = rows.reduce((a, r) => a + r.count, 0);

  if (error) return <Modal title={`Ekwipunek: ${username}`} onClose={onClose}><p className="muted">{(error as Error).message}</p><div className={s.fiBtns}><Button onClick={onClose}>Zamknij</Button></div></Modal>;
  if (trade) return <TradeBuilder username={username} initialWant={[{ person: trade.person, variant: trade.variant }]} onClose={() => { setTrade(null); onClose(); }} onSent={() => {}} />;

  const buy = async () => {
    if (!chosen) return;
    const gr = Math.round(+(price || chosen.value));
    if (!(gr > 0)) return toast('Podaj cenę', true);
    if (gr > game.state.balance) { Sound.error(); return toast('Za mało pieniędzy', true); }
    const name = withReveal(reveal, () => person(chosen.person).name);
    if (!confirm(`Złożyć zlecenie kupna: ${name} od ${username} za ${fmt(gr)}? Pieniądze zostaną zablokowane, dopóki ${username} nie sprzeda karty albo ty nie wycofasz zlecenia (zakładka Rynek, Szukam).`)) return;
    setBusy(true);
    try {
      const r = await api('/api/market/wanted', { person: chosen.person, variant: chosen.variant, price: gr, target: username });
      if (r.state) Object.assign(S.state, r.state);
      Sound.win();
      toast(`Wysłano zlecenie kupna do ${username}`);
      refreshBadges();
      setPick(null);
    } catch (e: any) { Sound.error(); toast(e.message, true); }
    setBusy(false);
  };

  return (
    <Modal title={`Ekwipunek: ${username}`} onClose={onClose} wide>
      {!data ? <p className="muted">Ładowanie</p> : (
        <>
          <p className="muted small">{total} kart, {rows.length} różnych. Kliknij kartę, żeby zaproponować wymianę albo kupić ją od {username}.</p>
          <div className={s.fiTools}>
            <SearchField value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj karty" aria-label="Szukaj w ekwipunku znajomego" />
            <Select value={rarity} onChange={e => setRarity(e.target.value)} aria-label="Rzadkość">
              <option value="">Każda rzadkość</option>
              {S.cfg.rarityOrder.filter((r: string) => S.cfg.rarities[r]).map((r: string) => <option key={r} value={r}>{S.cfg.rarities[r].name}</option>)}
            </Select>
            <Select value={variant} onChange={e => setVariant(e.target.value)} aria-label="Wariant">
              <option value="">Każdy wariant</option>
              {variants.map(v => <option key={v} value={v}>{variantName(v)}</option>)}
            </Select>
            <SortSelect value={sort} options={SORTS} onChange={setSort} />
          </div>
          <div className={`pick-grid ${s.fiGrid}`}>
            {list.slice(0, 400).map(r => <PickTile key={r.key} item={r} reveal={reveal} selected={r.key === pick} extra={<span className="pc">×{r.count}</span>} onClick={() => { setPick(r.key === pick ? null : r.key); setPrice(''); Sound.click(); }} />)}
            {!list.length && <p className="muted">{rows.length ? 'Nic nie pasuje do filtrów' : `${username} nie ma żadnych kart`}</p>}
          </div>
          {chosen && (
            <div className={s.fiBar} role="group" aria-label="Wybrana karta">
              <div className={s.fiBarInfo}><b>{withReveal(reveal, () => person(chosen.person).name)}</b>{chosen.variant !== 'normal' && ` · ${variantName(chosen.variant)}`}<span className="muted small"> · wartość {fmt(chosen.value)} · ma ×{chosen.count}</span></div>
              <div className={s.fiBarActs}>
                <Button kind="hue" onClick={() => setTrade(chosen)}><Repeat size={15} aria-hidden="true" /> Zaproponuj wymianę</Button>
                <label className={s.fiPrice}><span className="muted small">Kup za (gr)</span>
                  <input type="number" min={1} inputMode="numeric" value={price} placeholder={String(chosen.value)} onChange={e => setPrice(e.target.value)} aria-label="Cena kupna w groszach" /></label>
                <Button disabled={busy} onClick={buy}><ShoppingCart size={15} aria-hidden="true" /> Kup</Button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
