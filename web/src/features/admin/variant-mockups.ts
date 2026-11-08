// @ts-nocheck -- propozycje wariantów, przeniesione ze starego variant-mockups.js
import { rand } from '../../game/rules';
import { VX_DECO, VX_PHOTO, variantTop } from '../../cards/cardHtml';
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


// ================================================================ POLSKA (event Dzień Niepodległości; prefiks plm-)
// Makieta 1 = wariant `polska` już w grze (cards2.css, cardHtml.ts) - pozostałe do wyboru zamiast niego. Bez godła RP.

const plmKot = (cls = "") => vmSvg(`<path d="M14 28 L8 50 L14 46 L18 51 L20 30Z M26 28 L32 50 L26 46 L22 51 L20 30Z" fill="#dc143c"/>
  ${Array.from({ length: 16 }, (_, k) => `<ellipse cx="20" cy="9" rx="3.6" ry="9" fill="${k % 2 ? "#dc143c" : "#fff"}" transform="rotate(${k * 22.5} 20 20)"/>`).join("")}
  <circle cx="20" cy="20" r="7" fill="#fff"/><circle cx="20" cy="20" r="4.4" fill="#dc143c"/>`, "0 0 40 52", `plm-kot ${cls}`, "xMidYMid meet");
// łowicka wycinanka: kwiat z płatków w kilku kolorach (środek x, y, promień r)
const plmFlower = (x, y, r) => `<g transform="translate(${x} ${y})">${Array.from({ length: 8 }, (_, k) =>
  `<ellipse cx="0" cy="${-r * .62}" rx="${r * .28}" ry="${r * .42}" fill="${["#e8173f", "#ff8ac2", "#ffd23d", "#2fa84f", "#2a7de1", "#ff7a1a"][k % 6]}" transform="rotate(${k * 45})"/>`).join("")}
  <circle r="${r * .3}" fill="#ffd23d"/><circle r="${r * .14}" fill="#e8173f"/></g>`;
const plmBunting = n => `<div class="plm-bunting">${Array.from({ length: n }, (_, k) => `<i style="animation-delay:-${(k * .23).toFixed(2)}s"></i>`).join("")}</div>`;
const plmFirework = (x, y, c, d) => `<i class="plm-fw" style="left:${x}%;top:${y}%;--c:${c};animation-delay:-${d}s">${Array.from({ length: 12 }, (_, k) => `<b style="--r:${k * 30}deg"></b>`).join("")}</i>`;

VARIANT_PROPOSALS.push({
  key: "polska", icon: "🇵🇱", name: "Polska", tag: "🇵🇱 POLSKA",
  about: "wariant na event Dzień Niepodległości - wypada ze wszystkich skrzynek w czasie eventu (zakładka Eventy). Makieta 1 jest już w grze jako wariant Polska; wybierz inną, a podmienię wygląd",
  looks: [
    {
      name: "Biało-czerwona z wycinanką (w grze)",
      desc: "Obecny wariant Polska: czerwone tło z jasnym wzorem łowickiej wycinanki, nad kartą dwie skrzyżowane flagi na drzewcach, które falują, kotylion w rogu zdjęcia, baner „11 LISTOPADA · NIEPODLEGŁA” nad nazwą, białe panele z czerwonym paskiem.",
      cls: "v-polska",
      photo: () => VX_PHOTO.polska,
      deco: () => VX_DECO.polska(),
      top: () => variantTop("polska"),
      sub: () => "NARODOWE ŚWIĘTO NIEPODLEGŁOŚCI",
    },
    X({
      name: "Kotylion",
      desc: "Biała karta przecięta po skosie czerwoną wstęgą, wielki kotylion przypięty w prawym górnym rogu (kołysze się), biało-czerwone konfetti spada z góry, nazwa czerwona szeryfowa.",
      bg: () => '<div class="vm-bg plm2-bg"><i class="plm2-ribbon"></i></div>',
      deco: () => `<div class="vm-deco">${plmKot("big")}</div><div class="vm-deco plm-clip">${vmScatter(18, "plm-conf", () => `--c:${vmPick(["#fff", "#dc143c"])};--dx:${vmN(-10, 10)}cqw;animation-duration:${vmN(4, 7, 1)}s`, [-10, 0])}</div>`,
      sub: () => "ŚWIĘTUJEMY 11.11",
    }),
    X({
      name: "Wycinanka łowicka",
      desc: "Czarne tło jak papier pod wycinanką, dookoła karty kolorowa wycinanka łowicka: kwiaty w czerwieni, różu, żółci, zieleni i błękicie, które lekko się kołyszą; zdjęcie w czerwonej ramce, napisy w ludowych kolorach.",
      bg: () => '<div class="vm-bg plm3-bg"></div>',
      deco: () => `<div class="vm-deco">${vmPerimeter(20, (x, y) => `<i class="plm3-fl" style="left:${x}%;top:${y}%;animation-delay:-${vmN(0, 3, 1)}s">${vmSvg(plmFlower(10, 10, 9), "0 0 20 20", "", "xMidYMid meet")}</i>`)}</div>`,
      sub: () => "SZTUKA LUDOWA · ŁOWICZ",
    }),
    X({
      name: "Defilada",
      desc: "Wieczorne granatowe niebo z biało-czerwonymi fajerwerkami za zdjęciem, nad kartą girlanda biało-czerwonych chorągiewek, która lekko faluje, zdjęcie w biało-czerwonej obwódce, podpis o rocznicy.",
      bg: () => `<div class="vm-bg plm4-bg">${plmFirework(18, 14, "#fff", 0)}${plmFirework(80, 22, "#ff3b5c", 1.2)}${plmFirework(50, 70, "#fff", 2.1)}${plmFirework(12, 80, "#ff3b5c", .6)}</div>`,
      deco: () => `<div class="vm-deco">${plmBunting(11)}</div>`,
      sub: () => "108. ROCZNICA ODZYSKANIA NIEPODLEGŁOŚCI",
    }),
  ],
});

// ================================================================ EVENT ŚWIĄTECZNY: Candy Cane (cc-), Lodowy (ic-), Śnieżny (snw-),
// Świąteczny (xm-), Choinka (tre-), Prezentowy (gf-)

const ccMint = (n) => vmScatter(n, "cc-mint", () => `--s:${vmN(.6, 1.3, 2)};animation-duration:${vmN(4, 9, 1)}s`);
const ccCane = (cls) => vmSvg('<path d="M10 58 V16 a8 8 0 0 1 16 0 v4" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round"/><path d="M10 58 V16 a8 8 0 0 1 16 0 v4" fill="none" stroke="#e8173f" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="4 4"/>', "0 0 36 62", `cc-cane ${cls}`, "xMidYMid meet");
const snow = (n, cls = "snw-flake", y = [-10, 0]) => vmScatter(n, cls, () => `--s:${vmN(.4, 1.3, 2)};--dx:${vmN(-12, 12)}cqw;animation-duration:${vmN(5, 10, 1)}s`, y);
const snowflakeSvg = (cls = "") => vmSvg(`<g stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none">${Array.from({ length: 6 }, (_, k) =>
  `<g transform="rotate(${k * 60} 20 20)"><path d="M20 20 V3 M20 9 l-4 -4 M20 9 l4 -4 M20 14 l-3 -3 M20 14 l3 -3"/></g>`).join("")}</g>`, "0 0 40 40", `snw-big ${cls}`, "xMidYMid meet");
const icIcicles = () => vmSvg(Array.from({ length: 16 }, () => {
  const x = rand(0, 61), w = rand(1.6, 3), h = rand(4, 13);
  return `<path d="M${x.toFixed(2)} 0 L${(x + w).toFixed(2)} 0 L${(x + w / 2).toFixed(2)} ${h.toFixed(2)}Z" fill="#e8fbff" opacity="${vmN(.6, .95, 2)}"/>`;
}).join(""), "0 0 63 16", "ic-icicles");
const icCracks = () => vmSvg(Array.from({ length: 5 }, () => {
  let x = rand(5, 58), y = rand(4, 36), d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
  for (let k = 0; k < 4; k++) { x += rand(-8, 8); y += rand(-6, 6); d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
  return `<path d="${d}" stroke="#fff" stroke-width=".35" fill="none" opacity=".8"/>`;
}).join(""), "0 0 63 40", "vm-photo ic-cracks");
const icFacets = () => vmSvg(Array.from({ length: 34 }, () => {
  const x = rand(-5, 63), y = rand(-5, 88), sz = rand(8, 18);
  return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} l${sz.toFixed(1)} ${rand(-4, 4).toFixed(1)} l${rand(-6, 6).toFixed(1)} ${sz.toFixed(1)}Z" fill="${vmPick(["#dff6ff", "#b9e6ff", "#8fd0ff", "#eefcff"])}" opacity="${vmN(.25, .7, 2)}"/>`;
}).join(""), "0 0 63 88", "ic-facets");
const xmLights = (n, cls = "xm-bulb") => vmPerimeter(n, (x, y, k) => `<i class="${cls}" style="left:${x}%;top:${y}%;--c:${["#ff3b3b", "#ffd23d", "#2bd96b", "#3ba2ff", "#ff7ad9"][k % 5]};animation-delay:-${(k % 5 * .3).toFixed(1)}s"></i>`);
const xmBauble = (x, len, c, d) => `<i class="xm-bauble" style="left:${x}%;--len:${len}cqw;--c:${c};animation-delay:-${d}s"></i>`;
const treBranch = (cls, rot) => vmSvg(`<g transform="rotate(${rot} 50 50)"><path d="M50 98 L50 4" stroke="#3a2a18" stroke-width="2.2"/>
  ${Array.from({ length: 16 }, (_, k) => { const y = 8 + k * 5.6, l = 6 + k * 1.9;
    return `<path d="M50 ${y} l${l} ${l * .55} M50 ${y} l-${l} ${l * .55}" stroke="${k % 2 ? "#1f6b3a" : "#2a8a4a"}" stroke-width="2.6" stroke-linecap="round"/>`; }).join("")}</g>`,
  "0 0 100 100", `tre-branch ${cls}`, "xMidYMid meet");
const treTree = () => vmSvg(`<path d="M31.5 4 L52 30 H43 L58 52 H48 L62 78 H1 L15 52 H5 L20 30 H11Z" fill="#14532d"/><rect x="28" y="78" width="7" height="8" fill="#5a3a1a"/>`, "0 0 63 88", "tre-tree", "none");
// opakowanie prezentu: papier, wstążki, kokarda - pętla 10 s: zapakowany, odpakowanie, otwarty, zapakowanie z powrotem
const gfWrap = (paper, extra = "", tag = "") => `<div class="vm-deco gf-wrap ${paper}"><i class="gf-paper l"></i><i class="gf-paper r"></i>
  <i class="gf-rib v"></i><i class="gf-rib h"></i><i class="gf-bow"><b></b><b></b><u></u></i>${extra}${tag}</div>`;

VARIANT_PROPOSALS.push({
  key: "candycane", icon: "🍬", name: "Candy Cane", tag: "🍬 CANDY CANE",
  about: "event świąteczny: laski cukrowe, czerwono-białe paski, mięta i lukier",
  looks: [
    X({ name: "Laska cukrowa", desc: "Ramka w czerwono-białe ukośne paski, które przesuwają się jak na wirującej lasce, białe wnętrze z delikatnym połyskiem, w rogach miętowe cukierki-spirale, czerwona nazwa.",
      cls: "cc-stripes", bg: () => `<div class="vm-bg cc1-bg">${ccMint(4)}</div>`, sub: () => "SŁODKICH ŚWIĄT" }),
    X({ name: "Miętowa", desc: "Miętowa zieleń z czerwonymi paskami, po tle wirują miętowe cukierki w biało-czerwone spirale, zdjęcie w zaokrąglonej białej ramce, napisy czerwone na białych panelach.",
      cls: "cc-stripes mint", bg: () => `<div class="vm-bg cc2-bg">${ccMint(12)}</div>`, sub: () => "ŚWIEŻO Z FABRYKI SŁODYCZY" }),
    X({ name: "Lukier", desc: "Paski laski na ramce, z górnej krawędzi spływa biały lukier, na karcie kolorowa posypka, zdjęcie jak w cukierkowym okienku z białą obwódką.",
      cls: "cc-stripes", bg: () => `<div class="vm-bg cc3-bg">${vmScatter(30, "cc-spr", () => `--c:${vmPick(["#e8173f", "#2bd96b", "#ffd23d", "#3ba2ff", "#fff"])};--r:${vmN(0, 180)}deg`)}</div>`,
      deco: () => '<div class="vm-deco"><i class="cc-icing"></i></div>', sub: () => "Z LUKREM I POSYPKĄ" }),
    X({ name: "Słodka wystawa", desc: "Błyszcząca czerwień jak polewa, nad nazwą dwie skrzyżowane laski cukrowe z zieloną kokardą, po karcie przesuwa się połysk.",
      bg: () => '<div class="vm-bg cc4-bg"><i class="cc-gloss"></i></div>', top: () => `<div class="cc4-top">${ccCane("l")}<i class="cc4-bow"></i>${ccCane("r")}</div>`, sub: () => "CUKIERNIA ŚW. MIKOŁAJA" }),
  ],
});

VARIANT_PROPOSALS.push({
  key: "ice", icon: "🧊", name: "Lodowy", tag: "🧊 LÓD",
  about: "event świąteczny: lód, szron, sople i kryształy",
  looks: [
    X({ name: "Szron", desc: "Szron narasta z rogów karty jak paprotki na zimowej szybie, lodowo-błękitne tło, oszronione brzegi zdjęcia, ciemnoniebieskie napisy z białą poświatą.",
      bg: () => '<div class="vm-bg ic1-bg"><i class="ic1-frost a"></i><i class="ic1-frost b"></i></div>', photo: () => '<i class="vm-photo ic1-rim"></i>', sub: () => "−21°C · ODCZUWALNA −30°C" }),
    X({ name: "Zamrożona", desc: "Zdjęcie zatopione w bryle lodu: niebieskawy odcień, pęknięcia i pęcherzyki powietrza, odblask na tafli, panele jak kostki lodu.",
      bg: () => '<div class="vm-bg ic2-bg"></div>', photo: () => `${icCracks()}<i class="vm-photo ic2-ice"></i>${vmScatter(8, "ic2-bubble", () => `--s:${vmN(.5, 1.3, 2)}`)}`, sub: () => "ZAMROŻONA OD WIGILII" }),
    X({ name: "Sople", desc: "Z górnej krawędzi karty zwisają sople, z których co chwilę spada kropla, ramka przysypana śniegiem, granatowo-błękitne tło.",
      bg: () => '<div class="vm-bg ic3-bg"></div>', deco: () => `<div class="vm-deco ic-clip">${icIcicles()}${vmScatter(4, "ic3-drip", () => `animation-duration:${vmN(2.5, 4.5, 1)}s`, [8, 10])}<i class="ic3-snow"></i></div>`, sub: () => "ODWILŻ NIE NADEJDZIE" }),
    X({ name: "Lodowy kryształ", desc: "Tło z ostrych fasetek lodu jak oszlifowany kryształ, przez które przechodzi tęczowy błysk pryzmatu, ramka w lodowym gradiencie, zdjęcie w szklanej oprawie.",
      bg: () => `<div class="vm-bg ic4-bg">${icFacets()}<i class="ic4-prism"></i></div>`, sub: () => "KRYSZTAŁ CZYSTOŚCI 99,9%" }),
  ],
});

VARIANT_PROPOSALS.push({
  key: "snow", icon: "❄️", name: "Śnieżny", tag: "❄️ ŚNIEG",
  about: "event świąteczny: padający śnieg, zaspy, płatki i kula śnieżna",
  looks: [
    X({ name: "Śnieżyca", desc: "Gęsty śnieg pada przez całą kartę, przy dole mgła, zdjęcie lekko zamglone, białe panele jak zaspy.",
      bg: () => '<div class="vm-bg snw1-bg"><i class="snw-fog"></i></div>', deco: () => `<div class="vm-deco snw-clip">${snow(36)}</div>`, sub: () => "ALERT POGODOWY · 3. STOPIEŃ" }),
    X({ name: "Zaspa", desc: "Na górnej krawędzi karty i na każdym panelu leżą czapy śniegu, z dołu karty wyrasta zaspa, delikatnie prószy, ciepłe niebo o zmierzchu.",
      cls: "snw-caps", bg: () => '<div class="vm-bg snw2-bg"></div>', deco: () => `<div class="vm-deco snw-clip"><i class="snw2-top"></i><i class="snw2-drift"></i>${snow(14)}</div>`, sub: () => "PRZYSYPANA PO SAME USZY" }),
    X({ name: "Płatki", desc: "Granatowa noc z wielkimi, dokładnie wyrysowanymi płatkami śniegu, które powoli się obracają, małe płatki migoczą, srebrna ramka.",
      bg: () => `<div class="vm-bg snw3-bg">${snowflakeSvg("a")}${snowflakeSvg("b")}${snowflakeSvg("c")}${vmScatter(20, "snw-spark")}</div>`, sub: () => "KAŻDY PŁATEK JEST INNY" }),
    X({ name: "Kula śnieżna", desc: "Zdjęcie jak w szklanej kuli: wypukły połysk szkła i płatki wirujące w środku kuli (wzbijają się i opadają), ramka jak drewniana podstawka.",
      bg: () => '<div class="vm-bg snw4-bg"></div>', photo: () => `<i class="vm-photo snw4-glass"></i><i class="vm-photo snw4-inside">${vmScatter(22, "snw4-flake", () => `--s:${vmN(.4, 1, 2)};animation-duration:${vmN(3, 6, 1)}s`)}</i>`, sub: () => "POTRZĄŚNIJ, A ZACZNIE PADAĆ" }),
  ],
});

VARIANT_PROPOSALS.push({
  key: "christmas", icon: "🎄", name: "Świąteczny", tag: "🎄 ŚWIĘTA",
  about: "event świąteczny - najlepszy z wariantów eventu: najwięcej się dzieje, złoto, lampki, bombki, sanie",
  looks: [
    X({ name: "Wigilijna noc", desc: "Czerwony aksamit ze złotymi zdobieniami, złota ramka mieni się, dookoła karty mrugają kolorowe lampki, nad nazwą przez księżyc przelatują sanie z reniferami, z góry prószy złoty brokat.",
      cls: "xm-gold", bg: () => '<div class="vm-bg xm1-bg"><i class="xm-sheen"></i></div>', top: () => '<div class="xm1-sky"><i class="xm-moon"></i><i class="xm-sleigh"></i></div>',
      deco: () => `<div class="vm-deco">${xmLights(26)}</div><div class="vm-deco xm-clip">${vmScatter(14, "xm-glit", () => `--dx:${vmN(-8, 8)}cqw;animation-duration:${vmN(5, 9, 1)}s`, [-10, 0])}</div>`, sub: () => "WESOŁYCH ŚWIĄT!" }),
    X({ name: "Złota gala", desc: "Czarno-złota elegancja: z góry karty zwisają na wstążkach złote i czerwone bombki, które się kołyszą, złota gwiazda błyszczy nad nazwą, po karcie przesuwa się złoty połysk.",
      cls: "xm-gold dark", bg: () => '<div class="vm-bg xm2-bg"><i class="xm-sheen"></i></div>', top: () => '<div class="xm2-star">★</div>',
      deco: () => `<div class="vm-deco xm-clip">${xmBauble(10, 9, "#d4af37", 0)}${xmBauble(28, 5, "#c41e3a", .7)}${xmBauble(72, 6, "#d4af37", 1.3)}${xmBauble(90, 10, "#c41e3a", .4)}</div>`, sub: () => "GALA BOŻONARODZENIOWA" }),
    X({ name: "Przy kominku", desc: "Ciepła poświata płonącego kominka migocze na karcie, nad nazwą girlanda z gałązek z lampkami, po bokach wiszą skarpety na prezenty, zdjęcie w ciepłych kolorach.",
      bg: () => '<div class="vm-bg xm3-bg"><i class="xm3-fire"></i></div>', top: () => `<div class="xm3-garland">${Array.from({ length: 9 }, (_, k) => `<i style="--c:${["#ff3b3b", "#ffd23d", "#2bd96b"][k % 3]};animation-delay:-${k * .2}s"></i>`).join("")}</div>`,
      deco: () => '<div class="vm-deco"><i class="xm3-sock l"></i><i class="xm3-sock r"></i></div>', sub: () => "CIEPŁO RODZINNEGO DOMU" }),
    X({ name: "Lampki na ramce", desc: "Ramka owinięta sznurem kolorowych lampek, które mrugają falami, zielone wnętrze z fakturą igliwia, prószy śnieg, złota gwiazda w rogu.",
      bg: () => '<div class="vm-bg xm4-bg"></div>', deco: () => `<div class="vm-deco"><i class="xm4-wire"></i>${xmLights(34, "xm-bulb big")}</div><div class="vm-deco xm-clip">${snow(12, "snw-flake")}</div>`, sub: () => "ŚWIĄTECZNE LAMPKI · 220 V" }),
  ],
});

VARIANT_PROPOSALS.push({
  key: "tree", icon: "🌲", name: "Choinka", tag: "🌲 CHOINKA",
  about: "event świąteczny: gałązki świerku, bombki, łańcuchy i choinka",
  looks: [
    X({ name: "Gałązki", desc: "Gałązki świerku wchodzą na kartę z rogów, wiszą na nich bombki, które lekko się kołyszą, ciemnozielone tło z drobnym śniegiem.",
      bg: () => '<div class="vm-bg tre1-bg"></div>', deco: () => `<div class="vm-deco tre-clip">${treBranch("a", 135)}${treBranch("b", -135)}${xmBauble(14, 6, "#c41e3a", .2)}${xmBauble(86, 8, "#d4af37", .9)}</div>`, sub: () => "PROSTO Z LASU" }),
    X({ name: "Choinka w tle", desc: "Za zdjęciem stoi wielka choinka, jej brzegi z mrugającymi lampkami widać po bokach, złota gwiazda błyszczy nad nazwą, pod spodem prezenty.",
      bg: () => `<div class="vm-bg tre2-bg">${treTree()}${vmScatter(22, "tre2-light", () => `--c:${vmPick(["#ff3b3b", "#ffd23d", "#3ba2ff", "#ff7ad9"])}`, [10, 85], [6, 94])}</div>`, top: () => '<div class="xm2-star">★</div>', sub: () => "NAJŁADNIEJSZA W OKOLICY" }),
    X({ name: "Igliwie i łańcuch", desc: "Tło z gęstego igliwia, po skosie przez kartę przewieszony błyszczący złoty łańcuch, czerwone bombki w tle, panele jak papierowe zawieszki.",
      bg: () => `<div class="vm-bg tre3-bg"><i class="tre3-tinsel"></i>${vmScatter(8, "tre3-ball", () => `--c:${vmPick(["#c41e3a", "#d4af37", "#3ba2ff"])}`)}</div>`, sub: () => "ŁAŃCUCH Z NAJLEPSZEGO BROKATU" }),
    X({ name: "Zimowy las", desc: "Nocny ośnieżony las: rząd małych choinek u góry i u dołu karty, między nimi prószy śnieg, księżyc rozświetla niebo, srebrne napisy.",
      bg: () => '<div class="vm-bg tre4-bg"><i class="tre4-moon"></i><i class="tre4-row top"></i><i class="tre4-row bot"></i></div>', deco: () => `<div class="vm-deco tre-clip">${snow(16, "snw-flake")}</div>`, sub: () => "CICHA NOC W LESIE" }),
  ],
});

VARIANT_PROPOSALS.push({
  key: "gift", icon: "🎁", name: "Prezentowy", tag: "🎁 PREZENT",
  about: "event świąteczny: karta przychodzi zapakowana - gracz najpierw ją odpakowuje (zostaje odpakowana, w podglądzie przycisk „Zapakuj ponownie” uruchamia odwróconą animację). Na makietach pętla 10 s: zapakowana, odpakowanie, odpakowana, ponowne zapakowanie",
  looks: [
    X({ name: "Czerwony papier z kokardą", desc: "Cała karta w czerwonym papierze ze złotą wstążką na krzyż i dużą kokardą. Odpakowanie: kokarda się rozwiązuje, wstążki zsuwają, papier rozchodzi się na dwie strony. Odpakowana karta ma złotą wstążkę dookoła ramki i zawieszkę „Od: ScamBox”.",
      cls: "gf-card", bg: () => '<div class="vm-bg gf-under"></div>', deco: () => gfWrap("gf1"), sub: () => "OD: SCAMBOX · DLA: CIEBIE" }),
    X({ name: "Papier w gwiazdki", desc: "Granatowy papier w złote gwiazdki ze srebrną wstążką. Odpakowanie: wieczko z papieru unosi się do góry i odlatuje, jak zdejmowana pokrywka pudełka. Pod spodem karta z gwiazdkową ramką.",
      cls: "gf-card stars", bg: () => '<div class="vm-bg gf-under stars"></div>', deco: () => gfWrap("gf2"), sub: () => "PREZENT SPOD CHOINKI" }),
    X({ name: "Szary papier ze sznurkiem", desc: "Szary papier pakowy przewiązany sznurkiem, z papierową zawieszką „DLA: …”. Odpakowanie: papier rozdziera się od rogu i zwija, zawieszka spada. Odpakowana karta w ciepłych, ręcznie robionych kolorach.",
      cls: "gf-card kraft", bg: () => '<div class="vm-bg gf-under kraft"></div>', deco: p => gfWrap("gf3", "", `<i class="gf-tag">DLA: ${String(p?.name || "").toUpperCase()}</i>`), sub: () => "ZROBIONE Z SERCEM" }),
    X({ name: "Złota folia", desc: "Błyszcząca złota folia z refleksami i czerwoną wstążką. Odpakowanie: folia rozsypuje się w złote konfetti. Odpakowana karta ze złotymi akcentami i iskierkami.",
      cls: "gf-card gold", bg: () => '<div class="vm-bg gf-under gold"></div>', deco: () => gfWrap("gf4", vmScatter(16, "gf-conf", () => `--dx:${vmN(-20, 20)}cqw;--dy:${vmN(-30, 30)}cqw;--r:${vmN(-360, 360)}deg`, [30, 70], [20, 80])), sub: () => "LUKSUSOWY PREZENT" }),
  ],
});
