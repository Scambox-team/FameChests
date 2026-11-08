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
// ASCII Art (makieta 1), Drewniany (Dąb) i Dowód osobisty (makieta 1) są już w grze - cards2.css / cardHtml.ts.
const seeded = seed => { let s = seed % 2147483647 || 7; return () => (s = s * 16807 % 2147483647) / 2147483647; };

// ================================================================ ŻELKOWY (jl-): arbuzowa żelka, bardziej przezroczysta, cztery filtry zdjęcia dopasowujące je do żelki

const jlSugar = n => vmScatter(n, "jl-sug", () => `--s:${vmN(.35, 1.2, 2)};animation-delay:-${vmN(0, 5, 1)}s;animation-duration:${vmN(2.4, 5, 1)}s`, [1, 99], [1, 99]);
const jlLook = (name, desc, filter, photo) => ({
  name, desc, cls: `jl watermelon glass ${filter}`,
  bg: () => '<div class="vm-bg jl-bg"><i class="jl-glow a"></i><i class="jl-glow b"></i></div>',
  photo: () => `${photo}<i class="vm-photo jl-shine"></i>`,
  deco: () => `<div class="vm-deco jl-clip">${jlSugar(60)}</div><div class="vm-deco"><i class="jl-gloss"></i><i class="jl-rim"></i></div>`,
});

VARIANT_PROPOSALS.push({
  key: "jelly", icon: "🍬", name: "Żelkowy", tag: "🍬 ŻELKA",
  about: "wybrana arbuzowa żelka (makieta 1), bardziej przezroczysta - prześwituje przez nią tło; cztery sposoby, żeby zdjęcie zawsze pasowało kolorami do żelki (różowa czerwień u góry, zieleń u dołu), niezależnie od kolorów zdjęcia",
  looks: [
    jlLook("Zabarwione zdjęcie", "Na zdjęcie nałożone kolory żelki w trybie barwy: zdjęcie zachowuje jasność i szczegóły, ale przejmuje różowo-zielony gradient żelki; lekko podbite nasycenie.", "pf1", '<i class="vm-photo jl-color"></i>'),
    jlLook("Żelkowy duotone", "Zdjęcie w dwóch kolorach żelki: cienie w głębokiej malinowej czerwieni i ciemnej zieleni, światła jasnoróżowe - zawsze idealnie w kolorach karty.", "pf2", '<i class="vm-photo jl-duo-dark"></i><i class="vm-photo jl-duo-light"></i>'),
    jlLook("Zatopione w żelce", "Zdjęcie jakby wtopione w żelkę: jego jasność nałożona na kolorową galaretkę pod spodem, więc wszystkie kolory biorą się z żelki, a brzegi zdjęcia rozmywają się w niej.", "pf3", ""),
    jlLook("Przesunięte barwy", "Barwy zdjęcia przesunięte w stronę żelki (odcień z gradientu, nasycenie i jasność ze zdjęcia), do tego miękki różowy blask - zdjęcie bardziej kolorowe niż w wersji 1.", "pf4", '<i class="vm-photo jl-hue"></i><i class="vm-photo jl-soft"></i>'),
  ],
});

// ================================================================ KRYSZTAŁOWY (cr-): diament z mocniejszym filtrem zdjęcia (jedna makieta)

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
const CR_PAL = ["#ffffff", "#eef7ff", "#d6ecff", "#bcdcff", "#f3eeff", "#a9cfff"];

VARIANT_PROPOSALS.push({
  key: "crystal", icon: "💠", name: "Kryształowy", tag: "💠 KRYSZTAŁ",
  about: "wybrany Diament (makieta 1) z dużo mocniejszym filtrem zdjęcia - osoba wygląda, jakby sama była z kryształu",
  looks: [
    { name: "Diament, mocny filtr", desc: "Zdjęcie odbarwione i rozjaśnione, zabarwione na lodowy błękit, pocięte na wyraźne fasetki z białymi krawędziami (jedne jaśniejsze, inne ciemniejsze jak szlif), przy krawędziach zdjęcia biała poświata, tęczowy połysk mocniejszy niż na karcie, więcej iskier.",
      cls: "cr diamond strong",
      bg: () => `<div class="vm-bg cr-bg">${vmSvg(crMesh(7, 10, CR_PAL, 11), "0 0 100 140", "cr-mesh")}<i class="cr-shim"></i></div>`,
      photo: () => `<i class="vm-photo cr-ice"></i>${vmSvg(crMesh(7, 9, ["#ffffff", "#8fc4ff", "#cfe7ff", "#3a6ac0", "#eaf6ff"], 33, [.25, .7], ' stroke="#ffffff" stroke-opacity=".7" stroke-width=".45"'), "0 0 100 140", "vm-photo cr-facet")}<i class="vm-photo cr-glow"></i><i class="vm-photo cr-shim ph"></i>${crSparks(7)}`,
      deco: () => `<div class="vm-deco">${crSparks(14)}</div>` },
  ],
});

// ================================================================ NOCNE NIEBO (ns-): Droga Mleczna na serio (szum SVG = mgławica i ciemne pasy pyłu, gęste gwiazdy, jasne jądro)

const nsStars = (n, cls = "ns-star", y = [1, 99]) => vmScatter(n, cls, () => `--s:${vmN(.3, 1.2, 2)};--o:${vmN(.35, 1, 2)};animation-duration:${vmN(2, 6, 1)}s`, y, [1, 99]);
const nsBright = n => vmScatter(n, "ns-bright", () => `--s:${vmN(.6, 1.2, 2)};animation-duration:${vmN(3, 6, 1)}s`, [3, 70]);
// Droga Mleczna: pas pod kątem `angle`, szerokość `w` (jednostki widoku 100 x 140), jądro w miejscu `core` (0-1 wzdłuż pasa)
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
// linia drzew przy dolnej krawędzi (nieregularne korony z kół)
const nsTreeline = (cls = "ns-treeline", y0 = 140) => { const r = seeded(23); let c = "";
  for (let x = -4; x < 106; x += 2 + r() * 3) { const h = 4 + r() * 10; c += `<circle cx="${x.toFixed(1)}" cy="${(y0 - h).toFixed(1)}" r="${(2 + r() * 3.5).toFixed(1)}"/>`; if (r() < .25) c += `<path d="M${x.toFixed(1)} ${y0} L${(x + 2).toFixed(1)} ${(y0 - h - 9 - r() * 6).toFixed(1)} L${(x + 4).toFixed(1)} ${y0}Z"/>`; }
  return vmSvg(`<g fill="#02040a">${c}<rect x="-5" y="${y0 - 5}" width="110" height="10"/></g>`, "0 0 100 140", cls); };
const nsLook = (name, desc, cls, bg, photo, deco = () => "") => ({ name, desc, cls: `ns ${cls}`, bg, photo: p => `<i class="vm-photo ns-ph"></i>${photo(p)}`, deco });
const nsShoots = n => Array.from({ length: n }, (_, k) => `<i class="ns-shoot" style="top:${6 + k * 11}%;left:${-30 + k * 9}%;animation-delay:-${(k * 1.6).toFixed(1)}s;animation-duration:${(5 + k).toFixed(1)}s"></i>`).join("");

VARIANT_PROPOSALS.push({
  key: "nightsky", icon: "🌌", name: "Nocne niebo", tag: "✦ NOCNE NIEBO",
  about: "wybrana Droga Mleczna (makieta 2), teraz wyraźna jak na zdjęciach z długim naświetlaniem: mgławica z szumu, ciemne pasy pyłu, ciepłe jądro galaktyki i setki gwiazd w pasie; przechodzi też przez zdjęcie",
  looks: [
    nsLook("Wyraźna Droga Mleczna", "Szeroki pas Drogi Mlecznej po skosie przez całą kartę i zdjęcie: fioletowo-błękitna mgławica, ciemne pasy pyłu w środku, złote jądro, gęsto od gwiazd; poza pasem zwykłe migoczące gwiazdy.", "mw1",
      () => `<div class="vm-bg ns-bg">${nsMilkyWay({ angle: -58, seed: 3, w: 26, core: .62 })}${nsStars(50)}${nsBright(4)}</div>`,
      () => `<i class="vm-photo ns-mw-ph">${nsMilkyWay({ angle: -58, seed: 3, w: 26, core: .62 }, "ns-mw")}</i>${nsStars(14, "ns-star ph")}`),
    nsLook("Łuk nad horyzontem", "Droga Mleczna wznosi się prawie pionowo znad linii drzew, z jasnym jądrem tuż nad horyzontem i ciepłą łuną miasta; czarne korony drzew przy dole karty i u dołu zdjęcia.", "mw2",
      () => `<div class="vm-bg ns-bg"><i class="ns-glow"></i>${nsMilkyWay({ angle: -78, seed: 8, w: 22, core: .78 })}${nsStars(50)}${nsTreeline()}</div>`,
      () => `<i class="vm-photo ns-mw-ph">${nsMilkyWay({ angle: -78, seed: 8, w: 22, core: .78 }, "ns-mw")}</i>${nsTreeline("ns-treeline ph", 140)}`),
    nsLook("Zdjęcie wśród gwiazd", "Zdjęcie bez ramki rozpływa się w nocnym niebie - brzegi znikają, a za osobą i przez nią przechodzi Droga Mleczna; nad zdjęciem pojedyncze jasne gwiazdy.", "mw3",
      () => `<div class="vm-bg ns-bg">${nsMilkyWay({ angle: -40, seed: 14, w: 30, core: .45 })}${nsStars(60)}${nsBright(5)}</div>`,
      () => `${nsStars(18, "ns-star ph")}${nsBright(3)}`),
    nsLook("Obracające się niebo", "Całe niebo z Drogą Mleczną bardzo powoli obraca się wokół gwiazdy polarnej, a co chwilę przelatuje deszcz meteorów (kilka spadających gwiazd jedna po drugiej).", "mw4",
      () => `<div class="vm-bg ns-bg"><i class="ns-rot">${nsMilkyWay({ angle: -50, seed: 21, w: 24, core: .55 })}${nsStars(70)}</i>${nsShoots(5)}</div>`,
      () => `<i class="vm-photo ns-mw-ph">${nsMilkyWay({ angle: -50, seed: 21, w: 24, core: .55 }, "ns-mw")}</i>${nsStars(12, "ns-star ph")}`,
      () => `<div class="vm-deco ns-clip">${nsShoots(3)}</div>`),
  ],
});

// ================================================================ HOLOGRAMOWY (hg-) i FRUTIGER AERO 3D (fa-): sceny Three.js w variant-mockups-3d.ts
const m3d = (kind, look) => p => `<div class="vm-deco m3d-wrap"><canvas class="m3d" data-kind="${kind}" data-look="${look}" data-pid="${p.id}"></canvas></div>`;

VARIANT_PROPOSALS.push({
  key: "hologram", icon: "📡", name: "Hologramowy", tag: "📡 HOLO",
  about: "wybrany projektor stołowy (makieta 1): urządzenie na dole dużo mniejsze, hologram osoby i panel statystyk dużo większe; makiety różnią się siłą zakłóceń",
  looks: [
    { name: "Czysty sygnał", desc: "Prawie bez zakłóceń: delikatne linie skanowania i lekkie migotanie, rzadkie, małe przesunięcia obrazu - najczytelniejsza wersja.", cls: "hg", deco: m3d("holo", 1) },
    { name: "Lekkie zakłócenia", desc: "Co kilka sekund pasy obrazu przeskakują w bok, hologram drga, widoczne ziarno - jak w makiecie 1, tylko w nowych proporcjach.", cls: "hg", deco: m3d("holo", 2) },
    { name: "Mocne zakłócenia", desc: "Zakłócenia cały czas: częste przeskoki pasów, mocne ziarno, a przy większych zakłóceniach obraz rozjeżdża się na czerwoną i turkusową kopię.", cls: "hg", deco: m3d("holo", 3) },
    { name: "Słaby sygnał", desc: "Hologram co kilka sekund buduje się od dołu do góry (świecąca linia), przygasa i rozjaśnia się, a czasem na moment całkiem znika.", cls: "hg", deco: m3d("holo", 4) },
  ],
});

const faBg = (cls, extra = "") => `<div class="vm-bg fa-bg ${cls}"><i class="fa-rays"></i>${vmSvg('<path d="M-5 112 Q25 96 55 108 T110 104 V145 H-5Z" fill="url(#faG1)"/><path d="M-5 124 Q35 108 70 120 T110 116 V145 H-5Z" fill="url(#faG2)"/><defs><linearGradient id="faG1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ee35a"/><stop offset="1" stop-color="#3f9a2a"/></linearGradient><linearGradient id="faG2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd23f"/><stop offset="1" stop-color="#2c7a1e"/></linearGradient></defs>', "0 0 100 140", "fa-hills")}${extra}</div>`;
const faLook = (name, desc, look, cls, extra = "") => ({ name, desc, cls: `fa ${cls}`, bg: () => faBg(cls, extra), photo: () => '<i class="vm-photo fa-glass"></i>', deco: p => m3d("aero2", look)(p) + '<div class="vm-deco"><i class="fa-gloss"></i></div>' });

VARIANT_PROPOSALS.push({
  key: "aero3d", icon: "🫧", name: "Frutiger Aero (3D)", tag: "🫧 AERO",
  about: "połączenie wybranych elementów: trzy rybki z akwarium, jedna duża, nieruchoma mała planeta w rogu - z wieżowcami ze szkła i zapalonymi oknami zamiast domku - i szklane kule; makiety różnią się rogiem planety i tłem",
  looks: [
    faLook("Planeta w lewym dolnym rogu", "Duża trawiasta planeta wystaje z lewego dolnego rogu, z niej rosną szklane wieżowce w stronę środka karty; rybki pływają dookoła zdjęcia, szklane kule w górnej części, błękitne niebo z promieniami.", 1, "sky"),
    faLook("Planeta w prawym górnym rogu", "Planeta z wieżowcami zwisa z prawego górnego rogu, kule i rybki w dolnej części karty, niebo z zielonymi wzgórzami.", 2, "sky"),
    faLook("Podwodne miasto", "Planeta w prawym dolnym rogu pod wodą: turkusowa woda z refleksami światła, rybki, szklane kule jak bańki powietrza.", 3, "water", '<i class="fa-caustic"></i>'),
    faLook("Szklany poranek", "Planeta w lewym górnym rogu na tle jasnego, porannego nieba z flarą obiektywu, zielone kule jak krople, rybki pod spodem.", 4, "orbs", '<i class="fa-flare"></i>'),
  ],
});
