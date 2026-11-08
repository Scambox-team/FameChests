// @ts-nocheck -- propozycje wariantów, przeniesione ze starego variant-mockups.js
import { abilitiesOf, cardValue, crateOf, imgUrl, rand } from '../../game/rules';
import { S } from '../../game/store';
import './variant-mockups-3d';
import './variant-mockups.css';

// Propozycje nowych wariantów (strona /variants, zakładka „Propozycje”) - makiety do wyboru, jeszcze NIE w grze.
// Każda makieta = zwykła karta + klasy vm-<wariant> vm-<wariant>-<nr> (variant-mockups.css) i ozdoby:
// bg (tło w środku karty, pod napisami), photo (na zdjęciu), deco (nad całą kartą), top (w środku karty nad nazwą),
// sub (tekst zamiast "typ · skrzynka") - vrProposalCard w variants.ts. cls - dodatkowe klasy (np. `vmx`: wygląd paneli
// ze zmiennych --x-* w variant-mockups.css). Elementy w `top` potrzebują `flex: none` (inaczej karta je ściska).
// Po wyborze wygląd przechodzi do cards2.css / cardHtml.ts jako prawdziwy wariant, a jego makiety stąd znikają.
// Pomocnicze funkcje z poprzednich makiet (rozrzucanie ozdób, obwód karty, łuki kwiatów) są w historii git.

export const vmN = (a, b, d = 0) => rand(a, b).toFixed(d);
export const vmSvg = (body, vb = "0 0 63 88", cls = "", par = "none") =>
  `<svg class="${cls}" viewBox="${vb}" preserveAspectRatio="${par}" aria-hidden="true">${body}</svg>`;
const vmPick = arr => arr[Math.floor(Math.random() * arr.length)];
// rzeczy rozrzucone po karcie (kropki, iskry, płatki): losowe miejsce i opóźnienie animacji
const vmScatter = (n, cls, extra = () => "", y = [2, 96], x = [2, 96]) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${vmN(...x)}%;top:${vmN(...y)}%;animation-delay:-${vmN(0, 6, 1)}s;${extra()}"></i>`).join("");
// rzeczy rozłożone po obwodzie karty (lampki, kwiaty): n punktów, f(x%, y%, k)
const vmPerimeter = (n, f) => Array.from({ length: n }, (_, k) => {
  let d = k / n * 302, x, y;
  if (d < 63) { x = d; y = 0; } else if ((d -= 63) < 88) { x = 63; y = d; } else if ((d -= 88) < 63) { x = 63 - d; y = 88; } else { x = 0; y = 88 - (d - 63); }
  return f((x / .63).toFixed(1), (y / .88).toFixed(1), k);
}).join("");
// unikalne id (gradienty i filtry SVG - każda makieta ma własne)
let vmIdN = 0;
const vmId = p => `${p}${++vmIdN}`;
// makieta z panelami ze zmiennych --x-* (variant-mockups.css)
const X = o => ({ ...o, cls: `vmx${o.cls ? " " + o.cls : ""}` });

// ---------------------------------------------------------------- PROPOZYCJE (obecnie żadnych)

export const VARIANT_PROPOSALS = [
];

// ---- Czarna dziura: wspólne gwiazdy i sześć propozycji wyglądu
const bhStars = (n = 26) => vmScatter(n, "bh-star", () => `width:${vmN(.5, 1.6, 1)}px;height:${vmN(.5, 1.6, 1)}px;opacity:${vmN(.3, 1, 2)}`);
// ślady światła zakrzywione wokół dziury (soczewka grawitacyjna): łuki o różnym promieniu wokół punktu (cx, cy)
const bhLensArcs = (cx, cy) => Array.from({ length: 16 }, (_, k) => {
  const r = 10 + k * 1.9, a0 = Math.random() * Math.PI * 2, span = .5 + Math.random() * 1.7;
  const pt = a => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r * .9).toFixed(1)}`;
  return `<path d="M${pt(a0)} A${r.toFixed(1)} ${(r * .9).toFixed(1)} 0 ${span > Math.PI ? 1 : 0} 1 ${pt(a0 + span)}" fill="none" stroke="#cfe6ff" stroke-width="${vmN(.12, .38, 2)}" stroke-linecap="round" opacity="${vmN(.25, .85, 2)}"/>`;
}).join("");
// lej w siatce czasoprzestrzeni: pierścienie coraz węższe w dół i linie promieniste zbiegające się w czarnym punkcie
const bhWell = () => {
  const cx = 31.5, top = 44, bot = 86, rings = [], rays = [];
  for (let i = 0; i < 14; i++) {
    const t = i / 13, y = top + (bot - top) * Math.pow(t, .8), rx = 34 * Math.pow(1 - t, 1.25) + 1.5;
    rings.push(`<ellipse cx="${cx}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * .2).toFixed(1)}" fill="none" stroke="url(#GRAD)" stroke-width=".35"/>`);
  }
  for (let i = -8; i <= 8; i++) rays.push(`<path d="M${(cx + i * 4.5).toFixed(1)} ${top} Q${(cx + i * 1.2).toFixed(1)} ${(top + 26)} ${cx} ${bot}" fill="none" stroke="url(#GRAD)" stroke-width=".25" opacity=".7"/>`);
  return rings.join("") + rays.join("");
};

VARIANT_PROPOSALS.push({
  key: "blackhole", name: "Czarna dziura", icon: "🕳️", tag: "⚫ BLACK HOLE",
  about: "karta wciągana przez czarną dziurę; sześć pomysłów na to, jak ją pokazać",
  looks: [
    { name: "Dysk akrecyjny", desc: "Rozżarzony dysk wirujący wokół czarnego rdzenia, a zdjęcie jest przyciemnione i wyblakłe jak światło tuż przed horyzontem zdarzeń.",
      bg: () => `<div class="vm-bg bh1-bg">${bhStars()}<i class="bh1-disk"></i><i class="bh1-disk b"></i></div>`,
      photo: () => `<i class="vm-photo bh1-photo"></i>`,
      deco: () => `<div class="vm-deco bh1-deco"><i class="bh1-core"></i><i class="bh1-halo"></i></div>`,
      sub: () => `HORYZONT ZDARZEŃ · ${vmN(8, 99)} Ms` },
    { name: "Soczewka grawitacyjna", desc: "Światło gwiazd wygięte w łuki wokół ciemnej kuli, błękitny pierścień Einsteina na krawędzi zdjęcia, chłodna paleta bieli i granatu.",
      bg: () => `<div class="vm-bg bh2-bg">${bhStars(34)}</div>`,
      photo: () => `<div class="vm-photo bh2-photo">${vmSvg(bhLensArcs(46, 36) + `<circle cx="46" cy="36" r="9.4" fill="none" stroke="#9fd0ff" stroke-width=".7" opacity=".9"/><circle cx="46" cy="36" r="7.6" fill="#000"/>`, "0 0 63 55", "bh2-svg", "xMidYMid slice")}</div>`,
      deco: () => `<div class="vm-deco bh2-deco"><i class="bh2-flare"></i></div>`,
      sub: () => `EFEKT EINSTEINA · z = ${vmN(.2, 4.9, 2)}` },
    { name: "Spaghettifikacja", desc: "Zdjęcie rozciągnięte w stronę dziury pod kartą: pionowe smugi światła zbiegają się w czarnym punkcie, fiolet i purpura.",
      bg: () => `<div class="vm-bg bh3-bg"><i class="bh3-spiral"></i>${bhStars(14)}</div>`,
      photo: () => `<div class="vm-photo bh3-photo"><i></i><i></i><i></i><i></i><i></i><i></i></div>`,
      deco: () => `<div class="vm-deco bh3-deco"><i class="bh3-maw"></i><i class="bh3-rim"></i></div>`,
      sub: () => `STRZĘPIENIE · ${vmN(1, 9)}×10³ g` },
    { name: "Gargantua", desc: "Kinowy kadr w stylu filmów o kosmosie: cienki złoty pierścień fotonowy, pozioma smuga dysku, czarne pasy kadru i ciepłe światło.",
      bg: () => `<div class="vm-bg bh4-bg"><i class="bh4-bar t"></i><i class="bh4-bar b"></i></div>`,
      photo: () => `<div class="vm-photo bh4-photo"><i class="bh4-ring"></i><i class="bh4-band"></i><i class="bh4-sun"></i></div>`,
      top: () => `<div class="bh4-top"><span>GARGANTUA</span><span>IMAX 70 MM</span></div>`,
      sub: () => `1 GODZINA = 7 LAT NA ZIEMI` },
    { name: "Lej czasoprzestrzeni", desc: "Neonowa siatka wgnieciona w głęboki lej, cyjan i magenta na czerni; karta leży na siatce, a pod nią czeka czarny punkt.",
      bg: () => { const g = vmId("bhg"); return `<div class="vm-bg bh5-bg">${vmSvg(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00e5ff"/><stop offset="1" stop-color="#ff2bd6"/></linearGradient></defs>${bhWell().replaceAll("GRAD", g)}<circle cx="31.5" cy="86" r="3.2" fill="#000" stroke="#ff2bd6" stroke-width=".5"/>`, "0 0 63 88", "bh5-svg")}</div>`; },
      photo: () => `<i class="vm-photo bh5-photo"></i>`,
      sub: () => `SINGULARITY.EXE · ${vmN(1, 99)}%` },
    { name: "Pochłonięta karta", desc: "Czarny krąg wżera się w kartę od rogu i zasłania część zdjęcia, wokół niego okruchy karty spiralą wpadają do środka, fiolet i biel.",
      bg: () => `<div class="vm-bg bh6-bg">${bhStars(18)}</div>`,
      photo: () => `<i class="vm-photo bh6-photo"></i>`,
      deco: () => `<div class="vm-deco bh6-deco"><i class="bh6-hole"></i><i class="bh6-ring"></i>${Array.from({ length: 9 }, (_, k) => `<i class="bh6-shard" style="--k:${k};--d:${vmN(2.6, 5.4, 1)}s;--s:${vmN(.7, 1.6, 2)}"></i>`).join("")}</div>`,
      sub: () => `POCHŁONIĘTO · ${vmN(1, 99)}%` },
  ],
});

// ================================================================ wspólne (partia: Żelkowy, ASCII, Drewniany, Kryształowy, Hologram, Dowód, Nocne niebo, Aero 3D)
const vmEsc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// obrazek SVG jako url() do stylu (bez cudzysłowów, nawiasy zakodowane)
const svgUrl = svg => `url(data:image/svg+xml,${encodeURIComponent(svg).replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/'/g, "%27")})`;
// powtarzalne losowanie (ten sam rysunek przy każdym przerysowaniu makiety)
const seeded = seed => { let s = seed % 2147483647 || 7; return () => (s = s * 16807 % 2147483647) / 2147483647; };

// ================================================================ ŻELKOWY (jl-): kolorowa, półprzezroczysta żelka z zatopionym cukrem

const jlSugar = (n, big = 1) => vmScatter(n, "jl-sug", () => `--s:${vmN(.35, 1.2 * big, 2)};animation-delay:-${vmN(0, 5, 1)}s;animation-duration:${vmN(2.4, 5, 1)}s`, [1, 99], [1, 99]);
const jlLook = (name, desc, cls, extraBg = "", extraPhoto = "") => ({
  name, desc, cls: `jl ${cls}`,
  bg: () => `<div class="vm-bg jl-bg"><i class="jl-glow a"></i><i class="jl-glow b"></i>${extraBg}</div>`,
  photo: () => `<i class="vm-photo jl-tint"></i>${extraPhoto}<i class="vm-photo jl-shine"></i>`,
  deco: () => `<div class="vm-deco jl-clip">${jlSugar(56)}</div><div class="vm-deco"><i class="jl-gloss"></i><i class="jl-rim"></i></div>`,
});

VARIANT_PROPOSALS.push({
  key: "jelly", icon: "🍬", name: "Żelkowy", tag: "🍬 ŻELKA",
  about: "kolorowa półprzezroczysta żelka: karta jak z galaretki, w środku zatopione kryształki cukru, które migoczą jak gwiazdy w Galaktycznym, miękki połysk na krawędziach; karta lekko się trzęsie jak żelka",
  looks: [
    jlLook("Arbuzowa", "Jak na załączniku: żelka przechodząca od różowej czerwieni u góry do zieleni u dołu, półprzezroczysta, zdjęcie zatopione w żelce (lekko zabarwione), cukier rozsiany po całej karcie, duży miękki odblask.", "watermelon"),
    jlLook("Kwaśny pasek", "Tęczowy kwaśny pasek: poziome pasy czerwony, pomarańczowy, żółty, zielony, niebieski przechodzące w siebie, grubo obsypany kwaśnym cukrem.", "rainbow"),
    jlLook("Niebieska malina", "Niebiesko-fioletowa żelka jak niebieska malina, mocniej przezroczysta, z błękitną poświatą od środka i cukrem jak szron.", "blue"),
    jlLook("Cytrynowa z bąbelkami", "Żółto-pomarańczowa żelka cytrynowa, w środku uwięzione pęcherzyki powietrza (także na zdjęciu), miękki pomarańczowy blask.", "lemon",
      vmScatter(10, "jl-bub", () => `--s:${vmN(.6, 1.8, 2)}`, [6, 94], [6, 94]), vmScatter(6, "jl-bub", () => `--s:${vmN(.5, 1.4, 2)}`, [6, 94], [6, 94])),
  ],
});

// ================================================================ ASCII ART (asc-): cała karta jak w terminalu, zdjęcie przerobione na znaki
// Zdjęcie zamienia przeglądarka (vmAscii): rysuje je w małym canvasie, liczy jasność każdego pola i dobiera znak
// (białe znaki na czarnym tle - im jaśniej, tym „gęstszy” znak; w trybie „letters” na krawędziach / | \ - jak w ręcznym ASCII art).

const ASC_RAMPS = {
  classic: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  letters: " .,:;i1lIdbSWM",
  blocks: " ░▒▓█",
  dense: " .:-=+*#%@",
};
const ascMount = (p, mode, cols) => `<pre class="vm-photo asc-art" data-mode="${mode}" data-cols="${cols}"></pre><img class="asc-src" src="${imgUrl(p.id, "normal")}" alt="" onload="vmAscii(this)">`;
// ramka karty z samych znaków (+---+ i |)
const ascBox = (w = 34, h = 28) => `<pre class="vm-deco asc-box">${"+" + "-".repeat(w - 2) + "+\n" + ("|" + " ".repeat(w - 2) + "|\n").repeat(h - 2) + "+" + "-".repeat(w - 2) + "+"}</pre>`;
// rozsiane znaki w tle
const ascNoise = (n = 1500) => { const r = seeded(91), ch = "01#@$%&*+=-:;.<>/\\|"; let s = "";
  for (let i = 0; i < n; i++) s += r() < .78 ? " " : ch[Math.floor(r() * ch.length)]; return `<pre class="vm-bg asc-noise">${s}</pre>`; };

(window as any).vmAscii = (img, tries = 0) => {
  const pre = img.previousElementSibling, box = pre?.parentElement, card = pre?.closest(".card");
  if (!pre || !box || !card) return;
  const bw = box.clientWidth, bh = box.clientHeight, cw = card.clientWidth;
  if (!bw || !bh || !cw) { if (tries < 30) requestAnimationFrame(() => (window as any).vmAscii(img, tries + 1)); return; }
  const mode = pre.dataset.mode || "classic", cols = +pre.dataset.cols || 60, ramp = ASC_RAMPS[mode] || ASC_RAMPS.classic;
  const rows = Math.max(8, Math.round(cols * .6 * bh / bw));
  const cvs = document.createElement("canvas");
  cvs.width = cols; cvs.height = rows;
  const ctx = cvs.getContext("2d", { willReadFrequently: true });
  // przycięcie jak object-fit: cover, kadr przesunięty w stronę twarzy (18% od góry)
  const iw = img.naturalWidth, ih = img.naturalHeight, ta = bw / bh;
  let sw = iw, sh = ih, sx = 0, sy = 0;
  if (iw / ih > ta) { sw = ih * ta; sx = (iw - sw) / 2; } else { sh = iw / ta; sy = (ih - sh) * .18; }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows);
  let data;
  try { data = ctx.getImageData(0, 0, cols, rows).data; } catch { return; }
  const L = new Float32Array(cols * rows);
  for (let i = 0; i < L.length; i++) L[i] = (data[i * 4] * .299 + data[i * 4 + 1] * .587 + data[i * 4 + 2] * .114) / 255;
  // rozciągnięcie kontrastu (2. i 98. percentyl)
  const sorted = Float32Array.from(L).sort(), lo = sorted[Math.floor(L.length * .02)], hi = sorted[Math.floor(L.length * .98)] || 1;
  for (let i = 0; i < L.length; i++) L[i] = Math.min(1, Math.max(0, (L[i] - lo) / Math.max(.05, hi - lo))) ** 1.1;
  // tło: jednolite pola połączone z krawędzią zdjęcia (np. jasne tło portretu) zamieniamy na spacje, żeby postać stała na czarnym
  const bg = new Uint8Array(L.length), queue = [];
  const edge = [];
  for (let x = 0; x < cols; x++) edge.push(L[x], L[(rows - 1) * cols + x]);
  for (let y = 0; y < rows; y++) edge.push(L[y * cols], L[y * cols + cols - 1]);
  edge.sort((a, b) => a - b);
  const edgeMean = edge[Math.floor(edge.length / 2)];   // mediana brzegu = kolor tła
  const near = i => Math.abs(L[i] - edgeMean) < .1;
  for (let x = 0; x < cols; x++) for (const y of [0, rows - 1]) { const i = y * cols + x; if (near(i) && !bg[i]) { bg[i] = 1; queue.push(i); } }
  for (let y = 0; y < rows; y++) for (const x of [0, cols - 1]) { const i = y * cols + x; if (near(i) && !bg[i]) { bg[i] = 1; queue.push(i); } }
  while (queue.length) { const i = queue.pop(), x = i % cols, y = (i - x) / cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue; const j = ny * cols + nx; if (!bg[j] && near(j)) { bg[j] = 1; queue.push(j); } } }
  const hasBg = bg.reduce((a, b) => a + b, 0) < L.length * .8;
  let out = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = L[y * cols + x];
      if (hasBg && bg[y * cols + x]) { out += " "; continue; }
      if (mode === "letters" && x > 0 && y > 0 && x < cols - 1 && y < rows - 1) {
        const g = (dx, dy) => L[(y + dy) * cols + x + dx];
        const gx = g(1, -1) + 2 * g(1, 0) + g(1, 1) - g(-1, -1) - 2 * g(-1, 0) - g(-1, 1);
        const gy = g(-1, 1) + 2 * g(0, 1) + g(1, 1) - g(-1, -1) - 2 * g(0, -1) - g(1, -1);
        if (Math.hypot(gx, gy) > 1.1) {
          const a = (Math.atan2(gy, gx) * 180 / Math.PI + 180) % 180;   // kierunek zmiany jasności; krawędź jest prostopadła
          out += a < 22.5 || a >= 157.5 ? "|" : a < 67.5 ? "\\" : a < 112.5 ? "_" : "/";
          continue;
        }
      }
      out += ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))];
    }
    out += "\n";
  }
  pre.textContent = out;
  pre.style.fontSize = `${(bw / (cols * .6) / cw * 100).toFixed(3)}cqw`;
  pre.dataset.done = "1";
};

const ascLook = (name, desc, mode, cols, cls, extra = {}) => ({
  name, desc, cls: `asc ${cls}`,
  bg: () => extra.noise ? ascNoise() : "",
  photo: p => ascMount(p, mode, cols),
  deco: () => extra.box ? ascBox() : "",
});

VARIANT_PROPOSALS.push({
  key: "ascii", icon: "⌨️", name: "ASCII Art", tag: "> ASCII",
  about: "cała karta jak ekran terminala: białe znaki na czarnym tle, wszystkie napisy monospace, a zdjęcie przerobione na ASCII art w przeglądarce (algorytm: jasność każdego pola zdjęcia -> znak; w wersji 2 krawędzie twarzy rysowane znakami / | \\ _ jak na załączniku). Działa z każdym zdjęciem karty, także dodanym w panelu",
  looks: [
    ascLook("Terminal", "Czarny ekran, karta obrysowana ramką ze znaków + - |, zdjęcie z pełnej palety 70 znaków, nazwa z migającym kursorem.", "classic", 64, "t1", { box: true }),
    ascLook("Ręczny ASCII art", "Jak na załączniku: mniej znaków, litery i kreski (d b I l ; : .), kontury twarzy rysowane znakami / \\ | _, w tle rozsiane przypadkowe znaki.", "letters", 54, "t2", { noise: true }),
    ascLook("Bloki", "Zdjęcie z pełnych bloków ░ ▒ ▓ █ jak w starych programach DOS, nazwa w odwróconym pasku (czarne litery na białym).", "blocks", 46, "t3"),
    ascLook("Wydruk", "Gęste, drobne znaki (96 kolumn) - zdjęcie wypisuje się linijka po linijce jak w terminalu, potem chwila przerwy i od nowa.", "dense", 96, "t4", { box: true }),
  ],
});

// ================================================================ DREWNIANY (wd-): prosta, nieruchoma karta z drewna

// tekstura drewna: szum SVG (feTurbulence) rozciągnięty w słoje i pokolorowany tabelą brązów (paski = słoje)
const wdTex = o => svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420"><filter id="w" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="${o.type || "fractalNoise"}" baseFrequency="${o.freq}" numOctaves="${o.oct || 4}" seed="${o.seed || 3}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="table" tableValues="${o.r}"/><feFuncG type="table" tableValues="${o.g}"/><feFuncB type="table" tableValues="${o.b}"/><feFuncA type="discrete" tableValues="1"/></feComponentTransfer></filter><rect width="300" height="420" filter="url(#w)"/></svg>`);
const WOOD = {
  oak: { freq: "0.09 0.006", oct: 4, seed: 4, r: ".78 .62 .74 .58 .7 .55 .76", g: ".55 .41 .52 .38 .49 .36 .54", b: ".3 .2 .28 .18 .26 .17 .3" },
  oakDark: { freq: "0.09 0.006", oct: 4, seed: 9, r: ".42 .3 .38 .27 .36", g: ".25 .17 .22 .15 .21", b: ".12 .07 .1 .06 .1" },
  burl: { type: "turbulence", freq: "0.022 0.03", oct: 5, seed: 12, r: ".86 .55 .8 .42 .76 .5 .84 .36 .7", g: ".58 .32 .53 .22 .5 .28 .56 .17 .45", b: ".28 .12 .25 .07 .23 .1 .27 .05 .2" },
  ebony: { freq: "0.06 0.004", oct: 5, seed: 21, r: ".3 .18 .26 .12 .22 .34 .16", g: ".14 .08 .12 .05 .1 .16 .07", b: ".08 .04 .07 .03 .06 .09 .04" },
  pine: { freq: "0.07 0.005", oct: 3, seed: 2, r: ".93 .85 .9 .8 .92 .78", g: ".76 .65 .72 .6 .74 .57", b: ".48 .38 .45 .34 .47 .32" },
};
const wdLook = (name, desc, wood, frame, cls) => ({
  name, desc, cls: `wd ${cls}`,
  bg: () => `<div class="vm-bg wd-bg" style="background-image:${wdTex(WOOD[wood])}"></div>`,
  deco: () => `<div class="vm-deco wd-frame" style="--wd-frame:${wdTex(WOOD[frame])}"></div>`,
});

VARIANT_PROPOSALS.push({
  key: "wood", icon: "🪵", name: "Drewniany", tag: "🪵 DREWNO",
  about: "jeden z prostszych i tańszych wariantów: karta z drewna (tekstura słojów z szumu SVG, bez zdjęć z internetu), napisy jak wypalone, panele wyfrezowane w desce, zdjęcie w drewnianej ramce; bez animacji",
  looks: [
    wdLook("Korzeń orzecha", "Jak na załączniku: złocisto-brązowe drewno z korzenia - słoje zawijają się w wiry i oczka, ramka z ciemniejszego drewna.", "burl", "oakDark", "burl"),
    wdLook("Dąb", "Jasny dąb z prostymi słojami biegnącymi z góry na dół, ramka z ciemnego dębu, napisy wypalone.", "oak", "oakDark", "oak"),
    wdLook("Heban", "Ciemne, prawie czarne drewno hebanowe z delikatnymi słojami, jasne napisy jak inkrustowane, złote obwódki.", "ebony", "ebony", "ebony"),
    wdLook("Sosnowe deski", "Jasna sosna ułożona z poziomych desek ze szczelinami i gwoździkami w rogach.", "pine", "oak", "pine"),
  ],
});

// ================================================================ KRYSZTAŁOWY (cr-): mieniąca się karta z oszlifowanego kryształu (jak Crystal / Gem w Fortnite)

// siatka trójkątów (fasetki): kolumny x wiersze, kolory z palety, losowo jaśniejsze
const crMesh = (cols, rows, pal, seed, op = [.6, 1], stroke = "") => {
  const r = seeded(seed), P = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++)
    P.push([x * 100 / cols + (x && x < cols ? (r() - .5) * 70 / cols : 0), y * 140 / rows + (y && y < rows ? (r() - .5) * 98 / rows : 0)]);
  const at = (x, y) => P[y * (cols + 1) + x], tri = (a, b, c) => `<path d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}L${c[0].toFixed(1)} ${c[1].toFixed(1)}Z" fill="${pal[Math.floor(r() * pal.length)]}" opacity="${(op[0] + r() * (op[1] - op[0])).toFixed(2)}"${stroke}/>`;
  let s = "";
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const flip = r() < .5;
    s += flip ? tri(at(x, y), at(x + 1, y), at(x, y + 1)) + tri(at(x + 1, y), at(x + 1, y + 1), at(x, y + 1))
      : tri(at(x, y), at(x + 1, y), at(x + 1, y + 1)) + tri(at(x, y), at(x + 1, y + 1), at(x, y + 1));
  }
  return s;
};
const crSparks = n => vmScatter(n, "cr-spark", () => `--s:${vmN(.5, 1.4, 2)};animation-duration:${vmN(1.6, 3.4, 1)}s`);
const crLook = (name, desc, cls, pal, photoPal, opts = {}) => ({
  name, desc, cls: `cr ${cls}`,
  bg: () => `<div class="vm-bg cr-bg">${vmSvg(crMesh(7, 10, pal, 5 + pal.length, [.55, 1], opts.edge ? ` stroke="${opts.edge}" stroke-width=".25"` : ""), "0 0 100 140", "cr-mesh")}<i class="cr-shim"></i></div>`,
  photo: () => `${vmSvg(crMesh(6, 8, photoPal, 33, [.15, .55], ` stroke="#ffffff" stroke-opacity=".45" stroke-width=".4"`), "0 0 100 140", "vm-photo cr-facet")}<i class="vm-photo cr-shim ph"></i>${crSparks(4)}`,
  deco: () => `<div class="vm-deco">${crSparks(opts.sparks || 12)}</div>`,
});

VARIANT_PROPOSALS.push({
  key: "crystal", icon: "💠", name: "Kryształowy", tag: "💠 KRYSZTAŁ",
  about: "karta z oszlifowanego kryształu jak skórki Crystal / Gem z Fortnite: całość z fasetek, po których przebiega tęczowy połysk, zdjęcie też jakby pocięte na fasetki, iskry migoczą na krawędziach",
  looks: [
    crLook("Diament", "Jak na załączniku: biało-błękitne fasetki, chłodna niebieska poświata dookoła karty, mocne białe iskry.", "diamond", ["#ffffff", "#eef7ff", "#d6ecff", "#bcdcff", "#f3eeff", "#a9cfff"], ["#ffffff", "#8fc4ff", "#cfe7ff", "#5a8ad8"]),
    crLook("Ametyst", "Fioletowy kryształ: fasetki od lawendy do głębokiego fioletu, fioletowa poświata, iskry różowe.", "amethyst", ["#f1e4ff", "#d9bcff", "#bf94ff", "#a06cf5", "#8650e6", "#e8d4ff"], ["#ffffff", "#c99aff", "#7a4ad0"]),
    crLook("Pryzmat", "Prawie przezroczysty biały kryształ, przez który przechodzi mocny tęczowy blask - kolory przesuwają się po fasetkach jak w pryzmacie.", "prism", ["#ffffff", "#f6f9ff", "#eef3ff", "#fbf4ff", "#f0fbff"], ["#ffffff", "#ff9ad8", "#8ad0ff", "#8affc4"], { sparks: 16 }),
    crLook("Mroczny kryształ", "Granatowy, ciemny kryształ (jak Gem Grim): ciemne fasetki z jasnymi świecącymi krawędziami, błękitna poświata.", "dark", ["#14214d", "#1c2d66", "#24397f", "#0f1838", "#2e4799", "#18275a"], ["#9fd8ff", "#3a5fd0"], { edge: "#9fd8ff" }),
  ],
});

// ================================================================ DOWÓD OSOBISTY (id-): pozioma karta wzorowana na polskim dowodzie
// Celowo „Rzeczpospolita ScamBoxowa” i „Dowód kolekcjonerski”, tarcza z SB zamiast godła i bez flagi UE - ma przypominać dowód,
// ale nie udawać prawdziwego dokumentu (godło RP jest chronione prawem). Na makietach karta jest pozioma (jak w podglądzie);
// w ekwipunku będzie stała pionowo (obrócona), żeby nie psuć siatki.

const idSplit = name => { const w = String(name).trim().split(/\s+/); return w.length > 1 ? [w[w.length - 1], w.slice(0, -1).join(" ")] : [w[0], "—"]; };
const idData = p => {
  const crate = crateOf(p.crate), ab = abilitiesOf(p)[0], [sur, giv] = idSplit(p.name);
  return { sur, giv, nat: !p.country || p.country === "pl" ? "POLSKIE" : String(p.country).toUpperCase(), num: `${crate?.code || "SB"}${String(p.number || 0).padStart(6, "0")}`,
    rar: S.cfg.rarities[p.rarity]?.name || p.rarity, hp: p.hp, atk: ab ? `${ab.name} · ${ab.value}` : "—", val: cardValue(p.id), photo: imgUrl(p.id, "normal"), crate: crate?.name || "" };
};
const idMrz = (d, n = 30) => {
  const plain = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L").toUpperCase().replace(/[^A-Z0-9]+/g, "<");
  const line = s => (s + "<".repeat(n)).slice(0, n);
  return [line(`IDSBX${d.num}<<`), line(`${String(d.hp).padStart(4, "0")}<${String(d.val).padStart(7, "0")}<SBX<<${plain(d.rar)}`), line(`${plain(d.sur)}<<${plain(d.giv)}`)].map(vmEsc).join("\n");
};
const idField = (pl, en, val, cls = "") => `<div class="id-f ${cls}"><small>${pl}<em>/ ${en}</em></small><b>${vmEsc(val)}</b></div>`;
const idShield = '<i class="id-shield"><b>SB</b></i>';
const idFront = (p, cls) => {
  const d = idData(p);
  return `<div class="vm-deco id-card ${cls}">
    <i class="id-guil"></i>${idShield}
    <div class="id-head"><b>Rzeczpospolita ScamBoxowa</b> <span>Republic of ScamBox</span><br><b>Dowód kolekcjonerski</b> <span>Collector card</span></div>
    <i class="id-sb">SB</i><i class="id-chip-mark"></i>
    <div class="id-photo"><img src="${d.photo}" alt=""></div>
    <div class="id-fields">
      ${idField("NAZWISKO", "SURNAME", d.sur.toUpperCase(), "big")}${idField("IMIONA", "GIVEN NAMES", d.giv.toUpperCase(), "big")}
      ${idField("OBYWATELSTWO", "NATIONALITY", d.nat)}${idField("RZADKOŚĆ", "RARITY", d.rar.toUpperCase(), "r")}
      ${idField("SERIA I NUMER KARTY", "CARD NUMBER", d.num)}${idField("PUNKTY ŻYCIA", "HP", d.hp, "r")}
      ${idField("ATAK", "ATTACK", d.atk, "wide")}
    </div>
    <div class="id-ghost"><img src="${d.photo}" alt=""></div>
    <div class="id-sign"><small>PODPIS<em>/ SIGNATURE</em></small><i>${vmEsc(p.name)}</i></div>
    <div class="id-can"><b>${String(d.val).padStart(6, "0")}</b><small>WARTOŚĆ<em>/ VALUE</em></small></div>
    <i class="id-water">KOLEKCJONERSKI</i>${cls.includes("holo") ? '<i class="id-holo"></i><i class="id-holo b"></i>' : ""}
  </div>`;
};
const idBack = p => {
  const d = idData(p);
  return `<div class="vm-deco id-card back">
    <i class="id-guil"></i><i class="id-chip"></i>
    <div class="id-fields back">
      ${idField("SKRZYNKA", "CRATE", d.crate || "—", "wide")}${idField("PUNKTY ŻYCIA", "HP", d.hp)}${idField("WARTOŚĆ", "VALUE", `${d.val} gr`)}
      ${idField("ATAK", "ATTACK", d.atk, "wide")}${idField("ORGAN WYDAJĄCY", "AUTHORITY", "SCAMBOX")}${idField("RZADKOŚĆ", "RARITY", d.rar.toUpperCase())}
    </div>
    <div class="id-photo small"><img src="${d.photo}" alt=""></div>
    <pre class="id-mrz">${idMrz(d)}</pre>
  </div>`;
};
const idLook = (name, desc, build) => ({ name, desc, cls: "idc", deco: build });

VARIANT_PROPOSALS.push({
  key: "dowod", icon: "🪪", name: "Dowód osobisty", tag: "🪪 DOWÓD",
  about: "pozioma karta wzorowana na polskim dowodzie: zdjęcie po lewej, rubryki z nazwiskiem i statystykami karty, zdjęcie-cień, podpis i numer CAN (= wartość karty). Napisy „Rzeczpospolita ScamBoxowa / Dowód kolekcjonerski”, tarcza SB zamiast godła i bez flagi UE, żeby nie udawać prawdziwego dokumentu. W podglądzie poziomo, w ekwipunku pionowo",
  looks: [
    idLook("Nowy dowód", "Jak na załączniku: różowo-niebieskie tło z giloszem, czarno-białe zdjęcie po lewej, mniejsze zdjęcie-cień po prawej, podpis, duży numer, ukośny znak wodny.", p => idFront(p, "new")),
    idLook("Stary zielony", "Wzór starszego dowodu: zielonkawo-błękitne tło z falistym giloszem, zdjęcie w kolorze sepii, czerwony numer serii.", p => idFront(p, "old")),
    idLook("Rewers", "Tył dowodu: złoty chip, rubryki ze statystykami karty, małe zdjęcie i trzy linijki kodu do odczytu maszynowego (MRZ) wygenerowane z nazwiska i numeru karty.", idBack),
    idLook("Laminat z hologramem", "Nowy dowód z błyszczącym laminatem: po karcie przesuwa się tęczowy hologram, tarcza SB mieni się jak znak zabezpieczający.", p => idFront(p, "new holo")),
  ],
});

// ================================================================ NOCNE NIEBO (ns-): gwiazdy, Droga Mleczna, gwiazdozbiory

const nsStars = (n, cls = "ns-star", y = [1, 99]) => vmScatter(n, cls, () => `--s:${vmN(.3, 1.2, 2)};--o:${vmN(.35, 1, 2)};animation-duration:${vmN(2, 6, 1)}s`, y, [1, 99]);
const nsBright = n => vmScatter(n, "ns-bright", () => `--s:${vmN(.6, 1.2, 2)};animation-duration:${vmN(3, 6, 1)}s`, [3, 70]);
// sylwetka drzewa (korona z kół) i trawy
const nsTree = () => { const r = seeded(17); let c = "";
  for (let i = 0; i < 46; i++) { const a = r() * Math.PI * 2, d = r() * 20; c += `<circle cx="${(-3 + Math.cos(a) * d * .5).toFixed(1)}" cy="${(78 + Math.sin(a) * d * 1.4).toFixed(1)}" r="${(3 + r() * 4).toFixed(1)}"/>`; }
  for (let i = 0; i < 26; i++) c += `<circle cx="${(r() * 100).toFixed(1)}" cy="${(132 + r() * 6).toFixed(1)}" r="${(2 + r() * 4).toFixed(1)}"/>`;
  for (let i = 0; i < 40; i++) { const x = r() * 100; c += `<path d="M${x.toFixed(1)} 140 Q${(x + (r() - .5) * 4).toFixed(1)} ${(128 - r() * 8).toFixed(1)} ${(x + (r() - .5) * 6).toFixed(1)} ${(122 - r() * 10).toFixed(1)}" stroke="#03050a" stroke-width=".5" fill="none"/>`; }
  return vmSvg(`<g fill="#03050a">${c}<rect x="0" y="95" width="3" height="45"/><rect x="0" y="136" width="100" height="4"/></g>`, "0 0 100 140", "ns-sil"); };
// gwiazdozbiór (kształt Wielkiego Wozu) - linie i jasne gwiazdy w wierzchołkach
const NS_DIPPER = [[14, 18], [26, 14], [37, 19], [47, 26], [50, 40], [66, 42], [70, 28]];
const nsConstellation = () => vmSvg(`<path d="M${NS_DIPPER.map(p => p.join(" ")).join(" L")} L47 26" stroke="#bcd4ff" stroke-width=".35" stroke-opacity=".7" fill="none" stroke-dasharray="1.2 .8"/>${NS_DIPPER.map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" fill="#fff"/><circle cx="${x}" cy="${y}" r="2.4" fill="#bcd4ff" opacity=".25"/>`).join("")}`, "0 0 100 140", "ns-const");
const nsTrails = () => { const r = seeded(4); let s = "";
  for (let i = 0; i < 60; i++) { const rad = 6 + r() * 120, a0 = r() * 360, len = 25 + r() * 40, o = (.25 + r() * .7).toFixed(2), w = (.15 + r() * .35).toFixed(2);
    const p = a => [88 + Math.cos(a * Math.PI / 180) * rad, 6 + Math.sin(a * Math.PI / 180) * rad];
    const [x1, y1] = p(a0), [x2, y2] = p(a0 + len);
    s += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${rad.toFixed(1)} ${rad.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${r() < .2 ? "#ffd9a8" : r() < .3 ? "#a8c8ff" : "#fff"}" stroke-opacity="${o}" stroke-width="${w}" fill="none"/>`; }
  return vmSvg(s, "0 0 100 140", "ns-trails", "xMidYMid slice"); };
const nsLook = (name, desc, cls, bg, photo = () => "", deco = () => "") => ({ name, desc, cls: `ns ${cls}`, bg, photo: p => `<i class="vm-photo ns-ph"></i>${photo(p)}`, deco });

VARIANT_PROPOSALS.push({
  key: "nightsky", icon: "🌌", name: "Nocne niebo", tag: "✦ NOCNE NIEBO",
  about: "karta jak nocne niebo: setki migoczących gwiazd na granatowo-czarnym tle (także na zdjęciu), spadające gwiazdy, w rogach sylwetki drzew i trawy, łuna nad horyzontem jak na załączniku",
  looks: [
    nsLook("Polana nocą", "Jak na załączniku: czarno-granatowe niebo pełne gwiazd, przy dole ciepła łuna nad horyzontem, sylwetka drzewa w lewym rogu i trawy przy dole, raz na jakiś czas spada gwiazda.", "glade",
      () => `<div class="vm-bg ns-bg"><i class="ns-glow"></i>${nsStars(70)}${nsBright(5)}<i class="ns-shoot"></i></div>`, () => nsStars(14, "ns-star ph"),
      () => `<div class="vm-deco ns-clip">${nsTree()}</div>`),
    nsLook("Droga Mleczna", "Przez całą kartę po skosie biegnie Droga Mleczna (mgławica w fiolecie i błękicie gęsta od gwiazd), przechodzi też przez zdjęcie.", "milky",
      () => `<div class="vm-bg ns-bg"><i class="ns-milky"></i>${nsStars(80)}${nsBright(4)}</div>`, () => `<i class="vm-photo ns-milky ph"></i>${nsStars(24, "ns-star ph")}`,
      () => `<div class="vm-deco ns-clip"><i class="ns-shoot b"></i></div>`),
    nsLook("Gwiazdozbiory", "Głęboki granat z gwiazdami połączonymi liniami w gwiazdozbiory (Wielki Wóz nad nazwą i drugi na zdjęciu), jasne gwiazdy pulsują.", "const",
      () => `<div class="vm-bg ns-bg">${nsStars(60)}${nsConstellation()}</div>`, () => `${nsStars(12, "ns-star ph")}${nsConstellation()}`,
      () => `<div class="vm-deco ns-clip">${nsConstellation()}</div>`),
    nsLook("Smugi gwiazd", "Zdjęcie z długim czasem naświetlania: gwiazdy rysują łuki wokół gwiazdy polarnej w prawym górnym rogu, łuki powoli się obracają, przy dole czarna linia drzew.", "trails",
      () => `<div class="vm-bg ns-bg"><i class="ns-glow cool"></i>${nsTrails()}</div>`, () => `<i class="vm-photo ns-trail-ph">${nsTrails()}</i>`,
      () => `<div class="vm-deco ns-clip">${nsTree()}</div>`),
  ],
});

// ================================================================ HOLOGRAMOWY (hg-) i FRUTIGER AERO 3D (fa-): sceny Three.js w variant-mockups-3d.ts
const m3d = (kind, look) => p => `<div class="vm-deco m3d-wrap"><canvas class="m3d" data-kind="${kind}" data-look="${look}" data-pid="${p.id}"></canvas></div>`;

VARIANT_PROPOSALS.push({
  key: "hologram", icon: "📡", name: "Hologramowy", tag: "📡 HOLO",
  about: "to już nie karta: okrągłe, płaskie futurystyczne urządzenie w 3D, z którego w górę świeci niebieski hologram osoby i statystyk karty (jak w Gwiezdnych wojnach: linie skanowania, migotanie, zakłócenia przesuwające obraz). Wszystko w Three.js - scena się rusza, w podglądzie karty będzie większa",
  looks: [
    { name: "Projektor stołowy", desc: "Płaski metalowy dysk ze świecącym pierścieniem i diodami, nad nim w snopie światła postać i panel ze statystykami (nazwa, HP z paskiem, ataki, wartość, rzadkość); całość powoli obraca się w obie strony.", cls: "hg", deco: m3d("holo", 1) },
    { name: "Popiersie z pierścieniem", desc: "Hologram popiersia w miękkim kole, a dookoła niego kręci się świetlny pierścień, po którym biegną statystyki karty; postać lekko unosi się i opada.", cls: "hg", deco: m3d("holo", 2) },
    { name: "Wiadomość z daleka", desc: "Mały smukły nadajnik, hologram ziarnisty i mocno zakłócony jak odebrana z daleka wiadomość: częste przeskoki obrazu, pasy zakłóceń, migotanie; obok mniejszy panel statystyk.", cls: "hg", deco: m3d("holo", 3) },
    { name: "Stół taktyczny", desc: "Szeroki dysk z holograficzną siatką okręgów, postać na środku, a wokół niej krążą trzy panele: HP, atak i wartość (zawsze zwrócone do widza).", cls: "hg", deco: m3d("holo", 4) },
  ],
});

const faBg = (cls, extra = "") => `<div class="vm-bg fa-bg ${cls}"><i class="fa-rays"></i>${vmSvg('<path d="M-5 112 Q25 96 55 108 T110 104 V145 H-5Z" fill="url(#faG1)"/><path d="M-5 124 Q35 108 70 120 T110 116 V145 H-5Z" fill="url(#faG2)"/><defs><linearGradient id="faG1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ee35a"/><stop offset="1" stop-color="#3f9a2a"/></linearGradient><linearGradient id="faG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd23f"/><stop offset="1" stop-color="#2c7a1e"/></linearGradient></defs>', "0 0 100 140", "fa-hills")}${extra}</div>`;
const faLook = (name, desc, look, cls, extra = "") => ({ name, desc, cls: `fa ${cls}`, bg: () => faBg(cls, extra), photo: () => '<i class="vm-photo fa-glass"></i>', deco: p => m3d("aero", look)(p) + '<div class="vm-deco"><i class="fa-gloss"></i></div>' });

VARIANT_PROPOSALS.push({
  key: "aero3d", icon: "🫧", name: "Frutiger Aero (3D)", tag: "🫧 AERO",
  about: "nowa wersja Frutiger Aero z modelami 3D (Three.js, modele zbudowane w kodzie): błyszczące bańki, rybki, małe planety i szklane kule nad kartą w stylu Windows Vista / Frutiger Aero - niebo, zielone wzgórza, szklane panele, połysk. Karta nie musi pasować do reszty gry",
  looks: [
    faLook("Bańki", "Dziesiątki tęczowych baniek mydlanych w 3D unoszą się przez całą kartę (także przed zdjęciem), błękitne niebo, zielone wzgórza, szklane panele z połyskiem.", 1, "sky"),
    faLook("Akwarium", "Pod wodą: kolorowe rybki 3D (pomarańczowa, niebieska, żółta, różowa, turkusowa) pływają dookoła zdjęcia, machają ogonami, w górę lecą bąbelki, po tle przesuwają się refleksy światła.", 2, "water", '<i class="fa-caustic"></i>'),
    faLook("Małe planety", "Trzy małe trawiaste planety jak ze zdjęć „tiny planet”: z drzewkami i domkiem, w szklanej atmosferze, obracają się i krążą przy rogach karty.", 3, "planets"),
    faLook("Szklane kule", "Duże szklane kule w kolorach wody i trawy powoli unoszą się przy krawędziach, po karcie przechodzi smuga światła jak flara obiektywu - klasyczna tapeta Vista.", 4, "orbs", '<i class="fa-flare"></i>'),
  ],
});
