import { createLibraryViteConfig } from "../../scripts/vite/vite.base.config";

import type { UserConfig } from "vite";

const base = createLibraryViteConfig({
  entryRelative: "src/index.ts",
  external: [],
});

if (base.build === undefined) {
  throw new Error("[@seqlok/worklet-mount] Missing Vite build config.");
}

const config: UserConfig = {
  ...base,
  build: {
    ...base.build,
    lib: {
      entry: {
        index: "src/index.ts",
        worklet: "src/worklet/index.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
  },
};

export default config;
