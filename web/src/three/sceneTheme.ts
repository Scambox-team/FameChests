// Motyw interfejsu (Warm Editorial / Frutiger Aero) przebarwia też sceny 3D: światło, otoczenie, materiały skrzynek,
// podłogę i tło. Motyw wybiera się w Ustawieniach, a zmiana któregokolwiek z tych dwóch motywów przeładowuje stronę,
// więc sceny czytają go raz przy tworzeniu (ikony skrzynek są w pamięci tylko do przeładowania).
import { getTheme } from '../styles/theme';

export interface CrateMats {
  body: { roughness: number; metalness: number; clearcoat?: number; clearcoatRoughness?: number };
  lid: { roughness: number; metalness: number; clearcoat?: number; clearcoatRoughness?: number };
  trim: { color: string; roughness: number; metalness: number };
}
export interface SceneTheme {
  id: 'default' | 'warm' | 'aero' | 'vapor';
  /** ekspozycja sceny skrzynek */
  exposure: number;
  /** tło i panele światła, które odbijają się w metalu */
  envBg: string;
  envPanels: [number, number, number, number, string][];
  envIntensity: number;
  key: { color: string; intensity: number };
  rim: { intensity: number };
  /** cień pod skrzynką */
  shadow: { color: string; opacity: number };
  /** kamienne stopnie piramidy */
  step: { color: string; roughness: number; metalness: number };
  mats: CrateMats;
  /** unoszące się bańki w scenie sklepu (Frutiger Aero) */
  bubbles: boolean;
  /** podłoga i tło scen kasyna i odsłonięcia */
  floor: string;
  /** kolor sukna ruletki: [środek, pośredni, brzeg] */
  felt: [string, string, string];
  /** drewno ruletki: [ciemne, jasne] ([jasny kolor, ciemny kolor] każdego) */
  wood: [[string, string], [string, string]];
  /** złoto okuć ruletki i automatu */
  metal: string;
  /** chrom automatu */
  chrome: string;
  /** niebo i mgła wyścigów */
  sky: string;
  /** zieleń toru wyścigów */
  turf: string;
}

const DEFAULT: SceneTheme = {
  id: 'default', exposure: 1.1,
  envBg: '#15161a', envPanels: [[0, 6, 2, 8, '#ffffff'], [-6, 1, 3, 3, '#ffffff'], [6, 2, -2, 4, '#8fa3c8']], envIntensity: .55,
  key: { color: '#ffffff', intensity: 2.4 }, rim: { intensity: 3 },
  shadow: { color: '#000000', opacity: .6 },
  step: { color: '#1b1b20', roughness: .85, metalness: .1 },
  mats: {
    body: { roughness: .62, metalness: .05 }, lid: { roughness: .5, metalness: .05 },
    trim: { color: '#3a3c43', roughness: .3, metalness: .92 }
  },
  bubbles: false, floor: '#0c0c10',
  felt: ['#163a29', '#0d2219', '#060f0b'], wood: [['#3b1a0d', '#120602'], ['#6b3a1e', '#2a1206']], metal: '#d8b15a', chrome: '#e8ecf2',
  sky: '#05060c', turf: '#08130b'
};

// Warm Editorial: papier, glina i mosiądz. Matowe skrzynki, ciepłe światło lampy, brązowe cienie.
const WARM: SceneTheme = {
  id: 'warm', exposure: 1.05,
  envBg: '#2a1b10', envPanels: [[0, 6, 2, 8, '#fff1dc'], [-6, 1, 3, 3, '#ffd7a8'], [6, 2, -2, 4, '#e9a96a']], envIntensity: .5,
  key: { color: '#ffe3c2', intensity: 2.5 }, rim: { intensity: 2.6 },
  shadow: { color: '#2b1a0d', opacity: .5 },
  step: { color: '#6a4a30', roughness: 1, metalness: 0 },
  mats: {
    body: { roughness: .86, metalness: 0 }, lid: { roughness: .8, metalness: 0 },
    trim: { color: '#c58a4a', roughness: .42, metalness: .6 }
  },
  bubbles: false, floor: '#1c120a',
  felt: ['#5a2b19', '#2f160c', '#1a0b06'], wood: [['#7a4a28', '#2a160a'], ['#b27a47', '#4a2a12']], metal: '#e0a458', chrome: '#e6c89a',
  sky: '#2b1a10', turf: '#3a2a14'
};

// Frutiger Aero: szkło, chrom, niebo. Błyszczący lakier, jasne otoczenie, bańki.
const AERO: SceneTheme = {
  id: 'aero', exposure: 1.08,
  envBg: '#8ecbf2', envPanels: [[0, 6, 2, 9, '#ffffff'], [-6, 1, 3, 4, '#c8f3ff'], [6, 2, -2, 5, '#e6fff0']], envIntensity: .7,
  key: { color: '#ffffff', intensity: 2.8 }, rim: { intensity: 3.4 },
  shadow: { color: '#0b4f7a', opacity: .35 },
  step: { color: '#a8dcf4', roughness: .18, metalness: .15 },
  mats: {
    body: { roughness: .16, metalness: .02, clearcoat: 1, clearcoatRoughness: .05 },
    lid: { roughness: .12, metalness: .02, clearcoat: 1, clearcoatRoughness: .04 },
    trim: { color: '#e4f4ff', roughness: .08, metalness: 1 }
  },
  bubbles: true, floor: '#6fb8e6',
  felt: ['#2a9ca0', '#13717f', '#0a4a5a'], wood: [['#c9e8f8', '#5aa6d0'], ['#e6f6ff', '#8cc6e6']], metal: '#f2f8ff', chrome: '#ffffff',
  sky: '#7ec8f2', turf: '#3fae5a'
};

// Vaporwave: neon na fioletowej nocy. Lakierowane skrzynki, różowo-błękitne światło i otoczenie, purpurowe sukno.
const VAPOR: SceneTheme = {
  id: 'vapor', exposure: 1.1,
  envBg: '#2a0a4a', envPanels: [[0, 6, 2, 8, '#ff71ce'], [-6, 1, 3, 4, '#01cdfe'], [6, 2, -2, 5, '#b967ff']], envIntensity: .85,
  key: { color: '#ffd9f5', intensity: 2.6 }, rim: { intensity: 3.4 },
  shadow: { color: '#12062a', opacity: .6 },
  step: { color: '#3a1a6a', roughness: .35, metalness: .2 },
  mats: {
    body: { roughness: .3, metalness: .1, clearcoat: .7, clearcoatRoughness: .1 },
    lid: { roughness: .25, metalness: .1, clearcoat: .8, clearcoatRoughness: .08 },
    trim: { color: '#ffb3f0', roughness: .15, metalness: 1 }
  },
  bubbles: false, floor: '#1a0b2e',
  // sukno granatowe, żeby ciemne, lakierowane koło ruletki i różowy tor wyraźnie się od niego odcinały; okucia w kolorze błękitnego neonu
  felt: ['#0f5aa8', '#08306b', '#04142e'], wood: [['#7a2ad0', '#25094f'], ['#ff71ce', '#7a2aa8']], metal: '#01e5ff', chrome: '#e0c8ff',
  sky: '#2a0a4e', turf: '#0e2a5a'
};

export function sceneTheme(): SceneTheme {
  const t = getTheme();
  return t === 'warm' ? WARM : t === 'aero' ? AERO : t === 'vapor' ? VAPOR : DEFAULT;
}
