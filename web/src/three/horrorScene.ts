// Mgła (zakładka Gry -> Mgła): horror 3D w stylu kaset analog horror. Gracz chodzi z latarką po lesie, w którym drzewa tworzą
// labirynt (korytarze, ślepe zaułki, kilka polan), zbiera kasety VHS i ucieka bramą, zanim dopadnie go potwór.
// Wszystko jest tu: scena three.js renderowana w niskiej rozdzielczości i przepuszczana przez własny filtr „taśmy” (szum, linie,
// rozjechane kolory, winieta, zakłócenia rosnące, gdy potwór jest blisko), HUD z HTML poniżej, syntezator Web Audio i wejście
// (klawiatura + mysz z Pointer Lock, na telefonie joystick i przeciąganie). Gra działa w PEŁNYM EKRANIE: `start()` trzeba wywołać
// z kliknięcia (Fullscreen API wymaga gestu); bez pełnego ekranu (np. iOS Safari) kontener `.hz3` i tak leży na całym oknie.
// Wygląd potwora: tylko three/horrorMonster.ts (createMonster). Ładować wyłącznie dynamicznym import() po sprawdzeniu use3D().
// Styl: features/horror/hz3.css (wszystko pod `.hz3`, animacje `hz3-*`). Bez nagród: rekord tylko w localStorage (features/horror/best.ts).
import * as THREE from 'three';
import { createMonster, type Monster } from './horrorMonster';
import { clock, readBest, saveBest } from '../features/horror/best';

export interface HorrorHooks {
  volume: () => number;
  soundOn: () => boolean;
  /** gracz wybrał „Wyjdź z gry” (strona chowa kontener i woła destroy) */
  onExit: () => void;
}
export interface Horror3D { start: () => void; pause: () => void; destroy: () => void }

const TAPES = 6;          // kasety do zebrania
const BATTERIES = 4;
const CELLS = 10;         // labirynt CELLS x CELLS komórek
const G = CELLS * 2 + 1;  // bloki labiryntu (komórki + ściany z drzew)
const RING = 2;           // pas gęstego lasu dookoła
const N = G + RING * 2;   // cała siatka bloków
const B = 3.2;            // bok bloku w metrach
const EYE = 1.62, RADIUS = 0.3;
const WALK = 3.0, SPRINT = 5.6;
const CATCH = 0.85;
const FOG = 0x0c1015;
const LINES = ['ON JUŻ IDZIE', 'NIE OGLĄDAJ SIĘ ZA SIEBIE', 'ŚWIATŁO GO SPOWALNIA', 'SŁYSZY TWOJE KROKI', 'ZOSTAŁA OSTATNIA'];

const HTML = `
<div class="hz3-pad" aria-hidden="true"></div>
<div class="hz3-hud">
  <div class="hz3-tl"><span class="hz3-rec"><i></i>REC</span><span class="hz3-tc">0:00</span></div>
  <div class="hz3-tr"><span>KASETY</span> <b class="hz3-n">0</b><b>/${TAPES}</b></div>
  <div class="hz3-bars">
    <div class="hz3-bar hz3-bat"><span>LATARKA</span><i><b></b></i></div>
    <div class="hz3-bar hz3-sta"><span>KONDYCJA</span><i><b></b></i></div>
  </div>
  <div class="hz3-date">18.11.1996</div>
  <div class="hz3-msg" role="status" aria-live="polite"></div>
  <div class="hz3-hint"></div>
</div>
<div class="hz3-touch">
  <div class="hz3-stick"><i></i></div>
  <div class="hz3-tbtns">
    <button type="button" data-a="light" aria-pressed="true">LATARKA</button>
    <button type="button" data-a="run" aria-pressed="false">BIEG</button>
    <button type="button" data-a="pause">PAUZA</button>
  </div>
</div>
<div class="hz3-scare"></div>
<div class="hz3-menu" hidden><div class="hz3-card"></div></div>`;

const VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// Filtr kasety VHS: rwanie linii, przesuwany pas „trackingu”, rozjechane kanały, szum i śnieg, linie skanowania, winieta.
// CALM = ograniczony ruch / tryb wydajności (bez rwania obrazu i migotania, szum wolniejszy), LITE = jeden odczyt tekstury.
const FS = `
uniform sampler2D tScene; uniform vec2 uRes; uniform float uTime, uDanger, uGlitch, uFade, uScare;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 uv = vUv;
  float t = uTime, d = clamp(uDanger, 0.0, 1.0), g = clamp(uGlitch, 0.0, 1.0);
#if CALM == 0
  float row = floor(uv.y * 180.0);
  float tear = (h21(vec2(row, floor(t * 30.0))) - 0.5) * (0.0015 + d * 0.006 + g * 0.03);
  float by = fract(t * 0.045);
  tear += smoothstep(0.035, 0.0, abs(uv.y - by)) * (0.004 + d * 0.012) * (h21(vec2(row, t)) - 0.2);
  float blk = step(1.0 - g * 0.45, h21(vec2(floor(uv.y * 12.0), floor(t * 12.0))));
  tear += blk * (h21(vec2(floor(t * 12.0), 3.0)) - 0.5) * 0.12;
  uv.x += tear;
  float tn = floor(t * 30.0);
#else
  float tn = floor(t * 6.0);
#endif
  vec3 col;
#if LITE == 1
  col = texture2D(tScene, uv).rgb;
#else
  float ca = 0.0012 + d * 0.004 + g * 0.01;
  col.r = texture2D(tScene, uv + vec2(ca, 0.0)).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - vec2(ca, ca * 0.5)).b;
#endif
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 0.6) * vec3(0.93, 1.03, 0.97) + vec3(0.012, 0.016, 0.014);
  float n = h21(floor(vUv * uRes * 0.5) + tn * vec2(17.3, 9.1));
  col += (n - 0.5) * (0.07 + d * 0.2);
#if CALM == 0
  float snow = (d * d * 0.3 + g * 0.55 + uScare * 0.55) * (0.6 + 0.4 * h21(vec2(tn, 7.0)));
#else
  float snow = (d * d * 0.22 + g * 0.3 + uScare * 0.3);
#endif
  col = mix(col, vec3(n), clamp(snow, 0.0, 0.85));
  col *= 0.86 + 0.14 * sin(vUv.y * uRes.y * 1.5708);
  vec2 q = vUv - 0.5;
  col *= clamp(1.0 - dot(q, q) * (1.5 + d), 0.0, 1.0);
#if CALM == 0
  col *= 1.0 - 0.05 * h21(vec2(floor(t * 20.0), 1.0)) - g * 0.2 * h21(vec2(floor(t * 40.0), 2.0));
#endif
  gl_FragColor = vec4(col * uFade, 1.0);
}`;

type Mode = 'play' | 'pause' | 'scare' | 'over';
interface Pickup { x: number; z: number; obj: THREE.Object3D; taken: boolean }
interface World {
  group: THREE.Group;
  grid: Uint8Array;
  start: [number, number];
  startYaw: number;
  exitZ: number;
  gate: THREE.Group;
  lamp: THREE.Mesh;
  tapes: Pickup[];
  batteries: Pickup[];
  dispose: () => void;
}

export function createHorror3D(el: HTMLElement, hooks: HorrorHooks): Horror3D {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lite = document.documentElement.hasAttribute('data-lite');
  const touchUI = matchMedia('(pointer: coarse)').matches;
  el.classList.add('hz3');
  el.innerHTML = HTML;
  if (touchUI) el.classList.add('hz3-touchon');
  const q = (s: string) => el.querySelector(s) as HTMLElement;
  const ui = {
    pad: q('.hz3-pad'), tc: q('.hz3-tc'), n: q('.hz3-n'), bat: q('.hz3-bat'), sta: q('.hz3-sta'), msg: q('.hz3-msg'), hint: q('.hz3-hint'),
    stick: q('.hz3-stick'), knob: q('.hz3-stick > i'), menu: q('.hz3-menu'), card: q('.hz3-card'), scare: q('.hz3-scare'),
    light: q('[data-a="light"]'), run: q('[data-a="run"]'),
  };

  // ---------- grafika ----------
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lite ? 1 : 1.5));
  const canvas = renderer.domElement;
  canvas.className = 'hz3-cv';
  el.prepend(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.FogExp2(FOG, 0.085);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 38);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0x5d6f8c, 0x2a2018, 0.7));
  const torch = new THREE.SpotLight(0xffeed2, 90, 26, 0.42, 0.5, 1.3);
  torch.position.set(0.22, -0.18, 0);
  camera.add(torch);
  camera.add(torch.target);
  torch.target.position.set(0.05, -0.9, -6);
  const exitLight = new THREE.PointLight(0xff2a18, 0, 28, 1.4);
  scene.add(exitLight);

  // obraz rysujemy w małej rozdzielczości do tekstury, a filtr taśmy rozciąga go na ekran (taniej i bardziej „VHS”)
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
  const post = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false,
    defines: { LITE: lite ? 1 : 0, CALM: calm || lite ? 1 : 0 },
    uniforms: { tScene: { value: rt.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uDanger: { value: 0 }, uGlitch: { value: 0 }, uFade: { value: 1 }, uScare: { value: 0 } },
  });
  const postScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
  quad.frustumCulled = false;
  postScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const resize = () => {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const ih = Math.min(h, lite ? 270 : 400);
    rt.setSize(Math.max(1, Math.round(ih * w / h)), ih);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.uniforms.uRes.value.copy(db);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  // drobny kurz w powietrzu, widoczny w świetle latarki (bez niego w trybie wydajności)
  let dust: THREE.Points | null = null;
  const DUST = 16;
  if (!lite) {
    const pos = new Float32Array(360 * 3);
    for (let i = 0; i < pos.length; i += 3) { pos[i] = Math.random() * DUST; pos[i + 1] = Math.random() * 4; pos[i + 2] = Math.random() * DUST; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9b958a, size: 0.012, transparent: true, opacity: 0.5, depthWrite: false }));
    dust.frustumCulled = false;
    scene.add(dust);
  }

  // ---------- dźwięk (syntezator, bez plików) ----------
  const audio = createAudio(hooks, calm);

  // ---------- świat ----------
  const monster: Monster = createMonster();
  scene.add(monster.object);
  let world: World | null = null;
  let grid: Uint8Array = new Uint8Array(N * N);
  let gateOpen = false, gateAnim = 0;
  const solid = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= N || z >= N) return true;
    const v = grid[z * N + x];
    return v === 1 || (v === 2 && !gateOpen);
  };
  const blockOf = (v: number) => Math.floor(v / B);
  const center = (b: number) => (b + 0.5) * B;

  // pole odległości od gracza (BFS po blokach), którym potwór idzie do celu
  const flow = new Int16Array(N * N);
  let flowFrom = -1;
  const buildFlow = (bx: number, bz: number) => {
    const id = bz * N + bx;
    if (id === flowFrom) return;
    flowFrom = id;
    flow.fill(-1);
    const qq = new Int32Array(N * N);
    let h = 0, t = 0;
    flow[id] = 0; qq[t++] = id;
    while (h < t) {
      const c = qq[h++], cx = c % N, cz = (c / N) | 0;
      for (const [dx, dz] of DIRS) {
        const x = cx + dx, z = cz + dz;
        if (solid(x, z)) continue;
        const n = z * N + x;
        if (flow[n] >= 0) continue;
        flow[n] = flow[c] + 1; qq[t++] = n;
      }
    }
  };

  // ---------- stan ----------
  let mode: Mode = 'over';
  const P = { x: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, stamina: 100, tired: false, rest: 0, battery: 100, light: true, walked: 0, stepAt: 0, tapes: 0, t: 0 };
  const Mo = { x: 0, z: 0, on: false, speed: 0, cool: 0, stepAcc: 0, seen: false };
  let danger = 0, glitch = 0, heart = 0, ping = 0, breath = 0, gateMsg = 0, msgT = 0, lightK = 1;
  let scareT = 0, scarePitch = 0.9, won = false, record = false;
  let locked = false, wasLocked = false;
  const keys = new Set<string>();
  const joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  const look = { id: -1, lx: 0, ly: 0 };
  let mouseDrag = false, runToggle = false;

  const setMsg = (text: string, secs = 3.5) => { ui.msg.textContent = text; ui.msg.classList.add('on'); msgT = secs; };

  function newGame() {
    world?.dispose();
    if (world) scene.remove(world.group);
    world = buildWorld();
    grid = world.grid;
    scene.add(world.group);
    gateOpen = false; gateAnim = 0;
    world.gate.children[0].rotation.y = 0;
    exitLight.intensity = 0;
    exitLight.position.set(center(N - 1), 2.4, center(world.exitZ));
    flowFrom = -1;
    Object.assign(P, { x: center(world.start[0]), z: center(world.start[1]), yaw: world.startYaw, pitch: 0, vx: 0, vz: 0, stamina: 100, tired: false, rest: 0, battery: 100, light: true, walked: 0, stepAt: 0, tapes: 0, t: 0 });
    Object.assign(Mo, { x: -100, z: -100, on: false, speed: 0, cool: 0, stepAcc: 0, seen: false });
    monster.object.visible = false;
    danger = 0; glitch = 0; scareT = 0; won = false; record = false; heart = 0; ping = 0;
    runToggle = false;
    ui.run.setAttribute('aria-pressed', 'false');
    ui.scare.classList.remove('on');
    el.classList.remove('hz3-scaring');
    post.uniforms.uScare.value = 0;
    setMsg(`ZNAJDŹ ${TAPES} KASET I UCIEKAJ BRAMĄ`, 6);
    hud(true);
  }

  // ---------- pełny ekran, kursor ----------
  const fsEl = () => document.fullscreenElement || (document as any).webkitFullscreenElement;
  const enterFs = () => {
    if (fsEl()) return;
    const f = el.requestFullscreen || (el as any).webkitRequestFullscreen;
    if (!f) return;   // np. iOS Safari: zostaje kontener na całe okno
    try {
      const p = f.call(el, { navigationUI: 'hide' });
      p?.then?.(() => { if (touchUI) (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {}); }).catch?.(() => {});
    } catch { /* przeglądarka odmówiła */ }
  };
  const lockPointer = () => {
    if (touchUI || !ui.pad.requestPointerLock) return;
    try { (ui.pad.requestPointerLock() as any)?.catch?.(() => {}); } catch { /* bez blokady: rozglądanie przeciąganiem */ }
  };
  const onFs = () => { if (!fsEl() && mode === 'play') pause(); };
  const onLock = () => {
    locked = document.pointerLockElement === ui.pad;
    if (locked) wasLocked = true;
    else if (wasLocked && mode === 'play') pause();
    if (!locked) wasLocked = false;
  };

  // ---------- menu ----------
  function showMenu(kind: 'pause' | 'over') {
    const b = readBest();
    const stats = (rows: [string, string][]) => `<dl class="hz3-stats">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
    const best = `<div><dt>Rekord</dt><dd>${b.tapes} / ${TAPES}</dd></div>` + (b.escape != null ? `<div><dt>Najszybsza ucieczka</dt><dd>${clock(b.escape)}</dd></div>` : '');
    let h = '';
    if (kind === 'pause') {
      h = `<h2>PAUZA</h2><p>Taśma zatrzymana.</p>${stats([['Czas', clock(P.t)], ['Kasety', `${P.tapes} / ${TAPES}`]])}
        <div class="hz3-acts"><button type="button" data-act="resume" class="hz3-main">Wznów</button><button type="button" data-act="again">Zacznij od nowa</button><button type="button" data-act="exit">Wyjdź z gry</button></div>
        <p class="hz3-keys">WASD / strzałki: ruch, mysz: rozglądanie, Shift: bieg, F: latarka, Esc: pauza</p>`;
    } else {
      h = `<h2>${won ? 'UCIECZKA UDANA' : 'ZŁAPAŁ CIĘ'}</h2><p>${won ? 'Wydostajesz się z lasu.' : 'Koniec taśmy.'}</p>
        <dl class="hz3-stats"><div><dt>Czas</dt><dd>${clock(P.t)}</dd></div><div><dt>Kasety</dt><dd>${P.tapes} / ${TAPES}</dd></div>${best}</dl>
        ${record ? '<p class="hz3-rec2">Nowy rekord</p>' : ''}
        <div class="hz3-acts"><button type="button" data-act="again" class="hz3-main">Zagraj ponownie</button><button type="button" data-act="exit">Wyjdź z gry</button></div>`;
    }
    ui.card.innerHTML = h;
    ui.menu.hidden = false;
    (ui.card.querySelector('.hz3-main') as HTMLElement | null)?.focus({ preventScroll: true });
  }
  const hideMenu = () => { ui.menu.hidden = true; };
  ui.menu.addEventListener('click', e => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (!act) return;
    audio.click();
    if (act === 'resume') { enterFs(); lockPointer(); hideMenu(); mode = 'play'; audio.resume(); }
    else if (act === 'again') start();
    else if (act === 'exit') hooks.onExit();
  });

  function start() {
    enterFs();       // najpierw pełny ekran i kursor: przeglądarka pozwala na nie tylko zaraz po kliknięciu
    lockPointer();
    audio.resume();
    newGame();
    hideMenu();
    mode = 'play';
  }
  function pause() {
    if (mode !== 'play') return;
    mode = 'pause';
    keys.clear(); joy.id = -1; look.id = -1; mouseDrag = false;
    ui.stick.classList.remove('on');
    if (document.pointerLockElement) document.exitPointerLock?.();
    audio.hum(0, 0);
    showMenu('pause');
  }
  function finish(escaped: boolean) {
    won = escaped;
    record = saveBest(P.tapes, escaped, P.t);
    mode = 'over';
    if (document.pointerLockElement) document.exitPointerLock?.();
    audio.hum(0, 0);
    showMenu('over');
  }
  function caught() {
    mode = 'scare';
    scareT = 0;
    keys.clear();
    if (document.pointerLockElement) document.exitPointerLock?.();
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    Mo.x = P.x + fx * 1.2; Mo.z = P.z + fz * 1.2;
    monster.object.visible = true;
    monster.object.position.set(Mo.x, 0, Mo.z);
    monster.object.rotation.y = Math.atan2(P.x - Mo.x, P.z - Mo.z);
    scarePitch = Math.atan2(monster.height * 0.9 - EYE, 0.8);   // patrzymy w (pustą) twarz
    if (!calm) { P.pitch = scarePitch; ui.scare.classList.add('on'); }
    el.classList.add('hz3-scaring');
    hideMenu();
    audio.hum(0, 0);
    audio.scare();
  }

  // ---------- wejście ----------
  const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);
  const onKey = (e: KeyboardEvent) => {
    if (el.hidden) return;
    if (e.type === 'keydown') {
      if (mode === 'play') {
        if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); pause(); return; }
        if (e.code === 'KeyF' && !e.repeat) { toggleLight(); return; }
      } else if (mode === 'pause' && e.code === 'KeyP') { e.preventDefault(); enterFs(); lockPointer(); hideMenu(); mode = 'play'; return; }
      if (GAME_KEYS.has(e.code) && mode === 'play') { e.preventDefault(); keys.add(e.code); }
    } else keys.delete(e.code);
  };
  const toggleLight = () => {
    P.light = !P.light;
    ui.light.setAttribute('aria-pressed', String(P.light));
    audio.click();
  };
  const turn = (dx: number, dy: number, k: number) => {
    P.yaw -= dx * k;
    P.pitch = Math.max(-1.25, Math.min(1.25, P.pitch - dy * k));
  };
  const onMouse = (e: MouseEvent) => {
    if (mode !== 'play') return;
    if (locked || mouseDrag) turn(e.movementX || 0, e.movementY || 0, 0.0022);
  };
  const half = () => el.clientWidth / 2;
  ui.pad.addEventListener('pointerdown', e => {
    if (mode !== 'play') return;
    if (e.pointerType === 'mouse') {
      if (!locked) { lockPointer(); mouseDrag = true; }
      return;
    }
    if (!el.classList.contains('hz3-touchon')) el.classList.add('hz3-touchon');
    try { ui.pad.setPointerCapture?.(e.pointerId); } catch { /* wskaźnik już nieaktywny */ }
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < half() && joy.id < 0) {
      Object.assign(joy, { id: e.pointerId, ox: x, oy: y, x: 0, y: 0 });
      ui.stick.style.left = `${x}px`; ui.stick.style.top = `${y}px`;
      ui.knob.style.transform = '';
      ui.stick.classList.add('on');
    } else if (look.id < 0) Object.assign(look, { id: e.pointerId, lx: e.clientX, ly: e.clientY });
  });
  ui.pad.addEventListener('pointermove', e => {
    if (e.pointerId === joy.id) {
      const r = el.getBoundingClientRect();
      let dx = e.clientX - r.left - joy.ox, dy = e.clientY - r.top - joy.oy;
      const len = Math.hypot(dx, dy), max = 52;
      if (len > max) { dx *= max / len; dy *= max / len; }
      joy.x = dx / max; joy.y = dy / max;
      ui.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === look.id) {
      turn(e.clientX - look.lx, e.clientY - look.ly, 0.0048);
      look.lx = e.clientX; look.ly = e.clientY;
    }
  });
  const up = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') mouseDrag = false;
    if (e.pointerId === joy.id) { joy.id = -1; joy.x = joy.y = 0; ui.stick.classList.remove('on'); }
    if (e.pointerId === look.id) look.id = -1;
  };
  ui.pad.addEventListener('pointerup', up);
  ui.pad.addEventListener('pointercancel', up);
  el.querySelector('.hz3-tbtns')!.addEventListener('pointerdown', e => {
    const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
    if (!a || mode !== 'play') return;
    e.preventDefault();
    if (a === 'light') toggleLight();
    else if (a === 'run') { runToggle = !runToggle; ui.run.setAttribute('aria-pressed', String(runToggle)); }
    else if (a === 'pause') pause();
  });
  const onHide = () => { if (document.hidden) pause(); };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  document.addEventListener('mousemove', onMouse);
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);
  document.addEventListener('pointerlockchange', onLock);
  document.addEventListener('visibilitychange', onHide);
  const onBlur = () => keys.clear();
  window.addEventListener('blur', onBlur);

  // ---------- logika ----------
  const losClear = (x0: number, z0: number, x1: number, z1: number) => {
    const d = Math.hypot(x1 - x0, z1 - z0), steps = Math.ceil(d / 0.45);
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      if (solid(blockOf(x0 + (x1 - x0) * k), blockOf(z0 + (z1 - z0) * k))) return false;
    }
    return true;
  };
  /** gracz mógłby zobaczyć ten punkt (przed nim, blisko, bez drzew po drodze) */
  const visible = (x: number, z: number) => {
    const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
    if (d > 24) return false;
    if (d < 3) return true;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    return (dx * fx + dz * fz) / d > 0.5 && losClear(P.x, P.z, x, z);
  };
  /** potwór stoi w snopie światła latarki */
  const inBeam = () => {
    if (!P.light || P.battery <= 0 || !Mo.on) return false;
    const dx = Mo.x - P.x, dy = 1.7 - EYE, dz = Mo.z - P.z, d = Math.hypot(dx, dy, dz);
    if (d > 16) return false;
    const cp = Math.cos(P.pitch);
    const fx = -Math.sin(P.yaw) * cp, fy = Math.sin(P.pitch), fz = -Math.cos(P.yaw) * cp;
    return (dx * fx + dy * fy + dz * fz) / d > Math.cos(0.45) && losClear(P.x, P.z, Mo.x, Mo.z);
  };
  /** przenosi potwora w niewidoczne miejsce `lo`..`hi` bloków drogi od gracza (najchętniej za plecami) */
  const teleport = (lo: number, hi: number) => {
    buildFlow(blockOf(P.x), blockOf(P.z));
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    for (let tries = 0; tries < 4; tries++) {
      const pick: number[] = [], behind: number[] = [];
      for (let i = 0; i < N * N; i++) {
        const f = flow[i];
        if (f < lo || f > hi) continue;
        const x = center(i % N), z = center((i / N) | 0);
        if (visible(x, z) || Math.hypot(x - P.x, z - P.z) < 9) continue;
        pick.push(i);
        if ((x - P.x) * fx + (z - P.z) * fz < 0) behind.push(i);
      }
      const list = behind.length ? behind : pick;
      if (list.length) {
        const i = list[(Math.random() * list.length) | 0];
        Mo.x = center(i % N); Mo.z = center((i / N) | 0);
        return true;
      }
      lo = Math.max(2, lo - 1); hi += 2;
    }
    return false;
  };

  function step(dt: number) {
    if (!world) return;
    P.t += dt;
    // ruch
    let f = 0, s = 0, tr = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD')) s += 1;
    if (keys.has('KeyA')) s -= 1;
    if (keys.has('ArrowRight')) tr += 1;
    if (keys.has('ArrowLeft')) tr -= 1;
    if (joy.id >= 0) { f -= joy.y; s += joy.x; }
    if (tr) P.yaw -= tr * 2.3 * dt;
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const moving = len > 0.15;
    const wantRun = (keys.has('ShiftLeft') || keys.has('ShiftRight') || runToggle) && f > 0.3;
    const running = wantRun && moving && !P.tired && P.stamina > 0;
    if (running) { P.stamina = Math.max(0, P.stamina - 21 * dt); P.rest = 0.7; if (P.stamina <= 0) { P.tired = true; audio.gasp(); } }
    else { P.rest -= dt; if (P.rest <= 0) P.stamina = Math.min(100, P.stamina + (moving ? 11 : 20) * dt); }
    if (P.tired && P.stamina >= 35) P.tired = false;
    const speed = (running ? SPRINT : WALK) * (P.tired ? 0.75 : 1);
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const tx = (-sy * f + cy * s) * speed, tz = (-cy * f - sy * s) * speed;
    const a = 1 - Math.exp(-dt * 10);
    P.vx += (tx - P.vx) * a; P.vz += (tz - P.vz) * a;
    const ox = P.x, oz = P.z;
    P.x += P.vx * dt; P.z += P.vz * dt;
    collide(P, RADIUS);
    const moved = Math.hypot(P.x - ox, P.z - oz);
    P.walked += moved;
    const stride = running ? 1.05 : 0.78;
    if (P.walked - P.stepAt > stride) { P.stepAt = P.walked; audio.step(running); }

    // latarka: bateria, migotanie przy słabej baterii i przy potworze
    if (P.light && P.battery > 0) P.battery = Math.max(0, P.battery - 0.42 * dt);
    let lk = P.light && P.battery > 0 ? 1 : 0;
    if (lk && P.battery < 15) lk *= 0.45 + P.battery / 30;
    if (lk && !calm && ((P.battery < 12 && Math.random() < 0.12) || (danger > 0.55 && Math.random() < danger * 0.18))) lk *= 0.15;
    lightK += (lk - lightK) * (calm ? 1 - Math.exp(-dt * 6) : 0.6);

    // zbieranie
    for (const tp of world.tapes) {
      if (tp.taken || Math.hypot(tp.x - P.x, tp.z - P.z) > 1.15) continue;
      tp.taken = true; tp.obj.visible = false;
      P.tapes++;
      glitch = calm ? 0.4 : 0.9;
      audio.tape();
      if (P.tapes >= TAPES) {
        gateOpen = true; gateAnim = 0.001; flowFrom = -1;
        exitLight.intensity = 30;
        audio.gate();
        setMsg('BRAMA JEST OTWARTA. SZUKAJ CZERWONEGO ŚWIATŁA', 6);
      } else setMsg(P.tapes === TAPES - 1 ? LINES[LINES.length - 1] : LINES[Math.min(LINES.length - 2, P.tapes - 1)], 3.5);
      if (!Mo.on) activate();
    }
    for (const bt of world.batteries) {
      if (bt.taken || Math.hypot(bt.x - P.x, bt.z - P.z) > 1.1) continue;
      bt.taken = true; bt.obj.visible = false;
      P.battery = Math.min(100, P.battery + 45);
      audio.battery();
      setMsg('NOWA BATERIA', 2.2);
    }
    // brama
    const gx = N - RING - 1;
    if (!gateOpen && blockOf(P.z) === world.exitZ && blockOf(P.x) >= gx - 1) {
      gateMsg -= dt;
      if (gateMsg <= 0) { gateMsg = 5; setMsg('BRAMA JEST ZAMKNIĘTA. ZBIERZ WSZYSTKIE KASETY', 3.5); audio.rattle(); }
    }
    if (gateAnim > 0 && gateAnim < 1) {
      gateAnim = Math.min(1, gateAnim + dt / 1.6);
      world.gate.children[0].rotation.y = -1.75 * (1 - Math.pow(1 - gateAnim, 3));
    }
    if (gateOpen) {
      exitLight.intensity = calm ? 30 : 24 + Math.sin(P.t * 9) * 4 + Math.random() * 5;
      (world.lamp.material as THREE.MeshBasicMaterial).color.setHex(0xff3322);
      ping -= dt;
      if (ping <= 0) {
        ping = 2.2;
        const dx = exitLight.position.x - P.x, dz = exitLight.position.z - P.z, d = Math.hypot(dx, dz) || 1;
        audio.ping(panOf(dx / d, dz / d), Math.max(0.15, 1 - d / 70));
      }
      if (P.x > center(gx + 1)) { finish(true); return; }
    }
    if (!Mo.on && P.t > 25) activate();

    // potwór
    if (Mo.on) monsterStep(dt);

    // zakłócenia
    const md = Mo.on ? Math.hypot(Mo.x - P.x, Mo.z - P.z) : 99;
    const seenNow = Mo.on && inBeam();
    if (seenNow && !Mo.seen && md < 18) { glitch = Math.max(glitch, calm ? 0.3 : 0.85); audio.sting(); }
    Mo.seen = seenNow;
    const raw = Math.max(0, Math.min(1, (15 - md) / 12)) + (seenNow ? 0.2 : 0);
    danger += (Math.min(1, raw) - danger) * (1 - Math.exp(-dt * 3));
    if (!calm && danger > 0.55 && Math.random() < dt * 1.5 * danger) glitch = Math.max(glitch, 0.55);
    glitch *= Math.exp(-dt * 3.2);
    heart -= dt;
    if (danger > 0.22 && heart <= 0) { heart = 1.15 - danger * 0.6; audio.heart(0.25 + danger * 0.6); }
    if (P.tired) { breath -= dt; if (breath <= 0) { breath = 1.05; audio.breath(); } }
    // szum kasety: najbliższa kaseta cicho buczy z jej strony
    let nt: Pickup | null = null, nd = 99;
    for (const tp of world.tapes) if (!tp.taken) { const d = Math.hypot(tp.x - P.x, tp.z - P.z); if (d < nd) { nd = d; nt = tp; } }
    if (nt) audio.hum(panOf((nt.x - P.x) / nd, (nt.z - P.z) / nd), Math.max(0, 1 - nd / 13)); else audio.hum(0, 0);
    if (md < CATCH) caught();
  }

  const panOf = (dx: number, dz: number) => Math.max(-1, Math.min(1, dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw)));

  function activate() {
    Mo.on = true;
    if (!teleport(7, 10)) teleport(4, 20);
    monster.object.visible = true;
    Mo.cool = 8;
  }

  function monsterStep(dt: number) {
    const bx = blockOf(P.x), bz = blockOf(P.z);
    buildFlow(bx, bz);
    const mb = blockOf(Mo.z) * N + blockOf(Mo.x);
    let fd = flow[mb];
    Mo.cool -= dt;
    const dx = P.x - Mo.x, dz = P.z - Mo.z, d = Math.hypot(dx, dz);
    // za daleko (albo nie ma drogi): przeskakuje bliżej, ale tylko gdy gracz tego nie widzi - im więcej kaset, tym bliżej i częściej
    const far = Math.max(7, 13 - P.tapes);
    if ((fd < 0 || fd > far) && Mo.cool <= 0 && !visible(Mo.x, Mo.z)) {
      const lo = Math.max(3, 6 - (P.tapes >> 1));
      if (teleport(lo, lo + 3)) { Mo.cool = Math.max(4, 12 - P.tapes * 1.3); fd = flow[blockOf(Mo.z) * N + blockOf(Mo.x)]; }
    }
    let speed = 1.8 + P.tapes * 0.3 + (P.tapes >= TAPES ? 0.4 : 0);
    if (Mo.seen && d < 14) speed *= 0.55;   // światło go spowalnia
    let tx = P.x, tz = P.z;
    if (fd > 1 && !(d < 5 && losClear(Mo.x, Mo.z, P.x, P.z))) {
      const cx = blockOf(Mo.x), cz = blockOf(Mo.z);
      for (const [ddx, ddz] of DIRS) {
        const x = cx + ddx, z = cz + ddz;
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        if (flow[z * N + x] === fd - 1) { tx = center(x); tz = center(z); break; }
      }
    }
    const mx = tx - Mo.x, mz = tz - Mo.z, ml = Math.hypot(mx, mz);
    const stepLen = Math.min(ml, speed * dt);
    if (ml > 1e-4) { Mo.x += mx / ml * stepLen; Mo.z += mz / ml * stepLen; }
    Mo.speed = stepLen / Math.max(dt, 1e-4);
    Mo.stepAcc += stepLen;
    if (Mo.stepAcc > 1.15) { Mo.stepAcc = 0; if (d < 24) audio.thud(Math.pow(1 - d / 24, 2)); }
    monster.object.position.set(Mo.x, 0, Mo.z);
    // patrzy na gracza, gdy jest blisko, inaczej w kierunku marszu
    const face = d < 8 || ml < 1e-4 ? Math.atan2(dx, dz) : Math.atan2(mx, mz);
    let dr = face - monster.object.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    monster.object.rotation.y += dr * (1 - Math.exp(-dt * 5));
  }

  function collide(p: { x: number; z: number }, r: number) {
    const inset = 0.08;
    for (let pass = 0; pass < 2; pass++) {
      const bx = blockOf(p.x), bz = blockOf(p.z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx, z = bz + dz;
        if (!solid(x, z)) continue;
        const x0 = x * B + inset, x1 = (x + 1) * B - inset, z0 = z * B + inset, z1 = (z + 1) * B - inset;
        const cx = Math.max(x0, Math.min(p.x, x1)), cz = Math.max(z0, Math.min(p.z, z1));
        const ex = p.x - cx, ez = p.z - cz, d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += ex * k; p.z += ez * k; }
        else {   // środek w ścianie: wypchnij najkrótszą drogą
          const opts = [[p.x - x0 + r, -1, 0], [x1 - p.x + r, 1, 0], [p.z - z0 + r, 0, -1], [z1 - p.z + r, 0, 1]].sort((a, b) => a[0] - b[0]);
          p.x += opts[0][1] * opts[0][0]; p.z += opts[0][2] * opts[0][0];
        }
      }
    }
  }

  // ---------- HUD ----------
  const last = { tc: '', n: -1, bat: -1, sta: -1, low: false, tired: false, hint: '' };
  function hud(force = false) {
    const tc = clock(P.t);
    if (force || tc !== last.tc) { ui.tc.textContent = tc; last.tc = tc; }
    if (force || P.tapes !== last.n) { ui.n.textContent = String(P.tapes); last.n = P.tapes; }
    const bat = Math.round(P.battery), sta = Math.round(P.stamina);
    if (force || bat !== last.bat) { (ui.bat.querySelector('b') as HTMLElement).style.width = `${bat}%`; last.bat = bat; }
    if (force || sta !== last.sta) { (ui.sta.querySelector('b') as HTMLElement).style.width = `${sta}%`; last.sta = sta; }
    const low = P.battery < 15;
    if (force || low !== last.low) { ui.bat.classList.toggle('low', low); last.low = low; }
    if (force || P.tired !== last.tired) { ui.sta.classList.toggle('low', P.tired); last.tired = P.tired; }
    const hint = mode === 'play' && !touchUI && !locked && !mouseDrag && !el.classList.contains('hz3-touchon') ? 'Kliknij ekran, żeby rozglądać się myszą' : '';
    if (force || hint !== last.hint) { ui.hint.textContent = hint; ui.hint.classList.toggle('on', !!hint); last.hint = hint; }
  }

  // ---------- pętla ----------
  let raf = 0, prev = performance.now(), time = 0;
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - prev) / 1000));
    prev = now;
    time += dt;
    if (mode === 'play') step(dt);
    if (mode === 'scare') {
      scareT += dt;
      const dur = calm ? 1.9 : 1.25;
      // śnieg tylko błyska (pierwsza klatka i krótkie przebłyski), żeby było widać, kto stoi przed kamerą
      post.uniforms.uScare.value = calm ? Math.min(0.6, scareT / 2) : scareT < 0.08 || Math.random() < 0.18 ? 0.9 : 0;
      if (calm) P.pitch += (scarePitch - P.pitch) * (1 - Math.exp(-dt * 3));
      if (scareT >= dur) { ui.scare.classList.remove('on'); el.classList.remove('hz3-scaring'); finish(false); }
    }
    msgT -= dt;
    if (msgT <= 0 && ui.msg.classList.contains('on')) ui.msg.classList.remove('on');
    if (mode === 'play') hud();

    // kamera: lekkie kołysanie przy chodzeniu, w jumpscare drgania
    const bobK = calm ? 0.012 : 0.04;
    const bob = Math.sin(P.walked / (Math.hypot(P.vx, P.vz) > 4 ? 1.05 : 0.78) * Math.PI);
    camera.position.set(P.x, EYE + Math.abs(bob) * bobK - bobK * 0.5, P.z);
    camera.rotation.set(P.pitch, P.yaw, bob * bobK * 0.25);
    if (mode === 'scare' && !calm) {
      camera.rotation.x += (Math.random() - 0.5) * 0.09; camera.rotation.y += (Math.random() - 0.5) * 0.09;
      camera.position.x += (Math.random() - 0.5) * 0.05;
    }
    torch.intensity = (mode === 'scare' ? 140 : 90) * (mode === 'scare' ? 1 : lightK);
    torch.target.position.y = mode === 'scare' ? 0.4 : -0.9;   // w jumpscare latarka świeci w twarz
    if (Mo.on || mode === 'scare') monster.update({ dt, t: time, speed: mode === 'scare' ? 0 : Mo.speed, seen: Mo.seen || mode === 'scare', danger, calm, attack: mode === 'scare' });
    if (dust) {
      // kurz opada i zawija się wokół gracza, żeby był zawsze dookoła
      const pa = dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pa.array as Float32Array, hd = DUST / 2;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= dt * 0.08; if (arr[i + 1] < 0) arr[i + 1] += 4;
        while (arr[i] < P.x - hd) arr[i] += DUST; while (arr[i] > P.x + hd) arr[i] -= DUST;
        while (arr[i + 2] < P.z - hd) arr[i + 2] += DUST; while (arr[i + 2] > P.z + hd) arr[i + 2] -= DUST;
      }
      pa.needsUpdate = true;
    }
    audio.update(mode === 'play' || mode === 'scare' ? danger : 0, mode === 'pause' || mode === 'over');

    post.uniforms.uTime.value = time;
    post.uniforms.uDanger.value = mode === 'scare' ? 0.45 : danger;
    post.uniforms.uGlitch.value = mode === 'scare' && !calm ? 0.15 + Math.random() * 0.3 : glitch;
    const fadeTo = mode === 'play' || mode === 'scare' ? 1 : 0.35;
    post.uniforms.uFade.value += (fadeTo - post.uniforms.uFade.value) * (1 - Math.exp(-dt * 4));
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }
  raf = requestAnimationFrame(frame);

  function destroy() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('mousemove', onMouse);
    document.removeEventListener('fullscreenchange', onFs);
    document.removeEventListener('webkitfullscreenchange', onFs);
    document.removeEventListener('pointerlockchange', onLock);
    document.removeEventListener('visibilitychange', onHide);
    mode = 'over';
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (fsEl() === el) (document.exitFullscreen || (document as any).webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    try { (screen.orientation as any)?.unlock?.(); } catch { /* bez blokady */ }
    audio.close();
    world?.dispose();
    monster.dispose();
    if (dust) { dust.geometry.dispose(); (dust.material as THREE.Material).dispose(); }
    quad.geometry.dispose(); post.dispose(); rt.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
    el.innerHTML = '';
    el.classList.remove('hz3-touchon');
  }
  // podgląd stanu do testów w trybie deweloperskim (w zbudowanej grze tego nie ma)
  if (import.meta.env.DEV) (window as any).__hzDebug = { P, Mo, get world() { return world; }, activate, caught, tick: (ms: number) => { cancelAnimationFrame(raf); frame(prev + ms); } };

  return { start, pause, destroy };
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- mapa ----------
/** Las-labirynt: komórki labiryntu (algorytm z cofaniem), kilka przebić (pętle, żeby dało się uciekać) i polan,
 *  bloki-ściany z gęstych drzew i krzaków (InstancedMesh: kilka wywołań rysowania na cały las). */
function buildWorld(): World {
  const grid = new Uint8Array(N * N).fill(1);
  const set = (x: number, z: number, v: number) => { grid[z * N + x] = v; };
  const get = (x: number, z: number) => (x < 0 || z < 0 || x >= N || z >= N ? 1 : grid[z * N + x]);
  const cb = (c: number) => RING + c * 2 + 1;
  const rnd = Math.random;
  // labirynt
  const seen = new Uint8Array(CELLS * CELLS);
  const sz0 = (rnd() * CELLS) | 0;
  const stack: [number, number][] = [[0, sz0]];
  seen[sz0 * CELLS] = 1;
  set(cb(0), cb(sz0), 0);
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const opts = DIRS.filter(([dx, dz]) => { const x = cx + dx, z = cz + dz; return x >= 0 && z >= 0 && x < CELLS && z < CELLS && !seen[z * CELLS + x]; });
    if (!opts.length) { stack.pop(); continue; }
    const [dx, dz] = opts[(rnd() * opts.length) | 0];
    const nx = cx + dx, nz = cz + dz;
    seen[nz * CELLS + nx] = 1;
    set(cb(cx) + dx, cb(cz) + dz, 0);
    set(cb(nx), cb(nz), 0);
    stack.push([nx, nz]);
  }
  // przebicia ścian (pętle)
  for (let lz = 1; lz < G - 1; lz++) for (let lx = 1; lx < G - 1; lx++) {
    const between = (lx % 2 === 0) !== (lz % 2 === 0);
    if (between && get(RING + lx, RING + lz) === 1 && rnd() < 0.11) set(RING + lx, RING + lz, 0);
  }
  // polany
  for (let i = 0; i < 3; i++) {
    const cx = cb(1 + ((rnd() * (CELLS - 2)) | 0)), cz = cb(1 + ((rnd() * (CELLS - 2)) | 0));
    for (let z = cz - 1; z <= cz + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) set(x, z, 0);
  }
  // odległości od startu
  const sx = cb(0), sz = cb(sz0);
  const dist = new Int16Array(N * N).fill(-1);
  const qq: number[] = [sz * N + sx];
  dist[qq[0]] = 0;
  for (let h = 0; h < qq.length; h++) {
    const c = qq[h], cx = c % N, cz = (c / N) | 0;
    for (const [dx, dz] of DIRS) {
      const x = cx + dx, z = cz + dz;
      if (get(x, z) !== 0 || dist[z * N + x] >= 0) continue;
      dist[z * N + x] = dist[c] + 1; qq.push(z * N + x);
    }
  }
  // wyjście: brama we wschodniej ścianie, przy komórce najdalszej od startu; za nią droga przez pas lasu
  let exitZ = cb(0), bestD = -1;
  for (let c = 0; c < CELLS; c++) { const d = dist[cb(c) * N + cb(CELLS - 1)]; if (d > bestD) { bestD = d; exitZ = cb(c); } }
  const gateX = RING + G - 1;
  set(gateX, exitZ, 2);
  for (let x = gateX + 1; x < N; x++) set(x, exitZ, 0);
  // start patrzy w stronę wolnego korytarza
  let startYaw = -Math.PI / 2;
  for (const [dx, dz] of DIRS) if (get(sx + dx, sz + dz) === 0) { startYaw = Math.atan2(-dx, -dz); break; }

  // kasety w ślepych zaułkach daleko od startu (rozrzucone jak najszerzej), baterie w innych zakątkach
  const cellsOpen: number[] = [], deadEnds: number[] = [];
  for (let cz = 0; cz < CELLS; cz++) for (let cx = 0; cx < CELLS; cx++) {
    const x = cb(cx), z = cb(cz), id = z * N + x;
    if (grid[id] !== 0 || dist[id] < 0) continue;
    cellsOpen.push(id);
    const open = DIRS.filter(([dx, dz]) => get(x + dx, z + dz) === 0).length;
    if (open === 1 && dist[id] >= 5) deadEnds.push(id);
  }
  const pos = (id: number): [number, number] => [(id % N + 0.5) * B, (((id / N) | 0) + 0.5) * B];
  const chosen: number[] = [];
  const spread = (pool: number[], count: number, avoid: number[]) => {
    const out: number[] = [];
    const ref = () => [...avoid, ...out, sz * N + sx];
    while (out.length < count) {
      let best = -1, bd = -1;
      for (const id of pool) {
        if (out.includes(id) || avoid.includes(id)) continue;
        const [x, z] = pos(id);
        let m = 1e9;
        for (const r of ref()) { const [rx, rz] = pos(r); m = Math.min(m, Math.hypot(x - rx, z - rz)); }
        m *= 0.85 + rnd() * 0.3;
        if (m > bd) { bd = m; best = id; }
      }
      if (best < 0) break;
      out.push(best);
    }
    return out;
  };
  chosen.push(...spread(deadEnds, TAPES, []));
  if (chosen.length < TAPES) chosen.push(...spread(cellsOpen.filter(i => dist[i] >= 4), TAPES - chosen.length, chosen));
  const bats = spread(cellsOpen, BATTERIES, chosen);

  // ---------- geometria ----------
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  // ziemia: ciemna ściółka z płótna 2D
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g2 = cv.getContext('2d')!;
  g2.fillStyle = '#2a241c'; g2.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 20 + rnd() * 40;
    g2.fillStyle = `rgba(${v + 14},${v + 8},${v},${0.25 + rnd() * 0.5})`;
    const s = 1 + rnd() * 5;
    g2.fillRect(rnd() * 256, rnd() * 256, s, s * (0.4 + rnd()));
  }
  for (let i = 0; i < 260; i++) { g2.fillStyle = `rgba(${60 + rnd() * 40},${40 + rnd() * 20},${18},0.5)`; g2.beginPath(); g2.ellipse(rnd() * 256, rnd() * 256, 2 + rnd() * 4, 1 + rnd() * 2, rnd() * 3, 0, 7); g2.fill(); }
  const tex = keep(new THREE.CanvasTexture(cv));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const size = N * B + 60;
  tex.repeat.set(size / 5, size / 5);
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(size, size)), keep(new THREE.MeshLambertMaterial({ map: tex, color: 0xd8cfc0 })));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(N * B / 2, 0, N * B / 2);
  group.add(ground);

  // drzewa i krzaki: bloki-ściany labiryntu + 3 bloki lasu na zewnątrz (poza siatką nie da się wejść)
  const trunks: number[][] = [], cones: number[][] = [], bushes: number[][] = [];
  const decoSolid = (x: number, z: number) => {
    if (x >= 0 && z >= 0 && x < N && z < N) return grid[z * N + x] === 1;
    return !(z === exitZ && x >= N);   // droga za bramą biegnie dalej w las
  };
  for (let z = -3; z < N + 3; z++) for (let x = -3; x < N + 3; x++) {
    if (!decoSolid(x, z)) continue;
    const inside = x >= RING && z >= RING && x < N - RING && z < N - RING;
    const n = inside ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const px = (x + 0.5 + (rnd() - 0.5) * 0.78) * B, pz = (z + 0.5 + (rnd() - 0.5) * 0.78) * B;
      const r = 0.16 + rnd() * 0.22, h = 9 + rnd() * 7;
      trunks.push([px, pz, r, h, rnd() * 6, 0.75 + rnd() * 0.5]);
      if (rnd() < 0.45) cones.push([px, 2.6 + rnd() * 2, pz, 1.2 + rnd() * 1.1, 5 + rnd() * 5]);
    }
    if (!inside) continue;
    // krzaki przy krawędziach, które stykają się z korytarzem: zasłaniają prześwity między pniami
    for (const [dx, dz] of DIRS) {
      if (decoSolid(x + dx, z + dz)) continue;
      const k = 1 + (rnd() < 0.6 ? 1 : 0);
      for (let i = 0; i < k; i++) {
        const along = (rnd() - 0.5) * 0.85;
        const bx = (x + 0.5 + dx * 0.36 + (dz ? along : 0)) * B, bz = (z + 0.5 + dz * 0.36 + (dx ? along : 0)) * B;
        bushes.push([bx, bz, 0.55 + rnd() * 0.45, 0.4 + rnd() * 0.45, rnd() * 6]);
      }
    }
  }
  const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), e = new THREE.Euler(), vs = new THREE.Vector3(), vp = new THREE.Vector3(), col = new THREE.Color();
  const tg = keep(new THREE.CylinderGeometry(0.62, 1, 1, 7, 1, true)); tg.translate(0, 0.5, 0);
  const trunkMesh = new THREE.InstancedMesh(tg, keep(new THREE.MeshLambertMaterial({ color: 0xffffff })), trunks.length);
  trunks.forEach(([px, pz, r, h, rot, shade], i) => {
    e.set((rnd() - 0.5) * 0.06, rot, (rnd() - 0.5) * 0.06); qn.setFromEuler(e);
    m4.compose(vp.set(px, 0, pz), qn, vs.set(r, h, r));
    trunkMesh.setMatrixAt(i, m4);
    trunkMesh.setColorAt(i, col.setRGB(0.085 * shade, 0.068 * shade, 0.052 * shade));
  });
  group.add(trunkMesh);
  const cg = keep(new THREE.ConeGeometry(1, 1, 7, 1)); cg.translate(0, 0.5, 0);
  const coneMesh = new THREE.InstancedMesh(cg, keep(new THREE.MeshLambertMaterial({ color: 0x101a12 })), cones.length);
  cones.forEach(([px, y, pz, r, h], i) => { qn.identity(); m4.compose(vp.set(px, y, pz), qn, vs.set(r, h, r)); coneMesh.setMatrixAt(i, m4); });
  group.add(coneMesh);
  const bg = keep(new THREE.IcosahedronGeometry(1, 0));
  const bushMesh = new THREE.InstancedMesh(bg, keep(new THREE.MeshLambertMaterial({ color: 0xffffff })), bushes.length);
  bushes.forEach(([px, pz, r, h, rot], i) => {
    e.set(0, rot, 0); qn.setFromEuler(e);
    m4.compose(vp.set(px, h * 0.45, pz), qn, vs.set(r, h, r * 0.9));
    bushMesh.setMatrixAt(i, m4);
    const s = 0.7 + rnd() * 0.5;
    bushMesh.setColorAt(i, col.setRGB(0.035 * s, 0.055 * s, 0.03 * s));
  });
  group.add(bushMesh);
  // kamienie i pieńki w korytarzach (punkty odniesienia, bez kolizji)
  const rocks: number[] = [];
  for (let i = 0; i < N * N; i++) if (grid[i] === 0 && rnd() < 0.16) rocks.push(i);
  const rg = keep(new THREE.DodecahedronGeometry(1, 0));
  const rockMesh = new THREE.InstancedMesh(rg, keep(new THREE.MeshLambertMaterial({ color: 0x3b3a36 })), rocks.length);
  rocks.forEach((id, i) => {
    const s = 0.12 + rnd() * 0.22;
    e.set(rnd() * 3, rnd() * 3, 0); qn.setFromEuler(e);
    m4.compose(vp.set((id % N + 0.2 + rnd() * 0.6) * B, s * 0.3, (((id / N) | 0) + 0.2 + rnd() * 0.6) * B), qn, vs.set(s, s * 0.7, s));
    rockMesh.setMatrixAt(i, m4);
  });
  group.add(rockMesh);
  for (const m of [trunkMesh, coneMesh, bushMesh, rockMesh]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }

  // kasety VHS na pieńkach
  const stumpGeo = keep(new THREE.CylinderGeometry(0.28, 0.34, 0.42, 8));
  const stumpMat = keep(new THREE.MeshLambertMaterial({ color: 0x3a2d22 }));
  const caseGeo = keep(new THREE.BoxGeometry(0.38, 0.06, 0.22));
  const caseMat = keep(new THREE.MeshLambertMaterial({ color: 0x0d0d0e }));
  const labelGeo = keep(new THREE.BoxGeometry(0.26, 0.062, 0.08));
  const labelMat = keep(new THREE.MeshLambertMaterial({ color: 0xd8d0bc, emissive: 0x3a352a }));
  const reelGeo = keep(new THREE.CylinderGeometry(0.035, 0.035, 0.064, 10));
  const reelMat = keep(new THREE.MeshLambertMaterial({ color: 0x5b5650 }));
  const tapes: Pickup[] = chosen.map(id => {
    const [x0, z0] = pos(id);
    const x = x0 + (rnd() - 0.5) * 0.8, z = z0 + (rnd() - 0.5) * 0.8;
    const g = new THREE.Group();
    const stump = new THREE.Mesh(stumpGeo, stumpMat); stump.position.y = 0.21; g.add(stump);
    const cas = new THREE.Group(); cas.position.y = 0.45; cas.rotation.y = rnd() * 6;
    cas.add(new THREE.Mesh(caseGeo, caseMat));
    const label = new THREE.Mesh(labelGeo, labelMat); label.position.z = 0.055; cas.add(label);
    for (const s of [-1, 1]) { const r = new THREE.Mesh(reelGeo, reelMat); r.position.set(s * 0.08, 0.001, -0.03); cas.add(r); }
    g.add(cas);
    g.position.set(x, 0, z);
    group.add(g);
    return { x, z, obj: g, taken: false };
  });
  const batGeo = keep(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 10));
  const batMat = keep(new THREE.MeshLambertMaterial({ color: 0x2c5e38, emissive: 0x0b1e10 }));
  const capGeo = keep(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8));
  const capMat = keep(new THREE.MeshLambertMaterial({ color: 0xb08a4a }));
  const batteries: Pickup[] = bats.map(id => {
    const [x0, z0] = pos(id);
    const x = x0 + (rnd() - 0.5) * 1.2, z = z0 + (rnd() - 0.5) * 1.2;
    const g = new THREE.Group();
    const b = new THREE.Mesh(batGeo, batMat); g.add(b);
    const c = new THREE.Mesh(capGeo, capMat); c.position.y = 0.11; g.add(c);
    g.rotation.set(Math.PI / 2, 0, rnd() * 6); g.position.set(x, 0.06, z);
    group.add(g);
    return { x, z, obj: g, taken: false };
  });

  // brama: dwa słupy i skrzydło z desek (zawias przy jednym słupie), za nią lampa wyjścia
  const gate = new THREE.Group();
  gate.position.set((gateX + 0.5) * B, 0, (exitZ + 0.5) * B - B / 2);
  const woodMat = keep(new THREE.MeshLambertMaterial({ color: 0x4a3a2a }));
  const postGeo = keep(new THREE.BoxGeometry(0.16, 2.2, 0.16));
  const plankGeo = keep(new THREE.BoxGeometry(0.06, 0.2, B - 0.2));
  const wing = new THREE.Group();
  for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(plankGeo, woodMat); p.position.set(0, 0.35 + i * 0.45, B / 2); wing.add(p); }
  const brace = new THREE.Mesh(plankGeo, woodMat); brace.position.set(0.03, 1.0, B / 2); brace.rotation.x = 0.42; wing.add(brace);
  gate.add(wing);
  for (const s of [0, B]) { const p = new THREE.Mesh(postGeo, woodMat); p.position.set(0, 1.1, s); gate.add(p); }
  group.add(gate);
  const lamp = new THREE.Mesh(keep(new THREE.SphereGeometry(0.12, 10, 8)), keep(new THREE.MeshBasicMaterial({ color: 0x331512 })));
  lamp.position.set((N - 0.5) * B, 2.4, (exitZ + 0.5) * B);
  const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6)), woodMat); pole.position.set((N - 0.5) * B, 1.2, (exitZ + 0.5) * B);
  group.add(lamp, pole);

  return {
    group, grid, start: [sx, sz], startYaw, exitZ, gate, lamp, tapes, batteries,
    dispose: () => {
      for (const m of [trunkMesh, coneMesh, bushMesh, rockMesh]) m.dispose();
      disposables.forEach(d => d.dispose());
    },
  };
}

// ---------- dźwięk ----------
/** Syntezator: wiatr i niski dron w tle, trzaski zakłóceń rosnące przy potworze, kroki, serce, buczenie najbliższej kasety, jumpscare. */
function createAudio(hooks: HorrorHooks, calm: boolean) {
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  let ctx: AudioContext | null = null;
  let master: GainNode, droneG: GainNode, droneF: BiquadFilterNode, staticG: GainNode, humG: GainNode, humP: StereoPannerNode | null = null, noise: AudioBuffer;
  const live: AudioScheduledSourceNode[] = [];
  const ensure = () => {
    if (ctx || !AC) return ctx;
    try { ctx = new AC(); } catch { return null; }
    const c = ctx!;
    master = c.createGain(); master.gain.value = 0; master.connect(c.destination);
    noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loop = (filter: BiquadFilterType, freq: number, gain: number) => {
      const s = c.createBufferSource(); s.buffer = noise; s.loop = true;
      const f = c.createBiquadFilter(); f.type = filter; f.frequency.value = freq;
      const g = c.createGain(); g.gain.value = gain;
      s.connect(f).connect(g).connect(master); s.start(0, Math.random() * 1.5); live.push(s);
      return { f, g };
    };
    // wiatr: szum przez dolnoprzepustowy filtr, którego częstotliwość powoli faluje
    const wind = loop('lowpass', 420, 0.07);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 220;
    lfo.connect(lfoG).connect(wind.f.frequency); lfo.start(); live.push(lfo);
    // dron
    droneF = c.createBiquadFilter(); droneF.type = 'lowpass'; droneF.frequency.value = 140;
    droneG = c.createGain(); droneG.gain.value = 0.03;
    droneF.connect(droneG).connect(master);
    for (const [type, f] of [['sawtooth', 49], ['sawtooth', 49.6], ['sine', 24.5]] as [OscillatorType, number][]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.connect(droneF); o.start(); live.push(o);
    }
    // zakłócenia
    const st = loop('highpass', 1400, 0);
    staticG = st.g;
    // buczenie kasety
    humG = c.createGain(); humG.gain.value = 0;
    const humF = c.createBiquadFilter(); humF.type = 'bandpass'; humF.frequency.value = 900; humF.Q.value = 3;
    humP = c.createStereoPanner ? c.createStereoPanner() : null;
    for (const f of [180, 181.7, 360.5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(humF); o.start(); live.push(o); }
    if (humP) humF.connect(humP).connect(humG); else humF.connect(humG);
    humG.connect(master);
    return ctx;
  };
  const now = () => ctx!.currentTime;
  const burst = (o: { dur: number; freq: number; type?: BiquadFilterType; q?: number; gain: number; at?: number; attack?: number; pan?: number }) => {
    if (!ensure()) return;
    const c = ctx!, t = now() + (o.at || 0);
    const s = c.createBufferSource(); s.buffer = noise;
    const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.value = o.freq; f.Q.value = o.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let out: AudioNode = g;
    if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p; }
    s.connect(f).connect(g); out.connect(master);
    s.start(t, Math.random() * Math.max(0, 1.9 - o.dur)); s.stop(t + o.dur + 0.05);
  };
  const tone = (o: { freq: number; to?: number; dur: number; type?: OscillatorType; gain: number; at?: number; pan?: number }) => {
    if (!ensure()) return;
    const c = ctx!, t = now() + (o.at || 0);
    const osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let out: AudioNode = g;
    if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p; }
    osc.connect(g); out.connect(master);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  };
  let crackle = 0;
  return {
    resume() { ensure(); ctx?.resume?.().catch?.(() => {}); },
    update(danger: number, quiet: boolean) {
      if (!ctx) return;
      const t = now();
      const vol = hooks.soundOn() ? Math.max(0, Math.min(1, hooks.volume())) : 0;
      master.gain.setTargetAtTime(vol * (quiet ? 0.35 : 0.9), t, 0.1);
      droneG.gain.setTargetAtTime(0.025 + danger * 0.11, t, 0.3);
      droneF.frequency.setTargetAtTime(120 + danger * 650, t, 0.3);
      // trzaski: losowo przerywany szum, coraz gęstszy przy potworze (w trybie spokojnym bez przerw)
      if (!calm && Math.random() < 0.25) crackle = Math.random() < 0.15 + danger * 0.5 ? 1 : 0.25;
      const sg = Math.pow(danger, 1.5) * 0.24 * (calm ? 0.7 : crackle);
      staticG.gain.setTargetAtTime(sg, t, 0.02);
    },
    hum(pan: number, k: number) {
      if (!ctx) return;
      humG.gain.setTargetAtTime(k * k * 0.05, now(), 0.15);
      humP?.pan.setTargetAtTime(pan, now(), 0.15);
    },
    step(run: boolean) {
      burst({ dur: run ? 0.08 : 0.1, freq: 700 + Math.random() * 600, q: 0.8, gain: run ? 0.16 : 0.11 });
      burst({ dur: 0.05, freq: 2600 + Math.random() * 900, q: 1.2, gain: 0.04, at: 0.015 });
    },
    thud(k: number) {
      tone({ freq: 58, to: 32, dur: 0.3, gain: 0.55 * k });
      burst({ dur: 0.16, freq: 180, type: 'lowpass', gain: 0.35 * k });
    },
    heart(k: number) {
      tone({ freq: 62, to: 40, dur: 0.14, gain: 0.3 * k });
      tone({ freq: 56, to: 38, dur: 0.14, gain: 0.22 * k, at: 0.19 });
    },
    breath() { burst({ dur: 0.75, freq: 1100, q: 1.4, gain: 0.05, attack: 0.3 }); },
    gasp() { burst({ dur: 0.5, freq: 1400, q: 1.2, gain: 0.08, attack: 0.05 }); },
    tape() {
      tone({ freq: 880, dur: 0.05, type: 'square', gain: 0.05 });
      tone({ freq: 660, dur: 0.07, type: 'square', gain: 0.05, at: 0.07 });
      burst({ dur: calm ? 0.25 : 0.45, freq: 3200, type: 'highpass', gain: calm ? 0.06 : 0.14 });
      tone({ freq: 110, to: 70, dur: 1.4, type: 'sawtooth', gain: 0.06, at: 0.1 });
    },
    battery() { tone({ freq: 1200, dur: 0.04, type: 'square', gain: 0.04 }); tone({ freq: 1600, dur: 0.05, type: 'square', gain: 0.04, at: 0.06 }); },
    click() { tone({ freq: 2200, dur: 0.02, type: 'square', gain: 0.04 }); },
    rattle() { for (let i = 0; i < 4; i++) burst({ dur: 0.07, freq: 400 + i * 90, q: 3, gain: 0.12, at: i * 0.08 }); },
    gate() {
      tone({ freq: 140, to: 90, dur: 1.6, type: 'sawtooth', gain: 0.05 });
      burst({ dur: 1.4, freq: 600, q: 6, gain: 0.05, attack: 0.3 });
    },
    ping(pan: number, k: number) {
      tone({ freq: 980, dur: 0.25, type: 'sine', gain: 0.07 * k, pan });
      tone({ freq: 980, dur: 0.25, type: 'sine', gain: 0.04 * k, pan, at: 0.32 });
    },
    sting() {
      burst({ dur: calm ? 0.3 : 0.6, freq: 2400, type: 'highpass', gain: calm ? 0.08 : 0.2 });
      if (!calm) tone({ freq: 220, to: 180, dur: 0.6, type: 'sawtooth', gain: 0.05 });
    },
    scare() {
      if (!ensure()) return;
      if (calm) {
        tone({ freq: 50, to: 30, dur: 1.4, gain: 0.45 });
        burst({ dur: 1.2, freq: 1800, type: 'highpass', gain: 0.12, attack: 0.3 });
        return;
      }
      burst({ dur: 1.1, freq: 600, type: 'highpass', gain: 0.75 });
      tone({ freq: 190, to: 1500, dur: 0.9, type: 'sawtooth', gain: 0.22 });
      tone({ freq: 203, to: 1210, dur: 0.95, type: 'sawtooth', gain: 0.2 });
      tone({ freq: 330, to: 2400, dur: 0.7, type: 'square', gain: 0.08 });
      tone({ freq: 55, to: 28, dur: 1.4, gain: 0.9 });
    },
    close() {
      for (const s of live) try { s.stop(); } catch { /* już zatrzymany */ }
      ctx?.close?.().catch?.(() => {});
      ctx = null;
    },
  };
}
