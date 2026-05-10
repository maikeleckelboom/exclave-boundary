# @seqlok/core

**Seqlok**

Lock-free shared-memory sync for real-time systems: audio, simulations, workers, WebAssembly.

---

## Status: v0.2.0 · SWMR core + observer

Seqlok v0.2.0 ships the **single-writer, multi-reader (SWMR)** seqlock core, plus a formal observer role:

- One writer, many readers over a shared backing (`SharedArrayBuffer`).
- Controller ↔ processor bindings with coherent `within` reads and `publish` writes.
- New **observer binding** for passive / telemetry consumers on the same SWMR planes:
  - read-only `params.within(...)` and `params.snapshot(...)`,
  - read-only `meters.snapshot(...)`,
  - shared coherence/retry policy with controller/processor.
- Typed-plane layout for params (PF32 / PI32 / PB) and meters (MF32 / MU32 / MF64 / MU).
- Range-only v1 DSL: numeric scalars, fixed-length arrays, and enum / enum.array.
- **SWSR ring primitive** (`primitives/swsr-ring`) as the building block for future MWMR command buses.
- Decoupled mode only (JS + SAB); future MWMR/compose modes live in the design docs.
- Diagnostics / introspection surface (`@seqlok/core/introspect`) for counters, env probing, and debug tools.

**Zero-copy, seqlock-based state synchronization for real-time systems.**

A typed shared-memory layer between:

- a **Controller** (main/UI thread),
- a **Processor** (Worker / AudioWorklet / simulation loop),
- and optionally an **Observer** (telemetry / monitoring role),

all sharing a single backing:

- **Controller** writes **params** (what you want the engine / lane to do).
- **Processor** writes **meters** (what the engine / lane is actually doing).
- **Observer** reads both params/meters, but never writes.
- All readers use coherent snapshots guarded by a seqlock so no one ever sees torn state.

Properties:

- **Zero allocations** – direct typed-array access over `SharedArrayBuffer`.
- **Type-safe** – full TypeScript inference from spec → plan → backing → bindings.
- **Coherent reads** – readers never observe partial writes.
- **Predictable** – deterministic memory layout, no hidden orchestration or sugar in the core.

---

## Install

```bash
pnpm add @seqlok/core
```

### Runtime requirements

- ESM-only: modern browsers (≈2022+) or Node 20+.
- `SharedArrayBuffer` must be available:

  - **Browser**: correct COOP/COEP headers and `crossOriginIsolated === true`.
  - **Worker / AudioWorklet**: same process, SAB enabled by the host.
  - **Node**: recent Node with `SharedArrayBuffer` support (e.g. Node 20+).

---

## Core concept: Spec → Plan → Backing → Handoff → Bindings

Seqlok's API is shaped like the underlying protocol. There is **one canonical flow** and the core does not provide
shortcuts.

1. **Spec** – what exists

   ```ts
   const spec = defineSpec(/* params + meters schema */);
   ```

2. **Plan** – how it is laid out in memory

   ```ts
   const plan = planLayout(spec);
   ```

3. **Backing** – where it lives (actual shared memory)

   ```ts
   const backing = allocateShared(plan);
   ```

4. **Handoff** – how layout + backing cross a trust boundary

   ```ts
   const handoff = buildHandoff(plan, backing);
   ```

5. **AcceptedHandoff + bindings** – how the other side sees it

   ```ts
   const accepted = acceptHandoff(handoff);
   const controller = bindController(spec, plan, backing);
   const processor = bindProcessor(accepted);
   ```

The important rule:

> `planLayout` is called exactly once at the **Spec → Plan** boundary.
> Backing and binding **consume** `Plan` — they never recompute it.

There is **no** `bindController(spec, backing)` sugar in core.
If you want shortcuts, you build them _on top_ of this flow.

---

## Quick sketch: controller ↔ processor

This is the minimal shape of a typical setup. Think “lane” of control: it could be an audio lane, a simulation lane, a
render lane, etc.

### 1. Define a spec

```ts
import { defineSpec } from "@seqlok/core";

export const laneSpec = defineSpec(({ param, meter }) => ({
  id: "lane",
  params: {
    timeRatio: param.f32({ min: 0.25, max: 4 }),
    eqBands: param.f32.array({ length: 8 }),
    mode: param.enum(["normal", "granular"]),
  },
  meters: {
    rms: meter.f32(),
    peak: meter.f32(),
    framesProcessed: meter.u32(),
  },
}));

export type LaneSpec = typeof laneSpec;
```

### 2. Owner thread: spec → plan → backing → controller + handoff

```ts
import {
  planLayout,
  allocateShared,
  buildHandoff,
  bindController,
  type Handoff,
} from "@seqlok/core";
import { laneSpec, type LaneSpec } from "./spec";

const plan = planLayout(laneSpec);
const backing = allocateShared(plan);
const controller = bindController(laneSpec, plan, backing);

const handoff: Handoff<LaneSpec> = buildHandoff(plan, backing);

// handoff is what you post to a Worker / AudioWorklet / simulation worker
worker.postMessage({ type: "handoff", handoff });

// Example controller usage
controller.params.set("timeRatio", 1.5);
controller.params.update({ mode: "granular" });

controller.params.stage("eqBands", (view) => {
  for (let i = 0; i < view.length; i += 1) {
    view[i] = i < 4 ? -3 : 3;
  }
});

const meters = controller.meters.snapshot("rms", "peak", "framesProcessed");
console.log(meters);
```

### 3. Worker / processor side: accept handoff → bind processor

```ts
import {
  acceptHandoff,
  bindProcessor,
  type Handoff,
  type ProcessorBinding,
} from "@seqlok/core";
import type { LaneSpec } from "./spec";

type InitMessage = {
  type: "handoff";
  handoff: Handoff<LaneSpec>;
};

let processor: ProcessorBinding<LaneSpec> | undefined;

self.onmessage = (ev: MessageEvent<InitMessage>) => {
  if (ev.data.type !== "handoff") return;

  const accepted = acceptHandoff(ev.data.handoff);
  processor = bindProcessor(accepted);
};

// Somewhere in your audio loop / worker loop / simulation step
function processBlock(): void {
  if (!processor) return;

  processor.params.within((params) => {
    const { timeRatio } = params;
    const framesForBlock = Math.floor(128 * timeRatio);

    // Use framesForBlock in your engine logic...

    processor.meters.publish((writer) => {
      writer.rms(0.5);
      writer.peak(0.9);

      // Scalar meter: write via function, not stage.
      writer.framesProcessed(framesForBlock);
    });
  });
}
```

---

## Observer: passive telemetry binding

The **observer binding** is a read-only role over the same SWMR backing. It never writes params or meters; it just
samples them coherently.

### Host-side: bind from spec/plan/backing or SharedContext

```ts
import { bindObserver, type ObserverBinding } from "@seqlok/core";
import { laneSpec, type LaneSpec } from "./spec";

// Directly from spec + plan + backing
const plan = planLayout(laneSpec);
const backing = allocateShared(plan);

const observer: ObserverBinding<LaneSpec> = bindObserver(
  laneSpec,
  plan,
  backing,
);
```

Or, if you built a shared context (see next section), you can bind from that.

### Worker-side: bind from an accepted handoff

```ts
import {
  acceptHandoff,
  bindObserver,
  type ObserverBinding,
  type Handoff,
  type AcceptedHandoff,
} from "@seqlok/core";
import type { LaneSpec } from "./spec";

let observer: ObserverBinding<LaneSpec> | undefined;

self.onmessage = (
  ev: MessageEvent<{ type: "handoff"; handoff: Handoff<LaneSpec> }>,
) => {
  if (ev.data.type !== "handoff") return;

  const accepted: AcceptedHandoff<LaneSpec> = acceptHandoff(ev.data.handoff);
  observer = bindObserver(accepted);
};

// Periodic introspect sampling loop
function sampleTelemetry(): void {
  if (!observer) return;

  const meters = observer.meters.snapshot(["rms", "peak"]);
  const params = observer.params.snapshot(["timeRatio", "mode"]);

  // Ship to logging / HUD / time-series DB, etc.
}
```

Observer uses the same seqlock-backed coherence layer as controller/processor, with configurable spin/retry budgets.

---

## Host context helper

For host-side code that reuses the same `{ spec, plan, backing }` across multiple bindings and handoffs, Seqlok exposes
a small ergonomic helper:

```ts
import {
  createSharedContext,
  bindController,
  bindObserver,
  buildHandoff,
  type SharedContext,
} from "@seqlok/core";
import { laneSpec, type LaneSpec } from "./spec";

const ctx: SharedContext<LaneSpec> = createSharedContext(laneSpec);

// Reuse the same triple everywhere
const controller = bindController(ctx);
const observer = bindObserver(ctx);
const handoff = buildHandoff(ctx);
```

This is purely a host convenience; it does not change the underlying canonical flow.

---

## Benchmarks

Seqlok ships micro- and scenario-level benchmarks for both primitives (seqlock, SWSR ring) and end-to-end param/meter
flows.

Run the raw suite:

```bash
pnpm bench
```

This executes all Vitest benches with a JSON reporter and writes the raw report to:

```text
bench-results.json
```

For a human-readable summary suitable for docs:

```bash
pnpm bench:report
```

This is equivalent to:

```bash
pnpm bench && pnpm bench:format
```

- `bench` produces `bench-results.json`.
- `bench:format` (`tsx scripts/format-bench.ts`) reads `bench-results.json` and prints a Markdown-ready summary
  (ASCII charts for hot-path ops and parameter writes) to stdout, and refreshes:

  - `docs/performance/bench-results.generated.md`
  - `docs/performance/bench-results.json`

Treat these numbers as **regression guardrails**, not marketing claims.

---

## Diagnostics / introspection

Diagnostics live on a separate entry point:

```ts
import {
  snapshotCounters,
  resetCounters,
  type IntrospectCountersSnapshot,
} from "@seqlok/core/introspect";
```

Use this surface for:

- Environment probing and SAB/COOP/COEP checks.
- Binding / seqlock counters in stress harnesses.
- Dev overlays and HUDs.

It's designed so diagnostics can be tree-shaken out of production builds when unused.

---

## Documentation

Full design docs live under `packages/core/docs`.

Recommended entry points:

- [`docs/INDEX.md`](./docs/INDEX.md) – map of all architecture docs and ADRs.
- Concurrency model, seqlock rationale, planes layout, and architecture diagrams.
- API reference for the explicit canonical flow:

  - `defineSpec`
  - `planLayout`
  - `allocateShared`
  - `buildHandoff`
  - `acceptHandoff`
  - `bindController` (spec + plan + backing)
  - `bindProcessor`
  - `bindObserver`

---

## License

See the LICENSE file in this repository for current licensing terms.
