/**
 * @file ESLint configuration for @seqlok/core.
 * @author Maikel Eckelboom
 * @license MIT
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createPackageEslintConfig } from "../../scripts/eslint/eslint.base.config.js";

/**
 * Directory of the @seqlok/core package.
 * @type {string}
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Defines the architectural layers of the application for import restrictions.
 * These paths are relative to the package root (@seqlok/core).
 */
const layers = {
  primitives: "src/primitives",
  errors: "src/errors",
  types: "src/types",
  spec: "src/spec",
  plan: "src/plan",
  backing: "src/backing",
  handoff: "src/handoff",
  binding: "src/binding",
  introspect: "src/introspect",
  context: "src/context",
  internal: "src/internal",
};

/**
 * @typedef {object} LayerRestriction
 * @property {string} target - The layer where the restriction is applied.
 * @property {string} from - The layer that is not allowed to be imported.
 * @property {string} message - The error message for the restriction.
 */

/**
 * Builds an array of layer-based import restrictions.
 * This function enforces architectural boundaries by preventing illegal imports between layers.
 * @returns {LayerRestriction[]} An array of restriction objects for the 'import/no-restricted-paths' rule.
 */
function buildLayerRestrictions() {
  /** @type {LayerRestriction[]} */
  const restrictions = [];

  /**
   * Adds a new restriction to the list.
   * @param {string} target - The target layer.
   * @param {string} from - The source layer that is forbidden.
   * @param {string} message - The message to display on violation.
   */
  const addRestriction = (target, from, message) => {
    restrictions.push({ target, from, message });
  };

  // errors: base leaf — cannot import any other layer
  const layersAboveErrors = [
    "primitives",
    "types",
    "spec",
    "plan",
    "backing",
    "handoff",
    "binding",
    "context",
  ];
  for (const layer of layersAboveErrors) {
    addRestriction(
      layers.errors,
      layers[layer],
      `errors must not import ${layer}`,
    );
  }

  // primitives: bottom layer — cannot import domain layers
  const layersAbovePrimitives = [
    "types",
    "spec",
    "plan",
    "backing",
    "handoff",
    "binding",
    "context",
  ];
  for (const layer of layersAbovePrimitives) {
    addRestriction(
      layers.primitives,
      layers[layer],
      `primitives must not import ${layer}`,
    );
  }

  // types: cannot import any domain layer or primitives/errors
  const layersAboveTypes = [
    "spec",
    "plan",
    "backing",
    "handoff",
    "binding",
    "errors",
    "primitives",
    "context",
  ];
  for (const layer of layersAboveTypes) {
    addRestriction(
      layers.types,
      layers[layer],
      `types must not import ${layer}`,
    );
  }

  // spec: cannot import layers above it
  for (const layer of ["plan", "backing", "handoff", "binding", "context"]) {
    addRestriction(layers.spec, layers[layer], `spec must not import ${layer}`);
  }

  // plan: above spec, below backing
  for (const layer of ["backing", "handoff", "binding", "context"]) {
    addRestriction(layers.plan, layers[layer], `plan must not import ${layer}`);
  }

  // backing: below handoff/binding/context
  for (const layer of ["handoff", "binding", "context"]) {
    addRestriction(
      layers.backing,
      layers[layer],
      `backing must not import ${layer}`,
    );
  }

  // handoff: cannot import binding
  addRestriction(
    layers.handoff,
    layers.binding,
    "handoff must not import binding",
  );

  // context: host ergonomics over spec/plan/backing; cannot import higher layers
  for (const layer of ["handoff", "binding", "introspect"]) {
    addRestriction(
      layers.context,
      layers[layer],
      `context must not import ${layer}`,
    );
  }

  // Prevent imports from central type files (use domain-owned types instead)
  const centralTypeFiles = [
    {
      file: "src/types/backing.ts",
      domain: "src/backing/types.ts",
    },
    {
      file: "src/types/binding.ts",
      domain: "src/binding/types.ts",
    },
    {
      file: "src/types/spec.ts",
      domain: "src/spec/types.ts",
    },
    {
      file: "src/types/plan.ts",
      domain: "src/plan/types.ts",
    },
    {
      file: "src/types/handoff.ts",
      domain: "src/handoff/types.ts",
    },
    {
      file: "src/types/errors.ts",
      domain: "src/errors/types.ts",
    },
  ];

  for (const { file, domain } of centralTypeFiles) {
    addRestriction("src", file, `Import from ${domain}`);
  }

  // introspect: outermost leaf — production core layers cannot import it.
  const productionLayers = [
    "primitives",
    "errors",
    "types",
    "spec",
    "plan",
    "backing",
    "handoff",
    "binding",
    "context",
    "internal",
  ];
  for (const layer of productionLayers) {
    addRestriction(
      layers[layer],
      layers.introspect,
      `${layer} must not import introspect`,
    );
  }

  return restrictions;
}

/**
 * Flat ESLint configuration for @seqlok/core.
 *
 * @type {import("typescript-eslint").ConfigArray}
 */
export default createPackageEslintConfig({
  name: "seqlok/core",
  tsconfigRootDir: HERE,
  tsconfigProjects: ["./tsconfig.eslint.json"],
  src: ["src/**/*.{ts,tsx}"],
  tests: ["tests/**/*.{ts,tsx}", "**/*.test.ts", "**/*.spec.ts"],
  bench: ["bench/**/*.{ts,tsx}"],
  scripts: ["scripts/**/*.{ts,tsx}"],
  config: ["*.config.ts", "vite.config.ts", "rollup.*.config.{js,ts,mts}"],
  packageDirs: [HERE],
  // Inject the architectural boundaries
  extraBaseRules: {
    "import/no-restricted-paths": [
      "error",
      { zones: buildLayerRestrictions() },
    ],
  },
});
