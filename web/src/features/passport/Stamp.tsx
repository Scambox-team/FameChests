import { useId, type CSSProperties } from 'react';
import { lang } from '../../i18n/i18n';
import { SYMBOLS } from './symbols';
import COUNTRIES from './countries.json';

/** Wiersz tabeli państw (countries.json): kod ISO, nazwy, kontynent, kolor pieczątki, symbol (klucz z symbols.ts), skrót nazwy na pieczątce */
export interface Country { c: string; pl: string; en: string; k: string; col: string; sym: string; s?: string; /** adres własnej ikony z panelu admina (zastępuje symbol) */ icon?: string }

export const ALL_COUNTRIES = COUNTRIES as Country[];
export const BY_CODE: Record<string, Country> = Object.fromEntries(ALL_COUNTRIES.map(c => [c.c, c]));

/** Nazwa państwa w języku gry (kod i dane są po polsku, angielski jest w tabeli) */
export const countryName = (c: Country) => lang === 'en' ? c.en : c.pl;

function hash(code: string) {
  let h = 7;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Podział nazwy na najwyżej dwa wiersze (po spacji najbliżej środka) */
function lines(name: string): string[] {
  if (name.length <= 13 || !name.includes(' ')) return [name];
  const mid = name.length / 2;
  let best = -1;
  for (let i = 0; i < name.length; i++) if (name[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return [name.slice(0, best), name.slice(best + 1)];
}

const fit = (text: string, max: number, size: number) => Math.max(4.6, Math.min(size, max / (text.length * 0.62)));

/** Wspólne definicje (maska „wyblakłego tuszu”), raz na stronę; stemple odwołują się do nich przez url(#...) */
export function StampDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <pattern id="pspSpeck" width="31" height="27" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="6" r="1.1" fill="#000" /><circle cx="19" cy="3" r=".7" fill="#000" /><circle cx="26" cy="13" r="1.3" fill="#000" />
          <circle cx="11" cy="17" r=".8" fill="#000" /><circle cx="22" cy="23" r="1" fill="#000" /><circle cx="3" cy="24" r=".6" fill="#000" />
          <path d="M8 10 l5 1.4 M15 24 l4 -1" stroke="#000" strokeWidth=".7" />
        </pattern>
        <mask id="pspInk" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <rect width="100" height="100" fill="url(#pspSpeck)" opacity=".85" />
        </mask>
      </defs>
    </svg>
  );
}

/** Pieczątka państwa rysowana z danych: obrys (koło, owal albo koło z kropkowanym pierścieniem - zależnie od kodu), kod ISO,
 *  symbol z Lucide (albo własna ikona z panelu admina, barwiona kolorem stempla), nazwa. Zdobyta jest w kolorze państwa i lekko
 *  przekrzywiona jak odbita (z wyblakłym tuszem), niezdobyta to prosta szara sylwetka (kolor ustawia CSS strony). */
export function Stamp({ country, earned, className }: { country: Country; earned: boolean; className?: string }) {
  const h = hash(country.c);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const shape = h % 3;
  const tilt = ((h >> 3) % 17) - 8;
  const Icon = SYMBOLS[country.sym];
  const name = (lang === 'en' ? country.en : country.s ?? country.pl).toLocaleUpperCase(lang);
  const rows = lines(name);
  const rx = shape === 1 ? 48 : 47, ry = shape === 1 ? 43 : 47;
  const ink = earned ? { color: `color-mix(in srgb, ${country.col}, var(--stamp-mix, #fff) var(--stamp-pct, 26%))` } : undefined;
  return (
    <svg className={className} viewBox="0 0 100 100" role="img" aria-label={countryName(country)} style={ink as CSSProperties}>
      <g transform={earned ? `rotate(${tilt} 50 50)` : undefined} mask={earned ? 'url(#pspInk)' : undefined} fill="none" stroke="currentColor">
        {shape === 1 ? <ellipse cx="50" cy="50" rx={rx} ry={ry} strokeWidth="3" /> : <circle cx="50" cy="50" r={rx} strokeWidth="3" strokeDasharray={shape === 2 ? '.1 3.9' : undefined} strokeLinecap="round" />}
        {shape === 2 && <circle cx="50" cy="50" r="44" strokeWidth="1.2" />}
        {shape === 2 ? <circle cx="50" cy="50" r="40.5" strokeWidth=".8" /> : <ellipse cx="50" cy="50" rx={rx - 5} ry={ry - 5} strokeWidth="1.1" strokeDasharray={shape === 0 ? undefined : '2.4 1.6'} />}
        <text x="50" y="21" textAnchor="middle" fill="currentColor" stroke="none" fontSize="7.4" fontWeight="800" letterSpacing="1.6" fontFamily="var(--body)">{country.c}</text>
        {country.icon ? (
          <>
            <mask id={`pi${uid}`} maskUnits="userSpaceOnUse" x="35" y="25" width="30" height="30"><image href={country.icon} x="35" y="25" width="30" height="30" /></mask>
            <rect x="35" y="25" width="30" height="30" fill="currentColor" stroke="none" mask={`url(#pi${uid})`} />
          </>
        ) : Icon && <Icon x={35} y={25} width={30} height={30} strokeWidth={1.7} />}
        <path d="M13 61.5H87" strokeWidth="1" />
        {rows.map((r, i) => {
          const y = rows.length === 1 ? 76 : 71.5 + i * 9.4;
          const max = rows.length === 1 ? 58 : i === 0 ? 58 : 50;
          return <text key={i} x="50" y={y} textAnchor="middle" fill="currentColor" stroke="none" fontSize={fit(r, max, 9.6)} fontWeight="800" letterSpacing=".4" fontFamily="var(--body)">{r}</text>;
        })}
      </g>
    </svg>
  );
}
