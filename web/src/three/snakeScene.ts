// @ts-nocheck
// Super Turbo Snake 3D (neon): gra z gotowego pliku (Downloads/index.html), przeniesiona do kontenera .sn3 zamiast całej strony.
// Wszystko jest tu: scena three.js z bloomem, HUD (budowany z HTML poniżej), dźwięk z syntezatora Web Audio i wejście.
// Wynik w punktach (REKORD w localStorage `snake3dBest`); serwerowi po grze idzie liczba zjedzonych jabłek (hooks.onOver).
// Ładować tylko dynamicznym import() po sprawdzeniu use3D() (SnakePage.tsx). Styl: features/snake/snake3d.css.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface SnakeOver { apples: number; score: number; record: boolean }
export interface SnakeHooks {
  onStart: () => void;
  onOver: (r: SnakeOver) => void;
  volume: () => number;
  soundOn: () => boolean;
}
export interface Snake3D { pause: () => void; destroy: () => void }

const HTML = `<div id="vignette"></div>
<div id="danger"></div>
<div id="flash"></div>

<div id="hud">
  <div id="scoreBox">
    <div class="label">WYNIK</div>
    <div id="score">0</div>
    <div id="bestLine">REKORD <b id="best">0</b></div>
  </div>
  <div id="combo">
    <div id="comboText">COMBO x2</div>
    <div id="comboBar"><div id="comboFill"></div></div>
  </div>
  <div id="right">
    <canvas id="minimap" width="320" height="320"></canvas>
    <div class="stat"><div class="label">DŁUGOŚĆ</div><div class="v" id="len">4</div></div>
    <div class="stat"><div class="label">POZIOM</div><div class="v" id="lvl">1</div></div>
  </div>
  <div id="turbo">
    <div class="label">TURBO <kbd>W</kbd><kbd>↑</kbd></div>
    <div id="turboBar"><div id="turboFill"></div></div>
  </div>
  <div id="hint"><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> skręt &nbsp;·&nbsp; <kbd>W</kbd> turbo &nbsp;·&nbsp; <kbd>S</kbd> hamulec &nbsp;·&nbsp; <kbd>P</kbd> pauza</div>
  <div id="mute">[M] DŹWIĘK: ON</div><button type="button" id="fsBtn">[F] PEŁNY EKRAN</button>
  <div id="banner"></div>
</div>

<div class="overlay" id="menu">
  <div class="title">SUPER TURBO<br>SNAKE 3D</div>
  <div class="sub">NEON EDITION</div>
  <div class="keys">
    <div><kbd>A</kbd><kbd>←</kbd></div><div>skręt w lewo</div>
    <div><kbd>D</kbd><kbd>→</kbd></div><div>skręt w prawo</div>
    <div><kbd>W</kbd><kbd>↑</kbd></div><div>TURBO (x2 punkty!)</div>
    <div><kbd>S</kbd><kbd>↓</kbd></div><div>hamulec</div>
    <div><kbd>P</kbd><kbd>M</kbd></div><div>pauza · dźwięk</div>
  </div>
  <button class="cta" id="startBtn">SPACJA — START</button>
</div>

<div class="overlay hidden" id="over">
  <div class="title small">GAME OVER</div>
  <div id="finalScore">0</div>
  <div id="newRecord">★ NOWY REKORD ★</div>
  <div class="stats" id="overStats"></div>
  <button class="cta" id="againBtn">SPACJA — JESZCZE RAZ</button>
</div>

<div class="overlay hidden" id="pause">
  <div class="title small">PAUZA</div>
  <div class="stats">Naciśnij <kbd>P</kbd> lub <kbd>Esc</kbd> aby wrócić</div>
</div>`;

export function createSnake3D(root: HTMLElement, hooks: SnakeHooks): Snake3D {
  root.classList.add('sn3', 'inmenu');
  root.innerHTML = HTML;
let VW = Math.max(1, root.clientWidth), VH = Math.max(1, root.clientHeight);


// ================= utils =================
const $ = id => root.querySelector('#' + id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const dampAngle = (a, b, l, dt) => a + angDiff(a, b) * (1 - Math.exp(-l * dt));
const easeOutElastic = x => x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = x => x * x * (3 - 2 * x);

// ================= config =================
const N = 22, HALF = N / 2;
const SPACING = 0.15;
const MAX_SPHERES = 3600;
const SUB = 6;
const COMBO_WINDOW = 3.6;
const BOOST_MULT = 1.85, BRAKE_MULT = 0.55;

let best = 0;
try { best = +localStorage.getItem('snake3dBest') || 0; } catch (e) {}
$('best').textContent = best;

// ================= renderer / scene =================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(VW, VH);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
root.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b0620, 0.02);
const camera = new THREE.PerspectiveCamera(60, VW / VH, 0.1, 500);
camera.position.set(0, 14, 19);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(VW, VH), 0.6, 0.45, 0.42);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const ro = new ResizeObserver(() => {
  VW = Math.max(1, root.clientWidth); VH = Math.max(1, root.clientHeight);
  camera.aspect = VW / VH; camera.updateProjectionMatrix();
  renderer.setSize(VW, VH); composer.setSize(VW, VH);
});
ro.observe(root);

// lights
scene.add(new THREE.HemisphereLight(0x7a6cff, 0x0a0418, 1.1));
const sun = new THREE.DirectionalLight(0xfff2ff, 1.7);
sun.position.set(-9, 20, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 60 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
scene.add(sun);
const headLight = new THREE.PointLight(0x00f0ff, 3, 6, 2);
scene.add(headLight);

// sky
const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec3 vP;
    void main(){
      float h = vP.y;
      vec3 top = vec3(0.004,0.0,0.02);
      vec3 hor = vec3(0.12,0.02,0.2);
      vec3 c = mix(hor, top, smoothstep(-0.05, 0.55, h));
      c += vec3(0.0,0.25,0.4) * exp(-abs(h-0.02)*16.0) * 0.22;
      c += vec3(0.5,0.05,0.4) * exp(-abs(h-0.08)*7.0) * 0.12;
      gl_FragColor = vec4(c,1.0);
    }`
}));
scene.add(sky);

// stars
{
  const n = 1600, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(rand(0.02, 1)), r = 180;
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * r; pos[i * 3 + 1] = Math.cos(ph) * r; pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.9, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.85 })));
}

// distant floating wireframe shapes
const deco = [];
{
  const cols = [0x00f0ff, 0xff2bd6, 0x7b5cff, 0xffd23f];
  for (let i = 0; i < 9; i++) {
    const geo = i % 3 === 0 ? new THREE.TorusGeometry(rand(4, 7), 0.25, 8, 40) : i % 3 === 1 ? new THREE.IcosahedronGeometry(rand(3, 6), 0) : new THREE.OctahedronGeometry(rand(3, 5), 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i % 4]).multiplyScalar(0.9), wireframe: true, transparent: true, opacity: 0.4, fog: false }));
    const a = i / 9 * Math.PI * 2 + rand(-0.2, 0.2), r = rand(48, 70);
    m.position.set(Math.cos(a) * r, rand(5, 24), Math.sin(a) * r);
    m.userData.spin = new THREE.Vector3(rand(-0.2, 0.2), rand(-0.3, 0.3), rand(-0.2, 0.2));
    m.userData.baseY = m.position.y; m.userData.ph = rand(0, 6);
    scene.add(m); deco.push(m);
  }
}

// floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x0b0818, roughness: 0.7, metalness: 0.35 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

// arena slab (slightly lighter)
const slab = new THREE.Mesh(new THREE.PlaneGeometry(N, N), new THREE.MeshStandardMaterial({ color: 0x120c26, roughness: 0.55, metalness: 0.4 }));
slab.rotation.x = -Math.PI / 2; slab.position.y = 0.001; slab.receiveShadow = true; scene.add(slab);

// neon grid overlay
const ripples = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -100, 0));
let rippleIdx = 0;
const gridMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uHead: { value: new THREE.Vector2() }, uHalf: { value: HALF }, uRip: { value: ripples }, uBoost: { value: 0 } },
  vertexShader: `varying vec2 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    uniform float uTime; uniform vec2 uHead; uniform float uHalf; uniform vec4 uRip[6]; uniform float uBoost;
    varying vec2 vW;
    void main(){
      vec2 p = vW;
      float m = max(abs(p.x), abs(p.y));
      float inside = 1.0 - smoothstep(uHalf, uHalf + 0.05, m);
      vec2 g = abs(fract(p + 0.5) - 0.5) / fwidth(p);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      float dHead = length(p - uHead);
      float glow = exp(-dHead * 0.3);
      vec3 cA = vec3(0.0, 0.85, 1.0), cB = vec3(1.0, 0.17, 0.84), cF = vec3(1.0, 0.45, 0.04);
      float w = 0.5 + 0.5 * sin(p.x * 0.22 + p.y * 0.17 + uTime * 0.6);
      vec3 col = mix(cA, cB, w);
      col = mix(col, cF, uBoost * glow);
      float inten = line * (0.07 + 0.55 * glow) * inside + line * 0.035 * (1.0 - inside) * exp(-(m - uHalf) * 0.12);
      float rip = 0.0;
      for (int i = 0; i < 6; i++) {
        vec4 r = uRip[i]; float age = uTime - r.z;
        if (age > 0.0 && age < 1.8) {
          float rad = age * 11.0; float dd = length(p - r.xy) - rad;
          rip += exp(-dd * dd * 2.5) * (1.0 - age / 1.8) * r.w;
        }
      }
      inten += rip * (0.22 + line * 2.2) * (0.3 + 0.7 * inside);
      vec3 c = col * inten;
      float edge = abs(m - uHalf);
      c += cB * exp(-edge * 5.0) * 0.3;
      c += cA * glow * glow * 0.07 * inside;
      gl_FragColor = vec4(c, 1.0);
    }`
});
const grid = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), gridMat);
grid.rotation.x = -Math.PI / 2; grid.position.y = 0.004; scene.add(grid);

// walls
const walls = [];
{
  const L = N + 0.34;
  const defs = [[0, -HALF - 0.09, 0], [0, HALF + 0.09, 0], [-HALF - 0.09, 0, Math.PI / 2], [HALF + 0.09, 0, Math.PI / 2]];
  for (const [x, z, ry] of defs) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a0626, emissive: 0xff2bd6, emissiveIntensity: 0.6, roughness: 0.35, transparent: true, opacity: 0.9 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, 0.42, 0.18), mat);
    m.position.set(x, 0.21, z); m.rotation.y = ry; m.castShadow = true;
    scene.add(m); walls.push(m);
  }
  const pyl = new THREE.MeshStandardMaterial({ color: 0x001820, emissive: 0x00f0ff, emissiveIntensity: 1.2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.4, 16), pyl);
    c.position.set(sx * (HALF + 0.09), 0.7, sz * (HALF + 0.09)); c.castShadow = true; scene.add(c);
    const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), pyl); top.position.set(c.position.x, 1.75, c.position.z);
    top.userData.spin = true; scene.add(top); deco.push(top);
  }
}

// ambient motes
const motes = (() => {
  const n = 420, pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = rand(-16, 16); pos[i * 3 + 1] = rand(0.3, 7); pos[i * 3 + 2] = rand(-16, 16); seed[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform float uPR; varying float vS;
      void main(){ vec3 p = position; float t = uTime * (0.2 + aSeed * 0.3) + aSeed * 40.0;
        p.x += sin(t) * 0.8; p.y += sin(t * 1.3) * 0.5; p.z += cos(t * 0.9) * 0.8; vS = aSeed;
        vec4 mv = modelViewMatrix * vec4(p,1.0); gl_PointSize = (2.0 + aSeed * 3.0) * uPR * (12.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vS; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = pow(1.0 - d * 2.0, 2.0);
        vec3 c = mix(vec3(0.0,0.9,1.0), vec3(1.0,0.2,0.85), vS); gl_FragColor = vec4(c * a * 0.7, 1.0); }`
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false; scene.add(p); return m;
})();

// ================= particles =================
const MAXP = 5000;
const P = {
  pos: new Float32Array(MAXP * 3), col: new Float32Array(MAXP * 3), size: new Float32Array(MAXP), alpha: new Float32Array(MAXP),
  vel: new Float32Array(MAXP * 3), life: new Float32Array(MAXP), max: new Float32Array(MAXP), base: new Float32Array(MAXP),
  grav: new Float32Array(MAXP), drag: new Float32Array(MAXP), cursor: 0
};
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(P.pos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aColor', new THREE.BufferAttribute(P.col, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(P.size, 1).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(P.alpha, 1).setUsage(THREE.DynamicDrawUsage));
const particles = new THREE.Points(pGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uPR: { value: renderer.getPixelRatio() } },
  vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; uniform float uPR; varying vec3 vC; varying float vA;
    void main(){ vC = aColor; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
      gl_PointSize = aSize * uPR * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vC; varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = 1.0 - d * 2.0; a = a * a;
      float core = smoothstep(0.18, 0.0, d); gl_FragColor = vec4((vC + core * 0.8) * a * vA, 1.0); }`
}));
particles.frustumCulled = false; scene.add(particles);

function spawn(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 9, drag = 1.6) {
  const i = P.cursor; P.cursor = (P.cursor + 1) % MAXP;
  P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
  P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
  P.col[i * 3] = r; P.col[i * 3 + 1] = g; P.col[i * 3 + 2] = b;
  P.life[i] = life; P.max[i] = life; P.base[i] = size; P.grav[i] = grav; P.drag[i] = drag;
}
function burst(x, y, z, color, count, speed, opt = {}) {
  const c = new THREE.Color(color);
  const k = opt.bright ?? 2.2;
  for (let i = 0; i < count; i++) {
    const th = Math.random() * Math.PI * 2, u = rand(-0.2, 1), s = speed * rand(0.35, 1);
    const sq = Math.sqrt(1 - u * u);
    const hv = opt.hue ? new THREE.Color().setHSL(Math.random(), 1, 0.6) : c;
    spawn(x, y, z, Math.cos(th) * sq * s, u * s * (opt.up ?? 1) + (opt.lift ?? 2), Math.sin(th) * sq * s,
      hv.r * k, hv.g * k, hv.b * k, rand(0.12, 0.3) * (opt.size ?? 1), rand(0.5, 1.1) * (opt.life ?? 1), opt.grav ?? 9, opt.drag ?? 1.6);
  }
}
function updateParticles(dt) {
  for (let i = 0; i < MAXP; i++) {
    if (P.life[i] <= 0) { if (P.size[i] !== 0) { P.size[i] = 0; P.alpha[i] = 0; } continue; }
    P.life[i] -= dt;
    if (P.life[i] <= 0) { P.size[i] = 0; P.alpha[i] = 0; continue; }
    const dr = Math.exp(-P.drag[i] * dt), i3 = i * 3;
    P.vel[i3] *= dr; P.vel[i3 + 1] = P.vel[i3 + 1] * dr - P.grav[i] * dt; P.vel[i3 + 2] *= dr;
    P.pos[i3] += P.vel[i3] * dt; P.pos[i3 + 1] += P.vel[i3 + 1] * dt; P.pos[i3 + 2] += P.vel[i3 + 2] * dt;
    if (P.pos[i3 + 1] < 0.04) { P.pos[i3 + 1] = 0.04; P.vel[i3 + 1] *= -0.45; P.vel[i3] *= 0.75; P.vel[i3 + 2] *= 0.75; }
    const t = P.life[i] / P.max[i];
    P.alpha[i] = Math.min(1, t * 1.6);
    P.size[i] = P.base[i] * (0.35 + 0.65 * t);
  }
  for (const k of ['position', 'aColor', 'aSize', 'aAlpha']) pGeo.attributes[k].needsUpdate = true;
}

// shockwave rings
const waves = [];
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m);
  waves.push({ m, t: 0, dur: 1, size: 1, active: false });
}
function shockwave(x, z, color, size = 4, dur = 0.7, y = 0.08) {
  const w = waves.find(w => !w.active) || waves[0];
  w.active = true; w.t = 0; w.dur = dur; w.size = size;
  w.m.position.set(x, y, z); w.m.material.color.set(color).multiplyScalar(3); w.m.visible = true;
}
function updateWaves(dt) {
  for (const w of waves) {
    if (!w.active) continue;
    w.t += dt; const k = w.t / w.dur;
    if (k >= 1) { w.active = false; w.m.visible = false; continue; }
    const s = 0.2 + w.size * (1 - Math.pow(1 - k, 3));
    w.m.scale.set(s, s, 1); w.m.material.opacity = (1 - k) * (1 - k);
  }
}
function ripple(x, z, strength = 1) {
  ripples[rippleIdx].set(x, z, gameTime, strength); rippleIdx = (rippleIdx + 1) % ripples.length;
}

// ================= snake meshes =================
const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26, metalness: 0.18 });
bodyMat.onBeforeCompile = sh => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += vColor * 0.22;\n#endif');
};
const body = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 18, 12), bodyMat, MAX_SPHERES);
body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
body.setColorAt(0, new THREE.Color(1, 1, 1));
body.instanceColor.setUsage(THREE.DynamicDrawUsage);
body.castShadow = true; body.frustumCulled = false; body.count = 0;
scene.add(body);

const head = new THREE.Group();
const headMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00b8d8, emissiveIntensity: 0.35, roughness: 0.22, metalness: 0.25 });
const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 36, 26), headMat);
skull.castShadow = true; head.add(skull);
const SKULL = new THREE.Vector3(0.88, 0.72, 1.1);
skull.scale.copy(SKULL);
const crest = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 10), new THREE.MeshStandardMaterial({ color: 0xff2bd6, emissive: 0xff2bd6, emissiveIntensity: 1.6 }));
crest.position.set(0, 0.36, -0.12); crest.rotation.x = -0.7; head.add(crest);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.15 });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x050010 });
const glintMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) });
const pupils = [];
for (const s of [-1, 1]) {
  const e = new THREE.Mesh(new THREE.SphereGeometry(0.145, 18, 14), eyeMat); e.position.set(s * 0.23, 0.17, 0.25); head.add(e);
  const p = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), pupilMat); p.position.set(s * 0.25, 0.19, 0.36); head.add(p); pupils.push(p);
  const g = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), glintMat); g.position.set(s * 0.25 + 0.03, 0.24, 0.41); head.add(g);
}
const tongue = new THREE.Group();
{
  const tm = new THREE.MeshStandardMaterial({ color: 0xff2050, emissive: 0xff1040, emissiveIntensity: 1.4 });
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, 0.32), tm); a.position.z = 0.16; tongue.add(a);
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, 0.12), tm); f.position.set(s * 0.03, 0, 0.36); f.rotation.y = s * 0.45; tongue.add(f); }
  tongue.position.set(0, -0.06, 0.48); tongue.scale.z = 0.001; head.add(tongue);
}
scene.add(head);

// food
function makeFood(color, coreGeo) {
  const group = new THREE.Group();
  const float = new THREE.Group(); group.add(float);
  const core = new THREE.Mesh(coreGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.3, roughness: 0.15, metalness: 0.5, flatShading: true }));
  core.castShadow = true;
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), wireframe: true, transparent: true, opacity: 0.4 }));
  float.add(core, shell);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; group.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.22, 6, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.2), transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 3; group.add(beam);
  const light = new THREE.PointLight(color, 3, 5, 2); light.position.y = 0.8; group.add(light);
  scene.add(group);
  return { group, float, core, shell, ring, beam, light, cell: { x: 0, z: 0 }, active: false, spawnT: 0, life: 0, color };
}
const food = makeFood(0xff2bd6, new THREE.IcosahedronGeometry(0.3, 0));
const gold = makeFood(0xffc21a, new THREE.OctahedronGeometry(0.36, 0));
gold.group.visible = false;

// ================= audio =================
const AudioSys = (() => {
  let ctx = null, master, sfx, music, bassLP, noiseBuf, boostGain, boostFilter, muted = !hooks.soundOn(), schedTimer = 0;
  let nextT = 0, step = 0, intensity = 0;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8 * hooks.volume();
    master.connect(comp); comp.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
    music = ctx.createGain(); music.gain.value = 0.3; music.connect(master);
    bassLP = ctx.createBiquadFilter(); bassLP.type = 'lowpass'; bassLP.frequency.value = 520; bassLP.Q.value = 6; bassLP.connect(music);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    boostFilter = ctx.createBiquadFilter(); boostFilter.type = 'bandpass'; boostFilter.frequency.value = 700; boostFilter.Q.value = 1.4;
    boostGain = ctx.createGain(); boostGain.gain.value = 0;
    ns.connect(boostFilter); boostFilter.connect(boostGain); boostGain.connect(sfx); ns.start();
    nextT = ctx.currentTime + 0.1;
    schedTimer = setInterval(schedule, 25);
  }
  function tone(freq, t, dur, o = {}) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    const v = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + (o.attack ?? 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.dest || sfx); osc.start(t); osc.stop(t + dur + 0.03);
  }
  function noise(t, dur, o = {}) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'highpass'; f.frequency.setValueAtTime(o.freq ?? 6000, t); f.Q.value = o.q ?? 0.7;
    if (o.slide) f.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(o.vol ?? 0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(o.dest || sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.03);
  }
  const PENT = [0, 2, 4, 7, 9];
  const pent = i => PENT[i % 5] + 12 * Math.floor(i / 5);
  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    const spb = 60 / 124 / 4;
    while (nextT < ctx.currentTime + 0.12) { playStep(step, nextT); nextT += spb; step = (step + 1) % 64; }
  }
  const roots = [45, 41, 36, 43];
  const chords = [[69, 72, 76], [65, 69, 72], [60, 64, 67], [67, 71, 74]];
  function playStep(s, t) {
    const bar = Math.floor(s / 16), st = s % 16;
    if (st % 4 === 0) tone(140, t, 0.28, { vol: 0.55, slide: 38, dest: music });
    if (st % 4 === 2) noise(t, 0.045, { vol: 0.09, freq: 8000, dest: music });
    if (st === 4 || st === 12) noise(t, 0.14, { vol: 0.13, type: 'bandpass', freq: 1700, q: 0.7, dest: music });
    if ([0, 3, 6, 8, 10, 11, 14].includes(st)) tone(mtof(roots[bar] - 12 + (st === 14 ? 12 : 0)), t, 0.17, { type: 'sawtooth', vol: 0.16, dest: bassLP });
    if (st === 0) for (const n of chords[bar]) tone(mtof(n - 12), t, 1.9, { type: 'triangle', vol: 0.035, attack: 0.25, dest: music });
    if (intensity > 0.05 && st % 2 === 0) {
      const ch = chords[bar], i = (st / 2) % 4;
      const note = i === 3 ? ch[1] + 12 : ch[i];
      tone(mtof(note), t, 0.13, { type: 'square', vol: 0.05 * intensity, dest: music });
    }
    if (intensity > 0.6 && st % 2 === 1) noise(t, 0.03, { vol: 0.05 * intensity, freq: 10000, dest: music });
  }
  const now = () => ctx.currentTime;
  return {
    init,
    get muted() { return muted; },
    eat(combo) {
      if (!ctx) return; const t = now(); const i = Math.min(combo - 1, 16);
      const f = mtof(72 + pent(i));
      tone(f, t, 0.18, { type: 'triangle', vol: 0.3 }); tone(f * 2, t, 0.12, { vol: 0.08 });
      tone(f * 1.4983, t + 0.065, 0.24, { type: 'triangle', vol: 0.22 });
      if (combo >= 3) tone(f * 2, t + 0.13, 0.25, { type: 'square', vol: 0.06 });
      noise(t, 0.07, { vol: 0.1, freq: 5000 });
    },
    gold() {
      if (!ctx) return; const t = now();
      [0, 4, 7, 12, 16, 19, 24].forEach((n, k) => tone(mtof(79 + n), t + k * 0.045, 0.25, { type: 'square', vol: 0.07 }));
      tone(mtof(55), t, 0.5, { type: 'sawtooth', vol: 0.1, slide: mtof(67) });
    },
    turn(dir) {
      if (!ctx) return; const t = now();
      noise(t, 0.08, { vol: 0.08, type: 'bandpass', freq: dir > 0 ? 1500 : 1200, slide: dir > 0 ? 3600 : 2800, q: 2.2 });
      tone(dir > 0 ? 880 : 784, t, 0.05, { vol: 0.04 });
    },
    levelUp() {
      if (!ctx) return; const t = now();
      [0, 4, 7, 12].forEach((n, k) => tone(mtof(64 + n), t + k * 0.07, 0.22, { type: 'sawtooth', vol: 0.08 }));
    },
    die() {
      if (!ctx) return; const t = now();
      tone(260, t, 1.0, { type: 'sawtooth', vol: 0.22, slide: 30 });
      tone(90, t, 0.6, { vol: 0.6, slide: 25 });
      noise(t, 0.8, { vol: 0.45, type: 'lowpass', freq: 4000, slide: 90 });
    },
    pop(i) {
      if (!ctx) return; const t = now(); const f = 260 * Math.pow(2, Math.min(i, 36) / 12);
      tone(f, t, 0.09, { type: 'square', vol: 0.05, slide: f * 0.5 }); noise(t, 0.03, { vol: 0.05, freq: 3000 });
    },
    tick(i) { if (!ctx) return; tone(1200 + i * 4, now(), 0.03, { type: 'square', vol: 0.025 }); },
    record() {
      if (!ctx) return; const t = now();
      [[0, 0], [4, 0.12], [7, 0.24], [12, 0.36], [7, 0.5], [12, 0.62], [16, 0.74]].forEach(([n, d]) => { tone(mtof(72 + n), t + d, 0.3, { type: 'square', vol: 0.08 }); tone(mtof(60 + n), t + d, 0.3, { type: 'triangle', vol: 0.1 }); });
    },
    setBoost(on) { if (!ctx) return; boostGain.gain.setTargetAtTime(on ? 0.16 : 0, now(), 0.07); boostFilter.frequency.setTargetAtTime(on ? 1500 : 600, now(), 0.15); },
    setIntensity(x) { intensity = x; },
    toggleMute() { muted = !muted; if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.8 * hooks.volume(), now(), 0.05); return muted; },
    suspend() { if (ctx) ctx.suspend(); },
    dispose() { clearInterval(schedTimer); if (ctx) ctx.close().catch(() => {}); ctx = null; },
    resume() { if (ctx) ctx.resume(); }
  };
})();

// ================= game state =================
let dead = false, raf = 0;
let state = 'menu';
let cells, tailHist, exitDir, turnQueue, pendingGrow, progress, tickCount, Lvis;
let score = 0, displayScore = 0, foodsEaten = 0, combo = 0, maxCombo = 0, comboTimer = 0, energy = 100, boostLock = false;
let boostHeld = false, brakeHeld = false, boosting = false;
let gameTime = 0, realTime = 0, timeScale = 1;
let pulses = [];
let deathT = 0, deathCut = -1, cutBurstD = 0, popIdx = 0, overDelay = -1;
let trauma = 0, flashA = 0, flashColor = '#ffffff', fovKick = 0, dangerVis = 0;
let camYaw = Math.PI, camRoll = 0, yawVel = 0, camBlend = 0, boostVis = 0, comboVis = 0;
const camPos = new THREE.Vector3(0, 14, 19);
let headSquash = 0, tongueT = 0, tongueNext = 2;
let hx = 0, hz = 0, tx = 0, tz = -1;
let overCount = 0, overTarget = 0, overTickAcc = 0;
const bannerQ = []; let bannerBusy = 0;

const cellX = c => c.x - HALF + 0.5;
const cellZ = c => c.z - HALF + 0.5;
const speed = () => Math.min(5.0 + foodsEaten * 0.17, 12.5);
const level = () => 1 + Math.floor(foodsEaten / 5);

function reset() {
  const sx = Math.floor(N / 2), sz = Math.floor(N / 2) + 3;
  cells = []; for (let i = 0; i < 4; i++) cells.push({ x: sx, z: sz + i });
  tailHist = [{ x: sx, z: sz + 4 }, { x: sx, z: sz + 5 }, { x: sx, z: sz + 6 }];
  exitDir = { x: 0, z: -1 }; turnQueue = []; pendingGrow = 0; progress = 0; tickCount = 0;
  Lvis = cells.length - 0.55;
  score = 0; displayScore = 0; foodsEaten = 0; combo = 0; maxCombo = 0; comboTimer = 0; energy = 100; boostLock = false;
  pulses = []; deathCut = -1; overDelay = -1; timeScale = 1;
  gold.active = false; gold.group.visible = false;
  spawnFood(food);
  head.visible = true;
  $('score').textContent = '0';
}

function occupied(x, z) {
  for (const c of cells) if (c.x === x && c.z === z) return true;
  return false;
}
function spawnFood(f) {
  const h = cells[0];
  for (let a = 0; a < 800; a++) {
    const x = (Math.random() * N) | 0, z = (Math.random() * N) | 0;
    if (occupied(x, z)) continue;
    if (f === food && gold.active && gold.cell.x === x && gold.cell.z === z) continue;
    if (f === gold && food.active && food.cell.x === x && food.cell.z === z) continue;
    if (Math.abs(x - h.x) + Math.abs(z - h.z) < 3) continue;
    f.cell = { x, z }; f.active = true; f.spawnT = gameTime; f.group.visible = true;
    f.group.position.set(cellX(f.cell), 0, cellZ(f.cell)); f.group.scale.setScalar(0.001);
    shockwave(f.group.position.x, f.group.position.z, f.color, 1.6, 0.5);
    return true;
  }
  f.active = false; f.group.visible = false; return false;
}

// ---- path geometry ----
const known = i => i < cells.length ? cells[i] : tailHist[i - cells.length];
function cellAt(i) {
  const K = cells.length + tailHist.length;
  if (i < K) return known(i);
  const last = known(K - 1), prev = known(K - 2);
  const dx = last.x - prev.x, dz = last.z - prev.z, k = i - K + 1;
  return { x: last.x + dx * k, z: last.z + dz * k };
}
const PP = { x: 0, z: 0, tx: 0, tz: 0 };
function piecePoint(i, t, out) {
  const c = cellAt(i), p = cellAt(i + 1);
  const ex = c.x - p.x, ez = c.z - p.z;
  let xx, xz;
  if (i === 0) { xx = exitDir.x; xz = exitDir.z; } else { const n = cellAt(i - 1); xx = n.x - c.x; xz = n.z - c.z; }
  const cx = cellX(c), cz = cellZ(c);
  if ((ex === xx && ez === xz) || (ex === -xx && ez === -xz)) {
    out.x = cx + ex * (t - 0.5); out.z = cz + ez * (t - 0.5); out.tx = ex; out.tz = ez;
  } else {
    const kx = cx - ex * 0.5 + xx * 0.5, kz = cz - ez * 0.5 + xz * 0.5;
    const th = t * Math.PI / 2, co = Math.cos(th), si = Math.sin(th);
    out.x = kx - xx * 0.5 * co + ex * 0.5 * si; out.z = kz - xz * 0.5 * co + ez * 0.5 * si;
    out.tx = xx * si + ex * co; out.tz = xz * si + ez * co;
  }
  return out;
}
const PX = new Float32Array(40000), PD = new Float32Array(20000);
let PN = 0;
function pushPt(x, z) {
  if (PN > 0) { const dx = x - PX[PN * 2 - 2], dz = z - PX[PN * 2 - 1]; PD[PN] = PD[PN - 1] + Math.sqrt(dx * dx + dz * dz); } else PD[0] = 0;
  PX[PN * 2] = x; PX[PN * 2 + 1] = z; PN++;
}
function buildPath(f, maxLen) {
  PN = 0;
  const s0 = Math.max(1, Math.ceil(f * SUB));
  for (let s = 0; s <= s0; s++) { piecePoint(0, f * (1 - s / s0), PP); pushPt(PP.x, PP.z); }
  const lim = cells.length + tailHist.length + 40;
  for (let i = 1; i < lim && PD[PN - 1] < maxLen && PN < 19990 - SUB; i++) {
    for (let s = 1; s <= SUB; s++) { piecePoint(i, 1 - s / SUB, PP); pushPt(PP.x, PP.z); }
  }
}
function samplePath(d, out) {
  let lo = 0, hi = PN - 1;
  if (d <= 0) { out.x = PX[0]; out.z = PX[1]; return out; }
  if (d >= PD[hi]) { out.x = PX[hi * 2]; out.z = PX[hi * 2 + 1]; return out; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (PD[m] < d) lo = m; else hi = m; }
  const u = (d - PD[lo]) / ((PD[hi] - PD[lo]) || 1);
  out.x = lerp(PX[lo * 2], PX[hi * 2], u); out.z = lerp(PX[lo * 2 + 1], PX[hi * 2 + 1], u);
  return out;
}

// ---- turning ----
const rot = (d, t) => t > 0 ? { x: -d.z, z: d.x } : { x: d.z, z: -d.x };
function queueTurn(t) {
  if (state !== 'playing') return;
  const h = cells[0], b = cells[1];
  const straight = (h.x - b.x) === exitDir.x && (h.z - b.z) === exitDir.z;
  if (turnQueue.length === 0 && progress < 0.3 && straight) { exitDir = rot(exitDir, t); onTurn(t); }
  else if (turnQueue.length < 3) turnQueue.push(t);
}
function onTurn(t) {
  AudioSys.turn(t);
  headSquash = 1;
  const ox = -tz * t, oz = tx * t; // outward of turn
  for (let i = 0; i < 10; i++) spawn(hx, 0.25, hz, -ox * rand(1, 4) + rand(-1, 1), rand(0.5, 2.5), -oz * rand(1, 4) + rand(-1, 1), 0.2, 1.6, 2.2, rand(0.08, 0.16), rand(0.25, 0.5), 4, 3);
}

// ---- tick ----
function tick() {
  const h = cells[0];
  const nx = h.x + exitDir.x, nz = h.z + exitDir.z;
  const eatF = food.active && food.cell.x === nx && food.cell.z === nz;
  const eatG = gold.active && gold.cell.x === nx && gold.cell.z === nz;
  const grow = pendingGrow > 0 || eatF || eatG;
  let hit = nx < 0 || nz < 0 || nx >= N || nz >= N;
  if (!hit) { const lim = grow ? cells.length : cells.length - 1; for (let i = 0; i < lim; i++) if (cells[i].x === nx && cells[i].z === nz) { hit = true; break; } }
  if (hit) { crash(); return; }
  cells.unshift({ x: nx, z: nz });
  if (eatF) pendingGrow += 1;
  if (eatG) pendingGrow += 3;
  if (pendingGrow > 0) pendingGrow--; else { tailHist.unshift(cells.pop()); if (tailHist.length > 6) tailHist.length = 6; }
  tickCount++;
  if (eatF) eat(food);
  if (eatG) eat(gold);
  if (turnQueue.length) { const t = turnQueue.shift(); exitDir = rot(exitDir, t); onTurn(t); }
}

function eat(f) {
  const isGold = f === gold;
  const x = cellX(f.cell), z = cellZ(f.cell);
  foodsEaten++;
  combo = comboTimer > 0 ? combo + 1 : 1; comboTimer = COMBO_WINDOW; maxCombo = Math.max(maxCombo, combo);
  const turbo = boosting ? 2 : 1;
  const pts = (isGold ? 50 : 10) * combo * turbo;
  score += pts;
  energy = Math.min(100, energy + (isGold ? 100 : 14)); if (energy > 25) boostLock = false;
  pulses.push(gameTime); if (pulses.length > 8) pulses.shift();
  // juice
  const col = isGold ? 0xffc21a : 0xff2bd6;
  burst(x, 0.6, z, col, isGold ? 140 : 70, isGold ? 11 : 8, { lift: 3, size: isGold ? 1.3 : 1 });
  burst(x, 0.6, z, 0x00f0ff, isGold ? 40 : 20, 5, { lift: 4, grav: 5 });
  if (combo >= 3 || isGold) burst(x, 0.8, z, 0xffffff, 40 + combo * 6, 10, { hue: true, lift: 6, grav: 7 });
  shockwave(x, z, col, isGold ? 7 : 4.2, isGold ? 0.9 : 0.6);
  if (isGold) shockwave(x, z, 0xffffff, 10, 1.2);
  ripple(x, z, isGold ? 2 : 1);
  trauma = Math.min(1, trauma + (isGold ? 0.55 : 0.28));
  flashA = isGold ? 0.28 : 0.1; flashColor = isGold ? '#ffd23f' : '#ff7ae8';
  fovKick = isGold ? 9 : 5;
  headSquash = 1.4;
  popup('+' + pts, x, 1.3, z, isGold ? '#ffd23f' : (turbo > 1 ? '#ff9a00' : '#ffffff'), isGold ? 40 : 28 + Math.min(combo, 8) * 2);
  if (turbo > 1) popup('TURBO x2', x, 2.2, z, '#ff9a00', 18);
  bump($('score'));
  if (isGold) { AudioSys.gold(); banner('GOLDEN!', '#ffd23f'); f.active = false; f.group.visible = false; }
  else AudioSys.eat(combo);
  if (combo >= 2) bump($('comboText'));
  const names = { 3: 'NICE!', 5: 'SUPER!', 8: 'MEGA!', 12: 'ULTRA!', 16: 'TURBO GOD!', 20: 'NIEŚMIERTELNY!' };
  if (names[combo]) banner(names[combo], ['#00f0ff', '#ff2bd6', '#ffd23f', '#7bff6a', '#ff5a00', '#ffffff'][Object.keys(names).indexOf(String(combo))]);
  if (!isGold) {
    if (foodsEaten % 5 === 0) { banner('SPEED UP! LVL ' + level(), '#7b5cff'); AudioSys.levelUp(); }
    spawnFood(food);
    if (!gold.active && foodsEaten > 2 && Math.random() < 0.22) { if (spawnFood(gold)) { gold.life = 7; banner('ZŁOTO SIĘ POJAWIŁO!', '#ffd23f'); } }
  }
}

function crash() {
  state = 'dying'; progress = 1; deathT = 0; deathCut = -1; cutBurstD = 0.3; popIdx = 0; overDelay = -1;
  timeScale = 0.25; trauma = 1; flashA = 0.7; flashColor = '#ff2050'; fovKick = -6;
  AudioSys.die(); AudioSys.setBoost(false); AudioSys.setIntensity(0);
  piecePoint(0, 1, PP);
  const x = PP.x, z = PP.z;
  burst(x, 0.5, z, 0xff2050, 160, 13, { lift: 4, size: 1.4 });
  burst(x, 0.5, z, 0xffffff, 60, 9, { hue: true, lift: 6 });
  shockwave(x, z, 0xff2050, 9, 1.1); shockwave(x, z, 0xffffff, 5, 0.6);
  ripple(x, z, 3);
  head.visible = false;
  turnQueue = [];
}

function gameOver() {
  state = 'over'; root.classList.add('inmenu');
  const rec = score > best;
  if (rec) { best = score; try { localStorage.setItem('snake3dBest', best); } catch (e) {} }
  $('best').textContent = best;
  $('newRecord').style.display = rec ? 'block' : 'none';
  $('overStats').innerHTML = `Długość <b>${cells.length}</b> &nbsp;·&nbsp; Max combo <b>x${maxCombo}</b> &nbsp;·&nbsp; Poziom <b>${level()}</b> &nbsp;·&nbsp; Rekord <b>${best}</b>`;
  overCount = 0; overTarget = score; $('finalScore').textContent = '0';
  hooks.onOver({ apples: foodsEaten, score, record: rec });
  $('over').classList.remove('hidden');
  if (rec && score > 0) {
    AudioSys.record();
    for (let i = 0; i < 6; i++) setTimeout(() => burst(rand(-6, 6), 2, rand(-6, 6), 0xffffff, 60, 12, { hue: true, lift: 8, grav: 6, life: 1.6 }), i * 180);
  }
}

function startGame() {
  if (state === 'playing' || state === 'paused' || state === 'dying') return;
  hooks.onStart();
  AudioSys.init();
  reset();
  state = 'playing'; camBlend = 0; root.classList.remove('inmenu');
  $('menu').classList.add('hidden'); $('over').classList.add('hidden'); $('pause').classList.add('hidden');
  banner('GO!', '#00f0ff');
}
function togglePause() {
  if (state === 'playing') { state = 'paused'; $('pause').classList.remove('hidden'); AudioSys.setBoost(false); AudioSys.suspend(); }
  else if (state === 'paused') { state = 'playing'; $('pause').classList.add('hidden'); AudioSys.resume(); }
}

// ================= UI helpers =================
const hud = $('hud');
const tmpV = new THREE.Vector3();
function popup(text, x, y, z, color, size = 28) {
  tmpV.set(x, y, z).project(camera); if (tmpV.z > 1) return;
  const el = document.createElement('div'); el.className = 'popup'; el.textContent = text;
  el.style.left = ((tmpV.x + 1) / 2 * VW) + 'px'; el.style.top = ((1 - tmpV.y) / 2 * VH) + 'px';
  el.style.color = color; el.style.fontSize = size + 'px';
  hud.appendChild(el); setTimeout(() => el.remove(), 1100);
}
function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
function banner(text, color) { bannerQ.push({ text, color }); }
function updateBanner(rdt) {
  if (bannerBusy > 0) { bannerBusy -= rdt; return; }
  if (!bannerQ.length) return;
  const b = bannerQ.shift(), el = $('banner');
  el.textContent = b.text; el.style.color = b.color;
  el.style.textShadow = `0 0 20px ${b.color}, 0 0 60px ${b.color}, 0 4px 0 rgba(0,0,0,.4)`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  bannerBusy = 0.7;
}

// minimap
const mm = $('minimap'), mctx = mm.getContext('2d');
function drawMinimap() {
  const S = mm.width; mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, S, S);
  mctx.save();
  mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); mctx.clip();
  const bg = mctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  bg.addColorStop(0, 'rgba(24,10,50,.85)'); bg.addColorStop(1, 'rgba(6,2,18,.9)');
  mctx.fillStyle = bg; mctx.fillRect(0, 0, S, S);
  mctx.translate(S / 2, S / 2);
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  mctx.rotate(-Math.PI / 2 - Math.atan2(fz, fx));
  const sc = S / (N * 1.45);
  // grid
  mctx.strokeStyle = 'rgba(0,240,255,.08)'; mctx.lineWidth = 1;
  for (let i = -HALF; i <= HALF; i += 2) { mctx.beginPath(); mctx.moveTo(i * sc, -HALF * sc); mctx.lineTo(i * sc, HALF * sc); mctx.moveTo(-HALF * sc, i * sc); mctx.lineTo(HALF * sc, i * sc); mctx.stroke(); }
  mctx.strokeStyle = '#ff2bd6'; mctx.lineWidth = 3; mctx.shadowColor = '#ff2bd6'; mctx.shadowBlur = 8;
  mctx.strokeRect(-HALF * sc, -HALF * sc, N * sc, N * sc);
  // food
  const pulse = 1 + 0.25 * Math.sin(realTime * 8);
  for (const f of [food, gold]) {
    if (!f.active) continue;
    const c = f === gold ? '#ffd23f' : '#ff2bd6';
    mctx.fillStyle = c; mctx.shadowColor = c; mctx.shadowBlur = 14;
    mctx.beginPath(); mctx.arc(cellX(f.cell) * sc, cellZ(f.cell) * sc, sc * 0.55 * pulse, 0, Math.PI * 2); mctx.fill();
  }
  // snake
  if (state !== 'over' && PN > 1) {
    mctx.lineCap = 'round'; mctx.lineJoin = 'round'; mctx.shadowColor = '#00f0ff'; mctx.shadowBlur = 10;
    mctx.strokeStyle = boostVis > 0.5 ? '#ffa020' : '#00e5ff'; mctx.lineWidth = sc * 0.7;
    mctx.beginPath();
    const endD = state === 'dying' ? Math.max(0, deathCut) : 0;
    let started = false;
    for (let i = 0; i < PN; i++) {
      if (PD[i] < endD) continue; if (PD[i] > Lvis) break;
      if (!started) { mctx.moveTo(PX[i * 2] * sc, PX[i * 2 + 1] * sc); started = true; } else mctx.lineTo(PX[i * 2] * sc, PX[i * 2 + 1] * sc);
    }
    mctx.stroke();
    if (head.visible) { mctx.fillStyle = '#ffffff'; mctx.beginPath(); mctx.arc(hx * sc, hz * sc, sc * 0.6, 0, Math.PI * 2); mctx.fill(); }
  }
  mctx.restore();
  mctx.strokeStyle = 'rgba(255,255,255,.25)'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); mctx.stroke();
}

// ================= per-frame visuals =================
const M4 = new THREE.Matrix4();
const tmpC = new THREE.Color();
const SP = { x: 0, z: 0 };
function updateSnakeVisual(dt) {
  if (state === 'playing') Lvis = damp(Lvis, cells.length - 0.55, 5, dt);
  const f = progress;
  buildPath(f, Lvis + 0.4);
  piecePoint(0, f, PP); hx = PP.x; hz = PP.z;
  const tl = Math.hypot(PP.tx, PP.tz) || 1; tx = PP.tx / tl; tz = PP.tz / tl;

  if (state === 'over') { body.count = 0; return; }
  const traveled = tickCount + f;
  const phase = ((traveled % SPACING) + SPACING) % SPACING;
  const bk = boostVis, ck = comboVis;
  let j = 0, n = 0;
  const arr = body.instanceColor.array;
  for (let k = 0; n < MAX_SPHERES; k++) {
    const d = phase + k * SPACING;
    if (d > Lvis) break;
    while (j < PN - 2 && PD[j + 1] < d) j++;
    const seg = (PD[j + 1] - PD[j]) || 1;
    const u = clamp((d - PD[j]) / seg, 0, 1);
    let x = lerp(PX[j * 2], PX[j * 2 + 2], u), z = lerp(PX[j * 2 + 1], PX[j * 2 + 3], u);
    const sx = (PX[j * 2 + 2] - PX[j * 2]) / seg, sz = (PX[j * 2 + 3] - PX[j * 2 + 1]) / seg;
    const kabs = Math.round((traveled - d) / SPACING);
    // slither wiggle (world-anchored)
    const wig = Math.sin(kabs * SPACING * 2.4) * 0.065 * Math.min(d / 1.2, 1);
    x += -sz * wig; z += sx * wig;
    // radius
    const tailLeft = Lvis - d;
    let r = 0.335 * (0.3 + 0.7 * smooth(clamp(tailLeft / 2.6, 0, 1)));
    let wave = 0;
    for (let p = 0; p < pulses.length; p++) {
      const age = gameTime - pulses[p]; if (age > 2) continue;
      const q = d - age * 15; wave += Math.exp(-q * q * 1.1) * Math.max(0, 1 - age / 2);
    }
    r *= 1 + 0.38 * wave;
    if (state === 'dying' && d < deathCut) r = 0;
    M4.makeScale(r, r, r); M4.setPosition(x, r, z);
    body.setMatrixAt(n, M4);
    // color
    const t = clamp(d / Math.max(Lvis, 1), 0, 1);
    let cr = lerp(0.0, 0.62, t), cg = lerp(0.95, 0.12, t), cb = 1.0;
    if (bk > 0.001) { cr = lerp(cr, 1.0, bk); cg = lerp(cg, lerp(0.62, 0.08, t), bk); cb = lerp(cb, lerp(0.05, 0.4, t), bk); }
    if (ck > 0.001) {
      tmpC.setHSL((((kabs * 0.012 - gameTime * 0.5) % 1) + 1) % 1, 1, 0.55);
      cr = lerp(cr, tmpC.r, ck * 0.85); cg = lerp(cg, tmpC.g, ck * 0.85); cb = lerp(cb, tmpC.b, ck * 0.85);
    }
    const stripe = (((kabs % 8) + 8) % 8) < 2 ? 1.25 : 0.85;
    const m = stripe * (1 + wave * 1.6);
    arr[n * 3] = cr * m + wave * 0.4; arr[n * 3 + 1] = cg * m + wave * 0.4; arr[n * 3 + 2] = cb * m + wave * 0.4;
    n++;
  }
  body.count = n;
  body.instanceMatrix.needsUpdate = true; body.instanceColor.needsUpdate = true;

  // head
  if (head.visible) {
    head.position.set(hx, 0.36 + Math.sin(realTime * 9) * 0.012, hz);
    head.lookAt(hx + tx, 0.36, hz + tz);
    head.rotateZ(clamp(-yawVel * 0.05, -0.35, 0.35));
    const sq = headSquash;
    skull.scale.set(SKULL.x * (1 + 0.14 * sq), SKULL.y * (1 - 0.08 * sq), SKULL.z * (1 - 0.06 * sq));
    headMat.color.setRGB(lerp(0, 1, bk), lerp(0.9, 0.55, bk), lerp(1, 0.08, bk));
    headMat.emissive.setRGB(lerp(0, 1, bk) * 0.8, lerp(0.72, 0.35, bk) * 0.8, lerp(0.85, 0.02, bk) * 0.8);
    // pupils look toward food
    if (food.active) {
      const fxw = cellX(food.cell) - hx, fzw = cellZ(food.cell) - hz;
      const side = clamp((fxw * -tz + fzw * tx) * -0.02, -0.04, 0.04);
      for (const p of pupils) p.position.x = Math.sign(p.position.x) * 0.25 + side;
    }
  }
  headLight.position.set(hx, 1.0, hz);
  headLight.color.setRGB(lerp(0, 1, bk), lerp(0.94, 0.55, bk), lerp(1, 0.1, bk));
  headLight.intensity = head.visible ? 2.5 + bk * 3 : 0;
}

function updateFood(dt) {
  for (const f of [food, gold]) {
    if (!f.active) continue;
    const age = gameTime - f.spawnT;
    f.group.scale.setScalar(Math.max(0.001, easeOutElastic(Math.min(age / 0.7, 1))));
    f.float.position.y = 0.6 + Math.sin(gameTime * 3 + f.cell.x) * 0.13;
    f.core.rotation.y += dt * 1.9; f.core.rotation.x += dt * 1.1;
    f.shell.rotation.y -= dt * 0.8; f.shell.rotation.z += dt * 0.4;
    const pl = 1 + 0.18 * Math.sin(gameTime * 5);
    f.ring.scale.set(pl, pl, 1);
    f.beam.material.opacity = 0.06 + 0.03 * Math.sin(gameTime * 4);
    if (Math.random() < dt * 8) spawn(f.group.position.x + rand(-0.3, 0.3), 0.2, f.group.position.z + rand(-0.3, 0.3), 0, rand(1, 2.2), 0, ...(f === gold ? [2, 1.4, 0.2] : [2, 0.3, 1.6]), rand(0.08, 0.14), rand(0.6, 1.1), -0.5, 0.5);
  }
  if (gold.active && state === 'playing') {
    gold.life -= dt;
    gold.group.visible = gold.life > 2 || Math.sin(gameTime * 28) > -0.3;
    if (gold.life <= 0) {
      gold.active = false; gold.group.visible = false;
      burst(gold.group.position.x, 0.6, gold.group.position.z, 0x886622, 30, 3, { lift: 1 });
    }
  }
}

function updateCamera(rdt) {
  if (state === 'menu' || state === 'over') {
    const a = realTime * 0.12, r = 19, h = 12.5;
    camPos.x = damp(camPos.x, Math.sin(a) * r, 2, rdt); camPos.y = damp(camPos.y, h, 2, rdt); camPos.z = damp(camPos.z, Math.cos(a) * r, 2, rdt);
    camera.position.copy(camPos); camera.lookAt(0, -1, 0);
    camera.fov = damp(camera.fov, 55, 3, rdt); camera.updateProjectionMatrix();
    camYaw = Math.atan2(-camPos.x, -camPos.z);
    return;
  }
  const tYaw = Math.atan2(tx, tz);
  const prev = camYaw;
  camYaw = dampAngle(camYaw, tYaw, 7.5, rdt);
  yawVel = damp(yawVel, angDiff(prev, camYaw) / Math.max(rdt, 1e-4), 12, rdt);
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const dyingK = state === 'dying' ? Math.min(deathT * 1.6, 1.5) : 0;
  const back = 6.6 + boostVis * 1.8 + dyingK * 4;
  const up = 4.3 - boostVis * 0.5 + dyingK * 5;
  camBlend = Math.min(1, camBlend + rdt * 0.9);
  const rate = 1.5 + 9 * smooth(camBlend);
  camPos.x = damp(camPos.x, hx - fx * back, rate, rdt);
  camPos.y = damp(camPos.y, up, rate, rdt);
  camPos.z = damp(camPos.z, hz - fz * back, rate, rdt);
  trauma = Math.max(0, trauma - rdt * 1.5);
  const s = trauma * trauma;
  const t = realTime * 40;
  camera.position.set(camPos.x + Math.sin(t * 1.1) * s * 0.55, camPos.y + Math.sin(t * 1.7 + 3) * s * 0.4, camPos.z + Math.sin(t * 1.3 + 7) * s * 0.55);
  camera.lookAt(hx + fx * 4.6, 0.4, hz + fz * 4.6);
  camRoll = damp(camRoll, clamp(yawVel * 0.035, -0.13, 0.13), 6, rdt);
  camera.rotateZ(camRoll + Math.sin(t * 0.9) * s * 0.04);
  fovKick = damp(fovKick, 0, 4, rdt);
  camera.fov = damp(camera.fov, 66 + boostVis * 16 + Math.min(level() - 1, 8) * 0.8 + fovKick, 8, rdt);
  camera.updateProjectionMatrix();
}

function dangerAhead() {
  const h = cells[0]; const nx = h.x + exitDir.x, nz = h.z + exitDir.z;
  if (nx < 0 || nz < 0 || nx >= N || nz >= N) return true;
  for (let i = 0; i < cells.length - 1; i++) if (cells[i].x === nx && cells[i].z === nz) return true;
  return false;
}

// ================= main loop =================
let last = performance.now();
let lastLen = -1, lastLvl = -1;
function frame(now) {
  if (dead) return;
  raf = requestAnimationFrame(frame);
  const rdt = Math.min((now - last) / 1000, 0.05); last = now; realTime += rdt;
  timeScale = damp(timeScale, 1, 1.6, rdt);
  const dt = state === 'paused' ? 0 : rdt * timeScale;
  gameTime += dt;

  if (state === 'playing') {
    if (energy <= 0) boostLock = true;
    if (boostLock && energy > 25) boostLock = false;
    const wasBoost = boosting;
    boosting = boostHeld && !boostLock && energy > 0;
    if (boosting !== wasBoost) { AudioSys.setBoost(boosting); if (boosting) { fovKick += 4; trauma = Math.min(1, trauma + 0.12); } }
    energy = boosting ? Math.max(0, energy - 30 * dt) : Math.min(100, energy + 10 * dt);
    const sp = speed() * (boosting ? BOOST_MULT : brakeHeld ? BRAKE_MULT : 1);
    progress += dt * sp;
    while (progress >= 1 && state === 'playing') { progress -= 1; tick(); }
    if (combo > 0) { comboTimer -= dt; if (comboTimer <= 0) { combo = 0; comboTimer = 0; } }
    dangerVis = damp(dangerVis, dangerAhead() && progress > 0.15 ? 1 : 0, 10, rdt);
  } else if (state !== 'paused') {
    boosting = false; dangerVis = damp(dangerVis, 0, 6, rdt);
  }
  boostVis = damp(boostVis, boosting ? 1 : 0, 6, dt || rdt);
  comboVis = damp(comboVis, combo >= 3 ? Math.min((combo - 2) / 3, 1) : 0, 3, rdt);
  AudioSys.setIntensity(state === 'playing' ? Math.min(combo / 4, 1) : 0);
  headSquash = damp(headSquash, 0, 7, rdt);

  if (state !== 'paused') {
    updateSnakeVisual(dt);
    updateFood(dt);
    updateParticles(dt);
    updateWaves(dt);
  }

  // dying chain explosion
  if (state === 'dying') {
    deathT += dt;
    deathCut = deathT * 14 - 0.2;
    while (cutBurstD < Math.min(deathCut, Lvis)) {
      samplePath(cutBurstD, SP);
      const t = clamp(cutBurstD / Math.max(Lvis, 1), 0, 1);
      tmpC.setRGB(lerp(0, 0.62, t), lerp(0.95, 0.12, t), 1);
      burst(SP.x, 0.3, SP.z, tmpC.getHex(), 9, 5, { lift: 3, size: 1.1 });
      if (popIdx % 2 === 0) AudioSys.pop(popIdx / 2);
      popIdx++;
      cutBurstD += 0.5;
    }
    if (deathCut > Lvis + 0.4 && overDelay < 0) overDelay = 0.8;
    if (overDelay > 0) { overDelay -= rdt; if (overDelay <= 0) gameOver(); }
  }

  // boost flames
  if (boosting && state === 'playing') {
    samplePath(Lvis - 0.1, SP);
    const cnt = Math.ceil(rdt * 160);
    for (let i = 0; i < cnt; i++) spawn(SP.x + rand(-0.12, 0.12), 0.22, SP.z + rand(-0.12, 0.12), rand(-0.8, 0.8), rand(0.5, 2.5), rand(-0.8, 0.8), 2.4, rand(0.5, 1.1), 0.08, rand(0.1, 0.22), rand(0.25, 0.55), -2, 2);
    for (let i = 0; i < 2; i++) { const s = rand(-1, 1) > 0 ? 1 : -1; spawn(hx - tx * 0.3 + -tz * 0.35 * s, 0.1, hz - tz * 0.3 + tx * 0.35 * s, -tx * rand(3, 6) - tz * s * 2, rand(1, 3), -tz * rand(3, 6) + tx * s * 2, 2.5, 1.6, 0.3, rand(0.06, 0.12), rand(0.2, 0.4), 12, 1); }
  }

  // tongue flick
  tongueNext -= rdt;
  if (tongueNext <= 0) { tongueT = 0.35; tongueNext = rand(1.2, 3); }
  if (tongueT > 0) { tongueT -= rdt; const k = 1 - tongueT / 0.35; tongue.scale.z = Math.max(0.001, Math.sin(k * Math.PI)); tongue.rotation.y = Math.sin(k * 30) * 0.15; } else tongue.scale.z = 0.001;

  // walls & environment
  for (let i = 0; i < 4; i++) {
    const d = i === 0 ? hz + HALF : i === 1 ? HALF - hz : i === 2 ? hx + HALF : HALF - hx;
    walls[i].material.emissiveIntensity = 0.55 + (state === 'playing' ? 2.5 * Math.exp(-d * 1.1) : 0) + 0.15 * Math.sin(realTime * 3 + i);
  }
  for (const m of deco) {
    if (m.userData.spin === true) { m.rotation.y += rdt * 1.5; continue; }
    m.rotation.x += m.userData.spin.x * rdt; m.rotation.y += m.userData.spin.y * rdt; m.rotation.z += m.userData.spin.z * rdt;
    m.position.y = m.userData.baseY + Math.sin(realTime * 0.4 + m.userData.ph) * 1.5;
  }
  gridMat.uniforms.uTime.value = gameTime;
  gridMat.uniforms.uHead.value.set(hx, hz);
  gridMat.uniforms.uBoost.value = boostVis;
  motes.uniforms.uTime.value = realTime;
  bloom.strength = 0.6 + boostVis * 0.25 + comboVis * 0.2 + flashA * 0.35;

  updateCamera(rdt);

  // HUD
  flashA = damp(flashA, 0, 7, rdt);
  const fl = $('flash'); fl.style.opacity = flashA.toFixed(3); fl.style.background = flashColor;
  $('danger').style.opacity = (dangerVis * (0.55 + 0.45 * Math.sin(realTime * 18))).toFixed(3);
  displayScore = damp(displayScore, score, 10, rdt);
  if (Math.abs(displayScore - score) < 0.5) displayScore = score;
  $('score').textContent = Math.round(displayScore);
  if (cells.length !== lastLen) { lastLen = cells.length; $('len').textContent = lastLen; }
  if (level() !== lastLvl) { lastLvl = level(); $('lvl').textContent = lastLvl; }
  $('turboFill').style.width = energy.toFixed(1) + '%';
  $('turbo').classList.toggle('active', boosting);
  $('turbo').classList.toggle('empty', boostLock);
  const cEl = $('combo');
  if (combo >= 2 && state === 'playing') {
    cEl.style.opacity = 1;
    const txt = 'COMBO x' + combo; if ($('comboText').textContent !== txt) $('comboText').textContent = txt;
    $('comboFill').style.width = (comboTimer / COMBO_WINDOW * 100).toFixed(1) + '%';
  } else cEl.style.opacity = 0;
  updateBanner(rdt);
  if (state === 'over' && overCount < overTarget) {
    overCount = Math.min(overTarget, overCount + Math.max(1, overTarget * rdt * 0.9));
    $('finalScore').textContent = Math.round(overCount);
    overTickAcc += rdt; if (overTickAcc > 0.045) { overTickAcc = 0; AudioSys.tick(overCount / Math.max(overTarget, 1) * 100); }
  }
  drawMinimap();

  composer.render();
}

// ================= input
const typing = e => { const el = e.target; return !!(el && el.closest && el.closest('input, textarea, select, [contenteditable]')) || !!document.querySelector('[aria-modal="true"]'); };
const onKeyDown = e => {
  if (typing(e)) return;
  const k = e.code;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(k)) e.preventDefault();
  if (k === 'KeyM') { const m = AudioSys.toggleMute(); $('mute').textContent = '[M] DŹWIĘK: ' + (m ? 'OFF' : 'ON'); return; }
  if (k === 'KeyF') { toggleFullscreen(); return; }
  if ((k === 'Space' || k === 'Enter') && (state === 'menu' || (state === 'over' && overCount >= overTarget * 0.3))) {
    if (k === 'Enter' && e.target.closest && e.target.closest('button')) return;
    startGame(); return;
  }
  if ((k === 'KeyP' || k === 'Escape') && (state === 'playing' || state === 'paused')) { togglePause(); return; }
  if (k === 'KeyW' || k === 'ArrowUp') boostHeld = true;
  if (k === 'KeyS' || k === 'ArrowDown') brakeHeld = true;
  if (e.repeat) return;
  if (k === 'KeyA' || k === 'ArrowLeft') queueTurn(-1);
  if (k === 'KeyD' || k === 'ArrowRight') queueTurn(1);
};
const onKeyUp = e => {
  if (e.code === 'KeyW' || e.code === 'ArrowUp') boostHeld = false;
  if (e.code === 'KeyS' || e.code === 'ArrowDown') brakeHeld = false;
};
const onBlur = () => { boostHeld = false; brakeHeld = false; };
const onHide = () => { if (document.hidden && state === 'playing') togglePause(); };
const onTouch = e => {
  if (state === 'menu' || state === 'over' || state === 'paused') return;
  const r = root.getBoundingClientRect();
  for (const t of e.changedTouches) queueTurn(t.clientX - r.left < r.width / 2 ? -1 : 1);
};
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.(); else root.requestFullscreen?.().catch(() => {});
}
addEventListener('keydown', onKeyDown);
addEventListener('keyup', onKeyUp);
addEventListener('blur', onBlur);
document.addEventListener('visibilitychange', onHide);
root.addEventListener('touchstart', onTouch, { passive: true });
$('startBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('fsBtn').addEventListener('click', toggleFullscreen);

reset();
raf = requestAnimationFrame(frame);

return {
  pause() { if (state === 'playing') togglePause(); },
  destroy() {
    dead = true; cancelAnimationFrame(raf); ro.disconnect();
    removeEventListener('keydown', onKeyDown); removeEventListener('keyup', onKeyUp); removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onHide); root.removeEventListener('touchstart', onTouch);
    if (document.fullscreenElement === root) document.exitFullscreen?.();
    AudioSys.dispose();
    composer.dispose?.();
    renderer.dispose(); renderer.forceContextLoss();
    root.innerHTML = '';
  }
};


}
