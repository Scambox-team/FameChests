import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import svgDefs from '../cards/svgDefs.html?raw';
import { boot, startPolling } from '../game/session';
import { useGame } from '../game/store';
import { Toaster } from '../ui/Toaster';
import { CratesPage } from '../features/crates/CratesPage';
import { LoginPage } from '../features/auth/LoginPage';
import { Stage } from '../features/crates/Stage';
import { AppShell } from './AppShell';
import styles from './App.module.css';

const NotMoved = lazy(() => import('./NotMoved'));

function Game() {
  const [failed, setFailed] = useState(false);
  const game = useGame();

  useEffect(() => {
    let stop: undefined | (() => void), alive = true;
    boot().then(() => { if (alive) stop = startPolling(() => {}); }).catch(() => setFailed(true));
    return () => { alive = false; stop?.(); };
  }, []);

  if (failed) return <div className={styles.splash}>Nie można połączyć się z serwerem. Odśwież stronę.</div>;
  if (!game.cfg || !game.state) return <div className={styles.splash} aria-busy="true">Wczytywanie gry</div>;
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Navigate to="/crates" replace />} />
          <Route path="/crates" element={<CratesPage />} />
          <Route path="*" element={<NotMoved />} />
        </Routes>
      </Suspense>
      <Stage />
    </AppShell>
  );
}

export function App() {
  const { pathname } = useLocation();
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: svgDefs }} />
      {pathname === '/login' ? <LoginPage /> : <Game />}
      <Toaster />
      <canvas id="confetti" />
      <canvas id="fxCanvas" />
    </>
  );
}
