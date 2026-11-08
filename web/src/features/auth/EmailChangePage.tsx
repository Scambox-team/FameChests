import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../../app/Logo';
import { LangSwitch } from '../../app/Settings';
import { Button } from '../../ui/Button';
import styles from './LoginPage.module.css';

/** Strona pod linkiem z maila „Zmiana adresu email” (/konto/email?t=...): działa bez logowania, token z linku wystarcza */
export function EmailChangePage() {
  const [token] = useState(() => new URLSearchParams(location.search).get('t') ?? '');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = 'Zmiana adresu email · ScamBox'; }, []);
  // token z linku nie zostaje w pasku adresu ani w historii
  useEffect(() => { if (location.search) history.replaceState(null, '', location.pathname); }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (f.email.trim().toLowerCase() !== f.repeat.trim().toLowerCase()) return setError('Adresy nie są takie same');
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/account/email-change/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: f.email, repeat: f.repeat })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Błąd serwera');
      setDone(f.email.trim());
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.box}>
        <div className={styles.lang}><LangSwitch /></div>
        <h1 className={styles.brand}><Logo />ScamBox</h1>
        {!token && <p className={styles.err} role="alert">Ten link jest nieprawidłowy. Poproś o nowy w profilu (Email, Zmień email).</p>}
        {token && !done && (
          <>
            <p className="muted">Podaj nowy adres email konta. Po zmianie wyślemy informację na dotychczasowy adres.</p>
            <form className={styles.form} onSubmit={submit}>
              <label>Nowy email<input name="email" type="email" required maxLength={254} autoComplete="email" autoFocus /></label>
              <label>Powtórz nowy email<input name="repeat" type="email" required maxLength={254} autoComplete="email" /></label>
              <p className={styles.err} role="alert">{error}</p>
              <Button kind="hue" big type="submit" disabled={busy}>Zmień email</Button>
            </form>
          </>
        )}
        {done && <p className={styles.notice} role="status">{`Adres email konta zmieniony na ${done}. Od teraz tam trafią maile z gry.`}</p>}
        <nav className={styles.legal} aria-label="Nawigacja">
          <Link to="/">Wróć do gry</Link>
        </nav>
      </section>
    </main>
  );
}
