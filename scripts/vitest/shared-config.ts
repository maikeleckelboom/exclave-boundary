import type { TestUserConfig } from "vitest/config";

export interface SharedTestConfigOptions {
  readonly testTimeout?: number;
  readonly hookTimeout?: number;
  readonly coverageThresholds?: {
    readonly statements: number;
    readonly branches: number;
    readonly functions: number;
    readonly lines: number;
  };
  readonly coverageExclude?: readonly string[];
  readonly environment?: TestUserConfig["environment"];
}

type TestReporters = NonNullable<TestUserConfig["reporters"]>;
type BenchmarkConfig = NonNullable<TestUserConfig["benchmark"]>;
type BenchmarkReporters = NonNullable<BenchmarkConfig["reporters"]>;

export function createSharedTestConfig(
  options: SharedTestConfigOptions = {},
): TestUserConfig {
  const {
    testTimeout = 30_000,
    hookTimeout = 15_000,
    coverageThresholds,
    coverageExclude = [],
    environment = "node",
  } = options;

  const testReporters: TestReporters = ["default"];
  const benchmarkReporters: BenchmarkReporters = ["verbose"];

  const coverageExcludeGlobs = [
    "dist/**",
    "tests/**",
    "bench/**",
    ...coverageExclude,
  ];

  return {
    globals: true,
    reporters: testReporters,
    environment,
    fileParallelism: false,
    isolate: false,

    testTimeout,
    hookTimeout,

    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    exclude: ["dist/**", "node_modules/**", "bench/**", "docs/**"],

    coverage: {
      provider: "v8",
      enabled: false,
      reporter: ["text", "html", "lcov"],
      ...(coverageThresholds && { thresholds: coverageThresholds }),
      exclude: coverageExcludeGlobs,
    },

    benchmark: {
      include: ["bench/**/*.bench.ts"],
      exclude: [
        "node_modules/**",
        "dist/**",
        ".idea/**",
        ".git/**",
        ".cache/**",
      ],
      reporters: benchmarkReporters,
      outputJson: "bench-results.json",
    },
  };
}
