// File: packages/worklet-mount/eslint.config.js

/**
 * @file ESLint configuration for @seqlok/worklet-mount.
 * @license MIT
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createPackageEslintConfig } from "../../scripts/eslint/eslint.base.config.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {object} PathConfig
 * @property {string[]} ignores
 * @property {string[]} src
 * @property {string[]} tests
 * @property {string[]} bench
 * @property {string[]} scripts
 * @property {string[]} config
 */

/** @type {PathConfig} */
const paths = {
  ignores: [
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.output/**",
    "**/generated/**",
    "**/node_modules/**",
    "**/*.d.ts",
    "**/docs/**",
  ],
  src: ["src/**/*.{ts,tsx}"],
  tests: ["tests/**/*.{ts,tsx}", "**/*.test.ts", "**/*.spec.ts"],
  bench: ["bench/**/*.{ts,tsx}"],
  scripts: ["scripts/**/*.{ts,tsx}"],
  config: ["*.config.ts", "vite.config.ts"],
};

export default createPackageEslintConfig({
  name: "seqlok/worklet-mount",
  tsconfigRootDir: HERE,
  tsconfigProjects: ["./tsconfig.eslint.json"],
  src: paths.src,
  tests: paths.tests,
  bench: paths.bench,
  scripts: paths.scripts,
  config: paths.config,
  extraIgnores: paths.ignores,
  packageDirs: [HERE],
});
