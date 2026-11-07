// @ts-nocheck -- propozycje wariantów, przeniesione ze starego variant-mockups.js
import { rand } from '../../game/rules';
import './variant-mockups.css';

// Propozycje nowych wariantów (strona /variants, zakładka „Propozycje”) - makiety do wyboru, jeszcze NIE w grze.
// Każda makieta = zwykła karta + klasy vm-<wariant> vm-<wariant>-<nr> (variant-mockups.css) i ozdoby:
// bg (tło w środku karty, pod napisami), photo (na zdjęciu), deco (nad całą kartą), top (w środku karty nad nazwą),
// sub (tekst zamiast "typ · skrzynka") - vrProposalCard w variants.ts. cls - dodatkowe klasy (tu `vmx`: wygląd paneli
// ze zmiennych --x-* w variant-mockups.css).
// Po wyborze wygląd przechodzi do cards2.css / cardHtml.ts jako prawdziwy wariant, a jego makiety stąd znikają.

const vmN = (a, b, d = 0) => rand(a, b).toFixed(d);
const vmPick = arr => arr[Math.floor(Math.random() * arr.length)];
const vmSvg = (body, vb = "0 0 63 88", cls = "", par = "none") =>
  `<svg class="${cls}" viewBox="${vb}" preserveAspectRatio="${par}" aria-hidden="true">${body}</svg>`;
// rzeczy rozrzucone po karcie (kropki, iskry, gwiazdki): losowe miejsce i opóźnienie animacji
const vmScatter = (n, cls, extra = () => "", y = [2, 96]) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${vmN(2, 96)}%;top:${vmN(...y)}%;animation-delay:-${vmN(0, 6, 1)}s;${extra()}"></i>`).join("");
// gwiazda pięcioramienna (środek x, y, promień r)
const vmStar = (x, y, r, fill) => `<path fill="${fill}" d="M${Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * .4 : r;
  return `${(x + Math.cos(a) * rr).toFixed(2)} ${(y + Math.sin(a) * rr).toFixed(2)}`;
}).join(" L")}Z"/>`;
// makieta z panelami ze zmiennych --x-*
const X = o => ({ ...o, cls: `vmx${o.cls ? " " + o.cls : ""}` });

// ================================================================ ANALOG HORROR (prefiks ah-)

// szum telewizora (jedna warstwa, skacze w miejscu)
const ahNoise = (op = .35) => `<i class="ah-noise" style="opacity:${op}"></i>`;
const ahScan = () => '<i class="ah-scan"></i>';
// pasy kontrolne SMPTE (wyblakłe)
const ahBars = () => vmSvg(["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"].map((c, k) =>
  `<rect x="${k * 9}" y="0" width="9.1" height="60" fill="${c}"/>`).join("") +
  ["#0000c0", "#111", "#c000c0", "#111", "#00c0c0", "#111", "#c0c0c0"].map((c, k) => `<rect x="${k * 9}" y="60" width="9.1" height="8" fill="${c}"/>`).join("") +
  '<rect x="0" y="68" width="63" height="20" fill="#16161a"/>', "0 0 63 88", "ah-bars");

const VM_ANALOG = {
  key: "analog", icon: "📼", name: "Analog horror", tag: "📼 ANALOG",
  about: "estetyka horroru analogowego: kasety VHS, komunikaty alarmowe, plansze kontrolne i lokalna telewizja, w której coś jest nie tak",
  looks: [
    X({
      name: "Komunikat alarmowy",
      desc: "Granatowa plansza systemu ostrzegania: pasek „KOMUNIKAT ALARMOWY” nad nazwą, czarno-białe zdjęcie w liniach obrazu z migającym napisem „NIE PATRZ W NIEBO”, wszystkie napisy monospace na niebiesko-białym, delikatny szum.",
      top: () => '<div class="ah1-bar"><b>⚠ KOMUNIKAT ALARMOWY</b><span>NADAWANY O 03:00</span></div>',
      bg: () => `<div class="vm-bg ah1-bg">${ahScan()}${ahNoise(.12)}</div>`,
      photo: () => `<i class="vm-photo ah-ph-scan"></i><span class="ah1-warn">NIE PATRZ W NIEBO</span>`,
      sub: () => "TO NIE JEST ĆWICZENIE",
    }),
    X({
      name: "Kaseta z piwnicy",
      desc: "Znalezione nagranie z kamery: wyblakłe ciepłe kolory, na zdjęciu czerwone ● REC, „PLAY ▶” i data „PAŹ 03 1994 03:17”, przez obraz przesuwa się pas zakłóceń taśmy, kolory rozjechane jak na zużytej kasecie, naklejka na kasetę zamiast podpisu.",
      bg: () => `<div class="vm-bg ah2-bg">${ahNoise(.18)}</div>`,
      photo: () => `<i class="vm-photo ah-ph-scan"></i><i class="ah2-track"></i><span class="ah2-rec">● REC</span><span class="ah2-play">PLAY ▶</span><span class="ah2-date">PAŹ 03 1994<br>03:17:42</span>`,
      sub: () => "<span class=\"ah2-label\">NAGRANIE NR 7 — NIE ODTWARZAĆ</span>",
    }),
    X({
      name: "Plansza kontrolna",
      desc: "Wyblakłe pasy kontrolne za kartą, na zdjęciu okrąg i krzyż planszy testowej, w dolnym pasku tekst „PROSIMY NIE REGULOWAĆ ODBIORNIKA”, który co kilka sekund na moment zmienia się w „ON CIĘ WIDZI”.",
      bg: () => `<div class="vm-bg ah3-bg">${ahBars()}${ahNoise(.15)}</div>`,
      photo: () => '<i class="vm-photo ah3-target"></i><span class="ah3-msg"><b>PROSIMY NIE REGULOWAĆ ODBIORNIKA</b><b>ON CIĘ WIDZI</b></span>',
      sub: () => "KANAŁ 0 · NADAJE OD 3:00",
    }),
    X({
      name: "Telewizja lokalna",
      desc: "Wesoły program dla dzieci z lat 80.: pastelowe pasy i gwiazdki, zdjęcie w ciepłych kolorach z podpisem prowadzącego „WUJEK MIETEK ZAPRASZA!”, a pod nim co jakiś czas prześwituje drobny napis „ON STOI ZA TOBĄ”.",
      top: () => '<div class="ah4-logo">TV <b>LOKALNA</b> 3</div>',
      bg: () => `<div class="vm-bg ah4-bg">${vmScatter(10, "ah4-star")}${ahScan()}</div>`,
      photo: () => '<span class="ah4-caption">WUJEK MIETEK ZAPRASZA!</span><span class="ah4-ghost">on stoi za tobą</span>',
      sub: () => "PROGRAM DLA DZIECI · ODC. ??",
    }),
    X({
      name: "Instrukcja obrony",
      desc: "Pożółkła broszura obrony cywilnej: zdjęcie jak fotografia z druku z czerwonym kółkiem odręcznie zakreślonym wokół twarzy, nad nią „JEŚLI GO ZOBACZYSZ:”, w podpisie kroki „1. ZAMKNIJ OKNA 2. NIE ODPOWIADAJ”, numer strony w stopce.",
      top: () => '<div class="ah5-head">JEŚLI GO ZOBACZYSZ:</div>',
      bg: () => '<div class="vm-bg ah5-bg"></div>',
      photo: () => vmSvg('<ellipse cx="31.5" cy="16" rx="17" ry="13" fill="none" stroke="#c0141c" stroke-width="1.3" stroke-dasharray="90 6" transform="rotate(-6 31.5 16)"/>', "0 0 63 40", "vm-photo ah5-circle"),
      sub: () => "1. ZAMKNIJ OKNA &nbsp;2. NIE ODPOWIADAJ",
    }),
    X({
      name: "Martwy kanał",
      desc: "Śnieg na ekranie zakrywa całą kartę, a zdjęcie wyłania się z szumu tylko na chwile i znika, nad nazwą „SYGNAŁ UTRACONY”, podpis i część napisów zaczernione jak w tajnym dokumencie.",
      top: () => '<div class="ah6-lost">SYGNAŁ UTRACONY</div>',
      bg: () => `<div class="vm-bg ah6-bg">${ahNoise(.5)}</div>`,
      photo: () => `<i class="vm-photo ah6-snow">${ahNoise(.9)}</i>`,
      deco: () => `<div class="vm-deco ah-clip">${ahNoise(.1)}</div>`,
      sub: () => '<span class="ah6-red">█████</span> · <span class="ah6-red">███</span> · ██:██',
    }),
  ],
};

// ================================================================ RGB (prefiks rgb-)

// klawisze w rzędzie (np. W A S D)
const rgbKeys = keys => `<div class="rgb2-keys">${[...keys].map((k, i) => `<b style="animation-delay:-${i * .25}s">${k}</b>`).join("")}</div>`;
// diody wokół krawędzi karty: n punktów po obwodzie
function rgbLeds(n = 34) {
  const pts = [], per = 2 * (63 + 88);
  for (let k = 0; k < n; k++) {
    let d = k / n * per, x, y;
    if (d < 63) { x = d; y = 0; } else if ((d -= 63) < 88) { x = 63; y = d; } else if ((d -= 88) < 63) { x = 63 - d; y = 88; } else { x = 0; y = 88 - (d - 63); }
    pts.push(`<i class="rgb4-led" style="left:${(x / 63 * 100).toFixed(1)}%;top:${(y / 88 * 100).toFixed(1)}%;animation-delay:-${(k / n * 3).toFixed(2)}s"></i>`);
  }
  return pts.join("");
}
const rgbFan = () => '<i class="rgb3-fan"><b></b></i>';

const VM_RGB = {
  key: "rgb", icon: "🌈", name: "Gamingowa RGB", tag: "🌈 RGB",
  about: "jak sprzęt gamingowy: wszystko świeci i przelewa się kolorami tęczy (klawiatury, obudowy z wentylatorami, paski LED, HUD)",
  looks: [
    X({
      name: "Ramka spektrum",
      desc: "Czarna karta z włókna węglowego, ramka mieni się wszystkimi kolorami i płynnie zmienia odcień, nazwa i panele mają neonową poświatę w tym samym kolorze co ramka.",
      bg: () => '<div class="vm-bg rgb1-bg"></div>',
      sub: () => "RGB SYNC · TRYB: SPEKTRUM",
    }),
    X({
      name: "Mechaniczna klawiatura",
      desc: "Panele karty jak klawisze klawiatury mechanicznej z kolorowym podświetleniem pod spodem, nad nazwą rząd klawiszy W A S D, po których przechodzi fala kolorów, tło z aluminiowej płytki.",
      top: () => rgbKeys("WASD"),
      bg: () => '<div class="vm-bg rgb2-bg"><i class="rgb2-wave"></i></div>',
      sub: () => "SWITCH RED · 1000 Hz",
    }),
    X({
      name: "Wnętrze obudowy",
      desc: "Szklany bok komputera: nad nazwą trzy wentylatory z obracającymi się kolorowymi pierścieniami, zdjęcie za szybą z odbiciem, ciemne wnętrze z poświatą RGB od spodu.",
      top: () => `<div class="rgb3-fans">${rgbFan()}${rgbFan()}${rgbFan()}</div>`,
      bg: () => '<div class="vm-bg rgb3-bg"></div>',
      photo: () => '<i class="vm-photo rgb3-glass"></i>',
      sub: () => "CHŁODZENIE WODNE · 3×120 MM",
    }),
    X({
      name: "Pasek LED",
      desc: "Dookoła karty biegnie pasek diod, po którym goni się tęcza, środek ciemny i matowy, cienka kolorowa obwódka przy zdjęciu i panelach.",
      bg: () => '<div class="vm-bg rgb4-bg"></div>',
      deco: () => `<div class="vm-deco">${rgbLeds()}</div>`,
      sub: () => "ADRESOWALNE LED · 5 V",
    }),
    X({
      name: "HUD e-sportu",
      desc: "Nakładka z transmisji turnieju: na zdjęciu celownik, licznik „240 FPS / PING 3 ms” i napis „ULTRA KILL ×5”, nad nazwą „● LIVE · RANKED”, panele ścięte w rogach z przesuwającą się tęczową linią.",
      top: () => '<div class="rgb5-live"><b>● LIVE</b><span>RANKED · MAPA 3</span></div>',
      bg: () => '<div class="vm-bg rgb5-bg"></div>',
      photo: () => '<i class="vm-photo rgb5-cross"></i><span class="rgb5-fps">240 FPS<br>PING 3 ms</span><span class="rgb5-kill">ULTRA KILL ×5</span>',
      sub: () => "MVP MECZU · K/D 27/2",
    }),
    X({
      name: "Podkładka pod mysz",
      desc: "Wielka podkładka z gumowaną fakturą: krawędź świeci kolorami od środka karty, w tle duże „GG”, zdjęcie z cienką świecącą ramką, napisy jak na pudełku myszki.",
      bg: () => '<div class="vm-bg rgb6-bg"><b class="rgb6-gg">GG</b></div>',
      sub: () => "DPI 16000 · 8 PRZYCISKÓW",
    }),
  ],
};

// ================================================================ BARBIE (prefiks bb-)

const bbHearts = n => vmScatter(n, "bb-heart", () => `--s:${vmN(.6, 1.4, 2)};animation-duration:${vmN(3, 6, 1)}s`);
const bbGlitter = n => vmScatter(n, "bb-glit", () => `--s:${vmN(.4, 1.2, 2)};animation-duration:${vmN(1.2, 2.6, 1)}s`);
// sznur pereł (łuk pod nazwą)
const bbPearls = () => vmSvg(Array.from({ length: 19 }, (_, k) => {
  const t = k / 18, x = 6 + t * 51, y = 2 + Math.sin(t * Math.PI) * 4;
  return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.25" fill="url(#bbPearl)"/>`;
}).join("") + '<defs><radialGradient id="bbPearl" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#f6e6ee"/><stop offset="1" stop-color="#c9a7b8"/></radialGradient></defs>', "0 0 63 8", "bb5-pearls");
// pióra boa: puszyste kółka wzdłuż krawędzi
const bbBoa = () => Array.from({ length: 46 }, (_, k) => {
  const per = 2 * (63 + 88); let d = k / 46 * per, x, y;
  if (d < 63) { x = d; y = 0; } else if ((d -= 63) < 88) { x = 63; y = d; } else if ((d -= 88) < 63) { x = 63 - d; y = 88; } else { x = 0; y = 88 - (d - 63); }
  return `<i class="bb5-fluff" style="left:${(x / 63 * 100).toFixed(1)}%;top:${(y / 88 * 100).toFixed(1)}%;--s:${vmN(.8, 1.3, 2)};animation-delay:-${vmN(0, 4, 1)}s"></i>`;
}).join("");

const VM_BARBIE = {
  key: "barbie", icon: "💖", name: "Barbie", tag: "💖 BARBIE",
  about: "przesadnie dziewczęca: róż, brokat, serduszka i plastik. Wariant będzie mógł mieć własne zdjęcie karty (wgrywane w edycji karty, jak Anime), bez niego zwykłe",
  looks: [
    X({
      name: "Pudełko z lalką",
      desc: "Różowe kartonowe pudełko: ukośne paski w tle, zdjęcie za plastikowym okienkiem z odblaskiem, nazwa grubym zaokrąglonym pismem w bieli z różowym obrysem, nad nią „✦ KOLEKCJA LIMITOWANA ✦”, podpis drobnym drukiem „akcesoria sprzedawane osobno”.",
      top: () => '<div class="bb1-top">✦ KOLEKCJA LIMITOWANA ✦</div>',
      bg: () => '<div class="vm-bg bb1-bg"></div>',
      photo: () => '<i class="vm-photo bb1-window"></i>',
      sub: () => "akcesoria sprzedawane osobno",
    }),
    X({
      name: "Cała w brokacie",
      desc: "Wszystko pokryte różowym brokatem, który mieni się i migocze, po karcie unoszą się serduszka, zdjęcie w obwódce z brokatu, napisy błyszczące jak lakier do paznokci.",
      bg: () => `<div class="vm-bg bb2-bg">${bbGlitter(40)}${bbHearts(12)}</div>`,
      photo: () => `<i class="vm-photo bb2-rim"></i>`,
      sub: () => "✨ 100% BROKATU ✨",
    }),
    X({
      name: "Dom marzeń",
      desc: "Pastelowe niebo z puchatymi chmurkami w kształcie serc, zdjęcie w różowym okienku z okiennicami, panele jak różowe ściany domku z białym wykończeniem, podpis „DOM MARZEŃ · 3 PIĘTRA · BASEN”.",
      bg: () => '<div class="vm-bg bb3-bg"><i class="bb3-cloud a"></i><i class="bb3-cloud b"></i><i class="bb3-cloud c"></i></div>',
      photo: () => '<i class="vm-photo bb3-shutters"></i>',
      sub: () => "DOM MARZEŃ · 3 PIĘTRA · BASEN",
    }),
    X({
      name: "Malibu '86",
      desc: "Zachód słońca w różu i pomarańczu: słońce w paski za zdjęciem, sylwetki palm w rogach, nazwa pochyłym pismem retro, panele z neonowym różowym brzegiem.",
      bg: () => '<div class="vm-bg bb4-bg"><i class="bb4-sun"></i><i class="bb4-palm l"></i><i class="bb4-palm r"></i></div>',
      sub: () => "MALIBU ☀ LATO '86",
    }),
    X({
      name: "Diwa w piórach",
      desc: "Ramka z puchatego różowego boa z piór, które lekko falują, pod nazwą sznur pereł, ciemny róż w środku i błysk diamentu w rogu zdjęcia, nazwa złotym eleganckim pismem.",
      top: () => bbPearls(),
      bg: () => '<div class="vm-bg bb5-bg"></div>',
      photo: () => '<i class="bb5-diamond">✦</i>',
      deco: () => `<div class="vm-deco">${bbBoa()}</div>`,
      sub: () => "GWIAZDA WIECZORU",
    }),
    X({
      name: "Holograficzny plastik",
      desc: "Błyszczący plastik mieniący się różem, liliowym i błękitem jak naklejki holo, panele jak wypukłe cukierkowe przyciski z odblaskiem, ramka jak różowa plastikowa obudowa.",
      bg: () => '<div class="vm-bg bb6-bg"><i class="bb6-holo"></i></div>',
      photo: () => '<i class="vm-photo bb6-gloss"></i>',
      sub: () => "♡ PLASTIK FANTASTIK ♡",
    }),
  ],
};

// ================================================================ HAWAJSKA (prefiks hi-; hw- zajęte przez Halloween)

// kwiat hibiskusa (środek x, y, promień r)
const hiFlower = (x, y, r, c, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot})">${Array.from({ length: 5 }, (_, k) =>
  `<ellipse cx="0" cy="${(-r * .55).toFixed(2)}" rx="${(r * .42).toFixed(2)}" ry="${(r * .6).toFixed(2)}" fill="${c}" transform="rotate(${k * 72})"/>`).join("")}
  <circle r="${(r * .22).toFixed(2)}" fill="#ffe14d"/><path d="M0 0 L${(r * .15).toFixed(2)} ${(-r * .7).toFixed(2)}" stroke="#ffe14d" stroke-width="${(r * .08).toFixed(2)}"/></g>`;
// naszyjnik lei: kwiaty wzdłuż łuku (y0 - wysokość końców, dip - jak nisko w środku)
const hiLei = (y0 = 4, dip = 16, cls = "hi-lei") => vmSvg(Array.from({ length: 17 }, (_, k) => {
  const t = k / 16, x = 4 + t * 55, y = y0 + Math.sin(t * Math.PI) * dip;
  return hiFlower(x.toFixed(2), y.toFixed(2), 3.4, vmPick(["#ff4f8b", "#ff7a3d", "#ffd23d", "#c86bff", "#ff4f8b"]), vmN(0, 72));
}).join(""), `0 0 63 ${y0 + dip + 4}`, cls, "xMidYMax meet");
// palma (sylwetka)
const hiPalm = (cls, col = "#1d1030") => vmSvg(`<path d="M30 88 C31 70 29 52 33 34" stroke="${col}" stroke-width="2.4" fill="none"/>
  ${[[-38, 10], [-14, 13], [10, 12], [35, 10], [60, 8]].map(([a, l]) => `<path d="M33 34 q${(Math.cos((a - 90) * Math.PI / 180) * l * .5).toFixed(1)} ${(Math.sin((a - 90) * Math.PI / 180) * l * .5 - 6).toFixed(1)} ${(Math.cos((a - 90) * Math.PI / 180) * l * 1.6).toFixed(1)} ${(Math.sin((a - 90) * Math.PI / 180) * l + 10).toFixed(1)}" stroke="${col}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`).join("")}`, "0 0 63 88", cls, "xMidYMax meet");

const VM_HAWAII = {
  key: "hawaii", icon: "🌺", name: "Hawajska", tag: "🌺 ALOHA",
  about: "aloha: hibiskusy, laguna, palmy i surfing. Wariant z naklejkami od admina (jak MLG) i wbudowanymi grafikami: naszyjnik lei (do zawieszenia na szyi na zdjęciu), hibiskus, ananas, ukulele, deska surfingowa, maska tiki, kokos z parasolką",
  looks: [
    X({
      name: "Lei i laguna",
      desc: "Turkusowa laguna z falującym światłem, na dole zdjęcia wisi kolorowy naszyjnik lei z kwiatów (jak naklejka zawieszona na szyi), w rogach karty duże hibiskusy, panele jak jasny piasek.",
      bg: () => `<div class="vm-bg hi1-bg"><i class="hi1-ripple"></i>${vmSvg(hiFlower(4, 8, 9, "#ff4f8b", 10) + hiFlower(60, 82, 9, "#ff7a3d", 40), "0 0 63 88", "hi1-corner")}</div>`,
      photo: () => hiLei(1, 8, "hi-lei hi1-lei"),
      sub: () => "ALOHA · MAHALO",
    }),
    X({
      name: "Koszula aloha",
      desc: "Tło jak materiał hawajskiej koszuli: czerwony z białymi hibiskusami i zielonymi liśćmi palm, ramka z tego samego wzoru, panele w kremowym kolorze z guzikami z kokosa po bokach.",
      bg: () => `<div class="vm-bg hi2-bg">${vmSvg(Array.from({ length: 14 }, () => hiFlower(vmN(0, 63), vmN(0, 88), vmN(4, 7), "#fff3e0", vmN(0, 72))).join(""), "0 0 63 88", "hi2-print")}</div>`,
      sub: () => "100% BAWEŁNY · HONOLULU",
    }),
    X({
      name: "Zachód na plaży",
      desc: "Pomarańczowo-różowe niebo z zachodzącym słońcem, czarne sylwetki palm po bokach, na dole morze z migoczącymi refleksami, zdjęcie w ciepłych kolorach, napisy w kolorze zachodu.",
      bg: () => `<div class="vm-bg hi3-bg"><i class="hi3-sun"></i><i class="hi3-sea"></i>${hiPalm("hi3-palm l")}${hiPalm("hi3-palm r")}</div>`,
      sub: () => "WAIKIKI · 19:42",
    }),
    X({
      name: "Tiki bar",
      desc: "Ramka z bambusa, w środku ciemne rzeźbione drewno, nad nazwą dwie płonące pochodnie tiki, nazwa pismem jak z szyldu baru, panele jak deski z wypalonym wzorem.",
      top: () => '<div class="hi4-torches"><i></i><i></i></div>',
      bg: () => '<div class="vm-bg hi4-bg"></div>',
      sub: () => "MAI TAI · OTWARTE DO ŚWITU",
    }),
    X({
      name: "Wielka fala",
      desc: "Niebieska fala zawija się za zdjęciem, z piany pryskają krople, ramka w pasy jak deska surfingowa, panele białe jak piana.",
      bg: () => `<div class="vm-bg hi5-bg">${vmSvg('<path d="M-5 70 C10 40 40 20 62 30 C50 28 42 40 50 52 C56 60 66 56 70 50 L70 92 L-5 92Z" fill="#1576c9"/><path d="M-5 76 C12 52 38 36 58 44 C48 46 46 56 54 62 C60 66 68 62 70 58 L70 92 L-5 92Z" fill="#2fa6e8"/><path d="M62 30 C50 28 42 40 50 52" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>', "0 0 63 88", "hi5-wave")}${vmScatter(14, "hi5-drop", () => "", [20, 70])}</div>`,
      sub: () => "NORTH SHORE · FALA 8 M",
    }),
    X({
      name: "Pocztówka",
      desc: "Stara pocztówka: kremowy papier, nad nazwą wielkie litery „ALOHA” z kolorowym wypełnieniem, w rogu zdjęcia znaczek z hibiskusem i okrągły stempel pocztowy, kolory lekko wyblakłe.",
      top: () => '<div class="hi6-aloha">ALOHA</div>',
      bg: () => '<div class="vm-bg hi6-bg"></div>',
      photo: () => `<i class="hi6-stamp">${vmSvg(hiFlower(10, 11, 7, "#ff4f8b", 20), "0 0 20 24")}</i><i class="hi6-post">HONOLULU<br>1962</i>`,
      sub: () => "POZDROWIENIA Z HAWAJÓW",
    }),
  ],
};

// ================================================================ TABLOID (prefiks tb-) - pomysł własny

const VM_TABLOID = {
  key: "tabloid", icon: "📰", name: "Tabloid", tag: "📰 SZOK!",
  about: "pomysł własny: karta jak brukowiec i plotkarski portal - nagłówki SZOK, paparazzi, clickbait. Pasuje do kart znanych osób",
  looks: [
    X({
      name: "Pierwsza strona",
      desc: "Pierwsza strona brukowca: czerwona winieta „SZOK DNIA” nad nazwą, papier gazetowy, na zdjęciu żółte kółko i strzałka „TO ON!”, podpis jak wielki nagłówek „TAJEMNICA WYSZŁA NA JAW!”.",
      top: () => '<div class="tb1-mast"><b>SZOK</b><span>DNIA</span><small>NR 666 · CENA 2,50 ZŁ</small></div>',
      bg: () => '<div class="vm-bg tb1-bg"></div>',
      photo: () => vmSvg('<circle cx="40" cy="15" r="9" fill="none" stroke="#ffd400" stroke-width="1.4"/><path d="M12 32 L30 21" stroke="#ffd400" stroke-width="1.4"/><path d="M30 21 l-4 .4 l2.6 2.8z" fill="#ffd400"/>', "0 0 63 40", "vm-photo") + '<span class="tb1-him">TO ON!</span>',
      sub: () => "TAJEMNICA WYSZŁA NA JAW!",
    }),
    X({
      name: "Paparazzi",
      desc: "Nocne zdjęcie z teleobiektywu: ziarniste, rozmyte na brzegach, co chwilę błyskają flesze, w rogu „FOT. NASZ REPORTER”, podpis „PRZYŁAPANY NA ZAKUPACH!”.",
      bg: () => '<div class="vm-bg tb2-bg"></div>',
      photo: () => `<i class="vm-photo tb2-lens"></i>${vmScatter(5, "tb2-flash", () => `animation-duration:${vmN(2, 4, 1)}s`)}<span class="tb2-credit">FOT. NASZ REPORTER</span>`,
      sub: () => "PRZYŁAPANY NA ZAKUPACH!",
    }),
    X({
      name: "Clickbait",
      desc: "Plotkarski portal w telefonie: biała strona, nad nazwą „NIE UWIERZYSZ, CO ZROBIŁ! (WIDEO)”, na zdjęciu przycisk odtwarzania, czerwona strzałka i licznik „👁 2,1 mln”, pod spodem pasek wideo.",
      top: () => '<div class="tb3-head">NIE UWIERZYSZ, CO ZROBIŁ! <b>(WIDEO)</b></div>',
      bg: () => '<div class="vm-bg tb3-bg"></div>',
      photo: () => '<i class="tb3-play"></i><span class="tb3-views">👁 2,1 mln</span><i class="tb3-bar"><b></b></i>',
      sub: () => "KLIKNIJ, ZANIM TO USUNĄ",
    }),
    X({
      name: "Okładka magazynu",
      desc: "Błyszcząca okładka kolorowego pisma: wielki tytuł „GWIAZDY” za głową na zdjęciu, po boku zapowiedzi „ŚLUB? ROZWÓD? WSZYSTKO, CO WIEMY”, w rogu cena i kod kreskowy, połysk przesuwa się po karcie.",
      bg: () => '<div class="vm-bg tb4-bg"><i class="tb4-shine"></i></div>',
      photo: () => '<span class="tb4-title">GWIAZDY</span><span class="tb4-lines">ŚLUB?<br>ROZWÓD?<br><b>WSZYSTKO,<br>CO WIEMY</b></span><span class="tb4-price">3,99 zł</span>',
      sub: () => "WYDANIE SPECJALNE",
    }),
    X({
      name: "Wycinek z gazety",
      desc: "Wycięty nożyczkami artykuł na szarym papierze gazetowym: postrzępione brzegi, czarno-białe zdjęcie z rastra kropek, czerwony marker zakreślił nazwisko i dopisał „!!!”.",
      bg: () => '<div class="vm-bg tb5-bg"></div>',
      photo: () => '<i class="vm-photo tb5-dots"></i>',
      deco: () => '<div class="vm-deco"><span class="tb5-marker">!!!</span></div>',
      sub: () => "„NIKT SIĘ TEGO NIE SPODZIEWAŁ”",
    }),
    X({
      name: "Pilne",
      desc: "Wiadomości telewizyjne: granatowe studio, czerwony pasek „PILNE” nad nazwą, na zdjęciu „NA ŻYWO” i zegar, pod nazwą przewija się pasek z informacjami.",
      top: () => '<div class="tb6-bar"><b>PILNE</b><span><i>Nowe fakty w sprawie karty · Eksperci zaskoczeni · Ceny na rynku szaleją · Oświadczenie rzecznika o 18:00 · </i></span></div>',
      bg: () => '<div class="vm-bg tb6-bg"></div>',
      photo: () => '<span class="tb6-live">● NA ŻYWO</span><span class="tb6-clock">21:37</span>',
      sub: () => "SERWIS INFORMACYJNY",
    }),
  ],
};

// ================================================================ LODOWA (prefiks ic-) - pomysł własny

// sople wzdłuż górnej krawędzi
const icIcicles = () => vmSvg(Array.from({ length: 16 }, (_, k) => {
  const x = k * 4 + rand(0, 1.5), w = rand(1.6, 3), h = rand(4, 13);
  return `<path d="M${x.toFixed(2)} 0 L${(x + w).toFixed(2)} 0 L${(x + w / 2).toFixed(2)} ${h.toFixed(2)}Z" fill="url(#icG)"/>`;
}).join("") + '<defs><linearGradient id="icG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8fbff"/><stop offset="1" stop-color="#9fdcff" stop-opacity=".2"/></linearGradient></defs>', "0 0 63 16", "ic4-icicles", "none");
// pęknięcia lodu
const icCracks = () => vmSvg(Array.from({ length: 5 }, () => {
  let x = rand(5, 58), y = rand(4, 36), d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
  for (let k = 0; k < 4; k++) { x += rand(-8, 8); y += rand(-6, 6); d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
  return `<path d="${d}" stroke="#fff" stroke-width=".35" fill="none" opacity=".8"/>`;
}).join(""), "0 0 63 40", "vm-photo ic2-cracks");
// fasety kryształu (trójkąty w różnych odcieniach)
const icFacets = () => vmSvg(Array.from({ length: 34 }, () => {
  const x = rand(-5, 63), y = rand(-5, 88), s = rand(8, 18);
  return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} l${s.toFixed(1)} ${rand(-4, 4).toFixed(1)} l${rand(-6, 6).toFixed(1)} ${s.toFixed(1)}Z" fill="${vmPick(["#dff6ff", "#b9e6ff", "#8fd0ff", "#eefcff", "#c9d8ff"])}" opacity="${vmN(.25, .7, 2)}"/>`;
}).join(""), "0 0 63 88", "ic6-facets");

const VM_FROST = {
  key: "frost", icon: "❄️", name: "Lodowa", tag: "❄️ LÓD",
  about: "pomysł własny: szron, lód i zima - zamrożone zdjęcie, sople, zorza polarna, śnieżyca",
  looks: [
    X({
      name: "Szron",
      desc: "Szron narasta z rogów karty jak paprotki na zimowej szybie, lodowato błękitne tło, zdjęcie lekko oszronione przy brzegach, napisy jak wydrapane w lodzie.",
      bg: () => '<div class="vm-bg ic1-bg"><i class="ic1-frost a"></i><i class="ic1-frost b"></i></div>',
      photo: () => '<i class="vm-photo ic1-rim"></i>',
      sub: () => "−21°C · ODCZUWALNA −30°C",
    }),
    X({
      name: "Zamrożony",
      desc: "Zdjęcie zatopione w bryle lodu: niebieskawy odcień, pęknięcia i pęcherzyki powietrza, odblask na tafli, panele jak kostki lodu z zaokrąglonymi brzegami.",
      bg: () => '<div class="vm-bg ic2-bg"></div>',
      photo: () => `${icCracks()}<i class="vm-photo ic2-ice"></i>${vmScatter(8, "ic2-bubble", () => `--s:${vmN(.5, 1.3, 2)}`)}`,
      sub: () => "ZAMROŻONY OD 1987",
    }),
    X({
      name: "Zorza polarna",
      desc: "Nocne niebo z falującymi wstęgami zielono-fioletowej zorzy za zdjęciem, ośnieżone wzgórza na dole, gwiazdy, napisy z zielonkawą poświatą.",
      bg: () => `<div class="vm-bg ic3-bg">${vmScatter(14, "ic3-star", () => "", [2, 60])}<i class="ic3-aurora a"></i><i class="ic3-aurora b"></i><i class="ic3-hills"></i></div>`,
      sub: () => "LAPONIA · 69°N",
    }),
    X({
      name: "Sople",
      desc: "Z górnej krawędzi karty zwisają sople, z których co jakiś czas spada kropla, ramka pokryta śniegiem, granatowo-błękitne tło.",
      bg: () => '<div class="vm-bg ic4-bg"></div>',
      deco: () => `<div class="vm-deco ic-clip">${icIcicles()}${vmScatter(4, "ic4-drip", () => `animation-duration:${vmN(2.5, 4.5, 1)}s`, [8, 10])}<i class="ic4-snow"></i></div>`,
      sub: () => "ODWILŻ NIE NADEJDZIE",
    }),
    X({
      name: "Śnieżyca",
      desc: "Gęsty śnieg pada przez całą kartę, mgła przy dole, zdjęcie lekko zamglone, białe panele jak zaspy.",
      bg: () => '<div class="vm-bg ic5-bg"><i class="ic5-fog"></i></div>',
      deco: () => `<div class="vm-deco ic-clip">${vmScatter(36, "ic5-flake", () => `--s:${vmN(.4, 1.2, 2)};animation-duration:${vmN(4, 9, 1)}s;--dx:${vmN(-12, 12)}cqw`, [-10, 0])}</div>`,
      sub: () => "ALERT POGODOWY · 3. STOPIEŃ",
    }),
    X({
      name: "Lodowy kryształ",
      desc: "Tło z ostrych fasetek lodu jak oszlifowany kryształ, przez które przechodzi tęczowy błysk pryzmatu, ramka w lodowym gradiencie, zdjęcie w cienkiej szklanej oprawie.",
      bg: () => `<div class="vm-bg ic6-bg">${icFacets()}<i class="ic6-prism"></i></div>`,
      sub: () => "KRYSZTAŁ CZYSTOŚCI 99,9%",
    }),
  ],
};

// ---------------------------------------------------------------- PROPOZYCJE

export const VARIANT_PROPOSALS = [VM_ANALOG, VM_RGB, VM_BARBIE, VM_HAWAII, VM_TABLOID, VM_FROST];
