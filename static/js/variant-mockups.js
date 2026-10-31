"use strict";
// Propozycje nowych wariantów (strona /variants, zakładka „Propozycje”) - makiety do wyboru, jeszcze NIE w grze.
// Każda makieta = zwykła karta + klasy vm-<wariant> vm-<wariant>-<nr> (static/css/variant-mockups.css) i ozdoby:
// bg (tło w środku karty, pod napisami), photo (na zdjęciu), deco (nad całą kartą), top (w środku karty nad nazwą),
// sub (tekst zamiast "typ · skrzynka") - vrProposalCard w variants.js. cls - klasy pożyczone z istniejącego wariantu.
// Po wyborze wygląd przechodzi do cards2.css / app.js jako prawdziwy wariant, a jego makiety stąd znikają.

const vmN = (a, b, d = 0) => rand(a, b).toFixed(d);
const vmPick = arr => arr[Math.floor(Math.random() * arr.length)];
const vmSvg = (body, vb = "0 0 63 88", cls = "", par = "none") =>
  `<svg class="${cls}" viewBox="${vb}" preserveAspectRatio="${par}" aria-hidden="true">${body}</svg>`;
// rzeczy rozrzucone po karcie (kropki, iskry, gwiazdki): losowe miejsce i opóźnienie animacji
const vmScatter = (n, cls, extra = () => "", y = [2, 96]) => Array.from({ length: n }, () =>
  `<i class="${cls}" style="left:${vmN(2, 96)}%;top:${vmN(...y)}%;animation-delay:-${vmN(0, 6, 1)}s;${extra()}"></i>`).join("");
// gwiazda pięcioramienna (środek x, y, promień r) - do flagi i ozdób
const vmStar = (x, y, r, fill) => `<path fill="${fill}" d="M${Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * .4 : r;
  return `${(x + Math.cos(a) * rr).toFixed(2)} ${(y + Math.sin(a) * rr).toFixed(2)}`;
}).join(" L")}Z"/>`;
// unikalne id dla filtrów / gradientów SVG (na stronie jest wiele kart naraz)
let vmIdN = 0;
const vmId = p => `${p}${++vmIdN}`;

// ---------------------------------------------------------------- ANIME
// Wariant `anime` jest już w game.json (wyłączony, naklejki nad i pod zdjęciem - "stickers": "both", zdjęcia anime
// z tools/anime_photos.py - "photoAll"), makiety pokazują jego naklejki z /stickers i zdjęcia anime. Klasy z prefiksem an-.

// linie szybkości z mangi rozchodzące się od środka (n promieni)
const anSpeed = (n = 48, col = "#fff") => vmSvg(Array.from({ length: n }, (_, k) => {
  const a = k / n * Math.PI * 2 + rand(-0.03, 0.03), w = rand(0.008, 0.03), r0 = rand(16, 26);
  const p = (ang, r) => `${(31.5 + Math.cos(ang) * r).toFixed(2)} ${(44 + Math.sin(ang) * r * 1.3).toFixed(2)}`;
  return `<path d="M${p(a - w, 80)} L${p(a, r0)} L${p(a + w, 80)}Z" fill="${col}"/>`;
}).join(""), "0 0 63 88", "an-speed");
// płatki wiśni spadające z góry
const anPetals = n => vmScatter(n, "an-petal", () => `--s:${vmN(.6, 1.3, 2)};animation-duration:${vmN(5, 9, 1)}s;--dx:${vmN(-30, 30)}cqw`, [-10, 0]);
const anSparkles = (n, y) => vmScatter(n, "an-spark", () => `--s:${vmN(.5, 1.4, 2)}`, y);
// odgłos z mangi (katakana) w dymku
const anSfx = (t, x, y, r, cls = "") => `<b class="an-sfx ${cls}" style="left:${x}%;top:${y}%;--r:${r}deg">${t}</b>`;
// magiczny krąg (Isekai) - dwa obracające się pierścienie z runami
const anCircle = () => vmSvg(`<g fill="none" stroke="#9fe8ff" stroke-width=".35"><circle cx="31.5" cy="44" r="26"/><circle cx="31.5" cy="44" r="23"/>
  <circle cx="31.5" cy="44" r="12"/><path d="${Array.from({ length: 6 }, (_, k) => { const a = k * Math.PI / 3, b = a + Math.PI * 2 / 3;
    return `M${(31.5 + Math.cos(a) * 23).toFixed(2)} ${(44 + Math.sin(a) * 23).toFixed(2)} L${(31.5 + Math.cos(b) * 23).toFixed(2)} ${(44 + Math.sin(b) * 23).toFixed(2)}`; }).join(" ")}"/></g>
  <text font-size="2.2" fill="#9fe8ff" font-family="Share Tech Mono, monospace"><textPath href="#anRunes" startOffset="0">ᚠᚢᚦᚨᚱᚲ ✦ ᛃᛇᛈᛉᛊ ✦ ᛏᛒᛖᛗᛚ ✦ ᛜᛞᛟ ✦ ᚠᚢᚦᚨᚱᚲ ✦ ᛃᛇᛈᛉᛊ ✦</textPath></text>
  <defs><path id="anRunes" d="M31.5 44 m-24.5 0 a24.5 24.5 0 1 1 49 0 a24.5 24.5 0 1 1 -49 0"/></defs>`, "0 0 63 88", "an-circle", "xMidYMid meet");
// panoramiczne miasto nocą (Neo-Tokio): bloki z oknami i neonowymi szyldami
function anCity() {
  let x = -2, out = "";
  while (x < 64) {
    const w = rand(4, 9), h = rand(14, 40);
    out += `<rect x="${x.toFixed(1)}" y="${(88 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#120a24"/>`;
    for (let k = 0; k < h / 3; k++) if (Math.random() < .45)
      out += `<rect x="${(x + rand(.6, w - 1.4)).toFixed(1)}" y="${(88 - h + 1.5 + k * 3).toFixed(1)}" width=".8" height="1" fill="${vmPick(["#ff4fb5", "#38e1ff", "#ffe46b"])}" opacity=".8"/>`;
    x += w + rand(.3, 1.2);
  }
  return vmSvg(out, "0 0 63 88", "an-city", "xMidYMax slice");
}
// pasek statusu postaci z RPG (Isekai)
const anStatus = () => `<div class="an4-status"><b>LV 99</b><span class="hp"><i></i></span><span class="mp"><i></i></span></div>`;

const VM_ANIME = {
  key: "anime", icon: "🌸", name: "Anime", tag: "🌸 ANIME", stickers: "anime", photoVariant: "anime",
  about: "zdjęcie w stylu anime (tools/anime_photos.py), naklejki nad i pod zdjęciem z /stickers - osiem pomysłów na wygląd",
  looks: [
    {
      name: "Shōnen",
      desc: "Jak kadr z bijatyki: od zdjęcia rozchodzą się białe linie szybkości na pomarańczowo-niebieskim tle, w rogach odgłosy z mangi ドドド i ゴゴゴ, nazwa grubym komiksowym krojem z czarnym obrysem, ramka w ostre zęby.",
      bg: () => `<div class="vm-bg an1-bg">${anSpeed(54, "#ffffffcc")}</div>`,
      deco: () => `<div class="vm-deco">${anSfx("ドドド", 84, 22, 12)}${anSfx("ゴゴゴ", 14, 60, -10, "b")}</div>`,
      sub: () => "SEZON 1 · ODCINEK 12",
    },
    {
      name: "Shōjo",
      desc: "Pastelowy róż jak z romansu szkolnego: spadające płatki wiśni, migoczące gwiazdki i bąbelki, zdjęcie w miękkiej poświacie z kwiatową ramką, nazwa ozdobnym pismem, panele jak przezroczyste wstążki.",
      bg: () => `<div class="vm-bg an2-bg">${anSparkles(18, [2, 96])}<i class="an2-bubbles"></i></div>`,
      photo: () => '<i class="vm-photo an2-glow"></i>',
      deco: () => `<div class="vm-deco an-clip">${anPetals(12)}</div>`,
      sub: () => "♡ DOKI DOKI ♡",
    },
    {
      name: "Mecha",
      desc: "Kokpit robota bojowego: granatowe tło z siatką sześciokątów, celownik i narożniki namierzania na zdjęciu, pasy ostrzegawcze przy dole karty, pasek „SYNC 400%” nad nazwą, ramka z płyt pancerza z nitami.",
      top: () => '<div class="an3-bar"><span>UNIT-01</span><span class="an3-sync">SYNC 400%</span></div>',
      bg: () => '<div class="vm-bg an3-bg"><i class="an3-hex"></i><i class="an3-warn"></i></div>',
      photo: () => '<i class="vm-photo an3-lock"><b class="a"></b><b class="b"></b><b class="c"></b><b class="d"></b><u></u></i>',
      sub: () => "PILOT · KLASA S",
    },
    {
      name: "Manga",
      desc: "Strona z czarno-białej mangi: raster kropek (screentone) w tle, zdjęcie w czerni i bieli z mocnym kontrastem w kadrze z grubą ramką, dymek z tekstem przy zdjęciu, napisy jak czcionka z tomiku.",
      bg: () => '<div class="vm-bg an5-bg"><i class="an5-tone"></i></div>',
      photo: () => '<i class="vm-photo an5-ink"></i>',
      deco: () => '<div class="vm-deco"><span class="an5-bubble">…to jeszcze<br>nie koniec!</span></div>',
      sub: () => "ROZDZIAŁ 1 · STR. 23",
    },
    {
      name: "Isekai",
      desc: "Przeniesiony do świata fantasy: za zdjęciem obraca się błękitny magiczny krąg z runami, nad nazwą okno statusu postaci (LV, pasek HP i MP), panele jak półprzezroczyste niebieskie okna z gry RPG, podpis „Nowa umiejętność odblokowana”.",
      top: () => anStatus(),
      bg: () => `<div class="vm-bg an4-bg">${anCircle()}</div>`,
      sub: () => "✦ NOWA UMIEJĘTNOŚĆ ✦",
    },
    {
      name: "Neo-Tokio",
      desc: "Noc w wielkim mieście: sylwetki wieżowców z różowymi i błękitnymi oknami, pionowy neonowy szyld z japońskim napisem, ukośny deszcz, zdjęcie w neonowym obrysie, nazwa świecącym różem.",
      bg: () => `<div class="vm-bg an6-bg">${anCity()}<i class="an6-rain"></i></div>`,
      deco: () => '<div class="vm-deco"><span class="an6-sign">東京</span></div>',
      photo: () => '<i class="vm-photo an6-rim"></i>',
      sub: () => "NEO-TOKIO · 2099",
    },
    {
      name: "Letnie niebo",
      desc: "Spokojne letnie popołudnie jak z filmu animowanego: błękitne niebo z wielkimi chmurami, zielone wzgórza przy dole, ciepłe światło i drobinki kurzu w powietrzu, zdjęcie z akwarelowym brzegiem, ramka w kolorze kremowym.",
      bg: () => `<div class="vm-bg an7-bg"><i class="an7-cloud c1"></i><i class="an7-cloud c2"></i><i class="an7-cloud c3"></i><i class="an7-hill"></i>${anSparkles(10, [10, 60])}</div>`,
      photo: () => '<i class="vm-photo an7-wash"></i>',
      sub: () => "LATO · GDZIEŚ NA WSI",
    },
    {
      name: "Idol",
      desc: "Koncert idolki na scenie: kolorowe reflektory omiatają kartę, migoczą serduszka i brokat, nad nazwą świecący napis „LIVE!”, panele jak błyszczące różowo-fioletowe bilety, ramka w tęczowym połysku.",
      top: () => '<div class="an8-live">● LIVE!</div>',
      bg: () => `<div class="vm-bg an8-bg"><i class="an8-beam l"></i><i class="an8-beam r"></i>${vmScatter(10, "an8-heart", () => `--s:${vmN(.6, 1.3, 2)}`)}</div>`,
      deco: () => `<div class="vm-deco">${anSparkles(14, [2, 96])}</div>`,
      sub: () => "★ WORLD TOUR ★",
    },
  ],
};

// ---------------------------------------------------------------- COVID
// Wariant `covid` jest już w game.json (wyłączony, naklejki na zdjęciu - "stickers": true). Klasy z prefiksem cvd-.

// wirus: kula z wypustkami (n kolców)
const cvdVirus = (cls, n = 12) => `<i class="cvd-virus ${cls}">${vmSvg(`<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${Array.from({ length: n }, (_, k) => {
  const a = k / n * Math.PI * 2;
  return `<path d="M${(20 + Math.cos(a) * 11).toFixed(1)} ${(20 + Math.sin(a) * 11).toFixed(1)} L${(20 + Math.cos(a) * 16).toFixed(1)} ${(20 + Math.sin(a) * 16).toFixed(1)}"/>`;
}).join("")}</g>${Array.from({ length: n }, (_, k) => { const a = k / n * Math.PI * 2;
  return `<circle cx="${(20 + Math.cos(a) * 17).toFixed(1)}" cy="${(20 + Math.sin(a) * 17).toFixed(1)}" r="2.2" fill="currentColor"/>`; }).join("")}
  <circle cx="20" cy="20" r="11.5" fill="currentColor"/><circle cx="16" cy="16" r="4" fill="#fff" opacity=".25"/>`, "0 0 40 40", "", "xMidYMid meet")}</i>`;
const cvdViruses = n => Array.from({ length: n }, () => `<span class="cvd-float" style="left:${vmN(4, 92)}%;top:${vmN(4, 92)}%;--s:${vmN(.5, 1.2, 2)};animation-delay:-${vmN(0, 8, 1)}s">${cvdVirus("")}</span>`).join("");
// taśma ostrzegawcza z napisem
const cvdTape = (t, cls) => `<i class="cvd-tape ${cls}"><span>${Array(6).fill(t).join(" ⚠ ")}</span></i>`;
// kod QR z losowych modułów (certyfikat) - same kwadraty, nie da się go zeskanować
function cvdQr() {
  let out = "";
  const eye = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#111"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#111"/>`;
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    if ((x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)) continue;
    if (Math.random() < .5) out += `<rect x="${x}" y="${y}" width="1" height="1" fill="#111"/>`;
  }
  return vmSvg(`<rect width="21" height="21" fill="#fff"/>${out}${eye(0, 0)}${eye(14, 0)}${eye(0, 14)}`, "0 0 21 21", "", "xMidYMid meet");
}
// rolki papieru toaletowego (ułożone w piramidę)
const cvdRolls = () => Array.from({ length: 6 }, (_, k) => {
  const row = k < 3 ? 0 : k < 5 ? 1 : 2, i = k < 3 ? k : k < 5 ? k - 3 : 0;
  return `<i class="cvd-roll" style="left:${10 + row * 7 + i * 14}%;bottom:${4 + row * 9}%"></i>`;
}).join("");

const VM_COVID = {
  key: "covid", icon: "😷", name: "COVID", tag: "😷 COVID-19", stickers: "covid",
  about: "rok 2020: maseczki, kwarantanna, testy i zdalne lekcje; naklejki (np. maseczka) z /stickers leżą na zdjęciu - osiem pomysłów na wygląd",
  looks: [
    {
      name: "Maseczka",
      desc: "Szpitalny błękit i biel: tło w delikatny wzór z maseczek chirurgicznych, ramka jak plisowana maseczka z gumką w rogach, panele białe jak gaza, podpis „ZOSTAŃ W DOMU”.",
      bg: () => '<div class="vm-bg cvd1-bg"><i class="cvd1-pattern"></i></div>',
      deco: () => '<div class="vm-deco"><i class="cvd1-loop l"></i><i class="cvd1-loop r"></i></div>',
      sub: () => "#ZOSTAŃWDOMU",
    },
    {
      name: "Kwarantanna",
      desc: "Strefa zamknięta: żółto-czarne taśmy ostrzegawcze przecinają kartę na skos (jedna przez zdjęcie), tło w ukośne pasy, znak zagrożenia biologicznego za zdjęciem, podpis jak z tablicy „STREFA KWARANTANNY”.",
      bg: () => '<div class="vm-bg cvd2-bg"><i class="cvd2-bio">☣</i></div>',
      deco: () => `<div class="vm-deco cvd-clip">${cvdTape("KWARANTANNA", "a")}${cvdTape("NIE WCHODZIĆ", "b")}</div>`,
      sub: () => "STREFA KWARANTANNY · 14 DNI",
    },
    {
      name: "Laboratorium",
      desc: "Pod mikroskopem: zielono-turkusowe tło z okrągłym polem widzenia, powoli dryfujące cząstki wirusa z kolcami, skala pomiarowa na zdjęciu, napisy jak z wydruku z laboratorium.",
      bg: () => `<div class="vm-bg cvd3-bg"><i class="cvd3-lens"></i>${cvdViruses(7)}</div>`,
      photo: () => '<i class="vm-photo cvd3-scale"><b>100 nm</b></i>',
      sub: () => "PRÓBKA SARS-CoV-2 · ×40 000",
    },
    {
      name: "Wiadomości",
      desc: "Wydanie specjalne w telewizji: czerwony pasek „PILNE” nad nazwą, na dole karty przewijający się pasek z komunikatami, zdjęcie jak na ekranie z logo kanału w rogu, granatowe studio w tle.",
      top: () => '<div class="cvd4-breaking"><b>PILNE</b><span>WYDANIE SPECJALNE</span></div>',
      bg: () => '<div class="vm-bg cvd4-bg"><i class="cvd4-glow"></i></div>',
      photo: () => '<i class="vm-photo cvd4-live">NA ŻYWO</i>',
      deco: () => '<div class="vm-deco"><div class="cvd4-ticker"><span>MINISTERSTWO ZDROWIA: NOWE OBOSTRZENIA ★ SZKOŁY ZAMKNIĘTE DO ODWOŁANIA ★ NIE WYCHODŹ Z DOMU BEZ POTRZEBY ★ MYJ RĘCE ★</span></div></div>',
      sub: () => "KOMUNIKAT NR 2020/03",
    },
    {
      name: "Test",
      desc: "Karta jak kaseta testu antygenowego: biały plastik z lekkim połyskiem, zdjęcie w okienku testu, obok paski C i T (T powoli się pojawia), podpis „WYNIK: POZYTYWNY”, przy dole numer partii.",
      bg: () => '<div class="vm-bg cvd5-bg"><i class="cvd5-strip"><b class="c">C</b><b class="t">T</b></i></div>',
      sub: () => "WYNIK: POZYTYWNY",
    },
    {
      name: "Zapasy",
      desc: "Panika w sklepie: tło jak pusta półka marketu z cenówkami, przy dole piramida z rolek papieru toaletowego, na zdjęciu naklejka „LIMIT 2 SZT.”, ramka w kolorze sklepowej czerwieni.",
      bg: () => `<div class="vm-bg cvd6-bg"><i class="cvd6-shelf a"></i><i class="cvd6-shelf b"></i>${cvdRolls()}</div>`,
      photo: () => '<i class="vm-photo cvd6-limit">LIMIT<br>2 SZT.</i>',
      sub: () => "OSTATNIA ROLKA W SKLEPIE",
    },
    {
      name: "Zdalne lekcje",
      desc: "Wideorozmowa z domu: zdjęcie w kafelku rozmowy z ikonką wyciszonego mikrofonu i podpisem, obok mniejsze kafelki z wyłączonymi kamerami, nad nazwą pasek „Jesteś wyciszony”, ciemny interfejs komunikatora.",
      top: () => '<div class="cvd7-bar">🔇 Jesteś wyciszony</div>',
      bg: () => '<div class="vm-bg cvd7-bg"><i class="cvd7-tile a">KB</i><i class="cvd7-tile b">MN</i><i class="cvd7-tile c">ZS</i></div>',
      photo: () => '<i class="vm-photo cvd7-name"><b>🔇</b></i>',
      sub: () => "LEKCJA ZDALNA · 8:00",
    },
    {
      name: "Certyfikat",
      desc: "Jak certyfikat szczepienia: biały papier z zielonym nagłówkiem i gilosz w tle, w rogu karty kod QR (nie do zeskanowania), zielony znaczek ✓, podpis „ZASZCZEPIONY · 2 DAWKI”.",
      bg: () => '<div class="vm-bg cvd8-bg"><i class="cvd8-guilloche"></i></div>',
      photo: () => `<i class="vm-photo cvd8-qr">${cvdQr()}</i><i class="vm-photo cvd8-ok">✓</i>`,
      sub: () => "ZASZCZEPIONY · 2 DAWKI",
    },
  ],
};

// ---------------------------------------------------------------- PROPOZYCJE

const VARIANT_PROPOSALS = [VM_ANIME, VM_COVID];
