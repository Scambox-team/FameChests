import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { closeStage, openAgain, openCrates, sellDrops, setDropFavorite, skipSpin, stopAutoRun } from './opening';
import { Button } from '../../ui/Button';
import { closeViewer, epicOpen, openViewer, viewerOpen } from '../../fx/effects';
import { S, useGame } from '../../game/store';
import { Money } from '../../ui/Money';
import './Stage.css';

// klawiatura: Spacja/Enter = otwórz / pomiń / otwórz ponownie, Esc = pomiń / zamknij
// (wielkie odsłonięcie i skrzynka z pieniędzmi mają własną obsługę klawiszy)
function onStageKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t.closest?.('input, select, textarea, [contenteditable]')) return;
  if (epicOpen() || document.querySelector('.money-stage, .forge-anim, [role=dialog]')) return;
  if (viewerOpen()) {
    if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); closeViewer(); }
    return;
  }
  const o = S.opening;
  if (e.key === 'Escape') {
    if (o?.spinning) return skipSpin();
    if (o?.showingResults) return closeStage();
  }
  if (e.key === ' ' || e.key === 'Enter') {
    if (o?.spinning) { e.preventDefault(); return skipSpin(); }
    if (o?.showingResults) { e.preventDefault(); return void openAgain(); }
    if (!o && location.pathname === '/crates' && !t.closest?.('button, a')) { e.preventDefault(); openCrates(); }
  }
}

// Scena otwierania. Układ jest stały, a zawartość bębnów i wyników wstawia opening.ts.
export function Stage() {
  const game = useGame();
  useEffect(() => {
    document.addEventListener('keydown', onStageKey);
    return () => document.removeEventListener('keydown', onStageKey);
  }, []);

  const clickResults = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const fav = t.closest<HTMLElement>('[data-fav]');
    if (fav) return void setDropFavorite(+fav.dataset.fav!);
    const sell = t.closest<HTMLElement>('.rsell');
    if (sell) return void sellDrops([+sell.dataset.id!]);
    const card = t.closest<HTMLElement>('.card');
    if (card) openViewer(card.dataset.pid, card.dataset.variant, card.dataset.uid ? +card.dataset.uid : null);
  };
  const sellAll = () => {
    const ids = S.opening?.drops.filter((d: any) => !d.sold && !d.fav).map((d: any) => d.id) ?? [];
    if (ids.length) sellDrops(ids);
  };
  // w <body>, nie w <main>: scena musi przykryć też panel boczny (ma własny kontekst warstw)
  return createPortal(
    <div className="stage" id="stage" hidden>
      <div className="stage-bg" />
      <div className="stage-money" aria-label="Twoje grosze"><Money value={game.state.balance} /></div>
      <div className="stage-inner">
        <div className="stage-title" id="stageTitle" />
        <div className="reels" id="reels" />
        <div className="results" id="results" hidden onClick={clickResults} />
        <div className="stage-bar">
          <span className="stage-sum" id="stageSum" />
          <Button id="autoStopBtn" hidden onClick={stopAutoRun} />
          <Button id="skipBtn" onClick={skipSpin}>Pomiń</Button>
          <Button id="sellAllBtn" hidden onClick={sellAll} />
          <Button id="againBtn" kind="hue" hidden onClick={() => openAgain()} />
          <Button id="closeBtn" hidden onClick={closeStage} />
        </div>
      </div>
      <div className="flash" id="flash" />
    </div>,
    document.body
  );
}
