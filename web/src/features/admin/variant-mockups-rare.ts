// @ts-nocheck -- propozycje wariantów PONAD Negatywem: Lonsdaleit (makiety, jeszcze nie w grze). Pryzmat i Antymateria są już w grze (cards2.css).
import { rand } from '../../game/rules';
import './variant-mockups-rare.css';

// Lonsdaleit: „Złoty heks” statyczny z heksagonami 70% (wersja 1, zostaje dokładnie taka jak była, do porównania) oraz wersja 2: ta sama karta
// z BARDZO delikatnym ruchem sieci za kursorem, złotym pyłem i heksagonami tej samej wielkości co w statycznej. Obie z bardzo mocną poświatą
// wokół karty. Heksagony są CIĄGŁE na tle i na zdjęciu (jedna siatka we wspólnym układzie współrzędnych karty) i leżą na warstwach: jedna główna
// pokrywa całą kartę, a pod nią i nad nią leży kilka warstw FRAGMENTARYCZNYCH (tylko kilka grup heksagonów w różnych miejscach), wszystko
// przezroczyste, żeby zdjęcie było dobrze widoczne. Bez napisów i podpisów. Pomocniki efektów z poprzednich rund (scyntylacja, orbity,
// stare warstwy hexLayer, fasety SVG) zostają w pliku na później. ARCHIVED_LOOKS = odłożone wersje do ewentualnego przywrócenia. Światło reaguje na przechył karty (--mx / --my;
// w grze ustawia je Card.tsx, w makietach kursor - patrz niżej). Styl: variant-mockups-rare.css, klasy ln-.
// Pomocniki są skopiowane z variant-mockups.ts (import w drugą stronę zrobiłby cykl).

const vmN = (a, b, d = 0) => rand(a, b).toFixed(d);
const vmPerimeter = (n, f) => Array.from({ length: n }, (_, k) => {
  let d = k / n * 302, x, y;
  if (d < 63) { x = d; y = 0; } else if ((d -= 63) < 88) { x = 63; y = d; } else if ((d -= 88) < 63) { x = 63 - d; y = 88; } else { x = 0; y = 88 - (d - 63); }
  return f(+(x / .63).toFixed(1), +(y / .88).toFixed(1), k);
}).join("");
const X = o => ({ ...o, cls: `vmx${o.cls ? " " + o.cls : ""}` });

// przechył makiet za kursorem (bez tego --mx / --my stałyby w środku). Powrót do środka jest płynny: zmienne są
// zarejestrowane przez @property w CSS i mają przejście, więc po zjechaniu kursorem światło wraca, a nie skacze.
let tiltOn = false;
if (typeof document !== "undefined" && !tiltOn) {
  tiltOn = true;
  document.addEventListener("pointermove", e => {
    if (e.pointerType === "touch") return;
    const c = e.target?.closest?.(".card.vm");
    if (!c) return;
    const b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    c.classList.add("tilting");
    c.style.setProperty("--ry", `${((x - .5) * 14).toFixed(1)}deg`);
    c.style.setProperty("--rx", `${((.5 - y) * 14).toFixed(1)}deg`);
    c.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    c.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
  });
  document.addEventListener("pointerout", e => {
    const c = e.target?.closest?.(".card.vm");
    if (!c || c.contains(e.relatedTarget)) return;
    c.classList.remove("tilting");
    for (const [k, v] of [["--rx", "0deg"], ["--ry", "0deg"], ["--mx", "50%"], ["--my", "50%"]]) c.style.setProperty(k, v);
  });
}

// poświata wokół karty: element wielkości karty z samym box-shadow (cqw liczy się od karty); kolory --a1..--a3 z karty
const aura = () => `<div class="vm-deco rr-aura"><i></i></div>`;
// MOCNA poświata (mocniejsza i większa niż w kamieniach szlachetnych): ciasna biała krawędź + trzy warstwy złotego blasku; sama przezroczystość pulsuje
const glow = () => `<div class="vm-deco rr-aura strong"><i class="a"></i><i class="b"></i></div>`;
// błyski (gwiazdki 4-ramienne) w losowych miejscach
const flares = (n, big = 1) => Array.from({ length: n }, () =>
  `<i class="rr-flare" style="left:${vmN(2, 98)}%;top:${vmN(2, 98)}%;--s:${(vmN(.6, 1.4, 2) * big).toFixed(2)};animation-delay:-${vmN(0, 6, 1)}s"></i>`).join("");
// błyski tuż POZA kartą (lekka aura z iskrami): punkty na obwodzie odsunięte na zewnątrz
const outSparks = n => vmPerimeter(n, (x, y) =>
  `<i class="rr-flare out" style="left:${(50 + (x - 50) * 1.1).toFixed(1)}%;top:${(50 + (y - 50) * 1.08).toFixed(1)}%;--s:${vmN(.7, 1.6, 2)};animation-delay:-${vmN(0, 6, 1)}s"></i>`);

// fasety statyczne (pierwotny „Złoty heks”): siatka SVG na całym tle albo zdjęciu, komórki jasne (hl), ciemne (hd) albo złote (hm), część migocze (tw)
const hexGridSvg = (w, h, s) => {
  const out = [], dx = Math.sqrt(3) * s, dy = 1.5 * s;
  for (let r = -1; r * dy < h + s; r++) for (let c = -1; c * dx < w + dx; c++) out.push([c * dx + (r & 1 ? dx / 2 : 0), r * dy]);
  return out;
};
const hexFacets = (w, h, s) => hexGridSvg(w, h, s).map(([x, y]) => {
  const r = Math.random(), k = r < .3 ? "hl" : r < .55 ? "hd" : "hm", tw = Math.random() < .14 ? " tw" : "";
  return `<path class="lnc ${k}${tw}" d="${hexPath(x, y, s)}" style="--o:${vmN(.1, .5, 2)};animation-delay:-${vmN(0, 5, 1)}s"/>`;
}).join("");
const vmSvg = (body, vb = "0 0 63 88", cls = "", par = "none") =>
  `<svg class="${cls}" viewBox="${vb}" preserveAspectRatio="${par}" aria-hidden="true">${body}</svg>`;

// ---------------------------------------------------------------- sieć sześciokątów jako kafel (powtarza się bez szwu)
// Kafel to obrazek SVG (data URI) 6 x 6 komórek o boku TILE_S (1 jednostka = 1cqw), więc po przesunięciu sieć wygląda na nieskończoną.
// facet = fasety jak w „Złotym heksie” (jasne, ciemne i złote komórki z jasnym obrysem); mask = te same komórki jako maska (alfa),
// przez którą świeci ruchome światło, więc każda komórka rozbłyska z inną siłą.
const TILE_N = 6, TILE_M = 6, TILE_S = 7;
const tileSize = s => ({ w: +(TILE_N * Math.sqrt(3) * s).toFixed(2), h: +(TILE_M * 1.5 * s).toFixed(2) });
const hash = (a, b, seed) => { const x = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453; return x - Math.floor(x); };
const hexPath = (cx, cy, s) => Array.from({ length: 6 }, (_, k) => {
  const a = Math.PI / 3 * k + Math.PI / 6;
  return `${k ? "L" : "M"}${(cx + Math.cos(a) * s).toFixed(2)} ${(cy + Math.sin(a) * s).toFixed(2)}`;
}).join("") + "Z";
const hexTile = (mode, seed = Math.random() * 100, S = TILE_S) => {
  const w = Math.sqrt(3) * S, parts = [], { w: TILE_W, h: TILE_H } = tileSize(S);
  for (let r = -1; r <= TILE_M; r++) for (let c = -1; c <= TILE_N; c++) {
    const k = hash(((c % TILE_N) + TILE_N) % TILE_N, ((r % TILE_M) + TILE_M) % TILE_M, seed), k2 = hash(((c % TILE_N) + TILE_N) % TILE_N, ((r % TILE_M) + TILE_M) % TILE_M, seed + 9.1);
    const d = hexPath(c * w + w / 2 + (r & 1 ? w / 2 : 0), r * 1.5 * S + S, S);
    if (mode === "outline") parts.push(`<path d="${d}" fill="#ffd25a" fill-opacity="${(k2 * .12).toFixed(2)}" stroke="#fff3c4" stroke-opacity=".85" stroke-width="${(S * .06).toFixed(2)}"/>`);
    else if (mode === "mask") parts.push(`<path d="${d}" fill="#000" fill-opacity="${(.12 + .88 * k * k).toFixed(2)}" stroke="#000" stroke-opacity=".85" stroke-width="${(S * .08).toFixed(2)}"/>`);
    else {
      const fill = k < .3 ? `fill="#fff" fill-opacity="${(.1 + .4 * k2).toFixed(2)}"` : k < .55 ? `fill="#000" fill-opacity="${(.1 + .35 * k2).toFixed(2)}"` : `fill="#ffd25a" fill-opacity="${(.12 + .38 * k2).toFixed(2)}"`;
      parts.push(`<path d="${d}" ${fill} stroke="#fff3c4" stroke-opacity=".55" stroke-width="${(S * .04).toFixed(2)}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE_W} ${TILE_H}" width="${TILE_W}" height="${TILE_H}">${parts.join("")}</svg>`;
  return `url('data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27")}')`;
};
// warstwa sieci przesuwana za kursorem: element większy od karty (żeby brzegi nie wchodziły w kadr), w środku komórki i ruchome światło
// (kind: band = pas światła, spot = plama pod kursorem, both = oba); depth: front = większe komórki, przesuwane mocniej (paralaksa)
const hexLayer = (cls, kind, depth = "back", seed = Math.random() * 100, S = TILE_S) => {
  const k = depth === "front" ? 1.45 : 1, S2 = S * k, { w, h } = tileSize(S2);
  const style = `--hex:${hexTile("facet", seed, S2)};--hexm:${hexTile("mask", seed, S2)};--tw:${w}cqw;--th:${h}cqw`;
  const light = (kind === "band" || kind === "both" ? `<i class="ln-glint band"></i>` : "") + (kind === "spot" || kind === "both" ? `<i class="ln-glint spot"></i>` : "");
  return `<i class="ln-shift ${depth} ${cls}" style="${style}"><i class="ln-cells"></i>${light}</i>`;
};

// ---------------------------------------------------------------- dodatkowe efekty (makiety 3-8)
// pył: drobinki złota unoszą się i migoczą na karcie i tuż wokół niej
const dust = n => Array.from({ length: n }, () =>
  `<i class="ln-mote" style="left:${vmN(-8, 108, 1)}%;top:${vmN(-6, 106, 1)}%;--d:${vmN(.5, 1.4, 2)};--t:${vmN(3.5, 7, 1)}s;animation-delay:-${vmN(0, 7, 1)}s"></i>`).join("");
// scyntylacja: losowe komórki rozbłyskują na biało jak ścianki szlifowanego kamienia, w ich środkach błyski; zwraca svg do tła / zdjęcia i błyski
const scint = (w, h, s, n) => {
  const cells = hexGridSvg(w, h, s).filter(([x, y]) => x > 0 && x < w && y > 0 && y < h).sort(() => Math.random() - .5).slice(0, n);
  return {
    svg: cells.map(([x, y]) => `<path class="lnc-flash" d="${hexPath(x, y, s)}" style="animation-delay:-${vmN(0, 4, 1)}s"/>`).join(""),
    flares: cells.slice(0, Math.ceil(n / 2)).map(([x, y]) => `<i class="rr-flare" style="left:${(x / w * 100).toFixed(1)}%;top:${(y / h * 100).toFixed(1)}%;--s:${vmN(.7, 1.3, 2)};animation-delay:-${vmN(0, 4, 1)}s"></i>`).join(""),
  };
};
// orbity: jasne kropki z ogonami okrążają kartę tuż za jej krawędzią (po prostokącie z zaokrąglonymi rogami)
const orbit = () => Array.from({ length: 3 }, (_, j) => Array.from({ length: 6 }, (_, k) =>
  `<i style="--d:${(2.8 - k * .38).toFixed(2)};--o:${(1 - k * .17).toFixed(2)};animation-delay:${(-j * 3 + k * .12).toFixed(2)}s"></i>`).join("")).join("");

// statyczny „Złoty heks” 70% (wybrana wersja): z dodatkami do tła, zdjęcia i warstwy nad kartą
const staticLook = (name, desc, { bg = "", photo = "", deco = "", cls = "" } = {}) => X({
  name, desc, cls: `ln1 lnk70 ${cls}`.trim(),
  bg: () => `<div class="vm-bg ln-bg">${vmSvg(hexFacets(63, 88, 6), "0 0 63 88", "ln-svg")}<i class="ln-sheen"></i>${typeof bg === "function" ? bg() : bg}</div>`,
  photo: () => `<div class="vm-photo ln1-photo">${vmSvg(hexFacets(63, 60, 7.5), "0 0 63 60", "ln-svg")}<i class="ln-tint"></i>${flares(9, 1.2)}${typeof photo === "function" ? photo() : photo}</div>`,
  deco: () => `${glow()}<div class="vm-deco">${flares(5, 1.6)}</div>${typeof deco === "function" ? deco() : deco}` });

// ---------------------------------------------------------------- warstwy we WSPÓLNYM układzie współrzędnych karty (siatka ciągła na tle i na zdjęciu)
// Każda warstwa to element 240 x 260cqw o lewym górnym rogu w (-70, -85)cqw względem wnętrza karty; w warstwie zdjęcia jest przesunięty o
// położenie zdjęcia (5,43 / 14,02cqw, stałe w układzie karty), więc ta sama siatka leży w tym samym miejscu na tle i na zdjęciu.
// Jednostka 1cqw = 1% szerokości zawartości KARTY (92,8% jej szerokości) i w tle, i w warstwie zdjęcia (kontenerem jest .card).
// Warstwy są generowane RAZ (te same dla tła i zdjęcia). Główna = kafel SVG (powtarza się bez szwu, pokrywa całą kartę); fragmentaryczne = SVG
// 240 x 260 z kilkoma grupami komórek w losowych (ale stałych) miejscach karty.
const mkFrame = (cls, s, mode, seed, band) => { const { w, h } = tileSize(s); return { cls, band, tw: w, th: h, hex: hexTile(mode, seed, s), mask: band ? hexTile("mask", seed, s) : "none" }; };
const MAIN = mkFrame("lm", 6 / .63, "facet", 42.7, true);
const tileLayer = (L, where, band = true) =>
  `<i class="ln-shift ln-frame ${L.cls} ${where}" style="--hex:${L.hex};--hexm:${L.mask};--twn:${L.tw};--thn:${L.th}"><i class="ln-cells"></i>${L.band && band ? '<i class="ln-glint band"></i>' : ""}</i>`;
// generator pseudolosowy z ziarna (żeby grupy leżały w tych samych miejscach na tle i na zdjęciu)
const rng = seed => { let x = Math.floor(seed * 1000) % 2147483647 || 7; return () => (x = x * 16807 % 2147483647) / 2147483647; };
// fragmenty: n grup komórek (każda = komórki w promieniu rad komórek od środka grupy), mode: facet (jasne / ciemne / złote) albo outline (świecące obrysy)
const mkFrag = (cls, S, mode, seed, n, rad) => {
  const r = rng(seed), w = Math.sqrt(3) * S, centers = Array.from({ length: n }, () => [75 + r() * 90, 90 + r() * 132]), parts = [];
  for (let row = -2; row * 1.5 * S < 280; row++) for (let c = -2; c * w < 260; c++) {
    const cx = c * w + w / 2 + (row & 1 ? w / 2 : 0), cy = row * 1.5 * S + S;
    if (!centers.some(([x, y]) => Math.hypot(cx - x, cy - y) <= rad * w)) continue;
    const k = hash(c + 100, row + 100, seed), k2 = hash(c + 100, row + 100, seed + 9.1), d = hexPath(cx, cy, S);
    if (mode === "outline") parts.push(`<path d="${d}" fill="#ffd25a" fill-opacity="${(k2 * .14).toFixed(2)}" stroke="#fff3c4" stroke-opacity=".9" stroke-width="${(S * .06).toFixed(2)}"/>`);
    else {
      const fill = k < .3 ? `fill="#fff" fill-opacity="${(.1 + .4 * k2).toFixed(2)}"` : k < .55 ? `fill="#000" fill-opacity="${(.1 + .35 * k2).toFixed(2)}"` : `fill="#ffd25a" fill-opacity="${(.12 + .38 * k2).toFixed(2)}"`;
      parts.push(`<path d="${d}" ${fill} stroke="#fff3c4" stroke-opacity=".6" stroke-width="${(S * .04).toFixed(2)}"/>`);
    }
  }
  return { cls, svg: parts.join("") };
};
const fragLayer = (F, where) => `<i class="ln-shift ln-frame ${F.cls} ${where}"><svg viewBox="0 0 240 260" preserveAspectRatio="none" aria-hidden="true">${F.svg}</svg></i>`;
// zestaw: warstwy pod główną (fu), główna (lm), warstwy nad główną (fo)
const S_BG = 6 / .63, S_PH = 7.5 / 63 * 89.2;
const layered = (under, over, withBand = true) => ({
  bg: () => `<div class="vm-bg ln-bg">${under.map(F => fragLayer(F, "bgl")).join("")}${tileLayer(MAIN, "bgl", withBand)}${over.map(F => fragLayer(F, "bgl")).join("")}<i class="ln-sheen"></i></div>`,
  photo: () => `<div class="vm-photo ln-photo">${under.map(F => fragLayer(F, "ph")).join("")}${tileLayer(MAIN, "ph", withBand)}${over.map(F => fragLayer(F, "ph")).join("")}<i class="ln-tint"></i>${flares(8, 1.2)}</div>`,
});
const movingDeco = () => `${glow()}<div class="vm-deco">${flares(4, 1.5)}</div><div class="vm-deco">${dust(46)}</div>`;

// zestawy warstw fragmentarycznych (pod: mniejsze komórki, ledwo się ruszają; nad: większe, ruszają się mocniej)
const C = { under: [mkFrag("fu", S_BG * .78, "facet", 21.9, 4, 1.0)], over: [mkFrag("fo", S_BG * 1.3, "facet", 25.3, 5, .9)] };
const D = { under: [mkFrag("fu", S_BG * .78, "facet", 31.7, 3, 1.6), mkFrag("fu fu2", S_BG * 1.1, "facet", 33.1, 2, 1.1)], over: [mkFrag("fo", S_BG * 1.3, "outline", 36.2, 4, 1.2)] };
// przezroczystość pośrednia między C a D: [główna %, pod, nad, zdjęcie] (C: 70, .3, .6, .5; D: 45, .3, .35, .3)
const MID = [[65, .3, .55, .46], [60, .3, .5, .42], [55, .3, .45, .38], [50, .3, .4, .34]];

// ---------------------------------------------------------------- ARCHIWUM: odłożone makiety (nie są pokazywane w grze ani w panelu admina)
// Wersje 3 i 4 z poprzedniej rundy („Statyczny, ciągła siatka” i „Delikatny ruch + pył, ciągła siatka”). Żeby je przywrócić, dopisz
// `...ARCHIVED_LOOKS,` na początku listy `looks` w RARE_PROPOSALS poniżej.
export const ARCHIVED_LOOKS = [
  X({ name: "Statyczny, ciągła siatka", desc: "Bez ruchu, heksagony 70%, mocna poświata, jedna siatka dla tła i zdjęcia (bez uskoków na krawędzi zdjęcia).",
    cls: "ln1 lnk70 lnstat",
    bg: () => `<div class="vm-bg ln-bg">${tileLayer(MAIN, "bgl", false)}<i class="ln-sheen"></i></div>`,
    photo: () => `<div class="vm-photo ln-photo">${tileLayer(MAIN, "ph", false)}<i class="ln-tint"></i>${flares(9, 1.2)}</div>`,
    deco: () => `${glow()}<div class="vm-deco">${flares(5, 1.6)}</div>` }),
  X({ name: "Delikatny ruch + pył, ciągła siatka", desc: "Bardzo delikatny ruch za kursorem, złoty pył, mocna poświata, jedna ciągła siatka na tle i na zdjęciu.",
    cls: "ln2 lnk70 lnsub", ...layered([], []), deco: () => movingDeco() }),
];

export const RARE_PROPOSALS = [
  {
    key: "lonsdaleite", name: "Lonsdaleit", icon: "⬢", tag: "⬢ LONSDALEIT",
    about: "ruchome warstwy „Złotego heksa” (główna + fragmenty pod i nad, ciągła siatka): od C (70%) do D (45%) w sześciu stopniach przezroczystości",
    looks: [
      X({ name: "Warstwy C: rozsypane drobne grupy (główna 70%)", desc: "Wersja C bez zmian: 4 małe grupy pod główną warstwą (30%) i 5 nad nią (60%), główna warstwa 70%, na zdjęciu 50%.",
        cls: "ln2 lnk70 lnsub lnC", ...layered(C.under, C.over), deco: () => movingDeco() }),
      ...MID.map(([k, fu, fo, pv], n) => X({
        name: `Warstwy, pośrednia ${n + 1} (główna ${k}%)`,
        desc: `Skład jak w C (4 grupy pod i 5 nad główną warstwą), przezroczystość pomiędzy C a D: główna ${k}%, fragmenty pod ${Math.round(fu * 100)}%, nad ${Math.round(fo * 100)}%, warstwy na zdjęciu ${Math.round(pv * 100)}%.`,
        cls: `ln2 lnk${k} lnsub lnM${n + 1}`, ...layered(C.under, C.over), deco: () => movingDeco() })),
      X({ name: "Warstwy D: najbardziej przezroczyste (główna 45%)", desc: "Wersja D bez zmian: najwięcej warstw (pod główną dwie o różnych wielkościach komórek, nad nią świecące obrysy), ale wszystkie najlżejsze: główna 45%, fragmenty 30-35%, na zdjęciu 30%.",
        cls: "ln2 lnk45 lnsub lnD", ...layered(D.under, D.over), deco: () => movingDeco() }),
    ],
  },
];
