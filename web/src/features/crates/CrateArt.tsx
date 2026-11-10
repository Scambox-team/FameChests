import { crateIconPath } from '../../icons/crateIcons';
import type { Crate } from '../../game/types';
import type { CrateLook } from '../../three/crateModel';
import { useCrateIcon } from './crateIcon';
import { crateLook3d } from './crateLook';

/** Ikona skrzynki: obrazek modelu 3D, a dopóki go nie ma (albo bez WebGL) płaski rysunek */
export function CrateArt({ crate, className }: { crate: Crate; className?: string }) {
  const src = useCrateIcon(crateLook3d(crate));
  if (src) return <img className={className} src={src} alt="" draggable={false} />;
  return <FlatCrate c1={crate.color1} c2={crate.color2} d={crateIconPath(crate.emoji)} emoji={crate.emoji} className={className} />;
}

/** Ikona skrzynki z pieniędzmi z tego samego modelu */
export function MoneyChestArt({ look, className }: { look: CrateLook; className?: string }) {
  const src = useCrateIcon(look);
  if (src) return <img className={className} src={src} alt="" draggable={false} />;
  return <FlatCrate c1={look.c1} c2={look.c2} d={look.d} emoji={look.emoji} className={className} />;
}

function FlatCrate({ c1, c2, d, emoji, className }: { c1: string; c2: string; d: string; emoji?: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 100" aria-hidden="true">
      {/* elementy .fc-x rysują tylko motywy z własnymi ilustracjami 2D (Warm Editorial: naklejka, Frutiger Aero: szklana ikona) */}
      <ellipse className="fc-x fc-shadow" cx="60" cy="94" rx="48" ry="5" />
      <rect className="fc-body" x="10" y="38" width="100" height="54" rx="4" fill={c2} />
      <path className="fc-lid" d="M8 40 14 16q1-4 5-4h82q4 0 5 4l6 24z" fill={c1} />
      <rect x="10" y="40" width="100" height="4" fill="#00000033" />
      <rect className="fc-x fc-band" x="24" y="12" width="9" height="80" />
      <rect className="fc-x fc-band" x="87" y="12" width="9" height="80" />
      {/* art deco (Niepodległość): wachlarz z dołu, schodkowe narożniki, ramka i zygzak na wieku */}
      <path className="fc-x fc-deco" d="M60 91 28 52M60 91 38 47M60 91 49 45M60 91 60 44M60 91 71 45M60 91 82 47M60 91 92 52" />
      <path className="fc-x fc-deco" d="M14 89v-8h8v-8h8M106 89v-8h-8v-8h-8" />
      <rect className="fc-x fc-deco" x="14" y="42" width="92" height="46" />
      <path className="fc-x fc-deco" d="M16 30l7-7 7 7 7-7 7 7 7-7 7 7 7-7 7 7 7-7 7 7 7-7 7 7" />
      <circle className="fc-seal" cx="60" cy="63" r="17" fill={c1} />
      <polygon className="fc-x fc-octa" fill={c1} points="78.5,70.7 67.7,81.5 52.3,81.5 41.5,70.7 41.5,55.3 52.3,44.5 67.7,44.5 78.5,55.3" />
      {emoji ? <text x="60" y="64" textAnchor="middle" dominantBaseline="central" fontSize="20">{emoji}</text> : (
        <g transform="translate(48 51)" fill="none" stroke={c2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={d} />
        </g>
      )}
      <path className="fc-x fc-gloss" d="M11 40 16.5 18q1-3 4-3h79q3 0 4 3L109 40z" />
      <rect className="fc-x fc-gloss2" x="11" y="44" width="98" height="22" rx="3" />
    </svg>
  );
}
