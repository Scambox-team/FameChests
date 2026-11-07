// @ts-nocheck -- kod rysujący na canvasie i w DOM-ie, przeniesiony bez zmian; typy dochodzą przy dalszym porządkowaniu
// Efekty nad stroną: cząsteczki, wielkie odsłonięcie karty, drukarka paragonów, konfetti, podgląd karty.
// Rysują bezpośrednio na body i na canvasach (#fxCanvas, #confetti), bo muszą działać nad każdym ekranem.
import { S } from '../game/store';
import { joinVariant, splitVariant } from '../game/rules';
import { abilitiesOf, baseVariant, beerSub, cardValue, crateOf, crateVariants, isBlank, isCombo, isSpecial, isSpecialCard, sellableCard, person, plural, possibleVariants, rand, rarityIdx, rarityShare, variantChance, variantName, variantParts, vClass, vtClass, imgUrl } from '../game/rules';
import { cardHTML, scratchable } from '../cards/cardHtml';
import { esc, fmt, sleep } from '../lib/format';
import { Sound } from '../sound/sound';
import { kindIcon, typeIcon } from '../icons/cardIcons';
import { crateIconPath } from '../icons/crateIcons';
import { crateLook3d } from '../features/crates/crateLook';

const $ = (s, el: any = document) => el.querySelector(s);
const $$ = (s, el: any = document) => [...el.querySelectorAll(s)];
const KIND_LABELS = { off: "Atak", def: "Obrona", heal: "Leczenie", eco: "Ekonomia" };
const updateCovered = () => {};

/** Akcje przycisków w podglądzie karty: dostarczają je ekrany, które je obsługują */
export const viewerActions: Record<string, any> = {};

"use strict";
// Efekty: cząsteczki, wielkie odsłonięcie (legendarne/ultra), podgląd karty, deszcz monet.
// Korzysta z globalnych funkcji z app.js (S, $, person, cardHTML, fmt, esc...).

export const RAINBOW = ["#ff3b3b", "#ff9f1a", "#ffe53b", "#3bff6b", "#3bd5ff", "#6b5bff", "#ff3bd8"];
export const GOLDS = ["#ffc531", "#ffe58a", "#fff6cf", "#ffb300", "#ffffff"];
export const SECRET_COLORS = ["#fff6d0", "#f3e3b0", "#ffd54a", "#ffffff", "#ffe9a8"];
export const SPECIAL_COLORS = ["#19e6ff", "#ff2bd6", "#ffd54a", "#7dff6b", "#ffffff"];   // karty specjalne (Joker...)

// ================================================================ CZĄSTECZKI

export function makeParticles(canvas) {
  const ctx = canvas.getContext("2d");
  const ps = [];
  let running = false, stopped = false;
  const fit = () => {
    if (canvas.width !== innerWidth || canvas.height !== innerHeight) { canvas.width = innerWidth; canvas.height = innerHeight; }
  };
  function star(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, rr = i % 2 ? r * 0.28 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  }
  function frame() {
    if (stopped) return;
    fit();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life++;
      if (p.kind === "in") {
        p.x += (p.tx - p.x) * p.k; p.y += (p.ty - p.y) * p.k;
      } else {
        p.vx *= p.drag; p.vy *= p.drag; p.vy += p.g; p.x += p.vx; p.y += p.vy;
      }
      const a = 1 - p.life / p.max;
      if (a <= 0) { ps.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, a * 1.5);
      ctx.fillStyle = p.color;
      if (p.kind === "star") {
        star(p.x, p.y, p.size * (0.6 + 0.4 * Math.sin(p.life / 4)));
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2.2, 0, 6.283); ctx.globalAlpha *= 0.25; ctx.fill();
        ctx.globalAlpha = Math.min(1, a * 1.5);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (ps.length) requestAnimationFrame(frame);
    else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }
  return {
    add(p) {
      if (stopped) return;
      ps.push(Object.assign({ life: 0, max: 60, size: 3, color: "#fff", vx: 0, vy: 0, g: 0, drag: 1, kind: "spark" }, p));
      if (!running) { running = true; requestAnimationFrame(frame); }
    },
    burst(x, y, n, colors, { speed = 12, g = 0.12, life = [60, 120], size = [1.5, 4], stars = 0.15 } = {}) {
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * 6.283, sp = speed * (0.25 + Math.random() * 0.9);
        this.add({
          x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g, drag: 0.965,
          max: rand(life[0], life[1]), size: rand(size[0], size[1]),
          color: colors[i % colors.length], kind: Math.random() < stars ? "star" : "spark",
        });
      }
    },
    implode(x, y, n, colors, radius) {
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * 6.283, r = radius * rand(0.7, 1.2);
        this.add({ kind: "in", x: x + Math.cos(ang) * r, y: y + Math.sin(ang) * r, tx: x, ty: y,
                   k: rand(0.03, 0.07), max: rand(35, 60), size: rand(1.5, 3.5), color: colors[i % colors.length] });
      }
    },
    stop() { stopped = true; ps.length = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); },
  };
}

let FX = null; // globalny system cząsteczek (nad całą stroną)
export function fx() { return FX ||= makeParticles($("#fxCanvas")); }

// ================================================================ REWERS KARTY

export function cardBackHTML() {
  return `<div class="cback"><div class="cback-inner">
    <div class="cback-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="2" width="9" height="12" rx="1.5" fill="#fff"/><rect x="3" y="10" width="18" height="12" rx="2.5" fill="var(--rc, var(--hue))"/><rect x="3" y="10" width="18" height="3" fill="#00000040"/></svg></div>
    <div class="cback-title">ScamBox</div>
  </div></div>`;
}

// ================================================================ WIELKIE ODSŁONIĘCIE

// Odsłonięcie najlepszych kart (Legendarna, ULTRA, Specjalna, Tajna): skrzynka 3D wybucha i wyrzuca kartę (reveal3d.ts).
// Three.js wczytuje się dopiero tutaj; bez WebGL albo przy ograniczonym ruchu zostaje płaska wersja poniżej.
// Skrzynka ma wygląd tej, którą właśnie otwieramy; nagrody z kasyna, kuźni i linków dostają ciemną skrzynkę „domu”.
export async function epicReveal(drop, opts: { fast?: boolean; auto?: boolean } = {}) {
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    try {
      const { epicReveal3d } = await import("./reveal3d");
      const crate = S.opening?.crate ? crateOf(S.opening.crate) : null;
      const look = crate ? crateLook3d(crate) : { c1: "#2b2b33", c2: "#141418", hue: S.cfg.rarities[person(drop.person).rarity].color, d: crateIconPath("") };
      return await epicReveal3d(drop, { ...opts, look });
    } catch { /* bez WebGL: płaskie odsłonięcie */ }
  }
  return epicRevealFlat(drop, opts);
}

// Płaska wersja: ciemna scena, linia światła w kolorze rzadkości ładuje się, karta wychodzi z cienia rewersem,
// odwraca się w snopie reflektora. ULTRA ma opalizującą obwódkę, Tajna złotą ramkę rysowaną w ciemności i opadający pył.
function epicRevealFlat(drop, { fast = false, auto = false } = {}) {
  return new Promise(resolve => {
    const p = person(drop.person);
    const tier = p.rarity === "secret" ? "secret" : p.rarity === "ultra" ? "ultra" : p.rarity === "special" ? "special" : "gold";
    const R = S.cfg.rarities[p.rarity];
    const label = tier === "secret" ? "Tajna karta" : tier === "special" && baseVariant(drop.variant) === "joker" ? "Joker" : R.name;
    const colors = tier === "ultra" ? RAINBOW : tier === "special" ? SPECIAL_COLORS : tier === "secret" ? SECRET_COLORS : GOLDS;
    const chargeMs = { gold: 1500, special: 1500, ultra: 2300, secret: 2700 }[tier] * (fast ? .5 : 1);

    const el = document.createElement("div");
    el.className = `rv rv-${tier}`;
    el.style.setProperty("--rc", R.color);
    el.style.setProperty("--charge", chargeMs + "ms");
    el.innerHTML = `
      <canvas class="rv-canvas"></canvas>
      <div class="rv-spot"></div>
      <div class="rv-line"></div>
      <div class="rv-content">
        <div class="rv-label">${esc(label)}</div>
        <div class="rv-stage">
          ${tier === "secret" ? '<svg class="rv-frame" aria-hidden="true"><rect pathLength="100"/></svg>' : ""}
          ${tier === "ultra" ? '<div class="rv-edge"></div>' : ""}
          <div class="rv-flip">
            <div class="rv-face rv-back">${cardBackHTML()}</div>
            <div class="rv-face rv-front">${cardHTML(drop.person, drop.variant, drop.id)}</div>
          </div>
          <div class="rv-floor"></div>
        </div>
        <div class="rv-name">${esc(p.name)}</div>
        <div class="rv-meta">${isSpecial(drop.variant) ? `<span>${esc(variantName(drop.variant))}</span>` : ""}<b>${fmt(drop.value)}</b></div>
        <div class="rv-hint">Kliknij albo naciśnij spację</div>
      </div>`;
    document.body.appendChild(el);

    const P = makeParticles(el.querySelector(".rv-canvas"));
    const center = () => { const b = el.querySelector(".rv-stage").getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b]; };
    let phase = "charge", dust = null;

    requestAnimationFrame(() => el.classList.add("charging"));
    if (tier === "secret") Sound.drone(chargeMs); else Sound.charge(chargeMs / 1000, tier === "ultra");
    const pull = setInterval(() => { const [x, y] = center(); P.implode(x, y, tier === "gold" ? 3 : 5, colors, Math.max(innerWidth, innerHeight) * .45); }, 70);
    const timer = setTimeout(reveal, chargeMs);

    function reveal() {
      if (phase !== "charge") return;
      phase = "reveal";
      clearTimeout(timer); clearInterval(pull);
      el.classList.remove("charging");
      el.classList.add("revealed");
      Sound.boom(tier !== "gold");
      if (tier === "secret") Sound.choir(); else if (tier === "ultra") Sound.ultra(true); else Sound.gold();
      const [x, y] = center();
      P.burst(x, y, tier === "gold" ? 160 : 260, colors, { speed: tier === "gold" ? 12 : 16, stars: .3 });
      if (tier !== "gold") setTimeout(() => confetti(colors, tier === "ultra" ? 180 : 120), 400);
      // pył w snopie światła: spokojnie opada (Tajna) albo unosi się wokół karty
      dust = setInterval(() => {
        const [cx, cy, b] = center();
        const fall = tier === "secret";
        P.add({ x: cx + rand(-b.width, b.width), y: fall ? rand(-20, cy - b.height / 2) : cy + rand(-b.height / 2, b.height / 2),
                vx: rand(-.25, .25), vy: fall ? rand(.5, 1.4) : rand(-1.6, -.4), max: rand(70, 140), size: rand(.8, 2.2),
                color: colors[Math.floor(Math.random() * colors.length)], kind: Math.random() < .25 ? "star" : "spark" });
      }, tier === "gold" ? 110 : 60);
      setTimeout(() => { if (phase === "reveal") { phase = "ready"; el.classList.add("ready"); } }, fast ? 450 : 1000);
    }
    function close() {
      phase = "closing";
      clearInterval(dust);
      window.removeEventListener("keydown", onKey, true);
      el.classList.add("closing");
      setTimeout(() => { P.stop(); el.remove(); resolve(); }, 350);
    }
    function advance() {
      if (phase === "charge") reveal();
      else if (phase === "reveal") { phase = "ready"; el.classList.add("ready"); }
      else if (phase === "ready") close();
    }
    function onKey(e) {
      if ([" ", "Enter", "Escape"].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); advance(); }
    }
    window.addEventListener("keydown", onKey, true);
    el.addEventListener("click", advance);
    if (auto) {   // autootwieranie: odsłonięcie samo przechodzi dalej po chwili
      const tick = () => { if (phase !== "closing") { advance(); setTimeout(tick, fast ? 900 : 1500); } };
      setTimeout(tick, chargeMs + (fast ? 1200 : 2400));
    }
  });
}

export function epicOpen() { return !!document.querySelector(".rv, .r3, .rcp"); }
// ================================================================ DRUKOWANIE PARAGONU

// Paragon wypada z drukarki: karta wysuwa się ze szczeliny linia po linii (keyframes rcpFeed, tyle samo kroków co terkotów
// w Sound.print), na końcu dzwonek i oderwanie papieru. Pierwsze kliknięcie kończy drukowanie, drugie zamyka.
export const RCP_LINES = 24;
export function receiptReveal(drop, { fast = false, auto = false } = {}) {
  return new Promise(resolve => {
    const p = person(drop.person);
    const feedMs = fast ? 1300 : 3000;
    const el = document.createElement("div");
    el.className = "rcp printing";
    el.style.setProperty("--feed", feedMs + "ms");
    el.style.setProperty("--lines", RCP_LINES);
    el.innerHTML = `
      <div class="rcp-title"><span>PARAGON FISKALNY</span></div>
      <div class="rcp-window"><div class="rcp-jit"><div class="rcp-paper">${cardHTML(drop.person, drop.variant, drop.id)}</div></div></div>
      <div class="rcp-printer">
        <div class="rcp-slot"></div>
        <div class="rcp-led"></div>
        <div class="rcp-lcd"><span class="on">DRUKUJĘ<i>...</i></span><span class="off">GOTOWE ✓</span></div>
      </div>
      <div class="rcp-name">${esc(p.name)}<b>${fmt(drop.value)}</b></div>
      <div class="rcp-hint">Kliknij lub naciśnij spację, aby kontynuować</div>`;
    document.body.appendChild(el);
    updateCovered();

    let phase = "print", autoTimer = null;
    Sound.print(feedMs / 1000, RCP_LINES);
    const doneTimer = setTimeout(done, feedMs + 150);

    function done() {
      if (phase !== "print") return;
      phase = "ready";
      clearTimeout(doneTimer);
      el.classList.remove("printing");
      el.classList.add("done");
      Sound.tear();
      confetti(["#ffffff", "#e8e4da", "#1a1a1a"], fast ? 40 : 80);
      if (auto) autoTimer = setTimeout(close, fast ? 900 : 1500);
    }
    function close() {
      if (phase === "closing") return;
      phase = "closing";
      clearTimeout(doneTimer); clearTimeout(autoTimer);
      window.removeEventListener("keydown", onKey, true);
      el.classList.add("closing");
      setTimeout(() => { el.remove(); updateCovered(); resolve(); }, 350);
    }
    const advance = () => (phase === "print" ? done() : phase === "ready" ? close() : 0);
    function onKey(e) {
      if ([" ", "Enter", "Escape"].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); advance(); }
    }
    window.addEventListener("keydown", onKey, true);
    el.addEventListener("click", advance);
  });
}

// ================================================================ PODGLĄD KARTY

// Piwna: rodzaj piwa tego egzemplarza (i jak często wypada), a w podglądzie bez egzemplarza - lista wszystkich rodzajów
export function beerRow(variant, uid) {
  const subs = S.cfg.variants.beer?.subs;
  if (!subs?.length || !variantParts(variant).includes("beer")) return "";
  const sub = beerSub(variant, uid), total = subs.reduce((a, s) => a + s.weight, 0);
  return sub
    ? `<tr><td>Rodzaj piwa</td><td><b>${esc(sub.name)}</b> <span class="muted">(${Math.round(sub.weight / total * 100)}% Piwnych kart)</span></td></tr>`
    : `<tr><td>Rodzaje piwa</td><td>${subs.map(s => esc(s.name)).join(", ")}</td></tr>`;
}
// uid - numer egzemplarza (jeśli podgląd jest dla konkretnej karty gracza): od niego zależy podwariant Piwnej
export function openViewer(pid, variant = "normal", uid: any = null) {
  closeViewer();
  const p = person(pid);
  variant = variant || "normal";
  uid = uid || null;
  const el = document.createElement("div");
  el.className = "viewer";
  const stage = `
    <div class="viewer-stage">
      <div class="viewer-flipper">
        <div class="vf vf-front">${cardHTML(pid, variant, uid)}</div>
        <div class="vf vf-back">${cardBackHTML()}</div>
      </div>
    </div>`;
  // skrzynki, z których można zdobyć tę kartę (widać tylko w podglądzie, nie na samej karcie)
  // karta specjalna: nie ze skrzynek, tylko z kasyna albo z linku od admina
  const cratesRow = isSpecialCard(p)
    ? `<tr><td>Skąd</td><td>${esc(S.cfg.specialSources[p.source] || "")}</td></tr>`
    : `<tr><td>Ze skrzynek</td><td>${(p.crates || [p.crate]).map(crateOf).filter(Boolean)
    .map(c => `${esc(c.name)}`).join("<br>")}</td></tr>`;
  if (p.masked) {
    const share = rarityShare(p.crate, "secret");
    el.innerHTML = `${stage}
      <div class="viewer-info" style="--rc:${S.cfg.rarities.secret.color}">
        <div class="vi-rarity">★ TAJNA</div>
        <h2>???</h2>
        <div class="muted">${esc(crateOf(p.crate).name)}</div>
        <p>Najrzadsza karta w tej skrzynce. Nie wiadomo, kto na niej jest — dopóki jej nie zdobędziesz.</p>
        <table class="vi-table">
          <tr><td>Szansa z 1 skrzynki</td><td>${share ? "1 na " + Math.round(1 / share).toLocaleString("pl-PL") : "—"}</td></tr>
          <tr><td>Wartość</td><td>${fmt(cardValue(p.id))}+</td></tr>
          ${cratesRow}
        </table>
        <div class="vi-actions"><button class="btn" data-act="flip">Obróć</button><button class="btn" data-act="close">Zamknij</button></div>
      </div>`;
  } else {
    const R = S.cfg.rarities[p.rarity];
    const type = S.cfg.types[p.type];
    const crate = crateOf(p.crate);
    // szansa z 1 skrzynki: najlepsza ze skrzynek karty (wyjątkowe warianty tylko tam, gdzie są włączone)
    const chance = Math.max(0, ...(p.crates || [p.crate]).filter(crateOf).map(c => rarityShare(c, p.rarity) * variantChance(crateVariants(crateOf(c), p), variant, crateOf(c))));
    // warianty, w których karta może istnieć (np. Rzulty tylko JP2), osobno połączenia z flagą; plus te, które już masz
    const mine = S.items.filter(i => i.person === pid);
    const shown = new Set([...possibleVariants(p), variant, ...mine.map(i => i.variant)]);
    // kafelki: warstwy (flaga, Halloween...) i zwykłe warianty osobno; zaznaczone razem dają połączenie (flag+gold)
    const cur = splitVariant(variant);
    const order = S.cfg.variantOrder.filter(v => shown.has(v));
    const layerList = [...new Set(order.map(v => splitVariant(v).layer).filter(Boolean))];
    const baseList = [...new Set(order.map(v => splitVariant(v).base))];
    const tile = (v, key, val, on, dim = false) => `<button type="button" class="pick vt-tile ${vClass(v)}${on ? " on" : ""}${dim ? " dim" : ""}" style="--rc:${S.cfg.rarities[p.rarity].color}" ${key}="${val}" title="${esc(variantName(v))}">
      <img src="${imgUrl(pid, v, true)}" alt="" loading="lazy" draggable="false"><span class="pn">${esc(variantName(v))}</span><span class="pv">×${String(S.cfg.variants[v].mult).replace(".", ",")}</span></button>`;
    const vpick = `<div class="vi-vpick${VIEWER.tilesOpen ? " open" : ""}">
      <button type="button" class="vi-vhead" data-act="vtoggle" aria-expanded="${VIEWER.tilesOpen}"><span class="vdot ${vtClass(variant)}"></span><span class="muted">Wariant</span><b>${esc(variantName(variant))}</b>
        <svg class="vi-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="vi-vbody">
        ${layerList.length ? `<div class="vi-vlabel">Warstwa <span class="muted">łączy się z wariantem poniżej</span></div>
          <div class="vi-tiles">${layerList.map(l => tile(l, "data-vlayer", l, cur.layer === l)).join("")}</div>` : ""}
        <div class="vi-vlabel">Wariant</div>
        <div class="vi-tiles">${baseList.map(b => tile(b, "data-vbase", b, cur.base === b, !!cur.layer && !shown.has(joinVariant(cur.layer, b)))).join("")}</div>
      </div>
    </div>`;
    const owned = S.cfg.variantOrder.filter(v => mine.some(i => i.variant === v))
      .map(v => `${variantName(v)} ×${mine.filter(i => i.variant === v).length}`).join(", ");
    el.innerHTML = `${stage}
      <div class="viewer-info" style="--rc:${R.color}">
        <div class="vi-rarity">${R.name}${isSpecial(variant) ? ` · <span class="holo-txt">${variantName(variant)}</span>` : ""}</div>
        <h2>${esc(p.name)}</h2>
        <div class="muted">${typeIcon(p.type)} ${type.name} · ${esc(crate.name)} · nr ${String(p.number).padStart(3, "0")}/${String(crate.people.length).padStart(3, "0")}</div>
        ${p.subtitle ? `<div class="vi-subtitle">${esc(p.subtitle)}</div>` : ""}
        ${p.desc ? `<p class="vi-desc">${esc(p.desc)}</p>` : ""}
        <table class="vi-table">
          <tr><td>HP</td><td>${p.hp}</td></tr>
          ${abilitiesOf(p).map((a, i, all) => `<tr><td>${a.kind !== "off" ? kindIcon(a.kind) + " " : ""}${KIND_LABELS[a.kind] || "Atak"}${all.length > 1 ? " " + (i + 1) : ""}</td><td>${esc(a.name)} <b>${a.value}</b></td></tr>`).join("")}
          <tr><td>Słabość / odporność</td><td>${typeIcon(type.weak)} ×2 · ${typeIcon(type.resist)} −20</td></tr>
          <tr><td>Wartość</td><td><b>${fmt(cardValue(pid, variant))}</b> <span class="muted">(×${String(S.cfg.variants[variant].mult).replace(".", ",")})</span></td></tr>
          ${beerRow(variant, uid)}
          ${isSpecialCard(p) ? `<tr><td>Karta specjalna</td><td>tylko w wariancie ${esc(variantName(p.fixedVariant))} · ${sellableCard(p) ? "można ją sprzedać grze, nie da się jej postawić ani zużyć" : "nie da się jej sprzedać grze, postawić ani zużyć"}</td></tr>`
            : `<tr><td>Szansa z 1 skrzynki</td><td>${chance ? "1 na " + Math.round(1 / chance).toLocaleString("pl-PL") : "—"}</td></tr>`}
          ${cratesRow}
          <tr><td>Posiadasz</td><td>${owned || '<span class="muted">brak</span>'}</td></tr>
        </table>
        ${vpick}
        <div class="vi-actions">
          <button class="btn" data-act="flip">Obróć</button>
          <button class="btn" data-act="close">Zamknij</button>
        </div>
        ${viewerActions.myItemFor?.(pid, variant) ? `<div class="vi-actions vi-social">
          <button class="btn primary" data-act="share">Pokaż znajomym</button>
          <button class="btn" data-act="pin">${viewerActions.showcaseHas?.(pid, variant) ? "Zdejmij z gabloty" : "Do gabloty"}</button>
          ${isBlank(variant) && S.items.some(i => i.id === +uid) ? '<button class="btn primary" data-act="draw">Rysuj na karcie</button>' : ""}
          ${scratchable(variant, uid) ? '<button class="btn primary" data-act="scratch">Zdrap kartę</button>' : ""}
        </div>` : ""}
        <div class="muted small">Porusz kursorem nad kartą, aby ją przechylić. Kliknij kartę, aby ją obrócić.</div>
        <button type="button" class="vi-link" data-act="report">Zgłoś problem z kartą</button>
      </div>`;
  }
  document.body.appendChild(el);
  Sound.whoosh();

  el.addEventListener("click", e => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    const vb = e.target.closest("[data-vbase]")?.dataset.vbase, vl = e.target.closest("[data-vlayer]")?.dataset.vlayer;
    if (act === "close" || e.target === el) return closeViewer();
    if (act === "vtoggle") { VIEWER.tilesOpen = !VIEWER.tilesOpen; el.querySelector(".vi-vpick").classList.toggle("open", VIEWER.tilesOpen); e.target.closest("[data-act]").setAttribute("aria-expanded", String(VIEWER.tilesOpen)); return Sound.click(); }
    if (vb || vl) {
      const cur = splitVariant(variant), ok = v => S.cfg.variants[v] && (possibleVariants(p).includes(v) || S.items.some(i => i.person === pid && i.variant === v) || v === variant);
      let next;
      if (vb) next = ok(joinVariant(cur.layer, vb)) ? joinVariant(cur.layer, vb) : vb;   // baza bez pary z warstwą: warstwa odpada
      else next = cur.layer === vl ? cur.base : ok(joinVariant(vl, cur.base)) ? joinVariant(vl, cur.base) : vl;
      if (next !== variant) { Sound.click(); return openViewer(pid, next, next === variant ? uid : null); }
      return;
    }
    if (act === "report") return viewerActions.openReport?.(pid, variant);
    if (act === "share") return viewerActions.openShowDialog?.(pid, variant);
    if (act === "pin") return viewerActions.toggleShowcase?.(pid, variant).then(() => openViewer(pid, variant, uid));
    if (act === "draw") return viewerActions.openDrawing?.(+uid);
    if (act === "scratch") return viewerActions.openScratch?.(+uid);
    if (act === "flip" || e.target.closest(".viewer-flipper")) {
      el.querySelector(".viewer-flipper").classList.toggle("flipped");
      Sound.page();
    }
  });
}

// rozwinięty wybór wariantów zostaje rozwinięty przy kolejnych podglądach
const VIEWER = { tilesOpen: false };

export function closeViewer() { document.querySelector(".viewer")?.remove(); }
export function viewerOpen() { return !!document.querySelector(".viewer"); }

// ================================================================ DESZCZ MONET

export function coinRain(n) {
  const cv = $("#confetti");
  cv.width = innerWidth; cv.height = innerHeight;
  for (let i = 0; i < n; i++) {
    confettiState.parts.push({
      shape: "coin", x: rand(0, cv.width), y: rand(-cv.height * 0.6, -20),
      vx: rand(-1, 1), vy: rand(2, 7), w: rand(16, 26), h: 0, rot: 0, vr: 0,
      c: "#ffc531", life: rand(0, 30),
    });
  }
  if (!confettiState.running) { confettiState.running = true; requestAnimationFrame(confettiFrame); }
}

// ================================================================ ODSŁONIĘCIE TAJNEJ KARTY

export function starPoints(cx, cy, R, r, n) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r : R;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return pts.join(" ");
}

export const secretReveal = epicReveal;


// ================================================================ KONFETTI
export const confettiState = { parts: [], running: false };
export function confetti(colors, count) {
  const cv = $("#confetti");
  cv.width = innerWidth; cv.height = innerHeight;
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    confettiState.parts.push({
      x: fromLeft ? -10 : cv.width + 10, y: cv.height * rand(0.4, 0.8),
      vx: (fromLeft ? 1 : -1) * rand(4, 14), vy: rand(-18, -8),
      w: rand(6, 12), h: rand(8, 16), rot: rand(0, 6.28), vr: rand(-0.3, 0.3),
      c: colors[i % colors.length], life: 0,
    });
  }
  if (!confettiState.running) { confettiState.running = true; requestAnimationFrame(confettiFrame); }
}
export function drawCoin(ctx, p) {
  p.vy -= 0.2; // monety spadają wolniej niż konfetti
  const sx = Math.abs(Math.cos(p.life / 7)) * 0.85 + 0.15, r = p.w / 2;
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(sx, 1);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
  g.addColorStop(0, "#fff6c2"); g.addColorStop(0.5, "#ffc531"); g.addColorStop(1, "#b37a00");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
  ctx.strokeStyle = "#8a5d00"; ctx.lineWidth = 2; ctx.stroke();
  if (sx > 0.5) { ctx.fillStyle = "#8a5d00"; ctx.font = `bold ${r * 0.8}px Rubik, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("gr", 0, 1); }
  ctx.restore();
}
export function confettiFrame() {
  const cv = $("#confetti"), ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  confettiState.parts = confettiState.parts.filter(p => p.y < cv.height + 40 && p.life < 400);
  for (const p of confettiState.parts) {
    p.life++; p.vy += 0.35; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    if (p.shape === "coin") { drawCoin(ctx, p); continue; }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6)));
    ctx.restore();
  }
  if (confettiState.parts.length) requestAnimationFrame(confettiFrame);
  else { confettiState.running = false; ctx.clearRect(0, 0, cv.width, cv.height); }
}
