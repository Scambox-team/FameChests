// @ts-nocheck -- kod rysujący na canvasie i w DOM-ie, przeniesiony bez zmian; typy dochodzą przy dalszym porządkowaniu
// Skrzynka 3D: scena na przezroczystym tle, kolory biorą się z danych skrzynki
import * as THREE from 'three';

const LID_OPEN = -1.95;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function box(w, h, d, r = .05) {
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
function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, '#fff'); g.addColorStop(.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function emblemTexture(d, c1, c2) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = c1; x.fillRect(0, 0, 256, 256);
  x.translate(128 - 84, 128 - 84); x.scale(7, 7);
  x.strokeStyle = c2; x.lineWidth = 1.9; x.lineCap = 'round'; x.lineJoin = 'round';
  x.stroke(new Path2D(d));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
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

export type CrateScene = ReturnType<typeof createCrateScene>;

export function createCrateScene(canvas, { sideShift = .29 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 50);
  camera.position.set(0, 2.5, 7.8);
  camera.lookAt(0, .92, 0);

  // proste otoczenie, żeby metal miał w czym się odbijać
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#15161a');
  for (const [x, y, z, s, c] of [[0, 6, 2, 8, '#ffffff'], [-6, 1, 3, 3, '#ffffff'], [6, 2, -2, 4, '#8fa3c8']]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, .2), new THREE.MeshBasicMaterial({ color: c }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, .05).texture;
  scene.environmentIntensity = .55;

  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(-3, 5, 5); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffffff', 3); rim.position.set(3, 3, -4); scene.add(rim);

  const mat = {
    body: new THREE.MeshStandardMaterial({ roughness: .62, metalness: .05 }),
    lid: new THREE.MeshStandardMaterial({ roughness: .5, metalness: .05 }),
    trim: new THREE.MeshStandardMaterial({ color: '#3a3c43', roughness: .3, metalness: .92 }),
    emblem: new THREE.MeshStandardMaterial({ roughness: .4, metalness: .1 })
  };

  // jedna skrzynka: geometrie i materiały są wspólne, więc kolejne kopie są tanie
  const geo = {
    body: box(2.6, 1.2, 1.7, .06), base: box(2.74, .12, 1.84, .05), rimTop: box(2.68, .09, 1.78, .04), band: box(.24, 1.24, 1.76, .03), plate: box(.66, .72, .1, .04),
    emblem: new THREE.CircleGeometry(.25, 40), lid: lidGeo(2.6, 1.7, .68), lidBand: lidGeo(.24, 1.76, .72), lock: box(.34, .3, .07, .03), inner: new THREE.PlaneGeometry(2.4, 1.5), shadow: new THREE.PlaneGeometry(5, 3)
  };
  // światło ze środka widać dopiero po uchyleniu wieka
  const inner = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 });
  const dot = softDot();
  const flareMat = new THREE.SpriteMaterial({ map: dot, color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const shadowMat = new THREE.MeshBasicMaterial({ map: dot, color: '#000000', transparent: true, opacity: .6, depthWrite: false });

  function buildCrate() {
    const g = new THREE.Group();
    const add = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
    add(geo.body, mat.body, 0, .62, 0);
    add(geo.base, mat.trim, 0, .06, 0);
    add(geo.rimTop, mat.trim, 0, 1.2, 0);
    for (const sx of [-.86, .86]) add(geo.band, mat.trim, sx, .62, 0);
    add(geo.plate, mat.trim, 0, .86, .89);
    add(geo.emblem, mat.emblem, 0, .86, .945);
    const lid = new THREE.Group();
    lid.position.set(0, 1.25, -.86);
    g.add(lid);
    add(geo.lid, mat.lid, 0, 0, .86, lid);
    for (const sx of [-.86, .86]) add(geo.lidBand, mat.trim, sx, 0, .86, lid);
    add(geo.lock, mat.trim, 0, .02, 1.75, lid);
    add(geo.inner, inner, 0, 1.23, 0).rotation.x = -Math.PI / 2;
    const flare = new THREE.Sprite(flareMat);
    flare.position.set(0, 1.5, 0); flare.scale.setScalar(5); g.add(flare);
    const shadow = new THREE.Mesh(geo.shadow, shadowMat);
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.01;
    scene.add(g, shadow);
    return { g, lid, shadow, x: 0, z: 0, y: 0, vy: 0, wait: 0, lidAt: 0, phase: Math.random() * 6, leaving: 0 };
  }

  // kilka skrzynek naraz: układ w rzędach, nowe spadają z góry, kamera odjeżdża tak, żeby zmieściły się wszystkie
  const crates = [buildCrate()];
  const cam = { dist: 1, distTo: 1, cols: 1, rows: 1 };
  function layout(n) {
    const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n * 1.2)), rows = Math.ceil(n / cols);
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols), c = i - r * cols;
      out.push([(c - (inRow - 1) / 2) * 3.2, -(r - (rows - 1) / 2) * 2.6 - (rows - 1) * .4]);
    }
    return { out, cols, rows };
  }
  // odległość kamery tak, żeby cały rząd zmieścił się w części sceny ze skrzynką (na szerokim ekranie lewa kolumna)
  function fit() {
    if (!W || !H) return;
    const frac = W > 860 ? .34 : .9, half = Math.tan(camera.fov * Math.PI / 360);
    const needW = (cam.cols * 3.2 + .4) / (2 * half * (W / H) * frac) / 8.2;
    const needH = (1.9 + (cam.rows - 1) * 1.3) / (2 * half * .8) / 8.2;
    cam.distTo = Math.max(1, needW, needH);
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
    const { out, cols, rows } = layout(n);
    alive.slice(0, n).forEach((c, i) => { c.x = out[i][0]; c.z = out[i][1]; });
    cam.cols = cols; cam.rows = rows;
    fit();
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
    mat.emblem.map?.dispose();
    mat.emblem.map = emblemTexture(c.d, c.c1, c.c2); mat.emblem.needsUpdate = true;
    mat.emblem.color.set('#ffffff');
    if (!hasCrate) { mat.body.color.copy(color.body); mat.lid.color.copy(color.lid); color.raysNow.copy(color.raysTo); hasCrate = true; } else if (!reduced) s.hop = 1;
    close();
  }
  function burst(hex, n) {
    pMat.color.set(hex);
    for (let i = 0; i < Math.min(n, N); i++) {
      const from = crates.filter(c => !c.leaving)[i % crates.filter(c => !c.leaving).length] || crates[0];
      pPos[i * 3] = from.x + (Math.random() - .5) * 2; pPos[i * 3 + 1] = 1.3; pPos[i * 3 + 2] = from.z + (Math.random() - .5) * 1.2;
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
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const wide = W > 860;
    if (wide) camera.setViewOffset(W, H, W * sideShift, 0, W, H); else camera.clearViewOffset();
    camera.fov = wide ? 30 : 26;
    camera.updateProjectionMatrix();
    fit();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
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
        if (c.leaving <= 0) { scene.remove(c.g, c.shadow); crates.splice(i, 1); continue; }
      }
      c.lidAt = Math.max(0, c.lidAt - dt);
      c.lid.rotation.x = c.lidAt > 0 ? 0 : s.lid;
      const scale = c.leaving ? c.leaving : 1;
      c.g.scale.setScalar(scale);
      c.g.position.set(c.x, Math.max(0, c.y) + Math.sin(Math.PI * s.hop) * .34 + (reduced ? 0 : Math.sin(t * 1.1 + c.phase) * .018) + (c.leaving ? (1 - c.leaving) * 3 : 0), c.z);
      c.g.rotation.y = -.42 + s.yaw + idle + jolt;
      c.g.rotation.x = s.pitch;
      c.g.rotation.z = jolt * .7;
      c.shadow.position.set(c.x, -.01, c.z);
      const air = Math.min(1, Math.max(0, c.y) / 7);
      c.shadow.scale.setScalar(scale * (1 - air * .6));
      c.shadow.material.opacity = .6;
    }
    cam.dist += (cam.distTo - cam.dist) * k(3);
    // kamera odjeżdża wzdłuż tej samej osi, więc środek układu skrzynek zostaje w tym samym miejscu kadru
    camera.position.set(0, .92 + 1.58 * cam.dist, 7.8 * cam.dist);
    camera.lookAt(0, .92, 0);
    rays.scale.setScalar(cam.dist);

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
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  function pointer(nx, ny, over) { s.yawTo = nx * .55; s.pitchTo = ny * .12; s.hover = over && !s.open; }
  const vis = () => { const v = !document.hidden; if (v && !running) { running = true; last = performance.now(); requestAnimationFrame(frame); } else if (!v) running = false; };
  document.addEventListener('visibilitychange', vis);

  return {
    setCrate, setCount, open, close, pointer,
    destroy() { running = false; ro.disconnect(); document.removeEventListener('visibilitychange', vis); renderer.dispose(); pmrem.dispose(); }
  };
}
