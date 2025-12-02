# Bench Results

> Generated from `bench-results.json` by `scripts/format-bench.ts`. Re-run `pnpm bench:report` after changing benchmarks.

_Bench run (local time): 29 Nov 2025, 19:07:46_

_Bench run (ISO 8601): 2025-11-29T18:07:46.683Z_

## Hot path micro-operations
_Includes seqlock primitives, controller param writes, processor reads, and MeterWriter operations. Observer reads are broken out separately below._

| Operation                                          | Mean time (µs) | Throughput (M ops/s) |
|----------------------------------------------------|---------------:|---------------------:|
| seqlock publish uncontended                        |          0.091 |                11.05 |
| controller.params.stage (eqBands f32[8])           |          0.146 |                 6.85 |
| meter scalar: writer.level(0.75)                   |          0.159 |                 6.30 |
| seqlock tryRead uncontended                        |          0.182 |                 5.49 |
| meter scalar: writer.set('level', 0.75)            |          0.195 |                 5.14 |
| controller.params.set (two scalars)                |          0.221 |                 4.53 |
| controller.params.update (3 scalars)               |          0.245 |                 4.08 |
| controller.params.hydrate (3 scalars + f32[8])     |          0.335 |                 2.99 |
| controller.params.update (3 scalars + f32[8])      |          0.392 |                 2.55 |
| processor.params.within (scalars + eqBands f32[8]) |          0.719 |                 1.39 |
| processor.params.within (scalars only)             |          0.720 |                 1.39 |
| meter array: writer.stage('spectrum', cb)          |          0.791 |                 1.26 |
| interleaved controller.update + processor.within   |          0.918 |                 1.09 |

## E2E setup: `spec → plan → backing → handoff → bindings`

| Spec size   | Mean setup time (ms) | Setups per second |
|-------------|---------------------:|------------------:|
| Small spec  |                0.021 |             47075 |
| Medium spec |                0.033 |             30552 |
| Large spec  |                0.043 |             23194 |

## Interpretation and budgets

### Latency tiers

- Tier 0 (sub-microsecond): 13 operations including `seqlock publish uncontended`, `controller.params.stage (eqBands f32[8])`, `meter scalar: writer.level(0.75)`, `seqlock tryRead uncontended`.
- Tier 1 (tens of microseconds): 3 operations including `observer.params.snapshot (partial, array)`, `observer.params.within (full view)`, `observer.params.snapshot (full)`.
- Tier 2 (hundreds of microseconds): 2 operations including `observer.meters.snapshot (partial, array)`, `observer.meters.snapshot (full)`.

### Parameter write budgets

- Absolute costs: param writes sit between 0.146 µs (`params.stage`) and 0.392 µs (`params.update+array`) in this run.
- Relative: `params.stage` is about 1.51× faster than `params.set` and 1.68× faster than `params.update`.
- Mixed scalar + array writes remain sub-microsecond: `params.hydrate` and `params.update+array` land around 0.335–0.392 µs per call.

### Observer param read budgets

- Partial param snapshots (array form) cost about 40.254 µs per snapshot.
- Full param snapshots sit around 47.193 µs.
- Coherent views via `within (full view)` land near 42.999 µs.
- Relative to writes: a partial param snapshot is roughly 182.35× the cost of `params.set` and 275.77× the cost of `params.stage`.

### Observer meter read budgets

- Partial meter snapshots (array form) cost about 126.274 µs.
- Full meter snapshots land around 132.711 µs.
- Compared to a write: a partial meter snapshot is roughly 159.55× the cost of `writer.stage`.
- Compared to params: meter snapshots are about 3.14× heavier than partial param snapshots and 2.68× heavier than full param snapshots.

### End-to-end setup budgets

- Largest measured setup (Large spec) is about 0.043 ms per run.
- For reference, a 128-sample audio block at 48,000 Hz is about 2.667 ms, so Large spec is roughly 61.8× cheaper than processing a single block.
- This keeps full `spec → plan → backing → handoff → bindings` rebuilds safely on the control side rather than in the audio hot path.

_Note:_ numbers are from a single Node 22.18.0 + Vitest bench run and are meant for relative comparison, not absolute tuning.
