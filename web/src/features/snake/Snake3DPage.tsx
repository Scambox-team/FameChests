import { useEffect, useRef, useState } from 'react';
import { Coins } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Card } from '../../cards/Card';
import { openViewer } from '../../fx/effects';
import { variantName } from '../../game/rules';
import { applyState, syncInventory } from '../../game/session';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { hasWebGL, setUser3DOff, use3D } from '../../three/support';
import type { Snake3D } from '../../three/snakeScene';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import './snake3dpage.css';
import './snake3d.css';

// Zakładka Gry -> Gry Super Turbo -> Super Turbo Snake 3D (three/snakeScene.ts, neonowa arena z HUD-em w środku kontenera).
// Wynik w punktach i rekord liczy gra (localStorage `snake3dBest`); serwer daje ziarno na start, po grze dostaje zapis skrętów, sam odtwarza grę
// (snake3d_sim.rs), liczy zjedzone kule i płaci wg ustawień z panelu admina.
interface WonCard { id: number; person: string; variant: string; name: string; rarity: string }
interface Reward { perApple: number; perGame: number; daily: number; minScore: number; today: number }
interface TurboCards { cardVariant: string; cardTiers: { score: number; rarity: string; name: string }[] }

export function Snake3DPage() {
  const root = useRef<HTMLDivElement>(null);
  const game = useRef<Snake3D | null>(null);
  const ticket = useRef(false);   // serwer przyjął start gry: po końcu prosimy o nagrodę
  const [won, setWon] = useState<{ reward: number; capped: boolean; card: WonCard | null } | null>(null);
  const { data: look, refetch } = useQuery({ queryKey: ['snake3d-look'], queryFn: () => api<{ reward?: Reward; turbo?: TurboCards }>('/api/games/snake'), staleTime: 60_000 });
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const on = use3D();

  useEffect(() => {
    if (!on || !root.current) return;
    let alive = true;
    const el = root.current;
    import('../../three/snakeScene').then(({ createSnake3D }) => {
      if (!alive) return;
      game.current = createSnake3D(el, {
        volume: () => Sound.volume,
        soundOn: () => Sound.enabled,
        onStart: async () => {
          Sound.unlock();
          setWon(null);
          ticket.current = false;
          try {
            const r = await api<{ seed: number }>('/api/games/snake/start', { turbo: true });
            ticket.current = true;
            return r.seed;
          } catch { return undefined; /* gra bez nagrody */ }
        },
        onOver: async ({ log, ticks }) => {
          if (!ticket.current) return;
          ticket.current = false;
          try {
            const r = await api<{ reward: number; capped: boolean; card: WonCard | null; state: any }>('/api/games/snake/finish', { log, steps: ticks });   // serwer odtwarza grę i sam liczy kule
            applyState(r.state);
            setWon({ reward: r.reward, capped: r.capped, card: r.card });
            if (r.reward > 0) { Sound.coin(1); toast(`Snake: +${fmt(r.reward)}`); }
            if (r.card) { syncInventory(); toast(`Super Turbo: karta ${r.card.name} w wariancie ${variantName(r.card.variant)}`); }
            refetchRef.current();
          } catch (e: any) { toast(e.message, true); }
        },
      });
    });
    // okienko gry (codzienna skrzynka, osiągnięcie...) nad planszą = pauza
    const watch = setInterval(() => { if (document.querySelector('[aria-modal="true"]')) game.current?.pause(); }, 250);
    return () => { alive = false; clearInterval(watch); game.current?.destroy(); game.current = null; };
  }, [on]);

  if (!on) return (
    <div className="panel fl-off">
      <h3>Ta gra wymaga grafiki 3D</h3>
      <p className="muted">Grafika 3D jest wyłączona w ustawieniach (albo przeglądarka nie obsługuje WebGL).</p>
      {hasWebGL() && <Button kind="hue" onClick={() => { setUser3DOff(false); location.reload(); }}>Włącz grafikę 3D</Button>}
    </div>
  );

  const rw = look?.reward;
  return (
    <div className="s3-page">
      <div className="s3-board" aria-label="Super Turbo Snake 3D. Skręt: A i D albo strzałki, turbo: W, hamulec: S, pauza: P.">
        <div ref={root} className="s3-root" />
      </div>
      <aside className="s3-side">
        {won && (won.reward > 0 || won.capped || won.card) && (
          <div className="s3-reward">
            <Coins size={16} aria-hidden="true" />
            <span>{won.reward > 0 ? <>Nagroda za ostatnią grę: <b className="s3-won">+{fmt(won.reward)}</b></> : won.capped ? 'Osiągnięto dzienny limit nagród' : 'Nowa karta:'}
              {won.capped && won.reward > 0 && <><br /><small className="muted">Osiągnięto dzienny limit nagród</small></>}</span>
            {won.card && <span style={{ width: 120, cursor: 'pointer', flex: 'none' }} onClick={() => openViewer(won.card!.person, won.card!.variant, won.card!.id)}><Card person={won.card.person} variant={won.card.variant} tilt={false} /></span>}
          </div>
        )}
        {rw && rw.perApple > 0 && rw.daily > 0 && (
          <div className="s3-reward">
            <Coins size={16} aria-hidden="true" />
            <span>Nagroda: <b>{fmt(rw.perApple)}</b> {`za jabłko od ${rw.minScore} jabłek, najwyżej ${fmt(rw.perGame)} za grę`}<br />
              <small className="muted">{`Dziś: ${fmt(rw.today)} / ${fmt(rw.daily)}`}</small></span>
          </div>
        )}
        {look?.turbo && look.turbo.cardTiers.length > 0 && (
          <div className="s3-reward">
            <Coins size={16} aria-hidden="true" />
            <span>Karta w wariancie {variantName(look.turbo.cardVariant)} za wynik: {look.turbo.cardTiers.map(t => `${t.score} jabłek: ${t.name}`).join(', ')}, bez limitu.</span>
          </div>
        )}
        <div className="s3-help">
          <h3>Sterowanie</h3>
          <p><kbd>A</kbd> <kbd>D</kbd> albo <kbd>←</kbd> <kbd>→</kbd> skręt, <kbd>W</kbd> turbo, <kbd>S</kbd> hamulec, <kbd>P</kbd> pauza, <kbd>M</kbd> dźwięk, <kbd>F</kbd> pełny ekran</p>
          <p className="muted small">Na telefonie dotknij lewej albo prawej połowy planszy, żeby skręcić.</p>
          <h3>Zasady</h3>
          <ul>
            <li>Zjadaj kule: każda wydłuża węża, a złote dają 50 punktów i dużo turbo.</li>
            <li>Kolejne kule zjedzone szybko po sobie nabijają combo, a turbo podwaja punkty.</li>
            <li>Uderzenie w ścianę albo we własny ogon kończy grę.</li>
          </ul>
          <p className="muted small">Rekord (w punktach) zapisuje się tylko w tej przeglądarce.</p>
        </div>
      </aside>
    </div>
  );
}
