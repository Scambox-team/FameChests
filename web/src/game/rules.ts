// @ts-nocheck -- reguły przeniesione bez zmian ze starego app.js; typy dochodzą przy dalszym porządkowaniu
// Zasady gry wspólne dla wszystkich ekranów (warianty, wartości, sortowanie). Te same reguły liczy serwer.
import { S } from './store';

export const GEMS = ["emerald", "amethyst", "ruby", "sapphire", "diamond", "blackdiamond"];   // wspólny wygląd, inne kolory
export const rand = (a, b) => a + Math.random() * (b - a);
export const isBlank = v => variantParts(v || "").includes("blank");

export function rarityIdx(r) { return S.cfg.rarityOrder.indexOf(r); }
export function varRank(v) { return S.cfg.variantOrder.indexOf(v || "normal"); }
// warianty wyjątkowe (Królewski, Flagowy...) nie wypadają z kontraktu, ulepszacza ani kasyna
export function isExclusive(v) { return !!S.cfg.variants[v]?.exclusive; }
// wariant, który może dać kuźnia i kasyno: nie wyjątkowy i nie zablokowany przez admina ("noHouse", strona /variants)
export function houseVariant(v) { return !isExclusive(v) && !variantParts(v).some(x => S.cfg.variantCfg?.[x]?.noHouse); }
// warianty specjalne, które mogą wypaść z tej skrzynki: każdy wariant tylko wtedy, gdy jest przypięty do skrzynki
// (pole skrzynki "variants", panel admina) - flagowy tylko dla kart z ustawionym krajem
// (warianty z polem "cards", np. Rzulty, należą do konkretnych kart - nie do skrzynki)
// (połączenia "flag+gold" nie wypadają osobno - patrz variantChance)
// (jak catalog.drop_variants: wyłączone warianty nie wypadają, a trwające wydarzenie włącza wariant w swoich skrzynkach)
export function crateVariants(crate, p = null) {
  return S.cfg.variantOrder.filter(v => {
    if (!isSpecial(v)) return false;
    const V = S.cfg.variants[v];
    if (V.combo || V.special) return false;
    if (V.cards && !(p && V.cards.includes(p.id))) return false;
    if (v === "flag" && p && !p.country) return false;
    if (variantEvent(v, crate?.id)) return true;
    if (!variantOn(v)) return false;
    return (!!V.cards && !V.crateOnly) || (crate?.variants || []).includes(v);
  });
}
// Ustawienia wariantów ze strony /variants (catalog.variant_cfg_json): włączony / wyłączony i wydarzenia - od-do wariant
// wypada ze wszystkich albo z wybranych skrzynek (e.crates puste = wszystkie), boost = mnożnik szansy
export function variantOn(v) { return S.cfg.variantCfg?.[v]?.enabled ?? !S.cfg.variants[v]?.off; }
export function variantEvent(v, crateId, now = Date.now() / 1000) {
  return (S.cfg.variantCfg?.[v]?.events || []).find(e => e.start <= now && now < e.end && (!e.crates.length || e.crates.includes(crateId))) || null;
}
// wariant już był w grze (włączony kiedykolwiek albo po wydarzeniu) - tylko takie pokazujemy w klaserze
export function variantReleased(v) { return !!S.cfg.variants[v]?.extraSource || (S.cfg.variantCfg?.[v]?.released ?? !S.cfg.variants[v]?.off); }
// szansa na wariant z mnożnikiem trwającego wydarzenia w tej skrzynce
export function vChance(v, crate) { return S.cfg.variants[v].chance * (variantEvent(v, crate?.id)?.boost || 1); }
// Warianty, w których ta karta może istnieć (jak catalog.possible_variants): zwykłe zawsze, wyjątkowe tylko z jej skrzynek,
// własne warianty karty (Rzulty - tylko Jan Paweł II) i połączenia flagi z każdym z nich
export function possibleVariants(p) {
  if (isSpecialCard(p)) return [p.fixedVariant];   // karta specjalna istnieje tylko w jednym wariancie
  const extra = new Set(), V = S.cfg.variants, crates = p.crates || [p.crate], now = Date.now() / 1000;
  crates.forEach(c => { if (crateOf(c)) (crateOf(c).variants || []).forEach(v => { if ((v !== "flag" || p.country) && variantReleased(v)) extra.add(v); }); });
  S.cfg.variantOrder.forEach(v => {   // własne warianty karty i warianty z wydarzeń (już rozpoczętych) w jej skrzynkach
    if (V[v].cards?.includes(p.id) || (!V[v].special && (v !== "flag" || p.country) && (S.cfg.variantCfg?.[v]?.events || [])
      .some(e => e.start <= now && (!e.crates.length || e.crates.some(c => crates.includes(c)))))) extra.add(v);
  });
  const base = S.cfg.variantOrder.filter(v => !V[v].combo && (v === "normal" || extra.has(v) || (!V[v].exclusive && variantReleased(v))));
  const combos = new Set(base.filter(l => V[l].layer && !V[l].noCombo).flatMap(l => base.filter(b => b !== "normal" && !V[b].layer).map(b => `${l}+${b}`)));
  return S.cfg.variantOrder.filter(v => base.includes(v) || combos.has(v));
}
// Warstwy wariantu: flaga leży na osobnej warstwie, więc karta może być np. "flag+gold" (Flagowa + Złota)
export function variantParts(v) { return S.cfg.variants[v || "normal"]?.layers || [v || "normal"]; }
export function isCombo(v) { return !!S.cfg.variants[v]?.combo; }
// warstwa (flaga, Halloween, Lampionowa, Diabelska) leży na zwykłym wariancie: "flag+gold" = warstwa flag + baza gold
export const isLayer = v => !!S.cfg.variants[v]?.layer;
export function splitVariant(v) {
  const p = variantParts(v);
  if (p.length > 1) return { layer: p[0], base: p[p.length - 1] };
  return isLayer(v) ? { layer: v, base: "normal" } : { layer: null, base: v || "normal" };
}
export function joinVariant(layer, base) { return !layer ? base : base === "normal" ? layer : `${layer}+${base}`; }
// warianty do filtrów (ekwipunek, rynek): tylko te, które są albo były w grze (połączenie - gdy każda warstwa była),
// plus te, które gracz ma (np. karta od admina w niewydanym wariancie); bez połączeń z wariantami "noCombo"
// (Lampionowa, Diabelska - zawsze same) i z wariantami konkretnych kart (Rzulty)
export function filterVariants(owned = S.items) {
  const mine = new Set(owned.map(i => i.variant));
  const combo = v => S.cfg.variants[v]?.combo;
  const lone = x => S.cfg.variants[x]?.noCombo || S.cfg.variants[x]?.cards;
  return S.cfg.variantOrder.filter(v => mine.has(v) || (!S.cfg.variants[v]?.special && variantParts(v).every(variantReleased) &&
    !(combo(v) && variantParts(v).some(lone))));
}
// wariant z warstwy zwykłych wariantów (bez flagi) - od niego zależy zdjęcie i kolor plakietki
export function baseVariant(v) { const parts = variantParts(v); return parts[parts.length - 1]; }
// klasy wyglądu: "v-flag v-gold v-combo" (prefix "avv-" dla ikon graczy)
export function vClass(v, prefix = "v-") {
  const parts = variantParts(v);
  return parts.map(x => prefix + x).join(" ") + (parts.length > 1 ? ` ${prefix}combo` : "");
}
// klasa koloru (kropki, plakietki, przyciski): połączony wariant = kolor zwykłego wariantu z obwódką flagi
export function vtClass(v) { return isCombo(v) ? `vt-${baseVariant(v)} vt-combo vt-l-${variantParts(v)[0]}` : `vt-${v || "normal"}`; }

export function variantChance(avail, v, crate = null) {
  const V = S.cfg.variants, ch = x => vChance(x, crate);
  // warianty "always" (halloweenowe): w tej skrzynce każda karta ma jeden z nich (wg "weight"), zwykły losuje się normalnie
  const always = avail.filter(x => V[x].always);
  if (always.length) {
    const w = x => (V[x].weight || 1) * (variantEvent(x, crate?.id)?.boost || 1);
    const share = x => always.includes(x) ? w(x) / always.reduce((a, y) => a + w(y), 0) : 0;
    const bases = avail.filter(x => !V[x].layer), rest = 1 - bases.reduce((a, x) => a + ch(x), 0);
    // "noCombo" (Lampionowa, Diabelska): karta ma tylko ten wariant, bez zwykłego
    if (!isCombo(v)) return share(v) * (V[v]?.noCombo ? 1 : rest);
    const layer = variantParts(v)[0];
    return bases.includes(baseVariant(v)) && !V[layer].noCombo ? share(layer) * ch(baseVariant(v)) : 0;
  }
  if (!isSpecial(v)) return 1 - avail.reduce((a, x) => a + ch(x), 0);
  if (isCombo(v)) {
    const [layer, base] = variantParts(v);
    const bases = avail.filter(x => !V[x].layer), tot = bases.reduce((a, x) => a + ch(x), 0);
    return avail.includes(layer) && bases.includes(base) && tot ? ch(layer) * V[layer].extraChance * ch(base) / tot : 0;
  }
  if (!avail.includes(v)) return 0;
  return ch(v) * (1 - (V[v].extraChance || 0));
}

export function dupKey(x) {
  const v = x.variant || "normal", id = +x.id > 0 ? +x.id : null, base = x.person + "|" + v;
  if (id && isBlank(v) && S.drawn.has(id)) return `${base}|#${id}`;
  const sub = id ? beerSub(v, id) : null;
  return sub ? `${base}|${sub.id}` : base;
}
export function ownCounts() {
  const m = new Map();
  for (const i of S.items) m.set(dupKey(i), (m.get(dupKey(i)) || 0) + 1);
  return m;
}
export function sortCards(list, mode = "value") {
  const name = x => { const p = person(x.person); return !p || p.masked ? "￿" : p.name; };
  const byName = (a, b) => name(a).localeCompare(name(b), "pl");
  const num = x => (typeof x.id === "number" ? x.id : 0);
  let dup = () => 0;
  if (mode.startsWith("dupes")) {   // moje karty: ile mam ich łącznie (też ⭐), cudze (wymiany): ile jest ich na tej liście
    const own = ownCounts(), mine = new Set(S.items.map(i => i.id)), here = new Map();
    for (const x of list) here.set(dupKey(x), (here.get(dupKey(x)) || 0) + 1);
    dup = x => (mine.has(x.id) ? own : here).get(dupKey(x)) || 0;
  }
  const cmp = {
    // duplikaty na górze (najwięcej egzemplarzy najpierw), takie same karty obok siebie
    dupes: (a, b) => (dup(b) > 1) - (dup(a) > 1) || dup(b) - dup(a) || byName(a, b) || varRank(b.variant) - varRank(a.variant) || b.value - a.value,
    // duplikaty na górze, najdroższe najpierw (wartość jednej karty), takie same karty obok siebie
    dupesValue: (a, b) => (dup(b) > 1) - (dup(a) > 1) || b.value - a.value || byName(a, b) || varRank(b.variant) - varRank(a.variant),
    value: (a, b) => b.value - a.value || byName(a, b),
    valueAsc: (a, b) => a.value - b.value || byName(a, b),
    rarity: (a, b) => rarityIdx(person(b.person).rarity) - rarityIdx(person(a.person).rarity) || varRank(b.variant) - varRank(a.variant) || byName(a, b),
    variant: (a, b) => varRank(b.variant) - varRank(a.variant) || b.value - a.value || byName(a, b),
    name: (a, b) => byName(a, b) || varRank(b.variant) - varRank(a.variant),
    new: (a, b) => num(b) - num(a) || b.value - a.value,
  }[mode] || ((a, b) => b.value - a.value);
  return list.slice().sort(cmp);
}

export function searchNorm(s) { return String(s || "").toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
export function cardSearchText(pid, variant) {
  const p = person(pid);
  return p ? searchNorm(`${p.name} ${variantName(variant)} ${S.cfg.rarities[p.rarity].name}`) : "";
}
export function searchMatch(text, q) { return searchNorm(q).split(/\s+/).filter(Boolean).every(w => text.includes(w)); }
export function cardMatches(x, q) { return !q || !q.trim() || searchMatch(cardSearchText(x.person, x.variant), q); }

export function flagUrl(country) { return `/flag/${encodeURIComponent(country)}.svg`; }
export function person(id) { return S.cfg.people[id]; }
// karta specjalna (rzadkość Specjalna): tylko z kasyna albo z linku, jeden wariant; nie da się jej sprzedać grze,
// postawić ani zużyć w kuźni (można ją wymienić albo sprzedać na rynku). p - karta albo jej id.
export function isSpecialCard(p) { p = typeof p === "string" ? person(p) : p; return p?.rarity === "special"; }
export function crateOf(id) { return S.cfg.crates[id] ?? testCrates()[id]; }

// Skrzynki testowe adminów: każda daje tylko karty jednej rzadkości, żeby obejrzeć animację odsłonięcia.
// Istnieją tylko w przeglądarce (opening.ts: testOpen) - nic nie idzie do serwera, ekwipunku, rankingu ani Hall of Fame.
const TEST_CRATES = [["gold", "👑", "#e5b94a", "#3b2806"], ["ultra", "🃏", "#c58bff", "#1c0b38"], ["secret", "🃏", "#f3e3b0", "#0a0a0c"]];
let testCfg = null, testCache = {};
export function testCrates() {
  if (!S.me?.isAdmin) return {};
  if (testCfg === S.cfg) return testCache;
  testCfg = S.cfg; testCache = {};
  const all = Object.keys(S.cfg.people).filter(id => S.cfg.people[id].rarity !== "special");
  const weights = Object.fromEntries(S.cfg.rarityOrder.map((r, i) => [r, Math.max(1, 2 ** (S.cfg.rarityOrder.length - i))]));
  for (const [r, emoji, color1, color2] of TEST_CRATES) {
    const pool = all.filter(id => S.cfg.people[id].rarity === r), name = S.cfg.rarities[r]?.name;
    if (!pool.length || !name) continue;
    const id = `__test_${r}`;
    testCache[id] = { id, name: `Test: ${name}`, short: `Test: ${name}`, code: "", desc: "Skrzynka testowa admina, karty nie trafiają do ekwipunku", emoji, price: 0, color1, color2,
      shop: false, canBuy: true, test: r, pool, people: all, weights };
  }
  return testCache;
}
export function crateList() { return S.cfg.crateOrder.map(id => S.cfg.crates[id]); }
// skrzynki, które są albo były już w sklepie (i skrzynka kart specjalnych) - klaser i filtr ekwipunku nie zdradzają
// skrzynek, których jeszcze nie było (serwer: released_crates)
export function seenCrateList() { return crateList().filter(c => c.released !== false); }
export function isSpecial(v) { return !!v && v !== "normal"; }
export function variantName(v) { return S.cfg.variants[v || "normal"].name; }
export function cardValue(pid, v = "normal") {
  const p = person(pid);  // valueMult: karty tylko z droższych skrzynek są warte więcej (liczy serwer)
  return Math.round(S.cfg.rarities[p.rarity].value * (p.valueMult || 1) * S.cfg.variants[v || "normal"].mult);
}
// zdjęcie karty; wariant z własnym zdjęciem (np. Rzulty Jana Pawła II) -> /img/<id>/<wariant>
// (połączony wariant, np. halloween+gold: zdjęcie tej warstwy, która ma własne zdjęcie)
// small - mały kafelek (bęben, kuźnia, kasyno...): serwer wysyła lekką miniaturę zamiast pełnego zdjęcia
export function imgUrl(pid, variant: any = null, small = false) {
  // część wariantu z własnym zdjęciem, a gdy brak - zdjęcie z "photoFallback" (Lampionowa -> Halloweenowa)
  const p = person(pid), has = x => x && p.variantPhotos?.[x] != null, parts = variant ? variantParts(variant) : [];
  const part = parts.find(has) || parts.map(x => S.cfg?.variants[x]?.photoFallback).find(has);
  const vv = part ? p.variantPhotos[part] : null;
  return `/img/${p.imgAs || pid}${vv != null ? "/" + part : ""}?v=${vv ?? (p.imgv || 0)}${small ? "&s=1" : ""}${p.imgq ? "&" + p.imgq : ""}`;
}

export function beerSub(variant, uid) {
  const subs = S.cfg.variants.beer?.subs;
  if (uid == null || uid === "" || !subs?.length || !variantParts(variant).includes("beer")) return null;
  let h = Math.imul((+uid >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;   // >>> 0 - bez tego wynik bywa ujemny
  let r = h % subs.reduce((a, s) => a + s.weight, 0);
  return subs.find(s => (r -= s.weight) < 0) || subs[0];
}

export function abilitiesOf(p) {
  const list = [{ name: p.attack, kind: p.kind1 || "off", value: p.dmg }];
  if (p.attack2) list.push({ name: p.attack2, kind: p.kind2 || "off", value: p.dmg2 });
  return list.concat(p.abilities || []);
}


export function rarityShare(crateId, rarity) {
  const crate = crateOf(crateId);
  if (!crate) return 0;
  const present = new Set(crate.people.map(id => person(id).rarity));
  const total = S.cfg.rarityOrder.filter(r => present.has(r)).reduce((a, r) => a + crate.weights[r], 0);
  const inR = crate.people.filter(id => person(id).rarity === rarity).length;
  return present.has(rarity) && total ? crate.weights[rarity] / total / inR : 0;
}

export function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, dd = n % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
}
