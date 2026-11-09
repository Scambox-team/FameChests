import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import s from './RolesAdmin.module.css';

interface Role { id: number; name: string; perms: string[] }
interface Staff { id: number; username: string; owner: boolean; roleId: number | null }
interface Data { roles: Role[]; admins: Staff[]; perms: { key: string; label: string }[] }

/** Strona „Rangi”: tylko właściciel (OWNER_IDS) - serwer odrzuca każdego innego (403) */
export default function RolesAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [denied, setDenied] = useState('');
  const [edit, setEdit] = useState<{ id?: number; name: string; perms: string[] } | null>(null);
  const load = useCallback(() => { api<Data>('/api/admin/roles').then(setData).catch(e => setDenied(e.message)); }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); toast(done); load(); } catch (e: any) { toast(e.message, true); }
  };
  const save = () => edit && act(async () => { await api('/api/admin/roles', edit); setEdit(null); }, 'Zapisano rangę');
  const remove = (r: Role) => confirm(`Usunąć rangę „${r.name}”?`) && act(() => api(`/api/admin/roles/${r.id}/delete`, {}), 'Usunięto rangę');
  const assign = (a: Staff, v: string) => act(() => api('/api/admin/roles/assign', { userId: a.id, roleId: v ? Number(v) : null }), `Zmieniono rangę: ${a.username}`);
  const toggle = (k: string) => setEdit(e => e && { ...e, perms: e.perms.includes(k) ? e.perms.filter(p => p !== k) : [...e.perms, k] });

  if (denied) return <p className="muted">{denied}. Rangami zarządza tylko właściciel gry.</p>;
  if (!data) return <p className="muted">Wczytywanie…</p>;
  const label = (k: string) => data.perms.find(p => p.key === k)?.label.split(':')[0] ?? k;
  return (
    <section className={s.box}>
      <p className="muted">
        Właściciel ma wszystkie uprawnienia i jako jedyny tworzy rangi oraz je nadaje. Admin bez rangi ma wszystko poza sprawami
        właściciela (rangi, kopie zapasowe, nadawanie adminów). Nowego admina robisz w panelu Gracze, a tutaj przypisujesz mu rangę.
      </p>

      <h3>Rangi</h3>
      <ul className={s.list}>
        {data.roles.map(r => (
          <li key={r.id}>
            <b>{r.name}</b>
            <span className={s.perms}>{r.perms.length ? r.perms.map(p => <span key={p} className={s.chip}>{label(p)}</span>) : <span className="muted small">bez uprawnień (tylko podgląd menu)</span>}</span>
            <span className={s.btns}>
              <Button kind="quiet" onClick={() => setEdit({ id: r.id, name: r.name, perms: r.perms })}>Edytuj</Button>
              <Button kind="quiet" onClick={() => remove(r)}>Usuń</Button>
            </span>
          </li>
        ))}
        {data.roles.length === 0 && <li className="muted">Nie ma jeszcze żadnej rangi.</li>}
      </ul>
      {!edit && <div><Button kind="hue" onClick={() => setEdit({ name: '', perms: [] })}>Nowa ranga</Button></div>}

      {edit && (
        <form className={s.form} onSubmit={e => { e.preventDefault(); save(); }}>
          <h3>{edit.id ? 'Edycja rangi' : 'Nowa ranga'}</h3>
          <label className={s.name}>Nazwa
            <input value={edit.name} maxLength={30} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="np. Moderator" autoFocus />
          </label>
          {data.perms.map(p => (
            <label key={p.key} className={s.perm}>
              <input type="checkbox" checked={edit.perms.includes(p.key)} onChange={() => toggle(p.key)} /> {p.label}
            </label>
          ))}
          <div className={s.btns}>
            <Button kind="hue" type="submit" disabled={!edit.name.trim()}>Zapisz</Button>
            <Button kind="quiet" type="button" onClick={() => setEdit(null)}>Anuluj</Button>
          </div>
        </form>
      )}

      <h3>Admini</h3>
      <ul className={s.list}>
        {data.admins.map(a => (
          <li key={a.id}>
            <b>{a.username}</b>
            {a.owner
              ? <span className={s.chip}>właściciel</span>
              : (
                <select value={a.roleId ?? ''} onChange={e => assign(a, e.target.value)} aria-label={`Ranga: ${a.username}`}>
                  <option value="">Bez rangi (wszystko poza właścicielskim)</option>
                  {data.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              )}
          </li>
        ))}
      </ul>
    </section>
  );
}
