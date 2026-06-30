import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

const boundarySource = fileURLToPath(
  new URL("../../packages/core/src/index.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "@exclave/boundary": boundarySource,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
