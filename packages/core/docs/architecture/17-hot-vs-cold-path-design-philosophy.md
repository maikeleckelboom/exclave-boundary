# Hot Path vs Cold Path: Temperature-Based Design Philosophy

**Type:** Design principle

Seqlok does not treat all runtime calls as morally equivalent.
Some calls belong in bounded loops.
Some calls belong in setup and orchestration.
The API should not lie about that.

This is not a side note about performance.
It is part of how the public surface stays honest.

Related docs:

- `03-seqlok-concurrency-model-and-roles.md`
- `08-seqlok-api-and-naming-rationale.md`
- `09-seqlok-api-reference.md`

---

## 1. The principle

The temperature rule is simple:

- hot-path work should stay narrow, bounded, and explicit
- cold-path work should stay setup-oriented, ergonomic, and explicit
- one verb should not pretend to serve both worlds

A runtime surface becomes dishonest when it hides large differences in cost or semantic expectations behind one generic entrypoint.

Typical failure modes:

- a seemingly cheap call performs large copies
- a convenience API sneaks into a frame loop
- a setup API is treated like a DSP primitive
- a hot-path operation accumulates cold-path validation baggage

Seqlok tries to prevent that by naming the temperatures instead of hiding them.

---

## 2. Hot path

Hot-path operations may run at frame-rate, block-rate, or other tight-loop cadence.

Hot-path properties:

- bounded work matters
- hidden allocation is dangerous
- hidden copying is dangerous
- blocking is unacceptable
- semantic ambiguity becomes a runtime bug fast

Examples in Seqlok:

- `processor.params.within(...)`
- `processor.meters.publish(...)`
- `controller.params.set(...)`
- `controller.params.update(...)`
- `controller.params.stage(...)`
- observer high-frequency read loops

Hot-path APIs should look narrow because they are narrow.

---

## 3. Cold path

Cold-path operations happen during setup, restore, orchestration, inspection, or other human-time workflows.

Cold-path properties:

- ergonomics matter more
- allocation is acceptable
- copying is acceptable when explicit and useful
- richer validation is acceptable
- trust-boundary clarity matters more than shaving tiny overheads

Examples in Seqlok:

- `defineSpec(...)`
- `planLayout(...)`
- `buildHandoff(...)`
- `acceptHandoff(...)`
- `verifyHandoff(...)`
- `controller.params.hydrate(...)`
- full snapshot and restore workflows

Cold-path work is still real work.
It is just not the work you should be smuggling into a tight loop.

---

## 4. Temperature follows role

Seqlok's temperature doctrine is not floating free from its role doctrine.

### Processor

Processor is the hot-path coherent read role for params and the hot-path write role for meters.

- `params.within(...)` is hot-path
- `meters.publish(...)` is hot-path

### Observer

Observer is the dedicated high-frequency read-only role.

That is where Seqlok should center patterns such as:

- HUD loops
- visualization
- telemetry sampling
- dedicated inspection surfaces

Observer exists so the architecture does not have to lie and pretend every high-frequency read belongs on controller.

### Controller

Controller reads are valid and important, but they are the colder-path convenience surface.

That makes controller appropriate for:

- UI refresh
- orchestration
- debugging
- ordinary inspection

When docs lose that role distinction, they usually lose the temperature distinction too.

---

## 5. Hot-path surfaces in core

### `processor.params.within(...)`

This is a hot-path coherent param read window.

What it means:

- read params coherently now
- keep the read window scoped
- do not treat the callback view as ordinary long-lived state

Example:

```ts
processor.params.within((params) => {
  const timeRatio = params["transport.timeRatio"];
  const mode = params["transport.mode"];

  processor.meters.publish((writer) => {
    writer.set("output.rms", 0.42 * timeRatio);
    writer.set("output.peak", mode === 0 ? 0.8 : 0.9);
  });
});
```

### `processor.meters.publish(...)`

This is a hot-path coherent meter commit window.

What it means:

- commit one coherent meter frame now
- keep the write window explicit
- do not blur meter publication with broader orchestration logic

### `controller.params.set(...)` and `update(...)`

These are narrow controller write surfaces that remain acceptable in hot or near-hot controller flows.

That narrowness is the point.
Scalar writes should not look like bulk restore.

### `controller.params.stage(...)`

This is the explicit array-mutation surface.

Array work has different cost and shape from scalar writes.
Seqlok keeps that visible instead of pretending one write verb covers both cleanly.

---

## 6. Cold-path surfaces in core

### `defineSpec(...)`

This is authored-contract work.
It belongs to authorship and setup, not runtime loops.

### `planLayout(...)`

Planning is cold-path work.

It runs after authored meaning has already been normalized and produces a deterministic layout contract.
No one should think of planning as something to redo in ordinary runtime loops.

### `buildHandoff(...)` and `acceptHandoff(...)`

These are setup-path boundary operations.

- `buildHandoff(...)` is owner-side setup work
- `acceptHandoff(...)` is consumer-side trust-boundary work

That boundary matters architecturally.
It is still not hot-path work.

### `controller.params.hydrate(...)`

This is a cold-path bulk state surface.

Good uses:

- preset recall
- restore
- setup
- bulk patch application

Bad use:

- stuffing it into high-frequency loops and pretending it is equivalent to `set(...)`

---

## 7. A simple temperature test for API design

When evaluating or adding an API, ask four questions.

### 1. How often is it expected to run?

- rare or one-time setup → cold
- frame/block/update-loop usage → hot

### 2. What is the latency expectation?

- bounded and tight → hot
- human-time acceptable → cold

### 3. Is copying or allocation acceptable?

- no → hot
- yes, as part of setup or convenience → cold

### 4. Does the name tell the truth?

A good Seqlok verb should help the caller infer the expected temperature.

That is why surfaces like:

- `set`
- `update`
- `stage`
- `within`
- `publish`
- `hydrate`
- `acceptHandoff`

are better than one giant "do everything" abstraction.

---

## 8. Good temperature separation

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  acceptHandoff,
  bindController,
  bindObserver,
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
const observer = bindObserver(acceptHandoff(handoff));

// narrow write
controller.params.set("transport.timeRatio", 1.25);

// bulk restore
controller.params.hydrate({
  "transport.timeRatio": 1.0,
  "transport.mode": "granular",
});

// dedicated read-side loop
function sampleHud() {
  const meters = observer.meters.snapshot(["output.rms", "output.peak"]);
  drawMeters(meters);
}
```

What this gets right:

- authorship and planning stay cold-path
- trust-boundary acceptance stays setup-path
- controller scalar write stays narrow
- controller bulk hydration stays explicit
- observer carries the dedicated high-frequency read role

---

## 9. Bad temperature collapse

```ts
function everyFrame() {
  const freshSpec = defineSpec({
    params: {
      gain: { kind: "f32", min: 0, max: 1 },
    },
    meters: {},
  });

  const plan = planLayout(freshSpec);

  controller.params.hydrate({
    gain: Math.random(),
  });
}
```

What is wrong here:

- authorship is being recreated in a runtime loop
- planning is being treated like ordinary runtime work
- bulk hydration is being used where a narrow write should exist
- setup-path and hot-path concerns are being collapsed into one blob

This is exactly the kind of confusion the temperature doctrine exists to prevent.

---

## 10. What this doctrine is not saying

This document is not claiming:

- that controller reads are invalid
- that all observer work is magically free
- that all setup work is cheap just because it is cold
- that API design can ignore semantics and only think about speed

The point is simpler:

- tell the truth about intended runtime temperature
- keep hot-path and cold-path semantics explicit
- do not let authorship, setup, and runtime loops bleed into one another
