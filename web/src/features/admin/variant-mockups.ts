// @ts-nocheck -- propozycje wariantów, przeniesione ze starego variant-mockups.js
import { rand } from '../../game/rules';
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

