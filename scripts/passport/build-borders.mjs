// Granice państw dla Paszportu (server/data/borders.bin).
//
// Źródło: Natural Earth, ne_10m_admin_0_countries (domena publiczna, naturalearthdata.com).
// Skrypt pobiera plik GeoJSON, przypisuje każdy obszar jednemu z 196 państw z
// web/src/features/passport/countries.json (terytoria zależne trafiają do państwa, do którego należą),
// upraszcza granice (Douglas-Peucker, ok. 500 m) i zapisuje zwarty plik binarny, który serwer wbudowuje w scambox.exe.
// Kraj z pozycji GPS serwer ustala sam (point-in-polygon), więc współrzędne gracza nigdzie nie wychodzą.
//
// Wyjątek: Watykan z scripts/passport/vatican.geojson (patrz niżej).
//
// Użycie (z katalogu głównego repozytorium):   node scripts/passport/build-borders.mjs [plik.geojson]
//
// Format borders.bin:  "SBB1", u16 liczba państw (LE); dla każdego: 2 bajty kodu ISO, varint liczba pierścieni;
// pierścień: varint liczba punktów, potem punkty w jednostkach 1e-4 stopnia: pierwszy bezwzględnie (lon, lat),
// kolejne jako różnice - wszystko zigzag + varint (LEB128). Pierścienie są otwarte (ostatni punkt łączy się z pierwszym),
// punkt należy do państwa, gdy leży w nieparzystej liczbie jego pierścieni (reguła parzysto-nieparzysta, więc dziury działają).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson';
const SCALE = 1e4;          // 1e-4 stopnia (ok. 11 m)
const TOL = 0.005;          // tolerancja uproszczenia w stopniach (ok. 500 m; małe państwa dostają mniejszą, zależną od rozmiaru)
const MIN_RING = 0.004;     // mniejsze wysepki (< ok. 400 m) pomijamy - przy brzegu łapie je „najbliższy kraj”

const countries = JSON.parse(fs.readFileSync(path.join(root, 'web/src/features/passport/countries.json'), 'utf8'));
const wanted = new Set(countries.map(c => c.c));

// pobranie (z pamięci podręcznej w katalogu tymczasowym)
let file = process.argv[2];
if (!file) {
  file = path.join(os.tmpdir(), 'ne_10m_admin_0_countries.geojson');
  if (!fs.existsSync(file)) {
    console.log('pobieram', SRC_URL);
    const res = await fetch(SRC_URL);
    if (!res.ok) throw new Error('nie udało się pobrać: ' + res.status);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
// Obrys Watykanu w Natural Earth 10m to ok. 100 m kwadrat (nie obejmuje nawet placu św. Piotra), więc podmieniamy go na dokładniejszy:
// geoBoundaries VAT ADM0 (domena publiczna, źródło: Wikimedia Commons, Flag map of Vatican City.svg), zapisany obok skryptu.
const vatican = JSON.parse(fs.readFileSync(path.join(root, 'scripts/passport/vatican.geojson'), 'utf8')).features[0].geometry;
for (const f of data.features) if (f.properties.ADM0_A3 === 'VAT') f.geometry = vatican;

// obszar -> kod państwa. Domyślnie po „suwerenie” (SOV_A3), a wyjątki wprost.
const SOV = { GB1: 'GB', FR1: 'FR', US1: 'US', AU1: 'AU', NZ1: 'NZ', NL1: 'NL', DN1: 'DK', FI1: 'FI', CH1: 'CN', KA1: 'KZ', CU1: 'CU' };
const ADM = { PSX: 'PS', KOS: 'XK', VAT: 'VA', ISR: 'IL', SOL: 'SO', CYN: 'CY', CNM: 'CY' };
const NONE = new Set(['ATA', 'TWN', 'SAH', 'KAS', 'BRT', 'SPI', 'BRI', 'PGA', 'BJN', 'SER', 'SCR']);
const mainIso = {};
for (const f of data.features) {
  const p = f.properties;
  if (p.ADM0_A3 === p.SOV_A3) mainIso[p.SOV_A3] = p.ISO_A2_EH;
}
function codeOf(p) {
  if (NONE.has(p.ADM0_A3)) return null;
  if (ADM[p.ADM0_A3]) return ADM[p.ADM0_A3];
  if (SOV[p.SOV_A3]) return SOV[p.SOV_A3];
  const iso = mainIso[p.SOV_A3];
  return iso && iso !== '-99' ? iso : null;
}

// Douglas-Peucker (iteracyjnie), zamknięty pierścień bez powtórzonego ostatniego punktu
function simplify(pts, tol) {
  const n = pts.length;
  if (n <= 4) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bd = tol * tol;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
      const d = ex * ex + ey * ey;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const byCode = new Map();
let dropped = 0;
for (const f of data.features) {
  const code = codeOf(f.properties);
  if (!code) continue;
  if (!wanted.has(code)) throw new Error('kod spoza listy: ' + code + ' (' + f.properties.ADMIN + ')');
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = byCode.get(code) ?? [];
  for (const poly of polys) {
    for (const ring of poly) {
      let pts = ring.map(([x, y]) => [x, y]);
      if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const diag = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      pts = simplify(pts, Math.min(TOL, diag / 60));
      // po kwantyzacji usuwamy powtórzenia, żeby pierścień nie miał zerowych krawędzi
      const q = [];
      for (const [x, y] of pts) {
        const px = Math.round(x * SCALE), py = Math.round(y * SCALE);
        const last = q.at(-1);
        if (!last || last[0] !== px || last[1] !== py) q.push([px, py]);
      }
      if (q.length > 1 && q[0][0] === q.at(-1)[0] && q[0][1] === q.at(-1)[1]) q.pop();
      if (q.length >= 3) rings.push({ q, diag });
    }
  }
  byCode.set(code, rings);
}
// wysepki mniejsze niż MIN_RING pomijamy, ale każde państwo zachowuje przynajmniej swój największy pierścień (Watykan)
for (const [code, rings] of byCode) {
  const big = rings.filter(r => r.diag >= MIN_RING);
  dropped += rings.length - big.length;
  byCode.set(code, (big.length ? big : [rings.reduce((a, b) => (b.diag > a.diag ? b : a))]).map(r => r.q));
}
const missing = [...wanted].filter(c => !(byCode.get(c)?.length));
if (missing.length) throw new Error('brak granic dla: ' + missing.join(', '));

const bytes = [];
const u8 = n => bytes.push(n & 255);
const varint = n => { while (n >= 128) { bytes.push((n & 127) | 128); n = Math.floor(n / 128); } bytes.push(n); };
const zig = n => varint(n < 0 ? -2 * n - 1 : 2 * n);
bytes.push(...Buffer.from('SBB1'));
u8(byteCount(wanted.size)); u8(wanted.size >> 8);
function byteCount(n) { return n & 255; }
let points = 0;
for (const c of countries) {
  const rings = byCode.get(c.c);
  bytes.push(c.c.charCodeAt(0), c.c.charCodeAt(1));
  varint(rings.length);
  for (const r of rings) {
    varint(r.length);
    zig(r[0][0]); zig(r[0][1]);
    for (let i = 1; i < r.length; i++) { zig(r[i][0] - r[i - 1][0]); zig(r[i][1] - r[i - 1][1]); }
    points += r.length;
  }
}
const out = path.join(root, 'server/data/borders.bin');
fs.writeFileSync(out, Buffer.from(bytes));
console.log(`państw: ${wanted.size}, punktów: ${points}, pominięte wysepki: ${dropped}, plik: ${(bytes.length / 1024).toFixed(0)} KB -> ${path.relative(root, out)}`);
