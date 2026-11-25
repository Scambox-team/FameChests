import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Pin, ShoppingBag } from 'lucide-react';
import { api } from '../../api/client';
import { applyState } from '../../game/session';
import { S, useGame } from '../../game/store';
import { fmtNum } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { SearchField, Select } from '../../ui/Field';
import { FramedAvatar } from '../../ui/FramedAvatar';
import { PageHero } from '../../ui/PageHero';
import { toast } from '../../ui/Toaster';
import { useCosmeticSrc, type CosmeticView } from '../profile/cosmetics';
import { CosmeticPreview } from '../profile/CosmeticPreview';
import { loadStickers, stickerTileHTML, VARIANT_NAME } from '../stickers/stickers';
import pf from '../profile/playerCard.module.css';
import s from './shop.module.css';

// Sklep z kosmetykami (server/src/routes/cshop.rs): tła miniprofilu, obramówki i tła profilu za euro. Admin widzi też pozycje ukryte (zdobywane
// inaczej niż w sklepie), wyłączone i poza terminem - z wyraźnym oznaczeniem - i tylko on może je kupić (testy).

type Kind = 'mini' | 'frame' | 'bg' | 'avatar';
interface Item extends CosmeticView {
  price: number; tags: string[]; owned: boolean; avail: 'open' | 'hidden' | 'disabled' | 'soon' | 'ended' | 'soldout';
  stock: number | null; left: number | null; saleFrom: number | null; saleTo: number | null; canBuy: boolean; problem: string | null;
}
interface Showcase { base: number; extra: number; max: number; price: number | null }
interface StCrate { id: string; kind: string; name: string; emoji: string; color1: string; color2: string; desc: string; price: number; avail: 'open' | 'hidden'; canBuy: boolean }
interface StOffer { id: number; sticker: string; variant: string; price: number; name: string; rarity: string; v: number; stock: number | null; left: number | null; avail: 'open' | 'hidden' | 'soldout'; canBuy: boolean }
interface Data { stickerCrates?: StCrate[]; stickers?: StOffer[]; showcase?: Showcase; euro: number; admin: boolean; items: Item[]; colors: { key: string; name: string }[]; kinds: { key: Kind; label: string }[] }

const AVAIL_NOTE: Record<string, string> = {
  hidden: 'Ukryty: nie ma go w sklepie (zdobywa się inaczej)', disabled: 'Ukryty: wyłączony', ended: 'Ukryty: sprzedaż się skończyła',
  soon: 'Sprzedaż jeszcze się nie zaczęła', soldout: 'Wyprzedany'
};
const COLOR_HEX: Record<string, string> = {
  red: '#e5484d', orange: '#f08a24', yellow: '#f2c230', green: '#3fc07a', cyan: '#27c4c4', blue: '#3e7bfa', purple: '#9a5cf0', pink: '#ee5fb2',
  brown: '#8b5a3c', white: '#f3f3f3', gray: '#8c8c94', black: '#18181b'
};
const when = (t: number) => new Date(t * 1000).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Podgląd pozycji w miejscu użycia: miniprofil z tłem, ikona w obramówce, pasek tła profilu */
function Preview({ it }: { it: Item }) {
  const { me } = useGame();
  const src = useCosmeticSrc(it);
  if (!src) return <div className={s.shPrev} />;
  if (it.kind === 'avatar') {
    return <div className={`${s.shPrev} ${s.shFrame}`}><img className={s.shAvatar} src={src} alt="" draggable={false} /></div>;
  }
  if (it.kind === 'frame') {
    return <div className={`${s.shPrev} ${s.shFrame}`}>{me && <FramedAvatar user={me} size={110} frame={it} />}</div>;
  }
  if (it.kind === 'bg') {
    return <div className={`${s.shPrev} ${s.shBg}`}><div className={s.shBgImg} style={{ backgroundImage: `url("${src}")` }} /><div className={s.shBgShade} /><span className={s.shBgLabel}>{me?.username}</span></div>;
  }
  return (
    <div className={`${s.shPrev} ${s.shMini}`}>
      <div className={pf.pkBg} style={{ backgroundImage: `url("${src}")` }} /><div className={pf.pkTone} />
      <span className={s.shMiniName}>{me?.username}</span>
    </div>
  );
}

/** Jedna pozycja Sklepu: kosmetyk, miejsce w gablocie, skrzynka z naklejkami albo naklejka - wszystko w jednej siatce i z tymi samymi filtrami */
interface Entry {
  key: string; type: string; typeLabel: string; name: string; price: number; tags: string[]; owned: boolean; hidden: boolean; hiddenNote?: string;
  preview: ReactNode; onPreview?: () => void; notes: string[]; limit?: string; canBuy: boolean; problem: string | null; buyLabel: string; buy: () => Promise<void>; ownedLabel?: string;
}

function Tile({ e, admin, busy }: { e: Entry; admin: boolean; busy: boolean }) {
  return (
    <article className={`${s.shItem}${e.hidden ? ` ${s.shHidden}` : ''}`}>
      {e.preview}
      {e.onPreview && <button type="button" className={s.shTry} onClick={e.onPreview}><Eye size={14} aria-hidden="true" /> Podgląd na moim profilu</button>}
      <div className={s.shBody}>
        <b className={s.shName}>{e.name}</b>
        <span className="muted small">{e.typeLabel}</span>
        {e.tags.length > 0 && <span className={s.shTags} aria-label="Kolory">{e.tags.map(t => <i key={t} style={{ background: COLOR_HEX[t] }} />)}</span>}
        {e.hidden && admin && <span className={s.shAdminNote}><EyeOff size={13} aria-hidden="true" /> {e.hiddenNote} · widzisz to jako admin</span>}
        {e.notes.map(n => <span key={n} className="muted small">{n}</span>)}
        {e.limit && <span className={s.shLimit}>{e.limit}</span>}
      </div>
      <div className={s.shBuy}>
        <span className={s.shPrice}>{e.price > 0 ? <>{fmtNum(e.price)} <small>€</small></> : <small className="muted">brak ceny</small>}</span>
        {e.owned ? <span className={s.shOwned}>{e.ownedLabel ?? 'Masz'}</span>
          : <Button kind="hue" disabled={!e.canBuy || busy} title={e.problem ?? undefined} onClick={() => e.buy()}>{e.canBuy && e.hidden ? 'Kup (admin)' : e.buyLabel}</Button>}
        {!e.owned && e.problem && <span className="muted small">{e.problem}</span>}
      </div>
    </article>
  );
}

/** Podgląd skrzynki z naklejkami: kolory wieka i korpusu skrzynki + emblemat */
function CratePreview({ c }: { c: StCrate }) {
  return (
    <div className={`${s.shPrev} ${s.shStCrate}`} style={{ background: `linear-gradient(160deg, ${c.color1}, ${c.color2})` }}>
      <span className={s.shEmoji} aria-hidden="true">{c.emoji || '🏷️'}</span>
    </div>
  );
}


export function ShopPage() {
  const game = useGame();
  const qc = useQueryClient();
  const { data, error } = useQuery<Data>({ queryKey: ['cshop'], queryFn: () => api('/api/shop/cosmetics'), staleTime: 0 });
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [colors, setColors] = useState<string[]>([]);
  const [sort, setSort] = useState('price');
  const [hideOwned, setHideOwned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tryOn, setTryOn] = useState<Item | null>(null);
  useEffect(() => { document.title = 'Sklep · ScamBox'; }, []);

  /** Kupno jednej pozycji: potwierdzenie, zapytanie, stan z odpowiedzi, odświeżenie sklepu */
  const purchase = (ask: string, path: string, body: object, done: string, after?: (r: any) => void) => async () => {
    if (!confirm(ask)) return;
    setBusy(true);
    try {
      const r = await api(path, body);
      if (r.state) applyState(r.state);
      if (r.chests) S.chests = r.chests;
      Sound.win();
      toast(done);
      after?.(r);
      qc.invalidateQueries({ queryKey: ['cshop'] });
      qc.invalidateQueries({ queryKey: ['cosmetics'] });
      if (path.includes('sticker')) loadStickers();
    } catch (e: any) { Sound.error(); toast(e.message, true); }
    setBusy(false);
  };

  const entries: Entry[] = useMemo(() => {
    if (!data) return [];
    const euro = game.state.euro ?? data.euro;
    const out: Entry[] = [];
    for (const it of data.items) {
      const kindLabel = data.kinds.find(k => k.key === it.kind)?.label ?? it.kind;
      const hidden = it.avail === 'hidden' || it.avail === 'disabled' || it.avail === 'ended';
      const notes = [AVAIL_NOTE[it.avail]].filter((n): n is string => !!n && !hidden);
      out.push({
        key: `c:${it.id}`, type: it.kind, typeLabel: kindLabel, name: it.name, price: it.price, tags: it.tags, owned: it.owned, hidden, hiddenNote: AVAIL_NOTE[it.avail],
        preview: <Preview it={it} />, onPreview: () => setTryOn(it), notes,
        limit: it.left !== null && it.avail === 'open' ? `Zostało ${it.left} z ${it.stock}` : it.saleTo && it.avail === 'open' ? `Do ${when(it.saleTo)}` : it.saleFrom && it.avail === 'soon' ? `Od ${when(it.saleFrom)}` : undefined,
        canBuy: it.canBuy, problem: it.problem, buyLabel: 'Kup',
        buy: purchase(`Kupić „${it.name}” za ${fmtNum(it.price)} euro?`, '/api/shop/cosmetics/buy', { id: it.id }, `Kupiono: ${it.name}. Założysz to w profilu, w „Wygląd profilu”.`),
      });
    }
    // dodatkowe miejsce w gablocie: zwykły przedmiot (cena rośnie z każdym kupionym, można mieć najwyżej `max` dodatkowych)
    const sc = data.showcase;
    if (sc) {
      const left = sc.price == null;
      out.push({
        key: 'showcase', type: 'showcase', typeLabel: 'Miejsce w gablocie', name: 'Dodatkowe miejsce w gablocie', price: sc.price ?? 0, tags: [], owned: left, ownedLabel: 'Masz wszystkie',
        hidden: false, preview: <div className={`${s.shPrev} ${s.shSlot}`}><Pin size={44} aria-hidden="true" /><b>{sc.base + sc.extra}</b></div>,
        notes: [`Masz ${sc.base + sc.extra} miejsc (w tym ${sc.extra} dokupionych, najwyżej ${sc.max} dodatkowych). Po zakupie od razu masz o jedno miejsce więcej na karty na pokaz.`],
        canBuy: !left && euro >= (sc.price ?? 0), problem: !left && euro < (sc.price ?? 0) ? 'Za mało euro' : null, buyLabel: 'Kup',
        buy: purchase(`Kupić dodatkowe miejsce w gablocie za ${fmtNum(sc.price ?? 0)} euro?`, '/api/shop/showcase/buy', {}, 'Kupiono dodatkowe miejsce w gablocie'),
      });
    }
    for (const c of data.stickerCrates ?? []) {
      const hidden = c.avail === 'hidden';
      out.push({
        key: `sc:${c.id}`, type: 'stcrate', typeLabel: 'Skrzynka z naklejkami', name: c.name, price: c.price, tags: [], owned: false, hidden, hiddenNote: 'Ukryta: nie ma jej w sklepie',
        preview: <CratePreview c={c} />, notes: [c.desc || 'Po zakupie skrzynka trafia do ekwipunku, otwierasz ją stamtąd.'],
        canBuy: c.canBuy && euro >= c.price, problem: !c.canBuy ? 'Ta skrzynka nie ma jeszcze ceny' : euro < c.price ? 'Za mało euro' : null, buyLabel: 'Kup',
        buy: purchase(`Kupić skrzynkę „${c.name}” za ${fmtNum(c.price)} euro? Trafi do ekwipunku.`, '/api/shop/sticker-crate/buy', { id: c.id, count: 1 }, `Kupiono skrzynkę: ${c.name}. Otworzysz ją w ekwipunku.`),
      });
    }
    for (const o of data.stickers ?? []) {
      const hidden = o.avail === 'hidden';
      const rar = S.cfg.rarities[o.rarity];
      out.push({
        key: `st:${o.id}`, type: 'sticker', typeLabel: `Naklejka · ${VARIANT_NAME[o.variant] ?? o.variant}`, name: o.name, price: o.price, tags: [], owned: false, hidden, hiddenNote: 'Ukryta: wyłączona',
        preview: <div className={`${s.shPrev} ${s.shStk}`} dangerouslySetInnerHTML={{ __html: stickerTileHTML(o.sticker, o.variant, o.v) }} />,
        notes: [rar ? `Rzadkość: ${rar.name}` : '', o.avail === 'soldout' ? 'Wyprzedana' : ''].filter(Boolean),
        limit: o.left !== null && o.avail === 'open' ? `Zostało ${o.left} z ${o.stock}` : undefined,
        canBuy: o.canBuy && euro >= o.price, problem: !o.canBuy ? 'Ta naklejka jest wyprzedana' : euro < o.price ? 'Za mało euro' : null, buyLabel: 'Kup',
        buy: purchase(`Kupić naklejkę „${o.name}” (${VARIANT_NAME[o.variant] ?? o.variant}) za ${fmtNum(o.price)} euro?`, '/api/shop/sticker/buy', { id: o.id }, `Kupiono naklejkę: ${o.name}. Nakleisz ją w ekwipunku, w zakładce Naklejki.`),
      });
    }
    return out;
  }, [data, game.state.euro]);   // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const lo = min === '' ? -Infinity : +min, hi = max === '' ? Infinity : +max;
    const out = entries.filter(i =>
      (!needle || i.name.toLowerCase().includes(needle) || i.typeLabel.toLowerCase().includes(needle)) && (!kind || i.type === kind) && i.price >= lo && i.price <= hi
      && (!colors.length || colors.some(c => i.tags.includes(c))) && !(hideOwned && i.owned));
    out.sort((a, b) => sort === 'priceDesc' ? b.price - a.price : sort === 'name' ? a.name.localeCompare(b.name, 'pl') : a.price - b.price || a.name.localeCompare(b.name, 'pl'));
    return out;
  }, [entries, q, kind, min, max, colors, sort, hideOwned]);

  if (error) return <p className="muted">{(error as Error).message}</p>;
  if (!data) return <p className="muted">Ładowanie</p>;
  const euro = game.state.euro ?? data.euro ?? S.state.euro ?? 0;
  const types: [string, string][] = [...data.kinds.map(k => [k.key, k.label] as [string, string]), ['showcase', 'Miejsce w gablocie'], ['stcrate', 'Skrzynka z naklejkami'], ['sticker', 'Naklejka']];

  return (
    <>
      <PageHero icon={ShoppingBag} title="Sklep" lead="Kosmetyki profilu, miejsca w gablocie, skrzynki z naklejkami i naklejki za euro. Euro zdobywasz w grach, z MEGA skrzynek i w nagrodach."
        stats={[['Twoje euro', <span className={s.shEuroVal}>{fmtNum(euro)} €</span>], ['Pozycje', String(entries.length)]]} />
      <section className={s.shTools} aria-label="Filtry sklepu">
        <SearchField value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj po nazwie" aria-label="Szukaj w sklepie po nazwie" />
        <Select value={kind} onChange={e => setKind(e.target.value)} aria-label="Typ">
          <option value="">Każdy typ</option>{types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <label className={s.shPriceBox}><span className="muted small">Cena od</span><input type="number" min={0} inputMode="numeric" value={min} onChange={e => setMin(e.target.value)} aria-label="Cena od (euro)" /></label>
        <label className={s.shPriceBox}><span className="muted small">do</span><input type="number" min={0} inputMode="numeric" value={max} onChange={e => setMax(e.target.value)} aria-label="Cena do (euro)" /></label>
        <Select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sortowanie">
          <option value="price">Najtańsze</option><option value="priceDesc">Najdroższe</option><option value="name">Nazwa</option>
        </Select>
        <label className={s.shCheck}><input type="checkbox" checked={hideOwned} onChange={e => setHideOwned(e.target.checked)} /> Ukryj posiadane</label>
      </section>
      <div className={s.shColors} role="group" aria-label="Kolor">
        {data.colors.map(c => (
          <button key={c.key} type="button" className={`${s.shChip}${colors.includes(c.key) ? ` ${s.shChipOn}` : ''}`} aria-pressed={colors.includes(c.key)}
            onClick={() => setColors(v => v.includes(c.key) ? v.filter(x => x !== c.key) : [...v, c.key])}>
            <i style={{ background: COLOR_HEX[c.key] }} aria-hidden="true" />{c.name}
          </button>
        ))}
        {colors.length > 0 && <button type="button" className={s.shClear} onClick={() => setColors([])}>Wyczyść kolory</button>}
      </div>
      {tryOn && <CosmeticPreview item={tryOn} onClose={() => setTryOn(null)} />}
      <div className={s.shGrid}>
        {list.map(e => <Tile key={e.key} e={e} admin={data.admin} busy={busy} />)}
        {!list.length && <p className="muted">{entries.length ? 'Nic nie pasuje do filtrów.' : 'Sklep jest jeszcze pusty.'}</p>}
      </div>
    </>
  );
}
