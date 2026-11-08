import { useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { imgUrl, person } from '../../game/rules';
import { S, useGame } from '../../game/store';
import { Sound } from '../../sound/sound';
import { Button } from '../../ui/Button';
import type { FlappyHud, FlappyScene } from '../../three/flappyScene';
import { hasWebGL, setUser3DOff, use3D } from '../../three/support';
import './flappy.css';

// Zakładka Gry -> Flappy: leci wybrana karta z kolekcji (scena w three/flappyScene.ts). Rekord i wybór karty są w przeglądarce.
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* bez zapisu */ } };

export function FlappyPage() {
  const game = useGame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<FlappyScene | null>(null);
  const [hud, setHud] = useState<FlappyHud>({ phase: 'ready', score: 0, best: 0 });
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<number | null>(() => { const v = read('flappyCard'); return v ? +v : null; });
  const [best] = useState(() => +(read('flappyBest') || 0));

  const rank = (r: string) => S.cfg.rarityOrder.indexOf(r);
  const items = useMemo(() => [...game.items].sort((a, b) => rank(person(b.person).rarity) - rank(person(a.person).rarity)),
    [game.items]);  // eslint-disable-line react-hooks/exhaustive-deps
  const shown = items.filter(i => !q || person(i.person).name.toLowerCase().includes(q.toLowerCase())).slice(0, 80);
  const chosen = items.find(i => i.id === pick) ?? items[0] ?? null;
  const color = (pid: string) => S.cfg.rarities[person(pid).rarity]?.color ?? '#9aa3ad';

  const act = () => {
    Sound.unlock();
    if (hud.phase === 'over') scene.current?.reset(); else scene.current?.flap();
  };
  const actRef = useRef(act);
  actRef.current = act;

  useEffect(() => {
    if (!canvas.current || !chosen || !use3D()) return;
    const p = person(chosen.person);
    let top = best, alive = true;
    const cv = canvas.current;
    import('../../three/flappyScene').then(({ createFlappy }) => {
      if (!alive) return;
      scene.current = createFlappy(cv, { photo: imgUrl(chosen.person, chosen.variant), name: p.name, color: color(chosen.person) },
        h => { setHud(h); if (h.best > top) { top = h.best; write('flappyBest', String(top)); } },
        top, k => { if (k === 'flap') Sound.click(); });
    });
    return () => { alive = false; scene.current?.destroy(); scene.current = null; };
  }, [chosen?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.code === 'ArrowUp') && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault(); actRef.current();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  if (!use3D()) return (
    <div className="panel fl-off">
      <h3>Ta gra wymaga grafiki 3D</h3>
      <p className="muted">Grafika 3D jest wyłączona w ustawieniach (albo przeglądarka nie obsługuje WebGL).</p>
      {hasWebGL() && <Button kind="hue" onClick={() => { setUser3DOff(false); location.reload(); }}>Włącz grafikę 3D</Button>}
    </div>
  );
  if (!chosen) return <p className="muted">Nie masz jeszcze żadnej karty. Otwórz skrzynkę i wróć tu polatać.</p>;
  return (
    <div className="fl-page">
      <div className="fl-stage">
        <canvas ref={canvas} className="fl-canvas" tabIndex={0} onPointerDown={e => { e.preventDefault(); act(); }}
          aria-label="Flappy: kliknij, dotknij albo naciśnij spację, żeby skoczyć kartą między słupami." />
        <div className="fl-score" aria-live="polite">{hud.score}</div>
        {hud.phase !== 'play' && (
          <div className="fl-msg">
            <b>{hud.phase === 'over' ? 'Rozbita!' : 'Gotowy?'}</b>
            {hud.phase === 'over' ? 'Kliknij albo spacja: jeszcze raz' : 'Kliknij, dotknij albo spacja: skok'}
          </div>
        )}
      </div>
      <aside className="fl-side">
        <div className="fl-best"><span>Twój rekord</span><b>{Math.max(hud.best, best)}</b></div>
        <div className="fl-chosen" style={{ ['--c' as any]: color(chosen.person) }}>
          <img src={imgUrl(chosen.person, chosen.variant, true)} alt="" />
          <span><b>{person(chosen.person).name}</b><br /><span className="muted small">Ta karta leci.</span></span>
        </div>
        <Button kind="hue" onClick={act}><Play size={16} aria-hidden="true" /> {hud.phase === 'over' ? 'Zagraj jeszcze raz' : 'Skok'}</Button>
        <input className="input" placeholder="Szukaj karty…" value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj karty" />
        <div className="fl-pick">
          {shown.map(i => (
            <button key={i.id} className="fl-opt" style={{ ['--c' as any]: color(i.person) }} aria-pressed={i.id === chosen.id}
              title={person(i.person).name} onClick={() => { Sound.click(); setPick(i.id); write('flappyCard', String(i.id)); }}>
              <img src={imgUrl(i.person, i.variant, true)} alt={person(i.person).name} loading="lazy" />
            </button>
          ))}
        </div>
        <p className="muted small">Omijaj słupy. Każdy minięty to punkt. Rekord zapisuje się tylko w tej przeglądarce, bez nagród.</p>
      </aside>
    </div>
  );
}
