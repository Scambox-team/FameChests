import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { Tabs } from '../../ui/Field';
import { toast } from '../../ui/Toaster';
import { REPORT_CATEGORIES } from '../legal/useLegal';
import s from './ReportsAdmin.module.css';

interface Report {
  id: number; createdAt: number; userId: number | null; username: string;
  personId: string; cardName: string; variant: string; category: string; message: string; contact: string;
  status: string; adminNote: string; handledBy: string; handledAt: number | null;
}

const STATUS: Record<string, string> = { new: 'Nowe', in_progress: 'W trakcie', done: 'Załatwione', rejected: 'Odrzucone' };
const open = (r: Report) => r.status === 'new' || r.status === 'in_progress';
const date = (t: number) => new Date(t * 1000).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });

function Row({ r, onChange }: { r: Report; onChange: () => void }) {
  const [status, setStatus] = useState(r.status);
  const [note, setNote] = useState(r.adminNote);
  const [busy, setBusy] = useState(false);
  const cat = REPORT_CATEGORIES.find(c => c.id === r.category);
  const dirty = status !== r.status || note !== r.adminNote;

  const save = async () => {
    setBusy(true);
    try { await api(`/api/admin/reports/${r.id}`, { status, note }); toast('Zapisano'); onChange(); }
    catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm(`Usunąć zgłoszenie #${r.id}? Nie da się tego cofnąć.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/reports/${r.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Nie udało się usunąć');
      toast('Usunięto');
      onChange();
    } catch (e: any) { toast(e.message, true); setBusy(false); }
  };

  return (
    <article className={`${s.row} ${open(r) ? '' : s.closed}`}>
      <header>
        <span className={`${s.chip} ${s[r.status]}`}>{STATUS[r.status] ?? r.status}</span>
        <b>#{r.id} · {cat ? cat.label : r.category}</b>
        <span className="muted small">{date(r.createdAt)}</span>
      </header>
      <dl>
        <dt>Karta</dt><dd>{r.cardName || '—'}{r.personId && <> <code>{r.personId}</code></>}{r.variant && <> <span className="muted">({r.variant})</span></>}</dd>
        <dt>Zgłasza</dt><dd>{r.username ? <>gracz <b>{r.username}</b></> : 'osoba bez konta'}{r.contact && <> · <a href={`mailto:${r.contact}`}>{r.contact}</a></>}</dd>
      </dl>
      <p className={s.msg}>{r.message}</p>
      <div className={s.edit}>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} placeholder="Notatka wewnętrzna (np. co zrobiono z kartą). Zgłaszający jej nie widzi." />
        <div className={s.actions}>
          <Button kind="hue" disabled={busy || !dirty} onClick={save}>Zapisz</Button>
          <Button disabled={busy} onClick={remove}>Usuń</Button>
          {r.handledBy && <span className="muted small">ostatnio: {r.handledBy}{r.handledAt ? `, ${date(r.handledAt)}` : ''}</span>}
        </div>
      </div>
    </article>
  );
}

/** Zakładka „Zgłoszenia” w panelu admina: problemy z kartami wysłane formularzem /zglos */
export default function ReportsAdmin() {
  const [list, setList] = useState<Report[] | null>(null);
  const [tab, setTab] = useState<'open' | 'closed' | 'all'>('open');
  const load = useCallback(() => {
    api('/api/admin/reports').then(d => setList(d.reports)).catch(e => toast(e.message, true));
  }, []);
  useEffect(load, [load]);

  if (!list) return <p className="muted">Wczytywanie…</p>;
  const shown = list.filter(r => tab === 'all' || (tab === 'open') === open(r));
  return (
    <section className={s.box}>
      <p className="muted">
        Zgłoszenia z formularza <a href="/zglos" target="_blank" rel="noopener">/zglos</a>. Przy „To ja…” i „Prawa autorskie” zgłaszający podał e-mail: odpisz mu ręcznie.
        Uzasadnione zgłoszenie = usuń lub zmień kartę w zakładce „Skrzynki i karty”, a tu zmień status na „Załatwione”.
      </p>
      <Tabs label="Filtr" value={tab} onChange={setTab} items={[
        { id: 'open', label: 'Otwarte', count: list.filter(open).length },
        { id: 'closed', label: 'Zamknięte', count: list.filter(r => !open(r)).length },
        { id: 'all', label: 'Wszystkie', count: list.length }
      ]} />
      {shown.length === 0 && <p className="muted">Brak zgłoszeń.</p>}
      {shown.map(r => <Row key={`${r.id}:${r.status}:${r.adminNote}`} r={r} onChange={load} />)}
    </section>
  );
}
