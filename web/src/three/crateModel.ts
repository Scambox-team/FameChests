// @ts-nocheck -- geometria Three.js; typy dochodzą przy dalszym porządkowaniu
// Model skrzynki wspólny dla sceny w sklepie, ikon skrzynek i wielkiego odsłonięcia karty.
// Geometrie i materiały tworzy się raz na renderer, kolejne skrzynki są tylko kopiami siatek.
import * as THREE from 'three';
import { sceneTheme } from './sceneTheme';

export const LID_OPEN = -1.95;

/** Wygląd skrzynki: kolor wieka, kolor korpusu, kolor przewodni, emotka na emblemacie (albo ścieżka siatki 24 x 24, gdy emotki brak) */
export interface CrateLook { c1: string; c2: string; hue: string; d: string; emoji?: string }

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
export function box(w, h, d, r = .05) {
  const b = r * .6;
  const g = new THREE.ExtrudeGeometry(roundedRect(w - b * 2, h - b * 2, r), { depth: d - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 6 });
  g.center();
  return g;
}
// wieko: profil w płaszczyźnie głębokość-wysokość, wyciągnięty na szerokość skrzynki
function lidGeo(w, d, h) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(d / 2, h * .32);
  s.quadraticCurveTo(d / 2, h, 0, h); s.quadraticCurveTo(-d / 2, h, -d / 2, h * .32); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 2, curveSegments: 18 });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return g;
}
export function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, '#fff'); g.addColorStop(.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
export function emblemTexture(d, c1, c2, emoji = '') {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = c1; x.fillRect(0, 0, 256, 256);
  if (emoji) {
    x.font = "150px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(emoji, 128, 140);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  x.translate(128 - 84, 128 - 84); x.scale(7, 7);
  x.strokeStyle = c2; x.lineWidth = 1.9; x.lineCap = 'round'; x.lineJoin = 'round';
  x.stroke(new Path2D(d));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Proste otoczenie, żeby metal miał w czym się odbijać */
export function crateEnvironment(renderer) {
  const th = sceneTheme();
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(th.envBg);
  for (const [x, y, z, s, c] of th.envPanels) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, .2), new THREE.MeshBasicMaterial({ color: c }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(envScene, .05).texture;
  return { texture, dispose() { texture.dispose(); pmrem.dispose(); } };
}

/** Zestaw do budowania skrzynek: wspólne geometrie i materiały, kolory zmienia setLook */
export function crateKit() {
  const th = sceneTheme(), tm = th.mats;
  // motyw ze szklanym lakierem (Frutiger Aero) używa materiału fizycznego z warstwą lakieru
  const paint = (p) => p.clearcoat ? new THREE.MeshPhysicalMaterial(p) : new THREE.MeshStandardMaterial(p);
  const mat = {
    body: paint(tm.body),
    lid: paint(tm.lid),
    trim: new THREE.MeshStandardMaterial(tm.trim),
    emblem: new THREE.MeshStandardMaterial({ roughness: .4, metalness: .1 }),
    // światło ze środka widać dopiero po uchyleniu wieka
    inner: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 })
  };
  const geo = {
    body: box(2.6, 1.2, 1.7, .06), base: box(2.74, .12, 1.84, .05), rimTop: box(2.68, .09, 1.78, .04), band: box(.24, 1.24, 1.76, .03), plate: box(.66, .72, .1, .04),
    emblem: new THREE.CircleGeometry(.25, 40), lid: lidGeo(2.6, 1.7, .68), lidBand: lidGeo(.24, 1.76, .72), lock: box(.34, .3, .07, .03), inner: new THREE.PlaneGeometry(2.4, 1.5)
  };
  let emblemKey = '';

  /** Nowa skrzynka: grupa z korpusem i wiekiem na zawiasie z tyłu (lid.rotation.x = LID_OPEN otwiera) */
  function build(m = mat) {
    const g = new THREE.Group();
    const add = (gm, mm, x, y, z, parent = g) => { const o = new THREE.Mesh(gm, mm); o.position.set(x, y, z); parent.add(o); return o; };
    add(geo.body, m.body, 0, .62, 0);
    add(geo.base, m.trim, 0, .06, 0);
    add(geo.rimTop, m.trim, 0, 1.2, 0);
    for (const sx of [-.86, .86]) add(geo.band, m.trim, sx, .62, 0);
    add(geo.plate, m.trim, 0, .86, .89);
    add(geo.emblem, m.emblem, 0, .86, .945);
    const lid = new THREE.Group();
    lid.position.set(0, 1.25, -.86);
    g.add(lid);
    add(geo.lid, m.lid, 0, 0, .86, lid);
    for (const sx of [-.86, .86]) add(geo.lidBand, m.trim, sx, 0, .86, lid);
    add(geo.lock, m.trim, 0, .02, 1.75, lid);
    add(geo.inner, m.inner, 0, 1.23, 0).rotation.x = -Math.PI / 2;
    return { g, lid };
  }
  /** Kolory od razu (bez płynnego przejścia) i emblemat */
  function setLook(look: CrateLook) {
    mat.body.color.set(look.c2); mat.lid.color.set(look.c1);
    setEmblem(look);
  }
  function setEmblem(look: CrateLook) {
    const key = `${look.emoji || look.d}|${look.c1}|${look.c2}`;
    if (key === emblemKey) return;
    emblemKey = key;
    mat.emblem.map?.dispose();
    mat.emblem.map = emblemTexture(look.d, look.c1, look.c2, look.emoji); mat.emblem.needsUpdate = true;
    mat.emblem.color.set('#ffffff');
  }
  function dispose() {
    Object.values(geo).forEach(g => g.dispose());
    mat.emblem.map?.dispose();
    Object.values(mat).forEach(m => m.dispose());
  }
  return { mat, geo, build, setLook, setEmblem, dispose };
}
