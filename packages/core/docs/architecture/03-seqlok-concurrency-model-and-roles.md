# Seqlok: Concurrency Model & Roles

> How Seqlok coordinates Controllers, Processors, and shared memory.

This document describes **who is allowed to touch what**, **how Seqlok uses seqlocks**, and **what is actually
guaranteed** when you call things like `within`, `publish`, and `snapshot`.

It is the canonical reference for:

- param vs meter ownership,
- SWMR discipline per domain,
- what "coherent snapshot" means in Seqlok.

---

## High-Level Model

Seqlok organizes shared state into two **domains**:

- **Params** – control inputs flowing **from Controller → Processor**
- **Meters** – telemetry outputs flowing **from Processor → Controller / observers**

Each domain is:

- Stored in **shared memory** (`SharedArrayBuffer` or shared `WebAssembly.Memory`)
- Guarded by its own **seqlock** (sequence lock)
- Accessed under strict **SWMR** (Single-Writer / Multiple-Reader) rules

On top of that, Seqlok defines three roles:

```text
Controller:
  - writes params
  - reads meters

Processor:
  - reads params
  - writes meters

Observers / Consumers:
  - read meters (via controller bindings or dedicated observer bindings from `bindObserver`)
```

If you remember only one thing:

> **Controller owns inputs, Processor owns outputs, everyone else is read-only.**

---

## Roles

### Controller

The **Controller** typically lives on the main thread (browser) or a host thread (Node):

- Writes to **params**
- Reads from **meters**
- Never writes meters
- Never calls `within` / `publish` (those are processor-side semantics)

Example (canonical flow up to the Controller binding):

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  bindController,
} from "@seqlok/core";

const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);

// Compatibility check: spec ↔ plan ↔ backing
const controller = bindController(spec, plan, backing);

// controller responsibilities:
controller.params.set("gain", 0.8);
controller.params.update({ cutoff: 1200, resonance: 0.7 });

const meters = controller.meters.snapshot();
console.log(meters.peak, meters.rms);
```

Conceptually, the Controller is **“the human’s hand on the device”**: UI, automation, DAW host, etc.

---

### Processor

The **Processor** lives in a Worker, AudioWorklet, WASM-backed engine, or some other engine-like context:

- Reads **params** using `params.within(...)`
- Writes **meters** using `meters.publish(...)` (and per-field `stage` for array meters)
- Never writes params
- Never reads meters by poking the backing directly

Example (engine-side binding already constructed via `receiveHandoff` → `bindProcessor`):

```ts
import type { ProcessorBinding } from "@seqlok/core";
import type { DemoSpec } from "./spec";

class MyProcessor {
  constructor(private readonly proc: ProcessorBinding<DemoSpec>) {}

  process(input: Float32Array[], output: Float32Array[]): boolean {
    this.proc.params.within((params) => {
      const { gain, cutoff } = params;

      const result = this.dsp.process(input, output, gain, cutoff);

      this.proc.meters.publish((m) => {
        m.peak(result.peak);
        m.rms(result.rms);

        m.spectrum.stage((buf) => {
          buf.set(result.spectrum); // array meter updated atomically
        });
      });
    });

    return true;
  }
}
```

The Processor is **“the device brain”**: runs tight loops, does DSP / simulation, and must obey real-time constraints.

---

### Observers / Consumers

**Observers / consumers** are anything that reads meters but doesn’t own params or meters:

- UI graphs
- Logging/metrics jobs
- Secondary workers doing analysis
- Observer bindings via `bindObserver` (see ADR-00Z)

They should:

- Use **controller-facing APIs** (`controller.meters.snapshot(...)`) or observer helpers
- Never attempt to write into the Seqlok backing directly
- Treat Seqlok as _source-of-truth telemetry_, not as mutable state

Example (controller-side consumer):

```ts
// projection by keys
const { peak, rms } = controller.meters.snapshot(["peak", "rms"]);

drawMeterUI({ peak, rms });
```

---

## Domains and Planes

Seqlok has two logical domains, each backed by several **planes** in a shared backing.

### Param Domain

- **Payload planes**: `PF32`, `PI32`, `PB`

  - `PF32` – `f32` scalars / arrays
  - `PI32` – `i32` scalars / arrays and enum indices
  - `PB` – `bool` scalars / arrays as `0`/`1` bytes

- **Control plane**: `PU`

  - A `Uint32Array` control plane with **exactly two words**: `[LOCK, SEQ]`
  - Guards **all param payload** via a single seqlock

### Meter Domain

- **Payload planes**: `MF32`, `MF64`, `MU32`

  - `MF32` – `f32` scalars / arrays
  - `MF64` – `f64` scalars / arrays (hi-res time / stats)
  - `MU32` – `u32` counters / flags, plus bool meters as `0`/`1` `u32`

- **Control plane**: `MU`

  - A `Uint32Array` control plane with **exactly two words**: `[LOCK, SEQ]`
  - Guards **all meter payload** via a single seqlock

Each domain has:

- One **writer** from Seqlok's perspective (Controller for params, Processor for meters)
- Zero or more **readers**
- Exactly one **seqlock pair** per backing

There is **no single cross-domain seqlock**. Params and meters are separate, each with its own versioning and locking
discipline.

---

## Param Flow (Controller → Processor)

### Controller: Writes

The Controller updates param values through a high-level API that hides Atomics:

```ts
// single-field write
controller.params.set("gain", 0.7);

// multi-field write (batch)
controller.params.update({
  gain: 0.9,
  cutoff: 1500,
});

// staged array update (atomic commit for array param)
controller.params.stage("bands", (view) => {
  for (let i = 0; i < view.length; i++) {
    view[i] = computeBandValue(i);
  }
});
```

Under the hood, the param writer:

1. Begins a param write epoch:

- marks the param `LOCK` as "writer active" (odd value).

2. Writes the relevant scalar and array values into their planes.

3. Ends the epoch:

- returns `LOCK` to an even value, and
- bumps `SEQ` once to indicate a new logical version (the **one-bump rule**).

The Controller is free to call `set` / `update` / `stage` at any time; the seqlock ensures readers either see the **old**
state or the **new** state, but never an in-between mix for the param domain.

---

### Processor: Reads via `within`

On the Processor side, **all coherent param reads** go through:

```ts
proc.params.within((params) => {
  // params is a snapshot for the duration of this callback
});
```

Semantics:

- `within(cb)`:

  - Uses the param seqlock `(PU.LOCK, PU.SEQ)` to obtain a **coherent view**.
  - Spins and retries internally if the Controller is mid-write, with bounded budgets.
  - Passes `cb` a `params` view where:

    - **Scalars** are captured JS values (`number`, `boolean`, enum labels).
    - **Arrays** are ephemeral aliasing views into the backing (no allocation).

The callback is **synchronous and scoped**:

- Do **not** `await` inside `within`.
- Do **not** retain references to `params` or its array views after the callback returns.

**Contract:** Treat the param view as living exactly for the duration of that callback; outside that window, it is
logically invalid.

---

### Param Invariants

With correct usage:

- Each call to `within` sees a param snapshot corresponding to a single param `SEQ` value.

- Snapshots are **monotonic** in version when you poll `params.version()`:

  - `version()` never goes backwards; later snapshots see equal or greater sequence numbers.

- No `within` callback sees a mix of two different param writes; at worst it spins and retries until one is stable or
  times out with a clear error.

Seqlok does **not**:

- Guarantee that every intermediate Controller update is visible to the Processor.
- Guarantee a specific "age" for the snapshot, only that it is **coherent**.

---

## Meter Flow (Processor → Controller / Observers)

### Processor: Writes via `publish` and per-field `stage`

On the Processor side, all meter writes go through:

```ts
proc.meters.publish((m) => {
  m.peak(result.peak);
  m.rms(result.rms);

  m.spectrum.stage((buf) => {
    buf.set(result.spectrum);
  });
});
```

Semantics:

- `publish(cb)`:

  - Begins a meter write epoch (using the meter seqlock `(MU.LOCK, MU.SEQ)`).

  - Provides a **mutable writer** `m` where:

    - Scalar meters are functions: `m.peak(value)`, `m.rms(value)`, …
    - Array meters are written via `m.<key>.stage((view) => { ... })`:

      - `view` is an aliasing TypedArray for that meter payload.
      - You usually do a single `view.set(...)` or a tight loop.

  - Ends the epoch by:

    - restoring `LOCK` to an even value, and
    - bumping `SEQ` once to mark a new committed meter frame.

Multiple `publish` calls per audio quantum are **allowed**. Each one is an independent “meter commit”.

Example with multiple commits derived from one param snapshot:

```ts
proc.params.within((params) => {
  const filtered = this.filter.process(input, params.cutoff);

  // first commit
  proc.meters.publish((m) => {
    m.filterOutRms(this.analyze(filtered));
  });

  const driven = this.drive.process(filtered, params.drive);

  // second commit
  proc.meters.publish((m) => {
    m.finalOutRms(this.analyze(driven));
  });

  return driven;
});
```

Each `publish` creates a distinct meter snapshot; both are derived from the same param snapshot captured by `within`.

---

### Controller / Observer: Reads via `snapshot`

On the Controller side, coherent meter reads go through `snapshot`:

```ts
// full snapshot
const allMeters = controller.meters.snapshot();
drawFullHud(allMeters);

// projection by keys
const { peak, rms } = controller.meters.snapshot(["peak", "rms"]);
drawCompactHud({ peak, rms });

// reuse existing arrays for array meters (no allocations)
const buffers = {
  spectrum: new Float32Array(2048),
};

function frame() {
  const { spectrum } = controller.meters.snapshot(["spectrum"], {
    into: buffers,
  });

  drawSpectrum(spectrum);
  requestAnimationFrame(frame);
}

frame();
```

Semantics:

- `snapshot()`:

  - Uses the meter seqlock `(MU.LOCK, MU.SEQ)` to read a **coherent meter view**.
  - Retries internally if the Processor is mid-write, with bounded budgets.
  - Returns an object with all meter scalars and arrays; arrays are new TypedArrays unless `into` is used.

- `snapshot(keys, options?)`:

  - `keys`: array of meter names (e.g. `['peak', 'rms']`).
  - `options.into`: map of meter names → pre-allocated arrays for array meters.
  - Projects and fills just the requested meters.

For `into` arrays:

- Shape and type are validated against the plan.
- On mismatch, a typed error (`binding.snapshotIntoLengthMismatch` / `binding.shape`) is thrown instead of silently
  truncating.

The snapshot result is **owned by the caller**: once `snapshot` returns, you may keep and reuse the object/arrays.
Ephemeral-view rules apply to processor-side readers/writers, not to controller snapshots.

---

### Meter Invariants

With correct usage:

- Each `snapshot` returns meter values corresponding to a **single** meter `SEQ` value.
- Repeated snapshots see monotonically increasing or equal `SEQ` values.
- No snapshot sees half-written arrays from a single `publish`.
- Multiple `publish` calls between snapshots are fine; the Controller/observer sees the latest committed frame at the
  time of the `snapshot`.

---

## Quantum Scopes & Nested Calls

A very common pattern (especially in audio) is:

```ts
process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
  this.proc.params.within((params) => {
    // 1. read coherent params
    const result = this.dsp.process(inputs, outputs, params);

    // 2. first meter commit: basic level info
    this.proc.meters.publish((m) => {
      m.peak(result.peak);
      m.rms(result.rms);
    });

    // 3. extra analysis
    const more = this.analyze(result);

    // 4. second meter commit: more detailed info
    this.proc.meters.publish((m) => {
      m.spectralCentroid(more.centroid);
    });
  });

  return true;
}
```

Important points:

- All `publish` calls inside one `within` callback are **causally derived** from the same param snapshot.
- They are **not** grouped into a single param+meter transaction; params and meters have independent seqlocks.
- Each `publish` is its own atomic meter commit.

This is the **“quantum scope”** mental model:

> One `within` defines the param snapshot window. Any number of `publish` calls inside that `within` compute and commit
> meters derived from that snapshot.

Seqlok guarantees:

- Param reads inside that `within` are coherent.
- Each meter commit is coherent.
- The pairing (**this snapshot → these meter commits**) is enforced by your code structure, not by a cross-domain
  hardware transaction.

---

## What Seqlok Guarantees (and Does Not)

### Guarantees

Within the documented roles and APIs, Seqlok guarantees:

1. **Per-domain coherence via seqlock**

- Param snapshots from `params.within` are internally consistent.
- Meter snapshots from `meters.snapshot` are internally consistent.

2. **SWMR discipline per domain**

- Exactly one writer for params, one writer for meters (from Seqlok's perspective).

3. **Monotonic versions**

- Param and meter sequence counters are monotonically increasing `u32`s.
- When you poll `version()` and then snapshot, versions never go backwards.

4. **Atomic meter commits**

- All meter changes within one `publish` are committed as a unit.
- Controllers/observers never see half-updated meters from a single `publish`.

5. **Zero allocations in kernel hot paths**

- `params.within` / `meters.publish` do not allocate in the kernel hot path.
- `meters.snapshot` can be allocation-free when you supply `into` buffers.

### Non-Guarantees

Seqlok does **not** guarantee:

1. **Fairness between readers and writers**

- A pathological writer that constantly holds the lock can cause readers to spin more or time out.
- Design intent is that write epochs are relatively short vs read frequency.

2. **Cross-domain transactions**

- There is no atomic "params + meters move together" transaction across both domains.
- Params and meters are separate; your code expresses the causal relationship.

3. **Async safety inside callbacks**

- If you `await` inside `within` or `publish`, you violate the design; behaviour is undefined and can break invariants.

4. **Protection against misuse of views**

- JS cannot prevent you from storing internal aliasing views and using them later.
- The **contract** is that you treat those views as scoped to the callback that provided them.

---

## Execution Example: AudioWorklet Pattern

Golden-flow wiring for a typical browser + AudioWorklet setup.

### Controller (main thread)

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  bindController,
} from "@seqlok/core";

const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);

// Controller binding (spec + plan + backing cross-check)
const controller = bindController(spec, plan, backing);

// Handoff envelope for the worklet
const handoff = buildHandoff(plan, backing);

audioContext.audioWorklet.addModule("processor.js").then(() => {
  const node = new AudioWorkletNode(audioContext, "my-processor", {
    processorOptions: { seqlok: handoff },
  });

  // UI → params
  slider.oninput = (e) => {
    controller.params.set("gain", e.valueAsNumber);
  };

  // meters → UI
  function updateMeters() {
    const { peak, rms } = controller.meters.snapshot(["peak", "rms"]);
    ui.setPeak(peak);
    ui.setRms(rms);
    requestAnimationFrame(updateMeters);
  }

  updateMeters();
});
```

### Processor (AudioWorkletGlobalScope / worker)

```ts
import {
  receiveHandoff,
  bindProcessor,
  type ProcessorBinding,
} from "@seqlok/core";
import type { DemoSpec } from "./spec";

class MyProcessor extends AudioWorkletProcessor {
  private readonly binding: ProcessorBinding<DemoSpec>;

  constructor(opts: { processorOptions: { seqlok: unknown } }) {
    super();

    const received = receiveHandoff<DemoSpec>(opts.processorOptions.seqlok);
    this.binding = bindProcessor(received);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.binding.params.within((params) => {
      const out = this.dsp.process(inputs[0][0], outputs[0][0], params.gain);

      this.binding.meters.publish((m) => {
        m.peak(out.peak);
        m.rms(out.rms);
      });
    });

    return true;
  }
}

registerProcessor("my-processor", MyProcessor);
```

This is the canonical **Controller ↔ Processor** Seqlok pipeline:

- Main side: `defineSpec → planLayout → allocateShared → buildHandoff → bindController`
- Worklet side: `receiveHandoff → bindProcessor`

All shared state is in planes under seqlock; all accesses go through bindings.

---

## Design Invariants (for Contributors)

Internally, the concurrency model relies on several invariants that **must not be broken**:

1. **All shared-state reads/writes go through bindings or primitives**

- No high-level module should call `Atomics.*` on planes directly.
- Only the primitives layer (`seqlock`, `atomics`) touches `Atomics`.

2. **Roles are enforced at the API level**

- `bindController` must not expose meter write capabilities.
- `bindProcessor` must not expose param write capabilities.

3. **Callbacks are synchronous**

- `within` and `publish` must not be `async`.
- Hot-path callbacks are assumed to complete quickly.

4. **One control pair per domain per backing**

- Exactly one param seqlock (`PU`) and one meter seqlock (`MU`) per backing.
- No per-field seqlocks.

5. **Specs are structural, not behavioural**

- No field-level concurrency flags or ad-hoc semantics.
- Concurrency semantics are always the same: snapshot for params, commit for meters.

If you extend Seqlok's capabilities (e.g. observer bindings, MWMR ring topologies), check any new feature against these
invariants first and keep the **kernel** firmly in the SWMR + seqlock model.

---

## Summary

The concurrency model of Seqlok in one line:

> **One writer per domain, shared memory guarded by seqlocks, exposed through scoped callbacks (`within` / `publish`) and seqlock-guarded snapshots, so coherent use is the default.**

Everything else — spec, plan, backing, handoff, bindings, observers — exists to make that model:

- **Fast enough** for real-time code
- **Safe enough** for shared memory
- **Clear enough** that you can reason about it at 2am without hating future-you.
