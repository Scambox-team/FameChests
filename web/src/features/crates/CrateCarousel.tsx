import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, FlaskConical } from 'lucide-react';
import { S } from '../../game/store';
import type { Crate } from '../../game/types';
import { fmt } from '../../lib/format';
import { CrateArt } from './CrateArt';
import { crateHue } from './crateLook';
import styles from './CrateCarousel.module.css';

/** Karuzela skrzynek: wszystkie widać naraz, wybrana stoi na środku, pozostałe maleją w obie strony po łuku.
 *  Sama się nie obraca: skrzynkę zmienia tylko gracz (kliknięcie, strzałki, przeciągnięcie). */
export function CrateCarousel({ crates, active, onPick }: { crates: Crate[]; active: string; onPick: (c: Crate) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = crates.length, at = Math.max(0, crates.findIndex(c => c.id === active));
  const step = (d: number) => onPick(crates[(at + d + n) % n]);
  const half = Math.max(1, Math.floor(n / 2)), size = Math.min(230, W * .36);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  };
  // przeciągnięcie palcem albo myszą o ~60 px zmienia skrzynkę
  const drag = useRef<number | null>(null);

  return (
    <section className={styles.wrap} aria-label="Wybór skrzynki" aria-roledescription="karuzela" tabIndex={0} onKeyDown={onKey}
      onPointerDown={e => { drag.current = e.clientX; }}
      onPointerUp={e => { if (drag.current == null) return; const d = e.clientX - drag.current; drag.current = null; if (Math.abs(d) > 60) step(d < 0 ? 1 : -1); }}>
      <div ref={box} className={styles.track} style={{ '--size': `${size}px` } as React.CSSProperties}>
        {crates.map((c, i) => {
          // odległość od wybranej po okręgu: -half..half
          let d = i - at;
          if (d > n / 2) d -= n;
          if (d < -n / 2) d += n;
          // dalsze stoją ciaśniej i wyżej, jak na okręgu oglądanym lekko z góry
          const u = Math.min(1, Math.abs(d) / half), x = Math.sign(d) * (W / 2 - size * .32) * .8 * Math.pow(u, .78);
          const y = d === 0 ? 0 : -size * (.1 + .22 * u);
          const scale = d === 0 ? 1 : .64 - .3 * u, owned = S.chests[c.id] || 0;
          return (
            <button key={c.id} type="button" className={`${styles.item}${d === 0 ? ` ${styles.on}` : ''}`} aria-pressed={d === 0} aria-label={`${c.name}${owned ? `, masz ${owned}` : ''}`}
              tabIndex={-1} onClick={() => d && onPick(c)}
              style={{ '--th': crateHue(c).hue, transform: `translate(calc(-50% + ${x.toFixed(1)}px), ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`, zIndex: 100 - Math.abs(d), opacity: d === 0 ? 1 : 1 - u * .45 } as React.CSSProperties}>
              <CrateArt crate={c} className={styles.art} />
              {owned > 0 && <span className={styles.owned}>{owned}</span>}
              {c.test && <span className={styles.test}><FlaskConical size={13} aria-hidden="true" />Test</span>}
            </button>
          );
        })}
      </div>
      <div className={styles.bar}>
        <button type="button" className={styles.arrow} onClick={() => step(-1)} aria-label="Poprzednia skrzynka"><ChevronLeft size={22} /></button>
        <div className={styles.label} aria-live="polite">
          <b>{crates[at]?.name}</b>
          <span>{crates[at]?.test ? 'Tylko dla adminów, bez nagród' : `${crates[at]?.people.length} kart · ${fmt(crates[at]?.price ?? 0)}`}</span>
        </div>
        <button type="button" className={styles.arrow} onClick={() => step(1)} aria-label="Następna skrzynka"><ChevronRight size={22} /></button>
      </div>
      <div className={styles.dots} aria-hidden="true">{crates.map((c, i) => <i key={c.id} className={i === at ? styles.dotOn : ''} />)}</div>
    </section>
  );
}
