import { memo, useCallback, useRef, type PointerEvent } from 'react';
import { withReveal, type Reveal } from '../game/reveal';
import { cardHTML } from './cardHtml';
import { tiltMove, tiltLeave } from './tilt';

interface Props {
  person: string;
  variant?: string;
  uid?: number | null;
  tilt?: boolean;
  className?: string;
  reveal?: Reveal;
}

// Przechył karty za kursorem: te same zmienne CSS (--rx, --ry, --mx, --my), których używają warstwy połysku
function useTilt(enabled: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const move = useCallback((e: PointerEvent) => {
    if (enabled) tiltMove(box.current?.firstElementChild as HTMLElement | null, e);
  }, [enabled]);
  const leave = useCallback(() => tiltLeave(box.current?.firstElementChild as HTMLElement | null), []);
  return { box, move, leave };
}

/** Karta gry. HTML powstaje raz dla danej karty i wariantu, bo warstwy wariantów mają losowe ozdoby. */
export const Card = memo(function Card({ person, variant = 'normal', uid = null, tilt = true, className, reveal }: Props) {
  const { box, move, leave } = useTilt(tilt);
  const html = withReveal(reveal, () => cardHTML(person, variant, uid));
  return <div ref={box} className={className} onPointerMove={move} onPointerLeave={leave} dangerouslySetInnerHTML={{ __html: html }} />;
});
