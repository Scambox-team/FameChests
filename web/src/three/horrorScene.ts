// Mgła (zakładka Gry -> Mgła): horror 3D w stylu kaset analog horror. Gracz chodzi z latarką po opuszczonym budynku jak z Backrooms
// (żółte tapety, mokra wykładzina, jarzeniówki, z których większość już nie świeci): ściany tworzą labirynt (korytarze, ślepe zaułki,
// kilka hal z filarami). Zbiera kasety VHS i ucieka drzwiami z napisem WYJŚCIE, zanim dopadnie go potwór. Skok (Spacja): przez
// barykady z kartonów, na które potwór wspina się powoli, i po kasety leżące na wysokich szafkach; lądowanie słychać.
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
  /** zaczyna się nowa gra (pierwsza i każda kolejna): strona prosi serwer o bilet na nagrodę za przejście */
  onStart?: () => void;
  /** gra skończona: `escaped` = zebrane wszystkie kasety i wyjście z lasu (serwer sprawdza to jeszcze czasem gry) */
  onEnd?: (r: { escaped: boolean; tapes: number; seconds: number }) => void;
}
export interface Horror3D { start: () => void; pause: () => void; destroy: () => void }

const TAPES = 6;          // kasety do zebrania
const BATTERIES = 5;
const CELLS = 14;         // labirynt CELLS x CELLS komórek
const G = CELLS * 2 + 1;  // bloki labiryntu (komórki + ściany z drzew)
const RING = 2;           // pas ścian dookoła
const N = G + RING * 2;   // cała siatka bloków
const B = 3.2;            // bok bloku w metrach
const H = 3.0;            // wysokość sufitu
const H2 = 6.6;           // sufit w wysokich salach
const EYE = 1.62, RADIUS = 0.3;
const WALK = 3.0, SPRINT = 5.6;
const CATCH = 0.85;
const GRAV = 14, JUMP_V = 5.0, JUMP_COST = 14;   // skok ~0,9 m
const BAR_H = 0.62;       // barykada z kartonów: da się na nią wskoczyć i przez nią przeskoczyć
const CAB_H = 1.25;       // szafka z kasetą na górze: za wysoka na wejście, kasetę łapie się w skoku
const REACH_Y = 0.35;     // tyle trzeba być nad podłogą, żeby sięgnąć kasety z szafki
const STAND_H = 1.75, CROUCH_H = 1.1;   // wzrost gracza na stojąco i w kucki (kolizja z niskim sufitem)
const CROUCH_EYE = 0.95, CRAWL = 1.6;   // oczy i prędkość w kucki
const DUCT_LO = 1.2, DUCT_W = 1.3;      // kanał wentylacyjny w ścianie: wysokość i szerokość przejścia
const DUCTS = 5;
const STEP = 0.35;        // na tyle niską przeszkodę (brzeg basenu) wchodzi się bez skoku
const WATER_Y = 0.3, WADE = 0.6;        // woda w basenie: poziom i spowolnienie brodzącego
// Potwór nie wie, gdzie jest gracz: widzi go tylko przed sobą (stożek VIEW_COS, zasięg zależny od latarki i kucania) i słyszy
// kroki w promieniu HEAR_*. Zauważony gracz jest gonionym, dopóki potwór go widzi, i jeszcze LOSE_TIME s po zniknięciu z oczu;
// potem potwór szuka (SEARCH_TIME) tam, gdzie go zgubił, i wraca do krążenia po budynku.
const VIEW_COS = Math.cos(1.0), SEE_LIT = 20, SEE_DARK = 10, NOTICE = 0.35;
const HEAR_WALK = 6, HEAR_RUN = 12, HEAR_LAND = 13, HEAR_WATER = 1.7;
const LOSE_TIME = 3.5, SEARCH_TIME = 7;
const SPD_WANDER = 1.15, SPD_INVESTIGATE = 1.9, SPD_SEARCH = 1.4, SPD_LASTSEEN = 2.6;
type MoState = 'wander' | 'investigate' | 'search' | 'chase';
const FOG = 0x15120a;
const LAMPS = 4;          // tyle świateł z jarzeniówek naraz (najbliższe działające)
const LINES = ['ON JUŻ IDZIE', 'NIE OGLĄDAJ SIĘ ZA SIEBIE', 'ŚWIATŁO GO SPOWALNIA', 'SŁYSZY TWOJE KROKI', 'ZOSTAŁA OSTATNIA'];

const HTML = `
<div class="hz3-pad" aria-hidden="true"></div>
<div class="hz3-hud">
  <div class="hz3-tl"><span class="hz3-rec"><i></i>REC</span><span class="hz3-tc">0:00</span></div>
  <div class="hz3-tr"><span>KASETY</span> <b class="hz3-n">0</b><b>/${TAPES}</b></div>
  <div class="hz3-pose">KUCASZ</div>
  <div class="hz3-bars">
    <div class="hz3-bar hz3-bat"><span>LATARKA <em>[F]</em></span><i><b></b></i></div>
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
    <button type="button" data-a="jump">SKOK</button>
    <button type="button" data-a="crouch" aria-pressed="false">KUCNIJ</button>
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
/** `high` = kaseta na szafce: łapie się ją tylko w skoku */
interface Pickup { x: number; z: number; obj: THREE.Object3D; taken: boolean; high?: boolean }
/** przeszkoda: prostokąt w rzucie + zakres wysokości `lo`..`h` (barykada, szafka: od podłogi; sufit kanału wentylacyjnego: lo > 0).
 *  Blokuje, gdy zachodzi na ciało gracza (od stóp `P.y` do głowy); na przeszkodę od podłogi da się wskoczyć, jeśli jest niska. */
interface Prop { x0: number; x1: number; z0: number; z1: number; h: number; lo?: number }
/** jarzeniówka: `on` = świeci, `flick` = mruga (losowo gaśnie) */
interface Lamp { x: number; y: number; z: number; on: boolean; flick: boolean; k: number }
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
  /** przeszkody wg bloku (indeks z * N + x) */
  props: Map<number, Prop[]>;
  lamps: Lamp[];
  /** wolne bloki (indeksy), po których potwór krąży */
  open: number[];
  /** lustra wody w basenach (prostokąty w metrach): kto w nich stoi, brodzi */
  pools: { x0: number; x1: number; z0: number; z1: number }[];
  /** mokra podłoga (kałuże pod wodą spływającą po ścianach): kroki chlapią, ale nie spowalniają */
  wet: { x0: number; x1: number; z0: number; z1: number }[];
  /** strumienie wody na ścianach (szum słychać z ich strony) */
  streams: [number, number][];
  /** wysokość sufitu w punkcie (wysokie sale mają H2) */
  ceilAt: (x: number, z: number) => number;
  /** animacja (falująca woda, spływające strumienie) */
  tick: (t: number) => void;
  /** odświeża jasność jarzeniówek na suficie (mruganie) */
  setLamp: (i: number, k: number) => void;
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
    light: q('[data-a="light"]'), run: q('[data-a="run"]'), crouch: q('[data-a="crouch"]'),
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
  scene.add(new THREE.HemisphereLight(0x8a7d4e, 0x2a2312, 0.55));
  // światło z kilku najbliższych działających jarzeniówek (stała liczba świateł, żeby nie przebudowywać shaderów)
  const lampLights: THREE.PointLight[] = [];
  for (let i = 0; i < (lite ? 2 : LAMPS); i++) {
    const l = new THREE.PointLight(0xfff1c4, 0, 11, 1.6);
    scene.add(l);
    lampLights.push(l);
  }
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
    for (let i = 0; i < pos.length; i += 3) { pos[i] = Math.random() * DUST; pos[i + 1] = Math.random() * H; pos[i + 2] = Math.random() * DUST; }
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
  /** dla potwora i wzroku: ściana albo kanał wentylacyjny (3 - przejdzie tylko gracz w kucki, przez otwór nic nie widać) */
  const blocks = (x: number, z: number) => solid(x, z) || grid[z * N + x] === 3;
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
        if (blocks(x, z)) continue;
        const n = z * N + x;
        if (flow[n] >= 0) continue;
        flow[n] = flow[c] + 1; qq[t++] = n;
      }
    }
  };

  // ---------- stan ----------
  let mode: Mode = 'over';
  // y / vy = wysokość nad podłogą i prędkość w pionie (skok), `ground` = stoi na podłodze albo na przeszkodzie
  const P = { x: 0, z: 0, y: 0, vy: 0, ground: true, crouch: false, eye: EYE, yaw: 0, pitch: 0, vx: 0, vz: 0, stamina: 100, tired: false, rest: 0, battery: 100, light: true, walked: 0, stepAt: 0, tapes: 0, t: 0 };
  // alert = sekundy po głośnym lądowaniu (potwór idzie szybciej), climb = wysokość, na którą się wspina (barykada)
  // state = co robi; tx/tz = cel marszu; notice = jak długo już widzi gracza (0..1); track = ile jeszcze s wie, gdzie gracz jest po
  // zniknięciu z oczu; rot = kierunek patrzenia (0 = +z); look = dokąd się rozgląda, stojąc; snap = szybki obrót (usłyszał coś)
  const Mo = { x: 0, z: 0, on: false, speed: 0, stepAcc: 0, seen: false, climb: 0, state: 'wander' as MoState, tx: 0, tz: 0, notice: 0, track: 0,
    searchT: 0, idleT: 0, rot: 0, look: 0, lookT: 0, snap: 0, wade: false, peek: false, duct: -1, ductEnd: 0 };
  let danger = 0, fx = 0, glitch = 0, heart = 0, ping = 0, breath = 0, gateMsg = 0, msgT = 0, lightK = 1, lampAt = 0, highMsg = 0;
  let jumpQ = 0;   // wciśnięty skok czeka chwilę (np. Spacja tuż przed wylądowaniem)
  let lowMsg = 0;  // podpowiedź „kucnij” / „za nisko”, najwyżej raz na kilka sekund
  const faceV = new THREE.Vector3();
  let scareT = 0, scarePitch = 0.9, won = false, record = false;
  let locked = false, wasLocked = false;
  const keys = new Set<string>();
  const joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  const look = { id: -1, lx: 0, ly: 0 };
  let mouseDrag = false, runToggle = false, skipMouse = 0, mouseAvg = 20;

  const setMsg = (text: string, secs = 3.5) => { ui.msg.textContent = text; ui.msg.classList.add('on'); msgT = secs; };

  function newGame() {
    world?.dispose();
    if (world) scene.remove(world.group);
    world = buildWorld();
    grid = world.grid;
    scene.add(world.group);
    gateOpen = false; gateAnim = 0;
    world.gate.children[0].rotation.y = 0; world.gate.children[1].rotation.y = 0;
    exitLight.intensity = 0;
    if (camera.fov !== 70) { camera.fov = 70; camera.updateProjectionMatrix(); }
    exitLight.position.set((N - RING - 1) * B - 1.2, 2.5, center(world.exitZ));
    flowFrom = -1; lampAt = 0; highMsg = 0; jumpQ = 0;
    for (const pl of lampLights) { pl.userData.lamp = undefined; pl.intensity = 0; }
    Object.assign(P, { x: center(world.start[0]), z: center(world.start[1]), y: 0, vy: 0, ground: true, crouch: false, eye: EYE, yaw: world.startYaw, pitch: 0, vx: 0, vz: 0, stamina: 100, tired: false, rest: 0, battery: 100, light: true, walked: 0, stepAt: 0, tapes: 0, t: 0 });
    Object.assign(Mo, { x: -100, z: -100, on: false, speed: 0, stepAcc: 0, seen: false, climb: 0, state: 'wander', tx: 0, tz: 0, notice: 0, track: 0,
      searchT: 0, idleT: 0, rot: 0, look: 0, lookT: 0, snap: 0, wade: false, peek: false, duct: -1, ductEnd: 0 });
    fx = 0;
    ui.light.setAttribute('aria-pressed', 'true');
    ui.bat.classList.remove('off');
    setCrouch(false);
    monster.object.visible = false;
    danger = 0; glitch = 0; scareT = 0; won = false; record = false; heart = 0; ping = 0;
    runToggle = false;
    ui.run.setAttribute('aria-pressed', 'false');
    ui.scare.classList.remove('on');
    el.classList.remove('hz3-scaring');
    post.uniforms.uScare.value = 0;
    setMsg(`ZNAJDŹ ${TAPES} KASET I UCIEKAJ DRZWIAMI Z NAPISEM WYJŚCIE`, 6);
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
    // unadjustedMovement = surowy ruch myszy: bez niego Chrome na Windows potrafi wysłać skok o setki pikseli (widok nagle się obraca)
    const plain = () => { try { (ui.pad.requestPointerLock() as any)?.catch?.(() => {}); } catch { /* bez blokady: rozglądanie przeciąganiem */ } };
    try {
      const p = (ui.pad.requestPointerLock as any)({ unadjustedMovement: true });
      if (p?.catch) p.catch(plain); else if (document.pointerLockElement !== ui.pad) plain();
    } catch { plain(); }
    skipMouse = 2;
  };
  const onFs = () => { if (!fsEl() && mode === 'play') pause(); };
  const onLock = () => {
    locked = document.pointerLockElement === ui.pad;
    if (locked && !wasLocked) skipMouse = 2;
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
        <p class="hz3-keys">WASD / strzałki: ruch, mysz: rozglądanie, Shift: bieg, Spacja: skok, C: kucanie, F / prawy przycisk myszy: latarka, Esc: pauza</p>`;
    } else {
      h = `<h2>${won ? 'UCIECZKA UDANA' : 'ZŁAPAŁ CIĘ'}</h2><p>${won ? 'Wydostajesz się z budynku.' : 'Koniec taśmy.'}</p>
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
    hooks.onStart?.();
    mode = 'play';
  }
  function pause() {
    if (mode !== 'play') return;
    mode = 'pause';
    keys.clear(); joy.id = -1; look.id = -1; mouseDrag = false;
    ui.stick.classList.remove('on');
    if (document.pointerLockElement) document.exitPointerLock?.();
    audio.hum(0, 0); audio.stream(0, 0);
    showMenu('pause');
  }
  function finish(escaped: boolean) {
    won = escaped;
    record = saveBest(P.tapes, escaped, P.t);
    hooks.onEnd?.({ escaped, tapes: P.tapes, seconds: P.t });
    mode = 'over';
    if (document.pointerLockElement) document.exitPointerLock?.();
    audio.hum(0, 0); audio.stream(0, 0);
    showMenu('over');
  }
  function caught() {
    mode = 'scare';
    scareT = 0;
    keys.clear();
    if (document.pointerLockElement) document.exitPointerLock?.();
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    Mo.x = P.x + fx * monster.scareDist; Mo.z = P.z + fz * monster.scareDist;
    monster.object.visible = true;
    monster.object.position.set(Mo.x, 0, Mo.z);
    monster.object.rotation.y = Math.atan2(P.x - Mo.x, P.z - Mo.z);
    scarePitch = Math.atan2(monster.faceY - P.eye, monster.scareDist * 0.67);   // patrzymy w twarz
    if (!calm) { P.pitch = scarePitch; ui.scare.classList.add('on'); }
    el.classList.add('hz3-scaring');
    hideMenu();
    audio.hum(0, 0); audio.stream(0, 0);
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
        if (e.code === 'Space' && !e.repeat) jumpQ = 0.15;
        if (e.code === 'KeyC' && !e.repeat) { toggleCrouch(); return; }
      } else if (mode === 'pause' && e.code === 'KeyP') { e.preventDefault(); enterFs(); lockPointer(); hideMenu(); mode = 'play'; return; }
      if (GAME_KEYS.has(e.code) && mode === 'play') { e.preventDefault(); keys.add(e.code); }
    } else keys.delete(e.code);
  };
  /** wstanie: tylko gdy nad głową nie ma niskiego sufitu (w kanale trzeba najpierw z niego wyjść) */
  const canStand = () => !overhead(P.x, P.z, P.y + STAND_H);
  const setCrouch = (on: boolean) => {
    P.crouch = on;
    ui.crouch.setAttribute('aria-pressed', String(on));
    el.classList.toggle('hz3-crouching', on);
  };
  const toggleCrouch = () => {
    if (P.crouch && !canStand()) { lowMsg = 4; setMsg('ZA NISKO, ŻEBY WSTAĆ', 2.2); return; }
    setCrouch(!P.crouch);
  };
  const toggleLight = () => {
    P.light = !P.light;
    ui.light.setAttribute('aria-pressed', String(P.light));
    ui.bat.classList.toggle('off', !P.light);
    audio.click();
  };
  const turn = (dx: number, dy: number, k: number) => {
    P.yaw -= dx * k;
    P.pitch = Math.max(-1.25, Math.min(1.25, P.pitch - dy * k));
  };
  const onMouse = (e: MouseEvent) => {
    if (mode !== 'play') return;
    if (!locked && !mouseDrag) return;
    const dx = e.movementX || 0, dy = e.movementY || 0;
    // pierwsze ruchy po zablokowaniu kursora i pojedyncze skoki daleko ponad zwykły ruch to błąd przeglądarki, nie gracz
    if (skipMouse > 0) { skipMouse--; return; }
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    if (m > 160 && m > mouseAvg * 6) return;
    mouseAvg += (Math.min(m, 400) - mouseAvg) * 0.2;
    turn(dx, dy, 0.0022);
  };
  const half = () => el.clientWidth / 2;
  ui.pad.addEventListener('contextmenu', e => e.preventDefault());
  ui.pad.addEventListener('pointerdown', e => {
    if (mode !== 'play') return;
    if (e.pointerType === 'mouse') {
      if (e.button === 2) { toggleLight(); return; }   // prawy przycisk: latarka
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
    else if (a === 'jump') jumpQ = 0.15;
    else if (a === 'crouch') toggleCrouch();
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
      if (blocks(blockOf(x0 + (x1 - x0) * k), blockOf(z0 + (z1 - z0) * k))) return false;
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
    const wantRun = (keys.has('ShiftLeft') || keys.has('ShiftRight') || runToggle) && f > 0.3 && !P.crouch;
    const running = wantRun && moving && !P.tired && P.stamina > 0;
    if (running) { P.stamina = Math.max(0, P.stamina - 21 * dt); P.rest = 0.7; if (P.stamina <= 0) { P.tired = true; audio.gasp(); } }
    else { P.rest -= dt; if (P.rest <= 0) P.stamina = Math.min(100, P.stamina + (moving ? 11 : 20) * dt); }
    if (P.tired && P.stamina >= 35) P.tired = false;
    const wading = inWater(P.x, P.z) && P.y < 0.2;
    const splashy = wading || (inWet(P.x, P.z) && P.y < 0.05);
    const speed = (P.crouch ? CRAWL : running ? SPRINT : WALK) * (P.tired ? 0.75 : 1) * (wading ? WADE : 1);
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const tx = (-sy * f + cy * s) * speed, tz = (-cy * f - sy * s) * speed;
    const a = 1 - Math.exp(-dt * (P.ground ? 10 : 2.5));   // w powietrzu słabiej się skręca
    P.vx += (tx - P.vx) * a; P.vz += (tz - P.vz) * a;
    const ox = P.x, oz = P.z;
    P.x += P.vx * dt; P.z += P.vz * dt;
    collide(P, RADIUS);
    // skok: kosztuje kondycję, zmęczony nie skacze; lądowanie słychać (potwór przyspiesza i szybciej przeskakuje bliżej)
    jumpQ -= dt;
    if (jumpQ > 0 && P.ground) {
      jumpQ = 0;
      if (P.crouch) toggleCrouch();   // w kucki Spacja tylko wstaje
      else if (!P.tired && P.stamina >= JUMP_COST) {
        P.vy = JUMP_V; P.ground = false;
        P.stamina -= JUMP_COST; P.rest = 0.7;
        audio.jump();
      } else audio.gasp();
    }
    const gh = groundAt(P.x, P.z);
    if (!P.ground || P.y > gh + 0.01) {
      P.vy -= GRAV * dt; P.y += P.vy * dt;
      if (P.y <= gh) {
        const hard = -P.vy;
        P.y = gh; P.vy = 0; P.ground = true;
        if (hard > 2.5) land(Math.min(1, hard / 6));
      } else P.ground = false;
    } else { P.y = gh; P.vy = 0; P.ground = true; }
    const top = world.ceilAt(P.x, P.z) - 0.12 - (P.crouch ? CROUCH_H : STAND_H);
    if (P.y > top) { P.y = Math.max(gh, top); if (P.vy > 0) P.vy = 0; }
    const moved = Math.hypot(P.x - ox, P.z - oz);
    if (P.ground) P.walked += moved;
    const stride = running ? 1.05 : 0.78;
    if (P.walked - P.stepAt > (P.crouch ? 0.6 : stride)) {
      P.stepAt = P.walked;
      if (splashy) audio.splash(running); else audio.step(running, P.crouch);
      // kroki słychać (w kucki nie, w wodzie dalej): potwór idzie sprawdzić, skąd dochodzą
      const r = (P.crouch ? 0 : running ? HEAR_RUN : HEAR_WALK) * (splashy ? HEAR_WATER : 1) + (splashy && P.crouch ? 3 : 0);
      if (r) noise(P.x, P.z, r);
    }
    // oczy płynnie w dół / w górę; kucanie wycisza kroki i potwór rzadziej przeskakuje bliżej
    P.eye += ((P.crouch ? CROUCH_EYE : EYE) - P.eye) * (1 - Math.exp(-dt * 10));
    lowMsg -= dt;

    // latarka: bateria, migotanie przy słabej baterii i przy potworze
    if (P.light && P.battery > 0) P.battery = Math.max(0, P.battery - 0.42 * dt);
    let lk = P.light && P.battery > 0 ? 1 : 0;
    if (lk && P.battery < 15) lk *= 0.45 + P.battery / 30;
    if (lk && !calm && ((P.battery < 12 && Math.random() < 0.12) || (danger > 0.55 && Math.random() < danger * 0.18))) lk *= 0.15;
    lightK += (lk - lightK) * (calm ? 1 - Math.exp(-dt * 6) : 0.6);

    // zbieranie
    highMsg -= dt;
    for (const tp of world.tapes) {
      if (tp.taken || Math.hypot(tp.x - P.x, tp.z - P.z) > (tp.high ? 1.0 : 1.15)) continue;
      if (tp.high && P.y < REACH_Y) {   // kaseta na szafce: trzeba podskoczyć
        if (highMsg <= 0) { highMsg = 6; setMsg(touchUI ? 'ZA WYSOKO. PODSKOCZ (SKOK)' : 'ZA WYSOKO. PODSKOCZ (SPACJA)', 3); }
        continue;
      }
      tp.taken = true; tp.obj.visible = false;
      P.tapes++;
      glitch = calm ? 0.4 : 0.9;
      audio.tape();
      if (P.tapes >= TAPES) {
        gateOpen = true; gateAnim = 0.001; flowFrom = -1;
        exitLight.intensity = 14;
        audio.gate();
        setMsg('DRZWI SIĘ OTWORZYŁY. SZUKAJ CZERWONEGO NAPISU WYJŚCIE', 6);
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
      if (gateMsg <= 0) { gateMsg = 5; setMsg('DRZWI SĄ ZAMKNIĘTE. ZBIERZ WSZYSTKIE KASETY', 3.5); audio.rattle(); }
    }
    if (gateAnim > 0 && gateAnim < 1) {
      gateAnim = Math.min(1, gateAnim + dt / 1.6);
      const k = 1.6 * (1 - Math.pow(1 - gateAnim, 3));
      world.gate.children[0].rotation.y = k; world.gate.children[1].rotation.y = -k;   // dwa skrzydła na zewnątrz
    }
    if (gateOpen) {
      exitLight.intensity = calm ? 14 : 11 + Math.sin(P.t * 9) * 2 + Math.random() * 2.5;
      (world.lamp.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
      ping -= dt;
      if (ping <= 0) {
        ping = 2.2;
        const dx = exitLight.position.x - P.x, dz = exitLight.position.z - P.z, d = Math.hypot(dx, dz) || 1;
        audio.ping(panOf(dx / d, dz / d), Math.max(0.15, 1 - d / 70));
      }
      if (P.x > center(gx + 1)) { finish(true); return; }
    }
    if (!Mo.on && P.t > 25) activate();
    updateLamps(dt);

    // potwór
    if (Mo.on) monsterStep(dt);

    // zakłócenia
    const md = Mo.on ? Math.hypot(Mo.x - P.x, Mo.z - P.z) : 99;
    Mo.seen = Mo.on && inBeam();
    // `danger` (serce, dron) rośnie z odległością i pościgiem; zakłócenia obrazu (`fx`) dopiero w ostatnich metrach przed złapaniem
    const raw = Math.max(0, Math.min(1, (14 - md) / 12)) * (Mo.state === 'chase' ? 1 : 0.6);
    danger += (raw - danger) * (1 - Math.exp(-dt * 3));
    const fxRaw = Math.pow(Math.max(0, Math.min(1, (4.5 - md) / 3.6)), 1.6);
    fx += (fxRaw - fx) * (1 - Math.exp(-dt * 6));
    if (!calm && fx > 0.6 && Math.random() < dt * 2 * fx) glitch = Math.max(glitch, 0.5);
    glitch *= Math.exp(-dt * 3.2);
    heart -= dt;
    if (danger > 0.25 && heart <= 0) { heart = 1.15 - danger * 0.6; audio.heart(0.25 + danger * 0.6); }
    if (P.tired) { breath -= dt; if (breath <= 0) { breath = 1.05; audio.breath(); } }
    // szum kasety: najbliższa kaseta cicho buczy z jej strony
    let nt: Pickup | null = null, nd = 99;
    for (const tp of world.tapes) if (!tp.taken) { const d = Math.hypot(tp.x - P.x, tp.z - P.z); if (d < nd) { nd = d; nt = tp; } }
    if (nt) audio.hum(panOf((nt.x - P.x) / nd, (nt.z - P.z) / nd), Math.max(0, 1 - nd / 13)); else audio.hum(0, 0);
    let sd = 99, sp = 0;
    for (const [x, z] of world.streams) { const d = Math.hypot(x - P.x, z - P.z); if (d < sd) { sd = d; sp = panOf((x - P.x) / (d || 1), (z - P.z) / (d || 1)); } }
    audio.stream(sp, Math.max(0, 1 - sd / 14));
    if (md < CATCH) caught();
  }

  const panOf = (dx: number, dz: number) => Math.max(-1, Math.min(1, dx * Math.cos(P.yaw) - dz * Math.sin(P.yaw)));

  /** pojawia się raz, daleko i poza wzrokiem gracza; dalej już tylko chodzi */
  function activate() {
    Mo.on = true;
    if (!teleport(7, 11)) teleport(4, 22);
    monster.object.visible = true;
    Mo.rot = Math.random() * Math.PI * 2;
    wander();
  }

  const setTarget = (x: number, z: number) => { Mo.tx = x; Mo.tz = z; };
  /** cel krążenia: losowy wolny blok; czasem w okolicy gracza (im więcej kaset, tym częściej), żeby gra nie była pusta -
   *  to tylko „okolica”, nie dokładne miejsce, a potwór i tak musi gracza zobaczyć albo usłyszeć */
  function wander() {
    Mo.state = 'wander';
    const open = world!.open;
    const near = Math.random() < 0.3 + P.tapes * 0.07;
    for (let i = 0; i < 40; i++) {
      const id = open[(Math.random() * open.length) | 0], x = center(id % N), z = center((id / N) | 0);
      const dp = Math.hypot(x - P.x, z - P.z), dm = Math.hypot(x - Mo.x, z - Mo.z);
      if (near ? dp > 6 && dp < 22 : dm > 8 && dm < 36) { setTarget(x, z); return; }
    }
    const id = open[(Math.random() * open.length) | 0];
    setTarget(center(id % N), center((id / N) | 0));
  }
  /** potwór widzi gracza: przed sobą, w zasięgu (latarka widać z daleka, w ciemności i w kucki bliżej), bez ściany po drodze */
  function sees(d: number) {
    const range = (P.light && P.battery > 0 ? SEE_LIT : SEE_DARK) * (P.crouch ? 0.6 : 1);
    if (d > range) return false;
    if (d < 1.4 && !P.crouch) return true;   // wpadłeś na niego
    const c = ((P.x - Mo.x) * Math.sin(Mo.rot) + (P.z - Mo.z) * Math.cos(Mo.rot)) / Math.max(d, 1e-3);
    return c > VIEW_COS && losClear(Mo.x, Mo.z, P.x, P.z);
  }
  /** hałas w punkcie: jeśli dosięga potwora (przez ściany słabiej), obraca się w tamtą stronę i idzie sprawdzić */
  function noise(x: number, z: number, r: number) {
    if (!Mo.on || mode !== 'play' || Mo.state === 'chase') return;
    const d = Math.hypot(x - Mo.x, z - Mo.z);
    if (d > (losClear(Mo.x, Mo.z, x, z) ? r : r * 0.55)) return;
    Mo.state = 'investigate'; setTarget(x, z);
    Mo.look = Math.atan2(x - Mo.x, z - Mo.z); Mo.snap = 0.8; Mo.idleT = 0;
  }
  /** dokąd biec za graczem: gdy schował się w kanale wentylacyjnym, do wylotu po drugiej stronie (potwór się w nim nie mieści).
   *  Wylot wybiera raz na kanał - ten, do którego ma dalej drogą - i trzyma się go, żeby nie zawracać w połowie obchodzenia ściany */
  function chasePoint(): [number, number] {
    const bx = blockOf(P.x), bz = blockOf(P.z), id = bz * N + bx;
    if (grid[id] !== 3) { Mo.duct = -1; return [P.x, P.z]; }
    if (Mo.duct !== id) {
      Mo.duct = id;
      const mb = blockOf(Mo.z) * N + blockOf(Mo.x);
      let bd = -2;
      for (const [dx, dz] of DIRS) {
        const x = bx + dx, z = bz + dz;
        if (blocks(x, z)) continue;
        buildFlow(x, z);
        if (flow[mb] > bd) { bd = flow[mb]; Mo.ductEnd = z * N + x; }
      }
    }
    return [center(Mo.ductEnd % N), center((Mo.ductEnd / N) | 0)];
  }

  function monsterStep(dt: number) {
    const dx = P.x - Mo.x, dz = P.z - Mo.z, d = Math.hypot(dx, dz);
    // zmysły
    const see = sees(d);
    Mo.notice = see ? Math.min(1, Mo.notice + dt * (d < 6 ? 4 : 1.6)) : Math.max(0, Mo.notice - dt * 0.4);
    if (see && (Mo.state === 'chase' || Mo.notice >= NOTICE)) {
      if (Mo.state !== 'chase') audio.sting();
      Mo.state = 'chase'; Mo.track = LOSE_TIME; Mo.idleT = 0;
      setTarget(...chasePoint());
    } else if (Mo.state === 'chase') {
      Mo.track -= dt;
      if (Mo.track > 0) setTarget(...chasePoint());   // jeszcze chwilę wie, dokąd uciekłeś
      else { Mo.state = 'search'; Mo.searchT = SEARCH_TIME; Mo.idleT = 0; Mo.peek = false; }   // spieszy tam, gdzie cię zgubił
    }
    // droga do celu (pole odległości od bloku celu, ściany i kanały omija)
    const tb = blockOf(Mo.tz) * N + blockOf(Mo.tx);
    buildFlow(tb % N, (tb / N) | 0);
    const mb = blockOf(Mo.z) * N + blockOf(Mo.x);
    const fd = flow[mb];
    if (fd < 0) {   // nie da się dojść: szuka tutaj albo krąży dalej
      if (Mo.state === 'wander') wander(); else if (Mo.state !== 'search') { Mo.state = 'search'; Mo.searchT = SEARCH_TIME; setTarget(Mo.x, Mo.z); }
    }
    const arrived = mb === tb && Math.hypot(Mo.tx - Mo.x, Mo.tz - Mo.z) < 0.6;
    // postoje: na miejscu rozgląda się; w szukaniu zagląda potem w pobliskie zakamarki, w krążeniu idzie dalej
    let standing = false;
    if (Mo.state === 'search') {
      Mo.searchT -= dt;
      if (Mo.searchT < -6 && Mo.idleT <= 0) wander();   // nie doszedł na czas: odpuszcza
    }
    if (Mo.idleT > 0 && Mo.state !== 'chase') {
      Mo.idleT -= dt; standing = true;
      if (Mo.idleT <= 0) {
        if (Mo.state === 'wander' || (Mo.state === 'search' && Mo.searchT <= 0)) wander();
        else if (Mo.state === 'search') {
          const bx = blockOf(Mo.x), bz = blockOf(Mo.z), opts: number[] = [];
          for (let z = bz - 3; z <= bz + 3; z++) for (let x = bx - 3; x <= bx + 3; x++) if (!blocks(x, z)) opts.push(z * N + x);
          const id = opts[(Math.random() * opts.length) | 0];
          setTarget(center(id % N), center((id / N) | 0));
        }
      }
    } else if (arrived && Mo.state !== 'chase') {
      if (Mo.state === 'investigate') { Mo.state = 'search'; Mo.searchT = SEARCH_TIME; }
      Mo.peek = true;
      Mo.idleT = Mo.state === 'search' ? 1.2 + Math.random() * 1.3 : 1 + Math.random() * 2;
      standing = true;
    }

    // prędkość
    let speed = Mo.state === 'chase' ? 3.1 + P.tapes * 0.25 + (P.tapes >= TAPES ? 0.3 : 0)
      : Mo.state === 'investigate' ? SPD_INVESTIGATE : Mo.state === 'search' ? (Mo.peek ? SPD_SEARCH : SPD_LASTSEEN) : SPD_WANDER;
    if (Mo.seen && d < 14) speed *= 0.55;   // światło latarki go spowalnia
    Mo.wade = inWater(Mo.x, Mo.z);
    if (Mo.wade) speed *= 0.7;
    // barykada: nie skacze, tylko powoli się przez nią przełazi - przeskoczenie jej to sposób na zgubienie go
    let climb = 0, slow = false;
    const bar = world?.props.get(mb);
    if (bar) for (const pr of bar) if (!pr.lo && pr.h <= BAR_H && Mo.x > pr.x0 - 0.45 && Mo.x < pr.x1 + 0.45 && Mo.z > pr.z0 - 0.45 && Mo.z < pr.z1 + 0.45) { climb = Math.max(climb, pr.h); if (pr.h > STEP + 0.05) slow = true; }
    if (slow) speed *= 0.28;
    Mo.climb += (climb - Mo.climb) * (1 - Math.exp(-dt * 4));
    if (standing) speed = 0;

    // następny krok: blok bliżej celu, w bloku celu prosto do punktu, a w pościgu z bliska prosto na gracza
    let tx = Mo.tx, tz = Mo.tz;
    const direct = Mo.state === 'chase' && see && d < 6;
    if (direct) { tx = P.x; tz = P.z; }
    else if (fd > 0) {
      const cx = blockOf(Mo.x), cz = blockOf(Mo.z);
      for (const [ddx, ddz] of DIRS) {
        const x = cx + ddx, z = cz + ddz;
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        if (flow[z * N + x] === fd - 1) { tx = center(x); tz = center(z); break; }
      }
    }
    const mx = tx - Mo.x, mz = tz - Mo.z, ml = Math.hypot(mx, mz);
    let stepLen = Math.min(ml, speed * dt);
    if (ml > 1e-4 && stepLen > 0) {
      const nx = Mo.x + mx / ml * stepLen, nz = Mo.z + mz / ml * stepLen;
      // do kanału wentylacyjnego się nie zmieści: staje przy wejściu (krok przy krawędzi bloku)
      const ax = blockOf(nx + Math.sign(mx) * 0.35), az = blockOf(nz + Math.sign(mz) * 0.35);
      if (ax >= 0 && az >= 0 && ax < N && az < N && grid[az * N + ax] === 3) stepLen = 0;
      else { Mo.x = nx; Mo.z = nz; }
    } else stepLen = 0;
    Mo.speed = stepLen / Math.max(dt, 1e-4);
    Mo.stepAcc += stepLen;
    if (Mo.stepAcc > 1.15) { Mo.stepAcc = 0; if (d < 24) audio.thud(Math.pow(1 - d / 24, 2) * (Mo.wade ? 0.5 : 1)); }
    monster.object.position.set(Mo.x, Mo.climb, Mo.z);

    // kierunek patrzenia: w pościgu na gracza, w marszu przed siebie, na postoju rozgląda się (albo w stronę hałasu)
    Mo.snap -= dt; Mo.lookT -= dt;
    let face = Mo.rot;
    if (Mo.state === 'chase' && see) face = Math.atan2(dx, dz);
    else if (Mo.snap > 0) face = Mo.look;
    else if (Mo.speed > 0.05) face = Math.atan2(mx, mz);
    else {
      if (Mo.lookT <= 0) { Mo.look = Mo.rot + (Math.random() - 0.5) * 2.6; Mo.lookT = 1 + Math.random() * 1.4; }
      face = Mo.look;
    }
    let dr = face - Mo.rot;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    Mo.rot += dr * (1 - Math.exp(-dt * (Mo.snap > 0 ? 9 : 4)));
    monster.object.rotation.y = Mo.rot;
  }

  /** lądowanie po skoku: głośne, potwór słyszy je z daleka (w wodzie jeszcze dalej) */
  function land(k: number) {
    const wet = inWater(P.x, P.z) || inWet(P.x, P.z);
    if (wet) audio.splash(true); else audio.land(k);
    noise(P.x, P.z, HEAR_LAND * Math.max(0.5, k) * (wet ? HEAR_WATER : 1));
  }

  /** punkt stoi w kałuży pod wodą spływającą po ścianie */
  function inWet(x: number, z: number) {
    if (!world) return false;
    for (const r of world.wet) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
    return false;
  }

  /** punkt stoi w wodzie basenu */
  function inWater(x: number, z: number) {
    if (!world) return false;
    for (const r of world.pools) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
    return false;
  }

  /** wysokość, na której stoi się w punkcie (wierzch przeszkody, na którą da się wskoczyć, albo podłoga) */
  function groundAt(x: number, z: number) {
    const list = world?.props.get(blockOf(z) * N + blockOf(x));
    let g = 0;
    // w powietrzu, opadając, łapie się krawędź z większym zapasem (wskok „na styk” kończy się na barykadzie, nie odbiciem)
    const reach = !P.ground && P.vy <= 0 ? 0.3 : STEP;
    if (list) for (const pr of list) {
      if (pr.lo || pr.h > P.y + reach || pr.h <= g) continue;   // sufit kanału albo za wysoko, żeby na nią wejść
      const m = RADIUS * 0.6;   // stoi się na niej, dopóki większa część stopy jest nad krawędzią
      if (x > pr.x0 - m && x < pr.x1 + m && z > pr.z0 - m && z < pr.z1 + m) g = pr.h;
    }
    return g;
  }

  /** jarzeniówki: mrugające losowo gasną (częściej, gdy potwór jest blisko); światła z puli idą do najbliższych świecących */
  function updateLamps(dt: number) {
    if (!world) return;
    const ls = world.lamps;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (!l.on) continue;
      let k = 1;
      const near = Mo.on && Math.hypot(l.x - Mo.x, l.z - Mo.z) < 7;
      if (!calm && (l.flick || near) && Math.random() < (near ? 0.35 : 0.08)) k = Math.random() * 0.25;
      if (calm && near) k = 0.45;
      if (Math.abs(k - l.k) > 0.05) { l.k = k; world.setLamp(i, k); }
    }
    lampAt -= dt;
    if (lampAt <= 0) {
      lampAt = 0.25;
      const best = ls.filter(l => l.on && Math.abs(l.x - P.x) < 16 && Math.abs(l.z - P.z) < 16)
        .map(l => ({ l, d: Math.hypot(l.x - P.x, l.z - P.z) })).sort((a, b) => a.d - b.d);
      lampLights.forEach((pl, i) => {
        const l = best[i]?.l;
        pl.userData.lamp = l;
        if (l) { pl.position.set(l.x, l.y - 0.25, l.z); pl.distance = l.y > H ? 17 : 11; }
      });
    }
    for (const pl of lampLights) { const l = pl.userData.lamp as Lamp | undefined; pl.intensity = l ? (l.y > H ? 13 : 7) * l.k : 0; }
  }

  /** czy nad punktem jest niski sufit (kanał) poniżej wysokości `top` */
  function overhead(x: number, z: number, top: number) {
    const bx = blockOf(x), bz = blockOf(z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const list = world?.props.get((bz + dz) * N + bx + dx);
      if (list) for (const pr of list) {
        if (!pr.lo || pr.lo >= top) continue;
        if (x > pr.x0 - RADIUS && x < pr.x1 + RADIUS && z > pr.z0 - RADIUS && z < pr.z1 + RADIUS) return true;
      }
    }
    return false;
  }

  function collide(p: { x: number; z: number }, r: number) {
    const inset = 0.08;
    const push = (x0: number, x1: number, z0: number, z1: number) => {
      const cx = Math.max(x0, Math.min(p.x, x1)), cz = Math.max(z0, Math.min(p.z, z1));
      const ex = p.x - cx, ez = p.z - cz, d2 = ex * ex + ez * ez;
      if (d2 >= r * r) return;
      if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += ex * k; p.z += ez * k; }
      else {   // środek w przeszkodzie: wypchnij najkrótszą drogą
        const opts = [[p.x - x0 + r, -1, 0], [x1 - p.x + r, 1, 0], [p.z - z0 + r, 0, -1], [z1 - p.z + r, 0, 1]].sort((a, b) => a[0] - b[0]);
        p.x += opts[0][1] * opts[0][0]; p.z += opts[0][2] * opts[0][0];
      }
    };
    for (let pass = 0; pass < 2; pass++) {
      const bx = blockOf(p.x), bz = blockOf(p.z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx, z = bz + dz;
        if (solid(x, z)) push(x * B + inset, (x + 1) * B - inset, z * B + inset, (z + 1) * B - inset);
        // przeszkody blokują tylko poniżej wierzchu: nad barykadą się przeskakuje albo po niej przechodzi
        const list = world?.props.get(z * N + x);
        if (list) for (const pr of list) {
          if (P.y >= pr.h - 0.04 || P.y + (P.crouch ? CROUCH_H : STAND_H) <= (pr.lo || 0) + 0.02) continue;
          if (!pr.lo && P.ground && pr.h - P.y <= STEP) continue;   // stopień: groundAt wprowadzi na niego
          // opadając tuż pod krawędzią niskiej przeszkody nie odbijamy się (groundAt zaraz postawi gracza na niej)
          if (!pr.lo && !P.ground && P.vy <= 0 && pr.h <= BAR_H && P.y > pr.h - 0.3) continue;
          const bx0 = p.x, bz0 = p.z;
          push(pr.x0, pr.x1, pr.z0, pr.z1);
          if (pr.lo && !P.crouch && lowMsg <= 0 && (p.x !== bx0 || p.z !== bz0)) { lowMsg = 5; setMsg(touchUI ? 'ZA NISKO. KUCNIJ' : 'ZA NISKO. KUCNIJ (C)', 2.5); }
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
      post.uniforms.uScare.value = calm ? Math.min(0.45, scareT / 2.5) : scareT < 0.06 || Math.random() < 0.08 ? 0.85 : 0;
      // kamera celuje w twarz potwora (kość głowy, która rusza się z animacją ataku) i przybliża obraz, żeby twarz wypełniła kadr
      monster.face(faceV);
      const fdx = faceV.x - P.x, fdz = faceV.z - P.z, fdy = faceV.y + monster.height * 0.085 - (P.y + P.eye);   // kość głowy zaczyna się przy szyi: celujemy w środek twarzy
      const yawT = Math.atan2(-fdx, -fdz), pitchT = Math.atan2(fdy, Math.hypot(fdx, fdz));
      const ak = 1 - Math.exp(-dt * (calm ? 3 : 18));
      P.yaw += Math.atan2(Math.sin(yawT - P.yaw), Math.cos(yawT - P.yaw)) * ak;
      P.pitch += (pitchT - P.pitch) * ak;
      const fovT = calm ? 32 : 24;
      if (Math.abs(camera.fov - fovT) > 0.1) { camera.fov += (fovT - camera.fov) * (1 - Math.exp(-dt * (calm ? 2 : 9))); camera.updateProjectionMatrix(); }
      if (scareT >= dur) { ui.scare.classList.remove('on'); el.classList.remove('hz3-scaring'); finish(false); }
    }
    msgT -= dt;
    if (msgT <= 0 && ui.msg.classList.contains('on')) ui.msg.classList.remove('on');
    if (mode === 'play') hud();

    // kamera: lekkie kołysanie przy chodzeniu, w jumpscare drgania
    const bobK = calm ? 0.012 : 0.04;
    const bob = Math.sin(P.walked / (Math.hypot(P.vx, P.vz) > 4 ? 1.05 : 0.78) * Math.PI);
    camera.position.set(P.x, P.y + P.eye + Math.abs(bob) * bobK - bobK * 0.5, P.z);
    camera.rotation.set(P.pitch, P.yaw, bob * bobK * 0.25);
    if (mode === 'scare' && !calm) {
      camera.rotation.x += (Math.random() - 0.5) * 0.03; camera.rotation.y += (Math.random() - 0.5) * 0.03;   // drgania małe: obraz jest przybliżony
      camera.position.x += (Math.random() - 0.5) * 0.05;
    }
    torch.intensity = mode === 'scare' ? 55 : 90 * lightK;   // w jumpscare słabiej: twarz nie może się prześwietlić
    torch.target.position.y = mode === 'scare' ? 0 : -0.9;   // w jumpscare latarka świeci prosto w twarz
    if (Mo.on || mode === 'scare') monster.update({ dt, t: time, speed: mode === 'scare' ? 0 : Mo.speed, seen: Mo.seen || mode === 'scare', danger, calm, attack: mode === 'scare' });
    if (dust) {
      // kurz opada i zawija się wokół gracza, żeby był zawsze dookoła
      const pa = dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pa.array as Float32Array, hd = DUST / 2;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] -= dt * 0.08; if (arr[i + 1] < 0) arr[i + 1] += H;
        while (arr[i] < P.x - hd) arr[i] += DUST; while (arr[i] > P.x + hd) arr[i] -= DUST;
        while (arr[i + 2] < P.z - hd) arr[i + 2] += DUST; while (arr[i + 2] > P.z + hd) arr[i + 2] -= DUST;
      }
      pa.needsUpdate = true;
    }
    audio.update(mode === 'play' || mode === 'scare' ? danger : 0, mode === 'pause' || mode === 'over', mode === 'scare' ? 1 : fx);
    world?.tick(time);

    post.uniforms.uTime.value = time;
    post.uniforms.uDanger.value = mode === 'scare' ? 0.3 : fx;
    post.uniforms.uGlitch.value = mode === 'scare' && !calm ? 0.06 + Math.random() * 0.14 : glitch;
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
  if (import.meta.env.DEV) (window as any).__hzDebug = { P, Mo, camera, monster, get world() { return world; }, get fx() { return fx; }, get danger() { return danger; }, activate, caught, noise: (x: number, z: number, r: number) => noise(x, z, r), tick: (ms: number) => { cancelAnimationFrame(raf); frame(prev + ms); } };

  return { start, pause, destroy };
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- mapa ----------
/** Budynek-labirynt, przy każdej grze inny: komórki labiryntu (algorytm z cofaniem), kilka przebić (pętle, żeby dało się uciekać),
 *  pokoje (basen, łazienka, duże hale z filarami) i małe hale, bloki-ściany z tapetą (InstancedMesh: kilka wywołań rysowania na cały
 *  budynek), barykady w części korytarzy, kanały wentylacyjne. */
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
  // strefy: prostokąt komórek podzielony na kilka pokoi tego samego rodzaju, jeden obok drugiego (basenów, łazienek), albo jedna
  // duża sala. Pokoje łączą się z labiryntem tam, gdzie były przejścia, między sobą co najmniej jednym przejściem, a strefa ma
  // jedno dodatkowe wejście. zone (na blok, razem ze ścianami w środku strefy): 0 korytarz, 1 baseny (Poolrooms), 2 łazienki,
  // 3 duża hala z filarami, 4 wysoka sala (sufit H2) z filarami i balkonem. Strefy nie dotykają pierwszej ani ostatniej kolumny
  // komórek (start, wyjście) i stoją co najmniej 3 bloki od siebie.
  const zone = new Uint8Array(N * N);
  const rooms: { kind: number; x0: number; z0: number; x1: number; z1: number }[] = [];   // w blokach, włącznie
  const zones: { x0: number; z0: number; x1: number; z1: number }[] = [];
  const zoneOf = (kind: number, zw: number, zh: number, divide: boolean) => {
    for (let t = 0; t < 120; t++) {
      const [w, h] = rnd() < 0.5 ? [zw, zh] : [zh, zw];
      if (w > CELLS - 2 || h > CELLS) continue;
      const c0 = 1 + ((rnd() * (CELLS - 1 - w)) | 0), r0 = (rnd() * (CELLS - h + 1)) | 0;
      const X0 = cb(c0), Z0 = cb(r0), X1 = cb(c0 + w - 1), Z1 = cb(r0 + h - 1);
      if (zones.some(r => X0 <= r.x1 + 3 && X1 >= r.x0 - 3 && Z0 <= r.z1 + 3 && Z1 >= r.z0 - 3)) continue;
      zones.push({ x0: X0, z0: Z0, x1: X1, z1: Z1 });
      // podział na pokoje (w komórkach): bok od 4 komórek dzieli się na dwa, pokój ma 2-3 komórki na bok
      const parts: [number, number, number, number][] = [];
      const split = (a: number, b: number, cw: number, ch: number) => {
        if (!divide || (cw < 4 && ch < 4)) { parts.push([a, b, cw, ch]); return; }
        if (cw >= ch) { const k = 2 + ((rnd() * (cw - 3)) | 0); split(a, b, k, ch); split(a + k, b, cw - k, ch); }
        else { const k = 2 + ((rnd() * (ch - 3)) | 0); split(a, b, cw, k); split(a, b + k, cw, ch - k); }
      };
      split(c0, r0, w, h);
      for (const [a, b, cw, ch] of parts) {
        const x0 = cb(a), z0 = cb(b), x1 = cb(a + cw - 1), z1 = cb(b + ch - 1);
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, z, 0);
        rooms.push({ kind, x0, z0, x1, z1 });
      }
      // przejście między sąsiednimi pokojami strefy (w losowym miejscu wspólnej ściany)
      for (const p of parts) for (const q of parts) {
        if (p[0] + p[2] === q[0]) {
          const lo = Math.max(p[1], q[1]), hi = Math.min(p[1] + p[3], q[1] + q[3]);
          if (hi > lo) set(cb(q[0]) - 1, cb(lo + ((rnd() * (hi - lo)) | 0)), 0);
        }
        if (p[1] + p[3] === q[1]) {
          const lo = Math.max(p[0], q[0]), hi = Math.min(p[0] + p[2], q[0] + q[2]);
          if (hi > lo) set(cb(lo + ((rnd() * (hi - lo)) | 0)), cb(q[1]) - 1, 0);
        }
      }
      for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) zone[z * N + x] = kind;
      const side = (rnd() * 4) | 0;
      if (side < 2) { const x = cb(c0 + ((rnd() * w) | 0)), z = side ? Z1 + 1 : Z0 - 1; if (z > RING && z < N - RING - 1) set(x, z, 0); }
      else { const z = cb(r0 + ((rnd() * h) | 0)), x = side === 2 ? X1 + 1 : X0 - 1; if (x > RING && x < N - RING - 1) set(x, z, 0); }
      return;
    }
  };
  zoneOf(1, 6, 4, true); zoneOf(2, 4, 4, true); zoneOf(4, 3, 3, false); zoneOf(4, 3, 2, false); zoneOf(3, 3, 2, false);
  const inRoom = (x: number, z: number, m: number) => zones.some(r => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m);
  // małe hale (3 x 3 bloki, cztery filary w środku), poza pokojami
  const halls: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const cx = cb(1 + ((rnd() * (CELLS - 2)) | 0)), cz = cb(1 + ((rnd() * (CELLS - 2)) | 0));
    if (inRoom(cx, cz, 2)) continue;
    for (let z = cz - 1; z <= cz + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) set(x, z, 0);
    halls.push([cx, cz]);
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
    if (grid[id] !== 0 || dist[id] < 0 || zone[id] === 1 || zone[id] === 2) continue;   // nie w basenie i nie w łazience
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

  // ---------- przeszkody ----------
  const props = new Map<number, Prop[]>();
  // przeszkoda trafia do KAŻDEGO bloku, na który zachodzi (kolizja patrzy na sąsiednie bloki, a groundAt tylko na blok gracza):
  // zapisana w jednym bloku, długi balkon nie miał podłogi w pozostałych - gracz spadał i był wypychany przez ściany.
  // Pierwsze dwa argumenty zostały dla czytelności wywołań, ale bloki liczą się z prostokąta.
  const addProp = (_bx: number, _bz: number, pr: Prop) => {
    const e = 1e-6;
    for (let bz = Math.floor(pr.z0 / B); bz <= Math.floor((pr.z1 - e) / B); bz++) for (let bx = Math.floor(pr.x0 / B); bx <= Math.floor((pr.x1 - e) / B); bx++) {
      const id = bz * N + bx, list = props.get(id);
      if (list) list.push(pr); else props.set(id, [pr]);
    }
  };
  // filary w halach: na rogach środkowego bloku (potwór chodzi środkami bloków i krawędzi, więc ich nie zahacza)
  const pillars: [number, number][] = [];
  for (const [cx, cz] of halls) for (const [px, pz] of [[cx, cz], [cx + 1, cz], [cx, cz + 1], [cx + 1, cz + 1]]) {
    pillars.push([px * B, pz * B]);
    addProp(cx, cz, { x0: px * B - 0.28, x1: px * B + 0.28, z0: pz * B - 0.28, z1: pz * B + 0.28, h: H });
  }
  // duże hale i wysokie sale: filary co drugi narożnik bloków w środku (w wysokich salach aż do sufitu H2)
  const tallPillars: [number, number][] = [];
  for (const r of rooms) if (r.kind === 3 || r.kind === 4) for (let z = r.z0 + 1; z <= r.z1; z++) for (let x = r.x0 + 1; x <= r.x1; x++) {
    if ((x - r.x0 + z - r.z0) % 2) continue;
    (r.kind === 4 ? tallPillars : pillars).push([x * B, z * B]);
    addProp(x, z, { x0: x * B - 0.28, x1: x * B + 0.28, z0: z * B - 0.28, z1: z * B + 0.28, h: r.kind === 4 ? H2 : H });
  }
  // basen: woda w środku pokoju (pas jednego bloku dookoła to suchy brzeg), niski murek na brzegu wody wchodzi się bez skoku
  const fixtures: number[][] = [];   // [x, y0, z, szer. x, wys., szer. z, kolor] - białe i szare sprzęty pokoi
  const streamBits: number[][] = [], puddleBits: number[][] = [];
  const wet: { x0: number; x1: number; z0: number; z1: number }[] = [], streams: [number, number][] = [];
  const pools: { x0: number; x1: number; z0: number; z1: number }[] = [];
  const RIM = 0.25, RIM_H = 0.32;
  for (const r of rooms) if (r.kind === 1 && rnd() < 0.85) {   // nie w każdym pokoju jest woda
    const x0 = (r.x0 + 1) * B, x1 = r.x1 * B, z0 = (r.z0 + 1) * B, z1 = r.z1 * B;
    pools.push({ x0: x0 + RIM, x1: x1 - RIM, z0: z0 + RIM, z1: z1 - RIM });
    const rim = (a0: number, a1: number, b0: number, b1: number) => {
      fixtures.push([(a0 + a1) / 2, 0, (b0 + b1) / 2, a1 - a0, RIM_H, b1 - b0, 0xe6ecec]);
      for (let bz = Math.floor(b0 / B); bz <= Math.floor((b1 - 1e-3) / B); bz++) for (let bx = Math.floor(a0 / B); bx <= Math.floor((a1 - 1e-3) / B); bx++)
        addProp(bx, bz, { x0: Math.max(a0, bx * B), x1: Math.min(a1, (bx + 1) * B), z0: Math.max(b0, bz * B), z1: Math.min(b1, (bz + 1) * B), h: RIM_H });
    };
    rim(x0, x1, z0, z0 + RIM); rim(x0, x1, z1 - RIM, z1); rim(x0, x0 + RIM, z0 + RIM, z1 - RIM); rim(x1 - RIM, x1, z0 + RIM, z1 - RIM);
  }
  // ściana bloku od strony wolnego miejsca: u wzdłuż ściany (metry świata), v od ściany do środka; d: 0 północ (z - 1), 1 południe,
  // 2 zachód (x - 1), 3 wschód. faceBox stawia tam prostopadłościan (kolor na egzemplarz, opcjonalnie przeszkoda o wysokości solid)
  type Face = { plane: number; inward: number; alongX: boolean };
  const FACE_DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const faceOf = (x: number, z: number, d: number): Face => [
    { plane: z * B, inward: 1, alongX: true }, { plane: (z + 1) * B, inward: -1, alongX: true },
    { plane: x * B, inward: 1, alongX: false }, { plane: (x + 1) * B, inward: -1, alongX: false }][d];
  const faceRect = (f: Face, u0: number, u1: number, v0: number, v1: number) => {
    const a = f.plane + f.inward * v0, b = f.plane + f.inward * v1;
    return f.alongX ? [u0, u1, Math.min(a, b), Math.max(a, b)] : [Math.min(a, b), Math.max(a, b), u0, u1];
  };
  const faceBox = (f: Face, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, color: number, solid: number | false = false, list = fixtures) => {
    const [x0, x1, z0, z1] = faceRect(f, u0, u1, v0, v1);
    list.push([(x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color]);
    if (solid !== false) addProp(Math.floor((x0 + x1) / 2 / B), Math.floor((z0 + z1) / 2 / B), { x0, x1, z0, z1, h: solid });
  };
  // łazienka: kabiny z sedesami przy ścianie, która ma najwięcej pełnych bloków, i umywalki z lustrem przy następnej
  let stallSpot: [number, number, number] | null = null;
  for (const r of rooms) if (r.kind === 2) {
    const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    const sides = [
      { blocks: span(r.x0, r.x1).filter(x => get(x, r.z0 - 1) === 1), plane: r.z0 * B, inward: 1, alongX: true },
      { blocks: span(r.x0, r.x1).filter(x => get(x, r.z1 + 1) === 1), plane: (r.z1 + 1) * B, inward: -1, alongX: true },
      { blocks: span(r.z0, r.z1).filter(z => get(r.x0 - 1, z) === 1), plane: r.x0 * B, inward: 1, alongX: false },
      { blocks: span(r.z0, r.z1).filter(z => get(r.x1 + 1, z) === 1), plane: (r.x1 + 1) * B, inward: -1, alongX: false },
    ].sort((a, b) => b.blocks.length - a.blocks.length);
    // prostokąt w układzie ściany: u wzdłuż ściany (metry), v od ściany do środka pokoju, y od dołu do góry
    type Side = typeof sides[number];
    const put = (sd: Side, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, color: number, solid: boolean) => {
      const a = sd.plane + sd.inward * v0, b = sd.plane + sd.inward * v1;
      const [x0, x1, z0, z1] = sd.alongX ? [u0, u1, Math.min(a, b), Math.max(a, b)] : [Math.min(a, b), Math.max(a, b), u0, u1];
      fixtures.push([(x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color]);
      if (solid) addProp(Math.floor((x0 + x1) / 2 / B), Math.floor((z0 + z1) / 2 / B), { x0, x1, z0, z1, h: y1 });
    };
    const stalls = sides[0], sinks = sides[1];
    const walls = new Set<number>();
    for (const b of stalls.blocks.slice(0, 2)) {
      const u0 = b * B, um = u0 + B / 2;
      for (const u of [u0 + 0.05, um, u0 + B - 0.05]) {
        const k = Math.round(u * 10);
        if (walls.has(k)) continue;
        walls.add(k);
        put(stalls, u - 0.03, u + 0.03, 0, 1.5, 0, 2.05, 0x7f8f94, true);   // ścianka kabiny
      }
      for (const c of [u0 + B / 4, um + B / 4]) {
        put(stalls, c - 0.2, c + 0.2, 0.18, 0.7, 0, 0.42, 0xe8e6df, true);   // sedes
        put(stalls, c - 0.23, c + 0.23, 0, 0.2, 0, 0.85, 0xe8e6df, true);    // spłuczka
        if (!stallSpot) {
          const v = stalls.plane + stalls.inward * 0.45;
          stallSpot = stalls.alongX ? [c, v, 0.42] : [v, c, 0.42];
        }
      }
    }
    if (sinks !== stalls) for (const b of sinks.blocks.slice(0, 2)) {
      const u0 = b * B;
      put(sinks, u0 + 0.12, u0 + B - 0.12, 0, 0.55, 0, 0.85, 0xd8d5cb, true);   // blat
      for (const c of [u0 + B * 0.3, u0 + B * 0.7]) put(sinks, c - 0.22, c + 0.22, 0.08, 0.42, 0.85, 0.88, 0x8f989b, false);   // umywalki
      put(sinks, u0 + 0.25, u0 + B - 0.25, 0, 0.02, 1.25, 2.1, 0x34424a, false);   // lustro
    }
    // w części łazienek woda spływa strumieniem po ścianie (spod sufitu do kałuży na podłodze)
    // wolne kawałki ścian: wszystko poza dwoma blokami kabin i dwoma blokami umywalek
    const free: [Side, number][] = [];
    for (const sd of sides) for (const b of sd.blocks.slice(sd === stalls || sd === sinks ? 2 : 0)) free.push([sd, b]);
    for (let i = free.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [free[i], free[j]] = [free[j], free[i]]; }
    if (rnd() < 0.85) for (const [sd, b] of free.slice(0, 1 + ((rnd() * 2) | 0))) {
      const c = b * B + B / 2 + (rnd() - 0.5) * 1.2;
      const [x0, x1, z0, z1] = faceRect(sd, c - 0.28, c + 0.28, 0.02, 0.06);
      streamBits.push([(x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, H, z1 - z0]);
      faceBox(sd, c - 0.5, c + 0.5, 0.012, 0.018, 0, H, 0x56625f);   // mokre, ciemniejsze kafle za wodą
      const [px0, px1, pz0, pz1] = faceRect(sd, c - 0.95, c + 0.95, 0, 1.15);
      puddleBits.push([(px0 + px1) / 2, 0.006, (pz0 + pz1) / 2, px1 - px0, 0.006, pz1 - pz0]);
      wet.push({ x0: px0, x1: px1, z0: pz0, z1: pz1 });
      streams.push([(x0 + x1) / 2, (z0 + z1) / 2]);
    }
  }

  // wysokie sale: balkon przy pełnej ścianie, a na niego schody (po stopniach 0,2 m wchodzi się bez skoku)
  const PLAT = 2.6;
  let balconySpot: [number, number, number] | null = null;
  for (const r of rooms) if (r.kind === 4) {
    let best: { f: Face; u0: number; u1: number } | null = null;
    const runs = (cells: number[], test: (c: number) => boolean, f: Face) => {
      let start = -1;
      for (let i = 0; i <= cells.length; i++) {
        const ok = i < cells.length && test(cells[i]);
        if (ok && start < 0) start = i;
        if (!ok && start >= 0) {
          const u0 = cells[start] * B + 0.1, u1 = (cells[i - 1] + 1) * B - 0.1;
          if (u1 - u0 > 7 && (!best || u1 - u0 > best.u1 - best.u0)) best = { f, u0, u1 };
          start = -1;
        }
      }
    };
    const xs = Array.from({ length: r.x1 - r.x0 + 1 }, (_, i) => r.x0 + i), zs = Array.from({ length: r.z1 - r.z0 + 1 }, (_, i) => r.z0 + i);
    runs(xs, x => get(x, r.z0 - 1) === 1, faceOf(0, r.z0, 0));
    runs(xs, x => get(x, r.z1 + 1) === 1, faceOf(0, r.z1, 1));
    runs(zs, z => get(r.x0 - 1, z) === 1, faceOf(r.x0, 0, 2));
    runs(zs, z => get(r.x1 + 1, z) === 1, faceOf(r.x1, 0, 3));
    const bb = best as { f: Face; u0: number; u1: number } | null;
    if (!bb) continue;
    const STEPS = 13, run = 3.0, dir = rnd() < 0.5 ? 1 : -1;
    const sU = dir > 0 ? bb.u0 : bb.u1 - run;   // schody przy jednym końcu, balkon dalej
    for (let i = 0; i < STEPS; i++) {
      const k = dir > 0 ? i : STEPS - 1 - i, hgt = PLAT * (i + 1) / STEPS;
      faceBox(bb.f, sU + run * k / STEPS, sU + run * (k + 1) / STEPS, 0, 1.2, 0, hgt, 0x8f8771, hgt);
    }
    const p0 = dir > 0 ? bb.u0 + run : bb.u0, p1 = dir > 0 ? bb.u1 : bb.u1 - run;
    faceBox(bb.f, p0, p1, 0, 1.3, 0, PLAT, 0x7d765f, PLAT);
    faceBox(bb.f, p0, p1, 1.26, 1.3, PLAT, PLAT + 1.0, 0x5b5648);   // barierka (da się z balkonu zeskoczyć)
    if (!balconySpot) { const [x0, x1, z0, z1] = faceRect(bb.f, (p0 + p1) / 2 - 0.1, (p0 + p1) / 2 + 0.1, 0.5, 0.7); balconySpot = [(x0 + x1) / 2, (z0 + z1) / 2, PLAT]; }
  }


  // barykady z kartonów w części wąskich korytarzy (przejścia między komórkami ze ścianami po bokach), nie przy starcie
  const barriers: { x: number; z: number; alongX: boolean }[] = [];
  const passages: [number, number, boolean][] = [];
  for (let lz = 1; lz < G - 1; lz++) for (let lx = 1; lx < G - 1; lx++) {
    const x = RING + lx, z = RING + lz;
    if ((lx % 2 === 0) === (lz % 2 === 0) || get(x, z) !== 0) continue;
    const alongX = lx % 2 === 0;   // przejście między komórkami z lewej i prawej
    const walls = alongX ? get(x, z - 1) === 1 && get(x, z + 1) === 1 : get(x - 1, z) === 1 && get(x + 1, z) === 1;
    if (!walls || dist[z * N + x] < 4 || z === exitZ) continue;
    passages.push([x, z, alongX]);
  }
  for (let i = passages.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [passages[i], passages[j]] = [passages[j], passages[i]]; }
  for (const [x, z, alongX] of passages.slice(0, Math.min(10, Math.round(passages.length * 0.16)))) {
    barriers.push({ x, z, alongX });
    const c = (alongX ? x : z) * B + B / 2;   // barykada w poprzek korytarza, 0,7 m grubości
    if (alongX) addProp(x, z, { x0: c - 0.35, x1: c + 0.35, z0: z * B + 0.08, z1: (z + 1) * B - 0.08, h: BAR_H });
    else addProp(x, z, { x0: x * B + 0.08, x1: (x + 1) * B - 0.08, z0: c - 0.35, z1: c + 0.35, h: BAR_H });
  }

  // kanały wentylacyjne: przejścia w kucki przez ścianę między dwiema komórkami, do których drogą jest daleko. Potwór się
  // w nich nie mieści (blok 3 jest dla niego ścianą), więc to skróty do ucieczki. Ściana zostaje, w środku otwór DUCT_W x DUCT_LO.
  const ducts: { x: number; z: number; alongX: boolean }[] = [];
  const ductCands: [number, number, boolean, number][] = [];
  for (let lz = 1; lz < G - 1; lz++) for (let lx = 1; lx < G - 1; lx++) {
    const x = RING + lx, z = RING + lz;
    if ((lx % 2 === 0) === (lz % 2 === 0) || get(x, z) !== 1) continue;
    const alongX = lx % 2 === 0;
    const [ax, az, bx, bz] = alongX ? [x - 1, z, x + 1, z] : [x, z - 1, x, z + 1];
    const da = dist[az * N + ax], db = dist[bz * N + bx];
    if (da < 3 || db < 3 || (Math.abs(z - exitZ) <= 1 && x >= gateX - 2)) continue;
    if (zone[az * N + ax] === 1 || zone[az * N + ax] === 2 || zone[bz * N + bx] === 1 || zone[bz * N + bx] === 2) continue;   // kafelki zakryłyby wylot
    const gain = Math.abs(da - db);   // tyle bloków drogi oszczędza (co najmniej)
    if (gain >= 8) ductCands.push([x, z, alongX, gain + rnd() * 6]);
  }
  ductCands.sort((a, b) => b[3] - a[3]);
  for (const [x, z, alongX] of ductCands) {
    if (ducts.length >= DUCTS) break;
    if (ducts.some(d => Math.abs(d.x - x) + Math.abs(d.z - z) < 6)) continue;
    ducts.push({ x, z, alongX });
    set(x, z, 3);
    const x0 = x * B, x1 = (x + 1) * B, z0 = z * B, z1 = (z + 1) * B, half = DUCT_W / 2;
    if (alongX) {
      const c = (z + 0.5) * B;
      addProp(x, z, { x0, x1, z0, z1: c - half, h: H });
      addProp(x, z, { x0, x1, z0: c + half, z1, h: H });
      addProp(x, z, { x0, x1, z0: c - half, z1: c + half, h: H, lo: DUCT_LO });
    } else {
      const c = (x + 0.5) * B;
      addProp(x, z, { x0, x1: c - half, z0, z1, h: H });
      addProp(x, z, { x0: c + half, x1, z0, z1, h: H });
      addProp(x, z, { x0: c - half, x1: c + half, z0, z1, h: H, lo: DUCT_LO });
    }
  }

  // dziwne, bezsensowne konstrukcje przy ścianach (jak w filmach o Backrooms): pochylnie donikąd, schody w sufit, drzwi w połowie
  // ściany, okna w ciemność, krzesła twarzą do ściany. Tylko przy ścianach (do 1,2 m od nich), bo potwór chodzi środkami bloków.
  const slabs: THREE.Matrix4[] = [];   // pochylone płyty (pochylnie)
  {
    const busy = new Set<number>([...chosen, ...bats, sz * N + sx]);
    const faces: [number, number, number][] = [];
    for (let z = RING + 1; z < N - RING - 1; z++) for (let x = RING + 1; x < gateX - 1; x++) {
      const id = z * N + x, zn = zone[id];
      if (grid[id] !== 0 || zn === 1 || zn === 2 || busy.has(id) || props.has(id) || dist[id] < 3 || z === exitZ) continue;
      FACE_DIRS.forEach(([dx, dz], d) => { if (get(x + dx, z + dz) === 1) faces.push([x, z, d]); });
    }
    for (let i = faces.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [faces[i], faces[j]] = [faces[j], faces[i]]; }
    const used = new Set<number>();
    const take = (n: number, make: (x: number, z: number, f: Face, u0: number) => void, ok = (_id: number) => true) => {
      for (const [x, z, d] of faces) {
        if (n <= 0) break;
        const id = z * N + x;
        if (used.has(id) || !ok(id)) continue;
        used.add(id); n--;
        const f = faceOf(x, z, d);
        make(x, z, f, (f.alongX ? x : z) * B);
      }
    };
    // pochylnia donikąd: wjeżdża się po niej na 1,1 m i urywa się (zderzenia = 11 niskich stopni)
    take(5, (_x, _z, f, ub) => {
      const L = B - 0.4, D = 0.95, RISE = 1.1, dir = rnd() < 0.5 ? 1 : -1, u0 = ub + 0.2;
      for (let i = 0; i < 11; i++) {
        const k = dir > 0 ? i : 10 - i;
        const [x0, x1, z0, z1] = faceRect(f, u0 + L * k / 11, u0 + L * (k + 1) / 11, 0, D);
        addProp(Math.floor((x0 + x1) / 2 / B), Math.floor((z0 + z1) / 2 / B), { x0, x1, z0, z1, h: RISE * (i + 1) / 11 });
      }
      const [x0, x1, z0, z1] = faceRect(f, u0, u0 + L, 0, D), ang = Math.atan2(RISE, L) * dir;
      const qq = new THREE.Quaternion().setFromEuler(f.alongX ? new THREE.Euler(0, 0, ang) : new THREE.Euler(-ang, 0, 0));
      const len = Math.hypot(L, RISE);
      slabs.push(new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, RISE / 2, (z0 + z1) / 2), qq, f.alongX ? new THREE.Vector3(len, 0.07, D) : new THREE.Vector3(D, 0.07, len)));
      const hu = dir > 0 ? u0 + L - 0.07 : u0;
      faceBox(f, hu, hu + 0.07, 0, D, 0, RISE, 0x6d6858);   // ściana pod wysokim końcem
    }, id => zone[id] !== 4);
    // schody w sufit: pierwsze stopnie są do wejścia, wyższe znikają w suficie i są już ścianą
    take(4, (_x, _z, f, ub) => {
      const n = 10, depth = 0.28, dir = rnd() < 0.5 ? 1 : -1, u0 = dir > 0 ? ub + 0.25 : ub + B - 0.25 - n * depth;
      for (let i = 0; i < n; i++) {
        const k = dir > 0 ? i : n - 1 - i, hgt = 0.3 * (i + 1);
        faceBox(f, u0 + depth * k, u0 + depth * (k + 1), 0, 1.0, 0, Math.min(hgt, H), 0x9a8f72, hgt <= 1.2 ? hgt : H);
      }
    }, id => zone[id] !== 4);
    // drzwi donikąd, czasem zawieszone w połowie ściany
    take(7, (_x, _z, f, ub) => {
      const c = ub + B / 2 + (rnd() - 0.5) * 1.2, y0 = rnd() < 0.4 ? 0.8 + rnd() * 0.8 : 0;
      const frame = 0xcfc6ae, door = [0x8a6a48, 0xb9b09a, 0x5b6a70][(rnd() * 3) | 0];
      faceBox(f, c - 0.53, c - 0.45, 0, 0.07, y0, y0 + 2.12, frame);
      faceBox(f, c + 0.45, c + 0.53, 0, 0.07, y0, y0 + 2.12, frame);
      faceBox(f, c - 0.53, c + 0.53, 0, 0.07, y0 + 2.05, y0 + 2.13, frame);
      faceBox(f, c - 0.45, c + 0.45, 0, 0.04, y0, y0 + 2.05, door);
      faceBox(f, c + 0.3, c + 0.36, 0.04, 0.09, y0 + 0.98, y0 + 1.04, 0xb8a46a);   // klamka
    });
    // okna w ciemność
    take(4, (_x, _z, f, ub) => {
      const c = ub + B / 2 + (rnd() - 0.5) * 1.0, y0 = 1.0 + rnd() * 0.4;
      faceBox(f, c - 0.66, c + 0.66, 0, 0.06, y0 - 0.06, y0 + 0.96, 0xd6cfba);
      faceBox(f, c - 0.6, c + 0.6, 0, 0.065, y0, y0 + 0.9, 0x050506);
      faceBox(f, c - 0.03, c + 0.03, 0, 0.08, y0, y0 + 0.9, 0xd6cfba);   // szczebel
    });
    // krzesła twarzą do ściany
    take(6, (_x, _z, f, ub) => {
      const c = ub + B / 2 + (rnd() - 0.5) * 1.6, v = 0.35 + rnd() * 0.3;
      faceBox(f, c - 0.23, c + 0.23, v, v + 0.46, 0.42, 0.47, 0x6b5a45);
      faceBox(f, c - 0.23, c + 0.23, v + 0.41, v + 0.46, 0.47, 0.95, 0x4a4038);
      for (const [a, b] of [[-0.21, v + 0.02], [0.17, v + 0.02], [-0.21, v + 0.41], [0.17, v + 0.41]]) faceBox(f, c + a, c + a + 0.04, b, b + 0.04, 0, 0.42, 0x3a332c);
    });
  }

  // ---------- geometria ----------
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, rx: number, ry: number) => {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d')!);
    const t = keep(new THREE.CanvasTexture(cv));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(rx, ry);
    return t;
  };
  const stain = (g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(70,52,20,${a})`); gr.addColorStop(0.7, `rgba(80,60,25,${a * 0.5})`); gr.addColorStop(1, 'rgba(80,60,25,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.6), rnd() * 3, 0, 7); g.fill();
  };
  const size = N * B + 60;
  // wykładzina: musztardowa, z wilgotnymi plamami
  const carpet = canvasTex(256, 256, g => {
    g.fillStyle = '#6e5d2e'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { const v = rnd() * 30 - 15; g.fillStyle = `rgba(${110 + v},${93 + v},${46 + v},0.5)`; g.fillRect(rnd() * 256, rnd() * 256, 1, 1); }
    for (let i = 0; i < 7; i++) stain(g, rnd() * 256, rnd() * 256, 14 + rnd() * 34, 0.35);
  }, size / 2.6, size / 2.6);
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(size, size)), keep(new THREE.MeshLambertMaterial({ map: carpet, color: 0xd8cfb4 })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(N * B / 2, 0, N * B / 2);
  group.add(floor);
  // sufit z płyt 60 x 60 cm (tekstura = 2 x 2 płyty)
  const tiles = canvasTex(128, 128, g => {
    g.fillStyle = '#cbc097'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(90,80,50,${rnd() * 0.18})`; g.fillRect(rnd() * 128, rnd() * 128, 1, 1); }
    g.fillStyle = '#7d7452';
    for (const p of [0, 64]) { g.fillRect(p, 0, 3, 128); g.fillRect(0, p, 128, 3); }
    if (rnd() < 0.8) stain(g, rnd() * 128, rnd() * 128, 10 + rnd() * 16, 0.3);
  }, 1, 1);
  const tallAt = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && zone[z * N + x] === 4;

  // ściany: tylko bloki, które stykają się z wolnym miejscem (reszty i tak nie widać); poza siatką też, bo za drzwiami biegnie korytarz
  const decoSolid = (x: number, z: number) => {
    if (x >= 0 && z >= 0 && x < N && z < N) return grid[z * N + x] === 1;
    return !(z === exitZ && x >= N && x < N + 2);
  };
  const wallBlocks: [number, number][] = [];
  for (let z = -3; z < N + 3; z++) for (let x = -3; x < N + 3; x++) {
    if (!decoSolid(x, z)) continue;
    if (DIRS.some(([dx, dz]) => !decoSolid(x + dx, z + dz) && !(x + dx >= 0 && z + dz >= 0 && x + dx < N && z + dz < N && grid[(z + dz) * N + x + dx] === 2))) wallBlocks.push([x, z]);
  }
  // sufit: kwadrat nad każdym wolnym blokiem, UV w metrach (płyty pasują na łączeniach), w wysokich salach na H2
  {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let z = -3; z < N + 3; z++) for (let x = -3; x < N + 3; x++) {
      if (decoSolid(x, z)) continue;
      const y = tallAt(x, z) ? H2 : H, x0 = x * B, x1 = x0 + B, z0 = z * B, z1 = z0 + B, n = pos.length / 3;
      pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      uv.push(x0 / 1.2, z0 / 1.2, x1 / 1.2, z0 / 1.2, x1 / 1.2, z1 / 1.2, x0 / 1.2, z1 / 1.2);
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    }
    const cg = keep(new THREE.BufferGeometry());
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    cg.setIndex(idx);
    cg.computeVertexNormals();
    group.add(new THREE.Mesh(cg, keep(new THREE.MeshLambertMaterial({ map: tiles, color: 0xbdb48e, side: THREE.DoubleSide }))));
  }
  // tapeta: pionowe pasy w drobny wzór, ciemna listwa przy podłodze, zacieki
  const paper = canvasTex(256, 256, g => {
    g.fillStyle = '#b9a75a'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = 'rgba(150,130,62,0.55)'; g.fillRect(x, 0, 3, 256); g.fillRect(x + 14, 0, 1, 256);
      for (let y = 8; y < 236; y += 22) { g.fillStyle = 'rgba(140,122,58,0.5)'; g.beginPath(); g.moveTo(x + 23, y); g.lineTo(x + 27, y + 5); g.lineTo(x + 23, y + 10); g.lineTo(x + 19, y + 5); g.fill(); }
    }
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(80,66,30,${rnd() * 0.12})`; g.fillRect(rnd() * 256, rnd() * 256, 1, 2); }
    for (let i = 0; i < 4; i++) { const x = rnd() * 256; const gr = g.createLinearGradient(0, 0, 0, 236); gr.addColorStop(0, 'rgba(90,70,25,0)'); gr.addColorStop(1, 'rgba(90,70,25,0.35)'); g.fillStyle = gr; g.fillRect(x, 120 + rnd() * 80, 6 + rnd() * 18, 120); }
    g.fillStyle = '#4b3d22'; g.fillRect(0, 238, 256, 18);
    g.fillStyle = '#6a5631'; g.fillRect(0, 238, 256, 3);
  }, 1, 1);
  const wg = keep(new THREE.BoxGeometry(B, H, B)); wg.translate(0, H / 2, 0);
  const wallMesh = new THREE.InstancedMesh(wg, keep(new THREE.MeshLambertMaterial({ map: paper })), wallBlocks.length);
  const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), e = new THREE.Euler(), vs = new THREE.Vector3(), vp = new THREE.Vector3(), col = new THREE.Color();
  wallBlocks.forEach(([x, z], i) => {
    m4.compose(vp.set((x + 0.5) * B, 0, (z + 0.5) * B), qn.identity(), vs.set(1, 1, 1));
    wallMesh.setMatrixAt(i, m4);
    const s = 0.86 + rnd() * 0.16;
    wallMesh.setColorAt(i, col.setRGB(s, s * (0.97 + rnd() * 0.04), s * 0.95));
  });
  group.add(wallMesh);
  // filary
  const pg = keep(new THREE.BoxGeometry(0.56, H, 0.56)); pg.translate(0, H / 2, 0);
  const pillarMesh = new THREE.InstancedMesh(pg, keep(new THREE.MeshLambertMaterial({ map: paper, color: 0xe8e0c8 })), pillars.length);
  pillars.forEach(([x, z], i) => { m4.compose(vp.set(x, 0, z), qn.identity(), vs.set(1, 1, 1)); pillarMesh.setMatrixAt(i, m4); });
  group.add(pillarMesh);
  const ripple0 = () => canvasTex(128, 128, g => {
    g.fillStyle = '#7fd0de'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(235,255,255,0.4)'; g.lineWidth = 2;
    for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(rnd() * 128, rnd() * 128, 6 + rnd() * 20, 0, 7); g.stroke(); }
  }, 2, 2);
  // kafelki w basenie i łazience: podłoga, sufit i okładzina ścian (cienkie płyty przed ścianami z tapetą), dno basenu na niebiesko
  const tileTex = (base: string, grout: string, dirt: number) => canvasTex(256, 256, g => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1200; i++) { g.fillStyle = `rgba(90,100,95,${rnd() * dirt})`; g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2); }
    g.fillStyle = grout;
    for (let p = 0; p < 256; p += 32) { g.fillRect(p, 0, 2, 256); g.fillRect(0, p, 256, 2); }
    for (let i = 0; i < 3; i++) stain(g, rnd() * 256, rnd() * 256, 8 + rnd() * 20, dirt * 1.4);
  }, 1, 1);
  const whiteTiles = tileTex('#e6ebe9', '#b3bfc1', 0.12), blueTiles = tileTex('#7fcad8', '#4f9fb0', 0.08);
  const inPool = (x: number, z: number) => pools.some(r => x > r.x0 - RIM && x < r.x1 + RIM && z > r.z0 - RIM && z < r.z1 + RIM);
  const tileFloor: number[][] = [], poolFloor: number[][] = [], tileCeil: number[][] = [], veneer: number[][] = [];
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const zn = zone[z * N + x];
    if ((zn !== 1 && zn !== 2) || grid[z * N + x] !== 0) continue;
    const cx = (x + 0.5) * B, cz = (z + 0.5) * B;
    (inPool(cx, cz) ? poolFloor : tileFloor).push([cx, 0, cz, B, 0.008, B]);
    tileCeil.push([cx, H - 0.008, cz, B, 0.008, B]);
    if (get(x, z - 1) === 1) veneer.push([cx, 0, z * B + 0.011, B, H, 0.02]);
    if (get(x, z + 1) === 1) veneer.push([cx, 0, (z + 1) * B - 0.011, B, H, 0.02]);
    if (get(x - 1, z) === 1) veneer.push([x * B + 0.011, 0, cz, 0.02, H, B]);
    if (get(x + 1, z) === 1) veneer.push([(x + 1) * B - 0.011, 0, cz, 0.02, H, B]);
  }
  const tileMeshes: THREE.InstancedMesh[] = [];
  const instanced = (list: number[][], mat: THREE.Material) => {
    const mesh = new THREE.InstancedMesh(unitBox, mat, Math.max(1, list.length));
    mesh.count = list.length;
    list.forEach(([x, y, z, sx2, sy, sz2], i) => { m4.compose(vp.set(x, y, z), qn.identity(), vs.set(sx2, sy, sz2)); mesh.setMatrixAt(i, m4); });
    group.add(mesh); tileMeshes.push(mesh);
    return mesh;
  };
  const unitBox = keep(new THREE.BoxGeometry(1, 1, 1)); unitBox.translate(0, 0.5, 0);
  const whiteMat = keep(new THREE.MeshLambertMaterial({ map: whiteTiles, color: 0xbcc3c1 }));   // ciemniej: latarka z bliska i tak je rozjaśnia
  instanced(tileFloor, whiteMat); instanced(tileCeil, whiteMat); instanced(veneer, whiteMat);
  instanced(poolFloor, keep(new THREE.MeshLambertMaterial({ map: blueTiles })));
  // sprzęty (kabiny, sedesy, umywalki, lustra, brzeg basenu): kolor na egzemplarz
  const fixMesh = new THREE.InstancedMesh(unitBox, keep(new THREE.MeshLambertMaterial({ color: 0xffffff })), Math.max(1, fixtures.length));
  fixMesh.count = fixtures.length;
  fixtures.forEach(([x, y, z, sx2, sy, sz2, c], i) => { m4.compose(vp.set(x, y, z), qn.identity(), vs.set(sx2, sy, sz2)); fixMesh.setMatrixAt(i, m4); fixMesh.setColorAt(i, col.setHex(c)); });
  group.add(fixMesh); tileMeshes.push(fixMesh);
  // wysokie sale: ściany przy nich dobudowane od H do H2, a nad przejściami do niższych korytarzy nadproże z tapetą
  const paperMat = keep(new THREE.MeshLambertMaterial({ map: paper }));
  const upper: number[][] = [];
  for (const [x, z] of wallBlocks) if (DIRS.some(([dx, dz]) => tallAt(x + dx, z + dz) && !decoSolid(x + dx, z + dz))) upper.push([(x + 0.5) * B, H, (z + 0.5) * B, B, H2 - H, B]);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (!tallAt(x, z) || decoSolid(x, z)) continue;
    FACE_DIRS.forEach(([dx, dz], d) => {
      if (decoSolid(x + dx, z + dz) || tallAt(x + dx, z + dz)) return;
      const f = faceOf(x, z, d), [x0, x1, z0, z1] = faceRect(f, (f.alongX ? x : z) * B, (f.alongX ? x : z) * B + B, 0, 0.2);
      upper.push([(x0 + x1) / 2, H, (z0 + z1) / 2, x1 - x0, H2 - H, z1 - z0]);
    });
  }
  for (const [x, z] of tallPillars) upper.push([x, 0, z, 0.56, H2, 0.56]);
  instanced(upper, paperMat);
  // pochylnie
  const slabMesh = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), keep(new THREE.MeshLambertMaterial({ color: 0x8a8574 })), Math.max(1, slabs.length));
  slabMesh.count = slabs.length;
  slabs.forEach((m, i) => slabMesh.setMatrixAt(i, m));
  group.add(slabMesh); tileMeshes.push(slabMesh);
  // woda spływająca po ścianach łazienek: smugi przesuwane w dół + kałuża
  const streak = canvasTex(64, 256, g => {
    g.clearRect(0, 0, 64, 256);
    for (let i = 0; i < 26; i++) {
      const x = 6 + rnd() * 52, w = 1 + rnd() * 3, y = rnd() * 256, l = 40 + rnd() * 120;
      const gr = g.createLinearGradient(0, y, 0, y + l);
      gr.addColorStop(0, 'rgba(210,240,245,0)'); gr.addColorStop(0.5, `rgba(220,245,250,${0.35 + rnd() * 0.45})`); gr.addColorStop(1, 'rgba(210,240,245,0)');
      g.fillStyle = gr; g.fillRect(x, y, w, l); g.fillRect(x, y - 256, w, l);
    }
    g.fillStyle = 'rgba(160,210,220,0.18)'; g.fillRect(4, 0, 56, 256);
  }, 1, 2);
  const streamMat = keep(new THREE.MeshLambertMaterial({ map: streak, transparent: true, depthWrite: false, emissive: 0x16343a }));
  instanced(streamBits, streamMat);
  const puddleMat = keep(new THREE.MeshLambertMaterial({ map: ripple0(), color: 0x9fd6df, transparent: true, opacity: 0.45, depthWrite: false }));
  instanced(puddleBits, puddleMat);

  // woda: półprzezroczysta, z falującym odblaskiem (przesuwana tekstura)
  const ripple = canvasTex(128, 128, g => {
    g.fillStyle = '#7fd0de'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(235,255,255,0.45)'; g.lineWidth = 2;
    for (let i = 0; i < 9; i++) { g.beginPath(); const y = rnd() * 128; g.moveTo(0, y); for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + Math.sin(x / 20 + i) * 5); g.stroke(); }
  }, 1, 1);
  const waterMat = keep(new THREE.MeshPhongMaterial({ map: ripple, color: 0x9fdce6, transparent: true, opacity: 0.6, shininess: 90, specular: 0x9fe6f0, depthWrite: false }));
  for (const r of pools) {
    const w = r.x1 - r.x0 + RIM * 2, h = r.z1 - r.z0 + RIM * 2;
    const water = new THREE.Mesh(keep(new THREE.PlaneGeometry(w - RIM * 2, h - RIM * 2)), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set((r.x0 + r.x1) / 2, WATER_Y, (r.z0 + r.z1) / 2);
    group.add(water);
    ripple.repeat.set(w / 3, h / 3);
  }

  // kanały: ściana z otworem (dwa boki + nadproże z tapetą) i blaszana wykładzina w środku z ramką przy obu wejściach
  const ductWall: number[][] = [], ductTin: number[][] = [];
  for (const d of ducts) {
    const cx = (d.x + 0.5) * B, cz = (d.z + 0.5) * B, half = DUCT_W / 2, side = (B - DUCT_W) / 2;
    // [środek wzdłuż, dół, środek w poprzek, długość, wysokość, szerokość] w układzie kanału, potem obrót osi dla kanału wzdłuż z
    const put = (list: number[][], along: number, y: number, across: number, len: number, h: number, w: number) =>
      list.push(d.alongX ? [cx + along, y, cz + across, len, h, w] : [cx + across, y, cz + along, w, h, len]);
    put(ductWall, 0, 0, -(half + side / 2), B, H, side);
    put(ductWall, 0, 0, half + side / 2, B, H, side);
    put(ductWall, 0, DUCT_LO, 0, B, H - DUCT_LO, DUCT_W);
    put(ductTin, 0, 0, -half + 0.02, B, DUCT_LO, 0.04);
    put(ductTin, 0, 0, half - 0.02, B, DUCT_LO, 0.04);
    put(ductTin, 0, DUCT_LO - 0.04, 0, B, 0.04, DUCT_W);
    put(ductTin, 0, 0, 0, B, 0.02, DUCT_W - 0.08);
    for (const end of [-1, 1]) {   // ramka wejścia, lekko wystaje ze ściany
      const a = end * (B / 2 + 0.02);
      put(ductTin, a, 0, -half - 0.05, 0.06, DUCT_LO + 0.08, 0.1);
      put(ductTin, a, 0, half + 0.05, 0.06, DUCT_LO + 0.08, 0.1);
      put(ductTin, a, DUCT_LO, 0, 0.06, 0.08, DUCT_W + 0.2);
    }
  }
  const unit = keep(new THREE.BoxGeometry(1, 1, 1)); unit.translate(0, 0.5, 0);
  const ductWallMesh = new THREE.InstancedMesh(unit, keep(new THREE.MeshLambertMaterial({ map: paper })), Math.max(1, ductWall.length));
  const ductTinMesh = new THREE.InstancedMesh(unit, keep(new THREE.MeshLambertMaterial({ color: 0x6f716a })), Math.max(1, ductTin.length));
  for (const [mesh, list] of [[ductWallMesh, ductWall], [ductTinMesh, ductTin]] as [THREE.InstancedMesh, number[][]][]) {
    mesh.count = list.length;
    list.forEach(([x, y, z, sx2, sy, sz2], i) => { m4.compose(vp.set(x, y, z), qn.identity(), vs.set(sx2, sy, sz2)); mesh.setMatrixAt(i, m4); });
    group.add(mesh);
  }

  // jarzeniówki: jedna na blok, większość martwa; ta nad startem świeci
  const lamps: Lamp[] = [];
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (grid[z * N + x] === 1 || grid[z * N + x] === 3) continue;
    const startLamp = x === sx && z === sz, zn = zone[z * N + x];
    // basen jasny (wszystkie świecą), łazienka połowa i często mrugają, reszta jak zwykle
    const on = startLamp || zn === 1 || rnd() < (zn === 2 ? 0.5 : 0.36);
    lamps.push({ x: (x + 0.5) * B, y: zn === 4 ? H2 : H, z: (z + 0.5) * B, on, flick: on && !startLamp && zn !== 1 && rnd() < (zn === 2 ? 0.45 : 0.28), k: on ? 1 : 0 });
  }
  for (let x = N; x < N + 2; x++) lamps.push({ x: (x + 0.5) * B, y: H, z: (exitZ + 0.5) * B, on: true, flick: false, k: 1 });
  const lampMesh = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1.2, 0.05, 0.6)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff })), lamps.length);
  const LAMP_OFF = new THREE.Color(0x46412f), LAMP_ON = new THREE.Color(0xfff6dc);
  const setLamp = (i: number, k: number) => {
    lampMesh.setColorAt(i, col.copy(LAMP_OFF).lerp(LAMP_ON, k));
    if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
  };
  lamps.forEach((l, i) => {
    e.set(0, rnd() < 0.5 ? 0 : Math.PI / 2, 0); qn.setFromEuler(e);
    m4.compose(vp.set(l.x, l.y - 0.025, l.z), qn, l.y > H ? vs.set(1.6, 1, 1.6) : vs.set(1, 1, 1));
    lampMesh.setMatrixAt(i, m4);
    setLamp(i, l.k);
  });
  group.add(lampMesh);

  // barykady: trzy kartony obok siebie w poprzek korytarza
  const boxes: number[][] = [];
  for (const b of barriers) {
    const w = (B - 0.16) / 3;
    for (let i = 0; i < 3; i++) {
      const off = -B / 2 + 0.08 + w * (i + 0.5);
      const cx = (b.x + 0.5) * B + (b.alongX ? (rnd() - 0.5) * 0.12 : off), cz = (b.z + 0.5) * B + (b.alongX ? off : (rnd() - 0.5) * 0.12);
      boxes.push([cx, cz, b.alongX ? 0.7 : w - 0.04, BAR_H - rnd() * 0.04, b.alongX ? w - 0.04 : 0.7, (rnd() - 0.5) * 0.12]);
    }
  }
  // kasety: część na wysokich szafkach (w ślepych zaułkach, przy tylnej ścianie), reszta na niskich kartonach
  const highIdx = new Set<number>();
  // zaułek przed drzwiami wyjścia odpada: szafka stanęłaby w drzwiach (tylna ściana = drzwi)
  const deadOf = (id: number) => {
    const x = id % N, z = (id / N) | 0;
    if (z === exitZ && x === gateX - 1) return null;
    const open = DIRS.filter(([dx, dz]) => get(x + dx, z + dz) === 0);
    return open.length === 1 ? open[0] : null;
  };
  for (let i = 0; i < chosen.length && highIdx.size < 2; i++) if (deadOf(chosen[i]) && rnd() < 0.5) highIdx.add(i);
  for (let i = 0; i < chosen.length && highIdx.size < 2; i++) if (deadOf(chosen[i])) highIdx.add(i);
  const cabinets: number[][] = [];
  // kasety w szczególnych miejscach zamiast zwykłych: w środku kanału (trzeba się wczołgać), na dnie basenu (brodzenie słychać)
  // i na sedesie w kabinie łazienki
  const specials: [number, number, number][] = [];
  if (ducts.length) { const d = ducts[(rnd() * ducts.length) | 0]; specials.push([(d.x + 0.5) * B, (d.z + 0.5) * B, 0.02]); }
  if (pools.length) { const r = pools[(rnd() * pools.length) | 0]; specials.push([r.x0 + (r.x1 - r.x0) * (0.25 + rnd() * 0.5), r.z0 + (r.z1 - r.z0) * (0.25 + rnd() * 0.5), 0.02]); }
  if (stallSpot) specials.push(stallSpot);
  if (balconySpot) specials.push(balconySpot);
  const special = new Map<number, [number, number, number]>();
  for (let i = chosen.length - 1; i >= 0 && special.size < specials.length; i--) if (!highIdx.has(i)) special.set(i, specials[special.size]);
  const tapeSpots = chosen.map((id, i) => {
    const sp = special.get(i);
    if (sp) return { x: sp[0], z: sp[1], y: sp[2], high: false };
    const [x0, z0] = pos(id);
    const d = highIdx.has(i) ? deadOf(id) : null;
    if (!d) {
      const x = x0 + (rnd() - 0.5) * 0.8, z = z0 + (rnd() - 0.5) * 0.8;
      boxes.push([x, z, 0.5, 0.36, 0.42, rnd() * 6]);
      return { x, z, y: 0.36, high: false };
    }
    // szafka przy ścianie naprzeciw wejścia do zaułka
    const back = B / 2 - 0.08 - 0.27;
    const x = x0 - d[0] * back, z = z0 - d[1] * back;
    const wx = d[0] ? 0.5 : 0.9, wz = d[0] ? 0.9 : 0.5;
    cabinets.push([x, z, wx, wz]);
    addProp(id % N, (id / N) | 0, { x0: x - wx / 2, x1: x + wx / 2, z0: z - wz / 2, z1: z + wz / 2, h: CAB_H });
    return { x, z, y: CAB_H, high: true };
  });
  const bxg = keep(new THREE.BoxGeometry(1, 1, 1)); bxg.translate(0, 0.5, 0);
  // tektura: ciemniejsze krawędzie i pas taśmy przez środek
  const cardboard = canvasTex(64, 64, g => {
    g.fillStyle = '#8a6a3e'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(60,40,18,${rnd() * 0.2})`; g.fillRect(rnd() * 64, rnd() * 64, 2, 1); }
    g.strokeStyle = '#5a4122'; g.lineWidth = 4; g.strokeRect(0, 0, 64, 64);
    g.fillStyle = '#a58a5c'; g.fillRect(27, 0, 10, 64);
  }, 1, 1);
  const boxMesh = new THREE.InstancedMesh(bxg, keep(new THREE.MeshLambertMaterial({ map: cardboard })), boxes.length);
  boxes.forEach(([x, z, sx2, h, sz2, rot], i) => {
    e.set(0, rot, 0); qn.setFromEuler(e);
    m4.compose(vp.set(x, 0, z), qn, vs.set(sx2, h, sz2));
    boxMesh.setMatrixAt(i, m4);
    const s = 0.42 + rnd() * 0.14;   // ciemno, bo latarka z bliska i tak mocno je rozjaśnia
    boxMesh.setColorAt(i, col.setRGB(s, s * 0.92, s * 0.85));
  });
  group.add(boxMesh);
  // szafka na akta: szuflady z uchwytami
  const drawers = canvasTex(64, 128, g => {
    g.fillStyle = '#6b6d64'; g.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 4; i++) {
      const y = 4 + i * 31;
      g.fillStyle = '#585a52'; g.fillRect(4, y, 56, 27);
      g.fillStyle = '#8e9086'; g.fillRect(24, y + 6, 16, 4);
      g.fillStyle = '#d8d2bc'; g.fillRect(26, y + 13, 12, 7);
    }
  }, 1, 1);
  const cabMesh = new THREE.InstancedMesh(bxg, keep(new THREE.MeshLambertMaterial({ map: drawers, color: 0x77786f })), Math.max(1, cabinets.length));
  cabMesh.count = cabinets.length;
  cabinets.forEach(([x, z, wx, wz], i) => { m4.compose(vp.set(x, 0, z), qn.identity(), vs.set(wx, CAB_H, wz)); cabMesh.setMatrixAt(i, m4); });
  group.add(cabMesh);
  // śmieci na podłodze: kartki i płyty, które spadły z sufitu (bez kolizji)
  const junk: number[] = [];
  for (let i = 0; i < N * N; i++) if (grid[i] === 0 && zone[i] !== 1 && rnd() < 0.2) junk.push(i);
  const junkMesh = new THREE.InstancedMesh(bxg, keep(new THREE.MeshLambertMaterial({ color: 0xffffff })), junk.length);
  junk.forEach((id, i) => {
    const tile = rnd() < 0.4;
    e.set(tile ? (rnd() - 0.5) * 0.3 : 0, rnd() * 6, 0); qn.setFromEuler(e);
    m4.compose(vp.set((id % N + 0.15 + rnd() * 0.7) * B, 0.002, (((id / N) | 0) + 0.15 + rnd() * 0.7) * B), qn, tile ? vs.set(0.6, 0.02, 0.6) : vs.set(0.21, 0.004, 0.3));
    junkMesh.setMatrixAt(i, m4);
    junkMesh.setColorAt(i, tile ? col.setHex(0xa59c78) : col.setHex(0xd9d4c4));
  });
  group.add(junkMesh);
  const meshes = [wallMesh, pillarMesh, lampMesh, boxMesh, cabMesh, junkMesh, ductWallMesh, ductTinMesh, ...tileMeshes];
  for (const m of meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }

  // kasety VHS
  const caseGeo = keep(new THREE.BoxGeometry(0.38, 0.06, 0.22));
  const caseMat = keep(new THREE.MeshLambertMaterial({ color: 0x0d0d0e }));
  const labelGeo = keep(new THREE.BoxGeometry(0.26, 0.062, 0.08));
  const labelMat = keep(new THREE.MeshLambertMaterial({ color: 0xd8d0bc, emissive: 0x3a352a }));
  const reelGeo = keep(new THREE.CylinderGeometry(0.035, 0.035, 0.064, 10));
  const reelMat = keep(new THREE.MeshLambertMaterial({ color: 0x5b5650 }));
  const tapes: Pickup[] = tapeSpots.map(({ x, z, y, high }) => {
    const g = new THREE.Group();
    const cas = new THREE.Group(); cas.position.y = y + 0.03; cas.rotation.y = rnd() * 6;
    cas.add(new THREE.Mesh(caseGeo, caseMat));
    const label = new THREE.Mesh(labelGeo, labelMat); label.position.z = 0.055; cas.add(label);
    for (const s of [-1, 1]) { const r = new THREE.Mesh(reelGeo, reelMat); r.position.set(s * 0.08, 0.001, -0.03); cas.add(r); }
    g.add(cas);
    g.position.set(x, 0, z);
    group.add(g);
    return { x, z, obj: g, taken: false, high };
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

  // drzwi wyjścia: dwa metalowe skrzydła (otwierają się na zewnątrz), nadproże z tapetą, nad nimi podświetlany napis WYJŚCIE
  const gate = new THREE.Group();
  gate.position.set(gateX * B + 0.06, 0, exitZ * B);
  const doorMat = keep(new THREE.MeshLambertMaterial({ color: 0x5d6353 }));
  const barMat = keep(new THREE.MeshLambertMaterial({ color: 0xa9a89c }));
  const DOOR_H = 2.3, ww = B / 2 - 0.06;
  const leafGeo = keep(new THREE.BoxGeometry(0.06, DOOR_H, ww));
  const pushGeo = keep(new THREE.BoxGeometry(0.05, 0.06, ww * 0.7));
  for (const side of [1, -1]) {   // [0] przy z = 0 (skrzydło w +z), [1] przy z = B (w -z)
    const hinge = new THREE.Group();
    hinge.position.z = side > 0 ? 0.04 : B - 0.04;
    const leaf = new THREE.Mesh(leafGeo, doorMat); leaf.position.set(0, DOOR_H / 2, side * ww / 2); hinge.add(leaf);
    const push = new THREE.Mesh(pushGeo, barMat); push.position.set(-0.06, 1.05, side * ww * 0.55); hinge.add(push);
    gate.add(hinge);
  }
  const header = new THREE.Mesh(keep(new THREE.BoxGeometry(0.2, H - DOOR_H, B)), keep(new THREE.MeshLambertMaterial({ map: paper })));
  header.position.set(0.04, DOOR_H + (H - DOOR_H) / 2, B / 2);
  gate.add(header);
  group.add(gate);
  const sign = canvasTex(256, 80, g => {
    g.fillStyle = '#1c0705'; g.fillRect(0, 0, 256, 80);
    g.fillStyle = '#ff3b2a'; g.font = 'bold 50px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('WYJŚCIE', 128, 43);
  }, 1, 1);
  const lamp = new THREE.Mesh(keep(new THREE.BoxGeometry(0.06, 0.3, 0.95)), keep(new THREE.MeshBasicMaterial({ map: sign, color: 0x6a4a46 })));
  lamp.position.set(gateX * B - 0.06, DOOR_H + 0.3, (exitZ + 0.5) * B);
  group.add(lamp);

  return {
    group, grid, start: [sx, sz], startYaw, exitZ, gate, lamp, tapes, batteries, props, lamps, setLamp, pools,
    open: Array.from({ length: N * N }, (_, i) => i).filter(i => grid[i] === 0 && i % N < gateX),
    wet, streams,
    ceilAt: (x, z) => (tallAt(Math.floor(x / B), Math.floor(z / B)) ? H2 : H),
    tick: t => { ripple.offset.set(t * 0.03, t * 0.017); streak.offset.y = t * 0.9; puddleMat.map!.offset.set(t * 0.02, t * 0.05); },
    dispose: () => {
      for (const m of meshes) m.dispose();
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
  let streamG: GainNode, streamP: StereoPannerNode | null = null;
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
    // wentylacja: cichy szum, którego barwa powoli faluje
    const vent = loop('lowpass', 260, 0.045);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.05;
    const lfoG = c.createGain(); lfoG.gain.value = 120;
    lfo.connect(lfoG).connect(vent.f.frequency); lfo.start(); live.push(lfo);
    // brzęczenie jarzeniówek: 100 Hz z sieci i ostre harmoniczne przez pasmowy filtr
    const buzzF = c.createBiquadFilter(); buzzF.type = 'bandpass'; buzzF.frequency.value = 1200; buzzF.Q.value = 0.8;
    const buzzG = c.createGain(); buzzG.gain.value = 0.012;
    buzzF.connect(buzzG).connect(master);
    for (const f of [100, 200.4, 300.2]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(buzzF); o.start(); live.push(o); }
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
    // woda spływająca po ścianie: szum w paśmie, którego barwa lekko faluje
    const ws = c.createBufferSource(); ws.buffer = noise; ws.loop = true;
    const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1300; wf.Q.value = 0.6;
    const wl = c.createOscillator(); wl.frequency.value = 0.4;
    const wlg = c.createGain(); wlg.gain.value = 260;
    wl.connect(wlg).connect(wf.frequency); wl.start(); live.push(wl);
    streamG = c.createGain(); streamG.gain.value = 0;
    streamP = c.createStereoPanner ? c.createStereoPanner() : null;
    ws.connect(wf);
    if (streamP) wf.connect(streamP).connect(streamG); else wf.connect(streamG);
    streamG.connect(master); ws.start(0, Math.random()); live.push(ws);
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
    /** danger = napięcie (dron), fx = zakłócenia (trzaski - tylko tuż przy potworze) */
    update(danger: number, quiet: boolean, fx = danger) {
      if (!ctx) return;
      const t = now();
      const vol = hooks.soundOn() ? Math.max(0, Math.min(1, hooks.volume())) : 0;
      master.gain.setTargetAtTime(vol * (quiet ? 0.35 : 0.9), t, 0.1);
      droneG.gain.setTargetAtTime(0.025 + danger * 0.11, t, 0.3);
      droneF.frequency.setTargetAtTime(120 + danger * 650, t, 0.3);
      // trzaski: losowo przerywany szum, coraz gęstszy przy potworze (w trybie spokojnym bez przerw)
      if (!calm && Math.random() < 0.25) crackle = Math.random() < 0.15 + fx * 0.5 ? 1 : 0.25;
      const sg = Math.pow(fx, 1.5) * 0.24 * (calm ? 0.7 : crackle);
      staticG.gain.setTargetAtTime(sg, t, 0.02);
    },
    hum(pan: number, k: number) {
      if (!ctx) return;
      humG.gain.setTargetAtTime(k * k * 0.05, now(), 0.15);
      humP?.pan.setTargetAtTime(pan, now(), 0.15);
    },
    stream(pan: number, k: number) {
      if (!ctx) return;
      streamG.gain.setTargetAtTime(k * k * 0.12, now(), 0.2);
      streamP?.pan.setTargetAtTime(pan, now(), 0.2);
    },
    step(run: boolean, crouch = false) {   // kroki po mokrej wykładzinie: głuche, z lekkim mlaśnięciem; w kucki ledwo słychać
      const k = crouch ? 0.35 : 1;
      burst({ dur: run ? 0.09 : 0.12, freq: 380 + Math.random() * 260, q: 0.9, gain: (run ? 0.18 : 0.12) * k });
      burst({ dur: 0.06, freq: 1500 + Math.random() * 600, q: 2, gain: 0.025 * k, at: 0.02 });
    },
    splash(run: boolean) {   // brodzenie w basenie: plusk i bulgot
      burst({ dur: run ? 0.22 : 0.3, freq: 900 + Math.random() * 500, q: 0.7, gain: run ? 0.16 : 0.11, attack: 0.02 });
      burst({ dur: 0.18, freq: 2600 + Math.random() * 900, q: 1.5, gain: 0.05, at: 0.05 });
    },
    jump() { burst({ dur: 0.12, freq: 500, q: 0.8, gain: 0.12 }); burst({ dur: 0.25, freq: 1300, q: 1.4, gain: 0.04, attack: 0.04 }); },
    land(k: number) {
      tone({ freq: 90, to: 45, dur: 0.22, gain: 0.35 * k });
      burst({ dur: 0.18, freq: 320, type: 'lowpass', gain: 0.4 * k });
      burst({ dur: 0.1, freq: 900, q: 1, gain: 0.12 * k, at: 0.01 });
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
