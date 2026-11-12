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
import type { Run3D } from '../../three/runScene';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import './run3d.css';
import './turbo.css';

// Gry Super Turbo -> Super Turbo Run 3D (three/runScene.ts, bieg po tunelu z HUD-em w środku kontenera).
// Wynik w punktach i rekord liczy gra (localStorage `superTurboRun3D.best`); serwer daje ziarno tunelu na start, po biegu dostaje zapis klawiszy,
// sam odtwarza bieg (run_sim.rs) i liczy dystans,
// i płaci wg ustawień z panelu admina (routes/turbo_run.rs, bilet z /api/games/run/start, bez kart).
interface WonCard { id: number; person: string; variant: string; name: string; rarity: string }
interface Reward {
  per100m: number; minDist: number; perGame: number; daily: number; today: number;
  cardVariant: string; cardTiers: { score: number; rarity: string; name: string }[];
}

export function RunPage() {
  const root = useRef<HTMLDivElement>(null);
  const game = useRef<Run3D | null>(null);
  const ticket = useRef(false);   // serwer przyjął start biegu: po końcu prosimy o nagrodę
  const [won, setWon] = useState<{ reward: number; capped: boolean; card: WonCard | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const { data: look, refetch } = useQuery({ queryKey: ['run3d-look'], queryFn: () => api<{ reward?: Reward }>('/api/games/run'), staleTime: 60_000 });
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const on = use3D();

  useEffect(() => {
    if (!on || !root.current) return;
    let alive = true;
    const el = root.current;
    import('../../three/runScene').then(({ createRun3D }) => {
      if (!alive) return;
      try {
        game.current = createRun3D(el, {
          volume: () => Sound.volume,
          soundOn: () => Sound.enabled,
          onStart: async () => {
            Sound.unlock();
            setWon(null);
            ticket.current = false;
            try {
              const r = await api<{ seed: number }>('/api/games/run/start', {});
              ticket.current = true;
              return r.seed;
            } catch { return undefined; /* bieg bez nagrody */ }
          },
          onOver: async ({ log, ticks }) => {
            if (!ticket.current) return;
            ticket.current = false;
            try {
              const r = await api<{ reward: number; capped: boolean; card: WonCard | null; state: any }>('/api/games/run/finish', { log, ticks });   // serwer odtwarza bieg i sam liczy dystans
              applyState(r.state);
              setWon({ reward: r.reward, capped: r.capped, card: r.card });
              if (r.reward > 0) { Sound.coin(1); toast(`Super Turbo Run: +${fmt(r.reward)}`); }
              if (r.card) { syncInventory(); toast(`Super Turbo: karta ${r.card.name} w wariancie ${variantName(r.card.variant)}`); }
              refetchRef.current();
            } catch (e: any) { toast(e.message, true); }
          },
        });
      } catch { setFailed(true); }   // WebGL nie wystartował mimo wykrycia
    });
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
      <div className="tb-board" aria-label="Super Turbo Run 3D. Lewo i prawo: A i D albo strzałki, skok: spacja, pauza: P.">
        <div ref={root} className="tb-root" />
      </div>
      <aside className="tb-side">
        {won && (won.reward > 0 || won.capped || won.card) && (
          <div className="tb-reward">
            <Coins size={16} aria-hidden="true" />
            <span>{won.reward > 0 ? <>Nagroda za ostatni bieg: <b className="tb-won">+{fmt(won.reward)}</b></> : won.capped ? 'Osiągnięto dzienny limit nagród' : 'Nowa karta:'}
              {won.capped && won.reward > 0 && <><br /><small className="muted">Osiągnięto dzienny limit nagród</small></>}</span>
            {won.card && <span className="tb-card" onClick={() => openViewer(won.card!.person, won.card!.variant, won.card!.id)}><Card person={won.card.person} variant={won.card.variant} tilt={false} /></span>}
          </div>
        )}
        {rw && rw.per100m > 0 && rw.daily > 0 && (
          <div className="tb-reward">
            <Coins size={16} aria-hidden="true" />
            <span>Nagroda: <b>{fmt(rw.per100m)}</b> {`za każde 100 m od ${fmt(rw.minDist)} m, najwyżej ${fmt(rw.perGame)} za bieg`}<br />
              <small className="muted">{`Dziś: ${fmt(rw.today)} / ${fmt(rw.daily)}`}</small></span>
          </div>
        )}
        {rw && rw.cardTiers?.length > 0 && (
          <div className="tb-reward">
            <Coins size={16} aria-hidden="true" />
            <span>Karta w wariancie {variantName(rw.cardVariant)} za dystans: {rw.cardTiers.map(t => `${fmt(t.score)} m: ${t.name}`).join(', ')}, bez limitu.</span>
          </div>
        )}
        <div className="tb-help">
          <h3>Sterowanie</h3>
          <p><kbd>A</kbd> <kbd>D</kbd> albo <kbd>←</kbd> <kbd>→</kbd> bieg po ścianach tunelu, <kbd>Spacja</kbd> skok (przytrzymaj, żeby skoczyć wyżej), <kbd>P</kbd> pauza, <kbd>M</kbd> dźwięk, <kbd>F</kbd> pełny ekran</p>
          <p className="muted small">Na telefonie użyj przycisków na ekranie gry.</p>
          <h3>Zasady</h3>
          <ul>
            <li>Biegnij po kaflach tunelu, omijaj dziury i przeszkody, zbieraj kryształy i nabijaj combo.</li>
            <li>Zielone płyty wyrzucają w górę, żółte uruchamiają turbo, które rozbija przeszkody.</li>
            <li>Każda kolejna strefa jest szybsza. Zderzenie albo spadnięcie w pustkę kończy bieg.</li>
          </ul>
          <p className="muted small">Rekord (w punktach) zapisuje się tylko w tej przeglądarce. Grosze płaci się za przebiegnięty dystans.</p>
        </div>
      </aside>
    </div>
  );
}
