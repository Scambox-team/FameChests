// Nagrania botów do testu zgodności Strzelnicy: przeglądarka (aim/core.ts) i serwer (server/src/aim_sim.rs) muszą policzyć dokładnie
// ten sam wynik. Uruchom po KAŻDEJ zmianie aim/core.ts (potrzebny Node 22.6+ z obsługą TypeScript):
//   node web/scripts/aim-fixture.mjs
// i potem `cargo test aim_sim` w server/.
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'aim-'));
copyFileSync(join(here, '..', 'src', 'features', 'aim', 'core.ts'), join(tmp, 'core.ts'));
const { Sim, ROUND_TICKS, COOLDOWN } = await import(pathToFileURL(join(tmp, 'core.ts')).href);

function bot(seed, skill) {
  const sim = new Sim(seed);
  sim.start();
  const log = [];
  let r = (seed * 2654435761) >>> 0;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  while (sim.phase === 'play') {
    if (sim.tick - sim.lastShot >= COOLDOWN + Math.floor(rnd() * 8) && sim.ducks.length) {
      // celuje w losową kaczkę z wyprzedzeniem; skill = rozrzut w jednostkach pola
      const d = sim.ducks[Math.floor(rnd() * sim.ducks.length)];
      const lead = d.dir * d.v * 0.05;
      const x = Math.max(0, Math.min(800, Math.round(d.x + lead + (rnd() - 0.5) * skill)));
      const y = Math.max(0, Math.min(500, Math.round(d.y + (rnd() - 0.5) * skill)));
      log.push(sim.tick, x, y);
      sim.shoot(x, y);
    }
    sim.step();
  }
  return { seed, log, score: sim.score, hits: sim.hits, shots: sim.shots };
}

const runs = [bot(1, 30), bot(987654321, 60), bot(424242, 15), bot(2026, 90)];
for (const o of runs) console.log(`ziarno ${o.seed}: wynik ${o.score}, trafień ${o.hits} z ${o.shots}`);
writeFileSync(join(here, '..', '..', 'server', 'tests', 'fixtures', 'aim_replays.json'), JSON.stringify(runs));
console.log('rundy trwają', ROUND_TICKS, 'ticków');
