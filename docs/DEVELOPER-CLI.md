# Seqlok Developer CLI Reference

> Quick reference for working with the Seqlok monorepo.  
> All commands assume you're at the repository root unless noted otherwise.

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development (type-checking + core tests in watch mode)
pnpm dev

# Run full verification before committing
pnpm verify
```

---

## Monorepo Structure

```
seqlok/
├── packages/
│   ├── base/          # Error algebra, invariants, shared protocol shapes
│   ├── primitives/    # Low-level seqlock, ring buffers, atomics
│   ├── introspect/    # Counters, health classification, error registry
│   ├── core/          # Spec → Plan → Backing → Handoff → Bindings
│   ├── commands/      # Typed command transport (SWSR ring)
│   ├── hotswap/       # Engine lifecycle and hot-swap protocol
│   ├── integration/   # Topology wiring across all packages
│   └── playground/    # Dev host / experimentation app
├── scripts/           # Shared build tooling
│   ├── eslint/        # Shared ESLint config factory
│   ├── vite/          # Shared Vite library config
│   ├── vitest/        # Shared test config + bench presets
│   └── tla/           # TLA+ model checking scripts
└── tools/             # External tool downloads (TLA+ jar)
```

---

## Command Cheatsheet

### Development Workflows

| Command | Description |
|---------|-------------|
| `pnpm dev` | Watch types + run `@seqlok/core` tests in watch mode |
| `pnpm dev:ui` | Same as above + start playground dev server |
| `pnpm dev:types` | Type-check workspace in watch mode |

### Testing

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all package tests (single run) |
| `pnpm test:core` | Run `@seqlok/core` tests only |
| `pnpm test:watch` | Watch mode for `@seqlok/core` |
| `pnpm test:cov` | Run `@seqlok/core` with coverage |
| `pnpm test:types` | Type-check entire workspace (no emit) |

### Benchmarks

| Command | Description |
|---------|-------------|
| `pnpm bench` | Run `@seqlok/core` benchmarks |
| `pnpm bench:report` | Generate benchmark report |

### Linting & Formatting

| Command | Description |
|---------|-------------|
| `pnpm lint` | Lint all packages |
| `pnpm lint:fix` | Lint + auto-fix all packages |
| `pnpm lint:md` | Lint markdown files |
| `pnpm lint:md:fix` | Lint + fix markdown files |
| `pnpm format` | Format all files with Prettier |

### Building

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages + strip extra `.d.ts` |
| `pnpm clean` | Remove dist, caches, logs from all packages |
| `pnpm clean:caches` | Remove only cache directories |
| `pnpm purge` | Nuclear option: clean + remove all `node_modules` |

### Verification Gates

| Command | Description |
|---------|-------------|
| `pnpm check` | `test:types` → `test` → `lint` |
| `pnpm verify` | `clean` → `build` → `check` (full CI simulation) |

> **Note:** `verify` is the "from scratch" CI-style run — it always cleans and builds before running tests + lint. You don't need to run `clean` or `build` yourself first.

### Error Registry (introspect)

| Command | Description |
|---------|-------------|
| `pnpm schema:errors:json` | Export error registry schema |
| `pnpm schema:errors:snapshots` | Generate all snapshot presets |

### TLA+ Model Checking

| Command | Description |
|---------|-------------|
| `pnpm tla:fetch` | Download TLA+ tools to `tools/tla/` |
| `pnpm tla:hotswap` | Run hotswap spec (invariants only) |
| `pnpm tla:hotswap:full` | Run hotswap spec (full model check) |

---

## Working on a Single Package

You can work in isolation from any package directory.

### Navigate to Package

```bash
cd packages/core    # or base, primitives, hotswap, etc.
```

### Per-Package Commands

All library packages share this script interface:

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start test watch mode |
| `pnpm test` | Run tests (single run) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:cov` | Run tests with coverage |
| `pnpm test:types` | Delegates to root type-check |
| `pnpm lint` | Lint src + tests |
| `pnpm lint:fix` | Lint + auto-fix |
| `pnpm format` | Format with Prettier |
| `pnpm build` | Compile TS + bundle `.d.ts` |
| `pnpm clean` | Remove dist + caches |
| `pnpm purge` | clean + remove `node_modules` |
| `pnpm bench` | Run benchmarks (where applicable) |

### Playground-Specific

```bash
cd packages/playground
pnpm dev          # Start Vite dev server
pnpm build        # Production build
pnpm preview      # Preview production build
```

---

## Using pnpm Filter from Root

Target a specific package without changing directories:

```bash
# Run tests in a single package
pnpm -F @seqlok/core run test

# Build a specific package
pnpm -F @seqlok/primitives run build

# Watch tests in hotswap
pnpm -F @seqlok/hotswap run test:watch

# Run all packages matching pattern
pnpm -r -F "@seqlok/*" run lint
```

**Filter shortcuts:**
- `-F @seqlok/core` → filter to exact package
- `-r` → recursive (all workspace packages)
- `-F "@seqlok/*"` → glob pattern

---

## TypeScript Configuration

The workspace uses **composite project references** for incremental builds.

| Config File | Purpose |
|-------------|---------|
| `tsconfig.base.json` | Shared compiler options (strict mode, paths) |
| `tsconfig.json` | Solution file with project references |
| `tsconfig.workspace.json` | For dev-time watch (no emit, relaxed isolated declarations) |
| `packages/*/tsconfig.json` | Per-package emit config |
| `packages/*/tsconfig.eslint.json` | ESLint parser config (includes tests, configs) |

> **Why `isolatedDeclarations: false` in workspace config?**  
> `tsconfig.workspace.json` turns off `isolatedDeclarations` for the monorepo-wide `test:types` run to avoid duplicate declaration diagnostics. The per-package build configs still enforce declaration correctness.

### Key Strictness Flags

```json
{
  "strict": true,
  "noImplicitAny": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "useUnknownInCatchVariables": true,
  "isolatedDeclarations": true
}
```

---

## Build Pipeline

### Library Packages (base, primitives, core, etc.)

1. **TypeScript** → emits `.js` + `.d.ts` to `dist/`
2. **Rollup + rollup-plugin-dts** → bundles declarations into single `dist/index.d.ts`

### Bundled Packages (core, hotswap)

1. **Vite** → bundles to single ES module `dist/index.js`
2. **Rollup + rollup-plugin-dts** → bundles declarations

### Playground (app)

- **Vite** only (no declaration bundling)
- Resolves workspace packages via `source` export condition

---

## Workspace Aliases

During development, `@seqlok/*` imports resolve to source files, not `dist/`.

This is handled by:
- `scripts/vite/workspace-aliases.ts` → Vite alias config
- `tsconfig.base.json` paths → TypeScript resolution

```ts
// In vite.config.ts or vitest.config.ts
import { createSeqlokWorkspaceAliases } from "../../scripts/vite/workspace-aliases";

export default defineConfig({
  resolve: { alias: createSeqlokWorkspaceAliases() }
});
```

---

## Commit Convention

Commits are validated via **commitlint** + **simple-git-hooks**.

### Format

```
<type>(<scope>): <subject>
```

### Types

`feat` | `fix` | `chore` | `docs` | `refactor` | `test` | `build` | `ci` | `perf` | `style` | `revert`

### Rules

- **Scope is required** (e.g., `core`, `base`, `hotswap`, `docs`)
- **Scope must be kebab-case**
- **No trailing period**
- **Max 100 characters**

### Examples

```
feat(core): add observer binding for telemetry consumers
fix(primitives): prevent torn read on seqlock retry
docs(hotswap): document TLA+ model checking workflow
refactor(base): extract error envelope serialization
test(integration): add cross-thread coherence tests
```

---

## Common Workflows

### Starting Fresh Development

```bash
pnpm install
pnpm dev              # Start watching
# Edit code, tests run automatically
```

### Before Committing

```bash
pnpm check            # Quick: types + tests + lint
# or
pnpm verify           # Full: clean build + check
```

### Investigating a Test Failure

```bash
# From root
pnpm -F @seqlok/core run test:watch

# Or cd into package
cd packages/core
pnpm test:watch
```

### Adding a New Package Dependency

```bash
# Add workspace dependency
pnpm -F @seqlok/integration add @seqlok/hotswap

# Add external dev dependency
pnpm -F @seqlok/core add -D some-tool
```

### Resetting Everything

```bash
pnpm purge            # Remove all dist + node_modules
pnpm install          # Fresh install
pnpm verify           # Confirm clean state
```

---

## Package Dependencies (Layered Architecture)

```
integration
    └── hotswap
        └── commands
            └── core
                ├── primitives
                │   └── base
                └── introspect
                    └── base
```

**Key rule:** Lower layers cannot import higher layers. ESLint enforces this via `import/no-restricted-paths`.

---

## Benchmark Presets

Located in `scripts/vitest/bench-presets.ts`:

| Preset | Use Case |
|--------|----------|
| `MICRO_BENCH_OPTS` | Ultra-fast micro operations (seqlock ops, atomics) |
| `E2E_BENCH_OPTS` | Heavier end-to-end patterns (plan+allocate+bind) |

```ts
import { MICRO_BENCH_OPTS } from "../../scripts/vitest/bench-presets";

describe("seqlock", () => {
  bench("acquire-release", () => { /* ... */ }, MICRO_BENCH_OPTS);
});
```

---

## Environment Requirements

- **Node.js** 20+
- **pnpm** 10.24.0 (enforced via `packageManager` field)
- **SharedArrayBuffer** support (browser: COOP/COEP headers)

---

## Troubleshooting

### Type errors after pulling changes

```bash
pnpm clean:caches
pnpm install
pnpm test:types
```

### Stale build artifacts

```bash
pnpm clean
pnpm build
```

### ESLint cache issues

```bash
rm -rf .eslintcache packages/**/.eslintcache
pnpm lint
```

### "Cannot find module" in tests

Ensure workspace aliases are configured in the package's `vitest.config.ts`:

```ts
import { createSeqlokWorkspaceAliases } from "../../scripts/vite/workspace-aliases";

export default defineConfig({
  resolve: { alias: createSeqlokWorkspaceAliases() },
  test: createSharedTestConfig(),
});
```

---

## Quick Reference Card

```bash
# Daily development
pnpm dev                    # Start dev mode
pnpm test                   # Run all tests
pnpm check                  # Pre-commit gate

# Single package focus
pnpm -F @seqlok/core test   # Test one package
cd packages/core && pnpm dev # Work in isolation

# Full verification
pnpm verify                 # CI-equivalent check

# Cleanup
pnpm clean                  # Remove artifacts
pnpm purge                  # Full reset
```
