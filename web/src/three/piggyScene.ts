// Skarbonka 3D (features/quests/Piggy.tsx, zakładka Questy i kafelek na stronie startowej): porcelanowa świnka na aksamitnej
// poduszce. Tyje razem z postępem wspólnego celu (`fill` 0..1, pełna jest wyraźnie pulchna: grubszy brzuch, policzki, nogi
// rozstawione), trzęsie się jak galareta po kliknięciu (`poke`: ugięcie od kopytek + kołysanie), łapie monety wpadające przez
// szczelinę (`coin`), pęka (`crack` 0..1 rysuje coraz więcej pęknięć na teksturze) i w końcu wybucha skorupami, a z góry
// sypie się deszcz monet i banknotów, które zostają na poduszce (`burst`). Tło przezroczyste, światło z sceneTheme(). Ładować
// tylko dynamicznym import() po sprawdzeniu use3D(); bez WebGL Piggy.tsx rysuje płaską świnkę w SVG.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import pigUrl from './models/pig.glb?url';
import bankUrl from './models/piggybank.glb?url';
import { sceneTheme } from './sceneTheme';

export type PiggyState = { fill: number; crack: number; broken: boolean };
export type PiggyScene = {
  set(s: PiggyState): void;
  poke(): void;
  coin(): void;
  burst(): void;
  dispose(): void;
};

const PINK = '#f4a3bf';
const FLOOR = -1.1;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// powtarzalny generator (pęknięcia rysują się zawsze w tych samych miejscach)
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }

/** Tekstura porcelany z pęknięciami: `level` 0..1 = ile z przygotowanych pęknięć widać (skupione od frontu po stronę widza) */
function crackTexture(overlay = false) {
  const W = 1024, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const r = rng(2137);
  const cracks: { pts: [number, number][]; kids: [number, number][][] }[] = [];
  for (let i = 0; i < 30; i++) {
    let x = (0.55 + r() * 0.45) * W, y = (0.25 + r() * 0.5) * H, a = r() * Math.PI * 2;
    const pts: [number, number][] = [[x, y]], kids: [number, number][][] = [];
    const n = 5 + Math.floor(r() * 8);
    for (let k = 0; k < n; k++) {
      a += (r() - 0.5) * 1.1;
      x += Math.cos(a) * (14 + r() * 26); y += Math.sin(a) * (10 + r() * 18);
      pts.push([x, y]);
      if (r() < 0.38) {
        let bx = x, by = y, ba = a + (r() < 0.5 ? 1 : -1) * (0.6 + r() * 0.8);
        const kid: [number, number][] = [[bx, by]];
        for (let j = 0; j < 3; j++) { ba += (r() - 0.5) * 0.8; bx += Math.cos(ba) * (8 + r() * 14); by += Math.sin(ba) * (6 + r() * 10); kid.push([bx, by]); }
        kids.push(kid);
      }
    }
    cracks.push({ pts, kids });
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  let shown = -1;
  const line = (pts: [number, number][], w: number, col: string) => {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
  };
  function draw(level: number) {
    const count = Math.round(Math.max(0, Math.min(1, level)) * cracks.length);
    if (count === shown) return;
    shown = count;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#ffd9e6'); g.addColorStop(0.5, PINK); g.addColorStop(1, '#d97b9c');
    if (overlay) ctx.clearRect(0, 0, W, H);
    else {
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // szkliwo: drobne jasne kropki
      ctx.fillStyle = 'rgba(255,255,255,.16)';
      const d = rng(77);
      for (let i = 0; i < 300; i++) { ctx.beginPath(); ctx.arc(d() * W, d() * H, 1 + d() * 2.5, 0, Math.PI * 2); ctx.fill(); }
    }
    for (let i = 0; i < count; i++) {
      const { pts, kids } = cracks[i];
      line(pts, 6, 'rgba(255,244,248,.6)');              // jasna krawędź
      line(pts, 2.8, '#4a1527');                         // szczelina
      kids.forEach(k => { line(k, 3.4, 'rgba(255,244,248,.5)'); line(k, 1.7, '#5a2036'); });
    }
    tex.needsUpdate = true;
  }
  draw(0);
  return { tex, draw };
}

/** Tekstura banknotu (kolor, obwódka, medalion) */
function noteTexture(color: string) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f4f0e4'; x.fillRect(0, 0, 128, 64);
  x.strokeStyle = color; x.lineWidth = 4; x.strokeRect(3, 3, 122, 58);
  x.fillStyle = color; x.globalAlpha = 0.85;
  x.beginPath(); x.arc(64, 32, 19, 0, Math.PI * 2); x.fill();
  x.globalAlpha = 1; x.fillStyle = '#f4f0e4'; x.beginPath(); x.arc(64, 32, 11, 0, Math.PI * 2); x.fill();
  x.fillStyle = color; x.fillRect(10, 10, 22, 8); x.fillRect(96, 46, 22, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createPiggyScene(canvas: HTMLCanvasElement): PiggyScene {
  const th = sceneTheme();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = th.exposure * 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const look = new THREE.Vector3(0, 0.15, 0);

  scene.add(new THREE.HemisphereLight('#fff4f8', '#7a4a62', 1.5));
  const key = new THREE.DirectionalLight(th.key.color, th.key.intensity * 1.25);
  key.position.set(3.5, 5.5, 4.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ffc8e0', th.rim.intensity * 0.6);
  rim.position.set(-4, 2.5, -3.5);
  scene.add(rim);
  const flash = new THREE.PointLight('#ffe2a0', 0, 14, 1.4);
  flash.position.set(0, 1.2, 2.4);
  scene.add(flash);

  // ---------- poduszka pod świnką
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.4, 0.18, 72), new THREE.MeshStandardMaterial({ color: '#5b2746', roughness: 0.85 }));
  plinth.position.y = FLOOR - 0.09;
  scene.add(plinth);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.045, 10, 96), new THREE.MeshStandardMaterial({ color: th.metal, metalness: 0.9, roughness: 0.3 }));
  trim.rotation.x = Math.PI / 2; trim.position.y = FLOOR - 0.01;
  scene.add(trim);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.7, 48), new THREE.MeshBasicMaterial({ color: '#1a0612', transparent: true, opacity: 0.38 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = FLOOR + 0.004;
  scene.add(shadow);

  // ---------- świnka (początek układu = stopy; pozycje części liczy `layout`)
  const pig = new THREE.Group();
  pig.position.y = FLOOR;
  scene.add(pig);
  const crack = crackTexture();
  const porcelain = new THREE.MeshPhysicalMaterial({ map: crack.tex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new THREE.Color('#ffd0e0') });
  const plain = new THREE.MeshPhysicalMaterial({ color: PINK, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.15 });
  const deep = new THREE.MeshPhysicalMaterial({ color: '#e98cad', roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.18 });
  const inner = new THREE.MeshStandardMaterial({ color: '#ffb6cf', roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: '#3a1422', roughness: 0.55 });
  const hoof = new THREE.MeshPhysicalMaterial({ color: '#b5577c', roughness: 0.35, clearcoat: 0.8 });
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: '#120d12', roughness: 0.1, clearcoat: 1 });
  const white = new THREE.MeshStandardMaterial({ color: '#fffafc', roughness: 0.25 });
  const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const blush = new THREE.MeshBasicMaterial({ color: '#ff6f9f', transparent: true, opacity: 0.45, depthWrite: false });
  const gold = new THREE.MeshStandardMaterial({ color: th.metal, metalness: 0.65, roughness: 0.3, emissive: th.metal, emissiveIntensity: 0.3 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 48), porcelain);
  pig.add(body);

  // pierwotny model: kula z doklejonym ryjkiem, oczami, uszami-stożkami, walcowymi nogami i ogonkiem z torusa
  body.rotation.y = -Math.PI / 2;
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.3, 40), plain);
  snout.rotation.z = Math.PI / 2;
  pig.add(snout);
  const nostrils = [-1, 1].map(s => {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), dark);
    n.scale.set(0.5, 1.3, 1);
    n.userData.s = s;
    pig.add(n);
    return n;
  });
  const eyes = [-1, 1].map(s => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), eyeMat);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), shine);
    glint.position.set(0.05, 0.03, 0.02);
    e.add(glint);
    e.userData.s = s;
    pig.add(e);
    return e;
  });
  const ears = [-1, 1].map(s => {
    const e = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.42, 24), plain);
    e.userData.s = s;
    pig.add(e);
    return e;
  });
  const legs = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([fx, fz]) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 24), plain);
    l.userData.f = [fx, fz];
    pig.add(l);
    return l;
  });
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 10, 32, Math.PI * 1.7), plain);
  pig.add(tail);

  // szczelina na monety (czarna) i moneta tkwiąca w niej, gdy świnka jest pełna
  const slotMat = new THREE.MeshStandardMaterial({ color: '#050204', roughness: 0.7 });
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.17), slotMat);
  pig.add(slot);
  const stuck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 28), gold);
  stuck.rotation.x = Math.PI / 2;
  pig.add(stuck);
  const procedural = pig.children.filter(c => c !== slot && c !== stuck);   // model proceduralny: zapas, gdy plik się nie wczyta

  // ---------- monety, skorupy, banknoty
  const coinGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.04, 28);
  const rimGeo = new THREE.TorusGeometry(0.155, 0.016, 8, 28);
  const coinMat = new THREE.MeshStandardMaterial({ color: th.metal, metalness: 0.65, roughness: 0.32, emissive: th.metal, emissiveIntensity: 0.32 });
  const coinMat2 = new THREE.MeshStandardMaterial({ color: '#e8eef4', metalness: 0.6, roughness: 0.35, emissive: '#c8d0da', emissiveIntensity: 0.3 });
  const shardGeo = new THREE.TetrahedronGeometry(0.17);
  const noteGeo = new THREE.PlaneGeometry(0.5, 0.25);
  const noteTex = ['#4f7fc0', '#5f8f55', '#c8923a', '#b3325a'].map(noteTexture);
  const noteMats = noteTex.map(t => new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.8 }));
  type Bit = { m: THREE.Object3D; v: THREE.Vector3; w: THREE.Vector3; life: number; kind: 'coin' | 'shard' | 'note' | 'drop'; rest: boolean };
  const bits: Bit[] = [];
  function spawn(kind: Bit['kind'], pos: THREE.Vector3, vel: THREE.Vector3) {
    let m: THREE.Object3D;
    if (kind === 'shard') { const s = new THREE.Mesh(shardGeo, Math.random() < 0.4 ? porcelain : plain); s.scale.setScalar(0.5 + Math.random() * 1.3); m = s; }
    else if (kind === 'note') m = new THREE.Mesh(noteGeo, noteMats[Math.floor(Math.random() * 4)]);
    else {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(coinGeo, Math.random() < 0.8 ? coinMat : coinMat2));
      const rm = new THREE.Mesh(rimGeo, coinMat); rm.rotation.x = Math.PI / 2; rm.position.y = 0.021; g.add(rm);
      m = g;
    }
    m.position.copy(pos);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    scene.add(m);
    bits.push({ m, v: vel, w: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14), life: kind === 'drop' ? 0.8 : Infinity, kind, rest: false });
  }
  function clearBits() {
    bits.forEach(b => scene.remove(b.m));
    bits.length = 0;
  }

  // ---------- stan
  let target: PiggyState = { fill: 0, crack: 0, broken: false };
  let fill = 0, broken = false, rain = 0;
  let wob = 0, wobV = 0, sq = 0, sqV = 0, t = 0;
  let slotY = 1;
  // gotowy model z pliku (poly.pizza, CC0): root stoi na podłodze, `k` = skala bazowa, `h` = wysokość po skali
  let model: { root: THREE.Group; k: number; h: number; top: number; real: boolean; overlay: { tex: THREE.Texture; draw: (n: number) => void; mat: THREE.Material } } | null = null;

  function layout(sx: number, sy: number) {
    if (model) {
      // pulchność = szerszy i wyższy korpus; stopy zostają na poduszce
      // realistyczna świnia tyje łagodniej niż skarbonka (inaczej wygląda jak balon)
      const kx = model.real ? 0.9 + (sx - 0.74) * 0.55 : sx / 0.95, ky = model.real ? 0.92 + (sy - 0.8) * 0.4 : sy / 0.92;
      model.root.scale.set(model.k * kx, model.k * ky, model.k * kx);
      slotY = model.top * ky;
      slot.position.set(0, slotY - 0.06, 0);
      stuck.position.set(0, slotY + 0.08, 0);
      stuck.visible = fill > 0.93 && !broken;
      shadow.scale.set(0.8 + 0.22 * sx, 0.8 + 0.22 * sx, 1);
      return;
    }
    const y0 = 1.11 * sy;                                   // środek ciała nad podłogą: nogi stoją na poduszce
    const front = 1.25 * sx;
    body.scale.set(1.25 * sx, sy, sx); body.position.set(0, y0, 0);
    snout.position.set(front + 0.06, y0 + 0.02 * sy, 0);
    nostrils.forEach(n => n.position.set(front + 0.22, y0 + 0.03 * sy, n.userData.s * 0.11));
    eyes.forEach(e => e.position.set(front * 0.8, y0 + 0.36 * sy, e.userData.s * 0.36 * sx));
    ears.forEach(e => {
      e.position.set(front * 0.55, y0 + 0.86 * sy, e.userData.s * 0.42 * sx);
      e.rotation.set(e.userData.s * 0.35, 0, -0.35);
    });
    legs.forEach(l => {
      const [fx, fz] = l.userData.f;
      l.position.set(fx * 0.62 * sx, y0 - 0.86 * sy, fz * 0.46 * sx);
    });
    tail.position.set(-1.25 * sx - 0.08, y0 + 0.25 * sy, 0);
    tail.rotation.set(0, Math.PI / 2, 0.4);
    slotY = y0 + sy;
    slot.position.set(-0.05, slotY - 0.02, 0);
    stuck.position.set(-0.05, slotY + 0.1, 0);
    stuck.visible = fill > 0.93 && !broken;
    shadow.scale.set(0.8 + 0.22 * sx, 0.8 + 0.22 * sx, 1);
  }

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // kadr obejmuje całą poduszkę (±2,5 szerokości, ok. 4,2 wysokości): kamera dalej przy wąskim i niskim płótnie
    const d = Math.max(6.9, 2.6 / (0.2867 * (w / h)));
    camera.position.set(d * 0.36, 1.9, d);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let raf = 0, last = performance.now(), visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
  io.observe(canvas);

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible) return;
    t += dt;
    fill += (target.fill - fill) * Math.min(1, dt * 3);
    const f = Math.max(0, Math.min(1.1, fill));
    const breathe = reduced() ? 0 : Math.sin(t * 2.2) * 0.012 * (0.4 + f);
    wobV += (-wob * 55 - wobV * 4.5) * dt; wob += wobV * dt;
    sqV += (-sq * 85 - sqV * 6.5) * dt; sq += sqV * dt;
    // pulchność: cała bryła szersza niż wyższa
    const sx = 0.74 + 0.38 * f + breathe, sy = 0.8 + 0.24 * f + breathe;
    // galaretowate ugięcie od kopytek i kołysanie
    pig.scale.set(1 + sq * 0.07, 1 - sq * 0.1, 1 + sq * 0.07);
    pig.rotation.set(wob * 0.07, -0.4 + (reduced() ? 0 : Math.sin(t * 0.5) * 0.06) + wob * 0.05, wob * 0.17);
    if (target.fill >= 1 && !broken && target.crack > 0 && !reduced()) pig.position.x = Math.sin(t * 42) * 0.007 * target.crack;
    else pig.position.x = 0;
    pig.updateMatrixWorld(true);
    layout(sx, sy);
    // deszcz monet i banknotów po rozbiciu
    if (rain > 0) {
      const n = Math.min(rain, 3);
      rain -= n;
      for (let i = 0; i < n; i++) {
        const kind: Bit['kind'] = Math.random() < 0.62 ? 'coin' : 'note';
        spawn(kind, new THREE.Vector3((Math.random() - 0.5) * 3.6, 4 + Math.random() * 2.5, (Math.random() - 0.5) * 3), new THREE.Vector3((Math.random() - 0.5) * 0.8, -2 - Math.random() * 2, (Math.random() - 0.5) * 0.8));
      }
    }
    flash.intensity *= Math.exp(-dt * 4.5);
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      if (b.rest) continue;
      b.life -= dt;
      if (b.kind === 'drop') {
        b.v.y -= 14 * dt;
        b.m.position.addScaledVector(b.v, dt);
        b.m.rotation.x += 6 * dt;
        if (b.m.position.y < slotY + FLOOR + 0.2) b.life = 0;
      } else {
        b.v.y -= (b.kind === 'note' ? 4 : 11) * dt;
        if (b.kind === 'note') b.v.multiplyScalar(1 - dt * 1.2);
        b.m.position.addScaledVector(b.v, dt);
        const r = Math.hypot(b.m.position.x, b.m.position.z);
        if (r > 2.15) { const k = 2.1 / r; b.m.position.x *= k; b.m.position.z *= k; b.v.x *= -0.4; b.v.z *= -0.4; }
        const rest = b.kind === 'shard' ? 0.1 : b.kind === 'coin' ? 0.03 + Math.random() * 0.12 : 0.02 + Math.random() * 0.07;
        if (b.m.position.y < FLOOR + rest) {
          b.m.position.y = FLOOR + rest;
          b.v.y *= -0.32; b.v.x *= 0.62; b.v.z *= 0.62; b.w.multiplyScalar(0.6);
          if (Math.abs(b.v.y) < 0.9) {
            b.rest = true;                                   // leży na poduszce: płasko, losowo obrócona
            if (b.kind === 'note') b.m.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
            else if (b.kind === 'coin') b.m.rotation.set((Math.random() - 0.5) * 0.25, Math.random() * 6, (Math.random() - 0.5) * 0.25);
            continue;
          }
        }
        b.m.rotation.x += b.w.x * dt; b.m.rotation.y += b.w.y * dt; b.m.rotation.z += b.w.z * dt;
      }
      if (b.life <= 0) { scene.remove(b.m); bits.splice(i, 1); }
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  const api: PiggyScene = {
    set(s) {
      target = s;
      crack.draw(s.crack);
      model?.overlay.draw(s.crack);
      if (s.broken && !broken) api.burst();
      if (!s.broken && broken) { broken = false; pig.visible = true; shadow.visible = true; clearBits(); rain = 0; }
    },
    poke() {
      if (broken) return;
      wobV += (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3);
      sqV -= 5.5;
    },
    coin() {
      if (broken || reduced()) return;
      spawn('drop', new THREE.Vector3(-0.05, slotY + FLOOR + 1.6, 0), new THREE.Vector3(0, -1, 0));
    },
    burst() {
      if (broken) return;
      broken = true;
      pig.visible = false;
      shadow.visible = false;
      flash.intensity = reduced() ? 0 : 9;
      const n = reduced() ? 0.35 : 1;
      const mid = new THREE.Vector3(0, FLOOR + 1.1, 0);
      const out = (up: number, sp: number) => new THREE.Vector3((Math.random() - 0.5) * sp, up + Math.random() * up, (Math.random() - 0.5) * sp);
      for (let i = 0; i < 70 * n; i++) spawn('shard', mid.clone().add(out(0.5, 1.8)), out(4, 8));
      for (let i = 0; i < 90 * n; i++) spawn('coin', mid.clone().add(out(0.3, 1.2)), out(5, 7));
      for (let i = 0; i < 40 * n; i++) spawn('note', mid.clone().add(out(0.4, 1.2)), out(3.5, 5));
      rain = Math.round(170 * n);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      scene.traverse(o => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
      [slotMat, porcelain, plain, deep, inner, dark, hoof, eyeMat, white, shine, blush, gold, coinMat, coinMat2, ...noteMats].forEach(m => m.dispose());
      noteTex.forEach(x => x.dispose());
      crack.tex.dispose();
      model?.overlay.tex.dispose(); model?.overlay.mat.dispose();
      renderer.dispose();
    },
  };
  // wczytanie gotowego modelu: realistyczna świnia (Meshy), a gdy się nie uda - skarbonka z poly.pizza (CC0); do tego czasu (i gdy
  // nic się nie wczyta) widać model proceduralny. `face` = obrót, który kieruje ryjek na +x, `len` = długość po skali.
  let disposed = false;
  const PIG = { url: pigUrl, real: true, face: Math.PI / 2, len: 4.0 };
  const BANK = { url: bankUrl, real: false, face: Math.PI / 2, len: 3.3 };
  function loadModel(cfg: typeof PIG, onFail?: () => void) {
    new GLTFLoader().load(cfg.url, gltf => {
      if (disposed) return;
      try {
        let src: THREE.Mesh | null = null;
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse(o => { if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh; });
        if (!src) { onFail?.(); return; }
        const mesh0 = src as THREE.Mesh;
        const geo = mesh0.geometry.clone();
        geo.applyMatrix4(mesh0.matrixWorld);
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        // środek w poziomie, stopy na y = 0
        geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        geo.computeBoundingBox();
        const size = new THREE.Vector3(); geo.boundingBox!.getSize(size);
        const k = cfg.len / Math.max(size.x, size.z);
        const old = mesh0.material as THREE.MeshStandardMaterial;
        const mat = cfg.real
          // skóra: tekstura i mapa normalnych z pliku, matowa (bez metalu), delikatny połysk jak wilgotna skóra
          ? new THREE.MeshPhysicalMaterial({ map: old.map, normalMap: old.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.62, metalness: 0, sheen: 0.5, sheenColor: new THREE.Color('#ffc7d4'), sheenRoughness: 0.6 })
          : new THREE.MeshPhysicalMaterial({ color: PINK, roughness: 0.4, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.22, sheen: 0.3, sheenColor: new THREE.Color('#ffd0e0') });
        const mesh = new THREE.Mesh(geo, mat);
        const root = new THREE.Group();
        mesh.rotation.y = cfg.face;
        root.add(mesh);
        // pęknięcia: przezroczysta nakładka z rzutem kątowym wokół osi pionowej (od strony kamery)
        const og = geo.clone();
        const pos = og.attributes.position, uv = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          uv[i * 2] = 0.5 - Math.atan2(pos.getX(i), pos.getZ(i)) / (Math.PI * 2);
          uv[i * 2 + 1] = pos.getY(i) / size.y;
        }
        og.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        const oc = crackTexture(true);
        const omat = new THREE.MeshBasicMaterial({ map: oc.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        const overlay = new THREE.Mesh(og, omat);
        overlay.scale.setScalar(1.004);
        overlay.rotation.y = cfg.face;
        root.add(overlay);
        pig.add(root);
        // wysokość grzbietu w miejscu szczeliny (środek, nie czubki uszu)
        let top = 0;
        const gp = geo.attributes.position;
        for (let i = 0; i < gp.count; i++) if (Math.hypot(gp.getX(i), gp.getZ(i)) < Math.min(size.x, size.z) * 0.14) top = Math.max(top, gp.getY(i));
        model = { root, k, h: size.y * k, top: top * k, real: cfg.real, overlay: { tex: oc.tex, draw: oc.draw, mat: omat } };
        procedural.forEach(o => { o.visible = false; });
        slot.visible = true;
        oc.draw(target.crack);
      } catch { onFail?.(); }
    }, undefined, () => { onFail?.(); });
  }
  loadModel(PIG, () => loadModel(BANK));
  return api;
}
