import type { BenchOptions } from "vitest";

/**
 * For ultra-fast micro operations where we want low RME.
 */
export const MICRO_BENCH_OPTS: BenchOptions = {
  time: 1_000,
  warmupTime: 500,
  warmupIterations: 128,
  iterations: 512,
  throws: true,
};

/**
 * For heavier E2E-ish things (plan+allocate+bind, real-world patterns).
 */
export const E2E_BENCH_OPTS: BenchOptions = {
  time: 1_500,
  warmupTime: 750,
  warmupIterations: 64,
  iterations: 128,
  throws: true,
};
