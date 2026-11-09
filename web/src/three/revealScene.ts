// @ts-nocheck -- geometria Three.js; typy dochodzą przy dalszym porządkowaniu
// Wielkie odsłonięcie w 3D (Legendarna i wyżej): skrzynka spada na scenę, ładuje się światłem w kolorze rzadkości,
// wybucha (wieko odskakuje albo odlatuje), w górę strzela słup światła i fale uderzeniowe. Kartę rysuje HTML nad sceną:
// mouth() mówi, w którym miejscu ekranu jest otwór skrzynki, żeby karta mogła z niego wylecieć.
import * as THREE from 'three';
import { crateEnvironment, crateKit, LID_OPEN, softDot, type CrateLook } from './crateModel';
import { sceneTheme } from './sceneTheme';

export interface RevealTier {
  /** kolor przewodni (dla ULTRA tęcza, dla Specjalnej neon migający między dwoma kolorami) */
  color: string;
  colors: string[];
  rainbow?: boolean; neon?: boolean; dark?: boolean;
  /** ile fal uderzeniowych przy wybuchu */
  rings: number;
  /** wieko odlatuje zamiast się otworzyć */
  lidFly: boolean;
  /** jak wysoko skrzynka unosi się przy ładowaniu */
  levitate: number;
  /** pył po odsłonięciu: żar w górę, iskry spiralą albo złoty pył z góry */
  ambient: 'embers' | 'spiral' | 'dust' | 'neon';
  /** Tajna: reflektory w kręgu, świetlne pierścienie i kamera krążąca wokół skrzynki przy ładowaniu */
  orbit?: boolean;
}

// tarcza na podłodze pod skrzynką Tajnej: koła i znaczniki jak na tarczy zegara
function sigilTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.translate(256, 256); x.strokeStyle = '#fff'; x.fillStyle = '#fff';
  for (const [r, w] of [[250, 3], [236, 1.5], [180, 2], [120, 1.5]]) { x.lineWidth = w; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke(); }
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2, long = i % 6 === 0;
    x.lineWidth = long ? 3 : 1.5; x.beginPath();
    x.moveTo(Math.cos(a) * (long ? 196 : 210), Math.sin(a) * (long ? 196 : 210)); x.lineTo(Math.cos(a) * 232, Math.sin(a) * 232); x.stroke();
  }
  for (let i = 0; i < 8; i++) {   // ośmioramienna gwiazda z dwóch kwadratów
    const a = i / 8 * Math.PI * 2;
    x.beginPath(); x.arc(Math.cos(a) * 150, Math.sin(a) * 150, 7, 0, Math.PI * 2); x.fill();
  }
  x.lineWidth = 2;
  for (const off of [0, Math.PI / 4]) {
    x.beginPath();
    for (let i = 0; i <= 4; i++) { const a = off + i / 4 * Math.PI * 2; i ? x.lineTo(Math.cos(a) * 178, Math.sin(a) * 178) : x.moveTo(Math.cos(a) * 178, Math.sin(a) * 178); }
    x.stroke();
  }
  return new THREE.CanvasTexture(c);
}

const MOUTH_Y = 1.3;

function pillarTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.55, 'rgba(255,255,255,.35)'); g.addColorStop(.92, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,.6)');
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}
function makeRays(n) {
  const pos = [], col = [], rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < n; i++) {
    const a = (i + rnd(-.3, .3)) / n * Math.PI * 2, w = rnd(.03, .1), r = rnd(12, 20);
    pos.push(0, 0, 0, Math.cos(a - w) * r, Math.sin(a - w) * r, 0, Math.cos(a + w) * r, Math.sin(a + w) * r, 0);
    const k = rnd(.3, 1);
    col.push(k, k, k, 0, 0, 0, 0, 0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
}

export function createRevealScene(canvas: HTMLCanvasElement, look: CrateLook, tier: RevealTier) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const th = sceneTheme();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 150);
  const env = crateEnvironment(renderer);
  scene.environment = env.texture;
  scene.environmentIntensity = tier.dark ? .18 : .5;

  const main = new THREE.Color(tier.color);
  const key = new THREE.DirectionalLight('#ffffff', tier.dark ? .6 : 2.2); key.position.set(-4, 6, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(main, 4); rim.position.set(3, 4, -5); scene.add(rim);
  const glow = new THREE.PointLight(main, 0, 14, 1.6); glow.position.set(0, 2.2, 1.2); scene.add(glow);

  // skrzynka
  const kit = crateKit();
  kit.setLook(look);
  const { g: crate, lid } = kit.build();
  crate.rotation.y = -.38;
  const root = new THREE.Group();
  root.add(crate);
  scene.add(root);
  // szpara pod wiekiem: przez nią przecieka światło, zanim skrzynka pęknie
  const seamMat = new THREE.MeshBasicMaterial({ color: main, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const seam = new THREE.Mesh(new THREE.BoxGeometry(2.74, .06, 1.84), seamMat);
  seam.position.y = 1.25; crate.add(seam);
  const dot = softDot();
  const leakMat = new THREE.SpriteMaterial({ map: dot, color: main, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const leak = new THREE.Sprite(leakMat); leak.position.y = MOUTH_Y; leak.scale.setScalar(4.5); crate.add(leak);
  // Tajna: biały blask, w którym skrzynka znika, gdy wzlatuje (rysowany na wierzchu)
  const blazeMat = new THREE.SpriteMaterial({ map: dot, color: '#fff8e6', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  const blaze = new THREE.Sprite(blazeMat); blaze.position.y = .9; blaze.renderOrder = 10; crate.add(blaze);

  // podłoga, plama światła i cień
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: th.id === 'default' ? '#0c0c10' : th.floor, roughness: .92, metalness: .05 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const poolMat = new THREE.MeshBasicMaterial({ map: dot, color: main, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), poolMat);
  pool.rotation.x = -Math.PI / 2; pool.position.y = .015; scene.add(pool);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.2), new THREE.MeshBasicMaterial({ map: dot, color: '#000', transparent: true, opacity: .75, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .02; scene.add(shadow);

  // promienie za skrzynką
  const rays = makeRays(22);
  rays.position.set(0, 3, -6); scene.add(rays);
  rays.material.color.copy(main);

  // słup światła: szeroka poświata i jasny rdzeń
  const pTex = pillarTexture();
  const pillarMat = new THREE.MeshBasicMaterial({ map: pTex, color: main, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.25, .95, 18, 48, 1, true), pillarMat);
  pillar.geometry.translate(0, 9, 0); pillar.position.y = MOUTH_Y - .2; pillar.scale.y = .001; scene.add(pillar);
  const coreMat = new THREE.MeshBasicMaterial({ map: pTex, color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(.42, .3, 18, 32, 1, true), coreMat);
  core.geometry.translate(0, 9, 0); core.position.y = MOUTH_Y - .2; core.scale.y = .001; scene.add(core);

  // fale uderzeniowe na podłodze
  const ringGeo = new THREE.RingGeometry(.92, 1, 96);
  const rings = [];
  function ring(delay, speed, color = main) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = .03; scene.add(m);
    rings.push({ m, t: -delay, speed });
  }

  // cząsteczki: wsysanie przy ładowaniu, wybuch, potem żar / pył
  const N = 1400, pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), col = new Float32Array(N * 3), base = new Float32Array(N * 3);
  const life = new Float32Array(N), max = new Float32Array(N), kind = new Uint8Array(N);   // 0 nic, 1 wsysanie, 2 wybuch, 3 unosi się, 4 opada, 5 spirala
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pMat = new THREE.PointsMaterial({ map: dot, size: .16, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  scene.add(new THREE.Points(pGeo, pMat));
  let cursor = 0;
  const tmp = new THREE.Color();
  function emit(k, x, y, z, vx, vy, vz, l, colorHex) {
    const i = cursor; cursor = (cursor + 1) % N;
    kind[i] = k; life[i] = l; max[i] = l;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    tmp.set(colorHex); base[i * 3] = tmp.r; base[i * 3 + 1] = tmp.g; base[i * 3 + 2] = tmp.b;
  }
  const pick = () => tier.colors[Math.floor(Math.random() * tier.colors.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Tajna: osiem reflektorów w kręgu zapala się po kolei, trzy pierścienie światła krążą jak żyroskop i zaciskają się
  // na skrzynce, tarcza na podłodze się obraca, a kamera robi pełne okrążenie, zanim skrzynka wybuchnie
  const rig = tier.orbit ? (() => {
    const beams = [], halos = [], g = new THREE.Group();
    scene.add(g);
    for (let i = 0; i < 8; i++) {
      const a = (i + .5) / 8 * Math.PI * 2;
      const mat = new THREE.MeshBasicMaterial({ map: pTex, color: i % 2 ? '#ffffff' : main, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(.04, .42, 17, 24, 1, true), mat);
      m.geometry.translate(0, 8.5, 0);
      const spotMat = new THREE.MeshBasicMaterial({ map: dot, color: main, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const spot = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), spotMat);
      spot.rotation.x = -Math.PI / 2; spot.position.y = .02;
      const p = new THREE.Group();
      p.position.set(Math.cos(a) * 5.6, 0, Math.sin(a) * 5.6); p.rotation.y = -a;
      p.add(m, spot); g.add(p);
      beams.push({ m, mat, spotMat, a, on: 0, at: .08 + i * .075, ph: Math.random() * 6 });
    }
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: i === 1 ? '#ffffff' : main, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(new THREE.TorusGeometry(2.3 + i * .35, .025 + i * .008, 8, 160), mat);
      m.position.y = MOUTH_Y; g.add(m);
      halos.push({ m, mat, spin: [.7 + i * .35, 1.1 - i * .3, .4 + i * .2], tilt: [.4 + i * .5, i * .9, .2] });
    }
    const sigilTex = sigilTexture();
    const sigilMat = new THREE.MeshBasicMaterial({ map: sigilTex, color: main, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const sigil = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), sigilMat);
    sigil.rotation.x = -Math.PI / 2; sigil.position.y = .025; g.add(sigil);
    return { beams, halos, sigil, sigilMat, sigilTex, ang: 0, dip: 0, burstT: -1 };
  })() : null;

  function rigFrame(dt, t, charge, k) {
    const r = rig;
    if (s.phase === 'charge') {
      // reflektory zapalają się jeden po drugim z błyskiem
      for (const b of r.beams) if (!b.on && charge >= b.at) { b.on = 1; s.shake = Math.max(s.shake, .25); }
      for (const b of r.halos) b.mat.opacity += (charge * .9 - b.mat.opacity) * k(4);
      r.sigilMat.opacity = charge * .85;
    }
    const open = s.phase === 'open', since = r.burstT < 0 ? 0 : t - r.burstT;
    for (const b of r.beams) {
      b.on = Math.max(0, b.on - dt * 1.6);
      const goal = !b.on && !b.lit ? 0 : open ? .14 : .2;
      if (b.on) b.lit = true;
      // reflektory między kamerą a skrzynką prawie gasną, żeby nie zalewały ekranu
      const near = Math.min(1, Math.max(0, (Math.sin(b.a + r.ang) - .1) / .6));
      b.mat.opacity = Math.max(goal + Math.sin(t * 2 + b.ph) * .04 * (goal ? 1 : 0), b.on * .55) * (1 - near * .9);
      b.spotMat.opacity = b.mat.opacity * 1.4;
      // przechylone do środka, kołyszą się; przy wybuchu celują w skrzynkę
      b.m.rotation.z = (open ? .32 : s.phase === 'ascend' ? .36 : .14) + Math.sin(t * .9 + b.ph) * .12;
      b.m.rotation.x = Math.cos(t * .7 + b.ph) * .1;
    }
    r.halos.forEach((h, i) => {
      // przy ładowaniu pierścienie zaciskają się i kręcą coraz szybciej, po wybuchu rozlatują się w szeroką aureolę
      const sp = 1 + charge * 4 + (open ? Math.max(0, 3 - since * 3) : 0);
      h.m.rotation.x = h.tilt[0] + t * h.spin[0] * sp * .5;
      h.m.rotation.y = h.tilt[1] + t * h.spin[1] * sp * .5;
      h.m.rotation.z = h.tilt[2] + t * h.spin[2] * sp * .3;
      const goal = open ? 2.6 + i * .5 : 1.25 - charge * .55;
      const sc = h.m.scale.x + (goal - h.m.scale.x) * k(open ? 3 : 2.5);
      h.m.scale.setScalar(sc);
      h.m.position.y = MOUTH_Y + s.lift + (open ? 1.1 + i * .5 : 0);
      if (open) h.mat.opacity += (.5 - h.mat.opacity) * k(1.5);
    });
    r.sigil.rotation.z += dt * (.15 + charge * 1.2 + (open ? .3 : 0));
    if (open) r.sigilMat.opacity += (.55 - r.sigilMat.opacity) * k(2);
    // wir złotego pyłu wokół skrzynki przy ładowaniu
    if (s.phase === 'charge') for (let i = 0; i < 3; i++) { const a = Math.random() * Math.PI * 2, rr = rnd(2.4, 3.6); emit(5, Math.cos(a) * rr, rnd(0, .6), Math.sin(a) * rr, 0, rnd(1.2, 2.6) * (.5 + charge), 0, rnd(1, 1.8), pick()); }
    // kamera: pełne okrążenie w czasie ładowania (przód skrzynki na końcu), nisko w połowie drogi
    if (s.phase === 'charge') {
      const e = charge < .5 ? 2 * charge * charge : 1 - Math.pow(-2 * charge + 2, 2) / 2;
      r.ang = e * Math.PI * 2; r.dip = -Math.sin(charge * Math.PI) * 1.6;
    } else if (open) {
      const front = Math.ceil(r.ang / (Math.PI * 2) - .001) * Math.PI * 2;
      r.ang += (front - r.ang) * k(5); r.dip += (0 - r.dip) * k(3);
    }
  }

  // przebieg
  const s = { ascStart: 0, ascDur: 1, ascFrom: 0, phase: 'intro', t: 0, y: 11, vy: 0, landed: false, chargeStart: 0, chargeDur: 1, shake: 0, lift: 0, lid: 0, lidVel: 0, open: 0, lidFly: null, pillar: 0, flash: 0, hue: 0, cam: 0 };
  let W = 0, H = 0, running = true, last = performance.now(), onLand = null;
  const camFrom = new THREE.Vector3(0, 5.2, 15), camTo = new THREE.Vector3(0, 3.1, 10.2), look3 = new THREE.Vector3(0, 2.2, 0);

  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = W / H < .8 ? 46 : 34;   // telefon w pionie: szerzej, żeby skrzynka się mieściła
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

  function land() {
    s.landed = true; s.y = 0; s.vy = 0; s.shake = .55;
    ring(0, 7, main);
    for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, v = rnd(2, 6); emit(2, Math.cos(a) * 1.4, .1, Math.sin(a) * 1, Math.cos(a) * v, rnd(.5, 2.2), Math.sin(a) * v * .6, rnd(.5, 1), '#9a9aa6'); }
    onLand?.(); onLand = null;
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, .05), t = now / 1000; last = now;
    s.t += dt;
    const k = r => 1 - Math.exp(-dt * r);

    // kolor: tęcza ULTRA, neonowe miganie Specjalnej
    if (tier.rainbow) { s.hue = (s.hue + dt * .22) % 1; main.setHSL(s.hue, 1, .6); }
    else if (tier.neon) main.set(Math.sin(t * 9) + Math.sin(t * 23) > .6 ? tier.colors[1] : tier.colors[0]);
    for (const m of [seamMat, leakMat, poolMat, pillarMat, rays.material]) m.color.copy(main);
    rim.color.copy(main); glow.color.copy(main);

    // spadanie z odbiciem
    if (!s.landed) {
      s.vy -= 34 * dt; s.y += s.vy * dt;
      if (s.y <= 0) land();
    }
    // ładowanie: drżenie rośnie, szpara świeci coraz mocniej, iskry wpadają do środka
    let charge = 0;
    if (s.phase === 'charge') {
      charge = Math.min(1, (now - s.chargeStart) / s.chargeDur);
      s.lift += ((tier.levitate * charge) - s.lift) * k(3);
      seamMat.opacity = Math.min(1, charge * 1.3) * (.75 + .25 * Math.sin(t * 40 * (.4 + charge)));
      leakMat.opacity = charge * .9;
      leak.scale.setScalar(3 + charge * 4);
      glow.intensity = charge * 18;
      rays.material.opacity = charge * .22;
      const n = Math.round((2 + charge * 9) * dt * 60);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, e = rnd(-.6, 1.2), r = rnd(5, 9);
        const x = Math.cos(a) * Math.cos(e) * r, y = MOUTH_Y + s.lift + Math.sin(e) * r, z = Math.sin(a) * Math.cos(e) * r * .7, l = rnd(.45, .75);
        emit(1, x, y, z, -x / l, (MOUTH_Y + s.lift - y) / l, -z / l, l, pick());
      }
    }
    // Tajna: po okrążeniu kamery skrzynka wzlatuje, rozjarza się do białości i dopiero wtedy wybucha
    let asc = 0;
    if (s.phase === 'ascend') {
      asc = Math.min(1, (now - s.ascStart) / s.ascDur);
      const e = asc * asc * (3 - 2 * asc);
      s.lift = s.ascFrom + e * 2.8;
      seamMat.opacity = 1; leakMat.opacity = 1;
      leak.scale.setScalar(7 + e * 9);
      glow.intensity = 18 + e * 70;
      rays.material.opacity = .22 + e * .4;
      blazeMat.opacity = Math.min(1, e * 1.3); blaze.scale.setScalar(2 + e * 11);
      for (let i = 0; i < 4; i++) emit(2, rnd(-1.2, 1.2), s.lift + rnd(0, 1.2), rnd(-.7, .7), rnd(-1.5, 1.5), rnd(-4, -1), rnd(-1, 1), rnd(.5, 1.1), pick());
    } else if (s.phase === 'open') blazeMat.opacity += (0 - blazeMat.opacity) * k(2.5);
    const tremble = s.phase === 'charge' ? (.01 + charge * charge * .09) : s.phase === 'ascend' ? .05 + asc * .08 : 0;
    root.position.set(rnd(-1, 1) * tremble, Math.max(0, s.y) + s.lift + (s.phase === 'open' ? Math.sin(t * 1.6) * .05 * tier.levitate : 0), rnd(-1, 1) * tremble * .5);
    root.rotation.z = rnd(-1, 1) * tremble * .5;
    if (s.phase === 'open' && tier.levitate) crate.rotation.y += dt * .25 * tier.levitate;

    // wieko: sprężyna do otwartego położenia albo lot w górę
    if (s.lidFly) {
      const f = s.lidFly;
      f.vy -= 16 * dt; lid.position.y += f.vy * dt; lid.position.z -= 4 * dt; lid.rotation.x -= 8 * dt; lid.rotation.z += 3 * dt;
      if (lid.position.y < -20) lid.visible = false;
    } else {
      s.lidVel += ((s.open ? LID_OPEN : 0) - s.lid) * 180 * dt; s.lidVel *= Math.exp(-dt * 11);
      s.lid += s.lidVel * dt; lid.rotation.x = s.lid;
    }

    // po wybuchu: słup światła, poświata, fale, żar
    if (s.phase === 'open') {
      s.pillar += (1 - s.pillar) * k(5);
      pillar.scale.y = core.scale.y = Math.max(.001, s.pillar);
      pillarMat.opacity = .55 * s.pillar * (.85 + .15 * Math.sin(t * 7));
      coreMat.opacity = .8 * s.pillar;
      pillar.rotation.y += dt * .6;
      seamMat.opacity += (0 - seamMat.opacity) * k(6);
      leakMat.opacity += (.75 - leakMat.opacity) * k(4); leak.scale.setScalar(6 + Math.sin(t * 3) * .4);
      glow.intensity += (26 - glow.intensity) * k(3);
      poolMat.opacity += (.55 - poolMat.opacity) * k(3);
      rays.material.opacity += (.3 - rays.material.opacity) * k(3);
      const ax = 0, ay = MOUTH_Y + s.lift;
      if (tier.ambient === 'embers' && Math.random() < dt * 40) emit(3, ax + rnd(-.9, .9), ay, rnd(-.5, .5), rnd(-.3, .3), rnd(1.2, 2.8), rnd(-.2, .2), rnd(1.6, 2.8), pick());
      if (tier.ambient === 'spiral') for (let i = 0; i < 2; i++) { const a = t * 3 + i * Math.PI; emit(5, Math.cos(a) * 1.4, ay, Math.sin(a) * 1.4, -Math.sin(a) * 2, rnd(2, 3.5), Math.cos(a) * 2, rnd(1.8, 2.6), pick()); }
      if (tier.ambient === 'dust' && Math.random() < dt * 55) emit(4, rnd(-11, 11), rnd(9, 12), rnd(-5, 3), rnd(-.15, .15), rnd(-1.2, -.6), 0, rnd(6, 9), pick());
      if (tier.ambient === 'neon' && Math.random() < dt * 30) emit(3, ax + rnd(-1.2, 1.2), ay, rnd(-.6, .6), rnd(-1.5, 1.5), rnd(1.5, 3.5), rnd(-.4, .4), rnd(.8, 1.4), pick());
    }
    if (rig) rigFrame(dt, t, s.phase === 'ascend' ? 1 : charge, k);
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      if (r.t < 0) continue;
      const sc = .5 + r.t * r.speed;
      r.m.scale.set(sc, sc, sc);
      r.m.material.opacity = Math.max(0, 1 - r.t / 1.3) * .9;
      if (tier.rainbow) r.m.material.color.setHSL((s.hue + i * .17) % 1, 1, .6);
      if (r.t > 1.3) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
    }

    // cząsteczki
    for (let i = 0; i < N; i++) {
      if (!kind[i]) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { kind[i] = 0; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
      const kd = kind[i];
      if (kd === 2) { vel[i * 3 + 1] -= 7 * dt; const d = Math.exp(-dt * 1.4); vel[i * 3] *= d; vel[i * 3 + 2] *= d; }
      else if (kd === 3) vel[i * 3] += Math.sin(t * 3 + i) * dt * .6;
      else if (kd === 5) { const x = pos[i * 3], z = pos[i * 3 + 2]; vel[i * 3] = -z * 1.6; vel[i * 3 + 2] = x * 1.6; }
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const f = life[i] / max[i], a = kd === 1 ? Math.min(1, (1 - f) * 3) : kd === 4 ? Math.min(1, f * 3, (1 - f) * 6) : Math.min(1, f * 1.6);
      col[i * 3] = base[i * 3] * a; col[i * 3 + 1] = base[i * 3 + 1] * a; col[i * 3 + 2] = base[i * 3 + 2] * a;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;

    // kamera: odjazd z góry, podczas ładowania najazd, przy wybuchu wstrząs
    const goal = s.phase === 'intro' ? .15 : s.phase === 'charge' ? .3 + charge * .55 : .7;
    s.cam += (goal - s.cam) * k(s.phase === 'open' ? 2.5 : 2);
    s.shake = Math.max(0, s.shake - dt * 1.8);
    camera.position.lerpVectors(camFrom, camTo, s.cam);
    if (s.phase === 'open') camera.position.x += Math.sin(t * .35) * .9;
    if (rig) {
      const c = Math.cos(rig.ang), sn = Math.sin(rig.ang), x = camera.position.x, z = camera.position.z;
      camera.position.x = x * c + z * sn; camera.position.z = -x * sn + z * c; camera.position.y += rig.dip;
      rays.position.set(-sn * 6, 3 + s.lift, -c * 6);
      camera.position.y += s.lift * .45;   // kamera i jej cel idą w górę za wzlatującą skrzynką   // promienie zawsze za skrzynką, patrząc od kamery
    }
    const sh = s.shake * s.shake * .5;
    camera.position.x += rnd(-1, 1) * sh; camera.position.y += rnd(-1, 1) * sh;
    look3.y = 2.2 + (rig ? s.lift * .75 : 0);
    camera.lookAt(look3);
    rays.lookAt(camera.position);
    rays.rotation.z = t * .08;
    shadow.scale.setScalar(1 - Math.min(1, (Math.max(0, s.y) + s.lift) / 8) * .6);

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  const vis = () => { if (!document.hidden && running) last = performance.now(); };
  document.addEventListener('visibilitychange', vis);

  return {
    /** Skrzynka spada; obietnica kończy się przy uderzeniu o podłogę */
    intro(fast = false) {
      s.vy = fast ? -14 : -4;
      return new Promise(done => { if (s.landed) done(); else onLand = done; });
    },
    charge(ms) {
      if (!s.landed) land();
      s.phase = 'charge'; s.chargeStart = performance.now(); s.chargeDur = ms;
    },
    /** Tajna: skrzynka wzlatuje i rozjarza się przez ms, potem burst() */
    ascend(ms) {
      s.phase = 'ascend'; s.ascStart = performance.now(); s.ascDur = ms; s.ascFrom = s.lift;
    },
    burst() {
      if (!s.landed) land();
      pillar.position.y = core.position.y = MOUTH_Y - .2 + s.lift;
      s.phase = 'open'; s.open = 1; s.shake = 1.15; s.lidVel = -14;
      if (tier.lidFly) s.lidFly = { vy: 11 };
      if (rig) {
        rig.burstT = performance.now() / 1000;
        for (const b of rig.beams) b.on = 1;   // wszystkie reflektory błyskają naraz
        // kamera od razu na wprost skrzynki: karta wylatuje z otworu widocznego z przodu
        rig.ang = Math.ceil(rig.ang / (Math.PI * 2) - .001) * Math.PI * 2; rig.dip = 0;
        scene.updateMatrixWorld();
      }
      for (let i = 0; i < tier.rings; i++) ring(i * .14, 9 + i * 2.5, i % 2 ? new THREE.Color('#ffffff') : main.clone());
      const ay = MOUTH_Y + s.lift;
      for (let i = 0; i < 520; i++) {
        const a = Math.random() * Math.PI * 2, up = rnd(.15, 1), v = rnd(4, 13);
        emit(2, rnd(-.6, .6), ay, rnd(-.4, .4), Math.cos(a) * v * (1 - up * .6), v * up + 3, Math.sin(a) * v * (1 - up * .6) * .7, rnd(1.2, 2.6), pick());
      }
    },
    /** Otwór skrzynki w pikselach okna: stąd wylatuje karta */
    mouth() {
      const v = new THREE.Vector3(0, MOUTH_Y, 0).applyMatrix4(crate.matrixWorld).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    },
    destroy() {
      running = false; ro.disconnect(); document.removeEventListener('visibilitychange', vis);
      scene.traverse(o => { if (o.geometry && o.geometry !== ringGeo) o.geometry.dispose(); });
      ringGeo.dispose(); kit.dispose(); env.dispose(); dot.dispose(); pTex.dispose();
      if (rig) {
        rig.sigilTex.dispose(); rig.sigilMat.dispose();
        for (const b of rig.beams) { b.mat.dispose(); b.spotMat.dispose(); }
        for (const h of rig.halos) h.mat.dispose();
      }
      for (const m of [blazeMat, seamMat, leakMat, poolMat, pillarMat, coreMat, pMat, rays.material, shadow.material, floor.material]) m.dispose();
      renderer.dispose();
    }
  };
}
