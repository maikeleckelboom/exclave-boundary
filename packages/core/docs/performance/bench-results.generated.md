<!-- GENERATED FILE: do not edit by hand.
     Regenerate via: pnpm bench:report -->

# Bench Results

> Generated from `bench-results.json` by `scripts/format-bench.ts`. Re-run `pnpm bench:report` after changing benchmarks.

_Bench run: 2025-11-18T07:23:14.648Z_

## Hot path micro-operations

| Operation | Mean time (µs) | Throughput (M ops/s) |
| --- | ---: | ---: |
| Seqlock publish uncontended | 0.087 | 11.55 |
| meter scalar: writer.level(0.75) | 0.126 | 7.95 |
| controller.params.stage (eqBands f32[8]) | 0.132 | 7.55 |
| meter scalar: writer.set('level', 0.75) | 0.133 | 7.54 |
| Seqlock tryRead uncontended | 0.141 | 7.11 |
| controller.params.set (two scalars) | 0.196 | 5.11 |
| controller.params.update (3 scalars) | 0.215 | 4.65 |
| controller.params.update (3 scalars + f32[8]) | 0.355 | 2.82 |
| processor.params.within (scalars only) | 0.438 | 2.28 |
| processor.params.within (scalars + eqBands f32[8]) | 0.448 | 2.23 |
| meter array: writer.stage('spectrum', cb) | 0.660 | 1.51 |
| interleaved controller.update + processor.within | 0.673 | 1.49 |

## E2E setup: `spec → plan → backing → handoff → bindings`

| Spec size | Mean setup time (ms) | Setups per second |
| --- | ---: | ---: |
| Small spec | 0.021 | 47387 |
| Medium spec | 0.046 | 21909 |
| Large spec | 0.057 | 17413 |

_Note:_ numbers are from a single Node 20 + Vitest bench run and are meant for relative comparison, not absolute tuning.
