import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Crown } from 'lucide-react';
import { Logo } from '../../app/Logo';
import { LangSwitch } from '../../app/Settings';
import { Button } from '../../ui/Button';
import styles from './LoginPage.module.css';

const Galaxy: any = lazy(() => import('../../ui/reactbits/Galaxy/Galaxy') as any);

// po zalogowaniu wracamy na stronę, którą gracz chciał otworzyć (tylko adresy z tej gry)
function nextPath() {
  const next = new URLSearchParams(location.search).get('next');
  return next && /^\/(?![/\\])/.test(next) ? next : '/';
}

export function LoginPage() {
  const first = document.documentElement.dataset.first === '1';
  const [mode, setMode] = useState<'login' | 'register'>(first ? 'register' : 'login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const register = mode === 'register';

  useEffect(() => { document.title = 'Logowanie · ScamBox'; }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (register && f.password !== f.password2) return setError('Hasła nie są takie same');
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.username, password: f.password }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Błąd logowania');
      location.href = nextPath();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.sky} aria-hidden="true">
        <Suspense fallback={null}>
          <Galaxy hueShift={320} density={.7} glowIntensity={.2} saturation={.25} starSpeed={.25} speed={.5} mouseRepulsion={false} clickWarp={false} />
        </Suspense>
      </div>
      <section className={styles.box}>
        <div className={styles.lang}><LangSwitch /></div>
        <h1 className={styles.brand}><Logo />ScamBox</h1>
        <p className="muted">Otwieraj skrzynki, zbieraj karty znanych osób i wymieniaj się ze znajomymi.</p>
        <div className={styles.seg} role="group" aria-label="Rodzaj formularza">
          <button type="button" aria-pressed={!register} onClick={() => { setMode('login'); setError(''); }}>Logowanie</button>
          <button type="button" aria-pressed={register} onClick={() => { setMode('register'); setError(''); }}>Rejestracja</button>
        </div>
        {first && <p className={styles.first}><Crown size={16} aria-hidden="true" />To pierwsze konto w tej grze. Przejmie obecny zapis i dostanie uprawnienia admina.</p>}
        <form className={styles.form} onSubmit={submit} autoComplete="on">
          <label>Nazwa gracza<input name="username" type="text" required minLength={3} maxLength={20} autoComplete="username" autoFocus /></label>
          <label>Hasło<input name="password" type="password" required minLength={register ? 8 : 1} autoComplete={register ? 'new-password' : 'current-password'} /></label>
          {register && <label>Powtórz hasło<input name="password2" type="password" required autoComplete="new-password" /></label>}
          <p className={styles.err} role="alert">{error}</p>
          <Button kind="hue" big type="submit" disabled={busy}>{register ? 'Załóż konto' : 'Zaloguj'}</Button>
        </form>
      </section>
    </main>
  );
}
