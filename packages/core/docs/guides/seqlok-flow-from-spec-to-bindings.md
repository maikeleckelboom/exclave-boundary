# Seqlok Canonical Flow: From Spec to Bindings

> *How a param/meter schema becomes shared memory + bindings.*

This guide describes the **end-to-end pipeline** that Seqlok follows for all
shared-memory bindings:

> **Spec → Plan → Allocate → Handoff → Bind Controller → Bind Consumers**

It explains how a param/meter schema becomes:

* a **controller** on the owner side (UI / host), and
* one or more **consumer bindings** (processor, observers, analyzers) on the other side,

all over a single planned backing.

There are no shortcuts in `@seqlok/core`: every binding follows this flow in order.

---

## 1. Stage overview

At a high level:

1. **Spec** – describe *what exists*: params + meters and their types.
2. **Plan** – compute *how it is laid out* in memory.
3. **Allocate** – allocate backing memory that matches the plan.
4. **Handoff** – wrap backing + layout into an envelope and move it across a trust boundary.
5. **Bind Controller** – bind owner-side controller: param writers + meter readers.
6. **Bind Consumers** – bind one or more consumer roles: processors, observers, telemetry.

Key invariant:

> **`planLayout` is called exactly once per spec.
> All later stages consume a `Plan`; none of them recompute it.**

---

## 2. Canonical TypeScript flow (1× controller, N× consumers)

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  allocateSharedPartitioned,
  allocateWasmShared,
  buildHandoff,
  receiveHandoff,
  bindController,
  bindProcessor,
  // future: bindObserver, bindTelemetry, ...
} from '@seqlok/core';

// ── Spec ───────────────────────────────────────────────────────────────────────

const spec = defineSpec(({ param, meter }) => ({
  params: {
    rate: param.f32({ min: 0.5, max: 2 }),
    mode: param.enum(['a', 'b']),
  },
  meters: {
    peak: meter.f32(),
  },
}));

// ── Plan ──────────────────────────────────────────────────────────────────────

const plan = planLayout(spec);

// ── Allocate ──────────────────────────────────────────────────────────────────

const backing = allocateShared(plan);
// or: const backing = allocateSharedPartitioned(plan);
// or: const backing = allocateWasmShared(plan);

// ── Handoff (host side) ──────────────────────────────────────────────────────

const handoff = buildHandoff(plan, backing);

// ── Bind Controller (host side) ──────────────────────────────────────────────

const controller = bindController(spec, plan, backing);

// ── Handoff (worker side) ────────────────────────────────────────────────────

const received = receiveHandoff(handoff);

// ── Bind Consumers (worker side) ─────────────────────────────────────────────

// Primary consumer (audio / game loop / worker)
const processor = bindProcessor(received);

// Future additional consumers on the same backing:
// const observer  = bindObserver(received);
// const introspect = bindTelemetry(received);
```

Notes:

* The **order** between `bindController` and `buildHandoff` on the host is flexible:
  you can bind the controller before or after `buildHandoff` as long as you stay in
  the **Spec → Plan → Allocate → Handoff → Bind** domain order.
* On the worker side, `receiveHandoff` is always the entry point before any consumer
  bindings.

---

## 3. Stage-by-stage semantics

### 3.1 Spec (Schema)

**Domain:** schema / intent
**Input:** none (host code)
**Output:** `Spec<S>` (internal type parameterised by the user’s shape)

Responsibilities:

* Define **params** (control inputs) and **meters** (observability outputs).
* Capture only *types* and *ranges*, not layout or backing.

Constraints:

* Numeric params use the range-only DSL `{ min, max }`.
* No `default`, `step`, or `origin` at the spec layer.
* Any defaults, snapping, and UX behavior live in the application / UI.

Example:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    gain: param.f32({ min: 0, max: 2 }),
    mode: param.enum(['normal', 'granular']),
  },
  meters: {
    peak: meter.f32(),
  },
}));
```

Error namespace: `spec.*`.

---

### 3.2 Plan (Layout)

**Domain:** layout & memory planning
**Input:** `spec`
**Output:** `Plan<S>`

Responsibilities:

* Decide **plane structure** (which fields live in which typed arrays).
* Assign byte offsets and lengths.
* Compute total memory requirements.

Constraints:

* Pure function: deterministic for a given `spec`.
* No allocation; only numbers and shapes.

Example:

```ts
const plan = planLayout(spec);
```

Error namespace: `plan.*`.

Implementation rule:

> Only the planning stage is allowed to call `planLayout`.
> All later stages must receive a `Plan` instead of reconstructing it.

---

### 3.3 Allocate (Backing)

**Domain:** actual memory
**Input:** `Plan<S>`
**Output:** `Backing` (SAB or Wasm memory views)

Responsibilities:

* Allocate buffers that match the plan's plane sizes.
* Construct typed views (`Float32Array`, `Int32Array`, etc.).

Allocators:

```ts
const contiguous = allocateShared(plan);             // single SAB, contiguous
// or
const partitioned = allocateSharedPartitioned(plan); // one SAB per plane
// or
const wasmShared = allocateWasmShared(plan);         // backed by WebAssembly.Memory
```

Error namespace: `backing.*`.

---

### 3.4 Handoff (Envelope / Relay)

**Domain:** crossing trust boundaries
**Inputs:** `Plan<S>`, `Backing`
**Outputs:** `Handoff<S>` (sender side), `ReceivedHandoff<S>` (receiver side)

Responsibilities:

* Package the backing + layout into a **serializable envelope**.
* Validate that what arrives on the other side is coherent with the plan.
* Own the **envelope protocol**: nothing else reaches across the boundary.

Host side:

```ts
const handoff = buildHandoff(plan, backing);
```

Worker side:

```ts
const received = receiveHandoff(handoff);
```

`ReceivedHandoff<S>` is the normalized view of the backing, ready to be used by consumer bindings.
`Handoff<S>` itself should be treated as an **opaque transport envelope**:

* Application code obtains it from `buildHandoff(plan, backing)`.
* Application code passes it into `receiveHandoff(handoff)`.
* All layout metadata is carried via the embedded `Plan<S>`; the envelope does not re-plan.

Spec/layout compatibility across processes is enforced via a structural notion of plan equality
(e.g. a deterministic hash stored alongside the plan).

Error namespace: `handoff.*`.

Internal rule:

* Helpers that reconstruct typed views stay inside the handoff/backing layers;
  public consumers see only `Handoff` / `ReceivedHandoff`.

---

### 3.5 Bind Controller (owner-side binding)

**Domain:** owner-side binding

**Inputs:**

* `spec` — for typed API shape (keys, enums, etc.)
* `plan` — for introspection/diagnostics and compatibility checks
* `backing` — the actual memory

**Output:** `ControllerBinding<S>`

Responsibilities:

* Provide **param writers** on the host side:

  ```ts
  controller.params.set('gain', 0.8);
  controller.params.update({ cutoff: 1200, resonance: 0.7 });
  controller.params.stage('bands', (view) => {
    // RAII array write, single LU bump
    for (let i = 0; i < view.length; i++) {
      view[i] = computeBandValue(i);
    }
  });
  ```

  * `params.set(key, value)`
  * `params.update(patch)` – single LU bump
  * `params.stage(key, cb(view))` – RAII array writes, single LU bump

* Provide **meter readers**:

  ```ts
  const meters = controller.meters.snapshot();
  const { peak, rms } = controller.meters.snapshot(['peak', 'rms']);
  const { spectrum } = controller.meters.snapshot(['spectrum'], {
    into: { spectrum: preallocatedSpectrum },
  });
  ```

  * `meters.snapshot(...)` is the canonical read API (positional and `{ keys, into }` forms).

The controller does not expose seqlock details directly; versioning and retry semantics are handled internally.

Signature:

```ts
const controller = bindController(spec, plan, backing);
```

Error namespace: `binding.controller.*`.

---

### 3.6 Bind Consumers (processors, observers, telemetry)

**Domain:** consumer-side bindings on the receiver side

**Inputs:**

* `ReceivedHandoff<S>` — validated backing + layout (includes `Plan<S>`)

**Output:**

* One or more bindings over the same backing, for different roles

Today's canonical consumer:

```ts
const processor = bindProcessor(received);
```

`ProcessorBinding<S>` is allowed to:

* Read params via **coherent windows**:

  ```ts
  processor.params.within((params) => {
    const gain = params.gain;
    const mode = params.mode;
    const eqCurve = params.eqCurve;

    // use params for DSP…
  });
  ```

  * Scalars are copied values captured at the version.
  * Arrays are scratch views valid only inside the callback.

* Publish meters via a **single MU-scoped callback**:

  ```ts
  processor.meters.publish((meters) => {
    meters.peak(currentPeak);
    meters.stage('spectrum', (view) => {
      view.set(currentSpectrum);
    });
  });
  ```

Error namespace: `binding.processor.*`.

The flow intentionally supports **N ≥ 1 consumer bindings** off the same `ReceivedHandoff<S>`:

* `bindProcessor(received)` – primary SWMR writer of meters for that meter domain.
* `bindObserver(received)` – future read-only binding (params + meters).
* `bindTelemetry(received)` – future binding that exports state elsewhere.

Each binding:

* Shares the same underlying planes.
* Respects the same seqlock / SWMR guarantees.
* Differs only in *capabilities* (what you can read/write).

---

## 4. Multiple consumer bindings in practice

Pattern with multiple consumer roles on a single handoff:

```ts
// Host ─────────────────────────────────────────────────────────────────────────

const spec = defineSpec(({ param, meter }) => ({
  params: {
    rate: param.f32({ min: 0.5, max: 2 }),
  },
  meters: {
    rms: meter.f32(),
  },
}));

const plan = planLayout(spec);
const backing = allocateShared(plan);
const handoff = buildHandoff(plan, backing);

const controller = bindController(spec, plan, backing);

// Worker ───────────────────────────────────────────────────────────────────────

const received = receiveHandoff(handoff);

// Primary engine
const processor = bindProcessor(received);

// Future additional roles on the same backing:
// const observer  = bindObserver(received);
// const introspect = bindTelemetry(received);
```

Typical uses:

* **Processor** drives audio: reads params, writes meters.
* **Observer** runs in a visualization worker: reads params/meters to feed WebGPU.
* **Telemetry** streams snapshots to a remote debugger or log sink.

No copies, no extra handoffs: just more bindings over the same seqlock-protected planes.

---

## 5. Cross-language canonical flow

The same stages apply in C/C++/Rust bindings that want to be Seqlok-compatible:

```cpp
// C++ sketch (API names illustrative)

// Spec
Spec       define_spec(/* ... */);

// Plan
Plan       plan_layout(const Spec& spec);

// Allocate
Backing    allocate_shared(const Plan& plan);
// or: Backing allocate_shared_partitioned(const Plan& plan);
// or: Backing allocate_wasm_shared(const Plan& plan);

// Handoff
Handoff    build_handoff(const Plan& plan, const Backing& backing);
Received   receive_handoff(const Handoff& handoff);

// Bind Controller
Controller bind_controller(const Spec& spec,
                           const Plan& plan,
                           const Backing& backing);

// Bind Consumers
Processor  bind_processor(const Received&);
// Observer  bind_observer(const Received&);
// Telemetry bind_telemetry(const Received&);
```

Any implementation that:

* follows **Spec → Plan → Allocate → Handoff → Bind Controller → Bind Consumers** in this domain order, and
* respects the same SWMR / seqlock semantics,

is a valid Seqlok pipeline, even if the exact function names differ.

---

## 6. Design rules: the canonical flow as a hard contract

1. **Ordering is non-negotiable**

* Spec → Plan → Allocate → Handoff → Bind Controller → Bind Consumers is the
  only legal dependency chain inside `@seqlok/core`.
* Higher-level helpers may wrap stages, but they cannot merge or reorder domains.

2. **No hidden planning or allocation**

* `bindController`, `bindProcessor`, and future consumer roles must never call
  `planLayout` or allocate backing.
* They only bind views onto an existing `Plan` + backing / `ReceivedHandoff`.

3. **Final naming / semantics**

* `defineSpec`, `planLayout`,
  `allocateShared` / `allocateSharedPartitioned` / `allocateWasmShared`,
  `buildHandoff`, `receiveHandoff`,
  `bindController(spec, plan, backing)`, `bindProcessor(received)`.
* No `setMany`, no `meters.sample`, no DSL defaults/steps/origins.

4. **Multiple consumer bindings are encouraged but structured**

* The flow explicitly supports multiple consumer bindings over the same handoff.
* Only one role (the processor) may publish meters for a given meter domain;
  other roles are read-only or use dedicated planes planned up front.

As long as every engine, observer, and analyzer stays on this canonical flow, hot-swap
flows, multi-engine setups, and parallel visualizations all compose cleanly.
