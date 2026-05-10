# API Reference

Complete API documentation for `@seqlok/core`.

This file is about **shape and signatures**. For rationale and design notes, see:

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
  - [`buildHandoff`](#buildhandoff)
  - [`acceptHandoff`](#receivehandoff)
  - [`verifyHandoff`](#verifyhandoff)

- [Binding](#binding)

  - [`bindController`](#bindcontroller)
  - [`bindProcessor`](#bindprocessor)
  - [`bindObserver`](#bindobserver)

- [Controller Binding API](#controller-binding-api)

- [Processor Binding API](#processor-binding-api)

- [Observer Binding API](#observer-binding-api)

- [Types](#types)

- [Error Codes](#error-codes)

---

## Core

### `defineSpec`

Describe params/meters and obtain a strongly-typed spec.

```ts
declare function defineSpec<S extends SpecInput>(
  build: (ctx: { param: ParamDsl; meter: MeterDsl }) => S,
): S;
```

- Specs are plain objects with:

  - `id: string` – optional human-readable ID.
  - `params` – param definitions.
  - `meters` – meter definitions.

- Numeric params are **range-only**:

  ```ts
  // Scalars
  gain: param.f32({ min: 0, max: 1 });
  index: param.i32({ min: 0, max: 1023 });

  // Arrays (shape-only)
  curve: param.f32.array({ length: 1024 });
  ```

- Enums:

  ```ts
  mode: param.enum(["off", "lp", "hp"]);
  pattern: param.enum.array({
    values: ["off", "dim", "full"],
    length: 64,
  });
  ```

- Meters:

  ```ts
  peak: meter.f32();
  spectrum: meter.f32.array({ length: 2048 });
  ```

> Numeric ranges apply only to **scalar params** (`f32`, `i32`). Arrays (params/meters) are shape-only.
> Enum arrays store **indices** (in `Int32Array`) into the shared `values` vocabulary.

---

### `planLayout`

Compute a deterministic plan from the spec.

```ts
declare function planLayout<S extends SpecInput>(
  spec: S,
  options?: PlanOptions,
): Plan<S>;
```

- Same `spec + options` → same layout + `hash`.
- `Plan<S>` includes:

  - plane byte lengths for all planes (`PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`),
  - per-param / per-meter offsets and lengths,
  - seqlock indices for params/meters,
  - a stable `hash` used for handoff/diagnostics,
  - a `version` used as a plan ABI discriminant.

Plans are **pure**: they do not allocate memory and do not depend on runtime environment.

---

### `allocateShared`

Allocate a single contiguous `SharedArrayBuffer` and slice into planes.

```ts
declare function allocateShared<S extends SpecInput>(
  plan: Plan<S>,
): SharedBacking;
```

- Returns a backing object with:

  - `kind: 'shared'`,
  - `sab: SharedArrayBuffer`,
  - `byteLength: number`,
  - per-plane `TypedArray` views (PF32, PI32, PB, PU, MF32, MF64, MU32, MU).

- Plan-driven:

  - planes are sized according to `plan.planes[plane]`,
  - alignment is chosen to match cross-language expectations.

This is the **golden path** for controller/processor/observer bindings.

---

### `allocateSharedPartitioned`

Allocate separate SABs per plane (partitioned backing).

```ts
declare function allocateSharedPartitioned<S extends SpecInput>(
  plan: Plan<S>,
): SharedPartitionedBacking;
```

- Returns a backing object with:

  - `kind: 'shared-partitioned'`,
  - one `SharedArrayBuffer` per plane,
  - each plane sized according to `plan.planes[plane]`.

- Intended for hosts that want:

  - distinct lifetimes per plane,
  - OS/NUMA tricks per plane,
  - easier partial growth strategies.

- **Supported by handoff**:

  - `buildHandoff(plan, backing)` accepts `SharedPartitionedBacking`,
  - `Handoff<S>` encodes `packing: 'shared-partitioned'`,
  - `acceptHandoff` reconstructs an `AcceptedHandoff<S>` with a partitioned backing descriptor.

Bindings do not care whether backing is contiguous vs partitioned; the param/meter API is identical.

---

### `allocateWasmShared`

Use a shared `WebAssembly.Memory` as backing (advanced).

```ts
declare function allocateWasmShared<S extends SpecInput>(
  plan: Plan<S>,
  memory: WebAssembly.Memory,
): WasmSharedBacking;
```

- Uses a **shared** `WebAssembly.Memory` instead of JS `SharedArrayBuffer`.

- Layout is still plan-driven:

  - plane offsets/lengths are derived from `Plan<S>`,
  - typed views are created as `new <TypedArray>(memory.buffer, offset, length)`.

- Intended for WASM-heavy engines that want "DSP state + Seqlok planes" in the same linear memory.

- **Current limitation (v0.2.0)**:

  - `buildHandoff(plan, backing)` does **not** support `kind: 'wasm-shared'`,
  - passing a Wasm backing to `buildHandoff` throws `handoff.invalidArtifact`.

You can still bind directly to a Wasm backing via `bindController` / `bindProcessor` if you manage agent boundaries yourself.

---

### `buildHandoff`

Create a serializable handoff payload (owner/main → worker/secondary).

```ts
declare function buildHandoff<S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing, // shared or shared-partitioned
): Handoff<S>;
```

- Accepts:

  - `SharedBacking` (`kind: 'shared'`),
  - `SharedPartitionedBacking` (`kind: 'shared-partitioned'`).

- Rejects:

  - `kind: 'wasm-shared'` backings with `handoff.invalidArtifact`.

- Packs:

  - `plan` metadata (hash, version, per-plane byte lengths),
  - backing descriptor (SAB or per-plane SABs),
  - a version tag for the handoff schema.

Conceptually:

```ts
type Handoff<S extends SpecInput = SpecInput> =
  | {
      version: 1;
      packing: "shared";
      backingDescriptor: { sab: SharedArrayBuffer };
      plan: Plan<S>;
    }
  | {
      version: 1;
      packing: "shared-partitioned";
      backingDescriptor: { planes: Record<PlaneKey, SharedArrayBuffer> };
      plan: Plan<S>;
    };
// exact structure is opaque and may evolve
```

You should treat `Handoff<S>` as an **opaque envelope** and only interact with it via `acceptHandoff`.

---

### `acceptHandoff`

Decode and validate a `Handoff<S>` envelope on the consumer side.

```ts
declare function acceptHandoff<S extends SpecInput>(
  handoff: Handoff<S>,
): AcceptedHandoff<S>;
```

- Validates:

  - handoff schema version,
  - packing kind (`'shared'` / `'shared-partitioned'`),
  - SAB presence and byte lengths.

- Materializes new typed views over the SAB(s):

  - planes,
  - per-param / per-meter offsets and lengths.

Returns an `AcceptedHandoff<S>` that can be passed into `bindProcessor` / `bindObserver`.

---

### `verifyHandoff`

Optional hardening: verify that a remote plan matches a local plan.

```ts
declare function verifyHandoff<S extends SpecInput>(
  localPlan: Plan<S>,
  remotePlan: Plan<S>,
): void;
```

Usage:

```ts
// main thread
const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);
const handoff = buildHandoff(plan, backing);

// worker
const accepted = acceptHandoff(handoff);
verifyHandoff(plan, accepted.plan); // throws on mismatch
```

- Compares:

  - `hash` (spec + layout),
  - `bytesTotal`,
  - per-plane byte lengths,
  - plan `version`.

- Throws `SeqlokError` on mismatch:

  - `handoff.specHashMismatch`
  - `handoff.versionMismatch`
  - `handoff.backingMismatch`
  - `handoff.invalidArtifact`

This is for diagnostics/hardening. The **golden path** (`acceptHandoff` → `bindProcessor` / `bindObserver`) does not require it.

---

## Binding

### `bindController`

Create a controller binding (param writer + meter reader).

```ts
declare function bindController<S extends SpecInput>(
  spec: S,
  plan: Plan<S>,
  backing: Backing,
  options?: ControllerOptions,
): ControllerBinding<S>;
```

- Validates `spec` vs `plan`:

  - keys, kinds, array lengths,
  - enum label sets.

- Validates that `backing` has enough capacity for the plan.

- Returns a `ControllerBinding<S>` with:

  - `params` (write-only at API level),
  - `meters` (read-only).

Typical usage:

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  bindController,
  type Handoff,
} from "@seqlok/core";

export const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);

export const handoff: Handoff<typeof spec> = buildHandoff(plan, backing);

export const controller = bindController(spec, plan, backing, {
  params: { rangePolicy: "reject" },
});
```

---

### `bindProcessor`

Create a processor binding (param reader + meter writer) from an accepted handoff.

```ts
declare function bindProcessor<S extends SpecInput>(
  accepted: AcceptedHandoff<S>,
  options?: ProcessorOptions,
): ProcessorBinding<S>;
```

- Processor binding is **spec-free at runtime**:

  - spec is used only at type level (`S`),
  - runtime input is `AcceptedHandoff<S>`.

- Validates the accepted plan/backing descriptor and materializes typed views suitable for real-time loops.

- Returns a `ProcessorBinding<S>` with:

  - `params` (read-only),
  - `meters` (write-only).

Typical usage (worker / AudioWorklet):

```ts
import { acceptHandoff, bindProcessor } from "@seqlok/core";
import type { Handoff } from "@seqlok/core";
import type { Spec } from "./spec";

self.onmessage = (
  ev: MessageEvent<{ type: "INIT"; handoff: Handoff<Spec> }>,
) => {
  if (ev.data.type !== "INIT") return;

  const accepted = acceptHandoff(ev.data.handoff);
  const processor = bindProcessor(accepted);
  // processor.params / processor.meters available here
};
```

---

### `bindObserver`

Create a **read-only observer binding** (param + meter reader) from an accepted handoff.

```ts
declare function bindObserver<S extends SpecInput>(
  accepted: AcceptedHandoff<S>,
  options?: ObserverOptions,
): ObserverBinding<S>;
```

- Observer bindings share the same plan, backing, and seqlocks as controller/processor.

- They are strictly **read-only**:

  - no param writes,
  - no meter writes.

- Multiple observers can be created from the same `AcceptedHandoff<S>`; they do not interfere with each other or with the processor.

Typical usage (HUD / telemetry worker):

```ts
const accepted = acceptHandoff(handoff);
const observer = bindObserver(accepted);

// HUD loop
observer.params.within((p) => {
  // coherent read of params
});
observer.meters.within((m) => {
  // zero-copy read of meters (waveforms, etc.)
});
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
```

- Writes a **single scalar param** (f32, i32, bool, enum).
- Performs one param-domain seqlock commit (one `PUSeq` bump).
- Range behavior is controlled by `ControllerOptions.params.rangePolicy`:

  - `'reject'` (default): out-of-range values throw `binding.paramRange`.
  - `'clamp'`: values are clamped to `[min,max]` and committed.

---

#### Atomic multi-scalar updates

```ts
params.update(
  patch: Partial<ScalarParamValues<S>>,
): void;
```

- Atomic micro-batch of **scalar** params.
- Exactly one param-domain commit (`PUSeq` bump) for the entire patch.
- Arrays are **not allowed** in the patch; shape errors throw `binding.shapeInvalid`.
- Unknown keys throw `binding.unknownKey`.

---

#### Array writes (hot path)

```ts
params.stage<K extends ArrayParamKeys<S>>(
  key: K,
  cb: (view: ArrayParamView<S, K>) => void,
): void;
```

- `stage`:

  - exposes a **mutable TypedArray view** for the param array,
  - runs `cb(view)` under a single seqlock write window,
  - commits the entire array with one `PUSeq` bump,
  - guarantees readers never see a torn array.

Typical usage:

```ts
controller.params.stage("curve", (view) => {
  view.set(newCurve);
});
```

---

#### Bulk hydration (cold path)

```ts
params.hydrate(
  patch: HydrationPatch<S>,
): void;
```

- Cold-path bulk-param write:

  - supports both scalars and arrays in a single patch,
  - intended for preset recall, project restore, IPC hydration.

- Always one commit (`PUSeq` bump) per call.

- Does **not** attempt to be hot-path; allocations and copy work are allowed.

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

meters.snapshot(): MeterValues<S>;

meters.snapshot<M extends MeterSnapshotKeys<S>>(
  keys: M,
): MeterSubsetValues<S, M>;

meters.snapshot<M extends MeterSnapshotKeys<S>>(
  keys: M,
  options: MeterSnapshotOptions<S, M>,
): MeterSubsetValues<S, M>;
```

- `snapshot()` with no args returns **all** meters.
- `snapshot(keys)` returns a subset.
- `snapshot(keys, { into })` allows reusing caller-provided buffers for arrays.
- Snapshots are seqlock-coherent:

  - controller may spin/retry under the hood,
  - behavior when budgets are exhausted is controlled by `ControllerOptions.meters.degrade`:

    - `'returnLatest'` – return last successful values,
    - `'throw'` – throw `binding.snapshotRetryExhausted`.

---

#### Version

```ts
meters.version(): MUSeq;
```

- Returns meter-domain sequence counter.
- Cheap change-detection primitive: "only `snapshot` when version changed."

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

    - spins for up to `spinBudget`,
    - retries up to `retryBudget`.

  - If budgets are exhausted, throws `binding.coherentRetryExhausted`.

- Inside `cb(view)`:

  - scalars are exposed as numbers/booleans/enum **indices** (DSP-friendly),
  - arrays are exposed as ephemeral `TypedArray` views valid only inside `cb`.

Version:

```ts
params.version(): PUSeq;
```

- Returns param-domain sequence counter, useful for lightweight change detection.

---

### `meters` (processor)

Meters publish:

```ts
meters.publish(cb: (w: MeterWriters<S>) => void): void;
```

- Executes `cb(w)` inside a **single** meter-domain seqlock write window.
- Meter writers:

  - scalar meters: `w.peak(value)`,
  - array meters: `w.stage('spectrum', cb(view))` with one `MUSeq` bump.

Recommended pattern:

```ts
processor.params.within((p) => {
  const gain = p.gain;
  const modeIndex = p.mode; // enum index

  // ...DSP...

  processor.meters.publish((w) => {
    w.peak(computedPeak);
    w.stage("spectrum", (view) => {
      view.set(computedSpectrum);
    });
  });
});
```

Budgets are controlled via `ProcessorOptions.params` / `ProcessorOptions.meters`.

Version:

```ts
meters.version(): MUSeq;
```

- Returns meter-domain sequence counter.

---

## Observer Binding API

An `ObserverBinding<S>` exposes:

```ts
interface ObserverBinding<S extends SpecInput> {
  readonly params: ObserverParams<S>;
  readonly meters: ObserverMeters<S>;

  dispose(): void;
}
```

Observer bindings are **read-only**:

- share the same backing and seqlocks as controller/processor,
- never write params or meters,
- give HUDs / inspectors coherent views of state without affecting writers.

### `params` (observer)

Observer params expose snapshots and coherent read windows:

```ts
// Full snapshot of all params
observer.params.snapshot(): ParamsSnapshot<S>;

// Subset snapshot
observer.params.snapshot<K extends ParamKeys<S>>(
  keys: readonly K[],
): ParamsSubsetSnapshot<S, K>;

// Coherent read window
observer.params.within<T>(cb: (view: ObserverParamView<S>) => T): T;

// Sequence counter
observer.params.version(): PUSeq;
```

Semantics:

- `snapshot()` / `snapshot(keys)`:

  - same shapes as controller snapshots (scalars as numbers/booleans/enum **labels**; arrays as owned copies),
  - uses the same degrade/budget machinery as controller snapshots.

- `within(cb)`:

  - executes `cb` inside a seqlock **read window**,
  - exposes scalars as numbers/booleans/enum labels,
  - exposes arrays as ephemeral `TypedArray` views valid only during `cb`.

- `version()`:

  - returns the param-domain sequence counter (`PUSeq`),
  - useful for HUD change detection.

---

### `meters` (observer)

```ts
// Full snapshot of all meters
observer.meters.snapshot(): MetersSnapshot<S>;

// Subset snapshot
observer.meters.snapshot<K extends MeterKeys<S>>(
  keys: readonly K[],
): MetersSubsetSnapshot<S, K>;

// Coherent read window
observer.meters.within<T>(cb: (view: ObserverMeterView<S>) => T): T;

// Sequence counter
observer.meters.version(): MUSeq;
```

Semantics:

- `snapshot()` / `snapshot(keys)`:

  - same shapes as controller meter snapshots (scalars as numbers/booleans; arrays as typed copies),
  - suited for lower-frequency HUDs ("grab everything, then render").

- `within(cb)`:

  - gives the HUD an ephemeral, zero-copy `TypedArray` view into meter planes,
  - ideal for higher-frequency visualizations (waveforms, spectrograms).

- `version()`:

  - returns the meter-domain sequence counter (`MUSeq`),
  - useful for detecting whether meters changed without doing a full snapshot.

Budget/degrade knobs are provided by `ObserverOptions.params` / `ObserverOptions.meters`, mirroring the controller/processor options: bounded spin/retry and choice between `'throw'` and `'returnLatest'`.

---

## Types

Key public types (simplified):

```ts
export type PUSeq = number; // param-domains seqlock sequence
export type MUSeq = number; // meter-domains seqlock sequence

export type RangePolicy = "clamp" | "reject";
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

These are used by:

- `controller.params.hydrate(...)`,
- `controller.params.snapshot(...)` (where present),
- `controller.meters.snapshot(...)`,
- observer snapshot helpers.

---

### Controller / Processor / Observer options

```ts
export interface ControllerOptions {
  readonly params?: {
    readonly rangePolicy?: RangePolicy;
  };

  readonly meters?: {
    /**
     * Behavior when snapshot retries are exhausted.
     * - 'returnLatest': return the latest successfully read values.
     * - 'throw': throw `binding.snapshotRetryExhausted`.
     */
    readonly degrade?: "returnLatest" | "throw";

    /** Max spin iterations per snapshot attempt. */
    readonly spinBudget?: number;

    /** Max retry attempts before giving up. */
    readonly retryBudget?: number;
  };

  /**
   * Hint that this binding should be considered the exclusive owner
   * of the backing (used for introspect and future safety checks).
   *
   * Defaults to `true`.
   */
  readonly exclusive?: boolean;
}

export interface ProcessorOptions {
  readonly params?: {
    /**
     * Behavior when coherent reads cannot complete within budgets.
     * - 'returnLatest': return the last successfully read values.
     * - 'throw': throw `binding.coherentRetryExhausted`.
     */
    readonly degrade?: "returnLatest" | "throw";

    /** Max spin iterations per `within()` attempt. */
    readonly spinBudget?: number;

    /** Max retry attempts before giving up. */
    readonly retryBudget?: number;
  };

  readonly meters?: {
    /**
     * Behavior when coherent publishes cannot complete within budgets.
     * - 'returnLatest': keep previous values and return.
     * - 'throw': throw `binding.coherentRetryExhausted`.
     */
    readonly degrade?: "returnLatest" | "throw";

    /** Max spin iterations per `publish()` attempt. */
    readonly spinBudget?: number;

    /** Max retry attempts before giving up. */
    readonly retryBudget?: number;
  };
}
```

Observer bindings use a parallel `ObserverOptions` shape (same `degrade` / `spinBudget` / `retryBudget` knobs), applied to `params`/`meters` **reads** only. Observer options never affect writes because observers are read-only.

---

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

export interface ObserverBinding<S extends SpecInput> {
  readonly params: ObserverParams<S>;
  readonly meters: ObserverMeters<S>;
  dispose(): void;
}

/**
 * Opaque, serializable envelope for a given spec.
 * Type parameter S is used only at compile-time.
 */
export type Handoff<S extends SpecInput = SpecInput> = unknown;

/**
 * Decoded and validated handoff on the consumer side.
 */
export interface AcceptedHandoff<S extends SpecInput = SpecInput> {
  readonly plan: Plan<S>;
  readonly backing: Backing; // shared or shared-partitioned
}
```

---

### Backing types

```ts
export interface SharedBacking {
  readonly kind: "shared";
  readonly sab: SharedArrayBuffer;
  readonly byteLength: number;
}

export interface SharedPartitionedBacking {
  readonly kind: "shared-partitioned";
  readonly planes: Record<PlaneKey, SharedArrayBuffer>;
}

export interface WasmSharedBacking {
  readonly kind: "wasm-shared";
  readonly memory: WebAssembly.Memory;
}

export type Backing =
  | SharedBacking
  | SharedPartitionedBacking
  | WasmSharedBacking;
```

`Plan<S>`, `SharedBacking`, `SharedPartitionedBacking`, and `WasmSharedBacking` are exported generics over `SpecInput` and validated by type tests.

---

## Error Codes

Error domains (grouped by concern), as exposed from the error registry:

- `spec.*` — spec definition / DSL misuse
- `plan.*` — planning/layout issues
- `backing.*` — SAB / WASM allocation, mapping, capacity
- `handoff.*` — handoff envelopes and plan/backing verification
- `binding.*` — controller/processor/observer binding and runtime usage
- `primitives.*` — low-level seqlock/Atomics + SWSR ring primitives
- `env.*` — environment/runtime capability checks
- `diagnostics.*` — diagnostics and introspection
- `internal.*` — internal invariants (`assertionFailed`, `unreachable`, etc.)

Selected examples (non-exhaustive):

- `spec.duplicateKey`, `spec.enumEmpty`, `spec.rangeInvalid`

  - Misuse of the spec DSL.

- `plan.overflowRisk`, `plan.invariant`

  - Plan cannot be realized with safe integer sizes or hits a layout invariant.

- `backing.capacityInsufficient`, `backing.kindMismatch`

  - Backing too small or wrong kind for a given plan.

- `handoff.versionMismatch`, `handoff.specHashMismatch`, `handoff.invalidArtifact`

  - Handoff/plan compatibility issues.

- `binding.unknownKey`, `binding.shapeInvalid`, `binding.paramRange`

  - Binding usage errors: unknown param/meter keys, wrong shapes, out-of-range values (with `rangePolicy: 'reject'`).

- `binding.snapshotRetryExhausted`

  - Cannot obtain a coherent controller/observer snapshot within configured budgets.

- `binding.coherentRetryExhausted`

  - Coherent operations (`params.within`, `meters.publish`, observer `within`) cannot complete within configured budgets.

- `primitives.seqlockTimeout`

  - Low-level seqlock `tryRead` exhausted its internal budget.

- `primitives.swsrRingInvalidLayout`

  - SWSR ring layout invalid or inconsistent with expected header/region sizes.

- `env.unsupported`

  - Environment does not support required primitives (e.g. `SharedArrayBuffer`).

- `env.coopCoepRequired`

  - Indicates missing COOP/COEP when SAB is required in a browser.

- `diagnostics.counterInvalid`, `diagnostics.featureInvalid`

  - Diagnostics counters/feature flags invalid or out-of-range.

- `internal.assertionFailed`, `internal.unreachable`, `internal.exhaustiveness`

  - Internal invariants violated; these indicate bugs in Seqlok itself.

All error codes are centralized in the error registry and covered by tests to prevent accidental renames or silent semantic changes.
