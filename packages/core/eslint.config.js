import regex from 'eslint-plugin-regex';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(HERE));

const IGNORES = [
  '**/dist/**',
  '**/build/**',
  '**/.coverage/**',
  '**/coverage/**',
  '**/.vite/**',
  '**/.output/**',
  '**/generated/**',
  '**/node_modules/**',
  '**/*.d.ts',
];

const SRC = ['src/**/*.{ts,tsx}'];
const TESTS = ['tests/**/*.{ts,tsx}', '**/*.test.ts', '**/*.spec.ts'];
const EXAMPLES = ['examples/**/*.{ts,tsx}'];
const BENCH = ['bench/**/*.{ts,tsx}'];
const SCRIPTS = ['scripts/**/*.{ts,tsx}'];

const ALL_TS = [...SRC, ...TESTS, ...EXAMPLES, ...BENCH, ...SCRIPTS];

/** Layers (co-location + import direction) */
const LAYERS = {
  primitives: 'src/primitives',
  errors: 'src/errors',
  types: 'src/types',
  spec: 'src/spec',
  plan: 'src/plan',
  backing: 'src/backing',
  handoff: 'src/handoff',
  binding: 'src/binding',
};

export default defineConfig(
  // Global ignores
  { ignores: IGNORES },

  // TS-ESLint presets (typed) scoped to TS files
  ...tseslint.configs.strictTypeChecked.map((c) => ({ ...c, files: ALL_TS })),
  ...tseslint.configs.stylisticTypeChecked.map((c) => ({ ...c, files: ALL_TS })),

  // eslint-plugin-import presets
  ...[importPlugin.flatConfigs.recommended, importPlugin.flatConfigs.typescript].map(
    (c) => ({ ...c, files: ALL_TS }),
  ),

  // Project settings + base rules
  {
    files: ALL_TS,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: HERE,
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    settings: {
      'import/resolver': {
        typescript: { project: ['./tsconfig.json'], alwaysTryTypes: true },
        node: { extensions: ['.ts', '.tsx', '.js', '.jsx'] },
      },
      'import/ignore': ['\\?url$', '^virtual:', '^vite(-client)?$'],
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // Hygiene
      curly: ['error', 'all'],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-console': 'warn',

      // TypeScript
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          minimumDescriptionLength: 3,
        },
      ],

      // Imports
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'object',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
      'import/newline-after-import': 'error',
      'import/extensions': [
        'error',
        'never',
        { ts: 'never', tsx: 'never', js: 'never', jsx: 'never' },
      ],
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: true,
          optionalDependencies: false,
          peerDependencies: true,
          packageDir: [HERE, REPO_ROOT],
        },
      ],
      'import/no-cycle': ['error', { maxDepth: 2 }],

      /**
       * Directional flow lock (production code only; tests/examples override below)
       * Each zone reads as: modules in `target` MUST NOT import from `from`.
       */
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            // errors: foundational LEAF — must not depend on other layers
            {
              target: LAYERS.errors,
              from: LAYERS.primitives,
              message: 'errors must not import primitives',
            },
            {
              target: LAYERS.errors,
              from: LAYERS.types,
              message: 'errors must not import types',
            },
            {
              target: LAYERS.errors,
              from: LAYERS.spec,
              message: 'errors must not import spec',
            },
            {
              target: LAYERS.errors,
              from: LAYERS.plan,
              message: 'errors must not import plan',
            },
            {
              target: LAYERS.errors,
              from: LAYERS.backing,
              message: 'errors must not import backing',
            },
            {
              target: LAYERS.errors,
              from: LAYERS.handoff,
              message: 'errors must not import handoff',
            },
            {
              target: LAYERS.errors,
              from: LAYERS.binding,
              message: 'errors must not import binding',
            },

            // primitives: bottom
            {
              target: LAYERS.primitives,
              from: LAYERS.types,
              message: 'primitives must not import types',
            },
            {
              target: LAYERS.primitives,
              from: LAYERS.spec,
              message: 'primitives must not import spec',
            },
            {
              target: LAYERS.primitives,
              from: LAYERS.plan,
              message: 'primitives must not import plan',
            },
            {
              target: LAYERS.primitives,
              from: LAYERS.backing,
              message: 'primitives must not import backing',
            },
            {
              target: LAYERS.primitives,
              from: LAYERS.handoff,
              message: 'primitives must not import handoff',
            },
            {
              target: LAYERS.primitives,
              from: LAYERS.binding,
              message: 'primitives must not import binding',
            },

            {
              target: LAYERS.types,
              from: LAYERS.spec,
              message: 'types must not import spec',
            },
            {
              target: LAYERS.types,
              from: LAYERS.plan,
              message: 'types must not import plan',
            },
            {
              target: LAYERS.types,
              from: LAYERS.backing,
              message: 'types must not import backing',
            },
            {
              target: LAYERS.types,
              from: LAYERS.handoff,
              message: 'types must not import handoff',
            },
            {
              target: LAYERS.types,
              from: LAYERS.binding,
              message: 'types must not import binding',
            },
            {
              target: LAYERS.types,
              from: LAYERS.errors,
              message: 'types must not import errors',
            },
            {
              target: LAYERS.types,
              from: LAYERS.primitives,
              message: 'types must not import primitives',
            },

            // spec: must not depend upward
            {
              target: LAYERS.spec,
              from: LAYERS.plan,
              message: 'spec must not import plan',
            },
            {
              target: LAYERS.spec,
              from: LAYERS.backing,
              message: 'spec must not import backing',
            },
            {
              target: LAYERS.spec,
              from: LAYERS.handoff,
              message: 'spec must not import handoff',
            },
            {
              target: LAYERS.spec,
              from: LAYERS.binding,
              message: 'spec must not import binding',
            },
            // plan: above spec, below backing
            {
              target: LAYERS.plan,
              from: LAYERS.backing,
              message: 'plan must not import backing',
            },
            {
              target: LAYERS.plan,
              from: LAYERS.handoff,
              message: 'plan must not import handoff',
            },
            {
              target: LAYERS.plan,
              from: LAYERS.binding,
              message: 'plan must not import binding',
            },

            // backing: below handoff/binding
            {
              target: LAYERS.backing,
              from: LAYERS.handoff,
              message: 'backing must not import handoff',
            },
            {
              target: LAYERS.backing,
              from: LAYERS.binding,
              message: 'backing must not import binding',
            },

            {
              target: LAYERS.handoff,
              from: LAYERS.binding,
              message: 'handoff must not import binding',
            },

            // binding: top — allowed to import downwards (no zones here)

            /**
             * Ban "central types hop": anywhere under src/**, do not import
             * domain-owned type files from src/types/*.ts — import from that domain’s own types.ts.
             */
            {
              target: 'src',
              from: 'src/types/backing.ts',
              message: 'Import from src/backing/types.ts',
            },
            {
              target: 'src',
              from: 'src/types/binding.ts',
              message: 'Import from src/binding/types.ts',
            },
            {
              target: 'src',
              from: 'src/types/spec.ts',
              message: 'Import from src/spec/types.ts',
            },
            {
              target: 'src',
              from: 'src/types/plan.ts',
              message: 'Import from src/plan/types.ts',
            },
            {
              target: 'src',
              from: 'src/types/handoff.ts',
              message: 'Import from src/handoff/types.ts',
            },
            {
              target: 'src',
              from: 'src/types/errors.ts',
              message: 'Import from src/errors/types.ts',
            },
          ],
        },
      ],
    },
  },

  // Tests & examples: allow crossing boundaries and enable vitest globals
  {
    files: [...TESTS, ...EXAMPLES],
    languageOptions: { globals: { ...globals.vitest } },
    rules: {
      'import/no-restricted-paths': 'off',
    },
  },

  // Regex bans (global)
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: { regex: { rules: regex.rules } },
    rules: {
      'regex/invalid': [
        'error',
        [
          // 1) No blanket type barrels inside a domain
          {
            id: 'no-blanket-type-barrels',
            message: 'Do not blanket re-export types; import from the owning domain.',
            regex: String.raw`^\s*export\s+type\s+\*\s+from\s+['"]\./types['"];`,
            regexOptions: 'm',
          },
          // 2) No fence-style section headers (house style)
          {
            id: 'no-fence-singleline',
            message: 'Avoid fence-style section headers; prefer concise JSDoc.',
            regex: String.raw`^\s*//\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}.*$`,
            regexOptions: 'u',
          },
          {
            id: 'no-fence-block-start',
            message: 'Avoid banner block comment starts.',
            regex: String.raw`^\s*/\*+\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}.*$`,
            regexOptions: 'u',
          },
          {
            id: 'no-fence-block-line',
            message: 'Avoid banner lines inside block comments.',
            regex: String.raw`^\s*\*\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}\s*(?:\*/)?\s*$`,
            regexOptions: 'u',
          },
          {
            id: 'no-fence-one-line-block',
            message: 'Avoid one-line banner comments.',
            regex: String.raw`^\s*/\*+\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}\s*\*+/\s*$`,
            regexOptions: 'u',
          },
        ],
      ],
    },
  },

  // .d.ts: no project for perf; relax unused-vars
  {
    files: ['**/*.d.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: null },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
