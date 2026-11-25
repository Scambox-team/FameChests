import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Gift, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import pk from '../profile/playerCard.module.css';
import s from './CosmeticsAdmin.module.css';

// Panel admina „Kosmetyki profilu” (server/src/cosmetics.rs, routes/cosmetics.rs): tła miniprofilu, obramówki zdjęcia profilowego i tła profilu -
// jeden katalog dla wszystkich trzech rodzajów. Wymiary są sztywne (serwer odrzuca inne), źródło odblokowania to nagroda (osiągnięcia, eventy,
// levele, Paszport), automat (questy, odznaka służby) albo ręczne nadanie z tego panelu.
type Kind = 'mini' | 'frame' | 'bg' | 'avatar';
interface Item { price: number; inShop: boolean; tags: string[]; stock: number | null; sold: number; saleFrom: number | null; saleTo: number | null; id: string; kind: Kind; name: string; source: string; auto: string; enabled: boolean; hideLocked: boolean; url: string; animated: boolean; w: number; h: number; owners: number; worn: number }
interface KindInfo { key: Kind; label: string; w: number; h: number; maxKb: number; requirements: string }
interface Data { list: Item[]; kinds: KindInfo[]; auto: { key: string; name: string }[]; max: number; colors: { key: string; name: string }[] }

/** datetime-local <-> sekundy unixowe (puste = bez ograniczenia) */
const toLocal = (t: number | null) => t ? new Date(t * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
const fromLocal = (s: string) => s ? String(Math.round(new Date(s).getTime() / 1000)) : "";

async function send(form: FormData) {
  const res = await fetch('/api/admin/cosmetics/save', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Błąd serwera');
  return data;
}

/** Wymiary wybranego pliku w przeglądarce (szybka odpowiedź przed wysłaniem; serwer i tak sprawdza) */
function imageSize(file: File): Promise<{ w: number; h: number; url: string }> {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => ok({ w: img.naturalWidth, h: img.naturalHeight, url });
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('To nie jest obrazek')); };
    img.src = url;
  });
}

/** Podgląd na żywo w miejscu, w którym kosmetyk będzie pokazany: miniprofil, ramka wokół ikony, tło profilu */
function Preview({ kind, src }: { kind: Kind; src: string }) {
  if (kind === 'avatar') {
    return <div className={s.pvAvatar}><img src={src} alt="Podgląd zdjęcia profilowego" /></div>;
  }
  if (kind === 'frame') {
    return (
      <div className={s.pvFrame}>
        <span className={s.pvLetter}>A</span>
        <img src={src} alt="Podgląd obramówki" />
      </div>
    );
  }
  if (kind === 'bg') {
    return (
      <div className={s.pvProfile}>
        <div className={s.pvImg} style={{ backgroundImage: `url("${src}")` }} />
        <div className={s.pvShade} />
        <div className={s.pvPanel}><b>Nazwa gracza</b><span className="muted small">Tak wygląda tło za panelami profilu (przyciemnione kolorem motywu)</span></div>
      </div>
    );
  }
  return (
    <div className={`${pk.pkCard} ${pk.pkStatic}`}>
      <div className={pk.pkBg} style={{ backgroundImage: `url("${src}")` }} />
      <div className={pk.pkTone} />
      <div className={pk.pkTop}><span className={s.pvLetter}>A</span><div className={pk.pkWho}><b className={pk.pkNick}>Nazwa gracza</b><span className={pk.pkLine}><span className={pk.pkLv}>Level 12</span></span></div></div>
    </div>
  );
}

function Kinds({ data }: { data: Data }) {
  return (
    <table className={s.reqs}>
      <thead><tr><th>Rodzaj</th><th>Wymiary</th><th>Wymagania</th></tr></thead>
      <tbody>{data.kinds.map(k => <tr key={k.key}><td><b>{k.label}</b></td><td>{k.w} × {k.h} px</td><td>{k.requirements}</td></tr>)}</tbody>
    </table>
  );
}

/** Pola sklepu wspólne dla nowego kosmetyku i wiersza: cena w euro, „W sklepie”, limit sztuk, okno sprzedaży, tagi koloru */
interface Shop { price: string; inShop: boolean; stock: string; from: string; to: string; tags: string[] }
const shopOf = (it: Item): Shop => ({ price: String(it.price), inShop: it.inShop, stock: it.stock == null ? '' : String(it.stock), from: toLocal(it.saleFrom), to: toLocal(it.saleTo), tags: it.tags });
function putShop(fd: FormData, v: Shop, tags: boolean) {
  fd.set('price', v.price); fd.set('inShop', v.inShop ? '1' : '0'); fd.set('stock', v.stock); fd.set('saleFrom', fromLocal(v.from)); fd.set('saleTo', fromLocal(v.to));
  if (tags) fd.set('tags', v.tags.join(','));
}
function ShopEditor({ v, set, colors, tagsNote }: { v: Shop; set: (v: Shop) => void; colors: Data['colors']; tagsNote?: string }) {
  return (
    <>
      <div className={s.fields}>
        <label>Cena (euro)<input type="number" min={0} inputMode="numeric" value={v.price} onChange={e => set({ ...v, price: e.target.value })} /></label>
        <label>Limit sztuk (puste = bez limitu)<input type="number" min={1} inputMode="numeric" value={v.stock} onChange={e => set({ ...v, stock: e.target.value })} /></label>
        <label>Sprzedaż od (puste = od razu)<input type="datetime-local" value={v.from} onChange={e => set({ ...v, from: e.target.value })} /></label>
        <label>Sprzedaż do (puste = bez końca)<input type="datetime-local" value={v.to} onChange={e => set({ ...v, to: e.target.value })} /></label>
      </div>
      <div className={s.line}>
        <label className={s.chk}><input type="checkbox" checked={v.inShop} onChange={e => set({ ...v, inShop: e.target.checked })} /> W sklepie (odznacz, gdy kosmetyk zdobywa się inaczej: quest, event, osiągnięcie - w sklepie zobaczy go wtedy tylko admin)</label>
      </div>
      <div className={s.line} role="group" aria-label="Tagi koloru">
        <span className="muted small">Kolory{tagsNote ? ` (${tagsNote})` : ''}:</span>
        {colors.map(c => <button key={c.key} type="button" className={`${s.tag}${v.tags.includes(c.key) ? ` ${s.tagOn}` : ''}`} aria-pressed={v.tags.includes(c.key)}
          onClick={() => set({ ...v, tags: v.tags.includes(c.key) ? v.tags.filter(x => x !== c.key) : [...v.tags, c.key] })}>{c.name}</button>)}
      </div>
    </>
  );
}

function NewForm({ data, run }: { data: Data; run: (fn: () => Promise<unknown>, done: string) => Promise<void> }) {
  const [shop, setShop] = useState<Shop>({ price: '500', inShop: true, stock: '', from: '', to: '', tags: [] });
  const [manualTags, setManualTags] = useState(false);
  const [kind, setKind] = useState<Kind>('mini');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [auto, setAuto] = useState('');
  const [hide, setHide] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pre, setPre] = useState<{ w: number; h: number; url: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const info = data.kinds.find(k => k.key === kind)!;
  const wrong = pre && (pre.w !== info.w || pre.h !== info.h);

  const pick = async (f: File | undefined) => {
    if (pre) URL.revokeObjectURL(pre.url);
    setFile(f ?? null); setPre(null);
    if (f) try { setPre(await imageSize(f)); } catch (e: any) { toast(e.message, true); setFile(null); }
  };
  const submit = () => {
    if (!file) return toast('Wybierz plik z grafiką', true);
    const f = new FormData();
    f.set('kind', kind); f.set('name', name); f.set('source', source); f.set('auto', auto); f.set('enabled', '1'); f.set('hideLocked', hide ? '1' : '0'); f.set('image', file); putShop(f, shop, manualTags);
    run(async () => { await send(f); setName(''); setSource(''); setFile(null); setPre(null); if (input.current) input.current.value = ''; }, 'Dodano kosmetyk');
  };

  return (
    <div className={s.newBox}>
      <h4>Nowy kosmetyk</h4>
      <div className={s.fields}>
        <label>Rodzaj<select value={kind} onChange={e => { setKind(e.target.value as Kind); pick(undefined); if (input.current) input.current.value = ''; }}>{data.kinds.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
        <label>Nazwa<input value={name} maxLength={40} onChange={e => setName(e.target.value)} placeholder="np. Złota korona" /></label>
        <label>Jak zdobyć (widzi gracz)<input value={source} maxLength={120} onChange={e => setSource(e.target.value)} placeholder="np. Nagroda za 7. dzień kalendarza" /></label>
        <label>Odblokowanie samym zdarzeniem<select value={auto} onChange={e => setAuto(e.target.value)}>{data.auto.map(a => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
      </div>
      <div className={s.line}>
        <label className={s.upload}><Upload size={15} aria-hidden="true" /> Wybierz grafikę ({info.w} × {info.h})<input ref={input} type="file" accept="image/png,image/webp,image/gif,image/jpeg" onChange={e => pick(e.target.files?.[0])} /></label>
        {pre && <span className={wrong ? s.bad : 'muted small'}>{file?.name}: {pre.w} × {pre.h} px{wrong ? ` (wymagane ${info.w} × ${info.h})` : ' - wymiary OK'}</span>}
        <label className={s.chk}><input type="checkbox" checked={hide} onChange={e => setHide(e.target.checked)} /> Ukryj przed graczami, którzy jej nie mają</label>
      </div>
      <ShopEditor v={shop} set={v => { if (v.tags.join() !== shop.tags.join()) setManualTags(true); setShop(v); }} colors={data.colors} tagsNote={manualTags ? 'ustawione ręcznie' : 'bez zaznaczenia: wykryją się z grafiki po dodaniu'} />
      <p className="muted small">{info.requirements}</p>
      {pre && !wrong && <Preview kind={kind} src={pre.url} />}
      <div className={s.line}><Button kind="hue" disabled={!file || !!wrong || !name.trim()} onClick={submit}><Plus size={15} aria-hidden="true" /> Dodaj</Button></div>
    </div>
  );
}

function Row({ it, data, first, last, move, run }: { it: Item; data: Data; first: boolean; last: boolean; move: (d: -1 | 1) => void; run: (fn: () => Promise<unknown>, done: string) => Promise<void> }) {
  const info = data.kinds.find(k => k.key === it.kind)!;
  const [f, setF] = useState({ name: it.name, source: it.source, auto: it.auto, enabled: it.enabled, hideLocked: it.hideLocked });
  const [open, setOpen] = useState(false);
  const [sh, setSh] = useState<Shop>(shopOf(it));
  const [retag, setRetag] = useState(true);
  const dirty = JSON.stringify(f) !== JSON.stringify({ name: it.name, source: it.source, auto: it.auto, enabled: it.enabled, hideLocked: it.hideLocked }) || JSON.stringify(sh) !== JSON.stringify(shopOf(it));
  const form = (img?: File) => {
    const fd = new FormData();
    fd.set('id', it.id); fd.set('name', f.name); fd.set('source', f.source); fd.set('auto', f.auto); fd.set('enabled', f.enabled ? '1' : '0'); fd.set('hideLocked', f.hideLocked ? '1' : '0');
    putShop(fd, sh, true);
    if (img) { fd.set('image', img); if (retag) fd.set('retag', '1'); }
    return fd;
  };
  const swap = async (file: File | undefined) => {
    if (!file) return;
    try { const p = await imageSize(file); URL.revokeObjectURL(p.url); if (p.w !== info.w || p.h !== info.h) return toast(`Wymagane ${info.w} × ${info.h} px, plik ma ${p.w} × ${p.h}`, true); }
    catch (e: any) { return toast(e.message, true); }
    run(() => send(form(file)), 'Wymieniono grafikę');
  };
  return (
    <div className={`${s.row}${f.enabled ? '' : ` ${s.off}`}`}>
      <button type="button" className={`${s.thumb} ${s[`k_${it.kind}`]}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Podgląd: ${it.name}`}><img src={it.url} alt="" loading="lazy" /></button>
      <div className={s.rowBody}>
        <div className={s.fields}>
          <label>Nazwa<input value={f.name} maxLength={40} onChange={e => setF({ ...f, name: e.target.value })} /></label>
          <label>Jak zdobyć<input value={f.source} maxLength={120} onChange={e => setF({ ...f, source: e.target.value })} /></label>
          <label>Zdarzenie<select value={f.auto} onChange={e => setF({ ...f, auto: e.target.value })}>{data.auto.map(a => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
        </div>
        <ShopEditor v={sh} set={setSh} colors={data.colors} />
        <div className={s.line}>
          <label className={s.chk}><input type="checkbox" checked={f.enabled} onChange={e => setF({ ...f, enabled: e.target.checked })} /> Włączony</label>
          <label className={s.chk}><input type="checkbox" checked={f.hideLocked} onChange={e => setF({ ...f, hideLocked: e.target.checked })} /> Ukryty, gdy gracz go nie ma</label>
          <span className="muted small">{it.w} × {it.h}{it.animated ? ' · animowany' : ''} · ma {it.owners} · założony u {it.worn} · sprzedano {it.sold}{it.stock != null ? ` / ${it.stock}` : ''} · id: {it.id}</span>
        </div>
        <div className={s.line}>
          <Button kind="hue" disabled={!dirty || !f.name.trim()} onClick={() => run(() => send(form()), 'Zapisano')}>Zapisz</Button>
          <label className={s.chk}><input type="checkbox" checked={retag} onChange={e => setRetag(e.target.checked)} /> Po wymianie wykryj kolory od nowa</label>
          <label className={s.upload}><Upload size={15} aria-hidden="true" /> Wymień grafikę<input type="file" accept="image/png,image/webp,image/gif,image/jpeg" onChange={e => { swap(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <Button aria-label="Wyżej w katalogu" disabled={first} onClick={() => move(-1)}><ArrowUp size={15} aria-hidden="true" /></Button>
          <Button aria-label="Niżej w katalogu" disabled={last} onClick={() => move(1)}><ArrowDown size={15} aria-hidden="true" /></Button>
          <Button onClick={() => confirm(`Usunąć „${it.name}”? Gracze, którzy go mają (${it.owners}), tracą go, a założony wraca do standardowego wyglądu.`) && run(() => api(`/api/admin/cosmetics/${encodeURIComponent(it.id)}/delete`, {}), 'Usunięto')}><Trash2 size={15} aria-hidden="true" /> Usuń</Button>
        </div>
        {open && <Preview kind={it.kind} src={it.url} />}
      </div>
    </div>
  );
}

function Grant({ data, run }: { data: Data; run: (fn: () => Promise<unknown>, done: string) => Promise<void> }) {
  const [user, setUser] = useState('');
  const [id, setId] = useState('');
  const call = (revoke: boolean) => {
    if (!user.trim() || !id) return toast('Wpisz nazwę gracza i wybierz kosmetyk', true);
    run(async () => { const r = await api('/api/admin/cosmetics/grant', { username: user.trim(), id, revoke }); toast(r.message); }, revoke ? 'Odebrano' : 'Nadano');
  };
  return (
    <div className={s.newBox}>
      <h4><Gift size={16} aria-hidden="true" /> Ręczne nadanie</h4>
      <p className="muted small">Gracz dostaje kosmetyk od razu (zapis w dzienniku adminów). „Odbierz” zdejmuje go też, jeśli go nosi.</p>
      <div className={s.fields}>
        <label>Nazwa gracza<input value={user} onChange={e => setUser(e.target.value)} maxLength={30} /></label>
        <label>Kosmetyk<select value={id} onChange={e => setId(e.target.value)}><option value="">wybierz</option>{data.list.map(c => <option key={c.id} value={c.id}>{data.kinds.find(k => k.key === c.kind)?.label}: {c.name}</option>)}</select></label>
      </div>
      <div className={s.line}><Button kind="hue" onClick={() => call(false)}>Nadaj</Button><Button onClick={() => call(true)}>Odbierz</Button></div>
    </div>
  );
}

export default function CosmeticsAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<Data>('/api/admin/cosmetics').then(setData).catch(e => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!data) return <p className="muted">Wczytywanie…</p>;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast(done); await load(); } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const move = (kind: Kind, i: number, d: -1 | 1) => {
    const ids = data.list.filter(c => c.kind === kind).map(c => c.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    const rest = data.list.filter(c => c.kind !== kind).map(c => c.id);
    run(() => api('/api/admin/cosmetics/order', { ids: [...ids, ...rest] }), 'Zmieniono kolejność');
  };

  return (
    <section className={s.page} aria-busy={busy}>
      <p className="muted">Kosmetyki to tła miniprofilu, obramówki zdjęcia profilowego i tła całej strony profilu. Gracz domyślnie nie ma żadnego: odblokowuje je nagrodami
        (w edytorach nagród osiągnięć, kalendarza adwentowego, Paszportu i leveli EXP jest pozycja „Kosmetyk profilu”), samym zdarzeniem (quest Wanted / CTF, odznaka służby) albo
        dostaje je od admina. Na grafice zawsze leży warstwa w kolorach motywu, więc nawet jaskrawy obrazek nie psuje czytelności ani wyglądu motywu.</p>
      <div className={`panel ${s.block}`}><h3>Wymagania wobec grafik</h3><Kinds data={data} /></div>
      <div className={`panel ${s.block}`}><NewForm data={data} run={run} /></div>
      {data.kinds.map(k => {
        const list = data.list.filter(c => c.kind === k.key);
        return (
          <div key={k.key} className={`panel ${s.block}`}>
            <h3>{k.label} ({list.length})</h3>
            {list.map((it, i) => <Row key={`${it.id}:${it.url}`} it={it} data={data} first={i === 0} last={i === list.length - 1} move={d => move(k.key, i, d)} run={run} />)}
            {!list.length && <p className="muted">Nie ma jeszcze żadnych pozycji tego rodzaju.</p>}
          </div>
        );
      })}
      <div className={`panel ${s.block}`}><Grant data={data} run={run} /></div>
    </section>
  );
}
