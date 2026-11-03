import { useEffect, useRef } from 'react';
import styles from './Ambient.module.css';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tło całej gry: ciemna gablota, w której pod szkłem wolno przepływa światło w kolorze skrzynki (--hue),
 *  a w powietrzu unosi się kurz. Warstwy CSS robią poświatę, siatkę i ziarno; płótno rysuje tylko drobinki. */
export function Ambient() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current!, x = cv.getContext('2d');
    if (!x) return;
    let W = 0, H = 0, raf = 0, hue = '#e0264a', last = performance.now(), hueAt = 0;
    const N = innerWidth < 700 ? 26 : 52;
    const motes = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), r: .5 + Math.random() * 1.6, v: .004 + Math.random() * .012, d: Math.random() * 6.3, tw: Math.random() * 6.3, warm: Math.random() < .4 }));
    const resize = () => {
      const k = Math.min(devicePixelRatio, 1.5);
      W = innerWidth; H = innerHeight;
      cv.width = W * k; cv.height = H * k;
      x.setTransform(k, 0, 0, k, 0, 0);
    };
    resize();
    addEventListener('resize', resize);
    const draw = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      if (now - hueAt > 1000) { hueAt = now; hue = getComputedStyle(document.documentElement).getPropertyValue('--hue').trim() || hue; }
      x.clearRect(0, 0, W, H);
      const t = now / 1000;
      for (const m of motes) {
        m.y -= m.v * dt; m.x += Math.sin(t * .3 + m.d) * .0006;
        if (m.y < -.02) { m.y = 1.02; m.x = Math.random(); }
        const a = (.18 + .32 * (.5 + .5 * Math.sin(t * 1.3 + m.tw))) * Math.min(1, m.y * 3);
        x.globalAlpha = a;
        x.fillStyle = m.warm ? hue : '#ffffff';
        x.beginPath(); x.arc(m.x * W, m.y * H, m.r, 0, 6.283); x.fill();
      }
      x.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    // przy ograniczonym ruchu drobinki rysujemy raz i stoją
    const start = () => {
      cancelAnimationFrame(raf);
      if (document.hidden) return;
      last = performance.now();
      if (reduced()) { draw(last); cancelAnimationFrame(raf); } else raf = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', start);
    start();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); document.removeEventListener('visibilitychange', start); };
  }, []);
  return (
    <div className={styles.ambient} aria-hidden="true">
      <i className={styles.glowA} />
      <i className={styles.glowB} />
      <i className={styles.glowC} />
      <i className={styles.grid} />
      <canvas ref={canvas} className={styles.motes} />
      <i className={styles.grain} />
    </div>
  );
}
