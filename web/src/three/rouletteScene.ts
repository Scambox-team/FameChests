// Ruletka 3D: drewniana misa, koło z kieszeniami i kulka. Wynik przychodzi z serwera, scena tylko go pokazuje:
// koło kręci się w prawo, kulka w lewo po torze, zjeżdża po skosie, odbija się od przegródek i staje w wylosowanej kieszeni
// zawsze z przodu, przy widzu (kąt 0 = oś +z). Kieszeń i to koło: kąt i * step w układzie koła.
import * as THREE from 'three';
import { crateEnvironment, softDot } from './crateModel';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TAU = Math.PI * 2;

// wymiary (jednostki sceny): koło do R_WHEEL, kieszenie R_POCKET_IN..R_POCKET_OUT, tor kulki na misie od R_BOWL_IN
const R_WHEEL = 2, R_POCKET_IN = 1.24, R_POCKET_OUT = 1.62, R_REST = 1.43, R_BOWL_IN = 2.03, R_TRACK = 2.42, BALL = .075;
const SLOPE = .2 / .47;   // wznoszenie toru: od R_BOWL_IN w górę do zewnętrznej ścianki
const trackY = (r: number) => .02 + (r - R_BOWL_IN) * SLOPE + BALL;

// widok domyślny: z przodu i z góry (jak dawne camera.position 0, 5.1, 5.6), granice przybliżenia
const VIEW = { pitch: Math.atan2(5.1, 5.6), dist: Math.hypot(5.1, 5.6), min: 2.6, max: 14 };

const ease = (t: number, p: number) => 1 - Math.pow(1 - t, p);
const smooth = (a: number, b: number, t: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

function woodTexture(base: string, line: string) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = base; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * 512, a = .04 + Math.random() * .12;
    x.strokeStyle = line; x.globalAlpha = a; x.lineWidth = .6 + Math.random() * 2.2;
    x.beginPath();
    for (let px = 0; px <= 512; px += 16) x.lineTo(px, y + Math.sin(px / (40 + i % 30) + i) * 3);
    x.stroke();
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tarcza koła widziana z góry: pierścień z numerami, kieszenie i drewniany środek (UV koła = płaskie z góry) */
function faceTexture(wheel: number[], red: number[]) {
  const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!, k = S / 2 / R_WHEEL, mid = S / 2, step = TAU / wheel.length;
  const col = (n: number) => n === 0 ? ['#14a865', '#0b6b3f'] : red.includes(n) ? ['#d0302c', '#7d1512'] : ['#1c1d22', '#0b0b0e'];
  // punkt pod kątem a w układzie koła: x = sin a, z = cos a; na płótnie oś z idzie w dół (patrz UV w rotation.x = -PI/2)
  const sector = (r0: number, r1: number, a0: number, a1: number) => {
    x.beginPath();
    x.arc(mid, mid, r1 * k, Math.PI / 2 - a1, Math.PI / 2 - a0);
    x.arc(mid, mid, r0 * k, Math.PI / 2 - a0, Math.PI / 2 - a1, true);
    x.closePath();
  };
  x.fillStyle = '#2a140b'; x.fillRect(0, 0, S, S);
  wheel.forEach((n, i) => {
    const a0 = (i - .5) * step, a1 = (i + .5) * step, [c1, c2] = col(n);
    sector(R_POCKET_OUT, R_WHEEL - .03, a0, a1);
    const g = x.createRadialGradient(mid, mid, R_POCKET_OUT * k, mid, mid, R_WHEEL * k);
    g.addColorStop(0, c2); g.addColorStop(.5, c1); g.addColorStop(1, c2);
    x.fillStyle = g; x.fill();
    sector(R_POCKET_IN, R_POCKET_OUT, a0, a1);
    const p = x.createRadialGradient(mid, mid, R_POCKET_IN * k, mid, mid, R_POCKET_OUT * k);
    p.addColorStop(0, '#050506'); p.addColorStop(.35, c2); p.addColorStop(1, c1);
    x.fillStyle = p; x.fill();
    // numer: tekst stoi tangencjalnie, góra liter na zewnątrz koła
    const a = i * step, r = (R_POCKET_OUT + R_WHEEL) / 2 * k;
    x.save();
    x.translate(mid + Math.sin(a) * r, mid + Math.cos(a) * r);
    x.rotate(Math.PI - a);
    x.fillStyle = '#fff'; x.font = `800 ${Math.round(k * .2)}px "Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = '#0009'; x.shadowBlur = 6;
    x.fillText(String(n), 0, 0);
    x.restore();
  });
  // złote linie: obwódki pierścieni i granice pól z numerami
  x.strokeStyle = '#e0bd62'; x.lineWidth = 5;
  for (const r of [R_POCKET_IN, R_POCKET_OUT, R_WHEEL - .03]) { x.beginPath(); x.arc(mid, mid, r * k, 0, TAU); x.stroke(); }
  x.lineWidth = 3;
  wheel.forEach((_, i) => {
    const a = (i - .5) * step;
    x.beginPath();
    x.moveTo(mid + Math.sin(a) * R_POCKET_OUT * k, mid + Math.cos(a) * R_POCKET_OUT * k);
    x.lineTo(mid + Math.sin(a) * (R_WHEEL - .03) * k, mid + Math.cos(a) * (R_WHEEL - .03) * k);
    x.stroke();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export interface RouletteScene {
  spin(n: number, opts?: { fast?: boolean; onTick?: (strength: number) => void }): Promise<void>;
  result(win: boolean | null): void;
  /** Kamera gracza: obrót (radiany w poziomie i pionie), przybliżenie (ujemne = bliżej); zwraca false, gdy zoom doszedł do granicy */
  orbit(dYaw: number, dPitch: number): void;
  zoom(delta: number): boolean;
  resetView(): void;
  destroy(): void;
}

/** spot: miejsce na stronie, w którym ma stać koło (tło całej strony: płótno na cały ekran, koło w kadrze nad tym miejscem) */
export function createRouletteScene(canvas: HTMLCanvasElement, wheel: number[], red: number[], spot?: () => DOMRect | null): RouletteScene {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, spot ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 60);
  const env = crateEnvironment(renderer);
  scene.environment = env.texture;
  scene.environmentIntensity = .7;
  scene.add(new THREE.HemisphereLight('#fff4e0', '#140a06', .6));
  const key = new THREE.DirectionalLight('#fff1d6', 2.6); key.position.set(-2.5, 7, 3.5); scene.add(key);
  const rim = new THREE.DirectionalLight('#9fb6ff', 1.2); rim.position.set(4, 3, -5); scene.add(rim);
  const glow = new THREE.PointLight('#ffcf5a', 0, 3, 1.6); scene.add(glow);

  const step = TAU / wheel.length;
  const wood = woodTexture('#3b1a0d', '#120602'), woodLight = woodTexture('#6b3a1e', '#2a1206');
  const face = faceTexture(wheel, red);
  const disposables: { dispose(): void }[] = [wood, woodLight, face];
  const keep = <T extends { dispose(): void }>(o: T) => { disposables.push(o); return o; };

  // stół pod kołem: ciemne sukno z plamą światła z lampy nad stołem, krawędzie znikają w tle strony
  if (spot) {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(512, 512, 0, 512, 512, 512);
    g.addColorStop(0, '#163a29'); g.addColorStop(.3, '#0d2219'); g.addColorStop(.62, '#060f0b'); g.addColorStop(1, '#060f0b00');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 9000; i++) { x.fillStyle = Math.random() < .5 ? '#ffffff06' : '#00000010'; x.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2); }
    // złota linia pola do gry na suknie
    x.strokeStyle = '#e0bd6240'; x.lineWidth = 3;
    x.beginPath(); x.arc(512, 512, 250, 0, TAU); x.stroke();
    x.beginPath(); x.arc(512, 512, 262, 0, TAU); x.stroke();
    const felt = keep(new THREE.CanvasTexture(c));
    felt.colorSpace = THREE.SRGBColorSpace;
    const table = new THREE.Mesh(keep(new THREE.PlaneGeometry(30, 30)), keep(new THREE.MeshStandardMaterial({ map: felt, transparent: true, roughness: .95, depthWrite: false })));
    table.rotation.x = -Math.PI / 2; table.position.y = -.33;
    scene.add(table);
  }

  const gold = keep(new THREE.MeshStandardMaterial({ color: '#d8b15a', metalness: 1, roughness: .22 }));
  const lacquer = keep(new THREE.MeshPhysicalMaterial({ map: wood, roughness: .35, clearcoat: 1, clearcoatRoughness: .08 }));
  const satin = keep(new THREE.MeshPhysicalMaterial({ map: wood, roughness: .55, clearcoat: .35, clearcoatRoughness: .45 }));
  const track = keep(new THREE.MeshPhysicalMaterial({ map: woodLight, color: '#d9b08a', roughness: .4, clearcoat: .8, clearcoatRoughness: .15 }));

  // ---------------------------------------------------------------- misa (nie kręci się)
  const bowlProfile = [
    [R_BOWL_IN, -.06], [R_BOWL_IN, .02], [2.5, .22], [2.56, .24], [2.6, .52], [2.66, .56], [2.98, .56], [3.04, .5], [3.06, -.25], [2.2, -.32]
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bowl = new THREE.Mesh(keep(new THREE.LatheGeometry(bowlProfile, 160)), lacquer);
  scene.add(bowl);
  // tor kulki: jaśniejszy pas na skosie misy
  const trackMesh = new THREE.Mesh(keep(new THREE.LatheGeometry([new THREE.Vector2(R_BOWL_IN + .01, .024), new THREE.Vector2(2.5, .224), new THREE.Vector2(2.56, .244)], 160)), track);
  trackMesh.position.y = .002;
  scene.add(trackMesh);
  const rimRing = new THREE.Mesh(keep(new THREE.TorusGeometry(2.66, .025, 12, 160)), gold);
  rimRing.rotation.x = Math.PI / 2; rimRing.position.y = .56; scene.add(rimRing);
  // romby na torze: kulka się od nich odbija
  const diamondGeo = keep(new THREE.OctahedronGeometry(.075));
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + step / 2, r = 2.27, m = new THREE.Mesh(diamondGeo, gold);
    m.position.set(Math.sin(a) * r, trackY(r) - BALL + .03, Math.cos(a) * r);
    m.scale.set(.7, .55, 1.7); m.rotation.y = a;
    scene.add(m);
  }

  // ---------------------------------------------------------------- koło (kręci się)
  const spinner = new THREE.Group();
  scene.add(spinner);
  const faceMesh = new THREE.Mesh(keep(new THREE.CircleGeometry(R_WHEEL, 160)), keep(new THREE.MeshPhysicalMaterial({ map: face, roughness: .42, clearcoat: .7, clearcoatRoughness: .2 })));
  faceMesh.rotation.x = -Math.PI / 2;
  spinner.add(faceMesh);
  const side = new THREE.Mesh(keep(new THREE.CylinderGeometry(R_WHEEL, R_WHEEL - .02, .16, 160, 1, true)), lacquer);
  side.position.y = -.08; spinner.add(side);
  // przegródki między kieszeniami
  const fretGeo = keep(new THREE.BoxGeometry(.022, .085, R_POCKET_OUT - R_POCKET_IN));
  const frets = new THREE.InstancedMesh(fretGeo, gold, wheel.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  wheel.forEach((_, i) => {
    const a = (i + .5) * step, r = (R_POCKET_IN + R_POCKET_OUT) / 2;
    m4.compose(new THREE.Vector3(Math.sin(a) * r, .04, Math.cos(a) * r), q.setFromAxisAngle(up, a), new THREE.Vector3(1, 1, 1));
    frets.setMatrixAt(i, m4);
  });
  spinner.add(frets);
  for (const r of [R_POCKET_IN, R_POCKET_OUT]) {
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(r, .018, 8, 160)), gold);
    ring.rotation.x = Math.PI / 2; ring.position.y = .03; spinner.add(ring);
  }
  // stożek w środku z wieżyczką i czterema ramionami
  const cone = new THREE.Mesh(keep(new THREE.LatheGeometry([[R_POCKET_IN, 0], [1.05, .08], [.6, .26], [.3, .4], [.16, .46], [0, .47]].map(([r, y]) => new THREE.Vector2(r, y)), 96)), satin);
  spinner.add(cone);
  const turret = new THREE.Mesh(keep(new THREE.LatheGeometry([[.16, .45], [.1, .55], [.07, .78], [.12, .86], [.05, .95], [0, .97]].map(([r, y]) => new THREE.Vector2(r, y)), 48)), gold);
  spinner.add(turret);
  const armGeo = keep(new THREE.CylinderGeometry(.022, .03, .62, 12)), knobGeo = keep(new THREE.SphereGeometry(.055, 20, 14));
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU, arm = new THREE.Mesh(armGeo, gold);
    arm.position.set(Math.sin(a + Math.PI / 2) * .31, .74, Math.cos(a + Math.PI / 2) * .31);
    arm.lookAt(0, .74, 0); arm.rotateX(Math.PI / 2);
    spinner.add(arm);
    const knob = new THREE.Mesh(knobGeo, gold);
    knob.position.set(Math.sin(a + Math.PI / 2) * .62, .74, Math.cos(a + Math.PI / 2) * .62);
    spinner.add(knob);
  }

  // ---------------------------------------------------------------- kulka z cieniem
  const ball = new THREE.Mesh(keep(new THREE.SphereGeometry(BALL, 32, 20)), keep(new THREE.MeshPhysicalMaterial({ color: '#f6f6f2', roughness: .12, clearcoat: 1, clearcoatRoughness: .05 })));
  scene.add(ball);
  const dot = keep(softDot());
  const shadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(.34, .34)), keep(new THREE.MeshBasicMaterial({ map: dot, color: '#000', transparent: true, opacity: .55, depthWrite: false })));
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);
  const flare = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: dot, color: '#ffd76a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })));
  flare.scale.setScalar(1.1);
  scene.add(flare);

  // ---------------------------------------------------------------- stan i animacja
  const st = {
    wheelA: 0, ballRel: Math.random() * TAU, ballR: R_TRACK, ballY: trackY(R_TRACK), inPocket: false,
    spinning: false, glow: 0, glowTo: 0, zoom: 0, zoomTo: 0, win: null as boolean | null,
    // kamera na sferze wokół koła: yaw 0 = od strony widza (+z), pitch nad stołem, dist od środka; *To = cel, do którego płynie
    yaw: 0, pitch: VIEW.pitch, dist: VIEW.dist, yawTo: 0, pitchTo: VIEW.pitch, distTo: VIEW.dist
  };
  let W = 0, H = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.round(r.width); H = Math.round(r.height);
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    camera.aspect = spot ? 1 : W / H;
    aimed = '';
    camera.updateProjectionMatrix();
  }
  // tło strony: kadr kwadratowy V × V wokół środka miejsca na koło, wycięty z niego cały ekran (setViewOffset)
  let aimed = '';
  function aim(r: DOMRect | null) {
    if (!r || !W || !H) return;
    const V = Math.min(Math.max(r.width, Math.min(r.height, r.width * 1.25)) * 1.28, Math.min(W, H) * 1.35), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const k = `${Math.round(V)}|${Math.round(cx)}|${Math.round(cy)}|${W}|${H}`;
    if (k === aimed) return;
    aimed = k;
    camera.setViewOffset(V, V, V / 2 - cx, V / 2 - cy, W, H);
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

  function place() {
    spinner.rotation.y = st.wheelA;
    const a = st.wheelA + st.ballRel;
    ball.position.set(Math.sin(a) * st.ballR, st.ballY, Math.cos(a) * st.ballR);
    ball.rotation.x -= .2; ball.rotation.z += .13;
    const floor = st.ballR >= R_BOWL_IN ? trackY(st.ballR) - BALL : .0;
    shadow.position.set(ball.position.x, floor + .006, ball.position.z);
    shadow.material.opacity = .55 - Math.min(.4, (st.ballY - BALL - floor) * 2);
  }

  let last = performance.now(), running = true, visible = true, raf = 0;
  function frame(now: number) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!visible) return;
    if (!st.spinning && st.win == null && !reduced) st.wheelA += dt * .18;   // w spoczynku koło powoli się obraca, kulka jedzie w kieszeni
    st.zoom += (st.zoomTo - st.zoom) * Math.min(1, dt * 2.2);
    st.glow += (st.glowTo - st.glow) * Math.min(1, dt * 4);
    // kamera: z przodu i z góry; po wyniku podjeżdża do kieszeni przy widzu
    const z = st.zoom, t = now / 1000, follow = Math.min(1, dt * 8);
    st.yaw += (st.yawTo - st.yaw) * follow; st.pitch += (st.pitchTo - st.pitch) * follow; st.dist += (st.distTo - st.dist) * follow;
    // po wyniku kamera podjeżdża bliżej i celuje w kieszeń z kulką (przy widzu), z widoku wybranego przez gracza
    const d = st.dist * (1 - z * .3), cp = Math.cos(st.pitch), sway = st.yawTo === 0 && st.distTo === VIEW.dist ? Math.sin(t * .15) * .03 * (1 - z) : 0;
    camera.position.set(Math.sin(st.yaw + sway) * cp * d, Math.sin(st.pitch) * d - z * .4, Math.cos(st.yaw + sway) * cp * d);
    camera.lookAt(0, 0, .25 + z * 1.05);
    place();
    const front = ball.position;
    glow.position.set(front.x, .6, front.z);
    glow.intensity = st.glow * (st.win ? 6 : 2) * (1 + Math.sin(t * 6) * .15);
    glow.color.set(st.win ? '#ffcf5a' : '#ff5a5a');
    flare.position.set(front.x, front.y + .05, front.z);
    flare.material.opacity = st.glow * (st.win ? .9 : .35) * (1 + Math.sin(t * 6) * .2);
    if (spot) aim(spot());
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  const vis = () => { visible = !document.hidden; last = performance.now(); };
  document.addEventListener('visibilitychange', vis);
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; last = performance.now(); });
  io.observe(canvas);

  return {
    spin(n, { fast = false, onTick } = {}) {
      const idx = Math.max(0, wheel.indexOf(n));
      st.spinning = true; st.glowTo = 0; st.zoomTo = 0; st.win = null;
      const D = reduced ? 600 : fast ? 2600 : 7200, turns = fast ? 3 : 5;
      // koło staje tak, żeby wylosowana kieszeń była z przodu (kąt świata 0), z lekkim rozrzutem w obrębie kieszeni
      const w0 = st.wheelA, jitter = (Math.random() - .5) * .5 * step;
      const w1 = w0 + turns * TAU + ((((-idx * step + jitter - w0) % TAU) + TAU) % TAU);
      // kulka względem koła: wiele obrotów w przeciwną stronę, na końcu dokładnie w kieszeni idx
      const r0 = st.ballRel, ballTurns = fast ? 6 : 11;
      const target = idx * step;
      const r1 = target - Math.ceil((r0 - target) / TAU + ballTurns) * TAU;
      const startR = st.ballR, startY = st.ballY;
      const bump = .55 + Math.random() * .1;   // kiedy kulka trafia na romb
      let lastPocket = -1, lastTick = 0;
      return new Promise<void>(done => {
        const t0 = performance.now();
        const tick = (now: number) => {
          const u = Math.min(1, (now - t0) / D);
          st.wheelA = w0 + (w1 - w0) * ease(u, 3);
          st.ballRel = r0 + (r1 - r0) * ease(u, 2.2);
          // promień: wyjście z kieszeni na tor, jazda po torze, zjazd po skosie, odbicia w przegródkach, kieszeń
          let r: number, y: number;
          if (u < .08) { const s = smooth(0, .08, u); r = startR + (R_TRACK - startR) * s; y = startY + (trackY(R_TRACK) - startY) * s + Math.sin(s * Math.PI) * .25; }
          else if (u < .55) { r = R_TRACK + Math.sin(u * 60) * .004; y = trackY(r); }
          else if (u < .7) {
            const s = smooth(.55, .7, u); r = R_TRACK + (R_BOWL_IN - .02 - R_TRACK) * s;
            y = r >= R_BOWL_IN ? trackY(r) : BALL + .02;
            const b = Math.max(0, 1 - Math.abs(u - bump) / .02); y += b * .09; r -= b * .03;
          } else {
            const s = smooth(.7, .93, u); r = R_BOWL_IN - .02 + (R_REST - (R_BOWL_IN - .02)) * s;
            const hop = Math.abs(Math.sin(s * Math.PI * 3.5)) * (1 - s) * .16;
            y = BALL + .005 + hop + (r > R_POCKET_OUT ? .0 : -.02 * s);
          }
          st.ballR = r; st.ballY = y;
          // tyknięcia: przegródki pod kulką, gdy kulka jest już na kole; wcześniej romby i kieszenie przy widzu
          // tyknięcia od pierwszej klatki: kulka mija kieszenie (względem koła); przy dużej prędkości najwyżej co 45 ms
          const pocket = Math.floor((((st.ballRel % TAU) + TAU) % TAU) / step);
          if (pocket !== lastPocket) {
            if (lastPocket >= 0 && now - lastTick > (r < R_BOWL_IN ? 30 : 45)) { onTick?.(Math.max(.25, 1 - u * .8)); lastTick = now; }
            lastPocket = pocket;
          }
          if (u < 1) requestAnimationFrame(tick);
          else { st.wheelA = w1 % TAU; st.ballRel = ((target % TAU) + TAU) % TAU; st.inPocket = true; st.spinning = false; done(); }
        };
        requestAnimationFrame(tick);
      });
    },
    orbit(dYaw, dPitch) {
      st.yawTo += dYaw;
      st.pitchTo = Math.min(1.45, Math.max(.42, st.pitchTo + dPitch));
    },
    zoom(delta) {
      const to = Math.min(VIEW.max, Math.max(VIEW.min, st.distTo * (1 + delta)));
      const moved = to !== st.distTo;
      st.distTo = to;
      return moved;
    },
    resetView() {
      st.yawTo = Math.round(st.yawTo / TAU) * TAU; st.pitchTo = VIEW.pitch; st.distTo = VIEW.dist;
    },
    result(win) {
      st.win = win;
      st.glowTo = win == null ? 0 : 1;
      st.zoomTo = win == null || reduced ? 0 : .55;
    },
    destroy() {
      running = false; cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      disposables.forEach(d => d.dispose());
      env.dispose();
      renderer.dispose();
    }
  };
}
