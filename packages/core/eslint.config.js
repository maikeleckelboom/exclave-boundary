import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import importPlugin from 'eslint-plugin-import';
import regex from 'eslint-plugin-regex';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(HERE));

const paths = {
  ignores: [
    '**/dist/**',
    '**/build/**',
    '**/.coverage/**',
    '**/coverage/**',
    '**/.vite/**',
    '**/.output/**',
    '**/generated/**',
    '**/node_modules/**',
    '**/*.d.ts',
  ],
  src: ['src/**/*.{ts,tsx}'],
  tests: ['tests/**/*.{ts,tsx}', '**/*.test.ts', '**/*.spec.ts'],
  examples: ['examples/**/*.{ts,tsx}'],
  bench: ['bench/**/*.{ts,tsx}'],
  scripts: ['scripts/**/*.{ts,tsx}'],
};

paths.allTs = [
  ...paths.src,
  ...paths.tests,
  ...paths.examples,
  ...paths.bench,
  ...paths.scripts,
];

const layers = {
  primitives: 'src/primitives',
  errors: 'src/errors',
  types: 'src/types',
  spec: 'src/spec',
  plan: 'src/plan',
  backing: 'src/backing',
  handoff: 'src/handoff',
  binding: 'src/binding',
  diagnostics: 'src/diagnostics',
};

function buildLayerRestrictions() {
  const restrictions:{
    target: string;
    from: string;
    message: string;
  }[] = [];

  const addRestriction = (target: string, from: string, message: string) => {
    restrictions.push({ target, from, message });
  };

  // errors: foundational leaf — cannot import any other layer
  const layersAboveErrors: (keyof typeof layers)[] = [
    'primitives',
    'types',
    'spec',
    'plan',
    'backing',
    'handoff',
    'binding',
  ];
  for (const layer of layersAboveErrors) {
    addRestriction(layers.errors, layers[layer], `errors must not import ${layer}`);
  }

  // primitives: bottom layer — cannot import domain layers
  const layersAbovePrimitives: (keyof typeof layers)[] = [
    'types',
    'spec',
    'plan',
    'backing',
    'handoff',
    'binding',
  ];
  for (const layer of layersAbovePrimitives) {
    addRestriction(
      layers.primitives,
      layers[layer],
      `primitives must not import ${layer}`,
    );
  }

  // types: cannot import any domain layer or primitives/errors
  const layersAboveTypes: (keyof typeof layers)[] = [
    'spec',
    'plan',
    'backing',
    'handoff',
    'binding',
    'errors',
    'primitives',
  ];
  for (const layer of layersAboveTypes) {
    addRestriction(layers.types, layers[layer], `types must not import ${layer}`);
  }

  // spec: cannot import layers above it
  for (const layer of ['plan', 'backing', 'handoff', 'binding'] as const) {
    addRestriction(layers.spec, layers[layer], `spec must not import ${layer}`);
  }

  // plan: above spec, below backing
  for (const layer of ['backing', 'handoff', 'binding'] as const) {
    addRestriction(layers.plan, layers[layer], `plan must not import ${layer}`);
  }

  // backing: below handoff/binding
  for (const layer of ['handoff', 'binding'] as const) {
    addRestriction(layers.backing, layers[layer], `backing must not import ${layer}`);
  }

  // handoff: cannot import binding
  addRestriction(layers.handoff, layers.binding, 'handoff must not import binding');

  // Prevent imports from central type files (use domain-owned types instead)
  const centralTypeFiles: { file: string; domain: string }[] = [
    { file: 'src/types/backing.ts', domain: 'src/backing/types.ts' },
    { file: 'src/types/binding.ts', domain: 'src/binding/types.ts' },
    { file: 'src/types/spec.ts', domain: 'src/spec/types.ts' },
    { file: 'src/types/plan.ts', domain: 'src/plan/types.ts' },
    { file: 'src/types/handoff.ts', domain: 'src/handoff/types.ts' },
    { file: 'src/types/errors.ts', domain: 'src/errors/types.ts' },
  ];

  for (const { file, domain } of centralTypeFiles) {
    addRestriction('src', file, `Import from ${domain}`);
  }

  // diagnostics: outermost leaf — production core layers cannot import it,
  // EXCEPT binding, which is allowed to bump counters on slow/error paths.
  const productionLayersExceptBinding: (keyof typeof layers)[] = [
    'primitives',
    'errors',
    'types',
    'spec',
    'plan',
    'backing',
    'handoff',
    // 'binding' intentionally excluded: binding is allowed to import diagnostics.
  ];
  for (const layer of productionLayersExceptBinding) {
    addRestriction(
      layers[layer],
      layers.diagnostics,
      `${layer} must not import diagnostics`,
    );
  }

  return restrictions;
}

const baseRules: Record<string, unknown> = {
  // Code hygiene
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
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
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

  // Import ordering and organization
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
  'import/no-restricted-paths': ['error', { zones: buildLayerRestrictions() }],
};

const regexRules: Record<string, unknown> = {
  'regex/invalid': [
    'error',
    [
      {
        id: 'no-blanket-type-barrels',
        message: 'Do not blanket re-export types; import from the owning domain.',
        regex: String.raw`^\s*export\s+type\s+\*\s+from\s+['"]\./types['"];`,
        regexOptions: 'm',
      },
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
};

export default tseslint.config(
  { ignores: paths.ignores },

  ...tseslint.configs.strictTypeChecked.map((c) => ({
    ...c,
    files: paths.allTs,
  })),

  ...tseslint.configs.stylisticTypeChecked.map((c) => ({
    ...c,
    files: paths.allTs,
  })),

  ...[importPlugin.flatConfigs.recommended, importPlugin.flatConfigs.typescript].map(
    (c) => ({ ...c, files: paths.allTs }),
  ),

  {
    name: 'seqlok/base',
    files: paths.allTs,
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
        typescript: {
          project: ['./tsconfig.json'],
          alwaysTryTypes: true,
        },
        node: {
          extensions: ['.ts', '.tsx', '.js', '.jsx'],
        },
      },
      'import/ignore': ['\\?url$', '^virtual:', '^vite(-client)?$'],
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: baseRules,
  },

  {
    name: 'seqlok/tests-and-examples',
    files: [...paths.tests, ...paths.examples],
    languageOptions: {
      globals: { ...globals.vitest },
    },
    rules: {
      'import/no-restricted-paths': 'off',
    },
  },

  {
    name: 'seqlok/regex-bans',
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      regex: { rules: regex.rules },
    },
    rules: regexRules,
  },

  {
    name: 'seqlok/type-declarations',
    files: ['**/*.d.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: null,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
