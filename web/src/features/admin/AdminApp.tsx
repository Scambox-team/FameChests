import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Logo } from '../../app/Logo';
import { bindDesigner, renderDesigner } from './designer';
import { renderMockups } from './mockups';
import panelHtml from './panel.html?raw';
import { startPanel } from './panel';
import { renderStickers } from './stickers';
import { renderVariants } from './variants';

import { api } from '../../api/client';

const ReportsAdmin = lazy(() => import('./ReportsAdmin'));
const BackupsAdmin = lazy(() => import('./BackupsAdmin'));
const GamesAdmin = lazy(() => import('./GamesAdmin'));
const EventsAdmin = lazy(() => import('./EventsAdmin'));
const ReferralsAdmin = lazy(() => import('./ReferralsAdmin'));
import './admin.css';
import styles from './AdminApp.module.css';

const TABS: [string, string][] = [['/admin', 'Skrzynki i karty'], ['/admin/chess', 'Szachy'], ['/admin/games', 'Gry'], ['/admin/events', 'Eventy'], ['/admin/referrals', 'Polecenia'], ['/variants', 'Warianty'], ['/stickers', 'Naklejki'], ['/designer', 'Kreator wariantów'], ['/mockups', 'Karty specjalne'], ['/admin/reports', 'Zgłoszenia']];
// tylko dla właściciela (OWNER_IDS) - serwer i tak odrzuca innych adminów, zakładka tylko ich nie myli
const OWNER_TABS: [string, string][] = [['/admin/backups', 'Kopie zapasowe']];

// Formularze panelu są gotowym HTML, a każdy widok rysuje się sam w swoim elemencie.
// Zakładki przeładowują stronę, więc każdy widok startuje raz.
function View({ id, start }: { id: string; start: () => void }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    start();
  }, [start]);
  return <div id={id} />;
}

function Panel() {
  const box = useRef<HTMLDivElement>(null), done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    startPanel();
  }, []);
  return <div ref={box} dangerouslySetInnerHTML={{ __html: panelHtml }} />;
}

const startDesigner = () => { bindDesigner(); renderDesigner(); };

function page(path: string): [string, ReactNode] {
  if (path === '/variants') return ['Warianty', <View id="variantsBody" start={renderVariants} />];
  if (path === '/stickers') return ['Naklejki', <View id="stickersBody" start={renderStickers} />];
  if (path === '/designer') return ['Kreator wariantów', <View id="designerBody" start={startDesigner} />];
  if (path === '/mockups') return ['Karty specjalne', <View id="mockupsBody" start={renderMockups} />];
  if (path === '/admin/reports') return ['Zgłoszenia', <Suspense fallback={null}><ReportsAdmin /></Suspense>];
  if (path === '/admin/events') return ['Eventy', <Suspense fallback={null}><EventsAdmin /></Suspense>];
  if (path === '/admin/games') return ['Gry', <Suspense fallback={null}><GamesAdmin /></Suspense>];
  if (path === '/admin/referrals') return ['Polecenia', <Suspense fallback={null}><ReferralsAdmin /></Suspense>];
  if (path === '/admin/backups') return ['Kopie zapasowe', <Suspense fallback={null}><BackupsAdmin /></Suspense>];
  return [path === '/admin/chess' ? 'Szachy' : 'Panel admina', <Panel />];
}

export default function AdminApp() {
  const { pathname, search } = useLocation();
  const path = pathname.replace(/\/$/, '') === '/admin/mockups' ? '/mockups' : pathname.replace(/\/$/, '');
  const [title, body] = page(path);
  const [owner, setOwner] = useState(false);
  useEffect(() => { document.title = `${title} · ScamBox`; }, [title]);
  useEffect(() => { api<{ owner: boolean }>('/api/admin/role').then(r => setOwner(r.owner)).catch(() => {}); }, []);
  const tabs = owner ? [...TABS, ...OWNER_TABS] : TABS;
  if (new URLSearchParams(search).has('embed')) return <div className="a-page a-embed">{body}</div>;   // podgląd karty w ramce okna edycji
  return (
    <div className={`a-page ${styles.page}`}>
      <header className={styles.head}>
        <a className={styles.logo} href="/"><Logo /></a>
        <nav className={styles.tabs} aria-label="Panel admina">
          {tabs.map(([to, label]) => <a key={to} href={to} aria-current={to === path ? 'page' : undefined}>{label}</a>)}
        </nav>
        <a className={styles.back} href="/"><ArrowLeft size={16} aria-hidden="true" /> Wróć do gry</a>
      </header>
      <main className={styles.main}>{body}</main>
    </div>
  );
}
