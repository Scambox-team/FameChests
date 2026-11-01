import { crateIconPath } from '../../icons/crateIcons';
import type { Crate } from '../../game/types';

/** Płaski rysunek skrzynki: kafelki i sytuacje, w których nie ma sceny 3D */
export function CrateArt({ crate, className }: { crate: Crate; className?: string }) {
  const { color1: c1, color2: c2 } = crate;
  return (
    <svg className={className} viewBox="0 0 120 100" aria-hidden="true">
      <rect x="10" y="38" width="100" height="54" rx="4" fill={c2} />
      <path d="M8 40 14 16q1-4 5-4h82q4 0 5 4l6 24z" fill={c1} />
      <rect x="10" y="40" width="100" height="4" fill="#00000033" />
      <circle cx="60" cy="63" r="17" fill={c1} />
      <g transform="translate(48 51)" fill="none" stroke={c2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={crateIconPath(crate.emoji)} />
      </g>
    </svg>
  );
}
