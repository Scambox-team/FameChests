import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Coins, Pause, Play } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { applyState } from '../../game/session';
import { fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { getTheme } from '../../styles/theme';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toaster';
import { createSnake, type Dir, type SnakeGame, type SnakeHud, type SnakeLook } from './engine';
import './snake.css';

// Zakładka Gry -> Snake: plansza na płótnie (engine.ts), wygląd z panelu admina (/api/games/snake), rekord w przeglądarce.
// Motywy Warm / Aero / Vapor mają własny wygląd planszy i węża (skins.ts), więc kolory, obrazki i dźwięki z panelu admina dotyczą tylko motywu domyślnego (i Y2K).
const THEME = getTheme();
const SKIN = THEME === 'warm' || THEME === 'aero' || THEME === 'vapor' ? THEME : null;
const KEYS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

export function SnakePage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<SnakeGame | null>(null);
  const [hud, setHud] = useState<SnakeHud | null>(null);
  const { data: look, refetch } = useQuery({ queryKey: ['snake-look'], queryFn: () => api<SnakeLook>('/api/games/snake'), staleTime: 60_000 });
  const [won, setWon] = useState<{ reward: number; capped: boolean } | null>(null);   // nagroda za ostatnią grę
  const sounds = useRef<HTMLAudioElement[]>([]);   // dźwięki jabłka od admina (gra losuje jeden)
  const ticket = useRef(false);   // serwer przyjął start gry: po końcu prosimy o nagrodę

  useEffect(() => {
    sounds.current = SKIN ? [] : (look?.sounds ?? []).map(s => { const a = new Audio(s.url); a.preload = 'auto'; return a; });
  }, [look?.sounds]);

  useEffect(() => {
    const eat = (n: number) => {
      const list = sounds.current;
      if (!list.length || !Sound.enabled) return Sound.snake('eat', n);
      const a = list[Math.floor(Math.random() * list.length)].cloneNode(true) as HTMLAudioElement;   // kopia: dźwięki mogą na siebie nachodzić
      a.volume = Math.max(0, Math.min(1, Sound.volume));
      a.play().catch(() => Sound.snake('eat', n));
    };
    const over = async (rec: boolean, score: number) => {
      Sound.snake('over');
      if (rec) Sound.snake('best');
      if (!ticket.current) return;
      ticket.current = false;
      try {
        const r = await api<{ reward: number; capped: boolean; state: any }>('/api/games/snake/finish', { score });
        applyState(r.state);
        setWon({ reward: r.reward, capped: r.capped });
        if (r.reward > 0) { Sound.coin(1); toast(`Snake: +${fmt(r.reward)}`); }
        refetch();
      } catch (e: any) { toast(e.message, true); }
    };
    const g = createSnake(canvas.current!, setHud, { eat, over, turn: () => Sound.snake('turn') });
    game.current = g;
    g.setSkin(SKIN);
    const modal = () => document.querySelector('[aria-modal="true"]');
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || modal()) return;
      const d = KEYS[e.key];
      if (d && g.phase === 'play') { e.preventDefault(); g.turn(d); return; }
      if (e.key === ' ' || e.key === 'Enter') {
        if (el.closest('button') && e.key === 'Enter') return;
        e.preventDefault();
        if (g.phase === 'play' || g.phase === 'pause') g.pause(); else start();
      }
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (g.phase === 'play') g.pause(); }
    };
    // przesunięcie palcem po planszy
    let touch: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { if (e.pointerType !== 'mouse') touch = { x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!touch) return;
      const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      g.turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      touch = { x: e.clientX, y: e.clientY };
    };
    const up = () => { touch = null; };
    const cv = canvas.current!;
    window.addEventListener('keydown', key);
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    // wyjście z karty przeglądarki = pauza
    const hide = () => { if (document.hidden && g.phase === 'play') g.pause(); };
    document.addEventListener('visibilitychange', hide);
    // okienko gry (codzienna skrzynka, osiągnięcie...) nad planszą = pauza
    const watch = setInterval(() => { if (g.phase === 'play' && modal()) g.pause(); }, 250);
    return () => {
      clearInterval(watch);
      g.destroy(); game.current = null;
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerup', up);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useEffect(() => { if (look && !SKIN) game.current?.setLook(look); }, [look]);

  const start = () => {
    Sound.unlock(); Sound.snake('start');
    setWon(null);
    ticket.current = false;
    api('/api/games/snake/start', {}).then(() => { ticket.current = true; }).catch(() => { /* gra bez nagrody */ });
    game.current?.start(); canvas.current?.focus();
  };
  const rw = look?.reward;
  const phase = hud?.phase ?? 'idle';
  const turn = (d: Dir) => game.current?.turn(d);

  return (
    <div className={`sn-page${SKIN ? ` sn-${SKIN}` : ''}`} style={look && !SKIN ? { ['--sn-color' as any]: look.color } : undefined}>
      <div className="sn-board">
        <canvas ref={canvas} className="sn-canvas" tabIndex={0} aria-label="Plansza gry Snake. Sterowanie strzałkami albo WASD, pauza: spacja." />
        {phase !== 'play' && (
          <div className="sn-over">
            {phase === 'over' && <><b>Koniec gry</b><span>Jabłka: {hud!.score}{hud!.record ? ' · nowy rekord!' : ''}</span>
              {won && won.reward > 0 && <span className="sn-won">+{fmt(won.reward)}</span>}
              {won?.capped && <span>Osiągnięto dzienny limit nagród</span>}</>}
            {phase === 'pause' && <b>Pauza</b>}
            {phase === 'idle' && <b>Snake</b>}
            <Button kind="hue" onClick={phase === 'pause' ? () => game.current?.pause() : start}>
              <Play size={16} aria-hidden="true" /> {phase === 'pause' ? 'Wznów' : phase === 'over' ? 'Zagraj jeszcze raz' : 'Zagraj'}
            </Button>
          </div>
        )}
      </div>

      <aside className="sn-side">
        <div className="sn-score" role="status" aria-live="polite">
          <div><span>Jabłka</span><b>{hud?.score ?? 0}</b></div>
          <div><span>Długość</span><b>{hud?.length ?? 3}</b></div>
          <div><span>Twój rekord</span><b>{hud?.best ?? 0}</b></div>
        </div>
        {(phase === 'play' || phase === 'pause') && (
          <Button onClick={() => game.current?.pause()}>{phase === 'pause' ? <><Play size={16} aria-hidden="true" /> Wznów</> : <><Pause size={16} aria-hidden="true" /> Pauza</>}</Button>
        )}
        {rw && rw.perApple > 0 && rw.daily > 0 && (
          <div className="sn-reward">
            <Coins size={16} aria-hidden="true" />
            <span>Nagroda: <b>{fmt(rw.perApple)}</b> {`za jabłko od ${rw.minScore} jabłek, najwyżej ${fmt(rw.perGame)} za grę`}<br />
              <small className="muted">{`Dziś: ${fmt(rw.today)} / ${fmt(rw.daily)}`}</small></span>
          </div>
        )}
        <div className="sn-pad" aria-label="Kierunek">
          <button type="button" className="u" aria-label="W górę" onClick={() => turn('up')}><ArrowUp size={20} /></button>
          <button type="button" className="l" aria-label="W lewo" onClick={() => turn('left')}><ArrowLeft size={20} /></button>
          <button type="button" className="r" aria-label="W prawo" onClick={() => turn('right')}><ArrowRight size={20} /></button>
          <button type="button" className="d" aria-label="W dół" onClick={() => turn('down')}><ArrowDown size={20} /></button>
        </div>
        <div className="sn-help">
          <h3>Sterowanie</h3>
          <p><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> albo <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>, pauza: <kbd>Spacja</kbd></p>
          <p className="muted small">Na telefonie przesuwaj palcem po planszy albo użyj przycisków pod nią.</p>
          <h3>Zasady</h3>
          <ul>
            <li>Zjadaj jabłka: każde wydłuża węża i daje punkty, a gra z czasem przyspiesza.</li>
            <li>Uderzenie w ścianę albo we własny ogon kończy grę.</li>
          </ul>
          <p className="muted small">Rekord zapisuje się tylko w tej przeglądarce.</p>
        </div>
      </aside>
    </div>
  );
}
