import { defineConfig } from 'vitest/config';
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

export default defineConfig({
  test: {
    globals: true,
    reporters: ['default', 'verbose'],
    coverage: {
      provider: 'v8',
      enabled: false,
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 70,
        lines: 75,
      },
      exclude: [
        'dist/**',
        'tests/**',
        'src/**/index.ts',
        'src/types/**',
        'src/public/**',
        'src/errors/codes/**',
      ],
    },

    environment: 'node',

    // Let Vitest use its default pool (threads) or even `vm`,
    // but don't ask it to fork separate processes.
    // pool: 'forks',  <-- drop this

    fileParallelism: false, // run files serially
    isolate: false, // reuse the same VM / modules

    testTimeout: 60_000,
    hookTimeout: 30_000,

    benchmark: {
      include: ['bench/**/*.bench.ts'],
      exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
      reporters: ['verbose'],
      outputJson: 'bench-results.json', // compare: 'bench-results-main.json',
    },
  },
});
