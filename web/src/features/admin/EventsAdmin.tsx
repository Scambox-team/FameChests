import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Plus, RotateCcw, Trash2, TreePine } from 'lucide-react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import s from './EventsAdmin.module.css';

// Zakładka panelu admina „Eventy” (server/src/events.rs, routes/events.rs): nazwa, opis, termin i zawartość eventu -
// dropy wariantów ze wszystkich skrzynek w czasie eventu i kalendarz adwentowy (nagrody na kolejne dni).
type Reward = { type: 'card' | 'chest' | 'money'; person?: string; variant?: string; kind?: string; count?: number; amount?: number };
interface GameEvent { id: string; name: string; desc: string; start: string; end: string; enabled: boolean; drops: { variant: string; chance: number }[]; advent: Reward[][] | null }
interface Meta {
  events: GameEvent[]; variants: { key: string; name: string; chance: number; enabled: boolean; special?: boolean }[];
  cards: { id: string; name: string; rarity: string; special?: boolean; fixedVariant?: string | null }[]; chests: { kind: string; name: string }[]; claims: Record<string, number>; today: string;
}

const pct = (x: number) => +(x * 100).toFixed(4);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
const status = (e: GameEvent, today: string) => !e.enabled ? 'wyłączony' : today < e.start ? 'zaplanowany' : today > e.end ? 'zakończony' : 'trwa';

interface Xmas { enabled: boolean; testDate: string; event: { name: string; start: string; end: string } | null; tree: { cards: number; players: number; value: number }; settled: boolean; sharePct: number; specialCards: { person: string; name: string | null; variant: string }[] }

/** Choinka i kalendarz eventu świątecznego (server/src/routes/christmas.rs): włączanie dla graczy, data testowa, rozliczenie, czyszczenie */
function ChristmasPanel() {
  const [x, setX] = useState<Xmas | null>(null);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Xmas>('/api/admin/christmas').then(r => { setX(r); setDate(r.testDate); }).catch(e => toast(e.message, true)); }, []);
  const send = async (body: object, msg: string) => {
    setBusy(true);
    try { const r = await api<Xmas>('/api/admin/christmas', body); setX(r); setDate(r.testDate); toast(msg); } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  if (!x) return null;
  return (
    <article className={`panel ${s.event}`} aria-label="Choinka i kalendarz świąteczny">
      <div className={s.body}>
        <h4><TreePine size={16} aria-hidden="true" /> Choinka i kalendarz adwentowy (event „Święta”)</h4>
        <p className="muted small">Wspólna choinka: każdy gracz wiesza codziennie jedną kartę, na koniec eventu dostaje je z powrotem i losowe karty za {x.sharePct}% ich wartości
          w wariantach z dropów eventu. {x.specialCards.length ? `Karta specjalna z choinki (dla każdego z wkładem): ${x.specialCards.map(c => c.name || c.person).join(', ')}.` : 'Karta specjalna z choinki: żadna (ustaw źródło „Choinka” w karcie specjalnej).'}
          {x.event ? ` Termin: ${x.event.start} – ${x.event.end}.` : ' Event „Święta” jest wyłączony albo go nie ma.'}</p>
        <label className={s.chk}><input type="checkbox" checked={x.enabled} disabled={busy} onChange={e => send({ enabled: e.target.checked }, e.target.checked ? 'Choinka i kalendarz włączone dla graczy' : 'Wyłączone dla graczy (admini nadal je widzą)')} />
          Włączone dla wszystkich graczy (wyłączone: widzą je tylko admini)</label>
        <div className={s.row}>
          <label className={s.inline}>Data testowa (tylko dla adminów) <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <Button disabled={busy} onClick={() => send({ testDate: date }, date ? 'Data testowa ustawiona' : 'Data testowa wyłączona')}>Zapisz datę</Button>
          <span className="muted small">Pozwala adminowi sprawdzić kalendarz i choinkę poza terminem eventu (np. 2026-12-05). Gracze widzą prawdziwą datę.</span>
        </div>
        <p className="muted small">Na choince: {x.tree.cards} kart od {x.tree.players} graczy (wartość {x.tree.value.toLocaleString('pl-PL')} gr). {x.settled ? 'Choinka rozliczona.' : 'Rozliczy się sama po ostatnim dniu eventu.'}</p>
        <div className={s.btns}>
          <Button disabled={busy || x.settled} onClick={() => { if (confirm('Rozliczyć choinkę TERAZ? Wszystkim graczom zwrócą się powieszone karty i dostaną nagrody, nie da się tego cofnąć. Na produkcji rób to tylko przy teście.')) send({ action: 'settle' }, 'Choinka rozliczona'); }}>Rozlicz teraz</Button>
          <Button disabled={busy} onClick={() => { if (confirm('Wyczyścić choinkę? Powieszone karty wrócą do graczy BEZ nagród, wpisy i wyniki zostaną skasowane. Używaj po próbach.')) send({ action: 'reset' }, 'Choinka wyczyszczona'); }}>
            <RotateCcw size={15} aria-hidden="true" /> Wyczyść choinkę (po próbach)</Button>
        </div>
      </div>
    </article>
  );
}

export default function EventsAdmin() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { api<Meta>('/api/admin/events').then(m => { setMeta(m); setEvents(m.events); }).catch(e => toast(e.message, true)); }, []);
  const cardName = useMemo(() => new Map((meta?.cards || []).map(c => [c.id, c.name])), [meta]);

  const edit = (i: number, f: (e: GameEvent) => GameEvent) => { setEvents(list => list.map((e, k) => k === i ? f({ ...e }) : e)); setDirty(true); };
  const save = async (body: object, msg: string) => {
    setBusy(true);
    try {
      const r = await api<{ events: GameEvent[] }>('/api/admin/events', body);
      setEvents(r.events); setDirty(false); toast(msg);
    } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const addEvent = () => {
    const today = meta?.today || new Date().toISOString().slice(0, 10);
    setEvents(list => [...list, { id: '', name: 'Nowy event', desc: '', start: today, end: today, enabled: false, drops: [], advent: null }]);
    setOpen(`new${events.length}`); setDirty(true);
  };

  if (!meta) return <p className="muted">Wczytywanie…</p>;
  return (
    <section className={s.box}>
      <div className={s.head}>
        <p className="muted">Eventy z terminem (daty włącznie, czas serwera). Dropy: wariant wypada ze <b>wszystkich skrzynek</b> z podaną szansą przez cały event, także
          gdy jest wyłączony na /variants (na /variants widać go jako wydarzenie „Event: …”). Kalendarz adwentowy: dzień 1 = dzień startu eventu, gracz
          odbiera nagrodę raz, a zaległe okienka z poprzednich dni może otworzyć później. Gracze widzą trwające eventy i te, które zaczną się w ciągu 14 dni.</p>
        <div className={s.btns}>
          <Button onClick={addEvent}><Plus size={15} aria-hidden="true" /> Nowy event</Button>
          <Button kind="hue" disabled={busy || !dirty} onClick={() => save({ events }, 'Eventy zapisane')}>Zapisz wszystko</Button>
          <Button disabled={busy} onClick={() => { if (confirm('Przywrócić eventy z kodu (game.json)? Twoje zmiany eventów zostaną usunięte.')) save({ reset: true }, 'Przywrócono domyślne eventy'); }}>
            <RotateCcw size={15} aria-hidden="true" /> Domyślne</Button>
        </div>
      </div>

      <ChristmasPanel />

      {events.map((e, i) => {
        const key = e.id || `new${i}`, isOpen = open === key, st = status(e, meta.today);
        return (
          <article key={key} className={`panel ${s.event}`}>
            <button type="button" className={s.summary} onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
              <CalendarDays size={18} aria-hidden="true" />
              <b>{e.name}</b>
              <span className="muted">{e.start} – {e.end}</span>
              <span className={`${s.chip} ${({ trwa: s.trwa, zaplanowany: s.zaplanowany, 'zakończony': s.zakonczony } as Record<string, string>)[st] || ''}`}>{st}</span>
              {e.drops.length > 0 && <span className="muted small">{e.drops.map(d => `${meta.variants.find(v => v.key === d.variant)?.name || d.variant} ${pct(d.chance)}%`).join(', ')}</span>}
              {e.advent && <span className="muted small">kalendarz: {e.advent.length} dni{meta.claims[e.id] ? ` · odebrano ${meta.claims[e.id]}×` : ''}</span>}
            </button>
            {isOpen && (
              <div className={s.body}>
                <div className={s.grid}>
                  <label>Nazwa<input value={e.name} maxLength={60} onChange={x => edit(i, v => ({ ...v, name: x.target.value }))} /></label>
                  <label>Od<input type="date" value={e.start} onChange={x => edit(i, v => ({ ...v, start: x.target.value }))} /></label>
                  <label>Do (włącznie)<input type="date" value={e.end} onChange={x => edit(i, v => ({ ...v, end: x.target.value }))} /></label>
                  <label className={s.chk}><input type="checkbox" checked={e.enabled} onChange={x => edit(i, v => ({ ...v, enabled: x.target.checked }))} /> Event włączony</label>
                  <label className={s.wide}>Opis dla graczy (co jest w evencie)<textarea rows={3} maxLength={600} value={e.desc} onChange={x => edit(i, v => ({ ...v, desc: x.target.value }))} /></label>
                </div>

                <h4>Dropy ze wszystkich skrzynek</h4>
                {e.drops.map((d, k) => (
                  <div key={k} className={s.row}>
                    <select value={d.variant} onChange={x => edit(i, v => ({ ...v, drops: v.drops.map((y, j) => j === k ? { ...y, variant: x.target.value } : y) }))}>
                      {meta.variants.filter(v => !v.special).map(v => <option key={v.key} value={v.key}>{v.name}{v.enabled ? '' : ' (wyłączony)'}</option>)}
                    </select>
                    <label className={s.inline}>Szansa <input type="number" min={0} max={20} step="any" value={pct(d.chance)}
                      onChange={x => edit(i, v => ({ ...v, drops: v.drops.map((y, j) => j === k ? { ...y, chance: (+x.target.value || 0) / 100 } : y) }))} /> %</label>
                    <span className="muted small">{d.chance > 0 ? `1 na ${Math.round(1 / d.chance).toLocaleString('pl-PL')} kart` : ''}</span>
                    <Button onClick={() => edit(i, v => ({ ...v, drops: v.drops.filter((_, j) => j !== k) }))} aria-label="Usuń drop"><Trash2 size={15} /></Button>
                  </div>
                ))}
                <Button onClick={() => edit(i, v => ({ ...v, drops: [...v.drops, { variant: meta.variants[0]?.key || 'gold', chance: 0.02 }] }))}><Plus size={15} aria-hidden="true" /> Dodaj drop</Button>

                <h4>Kalendarz adwentowy</h4>
                <label className={s.chk}><input type="checkbox" checked={!!e.advent} onChange={x => edit(i, v => ({ ...v, advent: x.target.checked ? Array.from({ length: Math.min(24, daysBetween(v.start, v.end)) }, () => []) : null }))} /> Event ma kalendarz adwentowy</label>
                {e.advent && (
                  <>
                    <div className={s.row}>
                      <label className={s.inline}>Liczba okienek <input type="number" min={1} max={31} value={e.advent.length}
                        onChange={x => { const n = Math.max(1, Math.min(31, +x.target.value || 1)); edit(i, v => ({ ...v, advent: Array.from({ length: n }, (_, j) => v.advent?.[j] || []) })); }} /></label>
                      <span className="muted small">Dzień 1 = {e.start}. Nagrody w okienku: karta (w wariancie), skrzynka (z kartami albo z pieniędzmi) i grosze - dowolnie łączone.</span>
                    </div>
                    <datalist id="evCards">{meta.cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</datalist>
                    <div className={s.days}>
                      {e.advent.map((day, d) => {
                        const card = day.find(r => r.type === 'card'), chest = day.find(r => r.type === 'chest'), money = day.find(r => r.type === 'money');
                        const setDay = (type: Reward['type'], r: Reward | null) => edit(i, v => ({ ...v, advent: v.advent!.map((x, j) => j !== d ? x : [...x.filter(y => y.type !== type), ...(r ? [r] : [])]) }));
                        return (
                          <div key={d} className={s.day}>
                            <b className={s.dayN}>{d + 1}</b>
                            <label>Karta (id)<input list="evCards" value={card?.person || ''} placeholder="brak" onChange={x => setDay('card', x.target.value ? { type: 'card', person: x.target.value.trim(), variant: meta.cards.find(c => c.id === x.target.value.trim())?.fixedVariant || card?.variant || 'normal', count: 1 } : null)} />
                              {card?.person && <small className="muted">{cardName.get(card.person) || 'nie ma takiej karty'}</small>}</label>
                            <label>Wariant<select value={card?.variant || 'normal'} disabled={!card} onChange={x => setDay('card', { ...card!, variant: x.target.value })}>
                              <option value="normal">Zwykła</option>{meta.variants.map(v => <option key={v.key} value={v.key}>{v.name}</option>)}</select></label>
                            <label>Skrzynka<select value={chest?.kind || ''} onChange={x => setDay('chest', x.target.value ? { type: 'chest', kind: x.target.value, count: chest?.count || 1 } : null)}>
                              <option value="">brak</option>{meta.chests.map(c => <option key={c.kind} value={c.kind}>{c.name}</option>)}</select></label>
                            <label>Ile<input type="number" min={1} max={20} value={chest?.count || 1} disabled={!chest} onChange={x => setDay('chest', { ...chest!, count: Math.max(1, +x.target.value || 1) })} /></label>
                            <label>Grosze<input type="number" min={0} step={100} value={money?.amount || ''} placeholder="0" onChange={x => setDay('money', +x.target.value > 0 ? { type: 'money', amount: +x.target.value } : null)} /></label>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                <div className={s.btns}>
                  <Button kind="hue" disabled={busy} onClick={() => save({ events }, 'Eventy zapisane')}>Zapisz</Button>
                  <Button disabled={busy} onClick={() => { if (confirm(`Usunąć event „${e.name}”? (Zapisz, żeby usunąć na stałe)`)) { setEvents(l => l.filter((_, k) => k !== i)); setDirty(true); } }}>
                    <Trash2 size={15} aria-hidden="true" /> Usuń event</Button>
                </div>
              </div>
            )}
          </article>
        );
      })}
      {dirty && <p className={s.dirty}>Masz niezapisane zmiany.</p>}
    </section>
  );
}
