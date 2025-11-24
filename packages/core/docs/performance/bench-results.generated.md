

# Bench Results

> Generated from `bench-results.json` by `scripts/format-bench.ts`. Re-run `pnpm bench:report` after changing benchmarks.

_Bench run: 2025-11-24T08:49:32.667Z_

## Hot path micro-operations

| Operation                                          | Mean time (µs) | Throughput (M ops/s) |
|----------------------------------------------------|---------------:|---------------------:|
| seqlock publish uncontended                        |          0.103 |                 9.71 |
| controller.params.stage (eqBands f32[8])           |          0.141 |                 7.10 |
| meter scalar: writer.level(0.75)                   |          0.148 |                 6.76 |
| seqlock tryRead uncontended                        |          0.153 |                 6.54 |
| meter scalar: writer.set('level', 0.75)            |          0.161 |                 6.21 |
| controller.params.set (two scalars)                |          0.285 |                 3.51 |
| controller.params.update (3 scalars)               |          0.321 |                 3.11 |
| controller.params.hydrate (3 scalars + f32[8])     |          0.398 |                 2.51 |
| controller.params.update (3 scalars + f32[8])      |          0.459 |                 2.18 |
| processor.params.within (scalars only)             |          0.586 |                 1.71 |
| processor.params.within (scalars + eqBands f32[8]) |          0.602 |                 1.66 |
| meter array: writer.stage('spectrum', cb)          |          0.734 |                 1.36 |
| interleaved controller.update + processor.within   |          0.972 |                 1.03 |
| observer.params.snapshot (partial)                 |         39.745 |                 0.03 |
| observer.params.within (full view)                 |         44.969 |                 0.02 |
| observer.params.snapshot (full)                    |         50.944 |                 0.02 |
| observer.meters.snapshot (partial)                 |        103.788 |                 0.01 |
| observer.meters.snapshot (full)                    |        121.298 |                 0.01 |

## E2E setup: `spec → plan → backing → handoff → bindings`

| Spec size   | Mean setup time (ms) | Setups per second |
|-------------|---------------------:|------------------:|
| Small spec  |                0.020 |             49278 |
| Medium spec |                0.034 |             29485 |
| Large spec  |                0.049 |             20280 |

_Note:_ numbers are from a single Node 20 + Vitest bench run and are meant for relative comparison, not absolute tuning.
