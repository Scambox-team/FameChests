import { useCallback, useEffect, useState } from 'react';
import { ChevronsUp, Cherry, Club, Dices, Disc3, Flag, Spade, Swords, type LucideIcon } from 'lucide-react';
import { PageHero } from '../../ui/PageHero';
import { S, touch, useGame } from '../../game/store';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { Blackjack } from './Blackjack';
import { CasinoIntro } from './CasinoIntro';
import { casinoIntroWanted, markCasinoIntroSeen } from './introPref';
import { Horses } from './Horses';
import { Jackpot } from './Jackpot';
import { Poker } from './Poker';
import { Roulette } from './Roulette';
import { Slots } from './Slots';
import { CS } from './state';
import { Upgrade } from './Upgrade';
import './casino.css';
import './casino-theme.css';
import './casino-fx.css';

const GAMES: { id: string; label: string; sub: string; icon: LucideIcon }[] = [
  { id: 'roulette', label: 'Ruletka', sub: 'Czerwone, czarne, numer', icon: Disc3 },
  { id: 'blackjack', label: 'Blackjack', sub: 'Do 21 z krupierem', icon: Spade },
  { id: 'poker', label: 'Poker', sub: "Hold'em, 2-6 graczy", icon: Club },
  { id: 'slots', label: 'Jednoręki bandyta', sub: 'Trzy bębny, jedna linia', icon: Cherry },
  { id: 'horses', label: 'Wyścigi konne', sub: 'Obstaw konia', icon: Flag },
  { id: 'upgrade', label: 'Ulepszacz', sub: 'Mnożnik w ciemno', icon: ChevronsUp },
  { id: 'jackpot', label: 'Jackpot', sub: 'Pojedynek 2 graczy', icon: Swords }
];

/** Wyścigi wyłączone w game.json (`horseRace.enabled: false`) */
const horsesOn = () => S.cfg.horses?.race?.enabled !== false;
/** Wyłączone wyścigi widzi admin (i tryb dev) jako podgląd testowy bez zakładów */
const horsesVisible = () => horsesOn() || !!S.me?.isAdmin || import.meta.env.DEV;

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
  const [intro, setIntro] = useState(casinoIntroWanted);   // GIF raz na sesję (można wyłączyć w ustawieniach)
  const endIntro = useCallback(() => { markCasinoIntroSeen(); setIntro(false); }, []);
  useEffect(() => { document.title = 'Kasyno · ScamBox'; }, []);
  const games = GAMES.filter(g => g.id !== 'horses' || horsesVisible()).map(g => g.id === 'horses' && !horsesOn() ? { ...g, sub: 'Podgląd 3D (test)' } : g);
  const pick = (t: string) => {
    if (S.spinning || t === CS.tab) return;
    CS.tab = t;
    Sound.click();
    touch();
  };
  return (
    <div className="cs-page">
      <PageHero icon={Dices} title="Graj kartami" lead="Stawką są twoje karty. Wygrana daje losowe karty o wartości stawki razy mnożnik, przegrana zabiera postawione. Ulubionych i specjalnych nie da się postawić." />
      <nav className="cs-games" aria-label="Gry">
        {games.map(({ id, label, sub, icon: Icon }) => (
          <button key={id} type="button" className={`cs-game${CS.tab === id ? ' on' : ''}`} aria-pressed={CS.tab === id} disabled={!!game.spinning && CS.tab !== id} onClick={() => pick(id)}>
            <Icon strokeWidth={1.6} aria-hidden="true" /><span><b>{label}</b><small>{sub}</small></span>
          </button>
        ))}
      </nav>
      {CS.tab === 'roulette' && <Roulette />}
      {CS.tab === 'blackjack' && <Blackjack />}
      {CS.tab === 'slots' && <Slots />}
      {CS.tab === 'horses' && horsesVisible() && <Horses />}
      {CS.tab === 'upgrade' && <Upgrade />}
      {CS.tab === 'jackpot' && <Jackpot />}
      {CS.tab === 'poker' && <Poker />}
      <LeaveGuard />
      {intro && <CasinoIntro onDone={endIntro} />}
    </div>
  );
}
