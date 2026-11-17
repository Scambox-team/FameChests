// Nagrania botów do testu zgodności Obrony Orbity: przeglądarka (invaders/core.ts) i serwer (server/src/invaders_sim.rs) muszą
// policzyć dokładnie ten sam wynik. Uruchom po KAŻDEJ zmianie invaders/core.ts (potrzebny Node 22.6+ z obsługą TypeScript):
//   node web/scripts/invaders-fixture.mjs
// i potem `cargo test invaders_sim` w server/.
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'inv-'));
copyFileSync(join(here, '..', 'src', 'features', 'invaders', 'core.ts'), join(tmp, 'core.ts'));
const { InvadersSim, LEFT, RIGHT, FIRE, ACOLS, AW } = await import(pathToFileURL(join(tmp, 'core.ts')).href);

function bot(seed, skill, limit) {
  const sim = new InvadersSim(seed);
  let r = (seed * 2654435761) >>> 0;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  let goal = 240;
  while (!sim.over && sim.tick < limit) {
    if (sim.tick % 30 === 0) {
      // cel: kolumna z żywym obcym (skill = jak często bot celuje, a nie błądzi)
      const cols = [];
      for (let i = 0; i < sim.alive.length; i++) if (sim.alive[i]) cols.push(sim.alienX(i) + AW / 2);
      goal = cols.length && rnd() < skill ? cols[Math.floor(rnd() * cols.length)] : 20 + rnd() * 440;
    }
    let mask = 0, g = goal;
    // unik: bomba nad statkiem - w bok
    const danger = sim.bombs.find(b => b.y > 330 && Math.abs(b.x - sim.px) < 24);
    if (danger) g = danger.x < sim.px ? Math.min(464, danger.x + 60) : Math.max(16, danger.x - 60);
    if (sim.px < g - 3) mask |= RIGHT; else if (sim.px > g + 3) mask |= LEFT;
    if (rnd() < 0.7) mask |= FIRE;
    sim.step(mask);
  }
  return { seed, log: sim.log, ticks: sim.tick, score: sim.score, wave: sim.wave };
}

const runs = [bot(1, 0.9, 20000), bot(987654321, 0.6, 30000), bot(424242, 0.95, 60000), bot(2026, 0.3, 8000), bot(77, 1, 120000)];
for (const o of runs) console.log(`ziarno ${o.seed}: wynik ${o.score}, fala ${o.wave}, kroków ${o.ticks}, zapis ${o.log.length / 2}`);
writeFileSync(join(here, '..', '..', 'server', 'tests', 'fixtures', 'invaders_replays.json'), JSON.stringify(runs));
