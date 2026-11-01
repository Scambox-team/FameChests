// @ts-nocheck -- makiety na gotowym HTML, przeniesione ze starego app.js
import { api } from '../../api/client';
import { cardHTML } from '../../cards/cardHtml';
import { openViewer } from '../../fx/effects';
import { crateList, crateOf, isSpecialCard, person, possibleVariants, variantName, variantOn, isCombo, plural, cardValue } from '../../game/rules';
import { S } from '../../game/store';
import { esc, fmt, sleep } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const currentView = () => location.pathname.split('/')[1];

export function renderMockups() {
  const pq = new URLSearchParams(location.search).get("preview");
  if (pq) return renderCardPreview(pq);
  const base = person("pl_tusk") || Object.values(S.cfg.people).find(p => !p.masked && p.rarity !== "secret");
  const crate = crateList().find(c => c.special) || crateOf(base.crate);
  const real = Object.values(S.cfg.people).filter(p => isSpecialCard(p) && !p.id.startsWith("__"))
    .sort((a, b) => a.name.localeCompare(b.name, "pl"));
  const realHTML = `<section class="panel mock-sec mock-real"><h3>Karty specjalne w grze <small class="muted">— ${real.length
    ? "kliknij kartę, żeby zobaczyć ją tak jak w skrzynce" : "brak, dodaj je w panelu admina (rzadkość „Specjalna”)"}</small></h3>
    <div class="mock-grid">${real.map(p => `<figure class="mock"><div class="mock-card" data-real="${esc(p.id)}">${cardHTML(p.id, p.fixedVariant)}</div>
      <figcaption><b>${esc(p.name)}</b><span class="muted small">${esc(variantName(p.fixedVariant))}${
        (S.cfg.variants[p.fixedVariant]?.styles || []).length > 1 ? ` · wygląd ${p.style || 1}. ${esc(S.cfg.variants[p.fixedVariant].styles[(p.style || 1) - 1] || "")}` : ""
      } · ${esc(S.cfg.specialSources[p.source] || "")}</span></figcaption></figure>`).join("")}</div></section>`;
  const sections = S.cfg.specialVariants.map(v => {
    const V = S.cfg.variants[v];
    const cards = (V.styles || ["—"]).map((name, i) => {
      const id = `__mock_${v}_${i + 1}`;   // przykładowa karta tylko na czas budowania HTML
      S.cfg.people[id] = Object.assign({}, base, {
        id, rarity: "special", crate: crate.id, crates: [crate.id], number: i + 1, style: i + 1, fixedVariant: v,
        source: v === "jeans" ? "link" : v === "ufo" ? "ufo" : "casino", imgAs: base.id,
        attack2: base.attack2 || "Specjalny atak", dmg2: base.dmg2 || Math.round(base.dmg * 1.4) });
      const html = `<figure class="mock"><div class="mock-card">${cardHTML(id, v)}</div>
        <figcaption><b>${i + 1}. ${esc(name)}</b><span class="muted small">wygląd ${i + 1} · ${esc(V.name)}</span></figcaption></figure>`;
      delete S.cfg.people[id];
      return html;
    }).join("");
    return `<section class="panel mock-sec"><h3>${{ joker: "", jeans: "", ufo: "" }[v] || ""} ${esc(V.name)} <small class="muted">— ${esc(V.desc || "")}</small></h3>
      <div class="mock-grid">${cards}</div></section>`;
  }).join("");
  $("#mockupsBody").innerHTML = `<div class="mock-head">
      <h2>Makiety kart specjalnych</h2>
      <p class="muted">Rzadkość <b style="color:${S.cfg.rarities.special.color}">${esc(S.cfg.rarities.special.name)}</b>, między Legendarną a ULTRA.
        Na przykładzie: ${esc(base.name)}. Wariant i wygląd każdej karty specjalnej wybierasz w <a href="/admin">panelu admina</a>
        (rzadkość „Specjalna” w edycji karty).</p></div>${realHTML}${sections}`;
  $("#mockupsBody").onclick = e => {
    const card = e.target.closest("[data-real]");
    if (card) { Sound.click(); openViewer(card.dataset.real, person(card.dataset.real).fixedVariant); }
  };
  // podgląd z panelu admina: /mockups?card=<id>&variant=...&style=... (wariant i wygląd mogą być jeszcze niezapisane)
  const q = new URLSearchParams(location.search), pid = q.get("card");
  if (pid && person(pid)) {
    history.replaceState(null, "", location.pathname);
    const p = person(pid), saved = { fixedVariant: p.fixedVariant, style: p.style };
    if (S.cfg.variants[q.get("variant")]?.special) p.fixedVariant = q.get("variant");
    if (+q.get("style") > 0) p.style = +q.get("style");
    try { openViewer(pid, p.fixedVariant); } finally { Object.assign(p, saved); }
  }
}

// Podgląd jednej karty we wszystkich jej możliwych wariantach (possibleVariants) - /mockups?preview=<id>&embed=1, osadzony
// w oknie edycji karty w panelu admina. Dane karty bierzemy z /api/admin/catalog, więc działa też dla tajnej karty (bez
// maski, zdjęcie z ?admin=1) i dla karty ukrytej. Kliknięcie karty = duży podgląd.
async function renderCardPreview(pid) {
  const box = $("#mockupsBody");
  box.innerHTML = '<div class="empty">Ładowanie…</div>';
  let card;
  try { card = (await api("/api/admin/catalog")).cards.find(c => c.id === pid); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!card) { box.innerHTML = '<div class="empty">Nie ma takiej karty.</div>'; return; }
  const p = S.cfg.people[pid] = Object.assign({}, S.cfg.people[pid] || {}, card, { masked: false, imgq: card.rarity === "secret" ? "admin=1" : "" });
  const vs = possibleVariants(p);
  const fig = v => `<figure class="mock"><div class="mock-card" data-pv="${esc(v)}">${cardHTML(pid, v)}</div>
    <figcaption><b>${esc(variantName(v))}</b><span class="muted small">×${(S.cfg.variants[v]?.mult || 1).toLocaleString("pl-PL")} · ${fmt(cardValue(pid, v))}${
      v !== "normal" && !isCombo(v) && !variantOn(v) ? " · wyłączony" : ""}</span></figcaption></figure>`;
  const single = vs.filter(v => !isCombo(v)), combos = vs.filter(isCombo);
  box.innerHTML = `<div class="mock-head"><p class="muted small">${esc(p.name)}, ${single.length} ${plural(single.length, "wariant", "warianty", "wariantów")}${
      combos.length ? ` + ${combos.length} ${plural(combos.length, "połączenie", "połączenia", "połączeń")}` : ""}. Kliknij kartę, żeby ją powiększyć.
      Podgląd pokazuje zapisaną kartę.</p></div>
    <div class="mock-grid pv-grid">${single.map(fig).join("")}</div>
    ${combos.length ? `<details class="pv-combos"><summary>Połączenia wariantów (${combos.length})</summary><div class="mock-grid pv-grid">${combos.map(fig).join("")}</div></details>` : ""}`;
  box.onclick = e => {
    const c = e.target.closest("[data-pv]");
    if (c) { Sound.click(); openViewer(pid, c.dataset.pv); }
  };
}
