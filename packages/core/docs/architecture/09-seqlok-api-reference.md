# API Reference

Complete human-oriented API documentation for `@seqlok/core`.

This file is about the public surface as it exists today.
For rationale and naming doctrine, see:

- `07-seqlok-api-shape-rationale.md`
- `08-seqlok-api-and-naming-rationale.md`

---

## Table of Contents

- [Core](#core)

  - [`defineSpec`](#definespec)
  - [`planLayout`](#planlayout)
  - [`allocateShared`](#allocateshared)
  - [`allocateSharedPartitioned`](#allocatesharedpartitioned)
  - [`allocateWasmShared`](#allocatewasmshared)
  - [`createSharedContext`](#createsharedcontext)
  - [`buildHandoff`](#buildhandoff)
  - [`acceptHandoff`](#accepthandoff)
  - [`verifyHandoff`](#verifyhandoff)

- [Bindings](#bindings)

  - [`bindController`](#bindcontroller)
  - [`bindProcessor`](#bindprocessor)
  - [`bindObserver`](#bindobserver)

- [Role Summary](#role-summary)
- [Key Types](#key-types)

---

## Core

### `defineSpec`

Accept authored input and produce the validated runtime contract consumed by planning.

```ts
function defineSpec<const T extends SpecAstInput>(
  buildOrAst:
    | T
    | ((api: Readonly<{ param: ParamBuilders; meter: MeterBuilders }>) => T),
): CanonicalSpecFromAst<T>;
```

`defineSpec(...)` accepts two authoring surfaces:

- plain authored object / AST input
- builder callback input

Both lower into the same authored-contract boundary.

#### Plain authored object form

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
  },
});
```

#### Builder callback form

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

#### What `defineSpec(...)` does

`defineSpec(...)` is the semantic-compilation boundary.
It is where authored input becomes the validated runtime contract used by `planLayout(...)`.

That includes:

- validating authored structure
- validating and defaulting scalar numeric ranges
- flattening nested authored structure into canonical runtime keys
- rejecting duplicate or conflicting canonical outcomes
- producing deterministic anonymous identity when authored `id` is omitted

#### Nested authored structure

Nested authored structure is accepted for human-facing authorship.
It is not the runtime identity model.

This authored input:

```ts
params: {
  transport: {
    timeRatio: param.f32({ min: 0.25, max: 4 });
  }
}
```

normalizes into canonical runtime identity like:

```ts
spec.params["transport.timeRatio"];
```

Canonical dot-path keys own runtime identity.
The authored tree does not.

#### Deterministic anonymous ids

If authored `id` is present, it is authoritative.
If authored `id` is omitted, Seqlok generates deterministic identity from canonical compiled meaning.

That means:

- same anonymous authored meaning yields the same normalized identity
- different anonymous authored meaning yields a different normalized identity
- identity does not depend on placeholders, randomness, or timestamps

---

### `planLayout`

Compute a deterministic plan from a validated runtime contract.

```ts
function planLayout<S extends CanonicalSpec>(
  spec: S,
  options?: PlanOptions,
): Plan<S>;
```

Important boundary note:

- planning starts **after** the authored-contract boundary
- `planLayout(...)` consumes the validated runtime contract returned by `defineSpec(...)`
- planning is not the first place authored meaning is interpreted

`Plan<S>` includes layout information such as:

- plane byte lengths
- per-field offsets and lengths
- total byte size
- stable hash and compatibility metadata

Plans are pure:

- same spec plus same options yields the same plan
- planning does not allocate backing memory

---

### `allocateShared`

Allocate a single contiguous shared backing from a plan.

```ts
function allocateShared<S extends CanonicalSpec>(plan: Plan<S>): SharedBacking;
```

This is the golden-path backing strategy.

Use it when you want:

- one contiguous `SharedArrayBuffer`
- one plan-driven shared substrate
- the simplest setup story

---

### `allocateSharedPartitioned`

Allocate a per-plane shared backing from a plan.

```ts
function allocateSharedPartitioned<S extends CanonicalSpec>(
  plan: Plan<S>,
): SharedPartitionedBacking;
```

This uses one `SharedArrayBuffer` per plane.

Use it when you want:

- per-plane allocation and ownership
- a first-class alternative to contiguous packing
- the same public binding surface with different backing realization

Bindings do not change shape because of contiguous vs partitioned backing.

---

### `allocateWasmShared`

Use a shared `WebAssembly.Memory` as the backing realization.

```ts
function allocateWasmShared<S extends CanonicalSpec>(
  plan: Plan<S>,
  memory: WebAssembly.Memory,
): WasmSharedBacking;
```

Use this when you want Seqlok planes mapped into shared Wasm memory.

Important notes:

- the memory must be shared
- the same plan still owns layout semantics
- the backing realization changes, not the contract

---

### `createSharedContext`

Create a small host-side resource bundle containing `spec`, `plan`, and `backing`.

```ts
function createSharedContext<S extends CanonicalSpec>(
  spec: S,
  allocator?: (plan: Plan<S>) => Backing,
): SharedContext<S>;
```

Default behavior:

- plans the spec
- allocates contiguous shared backing via `allocateShared`
- returns `{ spec, plan, backing }`

Example:

```ts
const ctx = createSharedContext(spec);
const controller = bindController(ctx);
const observer = bindObserver(ctx);
const handoff = buildHandoff(ctx);
```

This is convenience over the same explicit model, not a different architecture.

---

### `buildHandoff`

Build a serializable boundary envelope from either a `SharedContext` or a `(plan, backing)` pair.

```ts
function buildHandoff<S extends CanonicalSpec>(
  context: SharedContext<S>,
): Handoff<S>;

function buildHandoff<S extends CanonicalSpec>(
  plan: Plan<S>,
  backing: Backing,
): Handoff<S>;
```

`buildHandoff(...)` carries:

- protocol version
- packing mode
- shared buffer reference or per-plane shared buffers
- the plan

Treat `Handoff<S>` as an opaque envelope.
Do not build or decode it manually.

#### Supported backing kinds

`buildHandoff(...)` supports:

- `shared`
- `shared-partitioned`
- `wasm-shared`

For `wasm-shared`, the handoff transfers the underlying shared buffer from `memory.buffer`, not a `WebAssembly.Memory`
object.

---

### `acceptHandoff`

Validate a handoff envelope and produce a trusted accepted handoff.

```ts
function acceptHandoff<S extends CanonicalSpec>(
  handoff: Handoff<S>,
): AcceptedHandoff<S>;

function acceptHandoff(handoff: unknown): AcceptedHandoff;
```

`acceptHandoff(...)` is the setup-path trust boundary.
It is not hot-path work.

It validates:

- handoff version
- packing mode
- presence of shared artifacts
- plan structure

Then it returns a trusted `AcceptedHandoff<S>` suitable for consumer-side binding.

Canonical consumer-side flow:

```ts
const accepted = acceptHandoff(handoff);
const processor = bindProcessor(accepted);
const observer = bindObserver(accepted);
```

---

### `verifyHandoff`

Optionally compare plans for compatibility.

```ts
function verifyHandoff<S extends CanonicalSpec>(
  localPlan: Plan<S>,
  remotePlan: Plan<S>,
): void;
```

Use this when you want explicit plan compatibility checks beyond the normal handoff acceptance path.

Typical use:

- tests
- diagnostics
- extra hardening in development tooling

It is not required for the normal runtime flow.

---

## Bindings

### `bindController`

Bind the controller role.

```ts
function bindController<const S extends CanonicalSpec>(
  context: SharedContext<S>,
  options?: ControllerOptions,
): ControllerBinding<S>;

function bindController<const S extends CanonicalSpec>(
  spec: S,
  plan: Plan<S>,
  backing: Backing,
  options?: ControllerOptions,
): ControllerBinding<S>;
```

Controller role:

- writes params
- reads meters
- does not write meters

Canonical owner-side explicit flow:

```ts
const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);

const controller = bindController(spec, plan, backing);
const handoff = buildHandoff(plan, backing);
```

Host-side convenience flow:

```ts
const ctx = createSharedContext(spec);
const controller = bindController(ctx);
```

Important correction:

- the current shape is `bindController(spec, plan, backing)`
- not `bindController(spec, backing)`

---

### `bindProcessor`

Bind the processor role.

```ts
function bindProcessor<const S extends CanonicalSpec>(
  source: Handoff<S> | AcceptedHandoff<S> | SharedContext<S>,
  options?: ProcessorOptions,
): ProcessorBinding<S>;

function bindProcessor<const S extends CanonicalSpec>(
  spec: S,
  plan: Plan<S>,
  backing: Backing,
  options?: ProcessorOptions,
): ProcessorBinding<S>;
```

Processor role:

- reads params
- writes meters
- does not write params

Consumer-side canonical flow:

```ts
const accepted = acceptHandoff(handoff);
const processor = bindProcessor(accepted);
```

Other valid public inputs:

```ts
const processorA = bindProcessor(handoff);
const processorB = bindProcessor(accepted);
const processorC = bindProcessor(ctx);
const processorD = bindProcessor(spec, plan, backing);
```

The `AcceptedHandoff` route is still the cleanest trust-boundary story for consumer-side code, but the API surface is
broader than that.

---

### `bindObserver`

Bind the observer role.

```ts
function bindObserver<const S extends CanonicalSpec>(
  source: Handoff<S> | AcceptedHandoff<S> | SharedContext<S>,
  options?: ObserverOptions,
): ObserverBinding<S>;

function bindObserver<const S extends CanonicalSpec>(
  spec: S,
  plan: Plan<S>,
  backing: Backing,
  options?: ObserverOptions,
): ObserverBinding<S>;
```

Observer role:

- reads params
- reads meters
- does not write params
- does not write meters

Observer is a first-class role.
It is not merely a loose “consumer” label.

Canonical consumer-side flow:

```ts
const accepted = acceptHandoff(handoff);
const observer = bindObserver(accepted);
```

Other valid public inputs:

```ts
const observerA = bindObserver(handoff);
const observerB = bindObserver(accepted);
const observerC = bindObserver(ctx);
const observerD = bindObserver(spec, plan, backing);
```

Typical observer use cases:

- HUDs
- inspectors
- telemetry workers
- visualization surfaces

---

## Role Summary

Seqlok has three first-class roles.

### Controller

- writes params
- reads meters
- usually lives on the owner / host / main side

### Processor

- reads params
- writes meters
- usually lives on the consumer / worker / worklet side

### Observer

- reads params
- reads meters
- read-only role for high-frequency visualization, inspection, and telemetry

Canonical full flow:

```text
owner side:
  defineSpec → planLayout → allocateShared → buildHandoff → bindController

consumer side:
  acceptHandoff → bindProcessor
                 → bindObserver
```

---

## Key Types

### `SpecAstInput`

Author-time spec input.

- optional `id`
- optional recursive `params`
- optional recursive `meters`

### `CanonicalSpec`

Normalized runtime contract.

- required `id`
- flat canonical `params` map keyed by dot-path strings
- flat canonical `meters` map keyed by dot-path strings

### `CanonicalSpecFromAst<T>`

The compile-time resolved output of `defineSpec(...)`.

This reflects:

- flattened runtime keyspace
- normalized `id`
- preserved value-domain typing

### `Handoff<S>`

Opaque serializable boundary envelope.

### `AcceptedHandoff<S>`

Validated and trusted consumer-side handoff result.

### `SharedContext<S>`

Host-side bundle containing:

- `spec`
- `plan`
- `backing`

---

## Short version

The correct public API story is:

- author a contract with `defineSpec(...)`
- plan the validated runtime contract with `planLayout(...)`
- realize backing with `allocateShared(...)`, `allocateSharedPartitioned(...)`, or `allocateWasmShared(...)`
- build a boundary envelope with `buildHandoff(...)`
- validate that envelope with `acceptHandoff(...)`
- bind controller, processor, and observer roles from the appropriate side

Authored structure is for humans.
Canonical dot-path keys own runtime identity.
