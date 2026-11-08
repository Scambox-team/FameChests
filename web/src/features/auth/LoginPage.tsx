import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Crown } from 'lucide-react';
import { Logo } from '../../app/Logo';
import { LangSwitch } from '../../app/Settings';
import { Button } from '../../ui/Button';
import { Link } from 'react-router-dom';
import { useLegal } from '../legal/useLegal';
import styles from './LoginPage.module.css';

const Galaxy: any = lazy(() => import('../../ui/reactbits/Galaxy/Galaxy') as any);

type Mode = 'login' | 'register' | 'forgot' | 'reset';

// po zalogowaniu wracamy na stronę, którą gracz chciał otworzyć (tylko adresy z tej gry)
function nextPath() {
  const next = new URLSearchParams(location.search).get('next');
  return next && /^\/(?![/\\])/.test(next) ? next : '/';
}

/** Link z maila odsyła tu z wynikiem w adresie po `#` (token do nowego hasła, potwierdzenie emaila albo błąd) */
function readMailLink() {
  // link z maila gry: ?t=sb1_...
  const own = new URLSearchParams(location.search).get('t') ?? '';
  if (own.startsWith('sb1_')) return { token: own, confirmed: false, failed: false };
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const token = h.get('access_token');
  return {
    token: h.get('type') === 'recovery' && token ? token : '',
    confirmed: !!token && h.get('type') !== 'recovery',
    failed: h.has('error') || h.has('error_code')
  };
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || 'Błąd serwera'), { data });
  return data ?? {};
}

export function LoginPage() {
  const first = document.documentElement.dataset.first === '1';
  const [link] = useState(readMailLink);
  const [mode, setMode] = useState<Mode>(link.token ? 'reset' : first ? 'register' : 'login');
  const [error, setError] = useState(link.failed ? 'Link wygasł albo został już użyty. Poproś o nowy.' : '');
  const [notice, setNotice] = useState(link.confirmed ? 'Adres email potwierdzony. Możesz się zalogować.' : '');
  const [unconfirmed, setUnconfirmed] = useState('');
  const [busy, setBusy] = useState(false);
  const register = mode === 'register';
  const legal = useLegal();
  const emailAuth = !!legal?.emailAuth;        // Supabase Auth: email wymagany przy rejestracji
  const emailOn = emailAuth || !!legal?.mail;  // emaile kont działają (także przy samym SMTP, wtedy email jest opcjonalny)

  useEffect(() => { document.title = 'Logowanie · ScamBox'; }, []);
  // token z linku nie zostaje w pasku adresu ani w historii
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    q.delete('t');
    if (location.hash || link.token) history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : ''));
  }, []);

  const go = (m: Mode) => { setMode(m); setError(''); setNotice(''); setUnconfirmed(''); };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if ((register || mode === 'reset') && f.password !== f.password2) return setError('Hasła nie są takie same');
    if (register && !f.terms) return setError('Zaakceptuj regulamin i politykę prywatności');
    setBusy(true);
    setError('');
    setNotice('');
    setUnconfirmed('');
    try {
      if (mode === 'forgot') {
        await post('/api/forgot', { email: f.email });
        setNotice('Jeśli konto z tym adresem istnieje, wysłaliśmy na niego link do ustawienia nowego hasła.');
        setBusy(false);
      } else if (mode === 'reset') {
        // token z naszego maila zaczyna się od "sb1_", token Supabase Auth to JWT
        await post(link.token.startsWith('sb1_') ? '/api/account/reset' : '/api/reset', { token: link.token, password: f.password });
        setMode('login');
        setNotice('Hasło zmienione. Zaloguj się nowym hasłem.');
        setBusy(false);
      } else {
        const data = await post(`/api/${mode}`, { username: f.username, email: f.email, password: f.password, terms: register && !!f.terms });
        if (data.confirm) {
          setMode('login');
          setNotice(`Wysłaliśmy link potwierdzający na ${f.email}. Kliknij w niego, a potem zaloguj się.`);
          setBusy(false);
        } else location.href = nextPath();
      }
    } catch (err: any) {
      setError(err.message);
      if (err.data?.unconfirmed) setUnconfirmed(f.username);
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await post('/api/resend', { username: unconfirmed });
      setError('');
      setNotice('Wysłaliśmy link jeszcze raz. Sprawdź też folder ze spamem.');
      setUnconfirmed('');
    } catch (err: any) { setError(err.message); }
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
        {(mode === 'login' || mode === 'register') && (
          <div className={styles.seg} role="group" aria-label="Rodzaj formularza">
            <button type="button" aria-pressed={!register} onClick={() => go('login')}>Logowanie</button>
            <button type="button" aria-pressed={register} onClick={() => go('register')}>Rejestracja</button>
          </div>
        )}
        {mode === 'forgot' && <p className="muted">Podaj email przypisany do konta. Wyślemy na niego link do ustawienia nowego hasła.</p>}
        {mode === 'reset' && <p className="muted">Ustaw nowe hasło do swojego konta.</p>}
        {first && register && <p className={styles.first}><Crown size={16} aria-hidden="true" />To pierwsze konto w tej grze. Przejmie obecny zapis.</p>}
        <form className={styles.form} onSubmit={submit} autoComplete="on">
          {register && emailOn && (
            <label>{emailAuth ? 'Email' : 'Email (niewymagany, do odzyskania hasła)'}
              <input name="email" type="email" required={emailAuth} maxLength={254} autoComplete="email" autoFocus={emailAuth} />
            </label>
          )}
          {mode === 'forgot' && <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" autoFocus /></label>}
          {(mode === 'login' || register) && (
            <label>{register || !emailOn ? 'Nazwa gracza' : 'Nazwa gracza lub email'}
              <input name="username" type="text" required minLength={register ? 3 : 1} maxLength={register ? 20 : 254} autoComplete="username" autoFocus={!(register && emailAuth)} />
            </label>
          )}
          {mode !== 'forgot' && (
            <label>{mode === 'reset' ? 'Nowe hasło' : 'Hasło'}
              <input name="password" type="password" required minLength={mode === 'login' ? 1 : 8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} autoFocus={mode === 'reset'} />
            </label>
          )}
          {(register || mode === 'reset') && <label>Powtórz hasło<input name="password2" type="password" required autoComplete="new-password" /></label>}
          {register && (
            <label className={styles.check}>
              <input name="terms" type="checkbox" required />
              <span>Mam co najmniej {legal?.minAge ?? 16} lat i akceptuję <Link to="/regulamin" target="_blank">Regulamin</Link> oraz <Link to="/prywatnosc" target="_blank">Politykę prywatności</Link>.</span>
            </label>
          )}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          <p className={styles.err} role="alert">{error}</p>
          {unconfirmed && <button type="button" className={styles.linkBtn} onClick={resend}>Wyślij link potwierdzający jeszcze raz</button>}
          <Button kind="hue" big type="submit" disabled={busy}>
            {mode === 'register' ? 'Załóż konto' : mode === 'forgot' ? 'Wyślij link' : mode === 'reset' ? 'Ustaw hasło' : 'Zaloguj'}
          </Button>
          {mode === 'login' && emailOn && <button type="button" className={styles.linkBtn} onClick={() => go('forgot')}>Nie pamiętasz hasła?</button>}
          {(mode === 'forgot' || mode === 'reset') && <button type="button" className={styles.linkBtn} onClick={() => go('login')}>Wróć do logowania</button>}
        </form>
        <nav className={styles.legal} aria-label="Informacje prawne">
          <Link to="/o-stronie">O stronie (to parodia)</Link>
          <Link to="/regulamin">Regulamin</Link>
          <Link to="/prywatnosc">Prywatność</Link>
          <Link to="/zglos">Zgłoś problem z kartą</Link>
        </nav>
      </section>
    </main>
  );
}
