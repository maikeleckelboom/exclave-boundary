/**
 * @file Shared Vite library config for Seqlok packages.
 * @license MIT
 */

import type { UserConfig } from "vite";

import { createSeqlokWorkspaceAliases } from "./workspace-aliases";

export interface ViteLibConfigOptions {
  /** Entry file relative to package root */
  readonly entryRelative: string;

  /**
   * Workspace packages to treat as external (not bundled).
   * Use package names like "@seqlok/base", "@seqlok/primitives".
   * @default [] (all deps inlined via aliases)
   */
  readonly external?: readonly string[];
}

/**
 * Shared Vite library config for Seqlok packages.
 *
 * - Uses workspace aliases resolved via the workspace sentinel
 * - Emits a single ES module bundle to `dist/index.js`
 * - Optionally marks workspace deps as external
 */
export function createLibraryViteConfig(
  options: ViteLibConfigOptions,
): UserConfig {
  const { entryRelative, external = [] } = options;

  const aliases = createSeqlokWorkspaceAliases();

  return {
    resolve: {
      alias: aliases,
    },
    define: {
      __SEQLOK_DEV_ASSERTS__: true,
    },
    build: {
      lib: {
        entry: {
          index: entryRelative,
        },
        formats: ["es"],
        fileName: (_format, entry) => `${entry}.js`,
      },
      minify: "esbuild",
      sourcemap: true,
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          preserveModules: false,
        },
        ...(external.length > 0 && { external: [...external] }),
      },
    },
    esbuild: {
      minifyIdentifiers: true,
      minifySyntax: true,
      minifyWhitespace: true,
      legalComments: "none",
    },
  };
}
