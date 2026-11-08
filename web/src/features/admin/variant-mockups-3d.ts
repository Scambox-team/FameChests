// @ts-nocheck -- makiety 3D (Hologramowy, Frutiger Aero): Three.js wczytywany dopiero, gdy na stronie pojawi się makieta 3D.
// Makieta wstawia <canvas class="m3d" data-kind="holo|aero" data-look="1..4" data-pid="...">, a obserwator poniżej
// uruchamia na nim scenę. Scena rysuje się tylko, gdy płótno jest widoczne, i sprząta się sama, gdy płótno zniknie ze strony.
import { abilitiesOf, cardValue, imgUrl, person } from '../../game/rules';
import { S } from '../../game/store';

let THREE = null;
const loadThree = () => THREE ? Promise.resolve(THREE) : import('three').then(m => (THREE = m));

function scan(root) {
  root?.querySelectorAll?.('canvas.m3d:not([data-on])').forEach(c => { c.dataset.on = '1'; mount(c); });
}
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n.matches?.('canvas.m3d') ? n.parentNode : n);
}).observe(document.body, { childList: true, subtree: true });
scan(document);

async function mount(canvas) {
  const T = await loadThree();
  if (!canvas.isConnected) return;
  const kind = canvas.dataset.kind, look = +canvas.dataset.look || 1, pid = canvas.dataset.pid;
  let renderer;
  try { renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true }); } catch { return; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = T.SRGBColorSpace;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(35, 1, .1, 100);
  const builders = { holo: buildHolo, holo2: buildHolo2, holo3: buildHolo3, aero: buildAero, aero2: buildAero2, aero3: buildAero3 };
  const sc = (builders[kind] || buildAero)(T, scene, camera, look, pid, canvas.dataset.layer);
  // obracanie przeciąganiem (hologram): pointer-events włącza CSS tylko w powiększeniu / podglądzie
  if (sc.drag) {
    let px = null;
    canvas.addEventListener('pointerdown', e => { px = e.clientX; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; e.stopPropagation(); });
    canvas.addEventListener('pointermove', e => { if (px == null) return; sc.drag(e.clientX - px); px = e.clientX; });
    const up = () => { px = null; canvas.style.cursor = ''; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('click', e => e.stopPropagation());
  }
  let visible = true, w = 0, h = 0;
  const io = new IntersectionObserver(e => { visible = e[0].isIntersecting; });
  io.observe(canvas);
  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    if (!canvas.isConnected) {
      renderer.setAnimationLoop(null); io.disconnect();
      scene.traverse(o => { o.geometry?.dispose?.(); [].concat(o.material || []).forEach(m => { m.map?.dispose?.(); m.uniforms?.map?.value?.dispose?.(); m.dispose?.(); }); });
      renderer.dispose(); renderer.forceContextLoss?.();
      return;
    }
    if (!visible) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (cw !== w || ch !== h) { w = cw; h = ch; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    sc.update((performance.now() - t0) / 1000);
    renderer.render(scene, camera);
  });
}

// ================================================================ HOLOGRAM

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// obraz hologramu: jasność zdjęcia (albo przezroczystość napisów) w kolorze hologramu, linie skanowania, migotanie,
// ziarno, poziome pasy zakłóceń przesuwające wiersze w bok; dodawane światło (AdditiveBlending)
const HOLO_FRAG = `
uniform sampler2D map; uniform float time, glitch, grain, opacity, radial, useAlpha, scanK, build; uniform vec3 color; varying vec2 vUv;
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
  float edge = radial > 0.5 ? smoothstep(0.52, 0.28, distance(vUv, vec2(0.5, 0.56)))
    : smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.93, vUv.y);
  float n = (rnd(vUv * vec2(512.0, 384.0) + fract(time * 7.0)) - 0.5) * grain;
  float a = clamp((l * 1.2 + (useAlpha > 0.5 ? 0.0 : 0.05)) * scan * band * flick * edge * opacity + n * edge, 0.0, 1.0);
  if (useAlpha < 0.5) a *= t.a;
  float edgeB = smoothstep(build - 0.025, build, vUv.y) * step(vUv.y, build) * step(build, 0.999);   // świecąca linia budowania obrazu
  a = a * step(vUv.y, build) + edgeB * 0.7;
  gl_FragColor = vec4(color * (0.5 + l * 0.95) + g * 0.15 + edgeB, a);
}`;
const holoMat = (T, tex, o = {}) => new T.ShaderMaterial({
  uniforms: { map: { value: tex }, time: { value: 0 }, glitch: { value: 0 }, color: { value: new T.Color(o.color ?? 0x5fc8ff) }, grain: { value: o.grain ?? .14 },
    opacity: { value: o.opacity ?? 1 }, radial: { value: o.radial ? 1 : 0 }, useAlpha: { value: o.text ? 1 : 0 }, scanK: { value: o.scan ?? .38 }, build: { value: 1 } },
  vertexShader: VERT, fragmentShader: HOLO_FRAG, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
});

function personStats(pid) {
  const p = person(pid) || {};
  return { name: String(p.name || '').toUpperCase(), hp: p.hp ?? 0, ab: abilitiesOf(p) || [], val: p.id ? cardValue(p.id) : 0, rar: S.cfg?.rarities?.[p.rarity]?.name || '' };
}
// napisy statystyk na płótnie (białe na przezroczystym - shader barwi je na niebiesko)
function statsTexture(T, st, kind = 'panel') {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  if (kind === 'strip') {   // pasek dookoła pierścienia
    c.width = 2048; c.height = 128;
    g.fillStyle = '#fff'; g.font = '700 64px Consolas, monospace'; g.textBaseline = 'middle';
    const txt = `  ${st.name}  ◆  HP ${st.hp}  ◆  ${st.ab.map(a => `${a.name.toUpperCase()} ${a.value}`).join('  ◆  ')}  ◆  ${st.val} GR  ◆  ${st.rar.toUpperCase()}  ◆`;
    let x = 0; while (x < c.width) { g.fillText(txt, x, 64); x += g.measureText(txt).width; }
    g.fillRect(0, 6, c.width, 4); g.fillRect(0, 118, c.width, 4);
  } else if (kind === 'chip') {   // mały panel: [etykieta, wartość]
    c.width = 256; c.height = 128;
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(6, 6, 244, 116);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 26px Consolas, monospace'; g.fillText(st[0], 128, 44);
    g.font = '800 46px Consolas, monospace'; g.fillText(String(st[1]).slice(0, 10), 128, 100);
  } else {   // panel: nazwa, HP, ataki, wartość, rzadkość, kreski
    c.width = 512; c.height = 640;
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 4;
    g.strokeRect(8, 8, 496, 624); g.fillRect(8, 8, 120, 10); g.fillRect(384, 622, 120, 10);
    g.font = '800 44px Consolas, monospace';
    const words = st.name.split(' '); let y = 76;
    for (const w of words.slice(0, 3)) { g.fillText(w.slice(0, 18), 32, y); y += 50; }
    g.fillRect(32, y - 16, 448, 3);
    g.font = '700 34px Consolas, monospace'; y += 36;
    g.fillText(`HP`, 32, y); g.fillText(String(st.hp), 380, y);
    g.globalAlpha = .5; g.fillRect(32, y + 14, 448, 12); g.globalAlpha = 1; g.fillRect(32, y + 14, Math.min(448, st.hp * 2.2), 12); y += 66;
    for (const a of st.ab.slice(0, 3)) { g.font = '600 28px Consolas, monospace'; g.fillText(a.name.toUpperCase().slice(0, 20), 32, y); g.font = '800 34px Consolas, monospace'; g.fillText(String(a.value), 400, y); y += 46; }
    g.fillRect(32, y - 14, 448, 3); y += 30;
    g.font = '700 30px Consolas, monospace'; g.fillText('WARTOŚĆ', 32, y); g.fillText(`${st.val} GR`, 300, y); y += 44;
    g.fillText(st.rar.toUpperCase().slice(0, 22), 32, y);
  }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
// urządzenie: płaski okrągły projektor z metalu, świecący pierścień, soczewka i diody dookoła
function projector(T, r = 1, h = .22, slim = false) {
  const g = new T.Group();
  const metal = new T.MeshStandardMaterial({ color: 0x2b323b, metalness: .85, roughness: .32 });
  if (slim) {
    const stem = new T.Mesh(new T.CylinderGeometry(r * .45, r * .7, h, 48), metal); stem.position.y = h / 2; g.add(stem);
  } else {
    const body = new T.Mesh(new T.CylinderGeometry(r, r * 1.08, h, 72), metal); body.position.y = h / 2; g.add(body);
    const groove = new T.Mesh(new T.TorusGeometry(r * 1.045, .014, 8, 96), new T.MeshStandardMaterial({ color: 0x0c0f13, metalness: .9, roughness: .3 }));
    groove.rotation.x = Math.PI / 2; groove.position.y = h * .32; g.add(groove);
  }
  const rt = slim ? r * .45 : r * .94;
  const top = new T.Mesh(new T.CylinderGeometry(rt, rt, .02, 72), new T.MeshStandardMaterial({ color: 0x08141e, metalness: .4, roughness: .5, emissive: 0x0b3d5e, emissiveIntensity: .7 }));
  top.position.y = h + .01; g.add(top);
  const ring = new T.Mesh(new T.TorusGeometry(rt * .82, .022, 12, 96), new T.MeshBasicMaterial({ color: 0x8fe2ff }));
  ring.rotation.x = Math.PI / 2; ring.position.y = h + .026; g.add(ring);
  const lens = new T.Mesh(new T.CircleGeometry(rt * .36, 48), new T.MeshBasicMaterial({ color: 0xbff0ff }));
  lens.rotation.x = -Math.PI / 2; lens.position.y = h + .03; g.add(lens);
  const leds = [];
  if (!slim) for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2, m = new T.Mesh(new T.SphereGeometry(.022, 8, 8), new T.MeshBasicMaterial({ color: i % 6 ? 0x3fb6ff : 0xff5a5a }));
    m.position.set(Math.cos(a) * r * 1.06, h * .62, Math.sin(a) * r * 1.06); g.add(m); leds.push(m);
  }
  return { group: g, ring, lens, leds, top: h + .03 };
}
// stożek światła od soczewki w górę (jaśniejszy przy urządzeniu)
function beam(T, rBot, rTop, height, color, y0) {
  const mat = new T.ShaderMaterial({
    uniforms: { color: { value: new T.Color(color) }, time: { value: 0 } }, vertexShader: VERT,
    fragmentShader: `uniform vec3 color; uniform float time; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.7) * 0.3 * (0.8 + 0.2 * sin(time * 9.0 + vUv.x * 50.0)); gl_FragColor = vec4(color, a); }`,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
  });
  const m = new T.Mesh(new T.CylinderGeometry(rTop, rBot, height, 48, 1, true), mat);
  m.position.y = y0 + height / 2; return m;
}
// drobinki unoszące się w stożku
function motes(T, n, r, height, y0, color) {
  const pos = new Float32Array(n * 3), spd = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; pos.set([Math.cos(a) * d, y0 + Math.random() * height, Math.sin(a) * d], i * 3); spd[i] = .15 + Math.random() * .35; }
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  const pts = new T.Points(geo, new T.PointsMaterial({ color, size: .035, transparent: true, opacity: .8, blending: T.AdditiveBlending, depthWrite: false }));
  pts.userData.tick = dt => { for (let i = 0; i < n; i++) { let y = pos[i * 3 + 1] + spd[i] * dt; if (y > y0 + height) y = y0; pos[i * 3 + 1] = y; } geo.attributes.position.needsUpdate = true; };
  return pts;
}

// wersja 2 (makieta Hologram 1 po uwagach): małe urządzenie, duża postać i duży panel statystyk; tryby różnią się zakłóceniami
const HOLO_MODES = {
  1: { base: .02, peak: .3, thr: 1.85, grain: .06, scan: .26, ghost: false, weak: false },   // czysty sygnał
  2: { base: .08, peak: 1, thr: 1.5, grain: .14, scan: .38, ghost: false, weak: false },     // lekkie zakłócenia
  3: { base: .45, peak: 1.7, thr: .9, grain: .4, scan: .5, ghost: true, weak: false },       // mocne zakłócenia, rozjechane kolory
  4: { base: .15, peak: 1.2, thr: 1.4, grain: .24, scan: .45, ghost: false, weak: true },    // słaby sygnał: obraz się buduje i gaśnie
};
function buildHolo(T, scene, camera, look, pid) {
  const M = HOLO_MODES[look] || HOLO_MODES[2], st = personStats(pid), color = 0x5fc8ff;
  scene.add(new T.AmbientLight(0xffffff, .55));
  const dl = new T.DirectionalLight(0xffffff, 1.1); dl.position.set(2, 4, 5); scene.add(dl);
  const pl = new T.PointLight(color, 2.5, 5); pl.position.set(0, .4, .7); scene.add(pl);
  const root = new T.Group(); scene.add(root);
  const dev = projector(T, .55, .14); root.add(dev.group);
  root.add(beam(T, .18, 1.15, 2.7, color, dev.top));
  const mats = [], ghosts = [];
  let photo;
  const tex = new T.TextureLoader().load(imgUrl(pid, 'normal'), t => {
    if (!photo) return;
    photo.scale.x = photo.scale.y * t.image.width / t.image.height;
    ghosts.forEach(g => g.scale.copy(photo.scale));
  });
  tex.colorSpace = T.SRGBColorSpace;
  const pm = holoMat(T, tex, { color, grain: M.grain, scan: M.scan }); mats.push(pm);
  photo = new T.Mesh(new T.PlaneGeometry(1, 1), pm); photo.scale.set(1.85, 2.35, 1); photo.position.set(-.15, dev.top + 1.32, 0); root.add(photo);
  if (M.ghost) for (const [c, dx] of [[0xff3a7a, -.035], [0x3affea, .035]]) {
    const gm = holoMat(T, tex, { color: c, grain: M.grain, scan: M.scan, opacity: .3 }); mats.push(gm);
    const g = new T.Mesh(new T.PlaneGeometry(1, 1), gm); g.scale.copy(photo.scale); g.position.copy(photo.position); g.userData.dx = dx; root.add(g); ghosts.push(g);
  }
  const sm = holoMat(T, statsTexture(T, st), { color, text: true, grain: M.grain * .6, scan: M.scan * .6, opacity: .95 }); mats.push(sm);
  const panel = new T.Mesh(new T.PlaneGeometry(1.3, 1.62), sm); panel.position.set(1.18, dev.top + 1.45, .3); panel.rotation.y = -.38; root.add(panel);
  const dust = motes(T, 80, .9, 2.7, dev.top, color); root.add(dust);
  root.position.x = -.28;
  camera.position.set(0, 1.55, 6.7); camera.lookAt(.12, 1.45, 0);
  let last = 0, drop = 0;
  return {
    update(t) {
      const dt = Math.min(.05, t - last); last = t;
      const glitch = (Math.sin(t * 1.3) + Math.sin(t * 3.1 + 1.7)) > M.thr ? M.peak : M.base;
      let opac = 1, build = 1;
      if (M.weak) {
        const cyc = t % 7;
        build = cyc < 1.3 ? cyc / 1.3 : 1;   // obraz rysuje się od dołu do góry
        if (drop <= 0 && Math.random() < .006) drop = .25 + Math.random() * .4;   // chwilowa utrata sygnału
        drop -= dt;
        opac = drop > 0 ? .08 : .6 + .4 * (.5 + .5 * Math.sin(t * 2.3));
      }
      for (const m of mats) { m.uniforms.time.value = t; m.uniforms.glitch.value = glitch; m.uniforms.build.value = build; }
      scene.traverse(o => { if (o.material?.uniforms?.time && !mats.includes(o.material)) o.material.uniforms.time.value = t; });
      pm.uniforms.opacity.value = opac; sm.uniforms.opacity.value = .95 * opac;
      photo.position.x = -.15 + (glitch > .9 ? (Math.random() - .5) * .07 : 0);
      ghosts.forEach(g => { g.material.uniforms.opacity.value = (glitch > .9 ? .55 : .18) * opac; g.position.x = photo.position.x + g.userData.dx * (glitch > .9 ? 3 : 1); });
      root.rotation.y = Math.sin(t * .3) * .22;
      dev.ring.material.color.setHSL(.55, 1, .65 + Math.sin(t * 3) * .12);
      dev.leds.forEach((l, i) => l.visible = Math.sin(t * 4 + i) > -.3);
      dust.userData.tick(dt);
    },
  };
}

// ================================================================ FRUTIGER AERO 3D

// bańka mydlana: przezroczysta, tęczowa obwódka (fresnel), biały odblask światła
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
const BUBBLE_VERT = `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const bubbleMat = (T, tint = 0x9fe8ff, glass = 0) => new T.ShaderMaterial({ uniforms: { time: { value: 0 }, tint: { value: new T.Color(tint) }, glass: { value: glass } }, vertexShader: BUBBLE_VERT, fragmentShader: BUBBLE_FRAG, transparent: true, depthWrite: false });

function stripeTexture(T, base, stripe, n = 3) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 256, 64);
  g.fillStyle = stripe; for (let i = 0; i < n; i++) { const x = 40 + i * 70; g.fillRect(x, 0, 16, 64); }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
// rybka: tułów z rozciągniętej kuli w paski, ogon i płetwy z trójkątów, czarne oko
function fish(T, base, stripe) {
  const g = new T.Group();
  const mat = new T.MeshStandardMaterial({ map: stripeTexture(T, base, stripe), roughness: .35, metalness: .05 });
  const body = new T.Mesh(new T.SphereGeometry(1, 28, 18), mat); body.scale.set(.32, .17, .1); g.add(body);
  const finMat = new T.MeshStandardMaterial({ color: stripe === '#ffffff' ? base : stripe, side: T.DoubleSide, roughness: .4, transparent: true, opacity: .92 });
  const tailShape = new T.Shape(); tailShape.moveTo(0, 0); tailShape.lineTo(-.22, .14); tailShape.lineTo(-.18, 0); tailShape.lineTo(-.22, -.14); tailShape.lineTo(0, 0);
  const tail = new T.Mesh(new T.ShapeGeometry(tailShape), finMat); tail.position.x = -.28; g.add(tail);
  const finShape = new T.Shape(); finShape.moveTo(-.12, 0); finShape.lineTo(0, .12); finShape.lineTo(.1, 0);
  const fin = new T.Mesh(new T.ShapeGeometry(finShape), finMat); fin.position.y = .14; g.add(fin);
  const eye = new T.Mesh(new T.SphereGeometry(.03, 10, 10), new T.MeshBasicMaterial({ color: 0x111111 })); eye.position.set(.2, .04, .07); g.add(eye);
  const eye2 = eye.clone(); eye2.position.z = -.07; g.add(eye2);
  g.userData.tail = tail;
  return g;
}
// mała planeta: trawiasta kula z drzewkami i domkiem, dookoła szklana atmosfera
function grassTexture(T, hue = 105) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = `hsl(${hue} 60% 42%)`; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 900; i++) { g.fillStyle = `hsl(${hue + (Math.random() * 30 - 15)} ${50 + Math.random() * 30}% ${32 + Math.random() * 25}%)`; g.fillRect(Math.random() * 256, Math.random() * 128, 3, 3); }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
function planet(T, r, hue) {
  const g = new T.Group();
  g.add(new T.Mesh(new T.SphereGeometry(r, 40, 28), new T.MeshStandardMaterial({ map: grassTexture(T, hue), roughness: .8 })));
  const trunk = new T.MeshStandardMaterial({ color: 0x6b4423, roughness: .8 }), leaf = new T.MeshStandardMaterial({ color: 0x1f8a3a, roughness: .6 });
  const up = new T.Vector3(0, 1, 0);
  for (let i = 0; i < 14; i++) {
    const n = new T.Vector3().randomDirection(), tree = new T.Group();
    const tr = new T.Mesh(new T.CylinderGeometry(r * .02, r * .025, r * .14, 6), trunk); tr.position.y = r * .07; tree.add(tr);
    const cr = new T.Mesh(new T.ConeGeometry(r * .08, r * .22, 8), leaf); cr.position.y = r * .2; tree.add(cr);
    tree.position.copy(n.clone().multiplyScalar(r * .98)); tree.quaternion.setFromUnitVectors(up, n); g.add(tree);
  }
  const house = new T.Group(), hn = new T.Vector3(0, 1, .3).normalize();
  const box = new T.Mesh(new T.BoxGeometry(r * .16, r * .12, r * .14), new T.MeshStandardMaterial({ color: 0xffffff })); box.position.y = r * .06; house.add(box);
  const roof = new T.Mesh(new T.ConeGeometry(r * .14, r * .1, 4), new T.MeshStandardMaterial({ color: 0xd64a3a })); roof.position.y = r * .17; roof.rotation.y = Math.PI / 4; house.add(roof);
  house.position.copy(hn.clone().multiplyScalar(r * .98)); house.quaternion.setFromUnitVectors(up, hn); g.add(house);
  const atm = new T.Mesh(new T.SphereGeometry(r * 1.32, 40, 28), bubbleMat(T, 0x8fd8ff, .15)); g.add(atm);
  return g;
}

function buildAero(T, scene, camera, look) {
  camera.position.set(0, 0, 6); camera.lookAt(0, 0, 0);
  scene.add(new T.HemisphereLight(0xcff6ff, 0x6fbf4a, 1.3));
  const dl = new T.DirectionalLight(0xffffff, 1.6); dl.position.set(-2, 4, 5); scene.add(dl);
  const mats = [], movers = [];
  // widoczny obszar przy z = 0: wysokość ~3,8, szerokość ~2,7 (karta pionowa)
  const H = 2 * 6 * Math.tan(17.5 * Math.PI / 180), W = H * .716;
  const addBubble = (r, tint, glass, x, y, z, speed) => {
    const m = bubbleMat(T, tint, glass); mats.push(m);
    const b = new T.Mesh(new T.SphereGeometry(r, 32, 24), m); b.position.set(x, y, z);
    b.userData = { speed, x0: x, ph: Math.random() * 6, r }; scene.add(b); movers.push(b); return b;
  };
  if (look === 1) {   // bańki mydlane unoszą się przez kartę
    for (let i = 0; i < 26; i++) addBubble(.07 + Math.random() * .3, 0x9fe8ff, 0, (Math.random() - .5) * W, (Math.random() - .5) * H, (Math.random() - .5) * 1.5, .15 + Math.random() * .3);
  } else if (look === 2) {   // akwarium: rybki krążą dookoła zdjęcia, bąbelki
    const kinds = [['#ff7a1a', '#ffffff'], ['#2a7de1', '#ffd23d'], ['#ffd23d', '#2a7de1'], ['#ff4fa0', '#ffffff'], ['#18c7c1', '#ffffff']];
    kinds.forEach(([a, b], k) => {
      const f = fish(T, a, b); f.userData = { fish: true, rx: 1.0 + Math.random() * .2, rz: 1.1, y: -1.55 + k * .78, sp: (.35 + Math.random() * .3) * (k % 2 ? -1 : 1), ph: k * 1.3 };
      f.scale.setScalar(.5 + Math.random() * .2); scene.add(f); movers.push(f);
    });
    for (let i = 0; i < 14; i++) addBubble(.03 + Math.random() * .07, 0xbff4ff, 0, (Math.random() - .5) * W, (Math.random() - .5) * H, (Math.random() - .5), .3 + Math.random() * .4);
  } else if (look === 3) {   // małe planety krążą wokół karty
    [[.24, 105, -1.05, 1.5], [.19, 90, 1.08, .35], [.22, 120, 1.0, -1.55]].forEach(([r, hue, x, y], k) => {
      const p = planet(T, r, hue); p.position.set(x, y, .3); p.userData = { planet: true, x0: x, y0: y, ph: k * 2 }; scene.add(p); movers.push(p);
    });
    for (let i = 0; i < 10; i++) addBubble(.04 + Math.random() * .1, 0x9fe8ff, 0, (Math.random() - .5) * W, (Math.random() - .5) * H, -.5, .12 + Math.random() * .2);
  } else {   // szklane kule w kolorze wody, powoli unoszą się i opadają
    [[.42, 0x2fd0ff, -.85, 1.2], [.28, 0x7cff6a, .95, 1.4], [.34, 0x2fd0ff, .9, -.35], [.22, 0xffffff, -.95, -.2], [.3, 0x7cff6a, -.7, -1.4], [.18, 0x2fd0ff, .6, -1.5]]
      .forEach(([r, tint, x, y]) => addBubble(r, tint, .55, x, y, .2, 0));
  }
  let last = 0;
  return {
    update(t) {
      const dt = Math.min(.05, t - last); last = t;
      for (const m of mats) m.uniforms.time.value = t;
      for (const o of movers) {
        const u = o.userData;
        if (u.fish) {
          const a = t * u.sp + u.ph, x = Math.cos(a) * u.rx * 1.2, z = Math.sin(a) * u.rz, y = u.y + Math.sin(t * .8 + u.ph) * .12;
          const nx = Math.cos(a + .05 * Math.sign(u.sp)) * u.rx * 1.2, nz = Math.sin(a + .05 * Math.sign(u.sp)) * u.rz;
          o.position.set(x, y, z); o.rotation.y = -Math.atan2(nz - z, nx - x); u.tail && (o.userData.tail.rotation.y = Math.sin(t * 9 + u.ph) * .5);
          o.children[1].rotation.y = Math.sin(t * 9 + u.ph) * .5;
        } else if (u.planet) {
          o.rotation.y = t * .3 + u.ph; o.rotation.x = .3;
          o.position.set(u.x0 + Math.sin(t * .4 + u.ph) * .12, u.y0 + Math.cos(t * .5 + u.ph) * .1, .3);
        } else if (u.speed) {
          o.position.y += u.speed * dt; o.position.x = u.x0 + Math.sin(t * 1.2 + u.ph) * .08;
          if (o.position.y > H / 2 + u.r) { o.position.y = -H / 2 - u.r; }
        } else {
          o.position.y += Math.sin(t * .8 + u.ph) * .002;
        }
      }
    },
  };
}

// ================================================================ FRUTIGER AERO 3D, wersja 2: rybki (mniej), jedna duża nieruchoma planeta z wieżowcami
// w rogu, szklane kule; looki różnią się rogiem planety, rozstawieniem kul i tłem (CSS)

// szklane okna wieżowca: niebieskie szkło, część okien zapalona
function cityTexture(T, seed) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, '#1b4a72'); grd.addColorStop(.5, '#3d86c0'); grd.addColorStop(1, '#173f62');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 128);
  let s = seed;
  const r = () => (s = s * 16807 % 2147483647) / 2147483647;
  for (let y = 4; y < 124; y += 9) for (let x = 5; x < 60; x += 14) { g.fillStyle = r() < .45 ? '#ffe7a0' : r() < .5 ? '#9fd8ff' : '#0f2a44'; g.fillRect(x, y, 9, 5); }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
// duża planeta: trawiasta kula, po stronie zwróconej do środka karty skupisko wieżowców, dookoła drzewka i szklana atmosfera
function cityPlanet(T, r, dir) {
  const g = new T.Group();
  g.add(new T.Mesh(new T.SphereGeometry(r, 56, 40), new T.MeshStandardMaterial({ map: grassTexture(T, 110), roughness: .8 })));
  const up = new T.Vector3(0, 1, 0);
  for (let i = 0; i < 13; i++) {
    const n = dir.clone().add(new T.Vector3().randomDirection().multiplyScalar(.42)).normalize();
    const h = r * (.22 + Math.random() * .55), w = r * (.07 + Math.random() * .06);
    const geo = new T.BoxGeometry(w, h, w); geo.translate(0, h / 2, 0);
    const tex = cityTexture(T, 7 + i * 31); tex.wrapT = T.RepeatWrapping; tex.repeat.set(1, h / (r * .4));
    const b = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex, roughness: .25, metalness: .2, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .55 }));
    b.position.copy(n.clone().multiplyScalar(r * .97)); b.quaternion.setFromUnitVectors(up, n); g.add(b);
  }
  const trunk = new T.MeshStandardMaterial({ color: 0x6b4423, roughness: .8 }), leaf = new T.MeshStandardMaterial({ color: 0x1f8a3a, roughness: .6 });
  for (let i = 0; i < 26; i++) {
    const n = new T.Vector3().randomDirection();
    if (n.dot(dir) > .8) continue;   // wieżowce mają swoje miejsce
    const tree = new T.Group();
    const tr = new T.Mesh(new T.CylinderGeometry(r * .015, r * .02, r * .1, 6), trunk); tr.position.y = r * .05; tree.add(tr);
    const cr = new T.Mesh(new T.SphereGeometry(r * .055, 10, 8), leaf); cr.position.y = r * .13; tree.add(cr);
    tree.position.copy(n.clone().multiplyScalar(r * .98)); tree.quaternion.setFromUnitVectors(up, n); g.add(tree);
  }
  g.add(new T.Mesh(new T.SphereGeometry(r * 1.18, 48, 32), bubbleMat(T, 0x8fd8ff, .12)));
  return g;
}
const AERO2 = {
  1: { planet: [-1.0, -1.6, .85], orbs: [[.34, 0x2fd0ff, .95, 1.5], [.22, 0x7cff6a, 1.05, .45], [.18, 0x2fd0ff, -.95, 1.6], [.15, 0xffffff, .2, 1.75]] },
  2: { planet: [1.0, 1.65, .85], orbs: [[.32, 0x2fd0ff, -.95, -1.5], [.22, 0x7cff6a, -1.05, -.5], [.18, 0x2fd0ff, .95, -1.65], [.15, 0xffffff, -.3, -1.8]] },
  3: { planet: [1.0, -1.6, .82], orbs: [[.3, 0x2fd0ff, -1.0, 1.45], [.2, 0x2fd0ff, -1.05, .2], [.24, 0x7cff6a, .95, 1.55]] },
  4: { planet: [-1.0, 1.65, .82], orbs: [[.3, 0x7cff6a, 1.0, -1.45], [.22, 0x2fd0ff, 1.05, -.2], [.18, 0x2fd0ff, -.95, -1.6]] },
};
function buildAero2(T, scene, camera, look) {
  const C = AERO2[look] || AERO2[1];
  camera.position.set(0, 0, 6); camera.lookAt(0, 0, 0);
  scene.add(new T.HemisphereLight(0xcff6ff, 0x6fbf4a, 1.3));
  const dl = new T.DirectionalLight(0xffffff, 1.6); dl.position.set(-2, 4, 5); scene.add(dl);
  const mats = [], orbs = [], fishes = [];
  const [px, py, pr] = C.planet;
  const dir = new T.Vector3(-px, -py, 2.2).normalize();
  const planetG = cityPlanet(T, pr, dir); planetG.position.set(px, py, 0); scene.add(planetG);
  planetG.traverse(o => o.material?.uniforms?.time && mats.push(o.material));
  C.orbs.forEach(([r, tint, x, y], k) => {
    const m = bubbleMat(T, tint, .55); mats.push(m);
    const b = new T.Mesh(new T.SphereGeometry(r, 36, 24), m); b.position.set(x, y, .4); b.userData = { y0: y, ph: k * 1.7 }; scene.add(b); orbs.push(b);
  });
  [['#ff7a1a', '#ffffff'], ['#2a7de1', '#ffd23d'], ['#18c7c1', '#ffffff']].forEach(([a, b], k) => {
    const f = fish(T, a, b); f.userData = { rx: 1.05, rz: 1.1, y: [-.9, .25, 1.15][k] * (py < 0 ? -1 : 1) * -1, sp: (.35 + k * .08) * (k % 2 ? -1 : 1), ph: k * 2.1 };
    f.scale.setScalar(.5 + k * .06); scene.add(f); fishes.push(f);
  });
  return {
    update(t) {
      for (const m of mats) m.uniforms.time.value = t;
      orbs.forEach(o => { o.position.y = o.userData.y0 + Math.sin(t * .7 + o.userData.ph) * .06; });
      fishes.forEach(o => {
        const u = o.userData, a = t * u.sp + u.ph, x = Math.cos(a) * u.rx * 1.2, z = Math.sin(a) * u.rz, y = u.y + Math.sin(t * .8 + u.ph) * .1;
        const nx = Math.cos(a + .05 * Math.sign(u.sp)) * u.rx * 1.2, nz = Math.sin(a + .05 * Math.sign(u.sp)) * u.rz;
        o.position.set(x, y, z); o.rotation.y = -Math.atan2(nz - z, nx - x); o.children[1].rotation.y = Math.sin(t * 9 + u.ph) * .5;
      });
    },
  };
}

// ================================================================ HOLOGRAM, wersja 3 (makieta „Lekkie zakłócenia”): tabliczka lekko po prawej i przed postacią,
// obracanie o 360° przeciąganiem (drag); bez dotyku hologram wraca do lekkiego kołysania
function buildHolo2(T, scene, camera, look, pid) {
  const M = HOLO_MODES[2], st = personStats(pid), color = 0x5fc8ff;
  scene.add(new T.AmbientLight(0xffffff, .55));
  const dl = new T.DirectionalLight(0xffffff, 1.1); dl.position.set(2, 4, 5); scene.add(dl);
  const pl = new T.PointLight(color, 2.5, 5); pl.position.set(0, .4, .7); scene.add(pl);
  const root = new T.Group(); scene.add(root);
  const dev = projector(T, .55, .14); root.add(dev.group);
  root.add(beam(T, .18, 1.15, 2.7, color, dev.top));
  const mats = [];
  let photo;
  const tex = new T.TextureLoader().load(imgUrl(pid, 'normal'), t => { if (photo) photo.scale.x = photo.scale.y * t.image.width / t.image.height; });
  tex.colorSpace = T.SRGBColorSpace;
  const pm = holoMat(T, tex, { color, grain: M.grain, scan: M.scan }); mats.push(pm);
  photo = new T.Mesh(new T.PlaneGeometry(1, 1), pm); photo.scale.set(1.85, 2.35, 1); photo.position.set(-.15, dev.top + 1.32, 0); root.add(photo);
  const sm = holoMat(T, statsTexture(T, st), { color, text: true, grain: M.grain * .6, scan: M.scan * .6, opacity: .95 }); mats.push(sm);
  let panel;
  if (look === 3) {   // wygięty ekran: wycinek walca przed postacią od prawej
    panel = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 1.5, 48, 1, true, .06 * Math.PI, .42 * Math.PI), sm);
    panel.position.set(-.15, dev.top + 1.25, 0);
  } else {
    panel = new T.Mesh(new T.PlaneGeometry(1.2, 1.5), sm);
    panel.position.set(.62, dev.top + 1.22, .55); panel.rotation.y = -.22;
  }
  root.add(panel);
  if (look === 2) {   // znaczek z wartością za postacią po lewej
    const cm = holoMat(T, statsTexture(T, ['WARTOŚĆ', `${st.val} GR`], 'chip'), { color, text: true, opacity: .9 }); mats.push(cm);
    const chip = new T.Mesh(new T.PlaneGeometry(.7, .35), cm); chip.position.set(-1.0, dev.top + 1.9, -.45); chip.rotation.y = .4; root.add(chip);
  }
  let ray;
  if (look === 4) {   // promień od urządzenia do tabliczki
    const a = new T.Vector3(.35, dev.top, .2), b = new T.Vector3(.62, dev.top + .47, .55), len = a.distanceTo(b);
    ray = new T.Mesh(new T.CylinderGeometry(.012, .012, len, 6, 1, true), new T.MeshBasicMaterial({ color, transparent: true, opacity: .7, blending: T.AdditiveBlending, depthWrite: false }));
    ray.position.copy(a.clone().add(b).multiplyScalar(.5)); ray.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize()); root.add(ray);
  }
  const dust = motes(T, 80, .9, 2.7, dev.top, color); root.add(dust);
  root.position.x = -.2;
  camera.position.set(0, 1.55, 6.7); camera.lookAt(.12, 1.45, 0);
  let last = 0, rot = 0, vel = 0, lastDrag = -1e9;
  return {
    drag(dx) { vel = dx * .01; rot += vel; lastDrag = performance.now(); },
    update(t) {
      const dt = Math.min(.05, t - last); last = t;
      const glitch = (Math.sin(t * 1.3) + Math.sin(t * 3.1 + 1.7)) > M.thr ? M.peak : M.base;
      for (const m of mats) { m.uniforms.time.value = t; m.uniforms.glitch.value = glitch; }
      scene.traverse(o => { if (o.material?.uniforms?.time && !mats.includes(o.material)) o.material.uniforms.time.value = t; });
      photo.position.x = -.15 + (glitch > .9 ? (Math.random() - .5) * .06 : 0);
      if (look === 4) { panel.position.y = dev.top + 1.22 + Math.sin(t * 1.1) * .05; }
      // obracanie: bezwładność po puszczeniu, po 2,5 s bez dotyku powrót do kołysania (do najbliższego pełnego obrotu)
      if (performance.now() - lastDrag < 2500) { rot += vel; vel *= .92; }
      else { const target = Math.sin(t * .3) * .22, k = Math.round((rot - target) / (Math.PI * 2)); rot += (target + k * Math.PI * 2 - rot) * .03; }
      root.rotation.y = rot;
      dev.ring.material.color.setHSL(.55, 1, .65 + Math.sin(t * 3) * .12);
      dev.leds.forEach((l, i) => l.visible = Math.sin(t * 4 + i) > -.3);
      dust.userData.tick(dt);
    },
  };
}

// ================================================================ FRUTIGER AERO 3D, wersja 3: planeta w tle (osobne płótno pod zdjęciem i panelami, data-layer="back"),
// rybki i szklane kule nad kartą (data-layer="front")
const AERO3 = {
  1: { planet: [-.7, -1.05, 1.2], orbs: [[.3, 0x2fd0ff, 1.05, 1.55], [.2, 0x7cff6a, 1.1, .6], [.16, 0xffffff, 1.0, -.35], [.24, 0x2fd0ff, -1.05, 1.6]] },
  2: { planet: [.75, 1.45, 1.1], orbs: [[.3, 0x2fd0ff, -1.05, -1.5], [.2, 0x7cff6a, -1.1, -.5], [.18, 0xffffff, -1.0, .5], [.22, 0x2fd0ff, 1.0, -1.6]] },
  3: { planet: [0, -2.15, 1.85], up: true, orbs: [[.3, 0x2fd0ff, -1.0, 1.55], [.22, 0x7cff6a, 1.05, 1.4], [.16, 0xffffff, 0, 1.75]] },
  5: { planet: [0, -1.95, 1.35], up: true, orbs: [[.3, 0x2fd0ff, -1.0, 1.55], [.22, 0x7cff6a, 1.05, 1.4], [.16, 0xffffff, 0, 1.75]] },
  4: { planet: [-.75, 1.45, 1.1], orbs: [[.28, 0x2fd0ff, 1.05, .9], [.2, 0x7cff6a, 1.0, -.6], [.24, 0x2fd0ff, -1.0, -1.55], [.16, 0xffffff, .9, -1.7]] },
};
function buildAero3(T, scene, camera, look, pid, layer) {
  const C = AERO3[look] || AERO3[1];
  camera.position.set(0, 0, 6); camera.lookAt(0, 0, 0);
  scene.add(new T.HemisphereLight(0xcff6ff, 0x6fbf4a, 1.3));
  const dl = new T.DirectionalLight(0xffffff, 1.6); dl.position.set(-2, 4, 5); scene.add(dl);
  const mats = [];
  if (layer === 'back') {
    const [px, py, pr] = C.planet;
    const dir = C.up ? new T.Vector3(0, 1, .9).normalize() : new T.Vector3(-px, -py, 2.2).normalize();
    const g = cityPlanet(T, pr, dir); g.position.set(px, py, 0); scene.add(g);
    g.traverse(o => o.material?.uniforms?.time && mats.push(o.material));
    return { update(t) { for (const m of mats) m.uniforms.time.value = t; } };
  }
  const orbs = [], fishes = [];
  C.orbs.forEach(([r, tint, x, y], k) => {
    const m = bubbleMat(T, tint, .55); mats.push(m);
    const b = new T.Mesh(new T.SphereGeometry(r, 36, 24), m); b.position.set(x, y, .4); b.userData = { y0: y, ph: k * 1.7 }; scene.add(b); orbs.push(b);
  });
  [['#ff7a1a', '#ffffff'], ['#2a7de1', '#ffd23d'], ['#18c7c1', '#ffffff']].forEach(([a, b], k) => {
    const f = fish(T, a, b); f.userData = { rx: 1.05, rz: 1.1, y: [-1.2, .1, 1.1][k], sp: (.35 + k * .08) * (k % 2 ? -1 : 1), ph: k * 2.1 };
    f.scale.setScalar(.5 + k * .06); scene.add(f); fishes.push(f);
  });
  return {
    update(t) {
      for (const m of mats) m.uniforms.time.value = t;
      orbs.forEach(o => { o.position.y = o.userData.y0 + Math.sin(t * .7 + o.userData.ph) * .06; });
      fishes.forEach(o => {
        const u = o.userData, a = t * u.sp + u.ph, x = Math.cos(a) * u.rx * 1.2, z = Math.sin(a) * u.rz, y = u.y + Math.sin(t * .8 + u.ph) * .1;
        const nx = Math.cos(a + .05 * Math.sign(u.sp)) * u.rx * 1.2, nz = Math.sin(a + .05 * Math.sign(u.sp)) * u.rz;
        o.position.set(x, y, z); o.rotation.y = -Math.atan2(nz - z, nx - x); o.children[1].rotation.y = Math.sin(t * 9 + u.ph) * .5;
      });
    },
  };
}

// ================================================================ HOLOGRAM, wersja 4: sposoby pokazania statystyk przy obracaniu o 360° (looki 1-6, kind „holo3”)
// tabliczka z linijkami tekstu (tytuł + pary etykieta / wartość)
function linesTexture(T, title, rows, w = 512, h = 300) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 4;
  g.strokeRect(6, 6, w - 12, h - 12); g.fillRect(6, 6, 90, 8); g.fillRect(w - 96, h - 14, 90, 8);
  g.font = '800 42px Consolas, monospace'; g.fillText(String(title).slice(0, 20), 26, 62);
  g.fillRect(26, 78, w - 52, 3);
  let y = 124;
  for (const [k, v] of rows) { g.font = '600 30px Consolas, monospace'; g.fillText(String(k).slice(0, 16), 26, y); g.font = '800 34px Consolas, monospace'; const s = String(v).slice(0, 14); g.fillText(s, w - 26 - g.measureText(s).width, y); y += 50; }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
// płaski pierścień z UV biegunowym (u = kąt, v = promień) - tekst biegnie dookoła
function polarRing(T, r0, r1, seg = 128) {
  const geo = new T.RingGeometry(r0, r1, seg, 1), pos = geo.attributes.position, uv = geo.attributes.uv, v = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    uv.setXY(i, (Math.atan2(v.y, v.x) / (Math.PI * 2) + 1) % 1, (v.length() - r0) / (r1 - r0));
  }
  return geo;
}
// pionowa kolumna danych (do przewijania)
function columnTexture(T, st) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 1024;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.textAlign = 'center';
  const items = [st.name, `HP ${st.hp}`, ...st.ab.map(a => `${a.name} ${a.value}`), `${st.val} GR`, st.rar];
  let y = 40;
  while (y < 1024) for (const it of items) { if (y > 1010) break; g.font = '700 22px Consolas, monospace'; for (const w of String(it).toUpperCase().split(' ').slice(0, 3)) { g.fillText(w.slice(0, 9), 64, y); y += 28; } g.fillRect(24, y - 12, 80, 2); y += 22; }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapT = T.RepeatWrapping; return t;
}

function buildHolo3(T, scene, camera, look, pid) {
  const M = HOLO_MODES[2], st = personStats(pid), color = 0x5fc8ff;
  scene.add(new T.AmbientLight(0xffffff, .55));
  const dl = new T.DirectionalLight(0xffffff, 1.1); dl.position.set(2, 4, 5); scene.add(dl);
  const pl = new T.PointLight(color, 2.5, 5); pl.position.set(0, .4, .7); scene.add(pl);
  const root = new T.Group(); scene.add(root);
  const dev = projector(T, .55, .14); root.add(dev.group);
  root.add(beam(T, .18, 1.15, 2.7, color, dev.top));
  const mats = [], txt = o => { const m = holoMat(T, o.map, { color, text: true, grain: M.grain * .6, scan: M.scan * .6, opacity: o.opacity ?? .95 }); if (o.front) m.side = T.FrontSide; mats.push(m); return m; };
  let photo;
  const tex = new T.TextureLoader().load(imgUrl(pid, 'normal'), t => { if (photo) photo.scale.x = photo.scale.y * t.image.width / t.image.height; });
  tex.colorSpace = T.SRGBColorSpace;
  const pm = holoMat(T, tex, { color, grain: M.grain, scan: M.scan }); mats.push(pm);
  const py = dev.top + 1.32;
  photo = new T.Mesh(new T.PlaneGeometry(1, 1), pm); photo.scale.set(1.85, 2.35, 1); photo.position.set(-.15, py, 0); root.add(photo);
  const spin = [], bill = [];
  let scroll = null;
  if (look === 1) {   // wygięty ekran (wersja 3 z poprzednich makiet)
    const panel = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 1.5, 48, 1, true, .06 * Math.PI, .42 * Math.PI), txt({ map: statsTexture(T, st) }));
    panel.position.set(-.15, dev.top + 1.25, 0); root.add(panel);
  } else if (look === 2) {   // cztery znaczki krążą wokół głowy
    const items = [['HP', st.hp], ['ATAK', st.ab[0]?.value ?? '-'], ['WARTOŚĆ', `${st.val}`], ['RZADKOŚĆ', st.rar]];
    items.forEach((it, k) => { const ch = new T.Mesh(new T.PlaneGeometry(.66, .33), txt({ map: statsTexture(T, it, 'chip') })); ch.userData.a = k / items.length * Math.PI * 2; root.add(ch); spin.push(ch); });
  } else if (look === 3) {   // statystyki z tyłu hologramu: obróć, żeby je zobaczyć
    pm.side = T.FrontSide;
    const back = new T.Mesh(new T.PlaneGeometry(1.85, 2.35), txt({ map: statsTexture(T, st), front: true }));
    back.position.set(-.15, py, -.02); back.rotation.y = Math.PI; root.add(back);
    const hint = new T.Mesh(new T.PlaneGeometry(1.2, .22), txt({ map: linesTexture(T, '↻ OBRÓĆ', [], 512, 96), opacity: .7 }));
    hint.position.set(-.15, dev.top + .2, .7); root.add(hint);
  } else if (look === 4) {   // trzy tabliczki jedna przed drugą (paralaksa przy obracaniu)
    const ab = st.ab[0];
    [[st.name, [['RZADKOŚĆ', st.rar]]], ['STATYSTYKI', [['HP', st.hp], [ab?.name || 'ATAK', ab?.value ?? '-']]], ['WARTOŚĆ', [['GROSZE', st.val]]]].forEach(([title, rows], k) => {
      const p = new T.Mesh(new T.PlaneGeometry(1.0, .58), txt({ map: linesTexture(T, title, rows) }));
      p.position.set(.75 + k * .08, dev.top + 2.05 - k * .62, .3 + k * .32); p.rotation.y = -.25; root.add(p);
    });
  } else if (look === 5) {   // pierścień tekstu na podłodze wokół urządzenia + nazwa nad głową
    const sTex = statsTexture(T, st, 'strip'); sTex.wrapS = T.RepeatWrapping;
    const ring = new T.Mesh(polarRing(T, .75, 1.2), txt({ map: sTex, opacity: .9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = dev.top + .01; root.add(ring); spin.push(ring); ring.userData.floor = true;
    const nm = new T.Mesh(new T.PlaneGeometry(2.0, .32), txt({ map: linesTexture(T, st.name, [], 768, 110) }));
    nm.position.set(-.15, py + 1.38, 0); root.add(nm);
  } else {   // przewijana kolumna danych z lewej + krótka tabliczka z prawej
    const cTex = columnTexture(T, st); cTex.repeat.set(1, .45);
    const col = new T.Mesh(new T.PlaneGeometry(.5, 2.4), txt({ map: cTex, opacity: .9 }));
    col.position.set(-1.35, py, .25); col.rotation.y = .3; root.add(col); scroll = cTex;
    const small = new T.Mesh(new T.PlaneGeometry(.8, .4), txt({ map: statsTexture(T, ['HP', st.hp], 'chip') }));
    small.position.set(.75, py + .7, .5); small.rotation.y = -.25; root.add(small);
  }
  const dust = motes(T, 80, .9, 2.7, dev.top, color); root.add(dust);
  root.position.x = -.12;
  camera.position.set(0, 1.6, 6.9); camera.lookAt(.05, 1.45, 0);
  let last = 0, rot = 0, vel = 0, lastDrag = -1e9;
  return {
    drag(dx) { vel = dx * .01; rot += vel; lastDrag = performance.now(); },
    update(t) {
      const dt = Math.min(.05, t - last); last = t;
      const glitch = (Math.sin(t * 1.3) + Math.sin(t * 3.1 + 1.7)) > M.thr ? M.peak : M.base;
      for (const m of mats) { m.uniforms.time.value = t; m.uniforms.glitch.value = glitch; }
      scene.traverse(o => { if (o.material?.uniforms?.time && !mats.includes(o.material)) o.material.uniforms.time.value = t; });
      photo.position.x = -.15 + (glitch > .9 ? (Math.random() - .5) * .06 : 0);
      if (performance.now() - lastDrag < 2500) { rot += vel; vel *= .92; }
      else { const target = Math.sin(t * .3) * .22, k = Math.round((rot - target) / (Math.PI * 2)); rot += (target + k * Math.PI * 2 - rot) * .03; }
      root.rotation.y = rot;
      spin.forEach(o => {
        if (o.userData.floor) { o.rotation.z = t * .25; return; }
        const a = o.userData.a + t * .45;
        o.position.set(-.15 + Math.cos(a) * 1.25, py + .75 + Math.sin(t + o.userData.a) * .05, Math.sin(a) * 1.25);
        o.quaternion.copy(camera.quaternion);   // zawsze przodem do widza
        o.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -rot));
      });
      if (scroll) scroll.offset.y = (scroll.offset.y + dt * .06) % 1;
      dev.ring.material.color.setHSL(.55, 1, .65 + Math.sin(t * 3) * .12);
      dev.leds.forEach((l, i) => l.visible = Math.sin(t * 4 + i) > -.3);
      dust.userData.tick(dt);
    },
  };
}
