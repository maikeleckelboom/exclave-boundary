# API Reference

Complete API documentation for `@seqlok/core`.

## Table of Contents

- [Core](#core)

  - [`defineSpec`](#definespec)
  - [`planLayout`](#planlayout)
  - [`allocateShared`](#allocateshared)
  - [`allocateSharedPartitioned`](#allocatesharedpartitioned)
  - [`allocateWasmShared`](#allocateWasmShared)
  - [`buildHandoff`](#buildhandoff)
  - [`receiveHandoff`](#receivehandoff)
  - [`verifyHandoff`](#verifyhandoff)

- [Bindings](#bindings)

  - [`bindController`](#bindcontroller)
  - [`bindProcessor`](#bindprocessor)

- [Controller Binding API](#controller-binding-api)

- [Processor Binding API](#processor-binding-api)

- [Types](#types)

- [Error Codes](#error-codes)

---

## Core

### `defineSpec`

Define the specification (params + meters).

```ts
function defineSpec<S extends SpecInput>(
  builder: (dsl: { param: ParamBuilders; meter: MeterBuilders }) => S,
): S;
```

**Example**

```ts
import { defineSpec } from '@seqlok/core';

export const spec = defineSpec(({ param, meter }) => ({
  id: 'demo',
  params: {
    timeRatio: param.f32({ min: 0.25, max: 4 }),
    coeffs: param.f32.array(8),
    mode: param.enum({ values: ['normal', 'granular'] }),
  },
  meters: {
    rms: meter.f32({ min: 0, max: 1 }),
    peak: meter.f32({ min: 0, max: 1 }),
    spectrum: meter.f32.array(1024),
    frames: meter.u32({ min: 0, max: 4_294_967_295 }),
  },
}));
```

**DSL summary**

- Params (scalars)

  - `param.f32({ min, max })`
  - `param.i32({ min, max })`
  - `param.bool()`
  - `param.enum({ values })` (labels array, e.g. `['off', 'on']`)

- Params (arrays, fixed length)

  - `param.f32.array(length)`
  - `param.i32.array(length)`
  - `param.bool.array(length)`
  - `param.enum.array({ values, length })` (enum indices in `Int32Array`)

- Meters (scalars)

  - `meter.f32({ min, max })`
  - `meter.f64({ min, max })`
  - `meter.u32({ min, max })`
  - `meter.bool()`

- Meters (arrays)

  - `meter.f32.array(length)`
  - `meter.f64.array(length)`
  - `meter.u32.array(length)`

> Numeric ranges are **scalar-only**; arrays are **shape-only** (fixed length, no per-element `{min,max}`).

---

### `planLayout`

Compute a deterministic memory plan for the spec.

```ts
function planLayout<S extends SpecInput>(spec: S, options?: PlanOptions): Plan<S>;
```

- Same spec → same layout and hash.
- Plan encodes byte lengths per plane, alignment, and a stable `hash` used for handoff verification.

---

### `allocateShared`

Allocate a single `SharedArrayBuffer` for all planes (contiguous backing).

```ts
function allocateShared<S extends SpecInput>(plan: Plan<S>): SharedBacking;
```

- Returns a backing object that owns:

  - one `SharedArrayBuffer`,
  - byte offsets for each plane (`PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`),
  - a `bytesTotal` field matching the plan.

- This is the **canonical** backing for cross-thread usage.

---

### `allocateSharedPartitioned`

Allocate separate SABs per plane (advanced).

```ts
function allocateSharedPartitioned<S extends SpecInput>(
  plan: Plan<S>,
): SharedPartitionedBacking;
```

- One `SharedArrayBuffer` per plane.
- Intended for advanced hosts that want separate lifetimes or OS-level mapping per plane.
- Not used by `buildHandoff` (handoff assumes contiguous backing).

---

### `allocateWasmShared`

Use a shared `WebAssembly.Memory` as the backing (advanced).

```ts
function allocateWasmShared<S extends SpecInput>(
  plan: Plan<S>,
  memory: WebAssembly.Memory,
): WasmSharedBacking;
```

- Uses a `shared` `WebAssembly.Memory` instead of SAB.
- Advanced path for WASM-heavy engines; same layout semantics as `allocateShared`.

---

### `buildHandoff`

Create a serializable handoff payload (owner/main → worker/secondary).

```ts
function buildHandoff<S extends SpecInput>(
  plan: Plan<S>,
  backing: SharedBacking, // contiguous-only
): Handoff<S>;
```

- Packs:

  - a stable spec/plan hash,
  - plane offsets/sizes,
  - and the underlying contiguous `SharedArrayBuffer`.

- The second parameter is **exactly** `SharedBacking` (contiguous SAB). Partitioned and WASM backings are **not** accepted here.

---

### `receiveHandoff`

Deserialize a handoff payload on the consumer side.

```ts
function receiveHandoff<S extends SpecInput>(handoff: Handoff<S>): ReceivedHandoff<S>;
```

- Validates basic structure and extracts:

  - `meta` (hash, layout),
  - `planes` (typed views over the SAB),
  - seqlock counters.

- Does **not** need the spec at runtime; the spec type `S` flows through the generic `Handoff<S>` and `ReceivedHandoff<S>`.

- Can be used in:

  - workers / audio worklets,
  - same-thread scenarios (e.g. tests or multi-agent main-thread setups).

---

### `verifyHandoff`

Check that a received handoff matches a `Plan<S>` (hash/size).

```ts
function verifyHandoff<S extends SpecInput>(
  plan: Plan<S>,
  received: ReceivedHandoff<S>,
): void;
```

- Throws a typed error if:

  - hashes differ (`handoff.specHashMismatch`),
  - or `bytesTotal` differs (`handoff.invalidArtifact`).

- Intended for **development / diagnostics**, typically on the side that owns the `Plan<S>` (usually the main/owner).
  The processor/worker side does not need to call `planLayout` or `verifyHandoff` in the golden flow.

---

## Bindings

### `bindController`

Create a controller binding (param writer + meter reader).

```ts
function bindController<S extends SpecInput>(
  spec: S,
  backing: Backing,
  options?: ControllerOptions,
): ControllerBinding<S>;
```

- `backing` can be:

  - `SharedBacking` (from `allocateShared`),
  - `SharedPartitionedBacking`,
  - `WasmSharedBacking`.

- `ControllerOptions` allows configuring param range policy and meter snapshot behavior; see [Types](#types).

---

### `bindProcessor`

Create a processor binding (param reader + meter writer) from a received handoff.

```ts
function bindProcessor<S extends SpecInput>(
  received: ReceivedHandoff<S>,
  options?: ProcessorOptions,
): ProcessorBinding<S>;
```

- Processor binding is **spec-free at runtime**:

  - The spec is a **type-only** concern for TypeScript users.
  - The runtime input is just `ReceivedHandoff<S>`.

- Canonical golden flow (cross-thread):

  ```ts
  // main (owner)
  import {
    defineSpec,
    planLayout,
    allocateShared,
    buildHandoff,
    bindController,
    type Handoff,
  } from '@seqlok/core';
  import type { DemoSpec } from './spec';

  const spec = defineSpec(/* ... */);
  const plan = planLayout(spec);
  const backing = allocateShared(plan);
  const handoff: Handoff<DemoSpec> = buildHandoff(plan, backing);

  const ctl = bindController(spec, backing, {
    params: { rangePolicy: 'reject' }, // or 'clamp'
  });

  worker.postMessage({ type: 'init', handoff });

  // worker (or secondary main)
  import { receiveHandoff, bindProcessor } from '@seqlok/core';
  import type { DemoSpec } from './spec';

  type InitMessage = { type: 'init'; handoff: Handoff<DemoSpec> };

  self.onmessage = (ev: MessageEvent<InitMessage>) => {
    if (ev.data.type !== 'init') return;

    const received = receiveHandoff<DemoSpec>(ev.data.handoff);
    const proc = bindProcessor(received);

    // proc.params / proc.meters now available
  };
  ```

- Processor never calls `planLayout` or touches backings directly; it only sees the `ReceivedHandoff<S>` and binds through `bindProcessor`.

- `ProcessorOptions` allows tuning retry/spin budgets for seqlock-based reads/writes; see [Types](#types).

---

## Controller Binding API

A `ControllerBinding<S>` exposes:

```ts
interface ControllerBinding<S extends SpecInput> {
  readonly params: ControllerParams<S>;
  readonly meters: ControllerMeters<S>;

  dispose(): void;
}
```

### `params` (controller)

Scalar writes:

```ts
params.set<K extends ScalarParamKeys<S>>(
  key: K,
  value: ControllerParamScalar<S, K>,
): void;

params.update(
  patch: Partial<{
    [K in ScalarParamKeys<S>]: ControllerParamScalar<S, K>;
  }>,
): void;
```

- `set(key, value)`:

  - writes a **single scalar** param,
  - triggers **one** PU sequence bump.

- `update(patch)`:

  - writes a batch of scalar params atomically,
  - triggers **one** PU sequence bump for the entire patch.

- Range behavior is controlled by `ControllerOptions.params.rangePolicy`:

  - `'reject'` (default): out-of-range values throw `binding.paramRange`.
  - `'clamp'`: out-of-range numeric values are clamped into `[min,max]` and committed.

Array writes:

```ts
params.stage<K extends ArrayParamKeys<S>>(
  key: K,
  cb: (view: ControllerParamArrayView<S, K>) => void,
): void;
```

- `stage(key, cb)`:

  - exposes a **mutable typed array view** over the param's plane slice,
  - executes `cb(view)` in a single seqlock write window,
  - commits the entire array with **one** PU bump,
  - guarantees no readers see a torn array.

- Recommended for GC-free updates (e.g. copying from another buffer).

Snapshots:

```ts
type ParamSnapshotKeys<S extends SpecInput> =
  | readonly (keyof S['params'])[]
  | undefined;

interface ParamSnapshotOptions<
  S extends SpecInput,
  P extends ParamSnapshotKeys<S> | undefined = undefined,
> {
  into?: SnapshotIntoBuffers<S, P>;
}

params.snapshot<P extends ParamSnapshotKeys<S> = undefined>(
  keys?: P,
  options?: ParamSnapshotOptions<S, P>,
): ControllerParamsSnapshot<S, P>;
```

- `snapshot()`:

  - returns a coherent view of param **values** at a single PU sequence.
  - Scalars: numbers / booleans / enum **labels** (string unions).
  - Arrays: **owned copies** (`Float32Array`, `Int32Array`, etc.).

- `snapshot(keys)`:

  - restricts to a subset of param keys.

- `snapshot(keys, { into })`:

  - reuses existing typed arrays supplied in `into`,
  - avoids allocations when shape matches.

Version:

```ts
params.version(): PUSeq;
```

- Returns the current **PU sequence** (params seqlock).
- Cheap atomic read; useful for polling loops that only snapshot on change.

---

### `meters` (controller)

Snapshots:

```ts
type MeterSnapshotKeys<S extends SpecInput> =
  | readonly (keyof S['meters'])[]
  | undefined;

interface MeterSnapshotOptions<
  S extends SpecInput,
  M extends MeterSnapshotKeys<S> | undefined = undefined,
> {
  into?: MeterSnapshotIntoBuffers<S, M>;
}

meters.snapshot<M extends MeterSnapshotKeys<S> = undefined>(
  keys?: M,
  options?: MeterSnapshotOptions<S, M>,
): ControllerMetersSnapshot<S, M>;
```

- `snapshot()`:

  - coherent view of meters at a single MU sequence.
  - Scalars: numbers and booleans (bool meters are exposed as `boolean`).
  - Arrays: copies (`Float32Array`, `Float64Array`, `Uint32Array`, `Int32Array` for enum arrays).

Version:

```ts
meters.version(): MUSeq;
```

- Returns current **MU sequence** (meters seqlock).
- Cheap atomic; ideal for "only redraw when meters changed" loops.

**Snapshot-into diagnostics**

Using `params.snapshot({ into })` or `meters.snapshot({ into })` with mismatched buffers can raise:

- `binding.snapshotIntoTypeMismatch`
- `binding.snapshotIntoLengthMismatch`

These are strongly typed and include details about expected vs actual types/lengths.

---

## Processor Binding API

A `ProcessorBinding<S>` exposes:

```ts
interface ProcessorBinding<S extends SpecInput> {
  readonly params: ProcessorParams<S>;
  readonly meters: ProcessorMeters<S>;

  dispose(): void;
}
```

### `params` (processor)

Coherent read window:

```ts
params.within<T>(cb: (view: ProcessorParamsView<S>) => T): T;
```

- Executes `cb` inside a seqlock **read window**:

  - will retry a bounded number of times if it sees a concurrent write,
  - guarantees `cb` sees a **self-consistent** snapshot of all params.

- Inside `cb(view)`:

  - Scalar params:

    - exposed as cheap getters (numbers / booleans / enum **indices**).

  - Array params:

    - exposed as **ephemeral** `TypedArray` views into the backing,
    - views are valid only during the callback; do **not** stash them.

Typical usage in a real-time loop:

```ts
proc.params.within((v) => {
  const ratio = v.timeRatio; // scalar
  const coeffs = v.coeffs; // Float32Array view
  // use them within this callback only
});
```

### `meters` (processor)

Coherent write window:

```ts
meters.publish<T>(cb: (w: MeterWriter<S>) => T): T;
```

- Exposes a writer for meters and commits all changes with **one** MU sequence bump.
- Inside `cb(w)`:

  - Scalar meters:

    - functions: `w.peak(value)`, `w.rms(value)`, etc.

  - Array meters:

    - staged writes: `w.stage('spectrum', (view) => { ... })`,
    - `view` is a mutable `TypedArray` aliasing meter plane storage.

Recommended pattern:

- In audio/RT loops, call `publish` in the **same tick** as `params.within` to keep reads/writes causally paired.

Example:

```ts
proc.meters.publish((w) => {
  w.simFps(120);
  w.simDtMs(8.33);
  w.stage('spectrum', (view) => {
    for (let i = 0; i < view.length; i += 1) {
      view[i] = Math.random();
    }
  });
});
```

---

## Types

Key public shapes (simplified):

```ts
export type PUSeq = number; // param seqlock sequence
export type MUSeq = number; // meter seqlock sequence

export type RangePolicy = 'clamp' | 'reject';
```

### Controller / Processor options

```ts
export interface ControllerOptions {
  readonly params?: {
    readonly rangePolicy?: RangePolicy;
  };

  readonly meters?: {
    /**
     * Behavior when snapshot retries are exhausted.
     * - 'returnLatest': return the latest successfully read values
     * - 'throw': throw `binding.snapshotRetryExhausted`
     */
    readonly degrade?: 'returnLatest' | 'throw';

    /** Max spin iterations per snapshot attempt. */
    readonly spinBudget?: number;

    /** Max retry attempts before giving up. */
    readonly retryBudget?: number;
  };

  /**
   * Reserved for hosts that want to treat a binding as exclusive owner of a backing.
   * Currently advisory; no hard behavior change.
   */
  readonly exclusive?: boolean;
}

export interface ProcessorOptions {
  readonly params?: {
    /** Max spin iterations per `within()` attempt. */
    readonly spinBudget?: number;
    /** Max retry attempts before giving up and throwing. */
    readonly retryBudget?: number;
  };

  readonly meters?: {
    /** Max spin iterations per `publish()` attempt. */
    readonly spinBudget?: number;
    /** Max retry attempts before giving up and throwing. */
    readonly retryBudget?: number;
  };
}
```

### Bindings and handoff types

```ts
export interface ControllerBinding<S extends SpecInput> {
  readonly params: ControllerParams<S>;
  readonly meters: ControllerMeters<S>;
  dispose(): void;
}

export interface ProcessorBinding<S extends SpecInput> {
  readonly params: ProcessorParams<S>;
  readonly meters: ProcessorMeters<S>;
  dispose(): void;
}

/**
 * Opaque, serializable envelope for a given spec.
 * Type parameter S is used only at compile-time.
 */
export type Handoff<S extends SpecInput = SpecInput> = unknown;

/**
 * Opaque, rehydrated handoff on the consumer side.
 * Carries layout/meta information and backing references.
 */
export type ReceivedHandoff<S extends SpecInput = SpecInput> = unknown;
```

Types like `ControllerParams<S>`, `ControllerMeters<S>`, `ProcessorParams<S>`, `ProcessorMeters<S>`, `Plan<S>`, `SharedBacking`, `SharedPartitionedBacking`, and `WasmSharedBacking` are exported as proper generics over `SpecInput` and are validated by the type test suite.

---

## Error Codes

Error domains (grouped by concern):

- `spec.*` — spec definition / DSL misuse
- `plan.*` / `layout.*` — planning/layout issues
- `backing.*` — SAB / WASM allocation and mapping
- `binding.*` — controller/processor binding and runtime usage
- `handoff.*` — handoff serialization/verification
- `orchestration.*` — higher-level orchestration/channel logic
- `primitives.*` — low-level seqlock/atomic primitives
- `runtime.*` — environment/runtime conditions
- `diagnostics.*` — optional diagnostics and introspection

Selected examples:

- `handoff.specHashMismatch`

  - Plan/hash mismatch when verifying a received handoff.

- `handoff.invalidArtifact`

  - Plan bytes vs meta bytes mismatch.

- `binding.paramRange`

  - Out-of-range param write under `rangePolicy: 'reject'` (includes key, range, and offending value).

- `binding.snapshotIntoTypeMismatch`

  - Using `snapshot({ into })` or `meters.snapshot({ into })` with the wrong typed array **type**.

- `binding.snapshotIntoLengthMismatch`

  - Using `into` buffers with incorrect length.

- `binding.snapshotRetryExhausted`

  - Snapshot could not obtain a coherent view within configured retry/spin budgets.

- `primitives.seqlockTimeout`

  - Seqlock `tryRead` could not acquire a coherent snapshot within its internal retry/spin budget.

All error codes have typed payloads and are exercised by tests; the exact payload shapes are available via the `errors` module for advanced hosts.
