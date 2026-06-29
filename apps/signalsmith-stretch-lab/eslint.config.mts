import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import importPlugin from "eslint-plugin-import";
import globals from "globals";
import tseslint from "typescript-eslint";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(HERE));

const paths = {
  allTs: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.mts", "*.config.ts"],
  ignores: [
    ".cache/**",
    "coverage/**",
    "dist/**",
    "generated/**",
    "node_modules/**",
    "third_party/**",
    "vendor/**",
    "**/*.d.ts",
  ],
  tests: ["tests/**/*.ts"],
};

const baseRules = {
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { fixStyle: "inline-type-imports" },
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      ignoreRestSiblings: true,
      varsIgnorePattern: "^_",
    },
  ],
  curly: ["error", "all"],
  eqeqeq: ["error", "smart"],
  "import/extensions": [
    "error",
    "never",
    { js: "never", jsx: "never", ts: "never", tsx: "never" },
  ],
  "import/newline-after-import": "error",
  "import/no-duplicates": "error",
  "import/no-extraneous-dependencies": [
    "error",
    {
      devDependencies: true,
      packageDir: [HERE, REPO_ROOT],
      peerDependencies: true,
    },
  ],
  "import/no-unresolved": ["error", { ignore: ["^virtual:"] }],
  "import/order": [
    "error",
    {
      alphabetize: { caseInsensitive: true, order: "asc" },
      groups: [
        "builtin",
        "external",
        "internal",
        ["parent", "sibling", "index"],
        "object",
        "type",
      ],
      "newlines-between": "always",
    },
  ],
  "no-console": "warn",
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
};

export default tseslint.config(
  { ignores: paths.ignores },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: paths.allTs,
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: paths.allTs,
  })),
  ...[
    importPlugin.flatConfigs.recommended,
    importPlugin.flatConfigs.typescript,
  ].map((config) => ({
    ...config,
    files: paths.allTs,
  })),
  {
    files: paths.allTs,
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: HERE,
      },
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: baseRules,
    settings: {
      "import/ignore": [
        "\\?url$",
        "\\?worker&url$",
        "^virtual:",
        "^vite(-client)?$",
      ],
      "import/resolver": {
        node: {
          extensions: [".ts", ".tsx", ".js", ".jsx"],
        },
        typescript: {
          alwaysTryTypes: true,
          project: ["./tsconfig.json"],
        },
      },
    },
  },
  {
    files: paths.tests,
    languageOptions: {
      globals: globals.vitest,
    },
  },
);
