// Poziomy Pinballa: układ stołu jako dane w levels.json (to samo ma serwer: server/src/pinball_sim.rs weryfikuje gry na tych danych).
// Silnik (core.ts) buduje z nich ściany, cele i dodatki.
// Wspólne dla wszystkich poziomów: górne tory, dolne łapy z prowadnicami, wyrzutnia po prawej, multiball (cele z lewej i prawej + słońce).
// Stół wyższy niż okno (H > 840) przewija się za kulką. Współrzędne: x 10..418 (oś symetrii 214), y w dół.

export type Pt = [number, number];
export type Palette = { cyan: string; pink: string; magenta: string; purple: string; yellow: string; orange: string; blue: string };

export type Spec = {
  id: number;
  name: string;                 // pokazywana na stole i na liście poziomów
  blurb: string;                // jedno zdanie na liście poziomów
  theme: 'neon' | 'space' | 'pizza' | 'carnival' | 'chaos';
  H: number;                    // wysokość stołu
  palette: Palette;
  title: string; tagline: string;   // napis na dolnej części stołu
  saucer: number;               // y tarczy multiballa (x = oś)
  bumpers: [number, number, number?, boolean?][];   // x, y, promień, drugi kolor
  drops: { labels: string; ys: number[] };          // cele z lewej (opadają)
  stands: { labels: string; ys: number[] };         // cele z prawej (zapalają się)
  lanes: string;                                    // 4 litery torów u góry
  walls?: number[][][];                             // dodatkowe łamane ściany
  posts?: number[][];                               // dodatkowe słupki x, y, r
  pads?: { a: Pt; b: Pt }[];                        // trampoliny: ściany, które mocno odbijają
  uppers?: { x: number; y: number; side: 'l' | 'r'; len?: number }[];   // dodatkowe łapy wyżej na stole
  portals?: { a: Pt; b: Pt }[];                     // teleporty (w obie strony)
  holes?: { x: number; y: number; pull?: number }[]; // czarne dziury: wciągają, wypluwają w losową stronę
  spinners?: { x: number; y: number; w: number }[];  // wiatraczki na torze: punkty za przelot
  movers?: { cx: number; cy: number; ax: number; ay?: number; period: number; phase?: number; r: number; skin: 'rock' | 'duck' | 'orb' }[];
  fans?: { x: number; y: number; w: number; h: number; fx: number; fy: number }[];   // strefy siły: wiatr, antygrawitacja
  sticky?: { x: number; y: number; w: number; h: number }[];                        // lepka maź: kulka zwalnia
  blades?: { x: number; y: number; len: number; w: number }[];                       // obracające się pałeczki
};

import data from './levels.json';

export const LEVELS = data as unknown as Spec[];
