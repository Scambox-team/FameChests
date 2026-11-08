// @ts-nocheck -- Hologramowy (wariant `hologram`, makieta „Chmura punktów”): to nie karta, tylko małe okrągłe urządzenie, z którego
// świeci niebieski hologram osoby złożony z tysięcy punktów (jaśniejsze miejsca twarzy wysunięte do przodu - przy obracaniu widać ją
// w 3D; punkty falują, zakłócenia przesuwają całe rzędy), prostokątna tabliczka ze statystykami po prawej przed postacią i znaczek
// z wartością za postacią.
// Karty w listach: jeden wspólny renderer rysuje kadr dla każdej osoby raz (hologramStill, kolejka, pamięć podręczna) - setki kart
// nie mogą mieć własnych kontekstów WebGL. Podgląd karty: mountHoloLive - żywa scena, obracanie o 360° przeciąganiem.
import * as THREE from 'three';
import { abilitiesOf, cardValue, imgUrl, person } from '../game/rules';
import { S } from '../game/store';

const T = THREE;
const W = 477, H = 600;   // proporcje warstwy .hg-wrap (karta poszerzona o 10% z boków i 6% u góry)

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HOLO_FRAG = `
uniform sampler2D map; uniform float time, glitch, grain, opacity, useAlpha, scanK; uniform vec3 color; varying vec2 vUv;
float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  float row = floor(uv.y * 70.0);
  float g = step(1.0 - 0.10 * glitch - 0.004, rnd(vec2(row, floor(time * 14.0))));
  uv.x += g * (rnd(vec2(time, row)) - 0.5) * 0.16;
  vec4 t = texture2D(map, uv);
  float l = useAlpha > 0.5 ? t.a : dot(t.rgb, vec3(0.3, 0.59, 0.11));
  float scan = 1.0 - scanK + scanK * sin(uv.y * 720.0 - time * 9.0);
  float band = 0.82 + 0.18 * sin(uv.y * 16.0 + time * 2.6);
  float flick = 0.86 + 0.14 * rnd(vec2(floor(time * 22.0), 3.0));
  float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.93, vUv.y);
  float n = (rnd(vUv * vec2(512.0, 384.0) + fract(time * 7.0)) - 0.5) * grain;
  float a = clamp((l * 1.2 + (useAlpha > 0.5 ? 0.0 : 0.05)) * scan * band * flick * edge * opacity + n * edge, 0.0, 1.0);
  if (useAlpha < 0.5) a *= t.a;
  gl_FragColor = vec4(color * (0.5 + l * 0.95) + g * 0.15, a);
}`;
const COLOR = 0x5fc8ff;
const holoMat = (tex, o = {}) => new T.ShaderMaterial({
  uniforms: { map: { value: tex }, time: { value: 0 }, glitch: { value: 0 }, color: { value: new T.Color(COLOR) }, grain: { value: o.grain ?? .14 },
    opacity: { value: o.opacity ?? 1 }, useAlpha: { value: o.text ? 1 : 0 }, scanK: { value: o.scan ?? .38 } },
  vertexShader: VERT, fragmentShader: HOLO_FRAG, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
});
const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; };

function stats(pid) {
  const p = person(pid) || {};
  return { name: String(p.name || '').toUpperCase(), hp: p.hp ?? 0, ab: abilitiesOf(p) || [], val: p.id ? cardValue(p.id) : 0, rar: S.cfg?.rarities?.[p.rarity]?.name || '' };
}
// tabliczka: nazwa, HP z paskiem, ataki, wartość, rzadkość (białe na przezroczystym - shader barwi na niebiesko)
const panelTexture = st => canvasTex(512, 640, g => {
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 4;
  g.strokeRect(8, 8, 496, 624); g.fillRect(8, 8, 120, 10); g.fillRect(384, 622, 120, 10);
  g.font = '800 44px Consolas, monospace';
  let y = 76;
  for (const w of st.name.split(' ').slice(0, 3)) { g.fillText(w.slice(0, 18), 32, y); y += 50; }
  g.fillRect(32, y - 16, 448, 3);
  g.font = '700 34px Consolas, monospace'; y += 36;
  g.fillText('HP', 32, y); g.fillText(String(st.hp), 380, y);
  g.globalAlpha = .5; g.fillRect(32, y + 14, 448, 12); g.globalAlpha = 1; g.fillRect(32, y + 14, Math.min(448, st.hp * 2.2), 12); y += 66;
  for (const a of st.ab.slice(0, 3)) { g.font = '600 28px Consolas, monospace'; g.fillText(String(a.name).toUpperCase().slice(0, 20), 32, y); g.font = '800 34px Consolas, monospace'; g.fillText(String(a.value), 400, y); y += 46; }
  g.fillRect(32, y - 14, 448, 3); y += 30;
  g.font = '700 30px Consolas, monospace'; g.fillText('WARTOŚĆ', 32, y); g.fillText(`${st.val} GR`, 300, y); y += 44;
  g.fillText(st.rar.toUpperCase().slice(0, 22), 32, y);
});
const chipTexture = (label, value) => canvasTex(256, 128, g => {
  g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(6, 6, 244, 116);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 26px Consolas, monospace'; g.fillText(label, 128, 44);
  g.font = '800 46px Consolas, monospace'; g.fillText(String(value).slice(0, 10), 128, 100);
});
// urządzenie: płaski metalowy dysk, świecący pierścień, soczewka, diody
function projector(r = .55, h = .14) {
  const g = new T.Group();
  const metal = new T.MeshStandardMaterial({ color: 0x2b323b, metalness: .85, roughness: .32 });
  const body = new T.Mesh(new T.CylinderGeometry(r, r * 1.08, h, 72), metal); body.position.y = h / 2; g.add(body);
  const groove = new T.Mesh(new T.TorusGeometry(r * 1.045, .014, 8, 96), new T.MeshStandardMaterial({ color: 0x0c0f13, metalness: .9, roughness: .3 }));
  groove.rotation.x = Math.PI / 2; groove.position.y = h * .32; g.add(groove);
  const rt = r * .94;
  const top = new T.Mesh(new T.CylinderGeometry(rt, rt, .02, 72), new T.MeshStandardMaterial({ color: 0x08141e, metalness: .4, roughness: .5, emissive: 0x0b3d5e, emissiveIntensity: .7 }));
  top.position.y = h + .01; g.add(top);
  const ring = new T.Mesh(new T.TorusGeometry(rt * .82, .022, 12, 96), new T.MeshBasicMaterial({ color: 0x8fe2ff }));
  ring.rotation.x = Math.PI / 2; ring.position.y = h + .026; g.add(ring);
  const lens = new T.Mesh(new T.CircleGeometry(rt * .36, 48), new T.MeshBasicMaterial({ color: 0xbff0ff }));
  lens.rotation.x = -Math.PI / 2; lens.position.y = h + .03; g.add(lens);
  const leds = [];
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2, m = new T.Mesh(new T.SphereGeometry(.022, 8, 8), new T.MeshBasicMaterial({ color: i % 6 ? 0x3fb6ff : 0xff5a5a }));
    m.position.set(Math.cos(a) * r * 1.06, h * .62, Math.sin(a) * r * 1.06); g.add(m); leds.push(m);
  }
  return { group: g, ring, leds, top: h + .03 };
}
function beam(height, y0) {
  const mat = new T.ShaderMaterial({
    uniforms: { color: { value: new T.Color(COLOR) }, time: { value: 0 } }, vertexShader: VERT,
    fragmentShader: `uniform vec3 color; uniform float time; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.7) * 0.3 * (0.8 + 0.2 * sin(time * 9.0 + vUv.x * 50.0)); gl_FragColor = vec4(color, a); }`,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
  });
  const m = new T.Mesh(new T.CylinderGeometry(1.15, .18, height, 48, 1, true), mat); m.position.y = y0 + height / 2; return m;
}
function motes(n, r, height, y0) {
  const pos = new Float32Array(n * 3), spd = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; pos.set([Math.cos(a) * d, y0 + Math.random() * height, Math.sin(a) * d], i * 3); spd[i] = .15 + Math.random() * .35; }
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  const pts = new T.Points(geo, new T.PointsMaterial({ color: COLOR, size: .035, transparent: true, opacity: .8, blending: T.AdditiveBlending, depthWrite: false }));
  pts.userData.tick = dt => { for (let i = 0; i < n; i++) { let y = pos[i * 3 + 1] + spd[i] * dt; if (y > y0 + height) y = y0; pos[i * 3 + 1] = y; } geo.attributes.position.needsUpdate = true; };
  return pts;
}

// scena; onPhoto - gdy zdjęcie się wczyta (kadr do listy rysujemy dopiero wtedy)
function buildScene(pid, onPhoto) {
  const st = stats(pid), scene = new T.Scene(), camera = new T.PerspectiveCamera(35, W / H, .1, 100);
  scene.add(new T.AmbientLight(0xffffff, .55));
  const dl = new T.DirectionalLight(0xffffff, 1.1); dl.position.set(2, 4, 5); scene.add(dl);
  const pl = new T.PointLight(COLOR, 2.5, 5); pl.position.set(0, .4, .7); scene.add(pl);
  const root = new T.Group(); scene.add(root);
  const dev = projector(); root.add(dev.group);
  root.add(beam(2.7, dev.top));
  const mats = [];
  // chmura punktów z jasności zdjęcia (96 x 122 próbek): jaśniejsze miejsca wysunięte do przodu; kadr do listy rysujemy, gdy jest gotowa
  const PW = 96, PH = 122, py = dev.top + 1.32;
  const ptsMat = new T.ShaderMaterial({
    uniforms: { time: { value: 0 }, glitch: { value: 0 }, color: { value: new T.Color(COLOR) } },
    vertexShader: `attribute float lum; uniform float time, glitch; varying float vL; float rnd(float x){ return fract(sin(x * 91.7) * 43758.5); }
      void main(){ vL = lum; vec3 p = position; p.z += sin(time * 2.0 + p.y * 9.0) * .012; float row = floor(p.y * 30.0);
        p.x += step(.97 - .05 * glitch, rnd(row + floor(time * 12.0))) * (rnd(row * 3.1 + time) - .5) * .18;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (2.2 + lum * 2.4) * (6.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; varying float vL; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; gl_FragColor = vec4(color * (.6 + vL), (1.0 - d * 2.0) * (.35 + vL * .65)); }`,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
  });
  mats.push(ptsMat);
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = PW; c.height = PH;
      const g = c.getContext('2d', { willReadFrequently: true }), ta = PW / PH;
      let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
      if (sw / sh > ta) { sw = sh * ta; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / ta; sy = (img.naturalHeight - sh) * .18; }
      g.drawImage(img, sx, sy, sw, sh, 0, 0, PW, PH);
      const d = g.getImageData(0, 0, PW, PH).data, pos = [], lum = [];
      for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
        const i = (y * PW + x) * 4, l = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) / 255;
        if (l < .12) continue;
        pos.push((x / PW - .5) * 1.85, (.5 - y / PH) * 2.35, (l - .5) * .45); lum.push(l);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('lum', new T.Float32BufferAttribute(lum, 1));
      const pts = new T.Points(geo, ptsMat); pts.position.set(-.15, py, 0); root.add(pts);
    } catch { /* bez dostępu do pikseli zostaje sama tabliczka */ }
    onPhoto?.();
  };
  img.onerror = () => onPhoto?.();
  img.src = imgUrl(pid, 'normal');
  const sm = holoMat(panelTexture(st), { text: true, grain: .08, scan: .23, opacity: .95 }); mats.push(sm);
  const panel = new T.Mesh(new T.PlaneGeometry(1.2, 1.5), sm); panel.position.set(.62, dev.top + 1.22, .55); panel.rotation.y = -.22; root.add(panel);
  const cm = holoMat(chipTexture('WARTOŚĆ', `${st.val} GR`), { text: true, opacity: .9 }); mats.push(cm);
  const chip = new T.Mesh(new T.PlaneGeometry(.7, .35), cm); chip.position.set(-1.0, dev.top + 1.9, -.45); chip.rotation.y = .4; root.add(chip);
  const dust = motes(80, .9, 2.7, dev.top); root.add(dust);
  root.position.x = -.2;
  camera.position.set(0, 1.55, 6.7); camera.lookAt(.12, 1.45, 0);
  let last = 0, rot = 0, vel = 0, lastDrag = -1e9;
  return {
    scene, camera,
    drag(dx) { vel = dx * .01; rot += vel; lastDrag = performance.now(); },
    update(t, still = false) {
      const dt = Math.min(.05, t - last); last = t;
      const glitch = still ? 0 : (Math.sin(t * 1.3) + Math.sin(t * 3.1 + 1.7)) > 1.5 ? 1 : .08;
      for (const m of mats) { m.uniforms.time.value = t; m.uniforms.glitch.value = glitch; }
      scene.traverse(o => { if (o.material?.uniforms?.time && !mats.includes(o.material)) o.material.uniforms.time.value = t; });
      if (performance.now() - lastDrag < 2500) { rot += vel; vel *= .92; }
      else { const target = Math.sin(t * .3) * .22, k = Math.round((rot - target) / (Math.PI * 2)); rot += (target + k * Math.PI * 2 - rot) * .03; }
      root.rotation.y = still ? .12 : rot;
      dev.ring.material.color.setHSL(.55, 1, .65 + Math.sin(t * 3) * .12);
      dev.leds.forEach((l, i) => l.visible = still || Math.sin(t * 4 + i) > -.3);
      dust.userData.tick(dt);
    },
  };
}
const disposeScene = scene => scene.traverse(o => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach(m => { m.map?.dispose?.(); m.uniforms?.map?.value?.dispose?.(); m.dispose?.(); }); });

// kadry dla kart w listach: jeden renderer, kolejka, pamięć podręczna wg osoby
const STILLS = new Map();
let shared = null, queue = Promise.resolve();
export function hologramStill(pid) {
  if (STILLS.has(pid)) return STILLS.get(pid);
  const job = queue.then(() => new Promise(resolve => {
    try {
      if (!shared) { const canvas = document.createElement('canvas'); shared = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true }); shared.setSize(W, H, false); shared.outputColorSpace = T.SRGBColorSpace; }
      let s;
      const shot = () => { s.update(1.2, true); shared.clear(); shared.render(s.scene, s.camera); const url = shared.domElement.toDataURL('image/png'); disposeScene(s.scene); resolve(url); };
      s = buildScene(pid, shot);
    } catch { resolve(null); }
  }));
  queue = job.catch(() => {});
  STILLS.set(pid, job);
  return job;
}

// podgląd karty: żywa scena w miejsce kadru, obracanie przeciąganiem (kliknięcie nie obraca karty w podglądzie)
export function mountHoloLive(card) {
  const still = card?.querySelector('.hg-still');
  if (!still) return;
  const pid = still.dataset.pid, canvas = document.createElement('canvas');
  canvas.className = 'hg-live';
  let renderer;
  try { renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true }); } catch { return; }
  still.replaceWith(canvas);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.outputColorSpace = T.SRGBColorSpace;
  const s = buildScene(pid), t0 = performance.now();
  let px = null, moved = 0;
  canvas.addEventListener('pointerdown', e => { px = e.clientX; moved = 0; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', e => { if (px == null) return; const dx = e.clientX - px; moved += Math.abs(dx); s.drag(dx); px = e.clientX; });
  const up = () => { px = null; canvas.style.cursor = ''; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('click', e => e.stopPropagation());
  let w = 0, h = 0;
  renderer.setAnimationLoop(() => {
    if (!canvas.isConnected) { renderer.setAnimationLoop(null); disposeScene(s.scene); renderer.dispose(); renderer.forceContextLoss?.(); return; }
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (cw !== w || ch !== h) { w = cw; h = ch; renderer.setSize(w, h, false); s.camera.aspect = w / h; s.camera.updateProjectionMatrix(); }
    s.update((performance.now() - t0) / 1000);
    renderer.render(s.scene, s.camera);
  });
}
