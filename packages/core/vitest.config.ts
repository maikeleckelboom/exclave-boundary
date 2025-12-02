import { defineConfig } from "vitest/config";

import { createSeqlokWorkspaceAliases } from "../../scripts/vite/workspace-aliases";
import { createSharedTestConfig } from "../../scripts/vitest/shared-config";

export default defineConfig({
  resolve: {
    alias: createSeqlokWorkspaceAliases(),
  },
  test: createSharedTestConfig({
    testTimeout: 60_000,
    hookTimeout: 30_000,
    coverageThresholds: {
      statements: 75,
      branches: 70,
      functions: 70,
      lines: 75,
    },
    coverageExclude: ["src/**/index.ts", "src/types/**", "src/context/**"],
  }),
});
