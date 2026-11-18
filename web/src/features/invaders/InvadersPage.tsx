import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Coins, Crosshair, Flag, Pause, Play } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { LiveSeeds, startLive } from '../games/liveSeeds';
import { SEG } from './core';
import { applyState } from '../../game/session';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import { GameRanking } from '../chess/GameRanking';
import { toast } from '../../ui/Toaster';
import { createInvaders, FIRE, LEFT, RIGHT, type InvadersGame, type InvHud } from './engine';
import { invSound } from './sfx';
import './invaders.css';

// Zakładka Gry -> Obrona Orbity: strzelanka na płótnie (engine.ts, rdzeń core.ts). Grosze płaci serwer: daje ziarno na start,
// po grze dostaje zapis klawiszy, sam odtwarza grę (invaders_sim.rs) i liczy punkty (routes/arcade.rs). Rekord w przeglądarce.
/** liczba punktów (fmt dopisuje grosze) */
export const pts = (n: number) => n.toLocaleString('pl-PL');

export interface ArcadeReward { per: number; unit: number; min: number; perGame: number; daily: number; today: number }

const KEYS: Record<string, number> = { ArrowLeft: LEFT, ArrowRight: RIGHT, a: LEFT, d: RIGHT, A: LEFT, D: RIGHT, ' ': FIRE, ArrowUp: FIRE, w: FIRE, W: FIRE };

export function InvadersPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<InvadersGame | null>(null);
  const ticket = useRef<LiveSeeds | null>(null);   // serwer przyjął start gry: po końcu prosimy o nagrodę
  const [hud, setHud] = useState<InvHud | null>(null);
  const [won, setWon] = useState<{ reward: number; capped: boolean; score: number } | null>(null);
  const { data: look, refetch } = useQuery({ queryKey: ['invaders-reward'], queryFn: () => api<{ reward: ArcadeReward }>('/api/games/arcade/invaders'), staleTime: 60_000 });

  useEffect(() => {
    const g = createInvaders(canvas.current!, setHud, {
      sound: invSound,
      over: async run => {
        invSound('over');
        const live = ticket.current;
        ticket.current = null;
        if (!live) return;
        try {
          // serwer odtwarza grę z ziaren i zapisu klawiszy (część zatwierdził już w trakcie gry), sam liczy punkty
          const rest = await live.rest(run.log);
          if (!rest) return toast('Obrona Orbity: połączenie z serwerem przerwane - ta gra jest bez nagrody', true);
          const r = await api<{ score: number; reward: number; capped: boolean; state: any }>('/api/games/arcade/invaders/finish', { log: rest, ticks: run.ticks });
          applyState(r.state);
          setWon({ reward: r.reward, capped: r.capped, score: r.score });
          if (r.reward > 0) { Sound.coin(1); toast(`Obrona Orbity: +${fmt(r.reward)}`); }
          refetch();
        } catch (e: any) { toast(e.message, true); }
      },
    });
    game.current = g;
    if (import.meta.env.DEV) (window as any).__inv = g;   // podgląd gry w testach (tylko npm run dev)
    const modal = () => document.querySelector('[aria-modal="true"]');
    const key = (down: boolean) => (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, textarea, select, [contenteditable]') || modal()) return;
      const bit = KEYS[e.key];
      if (bit && g.phase === 'play') { e.preventDefault(); g.setKey(bit, down); return; }
      if (!down) return;
      if (e.key === 'Enter' && !el?.closest('button') && g.phase !== 'play') { e.preventDefault(); if (g.phase === 'pause') g.pause(); else start(); }
      if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && (g.phase === 'play' || g.phase === 'pause')) { e.preventDefault(); g.pause(); }
    };
    const kd = key(true), ku = key(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    // wyjście z karty przeglądarki albo okienko gry nad planszą = pauza (i puszczone klawisze)
    const stop = () => { if (g.phase === 'play') g.pause(); [LEFT, RIGHT, FIRE].forEach(b => g.setKey(b, false)); };
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', stop);
    const watch = setInterval(() => { if (g.phase === 'play' && modal()) stop(); }, 250);
    return () => {
      clearInterval(watch);
      g.destroy(); game.current = null;
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);

  // gra zaczyna się dopiero z ziarnem od serwera (bez niego - losowe ziarno i gra bez nagrody)
  const start = async () => {
    Sound.unlock(); invSound('start');
    setWon(null);
    ticket.current = null;
    const { live } = await startLive('/api/games/arcade/invaders/start', {}, '/api/games/arcade/invaders/commit', SEG);
    if (live.online) ticket.current = live; else toast('Gra bez nagrody: serwer nie przyjął startu', true);
    game.current?.start(live); canvas.current?.focus();
  };

  // przyciski dotykowe: trzymanie = wciśnięty klawisz
  const hold = (bit: number) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); game.current?.setKey(bit, true); },
    onPointerUp: () => game.current?.setKey(bit, false),
    onPointerCancel: () => game.current?.setKey(bit, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const rw = look?.reward;
  const phase = hud?.phase ?? 'idle';
  return (
    <div className="iv-page">
      <div className="iv-board">
        <canvas ref={canvas} className="iv-canvas" tabIndex={0} aria-label="Plansza gry Obrona Orbity. Ruch: strzałki albo A i D, strzał: spacja, pauza: P." />
        {phase !== 'play' && (
          <div className="iv-over">
            {phase === 'over' && <><b>Koniec gry</b><span>Wynik: {hud!.score} · fala {hud!.wave}{hud!.record ? ' · nowy rekord!' : ''}</span>
              {won && won.reward > 0 && <span className="iv-won">+{fmt(won.reward)}</span>}
              {won?.capped && <span>Osiągnięto limit nagród</span>}</>}
            {phase === 'pause' && <b>Pauza</b>}
            {phase === 'idle' && <><b>Obrona Orbity</b><span>Zatrzymaj flotę najeźdźców, zanim dotrze do linii obrony.</span></>}
            <Button kind="hue" onClick={phase === 'pause' ? () => game.current?.pause() : start}>
              <Play size={16} aria-hidden="true" /> {phase === 'pause' ? 'Wznów' : phase === 'over' ? 'Zagraj jeszcze raz' : 'Zagraj'}
            </Button>
          </div>
        )}
      </div>

      <aside className="iv-side">
        <div className="iv-score" role="status" aria-live="polite">
          <div><span>Wynik</span><b>{hud?.score ?? 0}</b></div>
          <div><span>Życia</span><b>{hud?.lives ?? 3}</b></div>
          <div><span>Fala</span><b>{hud?.wave ?? 1}</b></div>
          <div><span>Rekord</span><b>{hud?.best ?? 0}</b></div>
        </div>
        {(phase === 'play' || phase === 'pause') && (
          <div className="iv-btns">
            <Button onClick={() => game.current?.pause()}>{phase === 'pause' ? <><Play size={16} aria-hidden="true" /> Wznów</> : <><Pause size={16} aria-hidden="true" /> Pauza</>}</Button>
            <Button onClick={() => { if (confirm('Zakończyć grę? Zdobyte punkty się liczą.')) game.current?.quit(); }}><Flag size={16} aria-hidden="true" /> Zakończ</Button>
          </div>
        )}
        {rw && rw.per > 0 && rw.daily > 0 && (
          <div className="iv-reward">
            <Coins size={16} aria-hidden="true" />
            <span>Nagroda: <b>{fmt(rw.per)}</b> {`za każde ${pts(rw.unit)} pkt od ${pts(rw.min)} pkt, najwyżej ${fmt(rw.perGame)} za grę`}<br />
              <small className="muted">{`Dziś: ${fmt(rw.today)} / ${fmt(rw.daily)}`}</small></span>
          </div>
        )}
        <GameRanking game="invaders" title="Ranking Obrony Orbity: punkty" refresh={won} />
        <div className="iv-pad" aria-label="Sterowanie dotykowe">
          <button type="button" aria-label="W lewo" {...hold(LEFT)}><ArrowLeft size={22} /></button>
          <button type="button" className="fire" aria-label="Strzał" {...hold(FIRE)}><Crosshair size={22} /></button>
          <button type="button" aria-label="W prawo" {...hold(RIGHT)}><ArrowRight size={22} /></button>
        </div>
        <div className="iv-help">
          <h3>Sterowanie</h3>
          <p><kbd>←</kbd> <kbd>→</kbd> albo <kbd>A</kbd> <kbd>D</kbd> ruch, <kbd>Spacja</kbd> strzał (można trzymać), <kbd>P</kbd> pauza</p>
          <h3>Zasady</h3>
          <ul>
            <li>Na raz leci tylko jeden twój pocisk, więc celuj. Zielone osłony chronią, ale się kruszą.</li>
            <li>Górny rząd: 30 pkt, środkowe: 20, dolne: 10. Złoty satelita przelatujący górą: 50-300 pkt.</li>
            <li>Im mniej najeźdźców, tym szybciej maszerują. Każda fala zaczyna niżej. Za 1500 pkt dostajesz dodatkowe życie.</li>
            <li>Gra kończy się, gdy stracisz wszystkie życia albo flota dotrze do linii obrony.</li>
          </ul>
          <p className="muted small">Punkty liczy serwer, odtwarzając twoją grę. Rekord zapisuje się tylko w tej przeglądarce.</p>
        </div>
      </aside>
    </div>
  );
}
