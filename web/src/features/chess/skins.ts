// @ts-nocheck -- rysunki figur w SVG i bęben skiny, przeniesione ze starego chess-skins.js
// Figury i skiny. Wszystko w siatce 100 x 100. Zwykła figura = prosta sylwetka w kolorze strony (--f wypełnienie, --l obrys).
// Skin rysuje własny kształt i kolory, a stronę zawsze pokazuje podstawka .pc-plate, dokładana na końcu przez skinSvg.
import { api } from '../../api/client';
import { crateOf, rarityIdx } from '../../game/rules';
import { S } from '../../game/store';
import { esc } from '../../lib/format';
import { toast } from '../../ui/Toaster';
import { openingHooks } from '../crates/opening';
import './chess.css';

export const SK: any = { catalog: [], owned: [], equipped: {} };
export const SK_PIECES = { k: "Król", q: "Hetman", r: "Wieża", b: "Goniec", n: "Skoczek", p: "Pion" };
const SK_SHAPE = {
  p: '<circle cx="50" cy="32" r="13"/><path d="M42 44h16l-1 6h-3c1 12 4 22 10 32H36c6-10 9-20 10-32h-3Z"/>',
  r: '<path d="M29 15h10v8h7v-8h8v8h7v-8h10v18l-7 5v30l7 14H29l7-14V38l-7-5Z"/>',
  b: '<circle cx="50" cy="10" r="4.500"/><path d="M50 15c11 8 17 18 15 28-1 6-6 9-9 12 1 10 4 19 10 27H34c6-8 9-17 10-27-3-3-8-6-9-12-2-10 4-20 15-28Z"/>',
  n: '<path d="M70 82c2-20-2-36-14-48l2-12-8 6-6-9-5 12C30 36 22 46 16 54c-2 3-1 7 2 8l5 3c3 2 7 1 9-1l8-6c3 4 1 10-2 14-3 5-6 6-7 10Z"/>',
  q: '<circle cx="18" cy="24" r="4"/><circle cx="35" cy="15" r="4"/><circle cx="50" cy="11" r="4"/><circle cx="65" cy="15" r="4"/><circle cx="82" cy="24" r="4"/><path d="M19 28l13 22 3-31 10 29 5-33 5 33 10-29 3 31 13-22-11 36 4 18H26l4-18Z"/>',
  k: '<path d="M46.500 5h7v7h7v7h-7v9c14-1 24 7 22 20-1 7-8 13-10 18l3 16H33l3-16c-2-5-9-11-10-18-2-13 8-21 22-20v-9h-7v-7h7Z" transform="translate(-1.500)"/>',
};
const SK_DETAIL = { b: '<path class="pc-line" d="M57 28 46 40"/>', n: '<circle class="pc-eye" cx="38" cy="37" r="2.400"/>' };
const SK_PLATE = '<rect class="pc-plate" x="17" y="81" width="66" height="12" rx="3"/>';
const SK_LN = 'stroke="#1a1a1a" stroke-width="1.500" stroke-linejoin="round" stroke-linecap="round"';
const SK_SKIN = "#e8b98f";

// gradient z własnym numerem (ta sama figura może być na stronie wiele razy, także w ukrytym kawałku strony)
let skN = 0;
function skGrad(stops, x2 = 0, y2 = 100) {
  const id = `skg${++skN}`;
  return [`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`, `url(#${id})`];
}
const skGold = () => skGrad([[0, "#fff4b8"], [.35, "#f0c23a"], [.7, "#c98f1c"], [1, "#fbe08a"]], 100, 40);
function skCrown(fill, gems = "#c8102e") {
  return `<g ${SK_LN}><path fill="${fill}" d="M30 25 26 9l10 8 7-12 7 9 7-9 7 12 10-8-4 16Z"/><rect fill="${fill}" x="30" y="23" width="40" height="5" rx="1"/></g>
    <g fill="${gems}" stroke="#1a1a1a" stroke-width=".8"><circle cx="50" cy="25.500" r="1.800"/><circle cx="40" cy="25.500" r="1.400"/><circle cx="60" cy="25.500" r="1.400"/></g>
    <g fill="#fff6c8" stroke="#1a1a1a" stroke-width=".8"><circle cx="26" cy="9" r="2"/><circle cx="43" cy="5" r="2"/><circle cx="57" cy="5" r="2"/><circle cx="74" cy="9" r="2"/></g>`;
}
function skHorse(coat, dark, extra = "") {
  const [def, fill] = skGrad([[0, coat[0]], [1, coat[1]]], 70, 70);
  return `<defs>${def}</defs><path d="M58 22c9 9 15 24 15 42l3 18H66c3-20-1-36-12-48Z" fill="${dark}" ${SK_LN}/>
    <path fill="${fill}" ${SK_LN} d="${SK_SHAPE.n.match(/d="([^"]+)"/)[1]}"/>
    <path d="M22 57c2-2 4-2 5 0" fill="none" ${SK_LN}/><circle cx="38" cy="37" r="2.800" fill="#120a04"/><circle cx="37.200" cy="36.200" r=".9" fill="#fff"/>${extra}`;
}

const SK_ART = {
  janusz: () => `<g ${SK_LN}><path fill="#d6c7a0" d="M31 82c0-18 5-31 19-31s19 13 19 31Z"/><path fill="#6f7c3c" d="M41 53l-6 29h11l4-20 4 20h11l-6-29-9 7Z"/>
    <rect fill="#fff" x="61" y="60" width="9" height="13" rx="2"/><path fill="#e0b32e" d="M61 63h9v7h-9Z"/>
    <circle fill="${SK_SKIN}" cx="50" cy="36" r="15"/><path fill="#5b3a1c" d="M37 42c4-3 9-3 13 0 4-3 9-3 13 0-3 5-9 6-13 2-4 4-10 3-13-2Z"/>
    <path fill="#808d46" d="M35 27c0-10 7-16 15-16s15 6 15 16Z"/><path fill="#6f7c3c" d="M26 28c7-4 41-4 48 0-8 4-40 4-48 0Z"/></g>
    <circle cx="44" cy="35" r="1.500" fill="#1a1a1a"/><circle cx="56" cy="35" r="1.500" fill="#1a1a1a"/>`,
  polski: p => {
    const [def, fill] = skGrad([[0, "#ffffff"], [.5, "#ffffff"], [.5, "#dc143c"], [1, "#a80e2c"]]);
    return `<defs>${def}</defs><g fill="${fill}" stroke="#1a1a1a" stroke-width="2.200" stroke-linejoin="round">${SK_SHAPE[p]}</g>${(SK_DETAIL[p] || "").replace('class="pc-line"', 'fill="none" stroke="#1a1a1a" stroke-width="2.200"').replace('class="pc-eye"', 'fill="#1a1a1a"')}`;
  },
  grazyna: () => `<g ${SK_LN}><path fill="#7c2f8c" d="M28 82c2-19 7-31 22-31s20 12 22 31Z"/>
    <circle fill="${SK_SKIN}" cx="50" cy="36" r="13"/></g>
    <g fill="#d65f28" stroke="#7a2e0e" stroke-width="1"><circle cx="35" cy="37" r="6.500"/><circle cx="65" cy="37" r="6.500"/><circle cx="35" cy="28" r="7"/><circle cx="65" cy="28" r="7"/><circle cx="42" cy="22" r="7.500"/><circle cx="58" cy="22" r="7.500"/><circle cx="50" cy="19" r="8"/></g>
    <path d="M38 17l3-11 6 6 3-8 3 8 6-6 3 11Z" fill="#e8c34a" ${SK_LN}/>
    <path d="M45 42c3 3 7 3 10 0" fill="none" stroke="#c8102e" stroke-width="2.200" stroke-linecap="round"/><circle cx="45" cy="35" r="1.500" fill="#1a1a1a"/><circle cx="55" cy="35" r="1.500" fill="#1a1a1a"/>
    <g fill="#fff" stroke="#666" stroke-width=".6">${[[36, 52], [40, 55], [45, 57], [50, 58], [55, 57], [60, 55], [64, 52]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.300"/>`).join("")}</g>
    <g fill="#f3a8c8">${[[40, 68], [58, 66], [49, 74], [34, 76], [65, 76]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.600"/>`).join("")}</g>`,
  kremowka: () => `<g ${SK_LN}><path fill="#d8983f" d="M25 82V66h50v16Z"/><path fill="#fff3cf" d="M25 66V52c4 2 8-2 12 0s8-2 13 0 8-2 13 0 8-2 12 0v14Z"/><path fill="#d8983f" d="M25 52V42h50v10Z"/><path fill="#fff" d="M23 42c1-4 53-4 54 0 0 3-54 3-54 0Z"/>
    <path fill="#fff3cf" d="M36 40c-2-8 2-12 5-14-3-5 2-13 9-13s12 8 9 13c3 2 7 6 5 14Z"/></g>
    <path d="M42 19c5 4 11 4 16 0M40 27c6 4 14 4 20 0M39 34c7 3 15 3 22 0" fill="none" stroke="#d9c58e" stroke-width="1.400"/><circle cx="50" cy="11" r="3.200" fill="#c8102e" stroke="#1a1a1a"/>
    <g stroke="#a86e22" stroke-width="1.100"><path d="M30 71l5 3M44 76l5-3M60 70l5 3M34 46l5 2M58 46l6 2"/></g>`,
  goniec: () => `<g ${SK_LN}><path fill="#23408e" d="M32 82l7-34c4-5 18-5 22 0l7 34Z"/><path fill="#c8102e" d="M41 48l9 6 9-6-2-5H43Z"/>
    <circle fill="${SK_SKIN}" cx="50" cy="33" r="12"/><path fill="#16295e" d="M37 26c0-9 26-9 26 0v3H37Z"/><path fill="#c8102e" d="M37 26h26v3.500H37Z"/><path fill="#111" d="M33 30c6-2 28-2 34 0-4 3-30 3-34 0Z"/></g>
    <path d="M46.500 23.500c0-3 7-3 7 0h-2c0-1-3-1-3 0Z" fill="#ffd21a" stroke="#6a4a10" stroke-width=".6"/>
    <path d="M40 48 64 70" stroke="#ffd21a" stroke-width="4"/><g ${SK_LN}><rect fill="#ffd21a" x="53" y="63" width="22" height="16" rx="2"/><path fill="none" d="M53 67l11 6 11-6"/><rect fill="#fff" x="24" y="56" width="16" height="11" rx="1" transform="rotate(-10 32 61)"/></g>
    <path d="M25 58l7 5 7-6" fill="none" stroke="#c8102e" stroke-width="1.200"/><g fill="#ffd21a"><circle cx="50" cy="61" r="1.400"/><circle cx="50" cy="70" r="1.400"/></g><circle cx="45" cy="34" r="1.400" fill="#1a1a1a"/><circle cx="55" cy="34" r="1.400" fill="#1a1a1a"/>`,
  pkin: () => {
    const [def, fill] = skGrad([[0, "#f2ecdd"], [.55, "#cfc6b2"], [1, "#8f8775"]], 100, 0);
    const win = (x, y, w, h) => `<path d="${Array.from({ length: Math.floor(w / 4) }, (_, i) => `M${x + 2 + i * 4} ${y}v${h}`).join("")}" stroke="#5e5748" stroke-width="1.400" stroke-dasharray="2.400 1.600"/>`;
    return `<defs>${def}</defs><path d="M50 1 47 22h6Z" fill="#c8c2b4" ${SK_LN}/><circle cx="50" cy="3" r="1.800" fill="#ffd21a" stroke="#6a4a10" stroke-width=".6"/>
      <g fill="${fill}" ${SK_LN}><path d="M41 34V25l3-3h12l3 3v9Z"/><path d="M36 48V37l3-3h22l3 3v11Z"/><path d="M29 66V51l4-3h34l4 3v15Z"/><path d="M19 82V70l5-4h52l5 4v12Z"/><path d="M12 82v-8l4-3h7v11ZM88 82v-8l-4-3h-7v11Z"/></g>
      ${win(43, 26, 15, 6)}${win(38, 37, 24, 9)}${win(31, 52, 38, 12)}${win(22, 70, 56, 10)}<circle cx="50" cy="29" r="2.500" fill="#fffbe8" stroke="#1a1a1a" stroke-width=".8"/>`;
  },
  plotka: () => skHorse(["#a06a36", "#6b4220"], "#2a1c10", `<path d="M26 52 45 40l13 12M42 41l-5-9" fill="none" stroke="#a02020" stroke-width="2"/><circle cx="45" cy="40" r="1.800" fill="#c8ccd4" stroke="#333" stroke-width=".6"/>
    <path d="M38 80c4-10 7-14 8-20 8-3 18-2 24 2l1 18Z" fill="#8e2a1e" ${SK_LN}/><circle cx="55" cy="69" r="7" fill="#c8ccd4" ${SK_LN}/><path d="M51 65l2 3 2-2 2 2 2-3-1 5-3 4-3-4Z" fill="#555"/>
    <path d="M85 8 72 40" stroke="#dfe3ea" stroke-width="2.600"/><path d="M78 15l8 4M72 40l-3 7" stroke="#6a4a24" stroke-width="3"/>`),
  kasztanka: () => skHorse(["#d27a34", "#9b4f1c"], "#5e2a10", `<path d="M27 54c3-6 8-13 13-19l3 3c-3 6-8 13-11 19Z" fill="#fff"/>
    <path d="M36 80c4-10 8-14 9-20 8-3 18-2 25 2l1 18Z" fill="#1f3a8a" stroke="#c8102e" stroke-width="2.400"/><path d="M57 62l1.800 4.200 4.500.4-3.400 3 1 4.500-3.900-2.400-3.900 2.400 1-4.500-3.400-3 4.500-.4Z" fill="#fff"/>
    <path d="M37 19l18-6 7 10-20 7Z" fill="#1f3a8a" ${SK_LN}/><path d="M38 26l21-7 3 4-20 7Z" fill="#c8102e" ${SK_LN}/><path d="M36 28l-7 6" stroke="#111" stroke-width="2.600"/>`),
  smok: () => {
    const [def, fill] = skGrad([[0, "#57c24f"], [1, "#1c6b2c"]], 70, 70);
    return `<defs>${def}</defs><path d="M60 30 80 8l1 18 13-5-6 17 8 4-12 8 5 8-16 2Z" fill="#2e8a3a" ${SK_LN}/>
      <path d="M58 22l8-12 2 14 10-6-3 14 12-1-7 12 10 5-9 8 6 9-8 3 4 14H70Z" fill="#c8d84a" ${SK_LN}/>
      <path fill="${fill}" ${SK_LN} d="${SK_SHAPE.n.match(/d="([^"]+)"/)[1]}"/>
      <path d="M44 19l-4-13 11 10ZM56 22l3-14 5 13Z" fill="#f2e9c8" ${SK_LN}/><path d="M43 60c4 3 22 3 28 0l1 22H34c3-6 8-12 9-22Z" fill="#c8d84a" opacity=".7"/>
      <circle cx="38" cy="37" r="3.600" fill="#ffd21a" stroke="#1a1a1a"/><path d="M38 34v6" stroke="#1a1a1a" stroke-width="1.400"/><path d="M19 63l2 4 3-2 3 3 3-3" fill="#fff" stroke="#1a1a1a" stroke-width=".8"/>
      <path d="M17 58C10 56 8 52 2 54c3 2 2 4 5 6-3 1-4 4-3 7 3-3 6-3 8-1 2-1 5-3 7-5Z" fill="#ff7a00" stroke="#c81e1e"/><path d="M15 59c-3-1-5-1-7 0 2 1 2 2 3 3 2 0 3-1 5-2Z" fill="#ffe14a"/>`;
  },
  korwin: () => {
    const [gd, gold] = skGold();
    return `<defs>${gd}</defs><g ${SK_LN}><path fill="#39404e" d="M26 82c1-17 7-29 24-29s23 12 24 29Z"/><path fill="#fff" d="M43 53l7 18 7-18Z"/>
      <circle fill="${SK_SKIN}" cx="50" cy="38" r="15"/><path fill="#dcdcdc" d="M35 40c1 13 8 18 15 18s14-5 15-18c-3 5-8 6-15 6s-12-1-15-6Z"/>
      <path fill="#dcdcdc" d="M34 40c-2-5-1-9 1-12l3 8ZM66 40c2-5 1-9-1-12l-3 8Z"/>
      <path fill="#c8102e" d="M36 54l14 6 14-6v13l-14-6-14 6Z"/></g>${skCrown(gold)}
      <g fill="#c8e4f4" fill-opacity=".55" stroke="#1a1a1a" stroke-width="1.700"><circle cx="43" cy="37" r="5.200"/><circle cx="57" cy="37" r="5.200"/></g><path d="M48 37h4" stroke="#1a1a1a" stroke-width="1.700"/>
      <circle cx="43" cy="37" r="1.300" fill="#1a1a1a"/><circle cx="57" cy="37" r="1.300" fill="#1a1a1a"/>
      <circle cx="50" cy="60.500" r="2.400" fill="#ffd21a" stroke="#6a4a10" stroke-width=".6"/><g fill="#fff"><circle cx="40" cy="58" r="1.100"/><circle cx="40" cy="63" r="1.100"/><circle cx="45" cy="60" r="1.100"/><circle cx="60" cy="58" r="1.100"/><circle cx="60" cy="63" r="1.100"/><circle cx="55" cy="60" r="1.100"/></g>`;
  },
  orzel: p => {
    const [gd, gold] = skGold();
    const wing = '<path fill="#fff" d="M50 38C40 33 24 23 11 27c3 5 2 9 4 13-1 5 1 8 3 12-1 5 2 8 6 10 3 2 9 1 14-3 5-3 10-8 12-13Z"/><path fill="none" stroke="#9aa0a8" stroke-width="1.200" d="M16 34c8 2 16 5 26 9M18 43c7 2 14 4 22 5M22 53c6 1 11 0 18-1M30 60c4-1 8-3 12-6"/>';
    return `<defs>${gd}</defs><path fill="#c8142e" ${SK_LN} d="M8 15h84v30c0 20-22 30-42 37C30 75 8 65 8 45Z"/>
      <g ${SK_LN}>${wing}<g transform="matrix(-1 0 0 1 100 0)">${wing}</g>
      <path fill="#fff" d="M50 32c7 0 9 7 9 17 0 9-4 17-9 26-5-9-9-17-9-26 0-10 2-17 9-17Z"/><path fill="#fff" d="M43 62l-9 8 8-1-3 7 9-6 2 8 2-8 9 6-3-7 8 1-9-8Z"/>
      <path fill="#fff" d="M50 21c6 0 8 3 8 7 0 3-3 5-3 8h-9c0-3 2-5 2-8-3 1-6 2-8 0 1-4 6-7 10-7Z"/><path fill="${gold}" d="M41 28c-3 0-5 1-6 3 3 1 6 0 8-1Z"/>
      <path fill="${gold}" d="M37 62l-8 5 4 1-2 4 5-3 1 3 3-6ZM63 62l8 5-4 1 2 4-5-3-1 3-3-6Z"/></g>
      <g ${SK_LN}><path fill="${gold}" d="M41 21l-3-11 6 5 6-9 6 9 6-5-3 11Z"/></g>${p === "k" ? `<path d="M50 0v8M47 3h6" stroke="#f0c23a" stroke-width="2.200"/>` : '<circle cx="50" cy="4" r="2.400" fill="#fff" stroke="#1a1a1a"/>'}<circle cx="49" cy="26" r="1.100" fill="#1a1a1a"/>`;
  },
  jp2: () => {
    const [gd, gold] = skGold();
    return `<defs>${gd}</defs><path d="M74 12v70" stroke="${gold}" stroke-width="3.400"/><path d="M74 4v16M67 10h14" stroke="#e0ae2c" stroke-width="3.400" stroke-linecap="round"/><path d="M68 16h12" stroke="#e0ae2c" stroke-width="2.600" stroke-linecap="round"/>
      <g ${SK_LN}><path fill="#fbfbf8" d="M29 82c2-19 6-32 21-32s19 13 21 32Z"/><path fill="#e8e6de" d="M36 50c-6 3-9 8-11 19 8 4 42 4 50 0-2-11-5-16-11-19-6 5-22 5-28 0Z"/>
      <path fill="#c8102e" d="M46 56h8v26h-8Z"/><path fill="${gold}" d="M46 56h8v3h-8ZM46 79h8v3h-8Z"/>
      <circle fill="${SK_SKIN}" cx="50" cy="38" r="12.500"/><path fill="#fbfbf8" d="M36 31 50 3l14 28c-8 3-20 3-28 0Z"/><path fill="${gold}" d="M35 29.500c9 3 21 3 30 0v3.500c-9 3-21 3-30 0Z"/></g>
      <path d="M50 10v14M45 15h10" stroke="#e0ae2c" stroke-width="2.400"/><circle cx="45" cy="38" r="1.400" fill="#1a1a1a"/><circle cx="55" cy="38" r="1.400" fill="#1a1a1a"/><path d="M45 44c3 2 7 2 10 0" fill="none" stroke="#7a4a30" stroke-width="1.300"/>
      <g fill="#1a1a1a" opacity=".12"><path d="M38 60l-3 22h4ZM62 60l3 22h-4Z"/></g><circle cx="74" cy="50" r="3.600" fill="${SK_SKIN}" stroke="#1a1a1a"/>`;
  },
  zloty_pion: () => {
    const [gd, gold] = skGold();
    return `<defs>${gd}</defs><g fill="${gold}" stroke="#6a4a10" stroke-width="2" stroke-linejoin="round">${SK_SHAPE.p}</g>
      <path d="M41 24c3-3 7-4 10-3" fill="none" stroke="#fffbe0" stroke-width="2.600" stroke-linecap="round"/><path d="M47 54c-1 9-3 16-6 24" fill="none" stroke="#fffbe0" stroke-width="2" stroke-linecap="round" opacity=".8"/>
      <path d="M56 62c4 1 5 4 6 8l3 9H53c-3-3-1-5 1-6-2-3-1-8 2-11Z" fill="#8d8d8d" stroke="#6a4a10" stroke-width="1.200"/><path d="M57 67l3 8M55 73l5-2" stroke="#b8b8b8" stroke-width="1"/>
      <text x="50" y="38" font-size="20" font-weight="700" font-family="Georgia, serif" text-anchor="middle" fill="#7a5410">?</text>
      <g fill="#fffbe0" stroke="#c98f1c" stroke-width=".5"><path d="M72 22l1.500 5 5 1.500-5 1.500-1.500 5-1.500-5-5-1.500 5-1.500Z"/><path d="M24 42l1 3.500 3.500 1-3.500 1-1 3.500-1-3.500-3.500-1 3.500-1Z"/></g>`;
  },
};

// figura: bez skina (albo nieznany skin) prosta sylwetka, ze skinem jego rysunek; podstawka zawsze w kolorze strony
export function skinSvg(skin, piece) {
  const art = SK_ART[skin];
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${art ? art(piece) : `<g class="pc-body">${SK_SHAPE[piece]}</g>${SK_DETAIL[piece] || ""}`}${SK_PLATE}</svg>`;
}
export function skDef(id: any): any { return SK.catalog.find(s => s.id === id); }
// figura po obu stronach: podstawka mówi, czyja jest
export function skPreview(skin, piece) {
  const one = (c, cls) => `<span class="sk-sq ${cls}"><span class="ch-pc ${c}${skin ? " sk" : ""}">${skinSvg(skin, piece)}</span></span>`;
  return `<div class="sk-prev">${one("w", "dk")}${one("b", "lt")}</div>`;
}
export function skRarity(id) {
  const r = S.cfg.rarities[skDef(id)?.rarity];
  return r ? `<span class="sk-rar" style="--rc:${r.color}">${esc(r.name)}</span>` : "";
}
export async function skLoad() {
  try { Object.assign(SK, await api("/api/games/chess/skins")); } catch (e) { toast(e.message, true); }
}

// BĘBEN FIGUR przy otwieraniu skrzynki szachów: kolor figur = kolor skrzynki, tło bębna losowane z szans skrzynki (jak weightedPerson)
function skTile(skin, piece, side, name, rarity, win) {
  return `<div class="mini mini-sk r-${rarity}${win ? " win" : ""}" style="--rc:${S.cfg.rarities[rarity].color}">
    <div class="sk-art ${side === "w" ? "dk" : "lt"}"><span class="ch-pc ${side} sk">${skinSvg(skin, piece)}</span></div><div class="mn">${esc(name)}</div></div>`;
}
function skStripHTML(won, crateId, len, winAt) {
  const crate = crateOf(crateId), side = crateId === "szachy_czarne" ? "b" : "w";
  const on = SK.catalog.filter(s => s.enabled !== false), rs = [...new Set(on.map(s => s.rarity))];
  const total = rs.reduce((a, r) => a + crate.weights[r], 0);
  const pick = () => {
    let x = Math.random() * total, r = rs[0];
    for (const q of rs) { x -= crate.weights[q]; if (x <= 0) { r = q; break; } }
    const list = on.filter(s => s.rarity === r);
    return list[Math.floor(Math.random() * list.length)];
  };
  const rare = on.filter(s => rarityIdx(s.rarity) >= rarityIdx("gold"));
  const near = rare.length && Math.random() < 0.28 ? winAt + (Math.random() < 0.5 ? -1 : 1) : -1;
  return Array.from({ length: len }, (_, k) => {
    if (k === winAt) return skTile(won.skin, won.piece, side, won.name, won.rarity, true);
    const s = k === near ? rare[Math.floor(Math.random() * rare.length)] : pick();
    return skTile(s.id, s.pieces[Math.floor(Math.random() * s.pieces.length)], side, s.name, s.rarity, false);
  }).join("");
}

// kafelek w wynikach otwarcia skrzynki: skin wypada obok karty
function skResultHTML(d, i) {
  const r = S.cfg.rarities[d.rarity];
  return `<div class="result sk-res" style="--rc:${r.color}; animation-delay:${i * 70}ms">
    <span class="new-badge">FIGURA</span>${skPreview(d.skin, d.piece)}
    <b>${esc(d.name)}</b><small>${SK_PIECES[d.piece]} · <span style="color:${r.color}">${esc(r.name)}</span></small></div>`;
}


Object.assign(openingHooks, { skLoad, skStripHTML, skResultHTML });
