# Package Readiness Checklist – v1.0 

**Purpose**: Track completion status for each package independently.  
**Last Updated**: 2025-11-29

This file is conservative on purpose. It reflects the **current reality**:

- `@seqlok/base`, `@seqlok/primitives`, and `@seqlok/introspect` have been extracted and are wired into the workspace.
- `@seqlok/core` has been refactored to depend on the new packages and no longer owns the global error registry.
- `@seqlok/commands`, `@seqlok/hotswap`, and `@seqlok/integration` exist as packages, but their APIs are at very
  different levels of maturity.

---

## Package Overview (Current)

| Package               | Status | Notes                                                                                                      | Ready for v1.0? |
|-----------------------|--------|------------------------------------------------------------------------------------------------------------|-----------------|
| `@seqlok/base`        | 🟡     | Extracted; error primitives + domain ids + health helpers live here; tests/docs are still minimal.         | ❌ Not yet       |
| `@seqlok/primitives`  | 🟡     | Extracted; seqlock/planes/SWSR ring + tests live here; docs + perf/stress story need rounding out.         | ❌ Not yet       |
| `@seqlok/introspect`  | 🟡     | New observatory package; owns error registry aggregation, JSON schema, counters, budgets, sessions.        | ❌ Not yet       |
| `@seqlok/core`        | 🟢     | Refactored core shared-state engine; uses `base`/`primitives`, owns env/spec/plan/backing/binding/handoff. | ❌ Not yet       |
| `@seqlok/commands`    | 🔴     | Package scaffolded with build/test wiring; real command transport API not implemented yet.                 | ❌ No            |
| `@seqlok/hotswap`     | 🟡     | Swap protocol + conformance/property tests exist; error domain + integration with commands pending.        | ❌ Not yet       |
| `@seqlok/integration` | 🔴     | Package exists with basic env wiring + smoke test; no real topology/host utilities yet.                    | ❌ No            |
| `@seqlok/playground`  | ⏸️     | Internal tooling app; Vite + Vitest wired; not part of the v1.0 contract surface.                          | N/A             |

Update this table as packages change phase.

---

## `@seqlok/base`

**Purpose**: Axioms – error primitives, invariants, health helpers. No dependencies.

**Status**: 🟡 Extracted and used, needs more tests/docs

### Current reality

- `SeqlokError`, error helpers, numeric encoding, invariants, and type-level tools now live in `@seqlok/base`.
- Domain id allocation and domain descriptors (`DOMAIN_IDS`, `DomainDescriptor`, etc.) live here as the cross-language
  ABI.
- Portable health helpers (`interpretHealth`, `isBoundarySafe`, `getDocsUrl`) are defined here and used by higher
  layers.
- `internal.*` error codes live in `base/src/errors/internal.ts`.
- Type helpers previously in `core` now live under `base/src/types/helpers.ts` and are exported via `@seqlok/base`.

### For v1.0, this package is "ready" when

#### Implementation

- [x] Package exists under `packages/base`.
- [x] All error primitives and invariant helpers moved from `core` to `base`.
- [x] `internal.*` error codes live under `base/src/errors/internal.ts`.
- [x] Former `internal/type-assert`-style helpers live in `base/src/types/helpers.ts` and are exported as internal/dev
  tooling.

#### Testing

- [ ] Focused unit tests for `SeqlokError` construction, serialization, and helpers (beyond a single smoke test).
- [ ] Type-level tests using `AssertTrue`/`IsExact` for key contracts (`ErrorMeta`, numeric domain ids, etc.).
- [ ] At least one integration test in another package that asserts behaviour when throwing/catching `SeqlokError`.

#### Documentation

- [x] `README.md` explaining the role of `base`.
- [ ] Short "Error Ownership" section describing `internal.*` and domain id allocation.
- [ ] API surface documented (or clearly covered by top-level error system docs).

#### Quality Gates

- [x] No `any` in public API.
- [x] Builds cleanly on its own via `tsc -p`.
- [x] No dependencies on other `@seqlok/*` packages.

**Verdict**: ❌ **NOT READY** – structurally in place and already in use; needs stronger tests and clearer docs before
v1.0.

---

## `@seqlok/primitives`

**Purpose**: Concurrency & memory primitives (seqlock, SWSR ring, low-level atomics). Depends on `@seqlok/base`.

**Status**: 🟡 Extracted, core primitives solid, docs/perf story pending

### Current reality

- Seqlock, planes, atomics helpers, and the SWSR ring have been moved out of `core` into `@seqlok/primitives`.
- `primitives.*` error domain lives under `primitives/src/errors/primitives.ts`.
- All former `core/tests/primitives/*` tests now live under `primitives/tests/*` and pass (including worker-based stress
  tests).
- Package builds and lints independently; `core` consumes it via normal workspace deps.

### For v1.0, this package is "ready" when

#### Implementation

- [x] Seqlock implementation moved into `primitives/src/seqlock.ts` (and friends).
- [x] SWSR ring / command buffer primitive implemented in `primitives/src/swsr-ring.ts`.
- [x] Core plane/typed-array utilities that are truly generic live here (`primitives/src/planes.ts`, etc.).
- [x] `primitives.*` error codes live under `primitives/src/errors/primitives.ts`.

#### Testing

- [x] Seqlock unit + property tests (monotone versions, no torn reads).
- [x] Stress tests under contention (worker tests) for seqlock.
- [ ] Ring buffer unit + property + long-run stress tests (beyond the current runtime suite).

#### Documentation

- [ ] `README.md` explaining "primitives vs core".
- [ ] Seqlock protocol doc (or clear link into architecture docs from this package).
- [ ] Brief ring-buffer protocol description (capacity, overwrite semantics, safe usage).

#### Quality Gates

- [x] No `any` in public API.
- [x] No circular dependencies.
- [x] Builds standalone with `tsc -p`.

**Verdict**: ❌ **NOT READY** – core building blocks are there; needs docs and stronger ring-bench/stress coverage.

---

## `@seqlok/introspect`

**Purpose**: Error registry aggregation, counters/budgets/sessions, and observability helpers.  
**Depends on**: `@seqlok/base`, `@seqlok/core`, `@seqlok/primitives` (for domain descriptors only).

**Status**: 🟡 First version implemented, observatory still maturing

### Current reality

- Owns the global error domain aggregation (`ALL_DOMAINS`) and derived views (`listErrors`, `computeNumericCode`, etc.).
- Exposes JSON Schema for the global error registry and a CLI script for exporting it.
- Hosts introspect-specific domain (`introspect.*`) under `introspect/src/errors/introspect.ts`.
- Provides runtime observability helpers: counters, budgets, sessions, feature flags, and `runWithIntrospect`/
  `runWithIntrospectSync`.
- Core/env probing lives in `@seqlok/core` and `@seqlok/integration`; `introspect` focuses on error/counter/session
  observability rather than raw env detection.

### For v1.0, this package is "ready" when

#### Implementation

- [x] Aggregated view of all error domains built via `ALL_DOMAINS` and registry map.
- [x] JSON schema + export tooling for the error registry live under `introspect/schema` and `introspect/scripts`.
- [x] `introspect.*` error codes live under `introspect/src/errors/introspect.ts`.
- [x] Counters, budgets, sessions, and features modules exist and are used by `runWithIntrospect*`.
- [ ] Optional higher-level CLIs / helpers for emitting/inspecting registry snapshots and health summaries.

#### Testing

- [x] Domain aggregation test(s) validate that `ALL_DOMAINS` matches the underlying registry map.
- [ ] Tests for budgets and counters (including invalid-budgets error paths).
- [ ] Tests for `runWithIntrospect*` happy-path + error-path behaviour.

#### Documentation

- [ ] `README.md` for `introspect`.
- [ ] Guide: "Using the error registry and schema in tooling or other languages".
- [ ] Guide: "Running soak/stress scenarios with introspect sessions and counters".

#### Quality Gates

- [x] No `any` in public API.
- [x] Builds standalone.
- [x] No deps on higher-level packages (`commands`, `hotswap`, `integration`).

**Verdict**: ❌ **NOT READY** – foundations are there and already used; needs docs and more coverage before v1.0.

---

## `@seqlok/core`

**Purpose**: Main shared state model – spec, plan, backing, handoff, bindings.  
**Depends on**: `@seqlok/base`, `@seqlok/primitives`.

**Status**: 🟢 Solid shared-state core post-split

### Current reality

- Implements the canonical flow using `base`/`primitives` (
  `defineSpec → planLayout → allocate* → buildHandoff → receiveHandoff → bindings`).
- Owns `env.*`, `backing.*`, `primitives.*` (via dependency), `binding.*`, `spec.*`, `plan.*`, and `handoff.*` error
  codes.
- Delegates global error registry aggregation to `@seqlok/introspect` instead of owning a monolithic registry.
- Tests and benches exist for layout, backing, bindings, and hotswap-adjacent flows.
- Builds cleanly in the monorepo with the new package layering.

### For v1.0, this package is "ready" when

#### Implementation

- [x] Uses `@seqlok/base` and `@seqlok/primitives` instead of inlining error primitives and concurrency code.
- [x] Only owns `env.*`, `spec.*`, `plan.*`, `backing.*`, `binding.*`, `handoff.*` error codes.
- [x] Does **not** own the global error registry; imports domain descriptors are consumed by `@seqlok/introspect`
  instead.
- [ ] Public API surface matches the final DoD (confirmed: no legacy names like `setMany`, `adoptHandoff`,
  `meters.sample`, etc.).

#### Testing

- [x] All existing tests green after the error/monorepo split.
- [ ] Additional regression tests for refactor seams (e.g. env probe + backing error paths, split error domains).
- [ ] At least one end-to-end "deck-like" quickstart flow used as a regression guard for public API.

#### Documentation

- [ ] Core docs updated to reference new packages instead of the old monolith.
- [ ] Canonical flow doc updated for the final monorepo layout and error split.
- [ ] Backing/layout docs aligned with the extracted `primitives` and `introspect` story.

#### Quality Gates

- [x] No `any` in public API.
- [x] `tsc -p` for the workspace passes with `core` depending on the other packages.
- [x] Exported surface stays minimal and matches the public API tests.

**Verdict**: ❌ **NOT READY** yet – functionally strong and well-tested, but still needs final API/name audit and doc
passes for v1.0.

---

## `@seqlok/commands`

**Purpose**: Command transport / ring, built on primitives. Depends on `@seqlok/base` and `@seqlok/primitives`.

**Status**: 🔴 Package scaffolded, no real API yet

### Current reality

- Package exists with basic build/test wiring and a smoke test.
- No finalized public API for producers/consumers or command formats.
- Will likely build on top of the SWSR ring from `@seqlok/primitives`.

### For v1.0, this package is "ready" when

#### Implementation

- [ ] Command ring abstraction(s) implemented on top of primitives.
- [ ] Producer API (controllers, schedulers) defined.
- [ ] Consumer API (processors, orchestrators) defined.
- [ ] Command format supports scheduling, cancellation, and engine control semantics.
- [ ] `commands.*` error codes live under `commands/src/errors/commands.ts` (or equivalent non-`codes/` path).

#### Testing

- [ ] Unit tests for ring behaviour.
- [ ] Property tests for no loss/duplication and FIFO guarantees.
- [ ] Stress tests under bursty producers/consumers and contention.

#### Documentation

- [ ] `README.md` for `commands`.
- [ ] Short protocol doc explaining expectations (order, eventual delivery, limits).
- [ ] Examples used by at least one reference integration.

**Verdict**: ❌ **NOT READY** – major critical-path blocker for the v1.0 story.

---

## `@seqlok/hotswap`

**Purpose**: Engine lifecycle and swap protocol. Depends on `@seqlok/base`, `@seqlok/core`, `@seqlok/commands` (
conceptually).

**Status**: 🟡 Protocol + tests exist, integration pending

### Current reality

- Package exists with property and conformance tests (`hotswap.properties.test.ts`, `hotswap.conformance.test.ts`).
- Core protocol (ticket lifecycle, swap flow) exists independently of any specific command transport.
- Error domain for `hotswap.*` has not yet been wired into the global error registry.

### For v1.0, this package is "ready" when

#### Implementation

- [x] Engine slot abstraction with clear lifecycle states exists.
- [x] Swap protocol implements `spawn → prime → preWarm → crossFade → retire` with well-defined transitions.
- [x] Swap tickets with clear terminal states are defined.
- [ ] `hotswap.*` error codes live under `hotswap/src/errors/hotswap.ts` and are included in the global domain table.

#### Testing

- [x] Unit/conformance tests for lifecycle transitions and invariants.
- [x] Property tests ensuring at most one active engine per slot and eventual terminal states.
- [ ] Stress tests with randomized command sequences (SPARBB harness) once `@seqlok/commands` exists.

#### Documentation

- [ ] `README.md` for `hotswap`.
- [ ] Protocol/state-machine diagrams.
- [ ] At least one reference integration uses `hotswap` in a realistic flow.

**Verdict**: ❌ **NOT READY** – protocol core is promising; needs error domain wiring, stress harness, and docs.

---

## `@seqlok/integration`

**Purpose**: Host wiring utilities and topology patterns. Depends on all core packages.

**Status**: 🔴 Package exists, patterns not implemented

### Current reality

- Package exists with basic env helper and a smoke test.
- No real wiring/topology helpers yet for workers, handoffs, or host lifecycle.
- Intended to be the home for "how you actually wire this in an app".

### For v1.0, this package is "ready" when

#### Implementation

- [ ] Utilities for wiring controller/processor/observer across workers/threads.
- [ ] Handoff transport helpers (e.g. `postMessage` + SharedArrayBuffer references).
- [ ] Host lifecycle helpers (start/stop/reset flows).
- [ ] `integration.*` error codes, if needed, live under `integration/src/errors/integration.ts` and participate in the
  registry.

#### Testing

- [ ] End-to-end tests for canonical host topologies.
- [ ] Error-path tests (e.g., bad host wiring, missing features).

#### Documentation

- [ ] `README.md` for `integration`.
- [ ] Wiring/topology guide explaining patterns and trade-offs.
- [ ] Examples (may overlap with reference integrations).

**Verdict**: ❌ **NOT READY** – can be deferred a bit if reference integrations inline wiring, but needed for a clean
v1.0 story.

---

## `@seqlok/playground`

**Purpose**: Internal development tool (not required for v1.0).

**Status**: ⏸️ Deferred

### Current reality

- Vite app builds (`pnpm -F "@seqlok/playground" run build`) and has a Vitest smoke test.
- Serves as a sandbox for trying out flows, not part of the supported API surface.

You can evolve this at any pace; it should not block Seqlok v1.0.

---

Update this file when a package changes phase (e.g. from 🔴 to 🟡 or 🟡 to ✅).
