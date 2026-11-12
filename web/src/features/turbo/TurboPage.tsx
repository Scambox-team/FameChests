import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Rocket, Worm, Zap } from 'lucide-react';
import { PageHero } from '../../ui/PageHero';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import './turbo.css';

// Zakładka Gry -> Gry Super Turbo: kafelki gier z serii (adresy /games/turbo, /games/turbo/run, /games/turbo/snake).
// Każda gra to osobna scena 3D ładowana dopiero po wybraniu kafelka; nowa gra z serii = nowy wpis w GAMES i w PAGES.
const RunPage = lazy(() => import('./RunPage').then(m => ({ default: m.RunPage })));
const Snake3DPage = lazy(() => import('../snake/Snake3DPage').then(m => ({ default: m.Snake3DPage })));

const GAMES = [
  { id: 'run', cls: 'tb-run', icon: Rocket, title: 'Super Turbo Run 3D', text: 'Biegnij po ścianach neonowego tunelu, skacz nad dziurami, zbieraj kryształy i rozbijaj przeszkody w turbo. Grosze za przebiegnięty dystans.' },
  { id: 'snake', cls: 'tb-snk', icon: Worm, title: 'Super Turbo Snake 3D', text: 'Neonowy wąż na arenie 3D: turbo, hamulec, combo i złote kule. Grosze za zjedzone jabłka.' },
] as const;
const PAGES: Record<string, React.ReactNode> = { run: <RunPage />, snake: <Snake3DPage /> };

export function TurboPage({ sub }: { sub?: string }) {
  const navigate = useNavigate();
  const game = GAMES.find(g => g.id === sub);
  if (game && PAGES[game.id]) {
    return (
      <div className="tb-hub">
        <div><Button className="tb-back" onClick={() => { Sound.click(); navigate('/games/turbo'); }}><ArrowLeft size={16} aria-hidden="true" /> Gry Super Turbo</Button></div>
        <Suspense fallback={<p className="muted">Wczytuję</p>}>{PAGES[game.id]}</Suspense>
      </div>
    );
  }
  return (
    <div className="tb-hub">
      <PageHero icon={Zap} title="Gry Super Turbo" lead="Seria szybkich gier 3D z neonowym stylem. Wybierz grę, a zarobione grosze trafią do twojego salda." />
      <div className="tb-tiles">
        {GAMES.map(g => (
          <button key={g.id} type="button" className={`tb-tile ${g.cls}`} onClick={() => { Sound.click(); navigate(`/games/turbo/${g.id}`); }}>
            <g.icon aria-hidden="true" strokeWidth={1.8} />
            <h3>{g.title}</h3>
            <p>{g.text}</p>
            <span className="tb-go">Graj <ArrowRight size={16} aria-hidden="true" /></span>
          </button>
        ))}
      </div>
    </div>
  );
}
