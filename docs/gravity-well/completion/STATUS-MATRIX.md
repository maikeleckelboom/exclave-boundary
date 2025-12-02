# Seqlok v1.0 – DoD Status Matrix

**Last Updated**: 2025-11-29  
**Overall Completion**: TBD – this matrix is a tool, not a prediction.

This file mirrors the sections in `../architecture/00-definition-of-done.md` and tracks *your* current assessment.
Rows below start with conservative defaults; update them as you implement work.

---

## Legend

| Symbol | Meaning                   |
|--------|---------------------------|
| ✅      | Complete                  |
| 🟢     | Implemented, needs polish |
| 🟡     | Partial / in progress     |
| 🔴     | Not implemented / blocked |
| ⏸️     | Deferred explicitly       |

---

## DOD-ARCH – Architecture & Packages

**Goal**: Layered monorepo, clear package ownership, frozen layout model.

**Section Status**: 🟡 In progress

| ID | Requirement                                                                                                                  | Status | Notes                                                                                                                                 |
|----|------------------------------------------------------------------------------------------------------------------------------|--------|---------------------------------------------------------------------------------------------------------------------------------------|
| A1 | 8-package monorepo structure exists (`base`, `primitives`, `introspect`, `core`, `commands`, `hotswap`, `integration`, apps) | ✅      | All packages exist with builds/tests (`playground` as app); higher-layer APIs are still evolving.                                     |
| A2 | Dependency flow enforced (no upward deps)                                                                                    | 🟡     | Package deps + TS project refs follow base → primitives → core → commands/hotswap → integration → playground; import lint still TODO. |
| A3 | Ownership of major concepts documented per package                                                                           | 🟡     | High-level docs + `01-packages-and-introspect.md` + `base/README.md` exist; per-package ownership sections still incomplete.          |
| A4 | Memory layout model documented for x-lang interop                                                                            | 🟡     | Planes/layout docs exist; needs promotion into a single canonical spec Rust/C++ can adopt verbatim.                                   |
| A5 | Definition of Done + Gravity Well docs exist                                                                                 | ✅      | DoD + Gravity Well / status docs exist and are in active use.                                                                         |

---

## DOD-API – Public Surface & Semantics

**Goal**: Stable canonical flow and param/meter APIs, minimal surface.

**Section Status**: 🟡 Core stable, higher layers missing

| ID | Requirement                                                                                                                      | Status | Notes                                                                                  |
|----|----------------------------------------------------------------------------------------------------------------------------------|--------|----------------------------------------------------------------------------------------|
| B1 | Canonical flow (`defineSpec → planLayout → allocate* → buildHandoff → receiveHandoff → bindings`) stable in `@seqlok/core`       | 🟢     | Implemented and exercised in tests; flow survived monorepo/error split refactors.      |
| B2 | Param/meter APIs (`params.set/update/stage`, `params.within`, `meters.snapshot/publish`) stable and range-only DSL (`{min,max}`) | 🟢     | Behaviourally stable; DSL is `{min,max}` only. Tests enforce the current shape.        |
| B3 | No legacy names/aliases (`setMany`, `adoptHandoff`, `meters.sample`, etc.) remain in public surface                              | 🟡     | Believed fully removed; a final grep/assertion pass is still on the v1.0 checklist.    |
| B4 | `@seqlok/commands` public API implemented                                                                                        | 🔴     | Package is scaffolded with build/test wiring; real command transport API not written.  |
| B5 | `@seqlok/hotswap` public API implemented                                                                                         | 🟡     | Core protocol + basic API exist and are tested; final shape depends on commands layer. |
| B6 | At least two reference integrations using only public APIs                                                                       | 🔴     | No official reference integrations yet; planned once integration package stabilizes.   |

---

## DOD-CONC – Concurrency & Correctness

**Goal**: Explicit concurrency model, property/stress tests for hot paths.

**Section Status**: 🟡 Core concurrency solid, commands/hotswap missing

| ID | Requirement                                                                | Status | Notes                                                                                |
|----|----------------------------------------------------------------------------|--------|--------------------------------------------------------------------------------------|
| C1 | Concurrency model for params/meters (SWMR + seqlock) documented and tested | 🟢     | Model + tests for core bindings/backing are in good shape.                           |
| C2 | Command ring concurrency model (MWSR/MWMR as designed) documented          | 🔴     | Depends on `@seqlok/commands` implementation.                                        |
| C3 | Hotswap invariants: ticket lifecycle + "one active engine per slot"        | 🟡     | Protocol + property/conformance tests exist; needs more integration-level hardening. |
| C4 | SPARBB-style randomized stress harness for commands + hotswap              | 🔴     | Not implemented; to follow commands/hotswap landing.                                 |
| C5 | Node + browser worker tests for existing concurrency primitives            | 🟡     | Node worker tests exist for seqlock/observer; browser worker coverage still missing. |

---

## DOD-ERR – Errors, Diagnostics, Health

**Goal**: Distributed error domains, global registry, invariants enforced.

**Section Status**: 🟢 Base/core/introspect migrated; invariants still evolving

| ID | Requirement                                                                                                                                         | Status | Notes                                                                                                                     |
|----|-----------------------------------------------------------------------------------------------------------------------------------------------------|--------|---------------------------------------------------------------------------------------------------------------------------|
| E1 | Error domains split across packages (`internal.*`, `primitives.*`, `introspect.*`, `spec.*`, `plan.*`, `backing.*`, `binding.*`, `handoff.*`, etc.) | 🟢     | Implemented across `base`, `primitives`, `core`, `introspect`; future `commands.*` / `hotswap.*` domains will join later. |
| E2 | Global registry aggregates domains without owning them                                                                                              | 🟢     | `@seqlok/introspect` now owns `ALL_DOMAINS` and aggregation; each package defines its own domain locally.                 |
| E3 | Invariants enforced: global uniqueness, bijection code ↔ maps, complete meta/messages                                                               | 🟡     | New aggregation tests exist; full parity/uniqueness checks from the old core registry still need to be reintroduced.      |
| E4 | JSON/IDL error schema generated from registry                                                                                                       | 🟢     | JSON Schema + export CLI wired under `@seqlok/introspect/schema`; registry export uses the aggregated domain view.        |
| E5 | Introspect API surfaces structured errors and health guidance                                                                                       | 🟢     | `runWithIntrospect*` + counters/sessions + base `interpretHealth`/`getDocsUrl` provide a structured, portable interface.  |

---

## DOD-PERF – Performance

**Goal**: Documented budgets, reproducible benches, perf checks in CI.

**Section Status**: 🟡 Core hot paths measured, no CI gate yet

| ID | Requirement                                                   | Status | Notes                                                                            |
|----|---------------------------------------------------------------|--------|----------------------------------------------------------------------------------|
| P1 | Benchmarks + budgets defined for core hot paths               | 🟢     | Bench harness + budgets exist; results captured in `bench-results.generated.md`. |
| P2 | Performance for new packages (commands, hotswap) budgeted     | 🔴     | Budgets/benches for commands + hotswap to be added with their implementations.   |
| P3 | Benchmarks can be run reproducibly (`pnpm bench` or similar)  | 🟢     | `pnpm bench:report` runs Vitest benches + formatting/scripts in a stable way.    |
| P4 | CI includes at least a perf smoke test (regression guardrail) | 🔴     | No perf gate in CI yet; still manual/local-only.                                 |

---

## DOD-DOCS – Documentation & Examples

**Goal**: Architecture understandable, APIs discoverable, examples runnable.

**Section Status**: 🟡 Core documented, v1.0 story ahead of docs

| ID | Requirement                                                                     | Status | Notes                                                                                                                    |
|----|---------------------------------------------------------------------------------|--------|--------------------------------------------------------------------------------------------------------------------------|
| D1 | Architecture docs for current core canonical flow                               | 🟢     | Docs exist; some naming (diagnostics → introspect) has been refreshed, more passes later.                                |
| D2 | Docs for new packages (base/primitives/introspect/commands/hotswap/integration) | 🟡     | `base/README`, `01-packages-and-introspect.md`, introspect schema docs exist; commands/hotswap/integration docs missing. |
| D3 | Host wiring / topology guide                                                    | 🔴     | To be written once `@seqlok/integration` patterns are stable.                                                            |
| D4 | Reference integration docs (audio deck + non-audio sim)                         | 🔴     | Planned for v1.0 once reference integrations actually exist.                                                             |
| D5 | VitePress docs site builds locally and in CI                                    | 🟡     | Local docs story is in progress; CI wiring still needs to be finalized.                                                  |

---

## DOD-TEST – Testing & CI

**Goal**: Meaningful coverage, property tests, and a single CI entrypoint.

**Section Status**: 🟡 Core well-tested, new packages missing

| ID | Requirement                                                              | Status | Notes                                                                                       |
|----|--------------------------------------------------------------------------|--------|---------------------------------------------------------------------------------------------|
| T1 | Core (spec/plan/backing/bindings) has focused tests                      | 🟢     | Good coverage across spec/plan/backing/bindings, including regressions and edge-cases.      |
| T2 | Command ring has unit/property/stress tests                              | 🔴     | Depends on `@seqlok/commands` implementation.                                               |
| T3 | Hotswap has unit/property/stress tests                                   | 🟡     | Property + conformance tests exist; dedicated long-run stress harness still to come.        |
| T4 | Property tests for spec/layout invariants                                | 🟡     | Some fast-check tests exist; expand once layout spec is frozen post-monorepo.               |
| T5 | Single CI command runs lint, typecheck, tests, benches (optionally docs) | 🟡     | Root scripts exist (`lint`, `test`, `test:types`, `bench:report`); CI wiring to be unified. |

---

## DOD-XLANG – Cross-Language & Integration

**Goal**: Seqlok semantics portable beyond TypeScript.

**Section Status**: 🔴 Mostly future work

| ID | Requirement                                                            | Status | Notes                                                                |
|----|------------------------------------------------------------------------|--------|----------------------------------------------------------------------|
| X1 | Language-agnostic memory layout spec                                   | 🟡     | Partial doc exists; needs promotion and alignment with current core. |
| X2 | Error schema consumable by Rust/C++                                    | 🟡     | JSON Schema now exists; no Rust/C++ consumer or codegen wired yet.   |
| X3 | Minimal Rust prototype (params/meters via shared layout)               | 🔴     | Planned; blocked on X1 + stronger error schema usage.                |
| X4 | Minimal C++ prototype                                                  | 🔴     | Same dependencies as X3; not started.                                |
| X5 | Integration patterns (workers, handoffs, command transport) documented | 🔴     | Will live under `@seqlok/integration` docs once patterns solidify.   |

---

## DOD-GOV – Versioning & Evolution

**Goal**: Clear versioning, changelog, and deprecation policy.

**Section Status**: 🔴 Governance not wired yet

| ID | Requirement                                              | Status | Notes                                                                                 |
|----|----------------------------------------------------------|--------|---------------------------------------------------------------------------------------|
| G1 | Semver per package (not just root)                       | 🔴     | Currently only root/core-style versioning; per-package semver still to be introduced. |
| G2 | Changelog per package                                    | 🔴     | No per-package changelogs yet.                                                        |
| G3 | Deprecation + error code evolution policy documented     | 🔴     | Policy to be written along with v1.0 hardening.                                       |
| G4 | Commit/CI hooks enforce changelog + version bumps        | 🔴     | Not implemented.                                                                      |
| G5 | Governance docs describe how to evolve the system safely | 🔴     | To be written as part of the v1.0 governance/documentation pass.                      |

---

## Weekly Usage

At the end of a work block:

1. Update any rows whose status changed.
2. If a new row is needed (e.g. you add a new DOD requirement), append it here and in the DoD doc.
3. Use the **section status** lines as your quick "heat map":

- If **DOD-API**, **DOD-ERR**, or **DOD-CONC** are mostly 🔴/🟡, you are not close to v1.0.
- When most sections are 🟢/✅ and only docs/governance are lagging, you are in v1.0 polishing mode.

