import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import s from './ThemesAdmin.module.css';

type Mode = 'dates' | 'permanent' | 'off';
interface Data { today: string; independence: { mode: Mode; from: string; to: string; active: boolean } }

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Strona „Motywy”: dostępność motywów czasowych (teraz Niepodległość) dla wszystkich graczy */
export default function ThemesAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [f, setF] = useState<{ mode: Mode; from: string; to: string } | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    api<Data>('/api/admin/themes').then(d => { setData(d); setF({ mode: d.independence.mode, from: d.independence.from, to: d.independence.to }); }).catch(e => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  if (err) return <p className="muted">{err}</p>;
  if (!data || !f) return <p className="muted">Wczytywanie…</p>;
  const w = data.independence;
  const dirty = f.mode !== w.mode || f.from !== w.from || f.to !== w.to;
  const save = async () => {
    try { await api('/api/admin/themes', { theme: 'independence', ...f }); toast('Zapisano'); load(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className={s.box}>
      <p className="muted">
        Motyw wygląda jak Warm Editorial, ale w bieli i czerwieni, z motywami z 1918 roku. Gracze wybierają go w Ustawieniach, w sekcji Eksperymentalne,
        i widzą go tylko wtedy, gdy jest dostępny. Po upływie terminu ich gra wraca sama do motywu domyślnego. Admini widzą go zawsze, żeby móc go sprawdzić.
      </p>
      <section className={s.card}>
        <h3>Niepodległość</h3>
        <p className={w.active ? s.on : s.off}>
          {w.active ? 'Teraz dostępny dla wszystkich graczy.' : 'Teraz niedostępny dla graczy (admini go widzą).'} <span className="muted">Dziś jest {data.today}.</span>
        </p>
        <label className={s.radio}><input type="radio" name="mode" checked={f.mode === 'dates'} onChange={() => setF({ ...f, mode: 'dates' })} /> W terminie (włącznie z obiema datami)</label>
        <div className={s.dates}>
          <label>Od<input type="date" value={f.from} disabled={f.mode !== 'dates'} onChange={e => setF({ ...f, from: e.target.value })} /></label>
          <label>Do<input type="date" value={f.to} disabled={f.mode !== 'dates'} onChange={e => setF({ ...f, to: e.target.value })} /></label>
          <Button kind="quiet" disabled={f.mode !== 'dates' || !f.to} onClick={() => setF({ ...f, to: addDays(f.to, 1) })}>Przedłuż o dzień</Button>
          <Button kind="quiet" disabled={f.mode !== 'dates' || !f.to} onClick={() => setF({ ...f, to: addDays(f.to, 7) })}>Przedłuż o tydzień</Button>
        </div>
        <label className={s.radio}><input type="radio" name="mode" checked={f.mode === 'permanent'} onChange={() => setF({ ...f, mode: 'permanent' })} /> Na stałe (zawsze dostępny)</label>
        <label className={s.radio}><input type="radio" name="mode" checked={f.mode === 'off'} onChange={() => setF({ ...f, mode: 'off' })} /> Wyłączony (nie zostaje u nikogo poza adminami)</label>
        <div><Button kind="hue" disabled={!dirty} onClick={save}>Zapisz</Button></div>
      </section>
    </div>
  );
}
