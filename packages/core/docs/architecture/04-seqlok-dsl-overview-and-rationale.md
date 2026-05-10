# Seqlok Spec & DSL: Overview and Rationale

> _The spec is the "truth of the device"; everything else is derived._

This document explains:

- What a **Spec** is in Seqlok
- How the **DSL** is structured
- What the design **does and does not** allow
- How the spec feeds into the **Spec → Plan → Backing → Handoff → Bindings** pipeline

If you're defining devices, binding controllers/processors, or extending Seqlok, this is your reference.

---

## 1. What is a Spec?

In Seqlok, a **spec** is a _pure description_ of:

- Which **params** (inputs) a device exposes
- Which **meters** (outputs) it produces
- Their **types**, **ranges**, and **shapes**

A spec is:

- **Pure data definition** — no references to `SharedArrayBuffer`, `Atomics`, or workers
- **Schema-only** — structure and constraints, no behavior
- **Deterministic** — same spec → same plan → same bindings

Example:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    gain: param.f32({ min: 0, max: 2 }),
    cutoff: param.f32({ min: 20, max: 20_000 }),
    bypass: param.bool(),
    mode: param.enum(["normal", "granular", "freeze"]),
    bands: param.f32.array({ length: 8 }),
  },
  meters: {
    peak: meter.f32(),
    rms: meter.f32(),
    spectrum: meter.f32.array({ length: 1024 }),
  },
}));
```

From here, the rest of the pipeline is:

```ts
// owner / controller side
const plan = planLayout(spec);
const backing = allocateShared(plan);
const handoff = buildHandoff(plan, backing);

const controller = bindController(spec, plan, backing, {
  params: { rangePolicy: "clamp" },
});

// processor / engine side (worker, AudioWorklet, etc.)
const accepted = acceptHandoff(handoff);
const processor = bindProcessor(accepted);
```

The **Spec** is the only place you describe the shared state. Everything else (plan, shared memory, handoff, bindings) is
derived.

---

## 2. Design Principles of the DSL

The DSL is intentionally narrow and opinionated.

### 2.1 Structural, Not Behavioral

The spec defines:

- **Types**: float, int, bool, enum, arrays of these
- **Shapes**: scalar vs fixed-length array
- **Constraints**: numeric ranges, enum domains

The spec does **not** define:

- Default values (those are handled at a higher layer)
- UI hints like step size, units, labels, color
- Automation curves, smoothing, ramps
- Behavior flags ("this param is smoothed", "this meter is decimated")

Reason: the spec must be:

- Stable across contexts (UI, worker, Wasm)
- Easy to map to **raw memory**
- Easy to reason about in terms of plan and type inference

Behavior and UI concerns live in _other_ layers.

---

### 2.2 Schema-First and Deterministic

Given the same `defineSpec` call, Seqlok must always:

- Produce the same **plan** (same plane sizes, same offsets)
- Allocate the same **backing** for shared memory
- Compute the same **spec hash** for compatibility checks

This is why:

- All containers (arrays) are **fixed-length**.
- Enums are **closed sets** of string literals.
- Numeric ranges are simple `{ min, max }` shapes.

No dynamic field addition, no polymorphic shapes.

---

### 2.3 Type-Safe

The DSL is designed so TypeScript can:

- Infer controller param types from the spec
- Infer processor param/meter view types from the spec
- Reject invalid keys and values at compile time

A typical pattern:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    filterType: param.enum(["lowpass", "highpass", "bandpass"]),
    drive: param.f32({ min: 0, max: 24 }),
  },
  meters: {
    driveRms: meter.f32(),
  },
}));

const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, plan, backing);

// TS knows filterType is 'lowpass' | 'highpass' | 'bandpass'
controller.params.set("filterType", "lowpass"); // ✅
controller.params.set("filterType", "notch"); // ❌ compile-time error
```

The DSL itself is structured to preserve good literal types and avoid leakage.

---

## 3. High-Level Shape of the DSL

The canonical pattern is:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    // param definitions here
  },
  meters: {
    // meter definitions here
  },
}));
```

- `param` and `meter` are _builder namespaces_.
- You use them to construct **typed descriptors**.
- The return value is a plain object with `params` and `meters` fields.

### 3.1 Param Families

The `param` builder offers (core families):

- `param.f32({ min, max })`
- `param.i32({ min, max })`
- `param.bool()`
- `param.enum([...])`
- `param.f32.array({ length })`
- `param.i32.array({ length })`
- `param.enum.array({ values, length })`

Example:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    gain: param.f32({ min: 0, max: 2 }),
    voices: param.i32({ min: 1, max: 16 }),
    bypass: param.bool(),
    waveform: param.enum(["sine", "square", "saw"]),
    bands: param.f32.array({ length: 8 }),
    steps: param.enum.array({ values: ["off", "on"], length: 16 }),
  },
  meters: {
    /* ... */
  },
}));
```

### 3.2 Meter Families

The `meter` builder parallels the param shapes (but meters are always processor-written):

- `meter.f32()`
- `meter.f32.array({ length })`

Depending on the implementation, there may also be integer or 64-bit families (e.g. `meter.u32()`, `meter.f64()`),
but the core idea remains:

- Scalars for simple metrics (`peak`, `rms`, `latencyMs`).
- Fixed-length arrays for spectra, histograms, etc.

Example:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    /* ... */
  },
  meters: {
    peak: meter.f32(),
    rms: meter.f32(),
    latencyMs: meter.f32(),
    spectrum: meter.f32.array({ length: 1024 }),
  },
}));
```

---

## 4. Param Types in Detail

### 4.1 `param.f32({ min, max })`

Represents a **single precision float** control value.

- Stored in a float param plane (e.g. `PF32`).
- Logically constrained to `[min, max]` (enforced at the Controller layer).
- Exposed as `number` in both controller and processor bindings.

Example:

```ts
frequency: param.f32({ min: 20, max: 20_000 });
```

Usage:

```ts
// controller
controller.params.set("frequency", 440);

// processor
processor.params.within((p) => {
  const f = p.frequency; // number
});
```

---

### 4.2 `param.i32({ min, max })`

Represents a **32-bit signed integer** param.

Example:

```ts
voices: param.i32({ min: 1, max: 16 });
```

Usage:

```ts
controller.params.set("voices", 8); // ✅
controller.params.set("voices", 2.5); // ❌ logically invalid (integer domains)

processor.params.within((p) => {
  const voices = p.voices; // number (int domains), but logically integral
});
```

---

### 4.3 `param.bool()`

Represents a **boolean control**.

Example:

```ts
bypass: param.bool();
```

Usage:

```ts
controller.params.set("bypass", true);

processor.params.within((p) => {
  if (p.bypass) {
    // quickly copy input to output
  }
});
```

---

### 4.4 `param.enum([...])`

Represents a **closed-set string enum**.

Example:

```ts
filterType: param.enum(["lowpass", "highpass", "bandpass"]);
```

Usage:

```ts
// controller
controller.params.set("filterType", "lowpass"); // ✅
controller.params.set("filterType", "notch"); // ❌ compile error

// processor
processor.params.within((p) => {
  switch (p.filterType) {
    case "lowpass":
      // ...
      break;
    case "highpass":
      // ...
      break;
    case "bandpass":
      // ...
      break;
  }
});
```

Internally, Seqlok stores **indices** (e.g. `0, 1, 2`) in an integer plane, not raw strings. This keeps the memory plan
compact and friendly to Wasm/FFI.

> **Note:** See `14-enum-arrays-runtime-behavior.md` for details on how enum arrays map strings to indices at runtime.

---

### 4.5 Array Params

Arrays are always **fixed-length** and represent structured control inputs:

- `param.f32.array({ length })`
- `param.i32.array({ length })`
- `param.enum.array({ values, length })`

Examples:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    // 8-band gain curve
    bandGains: param.f32.array({ length: 8 }),

    // 16-step sequencer (on / off)
    steps: param.enum.array({ values: ["off", "on"], length: 16 }),
  },
  meters: {
    /* ... */
  },
}));
```

Usage:

```ts
// controller: full-array write via update
controller.params.update({
  bandGains: [
    /* full array content */
  ],
});

// processor: read as read-only view
processor.params.within((p) => {
  const bands = p.bandGains; // readonly-ish Float32Array-like view
  const first = bands[0];
});
```

**Design choice:** arrays have **fixed length**; you don’t resize them at runtime. If length needs to change, define a
new spec.

---

## 5. Meter Types in Detail

Meters follow similar shapes, but they are written by the Processor and read by the Controller.

### 5.1 Scalar Meters

Examples:

```ts
const spec = defineSpec(({ meter, param }) => ({
  params: {
    /* ... */
  },
  meters: {
    peak: meter.f32(),
    rms: meter.f32(),
    latencyMs: meter.f32(),
    xruns: meter.f32(),
  },
}));
```

Usage:

```ts
// processor
processor.meters.publish((m) => {
  m.peak(peak);
  m.rms(rms);
  m.latencyMs(latency);
  m.xruns(xruns);
});

// controller
const meters = controller.meters.snapshot();
console.log(meters.peak, meters.rms, meters.latencyMs);
```

---

### 5.2 Array Meters

Examples:

```ts
const spec = defineSpec(({ meter, param }) => ({
  params: {
    /* ... */
  },
  meters: {
    spectrum: meter.f32.array({ length: 2048 }),
    histogram: meter.f32.array({ length: 256 }),
  },
}));
```

Usage:

```ts
// processor
processor.meters.publish((m) => {
  m.stage("spectrum", (buf) => {
    buf.set(computedSpectrum); // entire array commit
  });
});

// controller
const { spectrum } = controller.meters.snapshot();
drawSpectrum(spectrum);
```

The `stage` pattern ensures:

- Arrays are updated **as a whole** under the meter seqlock.
- The Controller never sees half-updated arrays.

---

## 6. Why the DSL Looks Like This (Rationale)

### 6.1 No `step`, `origin`, `default`, or UI Hints

We deliberately **do not** include:

- `step`, `origin`, `unit`, `logScale`, etc.
- `defaultValue` at the spec level

Reasons:

- Specs must be **platform-neutral**:

  - A DAW, a web UI, and a CLI tool might all interpret the same spec differently.

- UI/UX is higher-level:

  - React/Vue components can attach their own stepping/labels.

- Keep plan & concurrency simple:

  - Behavior hints don't belong in a memory-planning/concurrency kernel.

If you need defaults or UI metadata, define them in a separate layer (e.g. a `deviceManifest` that references fields of
the spec).

---

### 6.2 Fixed-Length Arrays Only

Variable-length arrays would cause:

- Dynamic layouts (breaking deterministic planning)
- Complex updates (potentially multi-step within seqlock)
- Harder TS typing (length not known at compile time)

So arrays are always:

```ts
param.f32.array({ length: N });
meter.f32.array({ length: N });
param.enum.array({ values, length: N });
```

If you _must_ support variable sizes:

- Treat a param like `numBands` as an **active count**.
- Keep the underlying array length fixed and only use the first `numBands` entries.
- Or create multiple specs for different sizes.

---

### 6.3 Enums as Closed Sets

Enums are explicitly closed:

```ts
param.enum(["a", "b", "c"]);
param.enum.array({ values: ["off", "on"], length: 16 });
```

We don't support:

- Open string enums
- Arbitrary `string` / `number` keys

This helps:

- TS: gives precise union types instead of `string`
- Layout: store as `[0..N-1]` indices in an integer plane
- Compatibility: spec hashes are stable and predictable

---

### 6.4 Spec is Structural, Not Identity

Specs can have optional identifiers (if you add them), but the **important identity** is:

- The _structure_ (field names, types, shapes)
- The resulting **plan** and optionally a **spec hash**

We do not rely on:

- Random IDs
- Class-based inheritance
- Global registries

Two specs that describe the same structure should be treated as equivalent for the purposes of plan and bindings.

---

## 7. Anti-Patterns and Misuses

Some patterns are _possible_ in TypeScript, but break Seqlok's design assumptions.

### 7.1 Storing Spec-Derived Views Globally

❌ Bad:

```ts
let cachedParamsView: unknown;

processor.params.within((params) => {
  cachedParamsView = params; // storing for later
});

// later
const f = (cachedParamsView as { frequency: number }).frequency; // undefined behavior
```

This breaks the **scoped access** rule. All views from `within`/`publish` must be treated as **ephemeral**.

✅ Correct:

```ts
processor.params.within((params) => {
  const f = params.frequency;
  // use f, compute, done
});
```

If you need to cache something, copy it into your own data structure.

---

### 7.2 Treating the Spec as UI Metadata

❌ Bad:

```ts
const spec = defineSpec(({ param }) => ({
  params: {
    gain: param.f32({
      min: 0,
      max: 2, // and I'll treat this as my slider range + step
    }),
  },
  meters: {},
}));

// directly using spec shape as a full UI contract
```

While you _can_ derive UI from the spec, it's not meant to be a complete design system.

✅ Better:

- Use the spec as **one input** (type + rough constraints).
- Layer a separate UI manifest that might refine or override behavior.

---

### 7.3 Dynamic Field Creation

❌ Not supported:

```ts
// constructing specs dynamically at runtime
const dynamicParams: Record<string, unknown> = {};
for (const name of someRuntimeArray) {
  dynamicParams[name] = param.f32({ min: 0, max: 1 });
}

const spec = defineSpec(() => ({
  params: dynamicParams, // this makes typing brittle and plan nondeterministic
  meters: {},
}));
```

Seqlok expects `defineSpec` calls to be:

- Top-level
- Deterministic
- Type-checkable

Dynamic spec mutation breaks those expectations.

---

## 8. How the DSL Feeds the Pipeline

The spec is the **root** of the Seqlok pipeline:

```text
Spec → Plan → Backing → Handoff → Bindings
```

- **Spec**

  - Describes `params` and `meters` structurally.
  - Drives TypeScript types.

- **Plan** (`planLayout(spec)`)

  - Computes plane sizes, offsets, seqlock locations.
  - Is pure and deterministic.

- **Backing** (`allocateShared(plan)` / `allocateSharedPartitioned(plan)` / `allocateWasmShared(plan, ...)`)

  - Allocates `SharedArrayBuffer` or shared `WebAssembly.Memory`.
  - Creates the underlying typed views for the planes.

- **Handoff** (`buildHandoff(plan, backing)` / `acceptHandoff(handoff)`)

  - Compact, serializable description of "this plan + this memory".
  - Lets other agents reconstruct compatible bindings without re-planning.

- **Bindings** (`bindController` / `bindProcessor`)

  - `bindController(spec, plan, backing, options?)` — controller-side view over the backing (owner side).
  - `bindProcessor(accepted, options?)` — processor-side view constructed from an `AcceptedHandoff`.
  - Expose the concurrency APIs:

    - `controller.params.set` / `controller.params.update` / `controller.params.stage` / `controller.params.hydrate`
    - `controller.meters.snapshot`
    - `processor.params.within`
    - `processor.meters.publish` / `processor.meters.stage`

Changes to the DSL must preserve this pipeline: **spec remains structural**, everything else derives from it.

---

## 9. Checklist for Spec Authors

When you define a new spec, check:

- [ ] Every param and meter has a clear type family (`f32`, `i32`, `bool`, `enum`, `array`)
- [ ] Arrays are fixed-length and that length is appropriate
- [ ] Enums are closed sets of literals (no dynamic strings)
- [ ] There are no behavior flags or UI concerns embedded in the spec
- [ ] The spec is top-level, deterministic, and not dynamically mutated
- [ ] You’re comfortable with the fact that the spec schema is **frozen** once planned and allocated

If all of these are true, you're using the DSL the way Seqlok's architecture expects.

---

## 10. Summary

The Seqlok DSL:

- Describes **what** shared state exists (params + meters)
- Avoids saying **how** it is used in UI or DSP
- Keeps the spec:

  - Structural
  - Deterministic
  - Type-safe
  - Easy to map to raw memory

Everything else — plan, backing, handoff, bindings, concurrency — builds on top of this single, simple, _schema-first_
definition.
