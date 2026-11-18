// Nagrania botów do testu zgodności Super Turbo AIMPULSE: przeglądarka (turbo/aimCore.ts) i serwer (server/src/aimpulse_sim.rs)
// muszą policzyć dokładnie ten sam wynik. Uruchom po KAŻDEJ zmianie aimCore.ts (potrzebny Node 22.6+ z obsługą TypeScript):
//   node web/scripts/aimpulse-fixture.mjs
// i potem `cargo test aimpulse_sim` w server/.
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ziarna odcinków (to samo co segSeed w features/games/liveSeeds.ts i live::test_seeds w Rust)
const segSeeds = base => k => { let a = (base ^ Math.imul(k, 0x9E3779B9)) | 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * 4294967296) >>> 0; };
const tmp = mkdtempSync(join(tmpdir(), 'aimp-'));
copyFileSync(join(here, '..', 'src', 'features', 'turbo', 'aimCore.ts'), join(tmp, 'aimCore.ts'));
const { AimSim, EYE, QUANT, BAD } = await import(pathToFileURL(join(tmp, 'aimCore.ts')).href);

function bot(seed, diff, dur, noise, avoid) {
  const sim = new AimSim(segSeeds(seed), diff, dur);
  let r = (seed * 2654435761) >>> 0;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  while (!sim.over) {
    if (sim.canShoot() && rnd() < 0.25) {
      const pool = sim.targets.filter(t => !avoid || t.type !== BAD);
      let dx, dy, dz;
      if (pool.length && rnd() < 0.9) {
        const t = pool[Math.floor(rnd() * pool.length)];
        dx = t.x - EYE.x + (rnd() - 0.5) * noise; dy = t.y - EYE.y + (rnd() - 0.5) * noise; dz = t.z - EYE.z;
      } else { dx = rnd() - 0.5; dy = rnd() * 0.3; dz = -1; }
      const l = Math.hypot(dx, dy, dz);
      sim.shoot(Math.round(dx / l * QUANT), Math.round(dy / l * QUANT), Math.round(dz / l * QUANT));
    }
    sim.step();
  }
  return { seed, diff, dur, log: sim.log, score: sim.score, hits: sim.hits };
}

const runs = [bot(1, 1, 60, 0.6, true), bot(987654321, 0, 30, 1.2, false), bot(424242, 2, 120, 0.3, true), bot(2026, 1, 30, 2, false), bot(31337, 2, 60, 0.1, true)];
for (const o of runs) console.log(`ziarno ${o.seed}: poziom ${o.diff}, ${o.dur} s: wynik ${o.score}, trafień ${o.hits} z ${o.log.length / 4}`);
writeFileSync(join(here, '..', '..', 'server', 'tests', 'fixtures', 'aimpulse_replays.json'), JSON.stringify(runs));
