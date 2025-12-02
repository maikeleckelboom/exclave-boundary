/**
 * @file ESLint configuration for @seqlok/base.
 * @license MIT
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createPackageEslintConfig } from "../../scripts/eslint/eslint.base.config.js";

/**
 * Directory of the @seqlok/base package.
 * @type {string}
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Flat ESLint configuration for @seqlok/base.
 *
 * @type {import("typescript-eslint").ConfigArray}
 */
export default createPackageEslintConfig({
  name: "seqlok/base",
  tsconfigRootDir: HERE,
  tsconfigProjects: ["./tsconfig.eslint.json"],
  src: ["src/**/*.{ts,tsx}"],
  tests: ["tests/**/*.{ts,tsx}", "**/*.test.ts", "**/*.spec.ts"],
  bench: ["bench/**/*.{ts,tsx}"],
  scripts: ["scripts/**/*.{ts,tsx}"],
  config: ["*.config.ts", "vite.config.ts", "rollup.*.config.{js,ts,mts}"],
  packageDirs: [HERE],
});
