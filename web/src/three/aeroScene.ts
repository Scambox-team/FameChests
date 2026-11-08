// @ts-nocheck -- Frutiger Aero (wariant `aero`, makieta „Mniejsza planeta jak horyzont”): sceny Three.js.
// Na kartach w listach (setki kart, limit kontekstów WebGL ~16) scena jest renderowana RAZ do dwóch obrazków (aeroStills):
// tło - trawiasta planeta z wieżowcami (pod zdjęciem i szklanymi panelami) i przód - rybki i szklane kule (nad kartą);
// obrazki trafiają do zmiennych CSS --aero-back / --aero-front na :root. W podglądzie karty (fx/effects.ts) mountAeroLive
// podmienia oba obrazki na żywe płótna z animacją; płótna sprzątają się same, gdy podgląd znika.
import * as THREE from 'three';

const T = THREE;
const W = 504, H = 704;   // proporcje karty 63 : 88

const BUBBLE_VERT = `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
// szklana kula / atmosfera: tęczowa obwódka (fresnel), odblask światła, przy `glass` > 0 zabarwiona i bardziej kryjąca
const BUBBLE_FRAG = `
uniform float time; uniform vec3 tint; uniform float glass; varying vec3 vN; varying vec3 vP;
void main(){
  vec3 V = normalize(cameraPosition - vP), N = normalize(vN);
  float f = pow(1.0 - max(dot(N, V), 0.0), 2.2);
  vec3 iri = 0.55 + 0.45 * cos(6.2831 * (f * 1.3 + vec3(0.0, 0.33, 0.67)) + time * 0.6);
  vec3 L = normalize(vec3(-0.5, 0.8, 0.6));
  float sp = pow(max(dot(reflect(-L, N), V), 0.0), 50.0);
  float top = smoothstep(-0.2, 1.0, N.y);
  vec3 base = mix(mix(vec3(0.92, 1.0, 1.0), iri, 0.65), tint, glass);
  float a = mix(f * 0.85 + 0.05, 0.35 + f * 0.6, glass) + sp;
  gl_FragColor = vec4(base * (0.55 + f * 0.9 + top * glass * 0.4) + sp, clamp(a, 0.0, 1.0));
}`;
const bubbleMat = (tint, glass = 0) => new T.ShaderMaterial({ uniforms: { time: { value: 0 }, tint: { value: new T.Color(tint) }, glass: { value: glass } }, vertexShader: BUBBLE_VERT, fragmentShader: BUBBLE_FRAG, transparent: true, depthWrite: false });
const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; };
const seeded = seed => { let s = seed; return () => (s = s * 16807 % 2147483647) / 2147483647; };

function grassTexture() {
  const r = seeded(9);
  return canvasTex(256, 128, g => {
    g.fillStyle = 'hsl(110 60% 42%)'; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 900; i++) { g.fillStyle = `hsl(${110 + (r() * 30 - 15)} ${50 + r() * 30}% ${32 + r() * 25}%)`; g.fillRect(r() * 256, r() * 128, 3, 3); }
  });
}
// szklane okna wieżowca: niebieskie szkło, część okien zapalona
function cityTexture(seed) {
  const r = seeded(seed);
  return canvasTex(64, 128, g => {
    const grd = g.createLinearGradient(0, 0, 64, 0); grd.addColorStop(0, '#1b4a72'); grd.addColorStop(.5, '#3d86c0'); grd.addColorStop(1, '#173f62');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 124; y += 9) for (let x = 5; x < 60; x += 14) { g.fillStyle = r() < .45 ? '#ffe7a0' : r() < .5 ? '#9fd8ff' : '#0f2a44'; g.fillRect(x, y, 9, 5); }
  });
}
// trawiasta planeta: skupisko wieżowców po stronie `dir`, dookoła drzewka, szklana atmosfera
function cityPlanet(r, dir) {
  const g = new T.Group(), rnd = seeded(31), up = new T.Vector3(0, 1, 0);
  const rv = () => new T.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
  g.add(new T.Mesh(new T.SphereGeometry(r, 56, 40), new T.MeshStandardMaterial({ map: grassTexture(), roughness: .8 })));
  for (let i = 0; i < 13; i++) {
    const n = dir.clone().add(rv().multiplyScalar(.42)).normalize();
    const h = r * (.22 + rnd() * .55), w = r * (.07 + rnd() * .06);
    const geo = new T.BoxGeometry(w, h, w); geo.translate(0, h / 2, 0);
    const tex = cityTexture(7 + i * 31); tex.wrapT = T.RepeatWrapping; tex.repeat.set(1, h / (r * .4));
    const b = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex, roughness: .25, metalness: .2, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .55 }));
    b.position.copy(n.clone().multiplyScalar(r * .97)); b.quaternion.setFromUnitVectors(up, n); g.add(b);
  }
  const trunk = new T.MeshStandardMaterial({ color: 0x6b4423, roughness: .8 }), leaf = new T.MeshStandardMaterial({ color: 0x1f8a3a, roughness: .6 });
  for (let i = 0; i < 26; i++) {
    const n = rv();
    if (n.dot(dir) > .8) continue;
    const tree = new T.Group();
    const tr = new T.Mesh(new T.CylinderGeometry(r * .015, r * .02, r * .1, 6), trunk); tr.position.y = r * .05; tree.add(tr);
    const cr = new T.Mesh(new T.SphereGeometry(r * .055, 10, 8), leaf); cr.position.y = r * .13; tree.add(cr);
    tree.position.copy(n.clone().multiplyScalar(r * .98)); tree.quaternion.setFromUnitVectors(up, n); g.add(tree);
  }
  g.add(new T.Mesh(new T.SphereGeometry(r * 1.18, 48, 32), bubbleMat(0x8fd8ff, .12)));
  return g;
}
// rybka: tułów z rozciągniętej kuli w paski, ogon i płetwa z trójkątów, czarne oczy
function fish(base, stripe) {
  const g = new T.Group();
  const map = canvasTex(256, 64, c => { c.fillStyle = base; c.fillRect(0, 0, 256, 64); c.fillStyle = stripe; for (let i = 0; i < 3; i++) c.fillRect(40 + i * 70, 0, 16, 64); });
  const body = new T.Mesh(new T.SphereGeometry(1, 28, 18), new T.MeshStandardMaterial({ map, roughness: .35, metalness: .05 })); body.scale.set(.32, .17, .1); g.add(body);
  const finMat = new T.MeshStandardMaterial({ color: stripe === '#ffffff' ? base : stripe, side: T.DoubleSide, roughness: .4, transparent: true, opacity: .92 });
  const ts = new T.Shape(); ts.moveTo(0, 0); ts.lineTo(-.22, .14); ts.lineTo(-.18, 0); ts.lineTo(-.22, -.14); ts.lineTo(0, 0);
  const tail = new T.Mesh(new T.ShapeGeometry(ts), finMat); tail.position.x = -.28; g.add(tail);
  const fs = new T.Shape(); fs.moveTo(-.12, 0); fs.lineTo(0, .12); fs.lineTo(.1, 0);
  const fin = new T.Mesh(new T.ShapeGeometry(fs), finMat); fin.position.y = .14; g.add(fin);
  const eye = new T.Mesh(new T.SphereGeometry(.03, 10, 10), new T.MeshBasicMaterial({ color: 0x111111 })); eye.position.set(.2, .04, .07); g.add(eye);
  const eye2 = eye.clone(); eye2.position.z = -.07; g.add(eye2);
  return g;
}
// warstwa „back” (planeta) albo „front” (rybki, kule); update(t) przesuwa animację
function buildScene(layer) {
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(35, W / H, .1, 100);
  camera.position.set(0, 0, 6); camera.lookAt(0, 0, 0);
  scene.add(new T.HemisphereLight(0xcff6ff, 0x6fbf4a, 1.3));
  const dl = new T.DirectionalLight(0xffffff, 1.6); dl.position.set(-2, 4, 5); scene.add(dl);
  const mats = [];
  if (layer === 'back') {
    const g = cityPlanet(1.35, new T.Vector3(0, 1, .9).normalize()); g.position.set(0, -1.95, 0); scene.add(g);
    g.traverse(o => o.material?.uniforms?.time && mats.push(o.material));
    return { scene, camera, update: t => mats.forEach(m => m.uniforms.time.value = t) };
  }
  const orbs = [[.3, 0x2fd0ff, -1.0, 1.55], [.22, 0x7cff6a, 1.05, 1.4], [.16, 0xffffff, 0, 1.75]].map(([r, tint, x, y], k) => {
    const m = bubbleMat(tint, .55); mats.push(m);
    const b = new T.Mesh(new T.SphereGeometry(r, 36, 24), m); b.position.set(x, y, .4); b.userData = { y0: y, ph: k * 1.7 }; scene.add(b); return b;
  });
  const fishes = [['#ff7a1a', '#ffffff'], ['#2a7de1', '#ffd23d'], ['#18c7c1', '#ffffff']].map(([a, b], k) => {
    const f = fish(a, b); f.userData = { y: [-1.2, .1, 1.1][k], sp: (.35 + k * .08) * (k % 2 ? -1 : 1), ph: k * 2.1 }; f.scale.setScalar(.5 + k * .06); scene.add(f); return f;
  });
  return {
    scene, camera,
    update(t) {
      mats.forEach(m => m.uniforms.time.value = t);
      orbs.forEach(o => { o.position.y = o.userData.y0 + Math.sin(t * .7 + o.userData.ph) * .06; });
      fishes.forEach(o => {
        const u = o.userData, a = t * u.sp + u.ph, x = Math.cos(a) * 1.26, z = Math.sin(a) * 1.1, s = Math.sign(u.sp);
        o.position.set(x, u.y + Math.sin(t * .8 + u.ph) * .1, z);
        o.rotation.y = -Math.atan2(Math.sin(a + .05 * s) * 1.1 - z, Math.cos(a + .05 * s) * 1.26 - x);
        o.children[1].rotation.y = Math.sin(t * 9 + u.ph) * .5;
      });
    },
  };
}

let stills = null;
// jednorazowy render obu warstw do obrazków dla kart w listach
export function aeroStills() {
  if (stills) return stills;
  stills = new Promise(resolve => {
    try {
      const canvas = document.createElement('canvas');
      const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(W, H, false); renderer.outputColorSpace = T.SRGBColorSpace;
      const shot = (layer, t) => { const s = buildScene(layer); s.update(t); renderer.render(s.scene, s.camera); const url = canvas.toDataURL('image/png'); s.scene.traverse(o => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach(m => { m.map?.dispose?.(); m.dispose?.(); }); }); return url; };
      const back = shot('back', 0), front = shot('front', 2.2);
      renderer.dispose(); renderer.forceContextLoss?.();
      document.documentElement.style.setProperty('--aero-back', `url(${back})`);
      document.documentElement.style.setProperty('--aero-front', `url(${front})`);
      resolve({ back, front });
    } catch { resolve(null); }   // bez WebGL karty zostają z samym tłem (niebo, wzgórza)
  });
  return stills;
}

// podgląd karty: żywe płótna w miejsce obrazków
export function mountAeroLive(card) {
  if (!card) return;
  for (const [sel, layer] of [['.ae3-planet', 'back'], ['.ae3-front', 'front']]) {
    const el = card.querySelector(sel);
    if (!el) continue;
    const canvas = document.createElement('canvas');
    canvas.className = 'ae3-live';
    el.replaceWith(canvas);
    let renderer;
    try { renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true }); } catch { canvas.replaceWith(el); continue; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.outputColorSpace = T.SRGBColorSpace;
    const s = buildScene(layer), t0 = performance.now();
    let w = 0, h = 0;
    renderer.setAnimationLoop(() => {
      if (!canvas.isConnected) {
        renderer.setAnimationLoop(null);
        s.scene.traverse(o => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach(m => { m.map?.dispose?.(); m.dispose?.(); }); });
        renderer.dispose(); renderer.forceContextLoss?.(); return;
      }
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return;
      if (cw !== w || ch !== h) { w = cw; h = ch; renderer.setSize(w, h, false); s.camera.aspect = w / h; s.camera.updateProjectionMatrix(); }
      s.update((performance.now() - t0) / 1000);
      renderer.render(s.scene, s.camera);
    });
  }
}
