import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Crate } from '../../game/types';
import { crateIconPath } from '../../icons/crateIcons';
import { CrateArt } from './CrateArt';
import { crateHue } from './crateLook';
import { crate3d } from './opening';
import styles from './CratesPage.module.css';

interface Props {
  crate: Crate;
  hero: RefObject<HTMLElement | null>;
  onOpen: () => void;
  label: string;
  count: number;
}

/** Skrzynka 3D w panelu sklepu. Three.js wczytuje się dopiero tutaj; bez WebGL zostaje płaski rysunek.
 *  Model otwiera się dwuklikiem (pojedyncze kliknięcie łatwo zrobić przypadkiem), z klawiatury Enterem. */
export function CrateStage({ crate, hero, onOpen, label, count }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLButtonElement>(null);
  const [flat, setFlat] = useState(false);
  const current = useRef(crate);
  current.current = crate;
  const howMany = useRef(count);
  howMany.current = count;
  const lastClick = useRef(0);

  const look = (c: Crate) => ({ c1: c.color1, c2: c.color2, hue: crateHue(c).hue, d: crateIconPath(c.emoji) });

  useEffect(() => {
    let alive = true, destroy = () => {};
    import('../../three/crateScene').then(({ createCrateScene }) => {
      if (!alive || !canvas.current) return;
      try {
        const scene = createCrateScene(canvas.current);
        scene.setCrate(look(current.current));
        scene.setCount(howMany.current);
        crate3d.scene = scene;
        destroy = () => { crate3d.scene = null; scene.destroy(); };
      } catch { setFlat(true); }
    }).catch(() => setFlat(true));
    return () => { alive = false; destroy(); };
  }, []);

  useEffect(() => { crate3d.scene?.setCrate(look(crate)); }, [crate.id, crate.color1, crate.color2]);
  useEffect(() => { crate3d.scene?.setCount(count); }, [count]);

  const click = (e: React.MouseEvent) => {
    if (e.detail === 0) return onOpen();   // Enter albo spacja
    const now = performance.now();
    if (now - lastClick.current < 400) { lastClick.current = 0; onOpen(); } else lastClick.current = now;
  };

  useEffect(() => {
    const box = hero.current;
    if (!box) return;
    const move = (e: PointerEvent) => {
      const s = stage.current!.getBoundingClientRect();
      const nx = (e.clientX - s.left - s.width / 2) / s.width, ny = (e.clientY - s.top - s.height / 2) / s.height;
      crate3d.scene?.pointer(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)), stage.current!.contains(e.target as Node));
    };
    const leave = () => crate3d.scene?.pointer(0, 0, false);
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerleave', leave);
    return () => { box.removeEventListener('pointermove', move); box.removeEventListener('pointerleave', leave); };
  }, [hero]);

  return (
    <>
      {!flat && <canvas ref={canvas} className={styles.scene} aria-hidden="true" />}
      <button ref={stage} className={styles.stage} type="button" aria-label={label} title="Kliknij dwa razy, żeby otworzyć" onClick={click}>
        {flat && <CrateArt crate={crate} className={styles.flat} />}
      </button>
    </>
  );
}
