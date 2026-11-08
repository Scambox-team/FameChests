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
  const sc = (kind === 'holo' ? buildHolo : buildAero)(T, scene, camera, look, pid);
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
uniform sampler2D map; uniform float time, glitch, grain, opacity, radial, useAlpha, scanK; uniform vec3 color; varying vec2 vUv;
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
  gl_FragColor = vec4(color * (0.5 + l * 0.95) + g * 0.15, a);
}`;
const holoMat = (T, tex, o = {}) => new T.ShaderMaterial({
  uniforms: { map: { value: tex }, time: { value: 0 }, glitch: { value: 0 }, color: { value: new T.Color(o.color ?? 0x5fc8ff) }, grain: { value: o.grain ?? .14 },
    opacity: { value: o.opacity ?? 1 }, radial: { value: o.radial ? 1 : 0 }, useAlpha: { value: o.text ? 1 : 0 }, scanK: { value: o.scan ?? .38 } },
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

function buildHolo(T, scene, camera, look, pid) {
  const st = personStats(pid);
  const color = look === 3 ? 0x4aa8ff : 0x5fc8ff;
  scene.add(new T.AmbientLight(0xffffff, .55));
  const dl = new T.DirectionalLight(0xffffff, 1.1); dl.position.set(2, 4, 5); scene.add(dl);
  const pl = new T.PointLight(color, 3, 6); pl.position.set(0, .5, .8); scene.add(pl);
  const root = new T.Group(); scene.add(root);
  const mats = [];
  const photoTex = new T.TextureLoader().load(imgUrl(pid, 'normal'), t => {
    const a = t.image.width / t.image.height;
    if (photo) photo.scale.x = photo.scale.y * a * (look === 2 ? 1.25 : 1);
  });
  photoTex.colorSpace = T.SRGBColorSpace;
  let photo, dev, extra = [], ring, chips = [];
  const pm = holoMat(T, photoTex, { color, grain: look === 3 ? .5 : .14, radial: look === 2, scan: look === 3 ? .55 : .38 });
  mats.push(pm);
  if (look === 1) {   // projektor stołowy: postać + panel statystyk obok, całość powoli się obraca
    dev = projector(T, 1, .22); root.add(dev.group);
    root.add(beam(T, .35, 1.0, 2.3, color, dev.top));
    photo = new T.Mesh(new T.PlaneGeometry(1, 1), pm); photo.scale.set(1.5, 1.9, 1); photo.position.set(0, dev.top + 1.1, 0); root.add(photo);
    const sm = holoMat(T, statsTexture(T, st), { color, text: true, opacity: .95 }); mats.push(sm);
    const panel = new T.Mesh(new T.PlaneGeometry(1.05, 1.31), sm); panel.position.set(1.15, dev.top + 1.25, .25); panel.rotation.y = -.45; root.add(panel);
    root.position.x = -.35;
    camera.position.set(0, 1.9, 7.4); camera.lookAt(0, 1.25, 0);
  } else if (look === 2) {   // popiersie w kole, dookoła obraca się pierścień z napisami
    dev = projector(T, .85, .2); root.add(dev.group);
    root.add(beam(T, .3, .9, 2.1, color, dev.top));
    photo = new T.Mesh(new T.PlaneGeometry(1, 1), pm); photo.scale.set(1.7, 1.7, 1); photo.position.set(0, dev.top + 1.25, 0); root.add(photo);
    const tex = statsTexture(T, st, 'strip'); tex.wrapS = T.RepeatWrapping; tex.repeat.x = 1;
    const rm = holoMat(T, tex, { color, text: true, opacity: .9, scan: .2 }); mats.push(rm);
    ring = new T.Mesh(new T.CylinderGeometry(1.1, 1.1, .22, 96, 1, true), rm); ring.position.y = dev.top + .55; root.add(ring);
    const ring2 = new T.Mesh(new T.TorusGeometry(1.1, .006, 6, 128), new T.MeshBasicMaterial({ color, transparent: true, opacity: .7, blending: T.AdditiveBlending }));
    ring2.rotation.x = Math.PI / 2; ring2.position.y = dev.top + 2.0; root.add(ring2); extra.push(ring2);
    camera.position.set(0, 2.3, 6.6); camera.lookAt(0, 1.2, 0);
  } else if (look === 3) {   // wiadomość z daleka: smukły nadajnik, drobna ziarnista postać, mocne zakłócenia
    dev = projector(T, .55, .55, true); root.add(dev.group);
    root.add(beam(T, .12, .7, 2.2, color, dev.top));
    photo = new T.Mesh(new T.PlaneGeometry(1, 1), pm); photo.scale.set(1.25, 1.65, 1); photo.position.set(0, dev.top + 1.15, 0); root.add(photo);
    const sm = holoMat(T, statsTexture(T, st), { color, text: true, opacity: .8, grain: .4 }); mats.push(sm);
    const panel = new T.Mesh(new T.PlaneGeometry(.75, .94), sm); panel.position.set(.95, dev.top + .7, .1); panel.rotation.y = -.3; root.add(panel);
    camera.position.set(0, 1.7, 6.2); camera.lookAt(.2, 1.3, 0);
  } else {   // stół taktyczny: szeroki dysk z siatką, postać w środku, trzy panele krążą dookoła
    dev = projector(T, 1.5, .15); root.add(dev.group);
    for (let i = 1; i <= 4; i++) {
      const rg = new T.Mesh(new T.RingGeometry(i * .32, i * .32 + .008, 96), new T.MeshBasicMaterial({ color, transparent: true, opacity: .55, blending: T.AdditiveBlending, side: T.DoubleSide }));
      rg.rotation.x = -Math.PI / 2; rg.position.y = dev.top + .01; root.add(rg);
    }
    root.add(beam(T, .3, .85, 2.0, color, dev.top));
    photo = new T.Mesh(new T.PlaneGeometry(1, 1), pm); photo.scale.set(1.25, 1.6, 1); photo.position.set(0, dev.top + 1.0, 0); root.add(photo);
    const items = [['HP', st.hp], ['ATAK', st.ab[0]?.value ?? '-'], ['WARTOŚĆ', `${st.val}`]];
    chips = items.map((it, k) => {
      const m = holoMat(T, statsTexture(T, it, 'chip'), { color, text: true, opacity: .95 }); mats.push(m);
      const ch = new T.Mesh(new T.PlaneGeometry(.62, .31), m); ch.userData.a = k / items.length * Math.PI * 2; root.add(ch); return ch;
    });
    camera.position.set(0, 2.9, 6.6); camera.lookAt(0, 1.0, 0);
  }
  const dust = motes(T, 70, .7, 2.2, dev.top, color); root.add(dust);
  let last = 0;
  return {
    update(t) {
      const dt = Math.min(.05, t - last); last = t;
      const glitch = (Math.sin(t * 1.3) + Math.sin(t * 3.1 + 1.7)) > (look === 3 ? 1.1 : 1.55) ? 1 : (look === 3 ? .35 : .08);
      for (const m of mats) { m.uniforms.time.value = t; m.uniforms.glitch.value = glitch; }
      scene.traverse(o => { if (o.material?.uniforms?.time && !mats.includes(o.material)) o.material.uniforms.time.value = t; });
      if (look === 1) root.rotation.y = Math.sin(t * .35) * .35;
      if (look === 2) { ring.rotation.y = t * .5; photo.position.y = dev.top + 1.25 + Math.sin(t * 1.2) * .03; }
      if (look === 3) photo.position.x = glitch > .5 ? (Math.random() - .5) * .05 : 0;
      if (look === 4) chips.forEach(ch => { const a = ch.userData.a + t * .4; ch.position.set(Math.cos(a) * 1.15, dev.top + 1.45 + Math.sin(t + ch.userData.a) * .06, Math.sin(a) * 1.15); ch.lookAt(camera.position); });
      if (look !== 2 && look !== 4) photo.lookAt(camera.position.x, photo.position.y + root.position.y, camera.position.z);
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
