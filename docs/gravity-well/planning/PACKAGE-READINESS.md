# Package Readiness Checklist – v1.0

**Purpose**: Track completion status for each package independently.
**Last Updated**: 2025-11-24

This file is conservative on purpose. It reflects the **current reality** that most packages are still being extracted
from `@seqlok/core` and that commands/hotswap/integration are not implemented yet.

---

## Package Overview (Baseline)

| Package               | Status | Notes                                                     | Ready for v1.0? |
|-----------------------|--------|-----------------------------------------------------------|-----------------|
| `@seqlok/foundation`  | 🔴     | Planned; primitives currently live inside `@seqlok/core`. | ❌ No            |
| `@seqlok/primitives`  | 🔴     | Planned; seqlock + low-level primitives live in `core`.   | ❌ No            |
| `@seqlok/diagnostics` | 🔴     | Planned; diagnostics/env logic not yet extracted.         | ❌ No            |
| `@seqlok/core`        | 🟡     | Existing v0.2.x monolith; golden flow implemented.        | ❌ Not yet       |
| `@seqlok/commands`    | 🔴     | Not implemented; only designed.                           | ❌ No            |
| `@seqlok/hotswap`     | 🔴     | Not implemented; only designed.                           | ❌ No            |
| `@seqlok/integration` | 🔴     | Not implemented; host wiring patterns not yet packaged.   | ❌ No            |
| `@seqlok/playground`  | ⏸️     | Internal tooling; not required for v1.0.                  | N/A             |

Update this table as you actually create packages and move code.

---

## `@seqlok/foundation`

**Purpose**: Axioms – error primitives, invariants, health helpers. No dependencies.

**Status**: 🔴 Not yet extracted

### Current reality

- `SeqlokError`, error helpers, invariants, and type-level tools are still in `@seqlok/core`.
- The distributed error plan designates `foundation` as the home for:
  - `SeqlokError`, `ErrorDetails`, `ErrorMeta`.
  - `invariant`, `unreachable`, exhaustiveness helpers.
  - `interpretHealth` and related helpers.
  - `internal.*` error codes.
  - `internal/type-assert` types.

### For v1.0, this package is "ready" when

#### Implementation

- [ ] Package exists under `packages/foundation`.
- [ ] All error primitives and invariant helpers moved from `core` to `foundation`.
- [ ] `internal.*` error codes live under `foundation/src/errors/codes/internal.ts`.
- [ ] `internal/type-assert` lives in `foundation` and is exported as a **dev-only** internal path.

#### Testing

- [ ] Unit tests for `SeqlokError` and helpers.
- [ ] Type-level tests using `AssertTrue`/`IsExact` for key contracts.
- [ ] At least one integration test that uses `SeqlokError` from another package.

#### Documentation

- [ ] `README.md` explaining the role of `foundation`.
- [ ] Short “Error Ownership” section describing `internal.*`.
- [ ] API surface documented (or covered by top-level docs).

#### Quality Gates

- [ ] No `any` in public API.
- [ ] Builds cleanly on its own via `tsc -b`.
- [ ] No dependencies on other `@seqlok/*` packages.

**Verdict**: ❌ **NOT READY** – must be created and populated as part of the monorepo/error split.

---

## `@seqlok/primitives`

**Purpose**: Concurrency & memory primitives (seqlock, SWSR ring, low-level atomics). Depends on `@seqlok/foundation`.

**Status**: 🔴 Not yet extracted

### Current reality

- Seqlock and other low-level primitives currently live inside `@seqlok/core`.
- Command-ring primitives are designed but not implemented.

### For v1.0, this package is "ready" when

#### Implementation

- [ ] Seqlock implementation moved into `primitives/src/seqlock/*.ts`.
- [ ] SWSR ring / command buffer primitive implemented.
- [ ] Core plane/memory utilities that are truly generic moved here.
- [ ] `primitives.*` error codes live under `primitives/src/errors/codes/primitives.ts`.

#### Testing

- [ ] Seqlock unit + property tests (monotone versions, no torn reads).
- [ ] Stress tests under contention (worker tests).
- [ ] Ring buffer unit + property + stress tests.

#### Documentation

- [ ] `README.md` explaining “primitives vs core”.
- [ ] Seqlock protocol doc (or link to architecture docs).
- [ ] Brief ring-buffer protocol description.

#### Quality Gates

- [ ] No `any` in public API.
- [ ] No circular dependencies.
- [ ] Builds standalone with `tsc -b`.

**Verdict**: ❌ **NOT READY** – creation and extraction required.

---

## `@seqlok/diagnostics`

**Purpose**: Environment probing, diagnostics, and health interpretation. Depends on `@seqlok/foundation`.

**Status**: 🔴 Not yet extracted

### Current reality

- Env probing (SAB/Atomics/WASM) and diagnostics logic are either ad-hoc or living in `@seqlok/core`.
- Error codes `diagnostics.*` and `env.*` are designed but not split out.

### For v1.0, this package is "ready" when

#### Implementation

- [ ] Env probes for SAB, Atomics, WASM, and other relevant features.
- [ ] Health helpers that translate probe results into error codes / recommendations.
- [ ] `diagnostics.*` and `env.*` error codes live under `diagnostics/src/errors/codes/*.ts`.

#### Testing

- [ ] Unit tests for each probe and helper.
- [ ] Tests for missing/partial feature sets (e.g. SAB disabled).

#### Documentation

- [ ] `README.md` for `diagnostics`.
- [ ] Guide: “Handling missing features and degrading gracefully”.

#### Quality Gates

- [ ] No `any` in public API.
- [ ] Builds standalone.
- [ ] No deps on higher-level packages.

**Verdict**: ❌ **NOT READY** – to be built as part of monorepo/error split.

---

## `@seqlok/core`

**Purpose**: Main shared state model – spec, plan, backing, handoff, bindings. Depends on `foundation`, `primitives`,
`diagnostics` (once split).

**Status**: 🟡 Solid core, needs monorepo refactor

### Current reality

- Implements the golden flow in a single package (v0.2.x).
- Contains primitives, diagnostics, and error system that belong in other packages.
- Tests and benches exist for the current monolithic layout.

### For v1.0, this package is "ready" when

#### Implementation

- [ ] Uses `@seqlok/foundation`, `@seqlok/primitives`, `@seqlok/diagnostics` instead of inlining their logic.
- [ ] Only owns `spec.*`, `plan.*`, `backing.*`, `binding.*`, `handoff.*` error codes.
- [ ] Global error registry aggregates domains imported from other packages.
- [ ] Public API surface matches the final DoD (no legacy names).

#### Testing

- [ ] All existing tests green after split.
- [ ] New tests cover any refactor edges introduced by package boundaries.

#### Documentation

- [ ] Core docs updated to reference the new packages.
- [ ] Golden flow doc updated for monorepo layout.

#### Quality Gates

- [ ] No `any` in public API.
- [ ] `tsc -b` on monorepo passes with `core` depending on the other packages.

**Verdict**: ❌ **NOT READY** yet – **closest to ready**, but must be refactored to sit correctly in the package
hierarchy.

---

## `@seqlok/commands`

**Purpose**: Command transport / ring, built on primitives. Depends on `@seqlok/foundation` and `@seqlok/primitives`.

**Status**: 🔴 Not implemented

### For v1.0, this package is "ready" when

#### Implementation

- [ ] Command ring primitive(s) implemented.
- [ ] Producer API (controllers, schedulers) defined.
- [ ] Consumer API (processors, orchestrators) defined.
- [ ] Command format supports scheduling, cancellation, and engine control.
- [ ] `commands.*` error codes live under `commands/src/errors/codes/commands.ts`.

#### Testing

- [ ] Unit tests for ring behaviour.
- [ ] Property tests for no loss/duplication and FIFO guarantees.
- [ ] Stress tests under bursty producers/consumers.

#### Documentation

- [ ] `README.md` for `commands`.
- [ ] Short protocol doc explaining expectations (order, eventual delivery, limits).
- [ ] Examples used by at least one reference integration.

**Verdict**: ❌ **NOT READY** – major critical-path blocker.

---

## `@seqlok/hotswap`

**Purpose**: Engine lifecycle and swap protocol. Depends on `@seqlok/foundation`, `@seqlok/core`, `@seqlok/commands`.

**Status**: 🔴 Not implemented

### For v1.0, this package is "ready" when

#### Implementation

- [ ] Engine slot abstraction with clear lifecycle states.
- [ ] Swap protocol implementing `spawn → prime → preWarm → crossFade → retire`.
- [ ] Swap tickets with clear terminal states.
- [ ] `hotswap.*` error codes live under `hotswap/src/errors/codes/hotswap.ts`.

#### Testing

- [ ] Unit tests for lifecycle transitions.
- [ ] Property tests ensuring at most one active engine per slot and eventual terminal states.
- [ ] Stress tests with randomized command sequences (SPARBB harness).

#### Documentation

- [ ] `README.md` for `hotswap`.
- [ ] Protocol/state-machine diagrams.
- [ ] At least one reference integration uses `hotswap` in the loop.

**Verdict**: ❌ **NOT READY** – major critical-path blocker.

---

## `@seqlok/integration`

**Purpose**: Host wiring utilities and topology patterns. Depends on all core packages.

**Status**: 🔴 Not implemented as a proper package

### For v1.0, this package is "ready" when

#### Implementation

- [ ] Utilities for wiring controller/processor/observer across workers.
- [ ] Handoff transport helpers (postMessage, SharedArrayBuffer references).
- [ ] Host lifecycle helpers (start/stop/reset flows).
- [ ] `integration.*` error codes if applicable.

#### Testing

- [ ] End-to-end tests for canonical host topologies.
- [ ] Error-path tests (e.g., bad host wiring, missing features).

#### Documentation

- [ ] `README.md` for `integration`.
- [ ] Wiring/topology guide explaining patterns and trade-offs.
- [ ] Examples (may be the same as reference integrations).

**Verdict**: ❌ **NOT READY** – can be deferred a bit if reference integrations inline wiring, but needed for a clean
v1.0 story.

---

## `@seqlok/playground`

**Purpose**: Internal development tool (not required for v1.0).

**Status**: ⏸️ Deferred

You can evolve this at any pace; it should not block Seqlok v1.0.

---

Update this file when a package changes phase (e.g. from 🔴 to 🟡 or 🟡 to ✅).
