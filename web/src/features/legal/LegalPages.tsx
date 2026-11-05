import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '../../app/Logo';
import { About } from './About';
import { Privacy } from './Privacy';
import { ReportForm } from './ReportForm';
import { Terms } from './Terms';
import { useLegal } from './useLegal';
import s from './legal.module.css';

export const LEGAL_PATHS = ['/regulamin', '/prywatnosc', '/o-stronie', '/zglos'];

const TITLES: Record<string, string> = { '/regulamin': 'Regulamin', '/prywatnosc': 'Polityka prywatności', '/o-stronie': 'O stronie', '/zglos': 'Zgłoś problem z kartą' };

/** Strony prawne i publiczny formularz zgłoszeń: dostępne bez logowania */
export function LegalPage() {
  const { pathname } = useLocation();
  const info = useLegal();
  const path = pathname.replace(/\/$/, '');
  useEffect(() => { document.title = `${TITLES[path] ?? 'ScamBox'} · ScamBox`; window.scrollTo(0, 0); }, [path]);

  return (
    <div className={s.page}>
      <header className={s.head}>
        <Link className={s.brand} to="/"><Logo />ScamBox</Link>
        <a className={s.back} href="/"><ArrowLeft size={16} aria-hidden="true" />Wróć do gry</a>
      </header>
      <main className={s.main}>
        {path === '/regulamin' && <Terms info={info} />}
        {path === '/prywatnosc' && <Privacy info={info} />}
        {path === '/o-stronie' && <About info={info} />}
        {path === '/zglos' && (
          <>
            <h1>Zgłoś problem z kartą</h1>
            <p className="muted">Jesteś osobą z jednej z kart, chcesz zgłosić naruszenie praw albo po prostu zauważyłeś(-aś) błąd? Wypełnij formularz. <b>Nie potrzebujesz konta.</b></p>
            <ReportForm />
          </>
        )}
      </main>
      <LegalFooter />
    </div>
  );
}

export function LegalFooter() {
  return (
    <footer className={s.foot}>
      <Link to="/regulamin">Regulamin</Link>
      <Link to="/prywatnosc">Polityka prywatności</Link>
      <Link to="/o-stronie">O stronie</Link>
      <Link to="/zglos">Zgłoś problem z kartą</Link>
    </footer>
  );
}
