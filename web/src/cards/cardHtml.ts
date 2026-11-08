// @ts-nocheck -- kod rysujący na canvasie i w DOM-ie, przeniesiony bez zmian; typy dochodzą przy dalszym porządkowaniu
// Rysowanie kart. To wierne przeniesienie starego cardHTML: warianty są gotowym HTML-em, a ich wygląd daje cards/css.
// Komponent <Card> wstawia ten HTML; animacje i warstwy wariantów zostają w CSS, tak jak były.
import { S } from '../game/store';
import {
  GEMS, abilitiesOf, baseVariant, cardValue, crateOf, flagUrl, imgUrl, isBlank, isSpecial, person, rand, rarityIdx, rarityShare,
  beerSub, vClass, variantName, variantParts
} from '../game/rules';
import { esc, fmt } from '../lib/format';
import { drawingVersions } from './drawingVersions';

const VARIANT_TAGS = { chesswhite: "BIAŁA", chessblack: "CZARNA", anime: "🌸 ANIME", rgb: "🌈 RGB", tabloid: "📰 SZOK!", barbie: "💖 BARBIE", hawaii: "🌺 ALOHA", polaroid: "📸 POLAROID", wizytowka: "💼 WIZYTÓWKA", analog: "📼 ANALOG", polska: "🇵🇱 POLSKA", sugarcane: "🍬 SUGAR CANE", snow: "❄️ ŚNIEG", ascii: "> ASCII", jelly: "🍬 ŻELKA", crystal: "💠 KRYSZTAŁ", wood: "🪵 DREWNO", dowod: "🪪 DOWÓD", ice: "🧊 LÓD", christmas: "🎄 ŚWIĘTA", tree: "🌲 CHOINKA", gift: "🎁 PREZENT", covid: "😷 COVID-19", claude: "✻ CLAUDE", scratch: "🪙 ZDRAPKA", teletext: "📟 P888", retroos: "💾 OKIENKA 97", receipt: "🧾 PARAGON", tarot: "🔮 TAROT", muertos: "💀 MUERTOS", blank: "🖌️ CZYSTA", bw: "B&W", reverse: "REVERSE", bronze: "BRONZE", silver: "SILVER", platinum: "PLATINUM", steel: "⚙️ STEEL", sapphire: "💙 SAPPHIRE", blackdiamond: "🖤 BLACK DIAMOND", holo: "HOLO", pearl: "🦪 PEARL", gold: "GOLDEN", vintage: "📷 1887", marble: "🏛️ MARBLE", slime: "🟢 SLIME", matte: "MATTE", racing: "🏁 RETRO", bismuth: "🌈 BISMUTH", digital: "💻 DIGITAL", cyber: "🌃 CYBER", fade: "🎨 FADE", wanted: "🤠 WANTED", artdeco: "ART DÉCO", cheese: "🧀 CHEESE", aero: "🫧 AERO", honey: "🍯 HONEY", chinese: "🏮 CHINA", moro: "🪖 MORO", beer: "🍺 BEER", neon: "💡 NEON", electric: "⚡ VOLT", synthwave: "📼 SYNTH", motor: "🏎️ MOTO", toxic: "☢️ TOXIC", pixel: "👾 PIXEL", popart: "💥 POP!", glass: "⛪ VITRAIL", thermal: "🌡️ THERMAL", blueprint: "📐 BLUEPRINT", glitch: "▓ GL1TCH", mosaic: "🧱 MOSAIC", noir: "🕵️ NOIR", chocolate: "🍫 CHOCO", candy: "🍭 CANDY", hollywood: "🎬 1969", cobalt: "🔷 COBALT", banana: "🍌 BANANA", uranium: "☢️ U-238", mercury: "☿ Hg", californium: "⚛️ Cf-252", files: "🗂️ AKTA", copper: "🟠 Cu", reflective: "🦺 HI-VIS", usa: "★ U.S.A. ★", komuna: "★ PRL ★", apollo: "◉ MISJA 69", flag: "FLAG", halloween: "🎃 HALLOWEEN", lantern: "🏮 LAMPION", devil: "😈 DEVIL", joker: "🃏 JOKER", jeans: "👖 DŻINS", ufo: "🛸 ⎍⎎⍜⌰⎍⎅", clear: "🫧 CLEAR", sketch: "✒️ SKETCH", emerald: "💚 EMERALD", amethyst: "💜 AMETHYST", ruby: "❤️ RUBY", mlg: "🎯 MLG", royal: "👑 ROYAL", diamond: "💎 DIAMOND", galaxy: "🌌 GALAXY", negative: "◐ NEGATIVE", rzulty: "💛 RZULTY" };

const drawUrl = (uid, layer) => `/drawing/${uid}/${layer}?v=${drawingVersions[uid] || 0}`;
const drawingBG = (variant, uid) => isBlank(variant) && +uid > 0 ? `<img class="dr-flat" src="${drawUrl(uid, "flat")}" alt="" loading="lazy" draggable="false">` : "";
const drawingPhoto = (variant, uid) => isBlank(variant) && +uid > 0 ? `<img class="dr-ph" src="${drawUrl(uid, "photo")}" alt="" loading="lazy" draggable="false">` : "";

const isScratch = v => variantParts(v || "").includes("scratch");
const scratchMine = uid => S.items.some(i => i.id === +uid);
const scratchDone = uid => S.scratched.has(+uid);
export const scratchOpen = new Set();   // karty właśnie zdrapywane: ich folię rysuje edytor
export const scratchable = (variant, uid) => isScratch(variant) && scratchMine(uid) && !scratchDone(uid);
function scratchPhoto(uid) {
  if (!(+uid > 0)) return zdFoil();
  if (scratchMine(uid) && !scratchDone(uid) && !scratchOpen.has(+uid))
    return `<i class="vx-photo zd-foil still">${Array.from({ length: 7 }, (_, k) => `<u style="--i:${k}"></u>`).join("")}<em class="zd-here">ZDRAP TUTAJ</em></i>`;
  return '<i class="vx-photo zd-left"></i>';
}

// efekty wariantu na karcie - połączony wariant (np. flag+gold) dostaje efekty obu warstw i dwie plakietki
export function variantLayers(v, p = null, sub = null) {
  const parts = variantParts(v).filter(isSpecial);
  let html = "";
  for (const x of parts) {
    if (x === "royal") html += '<div class="gold-sheen"></div><div class="royal-border"></div><div class="royal-crown"></div>';
    if (x === "mlg") html += mlgDeco(p);
    if (x === "flag") html += '<div class="flag-tint"></div><div class="flag-wave"></div>';
    if (x === "halloween") html += halloweenDeco();
    if (x === "lantern") html += lanternDeco();
    if (x === "devil") html += devilDeco();
    if (x === "toxic") html += toxicDeco();
    if (x === "blueprint" && p) html += `<div class="bpr-title">PROJ. ${esc(p.name.toUpperCase())}<br>SKALA 1:1 · ARK. ${p.number || 1}/${crateOf(p.crate)?.people.length || 96}</div>`;
    if (VX_DECO[x]) html += VX_DECO[x](p);
    if (cvOf(x)) html += cvDeco(x);
    if (x === "holo") html += '<div class="holo-layer"></div>';
    if (x === "gold" || x === "silver" || x === "bronze" || x === "platinum") html += '<div class="gold-sheen"></div>';
    if (x === "clear") html += '<div class="clear-sheen"></div>';
    // nad kartą: migoczące gwiazdy i co jakiś czas spadająca gwiazda (każda karta w innym momencie i miejscu)
    if (x === "galaxy") html += `<div class="galaxy-stars"></div><div class="galaxy-shoot" style="--sd:-${rand(0, 11).toFixed(1)}s;--st:${Math.round(rand(4, 50))}%;--sl:${Math.round(rand(-30, 10))}%"><i></i></div>`;
    if (x === "negative") html += '<div class="neg-grain"></div>';
    if (x === "joker") html += jokerDeco();
    if (x === "jeans") html += jeansDeco();
    if (x === "ufo") html += ufoDeco(p);
    if (GEMS.includes(x)) html += '<div class="diamond-layer"></div><div class="diamond-glints"><i></i><i></i><i></i><i></i><i></i></div>';
    const mode = S.cfg.variants[x]?.stickers;   // "under" - pod zdjęciem (underStickersHTML), "both" - każda naklejka osobno
    if (mode !== "under") html += stickersHTML(x, mode === "both" ? stickerList(x, p)?.filter(s => !s.under) : stickerList(x, p));
  }
  parts.forEach((x, i) => {
    const cls = `var-tag vt-${x}${i ? " vt-second" : ""}`;
    html += x === "flag" && p?.country
      ? `<div class="${cls}"><img src="${flagUrl(p.country)}" alt="">${esc(p.country.toUpperCase())}</div>`
      : `<div class="${cls}">${x === "beer" && sub ? esc(sub.tag) : VARIANT_TAGS[x] ?? esc(cvOf(x)?.tag || variantName(x))}</div>`;
  });
  return html;
}
// Galaktyczna: ruchome tło kosmosu w środku karty (pod napisami i zdjęciem) - trzy mgławice i dwie warstwy gwiazd
// Losowe gwiazdy (SVG, za każdym razem inne): pojedyncze w różnych miejscach, gromady wokół kilku punktów i kilka
// jaśniejszych "iskier" z promieniami; część gwiazd migocze (klasy tw1-tw3), w = szerokość, h = wysokość pola
function galaxyStars(w, h, solo, clumps, sparkles, size = 1) {
  const tint = () => ["#ffffff", "#ffffff", "#ffe3f6", "#dcecff"][Math.floor(Math.random() * 4)];
  const tw = () => (Math.random() < 0.4 ? ` class="tw${1 + Math.floor(Math.random() * 3)}"` : "");
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  let out = "";
  const star = (x, y, r, o) => { out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * size).toFixed(2)}" fill="${tint()}" opacity="${o.toFixed(2)}"${tw()}/>`; };
  for (let i = 0; i < solo; i++) star(rand(0, w), rand(0, h), rand(0.25, 0.75) ** 1.6 + 0.12, rand(0.35, 1));
  for (let c = 0; c < clumps; c++) {
    const cx = rand(0, w), cy = rand(0, h), spread = rand(3, 9), n = 7 + Math.floor(rand(0, 12));
    for (let i = 0; i < n; i++) star(cx + gauss() * spread, cy + gauss() * spread * rand(0.5, 1.2), rand(0.12, 0.4), rand(0.4, 0.95));
  }
  for (let i = 0; i < sparkles; i++) {
    const x = rand(5, w - 5), y = rand(5, h - 5), l = rand(1.8, 3.4) * size, t = 0.22 * size;
    out += `<g class="tw${1 + (i % 3)} gx-spark" opacity="0.95"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.55 * size).toFixed(2)}" fill="#fff"/>` +
      `<path d="M${x} ${y - l}L${x + t} ${y}L${x} ${y + l}L${x - t} ${y}Z M${x - l} ${y}L${x} ${y - t}L${x + l} ${y}L${x} ${y + t}Z" fill="#fff"/></g>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${out}</svg>`;
}

// Galaktyczna: ruchome tło kosmosu w środku karty (pod napisami i zdjęciem) - mgławice w różu, magencie i fiolecie
// z niebieską poświatą + dwie warstwy losowych gwiazd (dalsza wolniej, bliższa szybciej)
function galaxyBG(variant) {
  if (!variantParts(variant).includes("galaxy")) return "";
  return `<div class="galaxy-bg"><i class="gx-neb n1"></i><i class="gx-neb n2"></i><i class="gx-neb n3"></i><i class="gx-neb n4"></i>` +
    `<i class="gx-stars s1">${galaxyStars(100, 140, 55, 3, 0, 0.9)}</i><i class="gx-stars s2">${galaxyStars(100, 140, 14, 1, 3, 1.2)}</i></div>`;
}
// ...i ta sama galaktyka na zdjęciu: kosmiczne zabarwienie, mgławica i gwiazdy na postaci (jak skórka Galaxy)
function galaxyPhoto(variant) {
  if (!variantParts(variant).includes("galaxy")) return "";
  return `<i class="gx-photo"><i class="gx-neb n1"></i><i class="gx-neb n3"></i><i class="gx-stars s1">${galaxyStars(100, 100, 28, 2, 2, 1)}</i></i>`;
}

// Halloweenowa (symbole SVG #hw-* z templates/index.html): nietoperze przelatujące nad kartą...
const hwUse = (id, cls, style = "") => `<svg class="${cls}" style="${style}" aria-hidden="true"><use href="#${id}"/></svg>`;
function halloweenDeco() {
  const bat = (k, d) => `<i class="hw-bat b${k}" style="animation-delay:-${d.toFixed(1)}s">${hwUse("hw-bat", "hw-bat-svg")}</i>`;
  return `<div class="hw-deco">${bat(1, rand(0, 9))}${bat(2, rand(0, 12))}${bat(3, rand(0, 15))}</div>`;
}
// ...a na zdjęciu: księżyc w rogu, migoczące dynie-lampiony na dole i czaszka
function halloweenPhoto(variant) {
  if (!variantParts(variant).includes("halloween")) return "";
  return `<i class="hw-photo"><i class="hw-moon"></i><span class="hw-pumpkins">${hwUse("hw-pumpkin", "hw-p1")}${hwUse("hw-pumpkin", "hw-p2")}${
    hwUse("hw-pumpkin", "hw-p3")}</span>${hwUse("hw-skull", "hw-skull")}</i>`;
}
// Lampionowa: karta w blasku świecy - iskry unoszące się z dołu i dwie migoczące dynie w dolnych rogach
const embersHTML = (n, cls) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${rand(5, 90).toFixed(0)}%;animation-delay:-${rand(0, 5).toFixed(1)}s;animation-duration:${rand(3.5, 6.5).toFixed(1)}s"></i>`).join("");
function lanternDeco() {
  return `<div class="hw-deco lt-deco">${embersHTML(9, "lt-ember")}${hwUse("hw-pumpkin", "lt-cp l")}${hwUse("hw-pumpkin", "lt-cp r")}</div>`;
}
// Diabelska: płomienie od dołu karty (pod napisami) i rogi wystające nad kartę
function devilBG(variant) {
  if (!variantParts(variant).includes("devil")) return "";
  return `<div class="dv-bg">${[6, 20, 34, 48, 62, 76].map((x, k) =>
    `<i class="dv-flame" style="left:${x}%;animation-delay:-${(k * .37).toFixed(2)}s;animation-duration:${rand(.8, 1.4).toFixed(2)}s"></i>`).join("")}</div>`;
}
function devilDeco() { return `<div class="dv-out">${hwUse("dv-horn", "dv-horn l")}${hwUse("dv-horn", "dv-horn r")}</div>`; }

// Perłowa, Vintage, Marmurowa, Toksyczna, Pop-art: tło w środku karty (pod napisami - .vx-bg) i nakładki na zdjęcie
// (.vx-photo, na tajnej karcie w .sc-art). Perłowa: masa perłowa przesuwająca się po karcie i perłowy połysk zdjęcia;
// Vintage: ziarno, rysy i winieta starej fotografii; Marmurowa: zdjęcie jak biały posąg; Toksyczna: jarzący się szlam
// i bąbelki; Pop-art: zdjęcie cztery razy w kratce 2 x 2, każde w innym jaskrawym kolorze (jak sitodruk Warhola).
export function variantBG(variant) {
  const parts = variantParts(variant);
  let html = "";
  if (parts.includes("pearl")) html += '<i class="pl-nacre"></i>';
  if (parts.includes("glass")) html += `${glassShards()}<i class="gl-cool"></i>`;
  if (parts.includes("thermal")) html += '<i class="ht-blob h1"></i><i class="ht-blob h2"></i><i class="ht-blob h3"></i>';
  if (parts.includes("toxic")) html += `<i class="tx-glow"></i>${Array.from({ length: 7 }, () =>
    `<i class="tx-bub" style="left:${rand(10, 85).toFixed(0)}%;--s:${rand(.5, 1.5).toFixed(2)};animation-delay:-${rand(0, 9).toFixed(1)}s;animation-duration:${rand(5, 10).toFixed(1)}s"></i>`).join("")}`;
  for (const x of parts) if (VX_BG[x]) html += VX_BG[x]();
  for (const x of parts) if (cvOf(x)) html += cvBG(x);
  return html ? `<div class="vx-bg">${html}</div>` : "";
}
export function variantPhoto(variant, p, uid = null) {
  const parts = variantParts(variant);
  let html = "";
  if (parts.includes("popart")) html += ["#ff4fa0", "#ffe13b", "#2fd0ff", "#7cff4a"].map((c, k) =>
    `<i class="vx-photo pa-quad q${k + 1}" style="--c:${c}"><img src="${imgUrl(p.id, variant)}" alt="" loading="lazy" draggable="false"></i>`).join("");
  if (parts.includes("pearl")) html += '<i class="vx-photo pl-sheen"></i>';
  if (parts.includes("glass")) html += '<i class="vx-photo gl-shine"></i>';
  if (parts.includes("blueprint")) html += '<i class="vx-photo bp-dims"><b class="w">63 mm</b><b class="h">88 mm</b></i>';
  if (parts.includes("glitch")) html += '<span class="gt-err">⚠ file_corrupted.jpg</span>';
  if (parts.includes("vintage")) html += '<i class="vx-photo vp-grain"></i><i class="vx-photo vp-scratch"></i><i class="vx-photo vp-vignette"></i>';
  if (parts.includes("marble")) html += '<i class="vx-photo mr-statue"></i>';
  if (parts.includes("toxic")) html += '<i class="vx-photo tx-photo"></i>';
  if (parts.includes("tabloid")) html += tabloidMarks(p?.vx?.tabloid);
  if (parts.includes("analog") && p) html += analogPhoto(p, variant);
  for (const x of parts) if (VX_PHOTO[x]) html += typeof VX_PHOTO[x] === "function" ? VX_PHOTO[x](uid) : VX_PHOTO[x];
  for (const x of parts) {   // wariant z kreatora: zabarwienie zdjęcia
    const Ph = cvOf(x)?.photo;
    if (Ph && Ph.tintMode !== "none") html += `<i class="vx-photo cvx-tint" style="background:${Ph.tint};mix-blend-mode:${Ph.tintMode};opacity:${Ph.tintOp}"></i>`;
  }
  return html;
}
// Toksyczna: kałuża jarzącego się szlamu na dole karty
function toxicDeco() {
  return '<div class="tx-puddle"><svg viewBox="0 0 66 6" preserveAspectRatio="none" aria-hidden="true"><path d="M0 1.6 Q10 -.2 20 1.2 T40 .8 T58 .4 T66 1.2 V6 H0Z"/></svg></div>';
}
// Vintage: zamiast "typ · skrzynka" pieczątka atelier fotograficznego (podtytuł z panelu admina ma pierwszeństwo)
const VINTAGE_STAMP = "Atelier ScamBox · Warszawa · 1887";
// Pikselowa (16-bitowa gra RPG): zdjęcie przerysowane w canvasie - zmniejszone do 58 pikseli szerokości (wykadrowane jak
// w ramce zdjęcia), 6 poziomów na kanał z lekkim ditheringiem - i pokazane powiększone (image-rendering: pixelated).
// Wynik w pamięci (PX_CACHE), żeby ta sama karta w ekwipunku nie liczyła się kilka razy.
const PX_CACHE = new Map();
const PX_BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// zdjęcie przerysowane w canvasie po wczytaniu: Pikselowa (pxPhoto) albo Witrażowa (glassPhoto)
// (Neonowa, Termowizyjna: fxPhoto)
export const photoFx = variant => {
  const parts = variantParts(variant);
  return parts.includes("pixel") ? ' onload="pxPhoto(this)"' : parts.includes("glass") ? ' onload="glassPhoto(this)"'
    : (fx => fx ? ` onload="fxPhoto(this,'${fx}')"` : "")([...Object.keys(FX_KINDS), "glitch"].find(k => parts.includes(k)));
};
// Neonowa: krawędzie zdjęcia (Sobel na rozmytej szarości) - najmocniejsze 13% jako rurki w różu / błękicie / żółci (wg koloru
// zdjęcia w tym miejscu), reszta przezroczysta; Termowizyjna: "ciepło" = odcień skóry + trochę jasności, paleta jak w kamerze
// (fiolet - czerwień - żółć - biel), liczone w 70 px i powiększane z wygładzeniem. Wynik w pamięci (FX_CACHE).
const FX_CACHE = new Map();
const HEAT_RAMP = [[0, [5, 2, 26]], [.18, [42, 10, 106]], [.36, [138, 26, 138]], [.52, [216, 48, 58]], [.68, [240, 122, 26]], [.84, [255, 210, 63]], [1, [255, 251, 232]]];
function fxCrop(img, ratio, W) {
  const H = Math.round(W / ratio), c = document.createElement("canvas"), nw = img.naturalWidth, nh = img.naturalHeight;
  c.width = W; c.height = H;
  let sx = 0, sy = 0, sw = nw, sh = nh;
  if (nw / nh > ratio) { sw = nh * ratio; sx = (nw - sw) / 2; } else { sh = nw / ratio; sy = (nh - sh) * .18; }
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  return [c, ctx, W, H];
}
// ASCII Art (makieta ASCII 1 „Terminal”): zdjęcie przerysowane na znaki w przeglądarce (FX_KINDS.ascii -> asciiCanvas, wynik w FX_CACHE):
// mały canvas cols x rows, jasność pola -> znak z palety (białe na czarnym: jaśniej = gęściej), tło połączone z brzegiem zdjęcia
// (mediana brzegu, flood fill) -> spacje, żeby postać stała na czarnym; potem znaki rysowane na canvasie w rozdzielczości ekranu.
const ASCII_RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
function asciiCanvas(img, ratio, W, cols = 64) {
  const rows = Math.max(8, Math.round(cols * .6 / ratio));
  const c0 = document.createElement("canvas"); c0.width = cols; c0.height = rows;
  const x0 = c0.getContext("2d", { willReadFrequently: true });
  const nw = img.naturalWidth, nh = img.naturalHeight;
  let sx = 0, sy = 0, sw = nw, sh = nh;
  if (nw / nh > ratio) { sw = nh * ratio; sx = (nw - sw) / 2; } else { sh = nw / ratio; sy = (nh - sh) * .18; }
  x0.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows);
  const d = x0.getImageData(0, 0, cols, rows).data, n = cols * rows, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114) / 255;
  const sorted = Float32Array.from(L).sort(), lo = sorted[Math.floor(n * .02)], hi = sorted[Math.floor(n * .98)] || 1;
  for (let i = 0; i < n; i++) L[i] = Math.min(1, Math.max(0, (L[i] - lo) / Math.max(.05, hi - lo))) ** 1.1;
  const edge = [];
  for (let x = 0; x < cols; x++) edge.push(L[x], L[(rows - 1) * cols + x]);
  for (let y = 0; y < rows; y++) edge.push(L[y * cols], L[y * cols + cols - 1]);
  edge.sort((a, b) => a - b);
  const bgL = edge[Math.floor(edge.length / 2)], near = i => Math.abs(L[i] - bgL) < .1, bg = new Uint8Array(n), queue = [];
  const seed = i => { if (!bg[i] && near(i)) { bg[i] = 1; queue.push(i); } };
  for (let x = 0; x < cols; x++) { seed(x); seed((rows - 1) * cols + x); }
  for (let y = 0; y < rows; y++) { seed(y * cols); seed(y * cols + cols - 1); }
  while (queue.length) {
    const i = queue.pop(), x = i % cols, y = (i - x) / cols;
    if (x > 0) seed(i - 1); if (x < cols - 1) seed(i + 1); if (y > 0) seed(i - cols); if (y < rows - 1) seed(i + cols);
  }
  const useBg = bg.reduce((a, b) => a + b, 0) < n * .8;
  const out = document.createElement("canvas"), OW = Math.max(360, W), OH = Math.round(OW / ratio);
  out.width = OW; out.height = OH;
  const o = out.getContext("2d"), cw = OW / cols, lh = OH / rows;
  o.fillStyle = "#000"; o.fillRect(0, 0, OW, OH);
  o.font = `${Math.min(lh, cw / .55).toFixed(2)}px Consolas, "DejaVu Sans Mono", "Courier New", monospace`;
  o.fillStyle = "#f2f2f2"; o.textBaseline = "top"; o.shadowColor = "#ffffff70"; o.shadowBlur = cw * .4;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (useBg && bg[i]) continue;
    const ch = ASCII_RAMP[Math.min(ASCII_RAMP.length - 1, Math.floor(L[i] * ASCII_RAMP.length))];
    if (ch !== " ") o.fillText(ch, x * cw, y * lh);
  }
  return out;
}
// ramka karty ze znaków + - | (34 x 28 znaków na całą kartę)
const ASCII_BOX = `<pre class="vx-deco asc-box">${"+" + "-".repeat(32) + "+\n" + ("|" + " ".repeat(32) + "|\n").repeat(26) + "+" + "-".repeat(32) + "+"}</pre>`;

// Dowód osobisty (makieta Dowód 1 „Nowy dowód”): karta wzorowana na polskim dowodzie - napisy „Rzeczpospolita ScamBoxowa /
// Dowód kolekcjonerski”, tarcza SB zamiast godła, bez flagi UE (ma przypominać dowód, nie udawać dokumentu). Cały dowód to warstwa
// .id-card nad kartą: na zwykłej (pionowej) karcie obrócona o 90° (kafelki w ekwipunku i klaserze się nie rozjeżdżają),
// w podglądzie (viewer.css) karta jest pozioma i dowód stoi prosto. .id-card jest kontenerem, więc cqw = szerokość dowodu.
const idSplit = name => { const w = String(name).trim().split(/\s+/); return w.length > 1 ? [w[w.length - 1], w.slice(0, -1).join(" ")] : [w[0], "—"]; };
const idField = (pl, en, val, cls = "") => `<div class="id-f ${cls}"><small>${pl}<em>/ ${en}</em></small><b>${esc(String(val))}</b></div>`;
function dowodCard(p) {
  if (!p) return "";
  const crate = crateOf(p.crate), ab = abilitiesOf(p)[0], [sur, giv] = idSplit(p.name), photo = imgUrl(p.id, "normal");
  const nat = !p.country || p.country === "pl" ? "POLSKIE" : String(p.country).toUpperCase();
  return `<div class="vx-deco id-card">
    <i class="id-guil"></i><i class="id-shield"><b>SB</b></i>
    <div class="id-head"><b>Rzeczpospolita ScamBoxowa</b> <span>Republic of ScamBox</span><br><b>Dowód kolekcjonerski</b> <span>Collector card</span></div>
    <i class="id-sb">SB</i><i class="id-chip-mark"></i>
    <div class="id-photo"><img src="${photo}" alt="" loading="lazy" draggable="false"></div>
    <div class="id-fields">
      ${idField("NAZWISKO", "SURNAME", sur.toUpperCase(), "big")}${idField("IMIONA", "GIVEN NAMES", giv.toUpperCase(), "big")}
      ${idField("OBYWATELSTWO", "NATIONALITY", nat)}${idField("RZADKOŚĆ", "RARITY", (S.cfg.rarities[p.rarity]?.name || p.rarity).toUpperCase())}
      ${idField("SERIA I NUMER KARTY", "CARD NUMBER", `${crate?.code || "SB"}${String(p.number || 0).padStart(6, "0")}`)}${idField("PUNKTY ŻYCIA", "HP", p.hp)}
      ${idField("ATAK", "ATTACK", ab ? `${ab.name} · ${ab.value}` : "—", "wide")}
    </div>
    <div class="id-ghost"><img src="${photo}" alt="" loading="lazy" draggable="false"></div>
    <div class="id-sign"><small>PODPIS<em>/ SIGNATURE</em></small><i>${esc(p.name)}</i></div>
    <div class="id-can"><b>${String(cardValue(p.id)).padStart(6, "0")}</b><small>WARTOŚĆ<em>/ VALUE</em></small></div>
    <i class="id-water">KOLEKCJONERSKI</i>
  </div>`;
}
// Przerysowania zdjęcia po wczytaniu: (img, proporcje, szerokość ekranowa) -> canvas. Blueprint: kontur białą kreską; Dolarowa:
// rycina (poziome faliste linie, grubsze w cieniach) zielonym tuszem, na ekranową rozdzielczość (bez mory); Glitch: patrz glitchPhoto
const FX_KINDS = {
  ascii: img => asciiCanvas(img, ...fxArgs(img)),
  neon: img => neonCanvas(img, ...fxArgs(img)), thermal: img => heatCanvas(img, ...fxArgs(img)),
  blueprint: img => linesCanvas(img, fxArgs(img)[0], "#e8f4ff"),
  mosaic: img => mosaicCanvas(img, fxArgs(img)[0]),
};
const fxArgs = img => [img.closest(".sc-art") ? 63 / 88 : 1 / .96, Math.max(120, Math.round((img.parentElement?.offsetWidth || 150) * (window.devicePixelRatio || 1)))];
function fxPhoto(img, kind) {
  if (img.dataset.fx) return;
  img.dataset.fx = "1";
  const [ratio] = fxArgs(img), key = `${kind}|${img.src}|${ratio}`;
  if (kind === "glitch") return glitchPhoto(img, ratio, key);
  if (FX_CACHE.has(key)) { img.src = FX_CACHE.get(key); return; }
  try {
    const url = FX_KINDS[kind](img).toDataURL();
    FX_CACHE.set(key, url);
    img.src = url;
  } catch (e) { /* nie udało się przerysować - zostaje zwykłe zdjęcie */ }
}
// kontur: krawędzie zdjęcia (Sobel na rozmytej szarości) - najmocniejsza część "keep" w kolorze color, reszta przezroczysta
function linesCanvas(img, ratio, color, keep = .13, W = 220) {
  const [c, ctx, , H] = fxCrop(img, ratio, W), d = ctx.getImageData(0, 0, W, H), s = d.data, col = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  const g = new Float32Array(W * H), b = new Float32Array(W * H), m = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = .3 * s[i * 4] + .59 * s[i * 4 + 1] + .11 * s[i * 4 + 2];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let t = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) t += g[(y + j) * W + x + i];
    b[y * W + x] = t / 9;
  }
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const k = y * W + x;
    const gx = b[k - W + 1] + 2 * b[k + 1] + b[k + W + 1] - b[k - W - 1] - 2 * b[k - 1] - b[k + W - 1];
    const gy = b[k + W - 1] + 2 * b[k + W] + b[k + W + 1] - b[k - W - 1] - 2 * b[k - W] - b[k - W + 1];
    m[k] = Math.hypot(gx, gy);
  }
  const t = Float32Array.from(m).sort()[Math.floor(m.length * (1 - keep))];
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    if (m[k] <= t) { s[i + 3] = 0; continue; }
    s[i] = col[0]; s[i + 1] = col[1]; s[i + 2] = col[2]; s[i + 3] = Math.min(255, 110 + (m[k] - t) * 3);
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
// Mozaikowa: zdjęcie zmniejszone do 34 kolumn, każde pole przemalowane na najbliższy kolor klocka i narysowane jako klocek z nopkiem
const BRICK_PAL = ["#c91a09", "#0055bf", "#f2cd37", "#237841", "#ffffff", "#05131d", "#fe8a18", "#a0a5a9", "#6c6e68", "#582a12", "#d09168", "#e4cd9e", "#e4adc8", "#9bd7d6", "#bbe90b"]
  .map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
function mosaicCanvas(img, ratio) {
  const cols = 34, cell = 10, [, sctx, , rows] = fxCrop(img, ratio, cols), d = sctx.getImageData(0, 0, cols, rows).data;
  const c = document.createElement("canvas"); c.width = cols * cell; c.height = rows * cell;
  const g = c.getContext("2d"), shade = (col, f) => `rgb(${col.map(v => Math.round(Math.min(255, v * f))).join(",")})`;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = (y * cols + x) * 4, r = (d[i] - 128) * 1.12 + 128, gg = (d[i + 1] - 128) * 1.12 + 128, b = (d[i + 2] - 128) * 1.12 + 128;
    let best = 0, bd = 1e9;
    BRICK_PAL.forEach((p, k) => { const dd = 2 * (r - p[0]) ** 2 + 4 * (gg - p[1]) ** 2 + 3 * (b - p[2]) ** 2; if (dd < bd) { bd = dd; best = k; } });
    const col = BRICK_PAL[best], px = x * cell, py = y * cell, cx = px + cell / 2, cy = py + cell / 2;
    g.fillStyle = shade(col, .7); g.fillRect(px, py, cell, cell);
    g.fillStyle = shade(col, 1); g.beginPath(); g.arc(cx, cy, cell * .38, 0, 7); g.fill();
    g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, cell * .3, 3.4, 4.8); g.stroke();
    g.strokeStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.arc(cx, cy, cell * .3, .3, 1.7); g.stroke();
  }
  return c;
}
// Glitch "zepsuty plik": bloki 8 x 8 przesunięte w bok, z odwróconymi albo przesuniętymi kolorami, i kilka pasów z powtórzonym
// wierszem. Zdjęcie jest RUCHOME: liczymy 4 różne wersje uszkodzeń; pierwsza leży na stałe, a trzy pozostałe (.gt-fr) co chwilę
// błyskają nad nią w różnych momentach - więc elementy uszkodzenia ciągle się zmieniają (sama animacja opacity - tania)
function corruptCanvas(img, ratio) {
  const [c, ctx, W, H] = fxCrop(img, ratio, 192), d = ctx.getImageData(0, 0, W, H), s = d.data, o = new Uint8ClampedArray(s);
  for (let by = 0; by < H; by += 8) {
    const bad = Math.random() < .3, shift = bad ? Math.floor(rand(-40, 40)) : 0, mode = Math.floor(rand(0, 3));
    for (let bx = 0; bx < W; bx += 8) {
      if (!bad && Math.random() > .05) continue;
      for (let y = by; y < Math.min(H, by + 8); y++) for (let x = bx; x < Math.min(W, bx + 8); x++) {
        const sx = Math.min(W - 1, Math.max(0, x + shift)), i = (y * W + x) * 4, j = (y * W + sx) * 4;
        if (mode === 0) { s[i] = o[j + 2]; s[i + 1] = o[j]; s[i + 2] = o[j + 1]; }
        else if (mode === 1) { s[i] = o[j]; s[i + 1] = o[j + 1] * .3; s[i + 2] = o[j + 2] * 1.6; }
        else { s[i] = 255 - o[j]; s[i + 1] = 255 - o[j + 1]; s[i + 2] = 255 - o[j + 2]; }
      }
    }
  }
  for (let n = 0; n < 4; n++) {
    const y0 = Math.floor(rand(0, H - 12)), hh = Math.floor(rand(3, 12));
    for (let y = y0; y < y0 + hh; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) s[(y * W + x) * 4 + k] = o[(y0 * W + x) * 4 + k];
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
function glitchPhoto(img, ratio, key) {
  try {
    let frames = FX_CACHE.get(key);
    if (!frames) { frames = Array.from({ length: 4 }, () => corruptCanvas(img, ratio).toDataURL("image/jpeg", .85)); FX_CACHE.set(key, frames); }
    img.src = frames[0];
    for (let k = 1; k < 4; k++) img.insertAdjacentHTML("afterend", `<img class="gt-fr" src="${frames[k]}" alt="" draggable="false" style="animation-delay:-${(k * 1.07).toFixed(2)}s">`);
  } catch (e) { /* nie udało się przerysować - zostaje zwykłe zdjęcie */ }
}
function neonCanvas(img, ratio) {
  const [c, ctx, W, H] = fxCrop(img, ratio, 210), d = ctx.getImageData(0, 0, W, H), s = d.data;
  const g = new Float32Array(W * H), b = new Float32Array(W * H), m = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = .3 * s[i * 4] + .59 * s[i * 4 + 1] + .11 * s[i * 4 + 2];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let t = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) t += g[(y + j) * W + x + i];
    b[y * W + x] = t / 9;
  }
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const k = y * W + x;
    const gx = b[k - W + 1] + 2 * b[k + 1] + b[k + W + 1] - b[k - W - 1] - 2 * b[k - 1] - b[k + W - 1];
    const gy = b[k + W - 1] + 2 * b[k + W] + b[k + W + 1] - b[k - W - 1] - 2 * b[k - W] - b[k - W + 1];
    m[k] = Math.hypot(gx, gy);
  }
  const t = Float32Array.from(m).sort()[Math.floor(m.length * .87)];
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    if (m[k] <= t) { s[i + 3] = 0; continue; }
    const r = s[i], gg = s[i + 1], bb = s[i + 2];
    const col = r > bb + 30 ? (gg > r * .8 ? [255, 230, 60] : [255, 60, 220]) : [60, 230, 255];
    s[i] = col[0]; s[i + 1] = col[1]; s[i + 2] = col[2]; s[i + 3] = Math.min(255, 130 + (m[k] - t) * 3);
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
function heatCanvas(img, ratio) {
  const [c, ctx, W, H] = fxCrop(img, ratio, 70), d = ctx.getImageData(0, 0, W, H), s = d.data;
  const ramp = t => {
    t = Math.max(0, Math.min(1, t));
    let k = 1;
    while (k < HEAT_RAMP.length - 1 && HEAT_RAMP[k][0] < t) k++;
    const [p0, a] = HEAT_RAMP[k - 1], [p1, b] = HEAT_RAMP[k], f = (t - p0) / (p1 - p0);
    return a.map((v, i) => v + (b[i] - v) * f);
  };
  for (let i = 0; i < s.length; i += 4) {
    const r = s[i], g = s[i + 1], b = s[i + 2], lum = (.3 * r + .59 * g + .11 * b) / 255;
    const skin = Math.max(0, Math.min(1, (r - b - 25) / 90)) * (r >= g ? 1 : .5), out = ramp(.12 + .18 * lum + .72 * skin * (.55 + .45 * lum));
    s[i] = out[0]; s[i + 1] = out[1]; s[i + 2] = out[2];
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
function pxPhoto(img) {
  if (img.dataset.px) return;
  img.dataset.px = "1";
  const ratio = img.closest(".sc-art") ? 63 / 88 : 1 / .96, key = `${img.src}|${ratio}`;
  if (PX_CACHE.has(key)) { img.src = PX_CACHE.get(key); return; }
  try {
    const w = 58, h = Math.round(w / ratio), c = document.createElement("canvas"), nw = img.naturalWidth, nh = img.naturalHeight;
    c.width = w; c.height = h;
    let sx = 0, sy = 0, sw = nw, sh = nh;
    if (nw / nh > ratio) { sw = nh * ratio; sx = (nw - sw) / 2; } else { sh = nw / ratio; sy = (nh - sh) * .18; }
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h), px = d.data, q = v => Math.round(Math.max(0, Math.min(255, v)) / 51) * 51;
    for (let i = 0; i < px.length; i += 4) {
      const t = (PX_BAYER[(Math.floor(i / 4 / w) % 4) * 4 + (i / 4) % 4] / 16 - .5) * 12;
      px[i] = q(px[i] + t); px[i + 1] = q(px[i + 1] + t); px[i + 2] = q(px[i + 2] + t);
    }
    ctx.putImageData(d, 0, 0);
    const url = c.toDataURL();
    PX_CACHE.set(key, url);
    img.src = url;
  } catch (e) { /* nie udało się przerysować - zostaje zwykłe zdjęcie */ }
}
// Witrażowa (lampa Tiffany "ważka"): zdjęcie podzielone na ok. 500 kawałków szkła - komórki Woronoja z lekko przesuniętej
// siatki punktów, każdy kawałek w uśrednionym, nasyconym kolorze zdjęcia, jaśniejszy w środku, rozdzielone ołowiem.
// Wynik w pamięci (GL_CACHE); tło z trójkątów szkła w chłodnych barwach - jedno SVG dla wszystkich kart (glassShards).
const GL_CACHE = new Map();
function glassPhoto(img) {
  if (img.dataset.gl) return;
  img.dataset.gl = "1";
  const ratio = img.closest(".sc-art") ? 63 / 88 : 1 / .96, key = `${img.src}|${ratio}`;
  if (GL_CACHE.has(key)) { img.src = GL_CACHE.get(key); return; }
  try {
    const W = 320, H = Math.round(W / ratio), c = document.createElement("canvas"), nw = img.naturalWidth, nh = img.naturalHeight;
    c.width = W; c.height = H;
    let sx = 0, sy = 0, sw = nw, sh = nh;
    if (nw / nh > ratio) { sw = nh * ratio; sx = (nw - sw) / 2; } else { sh = nw / ratio; sy = (nh - sh) * .18; }
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H), s = d.data, cols = 22, rows = Math.max(2, Math.round(cols / ratio));
    const cw = W / cols, ch = H / rows, seeds = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++)
      seeds.push([(i + .5 + rand(-.4, .4)) * cw, (j + .5 + rand(-.4, .4)) * ch, rand(-.06, .06)]);
    const cell = new Int32Array(W * H), dist = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const gj = Math.min(rows - 1, Math.floor(y / ch));
      for (let x = 0; x < W; x++) {
        const gi = Math.min(cols - 1, Math.floor(x / cw));
        let best = 0, bd = 1e12;
        for (let j = Math.max(0, gj - 1); j <= Math.min(rows - 1, gj + 1); j++)
          for (let i = Math.max(0, gi - 1); i <= Math.min(cols - 1, gi + 1); i++) {
            const k = j * cols + i, dx = x - seeds[k][0], dy = y - seeds[k][1], dd = dx * dx + dy * dy;
            if (dd < bd) { bd = dd; best = k; }
          }
        cell[y * W + x] = best;
        dist[y * W + x] = Math.min(1, Math.sqrt(bd) / cw);
      }
    }
    const sum = new Float64Array(seeds.length * 4);
    for (let i = 0; i < W * H; i++) { const k = cell[i] * 4; sum[k] += s[i * 4]; sum[k + 1] += s[i * 4 + 1]; sum[k + 2] += s[i * 4 + 2]; sum[k + 3]++; }
    const col = seeds.map((_, k) => {
      const n = sum[k * 4 + 3] || 1, r = sum[k * 4] / n, g = sum[k * 4 + 1] / n, b = sum[k * 4 + 2] / n, gray = (r + g + b) / 3;
      return [gray + (r - gray) * 1.55 + 8, gray + (g - gray) * 1.55 + 8, gray + (b - gray) * 1.55 + 8];
    });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, k = cell[i];
      const lead = (x + 1 < W && cell[i + 1] !== k) || (y + 1 < H && cell[i + W] !== k) || (x > 0 && cell[i - 1] !== k) || (y > 0 && cell[i - W] !== k);
      if (lead) { s[i * 4] = 34; s[i * 4 + 1] = 28; s[i * 4 + 2] = 22; continue; }
      const f = (1.18 - dist[i] * .36 + seeds[k][2] + Math.sin((x + y * .6) * .9 + k) * .025) * (1 + rand(-.04, .04));
      s[i * 4] = col[k][0] * f; s[i * 4 + 1] = col[k][1] * f; s[i * 4 + 2] = col[k][2] * f;
    }
    ctx.putImageData(d, 0, 0);
    const url = c.toDataURL("image/jpeg", .9);
    GL_CACHE.set(key, url);
    img.src = url;
  } catch (e) { /* nie udało się przerysować - zostaje zwykłe zdjęcie */ }
}
let GLASS_SHARDS = null;
function glassShards() {
  if (GLASS_SHARDS) return GLASS_SHARDS;
  const pal = ["#2f7fc0", "#3fa0a0", "#4f8a5a", "#6a5aa8", "#2a5a8a", "#8ac0c0", "#e8a33a"], cols = 14, rows = 20, P = [];
  for (let j = 0; j <= rows; j++) {
    P.push([]);
    for (let i = 0; i <= cols; i++) {
      const ex = i === 0 || i === cols, ey = j === 0 || j === rows;
      P[j].push([i / cols * 63 + (ex ? 0 : rand(-1.4, 1.4)), j / rows * 88 + (ey ? 0 : rand(-1.4, 1.4))]);
    }
  }
  let out = "";
  const pt = a => `${a[0].toFixed(1)} ${a[1].toFixed(1)}`;
  const tri = (a, b, c) => { out += `<path d="M${pt(a)}L${pt(b)}L${pt(c)}Z" fill="${pal[Math.floor(rand(0, pal.length))]}" opacity="${rand(.78, 1).toFixed(2)}"/>`; };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i + 1], d = P[j + 1][i];
    if (Math.random() < .5) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  }
  GLASS_SHARDS = `<svg viewBox="0 0 63 88" preserveAspectRatio="none" aria-hidden="true"><g stroke="#2a1d12" stroke-width=".7" stroke-linejoin="round">${out}</g></svg>`;
  return GLASS_SHARDS;
}
// pasek postaci nad nazwą (Pikselowa): poziom i pasek HP zależne od punktów życia karty
function pxStatus(p, variant) {
  if (!variantParts(variant).includes("pixel")) return "";
  return `<div class="px-status"><span>LV ${Math.min(99, Math.max(1, Math.round(p.hp / 3)))}</span><span class="px-bar"><i style="width:${Math.min(100, Math.max(12, p.hp / 2.5)).toFixed(0)}%"></i></span></div>`;
}

// ---------------------------------------------------------------- warianty z makiet (strona /variants, domyślnie wyłączone)
// Szlamowa, Matowa czerń, Wyścigowa retro, Bizmutowa, Cyfrowa, Cyberpunk, Gradient, Wanted, Art déco, Serowa.
// VX_BG - tło w środku karty (pod napisami, w .vx-bg), VX_PHOTO - nakładki na zdjęcie (.vx-photo), VX_DECO - nad całą kartą
// (variantLayers), variantTop - pasek nad nazwą, variantSub - tekst zamiast "typ · skrzynka". Wygląd: sekcja w cards2.css.
const vxN = (a, b, d = 0) => rand(a, b).toFixed(d);
const vxSvg = (body, vb = "0 0 63 88", cls = "") => `<svg class="${cls}" viewBox="${vb}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
// kapiący płyn z górnej krawędzi (losowe sople) - w jednostkach karty 63 x 88
function vxDrips(color, hi, long = [7, 18]) {
  let d = "M0 0 H63 V3 ", x = 63;
  while (x > 0) {
    const w = +vxN(3, 7, 1), len = Math.random() < 0.45 ? +vxN(...long, 1) : +vxN(3.5, 6, 1), nx = Math.max(0, x - w);
    const mid = (x + nx) / 2, r = Math.min(w / 2, 2.2);
    d += `L${x.toFixed(1)} 3 C${(x - w * .15).toFixed(1)} 3.5 ${(mid + r).toFixed(1)} ${(len - r * 2).toFixed(1)} ${(mid + r).toFixed(1)} ${(len - r).toFixed(1)} ` +
      `A${r} ${r} 0 0 1 ${(mid - r).toFixed(1)} ${(len - r).toFixed(1)} C${(mid - r).toFixed(1)} ${(len - r * 2).toFixed(1)} ${(nx + w * .15).toFixed(1)} 3.5 ${nx.toFixed(1)} 3 `;
    x = nx - +vxN(1, 4, 1);
  }
  d += "L0 3 Z";
  return `<path d="${d}" fill="${color}"/><path d="${d}" fill="none" stroke="${hi}" stroke-width=".35" opacity=".7" transform="translate(-.4 -.5)"/>`;
}
// powierzchnia płynu na wysokości y (fala), zamknięta do dołu karty
const vxWave = (y, amp = 1.6) => `M-1 ${y} Q7 ${y - amp} 15 ${y} T31 ${y} T47 ${y} T63 ${y} L64 ${y} V90 H-1 Z`;
const vxFloat = (n, cls, x = [4, 92]) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${vxN(...x)}%;--s:${vxN(0.5, 1.6, 2)};animation-delay:-${vxN(0, 9, 1)}s;animation-duration:${vxN(5, 11, 1)}s"></i>`).join("");
// Cyfrowa: kolumny znaków lecące z góry na dół (jak w Matrixie)
const DG_CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789Z:.=*+-<>";
const dgRain = n => Array.from({ length: n }, (_, k) => {
  const txt = Array.from({ length: 10 + Math.floor(rand(0, 14)) }, () => esc(DG_CHARS[Math.floor(rand(0, DG_CHARS.length))])).join("<br>");
  return `<i class="dg-col" style="left:${(k / n * 100 + rand(-1, 1)).toFixed(1)}%;animation-duration:${vxN(4, 9, 1)}s;animation-delay:-${vxN(0, 9, 1)}s;font-size:${vxN(2.6, 3.8, 1)}cqw">${txt}</i>`;
}).join("");
// Cyberpunk: nocne miasto z losowymi neonowymi oknami
function cpSkyline(base = 88, colors = ["#ff2bd6", "#00e5ff", "#fcee0a"]) {
  let out = "", x = -1;
  while (x < 64) {
    const w = rand(4, 9), h = rand(12, 38);
    out += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#0b0618"/>`;
    for (let yy = base - h + 1.5; yy < base - 1; yy += 2.4)
      for (let xx = x + 1; xx < x + w - 1; xx += 1.8)
        if (Math.random() < 0.28) out += `<rect x="${xx.toFixed(1)}" y="${yy.toFixed(1)}" width=".9" height="1.1" fill="${colors[Math.floor(rand(0, colors.length))]}" opacity="${vxN(.5, 1, 2)}"/>`;
    if (Math.random() < 0.3) out += `<rect x="${(x + w / 2 - .15).toFixed(1)}" y="${(base - h - 5).toFixed(1)}" width=".3" height="5" fill="#0b0618"/><circle cx="${(x + w / 2).toFixed(1)}" cy="${(base - h - 5).toFixed(1)}" r=".5" fill="#ff003c"/>`;
    x += w + rand(-.5, 1);
  }
  return out;
}
// Serowa: dziury różnej wielkości na całym tle
const chHoles = (n, big = [6, 16]) => Array.from({ length: n }, () =>
  `<i class="ch-hole" style="left:${vxN(-4, 92)}%;top:${vxN(-3, 95)}%;width:${vxN(...big, 1)}%"></i>`).join("");
// Frutiger Aero, Grecka, Afrykańska, Miodowa, Uliczna, Chińska (druga partia makiet) - kształty SVG w jednostkach karty 63 x 88.
// Gradienty SVG potrzebują unikalnych id (ta sama karta bywa na stronie kilka razy) - vxId.
let vxUid = 0;
const vxId = name => `${name}${++vxUid}`;
const vxPick = arr => arr[Math.floor(Math.random() * arr.length)];
function vxRainbow(cx, cy, r, w = 2.2, op = .75) {
  return ["#ff3b3b", "#ff9a1f", "#ffe13b", "#4fd12a", "#2fa8ff", "#5a4dff", "#b04dff"].map((c, k) => {
    const rr = r - k * w;
    return `<path d="M${cx - rr} ${cy} A${rr} ${rr} 0 0 1 ${cx + rr} ${cy}" fill="none" stroke="${c}" stroke-width="${w + .1}" opacity="${op}"/>`;
  }).join("");
}
// rybka płynąca w prawo (viewBox 0 0 40 24); stripes - białe paski jak u błazenka
const vxFish = (c1, c2, stripes = false) => `<svg viewBox="0 0 40 24" aria-hidden="true"><path d="M10 12 L1 3 L4 12 L1 21 Z" fill="${c2}"/><path d="M17 5 Q23 -2 30 5 Z" fill="${c2}"/>
  <ellipse cx="22" cy="12" rx="14" ry="8.5" fill="${c1}"/>${stripes ? `<ellipse cx="18" cy="12" rx="1.7" ry="8" fill="#fff"/><ellipse cx="27" cy="12" rx="1.5" ry="7.3" fill="#fff"/>` : ""}
  <ellipse cx="22" cy="8" rx="10" ry="3" fill="#fff" opacity=".35"/><circle cx="31" cy="10" r="1.8" fill="#fff"/><circle cx="31.5" cy="10" r=".9" fill="#111"/></svg>`;
const AERO_FISH = [["#ff7a1f", "#ffb03f", true], ["#ffd23f", "#2fa8ff"], ["#3fe0c0", "#2f6bff"]];
// błyszczące zielone wzgórze z trawą i stokrotkami (Frutiger Aero) - od wysokości y do dołu karty
function aeMeadow(g, y = 62) {
  let blades = "", daisies = "";
  for (let x = -2; x < 66; x += rand(1.1, 2.2)) {
    const yy = y - 2.6 * Math.cos((x - 31.5) / 20) + 1, h = rand(2.5, 5.5), lean = rand(-1.4, 1.4);
    blades += `<path d="M${(x - .6).toFixed(1)} ${(yy + 1).toFixed(1)} Q${(x + lean * .5).toFixed(1)} ${(yy - h * .6).toFixed(1)} ${(x + lean).toFixed(1)} ${(yy - h).toFixed(1)} Q${(x + .2).toFixed(1)} ${(yy - h * .5).toFixed(1)} ${(x + .6).toFixed(1)} ${(yy + 1).toFixed(1)} Z" fill="${vxPick(["#5fd61c", "#7ef03a", "#3fae0e"])}"/>`;
  }
  for (let k = 0; k < 7; k++) {
    const x = rand(3, 60), yy = y + rand(4, 18), r = rand(.9, 1.5);
    daisies += `<g transform="translate(${x.toFixed(1)} ${yy.toFixed(1)})">${[0, 60, 120, 180, 240, 300].map(a => `<ellipse rx="${(r * .45).toFixed(2)}" ry="${r.toFixed(2)}" transform="rotate(${a}) translate(0 ${(-r * .7).toFixed(2)})" fill="#fff"/>`).join("")}<circle r="${(r * .45).toFixed(2)}" fill="#ffd23f"/></g>`;
  }
  return `<defs><radialGradient id="${g}" cx=".4" cy="0" r="1.1"><stop offset="0" stop-color="#c8ff6a"/><stop offset=".45" stop-color="#4fbf14"/><stop offset="1" stop-color="#1f7a06"/></radialGradient></defs>
    <path d="M-3 ${y + 3} C14 ${y - 4} 48 ${y - 4} 66 ${y + 3} V92 H-3 Z" fill="url(#${g})"/>
    <path d="M-3 ${y + 3} C14 ${y - 4} 48 ${y - 4} 66 ${y + 3}" fill="none" stroke="#e8ffb0" stroke-width=".5" opacity=".8"/>${blades}${daisies}`;
}
const vxBubbles = (n, cls) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${vxN(4, 92)}%;--s:${vxN(0.5, 1.6, 2)};animation-delay:-${vxN(0, 9, 1)}s;animation-duration:${vxN(5, 11, 1)}s"></i>`).join("");
// pszczoła lecąca w prawo (viewBox 0 0 24 16), skrzydła machają (.bee-wing)
const VX_BEE = `<svg viewBox="0 0 24 16" aria-hidden="true"><ellipse class="bee-wing" cx="10" cy="4" rx="4.2" ry="3.2" fill="#ffffffcc" stroke="#9ab" stroke-width=".3"/>
  <ellipse class="bee-wing b" cx="13" cy="4.4" rx="3.6" ry="2.8" fill="#ffffffaa" stroke="#9ab" stroke-width=".3"/>
  <path d="M3 10 L1 10.6 L3 11.2 Z" fill="#222"/><ellipse cx="11" cy="10.5" rx="8" ry="4.6" fill="#ffc21f"/>
  <path d="M8 6.2 C7 9 7 12 8 14.8 M11.4 6 C10.4 9 10.4 12 11.4 15 M14.8 6.4 C13.8 9 13.8 12 14.8 14.6" stroke="#222" stroke-width="1.6" fill="none"/>
  <circle cx="19.5" cy="9.6" r="2.6" fill="#222"/><circle cx="20.4" cy="9" r=".7" fill="#fff"/><path d="M20 7.2 Q21 4.6 22.6 4.4 M19 7.2 Q19.4 4.6 20.6 3.8" stroke="#222" stroke-width=".4" fill="none"/></svg>`;
const hnBees = n => Array.from({ length: n }, () =>
  `<i class="hn-bee" style="--by:${vxN(8, 70)}%;animation-delay:-${vxN(0, 10, 1)}s;animation-duration:${vxN(8, 13, 1)}s">${VX_BEE}</i>`).join("");
// chiński lampion na sznurku (x, długość sznurka) i złote chmurki xiangyun
function cnLantern(x, len, s = 1) {
  const y = len + 5 * s;
  return `<path d="M${x} -1 V${len}" stroke="#e2b13c" stroke-width=".3"/><rect x="${x - 2 * s}" y="${len}" width="${4 * s}" height="${1.1 * s}" fill="#e2b13c"/>
    <ellipse cx="${x}" cy="${y + .6 * s}" rx="${4.6 * s}" ry="${5 * s}" fill="#d81e1e"/><ellipse cx="${x}" cy="${y + .6 * s}" rx="${2.4 * s}" ry="${5 * s}" fill="none" stroke="#a30d0d" stroke-width=".35"/>
    <ellipse cx="${x - 1.6 * s}" cy="${y - 1 * s}" rx="${1.2 * s}" ry="${2.4 * s}" fill="#ff8a6a" opacity=".5"/>
    <rect x="${x - 2 * s}" y="${y + 5.2 * s}" width="${4 * s}" height="${1.1 * s}" fill="#e2b13c"/><path d="M${x - 1 * s} ${y + 6.3 * s} V${y + 10 * s} M${x} ${y + 6.3 * s} V${y + 10.8 * s} M${x + 1 * s} ${y + 6.3 * s} V${y + 10 * s}" stroke="#e2b13c" stroke-width=".35"/>`;
}
const cnCloud = (x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 4 C0 1 3 0 4.4 1.6 C5 -.4 9 -.6 9.6 1.8 C11.6 1 13.6 2.6 12.8 4.6 Z M3 3.4 a1.2 1.2 0 1 1 2 .2 M8 2.8 a1.1 1.1 0 1 1 1.8 .4" fill="none" stroke="#e2b13c" stroke-width=".55" stroke-linecap="round"/>`;
// Piwna, Moro, Elektryczna, Neonowa, Synthwave, Emo, Motoryzacyjna (trzecia partia makiet).
// Piwna: piana z koronką na dole i drobnymi bańkami (SVG, wysokość y w jednostkach karty), bąbelki i krople rosy
function brFoam(y, c1 = "#fffdf6", c2 = "#efe0b8", ring = "#d9c79a") {
  const g = vxId("brFoam");
  let d = `M-3 -3 H66 V${y}`;
  for (let x = 66; x > -3;) { const w = rand(1.6, 3.4); d += ` Q${(x - w / 2).toFixed(1)} ${(y + rand(.9, 2.4)).toFixed(1)} ${(x - w).toFixed(1)} ${(y + rand(-.4, .5)).toFixed(1)}`; x -= w; }
  let s = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--br-f1, ${c1})"/><stop offset=".7" style="stop-color:var(--br-f1, ${c1})"/><stop offset="1" style="stop-color:var(--br-f2, ${c2})"/></linearGradient></defs>
    <path d="${d} Z" fill="url(#${g})"/>`;
  for (let k = 0; k < 80; k++) {
    const x = rand(-1, 64), yy = rand(-1, y + 1.5), r = rand(.2, .9) * (yy > y - 2.5 ? 1.5 : 1);
    s += `<circle cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="${r.toFixed(2)}" fill="none" style="stroke:var(--br-ring, ${ring})" stroke-width=".14" opacity=".75"/>`;
    if (r > .5) s += `<circle cx="${(x - r * .35).toFixed(1)}" cy="${(yy - r * .35).toFixed(1)}" r="${(r * .22).toFixed(2)}" fill="#fff"/>`;
  }
  for (let k = 0; k < 9; k++) {
    const x = rand(2, 61), r = rand(.8, 1.6);
    s += `<circle cx="${x.toFixed(1)}" cy="${(y + rand(.2, 1.4)).toFixed(1)}" r="${r.toFixed(2)}" fill="#fff6d455" stroke="#fff" stroke-width=".18"/>`;
  }
  return s;
}
// bąbelki jak w prawdziwym szkle: łańcuszki z kilku punktów na dnie (ten sam x, równe odstępy w czasie) i pojedyncze;
// każdy to osobna kulka z jasnym brzegiem i odblaskiem, która rośnie, przyspiesza i lekko się chwieje w drodze do piany
function brBubbles(chains = 6, per = 5, loose = 8) {
  const bub = (x, sz, dur, delay, sw) => `<i class="br-bub" style="left:${x}%;width:${sz}cqw;--sw:${sw}cqw;animation-duration:${dur}s;animation-delay:-${delay}s"></i>`;
  let out = "";
  for (let c = 0; c < chains; c++) {
    const x = vxN(6, 92, 1), sz = rand(.7, 1.25), dur = rand(3.4, 5.4), sw = vxN(-.9, .9, 2);
    for (let k = 0; k < per; k++) out += bub(x, (sz * rand(.85, 1.1)).toFixed(2), dur.toFixed(2), (dur * k / per).toFixed(2), sw);
  }
  for (let k = 0; k < loose; k++) out += bub(vxN(4, 94, 1), vxN(.5, 1.5, 2), vxN(4.5, 7.5, 2), vxN(0, 7, 2), vxN(-1.6, 1.6, 2));
  return out;
}
// krople rosy na zimnym szkle; część co jakiś czas spływa w dół, zostawiając czysty ślad
const brDew = (n, runs = 0) => Array.from({ length: n }, () =>
  `<i class="br-drop" style="left:${vxN(0, 98)}%;top:${vxN(0, 96)}%;width:${vxN(.7, 2.2, 1)}%"></i>`).join("") +
  Array.from({ length: runs }, () =>
    `<i class="br-run" style="left:${vxN(3, 95)}%;top:${vxN(4, 40)}%;animation-delay:-${vxN(0, 9, 1)}s;animation-duration:${vxN(7, 12, 1)}s"></i>`).join("");
// Moro: nieśmiertelniki z nazwą i numerem karty
const moTags = p => `<i class="mo-tags"><b><span>${esc(p?.name || "SZEREGOWY")}</span><span>NR ${String(p?.number || 7).padStart(4, "0")}-2137</span><span>GR. KRWI 0 RH+</span></b><b></b></i>`;
// Elektryczna: piorun - poszarpana linia od (x1, y1) do (x2, y2) z odgałęzieniami (jednostki karty)
function elBolt(x1, y1, x2, y2, branches = 2, jag = 3) {
  const steps = 10, pts = [[x1, y1]];
  for (let k = 1; k < steps; k++) { const t = k / steps; pts.push([x1 + (x2 - x1) * t + rand(-jag, jag), y1 + (y2 - y1) * t + rand(-jag * .3, jag * .3)]); }
  pts.push([x2, y2]);
  let d = "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
  for (let b = 0; b < branches; b++) {
    const [bx, by] = pts[2 + Math.floor(rand(0, steps - 4))], dir = Math.random() < .5 ? -1 : 1;
    let x = bx, y = by; d += ` M${x.toFixed(1)} ${y.toFixed(1)}`;
    for (let k = 0; k < 4; k++) { x += dir * rand(1.5, 4); y += rand(1.5, 4); d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
  }
  return d;
}
const elBoltSvg = (d, cls) => `<path class="el-bolt ${cls}" d="${d}"/><path class="el-core ${cls}" d="${d}"/>`;
// Motoryzacyjna: obrotomierz dookoła okrągłego zdjęcia (zdjęcie = promień 11.5 z 20 jednostek tarczy) - podziałka 0-9
// z czerwonym polem, cyfry i krótka wskazówka tylko na pierścieniu; na dole tarczy przerwa (bez obwódki) na podpis karty
function mtGauge() {
  let ticks = "";
  for (let k = 0; k <= 45; k++) {
    const a = (-225 + k * 6) * Math.PI / 180, big = k % 5 === 0, r1 = big ? 15.5 : 17, red = k >= 35;
    ticks += `<path d="M${(20 + Math.cos(a) * r1).toFixed(2)} ${(20 + Math.sin(a) * r1).toFixed(2)} L${(20 + Math.cos(a) * 18.5).toFixed(2)} ${(20 + Math.sin(a) * 18.5).toFixed(2)}" stroke="${red ? "#ff2b2b" : "#f2f2f2"}" stroke-width="${big ? .8 : .35}"/>`;
    if (big) ticks += `<text x="${(20 + Math.cos(a) * 13.6).toFixed(2)}" y="${(20 + Math.sin(a) * 13.6 + .9).toFixed(2)}" font-size="2.6" text-anchor="middle" fill="${red ? "#ff2b2b" : "#f2f2f2"}">${k / 5}</text>`;
  }
  const arc = a => `${(20 + Math.cos(a * Math.PI / 180) * 18.5).toFixed(2)} ${(20 + Math.sin(a * Math.PI / 180) * 18.5).toFixed(2)}`;
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M${arc(-15)} A18.5 18.5 0 0 1 ${arc(45)}" stroke="#ff2b2b55" stroke-width="2.5" fill="none"/>
    ${ticks}<g class="mt-needle"><path d="M20 8.3 L20 1.6" stroke="#ff4a1f" stroke-width="1.1" stroke-linecap="round"/></g></svg>`;
}
// Noir: pionowe rysy na taśmie filmowej, co chwilę w innym miejscu
const nrScratches = n => Array.from({ length: n }, () =>
  `<i class="nr-scratch" style="left:${vxN(6, 94)}%;animation-delay:-${vxN(0, 3, 2)}s;animation-duration:${vxN(1.4, 3.2, 2)}s"></i>`).join("");
// Día de Muertos: duże tła (czaszki na rozetach, aksamitki) są gotowymi obrazkami SVG liczonymi raz na stronę - jako
// żywe elementy byłyby to tysiące węzłów na każdej karcie
const dmFlower = (x, y, r, c1 = "#ff8a00", c2 = "#ffc21a") => {
  const ring = (n, d, rx, ry, c, o = 0) => Array.from({ length: n }, (_, k) =>
    `<ellipse cx="${x}" cy="${(y - d).toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="${c}" transform="rotate(${(k * 360 / n + o).toFixed(1)} ${x} ${y})"/>`).join("");
  return ring(12, r * .68, r * .25, r * .36, c1) + ring(10, r * .42, r * .22, r * .3, c2, 18) + ring(7, r * .2, r * .13, r * .2, c1, 8);
};
// cukrowa czaszka (40 x 46)
const dmSkull = (ink, a, b) => `<g fill="none" stroke="${ink}" stroke-width=".9" stroke-linecap="round">
  <path d="M20 3 C9 3 4 11 4 20 C4 26 7 30 11 32 L11 39 C11 41 13 42 15 42 H25 C27 42 29 41 29 39 L29 32 C33 30 36 26 36 20 C36 11 31 3 20 3 Z"/>
  <path d="M15 42 V36 M20 42 V36 M25 42 V36"/><path d="M14 8 C16 12 24 12 26 8"/></g>
  ${[[13, 21], [27, 21]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.4" fill="none" stroke="${a}" stroke-width="1"/><circle cx="${x}" cy="${y}" r="2.6" fill="${b}"/>
    ${Array.from({ length: 8 }, (_, k) => `<circle cx="${(x + Math.cos(k * .785) * 7).toFixed(1)}" cy="${(y + Math.sin(k * .785) * 7).toFixed(1)}" r=".7" fill="${ink}"/>`).join("")}`).join("")}
  <path d="M20 27 L17.6 31 H22.4 Z" fill="${a}"/>${dmFlower(20, 11.5, 3.6, a, ink)}`;
const DM_INKS = [["#ffb81a", "#ff2f92", "#19d3c5"], ["#ff2f92", "#ffb81a", "#19d3c5"], ["#19d3c5", "#ff7a00", "#ffd23a"], ["#fff0dc", "#ff2f92", "#8a3dff"],
  ["#ff7a00", "#19d3c5", "#ffe2a0"], ["#c58aff", "#ffd23a", "#ff2f92"]];
// tło karty 630 x 880: rozety ton w ton (ciemny i jaśniejszy fiolet) i czaszki w kolorach, rzędy przesunięte
function dmWall() {
  const petals = (cx, cy, n, r, l, w) => Array.from({ length: n }, (_, k) => `<ellipse cx="${cx}" cy="${cy - r}" rx="${w}" ry="${l}" transform="rotate(${(k * 360 / n).toFixed(1)} ${cx} ${cy})"/>`).join("");
  const ros = (x, y) => `<g fill="#2a0a6a">${petals(x, y, 12, 8, 3.4, 1.3)}</g><g fill="#7a2ec8">${petals(x, y, 12, 4.4, 1.9, .8)}</g><circle cx="${x}" cy="${y}" r="2" fill="#2a0a6a"/>`;
  let body = "";
  for (let y = 0; y <= 91; y += 13) for (let x = (Math.round(y / 13) % 2) * 13; x <= 66; x += 26) body += ros(x, y);
  for (let k = 0; k < 30; k++) {
    const row = Math.floor(k / 6), [ink, a, b] = DM_INKS[(k * 5 + row) % DM_INKS.length];
    const x = ((k % 6) * 17 + (row % 2 ? 8 : 0) - 4) * .63, y = (row * 20 - 2) * .88;
    body += `<g opacity=".7" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${k % 2 ? 9 : -9} 6.3 7.3) scale(.315)">${dmSkull(ink, a, b)}</g>`;
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 63 88'><defs/><rect width='63' height='88' fill='none'/>${body}</svg>`;
}
// aksamitki wzdłuż dolnej krawędzi z listkami
function dmBorder() {
  const bunch = ([x, y, r]) => `<ellipse cx="${x - r}" cy="${y + r * .6}" rx="${r * .9}" ry="${r * .36}" fill="#1f7a4a" transform="rotate(-24 ${x} ${y})"/>
    <ellipse cx="${x + r}" cy="${y + r * .6}" rx="${r * .9}" ry="${r * .36}" fill="#2f9a5a" transform="rotate(24 ${x} ${y})"/>${dmFlower(x, y, r)}`;
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 63 88' preserveAspectRatio='none'>${Array.from({ length: 12 }, (_, k) => bunch([2 + k * 5.4, 86 + (k % 2) * 1.4, 2.8 - (k % 2) * .6])).join("")}</svg>`;
}
// papel picado: chorągiewka z wycinanymi wzorami (nieparzyste wypełnienie = dziury)
function dmPicado(c) {
  const hole = (x, y, r) => `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`;
  const edge = "M0 0 H20 V21 Q18.3 25 16.6 21 Q15 25 13.3 21 Q11.7 25 10 21 Q8.3 25 6.7 21 Q5 25 3.3 21 Q1.7 25 0 21 Z";
  const cuts = [hole(10, 10, 3.4), hole(4, 4, 1.5), hole(16, 4, 1.5), hole(4, 16, 1.5), hole(16, 16, 1.5), hole(10, 3, 1), hole(10, 17.4, 1), hole(3.2, 10, 1), hole(16.8, 10, 1)].join(" ");
  return `<svg viewBox="0 0 20 26" preserveAspectRatio="none" aria-hidden="true"><path fill="${c}" fill-rule="evenodd" d="${edge} ${cuts}"/></svg>`;
}
const dmFlags = () => `<i class="dm-string"></i>${["#ff2f92", "#ffb81a", "#19d3c5", "#8a3dff", "#ff5a1f", "#3ddc84"].map((c, k) =>
  `<i class="dm-flag" style="left:${(k * 16.66).toFixed(2)}%;animation-delay:-${(k * .55).toFixed(2)}s">${dmPicado(c)}</i>`).join("")}`;
const dmPetals = n => Array.from({ length: n }, () =>
  `<i class="dm-petal" style="left:${vxN(0, 96)}%;--r:${vxN(-260, 260)}deg;--dx:${vxN(-12, 12)}cqw;animation-delay:-${vxN(0, 10, 1)}s;animation-duration:${vxN(6, 11, 1)}s"></i>`).join("");
const dmConfetti = n => Array.from({ length: n }, () =>
  `<i class="dm-petal dm-conf" style="left:${vxN(0, 96)}%;background:${["#ff2f92", "#19d3c5", "#ffd23a", "#8a3dff", "#ff7a00", "#3ddc84"][Math.floor(rand(0, 6))]};--r:${vxN(-420, 420)}deg;--dx:${vxN(-10, 10)}cqw;animation-delay:-${vxN(0, 9, 1)}s;animation-duration:${vxN(5, 9, 1)}s"></i>`).join("");
const DM_WING = `<svg viewBox="0 0 12 14" aria-hidden="true"><path d="M12 3 C7 -1 1 0 .6 4 C.3 7 4 8 7 8 C3 8.6 2 12 5 13.4 C8 14 11 11 12 9 Z" fill="#ff7a00" stroke="#1a0a02" stroke-width=".8"/>
  <path d="M12 5 L3 3.4 M12 6 L5 8 M12 8 L6 11" stroke="#1a0a02" stroke-width=".5"/><circle cx="2.4" cy="3" r=".5" fill="#fff"/><circle cx="4" cy="1.8" r=".4" fill="#fff"/></svg>`;
const dmButterfly = (x, y, s, d) => `<i class="dm-fly" style="left:${x}%;top:${y}%;--s:${s};animation-delay:-${d}s"><b class="l" style="animation-delay:-${d}s">${DM_WING}</b><b class="r" style="animation-delay:-${d}s">${DM_WING}</b></i>`;
// obrazki tła raz na stronę
// Paragon: kod kreskowy; Tarot: narożniki i gwiazdy
const rcBars = () => Array.from({ length: 46 }, () => `<i style="flex:${[1, 1, 2, 3][Math.floor(rand(0, 4))]}" class="${Math.random() < .5 ? "b" : ""}"></i>`).join("");
const TR_CORNER = '<path d="M2 28 C2 12 12 2 28 2 M6 28 C6 15 15 6 28 6 M10 10 C13 13 13 17 10 20 C7 17 7 13 10 10 Z M10 10 C13 7 17 7 20 10 C17 13 13 13 10 10 Z" fill="none" stroke="#e8c8ff" stroke-width="1"/><circle cx="10" cy="10" r="1.6" fill="#e8c8ff"/>';
const trCorners = () => ["tl", "tr", "bl", "br"].map(k => `<i class="tr-corner ${k}">${vxSvg(TR_CORNER, "0 0 30 30")}</i>`).join("");
const trStars = n => Array.from({ length: n }, () => `<i class="tr-star" style="left:${vxN(2, 96)}%;top:${vxN(2, 96)}%;--s:${vxN(.5, 1.5, 2)};animation-delay:-${vxN(0, 2.4, 1)}s"></i>`).join("");

// Telegazeta: sekundy tykają (kolumny cyfr przesuwane schodkami); Okienka 97: lawina błędów
const ttDigits = (s, cls) => `<span class="tt-dig ${cls}"><b>${s}</b></span>`;
const w9Dialogs = () => [0, 1, 2, 3, 4].map(k => `<i class="w9-dlg" style="--i:${k}"><b>Błąd</b><u>✖ Program wykonał nieprawidłową operację i zostanie zamknięty.</u></i>`).join("");

// Claude: 8 wiadomości (podwojonych, bez szwu), nowa wchodzi od dołu i wypycha starsze do góry (CSS clFeed, krok 2,5 s);
// --idx = numer wiersza: kropki przed odpowiedzią startują tuż przed wjazdem wiersza do okna (CSS cl-dots / cl-txt)
const CL_PAIRS = [["zrób po 6 mockupów XD", "Już się robi."], ["popraw oba", "Naprawione, ramka płynie."], ["zrób commit i push", "Wypchnięte."], ["postaraj się XD", "Postaram się XD"],
  ["wymyśl 2 nowe warianty", "Okienka 97 i Zdrapka?"], ["dodaj coś do tła", "Dodałem płatki i motyle."], ["włącz grę na localhoście", "Działa na porcie 5002."], ["wybieram 1.", "Przenoszę do gry."],
  ["super zachowaj tak", "Zostawiam bez zmian."], ["poeksperymentuj", "Mam 6 nowych wersji."], ["jeszcze jedna rzecz", "Słucham."]];
const clFeed = () => {
  const pairs = [...CL_PAIRS].sort(() => Math.random() - .5).slice(0, 4);
  const body = pairs.map(([q, a], k) => `<span class="me"><s>${q}</s></span><span class="ai" style="--idx:${k * 2 + 1}"><q></q><s><em class="cl-dots"><b></b><b></b><b></b></em><em class="cl-txt">${a}</em></s></span>`).join("");
  return `<i class="cl-window"><b class="cl-mask"><i class="cl-col">${body}${body}</i></b></i>`;
};
// Zdrapka: folia zdzierana monetą pas po pasie (czasy w zdCoin i zdStrip), wybuchy z kwotami
const zdFoil = () => `<i class="vx-photo zd-foil">${Array.from({ length: 7 }, (_, k) => `<u class="${k % 2 ? "r" : ""}" style="--i:${k}"></u>`).join("")}<em class="zd-here">ZDRAP TUTAJ</em><b class="zd-coin"></b></i>`;
const zdBurst = (t, x, y, r, w, c, ink) => `<b class="zd-burst" style="left:${x}%;top:${y}%;width:${w}%;--r:${r}deg;--c:${c};color:${ink}"><u>${t}</u></b>`;
const zdStars = n => Array.from({ length: n }, () => `<i class="zd-star" style="left:${vxN(2, 96)}%;top:${vxN(2, 96)}%;--s:${vxN(.6, 1.6, 2)};animation-delay:-${vxN(0, 2.4, 1)}s"></i>`).join("");

// Anime: linie szybkości z mangi - rysowane raz, ten sam obrazek na każdej karcie
let anSpeedSvg = "";
function anSpeed() {
  if (anSpeedSvg) return anSpeedSvg;
  const n = 54, p = (ang, r) => `${(31.5 + Math.cos(ang) * r).toFixed(2)} ${(44 + Math.sin(ang) * r * 1.3).toFixed(2)}`;
  return anSpeedSvg = vxSvg(Array.from({ length: n }, (_, k) => {
    const a = k / n * Math.PI * 2 + rand(-.03, .03), w = rand(.008, .03), r0 = rand(16, 26);
    return `<path d="M${p(a - w, 80)} L${p(a, r0)} L${p(a + w, 80)}Z" fill="#ffffffcc"/>`;
  }).join(""), "0 0 63 88", "an-speed");
}
const anSfx = (t, x, y, r, cls = "") => `<b class="an-sfx ${cls}" style="left:${x}%;top:${y}%;--r:${r}deg">${t}</b>`;

// COVID: cząsteczki wirusa w świetle kogutów (trzy obrazki w CSS: --cvd-v1...3)
const cvdFloats = n => Array.from({ length: n }, (_, k) => `<i class="cvd-float v${k % 3 + 1}" style="left:${vxN(4, 92)}%;top:${vxN(2, 78)}%;--s:${vxN(.8, 2.4, 2)};animation-delay:-${vxN(0, 12, 1)}s"></i>`).join("");

// Biała / Czarna (skrzynka szachów): relief figur pod zdjęciem; ornamenty to obrazki w CSS (cards2.css)
const CS_RELIEF = `<i class="cs-relief">${[..."♜♞♝♛♚♝♞♜"].map(c => `<b>${c}︎</b>`).join("")}</i>`;
const CS_CORNERS = c => ["tl", "tr", "bl", "br"].map(k => `<i class="${c} ${k}"></i>`).join("");

function dmImages() {
  if (dmImages.done) return;
  dmImages.done = true;
  const url = svg => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  document.documentElement.style.setProperty("--dm-wall", url(dmWall()));
  document.documentElement.style.setProperty("--dm-border", url(dmBorder()));
}
// Czekoladowa: kostki tabliczki czekolady (siatka wypukłych prostokątów z jasną krawędzią) - jednostki karty 63 x 88
function coBar(cols = 4, rows = 6) {
  let s = "";
  const w = 63 / cols, h = 88 / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * w + 1, y = r * h + 1;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(w - 2).toFixed(1)}" height="${(h - 2).toFixed(1)}" rx="1.2" class="co-sq"/>` +
      `<path d="M${(x + 1).toFixed(1)} ${(y + h - 3).toFixed(1)} V${(y + 1).toFixed(1)} H${(x + w - 3).toFixed(1)}" class="co-hi"/>`;
  }
  return s;
}
// Cukierkowa: posypka sypiąca się z góry (obraca się w locie) i migoczące gwiazdki cukru na zdjęciu
const CD_SPR = ["#ff3b5c", "#ffd23f", "#3ddc84", "#4fb8ff", "#ffffff", "#b04dff"];
const cdFall = n => Array.from({ length: n }, () =>
  `<i class="cd-fall" style="left:${vxN(2, 96)}%;background:${CD_SPR[Math.floor(rand(0, CD_SPR.length))]};--r:${vxN(-400, 400)}deg;animation-duration:${vxN(4, 8, 1)}s;animation-delay:-${vxN(0, 8, 1)}s"></i>`).join("");
const cdTwinkles = n => Array.from({ length: n }, () =>
  `<i class="cd-twinkle" style="left:${vxN(6, 90)}%;top:${vxN(6, 86)}%;animation-delay:-${vxN(0, 2.4, 1)}s"></i>`).join("");
// Hollywood '69: palma (sylwetka, pień zaczyna się w (5, 30), flip = lustrzane odbicie) - jednostki karty 63 x 88
const hyPalm = (x, y, s, c, flip = false) => `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})" fill="${c}"><path d="M4.4 30 C5 22 5.6 14 6.6 6 L7.6 6.2 C6.8 14 6.2 22 5.8 30 Z"/>
  <path d="M7 6 C3 2 -1 4 -3 7 C0 5 3 5 6.6 6.6 Z M7 6 C4 1 0 1 -2 2 C1 2 4 4 6.6 6.2 Z M7 6 C10 2 14 2 16 4 C13 3.6 10 4.6 7.6 6.6 Z M7 6 C11 4 15 6 16 9 C13 7 10 6.6 7.6 7 Z M7 6 C7 2 9 0 11 -1 C9.4 1.4 8.4 3.6 7.6 6.2 Z"/></g>`;
// palmy wyrastające zza dolnej krawędzi karty: dwie po lewej i ich lustrzane odbicie po prawej
const hyPalms = (c = "#2a0c2a") => vxSvg(hyPalm(-2, 63, 1, c) + hyPalm(6, 70, .75, c) + hyPalm(65, 63, 1, c, true) + hyPalm(57, 70, .75, c, true), "0 0 63 88", "hy-palms");
// nieruchome snopy reflektorów zza dolnej krawędzi: [x podstawy w %, kąt, szerokość u góry w %]
const HY_BEAMS = [[31, -21, 30], [31, -7, 30], [69, 7, 30], [69, 21, 30]];
// Bananowa: brązowe plamki pojawiające się w trzeciej ćwiartce cyklu dojrzewania (30 s, CSS bnSpot)
const bnSpots = n => Array.from({ length: n }, () => `<i class="bn-spot" style="left:${vxN(2, 94)}%;top:${vxN(2, 96)}%;--s:${vxN(.5, 1.6, 2)}"></i>`).join("");
// Rtęciowa: chromowe sople (gradient w pionowe pasy jasne/ciemne) i krople odrywające się od nich
const hgDrips = () => `<defs><linearGradient id="hgChrome" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="5" y2="0" spreadMethod="reflect">
  <stop offset="0" stop-color="#4a5260"/><stop offset=".45" stop-color="#e8ecf0"/><stop offset=".6" stop-color="#ffffff"/><stop offset="1" stop-color="#8a94a0"/></linearGradient></defs>${vxDrips("url(#hgChrome)", "#ffffff", [5, 10])}`;
const hgFalls = n => Array.from({ length: n }, () =>
  `<i class="hg-fall" style="left:${vxN(6, 92)}%;--s:${vxN(.7, 1.2, 2)};animation-delay:-${vxN(0, 5, 1)}s;animation-duration:${vxN(3, 5, 1)}s"></i>`).join("");
// Kalifornowa: smugi neutronów z rdzenia za zdjęciem
const cfNeutrons = n => Array.from({ length: n }, () =>
  `<i class="cf-n" style="--r:${vxN(0, 360)}deg;animation-delay:-${vxN(0, 2, 2)}s;animation-duration:${vxN(1, 2.2, 2)}s"></i>`).join("");
// Amerykańska: flaga USA 76 x 40 (13 pasów, pole z 50 gwiazdami) w szarościach; powiewa przekrzywiona w tle
// (us-tilt obraca całość, us-flagbox faluje, cienie fal us-ripple przesuwają się po pasach), w rogu zdjęcia samo pole z gwiazdami
const usStar = (x, y, r, fill) => `<path fill="${fill}" d="M${Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * .4 : r;
  return `${(x + Math.cos(a) * rr).toFixed(2)} ${(y + Math.sin(a) * rr).toFixed(2)}`;
}).join(" L")}Z"/>`;
function usFlag(red, white, blue, star) {
  let s = `<rect width="76" height="40" fill="${white}"/>`;
  for (let k = 0; k < 13; k += 2) s += `<rect y="${(k * 40 / 13).toFixed(2)}" width="76" height="${(40 / 13).toFixed(2)}" fill="${red}"/>`;
  s += `<rect width="30.4" height="21.54" fill="${blue}"/>`;
  for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) s += usStar(2.53 + c * 5.07 + (r % 2 ? 2.53 : 0), 2.15 + r * 2.15, .95, star);
  return s;
}
let usFlagCache = null;   // SVG flagi jest taki sam na każdej karcie
const usFlags = () => usFlagCache ||= {
  wave: vxSvg(usFlag("#3a3a3a", "#d0d0d0", "#141414", "#e4e4e4"), "0 0 76 40"),
  canton: `<svg viewBox="0 0 30.4 21.54" preserveAspectRatio="xMinYMin slice" aria-hidden="true">${usFlag("#000", "#000", "#0c0c0c", "#f2f2f2")}</svg>`,
};
// Akta: spinacz biurowy (viewBox 0 0 12 30)
const AK_CLIP = `<path d="M4 26 V6 a3 3 0 0 1 6 0 V24 a4.5 4.5 0 0 1 -9 0 V9" fill="none" stroke="#9aa2ac" stroke-width="1.3" stroke-linecap="round"/>
  <path d="M4.4 25.6 V6 a2.6 2.6 0 0 1 5.2 0" fill="none" stroke="#e8ecf0" stroke-width=".5" stroke-linecap="round"/>`;
// Miedziana: plamy patyny pojawiające się kolejno w drugiej połowie cyklu (CSS cuSpot, opóźnienia 0-3 s)
const cuSpots = n => Array.from({ length: n }, () =>
  `<i class="cu-spot" style="left:${vxN(-6, 90)}%;top:${vxN(-4, 92)}%;--s:${vxN(.7, 1.8, 2)};animation-delay:${vxN(0, 3, 2)}s"></i>`).join("");
// Apollo (retro kosmos, „Kontrola misji”): w tle krótka cicha pętla filmu z Apollo 11 (lądownik Orzeł nad kraterami, static/video/space,
// archiwum NASA, domena publiczna), na całej karcie złoto-srebrna klisza (smugi, ziarno, migotanie, rysy, winieta), na zdjęciu krzyżyki
// pomiarowe i złote narożniki, nad nazwą pasek z zegarem misji (apTick - cyfra odlicza 0-9 sama). Nad filmem tylko zwykłe filtry CSS i
// przezroczystość - mix-blend-mode i filtry SVG psują obraz w Chrome.
const apTick = () => '<span class="ap-tick"><i>0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9</i></span>';
const apScratches = n => Array.from({ length: n }, () =>
  `<i class="ap-scratch" style="left:${vxN(2, 96)}%;animation-delay:-${vxN(0, 6, 1)}s;animation-duration:${vxN(1.2, 3, 1)}s"></i>`).join("");
// Napis wariantu wpisywany w panelu (pole "texts" wariantu w game.json, np. dane na Wizytówce): karta (vx.<wariant>) >
// domyślny z /variants (variantCfg[v].texts) > wartość z kodu
export function variantText(p, v, k) {
  return p?.vx?.[v]?.[k] || S.cfg.variantCfg?.[v]?.texts?.[k] || S.cfg.variants?.[v]?.texts?.[k]?.default || "";
}
// Wizytówka (makieta Wizytówka 3 „Korporacyjna”): granatowy pasek z logo i nazwą firmy (variantTop), kod QR w rogu zdjęcia,
// stanowisko i dane kontaktowe zamiast „typ · skrzynka” (variantSub) - napisy z variantText.
function wzSub(p) {
  const t = k => esc(variantText(p, "wizytowka", k));
  return `<span class="wz-title">${t("title")}</span><span class="wz-contact"><b>☎ ${t("phone")}</b><b>✉ ${t("email")}</b><b>⌂ ${t("address")}</b></span>`;
}
// Analog horror (makieta „Sekwencja nadawania”): granatowa plansza systemu ostrzegania. W miejscu zdjęcia pętla 12 s - godło
// „URZĄD OBRONY CYWILNEJ · SCAMBOX”, zdjęcie z migającym napisem, niebiesko-biały komunikat o schronie; na każdej planszy te same
// zakłócenia (rwące się paski = kopie planszy przycięte do pasków, rozjechane kolory, toczący się pas, linie obrazu, ziarno, błyski
// szumu). W tle obraca się godło. Napisy z panelu (variantText: warn, sub, bar, wait, shelter), własne zdjęcie wariantu.
const ahNoise = (op = .35) => `<i class="ah-noise" style="opacity:${op}"></i>`;
let ahSealCache = null;
const ahSeal = (cls = "ah-seal") => (ahSealCache ||= `<defs><path id="ahRing" d="M50 50 m-37 0 a37 37 0 1 1 74 0 a37 37 0 1 1 -74 0"/></defs>
  <circle cx="50" cy="50" r="47" fill="#0a1550" stroke="#dfe6ff" stroke-width="2.4"/><circle cx="50" cy="50" r="30" fill="none" stroke="#dfe6ff" stroke-width="1.2"/>
  <text font-size="8.2" font-family="Share Tech Mono, monospace" fill="#dfe6ff" letter-spacing="1.2"><textPath href="#ahRing">URZĄD OBRONY CYWILNEJ ✦ SCAMBOX ✦ </textPath></text>
  <path d="M33 44 L50 35 L67 44 L67 64 L50 72 L33 64Z M33 44 L50 53 L67 44 M50 53 V72" fill="none" stroke="#dfe6ff" stroke-width="2.2" stroke-linejoin="round"/>
  <rect x="45" y="49" width="10" height="7" rx="1.5" fill="#dfe6ff"/>`).replace(/^/, `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">`) + "</svg>";
const AH_SIGN = `<svg class="ah-sign" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#dfe6ff"/>${[0, 120, 240].map(a =>
  `<path d="M20 20 L13 7.5 A14.5 14.5 0 0 1 27 7.5Z" fill="#0a1550" transform="rotate(${a} 20 20)"/>`).join("")}<circle cx="20" cy="20" r="4.2" fill="#dfe6ff"/><circle cx="20" cy="20" r="19" fill="none" stroke="#0a1550" stroke-width="1.2"/></svg>`;
const ahTears = (html, n) => Array.from({ length: n }, () =>
  `<i class="ah-tear" style="--y:${vxN(6, 82)}%;--h:${vxN(3, 9)}%;animation-delay:-${vxN(0, 4, 1)}s;animation-duration:${vxN(2.2, 4.2, 1)}s">${html}</i>`).join("");
function analogPhoto(p, variant) {
  const t = k => esc(variantText(p, "analog", k));
  const img = `<img src="${imgUrl(p.id, variant)}" alt="" loading="lazy" draggable="false">`;
  const logo = `<i class="ah-face">${ahSeal()}<b>${t("wait")}</b></i>`;
  const shelter = `<i class="ah-face shelter">${AH_SIGN}<b>${t("shelter")}</b><small>ZACHOWAJ SPOKÓJ · ZABIERZ DOKUMENTY</small></i>`;
  return `<i class="vx-photo ah-chroma r">${img}</i><i class="vx-photo ah-chroma c">${img}</i>
    <i class="vx-photo ah-phase ah-ph-photo">${ahTears(img, 2)}<span class="ah-warn">${t("warn")}</span></i>
    <i class="vx-photo ah-phase ah-ph-logo">${logo}${ahTears(logo, 2)}</i>
    <i class="vx-photo ah-phase ah-ph-shelter">${shelter}${ahTears(shelter, 2)}</i>
    <i class="vx-photo ah-scan top"></i><i class="vx-photo ah-roll"></i><i class="vx-photo ah-grain">${ahNoise(.16)}</i><i class="vx-photo ah-burst">${ahNoise(1)}</i>`;
}
// Polska (event Dzień Niepodległości, makieta Polska 1): biało-czerwona karta - w tle łowicka wycinanka (obrazek w CSS),
// biało-czerwone szarfy w dwóch rogach karty, kotylion w rogu zdjęcia, baner „11 LISTOPADA” nad nazwą.
// Celowo bez godła (godło RP jest chronione prawem) - tylko flaga, kotylion i motywy ludowe. Inna niż Flagowa (ta barwi kartę).
// Polska: zamiast flag na drzewcach biało-czerwone szarfy owinięte wokół lewego górnego i prawego dolnego rogu (makieta „Szarfy w rogach”)
const PLS_SASHES = '<div class="vx-deco vx-clip"><i class="pls-sash a"><u></u></i><i class="pls-sash b"><u></u></i></div>';

// punkty na obwodzie karty (lampki, iskierki): n punktów, f(x%, y%, k)
const vxPerimeter = (n, f) => Array.from({ length: n }, (_, k) => {
  let d = k / n * 302, x, y;
  if (d < 63) { x = d; y = 0; } else if ((d -= 63) < 88) { x = 63; y = d; } else if ((d -= 88) < 63) { x = 63 - d; y = 88; } else { x = 0; y = 88 - (d - 63); }
  return f((x / .63).toFixed(1), (y / .88).toFixed(1), k);
}).join("");

// Świąteczny (makieta „Sanie nad miastem”): nad nazwą nocne niebo z sańmi (variantTop), w tle karty ośnieżone miasteczko
// z zapalającymi się oknami i dymem z komina (VX_BG), śnieg i lampki biegnące po ramce (VX_DECO), naklejki od admina (czapka Mikołaja).
const XM_COLORS = ["#ff3b3b", "#ffd23d", "#2bd96b", "#3ba2ff", "#ff7ad9"];
const xmDeer = c => `<g fill="${c}" stroke="${c}" stroke-linecap="round"><ellipse cx="18" cy="16" rx="11" ry="5" stroke="none"/><path d="M26 14 L31 6 L36 6 L37 8.5 L32 9.5 L29 16Z" stroke="none"/><path d="M32 6 L30 1 M31 3 L28 2 M34 6 L35 1 M34.5 3 L37.5 2 M10 19 L7 28 M13 20 L14 28 M23 20 L22 28 M26 19 L29 27" stroke-width="1.6" fill="none"/></g>`;
const XM_SLEIGH = `<svg class="xm-sleigh" viewBox="0 0 116 28" aria-hidden="true"><g fill="#f6dc7a"><path d="M4 12 Q4 20 11 20 H30 L34 11 H24 L20 5 H12Z"/><circle cx="17" cy="4" r="3"/><path d="M13 7 Q17 2 21 7 L21 11 H13Z"/></g><path d="M1 24 H31 Q36 24 36 19 M10 20 V24 M26 20 V24" stroke="#f6dc7a" stroke-width="1.5" fill="none"/><path d="M34 14 L44 14 M58 14 L68 14 M82 14 L92 14" stroke="#f6dc7a" stroke-width=".8"/>${[40, 64, 88].map(x => `<g transform="translate(${x} -2) scale(.7)">${xmDeer("#f6dc7a")}</g>`).join("")}</svg>`;
const XM_TOWN = `<svg class="xm-town" viewBox="0 40 100 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 100 V70 L8 62 L16 70 V60 H22 V54 L32 44 L42 54 V66 L50 58 L60 66 V52 L68 46 L76 52 V68 L84 60 L92 68 L100 62 V100Z" fill="#1a0f1c"/><path d="M0 70 L8 62 L16 70 M22 54 L32 44 L42 54 M42 66 L50 58 L60 66 M60 52 L68 46 L76 52 M76 68 L84 60 L92 68" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>${[[5, 76], [9, 86], [27, 62], [34, 70], [27, 80], [48, 72], [52, 84], [65, 60], [71, 74], [66, 86], [86, 76], [94, 80], [90, 90]].map(([x, y], k) => `<rect class="xm-win" x="${x}" y="${y}" width="4" height="5" fill="#ffd36e" style="animation-delay:-${(k * .7).toFixed(1)}s"/>`).join("")}<rect x="64" y="41" width="5" height="9" fill="#1a0f1c"/></svg>`;
const xmLights = n => vxPerimeter(n, (x, y, k) => `<i class="xm-bulb" style="left:${x}%;top:${y}%;--c:${XM_COLORS[k % 5]};animation-delay:${(k * .08).toFixed(2)}s"></i>`);
const xmSky = () => `<div class="xm-sky"><i class="xm-moon"></i>${Array.from({ length: 7 }, () => `<i class="xm-star" style="left:${vxN(4, 70)}%;top:${vxN(10, 80)}%;--s:${vxN(.5, 1.2, 2)};animation-delay:-${vxN(0, 2, 1)}s"></i>`).join("")}<i class="xm-fly">${XM_SLEIGH}<i class="xm-trail"></i></i></div>`;

// Choinka (makieta „Bombki przed zdjęciem”): gałązki świerku z górnych rogów, złota gwiazda nad nazwą, bombki po bokach
// i pięć bombek zwisających z górnej krawędzi zdjęcia (VX_PHOTO).
const treBranch = (cls, rot) => `<svg class="tre-branch ${cls}" viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(${rot} 50 50)"><path d="M50 98 L50 4" stroke="#3a2a18" stroke-width="2.2"/>${Array.from({ length: 16 }, (_, k) => { const y = 8 + k * 5.6, l = 6 + k * 1.9;
  return `<path d="M50 ${y.toFixed(1)} l${l.toFixed(1)} ${(l * .55).toFixed(1)} M50 ${y.toFixed(1)} l-${l.toFixed(1)} ${(l * .55).toFixed(1)}" stroke="${k % 2 ? "#1f6b3a" : "#2a8a4a"}" stroke-width="2.6" stroke-linecap="round"/>`; }).join("")}</g></svg>`;
const TRE_BRANCHES = `${treBranch("a", 135)}${treBranch("b", -135)}`;
const TRE_COLORS = ["#c41e3a", "#d4af37", "#2a7de1", "#e8e8f0", "#8a2be2", "#e84a8a"];
const TRE_PATTERNS = ["", "stripe", "dots"];
// bombki: n sztuk równo od x0 do x1 (% szerokości), długość nitki z zakresu lens (cqw), y = miejsce zawieszenia (%)
const treBalls = (n, x0, x1, lens, y = -2) => Array.from({ length: n }, (_, k) =>
  `<i class="tre-ball ${TRE_PATTERNS[Math.floor(rand(0, 3))]}" style="left:${(x0 + (x1 - x0) * (n > 1 ? k / (n - 1) : .5)).toFixed(1)}%;top:${y}%;--len:${vxN(lens[0], lens[1], 1)}cqw;--c:${TRE_COLORS[(k + Math.floor(rand(0, 6))) % 6]};--sz:${vxN(4.5, 7.5, 1)}cqw;animation-delay:-${vxN(0, 3, 1)}s"></i>`).join("");

// Prezentowy (makieta 1 „Kokarda i rozdarcie”): odpakowana karta ma złotą wstążkę dookoła ramki i małą kokardę w rogu.
// Moja karta, której jeszcze nie odpakowałem (S.unwrapped), jest zapakowana w papier (giftWrapHTML nad całą kartą);
// odpakowanie i „Zapakuj ponownie” w podglądzie (fx/effects.ts) grają tę samą animację w obie strony (klasy unwrap / rewrap).
const isGift = v => variantParts(v || "").includes("gift");
const GF_BOW = cls => `<i class="gf-bow ${cls}"><b class="tl l"></b><b class="tl r"></b><b class="lp l"></b><b class="lp r"></b><b class="kn"></b></i>`;
export const giftWrapped = (variant, uid) => isGift(variant) && +uid > 0 && S.items.some(i => i.id === +uid) && !S.unwrapped?.has(+uid);
export const giftRewrappable = (variant, uid) => isGift(variant) && +uid > 0 && S.items.some(i => i.id === +uid) && !!S.unwrapped?.has(+uid);
export const giftWrapHTML = (cls = "") => `<div class="gf-wrap ${cls}"><i class="gf-half l"></i><i class="gf-half r"></i><i class="gf-rib v"></i><i class="gf-rib h"></i>${GF_BOW("")}${
  Array.from({ length: 12 }, () => `<i class="gf-scrap" style="left:${vxN(40, 60)}%;top:${vxN(35, 60)}%;--dx:${vxN(-30, 30)}cqw;--dy:${vxN(10, 60)}cqw;--r:${vxN(-400, 400)}deg"></i>`).join("")}</div>`;
const giftWrap = (variant, uid) => giftWrapped(variant, uid) ? giftWrapHTML() : "";
const PLS_KOTYLION = `<svg class="pls-kot" viewBox="0 0 40 52" aria-hidden="true"><path d="M14 28 L8 50 L14 46 L18 51 L20 30Z M26 28 L32 50 L26 46 L22 51 L20 30Z" fill="#dc143c"/>
  ${Array.from({ length: 16 }, (_, k) => `<ellipse cx="20" cy="9" rx="3.6" ry="9" fill="${k % 2 ? "#dc143c" : "#fff"}" transform="rotate(${k * 22.5} 20 20)"/>`).join("")}
  <circle cx="20" cy="20" r="7" fill="#fff"/><circle cx="20" cy="20" r="4.4" fill="#dc143c"/></svg>`;
// Tabloid: żółte kółko, strzałka i napis na zdjęciu. Położenie (środek x, y w % zdjęcia), skala s i obrót r każdego
// elementu oraz napis ustawia admin w edycji karty (pole karty vx.tabloid, catalog::clean_vx) - tu wartości domyślne.
export const TABLOID_DEF = { circle: { x: 62, y: 34, s: 1, r: 0 }, arrow: { x: 30, y: 58, s: 1, r: -35 }, text: { x: 20, y: 86, s: 1, r: -4 } };
export const TABLOID_LABEL = "TO ON!";
export function tabloidMarks(t = null) {
  const at = k => { const o = { ...TABLOID_DEF[k], ...(t?.[k] || {}) }; return `left:${o.x}%;top:${o.y}%;--s:${o.s};--r:${o.r}deg`; };
  return `<i class="tb-mark tb-circle" data-k="circle" style="${at("circle")}"></i>` +
    `<i class="tb-mark tb-arrow" data-k="arrow" style="${at("arrow")}"><svg viewBox="0 0 40 14" aria-hidden="true"><path d="M1 7 H28 M26 1.5 L38 7 L26 12.5Z" stroke="#ffd400" stroke-width="3" stroke-linejoin="round" fill="#ffd400"/></svg></i>` +
    `<b class="tb-mark tb-him" data-k="text" style="${at("text")}">${esc(t?.label || TABLOID_LABEL)}</b>`;
}
// Barbie (makieta Barbie 2 „Brokatowa ramka”): ramka z migoczącego brokatu (CSS), po niej wędruje błysk (bbg-shine), iskierki
// rozłożone po obwodzie karty (bbgGlints), brokatowe serce nad nazwą (variantTop), różowa satyna w środku.
const bbgGlints = n => Array.from({ length: n }, (_, k) => {
  let d = k / n * 302, x, y;
  if (d < 63) { x = d; y = 0; } else if ((d -= 63) < 88) { x = 63; y = d; } else if ((d -= 88) < 63) { x = 63 - d; y = 88; } else { x = 0; y = 88 - (d - 63); }
  return `<i class="bbg-glint" style="left:${(x / .63).toFixed(1)}%;top:${(y / .88).toFixed(1)}%;--s:${vxN(.5, 1.2, 2)};animation-delay:-${vxN(0, 3, 1)}s;animation-duration:${vxN(1.4, 2.8, 1)}s"></i>`;
}).join("");
// Hawajska (makieta Hawajska 2 „Pod palmami”): liście palm wchodzą na kartę z trzech rogów i się kołyszą, hibiskusy i plumerie
// przy krawędziach, plamki słońca przesuwają się po lagunie. Naklejki od admina (wbudowane: lei, hibiskus, ananas, ukulele...).
const hiFlower = (x, y, r, c, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot})">${Array.from({ length: 5 }, (_, k) =>
  `<ellipse cx="0" cy="${(-r * .55).toFixed(2)}" rx="${(r * .42).toFixed(2)}" ry="${(r * .6).toFixed(2)}" fill="${c}" transform="rotate(${k * 72})"/>`).join("")}
  <circle r="${(r * .2).toFixed(2)}" fill="#ffe14d"/><path d="M0 0 L${(r * .15).toFixed(2)} ${(-r * .7).toFixed(2)}" stroke="#ffe14d" stroke-width="${(r * .08).toFixed(2)}"/></g>`;
const hiPlumeria = (x, y, r, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot})">${Array.from({ length: 5 }, (_, k) =>
  `<ellipse cx="${(r * .18).toFixed(2)}" cy="${(-r * .5).toFixed(2)}" rx="${(r * .32).toFixed(2)}" ry="${(r * .58).toFixed(2)}" fill="#fffaf0" stroke="#f5d9a8" stroke-width=".15" transform="rotate(${k * 72})"/>`).join("")}
  <circle r="${(r * .28).toFixed(2)}" fill="#ffd23d"/></g>`;
const hiFrond = (cls, rot) => `<svg class="hi-frond ${cls}" viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(${rot} 50 50)"><path d="M50 98 Q52 60 50 4" stroke="#1d7a3a" stroke-width="2" fill="none"/>
  ${Array.from({ length: 13 }, (_, k) => { const y = 10 + k * 6.5, l = (14 + Math.sin(k / 12 * Math.PI) * 20).toFixed(1);
    return `<path d="M50.5 ${y} q${(l * .55).toFixed(1)} -2 ${l} 8 q-${(l * .5).toFixed(1)} -1 -${l} -6Z" fill="#26a352"/><path d="M49.5 ${y} q-${(l * .55).toFixed(1)} -2 -${l} 8 q${(l * .5).toFixed(1)} -1 ${l} -6Z" fill="#2fbf61"/>`; }).join("")}</g></svg>`;
let hiDecoCache = null;   // ten sam rysunek na każdej karcie
const hiDeco = () => hiDecoCache ||= hiFrond("f1", -40) + hiFrond("f2", 130) + hiFrond("f3", 40) +
  vxSvg(hiFlower(2, 86, 5, "#ff3d7f", 20) + hiFlower(62, 46, 4.6, "#ffcf3d", 60) + hiPlumeria(7, 88, 3.2, 10), "0 0 63 88", "hi-flowers");
export const VX_BG = {
  jelly: () => '<i class="jly-glow a"></i><i class="jly-glow b"></i>',
  crystal: () => '<i class="cry-shim"></i>',
  ice: () => '<i class="ic-prism"></i>',
  christmas: () => `<i class="xm-sheen"></i>${XM_TOWN}<i class="xm-smoke"><b></b><b></b><b></b></i>`,
  snow: () => '<i class="snw-fog"></i>',
  anime: anSpeed,
  hawaii: () => '<i class="hi-dapple"></i>',
  analog: () => `${ahSeal("ah-seal ah-spin")}<i class="ah-scan"></i>${ahNoise(.08)}`,
  chesswhite: () => `<i class="cs-gloss"></i>${CS_RELIEF}`,
  chessblack: () => `<i class="cs-gloss"></i>${CS_RELIEF}`,
  covid: () => `<i class="cvd-beam"></i>${cvdFloats(11)}`,
  scratch: () => `${zdStars(26)}<i class="zd-line a">5 ZŁ ★ 50 ZŁ ★ 500 ZŁ ★ 5 000 ZŁ</i><i class="zd-line b">CENA LOSU 500 GR ★ SZANSA 1:4,2</i>`,
  teletext: () => '<i class="tt-bars"></i><i class="tt-grid"></i><i class="tt-ticker"><b>PRZEPRASZAMY ZA USTERKI +++ AWARIA NADAJNIKA +++ ZARAZ WRACAMY +++ NIE REGULUJ ODBIORNIKA +++ </b></i>',
  receipt: () => `<i class="rc-bars">${rcBars()}</i>`,
  tarot: () => `<i class="tr-eight"></i>${trStars(30)}`,
  muertos: () => { dmImages(); return '<i class="dm-wallimg"></i>'; },
  // Komunistyczna: nieruchome promienie z prawego dolnego rogu, ciemniejsza czerwień przy dole, ziarno papieru
  komuna: () => '<i class="kv-rays"></i><i class="kv-dark"></i><i class="kv-paper"></i>',
  apollo: () => '<video class="ap-film" src="/static/video/space/lm-orbit.mp4" autoplay muted loop playsinline preload="auto" disablepictureinpicture></video>' +
    '<span class="ap2-tm l">ALT 47 920 FT<br>VEL 1 604 FT/S</span><span class="ap2-tm r">ORZEŁ ▲<br>KOLUMBIA ▼</span><i class="ap-shade"></i>',
  copper: () => `<i class="cu-brush"></i><i class="cu-dark"></i>${cuSpots(16)}<i class="cu-full"></i>`,
  files: () => '<i class="ak-paper"></i>',
  usa: () => `<i class="us-tilt"><i class="us-flagbox">${usFlags().wave}</i><i class="us-ripple"></i></i><i class="us-spot"></i>`,
  banana: () => `<i class="bn-fibers"></i><i class="bn-green"></i>${bnSpots(22)}<i class="bn-brown"></i>`,
  uranium: () => `${Array.from({ length: 12 }, () => `<i class="ur-bubble" style="left:${vxN(2, 96)}%;top:${vxN(2, 96)}%;--s:${vxN(.4, 1.4, 2)}"></i>`).join("")}<i class="ur-uv"></i><i class="ur-streak"></i>`,
  mercury: () => Array.from({ length: 6 }, (_, k) => `<i class="hg-blob b${k}"></i>`).join(""),
  californium: () => `<i class="cf-core"></i>${cfNeutrons(18)}`,
  // Kobaltowa: poświata Czerenkowa z dołu i falujące światło odbite od wody
  cobalt: () => '<i class="cb-glow"></i><i class="cb-ripple"></i><i class="cb-ripple b"></i>',
  hollywood: () => HY_BEAMS.map(([x, a, w]) => `<i class="hy-beam" style="left:${x}%;--a:${a}deg;width:${w}%"></i>`).join("") + hyPalms(),
  candy: () => '<i class="cd-stripes"></i>',
  chocolate: () => vxSvg(coBar(), "0 0 63 88", "co-bar"),
  reflective: () => '<i class="rf-fluo"></i><i class="rf-band a"></i><i class="rf-band b"></i><i class="rf-glow"></i>',
  steel: () => '<i class="stl-shine"></i>',
  noir: () => '<i class="nr-rain soft"></i>',
  beer: () => `<i class="br-body"></i>${brBubbles()}`,
  electric: () => '<i class="el-clouds"></i><i class="el-rain"></i>',
  // Synthwave: na dole tła zachodzi słońce w paski (spod paneli z napisami)
  synthwave: () => '<i class="sw-sun"></i><i class="sw-glow"></i>',
  aero: () => `${vxSvg(vxRainbow(10, 40, 26, 1.8, .45), "0 0 63 88", "ae-rainbow")}<i class="ae-cloud c1"></i><i class="ae-cloud c2"></i>${vxSvg(aeMeadow(vxId("aeHill")))}`,
  honey: () => '<i class="hn-shine"></i>',
  chinese: () => vxSvg(cnCloud(6, 40, 1) + cnCloud(42, 60, .9) + cnCloud(10, 78, .8)),
  racing: () => '<i class="rc-band"></i><i class="rc-grain"></i>',
  bismuth: () => '<i class="bi-iso"></i><i class="bi-iso-tint"></i>',
  digital: () => `<span class="dg-rain">${dgRain(14)}</span>`,
  cyber: () => `${vxSvg(cpSkyline(), "0 0 63 88", "cp-city")}<i class="cp-rain"></i>`,
  fade: () => '<i class="fd-sheen"></i>',
  artdeco: () => '<i class="ad-fans"></i>',
  // ser z dziurami (makieta 1.) + trochę niebiesko-zielonej pleśni przy brzegach (makieta 3.)
  cheese: () => `${chHoles(15)}<i class="ch-mold"></i>`,
};
export const VX_PHOTO = {
  jelly: '<i class="vx-photo jly-shine"></i>',
  crystal: '<i class="vx-photo cry-ice"></i><i class="vx-photo cry-facet"></i><i class="vx-photo cry-glow"></i><i class="vx-photo cry-shim"></i>',
  ice: '<i class="vx-photo ic-light"></i><i class="vx-photo ic-dark"></i><i class="vx-photo ic-glare"></i>',
  tree: () => treBalls(5, 10, 90, [.5, 4], 0),
  scratch: uid => scratchPhoto(uid),   // scratch.js: folia do zdrapania / zdrapana / pokaz (bez numeru egzemplarza)
  chesswhite: `<i class="vx-photo cs-fade"></i><i class="vx-photo cs-orn">${CS_CORNERS("cs-v")}<i class="cs-crest"></i></i>`,
  chessblack: '<i class="vx-photo cs-fade"></i><i class="vx-photo cs-orn"><i class="cs-beads"></i></i>',
  covid: '<i class="vx-photo cvd-tint"></i><b class="cvd-scale"><u></u>100 nm</b>',
  barbie: '<i class="vx-photo bbg-rim"></i>',
  polska: `<i class="vx-photo pls-light"></i>${PLS_KOTYLION}`,
  // Polaroid: filtr odbitki, ciemna warstwa wywoływania znika w pętli 10 s, winieta
  polaroid: '<i class="vx-photo pd-tone"></i><i class="vx-photo pd-develop"></i><i class="vx-photo pd-vig"></i>',
  wizytowka: '<i class="vx-photo wz-qr"></i>',
  hawaii: '<i class="vx-photo hi-warm"></i><i class="vx-photo hi-shade"></i>',
  receipt: '<i class="vx-photo rc-dots"></i>',
  muertos: '<i class="vx-photo dm-f1"></i>',
  komuna: '<i class="vx-photo kv-ink"></i><i class="vx-photo kv-offset"></i>',
  copper: '<i class="vx-photo cu-ph"></i>',
  files: '<i class="vx-photo ak-old"></i><b class="ak-stamp">ŚCIŚLE<br>TAJNE</b>',
  usa: () => `<i class="vx-photo us-stripes"></i><i class="vx-photo us-canton">${usFlags().canton}</i>`,
  apollo: () => '<i class="vx-photo ap2-reseau"></i><i class="vx-photo ap2-corners"></i>',
  banana: '<i class="vx-photo bn-warm"></i><b class="bn-sticker"><small>DZIEŃ</small>1 → 7<small>SCAMBOX</small></b>',
  uranium: '<i class="vx-photo ur-pulse"></i>',
  cobalt: '<i class="vx-photo cb-blue"></i>',
  chocolate: '<i class="vx-photo co-tint"></i>',
  candy: () => `<i class="vx-photo cd-sugar"></i>${cdTwinkles(3)}`,
  steel: '<i class="vx-photo stl-cold"></i>',
  // ...i kilka łańcuszków bąbelków na zdjęciu (krótsza droga do góry)
  beer: () => `<i class="vx-photo br-amber"></i><i class="vx-photo br-bubs">${brBubbles(3, 4, 4)}</i><i class="vx-photo br-glass"></i>`,
  electric: '<i class="vx-photo el-strike"></i>',
  aero: '<i class="vx-photo ae-glass"></i>',
  honey: '<i class="vx-photo hn-amber"></i>',
  slime: '<i class="vx-photo sl-tint"></i>',
  bismuth: '<i class="vx-photo bi-oxide"></i>',
  digital: '<i class="vx-photo dg-crt"></i>',
  cyber: '<i class="vx-photo cp-duo"></i>',
  fade: '<i class="vx-photo fd-tint"></i>',
};
export const VX_DECO = {
  // Día de Muertos: płatki i konfetti, motyle, zygzak, chorągiewki, pas aksamitek
  tarot: () => `<div class="vx-deco">${trCorners()}<i class="tr-frame"></i></div>`,
  retroos: () => `<div class="vx-deco vx-clip">${w9Dialogs()}</div>`,
  chesswhite: () => `<div class="vx-deco"><i class="cs-rline"></i>${CS_CORNERS("cs-vc")}</div>`,
  chessblack: () => '<div class="vx-deco"><i class="cs-beads card"></i><u class="cs-pearl a"></u><u class="cs-pearl b"></u><u class="cs-pearl c"></u><u class="cs-pearl d"></u></div>',
  covid: () => '<div class="vx-deco"><i class="cvd-sms"><b>⚠ KOMUNIKAT · TERAZ</b>Zostań w domu. Wychodź tylko, gdy to konieczne.</i></div>',
  anime: () => `<div class="vx-deco">${anSfx("ドドド", 84, 22, 12)}${anSfx("ゴゴゴ", 14, 60, -10, "b")}</div>`,
  barbie: () => `<div class="vx-deco bbg-shine"></div><div class="vx-deco">${bbgGlints(22)}</div>`,
  polska: () => PLS_SASHES,
  ascii: () => ASCII_BOX,
  // Żelkowy: zatopiony cukier (dwa obrazki migoczące na zmianę), miękki połysk i obwódka żelki
  jelly: () => '<div class="vx-deco vx-clip jly-sugar"><i class="a"></i><i class="b"></i></div><div class="vx-deco"><i class="jly-gloss"></i><i class="jly-rim"></i></div>',
  // Kryształowy: iskry w losowych miejscach
  crystal: () => `<div class="vx-deco">${Array.from({ length: 12 }, () => `<i class="cry-spark" style="left:${vxN(3, 97)}%;top:${vxN(3, 97)}%;--s:${vxN(.5, 1.4, 2)};animation-delay:-${vxN(0, 4, 1)}s;animation-duration:${vxN(1.6, 3.4, 1)}s"></i>`).join("")}</div>`,
  dowod: p => dowodCard(p),
  christmas: () => `<div class="vx-deco vx-clip"><i class="snw-layer a"></i><i class="snw-layer b"></i></div><div class="vx-deco">${xmLights(30)}</div>`,
  tree: () => `<div class="vx-deco vx-clip">${TRE_BRANCHES}</div><div class="vx-deco vx-clip">${treBalls(4, 3, 18, [4, 16])}${treBalls(4, 82, 97, [4, 16])}</div>`,
  gift: () => `<div class="vx-deco"><i class="gf-frame"></i>${GF_BOW("small")}</div>`,
  // Sugar Cane: miętowe cukierki w rogach karty (nieruchome - wariant jest statyczny)
  sugarcane: () => '<div class="vx-deco"><i class="sgc-mint a"></i><i class="sgc-mint b"></i><i class="sgc-mint c"></i><i class="sgc-mint d"></i></div>',
  // Śnieżny: dwie warstwy płatków (jeden obrazek w CSS na warstwę, przesuwany transformem)
  snow: () => '<div class="vx-deco vx-clip"><i class="snw-layer a"></i><i class="snw-layer b"></i></div>',
  hawaii: () => `<div class="vx-deco vx-clip">${hiDeco()}</div>`,
  claude: () => `<div class="vx-deco">${clFeed()}</div>`,
  scratch: () => `<div class="vx-deco">${zdBurst("DO<br>100 000<br>ZŁ", 16, 30, -12, 31, "#ffd21a", "#c81e1e")}${zdBurst("x20!", 86, 52, 10, 22, "#ff2f92", "#fff")}</div>`,
  muertos: () => `<div class="vx-deco vx-clip">${dmPetals(6)}${dmConfetti(8)}${dmButterfly(3, 30, 1, 0)}${dmButterfly(84, 46, .85, 3)}</div>
    <div class="vx-deco vx-clip"><i class="dm-zig"></i><i class="dm-borderimg"></i></div><div class="dm-banners">${dmFlags()}</div>`,
  // Komunistyczna: kremowy margines plakatu i złota gwiazda na rogu zdjęcia
  komuna: () => `<div class="vx-deco"><i class="kv-margin"></i><i class="kv-star">${vxSvg(usStar(10, 10.6, 9.6, "currentColor"), "0 0 20 20")}</i></div>`,
  copper: () => '<div class="vx-deco vx-clip"><i class="cu-shine"></i></div>',
  // Akta: zakładka teczki z sygnaturą nad kartą i spinacz na zdjęciu
  files: () => `<div class="vx-deco"><i class="ak-tab"><b>AKTA · K-2137</b></i><i class="ak-clip">${vxSvg(AK_CLIP, "0 0 12 30")}</i></div>`,
  usa: () => '<div class="vx-deco vx-clip"><i class="us-hazard"></i></div>',
  apollo: () => `<div class="vx-deco ap-clip"><i class="ap-gs"></i><i class="ap-grain"></i><i class="ap-flicker"></i>${apScratches(2)}<i class="ap-vignette"></i></div><div class="vx-deco"><i class="ap2-lines"></i></div>`,
  uranium: () => '<div class="vx-deco"><i class="ur-halo"></i></div>',
  // Rtęciowa: połysk, krople spadające z sopli, sople u góry (nazwa nad nimi), kałuża z kręgami na dole
  mercury: () => `<div class="vx-deco vx-clip"><i class="hg-shine"></i>${hgFalls(5)}</div><div class="vx-deco hg-drip">${vxSvg(hgDrips())}</div>` +
    '<div class="vx-deco vx-clip"><i class="hg-pool"></i><i class="hg-ring"></i><i class="hg-ring b"></i></div>',
  // Hollywood '69: prosta ramka, migotanie projektora, kurz i ziarno starej taśmy
  hollywood: () => '<div class="vx-deco vx-clip"><i class="hy-frame"></i><i class="hy-flick"></i><i class="hy-dust"></i><i class="hy-grain"></i></div>',
  // Czekoladowa: połysk przesuwający się po tabliczce; Odblaskowa: światło reflektora (pasy rozbłyskują, gdy przez nie przechodzi)
  chocolate: () => '<div class="vx-deco vx-clip"><i class="co-shine"></i></div>',
  // Cukierkowa: ramka w różowo-miętowe paski laski cukrowej, sypiąca się posypka
  candy: () => `<div class="vx-deco vx-clip">${cdFall(8)}</div><div class="vx-deco vx-clip"><i class="cd-cane"></i></div>`,
  reflective: () => '<div class="vx-deco vx-clip"><i class="rf-beam"></i></div>',
  // Neonowa: rurka neonu dookoła karty z uchwytami
  neon: () => '<div class="vx-deco"><i class="nn-tube"></i><i class="nn-clip a"></i><i class="nn-clip b"></i><i class="nn-clip c"></i><i class="nn-clip d"></i></div>',
  // Stalowa: śruby w rogach karty
  steel: () => `<div class="vx-deco">${["tl", "tr", "bl", "br"].map(c => `<i class="stl-screw ${c}"></i>`).join("")}</div>`,
  // Piwna: piana u góry (nazwa nad nią), oszronione szkło z kroplami rosy - część spływa
  beer: () => `<div class="vx-deco vx-clip">${vxSvg(brFoam(11), "0 0 63 88", "br-foam")}</div><div class="vx-deco vx-clip"><i class="br-frost"></i>${brDew(46, 6)}</div>`,
  moro: p => `<div class="vx-deco"><i class="mo-stitch"></i>${moTags(p)}</div>`,
  // Elektryczna: dwa pioruny w losowych miejscach uderzają w swoim rytmie, przy uderzeniu karta się rozjaśnia
  electric: () => `<div class="vx-deco vx-clip"><i class="el-flash"></i>${vxSvg(elBoltSvg(elBolt(rand(8, 20), -2, rand(14, 30), 60, 3), "s1") +
    elBoltSvg(elBolt(rand(44, 56), -2, rand(36, 52), 50, 2), "s2"))}</div>`,
  synthwave: () => '<div class="vx-deco vx-clip"><i class="sw-track"></i><i class="sw-lines"></i></div>',
  // Noir: klatka starego filmu - perforacja, rysy, kurz, winieta, ziarno i lekkie migotanie
  noir: () => `<div class="vx-deco vx-clip nr-flick"><i class="nr-perf l"></i><i class="nr-perf r"></i>${nrScratches(3)}<i class="nr-dust"></i><i class="nr-vignette"></i><i class="nr-grain"></i></div>`,
  motor: () => `<div class="vx-deco"><i class="mt-gauge">${mtGauge()}</i><i class="mt-shift"></i></div>`,
  // Frutiger Aero: szklany połysk na górnej połowie karty, rybki pływające po niebie i bańki
  aero: () => `<div class="vx-deco"><i class="ae-gloss"></i></div><div class="vx-deco vx-clip">${AERO_FISH.map(([a, b, s], k) =>
    `<i class="ae-fish f${k + 1}" style="animation-delay:-${vxN(0, 12, 1)}s">${vxFish(a, b, s)}</i>`).join("")}${vxBubbles(6, "ae-bubble")}</div>`,
  // Miodowa: miód kapiący z góry i przelatujące pszczoły
  honey: () => `<div class="vx-deco hn-drip">${vxSvg(vxDrips("#f2a20f", "#ffe08a", [8, 16]))}</div><div class="vx-deco vx-clip">${hnBees(2)}</div>`,
  // Chińska: czerwone lampiony ze złotymi frędzlami kołyszą się u góry karty
  chinese: () => `<div class="vx-deco cn-lanterns">${vxSvg(cnLantern(6, 3, .95) + cnLantern(57, 8, 1.1) + cnLantern(48, 1, .7))}</div>`,
  // dolna część karty pływa w szlamie (fala + bąbelki), z góry kapie glut
  slime: () => `<div class="vx-deco sl-flood">${vxSvg(`<path d="${vxWave(60)}" fill="#8cf04a44"/><path d="${vxWave(61.5, 1.2)}" fill="#3fbf1a40"/>`, "0 0 63 88", "sl-wave")}
    ${vxFloat(9, "sl-bub", [6, 90])}</div><div class="vx-deco sl-drip">${vxSvg(vxDrips("#7dff3a", "#d4ffb0", [5, 9]))}</div>`,
  matte: () => '<div class="vx-deco"><i class="mt-stitch"></i></div>',
  racing: p => `<div class="vx-deco"><div class="rc-roundel"><b>${p?.number || 7}</b></div></div>`,
  wanted: () => `<div class="vx-deco"><i class="ww-hole" style="left:${vxN(66, 80)}%;top:${vxN(16, 24)}%"></i><i class="ww-hole" style="left:${vxN(10, 20)}%;top:${vxN(52, 60)}%"></i>` +
    `<i class="ww-hole small" style="left:${vxN(74, 84)}%;top:${vxN(62, 70)}%"></i></div>`,
  artdeco: () => '<div class="vx-deco"><i class="ad-lines"></i></div>',
  // roztopiony ser kapiący z górnej krawędzi (makieta 2.) - krótszy, żeby nie zasłaniał nazwy
  cheese: () => `<div class="vx-deco ch-melt">${vxSvg(vxDrips("#ffc23a", "#fff1a8", [5, 9]))}</div>`,
};
// ---------------------------------------------------------------- warianty z kreatora (panel admina, strona /designer)
// Projekt (S.cfg.customVariants[klucz], clean_custom_variant na serwerze) -> CSS dla .v-<klucz> (applyCustomVariants wstawia
// go do <style id="cvStyle">), tło-wzór w .vx-bg (cvBG), zabarwienie zdjęcia (variantPhoto) i efekty nad kartą (cvDeco).
export const cvOf = v => S.cfg.customVariants?.[v];
const cvA = (c, a) => `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
const cvSvg = (body, fill, op, s) => `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><g fill='${fill.replace("#", "%23")}' fill-opacity='${op}'>${body}</g></svg>") 0 0 / ${s}cqw ${s}cqw`;
// wzór tła: kolor pc z przezroczystością po, wielkość ps (cqw)
function cvPattern(b) {
  const c = cvA(b.pc, b.po), s = b.ps;
  return {
    dots: `radial-gradient(circle, ${c} 0 ${(s * .17).toFixed(2)}cqw, transparent ${(s * .21).toFixed(2)}cqw) 0 0 / ${s}cqw ${s}cqw`,
    stripes: `repeating-linear-gradient(90deg, ${c} 0 ${s / 2}cqw, transparent ${s / 2}cqw ${s}cqw)`,
    diagonal: `repeating-linear-gradient(45deg, ${c} 0 ${(s / 3).toFixed(2)}cqw, transparent ${(s / 3).toFixed(2)}cqw ${s}cqw)`,
    grid: `linear-gradient(${c} 0 .3cqw, transparent .3cqw) 0 0 / ${s}cqw ${s}cqw, linear-gradient(90deg, ${c} 0 .3cqw, transparent .3cqw) 0 0 / ${s}cqw ${s}cqw`,
    checker: `repeating-conic-gradient(${c} 0 25%, transparent 0 50%) 0 0 / ${s * 2}cqw ${s * 2}cqw`,
    grain: "var(--tx-grain) 0 0 / 120px",
    waves: `radial-gradient(circle at 50% 100%, transparent 38%, ${c} 40% 47%, transparent 49%) 0 0 / ${s * 2}cqw ${s}cqw`,
    hearts: cvSvg("<path d='M10 16 C4 12 2 9 3.5 6.5 C5 4 8 4.5 10 7 C12 4.5 15 4 16.5 6.5 C18 9 16 12 10 16 Z'/>", b.pc, b.po, s),
    stars: cvSvg("<path d='M10 2 L12.2 7.6 L18 7.8 L13.4 11.4 L15 17 L10 13.7 L5 17 L6.6 11.4 L2 7.8 L7.8 7.6 Z'/>", b.pc, b.po, s),
  }[b.pattern] || "none";
}
function cvPhotoFilter(p) {
  const f = { grayscale: "grayscale(1)", sepia: "sepia(1)", invert: "invert(1)", duotone: "grayscale(1) contrast(1.2)",
    vivid: "saturate(1.8) contrast(1.15)", faded: "saturate(.5) brightness(1.1) contrast(.9)" }[p.filter] || "";
  return [f, p.hue ? `hue-rotate(${p.hue}deg)` : ""].filter(Boolean).join(" ") || "none";
}
export const cvColors = v => { const d = cvOf(baseVariant(v)); return d && [d.frame.c1, d.frame.c2, d.frame.c3, d.fx.color]; };
export function customVariantCSS(k, d) {
  const s = `.card.v-${k}`, F = d.frame, B = d.bg, Ph = d.photo, T = d.text, G = d.tagStyle;
  const grad = `linear-gradient(${F.angle}deg, ${F.c1}, ${F.c2} 50%, ${F.c3})`;
  const photoF = cvPhotoFilter(Ph);
  const radius = { rect: "", rounded: "border-radius: 1em;", circle: "border-radius: 50%; aspect-ratio: 1; margin: 4% 14% 0;" }[Ph.shape];
  return `
${s} { --frame: ${grad}; --spin: initial; background: none; isolation: isolate; box-shadow: 0 6px 18px #000a${F.glow ? `, 0 0 22px ${cvA(F.glow, .75)}` : ""}; }
${s}::before { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; pointer-events: none;
  ${F.anim === "spin" ? `background: conic-gradient(from var(--ang, 0deg), ${F.c1}, ${F.c2}, ${F.c3}, ${F.c1}); animation: ultraSpin 4s linear infinite;`
    : F.anim === "shimmer" ? `background: ${grad}; background-size: 250% 250%; animation: goldShift 3s ease-in-out infinite;` : `background: ${grad};`} }
${s} .card-inner { background: linear-gradient(${B.angle}deg, ${B.c1}, ${B.c2}); color: ${T.color}; }
${s} .card-inner > :where(:not(.vx-bg, .galaxy-bg, .dv-bg, .mlg-bg, .v-stickers)) { position: relative; z-index: 1; }
${s} :is(.card-sub, .card-stats, :where(.card-stats b), .card-foot, .atk-dmg, .atk-name, .card-hp) { color: ${T.color}; }
${s} .card-name { font-family: "${T.font}", Rubik, sans-serif; font-weight: ${["Rubik", "Cinzel", "Orbitron"].includes(T.font) ? 900 : 400};
  background: linear-gradient(180deg, ${T.name1}, ${T.name2}); -webkit-background-clip: text; background-clip: text; color: transparent;
  ${T.glow ? `filter: drop-shadow(0 0 .25em ${T.glow});` : ""} }
${s} :is(.card-sub, .card-attack, .card-stats) { background: ${cvA(T.panel, T.panelOp)}; border: none; border-radius: .3em; }
${s} .card-attack { padding-inline: .35em; margin-top: 1.5%; }
${s} .card-photo { border-image: none; border: ${Ph.bw}em solid ${Ph.border}; ${radius} }
${s} .card-photo > img, .r-secret.v-${k} .sc-art img, .pick.v-${k} img, .avv-${k} img { filter: ${photoF}; }
.r-secret.v-${k} .sc-border { background: ${grad}; animation: none; }
:is(.var-tag, .ph).vt-${k} { background: ${G.bg}; color: ${G.color}; border: 1px solid ${G.border}; text-shadow: none; box-shadow: 0 0 .5em ${cvA(G.border, .6)}; }
.vdot.vt-${k} { background: ${grad}; } .odd.odd-v.vt-${k} { border-left-color: ${F.c1}; }
.pick.v-${k} { box-shadow: inset 0 0 0 2px ${F.c1}, inset 0 -26px 26px -18px var(--rc); }
.avv-${k} img { box-shadow: 0 0 0 2px ${F.c1}, 0 0 10px ${F.glow || F.c2} !important; } .av-vname.vt-${k} { color: ${F.c2}; }`;
}
export function applyCustomVariants() {
  let el = document.getElementById("cvStyle");
  if (!el) { el = document.createElement("style"); el.id = "cvStyle"; document.head.appendChild(el); }
  el.textContent = Object.entries(S.cfg.customVariants || {}).map(([k, d]) => customVariantCSS(k, d)).join("\n");
}
// tło-wzór (pod napisami), może się przesuwać albo pulsować
export function cvBG(k) {
  const B = cvOf(k).bg;
  return B.pattern === "none" ? "" : `<i class="cvx-pat${B.anim !== "none" ? " " + B.anim : ""}" style="background:${esc(cvPattern(B))};--ps:${B.ps}cqw"></i>`;
}
// efekty nad kartą: połysk, iskierki, deszcz, śnieg, bańki, serca, linie obrazu, winieta, ziarno, pulsująca poświata
export function cvDeco(k) {
  const X = cvOf(k).fx, n = (cnt, cls, extra = () => "") => Array.from({ length: cnt }, () =>
    `<i class="${cls}" style="left:${rand(2, 94).toFixed(0)}%;animation-delay:-${rand(0, 8).toFixed(1)}s;${extra()}"></i>`).join("");
  let html = "";
  if (X.sheen) html += '<i class="cvx-sheen"></i>';
  if (X.sparkles) html += n(9, "cvx-spark", () => `top:${rand(4, 92).toFixed(0)}%`);
  if (X.rain) html += '<i class="cvx-rain"></i>';
  if (X.snow) html += n(14, "cvx-snow", () => `--s:${rand(.5, 1.4).toFixed(2)};animation-duration:${rand(6, 11).toFixed(1)}s`);
  if (X.bubbles) html += n(8, "cvx-bub", () => `--s:${rand(.5, 1.5).toFixed(2)};animation-duration:${rand(5, 10).toFixed(1)}s`);
  if (X.hearts) html += n(6, "cvx-heart", () => `--s:${rand(.6, 1.3).toFixed(2)};animation-duration:${rand(6, 10).toFixed(1)}s`).replaceAll("></i>", ">♥</i>");
  if (X.scanlines) html += '<i class="cvx-scan"></i>';
  if (X.vignette) html += '<i class="cvx-vig"></i>';
  if (X.grain) html += '<i class="cvx-grain"></i>';
  return (X.glow ? `<div class="cvx-glow" style="--cvc:${X.color}"></div>` : "") + (html ? `<div class="cvx" style="--cvc:${X.color}">${html}</div>` : "");
}

// pasek nad nazwą: okno terminala (Cyfrowa), napis WANTED
export function variantTop(variant, p) {
  const parts = variantParts(variant);
  if (parts.includes("chesswhite") || parts.includes("chessblack")) return '<div class="cs-mark"><i></i>♚\uFE0E<i></i></div>';
  if (parts.includes("covid")) return '<div class="cvd-bar">⚠ ALERT ⚠ ALERT ⚠ ALERT</div>';
  if (parts.includes("barbie")) return '<div class="bbg-heart"></div>';
  if (parts.includes("polska")) return '<div class="pls-banner"><span>11 LISTOPADA</span><b>NIEPODLEGŁA</b></div>';
  if (parts.includes("christmas")) return xmSky();
  if (parts.includes("tree")) return '<div class="tre-star">★</div>';
  if (parts.includes("analog")) return `<div class="ah-bar"><b>${esc(variantText(p, "analog", "bar"))}</b><span>NADAWANY O 03:00</span></div>`;
  if (parts.includes("wizytowka")) return `<div class="wz-corp"><i class="wz-logo"></i><b>${esc(variantText(p, "wizytowka", "company"))}</b></div>`;
  if (parts.includes("tabloid")) return '<div class="tb-mast"><b>SZOK</b><span>DNIA</span><small>NR 666 · CENA 2,50 ZŁ</small></div>';
  if (parts.includes("claude")) return '<div class="cl-app"><i class="cl-logo"></i><b>Claude</b><span><u></u>online</span></div>';
  if (parts.includes("scratch")) return '<div class="zd-title">ZDRAP I WYGRAJ!</div>';
  if (parts.includes("teletext")) return `<div class="tt-head"><b>P888</b><span>TELEGAZETA</span><i>12:34:${ttDigits("012345", "t")}${ttDigits("0123456789", "u")}</i></div>`;
  if (parts.includes("retroos")) return `<div class="w9-title"><span>${esc(p?.name || "Karta")}.exe (Brak odpowiedzi)</span><i>_</i><i>□</i><i>×</i></div>`;
  if (parts.includes("receipt")) return '<div class="rc-shop">SCAMBOX SP. Z O.O.<br>NIP 213-742-00-69</div>';
  if (parts.includes("tarot")) return '<div class="tr-num">✦ XVII ✦</div>';
  if (parts.includes("digital")) return '<div class="dg-bar"><i></i><i></i><i></i><span>root@scambox: ~/hack</span></div>';
  if (parts.includes("wanted")) return '<div class="ww-title">WANTED</div>';
  if (parts.includes("apollo")) return `<div class="ap2-bar"><span>CAPCOM · HOUSTON</span><span class="ap2-met">MET 102:45:4${apTick()}</span></div>`;
  if (parts.includes("candy")) return '<div class="cd-awning"></div>';   // falbanka markizy cukierni
  if (parts.includes("hollywood")) return '<div class="hy-presents">A SCAMBOX PICTURE</div>';   // napis z czołówki filmu
  if (parts.includes("synthwave")) return '<div class="sw-osd"><span>▶ PLAY</span><span>SP 0:21:37</span></div>';
  return "";
}
// tekst zamiast "typ · skrzynka" (podtytuł z panelu admina ma pierwszeństwo); null = zwykły
export function variantSub(variant, pid) {
  const parts = variantParts(variant);
  if (parts.includes("vintage")) return VINTAGE_STAMP;
  if (parts.includes("noir")) return "— Ta sprawa śmierdziała od początku.";
  if (parts.includes("hollywood")) return "SEANS O ZMIERZCHU · 1969";
  if (parts.includes("usa")) return "TO PRAWDZIWA HISTORIA";
  if (parts.includes("sugarcane")) return "SŁODKICH ŚWIĄT";
  if (parts.includes("christmas")) return "WESOŁYCH ŚWIĄT!";
  if (parts.includes("gift")) return "OD: SCAMBOX · DLA: CIEBIE";
  if (parts.includes("komuna")) return "NAPRZÓD KU JASNEJ PRZYSZŁOŚCI!";
  if (parts.includes("apollo")) return "▲ ORZEŁ ODŁĄCZA SIĘ · 20.07.1969";
  if (parts.includes("cobalt")) return "Co-60 · T½ 5,27 LAT";
  // Bananowa: etap dojrzewania zmienia się razem z kolorem karty (CSS bnStage)
  if (parts.includes("banana")) return '<span class="bn-stages"><b>ZIELONY · JESZCZE TWARDY</b><b>IDEALNY</b><b>SŁODZIUTKI</b><b>NA CHLEBEK BANANOWY</b></span>';
  if (parts.includes("uranium")) return "U · 92 · 238,03";
  if (parts.includes("mercury")) return "Hg · 80 · 200,59";
  if (parts.includes("californium")) return "Cf-252 · 2,3 MLN NEUTRONÓW/s/µg";
  if (parts.includes("files")) return "SPRAWA NR 2137/K · ŚLEDZTWO W TOKU";
  if (parts.includes("muertos")) return "CALAVERAS · ¡VIVA LA VIDA!";
  if (parts.includes("receipt")) return "*** PARAGON FISKALNY ***";
  if (parts.includes("teletext")) return "PRZERWA W EMISJI";
  if (parts.includes("anime")) return "SEZON 1 · ODCINEK 12";
  if (parts.includes("chesswhite")) return "BIAŁE";
  if (parts.includes("chessblack")) return "CZARNE";
  if (parts.includes("covid")) return "SARS-CoV-2 · SYTUACJA NADZWYCZAJNA";
  if (parts.includes("rgb")) return "RGB SYNC · TRYB: SPEKTRUM";
  if (parts.includes("barbie")) return "♡ GLITTER QUEEN ♡";
  if (parts.includes("polska")) return "NARODOWE ŚWIĘTO NIEPODLEGŁOŚCI";
  if (parts.includes("polaroid")) return '<span class="pd-hand">potrząśnij mną!</span>';
  if (parts.includes("analog")) return esc(variantText(person(pid), "analog", "sub"));
  if (parts.includes("wizytowka")) return wzSub(person(pid));
  if (parts.includes("hawaii")) return "CIEŃ PALMY · MAI TAI";
  if (parts.includes("tabloid")) return "TAJEMNICA WYSZŁA NA JAW!";
  if (parts.includes("claude")) return "Claude pisze…";
  if (parts.includes("scratch")) return "GŁÓWNA WYGRANA 100 000 ZŁ";
  if (parts.includes("retroos")) return "Nieprawidłowa operacja";
  if (parts.includes("tarot")) return "GWIAZDA";
  // Miedziana: etap patyny zmienia się razem z kolorem karty (CSS cuStage)
  if (parts.includes("copper")) return '<span class="cu-stages"><b>Cu · 29 · NOWA MIEDŹ</b><b>Cu · 29 · CIEMNIEJE</b><b>Cu · 29 · ZIELENIEJE</b><b>Cu · 29 · PATYNA</b></span>';
  // Glitch: kod błędu
  if (parts.includes("glitch")) { const p = person(pid); return `${S.cfg.types[p.type].name} · ${esc(crateOf(p.crate).short)} <b>▓ERR 0x2137</b>`; }
  if (parts.includes("digital")) return "$ ./access --target <b>ACCESS GRANTED</b>";
  if (parts.includes("moro")) return "ODDZIAŁ 2137 · LAS";
  // Wanted: nagroda (wartość karty) zaraz pod DEAD OR ALIVE
  if (parts.includes("wanted")) return `DEAD OR ALIVE<span class="ww-reward">REWARD ${fmt(cardValue(pid, variant))}</span>`;
  return null;
}

// Karty specjalne - wariant Jokerowa "Talia Kasynowa" (joker-talia.css): karta do gry na zielonym suknie - na szerokich
// marginesach indeksy JOKER z czapką błazna (symbol SVG #jk-hat w templates/index.html) i stosy żetonów; nic nie zasłania zdjęcia.
function jokerDeco() {
  const letters = "JOKER".split("").map(l => `<b>${l}</b>`).join("");
  const idx = c => `<span class="jt-idx ${c}">${hwUse("jk-hat", "jt-hat")}${letters}</span>`;
  const chips = (side, colors) => `<span class="jt-chips ${side}">${colors.map(c => `<i class="jt-chip ${c}"></i>`).join("")}</span>`;
  return `<div class="jt-deco"><i class="jt-stitch"></i>${idx("tl")}${idx("br")}${chips("l", ["red", "black", "blue"])}${chips("r", ["purple", "red", "black"])}</div>`;
}
// Karty specjalne - wariant Dżinsowa: dżins, pomarańczowe przeszycia, miedziane nity
function jeansDeco() {
  const rivets = ["tl", "tr", "bl", "br"].map(c => `<i class="dz-rivet ${c}"></i>`).join("");
  return `<div class="dz-deco"><i class="dz-stitch"></i>${rivets}</div>`;
}

// Karta z UFO - wariant ⎍⎎⍜⌰⎍⎅ (static/css/ufo.css, wygląd "Pustka"): obracający się znak, napisy w alfabecie obcych.
// Napisy (deco1 u góry - domyślnie losowe znaki, deco2 na dole) można zmienić w panelu admina (teksty na karcie).
const UFO_GLYPHS = [..."⏃⏚☊⎅⟒⎎☌⊑⟟⟊☍⌰⋔⋏⍜⌿⍾⍀⌇⏁⎍⎐⍙⌖⊬⋉"];
const ufoGlyphs = n => Array.from({ length: n }, () => UFO_GLYPHS[Math.floor(Math.random() * UFO_GLYPHS.length)]).join("");
const UFO_SIGIL = `<i class="uf-sigil"><svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2">
  <polygon points="50,4 92,27 92,73 50,96 8,73 8,27"/><polygon points="50,18 80,35 80,65 50,82 20,65 20,35"/>
  <circle cx="50" cy="50" r="12"/><path d="M50 4V38M50 62v34M8 27l30 17M62 56l30 17M92 27L62 44M38 56L8 73"/></g></svg></i>`;
function ufoDeco(p) {
  const T = p ? cardTexts(p) : (k, h) => h;
  return `<div class="uf-deco">${UFO_SIGIL}<span class="uf-ring">${T("deco1", ufoGlyphs(14))}</span>` +
    `<span class="uf-band bot">${T("deco2", "⌇⌿⍜⏁⍀⏃⍀⟒⌇ ⍙ ⌿⎍⌇⏁☍⟒")}</span></div>`;
}

// MLG "Quickscope": jaskrawy gradient przesuwający się po skosie w środku karty (mlgBG), na zdjęciu celownik, który co jakiś
// czas namierza twarz i strzela (błysk + hitmarkery, potem kilka sekund zwykłego zdjęcia - mlgPhoto), nad kartą killfeed
// z nazwą karty, obracające się 360°, napisy i oko Illuminati (mlgDeco). Grafiki z biblioteki naklejek (static/img/mlg).
const MLG_WORDS = ["NO SCOPE", "QUICKSCOPE", "REKT", "WOW", "GG EZ", "+1000", "SKILL", "MLG", "#1"];
const MLG_TAGS = ["xX_Sn1p3r_Xx", "N0Sc0pe420", "FaZe_Tata", "MLG_Pro2137", "QuickScoper"];
const mlgPos = (a, b) => rand(a, b).toFixed(0) + "%";
const mlgImg = (k, cls, style = "") => `<img class="${cls}" src="${S.cfg.stickerLibrary[k].url}" alt="" draggable="false" style="${style}">`;
function mlgHits(n, x = [14, 86], y = [14, 84]) {
  return Array.from({ length: n }, (_, k) => mlgImg("hitmarker", "mlg-hit",
    `left:${mlgPos(...x)};top:${mlgPos(...y)};animation-delay:-${(k * 3.6 / n + rand(0, 0.5)).toFixed(2)}s`)).join("");
}
function mlgBG(variant) {
  if (!variantParts(variant).includes("mlg")) return "";
  return '<div class="mlg-bg"><i class="mlg-grad"></i></div>';
}
function mlgPhoto(variant) {
  if (!variantParts(variant).includes("mlg")) return "";
  return `<i class="mlg-photo"><i class="mlg-scope">${mlgImg("scope", "")}</i><i class="mlg-shot"></i>${mlgHits(5, [40, 60], [30, 55])}</i>`;
}
function mlgDeco(p) {
  const tag = () => MLG_TAGS[Math.floor(rand(0, MLG_TAGS.length))];
  const row = (k, victim) => `<span class="mlg-kill" style="animation-delay:${k * 0.8}s"><b>${tag()}</b>${mlgImg("scope", "")}<i>${esc(victim)}</i></span>`;
  const word = MLG_WORDS[Math.floor(rand(0, MLG_WORDS.length))];
  return `<div class="mlg-deco"><span class="mlg-feed">${row(0, p?.name || "noob")}${row(1, "Rywal")}</span>${mlgHits(3)}` +
    `<b class="mlg-word spin360">360°</b><b class="mlg-word" style="left:${mlgPos(30, 70)};top:${mlgPos(20, 40)};--wr:${
      rand(-16, 16).toFixed(0)}deg;animation-delay:-${rand(0, 5).toFixed(1)}s">${word}</b></div>${mlgImg("illuminati", "mlg-eye")}`;
}
// Naklejki od admina (strona /stickers) na wariantach z "stickers" (MLG): środek i szerokość w % karty, obrót, odbicie
// i ruch (klasy vsa-*); kolejność listy = od spodu. Obrazek w środku <i>, żeby ruch nie kasował obrotu.
// Karta z własnymi naklejkami (edytor, tryb "Tylko ta karta") ma gotową listę w cardStickers - reszta ma standardowe.
export function stickerList(v, p) { return (p && S.cfg.cardStickers?.[v]?.[p.imgAs || p.id]) || S.cfg.variantStickers?.[v]; }
export function stickersHTML(v, list = S.cfg.variantStickers?.[v], cls = "") {
  return list?.length ? `<div class="v-stickers${cls}">${list.map(stickerHTML).join("")}</div>` : "";
}
// Warianty z "stickers": "under" (np. Chińska): naklejki leżą na tle karty - pod zdjęciem i napisami
// (w .card-inner zaraz po tle wariantu; na tajnej karcie nad zdjęciem, które zajmuje całą kartę);
// "both" (np. Anime) - tu tylko naklejki z "under", reszta nad kartą jak zwykle
export function underStickersHTML(variant, p) {
  return variantParts(variant).map(x => {
    const mode = S.cfg.variants[x]?.stickers;
    if (mode !== "under" && mode !== "both") return "";
    const list = stickerList(x, p);
    return stickersHTML(x, mode === "both" ? list?.filter(s => s.under) : list, " under");
  }).join("");
}
export function stickerHTML(s) {
  return `<i class="v-sticker${s.anim && s.anim !== "none" ? " vsa-" + s.anim : ""}" data-sid="${s.id}" style="${stickerStyle(s)}">` +
    `<img src="${esc(s.url)}" alt="" draggable="false"></i>`;
}
export function stickerStyle(s) { return `--x:${s.x}%;--y:${s.y}%;--w:${s.w}%;--r:${s.rot}deg;--f:${s.flip ? -1 : 1}`; }

// wszystkie zdolności karty po kolei: [{ name, kind: "off" | "def" | "heal" | "eco", value }]
// wariant flagowy (także połączony, np. flag+gold): flaga kraju karty jako tło ramki (zmienna CSS --flag)
export function flagStyle(p, variant) { return variantParts(variant).includes("flag") && p.country ? ` style="--flag:url('${flagUrl(p.country)}')"` : ""; }

// własne napisy na karcie z panelu admina (pole "texts", karty specjalne): T(miejsce, zwykły tekst w HTML)
export function cardTexts(p) { return (k, html) => p.texts?.[k] != null ? esc(p.texts[k]) : html; }

export function cardHTML(pid, variant = "normal", uid: any = null) {
  const p = person(pid);
  const bs = beerSub(variant, uid);
  if (p.masked) return mysteryCardHTML(p);
  if (p.rarity === "secret") return secretCardHTML(p, variant, uid);
  const r = S.cfg.rarities[p.rarity];
  const type = S.cfg.types[p.type];
  const crate = crateOf(p.crate);
  const total = String(crate.people.length).padStart(3, "0");
  const cost = type.icon.repeat(Math.min(3, 1 + Math.floor(rarityIdx(p.rarity) / 2)));
  const abils = abilitiesOf(p);
  const T = cardTexts(p), name = p.texts?.name ?? p.name;
  // napis rzadkości: wariant może mieć własny (UFO - alfabet obcych zamiast "Specjalna")
  const rarityName = variantParts(variant).map(x => S.cfg.variants[x]?.rarityName).find(Boolean) || r.name;
  return `
  <div class="card r-${p.rarity} ${vClass(variant)}${bs ? " brs-" + bs.id : ""}${p.style ? " vs-" + p.style : ""}${abils.length > 1 ? " two-atk" : ""}${abils.length > 2 ? ` atk-${abils.length}` : ""}" data-pid="${p.id}" data-variant="${variant}"${uid != null ? ` data-uid="${uid}"` : ""}${flagStyle(p, variant)}>
    <div class="card-inner">
      ${baseVariant(variant) === "reverse" ? '<div class="rev-foil"></div>' : ""}
      ${drawingBG(variant, uid)}${galaxyBG(variant)}${devilBG(variant)}${mlgBG(variant)}${variantBG(variant)}${underStickersHTML(variant, p)}
      ${variantTop(variant, p)}${pxStatus(p, variant)}
      <div class="card-head">
        <span class="card-name">${variantParts(variant).includes("digital") ? `<span class="dg-type" style="--n:${[...name].length}">${esc(name)}</span>` : esc(name)}</span>
        <span class="card-hp"><small>${T("hpLabel", "HP")}</small>${T("hp", p.hp)}</span>
        <span class="card-type">${T("type", type.icon)}</span>
      </div>
      <div class="card-photo"><img src="${imgUrl(p.id, variant)}" alt="${esc(name)}" loading="lazy" draggable="false"${photoFx(variant)}>${drawingPhoto(variant, uid)}${galaxyPhoto(variant)}${halloweenPhoto(variant)}${mlgPhoto(variant)}${variantPhoto(variant, p, uid)}</div>
      <div class="card-sub${p.subtitle || p.texts?.sub ? " has-subtitle" : ""}">${T("sub", p.subtitle ? esc(p.subtitle)
        : bs ? esc(bs.label) : variantSub(variant, pid) ?? `${type.name} · ${esc(crate.short)}`)}</div>
      ${abils.map((a, i) => `<div class="card-attack${i ? " atk2" : ""}${a.kind !== "off" ? " " + a.kind : ""}">
        <span class="atk-cost">${T(`atk${i + 1}Cost`, a.kind === "off" ? cost + (i ? type.icon : "") : S.cfg.abilityKinds[a.kind]?.icon || "")}</span>
        <span class="atk-name">${T(`atk${i + 1}Name`, esc(a.name))}</span>
        <span class="atk-dmg">${T(`atk${i + 1}Value`, a.value)}</span>
      </div>`).join("")}
      <div class="card-stats">
        <span>${T("weakLabel", "słabość")}<b>${T("weak", S.cfg.types[type.weak].icon + "×2")}</b></span>
        <span>${T("resistLabel", "odporność")}<b>${T("resist", S.cfg.types[type.resist].icon + "-20")}</b></span>
        <span>${T("retreatLabel", "wycofanie")}<b>${T("retreat", "⚪".repeat(1 + rarityIdx(p.rarity) % 3))}</b></span>
      </div>
      <div class="card-foot">
        <span class="card-rarity"><span class="gem"></span>${T("rarity", rarityName)}</span>
        <span>${T("number", `${esc(crate.code)} ${String(p.number).padStart(3, "0")}/${total}`)}</span>
        <span class="card-value">${T("value", fmt(cardValue(pid, variant)))}</span>
      </div>
    </div>
    ${variantLayers(variant, p, bs)}${giftWrap(variant, uid)}
    <div class="shine"></div>
  </div>`;
}

// TAJNA karta - zupełnie inny układ: pełnoekranowe zdjęcie, aureola, złota animowana ramka
function secretCardHTML(p, variant, uid = null) {
  const type = S.cfg.types[p.type];
  const crate = crateOf(p.crate);
  return `
  <div class="card r-secret ${vClass(variant)}" data-pid="${p.id}" data-variant="${variant}"${flagStyle(p, variant)}>
    <div class="sc">
      ${drawingBG(variant, uid)}
      <div class="sc-art"><img src="${imgUrl(p.id, variant)}" alt="${esc(p.name)}" loading="lazy" draggable="false"${photoFx(variant)}>${drawingPhoto(variant, uid)}${variantPhoto(variant, p, uid)}</div>
      ${galaxyBG(variant)}${devilBG(variant)}${halloweenPhoto(variant)}${mlgBG(variant)}${mlgPhoto(variant)}${variantBG(variant)}${underStickersHTML(variant, p)}
      <div class="sc-halo"></div>
      <div class="sc-stars"></div>
      ${baseVariant(variant) === "reverse" ? '<div class="rev-foil"></div>' : ""}
      <div class="sc-top">
        <span class="sc-seal">★</span>
        <span class="sc-name">${esc(p.name)}</span>
        <span class="sc-hp"><small>HP</small>${p.hp}</span>
      </div>
      <div class="sc-panel">
        ${p.subtitle ? `<div class="sc-sub">${esc(p.subtitle)}</div>` : ""}
        ${abilitiesOf(p).map((a, i) => `<div class="sc-attack${a.kind !== "off" ? " " + a.kind : ""}"><span>${a.kind === "off" ? type.icon.repeat(i ? 2 : 1) : S.cfg.abilityKinds[a.kind]?.icon || ""}</span><span class="sc-atk">${esc(a.name)}</span><b>${a.value}</b></div>`).join("")}
        <div class="sc-foot"><span>★ TAJNA ★</span><span>${esc(crate.code)} ★${String(p.number).padStart(3, "0")}</span><span class="sc-val">${fmt(cardValue(p.id, variant))}</span></div>
      </div>
      <div class="sc-frame"></div>
      <div class="sc-border"></div>
    </div>
    ${variantLayers(variant, p)}${giftWrap(variant, uid)}
    <div class="shine"></div>
  </div>`;
}

// tajna karta, której jeszcze nie zdobyłeś
function mysteryCardHTML(p) {
  const n = rarityShare(p.crate, "secret");
  return `
  <div class="card r-secret mystery" data-pid="${p.id}" data-variant="normal">
    <div class="sc">
      <div class="sc-stars"></div>
      <div class="my-star">★</div>
      <div class="my-q">???</div>
      <div class="my-label">TAJNA KARTA</div>
      <div class="my-sub">Zdobądź ją, aby odkryć, kto to jest.<br>Szansa: 1 na ${n ? Math.round(1 / n).toLocaleString("pl-PL") : "?"}</div>
      <div class="sc-border"></div>
    </div>
  </div>`;
}

// pxPhoto, glassPhoto i fxPhoto są wołane z atrybutu onload wygenerowanego zdjęcia
Object.assign(window, { pxPhoto, glassPhoto, fxPhoto });
