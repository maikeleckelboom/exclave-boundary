# @seqlok/core

## 0.3.0

- Spec DSL overhaul:

  - `defineSpec` is now a real spec entrypoint with a clear author-time → runtime boundary.
  - Support nested namespaces in `params`/`meters`, normalized to flat dot-path keys.
  - Normalization applies stable defaults + validation for numeric scalar ranges.

- Type system expansion:

  - Split author-time vs runtime spec shapes (`SpecAstInput` / `SpecNamespace`
    → normalized `SpecInput` / `ResolvedSpec<T>`), so nesting is _typed_.
  - Params: added `u32` (scalar + `u32.array`), plus new fixed-length byte /
    integer array param kinds: `u8.array`, `i8.array`, `i16.array`, `u16.array`.
  - Meters: added missing `i32` + `i32.array`, and enum meters
    (`enum`, `enum.array`) alongside existing scalar/array meter kinds.
  - Tightened the “normalized runtime” contract: numeric scalar params end up
    with complete `{ min, max }` metadata after normalization.

## 0.2.0

- Add observer binding (`bindObserver`) for passive/telemetry consumers:

  - host-side: `bindObserver(spec, plan, backing, options?)` or `bindObserver(ctx)` with `SharedContext<S>`,
  - worker-side: `bindObserver(accepted, options?)` from `AcceptedHandoff<S>`,
  - supports both `shared` and `shared-partitioned` backings,
  - exposes read-only `params.within(...)` and `meters.snapshot(...)` with configurable retry/spin budgets.

- Introduce a shared coherence layer for bindings (`binding/common/coherent`):

  - centralize `snapshotWithPolicy` and `makeWithin`,
  - unify seqlock retry/spin/timeout semantics for controller, processor, and observer.

- Add `SharedContext<S>` helper (`context` module):

  - bundle `{ spec, plan, backing }` once and reuse across `bindController(ctx)` / `bindObserver(ctx)` /
    `buildHandoff(ctx)`.

- Add cross-thread observer coherence test:

  - Node `Worker` publishes meters while an observer samples params/meters,
  - asserts finite, in-range values with observed peak approaching `1.0`.

- Extend benchmarks/docs to cover observer read-path performance:

  - include `snapshot` / `within` timings,
  - document observer as a non-authoritative, read-only role.

- Introduce SWSR ring primitive in `primitives`:

  - single-writer/single-reader ring designed as the building block for higher-level MWMR command buses,
  - covered by runtime tests and documented in ADR-010.

## 0.1.0

- Lock v1 DSL: range-only numeric scalars, fixed-length arrays, enum/enum.array; no step/origin/defaults.
- Finalize public flow: `defineSpec` → `planLayout` → `allocateShared` → `buildHandoff` → `acceptHandoff` →
  `bindController` / `bindProcessor`.
- Ship SWMR seqlock primitives, backing/mapViews/handoff pipeline, diagnostics entrypoint
  (`@seqlok/core/diagnostics`), and error system with tests.
