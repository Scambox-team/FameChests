import { useEffect, useRef, useState } from 'react';
import { Coins } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { applyState } from '../../game/session';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { hasWebGL, setUser3DOff, use3D } from '../../three/support';
import type { Aim3D } from '../../three/aimpulseScene';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { pts, type ArcadeReward } from '../invaders/InvadersPage';
import './aimpulse.css';
import './turbo.css';

// Gry Super Turbo -> Super Turbo AIMPULSE 3D (three/aimpulseScene.ts, trener celności z menu i wynikami w środku kontenera).
// Punkty liczy serwer: daje ziarno na start rundy, po rundzie dostaje zapis strzałów, sam ją odtwarza (aimpulse_sim.rs)
// i płaci grosze wg ustawień z panelu admina (routes/arcade.rs). Rekord (osobno dla poziomu i czasu) w localStorage.
export function AimpulsePage() {
  const root = useRef<HTMLDivElement>(null);
  const game = useRef<Aim3D | null>(null);
  const ticket = useRef(false);   // serwer przyjął start rundy: po końcu prosimy o nagrodę
  const [won, setWon] = useState<{ reward: number; capped: boolean; score: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const { data: look, refetch } = useQuery({ queryKey: ['aimpulse-reward'], queryFn: () => api<{ reward: ArcadeReward }>('/api/games/arcade/aimpulse'), staleTime: 60_000 });
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const on = use3D();

  useEffect(() => {
    if (!on || !root.current) return;
    let alive = true;
    const el = root.current;
    import('../../three/aimpulseScene').then(({ createAimpulse }) => {
      if (!alive) return;
      try {
        game.current = createAimpulse(el, {
          volume: () => Sound.volume,
          soundOn: () => Sound.enabled,
          onStart: async (diff, dur) => {
            setWon(null);
            ticket.current = false;
            try {
              const r = await api<{ seed: number }>('/api/games/arcade/aimpulse/start', { diff, dur });
              ticket.current = true;
              return r.seed;
            } catch { return undefined; /* runda bez nagrody */ }
          },
          onOver: async ({ log }) => {
            if (!ticket.current) return 'RUNDA BEZ NAGRODY';
            ticket.current = false;
            try {
              // serwer odtwarza rundę z ziarna i zapisu strzałów, sam liczy punkty
              const r = await api<{ score: number; reward: number; capped: boolean; state: any }>('/api/games/arcade/aimpulse/finish', { log });
              applyState(r.state);
              setWon({ reward: r.reward, capped: r.capped, score: r.score });
              refetchRef.current();
              if (r.reward > 0) { Sound.coin(1); toast(`AIMPULSE: +${fmt(r.reward)}`); }
              return r.reward > 0 ? `NAGRODA: +${fmt(r.reward)}${r.capped ? ' (LIMIT)' : ''}` : r.capped ? 'OSIĄGNIĘTO DZIENNY LIMIT NAGRÓD' : 'ZA MAŁO PUNKTÓW NA NAGRODĘ';
            } catch (e: any) { toast(e.message, true); return undefined; }
          },
        });
      } catch { setFailed(true); }   // WebGL nie wystartował mimo wykrycia
    }).catch(() => { if (alive) setFailed(true); });
    // okienko gry (codzienna skrzynka, osiągnięcie...) nad planszą = pauza
    const watch = setInterval(() => { if (document.querySelector('[aria-modal="true"]')) game.current?.pause(); }, 250);
    return () => { alive = false; clearInterval(watch); game.current?.destroy(); game.current = null; };
  }, [on]);

  if (!on || failed) return (
    <div className="panel fl-off">
      <h3>Ta gra wymaga grafiki 3D</h3>
      <p className="muted">{failed ? 'Nie udało się uruchomić grafiki 3D w tej przeglądarce.' : 'Grafika 3D jest wyłączona w ustawieniach (albo przeglądarka nie obsługuje WebGL).'}</p>
      {hasWebGL() && !failed && <Button kind="hue" onClick={() => { setUser3DOff(false); location.reload(); }}>Włącz grafikę 3D</Button>}
    </div>
  );

  const rw = look?.reward;
  return (
    <div className="tb-page">
      <div className="tb-board" aria-label="Super Turbo AIMPULSE 3D. Celowanie myszą, strzał: lewy przycisk, pauza: Escape.">
        <div ref={root} className="tb-root" />
      </div>
      <aside className="tb-side">
        {won && (won.reward > 0 || won.capped) && (
          <div className="tb-reward">
            <Coins size={16} aria-hidden="true" />
            <span>{won.reward > 0 ? <>Nagroda za ostatnią rundę ({pts(won.score)} pkt): <b className="tb-won">+{fmt(won.reward)}</b></> : 'Osiągnięto dzienny limit nagród'}
              {won.capped && won.reward > 0 && <><br /><small className="muted">Osiągnięto limit nagród</small></>}</span>
          </div>
        )}
        {rw && rw.per > 0 && rw.daily > 0 && (
          <div className="tb-reward">
            <Coins size={16} aria-hidden="true" />
            <span>Nagroda: <b>{fmt(rw.per)}</b> {`za każde ${pts(rw.unit)} pkt od ${pts(rw.min)} pkt, najwyżej ${fmt(rw.perGame)} za rundę`}<br />
              <small className="muted">{`Dziś: ${fmt(rw.today)} / ${fmt(rw.daily)}`}</small></span>
          </div>
        )}
        <div className="tb-help">
          <h3>Sterowanie</h3>
          <p>Mysz: celowanie (kursor chowa się po starcie), <kbd>LPM</kbd> strzał, <kbd>R</kbd> restart, <kbd>M</kbd> muzyka, <kbd>F</kbd> pełny ekran, <kbd>Esc</kbd> pauza</p>
          <p className="muted small">Na telefonie celuj, przesuwając palcem, i strzelaj stuknięciem.</p>
          <h3>Zasady</h3>
          <ul>
            <li>Strzelaj w niebieskie kule. Im szybciej trafisz, tym więcej punktów, a trafienie w sam środek to PERFEKT (+50).</li>
            <li>Czerwonych min nie ruszaj: −300 pkt i koniec combo. Złoty bonus to +500 pkt, ale znika błyskawicznie.</li>
            <li>Combo mnoży punkty (do ×4). Pudło, mina albo przegapiona kula je zerują.</li>
          </ul>
          <p className="muted small">Punkty liczy serwer, odtwarzając twoją rundę strzał po strzale. Rekord zapisuje się tylko w tej przeglądarce.</p>
        </div>
      </aside>
    </div>
  );
}
