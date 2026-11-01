import { memo, useCallback, useRef, type PointerEvent } from 'react';
import { cardHTML } from './cardHtml';

interface Props {
  person: string;
  variant?: string;
  uid?: number | null;
  tilt?: boolean;
  className?: string;
}

// Przechył karty za kursorem: te same zmienne CSS (--rx, --ry, --mx, --my), których używają warstwy połysku
function useTilt(enabled: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const move = useCallback((e: PointerEvent) => {
    const el = box.current?.firstElementChild as HTMLElement | null;
    if (!enabled || !el || e.pointerType === 'touch') return;
    const b = el.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    el.classList.add('tilting');
    el.style.setProperty('--ry', `${(x - .5) * 16}deg`);
    el.style.setProperty('--rx', `${(.5 - y) * 16}deg`);
    el.style.setProperty('--mx', `${x * 100}%`);
    el.style.setProperty('--my', `${y * 100}%`);
  }, [enabled]);
  const leave = useCallback(() => {
    const el = box.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    el.classList.remove('tilting');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }, []);
  return { box, move, leave };
}

/** Karta gry. HTML powstaje raz dla danej karty i wariantu, bo warstwy wariantów mają losowe ozdoby. */
export const Card = memo(function Card({ person, variant = 'normal', uid = null, tilt = true, className }: Props) {
  const { box, move, leave } = useTilt(tilt);
  const html = cardHTML(person, variant, uid);
  return <div ref={box} className={className} onPointerMove={move} onPointerLeave={leave} dangerouslySetInnerHTML={{ __html: html }} />;
});
