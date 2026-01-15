import { defineConfig } from "vitest/config";

import { createSeqlokWorkspaceAliases } from "../../scripts/vite/workspace-aliases";
import { createSharedTestConfig } from "../../scripts/vitest/shared-config";

export default defineConfig({
  resolve: { alias: createSeqlokWorkspaceAliases() },
  test: createSharedTestConfig(),
});
