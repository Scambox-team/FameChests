import { useEffect, useRef, useState } from 'react';
import { Box, Minus, Play, Plus, RotateCcw, Square } from 'lucide-react';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { syncInventory } from '../../game/session';
import { S, touch } from '../../game/store';
import { fmt as fmtGr, fmtNum } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { baseTheme } from '../../styles/theme';
import { GameRanking } from '../chess/GameRanking';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { createPinball, type PinballGame, type PinHud } from './engine';
import { LEVELS } from './levels';
import './pinball.css';

// Zakładka Gry -> Pinball: płótno z silnikiem (engine.ts) w szafie automatu + wyświetlacz wyniku.
const fmt = (n: number) => n.toLocaleString('pl-PL');
const readLevel = () => { try { return Math.min(LEVELS.length, Math.max(1, +(localStorage.getItem('pinballLevel') ?? 1) || 1)); } catch { return 1; } };
const bestOf = (n: number) => { try { return +(localStorage.getItem(n === 1 ? 'pinballBest' : `pinballBest${n}`) ?? 0) || 0; } catch { return 0; } };
const read3d = () => { try { return localStorage.getItem('pinball3d') !== 'off'; } catch { return true; } };

type Tier = { score: number; rarity: string; name: string };
type Rewards = { pointsPerGr: number; cardTiers: Tier[]; levelMults?: number[] };
type Won = { id: number; person: string; variant: string; name: string; rarity: string };
type Result = { reward: number; reason: string; card: Won | null; score?: number };
const WHY: Record<string, string> = {
  too_short: 'Za krótka gra: nagroda od 30 sekund gry.',
  implausible: 'Wynik wygląda nierealnie, nagrody nie ma.',
  invalid: 'Serwer nie zdołał odtworzyć zapisu gry, nagrody nie ma.',
  no_run: 'Nie udało się rozliczyć gry.',
};

const levelMult = (r: Rewards, level: number) => r.levelMults?.[level - 1] ?? r.levelMults?.[r.levelMults.length - 1] ?? 1;

export function PinballPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<PinballGame | null>(null);
  const [hud, setHud] = useState<PinHud | null>(null);
  const [tilt3d, setTilt3d] = useState(read3d);
  const [level, setLevel] = useState(readLevel);
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const runId = useRef<number | null>(null);   // gra rozpoczęta na serwerze (czas i ziarno daje serwer)
  const [checking, setChecking] = useState(false);
  const prev = useRef('attract');

  useEffect(() => { api<Rewards>('/api/pinball').then(setRewards).catch(() => {}); }, []);

  // koniec gry -> serwer odtwarza zapis wciśnięć i sam liczy wynik oraz nagrodę (limity: game.json `pinball`)
  useEffect(() => {
    const phase = hud?.phase;
    if (!phase) return;
    if (phase === 'play' && prev.current !== 'play') setResult(null);
    if (phase === 'over' && prev.current === 'play') {
      const rec = game.current?.getRun(), id = runId.current;
      runId.current = null;
      if (rec?.verified && id) {
        setChecking(true);
        api<Rewards & Result & { balance: number; score: number }>('/api/pinball/finish', { run: id, level, ticks: rec.ticks, log: rec.log })
          .then(r => {
            setRewards(r);
            setResult(r);
            S.state = { ...S.state, balance: r.balance };
            touch();
            if (r.reward > 0) toast(`Pinball: +${fmtGr(r.reward)}`);
            if (r.card) { toast(`Pinball: karta ${r.card.name} w wariancie Synthwave`); syncInventory(null, true); }
          })
          .catch(() => {})
          .finally(() => setChecking(false));
      }
    }
    prev.current = phase;
  }, [hud?.phase]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    prev.current = 'attract'; runId.current = null;
    setResult(null);
    const g = createPinball(canvas.current!, setHud, level, {
      // ziarno gry daje serwer; bez niego (błąd sieci) gra się normalnie, ale bez nagród
      begin: async () => {
        try {
          const r = await api<Rewards & { run: number; seed: number }>('/api/pinball/start', { level });
          runId.current = r.run; setRewards(r);
          return r.seed;
        } catch { runId.current = null; return null; }
      },
    });
    game.current = g;
    return () => { g.destroy(); game.current = null; };
  }, [level]);
  useEffect(() => { game.current?.resize(); }, [tilt3d]);
  // przybliżenie jak w ruletce: kółko myszy (na granicy zoomu strona przewija się dalej), przyciski, dwuklik wraca
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { if (game.current?.zoom(-Math.sign(e.deltaY) * 0.18)) e.preventDefault(); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [level]);

  const toggle3d = () => {
    Sound.click();
    setTilt3d(v => { try { localStorage.setItem('pinball3d', v ? 'off' : 'on'); } catch { /* bez zapisu */ } return !v; });
  };
  const playing = hud?.phase === 'play';
  const pick = (n: number) => {
    if (playing || n === level) return;
    Sound.click();
    try { localStorage.setItem('pinballLevel', String(n)); } catch { /* bez zapisu */ }
    setLevel(n);
  };

  return (
    <div className={`pb-page pb-sk-${baseTheme()}`}>
      <div className={`pb-stage${tilt3d ? ' is-3d' : ''}`}>
        <div className="pb-cabinet">
          <div className="pb-table">
            <canvas ref={canvas} className="pb-canvas" aria-label="Stół pinballa. Lewa łapa: Z albo strzałka w lewo, prawa łapa: strzałka w prawo, wyrzut: spacja." />
            <div className="pb-scan" aria-hidden="true" />
            <div className="pb-cam" role="group" aria-label="Kamera">
              <button type="button" aria-label="Przybliż" onClick={() => game.current?.zoom(0.3)}><Plus size={16} /></button>
              <button type="button" aria-label="Oddal" onClick={() => game.current?.zoom(-0.3)}><Minus size={16} /></button>
              <button type="button" aria-label="Wróć do widoku" onClick={() => game.current?.resetZoom()}><RotateCcw size={15} /></button>
            </div>
          </div>
        </div>
      </div>

      <aside className="pb-side">
        <div className="pb-dmd" role="status" aria-live="polite">
          <span className="pb-dmd-label">{playing ? `Kulka ${hud!.ball} / ${hud!.balls}` : hud?.phase === 'over' ? 'Koniec gry' : 'Neon Drive'}</span>
          <b className="pb-dmd-score">{fmt(hud?.score ?? 0)}</b>
          <div className="pb-dmd-row">
            <span>Mnożnik <b>x{hud?.mult ?? 1}</b></span>
            {hud?.multiball && <span className="pb-flash">Multiball</span>}
            {hud?.save && <span>Kulka chroniona</span>}
            {hud?.tilt && <span className="pb-flash">Tilt</span>}
          </div>
        </div>
        {rewards && (
          <div className="pb-reward" role="status">
            <b>Nagroda w groszach</b>
            <span>{`${fmtGr(1)} za każde ${rewards.pointsPerGr} pkt, bez limitu.`}</span>
            {levelMult(rewards, level) !== 1 && <span>{`Poziom ${level}: nagroda x${String(levelMult(rewards, level)).replace('.', ',')}, czyli ${fmtGr(1)} za każde ${Math.round(rewards.pointsPerGr / levelMult(rewards, level))} pkt.`}</span>}
            {rewards.cardTiers.length > 0 && (
              <span>{`Karta Synthwave od ${fmtNum(rewards.cardTiers[0].score)} pkt (${rewards.cardTiers.map(t => `${fmtNum(t.score)}: ${t.name}`).join(', ')}), bez limitu.`}</span>
            )}
            {result?.card && hud?.phase === 'over' && (
              <span className="pb-reward-card" onClick={() => openViewer(result.card!.person, result.card!.variant, result.card!.id)}>
                <Card person={result.card.person} variant={result.card.variant} tilt={false} />
              </span>
            )}
            {checking && <span>Serwer sprawdza zapis gry…</span>}
            {result?.score !== undefined && hud?.phase === 'over' && result.score !== hud.score && (
              <span>{`Wynik sprawdzony przez serwer: ${fmtNum(result.score)}.`}</span>
            )}
            {result && hud?.phase === 'over' && (
              <span className={result.reward > 0 ? 'pb-reward-got' : 'pb-reward-none'}>
                {result.reward > 0 ? `Zarobiono: +${fmtGr(result.reward)}` : WHY[result.reason] ?? 'Bez nagrody.'}
              </span>
            )}
          </div>
        )}
        <div className="pb-levels" role="radiogroup" aria-label="Poziom">
          {LEVELS.map(l => (
            <button key={l.id} type="button" role="radio" aria-checked={l.id === level} disabled={playing && l.id !== level}
              className={`pb-level${l.id === level ? ' is-on' : ''}`} onClick={() => pick(l.id)}>
              <b>{l.id}</b>
              <span>{l.name}<small>{l.blurb}</small></span>
              <em>{bestOf(l.id) ? fmt(bestOf(l.id)) : '—'}</em>
            </button>
          ))}
        </div>
        <GameRanking game="pinball" level={level} title={`Ranking: ${LEVELS[level - 1].name}`} refresh={result?.score} />
        <div className="pb-best"><span>Twój rekord</span><b>{fmt(hud?.best ?? 0)}</b></div>
        <div className="pb-actions">
          <Button kind="hue" onClick={() => { Sound.unlock(); game.current?.start(); canvas.current?.focus(); }} disabled={playing}>
            <Play size={16} aria-hidden="true" /> {hud?.phase === 'over' ? 'Zagraj jeszcze raz' : 'Zagraj'}
          </Button>
          <Button onClick={toggle3d} aria-pressed={tilt3d}>{tilt3d ? <Box size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />} {tilt3d ? 'Widok 3D' : 'Widok z góry'}</Button>
        </div>
        <div className="pb-help">
          <h3>Sterowanie</h3>
          <dl>
            <div><dt>Lewa łapa</dt><dd><kbd>Z</kbd> <kbd>←</kbd> <kbd>Shift</kbd></dd></div>
            <div><dt>Prawa łapa</dt><dd><kbd>/</kbd> <kbd>→</kbd> <kbd>Shift</kbd></dd></div>
            <div><dt>Wyrzut</dt><dd>przytrzymaj <kbd>Spacja</kbd> i puść</dd></div>
            <div><dt>Szturchnięcie</dt><dd><kbd>Spacja</kbd> w trakcie gry albo <kbd>N</kbd></dd></div>
          </dl>
          <p className="muted small">Na telefonie: lewa i prawa połowa stołu to łapy, przytrzymaj prawy dolny róg, żeby wyrzucić kulkę.</p>
          <h3>Zasady</h3>
          <ul>
            <li>Zapal tory <b>N E O N</b> u góry (łapy przesuwają zapalone światła): mnożnik rośnie do x5.</li>
            <li>Zbij cele <b>V H S</b> po lewej i zapal <b>R A D</b> po prawej, potem traf w <b>słońce</b>: multiball.</li>
            <li>W multiballu każde trafienie w słońce to <b>jackpot</b>, za każdym razem większy.</li>
            <li>Przez pierwsze sekundy po wyrzucie kulka jest chroniona. Za mocne szturchanie to TILT.</li>
          </ul>
          <p className="muted small">Rekord zapisuje się tylko w tej przeglądarce. Nagrodę liczy serwer: gra musi trwać co najmniej 30 sekund i skończyć się wszystkimi kulkami.</p>
        </div>
      </aside>
    </div>
  );
}
