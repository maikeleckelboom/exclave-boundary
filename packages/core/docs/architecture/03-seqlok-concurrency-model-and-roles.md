# Seqlok: Concurrency Model and Roles

> How Seqlok coordinates controller, processor, and observer roles over a shared-memory substrate.

This document defines:

- who is allowed to touch what
- the per-domain SWMR law
- what `within`, `publish`, and `snapshot` actually guarantee
- how controller, processor, and observer differ

If you want the cleanest runtime ownership model for Seqlok, start here.

---

## 1. The runtime law

Seqlok is built on three rules.

### Rule 1: there are two domains

Seqlok organizes shared state into:

- **params**
- **meters**

Those domains are separate on purpose.
They do not share one cross-domain transaction lock.
They each have their own control state and sequence progression.

### Rule 2: each domain has one writer

Each domain has:

- one explicit writer
- zero or more readers
- its own seqlock control pair

Ownership is fixed:

- **Param domain**

  - writer: controller
  - readers: processor, observer

- **Meter domain**
  - writer: processor
  - readers: controller, observer

This is not a convenience guideline.
It is the concurrency law the design depends on.

### Rule 3: Seqlok has three first-class roles

The public runtime model is not "controller and maybe some readers."
It is:

- **Controller**
- **Processor**
- **Observer**

If you remember one line, remember this:

> Controller writes params and reads meters. Processor reads params and writes meters. Observer reads params and meters.

---

## 2. Canonical runtime flow

The canonical flow stays split across owner side and consumer side.

```text
owner side:
  defineSpec → planLayout → allocateShared → buildHandoff → bindController

consumer side:
  acceptHandoff → bindProcessor
                 → bindObserver
```

That split matters.

- The owner side authors, plans, allocates, and hands off the substrate.
- The consumer side accepts that handoff and binds a role onto it.
- The consumer side does not reinterpret authored meaning.
- The trust boundary is explicit, not hidden inside role binding.

---

## 3. Seqlock structure

Each domain is guarded by its own seqlock control pair.

Conceptually:

```text
params:
  control plane PU = [LOCK, SEQ]

meters:
  control plane MU = [LOCK, SEQ]
```

Meaning:

- `LOCK` is odd while the writer is active
- `LOCK` is even while quiescent
- `SEQ` advances once per successful commit

There is no claim here of one cross-domain transaction.
Params and meters are separate domains with separate commit progression.

---

## 4. Controller

The controller is the authoritative writer for params.

### Responsibilities

The controller:

- commits param changes
- may read meter state for UI and orchestration
- never writes meter state

Typical homes:

- main thread
- host process
- orchestration side

Example:

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  bindController,
} from "@seqlok/core";

const spec = defineSpec(({ param, meter }) => ({
  id: "lane",
  params: {
    transport: {
      timeRatio: param.f32({ min: 0.25, max: 4 }),
      mode: param.enum(["normal", "granular"]),
    },
  },
  meters: {
    output: {
      rms: meter.f32(),
      peak: meter.f32(),
    },
  },
}));

const plan = planLayout(spec);
const backing = allocateShared(plan);
const handoff = buildHandoff(plan, backing);

const controller = bindController(spec, plan, backing);

controller.params.set("transport.timeRatio", 1.25);
controller.params.update({
  "transport.mode": "granular",
});

const meters = controller.meters.snapshot(["output.rms", "output.peak"]);
```

### What controller writes guarantee

Param writes from the controller are seqlock-protected commits.

Conceptually, one commit does this:

1. mark the param lock active
2. update payload bytes
3. complete the write epoch
4. advance the param sequence once

The practical effect is simple:

- processor and observer do not treat half-written param state as a valid coherent read

### What controller reads are for

Controller meter reads are valid and useful, but they are the colder-path convenience read surface.

That makes controller appropriate for:

- UI refresh
- orchestration
- debugging
- host-side inspection

Controller is not the role Seqlok centers for dedicated high-frequency reads.
That role belongs to observer.

---

## 5. Processor

The processor is the authoritative writer for meters and the hot-path reader of params.

### Responsibilities

The processor:

- reads params coherently via `within(...)`
- writes meters coherently via `publish(...)`
- never writes params

Typical homes:

- worker
- `AudioWorklet`
- engine loop
- other time-critical execution boundaries

Example:

```ts
import {
  acceptHandoff,
  bindProcessor,
  type Handoff,
  type ProcessorBinding,
} from "@seqlok/core";
import type { LaneSpec } from "./spec";

let processor: ProcessorBinding<LaneSpec> | undefined;

self.onmessage = (
  ev: MessageEvent<{ type: "handoff"; handoff: Handoff<LaneSpec> }>,
) => {
  if (ev.data.type !== "handoff") return;
  processor = bindProcessor(acceptHandoff(ev.data.handoff));
};

function processBlock(): void {
  if (!processor) return;

  processor.params.within((params) => {
    const timeRatio = params.transport.timeRatio;

    processor.meters.publish((writer) => {
      writer.set("output.rms", 0.42 * timeRatio);
      writer.set("output.peak", 0.81 * timeRatio);
    });
  });
}
```

### `within(...)`

`processor.params.within(...)` is the hot-path coherent param read window.

It guarantees:

- the callback sees one coherent param-domain state
- if a param write is in flight, the read machinery spins or retries within configured budgets
- the callback is synchronous and scoped

It does **not** guarantee:

- that every intermediate controller write is observed
- any cross-domain atomicity with meters

### `publish(...)`

`processor.meters.publish(...)` is the hot-path meter commit window.

It guarantees:

- all writes in that publish block form one coherent meter commit
- readers do not observe a half-written meter frame from that publish window
- the meter sequence advances once per successful publish

That is the processor-side write law.

---

## 6. Observer

Observer is the first-class read-only role for high-frequency read scenarios.

### Responsibilities

Observer:

- reads params
- reads meters
- shares the same accepted handoff substrate as processor
- never becomes a writer

Typical homes:

- HUDs
- inspectors
- telemetry workers
- visualization surfaces

Example:

```ts
import {
  acceptHandoff,
  bindObserver,
  type Handoff,
  type ObserverBinding,
} from "@seqlok/core";
import type { LaneSpec } from "./spec";

let observer: ObserverBinding<LaneSpec> | undefined;

self.onmessage = (
  ev: MessageEvent<{ type: "handoff"; handoff: Handoff<LaneSpec> }>,
) => {
  if (ev.data.type !== "handoff") return;
  observer = bindObserver(acceptHandoff(ev.data.handoff));
};
```

### Why observer exists

Controller-side reads are useful, but controller is not the dedicated high-frequency read role.

Observer exists so Seqlok can say something plain and honest:

- controller is orchestration-oriented and reads meters as a colder-path convenience surface
- observer is the explicit high-frequency read-side role

That keeps the role model honest and keeps temperature doctrine aligned with ownership doctrine.

### Observer semantics

Observer shares the same underlying substrate and the same seqlock discipline.

That means:

- param reads are coherent according to param-domain read rules
- meter reads are coherent according to meter-domain read rules
- observer adds readers, not writers

Observer does not weaken SWMR because it does not introduce another write owner.

---

## 7. Domain flow

### Param flow

The param domain flows from controller to processor and observer.

```text
controller writes params
        │
        ▼
  param domain seqlock
        │
        ├──► processor reads params coherently
        └──► observer reads params coherently
```

Key point: each successful coherent param read corresponds to one stable param-domain commit view.

### Meter flow

The meter domain flows from processor to controller and observer.

```text
processor writes meters
        │
        ▼
  meter domain seqlock
        │
        ├──► controller snapshots / reads meters
        └──► observer reads meters coherently
```

Key point: each successful coherent meter read corresponds to one stable meter-domain commit view.

---

## 8. What coherence means here

Seqlok coherence is **per-domain coherence**.

### Param coherence

Inside one successful coherent param read window:

- values come from one stable param-domain state
- readers do not observe a torn param write as a valid coherent snapshot

### Meter coherence

Inside one successful coherent meter read window:

- values come from one stable meter-domain state
- readers do not observe a torn meter publish as a valid coherent snapshot

### What Seqlok does not claim

Seqlok does not claim:

- one cross-domain transaction covering both params and meters
- fairness guarantees between all readers and writers
- that every intermediate commit must be observed by every reader

That would be a different system.

---

## 9. Temperature and role

The role model and the temperature model reinforce each other.

### Processor

Processor is the hot-path role for coherent param reads and meter writes.

- `params.within(...)` is hot-path
- `meters.publish(...)` is hot-path

### Observer

Observer is the first-class high-frequency read role.

It is the cleanest place to put:

- high-frequency visualization
- telemetry sampling
- dedicated inspection loops

### Controller

Controller reads remain valid, but they are the colder-path convenience surface.

That makes controller right for:

- UI refresh
- app orchestration
- ordinary inspection

When docs blur those distinctions, the concurrency model starts sounding fuzzier than it really is.

---

## 10. What Seqlok guarantees

Within the documented role model, Seqlok guarantees:

1. **One writer per domain**

   - controller owns param writes
   - processor owns meter writes

2. **Per-domain coherence**

   - coherent param reads
   - coherent meter reads

3. **Role separation**

   - controller does not become a meter writer
   - processor does not become a param writer
   - observer remains read-only

4. **Independent domain control**

   - params and meters have separate lock and sequence progression

5. **Explicit consumer-side trust boundary**
   - consumer roles attach after `acceptHandoff(...)`

---

## 11. What Seqlok does not guarantee

Seqlok does not guarantee:

- multi-writer domains
- cross-domain atomic transactions
- async-safe callback usage inside coherent windows
- fairness across all readers and writers under pathological behavior
- protection from code that violates the scoped usage contract intentionally

Those non-guarantees are not accidental omissions.
They are part of keeping the kernel narrow and legible.
