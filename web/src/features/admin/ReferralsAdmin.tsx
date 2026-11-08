import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { timeAgo } from '../../lib/time';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { UserLink } from '../../ui/UserLink';
import s from './GamesAdmin.module.css';
import r from './ReferralsAdmin.module.css';

// Zakładka panelu admina „Polecenia” (routes/referral.rs): nagrody za reflinki, warunek aktywacji, limity,
// lista poleceń z podejrzanymi (to samo IP, kilka kont z jednego IP) do zatwierdzenia albo odrzucenia.
interface RewardSet {
  referrerCrate: string; referrerCount: number; referrerMoney: number;
  referredCrate: string; referredCount: number; referredMoney: number;
}
interface Cfg extends RewardSet {
  enabled: boolean;
  minOpened: number; minHours: number; monthlyCap: number; perIpLimit: number;
}
const EMPTY: RewardSet = { referrerCrate: '', referrerCount: 1, referrerMoney: 0, referredCrate: '', referredCount: 1, referredMoney: 0 };
/** Początek formularza własnych nagród: kopia globalnych */
const pick = (c: Cfg): RewardSet => ({
  referrerCrate: c.referrerCrate, referrerCount: c.referrerCount, referrerMoney: c.referrerMoney,
  referredCrate: c.referredCrate, referredCount: c.referredCount, referredMoney: c.referredMoney,
});
const STATUS: Record<string, string> = { pending: 'Czeka na aktywację', flagged: 'Podejrzane', rewarded: 'Nagrodzone', rejected: 'Odrzucone' };

function RewardFields({ who, cfg, set, crates }: { who: 'referrer' | 'referred'; cfg: RewardSet; set: (c: Partial<RewardSet>) => void; crates: any[] }) {
  const k = (f: string) => `${who}${f}` as keyof RewardSet;
  return (
    <div className={r.reward}>
      <h4>{who === 'referrer' ? 'Polecający (właściciel linku)' : 'Polecony (nowy gracz)'}</h4>
      <label>Skrzynka
        <select value={cfg[k('Crate')] as string} onChange={e => set({ [k('Crate')]: e.target.value })}>
          <option value="">bez skrzynki</option>
          {crates.map(c => <option key={c.id} value={c.id}>{c.name}{c.mode === 'offshop' ? ' (spoza sklepu)' : c.mode === 'disabled' ? ' (wyłączona)' : c.mode === 'money' ? ' (pieniężna)' : ''}</option>)}
        </select>
      </label>
      <label>Ile skrzynek<input type="number" min={0} max={100} value={cfg[k('Count')] as number} onChange={e => set({ [k('Count')]: +e.target.value })} /></label>
      <label>Grosze<input type="number" min={0} value={cfg[k('Money')] as number} onChange={e => set({ [k('Money')]: +e.target.value })} /></label>
    </div>
  );
}

export default function ReferralsAdmin() {
  const [data, setData] = useState<any>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<RewardSet | null>(null);
  const apply = (d: any) => { setData(d); setCfg(d.config); setMine(d.mine ?? { ...EMPTY, ...pick(d.config) }); };
  const saveMine = async () => {
    setBusy(true);
    try { apply(await api('/api/admin/referrals/mine', mine)); toast('Zapisano własne nagrody'); }
    catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const clearMine = async () => {
    setBusy(true);
    try { apply(await api('/api/admin/referrals/mine/clear', {})); toast('Używasz nagród globalnych'); }
    catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  useEffect(() => { api('/api/admin/referrals').then(apply).catch(e => toast(e.message, true)); }, []);
  const set = (c: Partial<Cfg>) => setCfg(x => ({ ...x!, ...c }));
  const save = async (over: Partial<Cfg> = {}) => {
    setBusy(true);
    try { apply(await api('/api/admin/referrals', { ...cfg, ...over })); toast('Zapisano'); }
    catch (e: any) { toast(e.message, true); }
    setBusy(false);
  };
  const decide = async (id: number, approve: boolean) => {
    try { apply(await api(`/api/admin/referrals/${id}`, { approve })); toast(approve ? 'Zatwierdzone' : 'Odrzucone'); }
    catch (e: any) { toast(e.message, true); }
  };
  if (!data || !cfg) return <p className="muted">Wczytywanie…</p>;
  const st = data.stats;
  return (
    <section className={s.box}>
      <div className="panel">
        <div className={r.head}>
          <h3>Polecenia (reflinki)</h3>
          <span className={`${r.badge}${data.config.enabled ? ` ${r.on}` : ''}`}>{data.config.enabled ? 'Włączone' : 'Wyłączone'}</span>
        </div>
        <p className="muted small">Każdy gracz ma w zakładce Znajomi swój link <code>/r/KOD</code>. Kto wejdzie z linku (ciasteczko na 30 dni, liczy się pierwszy link)
          i założy konto, jest przypisany do polecającego. Nagrody dostają obaj, ale dopiero gdy nowy gracz najpierw potwierdzi email (konto bez emaila nie dostaje nagrody), a potem spełni warunki aktywacji poniżej — dzięki temu puste konta zakładane dla nagrody się nie opłacają.</p>
        <div className={r.rewards}>
          <RewardFields who="referrer" cfg={cfg} set={set} crates={data.crates} />
          <RewardFields who="referred" cfg={cfg} set={set} crates={data.crates} />
        </div>
        <h4 className={r.sub}>Aktywacja i ochrona (liczą się dopiero po potwierdzeniu emaila)</h4>
        <div className={s.reward}>
          <label>Otwartych skrzynek (nowy gracz)<input type="number" min={0} value={cfg.minOpened} onChange={e => set({ minOpened: +e.target.value })} /></label>
          <label>Godzin od założenia konta<input type="number" min={0} step={1} value={cfg.minHours} onChange={e => set({ minHours: +e.target.value })} /></label>
          <label>Nagród polecającego w 30 dni (0 = bez limitu)<input type="number" min={0} value={cfg.monthlyCap} onChange={e => set({ monthlyCap: +e.target.value })} /></label>
          <label>Kont z jednego IP bez sprawdzania<input type="number" min={0} value={cfg.perIpLimit} onChange={e => set({ perIpLimit: +e.target.value })} /></label>
        </div>
        <p className="muted small">Polecenie z tego samego IP co polecający albo kolejne konto z jednego IP trafia niżej jako „Podejrzane” i czeka na twoją decyzję.
          Adresów IP nie zapisujemy — tylko skrót z sekretem serwera, po którym da się poznać to samo IP.</p>
        <div className={s.btns}>
          <Button kind="hue" disabled={busy} onClick={() => save()}>Zapisz</Button>
          {data.config.enabled
            ? <Button disabled={busy} onClick={() => save({ enabled: false })}>Wyłącz polecenia</Button>
            : <Button disabled={busy} onClick={() => save({ enabled: true })}>Zapisz i włącz</Button>}
        </div>
        {data.config.enabled && <p className="small">Gracze widzą: ty dostajesz <b>{data.reward.referrer || 'nic'}</b>, znajomy dostaje <b>{data.reward.referred || 'nic'}</b>.</p>}
      </div>

      <div className="panel">
        <h3>Moje nagrody za polecenia</h3>
        <p className="muted small">Polecenia z TWOJEGO linku dostają te nagrody (obie strony) zamiast globalnych. Progi aktywacji, limity i ochrona zostają globalne.
          Zestawy innych adminów widzisz niżej, ale zmieniasz tylko własny.
          {data.mine ? ' Teraz używasz własnego zestawu.' : ' Teraz używasz nagród globalnych.'}</p>
        {mine && <div className={r.rewards}>
          <RewardFields who="referrer" cfg={mine} set={c => setMine(x => ({ ...x!, ...c }))} crates={data.crates} />
          <RewardFields who="referred" cfg={mine} set={c => setMine(x => ({ ...x!, ...c }))} crates={data.crates} />
        </div>}
        <div className={s.btns}>
          <Button kind="hue" disabled={busy} onClick={saveMine}>Zapisz moje nagrody</Button>
          <Button disabled={busy || !data.mine} onClick={clearMine}>Użyj globalnych</Button>
        </div>
      </div>

      <div className="panel">
        <h3>Nagrody adminów</h3>
        {!data.adminSets.length && <p className="muted small">Żaden admin nie ma własnego zestawu, wszystkie linki używają nagród globalnych.</p>}
        {data.adminSets.length > 0 && <table className={r.table}>
          <thead><tr className="muted small"><td>Admin</td><td>Polecający dostaje</td><td>Polecony dostaje</td><td>Zmieniono</td></tr></thead>
          <tbody>
            {data.adminSets.map((x: any) => (
              <tr key={x.user?.username ?? x.updated}>
                <td>{x.user ? <UserLink user={x.user} /> : '—'}{x.mine && <span className="muted small"> (Ty)</span>}</td>
                <td>{x.referrer || <span className="muted">nic</span>}</td>
                <td>{x.referred || <span className="muted">nic</span>}</td>
                <td className="muted small">{timeAgo(x.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>

      <div className="panel">
        <h3>Wyniki</h3>
        <div className={r.stats}>
          <div><b>{st.clicks}</b><span>unikalnych wejść</span></div>
          <div><b>{st.signups}</b><span>kont z polecenia</span></div>
          <div><b>{st.rewarded}</b><span>nagrodzonych</span></div>
          <div><b>{st.flagged}</b><span>podejrzanych</span></div>
          <div><b>{st.clicks ? Math.round(st.signups / st.clicks * 100) : 0}%</b><span>wejście → konto</span></div>
        </div>
        {data.top.length > 0 && <>
          <h4 className={r.sub}>Najlepsi polecający</h4>
          <ol className={r.top}>{data.top.map((t: any, i: number) => <li key={i}>{t.user ? <UserLink user={t.user} /> : '—'} <b>{t.count}</b></li>)}</ol>
        </>}
      </div>

      <div className="panel">
        <h3>Polecenia</h3>
        {!data.list.length && <p className="muted small">Jeszcze nikt nie założył konta z polecenia.</p>}
        <table className={r.table}>
          <tbody>
            {data.list.map((x: any) => (
              <tr key={x.referredId} className={x.status === 'flagged' ? r.flagged : undefined}>
                <td>{x.referred ? <UserLink user={x.referred} /> : <span className="muted">usunięty</span>}</td>
                <td className="muted small">od</td>
                <td>{x.referrer ? <UserLink user={x.referrer} /> : <span className="muted">usunięty</span>}</td>
                <td><span className={r.status}>{STATUS[x.status] ?? x.status}</span>{x.reason && <div className="small muted">{x.reason}</div>}</td>
                <td className="small">{x.emailVerified ? 'email potwierdzony: tak' : <span className="muted">email potwierdzony: nie</span>}</td>
                <td className="muted small">{timeAgo(x.created)}</td>
                <td className={r.actions}>
                  {(x.status === 'flagged' || x.status === 'pending') && <>
                    {x.status === 'flagged' && <Button onClick={() => decide(x.referredId, true)}>Zatwierdź</Button>}
                    <Button onClick={() => { if (confirm('Odrzucić to polecenie? Nikt nie dostanie nagrody.')) decide(x.referredId, false); }}>Odrzuć</Button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
