import { closeStage, openAgain, sellDrops, setDropFavorite, skipSpin, stopAutoRun } from './opening';
import { Button } from '../../ui/Button';
import { openViewer } from '../../fx/effects';
import { S } from '../../game/store';
import './Stage.css';

// Scena otwierania. Układ jest stały, a zawartość bębnów i wyników wstawia opening.ts.
export function Stage() {
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
  return (
    <div className="stage" id="stage" hidden>
      <div className="stage-bg" />
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
    </div>
  );
}
