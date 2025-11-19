<!-- GENERATED FILE: do not edit by hand.
     Regenerate via: pnpm bench:report -->

# Bench Results

> Generated from `bench-results.json` by `scripts/format-bench.ts`. Re-run `pnpm bench:report` after changing benchmarks.

_Bench run: 2025-11-18T17:12:20.224Z_

## Hot path micro-operations

| Operation                                          | Mean time (µs) | Throughput (M ops/s) |
|----------------------------------------------------|---------------:|---------------------:|
| Seqlock publish uncontended                        |          0.087 |                11.44 |
| controller.params.stage (eqBands f32[8])           |          0.134 |                 7.47 |
| meter scalar: writer.set('level', 0.75)            |          0.137 |                 7.27 |
| meter scalar: writer.level(0.75)                   |          0.147 |                 6.80 |
| Seqlock tryRead uncontended                        |          0.163 |                 6.13 |
| controller.params.update (3 scalars)               |          0.240 |                 4.16 |
| controller.params.set (two scalars)                |          0.257 |                 3.89 |
| controller.params.hydrate (3 scalars + f32[8])     |          0.337 |                 2.97 |
| controller.params.update (3 scalars + f32[8])      |          0.356 |                 2.81 |
| processor.params.within (scalars only)             |          0.447 |                 2.23 |
| processor.params.within (scalars + eqBands f32[8]) |          0.489 |                 2.05 |
| meter array: writer.stage('spectrum', cb)          |          0.712 |                 1.41 |
| interleaved controller.update + processor.within   |          0.762 |                 1.31 |

## E2E setup: `spec → plan → backing → handoff → bindings`

| Spec size   | Mean setup time (ms) | Setups per second |
|-------------|---------------------:|------------------:|
| Small spec  |                0.023 |             42593 |
| Medium spec |                0.043 |             23256 |
| Large spec  |                0.063 |             15808 |

_Note:_ numbers are from a single Node 20 + Vitest bench run and are meant for relative comparison, not absolute tuning.
