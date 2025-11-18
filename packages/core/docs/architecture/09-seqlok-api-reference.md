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
    mode: param.enum(['normal', 'granular']),
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
  - `param.enum(values: readonly string[])`

- Params (arrays, fixed length)

  - `param.f32.array(length: number)` or `param.f32.array({ length })`
  - `param.i32.array(length: number)` or `param.i32.array({ length })`
  - `param.bool.array(length: number)` or `param.bool.array({ length })`
  - `param.enum.array({ values: readonly string[]; length: number })`

- Meters (scalars)

  - `meter.f32({ min, max })`
  - `meter.f64({ min, max })`
  - `meter.u32({ min, max })`
  - `meter.bool()`

- Meters (arrays)

  - `meter.f32.array(length: number)` or `meter.f32.array({ length })`
  - `meter.f64.array(length: number)` or `meter.f64.array({ length })`
  - `meter.u32.array(length: number)` or `meter.u32.array({ length })`

> Numeric ranges are **scalar-only**; arrays are **shape-only** (fixed length, no per-element `{min,max}`).
> Enum arrays always store **indices** (`Int32Array`) via `param.enum.array({ values, length })`.

---

### `planLayout`

Compute a deterministic memory plan for the spec.

```ts
function planLayout<S extends SpecInput>(spec: S, options?: PlanOptions): Plan<S>;
```

- Same spec + options → same layout and hash.
- `Plan<S>` encodes:

  - bytes per plane (`PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`),
  - offsets / lengths for all params and meters,
  - seqlock indices for param and meter domains,
  - a stable `hash` used for handoff verification and diagnostics.

The **plan layer** is the single source of truth for layout and spec metadata. No separate "layout domain" exists; all layout-related errors live under `plan.*`.

---

### `allocateShared`

Allocate a single `SharedArrayBuffer` for all planes (contiguous backing).

```ts
function allocateShared<S extends SpecInput>(plan: Plan<S>): SharedBacking;
```

- Returns a backing object that owns:

  - one `SharedArrayBuffer`,
  - typed views per plane (`PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`),
  - a `bytesTotal` field matching the plan.

- This is the **canonical** backing for cross-thread usage and for `buildHandoff`.

---

### `allocateSharedPartitioned`

Allocate separate SABs per plane (advanced).

```ts
function allocateSharedPartitioned<S extends SpecInput>(
  plan: Plan<S>,
): SharedPartitionedBacking;
```

- One `SharedArrayBuffer` per plane.

- Intended for advanced hosts that want:

  - distinct lifetimes per plane,
  - OS-level mapping tricks,
  - experimental memory policies.

- `SharedPartitionedBacking` **cannot** be passed directly to `buildHandoff`; handoff currently assumes a contiguous backing (`SharedBacking` from `allocateShared`).

---

### `allocateWasmShared`

Use a shared `WebAssembly.Memory` as the backing (advanced).

```ts
function allocateWasmShared<S extends SpecInput>(
  plan: Plan<S>,
  memory: WebAssembly.Memory,
): WasmSharedBacking;
```

- Uses a **shared** `WebAssembly.Memory` instead of a JS `SharedArrayBuffer`.

- Same plan-driven layout as `allocateShared`:

  - plane offsets/lengths are derived from `Plan<S>`.

- Intended for WASM-heavy engines that want Seqlok planes and DSP state in the same linear memory.

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

  - the `Plan<S>` itself (hash, planes, offsets, lengths),
  - and the underlying contiguous `SharedArrayBuffer`.

- Expects a **contiguous** `SharedBacking` from `allocateShared(plan)`. Partitioned and WASM backings are not accepted.

Conceptually:

```ts
type Handoff<S extends SpecInput> = {
  readonly plan: Plan<S>;
  readonly sab: SharedArrayBuffer;
};
```

(Exact structure is intentionally opaque and may evolve; treat it as a protocol envelope.)

---

### `receiveHandoff`

Deserialize a handoff payload on the consumer side.

```ts
function receiveHandoff<S extends SpecInput>(handoff: Handoff<S>): ReceivedHandoff<S>;
```

- Validates basic handoff structure and extracts:

  - `plan` (remote `Plan<S>`),
  - the underlying `SharedArrayBuffer`,
  - typed plane views,
  - seqlock indices.

- Does **not** need the spec at runtime; `S` is purely a type parameter.

- Works in:

  - Workers / AudioWorklets,
  - same-thread “multi-agent” setups,
  - test environments.

---

### `verifyHandoff`

Check that a received handoff matches a local `Plan<S>` (hash/size/version/backing shape).

```ts
function verifyHandoff<S extends SpecInput>(
  plan: Plan<S>,
  received: ReceivedHandoff<S>,
): void;
```

- Compares the local plan to the remote `received.plan` and `received.sab`:

  - hash equality,
  - `bytesTotal` consistency,
  - version compatibility,
  - backing size compatibility.

- Throws a `SeqlokError` if a mismatch is detected (see [Error Codes](#error-codes) for the specific `handoff.*` codes).

- Intended for **development / diagnostics** on the side that owns `Plan<S>`.

- The golden production path (`receiveHandoff` → `bindProcessor`) does **not** require `verifyHandoff`.

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
  - `SharedPartitionedBacking` (from `allocateSharedPartitioned`),
  - `WasmSharedBacking` (from `allocateWasmShared`).

- `ControllerOptions` configures:

  - param range policy (`'reject'` | `'clamp'`),
  - meter snapshot degrade and budgets,
  - optional exclusivity hints.

Canonical owner/main flow:

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  bindController,
  type Handoff,
} from '@seqlok/core';

export const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);
export const handoff: Handoff<typeof spec> = buildHandoff(plan, backing);

export const controller = bindController(spec, backing, {
  params: { rangePolicy: 'reject' },
});
```

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

  - the spec is only used at type level (`S extends SpecInput`),
  - the runtime input is `ReceivedHandoff<S>` from `receiveHandoff`.

Example (worker / AudioWorklet):

```ts
import {
  receiveHandoff,
  bindProcessor,
  type Handoff,
  type ProcessorBinding,
} from '@seqlok/core';
import type { DemoSpec } from './spec';

type InitMessage = { type: 'init'; handoff: Handoff<DemoSpec> };

let proc: ProcessorBinding<DemoSpec> | undefined;

self.onmessage = (ev: MessageEvent<InitMessage>) => {
  if (ev.data.type !== 'init') return;

  const received = receiveHandoff<DemoSpec>(ev.data.handoff);
  proc = bindProcessor(received);

  // proc.params / proc.meters now available in the audio/worker loop
};
```

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

#### Scalar writes

```ts
params.set<K extends ScalarParamKeys<S>>(
  key: K,
  value: ParamValueFor<S, K>,
): void;

params.update(patch: ScalarParamPatch<S>): void;
```

- `set(key, value)`:

  - single scalar write,
  - one param-domain seqlock commit (one PU sequence bump).

- `update(patch)`:

  - atomic micro-batch of **scalar** params,
  - one commit for the whole patch.

- `update` is **scalar-only**:

  - array params are **not** allowed in the patch,
  - attempting to include arrays is a binding-level usage error.

- Range behavior is controlled by `ControllerOptions.params.rangePolicy`:

  - `'reject'` (default): out-of-range values throw `binding.paramRange`.
  - `'clamp'`: out-of-range numeric values are clamped into `[min,max]` and committed.

#### Array writes (hot path)

```ts
params.stage<K extends ArrayParamKeys<S>>(
  key: K,
  cb: (view: ArrayParamView<S, K>) => void,
): void;
```

- `stage(key, cb)`:

  - exposes a **mutable typed view** (`Float32Array`, `Int32Array`, `Uint8Array`) over the param slice,
  - executes `cb(view)` under a single seqlock write window,
  - commits the entire array with one PU bump,
  - guarantees readers never see a torn array.

- Intended for hot-path / GC-free updates:

  - `view.set(scratchBuffer)`,
  - or compute directly into `view`.

#### Bulk hydration (cold path)

```ts
params.hydrate(patch: HydratePatch<S>): void;
```

- `hydrate(patch)`:

  - accepts a **partial** param object that may include both scalars and arrays,
  - validates keys and shapes up front (unknown keys, wrong types, and length mismatches throw before any commit),
  - applies all scalar and array writes under a single seqlock commit (one PU sequence bump),
  - is explicitly **cold-path**: presets, project load, snapshot restore, IPC, REPL.

- Scalars:

  - same semantics as `update`,
  - respect `rangePolicy`.

- Arrays:

  - must be typed arrays (`Float32Array`, `Int32Array`, `Uint8Array`, etc.),
  - length must match the spec-defined length for that param,
  - values are copied into backing slices via `subarray().set(src)`.

- Patch semantics:

  - keys with `value === undefined` are ignored,
  - omitted keys are left untouched.

Typical use:

```ts
// Preset or snapshot state
type ParamsState<S extends SpecInput> = ParamValues<S>;

// Load preset / state
function applyState<S extends SpecInput>(
  ctl: ControllerBinding<S>,
  state: ParamsState<S>,
): void {
  ctl.params.hydrate(state);
}
```

`hydrate` is the conceptual counterpart to `snapshot` (see below) and is the canonical bulk write primitive for each param domain.

#### Snapshots

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

  - coherent view of params at a single PU sequence,
  - scalars: numbers / booleans / enum **labels**,
  - arrays: owned copies (`Float32Array`, `Int32Array`, etc.).

- `snapshot(keys)`:

  - restricts to subset of params.

- `snapshot(keys, { into })`:

  - reuses preallocated typed arrays from `into`,
  - avoids allocations when lengths match.

Round-trip:

```ts
const snap = controller.params.snapshot();
// ...
controller.params.hydrate(snap);
```

#### Version

```ts
params.version(): PUSeq;
```

- Returns the current param-domain seqlock sequence.
- Cheap atomic; ideal for "only snapshot when changed" loops.

---

### `meters` (controller)

#### Snapshots

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

  - coherent view of meters at a single MU sequence,
  - scalars: numbers / booleans,
  - arrays: copies (`Float32Array`, `Float64Array`, `Uint32Array`, `Int32Array` for enum arrays).

- `snapshot(keys, { into })`:

  - subset + reuse existing array buffers.

Degrade / budgets are controlled via `ControllerOptions.meters`:

- `degrade: 'returnLatest' | 'throw'`
- `spinBudget`, `retryBudget`

These influence how snapshot behaves under heavy writer contention.

#### Version

```ts
meters.version(): MUSeq;
```

- Returns the meter-domain seqlock sequence.
- Cheap atomic; use it to avoid redundant snapshots.

**Snapshot-into diagnostics**

Using `params.snapshot({ into })` or `meters.snapshot({ into })` with mismatched buffers can raise:

- `binding.snapshotIntoTypeMismatch`
- `binding.snapshotIntoLengthMismatch`

These errors are fail-fast and never corrupt backing memory.

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
params.within<T>(cb: (view: ProcessorParamView<S>) => T): T;
```

- Executes `cb` inside a seqlock **read window**.

- If a write is in progress:

  - spins for a bounded `spinBudget`,
  - retries up to `retryBudget` times.

- Guarantees that `view` is self-consistent (no half-updated state).

Inside `cb(view)`:

- Scalars:

  - exposed as plain numbers / booleans / enum **indices**,
  - cheap property access.

- Arrays:

  - exposed as ephemeral `TypedArray` views into the backing,
  - valid only during the callback.

Example:

```ts
processor.params.within((p) => {
  const ratio = p.timeRatio;
  const coeffs = p.coeffs; // Float32Array view
  // use coeffs within this callback only
});
```

Spin/retry budgets are controlled via `ProcessorOptions.params`.

### `meters` (processor)

Coherent write window:

```ts
meters.publish<T>(cb: (w: MeterWriter<S>) => T): T;
```

- Exposes a meter writer inside a single seqlock write window.
- Commits all scalar and array meter updates with one MU bump.

Inside `cb(w)`:

- Scalar meters:

  - functions: `w.peak(value)`, `w.rms(value)`, `w.frames(value)`, etc.

- Array meters:

  - `w.stage('spectrum', (view) => { /* fill view */ })`,
  - `view` is a `TypedArray` aliasing meter plane storage.

Recommended pattern in DSP:

```ts
processor.params.within((p) => {
  const ratio = p.timeRatio;
  // read params, compute audio...

  processor.meters.publish((w) => {
    w.peak(computedPeak);
    w.stage('spectrum', (view) => {
      view.set(computedSpectrum);
    });
  });
});
```

Budgets for meter writes are controlled via `ProcessorOptions.meters`.

---

## Types

Key public types (simplified):

```ts
export type PUSeq = number; // param-domain seqlock sequence
export type MUSeq = number; // meter-domain seqlock sequence

export type RangePolicy = 'clamp' | 'reject';
```

### Value helpers

```ts
/** Controller-visible param values (arrays readonly, enums are label unions). */
export type ParamValues<S extends SpecInput> = {
  [K in ParamKeys<S>]: ParamValueFor<S, K>;
};

/** Controller-visible meter values (arrays readonly). */
export type MeterValues<S extends SpecInput> = {
  [K in MeterKeys<S>]: MeterValueFor<S, K>;
};
```

### Hydration patch

```ts
/**
 * Patch shape for `params.hydrate()`.
 *
 * - Keys are spec param keys.
 * - Scalars use controller-visible types (numbers, booleans, enum labels).
 * - Arrays must be typed arrays (`Float32Array`, `Int32Array`, `Uint8Array`, etc.).
 */
export type HydratePatch<S extends SpecInput> = {
  readonly [K in ParamKeys<S>]?: ParamValueFor<S, K> | undefined;
};
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

### Binding & handoff types

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
 * Carries plan/meta information and backing references.
 */
export type ReceivedHandoff<S extends SpecInput = SpecInput> = unknown;

/** Backing variants */
export type Backing = SharedBacking | SharedPartitionedBacking | WasmSharedBacking;
```

`Plan<S>`, `SharedBacking`, `SharedPartitionedBacking`, `WasmSharedBacking`, `ControllerParams<S>`, `ControllerMeters<S>`, `ProcessorParams<S>`, and `ProcessorMeters<S>` are exported generics over `SpecInput` and covered by the type tests.

---

## Error Codes

Error domains (grouped by concern):

- `spec.*` — spec definition / DSL misuse
- `plan.*` — planning/layout issues
- `backing.*` — SAB / WASM allocation and mapping
- `handoff.*` — handoff envelopes, plan/backing verification
- `binding.*` — controller/processor binding and runtime usage
- `bindings.*` — higher-level glue / orchestration around bindings and environment
- `primitives.*` — low-level seqlock/atomic primitives
- `env.*` — environment/runtime capability checks
- `diagnostics.*` — diagnostics and introspection
- `orchestration.*` — system-level composition / channel orchestration

Selected examples:

- `handoff.specHashMismatch`

  - Thrown by `verifyHandoff` when the local `Plan<S>.hash` and the received plan hash differ.
  - Includes both sides and a structured hash diff.

- `handoff.invalidArtifact`

  - Thrown by `verifyHandoff` when plan vs received byte sizes are inconsistent or the handoff envelope is malformed.

- `handoff.versionMismatch`

  - Thrown when a local plan and a received plan are incompatible due to versioned layout changes.

- `handoff.backingMismatch`

  - Thrown when the `SharedArrayBuffer` backing length does not match what the plan expects.

- `binding.paramRange`

  - Out-of-range param write under `rangePolicy: 'reject'` (includes key, range, offending value).

- `binding.snapshotIntoTypeMismatch`

  - Using `params.snapshot({ into })` / `meters.snapshot({ into })` with the wrong typed array **type**.

- `binding.snapshotIntoLengthMismatch`

  - Using snapshot-into with buffers of incorrect length.

- `binding.snapshotRetryExhausted`

  - Cannot obtain a coherent snapshot within configured spin/retry budgets.

- `primitives.seqlockTimeout`

  - Seqlock `tryRead` exhausted its internal budget and could not acquire a coherent snapshot.

- `env.sharedArrayBufferUnsupported`

  - Environment does not support `SharedArrayBuffer` with the required COOP/COEP/security model.

- `bindings.specBackingMismatch`

  - Higher-level bindings glue detected inconsistent spec/plan/backing wiring.

All error codes carry structured details and meta:

- `severity` (e.g. `'warning' | 'error' | 'fatal'`)
- `recoverable` (boolean)
- `boundarySafe` (boolean, for “safe to send across process/worker boundary”)

These are defined in the error registry and exercised by the tests.
