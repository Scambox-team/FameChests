# .step_play() / .tile_at()

> 16 nodes · cohesion 0.19

## Key Concepts

- **.step_play()** (9 connections) — `server/src/run_sim.rs`
- **.tile_at()** (6 connections) — `server/src/run_sim.rs`
- **.row_idx()** (5 connections) — `server/src/run_sim.rs`
- **fmod()** (4 connections) — `server/src/det.rs`
- **.collect_items()** (4 connections) — `server/src/run_sim.rs`
- **.enter_row()** (4 connections) — `server/src/run_sim.rs`
- **.hit_obstacles()** (4 connections) — `server/src/run_sim.rs`
- **wrap_pi()** (4 connections) — `server/src/run_sim.rs`
- **det.rs** (3 connections) — `server/src/det.rs`
- **jround()** (3 connections) — `server/src/det.rs`
- **Rng** (3 connections) — `server/src/det.rs`
- **.land()** (3 connections) — `server/src/run_sim.rs`
- **.launch()** (3 connections) — `server/src/run_sim.rs`
- **.support()** (3 connections) — `server/src/run_sim.rs`
- **.new()** (1 connections) — `server/src/det.rs`
- **.next()** (1 connections) — `server/src/det.rs`

## Relationships

- [Sim / .seg_row()](Sim_-_.seg_row.md) (11 shared connections)
- [run_sim.rs / replay()](run_sim.rs_-_replay.md) (3 shared connections)

## Source Files

- `server/src/det.rs`
- `server/src/run_sim.rs`

## Audit Trail

- EXTRACTED: 33 (89%)
- INFERRED: 4 (11%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*