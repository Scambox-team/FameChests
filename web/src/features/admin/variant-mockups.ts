// @ts-nocheck -- propozycje wariantów, przeniesione ze starego variant-mockups.js
import { imgUrl, rand } from '../../game/rules';
import './variant-mockups.css';

// Propozycje nowych wariantów (strona /variants, zakładka „Propozycje”) - makiety do wyboru, jeszcze NIE w grze.
// Każda makieta = zwykła karta + klasy vm-<wariant> vm-<wariant>-<nr> (variant-mockups.css) i ozdoby:
// bg (tło w środku karty, pod napisami), photo (na zdjęciu), deco (nad całą kartą), top (w środku karty nad nazwą),
// sub (tekst zamiast "typ · skrzynka") - vrProposalCard w variants.ts. cls - dodatkowe klasy (tu `vmx`: wygląd paneli
// ze zmiennych --x-* w variant-mockups.css). Elementy w `top` potrzebują `flex: none` (inaczej karta je ściska).
// Po wyborze wygląd przechodzi do cards2.css / cardHtml.ts jako prawdziwy wariant, a jego makiety stąd znikają.

const vmN = (a, b, d = 0) => rand(a, b).toFixed(d);
const vmPick = arr => arr[Math.floor(Math.random() * arr.length)];
const vmSvg = (body, vb = "0 0 63 88", cls = "", par = "none") =>
  `<svg class="${cls}" viewBox="${vb}" preserveAspectRatio="${par}" aria-hidden="true">${body}</svg>`;
// rzeczy rozrzucone po karcie (kropki, iskry, gwiazdki): losowe miejsce i opóźnienie animacji
const vmScatter = (n, cls, extra = () => "", y = [2, 96], x = [2, 96]) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${vmN(...x)}%;top:${vmN(...y)}%;animation-delay:-${vmN(0, 6, 1)}s;${extra()}"></i>`).join("");
// makieta z panelami ze zmiennych --x-*
const X = o => ({ ...o, cls: `vmx${o.cls ? " " + o.cls : ""}` });
// rzeczy rozłożone po obwodzie karty (pióra, kwiaty, diody): n punktów, f(x%, y%, k)
function vmPerimeter(n, f) {
  const per = 2 * (63 + 88);
  return Array.from({ length: n }, (_, k) => {
    let d = k / n * per, x, y;
    if (d < 63) { x = d; y = 0; } else if ((d -= 63) < 88) { x = 63; y = d; } else if ((d -= 88) < 63) { x = 63 - d; y = 88; } else { x = 0; y = 88 - (d - 63); }
    return f((x / 63 * 100).toFixed(1), (y / 88 * 100).toFixed(1), k);
  }).join("");
}

// ================================================================ ANALOG HORROR (prefiks ah-) - na bazie makiety 1 „Komunikat alarmowy”
// Wszystkie: granatowa plansza systemu ostrzegania, monospace, linie obrazu, czarno-białe zdjęcie. Napis na zdjęciu (tu „NIE PATRZ
// W NIEBO”) i podpis („TO NIE JEST ĆWICZENIE”) będą wpisywane w panelu admina osobno dla każdej karty; wariant z własnym zdjęciem.

const AH_WARN = "NIE PATRZ W NIEBO", AH_SUB = "TO NIE JEST ĆWICZENIE";
const ahNoise = (op = .35, cls = "") => `<i class="ah-noise ${cls}" style="opacity:${op}"></i>`;
const ahScan = () => '<i class="ah-scan"></i>';
// godło „urzędu”: pieczęć z gwiazdkami, w środku skrzynka ScamBox, napis dookoła
const ahSeal = (cls = "ah-seal") => vmSvg(`
  <defs><path id="ahRing" d="M50 50 m-37 0 a37 37 0 1 1 74 0 a37 37 0 1 1 -74 0"/></defs>
  <circle cx="50" cy="50" r="47" fill="#0a1550" stroke="#dfe6ff" stroke-width="2.4"/>
  <circle cx="50" cy="50" r="30" fill="none" stroke="#dfe6ff" stroke-width="1.2"/>
  <text font-size="8.2" font-family="Share Tech Mono, monospace" fill="#dfe6ff" letter-spacing="1.2"><textPath href="#ahRing">URZĄD OBRONY CYWILNEJ ✦ SCAMBOX ✦ </textPath></text>
  <path d="M33 44 L50 35 L67 44 L67 64 L50 72 L33 64Z" fill="none" stroke="#dfe6ff" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M33 44 L50 53 L67 44 M50 53 V72" fill="none" stroke="#dfe6ff" stroke-width="2.2" stroke-linejoin="round"/>
  <rect x="45" y="49" width="10" height="7" rx="1.5" fill="#ff3b30"/>`, "0 0 100 100", cls, "xMidYMid meet");
// znak schronu (żółte koło z trzema czarnymi trójkątami) i znak obrony cywilnej (niebieski trójkąt w pomarańczowym)
const ahShelterSign = (cls = "ah-sign") => vmSvg(`<circle cx="20" cy="20" r="19" fill="#ffd400" stroke="#111" stroke-width="1.5"/>
  ${[0, 120, 240].map(a => `<path d="M20 20 L13 7.5 A14.5 14.5 0 0 1 27 7.5Z" fill="#111" transform="rotate(${a} 20 20)"/>`).join("")}
  <circle cx="20" cy="20" r="4.2" fill="#ffd400"/>`, "0 0 40 40", cls, "xMidYMid meet");
const ahCivil = (cls = "ah-civil") => vmSvg('<rect width="40" height="40" fill="#ff7a00"/><path d="M20 6 L36 34 H4Z" fill="#1c4fd8"/>', "0 0 40 40", cls, "xMidYMid meet");
// pasy rozerwanego obrazu: kopie zdjęcia przycięte do wąskich pasków, co chwilę przesunięte w bok
const ahTears = (p, n = 3) => Array.from({ length: n }, (_, k) =>
  `<i class="ah-tear" style="--y:${vmN(8, 80)}%;--h:${vmN(3, 9)}%;animation-delay:-${vmN(0, 4, 1)}s;animation-duration:${vmN(2.4, 4.4, 1)}s"><img src="${imgUrl(p.id, "normal")}" alt=""></i>`).join("");
// rozjechane kolory: dwie barwne kopie zdjęcia, które na moment odjeżdżają w bok
const ahChroma = p => `<i class="ah-chroma r"><img src="${imgUrl(p.id, "normal")}" alt=""></i><i class="ah-chroma c"><img src="${imgUrl(p.id, "normal")}" alt=""></i>`;
const ahRoll = () => '<i class="ah-roll"></i>';
const ahBurst = (d = 5) => `<i class="ah-burst" style="animation-duration:${d}s">${ahNoise(1)}</i>`;

const VM_ANALOG = {
  key: "analog", icon: "📼", name: "Analog horror", tag: "📼 ANALOG",
  about: "na bazie makiety „Komunikat alarmowy”: zakłócenia sygnału, godło ScamBoxa jak urzędu, komunikaty o schronie. Napis na zdjęciu i podpis wpisywane w panelu dla każdej karty, własne zdjęcie wariantu",
  looks: [
    X({
      name: "Sekwencja nadawania",
      desc: "Zapętlony program w miejscu zdjęcia (12 s): najpierw godło „URZĄD OBRONY CYWILNEJ · SCAMBOX” z napisem „PROSIMY CZEKAĆ”, błysk szumu, potem czarno-białe zdjęcie z migającym napisem, znowu szum i plansza „UDAJ SIĘ DO NAJBLIŻSZEGO SCHRONU” ze znakiem schronu. Przez cały czas toczący się pas obrazu i rwące się paski.",
      top: () => '<div class="ah1-bar"><b>⚠ KOMUNIKAT ALARMOWY</b><span>NADAWANY O 03:00</span></div>',
      bg: () => `<div class="vm-bg ah-navy">${ahScan()}${ahNoise(.1)}</div>`,
      photo: p => `<i class="vm-photo ah-ph-scan"></i>${ahTears(p, 2)}<span class="ah-warn">${AH_WARN}</span>
        <i class="ah-seq ah-seq-logo">${ahSeal()}<b>PROSIMY CZEKAĆ</b></i>
        <i class="ah-seq ah-seq-shelter">${ahShelterSign()}<b>UDAJ SIĘ DO NAJBLIŻSZEGO SCHRONU</b></i>${ahRoll()}${ahBurst(12)}`,
      sub: () => AH_SUB,
    }),
    X({
      name: "Rwący się sygnał",
      desc: "Zdjęcie widać cały czas, ale sygnał co chwilę się sypie: paski obrazu przeskakują w bok, kolory rozjeżdżają się na czerwony i niebieski, przez obraz toczy się jasny pas, a co kilka sekund cała karta na ułamek sekundy zamienia się w śnieg. Godło urzędu wyblakłe w rogu tła.",
      top: () => '<div class="ah1-bar"><b>⚠ KOMUNIKAT ALARMOWY</b><span class="ah-sigbar">SYGNAŁ ▂▃▁▅▁</span></div>',
      bg: () => `<div class="vm-bg ah-navy">${ahScan()}${ahSeal("ah-seal ah2-water")}</div>`,
      photo: p => `<i class="vm-photo ah-ph-scan"></i>${ahChroma(p)}${ahTears(p, 4)}<span class="ah-warn">${AH_WARN}</span>${ahRoll()}${ahBurst(4)}`,
      deco: () => `<div class="vm-deco ah-clip ah2-jolt">${ahNoise(.08)}</div>`,
      sub: () => AH_SUB,
    }),
    X({
      name: "Godło w tle",
      desc: "Za kartą powoli obraca się duże godło ScamBoxa jak pieczęć urzędu, pod zdjęciem przesuwa się pasek z komunikatami („ZOSTAŃ W DOMU · ZASŁOŃ OKNA · NIE ODPOWIADAJ NA PUKANIE”), zdjęcie co jakiś czas szarpie się i rozmywa.",
      top: () => '<div class="ah1-bar"><b>URZĄD OBRONY CYWILNEJ</b><span>KANAŁ 0</span></div>',
      bg: () => `<div class="vm-bg ah-navy">${ahSeal("ah-seal ah3-spin")}${ahScan()}</div>`,
      photo: p => `<i class="vm-photo ah-ph-scan"></i>${ahTears(p, 2)}<span class="ah-warn">${AH_WARN}</span><span class="ah3-ticker"><i>ZOSTAŃ W DOMU · ZASŁOŃ OKNA · NIE ODPOWIADAJ NA PUKANIE · CZEKAJ NA DALSZE KOMUNIKATY · </i></span>`,
      sub: () => AH_SUB,
    }),
    X({
      name: "Schron",
      desc: "Zdjęcie z napisem, a co kilka sekund od dołu wjeżdża żółto-czarna plansza ze znakiem schronu i strzałką „SCHRON 200 M →”, pasek nad nazwą na zmianę pokazuje „KOMUNIKAT ALARMOWY” i „UDAJ SIĘ DO SCHRONU”, w rogu zdjęcia znak obrony cywilnej.",
      top: () => '<div class="ah1-bar ah4-swap"><b>⚠ KOMUNIKAT ALARMOWY</b><b>⚠ UDAJ SIĘ DO SCHRONU</b></div>',
      bg: () => `<div class="vm-bg ah-navy">${ahScan()}${ahNoise(.1)}</div>`,
      photo: p => `<i class="vm-photo ah-ph-scan"></i>${ahTears(p, 2)}<span class="ah-warn">${AH_WARN}</span>${ahCivil("ah-civil ah4-civil")}
        <i class="ah4-panel">${ahShelterSign()}<b>SCHRON<br>200 M →</b></i>${ahRoll()}`,
      sub: () => AH_SUB,
    }),
    X({
      name: "Odliczanie",
      desc: "Nad nazwą licznik „DO KOŃCA TRANSMISJI 00:00:09” odliczający w kółko, ramka pulsuje czerwonym światłem syreny, napis na zdjęciu pisze się literka po literce jak w dalekopisie, przy zerze obraz gaśnie do szumu i wszystko zaczyna się od nowa.",
      top: () => '<div class="ah1-bar"><b>DO KOŃCA TRANSMISJI</b><span class="ah5-count">00:00:0<i>9<br>8<br>7<br>6<br>5<br>4<br>3<br>2<br>1<br>0</i></span></div>',
      bg: () => `<div class="vm-bg ah-navy">${ahScan()}</div>`,
      photo: p => `<i class="vm-photo ah-ph-scan"></i>${ahTears(p, 2)}<span class="ah-warn ah5-type" style="--n:${AH_WARN.length}">${AH_WARN}</span><i class="ah5-off">${ahNoise(1)}</i>`,
      deco: () => '<div class="vm-deco ah5-siren"></div>',
      sub: () => AH_SUB,
    }),
    X({
      name: "Utrata kontroli",
      desc: "Plansza zaczyna spokojnie na granatowo, ale w ciągu kilkunastu sekund barwy przechodzą w czerwień, zakłócenia przybierają na sile, a napis nad zdjęciem zmienia się kolejno w „ZACHOWAJ SPOKÓJ”, „ZAMKNIJ DRZWI” i „ON JUŻ JEST W ŚRODKU”; potem obraz się resetuje do godła.",
      top: () => '<div class="ah1-bar ah6-msgs"><b>ZACHOWAJ SPOKÓJ</b><b>ZAMKNIJ DRZWI</b><b>ON JUŻ JEST W ŚRODKU</b></div>',
      bg: () => `<div class="vm-bg ah-navy ah6-redden">${ahScan()}${ahNoise(.12)}</div>`,
      photo: p => `<i class="vm-photo ah-ph-scan"></i>${ahChroma(p)}${ahTears(p, 3)}<span class="ah-warn">${AH_WARN}</span><i class="ah-seq ah6-logo">${ahSeal()}</i>${ahBurst(16)}`,
      sub: () => AH_SUB,
    }),
  ],
};

// ================================================================ BARBIE (prefiks bb-) - na bazie makiety 2 „Cała w brokacie”
// Brokat = dwie warstwy drobin, które migają na zmianę (każda w swoim rytmie), błyski gwiazdek i przesuwający się połysk.
// Wariant będzie miał własne zdjęcie karty (panel admina).

const bbGlints = (n, y = [2, 96]) => vmScatter(n, "bb-glint", () => `--s:${vmN(.5, 1.5, 2)};animation-duration:${vmN(1.6, 3.4, 1)}s`, y);
const bbHearts = n => vmScatter(n, "bb-heart", () => `--s:${vmN(.6, 1.4, 2)};animation-duration:${vmN(3, 6, 1)}s`);
const bbFlakes = (n, y = [-8, 0]) => vmScatter(n, "bb-flake", () => `--c:${vmPick(["#fff", "#ffd6f0", "#ff7cc0", "#ffe6a8", "#e8d8ff"])};--dx:${vmN(-10, 10)}cqw;animation-duration:${vmN(4, 8, 1)}s;--s:${vmN(.5, 1.2, 2)}`, y);
const bbGlitter = (cls = "") => `<i class="bb-gl a ${cls}"></i><i class="bb-gl b ${cls}"></i><i class="bb-sheen"></i>`;

const VM_BARBIE = {
  key: "barbie", icon: "💖", name: "Barbie", tag: "💖 BARBIE",
  about: "na bazie makiety „Cała w brokacie”: prawdziwy migoczący brokat, błyski, połysk, dużo ruchu. Wariant z własnym zdjęciem karty (panel admina)",
  looks: [
    X({
      name: "Brokatowa bomba",
      desc: "Cała karta pokryta drobnym różowym brokatem, którego drobiny migają na zmianę w dwóch rytmach, po karcie przelatuje połysk, co chwilę zapalają się duże gwiazdki-błyski, za zdjęciem unoszą się serduszka, a z góry sypią się różowe, białe i złote drobinki.",
      bg: () => `<div class="vm-bg bb-hot">${bbGlitter()}${bbHearts(10)}${bbGlints(10)}</div>`,
      photo: () => '<i class="vm-photo bb-rim"></i>',
      deco: () => `<div class="vm-deco bb-clip">${bbFlakes(16)}${bbGlints(5, [2, 30])}</div>`,
      sub: () => "✨ 100% BROKATU ✨",
    }),
    X({
      name: "Brokatowa ramka",
      desc: "Gruba ramka z gęstego brokatu w różu i srebrze, po której wędruje błysk, środek z gładkiej różowej satyny, wokół zdjęcia migoczą iskierki, a nad nazwą pulsuje brokatowe serce.",
      top: () => '<div class="bb2-heart"></div>',
      bg: () => `<div class="vm-bg bb-satin"></div>`,
      photo: () => '<i class="vm-photo bb-rim"></i>',
      deco: () => `<div class="vm-deco bb2-frame"></div><div class="vm-deco">${vmPerimeter(22, (x, y) => `<i class="bb-glint" style="left:${x}%;top:${y}%;--s:${vmN(.5, 1.2, 2)};animation-delay:-${vmN(0, 3, 1)}s;animation-duration:${vmN(1.4, 2.8, 1)}s"></i>`)}</div>`,
      sub: () => "♡ GLITTER QUEEN ♡",
    }),
    X({
      name: "Kula disco",
      desc: "Nad kartą obraca się różowa kula dyskotekowa: po całej karcie suną plamki odbitego światła, z góry omiatają ją różowe i fioletowe reflektory, brokat w tle miga w rytm, zdjęcie lśni na brzegach.",
      top: () => '<div class="bb3-ball"><i></i></div>',
      bg: () => `<div class="vm-bg bb-disco">${bbGlitter()}<i class="bb3-beam a"></i><i class="bb3-beam b"></i></div>`,
      photo: () => '<i class="vm-photo bb-rim"></i>',
      deco: () => `<div class="vm-deco bb-clip">${vmScatter(18, "bb3-spot", () => `animation-duration:${vmN(3, 6, 1)}s`)}</div>`,
      sub: () => "DISCO · SOBOTA · 21:00",
    }),
    X({
      name: "Lakier z brokatem",
      desc: "Jak żelowy lakier do paznokci: głęboki róż przechodzący w fiolet z zatopionymi sześciokątnymi drobinkami holo, które przy obrocie zmieniają kolor, po wierzchu szklany połysk przesuwa się jak światło po paznokciu.",
      bg: () => `<div class="vm-bg bb-gel">${vmScatter(36, "bb4-hex", () => `--s:${vmN(.5, 1.3, 2)};--h:${vmN(0, 360)}deg;animation-duration:${vmN(2, 5, 1)}s`)}<i class="bb4-gloss"></i></div>`,
      photo: () => '<i class="vm-photo bb-rim"></i><i class="vm-photo bb4-glass"></i>',
      deco: () => `<div class="vm-deco bb-clip">${bbGlints(6)}</div>`,
      sub: () => "KOLOR NR 69 · HOT PINK",
    }),
    X({
      name: "Brokat i serca",
      desc: "Migoczący brokat, a co kilka sekund od dołu karty wystrzeliwuje fontanna serduszek i drobinek, nazwa w różowo-złotym gradiencie, który przesuwa się jak połysk, błyski gwiazdek w rogach.",
      bg: () => `<div class="vm-bg bb-hot">${bbGlitter()}${bbGlints(8)}</div>`,
      photo: () => '<i class="vm-photo bb-rim"></i>',
      deco: () => `<div class="vm-deco bb-clip">${Array.from({ length: 14 }, () => `<i class="bb5-pop" style="left:${vmN(10, 90)}%;--dx:${vmN(-14, 14)}cqw;--up:${vmN(14, 34)}cqw;--c:${vmPick(["#ff2f9a", "#fff", "#ffd36e", "#ff9bd0"])};animation-delay:-${vmN(0, 4, 1)}s"></i>`).join("")}</div>`,
      sub: () => "♡ KOCHAM RÓŻ ♡",
    }),
    X({
      name: "Holo-brokat",
      desc: "Brokat holograficzny: drobiny mienią się wszystkimi kolorami tęczy na różowym tle, po karcie przelewa się tęczowy połysk, migają duże srebrne gwiazdki, ramka holo zmienia odcień.",
      bg: () => `<div class="vm-bg bb-holo">${bbGlitter("holo")}<i class="bb6-rainbow"></i>${bbGlints(10)}</div>`,
      photo: () => '<i class="vm-photo bb-rim holo"></i>',
      deco: () => `<div class="vm-deco bb-clip">${bbFlakes(10)}</div>`,
      sub: () => "✦ HOLO EDITION ✦",
    }),
  ],
};

// ================================================================ HAWAJSKA (prefiks hi-; hw- zajęte przez Halloween) - słonecznie, plaża, kwiaty

// kwiat hibiskusa (środek x, y, promień r) i plumeria (5 białych płatków z żółtym środkiem)
const hiFlower = (x, y, r, c, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot})">${Array.from({ length: 5 }, (_, k) =>
  `<ellipse cx="0" cy="${(-r * .55).toFixed(2)}" rx="${(r * .42).toFixed(2)}" ry="${(r * .6).toFixed(2)}" fill="${c}" transform="rotate(${k * 72})"/>`).join("")}
  <circle r="${(r * .2).toFixed(2)}" fill="#ffe14d"/><path d="M0 0 L${(r * .15).toFixed(2)} ${(-r * .7).toFixed(2)}" stroke="#ffe14d" stroke-width="${(r * .08).toFixed(2)}"/></g>`;
const hiPlumeria = (x, y, r, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot})">${Array.from({ length: 5 }, (_, k) =>
  `<ellipse cx="${(r * .18).toFixed(2)}" cy="${(-r * .5).toFixed(2)}" rx="${(r * .32).toFixed(2)}" ry="${(r * .58).toFixed(2)}" fill="#fffaf0" stroke="#f5d9a8" stroke-width=".15" transform="rotate(${k * 72})"/>`).join("")}
  <circle r="${(r * .28).toFixed(2)}" fill="#ffd23d"/></g>`;
const HI_COLS = ["#ff3d7f", "#ff6a3d", "#ffcf3d", "#c86bff", "#ff3d7f"];
// naszyjnik lei: kwiaty wzdłuż łuku
const hiLei = (y0 = 1, dip = 8) => vmSvg(Array.from({ length: 17 }, (_, k) => {
  const t = k / 16, x = 4 + t * 55, y = y0 + Math.sin(t * Math.PI) * dip;
  return hiFlower(x.toFixed(2), y.toFixed(2), 3.4, vmPick(HI_COLS), vmN(0, 72));
}).join(""), `0 0 63 ${y0 + dip + 4}`, "hi-lei", "xMidYMax meet");
// kępka kwiatów w rogu karty (hibiskusy + plumerie + liście)
const hiCorner = (cls, flip = "") => vmSvg(`
  <path d="M0 0 Q14 4 22 18 Q10 14 0 22Z" fill="#1f9a4a"/><path d="M0 0 Q4 16 16 26 Q4 22 -2 12Z" fill="#26b35a"/>
  ${hiFlower(8, 8, 7, "#ff3d7f", 15)}${hiPlumeria(19, 5, 4.2, 30)}${hiPlumeria(5, 19, 4, -10)}${hiFlower(17, 15, 4.6, "#ff6a3d", 50)}`,
  "0 0 30 30", `hi-corner ${cls}`, "xMinYMin meet") ;
// liść palmy (pierzasty) do ramki
const hiFrond = (cls, rot) => vmSvg(`<g transform="rotate(${rot} 50 50)"><path d="M50 98 Q52 60 50 4" stroke="#1d7a3a" stroke-width="2" fill="none"/>
  ${Array.from({ length: 13 }, (_, k) => { const y = 10 + k * 6.5, l = 14 + Math.sin(k / 12 * Math.PI) * 20;
    return `<path d="M50.5 ${y} q${l * .55} -2 ${l} 8 q-${l * .5} -1 -${l} -6Z" fill="#26a352"/><path d="M49.5 ${y} q-${l * .55} -2 -${l} 8 q${l * .5} -1 ${l} -6Z" fill="#2fbf61"/>`; }).join("")}</g>`,
  "0 0 100 100", `hi-frond ${cls}`, "xMidYMid meet");

const VM_HAWAII = {
  key: "hawaii", icon: "🌺", name: "Hawajska", tag: "🌺 ALOHA",
  about: "słoneczna plaża i hawajskie kwiaty (hibiskus, plumeria, lei). Wariant z naklejkami od admina (jak MLG) i wbudowanymi grafikami: naszyjnik lei, hibiskus, plumeria, ananas, ukulele, deska surfingowa, kokos z parasolką",
  looks: [
    X({
      name: "Słoneczna plaża",
      desc: "Jasne niebo, w rogu ostre słońce z obracającymi się promieniami, na dole turkusowe morze z migoczącymi refleksami i złoty piasek, w rogach kępy hibiskusów i plumerii, na szyi na zdjęciu kolorowy lei, ciepłe słoneczne zdjęcie.",
      bg: () => '<div class="vm-bg hi-sky"><i class="hi-rays"></i><i class="hi-sun"></i><i class="hi-sea"></i><i class="hi-sand"></i></div>',
      photo: () => `<i class="vm-photo hi-warm"></i>${hiLei()}`,
      deco: () => `<div class="vm-deco">${hiCorner("tl")}${hiCorner("br")}</div>`,
      sub: () => "ALOHA · WAIKIKI ☀ 32°C",
    }),
    X({
      name: "Pod palmami",
      desc: "Ramka z soczyście zielonych liści palm wchodzących na kartę z rogów, przez liście przesuwają się plamki słońca (cień liści na karcie się kołysze), hibiskusy przy liściach, piaskowo-turkusowe tło.",
      bg: () => '<div class="vm-bg hi-lagoon"><i class="hi2-dapple"></i></div>',
      photo: () => '<i class="vm-photo hi-warm"></i><i class="vm-photo hi2-shade"></i>',
      deco: () => `<div class="vm-deco hi-clip">${hiFrond("f1", -40)}${hiFrond("f2", 130)}${hiFrond("f3", 40)}${vmSvg(hiFlower(2, 86, 5, "#ff3d7f", 20) + hiFlower(62, 46, 4.6, "#ffcf3d", 60) + hiPlumeria(7, 88, 3.2, 10), "0 0 63 88", "hi2-fl")}</div>`,
      sub: () => "CIEŃ PALMY · MAI TAI",
    }),
    X({
      name: "Girlanda kwiatów",
      desc: "Cała ramka karty to girlanda z hibiskusów i plumerii, które lekko się kołyszą, tło w słonecznym gradiencie od żółci do turkusu, z góry spadają płatki, zdjęcie w białej obwódce.",
      bg: () => '<div class="vm-bg hi-sunny"><i class="hi-rays soft"></i></div>',
      photo: () => '<i class="vm-photo hi-warm"></i>',
      deco: () => `<div class="vm-deco">${vmPerimeter(30, (x, y, k) => `<i class="hi3-bloom" style="left:${x}%;top:${y}%;animation-delay:-${vmN(0, 3, 1)}s">${vmSvg(k % 3 ? hiFlower(10, 10, 9, vmPick(HI_COLS), vmN(0, 72)) : hiPlumeria(10, 10, 8, vmN(0, 72)), "0 0 20 20", "", "xMidYMid meet")}</i>`)}</div>
        <div class="vm-deco hi-clip">${vmScatter(10, "hi-petal", () => `--dx:${vmN(-12, 12)}cqw;animation-duration:${vmN(5, 9, 1)}s;--c:${vmPick(HI_COLS)}`, [-10, 0])}</div>`,
      sub: () => "E KOMO MAI · WITAJCIE",
    }),
    X({
      name: "Laguna w słońcu",
      desc: "Turkusowa płytka woda: po całej karcie tańczy siatka światła odbitego od fal, po wodzie dryfują plumerie, na zdjęciu słoneczny błysk obiektywu, który przesuwa się po skosie.",
      bg: () => `<div class="vm-bg hi-water"><i class="hi4-caustic a"></i><i class="hi4-caustic b"></i>${Array.from({ length: 6 }, () => `<i class="hi4-float" style="left:${vmN(0, 90)}%;top:${vmN(0, 90)}%;animation-delay:-${vmN(0, 10, 1)}s">${vmSvg(hiPlumeria(10, 10, 8, vmN(0, 72)), "0 0 20 20", "", "xMidYMid meet")}</i>`).join("")}</div>`,
      photo: () => '<i class="vm-photo hi-warm"></i><i class="vm-photo hi4-flare"></i>',
      deco: () => `<div class="vm-deco">${hiCorner("tr")}</div>`,
      sub: () => "LANIKAI · WODA 27°C",
    }),
    X({
      name: "Aloha retro",
      desc: "Słoneczna pocztówka z lat 50.: promienie słońca w paski rozchodzą się zza zdjęcia, nad nazwą duże „ALOHA” z kwiatowym wypełnieniem, hibiskusy w rogach, kolory nasycone jak w starych reklamach linii lotniczych.",
      top: () => '<div class="hi5-aloha">ALOHA</div>',
      bg: () => '<div class="vm-bg hi5-burst"></div>',
      photo: () => `<i class="vm-photo hi-warm"></i>${hiLei(1, 7)}`,
      deco: () => `<div class="vm-deco">${hiCorner("tl")}${hiCorner("br")}</div>`,
      sub: () => "POZDROWIENIA Z HAWAJÓW",
    }),
    X({
      name: "Tropikalny koktajl",
      desc: "Bardzo jaskrawo: różowo-pomarańczowo-żółte paski jak parasolka do drinka, po tle sunie wzór z hibiskusów, w dwóch rogach kępy kwiatów, z dołu unoszą się bąbelki jak w szklance soku, mocne letnie kolory napisów.",
      bg: () => `<div class="vm-bg hi6-stripes">${vmSvg(Array.from({ length: 12 }, () => hiFlower(vmN(0, 63), vmN(0, 88), vmN(4, 7), "#fff6", vmN(0, 72))).join(""), "0 0 63 88", "hi6-print")}${vmScatter(12, "hi6-bub", () => `--s:${vmN(.5, 1.3, 2)};animation-duration:${vmN(3, 6, 1)}s`, [80, 100])}</div>`,
      photo: () => '<i class="vm-photo hi-warm"></i>',
      deco: () => `<div class="vm-deco">${hiCorner("tr")}${hiCorner("bl")}</div>`,
      sub: () => "PIÑA COLADA · 2 ZA 1",
    }),
  ],
};

// ---------------------------------------------------------------- PROPOZYCJE

export const VARIANT_PROPOSALS = [VM_ANALOG, VM_BARBIE, VM_HAWAII];
