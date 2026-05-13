# Seqlok Developer CLI Reference

> Quick reference for working with the Seqlok monorepo.  
> All commands assume you're at the repository root unless noted otherwise.

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development
pnpm dev

# Run full verification before committing
pnpm verify
```

---

## Monorepo Structure

```text
seqlok/
├── apps/
│   └── playground/     # Interactive labs and visualization surfaces
├── packages/
│   ├── base/           # Error algebra, invariants, shared protocol shapes
│   ├── primitives/     # Low-level seqlock, planes, atomics, SWSR ring
│   ├── diagnostics/    # RT-safe telemetry schemas and SAB-backed rings
│   ├── core/           # Spec -> Plan -> Backing -> Handoff -> Bindings
│   ├── commands/       # Typed command transport over primitive rings
│   ├── streambuf/      # Bulk stream transport (PCM, bytes, frame streams)
│   ├── hotswap/        # Engine lifecycle and explicit swap protocol
│   ├── worklet-mount/  # AudioWorklet / WASM mount runtime and boundary wiring
│   └── introspect/     # Tooling, counters, health, registry export, analysis
├── scripts/
│   ├── eslint/         # Shared ESLint config factory
│   ├── support/        # Shared support utilities
│   ├── tla/            # TLA+ model checking scripts
│   ├── vite/           # Shared Vite library config + workspace aliases
│   └── vitest/         # Shared test config + bench presets
├── tools/
│   └── tla/            # Downloaded TLA+ tools
└── docs/               # Primer, setup sketch, repo-level docs
```

### Runtime vs tooling split

One distinction matters enough to call out explicitly:

- **`@seqlok/diagnostics`** owns **runtime-safe telemetry publication structures**  
  Shared-memory rings, snapshot schemas, and RT/host capture formats.

- **`@seqlok/introspect`** owns **tooling-side interpretation and export**  
  Counters, health, sinks, registry export, subset selection, and analysis helpers.

That split keeps runtime publication bounded and keeps higher-level analysis out of the hot path.

---

## Command Cheatsheet

### Development

| Command          | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `pnpm dev`       | Watch types + run `@seqlok/core` tests in watch mode |
| `pnpm dev:ui`    | Same as above + start playground dev server          |
| `pnpm dev:types` | Type-check workspace in watch mode                   |

### Testing

| Command           | Description                           |
| ----------------- | ------------------------------------- |
| `pnpm test`       | Run all package tests (single run)    |
| `pnpm test:core`  | Run `@seqlok/core` tests only         |
| `pnpm test:watch` | Watch mode for `@seqlok/core`         |
| `pnpm test:cov`   | Run `@seqlok/core` with coverage      |
| `pnpm test:types` | Type-check entire workspace (no emit) |

### Benchmarks

| Command             | Description                   |
| ------------------- | ----------------------------- |
| `pnpm bench`        | Run `@seqlok/core` benchmarks |
| `pnpm bench:report` | Generate benchmark report     |

### Linting and formatting

| Command            | Description                    |
| ------------------ | ------------------------------ |
| `pnpm lint`        | Lint all packages              |
| `pnpm lint:fix`    | Lint + auto-fix all packages   |
| `pnpm lint:md`     | Lint markdown files            |
| `pnpm lint:md:fix` | Lint + fix markdown files      |
| `pnpm format`      | Format all files with Prettier |

### Building and cleanup

| Command             | Description                                       |
| ------------------- | ------------------------------------------------- |
| `pnpm build`        | Build all packages + strip extra `.d.ts`          |
| `pnpm clean`        | Remove dist, caches, logs from all packages       |
| `pnpm clean:caches` | Remove only cache directories                     |
| `pnpm purge`        | Nuclear option: clean + remove all `node_modules` |

### Verification gates

| Command       | Description                                      |
| ------------- | ------------------------------------------------ |
| `pnpm check`  | `test:types` → `test` → `lint`                   |
| `pnpm verify` | `clean` → `build` → `check` (full CI simulation) |

> `verify` is the from-scratch CI-style run.  
> You do not need to run `clean` or `build` manually first.

### Error registry export

The most reliable commands are the package-local introspect scripts:

```bash
# Full registry snapshot
pnpm -F @seqlok/introspect run errors:registry:schema:full

# Boundary-safe snapshot
pnpm -F @seqlok/introspect run errors:registry:schema:boundary-safe

# Fatal-core snapshot
pnpm -F @seqlok/introspect run errors:registry:schema:fatal-core

# Regenerate all introspect snapshots
pnpm -F @seqlok/introspect run errors:registry:schema:snapshots
```

If the workspace root wires convenience aliases on top of those, treat them as shortcuts, not as the underlying source
of truth.

### TLA+ model checking

| Command                 | Description                         |
| ----------------------- | ----------------------------------- |
| `pnpm tla:fetch`        | Download TLA+ tools to `tools/tla/` |
| `pnpm tla:hotswap`      | Run hotswap spec (invariants only)  |
| `pnpm tla:hotswap:full` | Run hotswap spec (full model check) |

---

## Working on a Single Package

You can work in isolation from any package directory.

### Navigate to a package

```bash
cd packages/core
# or base, primitives, diagnostics, introspect, hotswap, etc.
```

### Common per-package scripts

Most library packages share a near-common script interface:

| Script            | Description                     |
| ----------------- | ------------------------------- |
| `pnpm dev`        | Start test watch mode           |
| `pnpm test`       | Run tests (single run)          |
| `pnpm test:watch` | Run tests in watch mode         |
| `pnpm test:cov`   | Run tests with coverage         |
| `pnpm test:types` | Delegate to root type-check     |
| `pnpm lint`       | Lint src + tests                |
| `pnpm lint:fix`   | Lint + auto-fix                 |
| `pnpm format`     | Format with Prettier            |
| `pnpm build`      | Compile TS + bundle `.d.ts`     |
| `pnpm clean`      | Remove dist + caches            |
| `pnpm purge`      | Clean + remove `node_modules`   |
| `pnpm bench`      | Run benchmarks where applicable |

Not every package exposes every script.  
Use the package `package.json` when you need the exact local truth.

### Playground-specific

```bash
cd apps/playground
pnpm dev
pnpm build
pnpm preview
```

---

## Using pnpm filter from root

Target a specific package without changing directories:

```bash
# Run tests in a single package
pnpm -F @seqlok/core run test

# Build a specific package
pnpm -F @seqlok/primitives run build

# Watch tests in hotswap
pnpm -F @seqlok/hotswap run test:watch

# Regenerate introspect registry snapshots
pnpm -F @seqlok/introspect run errors:registry:schema:snapshots

# Run all packages matching pattern
pnpm -r -F "@seqlok/*" run lint
```

### Filter shortcuts

- `-F @seqlok/core` → exact package
- `-r` → recursive across workspace packages
- `-F "@seqlok/*"` → glob pattern

---

## TypeScript configuration

The workspace uses composite project references for incremental builds.

| Config File                       | Purpose                                               |
| --------------------------------- | ----------------------------------------------------- |
| `tsconfig.base.json`              | Shared compiler options, strict mode, paths           |
| `tsconfig.json`                   | Solution file with project references                 |
| `tsconfig.workspace.json`         | Dev-time workspace type-checking                      |
| `packages/*/tsconfig.json`        | Per-package emit config                               |
| `packages/*/tsconfig.eslint.json` | ESLint parser config including tests and config files |
| `apps/*/tsconfig.json`            | Per-app type-check config                             |

### Key strictness flags

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

### Why workspace aliases exist

During development, `@seqlok/*` imports resolve to source files, not `dist/`.

This is handled by:

- `scripts/vite/workspace-aliases.ts`
- `tsconfig.base.json` path mapping

Example:

```ts
import { createSeqlokWorkspaceAliases } from "../../scripts/vite/workspace-aliases";

export default defineConfig({
  resolve: {
    alias: createSeqlokWorkspaceAliases(),
  },
});
```

---

## Build pipeline

### Library packages

Typical library package flow:

1. TypeScript emits `.js` + `.d.ts` to `dist/`
2. Rollup + `rollup-plugin-dts` bundles declarations into `dist/index.d.ts`

### Bundled packages

Some packages use Vite for the JS bundle and Rollup for declaration bundling.

### Playground

`apps/playground` is a Vite app:

- no declaration bundling
- workspace packages resolve through the `source` export condition during development

---

## Commit convention

Commits are validated through commitlint and git hooks.

### Format

```text
<type>(<scope>): <subject>
```

### Types

`feat` | `fix` | `chore` | `docs` | `refactor` | `test` | `build` | `ci` | `perf` | `style` | `revert`

### Rules

- scope is required
- scope must be kebab-case
- no trailing period
- max 100 characters

### Examples

```text
feat(core): add observer binding for telemetry consumers
fix(primitives): prevent torn read on seqlock retry
docs(hotswap): document TLA+ model checking workflow
refactor(base): extract error envelope serialization
test(playground): add hotswap lab coherence tests
```

---

## Common workflows

### Start fresh

```bash
pnpm install
pnpm dev
```

### Before committing

```bash
pnpm check
# or
pnpm verify
```

### Investigate a failure

```bash
# From root
pnpm -F @seqlok/core run test:watch

# Or inside the package
cd packages/core
pnpm test:watch
```

### Add a workspace dependency

```bash
pnpm --dir apps/playground add @seqlok/hotswap
```

### Add an external dev dependency

```bash
pnpm -F @seqlok/core add -D some-tool
```

### Reset everything

```bash
pnpm purge
pnpm install
pnpm verify
```

---

## Package layering

Use `packages/README.md` as the authoritative reusable package map.

At a high level:

- `base` is the floor
- `primitives` builds low-level shared-memory mechanisms on top of `base`
- `diagnostics` adds RT-safe telemetry structures on top of low-level runtime pieces
- `core` owns spec, layout, backing, handoff, and bindings
- `commands`, `streambuf`, `hotswap`, and `worklet-mount` build specialized protocol/runtime layers above the substrate
- `introspect` is tooling-side, not hot-path runtime
- `apps/playground` sits at the host/app edge and imports reusable packages through public entrypoints

**Rule:** lower layers do not import higher layers.

If you are unsure whether a reusable package import is legal, check `packages/README.md` before you code.

---

## Benchmark presets

Shared benchmark presets live in:

- `scripts/vitest/bench-presets.ts`

Typical presets include:

- `MICRO_BENCH_OPTS` for ultra-fast primitive operations
- `E2E_BENCH_OPTS` for heavier end-to-end flows

Example:

```ts
import { MICRO_BENCH_OPTS } from "../../scripts/vitest/bench-presets";

describe("seqlock", () => {
  bench(
    "acquire-release",
    () => {
      // ...
    },
    MICRO_BENCH_OPTS,
  );
});
```

---

## Environment requirements

- Node.js 20+
- pnpm 10.24.0
- `SharedArrayBuffer` support where relevant
- browser hosts need correct COOP/COEP headers

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
rm -rf .eslintcache packages/**/.eslintcache apps/**/.eslintcache
pnpm lint
```

### Module resolution issues in tests

Make sure the package `vitest.config.ts` uses workspace aliases:

```ts
import { createSeqlokWorkspaceAliases } from "../../scripts/vite/workspace-aliases";

export default defineConfig({
  resolve: {
    alias: createSeqlokWorkspaceAliases(),
  },
  test: createSharedTestConfig(),
});
```

---

## Quick Reference Card

```bash
# Daily development
pnpm dev
pnpm test
pnpm check

# Focus one package
pnpm -F @seqlok/core test
cd packages/core && pnpm dev

# Full verification
pnpm verify

# Cleanup
pnpm clean
pnpm purge
```
