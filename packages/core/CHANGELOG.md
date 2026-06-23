# @seqlok-internal/prototype-core

## 0.2.0

- Add observer binding (`bindObserver`) for passive/telemetry consumers:
  - host-side: `bindObserver(spec, plan, backing, options?)` or `bindObserver(ctx)` with `SharedContext<S>`,
  - worker-side: `bindObserver(received, options?)` from `ReceivedHandoff<S>`,
  - supports both `shared` and `shared-partitioned` backings,
  - exposes read-only `params.within(...)` and `meters.snapshot(...)` with configurable retry/spin budgets.
- Introduce a shared coherence layer for bindings (`binding/common/coherent`):
  - centralize `snapshotWithPolicy` and `makeWithin`,
  - unify seqlock retry/spin/timeout semantics for controller, processor, and observer.
- Add `SharedContext<S>` helper (`context` module):
  - bundle `{ spec, plan, backing }` once and reuse across `bindController(ctx)` / `bindObserver(ctx)` / `buildHandoff(ctx)`.
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
- Finalize public flow: `defineSpec` → `planLayout` → `allocateShared` → `buildHandoff` → `receiveHandoff` →
  `bindController` / `bindProcessor`.
- Ship SWMR seqlock primitives, backing/mapViews/handoff pipeline, diagnostics entrypoint
  (`@seqlok-internal/prototype-core/diagnostics`), and error system with tests.
