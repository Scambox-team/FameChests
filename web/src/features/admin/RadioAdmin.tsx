import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2, Upload } from 'lucide-react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import s from './RadioAdmin.module.css';

interface Track { id: number; albumId: number; title: string; credit: string; sourceUrl: string; ext: string; size: number }
interface Album { id: number; name: string; description: string; shuffle: boolean; enabled: boolean; tracks: Track[] }
interface Data { albums: Album[]; formats: string[]; maxBytes: number }

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Jeden plik na zapytanie, żeby jeden zły nie psuł reszty */
async function upload(form: FormData): Promise<void> {
  const res = await fetch('/api/admin/radio/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Błąd serwera (${res.status})`);
}

function TrackRow({ t, i, n, albums, onChanged, move }: { t: Track; i: number; n: number; albums: Album[]; onChanged: () => void; move: (d: -1 | 1) => void }) {
  const [f, setF] = useState({ title: t.title, credit: t.credit, sourceUrl: t.sourceUrl, albumId: t.albumId });
  useEffect(() => setF({ title: t.title, credit: t.credit, sourceUrl: t.sourceUrl, albumId: t.albumId }), [t.title, t.credit, t.sourceUrl, t.albumId]);
  const dirty = f.title !== t.title || f.credit !== t.credit || f.sourceUrl !== t.sourceUrl || f.albumId !== t.albumId;
  const act = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); toast(done); onChanged(); } catch (e: any) { toast(e.message, true); } };
  return (
    <li className={s.track}>
      <span className={s.no}>{i + 1}</span>
      <div className={s.fields}>
        <label>Nazwa dla graczy
          <input value={f.title} maxLength={80} onChange={e => setF({ ...f, title: e.target.value })} />
        </label>
        <label>Źródło / credit
          <input value={f.credit} maxLength={200} placeholder="np. Autor, tytuł, licencja" onChange={e => setF({ ...f, credit: e.target.value })} />
        </label>
        <label>Link do źródła (opcjonalnie)
          <input value={f.sourceUrl} placeholder="https://…" onChange={e => setF({ ...f, sourceUrl: e.target.value })} />
        </label>
        <label>Album
          <select value={f.albumId} onChange={e => setF({ ...f, albumId: +e.target.value })}>
            {albums.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <audio controls preload="none" src={`/api/admin/radio/file/${t.id}`} />
        <small className="muted">Plik .{t.ext}, {mb(t.size)}</small>
      </div>
      <div className={s.btns}>
        <Button kind="quiet" onClick={() => move(-1)} disabled={i === 0} aria-label="Wyżej"><ArrowUp size={15} /></Button>
        <Button kind="quiet" onClick={() => move(1)} disabled={i === n - 1} aria-label="Niżej"><ArrowDown size={15} /></Button>
        <Button kind="hue" disabled={!dirty || !f.title.trim()} onClick={() => act(() => api(`/api/admin/radio/track/${t.id}`, f), 'Zapisano utwór')}>Zapisz</Button>
        <Button kind="quiet" aria-label="Usuń utwór" onClick={() => confirm(`Usunąć utwór „${t.title}” razem z plikiem?`) && act(() => api(`/api/admin/radio/track/${t.id}/delete`, {}), 'Usunięto utwór')}><Trash2 size={15} /></Button>
      </div>
    </li>
  );
}

function AlbumBox({ a, i, all, data, reload }: { a: Album; i: number; all: Album[]; data: Data; reload: () => void }) {
  const [f, setF] = useState({ name: a.name, description: a.description, shuffle: a.shuffle, enabled: a.enabled });
  const [credit, setCredit] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const pick = useRef<HTMLInputElement>(null);
  const dirty = f.name !== a.name || f.description !== a.description || f.shuffle !== a.shuffle || f.enabled !== a.enabled;
  const act = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); toast(done); reload(); } catch (e: any) { toast(e.message, true); } };

  const moveAlbum = (d: -1 | 1) => {
    const ids = all.map(x => x.id); const j = i + d;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    act(() => api('/api/admin/radio/albums/order', { ids }), 'Zmieniono kolejność albumów');
  };
  const moveTrack = (k: number, d: -1 | 1) => {
    const ids = a.tracks.map(t => t.id); const j = k + d;
    [ids[k], ids[j]] = [ids[j], ids[k]];
    act(() => api(`/api/admin/radio/album/${a.id}/order`, { ids }), 'Zmieniono kolejność utworów');
  };
  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files]; let okCount = 0; const errors: string[] = [];
    for (const [k, file] of list.entries()) {
      setBusy(`Wgrywanie ${k + 1} z ${list.length}: ${file.name}`);
      const form = new FormData();
      form.set('albumId', String(a.id)); form.set('credit', credit); form.set('sourceUrl', url); form.set('file', file);
      try { await upload(form); okCount++; } catch (e: any) { errors.push(`${file.name}: ${e.message}`); }
    }
    setBusy('');
    if (pick.current) pick.current.value = '';
    if (okCount) toast(`Dodano utworów: ${okCount}`);
    errors.forEach(m => toast(m, true));
    reload();
  };

  return (
    <section className={s.album}>
      <div className={s.head}>
        <label className={s.grow}>Nazwa albumu
          <input value={f.name} maxLength={60} onChange={e => setF({ ...f, name: e.target.value })} />
        </label>
        <label>Domyślna kolejność
          <select value={f.shuffle ? 'shuffle' : 'order'} onChange={e => setF({ ...f, shuffle: e.target.value === 'shuffle' })}>
            <option value="shuffle">Losowo</option>
            <option value="order">Po kolei (jak na liście niżej)</option>
          </select>
        </label>
        <label className={s.check}><input type="checkbox" checked={f.enabled} onChange={e => setF({ ...f, enabled: e.target.checked })} /> Widoczny dla graczy</label>
      </div>
      <label className={s.wide}>Opis dla graczy (opcjonalnie)
        <input value={f.description} maxLength={300} onChange={e => setF({ ...f, description: e.target.value })} />
      </label>
      <div className={s.btns}>
        <Button kind="hue" disabled={!dirty || !f.name.trim()} onClick={() => act(() => api('/api/admin/radio/album', { id: a.id, ...f }), 'Zapisano album')}>Zapisz album</Button>
        <Button kind="quiet" disabled={i === 0} onClick={() => moveAlbum(-1)} aria-label="Album wyżej"><ArrowUp size={15} /></Button>
        <Button kind="quiet" disabled={i === all.length - 1} onClick={() => moveAlbum(1)} aria-label="Album niżej"><ArrowDown size={15} /></Button>
        <Button kind="quiet" onClick={() => confirm(`Usunąć album „${a.name}” razem z ${a.tracks.length} utworami i plikami?`) && act(() => api(`/api/admin/radio/album/${a.id}/delete`, {}), 'Usunięto album')}><Trash2 size={15} /> Usuń album</Button>
      </div>

      <h4>Utwory ({a.tracks.length})</h4>
      <p className="muted small">Kolejność z tej listy obowiązuje graczy, którzy wybrali „Po kolei”. Nazwa i źródło są widoczne dla graczy w radiu.</p>
      <ul className={s.tracks}>
        {a.tracks.map((t, k) => <TrackRow key={t.id} t={t} i={k} n={a.tracks.length} albums={all} onChanged={reload} move={d => moveTrack(k, d)} />)}
        {a.tracks.length === 0 && <li className="muted">Album jest pusty.</li>}
      </ul>

      <div className={s.add}>
        <b>Dodaj pliki</b>
        <label>Źródło / credit (dla dodawanych teraz plików)
          <input value={credit} maxLength={200} placeholder="np. Kevin MacLeod, licencja CC BY 4.0" onChange={e => setCredit(e.target.value)} />
        </label>
        <label>Link do źródła (opcjonalnie)
          <input value={url} placeholder="https://…" onChange={e => setUrl(e.target.value)} />
        </label>
        <input ref={pick} type="file" multiple hidden accept={data.formats.map(x => `.${x}`).join(',') + ',audio/*'} onChange={e => send(e.target.files)} />
        <div className={s.btns}>
          <Button kind="hue" disabled={!!busy} onClick={() => pick.current?.click()}><Upload size={15} /> Wybierz pliki</Button>
          {busy && <span className="muted small">{busy}</span>}
        </div>
        <small className="muted">Nazwą utworu zostaje nazwa pliku - zmienisz ją po dodaniu. Formaty: {data.formats.join(', ')}. Do {mb(data.maxBytes)} na plik.</small>
      </div>
    </section>
  );
}

/** Strona „Radio”: albumy z utworami dla funkcji eksperymentalnej Radio (gracze: Ustawienia -> Eksperymentalne) */
export default function RadioAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const load = useCallback(() => { api<Data>('/api/admin/radio').then(setData).catch(e => setErr(e.message)); }, []);
  useEffect(load, [load]);

  const create = async () => {
    try { await api('/api/admin/radio/album', { name, description: '', shuffle: true, enabled: true }); setName(''); toast('Dodano album'); load(); } catch (e: any) { toast(e.message, true); }
  };
  if (err) return <p className="muted">{err}</p>;
  if (!data) return <p className="muted">Wczytywanie…</p>;
  return (
    <div className={s.box}>
      <p className="muted">
        Radio to funkcja eksperymentalna: gracz włącza ją w Ustawieniach, wybiera album i czy chce słuchać losowo, czy po kolei. Muzyka gra w pętli.
        Album widzą gracze, gdy jest włączony i ma co najmniej jeden utwór.
      </p>
      {data.albums.map((a, i) => <AlbumBox key={a.id} a={a} i={i} all={data.albums} data={data} reload={load} />)}
      <form className={s.new} onSubmit={e => { e.preventDefault(); if (name.trim()) create(); }}>
        <h3>Nowy album</h3>
        <div className={s.head}>
          <label className={s.grow}>Nazwa
            <input value={name} maxLength={60} placeholder="np. Muzyka z kasyna" onChange={e => setName(e.target.value)} />
          </label>
          <Button kind="hue" type="submit" disabled={!name.trim()}>Utwórz album</Button>
        </div>
      </form>
    </div>
  );
}
