// Mgła (gra horror w zakładce Gry): POTWÓR. To jedyne miejsce, które decyduje, jak wygląda potwór - scena
// (three/horrorScene.ts) woła tylko createMonster(), ustawia pozycję i obrót zwróconego `object` i co klatkę woła `update`.
//
// JAK PODMIENIĆ POTWORA
// 1) Własny plik 3D (GLB / GLTF): wrzuć go do `static/models/` (np. `static/models/potwor.glb`) i wpisz adres w MONSTER_MODEL_URL
//    poniżej (np. '/static/models/potwor.glb'). Model wczytuje GLTFLoader z pakietu three (three/examples/jsm, bez nowych bibliotek),
//    dopiero gdy adres jest ustawiony. Do czasu wczytania (i przy błędzie) widać potwora proceduralnego.
//    Wymagania: przód modelu w stronę +Z (standard glTF), stopy na dole - wysokość i położenie skalujemy sami do MONSTER_HEIGHT.
//    Jeśli plik ma animacje, gra odtwarza klip o nazwie zawierającej MONSTER_CLIP (np. "walk"), a gdy takiego nie ma - pierwszy.
// 2) Własny potwór z prymitywów: zmień funkcję buildProcedural() - ma zwrócić { object, update, dispose }.
//    `object` stoi stopami w y = 0 i patrzy w +Z. `update(s)` dostaje stan z MonsterState (czas, prędkość, czy gracz go widzi...).
// Przy licencjach plików 3D trzymaj się tych samych zasad co przy zdjęciach: CC0 / CC BY, autor dopisany w „O stronie”.
import * as THREE from 'three';

/** Adres własnego modelu GLB / GLTF ('' = potwór proceduralny z prymitywów) */
export const MONSTER_MODEL_URL = '';
/** Fragment nazwy klipu animacji w pliku modelu, który odtwarzamy w ruchu */
export const MONSTER_CLIP = 'walk';
/** Wysokość potwora w metrach (gracz ma oczy na 1,62 m) */
export const MONSTER_HEIGHT = 2.75;

export interface MonsterState {
  dt: number;
  /** czas gry w sekundach */
  t: number;
  /** prędkość w m/s (0 = stoi) */
  speed: number;
  /** gracz patrzy na niego w świetle latarki */
  seen: boolean;
  /** 0..1, jak blisko jest gracz */
  danger: number;
  /** ograniczony ruch / tryb wydajności: bez szarpnięć */
  calm: boolean;
  /** jumpscare: potwór rzuca się na gracza */
  attack: boolean;
}
export interface Monster {
  object: THREE.Object3D;
  height: number;
  update: (s: MonsterState) => void;
  dispose: () => void;
}
interface Part { object: THREE.Object3D; update: (s: MonsterState) => void; dispose: () => void }

export function createMonster(): Monster {
  const root = new THREE.Group();
  root.name = 'monster';
  let part: Part = buildProcedural();
  let dead = false;
  root.add(part.object);
  if (MONSTER_MODEL_URL) {
    loadModel(MONSTER_MODEL_URL).then(m => {
      if (dead) return m.dispose();
      root.remove(part.object); part.dispose();
      part = m; root.add(m.object);
    }).catch(() => { /* zostaje potwór proceduralny */ });
  }
  return {
    object: root,
    height: MONSTER_HEIGHT,
    update: s => part.update(s),
    dispose: () => { dead = true; part.dispose(); },
  };
}

/** Wysoka, chuda sylwetka bez twarzy: za długie ręce, przygarbiony, blada głowa. Tylko prymitywy i dwa materiały. */
function buildProcedural(): Part {
  const H = MONSTER_HEIGHT / 2.75;   // wszystkie wymiary poniżej są dla 2,75 m
  const body = new THREE.MeshLambertMaterial({ color: 0x121110 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xb9b3a8, emissive: 0x141312 });
  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const limb = (len: number, r0: number, r1: number) => {
    const c = g(new THREE.CylinderGeometry(r1, r0, len, 6, 1));
    c.translate(0, -len / 2, 0);   // oś obrotu w górnym końcu
    return c;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => new THREE.Mesh(geo, mat);

  const fig = new THREE.Group();          // całość (drży, pochyla się)
  const hips = new THREE.Group(); hips.position.y = 1.32; fig.add(hips);
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.x = side * 0.1; hips.add(thigh);
    thigh.add(mesh(limb(0.7, 0.075, 0.05), body));
    const shin = new THREE.Group(); shin.position.y = -0.7; thigh.add(shin);
    shin.add(mesh(limb(0.62, 0.05, 0.035), body));
    const foot = mesh(g(new THREE.BoxGeometry(0.08, 0.04, 0.24)), body); foot.position.set(0, -0.62, 0.06); shin.add(foot);
    legs.push(thigh);
    (thigh as any).shin = shin;
  }
  const spine = new THREE.Group(); spine.position.y = 1.32; spine.rotation.x = 0.22; fig.add(spine);   // przygarbiony
  const torso = mesh(g(new THREE.CylinderGeometry(0.19, 0.12, 0.92, 7, 1)), body); torso.position.y = 0.46; spine.add(torso);
  const ribs = mesh(g(new THREE.BoxGeometry(0.44, 0.08, 0.16)), body); ribs.position.y = 0.88; spine.add(ribs);
  const neck = mesh(limb(0.32, 0.035, 0.03), skin); neck.rotation.x = Math.PI; neck.position.y = 0.9; spine.add(neck);
  const head = new THREE.Group(); head.position.set(0, 1.27, 0.05); spine.add(head);
  const skull = mesh(g(new THREE.SphereGeometry(1, 12, 10)), skin); skull.scale.set(0.12, 0.19, 0.135); skull.position.y = 0.06; head.add(skull);
  // twarzy nie ma: tylko ledwo widoczne zagłębienia tam, gdzie powinny być oczy
  for (const side of [-1, 1]) {
    const pit = mesh(g(new THREE.SphereGeometry(1, 6, 5)), body); pit.scale.set(0.028, 0.016, 0.01); pit.position.set(side * 0.045, 0.08, 0.125); head.add(pit);
  }
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(side * 0.24, 0.86, 0); spine.add(sh);
    sh.rotation.z = side * 0.08;
    sh.add(mesh(limb(0.72, 0.045, 0.035), body));
    const fore = new THREE.Group(); fore.position.y = -0.72; fore.rotation.x = -0.15; sh.add(fore);
    fore.add(mesh(limb(0.7, 0.035, 0.025), skin));
    const hand = new THREE.Group(); hand.position.y = -0.7; fore.add(hand);
    for (let i = 0; i < 4; i++) {
      const f = mesh(limb(0.26, 0.011, 0.006), skin);
      f.position.set((i - 1.5) * 0.018, 0, 0.01); f.rotation.set(0.12 * (i - 1.5) + 0.1, 0, side * (i - 1.5) * 0.07);
      hand.add(f);
    }
    arms.push(sh);
    (sh as any).fore = fore;
  }
  fig.scale.setScalar(H);

  let phase = 0, twitch = 0, twitchZ = 0;
  const update = (s: MonsterState) => {
    const walk = Math.min(1, s.speed / 2.5);
    phase += s.dt * (1.2 + s.speed * 1.1);
    legs.forEach((l, i) => {
      const k = Math.sin(phase + i * Math.PI);
      l.rotation.x = k * 0.42 * walk;
      (l as any).shin.rotation.x = Math.max(0, -k) * 0.55 * walk;
    });
    arms.forEach((a, i) => {
      const k = Math.sin(phase + i * Math.PI + Math.PI);
      a.rotation.x = s.attack ? -1.35 : k * 0.18 * walk + Math.sin(s.t * 0.7 + i) * 0.03;
      (a as any).fore.rotation.x = s.attack ? -0.35 : -0.15 - Math.max(0, k) * 0.2 * walk;
    });
    fig.position.y = Math.abs(Math.sin(phase)) * 0.03 * walk;
    // głowa: powolne kołysanie, a gdy gracz patrzy - nagłe szarpnięcia na bok (bez nich w trybie spokojnym)
    twitch -= s.dt;
    if (!s.calm && s.seen && twitch <= 0) { twitch = 0.25 + Math.random() * 1.1; twitchZ = (Math.random() - 0.5) * 1.1; }
    if (twitch <= 0 || s.calm) twitchZ *= Math.exp(-s.dt * 4);
    head.rotation.z = twitchZ + Math.sin(s.t * 0.5) * 0.06;
    head.rotation.x = s.attack ? 0.35 : -0.15 + Math.sin(s.t * 0.37) * 0.05;
    spine.rotation.x = s.attack ? 0.38 : 0.22 + walk * 0.08;
    // obraz „przeskakuje”, gdy jest blisko i ktoś na niego patrzy (analogowe zakłócenie)
    if (!s.calm && s.seen && Math.random() < 0.08 + s.danger * 0.25) fig.position.x = (Math.random() - 0.5) * 0.12;
    else fig.position.x *= 0.6;
  };
  return {
    object: fig,
    update,
    dispose: () => { geos.forEach(x => x.dispose()); body.dispose(); skin.dispose(); },
  };
}

/** Wczytuje model GLB / GLTF, skaluje do MONSTER_HEIGHT i stawia stopami w y = 0 */
async function loadModel(url: string): Promise<Part> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const k = MONSTER_HEIGHT / (size.y || 1);
  model.scale.setScalar(k);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  const wrap = new THREE.Group();
  wrap.add(model);
  const mixer = gltf.animations.length ? new THREE.AnimationMixer(model) : null;
  const clip = gltf.animations.find(a => a.name.toLowerCase().includes(MONSTER_CLIP)) || gltf.animations[0];
  if (mixer && clip) mixer.clipAction(clip).play();
  return {
    object: wrap,
    update: s => { mixer?.update(s.dt * (s.speed > 0.1 ? Math.max(0.6, s.speed / 2.2) : 0.25)); },
    dispose: () => {
      mixer?.stopAllAction();
      model.traverse((o: any) => {
        o.geometry?.dispose?.();
        for (const m of [].concat(o.material || [])) (m as THREE.Material).dispose();
      });
    },
  };
}
