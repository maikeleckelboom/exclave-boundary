# `@seqlok/core` Benchmarks

The benches in `packages/core/bench` track the hot paths of the shared-memory pipeline:

- seqlock publish/tryRead
- controller param writes (`set` / `update` / `stage` / `hydrate`)
- processor `within(...)`
- observer `within(...)` / `snapshot(...)`
- end-to-end `spec → plan → backing → handoff → bindings`

They exist to answer very specific questions:

- What does a single seqlock publish/tryRead cost?
- How expensive are controller writes relative to each other?
- What's the overhead of observer reads (full vs partial, params vs meters)?
- How long does it take to spin up a full instance (plan + allocate + bind)?

Most numbers are in the **sub-microsecond** range for hot params/meters, and **tens of microseconds** for observer
reads, on a typical Node 20 + Vitest bench run.

---

## How to run benches

From the repo root:

```bash
pnpm -F @seqlok/core run bench
```

This runs all `bench/*.bench.ts` files with Vitest's `bench` runner and prints detailed stats (hz, mean, percentiles)
for each case using the shared `MICRO_BENCH_OPTS` in [`vitest.config.ts`](../vitest.config.ts).

### Generating the docs + ASCII charts

For CI / docs, use the report pipeline:

```bash
pnpm -F @seqlok/core run bench:report
```

This does three things:

1. Runs the benches (same as `bench`).
2. Feeds Vitest's JSON output through [`scripts/format-bench.ts`](../scripts/format-bench.ts).
3. Produces:

- [`docs/performance/bench-results.generated.md`](../docs/performance/bench-results.generated.md) – Markdown tables for:

  - **Hot path micro-operations** (µs + M ops/s).
  - **E2E setup** (ms + setups/sec).

- [`docs/performance/bench-results.json`](../docs/performance/bench-results.json) – raw JSON, kept alongside the docs.
- An ASCII summary printed to stdout (the small bar charts you see in the logs).

Re-run `pnpm -F @seqlok/core run bench:report` whenever you change benches or touch the hot paths.

---

## Suite overview

Benches are organized by "what decision they inform" rather than by module name:

- [`bench/seqlock.bench.ts`](seqlock.bench.ts)
  Micro-benchmarks for the seqlock primitive:

  - `publish uncontended`
  - `tryRead uncontended (spin=0, retry=0)`

- [`bench/param-operations.bench.ts`](./param-operations.bench.ts)
  Controller-side param hot paths:

  - `params.set` (simple scalars)
  - `params.update` (patch objects, with and without arrays)
  - `params.hydrate` (mixed scalar + array)
  - `params.stage` (array writes)
  - paired `processor.params.within(...)` and an interleaved write+read loop.

- [`bench/real-world-scenarios.bench.ts`](./real-world-scenarios.bench.ts)
  The same operations, but grouped into a more DJ-style pattern:

  - “controller pokes a few knobs every frame”
  - “processor reads once per audio tick”.

- [`bench/array-vs-stage-and-meters.bench.ts`](./array-vs-stage-and-meters.bench.ts)
  Meter writer ergonomics:

  - `writer.level(…)` vs `writer.set('level', …)` for scalars.
  - `writer.stage('spectrum', cb)` for array meters.

- [`bench/observer-reads.bench.ts`](./observer-reads.bench.ts)
  Observer read strategies, for UI/telemetry overlays:

  - `params.within() – full view`
  - `params.snapshot() – full spec`
  - `params.snapshot(['gain']) – partial`
  - `meters.snapshot() – full spec`
  - `meters.snapshot(['peak']) – partial`

- [`bench/e2e-pipeline.bench.ts`](./e2e-pipeline.bench.ts)
  End-to-end setup times:

  - `spec → planLayout → allocateShared/allocateSharedPartitioned → buildHandoff → acceptHandoff → bindController/bindProcessor/bindObserver`
  - measured for small / medium / large specs.

Each file has its own `describe(...)` scope so you can target a suite:

```bash
pnpm -F @seqlok/core exec vitest bench bench/observer-reads.bench.ts
```

---

## How to read the numbers

When you look at [`docs/performance/bench-results.generated.md`](../docs/performance/bench-results.generated.md) or the
ASCII summary, treat it as **regression radar**, not a marketing slide:

- Focus on **ratios**, not absolute values.
  E.g.:

  - `params.stage` should stay comfortably faster than `params.set`/`params.update` for array-heavy writes.
  - Observer partial snapshots should stay clearly cheaper than full meter snapshots.

- Watch for **ordering invariants**:

  - seqlock `publish` should remain faster than `tryRead` uncontended.
  - `writer.level` should be ~equal or slightly faster than `writer.set(...)`.
  - `params.stage` should remain the cheapest way to update arrays.

- Check **end-to-end** after refactors:
  If a change tightens [`bench/param-operations.bench.ts`](./param-operations.bench.ts) but makes [`bench/e2e-pipeline.bench.ts`](./e2e-pipeline.bench.ts) worse, you've probably moved work into
  plan/backing/handoff/bind, not the hot loop.

If a refactor flips any of these relationships, that's your signal to pause and profile before shipping.
