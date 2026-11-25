// Arena: wspólne typy i opisy umiejętności (podgląd karty, plansza, panel admina). Zasady liczy serwer (server/src/arena).

export interface Ability {
  name: string;
  kind: 'attack' | 'shield' | 'heal' | 'eco' | 'special' | string;
  mode: string;
  power: number;
  area: boolean;
  count: number;
  aim: boolean;
  turns: number;
  cost: number;
  from: string;
}

export interface ArenaCardStats {
  id: string;
  atk: number;
  hp: number;
  class: string | null;
  spec: string | null;
  range: [number, number];
  points: number;
  abilities: Ability[];
  traits?: { trait: string; value: string }[];
}

export const KIND_NAMES: Record<string, string> = { attack: 'Atak', shield: 'Tarcza', heal: 'Leczenie', eco: 'Ekonomiczna', special: 'Specjalna' };

/** Zasięg: „1-3” albo „tylko 2” */
export function rangeText([lo, hi]: [number, number]) {
  return lo === hi ? `tylko ${lo}` : `${lo}-${hi}`;
}

const many = (a: Ability) => a.area ? (a.count > 0 ? `do ${a.count} kart` : 'wszystkie karty') : 'jedna karta';
const how = (a: Ability) => a.aim ? 'wybrany cel' : 'losowo';

/** Opis umiejętności dla gracza */
export function abilityText(a: Ability, atk?: number, specials?: { id: string; name: string; desc: string }[]) {
  const cost = a.cost > 0 ? ` Koszt: ${a.cost}.` : '';
  if (a.kind === 'special') {
    const s = specials?.find(x => x.id === a.mode);
    return s ? s.desc : 'Działa sama.';
  }
  if (a.kind === 'attack') {
    const dmg = atk != null ? `${Math.round(atk * a.power / 100)} obrażeń` : `${a.power}% ataku`;
    if (a.mode === 'poison') return `Trucizna: ${dmg} na turę przez ${a.turns} tur (${many(a)}, ${how(a)}).${cost}`;
    return `${dmg[0].toUpperCase()}${dmg.slice(1)} (${many(a)}, ${how(a)}).${cost}`;
  }
  if (a.kind === 'shield') return `Tarcza ${a.power} na ${a.turns} tur dla twoich kart (${many(a)}, ${how(a)}).${cost}`;
  if (a.kind === 'heal') {
    if (a.mode === 'regen') return `Leczy ${a.power} HP na turę przez ${a.turns} tur (${many(a)}, ${how(a)}).${cost}`;
    if (a.mode === 'drain') return `Zabiera do ${a.power} HP ${a.from === 'ally' ? 'innej twojej karcie' : 'karcie rywala w zasięgu'} i daje je twojej karcie (${how(a)}).${cost}`;
    return `Leczy ${a.power} HP (${many(a)}, ${how(a)}).${cost}`;
  }
  if (a.kind === 'eco') {
    if (a.mode === 'income') return `+${a.power} pieniędzy na turę przez ${a.turns} tur.${cost}`;
    if (a.mode === 'steal') return `Zabiera rywalowi do ${a.power} pieniędzy.${cost}`;
    return `+${a.power} pieniędzy w meczu.${cost}`;
  }
  return '';
}
