import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";
import { createSharedTestConfig } from "../../scripts/vitest/shared-config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: createSharedTestConfig({ environment: "happy-dom" }),
  }),
);
