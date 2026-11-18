// @ts-nocheck
// Stary Pinball (zakładka Gry -> Stary Pinball, /games/old-pinball): gra z wersji sprzed Reacta, przeniesiona prawie bez zmian
// (gotowy HTML i canvas, jak Arena). Montuje ją OldPinballPage.tsx (`mountOldPinball` / `unmountOldPinball`); nagrody liczy
// serwer w routes/old_pinball.rs (grosze za punkty z limitem na minutę i na dobę, ustawienia `oldPinball` w game.json).
import { api } from '../../api/client';
import { esc, fmt } from '../../lib/format';
import { Sound } from '../../sound/sound';
import { toast } from '../../ui/Toaster';
import { S, touch } from '../../game/store';

const $ = (sel) => PB.box?.querySelector(sel) ?? null;
const $$ = (sel) => [...(PB.box?.querySelectorAll(sel) ?? [])];
const pbMounted = () => !!PB.box?.isConnected;
// PINBALL (zakładka Gry -> Pinball). Gra jest darmowa: punkty zamieniają się na grosze po końcu partii (routes/pinball.rs -
// stawka stołu, limit na minutę i na dobę). Wszystko inne jest tutaj: stoły to dane (PB_TABLES + wspólna dolna część
// pbBase), silnik (pbStep) liczy kulki w krokach ~1/600 s - kolizje z odcinkami, okręgami i łapkami, czujniki (tory,
// spinnery, orbity, rampy, dołki); zasady w pbEv, rysowanie na canvasie (statyczna warstwa stołu + to, co się rusza),
// wyświetlacz DMD z kropek i dźwięki z Web Audio. Układ współrzędnych stołu: 600 x 1080, y w dół.

const PB_W = 600, PB_H = 1080, PB_MX = 562, PB_R = 10, PB_SUB = 10, PB_VMAX = 3000;
const PB_E = { wall: 0.42, rail: 0.38, rubber: 0.72, post: 0.7 };
const PB = { lobby: null, mode: "menu", T: null, G: null, raf: 0, last: 0, keys: {}, run: null, submitted: false, paused: false,
             box: null, cv: null, ctx: null, scale: 1, dmd: null, dmdCtx: null, dmdBuf: null, statT: 0, result: null, pointers: {} };

// ================================================================ GEOMETRIA I STOŁY

function pbArc(cx, cy, r, a0, a1, n = 16) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return p;
}
const pbMir = pts => pts.map(([x, y]) => [PB_MX - x, y]);

// wspólna dolna część i obrys: kopuła, tor wyrzutni z bramką, orbity po bokach, tory boczne, procy i łapki
function pbBase(d) {
  const o = d.outlane || 58, sa = o + 42;
  const sling = [[sa, 776], [sa, 856], [156, 888]];
  // prowadnica kończy się tuż nad osią łapki: kulka zjeżdża prosto na łapkę i nie utyka w szczelinie
  const guide = [[o, 760], [o, 872], [183, 932]];
  return {
    walls: [
      { pts: [[16, 1110], ...pbArc(300, 300, 284, 180, 360, 56), [584, 1062], [546, 1062], [546, 360]], kind: "wall" },
      { pts: guide, kind: "rail" },
      { pts: pbMir(guide), kind: "rail" },
      { pts: [[66, 585], [66, 300], ...pbArc(300, 300, 234, 180, 232, 12).slice(1)], kind: "rail" },
      { pts: [[496, 585], [496, 330], [486, 262], [462, 205], [436, 170]], kind: "rail" },
      { pts: [[16, 640], [84, 690]], kind: "wall" },
      { pts: [[546, 640], [478, 690]], kind: "wall" },
      { pts: [sling[0], sling[1], sling[2]], kind: "rubber" },
      { pts: pbMir([sling[0], sling[1], sling[2]]), kind: "rubber" },
    ],
    gate: [[546, 360], [584, 322]],
    slings: [[sling[0], sling[2]], pbMir([sling[2], sling[0]])],
    posts: [{ x: o, y: 760, r: 6 }, { x: PB_MX - o, y: 760, r: 6 }, { x: 66, y: 585, r: 5 }, { x: 496, y: 585, r: 5 }],
    flips: [{ x: 186, y: 945, len: d.flipLen || 80, side: "L" }, { x: 376, y: 945, len: d.flipLen || 80, side: "R" }],
    orbits: [{ id: "orbitL", x1: 16, y1: 560, x2: 66, y2: 560 }, { id: "orbitR", x1: 496, y1: 560, x2: 546, y2: 560 }],
    lanes: [
      { id: "outL", x: (16 + o) / 2, y: 960, r: 13, kind: "out" }, { id: "outR", x: PB_MX - (16 + o) / 2, y: 960, r: 13, kind: "out" },
      { id: "inL", x: (o + sa) / 2, y: 820, r: 13, kind: "in" }, { id: "inR", x: PB_MX - (o + sa) / 2, y: 820, r: 13, kind: "in" },
    ],
  };
}

// trzy albo cztery tory u góry: przegródki z kołkami między torami
function pbTopLanes(xs, y = 175) {
  const gap = xs[1] - xs[0], walls = [], posts = [], lanes = [];
  [xs[0] - gap / 2, ...xs.map(x => x + gap / 2)].forEach(x => { walls.push({ pts: [[x, y - 25], [x, y + 25]], kind: "rail" }); posts.push({ x, y: y - 25, r: 5 }); });
  xs.forEach((x, i) => lanes.push({ id: "top" + i, x, y, r: 12, kind: "top" }));
  return { walls, posts, lanes };
}
// wjazd na rampę: dwie ścianki i krawędź wjazdu (a -> b, prawa strona wjazdu patrzy na łapkę)
function pbRampMouth(a, b, depth = 52) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = dy / L, ny = -dx / L;
  // normalna w stronę łapek (w dół)
  const s = ny > 0 ? 1 : -1;
  return [{ pts: [[a[0] + nx * s * depth, a[1] + ny * s * depth], a], kind: "rail" }, { pts: [[b[0] + nx * s * depth, b[1] + ny * s * depth], b], kind: "rail" }];
}
const pbBank = (bank, y, xs, w = 28) => xs.map(x => ({ bank, x1: x, y1: y, x2: x + w, y2: y, drop: true }));
const pbVBank = (bank, x, ys, h = 28) => ys.map(y => ({ bank, x1: x, y1: y, x2: x, y2: y + h, drop: true }));

const PB_TABLES = {
  neon: () => {
    const top = pbTopLanes([226, 281, 336]);
    return {
      name: "Neonowy Automat", stars: 1, g: 1300, save: 10, extraAt: 600000, kickback: true, locks: 2,
      theme: { key: "neon", bg: ["#1a0233", "#07010f"], wall: "#ff3df2", rail: "#5ef2ff", rubber: "#ff9af7", bump: ["#ff3df2", "#5ef2ff", "#fff36b"],
               flip: "#5ef2ff", insert: "#ff3df2", insert2: "#5ef2ff", ramp: "#5ef2ff", dmd: "#ff4fd8", ball: "#ffe6ff", title: "NEON" },
      walls: [...top.walls, ...pbRampMouth([412, 478], [462, 494])],
      posts: top.posts, lanes: top.lanes,
      bumpers: [{ x: 226, y: 285, r: 28 }, { x: 336, y: 285, r: 28 }, { x: 281, y: 370, r: 28 }],
      targets: pbBank("A", 545, [236, 267, 298]),
      saucers: [{ x: 118, y: 440, kick: [420, 140], role: "lock" }],
      spinners: [{ x1: 16, y1: 520, x2: 66, y2: 520 }],
      ramps: [{ id: "ramp", a: [412, 478], b: [462, 494], min: 620, path: [[437, 486], [450, 360], [432, 252], [384, 178], [300, 140], [212, 150], [142, 212], [104, 322], [92, 470], [84, 620], [79, 748]] }],
      missions: [["Rozgrzewka: 20 odbić od grzybków", "bumper", 20], ["Zbij wszystkie cele", "bank", 1], ["Wjedź na rampę", "ramp", 2],
                 ["Okrąż stół orbitą", "orbit", 2], ["Rozkręć spinner", "spin", 30], ["Zablokuj kulkę", "saucer", 2]],
    };
  },
  casino: () => {
    const top = pbTopLanes([210, 260, 310, 360], 170);
    return {
      name: "Kasyno Royale", stars: 2, g: 1350, save: 8, extraAt: 700000, kickback: false, locks: 2,
      theme: { key: "casino", bg: ["#0f6a3a", "#03200f"], wall: "#ffd54a", rail: "#f4e3b0", rubber: "#ff5a5a", bump: ["#e3242b", "#141414", "#e3242b", "#141414"],
               flip: "#ffd54a", insert: "#ffd54a", insert2: "#ff4040", ramp: "#ffd54a", dmd: "#ffb22e", ball: "#fff6dc", title: "ROYALE" },
      walls: [...top.walls, ...pbRampMouth([100, 560], [150, 544])],
      posts: top.posts, lanes: top.lanes,
      bumpers: [{ x: 214, y: 290, r: 26 }, { x: 348, y: 290, r: 26 }, { x: 281, y: 252, r: 22 }, { x: 281, y: 350, r: 26 }],
      targets: [...pbVBank("B", 78, [372, 403, 434]), ...pbVBank("C", 484, [372, 403, 434])],
      saucers: [{ x: 281, y: 475, kick: [-260, 330], role: "lock" }],
      spinners: [{ x1: 496, y1: 520, x2: 546, y2: 520 }],
      ramps: [{ id: "ramp", a: [100, 560], b: [150, 544], min: 620, path: [[125, 552], [113, 430], [128, 300], [190, 200], [281, 150], [372, 182], [430, 262], [466, 400], [478, 560], [483, 748]] }],
      wheel: { x: 281, y: 475, r: 118 },
      missions: [["Rozbij bank żetonów", "bank", 2], ["25 odbić od żetonów", "bumper", 25], ["Rampa Royale", "ramp", 3],
                 ["Otwórz sejf", "saucer", 2], ["Zakręć ruletką", "spin", 40], ["Orbity", "orbit", 3]],
    };
  },
  space: () => {
    const top = pbTopLanes([260, 310, 360], 160);
    return {
      name: "Misja Kosmos", stars: 3, g: 1420, save: 8, extraAt: 800000, kickback: false, locks: 2,
      theme: { key: "space", bg: ["#0a0f3a", "#000004"], wall: "#7aa8ff", rail: "#c8d6ff", rubber: "#9b7bff", bump: ["#ff8a3d", "#43d2ff", "#b06bff"],
               flip: "#c8d6ff", insert: "#43d2ff", insert2: "#ff8a3d", ramp: "#9fc2ff", dmd: "#6fd0ff", ball: "#e8f0ff", title: "KOSMOS" },
      walls: [...top.walls, ...pbRampMouth([98, 560], [146, 544]), ...pbRampMouth([400, 598], [448, 614])],
      posts: top.posts, lanes: top.lanes,
      bumpers: [{ x: 150, y: 285, r: 24 }, { x: 228, y: 250, r: 22 }, { x: 212, y: 352, r: 24 }],
      targets: pbBank("A", 600, [196, 227, 258]),
      saucers: [{ x: 336, y: 420, kick: [-280, 360], role: "lock", hole: true }],
      magnets: [{ x: 336, y: 420, r: 125, str: 2600 }],
      uflips: [{ x: 488, y: 520, len: 62, side: "R" }],
      spinners: [{ x1: 16, y1: 520, x2: 66, y2: 520 }],
      ramps: [{ id: "rampL", a: [98, 560], b: [146, 544], min: 620, path: [[122, 552], [112, 420], [135, 300], [200, 192], [300, 140], [400, 170], [455, 262], [476, 380], [470, 482]] },
              { id: "rampR", a: [400, 598], b: [448, 614], min: 620, path: [[424, 606], [420, 480], [400, 332], [330, 232], [240, 205], [150, 240], [104, 350], [90, 520], [84, 640], [79, 748]] }],
      missions: [["Wpadnij w czarną dziurę", "saucer", 2], ["Start rakiet: rampy", "ramp", 3], ["Pas planetoid: 25 odbić", "bumper", 25],
                 ["Zestrzel satelity", "bank", 1], ["Orbita okołoziemska", "orbit", 2], ["Napęd warp: spinner", "spin", 35]],
    };
  },
  ghost: () => {
    const top = pbTopLanes([226, 281, 336]);
    return {
      name: "Noc Duchów", stars: 4, g: 1400, save: 7, extraAt: 900000, kickback: false, locks: 2,
      theme: { key: "ghost", bg: ["#2a1240", "#05020a"], wall: "#ff8a1f", rail: "#c9b6ff", rubber: "#9dff6a", bump: ["#ff7a00", "#ff9a2e", "#ff7a00"],
               flip: "#c9b6ff", insert: "#9dff6a", insert2: "#ff8a1f", ramp: "#b89cff", dmd: "#9dff6a", ball: "#f2ffe8", title: "DUCHY" },
      walls: [...top.walls, ...pbRampMouth([412, 478], [462, 494])],
      posts: top.posts, lanes: top.lanes,
      bumpers: [{ x: 372, y: 272, r: 26 }, { x: 444, y: 345, r: 24 }, { x: 362, y: 362, r: 24 }],
      targets: pbBank("G", 292, [140, 172, 204, 236]),
      movers: [{ cx: 281, y: 470, range: 95, w: 50, speed: 1.15 }],
      saucers: [{ x: 112, y: 525, kick: [420, 40], role: "lock" }],
      spinners: [{ x1: 496, y1: 520, x2: 546, y2: 520 }],
      ramps: [{ id: "ramp", a: [412, 478], b: [462, 494], min: 650, path: [[437, 486], [452, 380], [446, 270], [410, 190], [330, 145], [240, 140], [160, 180], [110, 280], [94, 420], [86, 600], [79, 748]] }],
      missions: [["Przegoń ducha", "mover", 5], ["Rozkop groby", "bank", 1], ["Dynie: 20 odbić", "bumper", 20],
                 ["Most nad cmentarzem", "ramp", 3], ["Otwórz kryptę", "saucer", 2], ["Nocny lot", "orbit", 3]],
    };
  },
  dragon: () => {
    const top = pbTopLanes([226, 281, 336]);
    return {
      name: "Smocze Wulkany", stars: 5, g: 1550, save: 5, extraAt: 1000000, kickback: false, locks: 3, outlane: 64, flipLen: 76,
      theme: { key: "dragon", bg: ["#3a0700", "#080000"], wall: "#ff5a1a", rail: "#ffc46b", rubber: "#ffdf3d", bump: ["#ff3b0a", "#ff9a1a", "#ff3b0a"],
               flip: "#ffc46b", insert: "#ff5a1a", insert2: "#ffdf3d", ramp: "#ffb06b", dmd: "#ff6a1a", ball: "#fff0d8", title: "SMOK" },
      walls: [...top.walls, ...pbRampMouth([100, 600], [150, 584]), ...pbRampMouth([412, 584], [462, 600])],
      posts: top.posts, lanes: top.lanes,
      bumpers: [{ x: 213, y: 322, r: 24 }, { x: 349, y: 322, r: 24 }, { x: 281, y: 392, r: 22 }],
      targets: pbBank("A", 520, [236, 267, 298]),
      saucers: [{ x: 281, y: 300, kick: [-180, -260], role: "lock", hole: true }],
      uflips: [{ x: 76, y: 468, len: 60, side: "L" }, { x: 486, y: 468, len: 60, side: "R" }],
      spinners: [{ x1: 16, y1: 520, x2: 66, y2: 520 }, { x1: 496, y1: 520, x2: 546, y2: 520 }],
      ramps: [{ id: "rampL", a: [100, 600], b: [150, 584], min: 680, path: [[125, 592], [116, 450], [140, 300], [205, 200], [281, 150], [362, 180], [430, 260], [466, 400], [478, 580], [483, 748]] },
              { id: "rampR", a: [412, 584], b: [462, 600], min: 680, path: [[437, 592], [446, 450], [422, 300], [357, 200], [281, 150], [200, 180], [132, 260], [96, 400], [84, 580], [79, 748]] }],
      missions: [["Obudź wulkan", "saucer", 3], ["Smocze skrzydła: rampy", "ramp", 4], ["Lawa: 30 odbić", "bumper", 30],
                 ["Skruszyć łuski", "bank", 2], ["Lot nad kraterem", "orbit", 3], ["Wir ognia", "spin", 50]],
    };
  },
};

// definicja -> stół do symulacji: odcinki, okręgi, łapki i czujniki
function pbBuild(id) {
  const d = PB_TABLES[id](), base = pbBase(d);
  const T = { id, d, th: d.theme, g: d.g, segs: [], circ: [], flips: [], walls: [...base.walls, ...(d.walls || [])], bumpers: [], targets: [],
              banks: {}, lanes: [], spinners: [], saucers: [], ramps: [], movers: [], magnets: d.magnets || [], slings: [], orbits: base.orbits, posts: [] };
  const seg = (a, b, o) => { const s = { ax: a[0], ay: a[1], bx: b[0], by: b[1], e: 0.42, ...o }; pbSegBox(s); T.segs.push(s); return s; };
  for (const w of T.walls) for (let i = 1; i < w.pts.length; i++) seg(w.pts[i - 1], w.pts[i], { e: PB_E[w.kind], kind: w.kind });
  // bramka toru wyrzutni: kulka przelatuje do góry, z góry odbija się do środka stołu
  seg(base.gate[0], base.gate[1], { e: 0.3, kind: "gate", oneWay: [Math.SQRT1_2, Math.SQRT1_2] });
  for (const [a, b] of base.slings) { const s = { a, b, flash: 0 }; T.slings.push(s); seg(a, b, { e: 0.6, kick: 560, tag: "sling", obj: s }); }
  for (const p of [...base.posts, ...(d.posts || [])]) { T.posts.push(p); T.circ.push({ ...p, e: PB_E.post, tag: "post" }); }
  for (const b of d.bumpers || []) { const o = { ...b, flash: 0 }; T.bumpers.push(o); T.circ.push({ x: b.x, y: b.y, r: b.r, e: 0.5, kick: 640, tag: "bumper", obj: o }); }
  for (const t of d.targets || []) {
    const o = { ...t, down: false, flash: 0 };
    T.targets.push(o);
    (T.banks[t.bank] ||= []).push(o);
    seg([t.x1, t.y1], [t.x2, t.y2], { e: 0.35, tag: "target", obj: o });
  }
  for (const m of d.movers || []) {
    const o = { ...m, t: 0, x: m.cx, flash: 0 };
    o.seg = seg([m.cx - m.w / 2, m.y], [m.cx + m.w / 2, m.y], { e: 0.45, tag: "mover", obj: o });
    T.movers.push(o);
  }
  for (const r of d.ramps || []) {
    const dx = r.b[0] - r.a[0], dy = r.b[1] - r.a[1], L = Math.hypot(dx, dy), s = dx > 0 ? 1 : -1;
    // normalna krawędzi wjazdu skierowana w stronę łapek (w dół stołu)
    let nx = dy / L, ny = -dx / L;
    if (ny < 0) { nx = -nx; ny = -ny; }
    const P = { ...r, pts: r.path, cum: [0], flash: 0, nx, ny, s };
    for (let i = 1; i < r.path.length; i++) P.cum.push(P.cum[i - 1] + Math.hypot(r.path[i][0] - r.path[i - 1][0], r.path[i][1] - r.path[i - 1][1]));
    P.total = P.cum[P.cum.length - 1];
    T.ramps.push(P);
    seg(r.a, r.b, { e: 0.3, tag: "ramp", obj: P });
  }
  for (const f of [...base.flips, ...(d.uflips || [])]) {
    const L = f.side === "L", rest = (L ? 28 : 152) * Math.PI / 180, up = (L ? -30 : 210) * Math.PI / 180;
    T.flips.push({ ...f, rest, up, ang: rest, omega: 0, r0: f.len > 70 ? 11 : 9, r1: 6 });
  }
  T.lanes = [...base.lanes, ...(d.lanes || [])].map(l => ({ ...l, lit: false, flash: 0 }));
  T.spinners = (d.spinners || []).map(s => ({ ...s, ang: 0, spd: 0 }));
  T.saucers = (d.saucers || []).map(s => ({ ...s, r: 15, flash: 0 }));
  T.topLanes = T.lanes.filter(l => l.kind === "top");
  return T;
}

function pbSegBox(s) {
  const p = PB_R + 2;
  s.x0 = Math.min(s.ax, s.bx) - p; s.x1 = Math.max(s.ax, s.bx) + p; s.y0 = Math.min(s.ay, s.by) - p; s.y1 = Math.max(s.ay, s.by) + p;
}

// ================================================================ FIZYKA

function pbBall(x, y, vx = 0, vy = 0) { return { x, y, vx, vy, trail: [], in: new Set(), still: 0, held: null, ramp: null, noCatch: 0, lane: x > 548 && y > 360 }; }

function pbStep(dt) {
  const T = PB.T, G = PB.G;
  for (const f of T.flips) {
    const target = f.on && !G.tilted ? f.up : f.rest, d = target - f.ang;
    const st = Math.sign(d) * Math.min(Math.abs(d), (f.on ? 30 : 17) * dt);
    f.ang += st;
    f.omega = st / dt;
  }
  for (const m of T.movers) {
    m.t += dt;
    m.x = m.cx + Math.sin(m.t * m.speed) * m.range;
    m.seg.ax = m.x - m.w / 2; m.seg.bx = m.x + m.w / 2; pbSegBox(m.seg);
  }
  for (const b of G.balls) {
    if (b.held) continue;
    if (b.ramp) { pbRampMove(b, dt); continue; }
    const px = b.x, py = b.y;
    b.vy += T.g * dt;
    for (const m of T.magnets) {
      const dx = m.x - b.x, dy = m.y - b.y, d = Math.hypot(dx, dy);
      if (d < m.r && d > 1) { const a = m.str * (1 - d / m.r) * dt / d; b.vx += dx * a; b.vy += dy * a; }
    }
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > PB_VMAX) { b.vx *= PB_VMAX / sp; b.vy *= PB_VMAX / sp; }
    b.vx *= 1 - 0.04 * dt; b.vy *= 1 - 0.04 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    for (const s of T.segs) {
      if (b.x < s.x0 || b.x > s.x1 || b.y < s.y0 || b.y > s.y1 || s.obj?.down) continue;
      pbHitSeg(b, s);
      if (b.ramp) break;
    }
    if (b.ramp) continue;
    for (const c of T.circ) pbHitCirc(b, c);
    for (const f of T.flips) pbHitFlip(b, f);
    pbSensors(b, px, py);
  }
  // kulki między sobą (multiball)
  const bs = G.balls;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], c = bs[j];
    if (a.held || c.held || a.ramp || c.ramp) continue;
    const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
    if (d >= PB_R * 2 || d < 0.01) continue;
    const nx = dx / d, ny = dy / d, push = (PB_R * 2 - d) / 2;
    a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
    const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
    if (vn < 0) { a.vx += vn * nx * 0.95; a.vy += vn * ny * 0.95; c.vx -= vn * nx * 0.95; c.vy -= vn * ny * 0.95; if (-vn > 200) PBS.clack(Math.min(1, -vn / 1500)); }
  }
}

function pbHitSeg(b, s) {
  const dx = s.bx - s.ax, dy = s.by - s.ay, L2 = dx * dx + dy * dy;
  let t = ((b.x - s.ax) * dx + (b.y - s.ay) * dy) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = s.ax + dx * t, py = s.ay + dy * t;
  let nx = b.x - px, ny = b.y - py;
  const d2 = nx * nx + ny * ny;
  if (d2 >= PB_R * PB_R) return;
  if (s.oneWay) {
    const [ox, oy] = s.oneWay;
    if (b.vx * ox + b.vy * oy <= 0 || (b.x - s.ax) * ox + (b.y - s.ay) * oy > 0) return;
  }
  const d = Math.sqrt(d2);
  if (d < 1e-4) { const L = Math.sqrt(L2); nx = -dy / L; ny = dx / L; } else { nx /= d; ny /= d; }
  const vn = b.vx * nx + b.vy * ny;
  // wjazd na rampę tylko od przodu (od strony łapek) i z odpowiednią prędkością; wolniejsza kulka odbija się od klapki
  if (s.tag === "ramp") {
    const P = s.obj, front = (b.x - s.ax) * P.nx + (b.y - s.ay) * P.ny > 0, into = -(b.vx * P.nx + b.vy * P.ny);
    if (front && into > P.min && !PB.G.tilted) return pbRampEnter(b, P, Math.hypot(b.vx, b.vy));
  }
  b.x = px + nx * PB_R; b.y = py + ny * PB_R;
  if (vn >= 0) return;
  b.vx -= (1 + s.e) * vn * nx; b.vy -= (1 + s.e) * vn * ny;
  // tarcie wzdłuż ściany: kulka trochę zwalnia na skos
  const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty;
  b.vx -= tx * vt * 0.02; b.vy -= ty * vt * 0.02;
  const imp = -vn;
  if (s.kick && imp > 90 && !PB.G.tilted) { b.vx += nx * s.kick; b.vy += ny * s.kick; }
  if (s.tag && s.tag !== "ramp") pbEv(s.tag, { b, o: s.obj, imp });
  else if (imp > 260) PBS.clack(Math.min(1, imp / 2200));
}

function pbHitCirc(b, c) {
  const dx = b.x - c.x, dy = b.y - c.y, min = PB_R + c.r, d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2) || 0.01, nx = dx / d, ny = dy / d;
  b.x = c.x + nx * min; b.y = c.y + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return;
  b.vx -= (1 + c.e) * vn * nx; b.vy -= (1 + c.e) * vn * ny;
  if (c.kick && !PB.G.tilted) { b.vx += nx * c.kick; b.vy += ny * c.kick; }
  if (c.tag === "bumper") pbEv("bumper", { b, o: c.obj, imp: -vn });
  else if (-vn > 260) PBS.clack(Math.min(1, -vn / 2000));
}

// łapka = kapsuła od osi do końcówki (promień maleje); prędkość powierzchni = omega x r
function pbHitFlip(b, f) {
  const ca = Math.cos(f.ang), sa = Math.sin(f.ang), dx = ca * f.len, dy = sa * f.len;
  let t = ((b.x - f.x) * dx + (b.y - f.y) * dy) / (f.len * f.len);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = f.x + dx * t, py = f.y + dy * t, rad = f.r0 + (f.r1 - f.r0) * t, min = PB_R + rad;
  let nx = b.x - px, ny = b.y - py;
  const d = Math.hypot(nx, ny);
  if (d >= min) return;
  if (d < 1e-4) { nx = sa; ny = -ca; } else { nx /= d; ny /= d; }
  b.x = px + nx * min; b.y = py + ny * min;
  const rx = px - f.x, ry = py - f.y, svx = -f.omega * ry, svy = f.omega * rx;
  const vn = (b.vx - svx) * nx + (b.vy - svy) * ny;
  if (vn >= 0) return;
  b.vx -= 1.28 * vn * nx; b.vy -= 1.28 * vn * ny;
  if (-vn > 400) PBS.clack(Math.min(1, -vn / 2500) * 0.8);
}

function pbCross(ax, ay, bx, by, s) {
  const d1 = (s.x2 - s.x1) * (ay - s.y1) - (s.y2 - s.y1) * (ax - s.x1);
  const d2 = (s.x2 - s.x1) * (by - s.y1) - (s.y2 - s.y1) * (bx - s.x1);
  if ((d1 > 0) === (d2 > 0)) return false;
  const e1 = (bx - ax) * (s.y1 - ay) - (by - ay) * (s.x1 - ax), e2 = (bx - ax) * (s.y2 - ay) - (by - ay) * (s.x2 - ax);
  return (e1 > 0) !== (e2 > 0);
}

function pbSensors(b, px, py) {
  const T = PB.T, G = PB.G;
  for (const l of T.lanes) {
    const inside = (b.x - l.x) ** 2 + (b.y - l.y) ** 2 < l.r * l.r, was = b.in.has(l.id);
    if (inside && !was) { b.in.add(l.id); pbEv("lane", { b, o: l }); } else if (!inside && was) b.in.delete(l.id);
  }
  for (const s of T.spinners) if (pbCross(px, py, b.x, b.y, s)) { s.spd += Math.min(60, Math.abs(b.vy) / 45) * Math.sign(-b.vy || 1); pbEv("spinpass", { b, o: s }); }
  for (const o of T.orbits) if (pbCross(px, py, b.x, b.y, o) && b.vy < -300) pbEv("orbit", { b, o });
  if (b.noCatch > 0) return;
  for (const s of T.saucers) {
    const d2 = (b.x - s.x) ** 2 + (b.y - s.y) ** 2;
    if (d2 < 13 * 13 && Math.hypot(b.vx, b.vy) < (s.hole ? 1600 : 1150) && !G.tilted) {
      b.held = { s, t: 1.3 }; b.x = s.x; b.y = s.y; b.vx = b.vy = 0;
      pbEv("saucer", { b, o: s });
      return;
    }
  }
  // wyrzutnia: kulka opuściła tor
  if (b.lane && b.y < 330) { b.lane = false; pbEv("launched", { b }); }
}

function pbRampEnter(b, P, speed) {
  b.ramp = { P, s: 0, v: Math.max(760, Math.min(1350, speed * 0.85)) };
  b.trail.length = 0;
  P.flash = 1;
  PBS.ramp();
}

function pbRampMove(b, dt) {
  const r = b.ramp, P = r.P;
  r.v = Math.max(650, r.v - 160 * dt);
  r.s += r.v * dt;
  if (r.s >= P.total) {
    const n = P.pts.length, [x1, y1] = P.pts[n - 2], [x2, y2] = P.pts[n - 1], L = Math.hypot(x2 - x1, y2 - y1);
    b.x = x2; b.y = y2; b.vx = (x2 - x1) / L * r.v * 0.55; b.vy = (y2 - y1) / L * r.v * 0.55;
    b.ramp = null;
    pbEv("ramp", { b, o: P });
    return;
  }
  let i = 1;
  while (P.cum[i] < r.s) i++;
  const k = (r.s - P.cum[i - 1]) / (P.cum[i] - P.cum[i - 1]), [ax, ay] = P.pts[i - 1], [bx, by] = P.pts[i];
  b.x = ax + (bx - ax) * k; b.y = ay + (by - ay) * k;
}

// ================================================================ ZASADY

function pbNewGame(id) {
  const T = pbBuild(id);
  PB.T = T;
  PB.G = { score: 0, ball: 1, ballsTotal: 3, extra: 0, extraGiven: false, bonus: 0, bonusX: 1, lockLit: false, locks: 0, multiball: false,
           jackpot: 100000, mission: 0, prog: 0, tier: 1, combo: 0, comboT: 0, saveT: 0, saveArmed: true, tilted: false, tiltMeter: 0,
           pfx: 1, pfxT: 0, kickback: T.d.kickback, skill: 0, skillT: 0, skillLive: false, state: "lane", balls: [], bonusAnim: null,
           particles: [], pops: [], flash: null, shake: 0, show: 0, msgs: [], msg: null, pull: 0, pulling: false, t: 0, plays: 0,
           missionsDone: 0, bankReset: {}, lastShot: "" };
  pbNewBall();
}

function pbNewBall(auto = false) {
  const G = PB.G;
  G.balls.push(pbBall(565, 1050));
  G.state = "lane";
  G.saveArmed = true;
  G.skill = Math.floor(Math.random() * PB.T.topLanes.length);
  G.skillLive = true;
  if (auto) setTimeout(() => { if (PB.G === G) pbLaunch(0.82); }, 450);
}

function pbLaunch(power) {
  const G = PB.G, b = G.balls.find(b => b.x > 548 && b.y > 960 && !b.held);
  if (!b) return;
  b.vy = -(900 + power * 1750) * (0.98 + Math.random() * 0.04);
  b.vx = 0;
  b.lane = true;
  PBS.launch(power);
}

function pbAdd(pts, x, y, big = false) {
  const G = PB.G, v = Math.round(pts * G.pfx);
  G.score += v;
  if (x !== undefined) G.pops.push({ x, y, text: v.toLocaleString("pl-PL"), life: big ? 1.6 : 0.9, max: big ? 1.6 : 0.9, big });
  if (!G.extraGiven && G.score >= PB.T.d.extraAt) {
    G.extraGiven = true; G.extra++;
    pbMsg(["DODATKOWA", "KULA!"], 2.4, "flash"); PBS.extra(); pbFlash("#ffffff", 0.6);
  }
}

function pbMsg(lines, dur = 1.8, fx = "") {
  const G = PB.G;
  if (G.msgs.length > 4) G.msgs.shift();
  G.msgs.push({ lines: Array.isArray(lines) ? lines : [lines], dur, t: 0, fx });
}

function pbFlash(color, a = 0.5) { PB.G.flash = { color, a, t: a }; }

function pbSpark(x, y, n, colors, speed = 380, size = 2.4) {
  const P = PB.G.particles;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
    P.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35 + Math.random() * 0.5, max: 0.85, c: colors[i % colors.length], size: size * (0.6 + Math.random() * 0.8) });
  }
  if (P.length > 600) P.splice(0, P.length - 600);
}

function pbMission() { const m = PB.T.d.missions[PB.G.mission % PB.T.d.missions.length]; return { text: m[0], ev: m[1], n: Math.ceil(m[2] * (1 + (PB.G.tier - 1) * 0.6)) }; }

function pbCount(ev, n = 1) {
  const G = PB.G, m = pbMission();
  if (m.ev !== ev || G.tilted) return;
  G.prog += n;
  if (G.prog < m.n) return;
  const reward = 50000 * (G.mission % PB.T.d.missions.length + 1) * G.tier;
  G.prog = 0; G.mission++; G.missionsDone++;
  pbAdd(reward, 281, 520, true);
  pbMsg(["MISJA ZALICZONA", reward.toLocaleString("pl-PL")], 2.6, "zoom");
  PBS.mission(); pbFlash(PB.T.th.insert, 0.5); G.show = 2.2; G.shake = 6;
  pbSpark(281, 520, 50, [PB.T.th.insert, PB.T.th.insert2, "#ffffff"], 700, 3);
  G.bonus += 5000;
  if (G.mission % PB.T.d.missions.length === 0) {
    G.tier++; G.pfx = 3; G.pfxT = 30;
    pbMsg(["SUPER TRYB", "WSZYSTKO x3"], 3, "flash"); PBS.multiball();
  }
}

function pbShot(name, x, y) {
  const G = PB.G;
  G.combo = G.comboT > 0 && G.lastShot !== "" ? Math.min(5, G.combo + 1) : 0;
  G.comboT = 3.5; G.lastShot = name;
  if (G.combo > 0) { pbAdd(15000 * G.combo, x, y, true); pbMsg([`COMBO x${G.combo + 1}`], 1.4, "zoom"); PBS.combo(G.combo); }
  if (G.multiball) {
    pbAdd(G.jackpot, x, y, true);
    pbMsg(["JACKPOT!", G.jackpot.toLocaleString("pl-PL")], 2.2, "flash");
    G.jackpot += 50000; G.shake = 10; G.show = 1.5;
    PBS.jackpot(); pbFlash("#ffffff", 0.7);
    pbSpark(x, y, 60, [PB.T.th.insert, PB.T.th.insert2, "#ffffff", "#ffe35a"], 800, 3.2);
  }
}

function pbEv(type, { b, o, imp = 0 } = {}) {
  const G = PB.G, T = PB.T, th = T.th;
  if (type === "launched") {
    if (G.state === "lane") { G.state = "play"; if (G.saveArmed) { G.saveT = T.d.save; G.saveArmed = false; } }
    G.skillT = 4;
    return;
  }
  if (G.tilted && type !== "lane") return;
  if (type === "bumper") {
    o.flash = 1; pbAdd(500, o.x, o.y - o.r); G.bonus += 50;
    pbSpark(b.x, b.y, 14, [o.c || th.bump[0], "#ffffff", th.insert2], 420);
    PBS.bumper(); G.shake = Math.max(G.shake, 2); pbCount("bumper");
  } else if (type === "sling") {
    if (imp < 90) return;
    o.flash = 1; pbAdd(110); PBS.sling(); pbSpark(b.x, b.y, 8, [th.rubber, "#ffffff"], 300);
  } else if (type === "target") {
    if (imp < 70) return;
    o.flash = 1; pbAdd(2500, (o.x1 + o.x2) / 2, o.y1); G.bonus += 250; PBS.drop();
    pbSpark((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, 10, [th.insert, "#ffffff"], 300);
    o.down = true;
    const bank = T.banks[o.bank];
    if (bank.every(t => t.down) && !G.bankReset[o.bank]) {
      pbAdd(25000, (o.x1 + o.x2) / 2, o.y1 - 30, true); pbMsg(["CELE ZBITE", "25 000"], 1.6, "zoom"); PBS.mission();
      G.bankReset[o.bank] = 1.6; G.kickback = G.kickback || T.d.kickback; G.bonus += 2500;
      if (!G.multiball && !G.lockLit) { G.lockLit = true; pbMsg(["BLOKADA", "GOTOWA"], 1.6); }
      pbCount("bank");
    }
  } else if (type === "mover") {
    if (imp < 60) return;
    o.flash = 1; pbAdd(5000, o.x, o.y - 20, true); PBS.ghost(); pbSpark(b.x, b.y, 18, [th.insert, "#ffffff"], 420); G.bonus += 500;
    pbCount("mover");
  } else if (type === "lane") {
    if (o.kind === "out") {
      if (o.id === "outL" && G.kickback && !G.tilted) {
        b.vx = 40; b.vy = -2150; G.kickback = false; pbMsg("KICKBACK!", 1.2); PBS.kickback(); pbFlash(th.insert2, 0.4);
      } else if (!G.tilted) { pbAdd(2500); PBS.lane(0.6); }
      return;
    }
    if (o.kind === "in") { if (!G.tilted) { pbAdd(1000); G.bonus += 100; PBS.lane(0.8); } return; }
    if (G.tilted) return;
    o.flash = 1;
    const i = T.topLanes.indexOf(o);
    if (G.skillLive && G.skillT > 0) {
      G.skillLive = false;
      if (i === G.skill) { pbAdd(50000, o.x, o.y, true); pbMsg(["SKILL SHOT!", "50 000"], 2, "zoom"); PBS.jackpot(); pbFlash("#ffffff", 0.4); return; }
    }
    G.skillLive = false;
    if (!o.lit) { o.lit = true; pbAdd(1000, o.x, o.y); G.bonus += 200; PBS.lane(1); } else pbAdd(300);
    if (T.topLanes.every(l => l.lit)) {
      G.bonusX = Math.min(6, G.bonusX + 1);
      T.topLanes.forEach(l => { l.lit = false; l.flash = 1; });
      pbAdd(10000, 281, 190, true);
      if (!G.multiball && !G.lockLit) { G.lockLit = true; pbMsg([`BONUS x${G.bonusX}`, "BLOKADA GOTOWA"], 2); } else pbMsg([`BONUS x${G.bonusX}`], 1.6);
      PBS.mission(); G.show = 1;
    }
  } else if (type === "spinpass") {
    PBS.spin();
  } else if (type === "orbit") {
    pbAdd(10000, (o.x1 + o.x2) / 2, o.y1, true); G.bonus += 500; PBS.orbit();
    pbShot(o.id, (o.x1 + o.x2) / 2, o.y1); pbCount("orbit");
  } else if (type === "ramp") {
    pbAdd(15000, b.x, b.y - 30, true); G.bonus += 800; PBS.rampDone();
    pbSpark(b.x, b.y, 16, [th.ramp, "#ffffff"], 300);
    pbShot(o.id, b.x, b.y - 30); pbCount("ramp");
  } else if (type === "saucer") {
    o.flash = 1; pbAdd(7500, o.x, o.y - 24, true); G.bonus += 750; PBS.saucer(); G.shake = 4;
    pbCount("saucer");
    if (G.multiball) { pbShot("saucer", o.x, o.y); return; }
    if (G.lockLit) {
      G.lockLit = false; G.locks++;
      if (G.locks >= T.d.locks) { G.locks = 0; b.held.t = 2.2; pbMultiball(o); }
      else { pbMsg(["KULKA ZABLOKOWANA", `${G.locks}/${T.d.locks}`], 1.8, "zoom"); PBS.lock(); }
    } else if (T.topLanes.length) pbMsg(["ZAPAL TORY U GÓRY", "ŻEBY ZABLOKOWAĆ"], 1.4);
  }
}

function pbMultiball(s) {
  const G = PB.G;
  G.multiball = true; G.jackpot = Math.max(G.jackpot, 100000 * G.tier);
  pbMsg(["MULTIBALL!", "STRZELAJ W RAMPY"], 3, "flash");
  PBS.multiball(); pbFlash("#ffffff", 0.8); G.shake = 12; G.show = 3; G.saveT = Math.max(G.saveT, 12);
  for (let i = 0; i < 2; i++) setTimeout(() => {
    if (PB.G !== G || G.state === "over") return;
    const b = pbBall(565, 1050); G.balls.push(b);
    setTimeout(() => { if (PB.G === G) { b.vy = -2500; b.lane = true; PBS.launch(0.9); } }, 120);
  }, 700 + i * 900);
}

function pbDrain(b) {
  const G = PB.G;
  G.balls.splice(G.balls.indexOf(b), 1);
  if (G.balls.length) {
    if (G.multiball && G.balls.filter(x => !x.lane || x.y < 960).length <= 1 && G.balls.length <= 1) { G.multiball = false; pbMsg("KONIEC MULTIBALLA", 1.5); }
    return;
  }
  if (G.saveT > 0 && !G.tilted) {
    pbMsg(["KULKA URATOWANA", "GRAJ DALEJ"], 1.8, "flash"); PBS.save();
    G.multiball = false;
    pbNewBall(true);
    return;
  }
  pbEndBall();
}

function pbEndBall() {
  const G = PB.G;
  G.multiball = false; G.pfx = 1; G.pfxT = 0;
  PB.T.flips.forEach(f => (f.on = false));
  PBS.drain();
  const total = G.tilted ? 0 : G.bonus * G.bonusX;
  G.state = "bonus";
  G.bonusAnim = { t: 0, total, shown: 0, bonus: G.bonus, x: G.bonusX, tilted: G.tilted };
}

function pbAfterBonus() {
  const G = PB.G, a = G.bonusAnim;
  G.score += a.total;
  G.bonus = 0; G.bonusAnim = null; G.tilted = false; G.tiltMeter = 0;
  if (G.bonusX > 1 && !G.extra) G.bonusX = 1;
  if (G.extra > 0) { G.extra--; pbMsg(["ZAGRAJ JESZCZE RAZ", "TA SAMA KULA"], 2, "flash"); pbNewBall(); return; }
  G.ball++;
  if (G.ball > G.ballsTotal) return pbGameOver();
  pbMsg([`KULA ${G.ball}`], 1.6);
  pbNewBall();
}

function pbNudge() {
  const G = PB.G;
  if (G.tilted || G.state !== "play") return;
  for (const b of G.balls) if (!b.held && !b.ramp) { b.vx += (Math.random() - 0.5) * 160; b.vy -= 260; }
  G.shake = 8; G.tiltMeter += 1; PBS.nudge();
  if (G.tiltMeter > 3.6) {
    G.tilted = true; G.lockLit = false; G.kickback = false;
    pbMsg(["TILT"], 4, "flash"); PBS.tilt(); pbFlash("#ff0000", 0.6);
  } else if (G.tiltMeter > 2.3) { pbMsg("UWAGA!", 1); PBS.warn(); }
}

function pbTick(dt) {
  const G = PB.G, T = PB.T;
  G.t += dt;
  if (G.state === "bonus") {
    const a = G.bonusAnim;
    a.t += dt;
    const k = Math.min(1, Math.max(0, (a.t - 0.6) / 1.6));
    const shown = Math.round(a.total * k);
    if (shown !== a.shown && Math.floor(a.t * 18) !== Math.floor((a.t - dt) * 18)) PBS.tick();
    a.shown = shown;
    if (a.t > 3) pbAfterBonus();
  }
  for (const b of [...G.balls]) {
    b.noCatch = Math.max(0, b.noCatch - dt);
    if (b.held) {
      b.held.t -= dt;
      if (b.held.t <= 0) {
        const k = b.held.s.kick;
        b.vx = k[0] * (0.95 + Math.random() * 0.1); b.vy = k[1] * (0.95 + Math.random() * 0.1);
        b.held = null; b.noCatch = 0.5; PBS.kick(); G.shake = 3;
        pbSpark(b.x, b.y, 12, [T.th.insert2, "#ffffff"], 350);
      }
      continue;
    }
    if (!b.ramp) {
      b.trail.push(b.x, b.y);
      if (b.trail.length > 18) b.trail.splice(0, 2);
    }
    if (b.y > 1110) { pbDrain(b); continue; }
    // kulka utknęła: szukanie kulki (jak w prawdziwych automatach)
    // kulka trzymana na podniesionej łapce to nie zacięcie
    const inLane = b.x > 548 && b.y > 900, cradled = b.y > 860 && T.flips.some(f => f.on);
    if (!b.ramp && !inLane && !cradled && Math.hypot(b.vx, b.vy) < 25) b.still += dt; else b.still = 0;
    if (b.still > 2.6) { b.still = 0; b.vy = -800; b.vx = (Math.random() - 0.5) * 500; pbMsg("SZUKAM KULKI", 1); PBS.kick(); }
  }
  if (G.saveT > 0) G.saveT = Math.max(0, G.saveT - dt);
  if (G.comboT > 0) G.comboT = Math.max(0, G.comboT - dt); else G.lastShot = "";
  if (G.skillT > 0) G.skillT = Math.max(0, G.skillT - dt);
  if (G.pfxT > 0) { G.pfxT -= dt; if (G.pfxT <= 0) { G.pfx = 1; pbMsg("KONIEC SUPER TRYBU", 1.4); } }
  G.tiltMeter = Math.max(0, G.tiltMeter - dt * 0.55);
  for (const k of Object.keys(G.bankReset)) {
    G.bankReset[k] -= dt;
    if (G.bankReset[k] <= 0) { delete G.bankReset[k]; T.banks[k].forEach(t => { t.down = false; t.flash = 1; }); PBS.reset(); }
  }
  if (G.state === "lane" && G.skillLive) G.skill = Math.floor(G.t * 2.2) % T.topLanes.length;
  if (G.pulling) G.pull = Math.min(1, G.pull + dt * 1.15);
  for (const s of T.spinners) {
    const before = s.ang;
    s.ang += s.spd * dt; s.spd *= Math.pow(0.18, dt);
    if (Math.abs(s.spd) < 0.6) s.spd = 0;
    const turns = Math.abs(Math.floor(s.ang / Math.PI) - Math.floor(before / Math.PI));
    if (turns && !G.tilted) { pbAdd(150 * turns); PBS.spin(); pbCount("spin", turns); }
  }
  const fade = x => Math.max(0, x - dt * 3.2);
  T.bumpers.forEach(o => (o.flash = fade(o.flash)));
  T.slings.forEach(o => (o.flash = fade(o.flash)));
  T.targets.forEach(o => (o.flash = fade(o.flash)));
  T.lanes.forEach(o => (o.flash = fade(o.flash)));
  T.saucers.forEach(o => (o.flash = fade(o.flash)));
  T.ramps.forEach(o => (o.flash = Math.max(0, o.flash - dt * 1.5)));
  T.movers.forEach(o => (o.flash = fade(o.flash)));
  for (const p of G.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 2.5 * dt; p.vy = p.vy * (1 - 2.5 * dt) + 500 * dt; }
  G.particles = G.particles.filter(p => p.life > 0);
  for (const p of G.pops) { p.life -= dt; p.y -= 40 * dt; }
  G.pops = G.pops.filter(p => p.life > 0);
  // ozdoby stołów, które żyją same: iskry z lawy, gwiazdy w czarnej dziurze
  if (T.th.key === "dragon" && Math.random() < dt * 14) G.particles.push({ x: 40 + Math.random() * 480, y: 1000, vx: (Math.random() - 0.5) * 30, vy: -120 - Math.random() * 160, life: 2.5, max: 2.5, c: Math.random() < 0.5 ? "#ff7a1a" : "#ffd23d", size: 1.6, ember: true });
  if (G.flash) { G.flash.t -= dt; if (G.flash.t <= 0) G.flash = null; }
  G.shake = Math.max(0, G.shake - dt * 30);
  G.show = Math.max(0, G.show - dt);
  if (G.msg) { G.msg.t += dt; if (G.msg.t > G.msg.dur) G.msg = null; }
  if (!G.msg && G.msgs.length) G.msg = G.msgs.shift();
}

async function pbGameOver() {
  const G = PB.G;
  G.state = "over";
  pbMsg(["KONIEC GRY", G.score.toLocaleString("pl-PL")], 99);
  PBS.gameover();
  const r = await pbSubmit();
  PB.result = r || { score: G.score, earned: 0, bonus: 0, error: true };
  pbShowOver();
}

async function pbSubmit() {
  if (!PB.run || PB.submitted) return null;
  PB.submitted = true;
  try {
    const r = await api("/api/games/old-pinball/finish", { run: PB.run, score: PB.G.score });
    if (typeof r.balance === "number") { S.state = { ...S.state, balance: r.balance }; touch(); }
    return r;
  } catch (e) { toast(e.message, true); return null; }
}

// wyjście w trakcie gry: wynik zapisuje się tak, jak jest (bez czekania na odpowiedź)
function pbBeacon() {
  if (!PB.run || PB.submitted || !PB.G) return;
  PB.submitted = true;
  try { navigator.sendBeacon("/api/games/old-pinball/finish", JSON.stringify({ run: PB.run, score: PB.G.score })); } catch (_) {}
}

// ================================================================ DŹWIĘKI (Web Audio, bez plików)

const PBS = (() => {
  let ctx = null, out = null, nb = null;
  function ac() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      out = ctx.createGain(); out.gain.value = 0.42;
      out.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
      nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  const on = () => typeof Sound === "undefined" || Sound.enabled;
  function tone(f, t, d, { type = "sine", vol = 0.2, slide = null, attack = 0.004 } = {}) {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.05);
  }
  function noise(t, d, { vol = 0.2, freq = 2000, q = 1, type = "bandpass", slide = null } = {}) {
    const c = ac(), s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = nb; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.05);
  }
  const play = fn => (...a) => { if (!on()) return; try { fn(ac().currentTime, ...a); } catch (_) {} };
  const notes = (t, list, step, o) => list.forEach((n, i) => tone(440 * Math.pow(2, (n - 9) / 12), t + i * step, step * 1.6, o));
  return {
    flip: play(t => { noise(t, 0.05, { vol: 0.25, freq: 900, q: 0.8, type: "lowpass" }); tone(110, t, 0.06, { type: "square", vol: 0.06, slide: 60 }); }),
    clack: play((t, k = 0.5) => { noise(t, 0.04, { vol: 0.08 + k * 0.22, freq: 1800 + k * 1500, q: 2 }); }),
    bumper: play(t => { tone(820 + Math.random() * 120, t, 0.12, { type: "square", vol: 0.1, slide: 260 }); noise(t, 0.06, { vol: 0.25, freq: 3500, q: 1.5 }); }),
    sling: play(t => { tone(520, t, 0.07, { type: "square", vol: 0.08, slide: 200 }); noise(t, 0.05, { vol: 0.25, freq: 2400, q: 2 }); }),
    drop: play(t => { noise(t, 0.09, { vol: 0.35, freq: 700, q: 1, type: "lowpass" }); tone(180, t, 0.09, { type: "triangle", vol: 0.15, slide: 90 }); }),
    reset: play(t => { [0, 0.05, 0.1].forEach(d => noise(t + d, 0.05, { vol: 0.2, freq: 1200, q: 3 })); }),
    lane: play((t, k = 1) => { tone(1320 * k, t, 0.16, { type: "sine", vol: 0.12 }); tone(1980 * k, t + 0.06, 0.18, { type: "sine", vol: 0.08 }); }),
    spin: play(t => tone(2600 + Math.random() * 400, t, 0.025, { type: "square", vol: 0.035 })),
    orbit: play(t => { tone(300, t, 0.35, { type: "sawtooth", vol: 0.06, slide: 1400 }); noise(t, 0.3, { vol: 0.12, freq: 600, slide: 4000, q: 1 }); }),
    ramp: play(t => { tone(200, t, 0.5, { type: "triangle", vol: 0.1, slide: 900 }); noise(t, 0.45, { vol: 0.1, freq: 500, slide: 3000, q: 0.7 }); }),
    rampDone: play(t => notes(t, [12, 16, 19, 24], 0.06, { type: "square", vol: 0.06 })),
    saucer: play(t => { noise(t, 0.25, { vol: 0.35, freq: 400, slide: 90, type: "lowpass" }); tone(70, t, 0.35, { type: "sine", vol: 0.3 }); }),
    kick: play(t => { noise(t, 0.08, { vol: 0.4, freq: 900, q: 0.7, type: "lowpass" }); tone(140, t, 0.08, { type: "square", vol: 0.1, slide: 70 }); }),
    kickback: play(t => { noise(t, 0.15, { vol: 0.5, freq: 600, type: "lowpass" }); tone(90, t, 0.3, { type: "sawtooth", vol: 0.12, slide: 600 }); }),
    launch: play((t, p = 0.5) => { noise(t, 0.12 + p * 0.1, { vol: 0.3, freq: 500 + p * 1500, slide: 200, q: 0.8 }); tone(220, t, 0.1, { type: "triangle", vol: 0.1, slide: 110 }); }),
    pull: play(t => tone(160, t, 0.04, { type: "triangle", vol: 0.04 })),
    lock: play(t => notes(t, [0, 7, 12, 19], 0.09, { type: "square", vol: 0.07 })),
    mission: play(t => { notes(t, [0, 4, 7, 12, 16, 19, 24], 0.07, { type: "square", vol: 0.06 }); notes(t + 0.02, [-12, -5, 0], 0.16, { type: "sawtooth", vol: 0.05 }); }),
    jackpot: play(t => { notes(t, [12, 16, 19, 24, 28, 31, 36], 0.06, { type: "square", vol: 0.07 }); notes(t + 0.45, [24, 28, 31, 36], 0.12, { type: "triangle", vol: 0.1 }); noise(t, 0.6, { vol: 0.15, freq: 6000, q: 0.5, type: "highpass" }); }),
    combo: play((t, n = 1) => notes(t, [12 + n * 2, 16 + n * 2, 19 + n * 2], 0.05, { type: "square", vol: 0.06 })),
    multiball: play(t => { for (let i = 0; i < 6; i++) { tone(660, t + i * 0.22, 0.11, { type: "square", vol: 0.07 }); tone(880, t + i * 0.22 + 0.11, 0.11, { type: "square", vol: 0.07 }); } }),
    extra: play(t => notes(t, [7, 12, 16, 19, 24, 19, 24, 28], 0.08, { type: "triangle", vol: 0.12 })),
    save: play(t => notes(t, [12, 7, 12, 19], 0.08, { type: "triangle", vol: 0.1 })),
    drain: play(t => { tone(330, t, 0.25, { type: "sawtooth", vol: 0.08, slide: 160 }); tone(220, t + 0.25, 0.5, { type: "sawtooth", vol: 0.08, slide: 70 }); }),
    tick: play(t => tone(1500, t, 0.03, { type: "square", vol: 0.04 })),
    nudge: play(t => { noise(t, 0.12, { vol: 0.4, freq: 180, type: "lowpass" }); }),
    warn: play(t => tone(180, t, 0.25, { type: "square", vol: 0.1 })),
    tilt: play(t => { tone(110, t, 0.9, { type: "sawtooth", vol: 0.12 }); tone(116, t, 0.9, { type: "sawtooth", vol: 0.12 }); }),
    ghost: play(t => { tone(500, t, 0.4, { type: "sine", vol: 0.1, slide: 250 }); tone(520, t + 0.05, 0.4, { type: "sine", vol: 0.06, slide: 240 }); }),
    gameover: play(t => notes(t, [12, 7, 4, 0, -5, -12], 0.16, { type: "triangle", vol: 0.12 })),
    start: play(t => notes(t, [0, 4, 7, 12, 7, 12, 16, 24], 0.07, { type: "square", vol: 0.06 })),
  };
})();

// ================================================================ RYSOWANIE

const PB_GLOW = {};
function pbGlow(color) {
  if (PB_GLOW[color]) return PB_GLOW[color];
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, color); g.addColorStop(0.35, color + "88"); g.addColorStop(1, color + "00");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (PB_GLOW[color] = c);
}
function pbGlowAt(ctx, color, x, y, r, a = 1) {
  if (a <= 0.01) return;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(pbGlow(color), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}
function pbRng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function pbPath(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); }
function pbShade(hex, k) {
  const n = parseInt(hex.slice(1), 16), f = c => Math.max(0, Math.min(255, Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// tło stołu w motywie (raz, do warstwy statycznej)
function pbArt(ctx, T) {
  const th = T.th, rnd = pbRng(T.id.length * 977 + 13);
  const bg = ctx.createLinearGradient(0, 0, 0, PB_H);
  bg.addColorStop(0, th.bg[0]); bg.addColorStop(1, th.bg[1]);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, PB_W, PB_H);
  const stars = (n, a = 1) => { for (let i = 0; i < n; i++) { ctx.globalAlpha = (0.2 + rnd() * 0.8) * a; ctx.fillStyle = "#fff"; const s = rnd() * 1.8 + 0.3; ctx.fillRect(rnd() * PB_W, rnd() * PB_H, s, s); } ctx.globalAlpha = 1; };
  const text = (t, y, color, size = 92) => {
    ctx.save(); ctx.font = `900 ${size}px Rubik, Arial Black, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.16; ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.strokeText(t, 281, y);
    ctx.globalAlpha = 0.07; ctx.fillStyle = color; ctx.fillText(t, 281, y); ctx.restore();
  };
  if (th.key === "neon") {
    stars(120, 0.7);
    const sun = ctx.createLinearGradient(0, 180, 0, 470);
    sun.addColorStop(0, "#fff36b"); sun.addColorStop(0.5, "#ff7ad9"); sun.addColorStop(1, "#7a2aff");
    ctx.save(); ctx.beginPath(); ctx.arc(281, 330, 150, 0, Math.PI * 2); ctx.clip();
    ctx.globalAlpha = 0.32; ctx.fillStyle = sun; ctx.fillRect(100, 170, 400, 320);
    ctx.globalAlpha = 1; ctx.fillStyle = th.bg[0];
    for (let i = 0; i < 9; i++) ctx.fillRect(100, 360 + i * 14, 400, 3 + i * 1.2);
    ctx.restore();
    ctx.strokeStyle = "#ff3df2"; ctx.lineWidth = 1.4;
    for (let i = 0; i < 13; i++) { const y = 560 + Math.pow(i / 12, 1.8) * 480; ctx.globalAlpha = 0.12 + i * 0.012; ctx.beginPath(); ctx.moveTo(16, y); ctx.lineTo(546, y); ctx.stroke(); }
    for (let i = -10; i <= 10; i++) { ctx.globalAlpha = 0.14; ctx.beginPath(); ctx.moveTo(281 + i * 12, 560); ctx.lineTo(281 + i * 70, 1080); ctx.stroke(); }
    ctx.globalAlpha = 1;
    text("NEON", 690, "#5ef2ff", 110);
  } else if (th.key === "casino") {
    const felt = ctx.createRadialGradient(281, 480, 40, 281, 480, 620);
    felt.addColorStop(0, "#16884c"); felt.addColorStop(1, "#021a0b");
    ctx.fillStyle = felt; ctx.fillRect(0, 0, PB_W, PB_H);
    ctx.globalAlpha = 0.05; ctx.fillStyle = "#000";
    for (let i = 0; i < 2500; i++) ctx.fillRect(rnd() * PB_W, rnd() * PB_H, 1, 1);
    ctx.globalAlpha = 0.09; ctx.fillStyle = "#ffd54a"; ctx.font = "48px serif"; ctx.textAlign = "center";
    [["♠", 150, 650], ["♥", 410, 650], ["♦", 150, 200], ["♣", 420, 120], ["♠", 330, 720], ["♥", 230, 720]].forEach(([s, x, y]) => ctx.fillText(s, x, y));
    ctx.globalAlpha = 0.25; ctx.strokeStyle = "#ffd54a"; ctx.lineWidth = 2; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.ellipse(281, 760, 200, 60, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    text("ROYALE", 770, "#ffd54a", 72);
  } else if (th.key === "space") {
    for (const [x, y, r, c] of [[150, 300, 260, "#5a2aff"], [430, 700, 300, "#0a7aff"], [300, 120, 200, "#ff2a8a"]]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c + "55"); g.addColorStop(1, c + "00");
      ctx.fillStyle = g; ctx.fillRect(0, 0, PB_W, PB_H);
    }
    stars(420);
    const pg = ctx.createRadialGradient(110, 760, 10, 130, 780, 90);
    pg.addColorStop(0, "#ffb36b"); pg.addColorStop(1, "#5a1a0a");
    ctx.globalAlpha = 0.45; ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(130, 780, 70, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ffd9a8"; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(130, 780, 120, 22, -0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    text("KOSMOS", 700, "#9fc2ff", 84);
  } else if (th.key === "ghost") {
    stars(160, 0.6);
    const mg = ctx.createRadialGradient(440, 190, 0, 440, 190, 180);
    mg.addColorStop(0, "#fffbe0"); mg.addColorStop(0.35, "#f0e6b088"); mg.addColorStop(1, "#f0e6b000");
    ctx.fillStyle = mg; ctx.fillRect(220, 0, 380, 400);
    ctx.fillStyle = "#fff8d0"; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(440, 190, 58, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = th.bg[0]; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(424, 178, 12, 0, Math.PI * 2); ctx.arc(458, 210, 8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.5; ctx.fillStyle = "#0a0410";
    ctx.beginPath(); ctx.moveTo(16, 760); for (let x = 16; x <= 546; x += 20) ctx.lineTo(x, 720 - Math.sin(x / 60) * 30 - rnd() * 8); ctx.lineTo(546, 1080); ctx.lineTo(16, 1080); ctx.fill();
    ctx.globalAlpha = 0.6;
    for (const x of [120, 200, 360, 440]) { ctx.beginPath(); ctx.moveTo(x - 14, 740); ctx.lineTo(x - 14, 712); ctx.arc(x, 712, 14, Math.PI, 0); ctx.lineTo(x + 14, 740); ctx.fill(); }
    ctx.fillStyle = "#000"; ctx.globalAlpha = 0.55;
    for (let i = 0; i < 7; i++) { const x = 60 + rnd() * 440, y = 80 + rnd() * 380, s = 6 + rnd() * 8; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - s, y - s, x - s * 2, y); ctx.quadraticCurveTo(x - s, y - s * 0.3, x, y + s * 0.3); ctx.quadraticCurveTo(x + s, y - s * 0.3, x + s * 2, y); ctx.quadraticCurveTo(x + s, y - s, x, y); ctx.fill(); }
    ctx.globalAlpha = 1;
    text("DUCHY", 640, "#9dff6a", 92);
  } else if (th.key === "dragon") {
    const lg = ctx.createRadialGradient(281, 1040, 20, 281, 1000, 520);
    lg.addColorStop(0, "#ff5a0a55"); lg.addColorStop(1, "#ff5a0a00");
    ctx.fillStyle = lg; ctx.fillRect(0, 0, PB_W, PB_H);
    ctx.lineCap = "round";
    const crack = (x, y, a, len, w) => {
      if (len < 8 || w < 0.4) return;
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      ctx.strokeStyle = "#ff6a1a"; ctx.lineWidth = w * 3; ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = "#ffb03d"; ctx.lineWidth = w; ctx.globalAlpha = 0.5; ctx.stroke();
      crack(x2, y2, a + (rnd() - 0.5) * 1.2, len * 0.75, w * 0.8);
      if (rnd() < 0.35) crack(x2, y2, a + (rnd() - 0.5) * 2, len * 0.6, w * 0.6);
    };
    for (let i = 0; i < 9; i++) crack(30 + rnd() * 500, 120 + rnd() * 900, rnd() * Math.PI * 2, 40 + rnd() * 30, 2.4);
    ctx.globalAlpha = 0.55; ctx.fillStyle = "#1a0400";
    ctx.beginPath(); ctx.moveTo(60, 820); ctx.lineTo(220, 560); ctx.lineTo(250, 580); ctx.lineTo(310, 580); ctx.lineTo(340, 560); ctx.lineTo(500, 820); ctx.fill();
    ctx.globalAlpha = 0.4; ctx.fillStyle = "#ff5a0a"; ctx.beginPath(); ctx.ellipse(281, 572, 40, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    text("SMOK", 680, "#ffb06b", 100);
  }
  // fartuch na dole i tor wyrzutni
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(548, 330, 36, 740);
  const ap = ctx.createLinearGradient(0, 960, 0, 1080);
  ap.addColorStop(0, pbShade(th.bg[0], -0.2)); ap.addColorStop(1, "#000");
  ctx.fillStyle = ap;
  ctx.beginPath(); ctx.moveTo(16, 1080); ctx.lineTo(16, 1000); ctx.lineTo(60, 1000); ctx.lineTo(172, 1040); ctx.lineTo(240, 1080); ctx.fill();
  ctx.beginPath(); ctx.moveTo(546, 1080); ctx.lineTo(546, 1000); ctx.lineTo(502, 1000); ctx.lineTo(390, 1040); ctx.lineTo(322, 1080); ctx.fill();
}

function pbStatic(T, scale) {
  const c = document.createElement("canvas");
  c.width = Math.round(PB_W * scale); c.height = Math.round(PB_H * scale);
  const ctx = c.getContext("2d"), th = T.th;
  ctx.scale(scale, scale);
  pbArt(ctx, T);
  // procy: trójkąty z plastiku
  for (const w of T.walls.filter(w => w.kind === "rubber")) {
    pbPath(ctx, w.pts); ctx.closePath();
    const g = ctx.createLinearGradient(w.pts[0][0], w.pts[0][1], w.pts[2][0], w.pts[2][1]);
    g.addColorStop(0, th.insert + "66"); g.addColorStop(1, th.insert2 + "33");
    ctx.fillStyle = g; ctx.fill();
  }
  // wkładki (zgaszone światła): dołki, cele, strzałki
  for (const s of T.saucers) {
    const g = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, s.r + 6);
    g.addColorStop(0, "#000"); g.addColorStop(0.7, "#050505"); g.addColorStop(1, th.insert2 + "aa");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 6, 0, Math.PI * 2); ctx.fill();
  }
  // ściany: poświata + jasna linia
  for (const w of T.walls) {
    const col = w.kind === "wall" ? th.wall : w.kind === "rubber" ? th.rubber : th.rail;
    ctx.lineJoin = ctx.lineCap = "round";
    pbPath(ctx, w.pts); if (w.kind === "rubber") ctx.closePath();
    ctx.strokeStyle = col; ctx.globalAlpha = 0.12; ctx.lineWidth = w.kind === "wall" ? 22 : 14; ctx.stroke();
    ctx.globalAlpha = 0.3; ctx.lineWidth = w.kind === "wall" ? 10 : 7; ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = w.kind === "wall" ? 4 : w.kind === "rubber" ? 4.5 : 3; ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.65)"; ctx.lineWidth = 1.1; ctx.stroke();
  }
  for (const p of T.posts) {
    ctx.fillStyle = th.rubber; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.35, 0, Math.PI * 2); ctx.fill();
  }
  // tor wyrzutni: napis
  ctx.save(); ctx.translate(565, 760); ctx.rotate(-Math.PI / 2); ctx.font = "700 13px Rubik, sans-serif"; ctx.fillStyle = th.rail; ctx.globalAlpha = 0.5;
  ctx.textAlign = "center"; ctx.fillText("▲  WYRZUTNIA  ▲", 0, 5); ctx.restore();
  // napis na fartuchu
  ctx.font = "800 15px Rubik, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = th.rail; ctx.globalAlpha = 0.55;
  ctx.fillText(T.d.name.toUpperCase(), 100, 1030); ctx.fillText("SCAMBOX", 462, 1030);
  ctx.globalAlpha = 1;
  return c;
}

// strzałki pokazujące strzały (rampy, orbity, dołki) - zapalone, gdy coś za nie dają
function pbArrows(T) {
  const out = [];
  for (const r of T.ramps) {
    const mx = (r.a[0] + r.b[0]) / 2, my = (r.a[1] + r.b[1]) / 2, dx = r.b[0] - r.a[0], dy = r.b[1] - r.a[1], L = Math.hypot(dx, dy);
    let nx = dy / L, ny = -dx / L;
    if (ny < 0) { nx = -nx; ny = -ny; }
    out.push({ shot: "ramp", x: mx + nx * 46, y: my + ny * 46, ang: Math.atan2(-ny, -nx) });
  }
  out.push({ shot: "orbit", x: 41, y: 610, ang: -Math.PI / 2 }, { shot: "orbit", x: 521, y: 610, ang: -Math.PI / 2 });
  for (const s of T.saucers) out.push({ shot: "saucer", x: s.x, y: s.y + 40, ang: -Math.PI / 2 });
  return out;
}

function pbDraw() {
  const ctx = PB.ctx, T = PB.T, G = PB.G;
  if (!ctx || !T) return;
  const sc = PB.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, PB.cv.width, PB.cv.height);
  const sx = G.shake ? (Math.random() - 0.5) * G.shake : 0, sy = G.shake ? (Math.random() - 0.5) * G.shake : 0;
  ctx.setTransform(sc, 0, 0, sc, sx * sc, sy * sc);
  ctx.drawImage(T.static, 0, 0, PB_W, PB_H);
  pbDrawDynamic(ctx, T, G);
}

function pbDrawDynamic(ctx, T, G) {
  const th = T.th, t = G.t, blink = Math.floor(t * 6) % 2 === 0, show = G.show > 0;
  const showOn = i => show && Math.floor(t * 10 + i) % 3 === 0;
  // ruchome ozdoby motywu
  if (T.d.wheel) {
    const w = T.d.wheel, rot = t * 0.3 + T.spinners.reduce((a, s) => a + s.ang, 0) * 0.15;
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(rot); ctx.globalAlpha = 0.3;
    for (let i = 0; i < 37; i++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, w.r, i * Math.PI * 2 / 37, (i + 1) * Math.PI * 2 / 37); ctx.closePath();
      ctx.fillStyle = i === 0 ? "#0a8a3a" : i % 2 ? "#c41a1a" : "#111"; ctx.fill();
    }
    ctx.globalAlpha = 0.55; ctx.strokeStyle = "#ffd54a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, w.r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, w.r * 0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  for (const m of T.magnets) {
    ctx.save(); ctx.translate(m.x, m.y);
    for (let i = 0; i < 3; i++) {
      ctx.rotate(t * (0.8 + i * 0.4));
      ctx.globalAlpha = 0.22 - i * 0.05; ctx.strokeStyle = i % 2 ? "#ff8a3d" : "#b06bff"; ctx.lineWidth = 6 - i;
      ctx.beginPath(); for (let a = 0; a < 12; a += 0.2) { const r = 8 + a * 8.5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.8); } ctx.stroke();
    }
    ctx.restore(); ctx.globalAlpha = 1;
    pbGlowAt(ctx, "#b06bff", m.x, m.y, 70 + Math.sin(t * 3) * 8, 0.5);
  }
  if (th.key === "neon") pbGlowAt(ctx, "#ff7ad9", 281, 330, 190 + Math.sin(t * 1.4) * 14, 0.22);
  if (th.key === "ghost") {
    const gx = 120 + ((t * 30) % 420);
    pbGlowAt(ctx, "#c9b6ff", gx, 650 + Math.sin(t) * 20, 120, 0.12);
  }
  // światła torów (top / boczne)
  T.lanes.forEach((l, i) => {
    const lit = l.kind === "top" ? l.lit || (G.state === "lane" && G.skillLive && T.topLanes[G.skill] === l && blink) : l.id === "outL" && G.kickback;
    const col = l.kind === "top" ? th.insert : th.insert2;
    ctx.fillStyle = lit || showOn(i) ? col : "rgba(255,255,255,.1)";
    ctx.beginPath();
    if (l.kind === "top") ctx.arc(l.x, l.y + 4, 7, 0, Math.PI * 2); else { ctx.moveTo(l.x, l.y - 30); ctx.lineTo(l.x - 7, l.y - 18); ctx.lineTo(l.x + 7, l.y - 18); ctx.closePath(); }
    ctx.fill();
    if (lit || showOn(i)) pbGlowAt(ctx, col, l.x, l.kind === "top" ? l.y + 4 : l.y - 22, 26, 0.9);
    if (l.flash) pbGlowAt(ctx, "#ffffff", l.x, l.y, 30, l.flash);
  });
  // mnożnik bonusu i kopnięcie zwrotne
  for (let i = 2; i <= 6; i++) {
    const x = 201 + (i - 2) * 40, y = 790, on = G.bonusX >= i || showOn(i);
    ctx.fillStyle = on ? th.insert2 : "rgba(255,255,255,.08)";
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
    if (on) pbGlowAt(ctx, th.insert2, x, y, 30, 0.7);
    ctx.fillStyle = on ? "#000" : "rgba(255,255,255,.35)"; ctx.font = "800 12px Rubik, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(i + "x", x, y + 1);
  }
  const ins = (label, x, y, on, col) => {
    ctx.fillStyle = on ? col : "rgba(255,255,255,.07)";
    ctx.beginPath(); ctx.roundRect(x - 34, y - 10, 68, 20, 10); ctx.fill();
    if (on) pbGlowAt(ctx, col, x, y, 46, 0.6);
    ctx.fillStyle = on ? "#000" : "rgba(255,255,255,.3)"; ctx.font = "800 10px Rubik, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x, y + 1);
  };
  ins("ZAGRAJ PONOWNIE", 281, 1000, G.extra > 0 && blink, "#ffffff");
  ins("RATUNEK", 281, 1035, G.saveT > 0 && (G.saveT > 2 || blink), th.insert);
  ins("BLOKADA", 281, 832, G.lockLit && blink, th.insert);
  if (G.multiball) ins("JACKPOT", 281, 862, blink, "#ffe35a");
  // strzałki strzałów
  const m = PB.G.state ? pbMission() : null;
  for (const a of pbArrows(T)) {
    const hot = G.multiball || G.comboT > 0 || m?.ev === a.shot || (a.shot === "saucer" && G.lockLit) || showOn(a.x);
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.ang);
    ctx.fillStyle = hot && blink ? (G.multiball ? "#ffe35a" : th.insert) : "rgba(255,255,255,.1)";
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -11); ctx.lineTo(-3, 0); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (hot && blink) pbGlowAt(ctx, G.multiball ? "#ffe35a" : th.insert, a.x, a.y, 30, 0.8);
  }
  // dołki
  for (const s of T.saucers) {
    ctx.strokeStyle = G.lockLit && blink ? th.insert : th.insert2; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 4, 0, Math.PI * 2); ctx.stroke();
    if (G.lockLit) pbGlowAt(ctx, th.insert, s.x, s.y, 44, blink ? 0.8 : 0.3);
    if (s.flash) pbGlowAt(ctx, "#ffffff", s.x, s.y, 60, s.flash);
  }
  // cele
  for (const o of T.targets) {
    const vert = o.x1 === o.x2;
    if (o.down) {
      ctx.fillStyle = "rgba(0,0,0,.6)";
      vert ? ctx.fillRect(o.x1 - 3, o.y1, 6, o.y2 - o.y1) : ctx.fillRect(o.x1, o.y1 - 3, o.x2 - o.x1, 6);
      continue;
    }
    const g = vert ? ctx.createLinearGradient(o.x1 - 5, 0, o.x1 + 5, 0) : ctx.createLinearGradient(0, o.y1 - 6, 0, o.y1 + 6);
    g.addColorStop(0, pbShade(th.insert, 0.5)); g.addColorStop(1, pbShade(th.insert, -0.4));
    ctx.fillStyle = g;
    vert ? ctx.fillRect(o.x1 - 5, o.y1 + 1, 10, o.y2 - o.y1 - 2) : ctx.fillRect(o.x1 + 1, o.y1 - 6, o.x2 - o.x1 - 2, 12);
    if (o.flash || showOn(o.x1)) pbGlowAt(ctx, "#ffffff", (o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, 30, o.flash || 0.5);
  }
  // duch (ruchomy cel)
  for (const o of T.movers) {
    ctx.save(); ctx.translate(o.x, o.y); ctx.globalAlpha = 0.85 + o.flash * 0.15;
    pbGlowAt(ctx, "#c9b6ff", 0, -10, 60, 0.4 + o.flash);
    ctx.fillStyle = "#f2eaff";
    ctx.beginPath(); ctx.moveTo(-25, 2); ctx.lineTo(-25, -22); ctx.arc(0, -22, 25, Math.PI, 0); ctx.lineTo(25, 2);
    for (let i = 0; i < 5; i++) ctx.lineTo(25 - (i + 0.5) * 10, 2 + (i % 2 ? -6 : 6) * Math.sin(G.t * 6 + i));
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#1a0830"; ctx.beginPath(); ctx.ellipse(-9, -24, 4, 6, 0, 0, Math.PI * 2); ctx.ellipse(9, -24, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -10, 5, o.flash ? 7 : 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  // procy błyskają po kopnięciu
  for (const s of T.slings) if (s.flash) {
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.globalAlpha = s.flash; pbPath(ctx, [s.a, s.b]); ctx.stroke(); ctx.globalAlpha = 1;
    pbGlowAt(ctx, th.rubber, (s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, 70, s.flash);
  }
  // spinnery
  for (const s of T.spinners) {
    const mx = (s.x1 + s.x2) / 2, my = s.y1, w = (s.x2 - s.x1) / 2 - 2, h = Math.cos(s.ang) * 9;
    ctx.fillStyle = "#444"; ctx.fillRect(mx - w - 3, my - 1.5, (w + 3) * 2, 3);
    const g = ctx.createLinearGradient(0, my - 9, 0, my + 9);
    g.addColorStop(0, "#fff"); g.addColorStop(1, th.rail);
    ctx.fillStyle = g; ctx.fillRect(mx - w, my - Math.abs(h), w * 2, Math.max(1.5, Math.abs(h) * 2));
    if (Math.abs(s.spd) > 3) pbGlowAt(ctx, th.rail, mx, my, 30, Math.min(0.8, Math.abs(s.spd) / 30));
  }
  // grzybki
  T.bumpers.forEach((o, i) => {
    const col = th.bump[i % th.bump.length], k = 1 + o.flash * 0.12, r = o.r * k;
    ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.beginPath(); ctx.arc(o.x + 4, o.y + 6, o.r, 0, Math.PI * 2); ctx.fill();
    pbGlowAt(ctx, col === "#141414" ? "#ffd54a" : col, o.x, o.y, r * 2.2, 0.35 + o.flash);
    ctx.fillStyle = pbShade(col, -0.35); ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = th.key === "casino" ? "#f4e3b0" : "#fff"; ctx.lineWidth = 3;
    if (th.key === "casino") { ctx.setLineDash([r * 0.5, r * 0.4]); ctx.beginPath(); ctx.arc(o.x, o.y, r * 0.85, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    const cap = ctx.createRadialGradient(o.x - r * 0.3, o.y - r * 0.35, 1, o.x, o.y, r * 0.75);
    cap.addColorStop(0, o.flash > 0.2 ? "#ffffff" : pbShade(col, 0.6)); cap.addColorStop(1, col);
    ctx.fillStyle = cap; ctx.beginPath(); ctx.arc(o.x, o.y, r * 0.68, 0, Math.PI * 2); ctx.fill();
    if (th.key === "ghost") { ctx.fillStyle = "#2a1000"; ctx.beginPath(); ctx.moveTo(o.x - 9, o.y - 4); ctx.lineTo(o.x - 4, o.y - 10); ctx.lineTo(o.x - 1, o.y - 3); ctx.moveTo(o.x + 9, o.y - 4); ctx.lineTo(o.x + 4, o.y - 10); ctx.lineTo(o.x + 1, o.y - 3); ctx.fill(); ctx.beginPath(); ctx.arc(o.x, o.y + 3, 8, 0.1 * Math.PI, 0.9 * Math.PI); ctx.lineTo(o.x - 6, o.y + 4); ctx.fill(); }
    else { ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.ellipse(o.x - r * 0.25, o.y - r * 0.3, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2); ctx.fill(); }
  });
  // łapki
  for (const f of T.flips) {
    const ca = Math.cos(f.ang), sa = Math.sin(f.ang), tx = f.x + ca * f.len, ty = f.y + sa * f.len, nx = -sa, ny = ca;
    ctx.fillStyle = "rgba(0,0,0,.45)";
    pbCapsule(ctx, f.x + 4, f.y + 6, tx + 4, ty + 6, f.r0, f.r1, nx, ny); ctx.fill();
    const g = ctx.createLinearGradient(f.x + nx * f.r0, f.y + ny * f.r0, f.x - nx * f.r0, f.y - ny * f.r0);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.5, th.flip); g.addColorStop(1, pbShade(th.flip, -0.5));
    pbCapsule(ctx, f.x, f.y, tx, ty, f.r0, f.r1, nx, ny);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = pbShade(th.flip, -0.6); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(f.x, f.y, 3.5, 0, Math.PI * 2); ctx.fill();
    if (f.on && !G.tilted) pbGlowAt(ctx, th.flip, (f.x + tx) / 2, (f.y + ty) / 2, 50, 0.3);
  }
  // sprężyna wyrzutni
  const py = 1062 + G.pull * 40;
  ctx.fillStyle = "#2a2a2a"; ctx.fillRect(556, py, 18, 1080 - py);
  ctx.strokeStyle = "#bbb"; ctx.lineWidth = 2;
  ctx.beginPath(); for (let i = 0; i < 8; i++) { const y = py + 4 + i * (1078 - py) / 8; ctx.moveTo(557, y); ctx.lineTo(573, y + 3); } ctx.stroke();
  const pg = ctx.createLinearGradient(556, 0, 574, 0); pg.addColorStop(0, "#666"); pg.addColorStop(0.5, "#eee"); pg.addColorStop(1, "#555");
  ctx.fillStyle = pg; ctx.fillRect(555, py - 2, 20, 8);
  if (G.pulling) { ctx.fillStyle = `hsl(${120 - G.pull * 120},100%,55%)`; ctx.fillRect(588, 1062 - G.pull * 200, 6, G.pull * 200); }
  // kulki pod rampami
  for (const b of G.balls) if (!b.ramp) pbDrawBall(ctx, b, th, 1);
  // rampy (przezroczysty plastik nad stołem)
  for (const r of T.ramps) {
    ctx.lineJoin = ctx.lineCap = "round";
    pbPath(ctx, r.pts);
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 34; ctx.save(); ctx.translate(5, 8); ctx.stroke(); ctx.restore();
    pbPath(ctx, r.pts);
    ctx.strokeStyle = r.flash ? th.ramp : th.ramp + "33"; ctx.globalAlpha = r.flash ? 0.3 + r.flash * 0.4 : 1; ctx.lineWidth = 30; ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = th.ramp; ctx.lineWidth = 32; ctx.globalAlpha = 0.85;
    ctx.setLineDash([]); ctx.lineWidth = 2.5;
    pbOffsetLine(ctx, r.pts, 15); pbOffsetLine(ctx, r.pts, -15);
    ctx.globalAlpha = 0.5; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; pbOffsetLine(ctx, r.pts, 12);
    ctx.globalAlpha = 1;
    if (r.flash) for (let k = 0; k < 6; k++) { const s = ((t * 900 + k * r.total / 6) % r.total); const p = pbAlong(r, s); pbGlowAt(ctx, th.ramp, p[0], p[1], 26, r.flash); }
  }
  for (const b of G.balls) if (b.ramp) pbDrawBall(ctx, b, th, 1.18);
  // iskry i punkty
  ctx.globalCompositeOperation = "lighter";
  for (const p of G.particles) {
    const a = Math.min(1, p.life / (p.max * 0.5));
    ctx.globalAlpha = a; ctx.fillStyle = p.c;
    if (p.ember) { pbGlowAt(ctx, p.c, p.x, p.y, 6, a * 0.8); continue; }
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const p of G.pops) {
    const a = Math.min(1, p.life / (p.max * 0.4));
    ctx.globalAlpha = a; ctx.font = `900 ${p.big ? 24 : 15}px Rubik, sans-serif`;
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.big ? "#ffe35a" : "#fff"; ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  if (G.tilted) { ctx.fillStyle = "rgba(60,0,0,.35)"; ctx.fillRect(0, 0, PB_W, PB_H); }
  if (G.flash) { ctx.globalAlpha = Math.max(0, G.flash.t / G.flash.a) * 0.45; ctx.fillStyle = G.flash.color; ctx.fillRect(0, 0, PB_W, PB_H); ctx.globalAlpha = 1; }
}

function pbAlong(r, s) {
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] < s) i++;
  const k = (s - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1] || 1), a = r.pts[i - 1], b = r.pts[i];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

function pbOffsetLine(ctx, pts, off) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const x = p[0] - dy / L * off, y = p[1] + dx / L * off;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}

function pbCapsule(ctx, x1, y1, x2, y2, r1, r2, nx, ny) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.arc(x1, y1, r1, a + Math.PI / 2, a - Math.PI / 2);
  ctx.arc(x2, y2, r2, a - Math.PI / 2, a + Math.PI / 2);
  ctx.closePath();
}

function pbDrawBall(ctx, b, th, k) {
  const r = PB_R * k;
  if (b.trail.length > 4 && !b.held) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < b.trail.length; i += 2) { const a = i / b.trail.length; ctx.globalAlpha = a * 0.25; ctx.fillStyle = th.ball; ctx.beginPath(); ctx.arc(b.trail[i], b.trail[i + 1], r * (0.4 + a * 0.6), 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  const sh = k > 1 ? 10 : 3;
  ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.beginPath(); ctx.arc(b.x + sh, b.y + sh * 1.3, r, 0, Math.PI * 2); ctx.fill();
  if (b.held) { ctx.globalAlpha = 0.65; }
  const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.4, r * 0.1, b.x, b.y, r);
  g.addColorStop(0, "#ffffff"); g.addColorStop(0.3, th.ball); g.addColorStop(0.75, "#7a808c"); g.addColorStop(1, "#23262c");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = th.insert + "55"; ctx.beginPath(); ctx.ellipse(b.x + r * 0.2, b.y + r * 0.45, r * 0.6, r * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

// ================================================================ WYŚWIETLACZ (DMD z kropek)

const PB_DW = 128, PB_DH = 32;
function pbDmdText(x, txt, cx, y, size, weight = 800) {
  x.font = `${weight} ${size}px "Rubik", "Arial Narrow", sans-serif`;
  x.textAlign = "center"; x.textBaseline = "middle";
  let s = size;
  while (x.measureText(txt).width > PB_DW - 4 && s > 6) { s--; x.font = `${weight} ${s}px "Rubik", "Arial Narrow", sans-serif`; }
  x.fillText(txt, cx, y);
}

function pbDmd() {
  const cv = PB.dmd, G = PB.G;
  if (!cv || !G) return;
  if (!PB.dmdBuf) { PB.dmdBuf = document.createElement("canvas"); PB.dmdBuf.width = PB_DW; PB.dmdBuf.height = PB_DH; }
  const x = PB.dmdBuf.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#000"; x.fillRect(0, 0, PB_DW, PB_DH); x.fillStyle = "#fff";
  const m = G.msg, t = G.t;
  if (G.state === "bonus" && G.bonusAnim) {
    const a = G.bonusAnim;
    if (a.tilted) pbDmdText(x, "TILT - BEZ BONUSU", 64, 16, 11);
    else { pbDmdText(x, `BONUS ${a.bonus.toLocaleString("pl-PL")} x${a.x}`, 64, 8, 9); pbDmdText(x, a.shown.toLocaleString("pl-PL"), 64, 22, 16, 900); }
  } else if (m) {
    const k = m.t / m.dur;
    if (m.fx === "flash" && Math.floor(m.t * 8) % 2 && m.t < 0.8) { x.fillRect(0, 0, PB_DW, PB_DH); x.fillStyle = "#000"; }
    const zoom = m.fx === "zoom" ? Math.min(1, 0.3 + m.t * 4) : 1;
    x.save(); x.translate(64, 16); x.scale(zoom, zoom); x.translate(-64, -16);
    if (m.lines.length === 1) pbDmdText(x, m.lines[0], 64, 17, 20, 900);
    else { pbDmdText(x, m.lines[0], 64, 9, 12, 900); pbDmdText(x, m.lines[1], 64, 24, 11); }
    x.restore();
    if (k > 1) G.msg = null;
  } else {
    const mis = pbMission();
    pbDmdText(x, G.score.toLocaleString("pl-PL"), 64, 13, 19, 900);
    x.font = "700 7px Rubik, sans-serif"; x.textAlign = "left"; x.textBaseline = "top";
    x.fillText(`KULA ${Math.min(G.ball, G.ballsTotal)}${G.extra ? "+" : ""}`, 2, 24);
    x.textAlign = "right"; x.fillText(`x${G.bonusX}${G.pfx > 1 ? " ⚡x" + G.pfx : ""}`, 126, 24);
    x.textAlign = "center";
    const label = G.state === "lane" ? "WYRZUĆ KULKĘ" : G.multiball ? "MULTIBALL" : `${mis.text.toUpperCase()} ${Math.min(G.prog, mis.n)}/${mis.n}`;
    const w = x.measureText(label).width;
    if (w > 76) { x.save(); x.beginPath(); x.rect(26, 23, 76, 9); x.clip(); x.textAlign = "left"; x.fillText(label, 102 - ((t * 28) % (w + 76)), 24); x.restore(); }
    else x.fillText(label, 64, 24);
  }
  const data = x.getImageData(0, 0, PB_DW, PB_DH).data;
  const c = PB.dmdCtx, s = cv.width / PB_DW, col = PB.T.th.dmd;
  c.fillStyle = "#0a0503"; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = col + "1c";
  for (let yy = 0; yy < PB_DH; yy++) for (let xx = 0; xx < PB_DW; xx++) if (data[(yy * PB_DW + xx) * 4] < 110) c.fillRect(xx * s + 0.6, yy * s + 0.6, s - 1.2, s - 1.2);
  c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 6;
  for (let yy = 0; yy < PB_DH; yy++) for (let xx = 0; xx < PB_DW; xx++) {
    const v = data[(yy * PB_DW + xx) * 4];
    if (v >= 110) { c.globalAlpha = 0.55 + v / 570; c.fillRect(xx * s + 0.6, yy * s + 0.6, s - 1.2, s - 1.2); }
  }
  c.globalAlpha = 1; c.shadowBlur = 0;
}

// ================================================================ STEROWANIE

const PB_KEYS = { L: ["ArrowLeft", "KeyZ", "KeyA", "ShiftLeft"], R: ["ArrowRight", "Slash", "KeyM", "KeyD", "ShiftRight"],
                  plunge: ["ArrowDown", "Space", "Enter", "KeyS"], nudge: ["ArrowUp", "KeyW", "Space"], pause: ["KeyP", "Escape"] };

function pbActive() { return PB.mode === "play" && PB.G && pbMounted(); }
function pbBallInLane() { return PB.G.balls.some(b => b.x > 548 && b.y > 960 && !b.held && Math.abs(b.vy) < 60); }

function pbFlip(side, on) {
  const G = PB.G;
  if (!G || G.state === "over" || G.state === "bonus" || PB.paused) return;
  let changed = false;
  for (const f of PB.T.flips) if (f.side === side && f.on !== on) { f.on = on; changed = true; }
  if (!changed) return;
  if (on && !G.tilted) {
    PBS.flip();
    // zmiana zapalonych torów u góry (jak w każdym automacie)
    const L = PB.T.topLanes;
    if (L.length && G.state === "play") {
      const lit = L.map(l => l.lit);
      if (side === "L") lit.push(lit.shift()); else lit.unshift(lit.pop());
      L.forEach((l, i) => (l.lit = lit[i]));
    }
  }
}

function pbPlunge(on) {
  const G = PB.G;
  if (!G || PB.paused) return;
  if (on) { if (pbBallInLane() && G.state !== "over") { G.pulling = true; G.pull = 0; PBS.pull(); } return; }
  if (G.pulling) { G.pulling = false; pbLaunch(G.pull); G.pull = 0; }
}

document.addEventListener("keydown", e => {
  if (!pbActive() || e.target.matches?.("input, select, textarea")) return;
  const k = e.code, G = PB.G;
  const used = Object.values(PB_KEYS).some(l => l.includes(k));
  if (!used) return;
  e.preventDefault(); e.stopPropagation();
  if (e.repeat) return;
  if (PB_KEYS.pause.includes(k)) return pbPause(!PB.paused);
  if (PB.paused) return;
  if (PB_KEYS.L.includes(k)) pbFlip("L", true);
  if (PB_KEYS.R.includes(k)) pbFlip("R", true);
  if (PB_KEYS.plunge.includes(k) && pbBallInLane()) pbPlunge(true);
  else if (PB_KEYS.nudge.includes(k) && G.state === "play") pbNudge();
}, true);

document.addEventListener("keyup", e => {
  if (!pbActive()) return;
  const k = e.code;
  if (PB_KEYS.L.includes(k)) pbFlip("L", false);
  if (PB_KEYS.R.includes(k)) pbFlip("R", false);
  if (PB_KEYS.plunge.includes(k)) pbPlunge(false);
}, true);

window.addEventListener("blur", () => { if (pbActive()) { pbFlip("L", false); pbFlip("R", false); pbPause(true); } });
document.addEventListener("visibilitychange", () => { if (document.hidden && pbActive()) pbPause(true); });
window.addEventListener("pagehide", () => { if (PB.mode === "play") pbBeacon(); });

// dotyk: lewa / prawa połowa stołu = łapki, prawy dolny róg przy kulce w wyrzutni = sprężyna
function pbBindTouch(el) {
  el.addEventListener("pointerdown", e => {
    if (!pbActive()) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    let what = x < 0.5 ? "L" : "R";
    if (x > 0.84 && y > 0.6 && pbBallInLane()) what = "P";
    PB.pointers[e.pointerId] = what;
    el.setPointerCapture?.(e.pointerId);
    if (what === "P") pbPlunge(true); else pbFlip(what, true);
  });
  const up = e => {
    const what = PB.pointers[e.pointerId];
    if (!what) return;
    delete PB.pointers[e.pointerId];
    if (what === "P") pbPlunge(false); else if (!Object.values(PB.pointers).includes(what)) pbFlip(what, false);
  };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

function pbPause(on) {
  if (PB.mode !== "play" || !PB.G || PB.G.state === "over") return;
  PB.paused = on;
  if (on) { PB.T.flips.forEach(f => (f.on = false)); PB.G.pulling = false; }
  const el = $("#pbPause");
  if (el) el.hidden = !on;
}

// ================================================================ EKRANY: WYBÓR STOŁU I GRA

function pbStop() {
  cancelAnimationFrame(PB.raf);
  PB.raf = 0;
  if (PB.mode === "play" && PB.G && PB.G.state !== "over") pbBeacon();
  PB.mode = "menu";
}

async function renderPinball() {
  pbStop();
  const box = PB.box;
  if (!box) return;
  if (!PB.lobby) box.innerHTML = `<div class="opb-empty">Wczytuję…</div>`;
  try { PB.lobby = await api("/api/games/old-pinball"); } catch (e) { box.innerHTML = `<div class="opb-empty">${esc(e.message)}</div>`; return; }
  if (!pbMounted() || PB.mode === "play") return;
  pbMenuHTML();
}

const PB_DIFF = ["", "Łatwy", "Średni", "Trudny", "Bardzo trudny", "Ekspert"];

function pbMenuHTML() {
  const d = PB.lobby, left = Math.max(0, d.dailyCap - d.earnedToday);
  PB.box.innerHTML = `<div id="pbMenu">
    <div class="opb-hero">
      <div class="opb-hero-txt"><h3>Pinball</h3>
        <p>Gra jest <b>darmowa</b>. Po każdej partii punkty zamieniają się na grosze — trudniejszy stół płaci więcej za punkt.
          Najwyżej <b>${fmt(d.perMinute)}</b> za minutę gry i <b>${fmt(d.dailyCap)}</b> na dobę.</p>
        <div class="opb-cap"><div class="opb-cap-bar"><i style="width:${Math.min(100, d.earnedToday / d.dailyCap * 100)}%"></i></div>
          <span>Dzisiaj zarobione: <b>${fmt(d.earnedToday)}</b> · zostało <b>${fmt(left)}</b></span></div>
      </div>
      <div class="opb-keys"><div><kbd>←</kbd><kbd>Z</kbd> lewa łapka</div><div><kbd>→</kbd><kbd>/</kbd> prawa łapka</div>
        <div><kbd>↓</kbd><kbd>Spacja</kbd> przytrzymaj i puść = wyrzut</div><div><kbd>↑</kbd><kbd>Spacja</kbd> w grze = szturchnięcie (uwaga na TILT)</div><div><kbd>P</kbd> pauza · na telefonie: dotknij lewej / prawej połowy</div></div>
    </div>
    <div class="opb-tables">${d.tables.map((t, i) => pbCardHTML(t, i)).join("")}</div>
  </div>`;
  $$("#pbMenu canvas[data-pbprev]").forEach(c => pbPreview(c, c.dataset.pbprev));
}

function pbCardHTML(t, i) {
  const prev = PB.lobby.tables[i - 1], need = t.unlock, have = prev ? prev.best : 0, def = PB_TABLES[t.id]?.();
  if (!def) return "";
  return `<div class="opb-card opb-th-${t.id}${t.unlocked ? "" : " locked"}">
    <div class="opb-prev"><canvas data-pbprev="${t.id}" width="150" height="270"></canvas>
      ${t.unlocked ? "" : `<div class="opb-lock"><span>🔒</span><b>Zdobądź ${need.toLocaleString("pl-PL")} pkt</b><small>na stole ${esc(prev.name)}</small>
        <div class="opb-cap-bar"><i style="width:${Math.min(100, have / need * 100)}%"></i></div><small>${have.toLocaleString("pl-PL")} / ${need.toLocaleString("pl-PL")}</small></div>`}</div>
    <div class="opb-info">
      <div class="opb-num">STÓŁ ${i + 1}</div>
      <h4>${esc(t.name)}</h4>
      <div class="opb-stars" title="${PB_DIFF[def.stars]}">${"★".repeat(def.stars)}${"☆".repeat(5 - def.stars)} <small>${PB_DIFF[def.stars]}</small></div>
      <div class="opb-meta"><span>💰 ${t.pay.toLocaleString("pl-PL")} gr / 1000 pkt</span><span>🏆 rekord: <b>${t.best.toLocaleString("pl-PL")}</b></span>
        ${t.unlockBonus && !t.unlocked ? `<span>🎁 za odblokowanie: ${fmt(t.unlockBonus)}</span>` : ""}</div>
      ${t.top.length ? `<ol class="opb-top">${t.top.map(r => `<li class="${r.me ? "me" : ""}"><span>${esc(r.name)}</span><b>${r.score.toLocaleString("pl-PL")}</b></li>`).join("")}</ol>` : '<p class="opb-none">Nikt jeszcze tu nie grał.</p>'}
      <button class="opb-go" data-pbplay="${t.id}" ${t.unlocked ? "" : "disabled"}>${t.unlocked ? "▶ Graj" : "Zablokowany"}</button>
    </div></div>`;
}

function pbPreview(cv, id) {
  const T = pbBuild(id), s = cv.width / PB_W;
  T.static = pbStatic(T, s * 2);
  const ctx = cv.getContext("2d");
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.drawImage(T.static, 0, 0, PB_W, PB_H);
  const G = { t: 1.3, balls: [pbBall(300, 640)], particles: [], pops: [], state: "", show: 0, bonusX: 2, saveT: 0, extra: 0, lockLit: true, multiball: false, comboT: 0, pull: 0, mission: 0, tier: 1 };
  const keep = PB.G; PB.G = G;
  try { pbDrawDynamic(ctx, T, G); } finally { PB.G = keep; }
}

async function pbPlay(id) {
  let r;
  try { r = await api("/api/games/old-pinball/start", { table: id }); } catch (e) { return toast(e.message, true); }
  PB.run = r.run; PB.submitted = false; PB.result = null; PB.paused = false;
  pbNewGame(id);
  PB.mode = "play";
  const T = PB.T;
  PB.box.innerHTML = `<div class="opb-play opb-th-${id}" style="--pb-a:${T.th.insert};--pb-b:${T.th.insert2};--pb-dmd:${T.th.dmd}">
    <div class="opb-side">
      <div class="opb-backbox"><div class="opb-bb-title">${esc(T.d.name)}</div><canvas class="opb-dmd" id="pbDmd" width="512" height="128"></canvas></div>
      <div class="opb-stats">
        <div><small>Wynik</small><b id="pbScore">0</b></div>
        <div><small>Kula</small><b id="pbBall">1 / 3</b></div>
        <div><small>Zarobek</small><b id="pbEarn">0 gr</b></div>
        <div><small>Rekord</small><b>${(PB.lobby?.tables.find(t => t.id === id)?.best || 0).toLocaleString("pl-PL")}</b></div>
      </div>
      <div class="opb-mis"><small>Misja</small><div id="pbMis"></div><div class="opb-cap-bar"><i id="pbMisBar"></i></div></div>
      <div class="opb-btns"><button class="opb-btn" data-pbpause="1">⏸ Pauza</button><button class="opb-btn" data-pbquit="1">✖ Zakończ grę</button></div>
      <div class="opb-help"><kbd>←</kbd>/<kbd>→</kbd> łapki · przytrzymaj <kbd>↓</kbd> wyrzut · <kbd>↑</kbd> szturchnij · <kbd>P</kbd> pauza</div>
    </div>
    <div class="opb-cab">
      <canvas id="pbCanvas"></canvas>
      <div class="opb-pause" id="pbPause" hidden><div><b>PAUZA</b><button class="opb-go" data-pbpause="1">▶ Graj dalej</button></div></div>
      <div class="opb-over" id="pbOver" hidden></div>
    </div>
    <div class="opb-touch"><button data-pbt="L">◀</button><button data-pbt="P">⤒ wyrzut</button><button data-pbt="N">⇡ szturchnij</button><button data-pbt="R">▶</button></div>
  </div>`;
  PB.cv = $("#pbCanvas"); PB.ctx = PB.cv.getContext("2d");
  PB.dmd = $("#pbDmd"); PB.dmdCtx = PB.dmd.getContext("2d");
  pbBindTouch(PB.cv);
  $$(".opb-touch [data-pbt]").forEach(btn => {
    const w = btn.dataset.pbt;
    btn.addEventListener("pointerdown", e => { e.preventDefault(); if (w === "P") pbPlunge(true); else if (w === "N") pbNudge(); else pbFlip(w, true); });
    const up = () => { if (w === "P") pbPlunge(false); else if (w !== "N") pbFlip(w, false); };
    btn.addEventListener("pointerup", up); btn.addEventListener("pointercancel", up); btn.addEventListener("pointerleave", up);
  });
  pbResize();
  $(".opb-cab").scrollIntoView({ block: "nearest" });
  PBS.start();
  pbMsg([T.d.name.toUpperCase(), "POWODZENIA!"], 2.2, "zoom");
  PB.last = performance.now();
  cancelAnimationFrame(PB.raf);
  PB.raf = requestAnimationFrame(pbFrame);
}

function pbResize() {
  if (!PB.cv || PB.mode !== "play") return;
  const narrow = innerWidth < 760;
  // narrow: pasek górny i dolny gry zabierają ok. 140 px (+ obudowa); szerokość z kontenera (pasek boczny gry, panel 330 px + odstęp)
  const h = Math.max(420, Math.min(innerHeight - (narrow ? 160 : 96), 1080));
  let w = h * PB_W / PB_H;
  const box = PB.box?.clientWidth || innerWidth;
  const maxW = (narrow ? box : box - 352) - 26;
  const cssW = Math.max(260, Math.min(w, maxW)), cssH = cssW * PB_H / PB_W;
  const dpr = Math.min(2, devicePixelRatio || 1);
  PB.cv.style.width = cssW + "px"; PB.cv.style.height = cssH + "px";
  PB.cv.width = Math.round(cssW * dpr); PB.cv.height = Math.round(cssH * dpr);
  PB.scale = PB.cv.width / PB_W;
  PB.T.static = pbStatic(PB.T, PB.scale);
}
window.addEventListener("resize", () => { clearTimeout(PB.rz); PB.rz = setTimeout(pbResize, 150); });

function pbFrame(ts) {
  if (PB.mode !== "play") return;
  PB.raf = requestAnimationFrame(pbFrame);
  if (!pbMounted()) return pbStop();
  const dt = Math.min(1 / 30, Math.max(0, (ts - PB.last) / 1000));
  PB.last = ts;
  const G = PB.G;
  if (!PB.paused && dt > 0) {
    if (G.state !== "over") for (let i = 0; i < PB_SUB; i++) pbStep(dt / PB_SUB);
    pbTick(dt);
  }
  pbDraw();
  pbDmd();
  PB.statT -= dt;
  if (PB.statT <= 0) { PB.statT = 0.2; pbStats(); }
}

function pbEarn(score) {
  const t = PB.lobby?.tables.find(t => t.id === PB.T.id), d = PB.lobby;
  if (!t || !d) return 0;
  return Math.max(0, Math.min(Math.floor(score * t.pay / 1000), Math.max(0, d.dailyCap - d.earnedToday)));
}

function pbStats() {
  const G = PB.G, m = pbMission();
  const set = (id, v) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
  set("pbScore", G.score.toLocaleString("pl-PL"));
  set("pbBall", `${Math.min(G.ball, G.ballsTotal)} / ${G.ballsTotal}${G.extra ? " +" + G.extra : ""}`);
  set("pbEarn", fmt(pbEarn(G.score)));
  set("pbMis", G.multiball ? "MULTIBALL — trafiaj rampy i orbity po JACKPOT" : `${m.text} (${Math.min(G.prog, m.n)}/${m.n})`);
  const bar = $("#pbMisBar");
  if (bar) bar.style.width = (G.multiball ? 100 : Math.min(100, G.prog / m.n * 100)) + "%";
}

function pbShowOver() {
  const r = PB.result, el = $("#pbOver");
  if (!el) return;
  const t = PB.lobby?.tables.find(t => t.id === PB.T.id);
  el.innerHTML = `<div class="opb-over-in">
    <div class="opb-over-t">KONIEC GRY</div>
    <div class="opb-over-score">${(r.score ?? PB.G.score).toLocaleString("pl-PL")}</div>
    ${r.newBest ? '<div class="opb-newbest">🏆 NOWY REKORD!</div>' : ""}
    ${r.error ? '<p>Nie udało się zapisać wyniku.</p>' : `<div class="opb-over-earn">+${fmt(r.earned)}</div>
      ${r.capped ? `<p class="opb-small">Limit: najwyżej ${fmt(PB.lobby.perMinute)} za minutę i ${fmt(r.dailyCap)} na dobę.</p>` : ""}
      ${r.bonus ? `<div class="opb-unlock">🔓 Odblokowany stół: <b>${esc(r.unlocked)}</b><br>Premia +${fmt(r.bonus)}</div>` : ""}`}
    <div class="opb-over-btns"><button class="opb-go" data-pbplay="${PB.T.id}">↻ Jeszcze raz</button><button class="opb-btn" data-pbmenu="1">Wybierz stół</button></div>
    ${t ? `<p class="opb-small">Rekord stołu: ${Math.max(t.best, r.best || 0).toLocaleString("pl-PL")}</p>` : ""}
  </div>`;
  el.hidden = false;
  if (r.earned > 0) Sound.cash();
  PB.lobby = null;
  api("/api/games/old-pinball").then(d => { PB.lobby = d; }).catch(() => {});
}

async function pbQuit() {
  if (PB.mode !== "play") return;
  const G = PB.G;
  if (G.state !== "over") {
    G.state = "over";
    const r = await pbSubmit();
    PB.result = r || { score: G.score, earned: 0, error: true };
    pbShowOver();
  }
}

document.addEventListener("click", e => {
  const t = e.target.closest("[data-pbplay],[data-pbmenu],[data-pbpause],[data-pbquit]");
  if (!t || !t.closest("#view-games")) return;
  if (t.dataset.pbplay) { if (PB.mode === "play") { cancelAnimationFrame(PB.raf); PB.mode = "menu"; } pbPlay(t.dataset.pbplay); }
  else if (t.dataset.pbmenu) { PB.mode = "menu"; cancelAnimationFrame(PB.raf); renderPinball(); }
  else if (t.dataset.pbpause) pbPause(!PB.paused);
  else if (t.dataset.pbquit) { pbPause(false); pbQuit(); }
});

export function mountOldPinball(box) {
  PB.box = box;
  PB.mode = "menu";
  renderPinball();
}

export function unmountOldPinball() {
  pbStop();
  PB.box = null;
}
