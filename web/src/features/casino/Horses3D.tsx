import { useEffect, useRef, useState } from 'react';
import { Eye, Ghost, Map as MapIcon, Skull, Tv, Video } from 'lucide-react';
import { S } from '../../game/store';
import type { HorseCam, HorsesHud } from '../../three/horsesScene';
import { HR, hrCarX, hrClock, hrFinishTime, hrHorses, hrHorseState, hrInterp } from './horsesEngine';

const CAMS: { id: HorseCam; label: string; icon: typeof Tv }[] = [
  { id: 'tv', label: 'Realizacja', icon: Tv },
  { id: 'chase', label: 'Za koniem', icon: Video },
  { id: 'fpv', label: 'Oczami konia', icon: Eye },
  { id: 'top', label: 'Z góry', icon: MapIcon }
];

/** Wyścig w 3D (Three.js wczytuje się dopiero tutaj). Odtwarza ten sam wyścig co płótno 2D, które dalej liczy zdarzenia i dźwięki. */
export function Horses3D({ onFail }: { onFail: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<{ setCam(m: HorseCam, f?: number): void; hud(): HorsesHud; destroy(): void } | null>(null);
  const [hud, setHud] = useState<HorsesHud | null>(null);
  const [mode, setMode] = useState<HorseCam>(HR.cam3d ?? 'tv');
  const [focus, setFocus] = useState<number>(HR.horse ?? 0);
  const H = hrHorses();

  useEffect(() => {
    let alive = true;
    import('../../three/horsesScene').then(({ createHorsesScene }) => {
      if (!alive || !canvas.current) return;
      try {
        scene.current = createHorsesScene(canvas.current, {
          horses: H.map((h: any) => ({ id: h.id, name: h.name, color: h.color })),
          clock: () => { const c = hrClock(); return { race: c.race, T: c.T, solo: c.solo }; },
          interp: hrInterp, state: hrHorseState, carX: hrCarX, finish: hrFinishTime,
          boxRows: () => S.cfg.horses.race.boxRows,
          itemIcon: it => S.cfg.horses.items[it]?.icon ?? '❓',
          info: () => HR.info ?? null
        });
        scene.current.setCam(mode, focus);
      } catch { onFail(); }
    }).catch(onFail);
    const t = setInterval(() => { if (scene.current) setHud({ ...scene.current.hud() }); }, 120);
    return () => { alive = false; clearInterval(t); scene.current?.destroy(); scene.current = null; };
  }, []);

  const pick = (m: HorseCam, f = focus) => { setMode(m); setFocus(f); HR.cam3d = m; scene.current?.setCam(m, f); };
  const needsHorse = mode === 'chase' || mode === 'fpv';
  const info = HR.info;
  return (
    <div className={`hr3${needsHorse ? ' close' : ''}`}>
      <canvas ref={canvas} aria-label="Wyścig konny 3D" />
      <i className="hr3-speed" style={{ opacity: hud?.fx ?? 0 }} />
      <i className="hr3-flash" style={{ opacity: (hud?.flash ?? 0) * .7 }} />
      {mode === 'fpv' && <i className="hr3-vignette" />}
      <div className="hr3-cams" role="group" aria-label="Kamera">
        {CAMS.map(({ id, label, icon: I }) => <button key={id} type="button" className={mode === id ? 'on' : ''} aria-pressed={mode === id} onClick={() => pick(id)}><I size={15} aria-hidden="true" />{label}</button>)}
      </div>
      {needsHorse && <div className="hr3-pick" role="group" aria-label="Koń">
        {H.map((h: any) => <button key={h.id} type="button" className={focus === h.id ? 'on' : ''} style={{ '--c': h.color } as React.CSSProperties} title={h.name} aria-label={h.name} aria-pressed={focus === h.id} onClick={() => pick(mode, h.id)}>{h.id + 1}</button>)}
      </div>}
      {hud && <ol className="hr3-order" aria-label="Kolejność">
        {hud.order.map((o, i) => { const h = H[o.id]; return <li key={o.id} className={o.out ? 'out' : ''}><b>{i + 1}</b><i style={{ background: h.color }}>{h.id + 1}</i><span>{h.name}</span>{o.out === 'dead' && <Skull size={12} aria-label="padł" />}{o.out === 'left' && <Ghost size={12} aria-label="uciekł" />}</li>; })}
      </ol>}
      {info && <div className="hr3-banner"><small>{info.top}</small>{info.big && <b style={{ color: info.color }}>{info.big}</b>}</div>}
      {needsHorse && hud && <div className="hr3-speedo"><b>{hud.speed}</b><small>km/h</small><span>{H[focus]?.name}</span></div>}
    </div>
  );
}
