// @ts-nocheck -- propozycje wariantów, przeniesione ze starego variant-mockups.js
import { imgUrl, rand } from '../../game/rules';
import { VX_PHOTO, variantTop } from '../../cards/cardHtml';
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


// ================================================================ POLSKA: poprawione flagi (prefiks plf-)
// Wybrany wygląd = wariant `polska` w grze (cls v-polska); makiety różnią się tylko tym, co zastępuje flagi po bokach. Bez godła RP.

const plfLook = (name, desc, extra = {}) => ({
  name, desc, cls: `v-polska plf${extra.cls ? " " + extra.cls : ""}`,
  photo: p => VX_PHOTO.polska + (extra.photo ? extra.photo(p) : ""),
  deco: extra.deco, bg: extra.bg,
  top: () => variantTop("polska"), sub: () => "NARODOWE ŚWIĘTO NIEPODLEGŁOŚCI",
});
const plfMini = (cls) => `<i class="plf2-flag ${cls}"><b class="plf-pole"></b><b class="plf-cloth"><u></u></b></i>`;

VARIANT_PROPOSALS.push({
  key: "polska", icon: "🇵🇱", name: "Polska", tag: "🇵🇱 POLSKA",
  about: "wybrany wygląd 1 (już w grze) - cztery wersje tego, co zamiast flag na drzewcach po bokach karty",
  looks: [
    plfLook("Szarfy w rogach", "Zamiast flag biało-czerwone szarfy owinięte wokół lewego górnego i prawego dolnego rogu karty, z połyskiem, który co chwilę po nich przebiega. Nic nie wystaje poza kartę.",
      { deco: () => '<div class="vm-deco plf-clip"><i class="plf1-sash a"><u></u></i><i class="plf1-sash b"><u></u></i></div>' }),
    plfLook("Chorągiewki w rogach zdjęcia", "Dwie małe flagi na krótkich drzewcach wbite w górne rogi zdjęcia, lekko odchylone na zewnątrz, płótno faluje. Mniejsze i równe po obu stronach.",
      { photo: () => `${plfMini("l")}${plfMini("r")}` }),
    plfLook("Girlanda chorągiewek", "Nad górną krawędzią zdjęcia biegnie sznurek z małymi biało-czerwonymi chorągiewkami, które kołyszą się na wietrze, każda trochę inaczej.",
      { photo: () => `<svg class="plf3-line" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path d="M0 1 Q50 9 100 1" fill="none" stroke="#e8e0d0" stroke-width=".6"/></svg>${
        Array.from({ length: 9 }, (_, k) => { const x = 6 + k * 11, y = 1 + 4 * (1 - ((x - 50) / 50) ** 2); return `<i class="plf3-pen" style="left:${x}%;top:${(y * .9 - .3).toFixed(2)}cqw;animation-delay:-${(k * .37).toFixed(2)}s"></i>`; }).join("")}` }),
    plfLook("Flaga w tle", "Bez flag po bokach: całe tło karty to falująca biało-czerwona flaga (po materiale przesuwają się fałdy), kotylion i baner zostają, nazwa czerwona na bieli.",
      { cls: "plf4", bg: () => '<div class="vm-bg plf4-bg"><i class="plf4-fold"></i></div>' }),
  ],
});

// ================================================================ LODOWY: wygląd 4 (kryształ) z filtrem na zdjęciu (prefiks ic-)

const icFacets = () => vmSvg(Array.from({ length: 34 }, () => {
  const x = rand(-5, 63), y = rand(-5, 88), sz = rand(8, 18);
  return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} l${sz.toFixed(1)} ${rand(-4, 4).toFixed(1)} l${rand(-6, 6).toFixed(1)} ${sz.toFixed(1)}Z" fill="${vmPick(["#dff6ff", "#b9e6ff", "#8fd0ff", "#eefcff"])}" opacity="${vmN(.25, .7, 2)}"/>`;
}).join(""), "0 0 63 88", "ic-facets");
const icBg = () => `<div class="vm-bg ic-bg">${icFacets()}<i class="ic-prism"></i></div>`;
// kryształ: zdjęcie pocięte na fasety, każda trochę przesunięta i inaczej jasna
const IC_SHARDS = ["0 0,58% 0,38% 46%,0 30%", "58% 0,100% 0,100% 38%,38% 46%", "0 30%,38% 46%,30% 100%,0 100%", "38% 46%,100% 38%,100% 100%,30% 100%", "38% 46%,64% 60%,52% 82%,30% 70%"];

VARIANT_PROPOSALS.push({
  key: "ice", icon: "🧊", name: "Lodowy", tag: "🧊 LÓD",
  about: "wybrany wygląd 4 (lodowy kryształ) - cztery filtry na zdjęcie",
  looks: [
    X({ name: "Mróz", desc: "Zdjęcie w chłodnych, przygaszonych błękitach, jak sfotografowane w trzaskający mróz; brzegi zdjęcia oszronione na biało, w rogach drobne kryształki lodu, które migoczą.",
      cls: "ic", bg: icBg, photo: () => `<i class="vm-photo ic1-rim"></i>${vmScatter(10, "ic1-xtal", () => `--s:${vmN(.5, 1.1, 2)}`, [2, 22], [2, 98])}` }),
    X({ name: "Zamarznięta szyba", desc: "Jakby patrzeć na osobę przez zamarzniętą szybę: z rogów zdjęcia narastają paprotki szronu, środek zostaje czysty, całość ma lekko błękitną mgiełkę.",
      cls: "ic", bg: icBg, photo: () => '<i class="vm-photo ic2-tint"></i><i class="vm-photo ic2-fern a"></i><i class="vm-photo ic2-fern b"></i><i class="vm-photo ic2-fern c"></i><i class="vm-photo ic2-fern d"></i>' }),
    X({ name: "Przez kryształ", desc: "Zdjęcie pocięte na fasety jak widziane przez oszlifowany lodowy kryształ: każdy kawałek lekko przesunięty i inaczej jasny, na krawędziach białe linie, po fasetach przebiega tęczowy błysk.",
      cls: "ic", bg: icBg, photo: p => IC_SHARDS.map((c, k) => `<img class="vm-photo ic3-shard s${k}" src="${imgUrl(p.id, "normal")}" alt="" style="clip-path:polygon(${c})">`).join("") +
        vmSvg('<path d="M36.5 0 L24 52 L0 34 M24 52 L63 43 M24 52 L19 100 M24 52 L40 68 L33 93" stroke="#fff" stroke-width=".7" fill="none" opacity=".75"/>', "0 0 63 100", "vm-photo ic3-edges") + '<i class="vm-photo ic3-glint"></i>' }),
    X({ name: "Lodowy duotone", desc: "Zdjęcie w dwóch kolorach lodu: cienie granatowe, światła lodowato białe, jak odbitka na tafli; co kilka sekund przez zdjęcie przechodzi biały odblask.",
      cls: "ic", bg: icBg, photo: () => '<i class="vm-photo ic4-dark"></i><i class="vm-photo ic4-light"></i><i class="vm-photo ic4-glare"></i>' }),
  ],
});

// ================================================================ ŚWIĄTECZNY: od nowa, dużo ruchu (prefiks xm-)

const xmChase = (n, cls = "xm-bulb") => vmPerimeter(n, (x, y, k) =>
  `<i class="${cls}" style="left:${x}%;top:${y}%;--c:${["#ff3b3b", "#ffd23d", "#2bd96b", "#3ba2ff", "#ff7ad9"][k % 5]};animation-delay:${(k * .08).toFixed(2)}s"></i>`);
const xmSnow = () => '<i class="xm-snow a"></i><i class="xm-snow b"></i>';
const xmDeer = (c = "#1a1408") => `<g fill="${c}" stroke="${c}" stroke-linecap="round"><ellipse cx="18" cy="16" rx="11" ry="5" stroke="none"/><path d="M26 14 L31 6 L36 6 L37 8.5 L32 9.5 L29 16Z" stroke="none"/>
  <path d="M32 6 L30 1 M31 3 L28 2 M34 6 L35 1 M34.5 3 L37.5 2 M10 19 L7 28 M13 20 L14 28 M23 20 L22 28 M26 19 L29 27" stroke-width="1.6" fill="none"/></g>`;
const xmSleigh = (c = "#1a1408") => vmSvg(`<g fill="${c}"><path d="M4 12 Q4 20 11 20 H30 L34 11 H24 L20 5 H12Z"/><circle cx="17" cy="4" r="3"/><path d="M13 7 Q17 2 21 7 L21 11 H13Z"/></g>
  <path d="M1 24 H31 Q36 24 36 19 M10 20 V24 M26 20 V24" stroke="${c}" stroke-width="1.5" fill="none"/><path d="M34 14 L44 14 M58 14 L68 14 M82 14 L92 14" stroke="${c}" stroke-width=".8"/>
  ${[40, 64, 88].map(x => `<g transform="translate(${x} -2) scale(.7)">${xmDeer(c)}</g>`).join("")}`, "0 0 116 28", "xm-sleighsvg", "xMidYMid meet");
const xmRoofs = () => vmSvg(`<path d="M0 100 V70 L8 62 L16 70 V60 H22 V54 L32 44 L42 54 V66 L50 58 L60 66 V52 L68 46 L76 52 V68 L84 60 L92 68 L100 62 V100Z" fill="#141022"/>
  <path d="M0 70 L8 62 L16 70 M22 54 L32 44 L42 54 M42 66 L50 58 L60 66 M60 52 L68 46 L76 52 M76 68 L84 60 L92 68" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  ${[[5, 76], [27, 62], [34, 70], [48, 72], [65, 60], [71, 74], [86, 76], [94, 80]].map(([x, y], k) => `<rect class="xm-win" x="${x}" y="${y}" width="4" height="5" fill="#ffd36e" style="animation-delay:-${k * .7}s"/>`).join("")}
  <rect x="64" y="38" width="5" height="10" fill="#141022"/>`, "0 0 100 100", "vm-photo xm1-roofs");
const xmGifts = () => Array.from({ length: 2 }, () => ["#c41e3a", "#2bd96b", "#3ba2ff", "#ffd23d", "#b46bff", "#ff7a1a"].map((c, k) =>
  `<i class="xm2-box" style="--c:${c};--h:${[6, 8, 5, 7, 6, 8][k]}cqw"></i>`).join("")).join("");
const xmBokeh = n => vmScatter(n, "xm3-bokeh", () => `--c:${vmPick(["#ff3b3b", "#ffd23d", "#2bd96b", "#3ba2ff", "#ff7ad9"])};--s:${vmN(.6, 1.6, 2)};animation-duration:${vmN(6, 11, 1)}s`, [30, 100]);
const xmBurst = n => vmScatter(n, "xm-burst", () => `--s:${vmN(.6, 1.3, 2)};animation-duration:${vmN(2.2, 3.6, 1)}s`);

VARIANT_PROPOSALS.push({
  key: "christmas", icon: "🎄", name: "Świąteczny", tag: "🎄 ŚWIĘTA",
  about: "najlepszy wariant eventu świątecznego - cztery nowe wersje, na każdej dzieje się kilka rzeczy naraz",
  looks: [
    X({ name: "Sanie nad miastem", desc: "Nad nazwą nocne niebo z księżycem i migoczącymi gwiazdami, przez które przelatują sanie z reniferami i zostawiają smugę iskier. Na dole zdjęcia ośnieżone dachy z zapalającymi się oknami i dymem z komina, przez kartę pada śnieg, a lampki na ramce biegną w kółko.",
      cls: "xm-gold", bg: () => '<div class="vm-bg xm1-bg"><i class="xm-sheen"></i></div>',
      top: () => `<div class="xm1-sky"><i class="xm-moon"></i>${vmScatter(9, "xm-star", () => `--s:${vmN(.5, 1.2, 2)}`, [10, 80])}<i class="xm1-fly">${xmSleigh("#f6dc7a")}<i class="xm1-trail"></i></i></div>`,
      photo: () => `${xmRoofs()}<i class="vm-photo xm1-smoke"><b></b><b></b><b></b></i>`,
      deco: () => `<div class="vm-deco xm-clip">${xmSnow()}</div><div class="vm-deco">${xmChase(30)}</div>`, sub: () => "WESOŁYCH ŚWIĄT!" }),
    X({ name: "Fabryka prezentów", desc: "Nad nazwą taśmociąg, po którym bez końca jadą kolorowe prezenty, w dolnych rogach obracają się złote zębatki, na zdjęciu co chwilę błyskają gwiazdki, z góry sypie się konfetti, ramka w zielono-czerwone paski.",
      cls: "xm2", bg: () => '<div class="vm-bg xm2-bg"></div>',
      top: () => `<div class="xm2-belt"><div class="xm2-track">${xmGifts()}</div><i class="xm2-band"></i></div>`,
      photo: () => xmBurst(6), deco: () => `<div class="vm-deco"><i class="xm2-gear a"></i><i class="xm2-gear b"></i></div><div class="vm-deco xm-clip">${vmScatter(18, "xm2-conf", () => `--c:${vmPick(["#c41e3a", "#2bd96b", "#ffd23d", "#fff"])};--dx:${vmN(-10, 10)}cqw;animation-duration:${vmN(4, 7, 1)}s`, [-10, 0])}</div>`,
      sub: () => "WARSZTAT ŚWIĘTEGO MIKOŁAJA" }),
    X({ name: "Pokaz świateł", desc: "Ramka obsypana lampkami, które zapalają się po kolei i gonią dookoła karty, za zdjęciem omiatają tło snopy reflektorów, po zdjęciu unoszą się kolorowe rozmyte światełka, na karcie wybuchają złote iskry, raz na jakiś czas przelatuje spadająca gwiazda.",
      cls: "xm3", bg: () => '<div class="vm-bg xm3-bg"><i class="xm3-beam a"></i><i class="xm3-beam b"></i></div>',
      photo: () => xmBokeh(12), deco: () => `<div class="vm-deco">${xmChase(40, "xm-bulb big")}</div><div class="vm-deco xm-clip"><i class="xm3-shoot"></i>${xmBurst(7)}</div>`,
      sub: () => "ŚWIĄTECZNY POKAZ ŚWIATEŁ" }),
    X({ name: "Zorza i renifery", desc: "Na niebie nad nazwą i za zdjęciem faluje zielono-fioletowa zorza polarna, po dolnej krawędzi zdjęcia po ośnieżonym pagórku biegną renifery, przez kartę pada śnieg, migoczą gwiazdy i co jakiś czas przelatuje spadająca gwiazda.",
      cls: "xm4", bg: () => '<div class="vm-bg xm4-bg"><i class="xm4-aurora a"></i><i class="xm4-aurora b"></i></div>',
      top: () => `<div class="xm4-sky"><i class="xm4-aurora a"></i><i class="xm4-aurora b"></i>${vmScatter(8, "xm-star", () => `--s:${vmN(.5, 1.1, 2)}`, [10, 80])}</div>`,
      photo: () => `<i class="vm-photo xm4-hill"></i><i class="vm-photo xm4-run">${[0, 1, 2].map(k => vmSvg(xmDeer("#3a2412"), "0 0 40 30", `xm4-deer d${k}`, "xMidYMid meet")).join("")}</i>`,
      deco: () => `<div class="vm-deco xm-clip">${xmSnow()}<i class="xm3-shoot"></i></div>`, sub: () => "MAGIA PÓŁNOCY" }),
  ],
});

// ================================================================ CHOINKA: wygląd 1 z większą liczbą bombek (prefiks tre-)

const treBranch = (cls, rot) => vmSvg(`<g transform="rotate(${rot} 50 50)"><path d="M50 98 L50 4" stroke="#3a2a18" stroke-width="2.2"/>
  ${Array.from({ length: 16 }, (_, k) => { const y = 8 + k * 5.6, l = 6 + k * 1.9;
    return `<path d="M50 ${y} l${l} ${l * .55} M50 ${y} l-${l} ${l * .55}" stroke="${k % 2 ? "#1f6b3a" : "#2a8a4a"}" stroke-width="2.6" stroke-linecap="round"/>`; }).join("")}</g>`,
  "0 0 100 100", `tre-branch ${cls}`, "xMidYMid meet");
const TRE_COLORS = ["#c41e3a", "#d4af37", "#2a7de1", "#e8e8f0", "#8a2be2", "#e84a8a"];
// bombka: x (%), długość nitki, kolor, średnica, wzór (pasek / kropki / gładka)
const treBall = (x, len, c, sz = 6, pat = "", y = -2) => `<i class="tre-ball ${pat}" style="left:${x}%;top:${y}%;--len:${len}cqw;--c:${c};--sz:${sz}cqw;animation-delay:-${vmN(0, 3, 1)}s"></i>`;
const treBalls = (n, x0 = 6, x1 = 94, lens = [3, 14], y = -2) => Array.from({ length: n }, (_, k) =>
  treBall((x0 + (x1 - x0) * (n > 1 ? k / (n - 1) : .5)).toFixed(1), vmN(...lens), TRE_COLORS[k % TRE_COLORS.length], vmN(4.5, 7.5, 1), vmPick(["", "stripe", "dots"]), y)).join("");

VARIANT_PROPOSALS.push({
  key: "tree", icon: "🌲", name: "Choinka", tag: "🌲 CHOINKA",
  about: "wybrany wygląd 1 (gałązki świerku z rogów) - cztery wersje z dużo większą liczbą bombek",
  looks: [
    X({ name: "Kaskady bombek", desc: "Gałązki świerku z górnych rogów, a z nich spływają po obu bokach kaskady bombek na nitkach różnej długości (środek karty zostaje wolny): czerwone, złote, niebieskie, srebrne, fioletowe i różowe, gładkie, w paski i w kropki; kołyszą się, prószy drobny śnieg.",
      cls: "tre", bg: () => '<div class="vm-bg tre-bg"></div>', deco: () => `<div class="vm-deco tre-clip">${treBranch("a", 135)}${treBranch("b", -135)}${xmSnow()}</div><div class="vm-deco tre-clip">${treBalls(6, 3, 21, [2, 20], 3)}${treBalls(6, 79, 97, [2, 20], 3)}</div>` }),
    X({ name: "Choinkowa rama", desc: "Gałązki we wszystkich czterech rogach, a wzdłuż lewego i prawego boku ramki wiszą jedna pod drugą małe bombki, po siedem z każdej strony, i kolejne przy dolnych gałązkach - razem prawie 20.",
      cls: "tre", bg: () => '<div class="vm-bg tre-bg"></div>',
      deco: () => `<div class="vm-deco tre-clip">${treBranch("a", 135)}${treBranch("b", -135)}${treBranch("c", 45)}${treBranch("d", -45)}</div><div class="vm-deco tre-clip">${treBalls(2, 12, 22, [1, 4], 76)}${treBalls(2, 78, 88, [1, 4], 76)}${
        [12, 22, 32, 42, 52, 62, 72].map(y => treBall(2.5, 2, vmPick(TRE_COLORS), 5, vmPick(["", "stripe", "dots"]), y) + treBall(97.5, 2, vmPick(TRE_COLORS), 5, vmPick(["", "stripe", "dots"]), y)).join("")}</div>` }),
    X({ name: "Girlanda", desc: "Przez górę zdjęcia przewieszona gruba girlanda z gałązek świerku z migoczącymi lampkami, a z niej zwisają gęsto bombki w różnych kolorach i rozmiarach - dłuższe po bokach, przy twarzy krótkie; prószy śnieg.",
      cls: "tre", bg: () => '<div class="vm-bg tre-bg"></div>',
      photo: () => `${treBalls(4, 4, 22, [6, 22], 3)}${treBalls(4, 78, 96, [6, 22], 3)}${treBalls(4, 32, 68, [0, 1.5], 3)}<i class="tre3-garland"></i>${vmScatter(12, "tre3-light", () => `--c:${vmPick(["#ff3b3b", "#ffd23d", "#3ba2ff", "#ff7ad9"])}`, [1, 9])}`,
      deco: () => `<div class="vm-deco tre-clip">${xmSnow()}</div>` }),
    X({ name: "Bombki przed zdjęciem", desc: "Gałązki z górnych rogów, złota gwiazda nad nazwą, a bombki wiszą też przed zdjęciem - z górnej krawędzi zdjęcia zwisa pięć dużych bombek, w których odbija się światło; po bokach karty kolejne.",
      cls: "tre", bg: () => '<div class="vm-bg tre-bg"></div>', top: () => '<div class="tre4-star">★</div>',
      photo: () => treBalls(5, 10, 90, [.5, 4], 0),
      deco: () => `<div class="vm-deco tre-clip">${treBranch("a", 135)}${treBranch("b", -135)}</div><div class="vm-deco tre-clip">${treBalls(4, 3, 18, [4, 16])}${treBalls(4, 82, 97, [4, 16])}</div>` }),
  ],
});

// ================================================================ PREZENTOWY: wygląd 1 z lepszą animacją odpakowania (prefiks gf-)
// Na makietach animacja gra tam i z powrotem (alternate): odpakowanie, a potem to samo od tyłu = „Zapakuj ponownie” z podglądu karty.

const gfBow = (cls = "") => `<i class="gf-bow ${cls}"><b class="tl l"></b><b class="tl r"></b><b class="lp l"></b><b class="lp r"></b><b class="kn"></b></i>`;
const gfOpen = () => '<div class="vm-deco gf-open"><i class="gf-frame"></i>' + gfBow("small") + '</div>';
const gfLook = (name, desc, wrap) => X({ name, desc, cls: "gf", bg: () => '<div class="vm-bg gf-under"></div>', deco: () => gfOpen() + `<div class="vm-deco gf-wrap ${wrap.cls}">${wrap.html()}</div>`, sub: () => "OD: SCAMBOX · DLA: CIEBIE" });

VARIANT_PROPOSALS.push({
  key: "gift", icon: "🎁", name: "Prezentowy", tag: "🎁 PREZENT",
  about: "wybrany wygląd 1 (czerwony papier, złota wstążka) - cztery nowe animacje odpakowania. Na makietach pętla: zapakowana, odpakowanie, odpakowana, a potem to samo od tyłu (tak zadziała „Zapakuj ponownie”)",
  looks: [
    gfLook("Kokarda i rozdarcie", "Kokarda się rozwiązuje (pętle rozchodzą się na boki i opadają), wstążki zsuwają się z karty, a papier pęka w zygzak przez środek i obie połówki odpadają w dół, obracając się; w momencie rozdarcia sypią się strzępki papieru.",
      { cls: "gfa", html: () => `<i class="gf-half l"></i><i class="gf-half r"></i><i class="gf-rib v"></i><i class="gf-rib h"></i>${gfBow()}${vmScatter(14, "gf-scrap", () => `--dx:${vmN(-30, 30)}cqw;--dy:${vmN(10, 60)}cqw;--r:${vmN(-400, 400)}deg`, [35, 60], [40, 60])}` }),
    gfLook("Pudełko z pokrywką", "Karta to pudełko: pokrywka podskakuje kilka razy, jakby coś było w środku, potem wyskakuje do góry i odlatuje, przednia ścianka opada do przodu, a ze środka wylatują złote gwiazdki.",
      { cls: "gfb", html: () => `<i class="gf-front"><i class="gf-rib v"></i></i><i class="gf-lid"><i class="gf-rib v"></i><i class="gf-rib h"></i>${gfBow()}</i>${vmScatter(12, "gf-star", () => `--dx:${vmN(-25, 25)}cqw;--dy:${vmN(-70, -30)}cqw`, [45, 60], [30, 70])}` }),
    gfLook("Rozkładany papier", "Papier złożony jak koperta z czterech trójkątów, na środku kokarda. Kokarda odskakuje, a potem cztery skrzydełka papieru po kolei rozkładają się na zewnątrz w 3D (góra, prawe, dół, lewe) i odsłaniają kartę.",
      { cls: "gfc", html: () => `<i class="gf-flap t"></i><i class="gf-flap r"></i><i class="gf-flap b"></i><i class="gf-flap l"></i>${gfBow()}` }),
    gfLook("Pociągnięta wstążka", "Kokarda zostaje pociągnięta do góry, wstążki z sykiem się wysuwają, a papier rozpada się na kilkadziesiąt kawałków, które rozlatują się na wszystkie strony, obracając się.",
      { cls: "gfd", html: () => `${Array.from({ length: 24 }, (_, k) => { const cx = k % 4, cy = Math.floor(k / 4);
        return `<i class="gf-tile" style="left:${cx * 25}%;top:${(cy * 100 / 6).toFixed(3)}%;background-position:${(cx / 3 * 100).toFixed(2)}% ${(cy / 5 * 100).toFixed(2)}%;--dx:${((cx - 1.5) * vmN(14, 30)).toFixed(0)}cqw;--dy:${((cy - 2.5) * vmN(10, 22)).toFixed(0)}cqw;--r:${vmN(-300, 300)}deg;animation-delay:${(Math.abs(cx - 1.5) + Math.abs(cy - 2.5)) * .02}s"></i>`; }).join("")}<i class="gf-rib v"></i><i class="gf-rib h"></i>${gfBow()}` }),
  ],
});
