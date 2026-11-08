import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../../app/Logo';
import { LangSwitch } from '../../app/Settings';
import styles from './LoginPage.module.css';

/** Strona pod linkiem z maila „Potwierdź adres email” (/konto/potwierdz?t=...): działa bez logowania, token z linku wystarcza */
export function VerifyEmailPage() {
  const [token] = useState(() => new URLSearchParams(location.search).get('t') ?? '');
  const [state, setState] = useState<'wait' | 'ok' | 'fail'>(token ? 'wait' : 'fail');
  const [error, setError] = useState(token ? '' : 'Ten link jest nieprawidłowy. Poproś o nowy w profilu (Email).');

  useEffect(() => { document.title = 'Potwierdzenie emaila · ScamBox'; }, []);
  useEffect(() => {
    if (location.search) history.replaceState(null, '', location.pathname);
    if (!token) return;
    fetch('/api/account/email-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async res => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Błąd serwera');
        setState('ok');
      })
      .catch((err: Error) => { setError(err.message); setState('fail'); });
  }, [token]);

  return (
    <main className={styles.page}>
      <section className={styles.box}>
        <div className={styles.lang}><LangSwitch /></div>
        <h1 className={styles.brand}><Logo />ScamBox</h1>
        {state === 'wait' && <p className="muted" aria-busy="true">Potwierdzam adres email…</p>}
        {state === 'ok' && <p className={styles.notice} role="status">Adres email potwierdzony. Dziękujemy!</p>}
        {state === 'fail' && <p className={styles.err} role="alert">{error}</p>}
        <nav className={styles.legal} aria-label="Nawigacja">
          <Link to="/">Wróć do gry</Link>
        </nav>
      </section>
    </main>
  );
}
