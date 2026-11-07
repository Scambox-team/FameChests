// Nagrania botów do testu zgodności Pinballa: przeglądarka (core.ts) i serwer (server/src/pinball_sim.rs) muszą policzyć dokładnie
// ten sam wynik. Uruchom po KAŻDEJ zmianie core.ts albo levels.json (potrzebny Node 22.6+ z obsługą TypeScript):
//   node web/scripts/pinball-fixture.mjs
// i potem `cargo test pinball_sim` w server/. Skrypt kopiuje rdzeń do folderu tymczasowego z poprawionymi importami
// (Node chce rozszerzeń w ścieżkach i atrybutu `with { type: 'json' }`), więc źródeł nie rusza.
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src', 'features', 'pinball');
const out = join(here, '..', '..', 'server', 'tests', 'fixtures', 'pinball_replays.json');
const tmp = mkdtempSync(join(tmpdir(), 'pinball-'));

writeFileSync(join(tmp, 'core.ts'), readFileSync(join(src, 'core.ts'), 'utf8').replace("from './levels';", "from './levels.ts';"));
writeFileSync(join(tmp, 'levels.ts'), readFileSync(join(src, 'levels.ts'), 'utf8').replace("from './levels.json';", "from './levels.json' with { type: 'json' };"));
copyFileSync(join(src, 'levels.json'), join(tmp, 'levels.json'));

const { Sim, INPUT_CODES } = await import(pathToFileURL(join(tmp, 'core.ts')).href);

function bot(level, seed) {
  const sim = new Sim(level, seed);
  sim.start();
  const log = [];
  const inp = c => { log.push(sim.tick, INPUT_CODES.indexOf(c)); sim.input(c); };
  let chargeFor = 0, left = false;
  let r = (seed * 7919 + level * 104729) >>> 0;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  while (sim.phase === 'play' && sim.tick < 120 * 60 * 20) {
    const t = sim.tick;
    const inLane = sim.balls.some(b => sim.inLane(b) && !b.auto);
    if (inLane && !sim.charging && chargeFor === 0) { inp('p+'); chargeFor = 40 + Math.floor(rnd() * 80); }
    if (sim.charging) { chargeFor--; if (chargeFor <= 0) { inp('p-'); chargeFor = 0; } }
    if (t % 20 === 0) { left = !left; inp(left ? 'l+' : 'r+'); inp(left ? 'r-' : 'l-'); }
    if (t % 1700 === 900) inp('n');
    sim.step();
  }
  return { level, seed, log, score: Math.floor(sim.score), ticks: sim.tick, over: sim.phase === 'over' };
}

const runs = [];
for (let level = 1; level <= 5; level++) for (const seed of [1, 987654321]) runs.push(bot(level, seed));
for (const o of runs) console.log(`poziom ${o.level} ziarno ${o.seed}: wynik ${o.score}, ${o.ticks} ticków, zdarzeń ${o.log.length / 2}${o.over ? '' : ' (NIE DOSZŁA DO KOŃCA)'}`);
writeFileSync(out, JSON.stringify(runs.filter(o => o.over).map(({ level, seed, log, score, ticks }) => ({ level, seed, log, score, ticks }))));
console.log('zapisano', out);
