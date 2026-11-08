// @ts-nocheck -- propozycje wariantów, przeniesione ze starego variant-mockups.js
import { rand } from '../../game/rules';
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

// ================================================================ wspólne (partia 2: Żelkowy, Kryształowy, Nocne niebo, Hologram, Frutiger Aero 3D)
// ASCII Art, Drewniany, Dowód osobisty, Żelkowy i Kryształowy są już w grze - cards2.css / cardHtml.ts.
const seeded = seed => { let s = seed % 2147483647 || 7; return () => (s = s * 16807 % 2147483647) / 2147483647; };

// ================================================================ NOCNE NIEBO (ns-): wersja 3 - zdjęcie wśród gwiazd, Droga Mleczna w całości za zdjęciem

const nsStars = (n, cls = "ns-star", y = [1, 99], dur = [2, 6]) => vmScatter(n, cls, () => `--s:${vmN(.3, 1.2, 2)};--o:${vmN(.45, 1, 2)};animation-duration:${vmN(dur[0], dur[1], 1)}s`, y, [1, 99]);
const nsBright = (n, dur = [3, 6]) => vmScatter(n, "ns-bright", () => `--s:${vmN(.6, 1.2, 2)};animation-duration:${vmN(dur[0], dur[1], 1)}s`, [3, 70]);
const nsMilkyWay = (o, cls = "ns-mw") => {
  const id = vmId("mw"), r = seeded(o.seed), a = o.angle * Math.PI / 180, cx = o.cx ?? 50, cy = o.cy ?? 70, ca = Math.cos(a), sa = Math.sin(a);
  let dots = "";
  for (let i = 0; i < 520; i++) {
    const t = (r() - .5) * 200, off = (r() + r() + r() - 1.5) * o.w * .8, big = r() > .93;
    dots += `<circle cx="${(cx + ca * t - sa * off).toFixed(1)}" cy="${(cy + sa * t + ca * off).toFixed(1)}" r="${(big ? .45 + r() * .4 : .1 + r() * .22).toFixed(2)}" fill="${big && r() < .3 ? "#ffd9b0" : "#fff"}" opacity="${(.3 + r() * .7).toFixed(2)}"/>`;
  }
  const W = o.w, kx = (o.core ?? .5) - .5, corX = cx + ca * kx * 120, corY = cy + sa * kx * 120;
  return vmSvg(`<defs>
    <filter id="${id}n" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="5" seed="${o.seed}"/><feColorMatrix type="matrix" values="0 0 0 0 .86  0 0 0 0 .78  0 0 0 0 1  2.4 0 0 0 -.55"/></filter>
    <filter id="${id}d" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".055 .025" numOctaves="4" seed="${o.seed + 5}"/><feColorMatrix type="matrix" values="0 0 0 0 .02  0 0 0 0 .02  0 0 0 0 .06  -2.6 0 0 0 1.3"/></filter>
    <linearGradient id="${id}b" gradientUnits="userSpaceOnUse" x1="${(cx + sa * W).toFixed(1)}" y1="${(cy - ca * W).toFixed(1)}" x2="${(cx - sa * W).toFixed(1)}" y2="${(cy + ca * W).toFixed(1)}">
      <stop offset="0" stop-color="#000"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
    <radialGradient id="${id}c"><stop offset="0" stop-color="#ffe6c0" stop-opacity=".9"/><stop offset=".5" stop-color="#ffb47a" stop-opacity=".35"/><stop offset="1" stop-color="#ff9a6a" stop-opacity="0"/></radialGradient>
    <mask id="${id}m"><rect x="-60" y="-60" width="220" height="260" fill="url(#${id}b)"/></mask></defs>
    <g mask="url(#${id}m)"><rect x="-60" y="-60" width="220" height="260" filter="url(#${id}n)"/>
    <ellipse cx="${corX.toFixed(1)}" cy="${corY.toFixed(1)}" rx="${(W * 1.3).toFixed(1)}" ry="${(W * .7).toFixed(1)}" transform="rotate(${o.angle} ${corX.toFixed(1)} ${corY.toFixed(1)})" fill="url(#${id}c)"/>
    <rect x="-60" y="-60" width="220" height="260" filter="url(#${id}d)"/>${dots}</g>`, "0 0 100 140", cls, "xMidYMid slice");
};
const nsShoot = (top, left, delay, dur) => `<i class="ns-shoot fast" style="top:${top}%;left:${left}%;animation-delay:-${delay}s;animation-duration:${dur}s"></i>`;

VARIANT_PROPOSALS.push({
  key: "nightsky", icon: "🌌", name: "Nocne niebo", tag: "✦ NOCNE NIEBO",
  about: "wybrana wersja 3 (zdjęcie wśród gwiazd): Droga Mleczna w całości za zdjęciem, spadające gwiazdy, gwiazdy migoczą wyraźnie i szybko",
  looks: [
    { name: "Zdjęcie wśród gwiazd 2", desc: "Zdjęcie bez ramki stoi przed niebem (brzegi lekko rozmyte w ciemności), Droga Mleczna z mgławicą i jasnym jądrem biegnie w całości za nim; gwiazdy w tle i przy krawędziach mrugają szybko i wyraźnie (gasną prawie do zera), co kilka sekund nad kartą przelatuje spadająca gwiazda.",
      cls: "ns mw3 v2",
      bg: () => `<div class="vm-bg ns-bg">${nsMilkyWay({ angle: -40, seed: 14, w: 30, core: .45 })}${nsStars(70, "ns-star fast", [1, 99], [.7, 1.8])}${nsBright(6, [1.2, 2.4])}${nsShoot(8, -30, 0, 6)}</div>`,
      photo: () => "",
      deco: () => `<div class="vm-deco ns-clip">${nsShoot(4, -35, 2.5, 7)}${nsShoot(22, -40, 5.5, 9)}${vmScatter(12, "ns-star fast edge", () => `--s:${vmN(.4, 1.1, 2)};--o:${vmN(.6, 1, 2)};animation-duration:${vmN(.7, 1.6, 1)}s`, [2, 98], [1, 99])}</div>` },
  ],
});

// ================================================================ HOLOGRAMOWY (hg-) i FRUTIGER AERO 3D (fa-): sceny Three.js w variant-mockups-3d.ts
const m3d = (kind, look, layer = "") => p => `<div class="vm-deco m3d-wrap"><canvas class="m3d" data-kind="${kind}" data-look="${look}" data-pid="${p.id}"${layer ? ` data-layer="${layer}"` : ""}></canvas></div>`;

VARIANT_PROPOSALS.push({
  key: "hologram", icon: "📡", name: "Hologramowy", tag: "📡 HOLO",
  about: "wybrane „lekkie zakłócenia” (makieta 2): tabliczka ze statystykami lekko po prawej i lekko przed postacią. W powiększeniu (a w grze w podglądzie karty) hologram można obracać o 360° przeciągając myszą lub palcem; puszczony wraca do lekkiego kołysania",
  looks: [
    { name: "Tabliczka przed postacią", desc: "Panel ze statystykami zachodzi na prawy brzeg postaci i wisi trochę przed nią, lekko odwrócony do środka.", cls: "hg", deco: m3d("holo2", 1) },
    { name: "Tabliczka i znaczek", desc: "Jak 1, a do tego mały znaczek z rzadkością i wartością za postacią po lewej - widać go dopiero przy obracaniu.", cls: "hg", deco: m3d("holo2", 2) },
    { name: "Wygięty ekran", desc: "Statystyki na wygiętym ekranie, który otacza postać od prawej strony z przodu jak fragment walca.", cls: "hg", deco: m3d("holo2", 3) },
    { name: "Ekran na promieniu", desc: "Tabliczka przed postacią po prawej, połączona z urządzeniem cienkim promieniem światła; lekko unosi się i opada.", cls: "hg", deco: m3d("holo2", 4) },
  ],
});

const faBg = (cls, look, extra = "") => p => `<div class="vm-bg fa-bg ${cls}"><i class="fa-rays"></i>${vmSvg('<path d="M-5 112 Q25 96 55 108 T110 104 V145 H-5Z" fill="url(#faG1)"/><path d="M-5 124 Q35 108 70 120 T110 116 V145 H-5Z" fill="url(#faG2)"/><defs><linearGradient id="faG1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ee35a"/><stop offset="1" stop-color="#3f9a2a"/></linearGradient><linearGradient id="faG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd23f"/><stop offset="1" stop-color="#2c7a1e"/></linearGradient></defs>', "0 0 100 140", "fa-hills")}${extra}<canvas class="m3d" data-kind="aero3" data-look="${look}" data-pid="${p.id}" data-layer="back"></canvas></div>`;
const faLook = (name, desc, look, cls, extra = "") => ({ name, desc, cls: `fa ${cls}`, bg: faBg(cls, look, extra), photo: () => '<i class="vm-photo fa-glass"></i>',
  deco: p => m3d("aero3", look, "front")(p) + '<div class="vm-deco"><i class="fa-gloss"></i></div>' });

VARIANT_PROPOSALS.push({
  key: "aero3d", icon: "🫧", name: "Frutiger Aero (3D)", tag: "🫧 AERO",
  about: "wybrana makieta 1: planeta z wieżowcami jest teraz w tle - za zdjęciem i statystykami (widać ją przy krawędziach i w przerwach między panelami), rybki i szklane kule zostają nad kartą; kule w nowych miejscach",
  looks: [
    faLook("Planeta za zdjęciem, lewy dół", "Planeta w tle wychodzi zza zdjęcia i paneli w lewym dolnym rogu, kule w prawym górnym rogu i przy prawej krawędzi, rybki dookoła.", 1, "sky"),
    faLook("Planeta za zdjęciem, prawa góra", "Planeta w tle za prawym górnym rogiem zdjęcia (wieżowce wystają nad nazwą), kule po lewej i na dole.", 2, "sky"),
    faLook("Wielka planeta jak horyzont", "Bardzo duża planeta w tle za dolną połową karty - jej trawiasty brzeg i wieżowce wychodzą po bokach jak horyzont, kule u góry.", 3, "sky"),
    faLook("Planeta za zdjęciem, lewa góra", "Planeta w tle w lewym górnym rogu za zdjęciem, poranne niebo z flarą obiektywu, kule przy prawej krawędzi i w dole.", 4, "orbs", '<i class="fa-flare"></i>'),
  ],
});
