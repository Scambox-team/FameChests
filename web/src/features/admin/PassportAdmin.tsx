import { useEffect, useMemo, useRef, useState } from 'react';
import { Gift, Palette, Search, Trash2, Upload } from 'lucide-react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { ALL_COUNTRIES, Stamp, StampDefs, type Country } from '../passport/Stamp';
import s from './PassportAdmin.module.css';

// Zakładka panelu admina „Paszport” (server/src/routes/passport.rs, tabela passport_settings): dla każdego stempla kolor, własna
// ikona (jednokolorowy PNG na przezroczystym tle - kolor nadaje stempel) i nagroda za pierwsze zdobycie (karta w dowolnym wariancie,
// skrzynka, grosze). Nagroda trafia do gracza tylko raz, w chwili zdobycia stempla; stemple zdobyte wcześniej nie dostają jej wstecz.
type Reward = { type: 'card' | 'chest' | 'money'; person?: string; variant?: string; kind?: string; count?: number; amount?: number };
interface Setting { color: string; rewards: Reward[]; icon: number | null }
interface Data {
  settings: Record<string, Setting>; holders: Record<string, number>;
  variants: { key: string; name: string; enabled: boolean }[]; cards: { id: string; name: string; rarity: string }[]; chests: { kind: string; name: string }[];
}
const CONTINENT: Record<string, string> = { eu: 'Europa', as: 'Azja', af: 'Afryka', na: 'Ameryka Północna', sa: 'Ameryka Południowa', oc: 'Australia i Oceania' };
const EMPTY: Setting = { color: '', rewards: [], icon: null };

const plain = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

export default function PassportAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const load = () => api<Data>('/api/admin/passport').then(setData).catch(e => toast(e.message, true));
  useEffect(() => { load(); }, []);
  const cardName = useMemo(() => new Map((data?.cards || []).map(c => [c.id, c.name])), [data]);

  const list = useMemo(() => {
    const t = plain(q.trim());
    return ALL_COUNTRIES.filter(c => !t || plain(`${c.pl} ${c.en} ${c.c}`).includes(t));
  }, [q]);

  if (!data) return <p className="muted">Wczytywanie…</p>;
  const customized = ALL_COUNTRIES.filter(c => { const x = data.settings[c.c]; return x && (x.color || x.icon || x.rewards.length); }).length;
  return (
    <section className={s.box}>
      <StampDefs />
      <div className={s.head}>
        <p className="muted">Stemple zdobywają gracze, którzy zaznaczą lokalizację w zakładce Paszport. Tutaj ustawiasz dla każdego państwa <b>kolor</b>, <b>własną ikonę</b> i <b>nagrodę</b> za
          pierwsze zdobycie stempla. Ikona: wgraj jednokolorowy PNG na przezroczystym tle (kolor pliku nie ma znaczenia - stempel pokoloruje ją sam i wstawi w miejsce symbolu);
          obrazek bez przezroczystości też zadziała (ciemny kształt na jasnym tle). <b>Uwaga:</b> lokalizację z przeglądarki da się podrobić, więc nagrody wpływają na ekonomię gry -
          graczom, którzy mieli stempel wcześniej, nagroda nie jest przyznawana wstecz.</p>
        <div className={s.tools}>
          <label className={s.search}><Search size={15} aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Szukaj państwa (nazwa, kod)" aria-label="Szukaj państwa" /></label>
          <span className="muted small">Z własnymi ustawieniami: {customized} z {ALL_COUNTRIES.length}</span>
        </div>
      </div>
      <datalist id="psCards">{data.cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</datalist>
      {list.map(c => (
        <Row key={c.c} country={c} setting={data.settings[c.c] || EMPTY} holders={data.holders[c.c] || 0} data={data} cardName={cardName}
          open={open === c.c} toggle={() => setOpen(open === c.c ? null : c.c)} reload={load} />
      ))}
      {!list.length && <p className="muted">Nie ma takiego państwa.</p>}
    </section>
  );
}

function summary(r: Reward, cardName: Map<string, string>, data: Data) {
  if (r.type === 'money') return `${(r.amount || 0).toLocaleString('pl-PL')} gr`;
  if (r.type === 'chest') return `${r.count || 1}× ${data.chests.find(c => c.kind === r.kind)?.name || r.kind}`;
  const v = r.variant && r.variant !== 'normal' ? ` (${data.variants.find(x => x.key === r.variant)?.name || r.variant})` : '';
  return `${cardName.get(r.person || '') || r.person}${v}${(r.count || 1) > 1 ? ` ×${r.count}` : ''}`;
}

function Row({ country, setting, holders, data, cardName, open, toggle, reload }: {
  country: Country; setting: Setting; holders: number; data: Data; cardName: Map<string, string>; open: boolean; toggle: () => void; reload: () => void;
}) {
  const [color, setColor] = useState(setting.color);
  const [rewards, setRewards] = useState<Reward[]>(setting.rewards);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setColor(setting.color); setRewards(setting.rewards); }, [setting.color, setting.rewards]);
  const dirty = color !== setting.color || JSON.stringify(rewards) !== JSON.stringify(setting.rewards);
  // podgląd stempla z tym, co jest w formularzu (kolor) i zapisaną ikoną
  const shown: Country = { ...country, col: color || country.col, icon: setting.icon ? `/passport/icon/${country.c}?v=${setting.icon}` : undefined };

  const card = rewards.find(r => r.type === 'card'), chest = rewards.find(r => r.type === 'chest'), money = rewards.find(r => r.type === 'money');
  const set = (type: Reward['type'], r: Reward | null) => setRewards(list => [...list.filter(x => x.type !== type), ...(r ? [r] : [])]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); toast(done); reload(); } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const save = () => run(() => api(`/api/admin/passport/${country.c}`, { color, rewards }), `Zapisano stempel: ${country.pl}`);
  const sendIcon = (f: File | undefined, remove = false) => {
    if (!remove && !f) return;
    const form = new FormData();
    if (remove) form.set('remove', '1'); else form.set('image', f!);
    return run(async () => {
      const res = await fetch(`/api/admin/passport/${country.c}/icon`, { method: 'POST', body: form });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || `Błąd serwera (${res.status})`);
      if (file.current) file.current.value = '';
    }, remove ? 'Usunięto ikonę' : 'Wgrano ikonę');
  };

  return (
    <article className={`panel ${s.row}`}>
      <button type="button" className={s.summary} onClick={toggle} aria-expanded={open}>
        <Stamp country={shown} earned className={s.preview} />
        <b>{country.pl}</b>
        <span className="muted small">{country.c} · {CONTINENT[country.k]}</span>
        {setting.color && <span className={s.chip}><Palette size={12} aria-hidden="true" /> <i className={s.dot} style={{ background: setting.color }} /> {setting.color}</span>}
        {setting.icon && <span className={s.chip}><Upload size={12} aria-hidden="true" /> własna ikona</span>}
        {setting.rewards.length > 0 && <span className={s.chip}><Gift size={12} aria-hidden="true" /> {setting.rewards.map(r => summary(r, cardName, data)).join(', ')}</span>}
        <span className={`muted small ${s.holders}`}>zdobyło: {holders}</span>
      </button>
      {open && (
        <div className={s.body}>
          <div className={s.cols}>
            <div className={s.block}>
              <h4>Kolor</h4>
              <div className={s.row2}>
                <input type="color" value={color || country.col} onChange={e => setColor(e.target.value)} aria-label="Kolor stempla" />
                <input className={s.hex} value={color} placeholder={country.col} maxLength={7} onChange={e => setColor(e.target.value)} aria-label="Kolor jako #rrggbb" />
                <Button disabled={!color} onClick={() => setColor('')}>Domyślny</Button>
              </div>
              <small className="muted">Puste = kolor z tabeli państw ({country.col}). Na jasnych motywach gry kolor jest automatycznie przyciemniany, na ciemnych rozjaśniany.</small>
            </div>

            <div className={s.block}>
              <h4>Ikona</h4>
              <div className={s.row2}>
                <input ref={file} type="file" accept="image/png,image/webp,image/jpeg,image/gif" onChange={e => sendIcon(e.target.files?.[0])} disabled={busy} aria-label="Plik ikony" />
                <Button disabled={busy || !setting.icon} onClick={() => confirm('Usunąć własną ikonę? Wróci symbol domyślny.') && sendIcon(undefined, true)}><Trash2 size={15} aria-hidden="true" /> Usuń</Button>
              </div>
              <small className="muted">Jednokolorowy PNG bez tła. Ikona jest przycinana do zawartości, skalowana i barwiona kolorem stempla; zapisuje się od razu po wybraniu pliku.</small>
            </div>
          </div>

          <h4>Nagroda za pierwsze zdobycie stempla</h4>
          <div className={s.reward}>
            <label>Karta (id)<input list="psCards" value={card?.person || ''} placeholder="brak" onChange={e => set('card', e.target.value ? { type: 'card', person: e.target.value.trim(), variant: card?.variant || 'normal', count: card?.count || 1 } : null)} />
              {card?.person && <small className={cardName.has(card.person) ? 'muted' : s.bad}>{cardName.get(card.person) || 'nie ma takiej karty'}</small>}</label>
            <label>Wariant<select value={card?.variant || 'normal'} disabled={!card} onChange={e => set('card', { ...card!, variant: e.target.value })}>
              <option value="normal">Zwykła</option>{data.variants.map(v => <option key={v.key} value={v.key}>{v.name}{v.enabled ? '' : ' (wyłączony)'}</option>)}</select></label>
            <label>Ile kart<input type="number" min={1} max={10} value={card?.count || 1} disabled={!card} onChange={e => set('card', { ...card!, count: Math.max(1, +e.target.value || 1) })} /></label>
            <label>Skrzynka<select value={chest?.kind || ''} onChange={e => set('chest', e.target.value ? { type: 'chest', kind: e.target.value, count: chest?.count || 1 } : null)}>
              <option value="">brak</option>{data.chests.map(c => <option key={c.kind} value={c.kind}>{c.name}</option>)}</select></label>
            <label>Ile skrzynek<input type="number" min={1} max={20} value={chest?.count || 1} disabled={!chest} onChange={e => set('chest', { ...chest!, count: Math.max(1, +e.target.value || 1) })} /></label>
            <label>Grosze<input type="number" min={0} step={100} value={money?.amount || ''} placeholder="0" onChange={e => set('money', +e.target.value > 0 ? { type: 'money', amount: +e.target.value } : null)} /></label>
          </div>
          <p className="muted small">Skrzynka: skrzynki z kartami ze sklepu albo skrzynki z pieniędzmi (Codzienna, MEGA). Karty, skrzynki i grosze można łączyć.</p>

          <div className={s.btns}>
            <Button kind="hue" disabled={busy || !dirty} onClick={save}>Zapisz kolor i nagrodę</Button>
            {dirty && <span className={s.dirty}>Niezapisane zmiany</span>}
          </div>
        </div>
      )}
    </article>
  );
}
