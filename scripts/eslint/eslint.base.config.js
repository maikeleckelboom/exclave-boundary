/**
 * @file Shared ESLint configuration utilities for the Seqlok monorepo.
 * @license MIT
 */

import importPlugin from "eslint-plugin-import";
import regex from "eslint-plugin-regex";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Default ignore patterns shared by all packages.
 *
 * @type {string[]}
 */
const DEFAULT_IGNORES = [
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.output/**",
  "**/generated/**",
  "**/node_modules/**",
  "**/*.d.ts",
  "**/docs/**",
];

/**
 * Base ESLint rules for code hygiene, TypeScript, and import organization.
 *
 * Package-specific configs may extend or override these rules.
 *
 * @type {import("eslint").Linter.RulesRecord}
 */
export const BASE_RULES = {
  // Code hygiene
  curly: ["error", "all"],
  eqeqeq: ["error", "smart"],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  "no-console": "warn",

  // TypeScript
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { fixStyle: "inline-type-imports" },
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      ignoreRestSiblings: true,
    },
  ],
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/no-unsafe-function-type": "error",
  "@typescript-eslint/ban-ts-comment": [
    "error",
    {
      "ts-expect-error": "allow-with-description",
      "ts-ignore": true,
      "ts-nocheck": true,
      "ts-check": false,
      minimumDescriptionLength: 3,
    },
  ],

  // Import ordering and organization
  "import/order": [
    "error",
    {
      groups: [
        "builtin",
        "external",
        "internal",
        ["parent", "sibling", "index"],
        "object",
        "type",
      ],
      "newlines-between": "always",
      alphabetize: { order: "asc", caseInsensitive: true },
    },
  ],
  "import/no-duplicates": "error",
  "import/newline-after-import": "error",
  "import/extensions": [
    "error",
    "never",
    {
      ts: "never",
      tsx: "never",
      js: "never",
      jsx: "never",
      json: "always",
    },
  ],
  "import/no-cycle": ["error", { maxDepth: 2 }],
};

/**
 * Rules for banning specific string patterns in the codebase using regex.
 *
 * @type {import("eslint").Linter.RulesRecord}
 */
export const REGEX_RULES = {
  "regex/invalid": [
    "error",
    [
      {
        id: "no-blanket-type-barrels",
        message:
          "Do not blanket re-export types; import from the owning domain.",
        regex: String.raw`^\s*export\s+type\s+\*\s+from\s+['"]\./types['"];`,
        regexOptions: "m",
      },
      {
        id: "no-fence-singleline",
        message: "Avoid fence-style section headers; prefer concise JSDoc.",
        regex: String.raw`^\s*//\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}.*$`,
        regexOptions: "u",
      },
      {
        id: "no-fence-block-start",
        message: "Avoid banner block comment starts.",
        regex: String.raw`^\s*/\*+\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}.*$`,
        regexOptions: "u",
      },
      {
        id: "no-fence-block-line",
        message: "Avoid banner lines inside block comments.",
        regex: String.raw`^\s*\*\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}\s*(?:\*/)?\s*$`,
        regexOptions: "u",
      },
      {
        id: "no-fence-one-line-block",
        message: "Avoid one-line banner comments.",
        regex: String.raw`^\s*/\*+\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}\s*\*+/\s*$`,
        regexOptions: "u",
      },
    ],
  ],
};

/**
 * @typedef {object} CreatePackageEslintConfigOptions
 * @property {string} name - Human-readable package name for config segments.
 * @property {string} tsconfigRootDir - Directory used as tsconfig root.
 * @property {string[]} [tsconfigProjects] - Paths to tsconfig files for typed linting.
 * @property {string[]} src - Glob patterns for source files.
 * @property {string[]} tests - Glob patterns for test files.
 * @property {string[]} [bench] - Glob patterns for benchmark files.
 * @property {string[]} [scripts] - Glob patterns for script files.
 * @property {string[]} [config] - Glob patterns for config files.
 * @property {string[]} [extraIgnores] - Extra ignore patterns merged with defaults.
 * @property {string[]} [packageDirs] - Package directories for import/no-extraneous-dependencies.
 * @property {import("eslint").Linter.RulesRecord} [extraBaseRules] - Extra base rules.
 * @property {import("eslint").Linter.RulesRecord} [extraTestRules] - Extra rules applied only to tests.
 */

/**
 * Creates a flat ESLint configuration for a given package in the monorepo.
 * Uses TypeScript project configs (tsconfig.eslint.json) for typed linting.
 *
 * @param {CreatePackageEslintConfigOptions} options - Package-specific configuration options.
 * @returns {import("typescript-eslint").ConfigArray} Flat config array for ESLint.
 */
export function createPackageEslintConfig(options) {
  const {
    name,
    tsconfigRootDir,
    tsconfigProjects = ["./tsconfig.eslint.json"],
    src,
    tests,
    bench = [],
    scripts = [],
    config = [],
    extraIgnores = [],
    packageDirs,
    extraBaseRules,
    extraTestRules,
  } = options;

  /** @type {string[]} */
  const ignores = [...DEFAULT_IGNORES, ...extraIgnores];

  /** @type {string[]} */
  const allTs = [...src, ...tests, ...bench, ...scripts, ...config];

  /** @type {string[]} */
  const effectivePackageDirs =
    packageDirs && packageDirs.length > 0 ? packageDirs : [tsconfigRootDir];

  // Fold in the rule sets from the strict + stylistic preset configs as rules-only.
  /** @type {import("eslint").Linter.RulesRecord} */
  const strictTypeCheckedRules = Object.assign(
    {},
    ...tseslint.configs.strictTypeChecked.map((cfg) => cfg.rules),
  );

  /** @type {import("eslint").Linter.RulesRecord} */
  const stylisticTypeCheckedRules = Object.assign(
    {},
    ...tseslint.configs.stylisticTypeChecked.map((cfg) => cfg.rules ?? {}),
  );

  /** @type {import("eslint").Linter.RulesRecord} */
  const mergedBaseRules = {
    // TypeScript strict + stylistic presets
    ...strictTypeCheckedRules,
    ...stylisticTypeCheckedRules,

    // Local base rules
    ...BASE_RULES,

    // Monorepo specific overrides
    "import/no-extraneous-dependencies": [
      "error",
      {
        devDependencies: true,
        optionalDependencies: false,
        peerDependencies: true,
        packageDir: effectivePackageDirs,
      },
    ],

    // User overrides
    ...(extraBaseRules ?? {}),
  };

  return tseslint.config(
    // Global ignores for the package
    { ignores },

    // Core parser + plugin setup with project-based typed linting
    {
      name: `${name}:setup`,
      files: allTs,
      plugins: {
        "@typescript-eslint": tseslint.plugin,
        import: importPlugin,
      },
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
          project: tsconfigProjects,
          tsconfigRootDir,
        },
        globals: {
          ...globals.node,
        },
      },
      settings: {
        "import/resolver": {
          typescript: {
            project: tsconfigProjects,
            alwaysTryTypes: true,
          },
          node: {
            extensions: [".ts", ".tsx", ".js", ".jsx"],
          },
        },
      },
    },

    // Base rules (includes TS strict + stylistic + import rules)
    {
      name: `${name}:base-rules`,
      files: allTs,
      linterOptions: {
        reportUnusedDisableDirectives: "error",
      },
      rules: mergedBaseRules,
    },

    // Regex-based bans (separate config with its own plugin registration)
    {
      name: `${name}:regex-bans`,
      files: ["**/*.{ts,tsx,js,jsx}"],
      plugins: {
        regex,
      },
      rules: REGEX_RULES,
    },

    // Test environment overrides
    {
      name: `${name}:tests`,
      files: tests,
      languageOptions: {
        globals: { ...globals.vitest },
      },
      rules: {
        ...(extraTestRules ?? {}),
      },
    },

    // Declarations – relax strict TS rules
    {
      name: `${name}:dts`,
      files: ["**/*.d.ts"],
      rules: {
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/consistent-type-imports": "off",
      },
    },

    // Benchmarks & scripts – allow console usage
    {
      name: `${name}:benches-and-scripts`,
      files: [...bench, ...scripts],
      rules: {
        "no-console": "off",
      },
    },
  );
}
