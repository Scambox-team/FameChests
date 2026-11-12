// Nagrania botów do testu zgodności Snake'ów i Super Turbo Run: przeglądarka (rdzenie TS) i serwer (snake_sim.rs, snake3d_sim.rs,
// run_sim.rs) muszą policzyć dokładnie ten sam wynik. Uruchom po KAŻDEJ zmianie features/snake/core.ts, features/snake/core3d.ts
// albo features/turbo/runCore.ts (Node 22.6+ z obsługą TypeScript):
//   node web/scripts/snake-fixture.mjs
// i potem `cargo test sim` w server/. Rdzenie nie mają importów, więc Node wczytuje je wprost.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src', 'features');
const fixtures = join(here, '..', '..', 'server', 'tests', 'fixtures');
const lcg = s => { let r = s >>> 0; return () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; }; };

// ---------------------------------------------------------------- Snake 2D: bot idzie do jabłka, unika ścian i ogona
{
  const { SnakeSim, DIRS, VEC, COLS, ROWS } = await import(pathToFileURL(join(src, 'snake', 'core.ts')).href);
  const out = [];
  for (const seed of [1, 2, 7, 4242, 987654321]) {
    const sim = new SnakeSim(seed), rnd = lcg(seed);
    while (!sim.over && sim.steps < 20000) {
      const h = sim.snake[0], body = sim.snake.slice(0, -1);
      const safe = d => { const v = VEC[d], x = h.x + v.x, y = h.y + v.y; return x >= 0 && y >= 0 && x < COLS && y < ROWS && !body.some(s => s.x === x && s.y === y); };
      const ok = DIRS.filter(safe);
      let d = sim.dir;
      if (ok.length) {
        const toward = ok.filter(k => { const v = VEC[k]; return Math.abs(h.x + v.x - sim.apple.x) + Math.abs(h.y + v.y - sim.apple.y) < Math.abs(h.x - sim.apple.x) + Math.abs(h.y - sim.apple.y); });
        d = (toward.length && rnd() < 0.9 ? toward : ok)[Math.floor(rnd() * (toward.length && rnd() < 0.9 ? toward : ok).length)] ?? ok[0];
        if (!safe(d)) d = ok[0];
      }
      if (sim.steps > 1500 && rnd() < 0.02) d = sim.dir;   // czasem w ścianę: gra musi się kończyć
      sim.step(d);
    }
    out.push({ seed, log: sim.log, score: sim.score, steps: sim.steps });
  }
  writeFileSync(join(fixtures, 'snake_replays.json'), JSON.stringify(out) + '\n');
  console.log('snake 2D:', out.map(o => `${o.seed}: ${o.score} jabłek / ${o.steps} kroków`).join(', '));
}

// ---------------------------------------------------------------- Super Turbo Snake 3D: bot skręca w stronę kuli, unika ścian i ogona
{
  const { Snake3DSim, N } = await import(pathToFileURL(join(src, 'snake', 'core3d.ts')).href);
  const out = [];
  for (const seed of [1, 3, 99, 31337, 2024001]) {
    const sim = new Snake3DSim(seed), rnd = lcg(seed);
    const free = (d) => { const h = sim.cells[0], x = h.x + d.x, z = h.z + d.z; return x >= 0 && z >= 0 && x < N && z < N && !sim.cells.slice(0, -1).some(c => c.x === x && c.z === z); };
    const turned = t => t > 0 ? { x: -sim.exitDir.z, z: sim.exitDir.x } : { x: sim.exitDir.z, z: -sim.exitDir.x };
    while (!sim.over && sim.ticks < 20000) {
      const h = sim.cells[0], target = sim.gold.active ? sim.gold.cell : sim.food.cell;
      const dist = d => Math.abs(h.x + d.x - target.x) + Math.abs(h.z + d.z - target.z);
      const opts = [[0, sim.exitDir], [1, turned(1)], [-1, turned(-1)]].filter(([, d]) => free(d));
      if (opts.length && !(sim.ticks > 1200 && rnd() < 0.02)) {
        opts.sort((a, b) => dist(a[1]) - dist(b[1]));
        const pick = rnd() < 0.85 ? opts[0] : opts[Math.floor(rnd() * opts.length)];
        if (pick[0]) sim.turn(pick[0]);
      }
      sim.tick();
    }
    out.push({ seed, log: sim.log, foods: sim.foods, ticks: sim.ticks });
  }
  writeFileSync(join(fixtures, 'snake3d_replays.json'), JSON.stringify(out) + '\n');
  console.log('snake 3D:', out.map(o => `${o.seed}: ${o.foods} kul / ${o.ticks} kroków`).join(', '));
}

// ---------------------------------------------------------------- Super Turbo Run 3D: bot skręca w stronę bezpiecznego pasa i skacze nad dziurami i przeszkodami
{
  const { createRunCore, TICK, TL, N, DTH, jround, mod } = await import(pathToFileURL(join(src, 'turbo', 'runCore.ts')).href);
  const out = [];
  for (const seed of [1, 5, 77, 123456, 3141592653]) {
    const core = createRunCore(), { G, P, getRow } = core, rnd = lcg(seed);
    core.start(seed);
    let holdJump = 0;
    while (G.state === 'playing' && core.run.tick < 120 * 60 * 4) {
      const lane = mod(jround(P.th / DTH), N), j = Math.floor(G.dist / TL);
      const bad = (jj, l) => { const r = getRow(jj); return r && (!r.tile[mod(l, N)] || r.obs[mod(l, N)]); };
      // co kilka kroków: skręć na pas bez dziur i przeszkód 2-3 rzędy przed biegaczem
      if (core.run.tick % 6 === 0) {
        let best = 0, bestScore = -1;
        for (const d of [0, -1, 1, -2, 2]) { let s = 0; for (let k = 1; k <= 4; k++) if (!bad(j + k, lane + d)) s++; if (s > bestScore + (d ? 0.5 : 0)) { bestScore = s; best = d; } }
        core.setKey('left', best < 0); core.setKey('right', best > 0);
      }
      if (P.grounded && (bad(j + 1, lane) || bad(j + 2, lane)) && rnd() < 0.7) { core.setKey('jump', true); holdJump = 20 + Math.floor(rnd() * 30); }
      if (holdJump > 0 && --holdJump === 0) core.setKey('jump', false);
      core.tick();
    }
    out.push({ seed, log: core.run.log, dist: G.deathDist || G.dist, ticks: core.run.tick });
  }
  writeFileSync(join(fixtures, 'run_replays.json'), JSON.stringify(out) + '\n');
  console.log('run 3D:', out.map(o => `${o.seed}: ${Math.floor(o.dist)} m / ${o.ticks} kroków`).join(', '));
}
