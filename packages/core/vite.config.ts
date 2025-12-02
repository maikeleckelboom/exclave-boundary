/**
 * @file Vite build configuration for @seqlok/core.
 *
 * - Mode-dependent `__SEQLOK_DEV_ASSERTS__` (true in dev, false in prod)
 * - Workspace deps as externals (not bundled into dist)
 */

import { defineConfig } from "vite";

import { createLibraryViteConfig } from "../../scripts/vite/vite.base.config";

import type { UserConfig } from "vite";

export default defineConfig(({ mode }): UserConfig => {
  const base = createLibraryViteConfig({
    entryRelative: "src/index.ts",
    external: ["@seqlok/base", "@seqlok/primitives"],
  });

  return {
    ...base,
    define: {
      ...base.define,
      __SEQLOK_DEV_ASSERTS__: mode === "development" ? "true" : "false",
    },
  };
});
