import { useCallback, useEffect, useState } from 'react';
import { Database, Download } from 'lucide-react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import s from './BackupsAdmin.module.css';

interface Backup { name: string; kind: 'auto' | 'manual'; size: number; createdAt: number }
interface BackupList { backups: Backup[]; everyHours: number; keep: number; dir: string; schema: string; pgDump: string | null }

const date = (t: number) => new Date(t * 1000).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
const size = (b: number) => b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`;

/** Zakładka „Kopie zapasowe”: tylko właściciel (OWNER_IDS) - serwer odrzuca każdego innego (403) */
export default function BackupsAdmin() {
  const [data, setData] = useState<BackupList | null>(null);
  const [denied, setDenied] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<BackupList>('/api/admin/backups').then(setData).catch(e => setDenied(e.message));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ backup: Backup }>('/api/admin/backups', {});
      toast(`Kopia gotowa: ${size(r.backup.size)}`);
      load();
    } catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };

  if (denied) return <p className="muted">{denied}. Kopie zapasowe pobiera tylko właściciel gry.</p>;
  if (!data) return <p className="muted">Wczytywanie…</p>;
  return (
    <section className={s.box}>
      <p className="muted">
        Kopia = cała baza gry (schemat <code>{data.schema}</code>: konta, karty, rynek, ustawienia z panelu). Plik <code>.dump</code> przywraca
        się na serwerze poleceniem <code>pg_restore</code> (instrukcja: <code>deploy/selfhost/README.md</code>). Są w nim hashe haseł i dane
        graczy - nie wysyłaj go nikomu i nie wrzucaj do internetu. Każde pobranie zapisuje się w dzienniku adminów.
      </p>
      <div className={s.info}>
        <span><Database size={15} aria-hidden="true" /> {data.everyHours > 0 ? `Automatycznie co ${data.everyHours} h` : 'Automatyczne kopie wyłączone'}, zostaje {data.keep} najnowszych każdego rodzaju</span>
        <span className="muted small">{data.pgDump ?? 'brak pg_dump na serwerze - kopie nie działają'}</span>
      </div>
      <div><Button kind="hue" disabled={busy || !data.pgDump} onClick={create}>{busy ? 'Robię kopię…' : 'Zrób kopię teraz'}</Button></div>
      {data.backups.length === 0 && <p className="muted">Nie ma jeszcze żadnej kopii.</p>}
      <ul className={s.list}>
        {data.backups.map(b => (
          <li key={b.name}>
            <span className={`${s.chip} ${b.kind === 'auto' ? s.auto : ''}`}>{b.kind === 'auto' ? 'Automatyczna' : 'Ręczna'}</span>
            <b>{date(b.createdAt)}</b>
            <span className="muted small">{size(b.size)}</span>
            <a className={s.dl} href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download><Download size={15} aria-hidden="true" /> Pobierz</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
