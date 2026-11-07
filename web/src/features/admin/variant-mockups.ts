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
const vmSvg = (body, vb = "0 0 63 88", cls = "", par = "none") =>
  `<svg class="${cls}" viewBox="${vb}" preserveAspectRatio="${par}" aria-hidden="true">${body}</svg>`;
// makieta z panelami ze zmiennych --x-*
const X = o => ({ ...o, cls: `vmx${o.cls ? " " + o.cls : ""}` });

// ================================================================ ANALOG HORROR (prefiks ah-) - wersja do akceptacji
// Na bazie makiety „Sekwencja nadawania”: w miejscu zdjęcia zapętlony program (12 s) - godło urzędu, zdjęcie, komunikat o schronie.
// Te same zakłócenia na każdej planszy: rwące się paski (kopie planszy przycięte do pasków), rozjechane kolory, toczący się pas,
// linie obrazu, ziarno, szarpnięcia i błyski szumu między planszami. Za kartą obraca się godło (jak w makiecie „Godło w tle”).
// W prawdziwym wariancie napis na zdjęciu i podpis wpisuje się w panelu dla każdej karty; wariant z własnym zdjęciem.

const AH_WARN = "NIE PATRZ W NIEBO", AH_SUB = "TO NIE JEST ĆWICZENIE";
const ahNoise = (op = .35) => `<i class="ah-noise" style="opacity:${op}"></i>`;
// godło „urzędu”: pieczęć, w środku skrzynka ScamBox, napis dookoła
const ahSeal = (cls = "ah-seal") => vmSvg(`
  <defs><path id="ahRing" d="M50 50 m-37 0 a37 37 0 1 1 74 0 a37 37 0 1 1 -74 0"/></defs>
  <circle cx="50" cy="50" r="47" fill="#0a1550" stroke="#dfe6ff" stroke-width="2.4"/>
  <circle cx="50" cy="50" r="30" fill="none" stroke="#dfe6ff" stroke-width="1.2"/>
  <text font-size="8.2" font-family="Share Tech Mono, monospace" fill="#dfe6ff" letter-spacing="1.2"><textPath href="#ahRing">URZĄD OBRONY CYWILNEJ ✦ SCAMBOX ✦ </textPath></text>
  <path d="M33 44 L50 35 L67 44 L67 64 L50 72 L33 64Z" fill="none" stroke="#dfe6ff" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M33 44 L50 53 L67 44 M50 53 V72" fill="none" stroke="#dfe6ff" stroke-width="2.2" stroke-linejoin="round"/>
  <rect x="45" y="49" width="10" height="7" rx="1.5" fill="#dfe6ff"/>`, "0 0 100 100", cls, "xMidYMid meet");
// znak schronu w barwach planszy: białe koło z trzema granatowymi trójkątami
const ahShelterSign = () => vmSvg(`<circle cx="20" cy="20" r="19" fill="#dfe6ff"/>
  ${[0, 120, 240].map(a => `<path d="M20 20 L13 7.5 A14.5 14.5 0 0 1 27 7.5Z" fill="#0a1550" transform="rotate(${a} 20 20)"/>`).join("")}
  <circle cx="20" cy="20" r="4.2" fill="#dfe6ff"/><circle cx="20" cy="20" r="19" fill="none" stroke="#0a1550" stroke-width="1.2"/>`, "0 0 40 40", "ah-sign", "xMidYMid meet");
// rwące się paski: kopie planszy (html) przycięte do wąskich pasków, co chwilę przeskakują w bok
const ahTears = (html, n = 3) => Array.from({ length: n }, () =>
  `<i class="ah-tear" style="--y:${vmN(6, 82)}%;--h:${vmN(3, 9)}%;animation-delay:-${vmN(0, 4, 1)}s;animation-duration:${vmN(2.2, 4.2, 1)}s">${html}</i>`).join("");
// plansze sekwencji (ta sama treść w kopii do pasków)
const AH_LOGO = `<i class="ah-face">${ahSeal()}<b>PROSIMY CZEKAĆ</b></i>`;
const AH_SHELTER = `<i class="ah-face shelter">${ahShelterSign()}<b>UDAJ SIĘ DO<br>NAJBLIŻSZEGO SCHRONU</b><small>ZACHOWAJ SPOKÓJ · ZABIERZ DOKUMENTY</small></i>`;

const VM_ANALOG = {
  key: "analog", icon: "📼", name: "Analog horror", tag: "📼 ANALOG",
  about: "wersja do akceptacji: sekwencja nadawania z zakłóceniami na każdej planszy, godło w tle. Napis na zdjęciu i podpis wpisywane w panelu dla każdej karty, własne zdjęcie wariantu",
  looks: [
    X({
      name: "Sekwencja nadawania",
      desc: "Pętla 12 s w miejscu zdjęcia: godło „URZĄD OBRONY CYWILNEJ · SCAMBOX” z napisem „PROSIMY CZEKAĆ”, błysk szumu, czarno-białe zdjęcie z migającym napisem, szum, niebiesko-biała plansza „UDAJ SIĘ DO NAJBLIŻSZEGO SCHRONU” ze znakiem schronu. Na każdej planszy te same zakłócenia: rwące się paski, rozjechane kolory, toczący się pas, linie obrazu, ziarno i szarpnięcia obrazu. W tle karty powoli obraca się duże godło.",
      top: () => '<div class="ah-bar"><b>⚠ KOMUNIKAT ALARMOWY</b><span>NADAWANY O 03:00</span></div>',
      bg: () => `<div class="vm-bg ah-navy">${ahSeal("ah-seal ah-spin")}<i class="ah-scan"></i>${ahNoise(.08)}</div>`,
      photo: p => {
        const img = `<img src="${imgUrl(p.id, "normal")}" alt="">`;
        return `<i class="ah-chroma r">${img}</i><i class="ah-chroma c">${img}</i>
          <i class="ah-phase ah-ph-photo">${ahTears(img, 3)}<span class="ah-warn">${AH_WARN}</span></i>
          <i class="ah-phase ah-ph-logo">${AH_LOGO}${ahTears(AH_LOGO, 3)}</i>
          <i class="ah-phase ah-ph-shelter">${AH_SHELTER}${ahTears(AH_SHELTER, 3)}</i>
          <i class="ah-scan top"></i><i class="ah-roll"></i><i class="ah-grain">${ahNoise(.16)}</i><i class="ah-burst">${ahNoise(1)}</i>`;
      },
      sub: () => AH_SUB,
    }),
  ],
};

// ================================================================ POLAROID (prefiks pl-; pl- nie koliduje: perłowa to pl-nacre/pl-sheen w grze)
// Karta to biała ramka zdjęcia natychmiastowego, zdjęcie z filtrem jak z tych odbitek (wyblakłe czernie, ciepłe światła,
// chłodne cienie, winieta, przebarwienia), podpis pisany flamastrem na dolnym marginesie.

const plLeak = cls => `<i class="vm-photo pl-leak ${cls}"></i>`;
const plTape = (cls) => `<i class="pl-tape ${cls}"></i>`;

const VM_POLAROID = {
  key: "polaroid", icon: "📸", name: "Polaroid", tag: "📸 POLAROID",
  about: "zdjęcie natychmiastowe: biała ramka z szerszym dołem, zdjęcie z filtrem jak z odbitki (wyblakłe, ciepłe, winieta), podpis flamastrem",
  looks: [
    X({
      name: "Klasyczna odbitka",
      desc: "Kremowobiała ramka jak z odbitki, zdjęcie z typowym filtrem: wyblakłe czernie, ciepłe jasne partie, lekko zielonkawe cienie, winieta i smuga światła z boku, podpis flamastrem „wakacje '98 ♡”, panele jak drobne dopiski ołówkiem.",
      bg: () => '<div class="vm-bg pl-paper"></div>',
      photo: () => `<i class="vm-photo pl-tone"></i>${plLeak("r")}<i class="vm-photo pl-vig"></i>`,
      sub: () => '<span class="pl-hand">wakacje \'98 ♡</span>',
    }),
    X({
      name: "Wywoływanie",
      desc: "Zdjęcie wywołuje się na oczach gracza (pętla 10 s): najpierw ciemne, brązowo-zielone i puste, powoli wyłaniają się kolory, aż do pełnej odbitki, potem znowu od początku. Podpis „potrząśnij mną!”.",
      bg: () => '<div class="vm-bg pl-paper"></div>',
      photo: () => '<i class="vm-photo pl-tone"></i><i class="vm-photo pl-develop"></i><i class="vm-photo pl-vig"></i>',
      sub: () => '<span class="pl-hand">potrząśnij mną!</span>',
    }),
    X({
      name: "Przyklejona taśmą",
      desc: "Odbitka lekko przekrzywiona, przyklejona dwoma kawałkami taśmy klejącej w rogach, na ramce dorysowane flamastrem serduszka i gwiazdki, podpis „najlepszy dzień!!!”.",
      bg: () => '<div class="vm-bg pl-paper"></div>',
      photo: () => `<i class="vm-photo pl-tone"></i>${plLeak("l")}<i class="vm-photo pl-vig"></i>`,
      deco: () => `<div class="vm-deco">${plTape("tl")}${plTape("tr")}<span class="pl-doodle a">♡</span><span class="pl-doodle b">✦</span><span class="pl-doodle c">☆</span></div>`,
      sub: () => '<span class="pl-hand">najlepszy dzień!!!</span>',
    }),
    X({
      name: "Na lodówce",
      desc: "Odbitka przyczepiona okrągłym kolorowym magnesem u góry, lekko kołysze się jak po zamknięciu drzwi lodówki, cień pod spodem, ramka trochę pożółkła, podpis „ciocia Halinka 2004”.",
      bg: () => '<div class="vm-bg pl-paper aged"></div>',
      photo: () => `<i class="vm-photo pl-tone warm"></i><i class="vm-photo pl-vig"></i>`,
      deco: () => '<div class="vm-deco"><i class="pl-magnet"></i></div>',
      sub: () => '<span class="pl-hand">ciocia Halinka 2004</span>',
      cls: "pl-sway",
    }),
    X({
      name: "Wyblakła z lat 70.",
      desc: "Stara, mocno wyblakła odbitka: kolory przesunięte w magentę i cyjan, pożółkła ramka z plamami i zagiętym rogiem, rysy na zdjęciu, podpis wyblakłym długopisem „lato 1976”.",
      bg: () => '<div class="vm-bg pl-paper old"><i class="pl-stain a"></i><i class="pl-stain b"></i></div>',
      photo: () => '<i class="vm-photo pl-tone old"></i><i class="vm-photo pl-scratch"></i><i class="vm-photo pl-vig strong"></i>',
      deco: () => '<div class="vm-deco"><i class="pl-dogear"></i></div>',
      sub: () => '<span class="pl-hand old">lato 1976</span>',
    }),
    X({
      name: "Kolorowa ramka",
      desc: "Ramka w pastelowym kolorze (miętowa), zdjęcie jasne i nasycone jak z nowoczesnego aparatu natychmiastowego, w rogu zdjęcia pomarańczowa data jak z aparatu „’26 11 07”, podpis „#ScamBox”.",
      bg: () => '<div class="vm-bg pl-mint"></div>',
      photo: () => '<i class="vm-photo pl-tone bright"></i><span class="pl-date">’26 11 07</span><i class="vm-photo pl-vig soft"></i>',
      sub: () => '<span class="pl-hand">#ScamBox</span>',
    }),
  ],
};

// ================================================================ WIZYTÓWKA (prefiks wz-)
// Karta jak wizytówka: papier (len, bawełna, czerń z folią), elegancka typografia, stanowisko w podtytule, dane kontaktowe.

const wzContact = (a = "tel. 213 742 069", b = "kontakt@scambox.pl", c = "www.scambox.pl") =>
  `<span class="wz-contact"><b>${a}</b><b>${b}</b><b>${c}</b></span>`;

const VM_CARD = {
  key: "wizytowka", icon: "💼", name: "Wizytówka", tag: "💼 WIZYTÓWKA",
  about: "karta jak wizytówka: dobry papier, elegancka typografia, stanowisko i dane kontaktowe (wymyślone, z domeną gry)",
  looks: [
    X({
      name: "Klasyczna biała",
      desc: "Biały papier z fakturą lnu, cienka czarna linia dookoła, nazwa wersalikami szeryfowym krojem, nad zdjęciem drobne „PREZES ZARZĄDU”, zdjęcie w cienkiej ramce w lekkiej szarości, pod spodem dane kontaktowe drobnym drukiem.",
      top: () => '<div class="wz-role">PREZES ZARZĄDU</div>',
      bg: () => '<div class="vm-bg wz-linen"><i class="wz-rule"></i></div>',
      sub: () => wzContact(),
    }),
    X({
      name: "Złocenie na czerni",
      desc: "Matowa czarna wizytówka, nazwa i ramka złotą folią, która mieni się, gdy przesuwa się po niej światło, zdjęcie w złotej obwódce, dane kontaktowe drobnym złotym drukiem.",
      top: () => '<div class="wz-role gold">DYREKTOR GENERALNY</div>',
      bg: () => '<div class="vm-bg wz-black"><i class="wz-rule gold"></i><i class="wz-foil"></i></div>',
      sub: () => wzContact(),
    }),
    X({
      name: "Korporacyjna",
      desc: "Biało-granatowa jak z dużej firmy: granatowy pasek z logo ScamBox u góry, w rogu kod QR, nazwa bezszeryfowa, stanowisko „Senior Manager ds. Skrzynek”, dane z ikonkami.",
      top: () => '<div class="wz-corp"><i class="wz-logo"></i><b>SCAMBOX</b><span>GROUP</span></div>',
      bg: () => '<div class="vm-bg wz-white"></div>',
      photo: () => '<i class="wz-qr"></i>',
      sub: () => '<span class="wz-title">Senior Manager ds. Skrzynek</span>' + wzContact("☎ +48 213 742 069", "✉ kontakt@scambox.pl", "⌂ ul. Losowa 7, Warszawa"),
    }),
    X({
      name: "Kość słoniowa z tłoczeniem",
      desc: "Gruby kremowy papier w kolorze kości słoniowej z delikatnym znakiem wodnym, nazwa i stanowisko wytłoczone (cień i światło na literach), bardzo dyskretna typografia, zdjęcie w ciepłej sepii.",
      top: () => '<div class="wz-role emboss">WICEPREZES · FUZJE I PRZEJĘCIA</div>',
      bg: () => '<div class="vm-bg wz-ivory"><i class="wz-water"></i></div>',
      sub: () => wzContact("tel. 213 742 069", "kontakt@scambox.pl", "ul. Losowa 7, Warszawa"),
    }),
    X({
      name: "Kreatywna",
      desc: "Odważna wizytówka grafika: jaskrawy duet kolorów (koral i fiolet), wielki inicjał w tle, zaokrąglone rogi, nazwa grubym zaokrąglonym krojem, stanowisko „Dyrektor kreatywny”, zdjęcie w zaokrąglonej ramce.",
      top: () => '<div class="wz-role bold">DYREKTOR KREATYWNY</div>',
      bg: p => `<div class="vm-bg wz-duo"><b class="wz-initial">${(p?.name || "S")[0]}</b></div>`,
      sub: () => wzContact("213 742 069", "hej@scambox.pl", "@scambox"),
    }),
    X({
      name: "Firma z lat 90.",
      desc: "Wizytówka z punktu ksero z lat 90.: tło jak polerowany granit, nazwa tęczowym gradientem z cieniem jak w starym edytorze tekstu, nad zdjęciem „USŁUGI WSZELAKIE · TANIO · SOLIDNIE”, dane z numerem pagera.",
      top: () => '<div class="wz-role nineties">USŁUGI WSZELAKIE · TANIO · SOLIDNIE</div>',
      bg: () => '<div class="vm-bg wz-granite"></div>',
      sub: () => wzContact("tel. (022) 213-74-20", "pager 0642 213 742", "faks: na życzenie"),
    }),
  ],
};

// ---------------------------------------------------------------- PROPOZYCJE

export const VARIANT_PROPOSALS = [VM_ANALOG, VM_POLAROID, VM_CARD];
