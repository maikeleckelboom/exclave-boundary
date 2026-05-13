# Seqlok Spec and DSL: Overview and Rationale

> The spec is an authored contract. The builder DSL is an authoring surface over that contract.

This document explains:

- what a spec is in Seqlok
- how authored input enters the system
- how nested authored structure relates to runtime identity
- where `keysOf(spec)` fits
- how authored input becomes planning input

If you are defining a Seqlok contract, this is the doc that should leave your mental model straight.

---

## 1. What a spec is

In Seqlok, a spec is an **authored contract** describing shared state across an execution boundary.

`@seqlok/schema` publishes the canonical authored AST for that contract. It owns structural validation and
authored-layer normalization only. `@seqlok/core` owns `defineSpec(...)`, semantic compilation, and all
runtime-facing behavior beyond that boundary.

It defines:

- which **params** exist
- which **meters** exist
- their **kinds**, **ranges**, **enum vocabularies**, and **fixed shapes**

It does **not** define backing memory, thread wiring, worker setup, UI policy, or runtime behavior above the
shared-memory boundary.

That distinction matters.

A Seqlok spec is not “the callback you pass to `defineSpec(...)`.”
It is the authored meaning that `defineSpec(...)` receives, validates, normalizes, and turns into the runtime contract
consumed by planning.

---

## 2. The pipeline, in the right order

The correct high-level pipeline is:

```text
authored contract
  → semantic compilation via defineSpec(...)
    → validated runtime contract
      → planLayout(...)
        → backing
          → handoff
            → bindings
```

That order is not cosmetic.

It means:

- authored meaning is settled **before** planning
- planning consumes a validated runtime contract, not raw authored structure
- bindings sit at the end of the flow, not the beginning

Planning is not where authored meaning is first interpreted.
That work already happened at the authored-contract boundary.

---

## 3. Authoring surfaces

Seqlok accepts more than one authoring surface.

### 3.1 Plain object authored input

A plain object, AST-style authored input is valid:

```ts
const spec = defineSpec({
  id: "lane",
  params: {
    transport: {
      timeRatio: { kind: "f32", min: 0.25, max: 4 },
      mode: { kind: "enum", values: ["normal", "granular"] },
    },
    mixer: {
      eqBands: { kind: "f32.array", length: 8 },
    },
  },
  meters: {
    output: {
      rms: { kind: "f32" },
      peak: { kind: "f32" },
    },
    engine: {
      framesProcessed: { kind: "u32" },
    },
  },
});
```

This is the canonical authored-contract shape.
It is serializable, toolable, and structurally honest.
Its versioned JSON Schema artifact lives in `@seqlok/schema`.

### 3.2 Builder callback authored input

The most ergonomic TypeScript pattern is the builder callback:

```ts
const spec = defineSpec(({ param, meter }) => ({
  id: "lane",
  params: {
    transport: {
      timeRatio: param.f32({ min: 0.25, max: 4 }),
      mode: param.enum(["normal", "granular"]),
    },
    mixer: {
      eqBands: param.f32.array({ length: 8 }),
    },
  },
  meters: {
    output: {
      rms: meter.f32(),
      peak: meter.f32(),
    },
    engine: {
      framesProcessed: meter.u32(),
    },
  },
}));
```

This is premium TypeScript authoring ergonomics.
It is not a second contract model.

### 3.3 The important rule

Both forms lower into the same authored-contract boundary.

That means:

- plain object authored input is valid
- builder callback authored input is valid
- neither owns a different runtime identity model
- both end at the same semantic-compilation step

So the right doctrine is:

> the authored contract is primary
> the builder surface is ergonomic sugar over that contract

---

## 4. What `defineSpec(...)` actually does

`defineSpec(...)` is the public semantic-compilation boundary.

It does not merely “wrap the DSL.”
It performs real normalization work before planning begins.

That includes:

- validating authored structure through `@seqlok/schema`
- validating and defaulting numeric scalar ranges
- compiling nested authored namespaces into canonical flat runtime keys
- rejecting duplicate or conflicting canonical outcomes
- producing deterministic anonymous identity when authored `id` is omitted
- returning the validated runtime contract consumed by `planLayout(...)`

So this:

```ts
const spec = defineSpec(authoredInput);
const plan = planLayout(spec);
```

means:

- `authoredInput` is still human-facing authored structure
- `spec` is now the validated runtime contract
- `plan` is derived from that normalized contract

---

## 5. Nested authored structure

Nested authored structure is real.
It is not decorative.

Example:

```ts
const spec = defineSpec(({ param, meter }) => ({
  id: "lane",
  params: {
    transport: {
      timeRatio: param.f32({ min: 0.25, max: 4 }),
      mode: param.enum(["normal", "granular"]),
    },
    mixer: {
      eqBands: param.f32.array({ length: 8 }),
    },
  },
  meters: {
    output: {
      rms: meter.f32(),
      peak: meter.f32(),
    },
  },
}));
```

That nested structure exists for human-facing authorship.
It gives the contract semantic shape at the authoring layer.

### 5.1 What nesting is for

Nested namespaces are for:

- readable authored structure
- semantic grouping
- better TypeScript ergonomics
- better tooling and docs

### 5.2 What nesting is not for

Nested authored shape is **not** the ABI owner.

Runtime identity is normalized into canonical flat dot-path keys.

The contract above compiles into a runtime-facing keyspace like:

```ts
spec.params["transport.timeRatio"];
spec.params["transport.mode"];
spec.params["mixer.eqBands"];
spec.meters["output.rms"];
spec.meters["output.peak"];
```

That flat canonical keyspace is the runtime identity model.

So the rule is:

> author in structure
> compile into canonical dot-path keys
> do not pretend the authored tree is the runtime ABI

---

## 6. Canonical runtime identity

Seqlok keeps one runtime identity model for fields: **canonical dot-path keys**.

For example:

```text
transport.timeRatio
transport.mode
mixer.eqBands
output.rms
output.peak
```

Why this is the right runtime identity:

- flat keys are stable and explicit
- plans can assign offsets per canonical key deterministically
- bindings can target one identity model without tree ambiguity
- handoff and diagnostics do not need to preserve authored nesting as ABI
- the same contract remains easy to map in other languages and runtimes

The important thing is not that dot-paths are pretty.
It is that they are singular.

Seqlok should not drift into two runtime identity systems.
That would be a naming lie.

---

## 7. Optional ergonomic projection with `keysOf(spec)`

`keysOf(spec)` exists for call sites that prefer nested property access while still using canonical runtime keys.

Typed code does not need this helper. The flat string keyspace returned by `defineSpec(...)` is already the canonical,
strictly typed runtime identity in core:

```ts
controller.params.set("transport.timeRatio", 1.5);
observer.meters.snapshot("output.rms", "output.peak");
```

Example:

```ts
const keys = keysOf(spec);

keys.params.transport.timeRatio;
// "transport.timeRatio"

keys.params.transport.mode;
// "transport.mode"

keys.meters.output.rms;
// "output.rms"
```

### 7.1 What it does

`keysOf(spec)` projects canonical runtime keys back into a structural mirror.

That mirror:

- follows the structural authored shape
- has canonical dot-path strings at the leaves
- is optional ergonomic projection over the flat keyspace

### 7.2 What it is not

`keysOf(spec)` is:

- ergonomic sugar
- a projection of canonical identity back into structure
- outside the kernel ownership spine

It is **not**:

- a second identity system
- a second ABI
- a second canonical source of field ownership
- required for typed usage

The canonical runtime keys still own identity.
`keysOf(spec)` only gives one optional way to refer to them.

### 7.3 Why that distinction matters

If people start treating the mirror itself as authority, the model decays.

The actual order is:

- authored structure
- semantic compilation
- canonical runtime keys
- optional ergonomic mirror via `keysOf(spec)`

Not the other way around.

---

## 8. Deterministic anonymous ids

Authored `id` is authoritative when present.

```ts
const spec = defineSpec({
  id: "lane",
  params: {
    gain: { kind: "f32", min: 0, max: 1 },
  },
});
```

In that case, the authored `id` wins.

When authored `id` is omitted, Seqlok still normalizes the contract to a deterministic identity.

That identity derives from canonical compiled meaning, not from placeholders, randomness, timestamps, or authoring
noise.

This identity is owned by `@seqlok/core`, not `@seqlok/schema`.

So the rule is:

- explicit authored `id` wins
- omitted authored `id` yields deterministic anonymous identity
- identity comes from compiled meaning, not incidental authoring mechanics

This matters for:

- stable planning
- compatibility checks
- reproducible diagnostics
- honest contract identity across authoring routes

---

## 9. Field families and constraints

The spec stays deliberately narrow.

### 9.1 Param families

Core param families include:

- `f32`
- `i32`
- `u32`
- `bool`
- `enum`
- fixed-length arrays of supported param kinds

Example:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {
    transport: {
      timeRatio: param.f32({ min: 0.25, max: 4 }),
      mode: param.enum(["normal", "granular"]),
    },
    mixer: {
      eqBands: param.f32.array({ length: 8 }),
      pattern: param.enum.array({
        values: ["off", "dim", "full"],
        length: 16,
      }),
    },
  },
  meters: {},
}));
```

### 9.2 Meter families

Core meter families include:

- `f32`
- `f64`
- `i32`
- `u32`
- `bool`
- fixed-length arrays of supported meter kinds

Example:

```ts
const spec = defineSpec(({ param, meter }) => ({
  params: {},
  meters: {
    output: {
      rms: meter.f32(),
      peak: meter.f32(),
      spectrum: meter.f32.array({ length: 1024 }),
    },
    engine: {
      frameCount: meter.u32(),
    },
  },
}));
```

### 9.3 Numeric ranges are scalar-only

Numeric ranges apply to scalar numeric params.
Arrays are shape-only.

Examples:

```ts
gain: param.f32({ min: 0, max: 2 });
voices: param.i32({ min: 1, max: 16 });
bands: param.f32.array({ length: 8 });
```

That keeps planning deterministic and keeps the contract about structure, not behavioral policy.

---

## 10. What the spec does not own

The spec does **not** own:

- UI hints like labels, units, sliders, display ranges, or color
- automation behavior
- smoothing policy
- runtime orchestration
- backing choice
- handoff lifecycle
- binding lifecycle

Those belong to other layers.

The spec also does not own high-level app semantics.
It owns the shared-memory contract boundary.

That restraint is a feature.

---

## 11. From authored contract to live roles

Once the authored contract is normalized, the rest of the flow is straightforward:

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  acceptHandoff,
  bindController,
  bindProcessor,
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
const accepted = acceptHandoff(handoff);
const controller = bindController(spec, plan, backing);
const processor = bindProcessor(accepted);
const observer = bindObserver(accepted);
```

That last line matters.

Observer exists as a first-class role.
Even though this doc is mainly about authorship, the authored contract feeds all three live roles:

- controller
- processor
- observer

---

## 12. Common mistakes

### 12.1 Treating the builder callback as the canonical contract

Wrong model:

> “The callback is the spec.”

Correct model:

> The callback is one authoring surface. The authored contract is the real input. `defineSpec(...)` is the boundary that
> normalizes it.

### 12.2 Treating nested authored shape as runtime identity

Wrong model:

> “The tree itself is the ABI.”

Correct model:

> The tree is for authorship. Canonical dot-path keys own runtime identity.

### 12.3 Treating `keysOf(spec)` as authority

Wrong model:

> “The key mirror is another source of truth.”

Correct model:

> The mirror is projection sugar over canonical runtime keys.

### 12.4 Smuggling higher-level semantics into the spec

Wrong examples:

- UI-only metadata
- behavioral flags
- runtime orchestration policy
- variable-size layout ideas

Correct model:

> keep the spec structural, deterministic, and portable

---

## 13. Checklist for spec authors

When authoring a Seqlok contract, check the following:

- the contract is structural, not behavioral
- plain object or builder input would describe the same authored meaning
- nested namespaces are used for human-facing structure where helpful
- canonical runtime identity remains flat dot-path keys
- `keysOf(spec)`, when used, is ergonomic projection rather than authority
- arrays are fixed-length
- enums are closed vocabularies
- authored `id` is explicit when meaningful
- omitted `id` is acceptable because deterministic anonymous identity exists
- planning happens only after `defineSpec(...)` has normalized the contract

---

## 14. Summary

The right mental model is:

- the spec is an authored contract
- Seqlok accepts more than one authoring surface
- `defineSpec(...)` is the semantic-compilation boundary
- nested authored structure is real and useful for humans
- canonical flat dot-path keys own runtime identity
- `keysOf(spec)` can optionally project those keys back into a structural mirror for ergonomics
- explicit authored ids win; omitted ids normalize deterministically
- planning begins after authored meaning has already been normalized

That is the Seqlok authorship model.
Everything else in the pipeline should be read from there.
