// @ts-nocheck -- kod rysujący na canvasie i w DOM-ie, przeniesiony bez zmian; typy dochodzą przy dalszym porządkowaniu
// Skrzynka 3D: scena na przezroczystym tle, kolory biorą się z danych skrzynki
import * as THREE from 'three';
import { crateEnvironment, crateKit, LID_OPEN, softDot } from './crateModel';
import { mountR3F } from './r3f';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// piramida: rząd z przodu jest najszerszy i stoi na podłodze, każdy dalszy o skrzynkę węższy, stopień wyżej i dalej
const STEP_X = 3.2, TIER_Y = 1.05, TIER_Z = 2.1;

function makeRays(n) {
  const pos = [], col = [], rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < n; i++) {
    const a = (i + rnd(-.25, .25)) / n * Math.PI * 2, w = rnd(.05, .13), r = rnd(6, 10);
    pos.push(0, 0, 0, Math.cos(a - w) * r, Math.sin(a - w) * r, 0, Math.cos(a + w) * r, Math.sin(a + w) * r, 0);
    const k = rnd(.35, 1);
    col.push(k, k, k, 0, 0, 0, 0, 0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .13, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
}

/** Układ piramidy dla n skrzynek: pierwsze trafiają do przedniego, najszerszego rzędu */
export function pyramid(n) {
  let base = 1;
  while (base * (base + 1) / 2 < n) base++;
  const rows = [];
  for (let left = n, r = 0; left > 0; r++) { const k = Math.min(base - r, left); rows.push(k); left -= k; }
  const out = [];
  rows.forEach((k, r) => {
    for (let c = 0; c < k; c++) out.push({ x: (c - (k - 1) / 2) * STEP_X, y: r * TIER_Y, z: ((rows.length - 1) / 2 - r) * TIER_Z });
  });
  return { out, cols: base, rows: rows.length };
}

export type CrateScene = ReturnType<typeof createCrateScene>;

export function createCrateScene(canvas, { sideShift = .29 } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 80);
  camera.position.set(0, 2.5, 7.8);
  camera.lookAt(0, .92, 0);

  // renderer, rozmiar i pętla klatek: React Three Fiber (three/r3f.tsx)
  const host = mountR3F(canvas, { scene, camera, maxDpr: 2, exposure: 1.1 });
  const renderer = host.gl;
  const env = crateEnvironment(renderer);
  scene.environment = env.texture;
  scene.environmentIntensity = .55;

  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(-3, 5, 5); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffffff', 3); rim.position.set(3, 3, -4); scene.add(rim);

  const kit = crateKit(), mat = kit.mat, inner = mat.inner;
  const dot = softDot();
  const flareMat = new THREE.SpriteMaterial({ map: dot, color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const shadowMat = new THREE.MeshBasicMaterial({ map: dot, color: '#000000', transparent: true, opacity: .6, depthWrite: false });
  const shadowGeo = new THREE.PlaneGeometry(5, 3);
  // stopnie piramidy: kamienny blok pod każdą skrzynką z dalszego rzędu
  const stepGeo = new THREE.BoxGeometry(STEP_X - .06, 1, TIER_Z - .04);
  stepGeo.translate(0, .5, 0);
  const stepMat = new THREE.MeshStandardMaterial({ color: '#1b1b20', roughness: .85, metalness: .1 });

  function buildCrate() {
    const { g, lid } = kit.build();
    const flare = new THREE.Sprite(flareMat);
    flare.position.set(0, 1.5, 0); flare.scale.setScalar(5); g.add(flare);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.01;
    const step = new THREE.Mesh(stepGeo, stepMat);
    step.scale.y = 1e-3; step.visible = false;
    scene.add(g, shadow, step);
    return { g, lid, shadow, step, x: 0, z: 0, base: 0, px: 0, pz: 0, pb: 0, y: 0, vy: 0, wait: 0, lidAt: 0, phase: Math.random() * 6, leaving: 0, placed: false };
  }

  // kilka skrzynek naraz: piramida, nowe spadają z góry, kamera odjeżdża tak, żeby zmieściły się wszystkie
  const crates = [buildCrate()];
  crates[0].placed = true;
  const cam = { dist: 1, distTo: 1, cols: 1, rows: 1, look: .92, lookTo: .92 };
  // odległość kamery tak, żeby cała piramida zmieściła się w części sceny ze skrzynką (na szerokim ekranie lewa kolumna)
  function fit() {
    if (!W || !H) return;
    const frac = W > 860 && sideShift ? .34 : .9, half = Math.tan(camera.fov * Math.PI / 360);
    const needW = (cam.cols * STEP_X + .4) / (2 * half * (W / H) * frac) / 8.2;
    const needH = (1.9 + (cam.rows - 1) * (TIER_Y + .5)) / (2 * half * .8) / 8.2;
    cam.distTo = Math.max(1, needW, needH);
    cam.lookTo = .92 + (cam.rows - 1) * TIER_Y * .5;
  }
  function setCount(n) {
    n = Math.max(1, Math.min(20, n | 0));
    const alive = crates.filter(c => !c.leaving);
    for (let i = alive.length; i < n; i++) {
      const c = buildCrate();
      c.y = 7 + Math.random() * 1.5; c.wait = reduced ? 0 : (i - alive.length) * .07; c.lidAt = 0;
      if (reduced) c.y = 0;
      crates.push(c); alive.push(c);
    }
    alive.slice(n).forEach(c => { c.leaving = reduced ? 1e-3 : 1; });
    const { out, cols, rows } = pyramid(n);
    alive.slice(0, n).forEach((c, i) => {
      c.x = out[i].x; c.z = out[i].z; c.base = out[i].y;
      if (!c.placed) { c.px = c.x; c.pz = c.z; c.placed = true; }   // nowa skrzynka spada od razu nad swoje miejsce
    });
    cam.cols = cols; cam.rows = rows;
    fit();
  }
  /** Wszystkie skrzynki spadają z góry po kolei (wejście sceny nad ekranem) */
  function dropIn() {
    cam.dist = cam.distTo; cam.look = cam.lookTo;   // kamera od razu na miejscu, ruch robią tylko skrzynki
    crates.filter(c => !c.leaving).forEach((c, i) => {
      c.y = reduced ? 0 : 6 + Math.random(); c.vy = 0; c.wait = reduced ? 0 : i * .06;
      c.px = c.x; c.pz = c.z; c.pb = c.base;
    });
  }

  const rays = makeRays(16);
  rays.position.set(0, .9, -2.4);
  scene.add(rays);

  // pył w powietrzu i wybuch iskier przy otwarciu: jeden bufor punktów
  const N = 150, pPos = new Float32Array(N * 3), pVel = new Float32Array(N * 3), pLife = new Float32Array(N);
  for (let i = 0; i < N; i++) { pPos[i * 3] = (Math.random() - .5) * 8; pPos[i * 3 + 1] = Math.random() * 4; pPos[i * 3 + 2] = (Math.random() - .5) * 3 - .5; }
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ map: dot, size: .075, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false, color: '#ffffff' });
  const points = new THREE.Points(pGeo, pMat);
  scene.add(points);

  // cele, do których wartości płynnie dochodzą
  const color = { body: new THREE.Color(), lid: new THREE.Color(), hue: new THREE.Color(), raysNow: new THREE.Color(), raysTo: new THREE.Color() };
  const s = { lid: 0, lidTo: 0, glow: 0, glowTo: 0, raysPow: .13, raysPowTo: .13, shake: 0, hop: 0, yaw: 0, pitch: 0, yawTo: 0, pitchTo: 0, hover: false, open: false };
  let hasCrate = false, running = true, last = performance.now(), W = 0, H = 0;

  function setCrate(c) {
    color.body.set(c.c2); color.lid.set(c.c1); color.hue.set(c.hue); color.raysTo.set(c.hue);
    rim.color.set(c.hue);
    kit.setEmblem(c);
    if (!hasCrate) { mat.body.color.copy(color.body); mat.lid.color.copy(color.lid); color.raysNow.copy(color.raysTo); hasCrate = true; } else if (!reduced) s.hop = 1;
    close();
  }
  function burst(hex, n) {
    pMat.color.set(hex);
    const alive = crates.filter(c => !c.leaving);
    for (let i = 0; i < Math.min(n, N); i++) {
      const from = alive[i % alive.length] || crates[0];
      pPos[i * 3] = from.px + (Math.random() - .5) * 2; pPos[i * 3 + 1] = from.pb + 1.3; pPos[i * 3 + 2] = from.pz + (Math.random() - .5) * 1.2;
      const a = Math.random() * Math.PI * 2, v = 1.2 + Math.random() * 3.4;
      pVel[i * 3] = Math.cos(a) * v * .55; pVel[i * 3 + 1] = 1.6 + Math.random() * 3.6; pVel[i * 3 + 2] = Math.sin(a) * v * .4;
      pLife[i] = 1 + Math.random() * .9;
    }
  }
  function open(hex, power = .5) {
    return new Promise(done => {
      const wait = reduced ? 0 : 620;
      color.raysTo.set(hex); s.raysPowTo = .2; s.shake = reduced ? 0 : 1; s.hover = false;
      setTimeout(() => {
        s.lidTo = LID_OPEN; s.glowTo = 1; s.raysPowTo = .2 + power * .5; s.open = true;
        inner.color.set(hex); flareMat.color.set(hex);
        // rząd po rzędzie od przodu, tak jak ustawiały się skrzynki
        crates.forEach((c, i) => { c.lidAt = reduced ? 0 : i * .06; });
        burst(hex, (60 + power * 90) * Math.min(3, Math.sqrt(crates.length)));
        setTimeout(done, reduced ? 0 : 420);
      }, wait);
    });
  }
  function close() { s.lidTo = 0; s.glowTo = 0; s.raysPowTo = .13; s.open = false; color.raysTo.copy(color.hue); }

  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return;
    camera.aspect = W / H;
    const wide = W > 860;
    if (wide && sideShift) camera.setViewOffset(W, H, W * sideShift, 0, W, H); else camera.clearViewOffset();
    camera.fov = wide ? 30 : 26;
    camera.updateProjectionMatrix();
    fit();
  }
  host.onResize(resize); resize();

  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, .05), t = now / 1000; last = now;
    const k = r => 1 - Math.exp(-dt * r);

    s.lid += ((s.open ? s.lidTo : s.hover ? -.09 : 0) - s.lid) * k(s.open ? 7 : 9);
    s.glow += (Math.max(s.glowTo, s.hover ? .28 : 0) - s.glow) * k(6);
    s.raysPow += (s.raysPowTo - s.raysPow) * k(4);
    s.yaw += (s.yawTo - s.yaw) * k(5); s.pitch += (s.pitchTo - s.pitch) * k(5);
    s.shake = Math.max(0, s.shake - dt * 1.5); s.hop = Math.max(0, s.hop - dt * 2.6);

    mat.body.color.lerp(color.body, k(8)); mat.lid.color.lerp(color.lid, k(8));
    color.raysNow.lerp(color.raysTo, k(6)); rays.material.color.copy(color.raysNow);
    rays.material.opacity = s.raysPow; if (!reduced) rays.rotation.z = t * .05;

    inner.opacity = Math.min(1, s.glow * 1.4);
    flareMat.opacity = s.glow * .8 / Math.sqrt(crates.length);

    const jolt = s.shake > 0 ? Math.sin(t * 62) * .035 * s.shake : 0;
    for (let i = crates.length - 1; i >= 0; i--) {
      const c = crates[i], idle = reduced ? 0 : Math.sin(t * .6 + c.phase) * .07;
      if (c.wait > 0) c.wait -= dt;
      else if (c.y > 0 || c.vy > 0) {   // spadanie z odbiciem
        c.vy -= 26 * dt; c.y += c.vy * dt;
        if (c.y <= 0) { c.y = 0; c.vy = Math.abs(c.vy) > 3 ? -c.vy * .32 : 0; if (c.vy) s.shake = Math.max(s.shake, .25); }
      }
      if (c.leaving) {
        c.leaving -= dt * 2.6;
        if (c.leaving <= 0) { scene.remove(c.g, c.shadow, c.step); crates.splice(i, 1); continue; }
      }
      // zmiana liczby skrzynek: każda przesuwa się na swoje nowe miejsce, stopień rośnie albo chowa się w podłodze
      const m = reduced ? 1 : k(7);
      c.px += (c.x - c.px) * m; c.pz += (c.z - c.pz) * m; c.pb += ((c.leaving ? 0 : c.base) - c.pb) * m;
      c.lidAt = Math.max(0, c.lidAt - dt);
      c.lid.rotation.x = c.lidAt > 0 ? 0 : s.lid;
      const scale = c.leaving ? c.leaving : 1;
      c.g.scale.setScalar(scale);
      c.g.position.set(c.px, c.pb + Math.max(0, c.y) + Math.sin(Math.PI * s.hop) * .34 + (reduced ? 0 : Math.sin(t * 1.1 + c.phase) * .018) + (c.leaving ? (1 - c.leaving) * 3 : 0), c.pz);
      c.g.rotation.y = -.42 + s.yaw + idle + jolt;
      c.g.rotation.x = s.pitch;
      c.g.rotation.z = jolt * .7;
      c.step.visible = c.pb > .02;
      c.step.scale.y = Math.max(1e-3, c.pb);
      c.step.position.set(c.px, 0, c.pz);
      c.shadow.position.set(c.px, c.pb + .01, c.pz);
      const air = Math.min(1, Math.max(0, c.y) / 7);
      c.shadow.scale.setScalar(scale * (1 - air * .6));
    }
    cam.dist += (cam.distTo - cam.dist) * k(3);
    cam.look += (cam.lookTo - cam.look) * k(3);
    // kamera odjeżdża wzdłuż tej samej osi, więc środek piramidy zostaje w tym samym miejscu kadru
    camera.position.set(0, cam.look + 1.58 * cam.dist, 7.8 * cam.dist);
    camera.lookAt(0, cam.look, 0);
    rays.scale.setScalar(cam.dist);
    rays.position.y = cam.look;

    for (let i = 0; i < N; i++) {
      if (pLife[i] > 0) {
        pLife[i] -= dt;
        pVel[i * 3 + 1] -= 3.6 * dt;
        for (let j = 0; j < 3; j++) pPos[i * 3 + j] += pVel[i * 3 + j] * dt;
      } else if (!reduced) {
        pPos[i * 3 + 1] += dt * .1;
        if (pPos[i * 3 + 1] > 4) pPos[i * 3 + 1] = 0;
      }
    }
    pGeo.attributes.position.needsUpdate = true;
  }
  host.run(frame);

  function pointer(nx, ny, over) { s.yawTo = nx * .55; s.pitchTo = ny * .12; s.hover = over && !s.open; }
  const vis = () => { last = performance.now(); };
  document.addEventListener('visibilitychange', vis);

  return {
    setCrate, setCount, dropIn, open, close, pointer,
    destroy() {
      running = false; document.removeEventListener('visibilitychange', vis);
      kit.dispose(); env.dispose(); dot.dispose(); shadowGeo.dispose(); stepGeo.dispose(); stepMat.dispose(); pGeo.dispose();
      host.dispose();
    }
  };
}
