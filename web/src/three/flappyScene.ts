// @ts-nocheck -- scena Three.js; typy dochodzą przy dalszym porządkowaniu
// Flappy Bird w 3D: zamiast ptaka leci karta gracza. Pogodny dzień: niebo z chmurami, zielone wzgórza, trawa, zielone rury.
// Logika gry jest płaska (x do przodu, y w górę, jednostki świata); kamera patrzy z boku.
import * as THREE from 'three';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const W = { g: -26, flap: 8.6, speed: 4.6, gap: 3.6, every: 6.2, top: 7.2, floor: -4.4, cw: 1.1, ch: 1.55, pw: 1.3, x: -3.2 };

export interface FlappyHud { phase: 'ready' | 'play' | 'over'; score: number; best: number }
export interface FlappyCard { photo: string; name: string; color: string }

function cardTexture(card: FlappyCard) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 360;
  const x = c.getContext('2d')!;
  const paint = (img?: HTMLImageElement) => {
    x.clearRect(0, 0, 256, 360);
    x.fillStyle = card.color; x.beginPath(); x.roundRect(0, 0, 256, 360, 22); x.fill();
    x.fillStyle = '#101014'; x.beginPath(); x.roundRect(10, 10, 236, 340, 15); x.fill();
    x.save(); x.beginPath(); x.roundRect(20, 20, 216, 266, 10); x.clip();
    x.fillStyle = '#22222a'; x.fillRect(20, 20, 216, 266);
    if (img && img.naturalWidth) {
      const s = Math.max(216 / img.naturalWidth, 266 / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
      x.drawImage(img, 20 + (216 - w) / 2, 20 + (266 - h) / 2, w, h);
    }
    x.restore();
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    let size = 30; x.font = `800 ${size}px "Bricolage Grotesque", system-ui, sans-serif`;
    while (x.measureText(card.name).width > 210 && size > 12) { size -= 2; x.font = `800 ${size}px "Bricolage Grotesque", system-ui, sans-serif`; }
    x.fillText(card.name, 128, 318);
  };
  paint();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => { paint(img); t.needsUpdate = true; };
  img.src = card.photo;
  return t;
}

function grassTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#5cbf4a'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#4fae3e'; x.fillRect(0, 0, 64, 128);
  x.fillStyle = '#3f8f31'; x.fillRect(0, 0, 128, 6);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 10); t.anisotropy = 8;
  return t;
}

export function createFlappy(canvas: HTMLCanvasElement, card: FlappyCard, onHud: (h: FlappyHud) => void, best0: number, sfx: (k: 'flap' | 'score' | 'hit') => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#7ec8f2');
  scene.fog = new THREE.Fog('#bfe6fb', 22, 52);
  const cam = new THREE.PerspectiveCamera(42, 1, .1, 120);
  cam.position.set(0, 0, 17); cam.lookAt(0, -.4, 0);

  scene.add(new THREE.AmbientLight('#ffffff', 1.1));
  const key = new THREE.DirectionalLight('#fff4e0', 1.6); key.position.set(-4, 6, 8); scene.add(key);

  // niebo: gradient na dużej płaszczyźnie z tyłu, słońce, dryfujące chmury i wzgórza
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(140, 70), new THREE.ShaderMaterial({
    depthWrite: false, fog: false,
    vertexShader: 'varying vec2 v; void main(){ v = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec2 v; void main(){ gl_FragColor = vec4(mix(vec3(.80,.93,1.), vec3(.32,.62,.93), smoothstep(.25,.95,v.y)), 1.); }'
  }));
  sky.position.set(0, 4, -40); scene.add(sky);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(2.2, 40), new THREE.MeshBasicMaterial({ color: '#fff3b0', fog: false }));
  sun.position.set(7, 6.5, -36); scene.add(sun);
  const clouds = new THREE.Group();
  const cm = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .92, fog: false }), cg = new THREE.CircleGeometry(1, 20);
  for (let i = 0; i < 9; i++) {
    const cl = new THREE.Group();
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(cg, cm); b.position.set(k * 1.1 - 1.6, (k % 2) * .35, 0); b.scale.set(1.2 - (k % 2) * .25, .9, 1); cl.add(b); }
    cl.position.set(i * 9 - 36, 2 + ((i * 37) % 7) * .8, -30 - (i % 3) * 3); clouds.add(cl);
  }
  scene.add(clouds);
  const hills = new THREE.Group();
  const hg = new THREE.CircleGeometry(1, 36);
  [['#7ccf6b', .9, 5, 3.6, -28], ['#5db553', 1.2, 4, 2.8, -22]].forEach(([col, sp, w, h, z], layer) => {
    const mat = new THREE.MeshBasicMaterial({ color: col });
    for (let i = -8; i <= 8; i++) {
      const m = new THREE.Mesh(hg, mat); m.scale.set(w + ((i * 7 + layer) % 3), h + Math.abs(Math.sin(i * 1.7 + layer)) * 1.6, 1);
      m.position.set(i * 7.5 + layer * 3, W.floor, z); hills.add(m);
    }
  });
  scene.add(hills);

  // podłoga: przesuwająca się trawa
  const gt = grassTexture();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshBasicMaterial({ map: gt }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, W.floor, -20); scene.add(floor);

  // karta-ptak
  const tex = cardTexture(card);
  const bird = new THREE.Group();
  const edge = () => new THREE.MeshStandardMaterial({ color: card.color, emissive: card.color, emissiveIntensity: .6 });
  const face = new THREE.Mesh(new THREE.BoxGeometry(W.cw, W.ch, .12), [
    edge(), edge(), edge(), edge(),
    new THREE.MeshStandardMaterial({ map: tex, roughness: .35, metalness: .15 }), new THREE.MeshStandardMaterial({ color: '#101014' })
  ]);
  bird.add(face);
  const glow = new THREE.PointLight(card.color, 22, 7); glow.position.z = 1; bird.add(glow);
  scene.add(bird);

  // ogon: wstęga przyczepiona do karty. Ma biały spód (podłoże) i kolorowy pas na nim; powtarza ruch karty z opóźnieniem i faluje
  const SEG = 24, STEP = .17;
  const ribbon = (width: number, color: string, z: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .95, depthWrite: false }));
    m.frustumCulled = false; m.position.z = z; scene.add(m);
    return { m, width };
  };
  const tailBase = ribbon(.62, '#ffffff', -.12), tailBand = ribbon(.36, card.color, -.1);
  const hist: number[] = Array(SEG).fill(0);
  let histT = 0;
  const updRibbon = (r: { m: THREE.Mesh; width: number }, live: boolean) => {
    const a = r.m.geometry.attributes.position;
    for (let i = 0; i < SEG; i++) {
      const k = i / (SEG - 1), half = r.width * (1 - k * .85) / 2 * (live ? 1 : .8);
      const cy = hist[i] + Math.sin(time * 9 - i * .6) * .07 * k * 3;
      const x = W.x - W.cw / 2 - i * STEP;
      a.setXYZ(i * 2, x, cy + half, 0); a.setXYZ(i * 2 + 1, x, cy - half, 0);
    }
    a.needsUpdate = true;
  };

  // słupy
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#3fae3a', emissive: '#1d6b22', emissiveIntensity: .35, roughness: .5 });
  const edgeMat = new THREE.LineBasicMaterial({ color: '#1b5e20' });
  const unit = new THREE.BoxGeometry(W.pw, 1, W.pw), unitEdges = new THREE.EdgesGeometry(unit);
  type Pipe = { x: number; gy: number; passed: boolean; top: THREE.Mesh; bot: THREE.Mesh };
  let pipes: Pipe[] = [];
  const mkPipe = (x: number): Pipe => {
    const gy = (Math.random() - .5) * 5.2 + .2;
    const mk = () => { const m = new THREE.Mesh(unit, pillarMat); m.add(new THREE.LineSegments(unitEdges, edgeMat)); scene.add(m); return m; };
    const p = { x, gy, passed: false, top: mk(), bot: mk() };
    const topY = W.top + 2, botY = W.floor;
    const gt2 = gy + W.gap / 2, gb = gy - W.gap / 2;
    p.top.scale.y = topY - gt2; p.top.position.set(x, gt2 + (topY - gt2) / 2, 0);
    p.bot.scale.y = gb - botY; p.bot.position.set(x, botY + (gb - botY) / 2, 0);
    return p;
  };
  const clearPipes = () => { for (const p of pipes) scene.remove(p.top, p.bot); pipes = []; };

  // cząstki przy uderzeniu
  const sparks: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  const sg = new THREE.PlaneGeometry(.18, .18);
  const burst = () => {
    if (reduced) return;
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: i % 2 ? card.color : '#fff3b0', transparent: true, depthWrite: false }));
      m.position.copy(bird.position); scene.add(m);
      sparks.push({ m, v: new THREE.Vector3((Math.random() - .5) * 9, Math.random() * 7 - 1, (Math.random() - .5) * 5), life: 1 });
    }
  };

  const hud: FlappyHud = { phase: 'ready', score: 0, best: best0 };
  const emit = () => onHud({ ...hud });
  let y = 0, vy = 0, tilt = 0, dist = 0, since = 0, shake = 0, time = 0;

  function reset() {
    clearPipes(); y = 0; vy = 0; since = W.every - 2.6; hud.score = 0; hud.phase = 'ready'; emit();
  }
  function flap() {
    if (hud.phase === 'over') return;
    if (hud.phase === 'ready') { hud.phase = 'play'; emit(); }
    vy = W.flap; sfx('flap');
  }
  function die() {
    hud.phase = 'over'; shake = .5; burst(); sfx('hit');
    if (hud.score > hud.best) hud.best = hud.score;
    emit();
  }

  function step(dt: number) {
    time += dt;
    const live = hud.phase === 'play';
    if (live) { vy += W.g * dt; y += vy * dt; }
    else if (hud.phase === 'over') {
      vy += W.g * dt; y += vy * dt;
      if (y < W.floor + W.ch / 2) { y = W.floor + W.ch / 2; vy = 0; }
    } else { y = Math.sin(time * 3) * .35; vy = 0; }
    tilt += ((live || hud.phase === 'over' ? Math.max(-1.2, Math.min(.5, vy * .09)) : 0) - tilt) * Math.min(1, dt * 12);
    if (live) {
      dist += W.speed * dt; since += W.speed * dt;
      if (since >= W.every) { since = 0; pipes.push(mkPipe(18)); }
      for (const p of pipes) {
        p.x -= W.speed * dt; p.top.position.x = p.bot.position.x = p.x;
        if (!p.passed && p.x < W.x - W.pw / 2) { p.passed = true; hud.score++; sfx('score'); emit(); }
        // zderzenie: prostokąt karty (z lekką tolerancją) kontra słup
        const hx = (W.cw + W.pw) / 2 - .12;
        if (hud.phase === 'play' && Math.abs(p.x - W.x) < hx && (y + W.ch / 2 - .1 > p.gy + W.gap / 2 || y - W.ch / 2 + .1 < p.gy - W.gap / 2)) die();
      }
      pipes = pipes.filter(p => { if (p.x < -14) { scene.remove(p.top, p.bot); return false; } return true; });
      if (hud.phase === 'play' && (y - W.ch / 2 < W.floor || y + W.ch / 2 > W.top + 1.4)) {
        y = Math.max(W.floor + W.ch / 2, Math.min(y, W.top + 1.4 - W.ch / 2)); die();
      }
    }
    bird.position.set(W.x, y, 0);
    bird.rotation.z = tilt; bird.rotation.y = Math.sin(time * 2) * .12;
    histT += dt;
    while (histT >= .014) { histT -= .014; hist.pop(); hist.unshift(y); }
    hist[0] = y;
    tailBase.m.visible = tailBand.m.visible = hud.phase !== 'over';
    updRibbon(tailBase, live); updRibbon(tailBand, live);
    gt.offset.x = (dist * .08) % 1;
    hills.position.x = -((dist * .18) % 7.5);
    clouds.position.x = -((time * .5 + dist * .05) % 9);
    for (const s of sparks) { s.life -= dt * 1.4; s.v.y -= 14 * dt; s.m.position.addScaledVector(s.v, dt); s.m.material.opacity = Math.max(0, s.life); }
    while (sparks.length && sparks[0].life <= 0) { const s = sparks.shift()!; scene.remove(s.m); s.m.material.dispose(); }
    shake = Math.max(0, shake - dt);
    cam.position.set((Math.random() - .5) * shake * .6, (Math.random() - .5) * shake * .6, 17);
    cam.lookAt(0, -.4, 0);
  }

  function resize() {
    const w = canvas.clientWidth || 640, h = canvas.clientHeight || 400;
    renderer.setSize(w, h, false); cam.aspect = w / h;
    cam.fov = w / h < 1.2 ? 62 : 42;    // w pionie szerszy kąt, żeby słupy się mieściły
    cam.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

  let raf = 0, last = performance.now(), acc = 0;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    acc += Math.min(.1, (now - last) / 1000); last = now;
    while (acc >= 1 / 120) { step(1 / 120); acc -= 1 / 120; }
    renderer.render(scene, cam);
  };
  raf = requestAnimationFrame(loop);
  reset();

  return {
    flap, reset,
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect();
      scene.traverse(o => {
        if (o.geometry && o.geometry !== unit && o.geometry !== unitEdges) o.geometry.dispose();
        const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { x.map?.dispose?.(); x.dispose(); });
      });
      unit.dispose(); unitEdges.dispose(); renderer.dispose();
    }
  };
}
export type FlappyScene = ReturnType<typeof createFlappy>;
