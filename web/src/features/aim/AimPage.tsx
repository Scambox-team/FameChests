import { useEffect, useRef, useState } from 'react';
import { Crosshair, Play } from 'lucide-react';
import { api } from '../../api/client';
import { fmtNum } from '../../lib/format';
import { Button } from '../../ui/Button';
import { GameRanking } from '../chess/GameRanking';
import { createAim, type AimGame, type AimHud } from './engine';
import './aim.css';

// Zakładka Gry -> Strzelnica: runda 45 s z blaszanymi kaczkami. Wynik liczy serwer (odtwarza zapis strzałów), do rankingu trafia
// tylko runda sprawdzona przez serwer; bez nagród w groszach i kartach.
type Result = { verified: boolean; reason: string; score?: number; hits?: number; shots?: number };
const WHY: Record<string, string> = {
  invalid: 'Serwer nie zdołał odtworzyć zapisu rundy, wynik nie wchodzi do rankingu.',
  implausible: 'Runda trwała krócej niż jej zapis, wynik nie wchodzi do rankingu.',
  no_run: 'Nie udało się rozliczyć rundy.',
};

export function AimPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<AimGame | null>(null);
  const runId = useRef<number | null>(null);
  const prev = useRef('attract');
  const [hud, setHud] = useState<AimHud | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const g = createAim(canvas.current!, setHud, {
      // ziarno rundy daje serwer; bez niego (błąd sieci) gra się normalnie, ale bez rankingu
      begin: async () => {
        try {
          const r = await api<{ run: number; seed: number }>('/api/aim/start', {});
          runId.current = r.run;
          return r.seed;
        } catch { runId.current = null; return null; }
      },
    });
    game.current = g;
    return () => { g.destroy(); game.current = null; };
  }, []);

  // koniec rundy -> serwer odtwarza zapis strzałów i sam liczy wynik
  useEffect(() => {
    const phase = hud?.phase;
    if (!phase) return;
    if (phase === 'play' && prev.current !== 'play') setResult(null);
    if (phase === 'over' && prev.current === 'play') {
      const rec = game.current?.getRun(), id = runId.current;
      runId.current = null;
      if (rec?.verified && id) {
        setChecking(true);
        api<Result>('/api/aim/finish', { run: id, log: rec.log }).then(setResult).catch(() => {}).finally(() => setChecking(false));
      }
    }
    prev.current = phase;
  }, [hud?.phase]);

  const playing = hud?.phase === 'play';
  const acc = hud && hud.shots ? Math.round((hud.hits / hud.shots) * 100) : 0;
  const left = Math.round(hud?.left ?? 45);

  return (
    <div className="aim-page">
      <div className="aim-stage">
        <canvas ref={canvas} className="aim-canvas" aria-label="Strzelnica: klikaj w kaczki, żeby w nie strzelać." />
      </div>
      <aside className="aim-side">
        <div className="aim-board" role="status" aria-live="polite">
          <span className="aim-label">{playing ? 'Punkty' : hud?.phase === 'over' ? 'Koniec rundy' : 'Strzelnica'}</span>
          <b className="aim-score">{fmtNum(hud?.score ?? 0)}</b>
          <div className="aim-row">
            <span>{`Czas ${left} s`}</span>
            <span>{`Seria ${hud?.streak ?? 0}`}</span>
            <span>{`Mnożnik x${hud?.mult ?? 1}`}</span>
          </div>
          <div className="aim-bar" aria-hidden="true"><i style={{ width: `${Math.round((left / 45) * 100)}%` }} /></div>
          <div className="aim-row"><span>{`Celność ${acc}%`}</span><span>{`Trafienia ${hud?.hits ?? 0}/${hud?.shots ?? 0}`}</span></div>
        </div>
        <div className="aim-best"><span>Twój rekord</span><b>{fmtNum(hud?.best ?? 0)}</b></div>
        <Button kind="hue" onClick={() => { game.current?.start(); }} disabled={playing}>
          <Play size={16} aria-hidden="true" /> {hud?.phase === 'over' ? 'Zagraj jeszcze raz' : 'Zagraj'}
        </Button>
        {(checking || result) && hud?.phase === 'over' && (
          <div className="aim-result" role="status">
            {checking && <span>Serwer sprawdza zapis rundy…</span>}
            {result?.verified && <span className="aim-ok">{`Wynik sprawdzony przez serwer: ${fmtNum(result.score ?? 0)} pkt, trafień ${result.hits} z ${result.shots}.`}</span>}
            {result && !result.verified && <span>{WHY[result.reason] ?? 'Wynik nie wchodzi do rankingu.'}</span>}
          </div>
        )}
        <GameRanking game="aim" title="Ranking strzelnicy" refresh={result?.score} />
        <div className="aim-help">
          <h3><Crosshair size={16} aria-hidden="true" /> Zasady</h3>
          <ul>
            <li>Masz 45 sekund. Klikaj w kaczki, żeby w nie strzelać; dotyk też działa.</li>
            <li>Dalsze rzędy są mniejsze i szybsze, więc dają więcej punktów: 30, 20 i 10.</li>
            <li>Złota kaczka jest mała i bardzo szybka, za nią jest 100 punktów.</li>
            <li>Co 3 trafienia z rzędu rośnie mnożnik (do x5). Pudło zeruje serię.</li>
            <li>Między strzałami jest krótka przerwa, więc nie da się klikać na ślepo.</li>
          </ul>
          <p className="muted small">Wynik liczy serwer na podstawie zapisu strzałów. Za rundę nie ma nagród, liczy się tylko ranking.</p>
        </div>
      </aside>
    </div>
  );
}
