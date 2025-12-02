import { defineConfig } from "vitest/config";

import { createSharedTestConfig } from "../../scripts/vitest/shared-config";

export default defineConfig({
  test: createSharedTestConfig(),
});
