// Lonsdaleit (wariant `lonsdaleite`): siatka sześciokątów na warstwach (jedna główna na całą kartę + fragmentaryczne pod nią i nad nią), ciągła na tle
// i na zdjęciu. Warstwy to obrazki SVG (data URI), które trafiają do zmiennych CSS `.card.v-lonsdaleite` (--lns-*) RAZ, przy pierwszej karcie tego
// wariantu (styl wstrzykiwany do <head>), a nie do HTML każdej karty - kart są tysiące. Wymiary w cqw: 1cqw = 1% szerokości zawartości KARTY
// (92,8% jej szerokości), także w warstwie zdjęcia (kontenerem jest .card); zdjęcie leży 5,43 / 14,02cqw od lewego górnego rogu wnętrza karty, więc
// warstwa na zdjęciu jest przesunięta o tyle i siatka jest ciągła. Wygląd wybrany z makiet (Warstwy, pośrednia 4: główna 50%, pod 30%, nad 40%, zdjęcie 34%).
// Styl: sekcja Lonsdaleit na końcu cards2.css (klasy lns-).

const TILE_N = 6, TILE_M = 6;
const S_MAIN = 6 / .63;   // bok komórki (cqw) jak w pierwotnym „Złotym heksie”
const hash = (a: number, b: number, seed: number) => { const x = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453; return x - Math.floor(x); };
const hexPath = (cx: number, cy: number, s: number) => Array.from({ length: 6 }, (_, k) => {
  const a = Math.PI / 3 * k + Math.PI / 6;
  return `${k ? "L" : "M"}${(cx + Math.cos(a) * s).toFixed(2)} ${(cy + Math.sin(a) * s).toFixed(2)}`;
}).join("") + "Z";
const tileSize = (s: number) => ({ w: +(TILE_N * Math.sqrt(3) * s).toFixed(2), h: +(TILE_M * 1.5 * s).toFixed(2) });
const dataUri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
// komórka: jasna (biała), ciemna (czarna) albo złota, z jasnym obrysem
const facetCell = (d: string, k: number, k2: number, S: number, strokeOp: string) => {
  const fill = k < .3 ? `fill="#fff" fill-opacity="${(.1 + .4 * k2).toFixed(2)}"` : k < .55 ? `fill="#000" fill-opacity="${(.1 + .35 * k2).toFixed(2)}"` : `fill="#ffd25a" fill-opacity="${(.12 + .38 * k2).toFixed(2)}"`;
  return `<path d="${d}" ${fill} stroke="#fff3c4" stroke-opacity="${strokeOp}" stroke-width="${(S * .04).toFixed(2)}"/>`;
};
// kafel powtarzający się bez szwu: facet = komórki jak wyżej, mask = te same komórki jako maska (alfa) dla ruchomego światła
function tile(mode: "facet" | "mask", seed: number, S: number) {
  const w = Math.sqrt(3) * S, { w: W, h: H } = tileSize(S), parts: string[] = [];
  for (let r = -1; r <= TILE_M; r++) for (let c = -1; c <= TILE_N; c++) {
    const ci = ((c % TILE_N) + TILE_N) % TILE_N, ri = ((r % TILE_M) + TILE_M) % TILE_M, k = hash(ci, ri, seed), k2 = hash(ci, ri, seed + 9.1);
    const d = hexPath(c * w + w / 2 + (r & 1 ? w / 2 : 0), r * 1.5 * S + S, S);
    parts.push(mode === "mask"
      ? `<path d="${d}" fill="#000" fill-opacity="${(.12 + .88 * k * k).toFixed(2)}" stroke="#000" stroke-opacity=".85" stroke-width="${(S * .08).toFixed(2)}"/>`
      : facetCell(d, k, k2, S, ".55"));
  }
  return dataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join("")}</svg>`);
}
const rng = (seed: number) => { let x = Math.floor(seed * 1000) % 2147483647 || 7; return () => (x = x * 16807 % 2147483647) / 2147483647; };
// warstwa fragmentaryczna 240 x 260: n grup komórek (promień rad komórek) w stałych miejscach wnętrza karty
function fragment(S: number, seed: number, n: number, rad: number) {
  const r = rng(seed), w = Math.sqrt(3) * S, centers = Array.from({ length: n }, () => [75 + r() * 90, 90 + r() * 132]), parts: string[] = [];
  for (let row = -2; row * 1.5 * S < 280; row++) for (let c = -2; c * w < 260; c++) {
    const cx = c * w + w / 2 + (row & 1 ? w / 2 : 0), cy = row * 1.5 * S + S;
    if (!centers.some(([x, y]) => Math.hypot(cx - x, cy - y) <= rad * w)) continue;
    parts.push(facetCell(hexPath(cx, cy, S), hash(c + 100, row + 100, seed), hash(c + 100, row + 100, seed + 9.1), S, ".6"));
  }
  return dataUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 260" preserveAspectRatio="none">${parts.join("")}</svg>`);
}

let injected = false;
/** Wstrzykuje zmienne CSS z obrazkami warstw (raz). Wołane przy tworzeniu pierwszej karty wariantu. */
export function ensureLonsdaleitStyle() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const { w, h } = tileSize(S_MAIN), el = document.createElement("style");
  el.id = "lns-vars";
  el.textContent = `.card.v-lonsdaleite { --lns-hex: ${tile("facet", 42.7, S_MAIN)}; --lns-mask: ${tile("mask", 42.7, S_MAIN)}; --lns-fu: ${fragment(S_MAIN * .78, 21.9, 4, 1.0)}; --lns-fo: ${fragment(S_MAIN * 1.3, 25.3, 5, .9)}; --lns-tw: ${w}cqw; --lns-th: ${h}cqw; }`;
  document.head.appendChild(el);
}

const rnd = (a: number, b: number, d = 0) => (a + Math.random() * (b - a)).toFixed(d);
/** Warstwy siatki: pod główną (fu), główna (lm, komórki + pas światła), nad główną (fo); where = "bg" (tło) albo "ph" (zdjęcie) */
export function lonsdaleitLayers(where: "bg" | "ph") {
  return `<i class="lns-lyr lns-fu ${where}"><i></i></i><i class="lns-lyr lns-lm ${where}"><i class="lns-cells"></i><i class="lns-glint"></i></i><i class="lns-lyr lns-fo ${where}"><i></i></i>`;
}
/** Błyski (gwiazdki czteroramienne) w losowych miejscach */
export const lonsdaleitFlares = (n: number, big = 1) => Array.from({ length: n }, () =>
  `<i class="lns-flare" style="left:${rnd(2, 98)}%;top:${rnd(2, 98)}%;--s:${(+rnd(.6, 1.4, 2) * big).toFixed(2)};animation-delay:-${rnd(0, 6, 1)}s"></i>`).join("");
/** Złoty pył: drobinki unoszą się i migoczą na karcie i tuż wokół niej */
export const lonsdaleitDust = (n: number) => Array.from({ length: n }, () =>
  `<i class="lns-mote" style="left:${rnd(-8, 108, 1)}%;top:${rnd(-6, 106, 1)}%;--d:${rnd(.5, 1.4, 2)};--t:${rnd(3.5, 7, 1)}s;animation-delay:-${rnd(0, 7, 1)}s"></i>`).join("");
