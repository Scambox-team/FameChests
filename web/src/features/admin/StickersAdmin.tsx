import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { stickerTileHTML, VARIANT_NAME } from '../stickers/stickers';
import s from './StickersAdmin.module.css';

// Panel admina „Naklejki dla graczy” (server/src/routes/stickers.rs): katalog naklejek (PNG, rzadkość, z których skrzynek wypadają) i skrzynki
// z naklejkami z szansami wariantów (zwykła / foliowana / holo / złota). To NIE są naklejki z zakładki „Naklejki na wariantach” - tamte
// są wyglądem wariantu karty. Wersje foliowana, holo i złota powstają automatycznie jako filtry na wgranym PNG.
interface Sticker { id: string; name: string; rarity: string; enabled: boolean; crates: string[]; v: number; owned: number; placed: number }
interface Crate { id: string; name: string; emoji: string; color1: string; color2: string; desc: string; weights: Record<string, number>; price?: number; inShop?: boolean }
interface Offer { id?: number; sticker: string; variant: string; price: number; enabled: boolean; stock: number | null; sold?: number }
interface Data { offers: Offer[]; stickers: Sticker[]; crates: Crate[]; rarities: { key: string; name: string }[]; variants: { key: string; name: string }[]; secretOdds: number; maxOnCard: number }

const W_KEYS = ['normal', 'foil', 'holo', 'gold'] as const;
const PRESETS: [string, Record<string, number>][] = [
  ['Domyślne', { normal: 85, foil: 9, holo: 4, gold: 2 }], ['Zawsze foliowana', { normal: 0, foil: 1, holo: 0, gold: 0 }],
  ['Zawsze holo', { normal: 0, foil: 0, holo: 1, gold: 0 }], ['Zawsze złota', { normal: 0, foil: 0, holo: 0, gold: 1 }],
];

export default function StickersAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [crates, setCrates] = useState<Crate[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => api<Data>('/api/admin/gstickers').then(d => { setData(d); setCrates(d.crates.map(c => ({ ...c, weights: { ...c.weights } }))); }).catch(e => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!data) return <p className="muted">Wczytywanie…</p>;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast(done); await load(); } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const dirtyCrates = JSON.stringify(crates) !== JSON.stringify(data.crates);
  const saveCrates = () => run(() => api('/api/admin/gstickers/crates', { crates }), 'Zapisano skrzynki z naklejkami');
  const setCrate = (i: number, d: Partial<Crate>) => setCrates(l => l.map((c, j) => (j === i ? { ...c, ...d } : c)));

  return (
    <section className={s.page}>
      <p className="muted">Naklejki to kolekcjonerskie obrazki, które gracz nakleja na <b>dowolną kartę</b> (najwyżej {data.maxOnCard} na kartę; nad zdjęciem albo nad całą kartą).
        Mają rzadkości kart (bez Specjalnej); <b>tajna</b> naklejka wypada zawsze z szansą 1 na {data.secretOdds.toLocaleString('pl-PL')}. Każda naklejka może wypaść w wariancie zwykłym, foliowanym, holo albo złotym -
        wersje powstają same z wgranego PNG (filtry), a szansę wariantów ustawiasz osobno dla każdej <b>skrzynki z naklejkami</b>. Skrzynki z naklejkami nie ma w sklepie: gracz dostaje ją za nagrody
        (na razie jako jedna z dużych nagród za level; pulę ekskluzywną ustawiasz w „EXP i levele”).</p>

      <div className={`panel ${s.block}`}>
        <h3>Skrzynki z naklejkami</h3>
        {crates.map((c, i) => (
          <div key={c.id || `new${i}`} className={s.crate}>
            <div className={s.fields}>
              <label>Nazwa<input value={c.name} maxLength={40} onChange={e => setCrate(i, { name: e.target.value })} /></label>
              <label>Emblemat (emotka skrzynki)<input value={c.emoji} maxLength={8} onChange={e => setCrate(i, { emoji: e.target.value })} /></label>
              <label>Kolor wieka<input type="color" value={c.color1} onChange={e => setCrate(i, { color1: e.target.value })} /></label>
              <label>Kolor korpusu<input type="color" value={c.color2} onChange={e => setCrate(i, { color2: e.target.value })} /></label>
              <label className={s.wide}>Opis<input value={c.desc} maxLength={200} onChange={e => setCrate(i, { desc: e.target.value })} /></label>
              <label>Cena w Sklepie (euro)<input type="number" min={0} inputMode="numeric" value={c.price ?? 600} onChange={e => setCrate(i, { price: Math.max(0, +e.target.value || 0) })} /></label>
              <label className={s.chk}><input type="checkbox" checked={c.inShop !== false} onChange={e => setCrate(i, { inShop: e.target.checked })} /> W sklepie (odznaczona: widzi ją tylko admin)</label>
            </div>
            <div className={s.weights}>
              <b>Szanse wariantów naklejki (wagi)</b>
              <div className={s.fields}>
                {W_KEYS.map(k => <label key={k}>{VARIANT_NAME[k]}<input inputMode="decimal" value={c.weights[k] ?? 0} onChange={e => setCrate(i, { weights: { ...c.weights, [k]: +e.target.value.replace(',', '.') || 0 } })} /></label>)}
              </div>
              <WeightsInfo w={c.weights} />
              <div className={s.line}>{PRESETS.map(([name, w]) => <Button key={name} onClick={() => setCrate(i, { weights: w })}>{name}</Button>)}
                <Button onClick={() => confirm(`Usunąć skrzynkę „${c.name}”? Znikną też takie skrzynki z ekwipunków graczy.`) && setCrates(l => l.filter((_, j) => j !== i))}><Trash2 size={15} aria-hidden="true" /> Usuń skrzynkę</Button></div>
            </div>
          </div>
        ))}
        <div className={s.line}>
          <Button onClick={() => setCrates(l => [...l, { id: '', name: 'Nowa skrzynka z naklejkami', emoji: '🏷️', color1: '#ffd23f', color2: '#2a1f4d', desc: '', price: 600, inShop: true, weights: { normal: 85, foil: 9, holo: 4, gold: 2 } }])}><Plus size={15} aria-hidden="true" /> Nowa skrzynka</Button>
          <Button kind="hue" disabled={busy || !dirtyCrates} onClick={saveCrates}>Zapisz skrzynki</Button>
          {dirtyCrates && <span className={s.dirty}>Niezapisane zmiany</span>}
        </div>
      </div>

      <Offers data={data} run={run} busy={busy} />

      <div className={`panel ${s.block}`}>
        <h3>Katalog naklejek ({data.stickers.length})</h3>
        <NewSticker data={data} busy={busy} run={run} />
        <div className={s.list}>
          {data.stickers.map(st => <Row key={st.id} st={st} data={data} busy={busy} run={run} />)}
          {!data.stickers.length && <p className="muted">Nie ma jeszcze żadnych naklejek. Dodaj pierwszą PNG-iem.</p>}
        </div>
      </div>
    </section>
  );
}

/** Pojedyncze naklejki w konkretnym wariancie wystawione w Sklepie za euro (skrzynki są w Sklepie domyślnie, ich cenę ustawiasz wyżej) */
function Offers({ data, run, busy }: { data: Data; run: (fn: () => Promise<unknown>, done: string) => Promise<void>; busy: boolean }) {
  const [list, setList] = useState<Offer[]>(data.offers);
  useEffect(() => setList(data.offers), [data.offers]);
  const dirty = JSON.stringify(list) !== JSON.stringify(data.offers);
  const set = (i: number, d: Partial<Offer>) => setList(l => l.map((o, j) => (j === i ? { ...o, ...d } : o)));
  const save = () => run(() => api('/api/admin/gstickers/offers', { offers: list }), 'Zapisano oferty naklejek w Sklepie');
  return (
    <div className={`panel ${s.block}`}>
      <h3>Naklejki w Sklepie</h3>
      <p className="muted small">Każda oferta to jedna naklejka w wybranym wariancie (zwykła / foliowana / holo / złota) za euro, z opcjonalnym limitem sztuk. Kupiona trafia do ekwipunku naklejek. Skrzynki z naklejkami są w Sklepie domyślnie (cenę ustawiasz wyżej).</p>
      {list.map((o, i) => (
        <div key={o.id ?? `n${i}`} className={s.fields}>
          <label>Naklejka<select value={o.sticker} onChange={e => set(i, { sticker: e.target.value })}>
            <option value="">wybierz</option>{data.stickers.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}</select></label>
          <label>Wariant<select value={o.variant} onChange={e => set(i, { variant: e.target.value })}>{data.variants.map(v => <option key={v.key} value={v.key}>{v.name}</option>)}</select></label>
          <label>Cena (euro)<input type="number" min={1} inputMode="numeric" value={o.price || ''} onChange={e => set(i, { price: Math.max(0, +e.target.value || 0) })} /></label>
          <label>Limit sztuk (puste = bez limitu)<input type="number" min={1} inputMode="numeric" value={o.stock ?? ''} onChange={e => set(i, { stock: e.target.value ? Math.max(1, +e.target.value) : null })} /></label>
          <label className={s.chk}><input type="checkbox" checked={o.enabled} onChange={e => set(i, { enabled: e.target.checked })} /> Włączona</label>
          <span className="muted small">{o.id ? `sprzedano ${o.sold ?? 0}` : 'nowa'}</span>
          <Button onClick={() => setList(l => l.filter((_, j) => j !== i))}><Trash2 size={15} aria-hidden="true" /> Usuń</Button>
        </div>
      ))}
      {!list.length && <p className="muted small">Nie ma jeszcze żadnych ofert pojedynczych naklejek.</p>}
      <div className={s.line}>
        <Button onClick={() => setList(l => [...l, { sticker: data.stickers[0]?.id ?? '', variant: 'normal', price: 300, enabled: true, stock: null }])} disabled={!data.stickers.length}><Plus size={15} aria-hidden="true" /> Nowa oferta</Button>
        <Button kind="hue" disabled={busy || !dirty} onClick={save}>Zapisz oferty</Button>
        {dirty && <span className={s.dirty}>Niezapisane zmiany</span>}
      </div>
    </div>
  );
}

function WeightsInfo({ w }: { w: Record<string, number> }) {
  const sum = W_KEYS.reduce((n, k) => n + (w[k] || 0), 0);
  if (sum <= 0) return <small className="muted">Same zera: wypadają tylko zwykłe naklejki.</small>;
  return <small className="muted">{W_KEYS.map(k => `${VARIANT_NAME[k]} ${Math.round(((w[k] || 0) / sum) * 1000) / 10}%`).join(' · ')}</small>;
}

type Run = (fn: () => Promise<unknown>, done: string) => Promise<void>;

async function send(form: FormData) {
  const res = await fetch('/api/admin/gstickers/save', { method: 'POST', body: form });
  const d = await res.json().catch(() => null);
  if (!res.ok) throw new Error(d?.error || `Błąd serwera (${res.status})`);
}

function Row({ st, data, busy, run }: { st: Sticker; data: Data; busy: boolean; run: Run }) {
  const [name, setName] = useState(st.name);
  const [rarity, setRarity] = useState(st.rarity);
  const [enabled, setEnabled] = useState(st.enabled);
  const [inCrates, setInCrates] = useState<string[]>(st.crates);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setName(st.name); setRarity(st.rarity); setEnabled(st.enabled); setInCrates(st.crates); }, [st]);
  const dirty = name !== st.name || rarity !== st.rarity || enabled !== st.enabled || JSON.stringify(inCrates) !== JSON.stringify(st.crates);
  const form = () => {
    const f = new FormData();
    f.set('id', st.id); f.set('name', name); f.set('rarity', rarity); f.set('enabled', enabled ? '1' : '0'); f.set('crates', JSON.stringify(inCrates));
    return f;
  };
  const save = () => run(() => send(form()), `Zapisano: ${name}`);
  const replace = (f: File | undefined) => {
    if (!f) return;
    const x = form(); x.set('image', f);
    return run(async () => { await send(x); if (file.current) file.current.value = ''; }, 'Podmieniono obrazek');
  };
  const crateNames = new Map(data.crates.map(c => [c.id, c.name]));
  return (
    <article className={s.sticker}>
      <div className={s.previews}>
        {W_KEYS.map(k => <span key={k} className={s.prev} title={VARIANT_NAME[k]} dangerouslySetInnerHTML={{ __html: stickerTileHTML(st.id, k, st.v) }} />)}
      </div>
      <div className={s.fields}>
        <label>Nazwa<input value={name} maxLength={40} onChange={e => setName(e.target.value)} /></label>
        <label>Rzadkość<select value={rarity} onChange={e => setRarity(e.target.value)}>{data.rarities.map(r => <option key={r.key} value={r.key}>{r.name}</option>)}</select></label>
        <label className={s.chk}><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Włączona (wypada ze skrzynek)</label>
      </div>
      <div className={s.line}>
        <span className="muted small">Wypada ze skrzynek:</span>
        {data.crates.map(c => (
          <label key={c.id} className={s.chk}><input type="checkbox" checked={inCrates.includes(c.id)} onChange={e => setInCrates(l => e.target.checked ? [...l, c.id] : l.filter(x => x !== c.id))} /> {crateNames.get(c.id)}</label>
        ))}
        {!data.crates.length && <span className="muted small">(najpierw dodaj skrzynkę z naklejkami)</span>}
      </div>
      <div className={s.line}>
        <Button kind="hue" disabled={busy || !dirty} onClick={save}>Zapisz</Button>
        <label className={s.upload}><Upload size={14} aria-hidden="true" /> Podmień PNG<input ref={file} type="file" accept="image/png,image/webp" onChange={e => replace(e.target.files?.[0])} disabled={busy} /></label>
        <Button disabled={busy} onClick={() => confirm(`Usunąć naklejkę „${st.name}”? Znikną też wszystkie jej egzemplarze u graczy (${st.owned} w ekwipunkach, ${st.placed} na kartach).`) && run(() => api(`/api/admin/gstickers/${st.id}/delete`, {}), 'Usunięto naklejkę')}><Trash2 size={15} aria-hidden="true" /> Usuń</Button>
        <span className="muted small">{st.owned} w ekwipunkach, {st.placed} na kartach</span>
      </div>
    </article>
  );
}

function NewSticker({ data, busy, run }: { data: Data; busy: boolean; run: Run }) {
  const [name, setName] = useState('');
  const [rarity, setRarity] = useState('green');
  const [inCrates, setInCrates] = useState<string[]>([]);
  const [fileObj, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = () => {
    if (!fileObj) return toast('Wybierz plik PNG', true);
    const f = new FormData();
    f.set('name', name); f.set('rarity', rarity); f.set('enabled', '1'); f.set('crates', JSON.stringify(inCrates)); f.set('image', fileObj);
    return run(async () => { await send(f); setName(''); setFile(null); if (input.current) input.current.value = ''; }, 'Dodano naklejkę');
  };
  return (
    <div className={s.newBox}>
      <h4>Nowa naklejka</h4>
      <div className={s.fields}>
        <label>Nazwa<input value={name} maxLength={40} onChange={e => setName(e.target.value)} /></label>
        <label>Rzadkość<select value={rarity} onChange={e => setRarity(e.target.value)}>{data.rarities.map(r => <option key={r.key} value={r.key}>{r.name}</option>)}</select></label>
        <label>Plik PNG (najlepiej z przezroczystym tłem i białym obrysem)<input ref={input} type="file" accept="image/png,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      <div className={s.line}>
        <span className="muted small">Wypada ze skrzynek:</span>
        {data.crates.map(c => <label key={c.id} className={s.chk}><input type="checkbox" checked={inCrates.includes(c.id)} onChange={e => setInCrates(l => e.target.checked ? [...l, c.id] : l.filter(x => x !== c.id))} /> {c.name}</label>)}
        <Button kind="hue" disabled={busy || !name.trim() || !fileObj} onClick={add}><Plus size={15} aria-hidden="true" /> Dodaj naklejkę</Button>
      </div>
    </div>
  );
}
