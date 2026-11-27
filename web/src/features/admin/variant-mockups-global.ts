// @ts-nocheck -- makiety wariantu „Globalny” (`global`): estetyka organizacji międzynarodowych. JESZCZE NIE W GRZE.
// Połączenie dwóch pomysłów: sali obrad (półokrąg miejsc, reflektory) i globusa (siatka południków, kontury kontynentów). Wyłącznie odcienie
// NIEBIESKIEGO (granat, błękit, jasny błękit), bez flag, bez napisów pod zdjęciem i nad nazwą (zostaje zwykły podpis karty). Własne, ogólne symbole
// (globus, wieniec, gwiazdki), bez godeł i logo organizacji. Cztery różne wersje: Hologram w sali, Orbita, Siatka, Kopuła.
// Style: variant-mockups-global.css, klasy gbl- (gl- to Witrażowa). Animacje tylko transform / opacity. Pomocniki skopiowane z variant-mockups.ts
// (import w drugą stronę zrobiłby cykl).
import { rand } from '../../game/rules';
import './variant-mockups-global.css';

const vmN = (a, b, d = 0) => rand(a, b).toFixed(d);
const vmSvg = (body, vb = "0 0 63 88", cls = "", par = "none") => `<svg class="${cls}" viewBox="${vb}" preserveAspectRatio="${par}" aria-hidden="true">${body}</svg>`;
let idN = 0;
const vmId = p => `${p}${++idN}`;
const scatter = (n, cls, extra = () => "", y = [2, 96], x = [2, 96]) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${vmN(...x)}%;top:${vmN(...y)}%;animation-delay:-${vmN(0, 6, 1)}s;${extra()}"></i>`).join("");

const star = (cx, cy, r) => Array.from({ length: 10 }, (_, i) => {
  const a = Math.PI * i / 5 - Math.PI / 2, rr = i % 2 ? r * .42 : r;
  return `${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`;
}).join(" ");

// kontury kontynentów (własne, uproszczone plamy) w układzie -1..1
const CONT = [
  "M-.55 -.55 -.25 -.7 .1 -.5 .0 -.3 -.2 -.15 -.5 -.2Z", "M-.35 .0 -.1 .05 -.05 .4 -.2 .75 -.38 .5Z", "M.15 -.62 .55 -.5 .72 -.25 .5 .0 .3 -.05 .1 -.25Z",
  "M.12 .02 .38 .05 .42 .4 .25 .62 .1 .35Z", "M.55 .45 .8 .4 .75 .62 .55 .6Z",
];
// siatka południków i równoleżników
const grid = (cx, cy, r, line, w = .22, op = .55) =>
  [.25, .5, .75].map(k => `<ellipse cx="${cx}" cy="${cy}" rx="${(r * k).toFixed(2)}" ry="${r}" fill="none" stroke="${line}" stroke-width="${w}" opacity="${op}"/>`).join("") +
  [-.6, -.3, 0, .3, .6].map(k => { const y = cy + r * k, wd = Math.sqrt(1 - k * k) * r; return `<ellipse cx="${cx}" cy="${y.toFixed(2)}" rx="${wd.toFixed(2)}" ry="${(wd * .12).toFixed(2)}" fill="none" stroke="${line}" stroke-width="${w * .9}" opacity="${op * .8}"/>`; }).join("");
// globus pełny (niebieskie morze, jasnoniebieskie kontynenty)
const globe = (cx, cy, r, id) => `<defs><radialGradient id="${id}s" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#6fb4ff"/><stop offset="1" stop-color="#0a2a66"/></radialGradient>
  <clipPath id="${id}c"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}s)"/>
  <g clip-path="url(#${id}c)">${CONT.map(d => `<path d="${d}" transform="translate(${cx} ${cy}) scale(${r})" fill="#a9d2ff" opacity=".6"/>`).join("")}${grid(cx, cy, r, "#e8f0ff")}</g>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e8f0ff" stroke-width=".35" opacity=".7"/>`;
// globus „szkieletowy”: tylko linie
const wire = (cx, cy, r, line = "#8cc4ff", op = .8) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${line}" stroke-width=".35" opacity="${op}"/>${grid(cx, cy, r, line, .24, op)}` +
  CONT.map(d => `<path d="${d}" transform="translate(${cx} ${cy}) scale(${r})" fill="none" stroke="${line}" stroke-width="${(.3 / r).toFixed(3)}" opacity="${op * .8}"/>`).join("");

// półokrąg miejsc w sali: rzędy kropek na łukach wokół punktu (cx, cy)
const seats = (cx, cy, from, to, step, col) => {
  const out = [];
  for (let r = from; r <= to; r += step) {
    const n = Math.round(r * 1.25);
    for (let k = 0; k < n; k++) {
      const a = Math.PI * (1.04 + .92 * k / (n - 1));
      out.push(`<circle cx="${(cx + Math.cos(a) * r).toFixed(2)}" cy="${(cy + Math.sin(a) * r * .92).toFixed(2)}" r=".95" fill="${col}" opacity="${vmN(.4, .9, 2)}"/>`);
    }
  }
  return out.join("");
};
// pierścień z kropek (jak miejsca w sali ułożone w okręgu): n kropek na okręgu o promieniu r
const dotRing = (cx, cy, r, n, col, rr = .7) => Array.from({ length: n }, (_, k) => {
  const a = k / n * Math.PI * 2;
  return `<circle cx="${(cx + Math.cos(a) * r).toFixed(2)}" cy="${(cy + Math.sin(a) * r).toFixed(2)}" r="${rr}" fill="${col}" opacity="${vmN(.5, 1, 2)}"/>`;
}).join("");
// wieniec z liści: dwie gałązki od dołu (cx, cy = środek, r = promień, span = jak wysoko sięgają, ułamek półokręgu); w każdym punkcie para liści
// odchylonych o ±35° od stycznej do łuku
const laurel = (cx, cy, r, n = 11, fill = "#c9d6e6", span = .72) => [-1, 1].map(side => Array.from({ length: n }, (_, k) => {
  const th = k / (n - 1) * Math.PI * span, px = cx + side * Math.sin(th) * r, py = cy + Math.cos(th) * r;
  const tan = (side > 0 ? -1 : 1) * (th * 180 / Math.PI);
  return [-35, 35].map(d => `<ellipse cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" rx="2.3" ry=".9" transform="rotate(${(tan + d).toFixed(1)} ${px.toFixed(2)} ${py.toFixed(2)})" fill="${fill}"/>`).join("");
}).join("")).join("");

// tarcza radaru: koncentryczne okręgi, osie, podziałka co 10° na obrzeżu i krótkie kreski na pierścieniach
const radar = (cx, cy, rmax, col = "#6fb4ff") => {
  let s = "";
  for (let r = 7; r <= rmax; r += 6.5) s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width=".25" opacity="${(.62 - r / rmax * .3).toFixed(2)}"/>`;
  for (let a = 0; a < 360; a += 10) {
    const rad = a * Math.PI / 180, big = a % 90 === 0, r1 = rmax - (big ? 6 : 2.6);
    s += `<line x1="${(cx + Math.cos(rad) * r1).toFixed(2)}" y1="${(cy + Math.sin(rad) * r1).toFixed(2)}" x2="${(cx + Math.cos(rad) * rmax).toFixed(2)}" y2="${(cy + Math.sin(rad) * rmax).toFixed(2)}" stroke="${col}" stroke-width="${big ? .4 : .22}" opacity=".7"/>`;
  }
  s += `<line x1="${cx - rmax}" y1="${cy}" x2="${cx + rmax}" y2="${cy}" stroke="${col}" stroke-width=".22" opacity=".45"/><line x1="${cx}" y1="${cy - rmax}" x2="${cx}" y2="${cy + rmax}" stroke="${col}" stroke-width=".22" opacity=".45"/>`;
  return s;
};
// sieć połączeń: n węzłów w prostokącie i łuki między losowymi parami (jak trasy między krajami)
const netPts = (n, x0, y0, x1, y1) => Array.from({ length: n }, () => [+vmN(x0, x1, 1), +vmN(y0, y1, 1)]);
const netArcs = (pts, links, col = "#8cc4ff") => Array.from({ length: links }, () => {
  const a = pts[Math.floor(Math.random() * pts.length)], b = pts[Math.floor(Math.random() * pts.length)];
  if (a === b) return "";
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - Math.hypot(a[0] - b[0], a[1] - b[1]) * .28;
  return `<path d="M${a[0]} ${a[1]} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b[0]} ${b[1]}" fill="none" stroke="${col}" stroke-width=".28" opacity="${vmN(.35, .85, 2)}"/>`;
}).join("") + pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r=".75" fill="#e8f0ff"/><circle cx="${p[0]}" cy="${p[1]}" r="1.7" fill="none" stroke="${col}" stroke-width=".2" opacity=".6"/>`).join("");

export const GLOBAL_PROPOSALS = [{
  key: "global", name: "Globalny", icon: "🌐", tag: "🌐 GLOBALNY",
  about: "organizacje międzynarodowe: sala obrad połączona z globusem, wyłącznie odcienie niebieskiego, bez flag i dodatkowych napisów; cztery wersje",
  looks: [
    { name: "Hologram w sali", desc: "Granatowa sala z półokręgiem miejsc i reflektorami, a na zdjęciu świetlisty globus z siatką południków jak hologram nad mównicą; przesuwa się po nim jasna linia skanera.",
      bg: () => `<div class="vm-bg gbl1-bg">${vmSvg(seats(31.5, 62, 15, 47, 4.1, "#8cc4ff"), "0 0 63 88", "gbl1-seats")}<i class="gbl1-beam"></i><i class="gbl1-beam b"></i>${scatter(14, "gbl1-dust", () => `width:${vmN(.5, 1.4, 1)}px;height:${vmN(.5, 1.4, 1)}px`, [4, 60])}</div>`,
      photo: () => `<i class="vm-photo gbl1-photo"></i><div class="gbl1-holo">${vmSvg(wire(30, 30, 29, "#bfe0ff", .9), "0 0 60 60", "gbl1-holosvg")}</div><i class="gbl1-scan"></i>`,
      deco: () => `<div class="vm-deco gbl1-deco"><i class="gbl1-rim"></i>${vmSvg(`<polygon points="${star(31.5, 3.2, 1.7)}" fill="#dfe9f7"/><polygon points="${star(24, 3.2, 1.1)}" fill="#8cc4ff"/><polygon points="${star(39, 3.2, 1.1)}" fill="#8cc4ff"/>`, "0 0 63 88", "gbl1-stars")}</div>` },
    { name: "Orbita", desc: "Kosmiczny granat: pod panelami wschodzi błękitna planeta z kontynentami, a wokół zdjęcia krążą w przeciwne strony pierścienie z drobnych świateł (miejsca z sali ułożone na orbitach).",
      bg: () => { const g = vmId("gbo"); return `<div class="vm-bg gbl2-bg">${scatter(24, "gbl2-star", () => `width:${vmN(.5, 1.5, 1)}px;height:${vmN(.5, 1.5, 1)}px`, [1, 98])}<i class="gbl2-glow"></i><div class="gbl2-planet">${vmSvg(globe(30, 30, 29, g), "0 0 60 60", "gbl2-svg")}</div></div>`; },
      photo: () => `<i class="vm-photo gbl2-photo"></i>`,
      deco: () => `<div class="vm-deco gbl2-deco"><div class="gbl2-ring">${vmSvg(dotRing(0, 0, 21, 36, "#bfe0ff") + dotRing(0, 0, 26, 46, "#6fb4ff", .6), "-31.5 -31.5 63 63", "gbl2-svg")}</div><div class="gbl2-ring r2">${vmSvg(dotRing(0, 0, 29, 56, "#8cc4ff", .55) + `<circle cx="29" cy="6" r="1.1" fill="#e8f0ff"/>`, "-31.5 -31.5 63 63", "gbl2-svg")}</div></div>` },
    { name: "Siatka", desc: "Zdjęcie jak ekran w centrum dowodzenia: niebieska siatka współrzędnych i narożniki celownika, szkieletowy globus za kartą, a na dole tarcza radaru z obracającą się wiązką.",
      bg: () => `<div class="vm-bg gbl3-bg"><div class="gbl3-wire">${vmSvg(wire(30, 30, 29, "#6fb4ff", .55), "0 0 60 60", "gbl3-svg")}</div>${vmSvg(radar(31.5, 74, 38), "0 0 63 88", "gbl3-seats")}<i class="gbl3-sweep"></i>${scatter(5, "gbl3-blip", () => "", [58, 92], [12, 88])}</div>`,
      photo: () => `<i class="vm-photo gbl3-photo"></i><i class="gbl3-gridlines"></i><i class="gbl3-brk a"></i><i class="gbl3-brk b"></i><i class="gbl3-brk c"></i><i class="gbl3-brk d"></i><i class="gbl3-scan"></i>`,
      deco: () => `<div class="vm-deco gbl3-deco"><i class="gbl3-rim"></i><i class="gbl3-notch l"></i><i class="gbl3-notch r"></i></div>` },
    { name: "Kopuła", desc: "Wnętrze kopuły: żebra rozchodzą się z góry jak promienie, a zdjęcie obejmuje srebrnoniebieski wieniec z liści; w tle bije błękitna poświata globusa.",
      bg: () => { const g = vmId("gbk"); return `<div class="vm-bg gbl4-bg"><i class="gbl4-ribs"></i><i class="gbl4-glow"></i><div class="gbl4-globe">${vmSvg(globe(30, 30, 29, g), "0 0 60 60", "gbl4-svg")}</div>${scatter(10, "gbl4-dust", () => `width:${vmN(.5, 1.3, 1)}px;height:${vmN(.5, 1.3, 1)}px`, [2, 50])}</div>`; },
      photo: () => `<i class="vm-photo gbl4-photo"></i>`,
      deco: () => `<div class="vm-deco gbl4-deco">${vmSvg(laurel(31.5, 33, 25, 13, "#bcd6f5"), "0 0 63 88", "gbl4-wreath")}</div>` },
    { name: "Radar", desc: "Zdjęcie jako tarcza radaru: koncentryczne okręgi, osie z podziałką, obracająca się wiązka i pulsujące punkty; w tle ciemny granat, w rogach ramki ścięte narożniki.",
      bg: () => `<div class="vm-bg gbl5-bg"><i class="gbl5-vig"></i>${scatter(12, "gbl5-dot", () => `width:${vmN(.5, 1.2, 1)}px;height:${vmN(.5, 1.2, 1)}px`, [1, 98])}</div>`,
      photo: () => `<i class="vm-photo gbl5-photo"></i>${vmSvg(radar(26, 19, 18.5, "#8cc4ff"), "0 0 52 38", "gbl5-radar", "xMidYMid slice")}<i class="gbl5-sweep"></i>${scatter(5, "gbl5-blip", () => "", [14, 80], [14, 86])}`,
      deco: () => `<div class="vm-deco gbl5-deco"><i class="gbl5-rim"></i><i class="gbl5-cut a"></i><i class="gbl5-cut b"></i></div>` },
    { name: "Horyzont", desc: "Perspektywiczna podłoga z błękitnej siatki sunie ku horyzontowi, nad którym świeci jasny pas; zdjęcie ma delikatne linie skanowania i podziałkę po lewej i u góry.",
      bg: () => `<div class="vm-bg gbl6-bg"><i class="gbl6-sky"></i><i class="gbl6-sun"></i><div class="gbl6-floor"><i class="gbl6-lines"></i></div>${scatter(10, "gbl6-star", () => `width:${vmN(.5, 1.3, 1)}px;height:${vmN(.5, 1.3, 1)}px`, [2, 40])}</div>`,
      photo: () => `<i class="vm-photo gbl6-photo"></i><i class="gbl6-scanl"></i><i class="gbl6-ruler l"></i><i class="gbl6-ruler t"></i>`,
      deco: () => `<div class="vm-deco gbl6-deco"><i class="gbl6-rim"></i></div>` },
    { name: "Sieć", desc: "Mapa połączeń: świecące węzły i łuki jak trasy między krajami nad szkieletowym globusem; węzły na zdjęciu pulsują, a między nimi biegną cienkie linie.",
      bg: () => { const pts = netPts(11, 6, 8, 57, 70); return `<div class="vm-bg gbl7-bg"><div class="gbl7-wire">${vmSvg(wire(30, 30, 29, "#6fb4ff", .4), "0 0 60 60", "gbl7-svg")}</div>${vmSvg(netArcs(pts, 12), "0 0 63 88", "gbl7-net")}</div>`; },
      photo: () => { const pts = netPts(6, 3, 3, 49, 35); return `<i class="vm-photo gbl7-photo"></i>${vmSvg(netArcs(pts, 7, "#bfe0ff"), "0 0 52 38", "gbl7-photonet", "none")}${scatter(4, "gbl7-pulse", () => "", [8, 88], [8, 92])}`; },
      deco: () => `<div class="vm-deco gbl7-deco"><i class="gbl7-rim"></i></div>` },
    { name: "Plan", desc: "Rysunek techniczny na niebieskim papierze: drobna i gruba siatka, linijki po bokach zdjęcia, przerywane okręgi cyrkla wokół twarzy, linia wymiarowa; zdjęcie w odcieniach błękitu jak kalka.",
      bg: () => `<div class="vm-bg gbl8-bg"><i class="gbl8-fine"></i><i class="gbl8-bold"></i></div>`,
      photo: () => `<i class="vm-photo gbl8-photo"></i><i class="gbl8-ruler l"></i><i class="gbl8-ruler b"></i>${vmSvg(`<circle cx="26" cy="19" r="15" fill="none" stroke="#e8f0ff" stroke-width=".25" stroke-dasharray="1.2 .9" opacity=".8"/><circle cx="26" cy="19" r="9" fill="none" stroke="#e8f0ff" stroke-width=".2" stroke-dasharray=".6 .8" opacity=".7"/><path d="M26 2v6M26 30v6M9 19h6M37 19h6" stroke="#e8f0ff" stroke-width=".25" opacity=".8"/><path d="M26 19 38 10" stroke="#e8f0ff" stroke-width=".2" opacity=".7"/><path d="M33 19a7 7 0 0 0-2.1-5" fill="none" stroke="#e8f0ff" stroke-width=".25" opacity=".8"/>`, "0 0 52 38", "gbl8-compass", "xMidYMid slice")}`,
      deco: () => `<div class="vm-deco gbl8-deco"><i class="gbl8-rim"></i>${vmSvg(`<path d="M5.4 11.5H57.6M5.4 9.4v4.2M57.6 9.4v4.2M8 11.5l2.2-1.2v2.4zM55 11.5l-2.2-1.2v2.4z" fill="#e8f0ff" stroke="#e8f0ff" stroke-width=".25" opacity=".85"/>`, "0 0 63 88", "gbl8-dim")}</div>` },
  ],
}];
