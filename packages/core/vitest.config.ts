import { defineConfig } from 'vitest/config';

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
