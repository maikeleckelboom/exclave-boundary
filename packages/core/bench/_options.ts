// bench/_options.ts (or just inline at top of each bench file)
import type { BenchOptions } from 'vitest';

/**
 * For ultra-fast micro operations where we want low RME.
 */
export const MICRO_BENCH_OPTS: BenchOptions = {
  time: 1_000, // run ~1s per task
  warmupTime: 500, // give V8 plenty of time to optimize
  warmupIterations: 128,
  iterations: 512, // at least this many iterations
  throws: true, // fail on errors, don't silently skip
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
