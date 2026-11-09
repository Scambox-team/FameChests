// @ts-nocheck -- dane wyścigu przychodzą z serwera bez typów (jak w horsesEngine.ts)
// Wyścigi konne 3D: nocny stadion z reflektorami, okrągły tor jak na płótnie 2D (tory koni = promienie R0 + i * DR),
// konie z galopem, dżokeje w barwach konia, przedmioty ze skrzynek, samochód i kamery: realizacja TV, za koniem,
// z pierwszej osoby (oczami konia) i z góry. Przebieg liczy serwer; scena tylko odtwarza race.x i race.events w chwili T.
import * as THREE from 'three';
import { softDot } from './crateModel';
import { sceneTheme } from './sceneTheme';

const TAU = Math.PI * 2;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// płótno 2D: środek 320, tor 0 na promieniu 160 px, kolejne co 13.4 px; tutaj 1 px = 0.1 jednostki
const R0 = 16, DR = 1.34, R_IN = 14.7, R_OUT = 29.7;
export const laneR = (i: number) => R0 + i * DR;
export const ang = (x: number) => -Math.PI / 2 + x * TAU;
const COATS = ['#6b3e1f', '#8a4a22', '#1d1713', '#9c968e', '#d8d2c8', '#c39a55', '#4a2b17', '#2c2622', '#7a5232', '#b07a45'];
export type HorseCam = 'tv' | 'chase' | 'fpv' | 'top';

/** Emotka narysowana na płótnie jako tekstura duszka (wspólna dla wszystkich duszków z tą emotką) */
const emojiCache: Record<string, THREE.SpriteMaterial> = {};
function emojiMat(e: string) {
  if (emojiCache[e]) return emojiCache[e];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.font = "100px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(e, 64, 72);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return emojiCache[e] = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
}
function emojiSprite(e: string, size = 1) {
  const s = new THREE.Sprite(emojiMat(e)); s.scale.setScalar(size); return s;
}

function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Tor z góry: piach, linie torów, meta w szachownicę (płaskie UV pierścienia: płótno x = świat x, płótno y = świat z) */
function trackTexture() {
  return canvasTex(2048, 2048, x => {
    const c = 1024, k = c / R_OUT;
    x.fillStyle = '#4a3220'; x.fillRect(0, 0, 2048, 2048);
    for (let i = 0; i < 60000; i++) {
      x.fillStyle = Math.random() < .5 ? '#ffffff08' : '#0000001a';
      x.fillRect(Math.random() * 2048, Math.random() * 2048, 2 + Math.random() * 3, 2);
    }
    // ślady kopyt: ciemniejsze pasy wzdłuż torów
    for (let i = 0; i < 10; i++) { x.strokeStyle = '#2a1a0e55'; x.lineWidth = DR * k * .5; x.beginPath(); x.arc(c, c, laneR(i) * k, 0, TAU); x.stroke(); }
    x.strokeStyle = '#ffffff22'; x.lineWidth = 2;
    for (let i = 0; i <= 10; i++) { x.beginPath(); x.arc(c, c, (laneR(i) - DR / 2) * k, 0, TAU); x.stroke(); }
    // meta: kąt -90° (góra płótna), szachownica w poprzek wszystkich torów
    const sq = .45 * k;
    for (let r = R_IN * k, j = 0; r < R_OUT * k; r += sq, j++) for (let i = 0; i < 3; i++) {
      x.fillStyle = (i + j) % 2 ? '#111' : '#f2f2f2';
      x.fillRect(c - 1.5 * sq + i * sq, c - r - sq, sq, sq);
    }
  });
}

function grassTexture(text = '') {
  return canvasTex(1024, 1024, x => {
    for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#12301b' : '#15381f'; x.fillRect(i * 64, 0, 64, 1024); }
    for (let i = 0; i < 26000; i++) { x.fillStyle = Math.random() < .5 ? '#ffffff05' : '#00000012'; x.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 3); }
    if (text) {
      x.save(); x.translate(512, 512);
      x.strokeStyle = '#ffffff30'; x.lineWidth = 6; x.beginPath(); x.arc(0, 0, 330, 0, TAU); x.stroke();
      x.font = '800 120px "Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#ffffff2a';
      x.fillText(text, 0, -40);
      x.font = '700 54px "Hanken Grotesk", system-ui, sans-serif'; x.fillText('DERBY', 0, 70);
      x.restore();
    }
  });
}

// ------------------------------------------------------------------------------------------------- koń
function buildHorse(color: string, coatHex: string, num: number, geo, shared) {
  const coat = new THREE.MeshStandardMaterial({ color: coatHex, roughness: .5, metalness: .05 });
  const silk = new THREE.MeshStandardMaterial({ color, roughness: .35, metalness: .1, emissive: color, emissiveIntensity: .12 });
  const numTex = canvasTex(256, 128, x => {
    x.fillStyle = color; x.fillRect(0, 0, 256, 128);
    x.fillStyle = '#fff'; x.beginPath(); x.ellipse(128, 64, 58, 50, 0, 0, TAU); x.fill();
    x.fillStyle = '#111'; x.font = '900 80px "Bricolage Grotesque", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(num), 128, 70);
  });
  const cloth = new THREE.MeshStandardMaterial({ map: numTex, roughness: .6 });
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const part = (gm, mat, px, py, pz, sx = 1, sy = 1, sz = 1, rx = 0) => { const m = new THREE.Mesh(gm, mat); m.position.set(px, py, pz); m.scale.set(sx, sy, sz); m.rotation.x = rx; body.add(m); return m; };
  part(geo.sphere, coat, 0, 1.22, 0, .38, .4, .92);
  part(geo.sphere, coat, 0, 1.27, -.58, .4, .42, .45);
  part(geo.sphere, coat, 0, 1.18, .58, .36, .44, .42);
  const head = new THREE.Group(); body.add(head);
  const neck = new THREE.Mesh(geo.neck, coat); neck.position.set(0, 1.62, .95); neck.rotation.x = .75; head.add(neck);
  const mane = new THREE.Mesh(geo.mane, shared.dark); mane.position.set(0, 1.72, .86); mane.rotation.x = .75; head.add(mane);
  const skull = new THREE.Group(); skull.position.set(0, 1.98, 1.28); head.add(skull);
  const s1 = new THREE.Mesh(geo.skull, coat); s1.rotation.x = 2.05; s1.position.set(0, -.06, .16); skull.add(s1);
  for (const sx of [-1, 1]) { const ear = new THREE.Mesh(geo.ear, coat); ear.position.set(sx * .07, .16, -.06); ear.rotation.z = -sx * .2; skull.add(ear); }
  const eyeL = new THREE.Mesh(geo.eye, shared.eye); eyeL.position.set(.11, .02, .05); skull.add(eyeL);
  const eyeR = new THREE.Mesh(geo.eye, shared.eye); eyeR.position.set(-.11, .02, .05); skull.add(eyeR);
  const tail = new THREE.Group(); tail.position.set(0, 1.4, -1.0); body.add(tail);
  const tm = new THREE.Mesh(geo.tail, shared.dark); tm.position.set(0, -.3, -.12); tm.rotation.x = -.45; tail.add(tm);
  const cl = new THREE.Mesh(geo.cloth, [cloth, cloth, silk, silk, silk, silk]); cl.position.set(0, 1.5, -.05); body.add(cl);
  // nogi: biodro -> kolano -> kopyto; galop to obrót bioder i zgięcie kolan w czterotakcie
  const legs = [];
  for (const [sx, z, front, off] of [[1, .58, true, .55], [-1, .58, true, .8], [1, -.55, false, 0], [-1, -.55, false, .25]]) {
    const hip = new THREE.Group(); hip.position.set(sx * .2, 1.08, z); body.add(hip);
    const up = new THREE.Mesh(geo.upper, coat); up.position.y = -.28; hip.add(up);
    const knee = new THREE.Group(); knee.position.y = -.56; hip.add(knee);
    const low = new THREE.Mesh(geo.lower, coat); low.position.y = -.23; knee.add(low);
    const hoof = new THREE.Mesh(geo.hoof, shared.dark); hoof.position.y = -.48; knee.add(hoof);
    legs.push({ hip, knee, front, off });
  }
  // dżokej w barwach konia, pochylony do przodu
  const jockey = new THREE.Group(); jockey.position.set(0, 1.64, .1); body.add(jockey);
  const torso = new THREE.Mesh(geo.torso, silk); torso.position.set(0, .26, .08); torso.rotation.x = .95; jockey.add(torso);
  const jh = new THREE.Mesh(geo.jhead, shared.skin); jh.position.set(0, .5, .34); jockey.add(jh);
  const helmet = new THREE.Mesh(geo.helmet, silk); helmet.position.set(0, .54, .33); jockey.add(helmet);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(geo.arm, silk); arm.position.set(sx * .17, .28, .42); arm.rotation.x = 1.25; jockey.add(arm);
    const leg = new THREE.Mesh(geo.jleg, shared.white); leg.position.set(sx * .3, -.05, .05); leg.rotation.x = -.6; jockey.add(leg);
  }
  const shadow = new THREE.Mesh(geo.shadow, shared.shadow); shadow.rotation.x = -Math.PI / 2; shadow.position.y = .02;
  return { g, body, head, jockey, tail, legs, coat, silk, shadow, phase: Math.random() * TAU, yaw: 0, dir: 1, fallZ: 0, dispose() { coat.dispose(); silk.dispose(); cloth.dispose(); numTex.dispose(); } };
}

export interface HorsesHud { mode: HorseCam; focus: number; order: { id: number; out: string | null }[]; speed: number; fx: number; flash: number }

export function createHorsesScene(canvas: HTMLCanvasElement, o: {
  horses: { id: number; name: string; color: string }[];
  clock: () => { race: any; T: number; solo: boolean };
  interp: (arr: number[], T: number, dt: number, scale: number) => number;
  state: (race: any, h: number, T: number) => any;
  carX: (race: any, T: number) => number | null;
  finish: (race: any) => number | null;
  boxRows: () => number[];
  itemIcon: (it: string) => string;
  info: () => { top: string; big: string; sub: string; color: string } | null;
}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const th = sceneTheme();
  const SKY = new THREE.Color(th.sky);
  scene.background = SKY;
  scene.fog = new THREE.FogExp2(SKY, .0075);
  const camera = new THREE.PerspectiveCamera(42, 1, .05, 400);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight('#9fb0ff', '#1c140a', .7));
  const sun = new THREE.DirectionalLight('#fff4e2', 2.4); sun.position.set(20, 45, 18); scene.add(sun);
  const fill = new THREE.DirectionalLight('#ff9fd0', .6); fill.position.set(-30, 18, -25); scene.add(fill);

  const trash = [];
  const keep = (x) => { trash.push(x); return x; };
  const dot = keep(softDot());

  // ---------------------------------------------------------------- stadion
  const ground = new THREE.Mesh(keep(new THREE.CircleGeometry(160, 64)), keep(new THREE.MeshStandardMaterial({ color: th.turf, roughness: 1 })));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.02; scene.add(ground);
  const outerGrass = new THREE.Mesh(keep(new THREE.RingGeometry(R_OUT, 33, 128)), keep(new THREE.MeshStandardMaterial({ map: keep(grassTexture()), roughness: 1 })));
  outerGrass.rotation.x = -Math.PI / 2; outerGrass.position.y = -.01; scene.add(outerGrass);
  const track = new THREE.Mesh(keep(new THREE.RingGeometry(R_IN, R_OUT, 256, 2)), keep(new THREE.MeshStandardMaterial({ map: keep(trackTexture()), roughness: .95 })));
  track.rotation.x = -Math.PI / 2; scene.add(track);
  const infield = new THREE.Mesh(keep(new THREE.CircleGeometry(R_IN, 96)), keep(new THREE.MeshStandardMaterial({ map: keep(grassTexture('SCAMBOX')), roughness: 1 })));
  infield.rotation.x = -Math.PI / 2; infield.position.y = .005; scene.add(infield);
  // barierki: biała rura na słupkach po obu stronach toru
  const railMat = keep(new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: .3, emissive: '#ffffff', emissiveIntensity: .08 }));
  const postGeo = keep(new THREE.CylinderGeometry(.05, .05, 1, 6));
  for (const R of [R_IN - .15, R_OUT + .15]) {
    const rail = new THREE.Mesh(keep(new THREE.TorusGeometry(R, .06, 6, 256)), railMat);
    rail.rotation.x = Math.PI / 2; rail.position.y = 1; scene.add(rail);
    const n = Math.round(TAU * R / 2.2), posts = new THREE.InstancedMesh(postGeo, railMat, n), m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { const a = i / n * TAU; m.makeTranslation(Math.cos(a) * R, .5, Math.sin(a) * R); posts.setMatrixAt(i, m); }
    scene.add(posts);
  }
  // brama mety nad torem
  const metaA = ang(0), tA = new THREE.Vector3(-Math.sin(metaA), 0, Math.cos(metaA));
  const gantry = new THREE.Group(); scene.add(gantry);
  const steel = keep(new THREE.MeshStandardMaterial({ color: '#2a2b31', metalness: .8, roughness: .35 }));
  for (const R of [R_IN - .6, R_OUT + .6]) { const p = new THREE.Mesh(keep(new THREE.BoxGeometry(.35, 7, .35)), steel); p.position.set(Math.cos(metaA) * R, 3.5, Math.sin(metaA) * R); gantry.add(p); }
  const banner = new THREE.Mesh(keep(new THREE.BoxGeometry(R_OUT - R_IN + 1.6, 1.4, .3)), [steel, steel, steel, steel,
    keep(new THREE.MeshBasicMaterial({ map: keep(canvasTex(1024, 96, x => { x.fillStyle = '#0b0b10'; x.fillRect(0, 0, 1024, 96); x.fillStyle = '#ffe08a'; x.font = '800 64px "Bricolage Grotesque", system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('META · SCAMBOX DERBY', 512, 52); })) })),
    keep(new THREE.MeshBasicMaterial({ map: keep(canvasTex(1024, 96, x => { x.fillStyle = '#0b0b10'; x.fillRect(0, 0, 1024, 96); x.fillStyle = '#ff5a7a'; x.font = '800 64px "Bricolage Grotesque", system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('START', 512, 52); })) }))]);
  banner.position.set(Math.cos(metaA) * (R_IN + R_OUT) / 2, 6.6, Math.sin(metaA) * (R_IN + R_OUT) / 2);
  banner.lookAt(banner.position.clone().add(tA)); gantry.add(banner);

  // trybuna po stronie +z z publicznością, która podskakuje (mocniej przy finiszu)
  const STAND_A = Math.PI / 2, STAND_SPAN = .85, TIERS = 7, SEGS = 46;
  const standMat = keep(new THREE.MeshStandardMaterial({ color: '#23242b', roughness: .9 }));
  const tierGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  const tiers = new THREE.InstancedMesh(tierGeo, standMat, TIERS * SEGS);
  const fan = keep(new THREE.BoxGeometry(.34, .55, .26));
  const fanMat = keep(new THREE.MeshStandardMaterial({ roughness: .8 }));
  const FANS = TIERS * SEGS * 3, fans = new THREE.InstancedMesh(fan, fanMat, FANS), fanAt = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  const PAL = ['#e5484d', '#3fc07a', '#55c7ff', '#ffd76a', '#ff5cf0', '#f2f2f2', '#ff8a3a', '#7f6bff'];
  let ti = 0, fi = 0;
  for (let t = 0; t < TIERS; t++) {
    const r = 34 + t * 1.25, y = .45 + t * .85;
    for (let s = 0; s < SEGS; s++) {
      const a = STAND_A - STAND_SPAN + (s + .5) / SEGS * STAND_SPAN * 2, w = r * STAND_SPAN * 2 / SEGS * 1.02;
      q.setFromAxisAngle(up, -a + Math.PI / 2);
      m4.compose(v3.set(Math.cos(a) * r, y / 2, Math.sin(a) * r), q, new THREE.Vector3(w, y, 1.25));
      tiers.setMatrixAt(ti++, m4);
      for (let k = 0; k < 3; k++) {
        const aa = a + (k - 1) * w / r / 3.2;
        fanAt.push({ x: Math.cos(aa) * (r - .1), z: Math.sin(aa) * (r - .1), y: y + .3, q: q.clone(), ph: Math.random() * TAU, sp: 3 + Math.random() * 4 });
        fans.setColorAt(fi++, col.set(PAL[Math.floor(Math.random() * PAL.length)]));
      }
    }
  }
  scene.add(tiers, fans);
  // telebim nad trybuną: to samo, co napis na środku płaskiego toru
  const jumboCv = document.createElement('canvas'); jumboCv.width = 1024; jumboCv.height = 512;
  const jx = jumboCv.getContext('2d'), jumboTex = keep(new THREE.CanvasTexture(jumboCv)); jumboTex.colorSpace = THREE.SRGBColorSpace;
  const jumbo = new THREE.Mesh(keep(new THREE.PlaneGeometry(14, 7)), keep(new THREE.MeshBasicMaterial({ map: jumboTex })));
  jumbo.position.set(0, 14, 44); jumbo.lookAt(0, 6, 0); scene.add(jumbo);
  const jumboFrame = new THREE.Mesh(keep(new THREE.BoxGeometry(14.8, 7.8, .5)), steel); jumboFrame.position.copy(jumbo.position).add(new THREE.Vector3(0, 0, .3)); jumboFrame.lookAt(0, 6, 0); scene.add(jumboFrame);
  let jumboKey = '';
  function drawJumbo() {
    const i = o.info(); if (!i) return;
    const k = i.top + i.big + i.sub + i.color;
    if (k === jumboKey) return; jumboKey = k;
    jx.fillStyle = '#050508'; jx.fillRect(0, 0, 1024, 512);
    const g = jx.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#1a0f2a'); g.addColorStop(1, '#050508'); jx.fillStyle = g; jx.fillRect(0, 0, 1024, 512);
    jx.textAlign = 'center'; jx.textBaseline = 'middle';
    jx.fillStyle = '#ffe9a8'; jx.font = '700 54px "Hanken Grotesk", system-ui'; jx.fillText(i.top, 512, 120);
    jx.fillStyle = i.color || '#fff'; jx.font = `800 ${i.big.length > 12 ? 90 : 140}px "Bricolage Grotesque", system-ui`; jx.fillText(i.big, 512, 270);
    jx.fillStyle = '#fff'; jx.font = '600 42px "Hanken Grotesk", system-ui'; jx.fillText(i.sub, 512, 420);
    for (let y = 0; y < 512; y += 4) { jx.fillStyle = '#0000002a'; jx.fillRect(0, y, 1024, 2); }
    jumboTex.needsUpdate = true;
  }
  // maszty z reflektorami: świecąca głowica, blask i stożek światła
  const glareMat = keep(new THREE.SpriteMaterial({ map: dot, color: '#fff6e0', transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  const beamMat = keep(new THREE.MeshBasicMaterial({ color: '#fff3d0', transparent: true, opacity: .025, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  for (const a of [-.25, Math.PI + .25, -Math.PI / 2 - 1.15, -Math.PI / 2 + 1.15]) {
    const R = 39, mast = new THREE.Mesh(keep(new THREE.CylinderGeometry(.25, .45, 22, 10)), steel);
    mast.position.set(Math.cos(a) * R, 11, Math.sin(a) * R); scene.add(mast);
    const headM = new THREE.Mesh(keep(new THREE.BoxGeometry(4, 2, .5)), keep(new THREE.MeshBasicMaterial({ color: '#fffaf0' })));
    headM.position.set(Math.cos(a) * R, 22.5, Math.sin(a) * R); headM.lookAt(0, 0, 0); scene.add(headM);
    const glare = new THREE.Sprite(glareMat); glare.scale.setScalar(16); glare.position.copy(headM.position); scene.add(glare);
    const beam = new THREE.Mesh(keep(new THREE.ConeGeometry(14, 30, 24, 1, true)), beamMat);
    beam.position.copy(headM.position).multiplyScalar(.62); beam.position.y = 11;
    beam.lookAt(headM.position); beam.rotateX(-Math.PI / 2); scene.add(beam);
  }
  // gwiazdy
  const starPos = [];
  for (let i = 0; i < 1400; i++) { const a = Math.random() * TAU, e = Math.random() * .9 + .08, r = 190; starPos.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r); }
  const stars = new THREE.Points(keep(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))), keep(new THREE.PointsMaterial({ color: '#cfd8ff', size: .8, sizeAttenuation: false, fog: false })));
  scene.add(stars);
  if (th.id === 'aero') stars.visible = false;   // w dzień nie ma gwiazd
  // flesze aparatów na trybunie
  const FL = 40, flashGeo = keep(new THREE.BufferGeometry()), flashPos = new Float32Array(FL * 3), flashCol = new Float32Array(FL * 3);
  flashGeo.setAttribute('position', new THREE.BufferAttribute(flashPos, 3)); flashGeo.setAttribute('color', new THREE.BufferAttribute(flashCol, 3));
  const flashes = new THREE.Points(flashGeo, keep(new THREE.PointsMaterial({ map: dot, size: 1.4, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  scene.add(flashes);

  // ---------------------------------------------------------------- konie
  const geo = {
    sphere: keep(new THREE.SphereGeometry(1, 20, 14)), neck: keep(new THREE.CylinderGeometry(.16, .25, .9, 12)), mane: keep(new THREE.BoxGeometry(.05, .14, .85)),
    skull: keep(new THREE.CylinderGeometry(.09, .15, .58, 12)), ear: keep(new THREE.ConeGeometry(.04, .16, 6)), eye: keep(new THREE.SphereGeometry(.03, 8, 6)),
    tail: keep(new THREE.CylinderGeometry(.03, .1, .75, 8)), cloth: keep(new THREE.BoxGeometry(.84, .3, .62)),
    upper: keep(new THREE.CylinderGeometry(.09, .06, .58, 8)), lower: keep(new THREE.CylinderGeometry(.05, .045, .46, 8)), hoof: keep(new THREE.CylinderGeometry(.06, .07, .08, 8)),
    torso: keep(new THREE.BoxGeometry(.32, .44, .24)), jhead: keep(new THREE.SphereGeometry(.12, 12, 10)), helmet: keep(new THREE.SphereGeometry(.135, 12, 8, 0, TAU, 0, Math.PI / 2)),
    arm: keep(new THREE.CylinderGeometry(.04, .04, .36, 6)), jleg: keep(new THREE.BoxGeometry(.1, .1, .42)), shadow: keep(new THREE.PlaneGeometry(1.6, 2.8))
  };
  const shared = {
    dark: keep(new THREE.MeshStandardMaterial({ color: '#120d0a', roughness: .7 })), eye: keep(new THREE.MeshStandardMaterial({ color: '#000', roughness: .1 })),
    skin: keep(new THREE.MeshStandardMaterial({ color: '#e0b48c', roughness: .7 })), white: keep(new THREE.MeshStandardMaterial({ color: '#f0f0f0', roughness: .6 })),
    shadow: keep(new THREE.MeshBasicMaterial({ map: dot, color: '#000', transparent: true, opacity: .6, depthWrite: false }))
  };
  const H = o.horses.map(h => { const m = buildHorse(h.color, COATS[h.id % COATS.length], h.id + 1, geo, shared); scene.add(m.g, m.shadow); trash.push(m); return m; });
  // duszki nad końmi: przedmiot w kieszeni i stan (ślimak, gwiazdki po upadku), nagrobek i duch
  const held = H.map(() => { const s = emojiSprite('❓', .8); s.visible = false; scene.add(s); return s; });
  const mood = H.map(() => { const s = emojiSprite('💫', .9); s.visible = false; scene.add(s); return s; });
  const grave = H.map(() => { const s = emojiSprite('🪦', 1.6); s.visible = false; scene.add(s); return s; });
  const ghost = H.map(() => { const s = emojiSprite('👻', 1.3); s.visible = false; scene.add(s); return s; });
  // uszy i grzywa przed kamerą w widoku z pierwszej osoby
  const fpv = new THREE.Group(); camera.add(fpv); fpv.visible = false;
  const fpvCoat = keep(new THREE.MeshStandardMaterial({ color: '#6b3e1f', roughness: .5 }));
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(geo.ear, fpvCoat); e.scale.set(1.2, 1.4, 1.2); e.position.set(sx * .16, -.36, -.62); e.rotation.set(-.35, 0, -sx * .25); fpv.add(e); }
  const fpvMane = new THREE.Mesh(keep(new THREE.BoxGeometry(.07, .05, .7)), shared.dark); fpvMane.position.set(0, -.5, -.8); fpvMane.rotation.x = -.35; fpv.add(fpvMane);
  const fpvNeck = new THREE.Mesh(keep(new THREE.CylinderGeometry(.14, .22, .9, 12)), fpvCoat); fpvNeck.rotation.x = -1.25; fpvNeck.position.set(0, -.72, -1.05); fpv.add(fpvNeck);

  // skrzynki "?" na torach
  const qTex = keep(canvasTex(128, 128, x => { x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#000'; x.globalAlpha = .9; x.font = '900 100px Rubik, system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', 64, 72); x.globalAlpha = 1; x.strokeStyle = '#fff'; x.lineWidth = 10; x.strokeRect(5, 5, 118, 118); }));
  const MAXB = H.length * 6;
  const boxes = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(.7, .7, .7)), keep(new THREE.MeshStandardMaterial({ map: qTex, emissive: '#ffffff', emissiveMap: qTex, emissiveIntensity: .12, roughness: .3, transparent: true, opacity: .92 })), MAXB);
  boxes.count = 0; scene.add(boxes);
  const banana = new Map(), rocket = new Map(), boom = new Map();

  // samochód
  const car = new THREE.Group(); car.visible = false; scene.add(car);
  const carPaint = keep(new THREE.MeshPhysicalMaterial({ color: '#d21f2f', metalness: .6, roughness: .25, clearcoat: 1 }));
  const cb = new THREE.Mesh(keep(new THREE.BoxGeometry(1.5, .55, 3)), carPaint); cb.position.y = .55; car.add(cb);
  const cc = new THREE.Mesh(keep(new THREE.BoxGeometry(1.3, .5, 1.5)), keep(new THREE.MeshStandardMaterial({ color: '#0d1420', metalness: .9, roughness: .1 }))); cc.position.set(0, 1.05, -.2); car.add(cc);
  const wheelGeo = keep(new THREE.CylinderGeometry(.36, .36, .3, 16)); wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[.75, 1], [-.75, 1], [.75, -1], [-.75, -1]]) { const w = new THREE.Mesh(wheelGeo, shared.dark); w.position.set(x, .36, z); car.add(w); wheels.push(w); }
  for (const x of [-.5, .5]) { const l = new THREE.Sprite(glareMat); l.scale.setScalar(2.2); l.position.set(x, .6, 1.55); car.add(l); }

  // ---------------------------------------------------------------- cząsteczki: kurz (zwykłe) i błyski (świecące)
  function pool(n: number, additive: boolean, size: number) {
    const g = keep(new THREE.BufferGeometry()), pos = new Float32Array(n * 3), colA = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
    const pts = new THREE.Points(g, keep(new THREE.PointsMaterial({ map: dot, size, vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: additive ? 1 : .55 })));
    pts.frustumCulled = false; scene.add(pts);
    const P = Array.from({ length: n }, () => ({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1, grav: 0 }));
    let next = 0;
    return {
      emit(x, y, z, vx, vy, vz, life, c: THREE.Color, grav = 0) { const p = P[next]; next = (next + 1) % n; Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, r: c.r, g: c.g, b: c.b, grav }); },
      step(dt) {
        for (let i = 0; i < n; i++) {
          const p = P[i];
          if (p.life <= 0) { pos[i * 3 + 1] = -99; continue; }
          p.life -= dt; p.vy -= p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const k = Math.max(0, p.life / p.max);
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
          colA[i * 3] = p.r * k; colA[i * 3 + 1] = p.g * k; colA[i * 3 + 2] = p.b * k;
        }
        g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      }
    };
  }
  const dust = pool(900, false, .9), fx = pool(1600, true, .55);
  const DUST = new THREE.Color('#8a6a48');
  const bolts = Array.from({ length: 10 }, () => { const l = new THREE.Line(keep(new THREE.BufferGeometry()), keep(new THREE.LineBasicMaterial({ color: '#cfe4ff', transparent: true, blending: THREE.AdditiveBlending }))); l.visible = false; l.frustumCulled = false; scene.add(l); return l; });

  // ---------------------------------------------------------------- stan kamery i pętla
  const cam = { mode: 'tv' as HorseCam, focus: 0, shot: 0, shotAt: 0, pos: new THREE.Vector3(0, 40, 60), look: new THREE.Vector3(), fov: 42, blend: 1, ghost: 0 };
  const hud: HorsesHud = { mode: 'tv', focus: 0, order: [], speed: 0, fx: 0, flash: 0 };
  let W = 0, HGT = 0;
  function resize() {
    const r = canvas.getBoundingClientRect(); W = Math.round(r.width); HGT = Math.round(r.height);
    if (!W || !HGT) return;
    renderer.setSize(W, HGT, false); camera.aspect = W / HGT; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

  const P = (i: number, x: number, out = new THREE.Vector3()) => { const a = ang(x), r = laneR(i); return out.set(Math.cos(a) * r, 0, Math.sin(a) * r); };
  const fwdOf = (x: number, dir: number, out = new THREE.Vector3()) => { const a = ang(x); return out.set(-Math.sin(a) * dir, 0, Math.cos(a) * dir); };
  const fired = new Set<string>();
  let lastKey = '', fwT = 0, last = performance.now(), raf = 0, running = true, visible = true;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), fwd = new THREE.Vector3(), camTo = new THREE.Vector3(), lookTo = new THREE.Vector3();

  function frame(now: number) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!visible) return;
    const t = now / 1000;
    const { race, T } = o.clock();
    const key = race ? (race.id ?? 'solo') + ':' + race.dur : 'idle';
    if (key !== lastKey) { lastKey = key; fired.clear(); banana.forEach(s => scene.remove(s)); banana.clear(); }
    const fin = race ? o.finish(race) : null;
    const live = race && T >= 0 && T < race.dur + 4;
    // --------- konie
    const xs = [], sts = [];
    let flash = 0;
    o.horses.forEach((h, i) => {
      const m = H[i];
      const x = race ? o.interp(race.x[i], T, race.dt, race.scale) : -.004;
      const xp = race ? o.interp(race.x[i], T - .08, race.dt, race.scale) : x;
      const st = race ? o.state(race, i, T) : { dead: null, left: null, fall: null, turbo: false, star: false, boost: false, slow: false, held: null };
      xs[i] = x; sts[i] = st;
      const v = (x - xp) / .08 * TAU * laneR(i);   // prędkość w jednostkach na sekundę
      if (Math.abs(v) > .3) m.dir = v >= 0 ? 1 : -1;
      const finished = race && x >= race.laps && race.winner !== i;
      const moving = live && !st.dead && !st.fall && Math.abs(v) > .3;
      P(i, x, m.g.position);
      fwdOf(x, m.dir, fwd);
      const yaw = Math.atan2(fwd.x, fwd.z);
      m.g.rotation.y = yaw;
      m.phase += dt * (moving ? 2.4 + Math.abs(v) * .55 : .6);
      const ph = m.phase, gallop = moving ? 1 : 0;
      m.legs.forEach(l => {
        const s = Math.sin(ph + l.off * TAU);
        l.hip.rotation.x = s * .65 * gallop;
        l.knee.rotation.x = (l.front ? 1 : -1) * Math.max(0, Math.sin(ph + l.off * TAU + 1)) * 1.1 * gallop;
      });
      m.body.position.y = moving ? Math.abs(Math.sin(ph)) * .14 : Math.sin(t * 1.5 + i) * .01;
      m.body.rotation.x = moving ? Math.sin(ph * 2) * .04 : 0;
      m.head.rotation.x = moving ? Math.sin(ph * 2 + .6) * .08 : Math.sin(t * .8 + i) * .05;
      m.tail.rotation.x = moving ? -.6 + Math.sin(ph * 2) * .15 : Math.sin(t * 2 + i) * .1;
      m.tail.rotation.z = Math.sin(t * 3 + i) * .25;
      m.jockey.position.y = 1.64 + (moving ? -Math.abs(Math.sin(ph)) * .08 : 0);
      // upadek, śmierć, gwiazda, turbo
      let fallTo = 0;
      if (st.dead != null) fallTo = Math.PI / 2;
      else if (st.fall) fallTo = 1.25;
      m.fallZ += (fallTo - m.fallZ) * Math.min(1, dt * (st.dead != null ? 6 : 9));
      m.g.rotation.z = m.fallZ;
      m.g.position.y = Math.sin(m.fallZ) * .35;
      const deadAge = st.dead != null ? T - st.dead : -1;
      m.g.visible = !(deadAge > 2.5);
      if (st.star) { m.coat.emissive.setHSL((t * 1.5 + i * .1) % 1, 1, .5); m.coat.emissiveIntensity = .7; }
      else m.coat.emissiveIntensity = 0;
      const sc = st.turbo ? 1.18 : 1;
      m.g.scale.setScalar(sc);
      if (st.turbo) m.silk.emissive.setHSL((t * 2) % 1, 1, .5); else m.silk.emissive.set(o.horses[i].color);
      m.silk.emissiveIntensity = st.turbo ? .8 : .12;
      m.shadow.position.set(m.g.position.x, .02, m.g.position.z); m.shadow.rotation.z = -yaw; m.shadow.visible = m.g.visible;
      // cząsteczki
      if (moving && !reduced) {
        if (Math.random() < .8) { const b = m.g.position; dust.emit(b.x - fwd.x * 1 + (Math.random() - .5) * .6, .15, b.z - fwd.z * 1 + (Math.random() - .5) * .6, -fwd.x * 1.5 + (Math.random() - .5), .6 + Math.random() * .8, -fwd.z * 1.5 + (Math.random() - .5), .9 + Math.random() * .6, DUST, 1.2); }
        if (st.turbo) for (let k = 0; k < 3; k++) fx.emit(m.g.position.x - fwd.x * (1 + k * .3), 1.2 + (Math.random() - .5) * .6, m.g.position.z - fwd.z * (1 + k * .3), (Math.random() - .5) * .4, (Math.random() - .5) * .4, (Math.random() - .5) * .4, .7, col.setHSL((t * 1.2 + k * .1 + i * .07) % 1, 1, .6));
        if (st.boost) for (let k = 0; k < 2; k++) fx.emit(m.g.position.x - fwd.x * 1.3, .5 + Math.random() * .5, m.g.position.z - fwd.z * 1.3, -fwd.x * 3 + (Math.random() - .5), Math.random(), -fwd.z * 3 + (Math.random() - .5), .4, col.set(Math.random() < .5 ? '#ff8a3a' : '#ffd76a'));
        if (st.star && Math.random() < .5) fx.emit(m.g.position.x + (Math.random() - .5) * 1.5, 1 + Math.random() * 1.5, m.g.position.z + (Math.random() - .5) * 1.5, 0, 1, 0, .6, col.set('#ffe680'));
      }
      // duszki nad koniem
      const top = tmp.copy(m.g.position).setY(3.1);
      held[i].visible = !!st.held && m.g.visible && st.dead == null;
      if (held[i].visible) { held[i].material = emojiMat(o.itemIcon(st.held)); held[i].position.copy(top).add(tmp2.set(0, Math.sin(t * 4 + i) * .1, 0)); }
      const moodE = st.fall ? '💫' : st.slow ? '🐌' : st.star ? '⭐' : '';
      mood[i].visible = !!moodE && st.dead == null;
      if (moodE) { mood[i].material = emojiMat(moodE); mood[i].position.copy(top).add(tmp2.set(Math.cos(t * 3) * .5, .6, Math.sin(t * 3) * .5)); }
      grave[i].visible = deadAge > .4;
      if (grave[i].visible) { grave[i].position.copy(m.g.position).setY(.8); grave[i].scale.setScalar(1.6 * Math.min(1, (deadAge - .4) / .3)); }
      ghost[i].visible = deadAge > 0 && deadAge < 4;
      if (ghost[i].visible) { ghost[i].position.copy(m.g.position).setY(1.5 + deadAge * 1.4).add(tmp2.set(Math.sin(deadAge * 3) * .4, 0, 0)); ghost[i].scale.setScalar(1.3 * (1 - deadAge / 5)); }
      // wybuch pod kołami samochodu i błysk przy śmierci
      if (st.dead != null && !fired.has('d' + i)) {
        fired.add('d' + i);
        if (st.carDeath && !reduced) for (let k = 0; k < 120; k++) { const a = Math.random() * TAU, e = Math.random() * 1.4, s = 3 + Math.random() * 7; fx.emit(m.g.position.x, 1, m.g.position.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, .8 + Math.random() * .6, col.set(['#ff5a1a', '#ffb02a', '#ffe08a', '#fff'][k % 4]), 6); }
        if (st.carDeath) flash = Math.max(flash, .5);
      }
    });
    // --------- skrzynki "?" (jak hrBoxes w 2D)
    const rows = race ? race.rows : o.boxRows();
    let nb = 0;
    o.horses.forEach((h, i) => {
      const st = sts[i], x = xs[i];
      if (st.dead != null || st.left != null) return;
      const L = race ? Math.min(race.laps - 1, Math.max(0, Math.floor(x))) : 0;
      rows.forEach((pos, r) => {
        if (nb >= MAXB) return;
        if (race && !race.bx0[i][L][r]) return;
        const p = L + pos;
        if (x >= p) return;
        const pop = L === 0 ? 1 : Math.min(1, (x - L) / .04 + .15);
        P(i, p, tmp).setY(1.1 + Math.sin(t * 3 + r + i) * .15);
        q.setFromEuler(new THREE.Euler(t * .9, t * 1.3 + i, 0));
        m4.compose(tmp, q, tmp2.setScalar(pop));
        boxes.setMatrixAt(nb, m4);
        boxes.setColorAt(nb, col.setHSL(((t * 120 + i * 36 + r * 90) % 360) / 360, .9, .58));
        nb++;
      });
    });
    boxes.count = nb; boxes.instanceMatrix.needsUpdate = true; if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    // --------- banany, rakiety, pioruny, samochód
    if (race) {
      const alive = new Set();
      race.events.forEach((e, k) => {
        if (e.t > T) return;
        if (e.k === 'banana') alive.add(e.id);
        else if (e.k === 'banana_end') alive.delete(e.id);
        else if (e.k === 'bolt' && T < e.t + .5) {
          flash = Math.max(flash, 1 - (T - e.t) / .5);
          let n = 0;
          o.horses.forEach((h, i) => {
            if (i === e.h || n >= bolts.length || sts[i].dead != null) return;
            const b = bolts[n++], pts = [], base = H[i].g.position;
            for (let s = 0; s <= 10; s++) pts.push(new THREE.Vector3(base.x + (s < 10 ? (Math.random() - .5) * 1.6 : 0), 40 - s * 3.85, base.z + (s < 10 ? (Math.random() - .5) * 1.6 : 0)));
            b.geometry.setFromPoints(pts); b.visible = true; b.material.opacity = 1 - (T - e.t) / .5;
          });
        } else if (e.k === 'rocket') {
          const t1 = e.t1 ?? e.t + 3;
          let s = rocket.get(k);
          if (T <= t1) {
            if (!s) { s = emojiSprite('🚀', 1.4); scene.add(s); rocket.set(k, s); }
            const u = Math.min(1, (T - e.t) / Math.max(.05, t1 - e.t)), xe = o.interp(race.x[e.to], t1, race.dt, race.scale);
            const rx = e.x0 + (xe - e.x0) * u, lane = e.h + (e.to - e.h) * u, a = ang(rx), r = R0 + lane * DR;
            s.position.set(Math.cos(a) * r, 2 + Math.sin(u * Math.PI) * 2.5, Math.sin(a) * r);
            if (!reduced) for (let j = 0; j < 3; j++) fx.emit(s.position.x, s.position.y, s.position.z, (Math.random() - .5) * 1.5, (Math.random() - .5) * 1.5, (Math.random() - .5) * 1.5, .5, col.set(j ? '#ff8a3a' : '#ffe08a'));
          } else {
            if (s) { scene.remove(s); rocket.delete(k); }
            if (!fired.has('r' + k) && e.res !== 'gone') {
              fired.add('r' + k);
              const p = H[e.to].g.position, hit = e.res === 'hit';
              const b = emojiSprite(hit ? '💥' : '🛡️', 2); b.position.copy(p).setY(2); scene.add(b); boom.set('r' + k, { s: b, at: T });
              if (hit && !reduced) for (let j = 0; j < 60; j++) { const a2 = Math.random() * TAU; fx.emit(p.x, 1.4, p.z, Math.cos(a2) * 5, Math.random() * 5, Math.sin(a2) * 5, .7, col.set(j % 2 ? '#ff5a1a' : '#ffe08a'), 5); }
            }
          }
        }
      });
      banana.forEach((s, id) => { if (!alive.has(id)) { scene.remove(s); banana.delete(id); } });
      alive.forEach(id => {
        if (banana.has(id)) return;
        const e = race.events.find(ev => ev.k === 'banana' && ev.id === id), s = emojiSprite('🍌', 1);
        P(e.lane, e.x, s.position).setY(.4); scene.add(s); banana.set(id, s);
      });
    }
    bolts.forEach(b => { if (!(race && race.events.some(e => e.k === 'bolt' && T >= e.t && T < e.t + .5))) b.visible = false; });
    boom.forEach((b, k) => { const age = T - b.at; if (age > .9 || age < 0) { scene.remove(b.s); boom.delete(k); } else { b.s.scale.setScalar(2 + age * 3); b.s.material.opacity = 1 - age / .9; } });
    car.visible = false;
    if (race?.car) {
      const cx = o.carX(race, T);
      if (cx != null) {
        const ev = race.events.find(e => e.k === 'car') ?? { t: 0, go: 1 }, entry = Math.min(1, Math.max(0, (T - ev.t) / (ev.go - ev.t)));
        const kills = race.events.filter(e => e.k === 'die' && e.by === 'car');
        const prevK = kills.filter(e => e.t <= T).pop(), nextK = kills.find(e => e.t > T);
        const mid = (R0 + laneR(9)) / 2, lr = k => (k == null ? mid : laneR(k));
        const fromR = prevK ? lr(prevK.h) : mid, toR = nextK ? lr(nextK.h) : mid;
        const t0 = prevK ? prevK.t + .4 : ev.go, t1 = nextK ? nextK.t : (prevK ? prevK.t + 1.8 : ev.go + 1);
        const u = Math.min(1, Math.max(0, (T - t0) / Math.max(.3, t1 - t0))), lane = fromR + (toR - fromR) * (u * u * (3 - 2 * u));
        const r = 36 + (lane - 36) * (1 - Math.pow(1 - entry, 2)), a = ang(cx);
        car.visible = true; car.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        const d = (o.carX(race, T + .2) ?? cx) - cx >= -1e-6 ? 1 : -1;
        fwdOf(cx, d, fwd); car.rotation.y = Math.atan2(fwd.x, fwd.z);
        wheels.forEach(w => { w.rotation.x += dt * 20; });
        if (!reduced) dust.emit(car.position.x - fwd.x * 1.6, .3, car.position.z - fwd.z * 1.6, -fwd.x * 2, 1, -fwd.z * 2, 1.2, col.set('#9a9a9a'), .5);
      }
    }
    // --------- meta: fajerwerki nad trybuną
    if (fin != null && T >= fin && T < fin + 8 && !reduced) {
      fwT -= dt;
      if (fwT <= 0) {
        fwT = .35 + Math.random() * .3;
        const a = STAND_A + (Math.random() - .5) * 1.4, r = 30 + Math.random() * 10, y = 16 + Math.random() * 10, c = new THREE.Color().setHSL(Math.random(), 1, .6);
        for (let k = 0; k < 110; k++) { const aa = Math.random() * TAU, e = Math.asin(Math.random() * 2 - 1), s = 5 + Math.random() * 2; fx.emit(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(aa) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(aa) * Math.cos(e) * s, 1.4 + Math.random() * .6, c, 3); }
        flash = Math.max(flash, .15);
      }
    }
    // --------- publiczność i flesze
    const hype = live ? (fin != null && T >= fin ? 1 : .45) : .15;
    fanAt.forEach((f, i) => { m4.compose(v3.set(f.x, f.y + Math.max(0, Math.sin(t * f.sp + f.ph)) * .25 * hype * 2, f.z), f.q, one); fans.setMatrixAt(i, m4); });
    fans.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < FL; i++) {
      if (Math.random() < .02 * (1 + hype * 3)) { const f = fanAt[Math.floor(Math.random() * fanAt.length)]; flashPos[i * 3] = f.x; flashPos[i * 3 + 1] = f.y + .4; flashPos[i * 3 + 2] = f.z; flashCol[i * 3] = flashCol[i * 3 + 1] = flashCol[i * 3 + 2] = 1; }
      else { flashCol[i * 3] *= .8; flashCol[i * 3 + 1] *= .8; flashCol[i * 3 + 2] *= .8; }
    }
    flashGeo.attributes.position.needsUpdate = true; flashGeo.attributes.color.needsUpdate = true;
    dust.step(dt); fx.step(dt);
    drawJumbo();
    // --------- kamera
    const order = o.horses.map((h, i) => i).sort((a, b) => {
      const da = sts[a].dead != null || sts[a].left != null, db = sts[b].dead != null || sts[b].left != null;
      return da !== db ? (da ? 1 : -1) : xs[b] - xs[a];
    });
    const leader = race && race.winner >= 0 && fin != null && T >= fin ? race.winner : order[0];
    const f = cam.mode === 'tv' || cam.mode === 'top' ? leader : cam.focus;
    const fm = H[f], fx0 = xs[f], fst = sts[f];
    fwdOf(fx0, fm.dir, fwd);
    let fov = 42;
    fpv.visible = false;
    H.forEach((m, i) => { m.head.visible = true; m.jockey.visible = true; });
    if (cam.mode === 'top') {
      camTo.set(0, 78, 30); lookTo.set(0, 0, 2); fov = 45;
    } else if ((!race || T < -1) && cam.mode === 'tv') {
      // przed wyścigiem: przelot nad stadionem, potem najazd na bramę startową
      const a = t * .06;
      camTo.set(Math.cos(a) * 52, 22, Math.sin(a) * 52); lookTo.set(0, 2, 0); fov = 45;
      if (race && T > -4) { P(4, -.02, camTo).add(tmp.set(0, 6, 0)); P(4, .01, lookTo).setY(1); }
    } else if (cam.mode === 'tv') {
      // realizacja: co kilka sekund cięcie na inne ujęcie lidera
      if (t - cam.shotAt > 6.5) { cam.shot = (cam.shot + 1) % 4; cam.shotAt = t; cam.blend = 1; }
      const a = ang(fx0), lp = fm.g.position;
      if (cam.shot === 0) { camTo.set(Math.cos(a - .06) * 9, 6, Math.sin(a - .06) * 9); lookTo.copy(lp).setY(1.2); fov = 38; }
      else if (cam.shot === 1) { camTo.set(Math.cos(a + .1) * (R_OUT + 1.5), 2.2, Math.sin(a + .1) * (R_OUT + 1.5)); lookTo.copy(lp).setY(1.4); fov = 34; }
      else if (cam.shot === 2) { camTo.set(Math.cos(a - .28) * 46, 24, Math.sin(a - .28) * 46); lookTo.copy(lp).setY(1); fov = 40; }
      else { camTo.copy(lp).addScaledVector(fwd, 7).add(tmp.set(0, 1.6, 0)); lookTo.copy(lp).setY(1.3); fov = 46; }
    } else if (cam.mode === 'chase') {
      camTo.copy(fm.g.position).addScaledVector(fwd, -5.2).add(tmp.set(0, 2.5, 0));
      lookTo.copy(fm.g.position).addScaledVector(fwd, 4).add(tmp.set(0, 1.1, 0));
      fov = 50 + (fst.turbo ? 14 : 0) + (fst.boost ? 8 : 0);
    } else {
      // oczami konia: kamera w głowie, patrzy wzdłuż toru; po śmierci dusza unosi się nad ciałem
      const ph = fm.phase, bob = fst.dead == null && !fst.fall ? Math.sin(ph * 2) * .07 : 0;
      if (fst.dead != null) {
        const age = Math.max(0, T - fst.dead);
        camTo.copy(fm.g.position).add(tmp.set(0, 2.2 + age * 2, 0)).addScaledVector(fwd, -2 - age);
        lookTo.copy(fm.g.position).setY(.5); fov = 60;
      } else {
        camTo.copy(fm.g.position).addScaledVector(fwd, 1.45).add(tmp.set(0, 2.05 + bob + (fst.fall ? -1.2 : 0), 0));
        P(f, fx0 + fm.dir * .07, lookTo).setY(1.6 + bob * .5);
        fov = 74 + (fst.turbo ? 22 : 0) + (fst.boost ? 12 : 0) - (fst.slow ? 10 : 0);
        fm.head.visible = false; fm.jockey.visible = false;
        fpv.visible = true; fpvCoat.color.copy(fm.coat.color);
        fpv.rotation.x = Math.sin(ph * 2 + .6) * .05;
      }
    }
    // płynne przejście (przy cięciu realizacji od razu)
    const k = cam.blend >= 1 && cam.mode === 'tv' ? 1 : Math.min(1, dt * (cam.mode === 'fpv' ? 14 : 3.2));
    cam.blend = 0;
    cam.pos.lerp(camTo, k); cam.look.lerp(lookTo, cam.mode === 'fpv' ? Math.min(1, dt * 10) : k);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    camera.position.copy(cam.pos); camera.lookAt(cam.look);
    if (cam.mode === 'fpv' && fst.dead == null) camera.rotateZ(Math.sin(fm.phase) * .025 + (fst.fall ? .9 : 0));
    if (Math.abs(camera.fov - cam.fov) > .01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    renderer.toneMappingExposure = 1.1 + flash * 2.2;
    hud.mode = cam.mode; hud.focus = cam.focus; hud.flash = flash;
    hud.order = order.map(i => ({ id: i, out: sts[i].dead != null ? 'dead' : sts[i].left != null ? 'left' : null }));
    const fv = live ? (o.interp(race.x[f], T, race.dt, race.scale) - o.interp(race.x[f], T - .2, race.dt, race.scale)) / .2 * TAU * laneR(f) : 0;
    hud.speed = Math.max(0, Math.round(fv * 3.6 * 2.2));
    hud.fx = cam.mode === 'fpv' || cam.mode === 'chase' ? (fst.turbo ? 1 : fst.boost ? .6 : 0) : 0;
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  const vis = () => { visible = !document.hidden; last = performance.now(); };
  document.addEventListener('visibilitychange', vis);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; last = performance.now(); });
  io.observe(canvas);

  return {
    setCam(mode: HorseCam, focus?: number) { cam.mode = mode; if (focus != null) cam.focus = focus; cam.blend = 0; cam.shotAt = performance.now() / 1000; },
    hud: () => hud,
    destroy() {
      running = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      trash.forEach(x => x.dispose?.());
      renderer.dispose();
    }
  };
}
