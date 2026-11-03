// Jednoręki bandyta 3D: szafa automatu z trzema bębnami, świecącym szyldem, dźwignią i tacką na monety.
// Bęben to walec z REEL_SLOTS polami (ten sam pas przez całą grę); wynik z serwera = pole z tym symbolem zatrzymane na środkowej linii.
// Kąt bębna a: pole i jest z przodu, gdy a = kąt środka pola; rosnące a przesuwa symbole w dół.
import * as THREE from 'three';
import { crateEnvironment, softDot } from './crateModel';
import { mountR3F } from './r3f';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TAU = Math.PI * 2;
export const REEL_SLOTS = 15;
const SLOT = TAU / REEL_SLOTS;
const REEL_R = 1, REEL_W = .78, REEL_X = [-.88, 0, .88], REEL_Y = .35, REEL_Z = .02;
const BODY_W = 3.3, BODY_H = 4.6, BODY_D = 1.5, WIN_W = 2.74, WIN_H = 1.36;

export interface SlotSymbol { id: string; color: string; svg?: string }

/** Pas bębna: symbole rysowane obrócone, bo obwód walca biegnie po osi U tekstury (patrz układ we wstępie) */
function reelTexture(strip: string[], syms: Record<string, SlotSymbol>, images: Record<string, HTMLImageElement>) {
  const S = 220, c = document.createElement('canvas'); c.width = S * REEL_SLOTS; c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0b0b0e'); g.addColorStop(.5, '#1a1a20'); g.addColorStop(1, '#0b0b0e');
  x.fillStyle = g; x.fillRect(0, 0, c.width, 256);
  strip.forEach((id, i) => {
    const cx = (i + .5) * S, s = syms[id];
    x.fillStyle = '#ffffff10'; x.fillRect(i * S, 0, 2, 256);
    x.save();
    x.translate(cx, 128); x.rotate(Math.PI / 2);
    x.shadowColor = s.color; x.shadowBlur = 26;
    if (id === 'seven' || !images[id]) {
      x.font = '900 190px "Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineWidth = 10; x.strokeStyle = '#2a0420'; x.strokeText('7', 0, 8);
      x.fillStyle = s.color; x.fillText('7', 0, 8);
    } else x.drawImage(images[id], -88, -88, 176, 176);
    x.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function marqueeTexture(title: string) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2a0710'); g.addColorStop(1, '#0d0205');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 256);
  x.font = '800 120px "Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#ffb02a'; x.shadowBlur = 30;
  x.fillStyle = '#ffe08a'; x.fillText(title, 512, 136);
  x.shadowBlur = 0; x.lineWidth = 2; x.strokeStyle = '#fff6'; x.strokeText(title, 512, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Promienie na łuku szczytu automatu (tekstura obraca się w pętli) */
function raysTexture(hue: string) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 24; i++) {
    x.fillStyle = i % 2 ? hue : '#ffcf5a';
    x.globalAlpha = i % 2 ? .9 : .75;
    x.beginPath(); x.moveTo(S / 2, S / 2);
    x.arc(S / 2, S / 2, S, i / 24 * Math.PI * 2, (i + 1) / 24 * Math.PI * 2); x.closePath(); x.fill();
  }
  x.globalAlpha = 1;
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#fff8'); g.addColorStop(.25, '#0000'); g.addColorStop(1, '#0008');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.center.set(.5, .5);
  return t;
}

/** Wyświetlacz LED z kropek: napis rysowany na nowo tylko przy zmianie */
function ledDisplay() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  const x = c.getContext('2d')!, tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const tmp = document.createElement('canvas'); tmp.width = 256; tmp.height = 32;
  const tx = tmp.getContext('2d', { willReadFrequently: true })!;
  let shown = '';
  function draw(text: string, color: string, offset = 0) {
    const key = text + color + offset;
    if (key === shown) return;
    shown = key;
    tx.clearRect(0, 0, 256, 32);
    tx.font = '800 22px "Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif';
    tx.textAlign = 'center'; tx.textBaseline = 'middle'; tx.fillStyle = '#fff';
    tx.fillText(text, 128 - offset, 17);
    const px = tx.getImageData(0, 0, 256, 32).data;
    x.fillStyle = '#060304'; x.fillRect(0, 0, 1024, 128);
    for (let j = 0; j < 32; j++) for (let i = 0; i < 256; i++) {
      const on = px[(j * 256 + i) * 4 + 3] > 110;
      x.fillStyle = on ? color : '#2a0d12';
      x.beginPath(); x.arc(i * 4 + 2, j * 4 + 2, on ? 1.7 : 1.2, 0, 6.283); x.fill();
    }
    tex.needsUpdate = true;
  }
  return { tex, draw };
}

/** Cień na górze i dole okna bębnów: bębny wyglądają na wypukłe */
function shadeTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d')!, g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#000e'); g.addColorStop(.28, '#0000'); g.addColorStop(.72, '#0000'); g.addColorStop(1, '#000e');
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}

/** Zaokrąglony prostokąt (środek w 0, 0), opcjonalnie z otworem */
function rounded<T extends THREE.Path>(w: number, h: number, r: number, path: T): T {
  const x = -w / 2, y = -h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r); path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

const loadImage = (svg: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img); img.onerror = fail;
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
});

export interface SlotsScene {
  /** Bębny staną na podanych symbolach (środkowa linia); onStop(k) przy zatrzymaniu bębna k */
  spin(result: string[], opts?: { fast?: boolean; onTick?: (k: number, strength: number) => void; onStop?: (k: number) => void }): Promise<void>;
  win(pays: number | null): void;
  /** Dźwignia: 0 = w górze, 1 = na dole */
  setPull(p: number): void;
  /** Czy punkt ekranu trafia w dźwignię (z zapasem) */
  hitLever(clientX: number, clientY: number): boolean;
  setHue(hex: string): void;
  /** Gotowy do gry: kulka dźwigni pulsuje, wyświetlacz zaprasza */
  setArmed(on: boolean): void;
  destroy(): void;
}

export async function createSlotsScene(canvas: HTMLCanvasElement, symbols: SlotSymbol[], weights: Record<string, number>, hue: string): Promise<SlotsScene> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 60);
  // renderer, rozmiar i pętla klatek: React Three Fiber (three/r3f.tsx)
  const host = mountR3F(canvas, { scene, camera, maxDpr: 2, exposure: 1.05 });
  const renderer = host.gl;
  const env = crateEnvironment(renderer);
  scene.environment = env.texture;
  scene.environmentIntensity = .75;
  scene.add(new THREE.HemisphereLight('#ffffff', '#1a0a10', .5));
  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(-3, 5, 6); scene.add(key);
  const rimL = new THREE.DirectionalLight('#ff8aa0', 1.4); rimL.position.set(-5, 2, -3); scene.add(rimL);
  const winLight = new THREE.PointLight('#ffcf5a', 0, 8, 1.5); winLight.position.set(0, REEL_Y, 2.4); scene.add(winLight);

  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(o: T) => { disposables.push(o); return o; };
  const syms = Object.fromEntries(symbols.map(s => [s.id, s]));
  const images: Record<string, HTMLImageElement> = {};
  await Promise.all(symbols.filter(s => s.svg).map(s => loadImage(s.svg!).then(img => { images[s.id] = img; }).catch(() => {})));
  await document.fonts?.ready.catch(() => {});

  // ---------------------------------------------------------------- szafa
  const paint = keep(new THREE.MeshPhysicalMaterial({ color: hue, metalness: .55, roughness: .32, clearcoat: 1, clearcoatRoughness: .06 }));
  const chrome = keep(new THREE.MeshStandardMaterial({ color: '#e8ecf2', metalness: 1, roughness: .12 }));
  const dark = keep(new THREE.MeshStandardMaterial({ color: '#0b0b0e', metalness: .3, roughness: .6 }));
  const bodyShape = rounded(BODY_W, BODY_H, .32, new THREE.Shape());
  bodyShape.holes.push(rounded(WIN_W, WIN_H, .14, new THREE.Path()));
  const body = new THREE.Mesh(keep(new THREE.ExtrudeGeometry(bodyShape, { depth: BODY_D, bevelEnabled: true, bevelSize: .06, bevelThickness: .06, bevelSegments: 4, curveSegments: 24 })), paint);
  body.position.set(0, REEL_Y, -BODY_D + .02);
  scene.add(body);
  // kształt ma środek w 0, więc okno szafy wypada na wysokości bębnów (REEL_Y)
  const back = new THREE.Mesh(keep(new THREE.PlaneGeometry(WIN_W, WIN_H)), dark);
  back.position.set(0, REEL_Y, -BODY_D + .1); scene.add(back);
  const bezelShape = rounded(WIN_W + .22, WIN_H + .22, .2, new THREE.Shape());
  bezelShape.holes.push(rounded(WIN_W, WIN_H, .14, new THREE.Path()));
  const bezel = new THREE.Mesh(keep(new THREE.ExtrudeGeometry(bezelShape, { depth: .06, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 3, curveSegments: 24 })), chrome);
  bezel.position.set(0, REEL_Y, .08); scene.add(bezel);
  // szyld u góry
  const marqueeTex = keep(marqueeTexture('ScamBox'));
  const marquee = new THREE.Mesh(keep(new THREE.BoxGeometry(BODY_W - .5, .8, .3)), [dark, dark, dark, dark, keep(new THREE.MeshStandardMaterial({ map: marqueeTex, emissive: '#ffffff', emissiveMap: marqueeTex, emissiveIntensity: .9, roughness: .4 })), dark]);
  marquee.position.set(0, REEL_Y + BODY_H / 2 - .62, .14); scene.add(marquee);
  // żarówki wokół szyldu i okna: kolor zmienia się w pętli (świecą jak w kasynie)
  const bulbSpots: THREE.Vector3[] = [];
  const ring = (cx: number, cy: number, w: number, h: number, n: number, z: number) => {
    for (let i = 0; i < n; i++) {
      const t = i / n * 2 * (w + h);
      const p = t < w ? [cx - w / 2 + t, cy + h / 2] : t < w + h ? [cx + w / 2, cy + h / 2 - (t - w)] : t < 2 * w + h ? [cx + w / 2 - (t - w - h), cy - h / 2] : [cx - w / 2, cy - h / 2 + (t - 2 * w - h)];
      bulbSpots.push(new THREE.Vector3(p[0], p[1], z));
    }
  };
  ring(0, marquee.position.y, BODY_W - .36, .96, 30, .32);
  ring(0, REEL_Y, WIN_W + .5, WIN_H + .5, 34, .14);
  const bulbs = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(.045, 12, 8)), keep(new THREE.MeshBasicMaterial({ color: '#ffffff' })), bulbSpots.length);
  const m4 = new THREE.Matrix4();
  bulbSpots.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); bulbs.setMatrixAt(i, m4); bulbs.setColorAt(i, new THREE.Color('#ffe08a')); });
  scene.add(bulbs);
  // poświata żarówek: kolor taki jak żarówki, gaśnie razem z nimi
  const glowGeo = keep(new THREE.BufferGeometry().setFromPoints(bulbSpots.map(p => p.clone().setZ(p.z + .02))));
  glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(bulbSpots.length * 3), 3));
  const bulbGlow = new THREE.Points(glowGeo, keep(new THREE.PointsMaterial({ map: keep(softDot()), size: .42, vertexColors: true, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false })));
  scene.add(bulbGlow);
  const glowCol = glowGeo.getAttribute('color') as THREE.BufferAttribute;
  // panel pod oknem z przyciskami i tacka na monety
  const deck = new THREE.Mesh(keep(new THREE.BoxGeometry(BODY_W - .2, .22, .7)), dark);
  deck.position.set(0, REEL_Y - WIN_H / 2 - .45, .25); deck.rotation.x = .25; scene.add(deck);
  const btnGeo = keep(new THREE.CylinderGeometry(.11, .11, .06, 24));
  const btnMats = ['#e5484d', '#3fc07a', '#e5a93b'].map(c => keep(new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: .5, roughness: .3 })));
  btnMats.forEach((mat, i) => { const b = new THREE.Mesh(btnGeo, mat); b.position.set(-.7 + i * .7, deck.position.y + .14, .35); b.rotation.x = .25; scene.add(b); });
  const tray = new THREE.Mesh(keep(new THREE.BoxGeometry(BODY_W - .8, .4, .55)), chrome);
  tray.position.set(0, REEL_Y - BODY_H / 2 + .55, .22); scene.add(tray);
  const trayIn = new THREE.Mesh(keep(new THREE.BoxGeometry(BODY_W - 1, .3, .5)), dark);
  trayIn.position.set(0, tray.position.y + .08, .28); scene.add(trayIn);
  // chromowane listwy na krawędziach i świecące neony po bokach
  const pillarGeo = keep(new THREE.CylinderGeometry(.07, .07, BODY_H - .5, 20));
  const neonMat = keep(new THREE.MeshBasicMaterial({ color: hue }));
  const neonGeo = keep(new THREE.CylinderGeometry(.035, .035, BODY_H - 1.2, 12));
  const dotTex = keep(softDot());
  const neonGlowMat = keep(new THREE.MeshBasicMaterial({ map: dotTex, color: hue, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }));
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, chrome); p.position.set(sx * (BODY_W / 2 - .02), REEL_Y, .02); scene.add(p);
    const n = new THREE.Mesh(neonGeo, neonMat); n.position.set(sx * (BODY_W / 2 - .2), REEL_Y - .15, .13); scene.add(n);
    const g = new THREE.Mesh(keep(new THREE.PlaneGeometry(.7, BODY_H - .6)), neonGlowMat); g.position.set(n.position.x, n.position.y, .14); scene.add(g);
  }
  // łuk na szczycie z obracającymi się promieniami
  const ARC_R = 1.25, topY = REEL_Y + BODY_H / 2 + .02;
  const arcShape = new THREE.Shape(); arcShape.absarc(0, 0, ARC_R, 0, Math.PI, false); arcShape.lineTo(ARC_R, 0);
  const arc = new THREE.Mesh(keep(new THREE.ExtrudeGeometry(arcShape, { depth: .5, bevelEnabled: true, bevelSize: .05, bevelThickness: .05, bevelSegments: 3, curveSegments: 48 })), chrome);
  arc.position.set(0, topY, -.62); scene.add(arc);
  const rays = keep(raysTexture(hue));
  const arcFace = new THREE.Mesh(keep(new THREE.CircleGeometry(ARC_R - .1, 48, 0, Math.PI)), keep(new THREE.MeshBasicMaterial({ map: rays })));
  arcFace.position.set(0, topY + .02, -.06); scene.add(arcFace);
  const seven = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.2, .3)), keep(new THREE.MeshBasicMaterial({ map: keep(marqueeTexture('777')), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  seven.position.set(0, topY + .48, -.04); scene.add(seven);
  // wyświetlacz LED między szyldem a oknem
  const led = ledDisplay(); keep(led.tex);
  const ledMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.1, .26)), keep(new THREE.MeshBasicMaterial({ map: led.tex })));
  ledMesh.position.set(0, REEL_Y + WIN_H / 2 + .43, .1); scene.add(ledMesh);
  const ledFrame = new THREE.Mesh(keep(new THREE.BoxGeometry(2.2, .34, .05)), chrome);
  ledFrame.position.set(0, ledMesh.position.y, .07); scene.add(ledFrame);
  // cokół i błyszcząca podłoga z poświatą w kolorze automatu
  const base = new THREE.Mesh(keep(new THREE.BoxGeometry(BODY_W + .3, .5, BODY_D + .4)), dark);
  base.position.set(0, REEL_Y - BODY_H / 2 - .3, -BODY_D / 2 + .05); scene.add(base);
  const kick = new THREE.Mesh(keep(new THREE.BoxGeometry(BODY_W + .32, .12, .04)), chrome);
  kick.position.set(0, base.position.y + .1, .27); scene.add(kick);
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(30, 20)), keep(new THREE.MeshStandardMaterial({ color: '#0c0b0e', roughness: .22, metalness: .7 })));
  floor.rotation.x = -Math.PI / 2; floor.position.y = base.position.y - .25; scene.add(floor);
  const poolMat = keep(new THREE.MeshBasicMaterial({ map: dotTex, color: hue, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false }));
  const pool = new THREE.Mesh(keep(new THREE.PlaneGeometry(7, 4)), poolMat);
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, floor.position.y + .01, .6); scene.add(pool);

  // ---------------------------------------------------------------- bębny
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const pick = () => { let r = Math.random() * total; for (const id in weights) if ((r -= weights[id]) < 0) return id; return symbols[0].id; };
  const reelGeo = keep(new THREE.CylinderGeometry(REEL_R, REEL_R, REEL_W, 72, 1, false));
  reelGeo.rotateZ(Math.PI / 2);
  const reels = REEL_X.map((x, k) => {
    // pas: każdy symbol przynajmniej raz, reszta wg wag; sąsiednie pola różne
    const strip = symbols.map(s => s.id);
    while (strip.length < REEL_SLOTS) strip.push(pick());
    for (let i = strip.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [strip[i], strip[j]] = [strip[j], strip[i]]; }
    const tex = keep(reelTexture(strip, syms, images));
    const mat = keep(new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: .55, roughness: .45, metalness: .1 }));
    const side = keep(new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 1, roughness: .2 }));
    const mesh = new THREE.Mesh(reelGeo, [mat, side, side]);
    mesh.position.set(x, REEL_Y, REEL_Z - REEL_R);
    scene.add(mesh);
    const a = (Math.floor(Math.random() * REEL_SLOTS) + .5) * SLOT;
    mesh.rotation.x = a;
    return { mesh, strip, a, k };
  });
  // linia wygranej i strzałki po bokach
  const lineMat = keep(new THREE.MeshBasicMaterial({ color: '#ff3b5c', transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false }));
  const line = new THREE.Mesh(keep(new THREE.PlaneGeometry(WIN_W - .1, .025)), lineMat);
  line.position.set(0, REEL_Y, REEL_Z + .02); scene.add(line);
  const arrowGeo = keep(new THREE.ConeGeometry(.09, .2, 3));
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(arrowGeo, lineMat);
    a.rotation.z = s * Math.PI / 2; a.position.set(-s * (WIN_W / 2 + .2), REEL_Y, .2);
    scene.add(a);
  }
  // szyba: delikatne odbicie otoczenia nad bębnami
  const glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(WIN_W, WIN_H)), keep(new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: .06, roughness: .02, metalness: .9, depthWrite: false })));
  glass.position.set(0, REEL_Y, .1); scene.add(glass);
  for (const dx of [-.44, .44]) {
    const bar = new THREE.Mesh(keep(new THREE.BoxGeometry(.05, WIN_H, .04)), chrome);
    bar.position.set(dx, REEL_Y, REEL_Z + .03); scene.add(bar);
  }
  const shade = new THREE.Mesh(keep(new THREE.PlaneGeometry(WIN_W, WIN_H)), keep(new THREE.MeshBasicMaterial({ map: keep(shadeTexture()), transparent: true, depthWrite: false })));
  shade.position.set(0, REEL_Y, REEL_Z + .05); scene.add(shade);
  // cień szafy na podłodze
  const dot = keep(softDot());
  const floorShadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(6, 2.6)), keep(new THREE.MeshBasicMaterial({ map: dot, color: '#000', transparent: true, opacity: .7, depthWrite: false })));
  floorShadow.rotation.x = -Math.PI / 2; floorShadow.position.set(0, REEL_Y - BODY_H / 2 - .07, -.6); scene.add(floorShadow);

  // ---------------------------------------------------------------- dźwignia po prawej
  const leverRoot = new THREE.Group();
  leverRoot.position.set(BODY_W / 2 + .14, REEL_Y - .25, -.55);
  scene.add(leverRoot);
  const hub = new THREE.Mesh(keep(new THREE.CylinderGeometry(.2, .2, .22, 32)), chrome);
  hub.rotation.z = Math.PI / 2; leverRoot.add(hub);
  const arm = new THREE.Group(); arm.position.x = .12; leverRoot.add(arm);
  const rod = new THREE.Mesh(keep(new THREE.CylinderGeometry(.045, .05, 1.9, 16)), chrome);
  rod.position.y = .95; arm.add(rod);
  const knobMat = keep(new THREE.MeshPhysicalMaterial({ color: '#e8202f', emissive: '#ff2a3a', emissiveIntensity: 0, roughness: .18, clearcoat: 1, clearcoatRoughness: .05 }));
  const knob = new THREE.Mesh(keep(new THREE.SphereGeometry(.2, 32, 20)), knobMat);
  knob.position.y = 1.95; arm.add(knob);
  const hitBox = new THREE.Mesh(keep(new THREE.BoxGeometry(.9, 2.6, 1.6)), keep(new THREE.MeshBasicMaterial({ visible: false })));
  hitBox.position.set(.12, 1.1, .5); leverRoot.add(hitBox);
  const REST = -.18, DOWN = 1.95;   // kąt dźwigni: lekko do tyłu w spoczynku, na dole przechylona do widza

  // ---------------------------------------------------------------- monety przy wygranej
  const COINS = 90;
  const coinMesh = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(.1, .1, .025, 20)), keep(new THREE.MeshStandardMaterial({ color: '#f3c04a', metalness: 1, roughness: .25 })), COINS);
  coinMesh.count = 0; scene.add(coinMesh);
  const coins = Array.from({ length: COINS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 }));

  // ---------------------------------------------------------------- pętla
  const st = { pull: 0, pullTo: 0, winT: -1, pays: 0, spinning: false, armed: false };
  let W = 0, H = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.round(r.width); H = Math.round(r.height);
    if (!W || !H) return;
    camera.aspect = W / H;
    // całą szafę razem z dźwignią mieścimy w kadrze także w wąskim oknie
    const half = Math.tan(camera.fov * Math.PI / 360);
    const dist = Math.max((BODY_W + 1.5) / (2 * half * camera.aspect), (BODY_H + 2.6) / (2 * half));
    camera.position.set(.4, REEL_Y + .9, dist);
    camera.lookAt(.2, REEL_Y + .55, 0);
    camera.updateProjectionMatrix();
  }
  host.onResize(resize); resize();

  const color = new THREE.Color(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  let last = performance.now(), running = true, visible = true;
  function frame(now: number) {
    if (!running) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!visible) return;
    const t = now / 1000;
    st.pull += (st.pullTo - st.pull) * Math.min(1, dt * (st.pullTo > st.pull ? 30 : 7));
    arm.rotation.x = REST + st.pull * DOWN;
    reels.forEach(r => { r.mesh.rotation.x = r.a; });
    // żarówki: wolny bieg w spoczynku, szybki przy kręceniu, błyski przy wygranej
    const winning = st.winT >= 0 && t - st.winT < 4;
    const speed = winning ? 18 : st.spinning ? 10 : reduced ? 0 : 2.4;
    bulbSpots.forEach((_, i) => {
      const on = Math.sin(i * .9 - t * speed) > (winning ? -.2 : .2);
      if (winning) color.setHSL(((i * .07 + t * .8) % 1), 1, on ? .62 : .15);
      else color.set(on ? '#ffe08a' : '#5a3a10');
      bulbs.setColorAt(i, color);
      const k = on ? 1 : .12;
      glowCol.setXYZ(i, color.r * k, color.g * k, color.b * k);
    });
    glowCol.needsUpdate = true;
    if (!reduced) rays.rotation = t * (winning ? 1.6 : st.spinning ? .9 : .15);
    neonGlowMat.opacity = .45 + Math.sin(t * (winning ? 12 : 2)) * .15;
    knobMat.emissiveIntensity = st.armed && !st.spinning ? .35 + Math.sin(t * 5) * .3 : 0;
    // wyświetlacz: zaproszenie, kręcenie, wygrana
    if (winning) led.draw(`WYGRANA x${st.pays}`, Math.floor(t * 4) % 2 ? '#ffe08a' : '#ff5cf0');
    else if (st.spinning) led.draw('POWODZENIA', '#ff3b5c');
    else led.draw(st.armed ? 'POCIĄGNIJ DŹWIGNIĘ' : 'POSTAW KARTY', st.armed ? '#3fc07a' : '#ff8a3a');
    bulbs.instanceColor!.needsUpdate = true;
    lineMat.opacity = winning ? .6 + Math.sin(t * 14) * .4 : .75;
    winLight.intensity = winning ? 5 + Math.sin(t * 9) * 2 : 0;
    // monety: wylatują z okna do tacki
    let n = 0;
    for (const c of coins) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.v.y -= 9.8 * dt;
      c.p.addScaledVector(c.v, dt);
      const floor = tray.position.y + .2;
      if (c.p.y < floor && Math.abs(c.p.x) < (BODY_W - .8) / 2 && c.p.z > -.05 && c.p.z < .5) { c.p.y = floor; c.v.multiplyScalar(.35); c.v.y = Math.abs(c.v.y) * .4; }
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      m4.compose(c.p, q.setFromEuler(c.r), one);
      coinMesh.setMatrixAt(n++, m4);
    }
    coinMesh.count = n;
    coinMesh.instanceMatrix.needsUpdate = true;
  }
  host.run(frame);
  const vis = () => { visible = !document.hidden; last = performance.now(); };
  document.addEventListener('visibilitychange', vis);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; last = performance.now(); });
  io.observe(canvas);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  return {
    spin(result, { fast = false, onTick, onStop } = {}) {
      st.spinning = true; st.winT = -1;
      st.pullTo = 0;
      const durs = reduced ? [300, 400, 500] : fast ? [800, 1050, 1300] : [1700, 2350, 3000];
      const plan = reels.map((r, k) => {
        const spots = r.strip.map((id, i) => id === result[k] ? i : -1).filter(i => i >= 0);
        const slot = spots[Math.floor(Math.random() * spots.length)] ?? 0;
        const target = (slot + .5) * SLOT, turns = (fast ? 2 : 4) + k * (fast ? 1 : 2);
        const from = r.a, to = from + turns * TAU + ((((target - from) % TAU) + TAU) % TAU);
        return { from, to, last: Math.floor(from / SLOT), stopped: false };
      });
      return new Promise<void>(done => {
        const t0 = performance.now();
        const tick = (now: number) => {
          let all = true;
          plan.forEach((p, k) => {
            const u = Math.min(1, (now - t0) / durs[k]);
            // rozpęd, długi wybieg i małe odbicie na końcu
            const e = u < 1 ? 1 - Math.pow(1 - u, 3) + Math.sin(u * Math.PI) * .004 * (1 - u) : 1;
            const back = u > .92 ? Math.sin((u - .92) / .08 * Math.PI) * .045 : 0;
            reels[k].a = p.from + (p.to - p.from) * e + back;
            const s = Math.floor(reels[k].a / SLOT);
            if (s !== p.last) { p.last = s; if (k === plan.findIndex(x => !x.stopped)) onTick?.(k, 1 - u); }
            if (u >= 1 && !p.stopped) { p.stopped = true; reels[k].a = p.to % TAU; onStop?.(k); }
            if (u < 1) all = false;
          });
          if (all) { st.spinning = false; done(); } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },
    win(pays) {
      if (pays == null) { st.winT = -1; return; }
      st.winT = performance.now() / 1000; st.pays = pays;
      const n = Math.min(COINS, 20 + Math.round(Math.sqrt(pays) * 8));
      for (let i = 0; i < n; i++) {
        const c = coins[i];
        c.p.set((Math.random() - .5) * 1.8, REEL_Y - WIN_H / 2, .5);
        c.v.set((Math.random() - .5) * 2.4, 1.5 + Math.random() * 2.6, .6 + Math.random() * 1.4);
        c.r.set(Math.random() * TAU, Math.random() * TAU, 0);
        c.w.set((Math.random() - .5) * 20, (Math.random() - .5) * 20, (Math.random() - .5) * 10);
        c.life = 2.2 + Math.random() * 1.6 + i * .012;
      }
    },
    setPull(p) { st.pullTo = Math.max(0, Math.min(1, p)); if (st.pullTo > st.pull) st.pull = st.pullTo; },
    hitLever(cx, cy) {
      const r = canvas.getBoundingClientRect();
      ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObject(hitBox).length > 0;
    },
    setHue(hex) { paint.color.set(hex); neonMat.color.set(hex); neonGlowMat.color.set(hex); poolMat.color.set(hex); },
    setArmed(on) { st.armed = on; },
    destroy() {
      running = false;
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      disposables.forEach(d => d.dispose());
      env.dispose();
      host.dispose();
    }
  };
}
