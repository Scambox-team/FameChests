import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import svgDefs from '../cards/svgDefs.html?raw';
import { boot, startPolling } from '../game/session';
import { S, useGame } from '../game/store';
import { Toaster } from '../ui/Toaster';
import { FriendsPage } from '../features/social/FriendsPage';
import { LinkClaim } from '../features/social/LinkClaim';
import { ProfilePage } from '../features/social/ProfilePage';
import { RankingPage } from '../features/social/RankingPage';
import { ShareDialog } from '../features/social/ShareDialog';
import { installViewerActions } from '../features/social/showcase';
import { ChessPage } from '../features/chess/ChessPage';
import { ArenaPage } from '../features/arena/ArenaPage';
import { startArena } from '../features/arena/arena';
import { CasinoPage } from '../features/casino/CasinoPage';
import { showJackpotResult } from '../features/casino/jackpotResult';
import { hrNews } from '../features/casino/horsesEngine';
import { BinderPage } from '../features/binder/BinderPage';
import { CratesPage } from '../features/crates/CratesPage';
import { ForgePage } from '../features/forge/ForgePage';
import { MarketPage } from '../features/market/MarketPage';
import { noteMarketBonus } from '../features/market/bonus';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { noteUfo } from '../features/inventory/ufo';
import { LoginPage } from '../features/auth/LoginPage';
import { noteQuest } from '../features/crates/QuestBox';
import { Stage } from '../features/crates/Stage';
import { Notices, showMessages, startNotices } from '../features/notices/Notices';
import { achPoll } from '../features/achievements/popups';
import { onResponseHeaders } from '../api/client';
import { AppShell } from './AppShell';
import styles from './App.module.css';

const NotMoved = lazy(() => import('./NotMoved'));

// odpowiedź /api/me co 30 s: to, co mogło się zmienić bez udziału gracza
function onMe(me: any) {
  noteQuest(me.quest);
  noteUfo(me);
  noteMarketBonus(me.marketBonus);
  if (me.horseNews?.length) hrNews(me.horseNews);
  if (me.achUnseen && !S.opening) achPoll();
  if (me.jackpot) showJackpotResult(me.jackpot);
  if (me.messages?.length) showMessages(me.messages);
}

installViewerActions();

function Game() {
  const [failed, setFailed] = useState(false);
  const game = useGame();

  useEffect(() => {
    let stop: undefined | (() => void), alive = true;
    onResponseHeaders({ achievements: achPoll });
    boot().then(me => {
      if (!alive) return;
      noteQuest(me.quest);
      noteUfo(me);
      noteMarketBonus(me.marketBonus);
      startNotices(me);
      if (S.cfg.arena) startArena();   // Arena tylko dla adminów: reszta graczy nie pyta serwera o wyzwania
      if (me.jackpot) setTimeout(() => showJackpotResult(me.jackpot), 600);
      if (me.achUnseen) setTimeout(achPoll, 2500);   // zdobyte, gdy nie było mnie w grze
      stop = startPolling(onMe);
    }).catch(() => setFailed(true));
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
          <Route path="/inventory/*" element={<InventoryPage />} />
          <Route path="/binder" element={<BinderPage />} />
          <Route path="/forge" element={<ForgePage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/casino" element={<CasinoPage />} />
          <Route path="/arena" element={<ArenaPage />} />
          <Route path="/games" element={<ChessPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/ranking" element={<RankingPage />} />
          <Route path="/player/:name" element={<ProfilePage />} />
          <Route path="/link/:token" element={<LinkClaim />} />
          <Route path="*" element={<NotMoved />} />
        </Routes>
      </Suspense>
      <Stage />
      <Notices />
      <ShareDialog />
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
