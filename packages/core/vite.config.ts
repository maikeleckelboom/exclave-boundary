/**
 * @file Vite build configuration for @seqlok/core.
 *
 * - Mode-dependent `__SEQLOK_DEV_ASSERTS__` (true in dev, false in prod)
 * - Workspace deps as externals (not bundled into dist)
 */

import { createLibraryViteConfig } from "../../scripts/vite/vite.base.config";

export default createLibraryViteConfig({
  entryRelative: "src/index.ts",
  external: ["@seqlok/base", "@seqlok/primitives"],
});
