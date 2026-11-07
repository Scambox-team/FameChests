import { useEffect, useRef, useState } from 'react';
import { Box, Play, Square } from 'lucide-react';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { syncInventory } from '../../game/session';
import { S, touch } from '../../game/store';
import { fmt as fmtGr, fmtNum } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { createPinball, type PinballGame, type PinHud } from './engine';
import './pinball.css';

// Zakładka Gry -> Pinball: płótno z silnikiem (engine.ts) w szafie automatu + wyświetlacz wyniku.
const fmt = (n: number) => n.toLocaleString('pl-PL');
const read3d = () => { try { return localStorage.getItem('pinball3d') !== 'off'; } catch { return true; } };

type Tier = { score: number; rarity: string; name: string };
type Rewards = { pointsPerGr: number; maxPerRun: number; maxPerDay: number; left: number; cardTiers: Tier[]; cardsLeft: number };
type Won = { id: number; person: string; variant: string; name: string; rarity: string };
type Result = { reward: number; reason: string; card: Won | null };
const WHY: Record<string, string> = {
  too_short: 'Za krótka gra: nagroda od 30 sekund gry.',
  implausible: 'Wynik wygląda nierealnie, nagrody nie ma.',
  daily_limit: 'Dzisiejszy limit nagród z Pinballa wyczerpany.',
  no_run: 'Nie udało się rozliczyć gry.',
};

export function PinballPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<PinballGame | null>(null);
  const [hud, setHud] = useState<PinHud | null>(null);
  const [tilt3d, setTilt3d] = useState(read3d);
  const [rewards, setRewards] = useState<Rewards | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const run = useRef<Promise<number | null> | null>(null);   // gra rozpoczęta na serwerze (czas liczy serwer)
  const prev = useRef('attract');

  useEffect(() => { api<Rewards>('/api/pinball').then(setRewards).catch(() => {}); }, []);

  // początek gry -> serwer zapisuje czas; koniec gry -> serwer wylicza nagrodę (limity: game.json `pinball`)
  useEffect(() => {
    const phase = hud?.phase;
    if (!phase) return;
    if (phase === 'play' && prev.current !== 'play') {
      setResult(null);
      run.current = api<Rewards & { run: number }>('/api/pinball/start', {}).then(r => { setRewards(r); return r.run; }).catch(() => null);
    }
    if (phase === 'over' && prev.current === 'play') {
      const score = hud.score, started = run.current;
      run.current = null;
      started?.then(async id => {
        if (!id) return;
        const r = await api<Rewards & Result & { balance: number }>('/api/pinball/finish', { run: id, score });
        setRewards(r);
        setResult(r);
        S.state = { ...S.state, balance: r.balance };
        touch();
        if (r.reward > 0) toast(`Pinball: +${fmtGr(r.reward)}`);
        if (r.card) { toast(`Pinball: karta ${r.card.name} w wariancie Synthwave`); syncInventory(null, true); }
      }).catch(() => {});
    }
    prev.current = phase;
  }, [hud?.phase]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const g = createPinball(canvas.current!, setHud);
    game.current = g;
    return () => { g.destroy(); game.current = null; };
  }, []);
  useEffect(() => { game.current?.resize(); }, [tilt3d]);

  const toggle3d = () => {
    Sound.click();
    setTilt3d(v => { try { localStorage.setItem('pinball3d', v ? 'off' : 'on'); } catch { /* bez zapisu */ } return !v; });
  };
  const playing = hud?.phase === 'play';

  return (
    <div className="pb-page">
      <div className={`pb-stage${tilt3d ? ' is-3d' : ''}`}>
        <div className="pb-cabinet">
          <div className="pb-table">
            <canvas ref={canvas} className="pb-canvas" aria-label="Stół pinballa. Lewa łapa: Z albo strzałka w lewo, prawa łapa: strzałka w prawo, wyrzut: spacja." />
            <div className="pb-scan" aria-hidden="true" />
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
            <span>{`${fmtGr(1)} za każde ${rewards.pointsPerGr} pkt, do ${fmtGr(rewards.maxPerRun)} za grę.`}</span>
            <span>{`Dziś jeszcze do zarobienia: ${fmtGr(rewards.left)} z ${fmtGr(rewards.maxPerDay)}.`}</span>
            {rewards.cardTiers.length > 0 && (
              <span>{`Karta Synthwave od ${fmtNum(rewards.cardTiers[0].score)} pkt (${rewards.cardTiers.map(t => `${fmtNum(t.score)}: ${t.name}`).join(', ')}). Dziś jeszcze kart: ${rewards.cardsLeft}.`}</span>
            )}
            {result?.card && hud?.phase === 'over' && (
              <span className="pb-reward-card" onClick={() => openViewer(result.card!.person, result.card!.variant, result.card!.id)}>
                <Card person={result.card.person} variant={result.card.variant} tilt={false} />
              </span>
            )}
            {result && hud?.phase === 'over' && (
              <span className={result.reward > 0 ? 'pb-reward-got' : 'pb-reward-none'}>
                {result.reward > 0 ? `Zarobiono: +${fmtGr(result.reward)}` : WHY[result.reason] ?? 'Bez nagrody.'}
              </span>
            )}
          </div>
        )}
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
