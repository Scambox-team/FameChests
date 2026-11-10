import { useEffect, useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import { api } from '../../api/client';
import { refreshBadges } from '../../game/session';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import { fmt } from '../../lib/format';
import styles from './settings.module.css';

type Status = { enabled: boolean; linked: boolean; reward: number; rewarded: boolean };

/** Połączenie konta z serwerem Discord społeczności: kod z komendy /polacz, pierwsze połączenie daje nagrodę,
 *  bot nadaje role za miejsce w rankingu. Sekcja znika, gdy bot nie jest włączony na serwerze (brak BOT_TOKEN). */
export function DiscordLink() {
  const [st, setSt] = useState<Status | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/api/discord').then(setSt).catch(() => {}); }, []);
  if (!st?.enabled) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e: any) { Sound.error(); toast(e.message, true); } finally { setBusy(false); }
  };
  const link = () => run(async () => {
    const r = await api('/api/discord/link', { code });
    setCode('');
    setSt({ ...st, linked: true, rewarded: st.rewarded || r.reward > 0 });
    Sound.click();
    toast(r.reward > 0 ? `Discord połączony. Nagroda: ${fmt(r.reward)}` : 'Discord połączony');
    refreshBadges();
  });
  const unlink = () => run(async () => {
    await api('/api/discord/unlink', {});
    setSt({ ...st, linked: false });
    toast('Discord odłączony');
  });

  return (
    <div className={styles.box}>
      <h3 className={styles.discordTitle}><Link2 size={16} strokeWidth={1.8} aria-hidden="true" /> Discord</h3>
      {st.linked ? (
        <>
          <p className={styles.discordText}>Twoje konto jest połączone z Discordem. Bot nadaje role za miejsce w rankingu.</p>
          <button className={styles.discordBtn} onClick={unlink} disabled={busy}><Unlink size={15} strokeWidth={1.8} aria-hidden="true" /> Odłącz</button>
        </>
      ) : (
        <>
          <p className={styles.discordText}>
            Wpisz <b>/polacz</b> na naszym serwerze Discord, a bot da Ci kod. Wpisz go tutaj, żeby dostać rolę i miejsce na liście.
            {!st.rewarded && <> Za pierwsze połączenie dostaniesz <b>{fmt(st.reward)}</b>.</>}
          </p>
          <form className={styles.discordForm} onSubmit={e => { e.preventDefault(); if (code.trim()) link(); }}>
            <input className={styles.discordInput} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Kod z Discorda" maxLength={8} autoComplete="off" spellCheck={false} aria-label="Kod z Discorda" />
            <button className={styles.discordBtn} type="submit" disabled={busy || !code.trim()}>Połącz</button>
          </form>
        </>
      )}
    </div>
  );
}
