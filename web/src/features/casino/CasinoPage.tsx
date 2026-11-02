import { useEffect, useState } from 'react';
import { Dices } from 'lucide-react';
import { PageHero } from '../../ui/PageHero';
import { S, touch, useGame } from '../../game/store';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Tabs } from '../../ui/Field';
import { Blackjack } from './Blackjack';
import { Horses } from './Horses';
import { Jackpot } from './Jackpot';
import { Roulette } from './Roulette';
import { Slots } from './Slots';
import { CS } from './state';
import { Upgrade } from './Upgrade';
import './casino.css';
import './casino-theme.css';

const GAMES = [['roulette', 'Ruletka'], ['blackjack', 'Blackjack'], ['slots', 'Jednoręki bandyta'], ['horses', 'Wyścigi konne'], ['upgrade', 'Ulepszacz'], ['jackpot', 'Jackpot (2 graczy)']].map(([id, label]) => ({ id, label }));

/** Wyjście z kasyna po przegranej: pytamy, czy na pewno */
function LeaveGuard() {
  const [proceed, setProceed] = useState<null | (() => void)>(null);
  useEffect(() => {
    S.leaveGuard = (go: () => void) => {
      if (!CS.lost) return false;
      Sound.fail();
      setProceed(() => go);
      return true;
    };
    return () => { S.leaveGuard = null; };
  }, []);
  useEffect(() => {
    if (!proceed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setProceed(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [proceed]);
  if (!proceed) return null;
  return (
    <div className="cs-leave" role="dialog" aria-modal="true" aria-label="Wyjście z kasyna" onClick={e => { if (e.target === e.currentTarget) setProceed(null); }}>
      <div className="cs-leave-box">
        <img src="/static/img/casino_leave.png" alt="" />
        <h2>Na pewno wychodzisz?</h2>
        <div className="cs-btns">
          <Button kind="hue" onClick={() => setProceed(null)}>Zostaję</Button>
          <Button onClick={() => { CS.lost = false; const go = proceed; setProceed(null); go(); }}>Wychodzę</Button>
        </div>
      </div>
    </div>
  );
}

export function CasinoPage() {
  const game = useGame();
  useEffect(() => { document.title = 'Kasyno · ScamBox'; }, []);
  const pick = (t: string) => {
    if (S.spinning || t === CS.tab) return;
    CS.tab = t;
    Sound.click();
    touch();
  };
  return (
    <>
      <PageHero icon={Dices} title="Graj kartami" lead="Stawką są twoje karty. Wygrana daje losowe karty o wartości stawki razy mnożnik, przegrana zabiera postawione. Ulubionych i specjalnych nie da się postawić.">
        <Tabs label="Gry" value={CS.tab} onChange={pick} items={GAMES.map(g => ({ ...g, disabled: !!game.spinning }))} />
      </PageHero>
      {CS.tab === 'roulette' && <Roulette />}
      {CS.tab === 'blackjack' && <Blackjack />}
      {CS.tab === 'slots' && <Slots />}
      {CS.tab === 'horses' && <Horses />}
      {CS.tab === 'upgrade' && <Upgrade />}
      {CS.tab === 'jackpot' && <Jackpot />}
      <LeaveGuard />
    </>
  );
}
