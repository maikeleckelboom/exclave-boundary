# Backing and plane layout

Deterministic, allocation-free memory mapping for Seqlok.

This document explains how a validated **Plan** turns into concrete shared memory **Backings**
and **TypedArray views**, including plane layout, packing rules, and how `mapViews` ties it together.

This is written for people working _inside_ Seqlok (or doing advanced diagnostics),
not for everyday users of `@seqlok/core`.

---

## 1) Mental model: from Spec to Views

### 1.1 User-facing pipeline (golden path)

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  acceptHandoff,
  bindController,
  bindProcessor,
} from "@seqlok/core";

const spec = defineSpec(/* ... */);

// Spec → Plan
const plan = planLayout(spec);

// Plan → Backing (memory)
const backing = allocateShared(plan);

// Owner-side binding
const controller = bindController(spec, plan, backing);

// Cross-agent envelope
const handoff = buildHandoff(plan, backing);

// Consumer-side binding
const accepted = acceptHandoff(handoff);
const processor = bindProcessor(accepted);
````

From the user's point of view:

* `allocateShared(plan)` gives you "the memory"
* `buildHandoff(plan, backing)` gives you "the envelope"
* `bindController` / `bindProcessor` give you "the APIs"

The underlying plane layout and seqlock wiring are internal concerns of backing + bindings.

---

### 1.2 Internal pipeline

Internally we reason about:

```text
Spec
  ── planLayout ─────▶ Plan
  ── allocate* ──────▶ Backing
  ── mapViews ───────▶ Views
```

| Component | Role                                        | Output / contents                                             |
|:----------|:--------------------------------------------|:--------------------------------------------------------------|
| Spec      | User-defined param/meter structure          | —                                                             |
| Plan      | Blueprint (plane sizes, slot tables, total) | per-plane byte lengths, total bytes, slots, hashes            |
| Backing   | Concrete shared storage shaped by the plan  | contiguous SAB / per-plane SABs / shared `WebAssembly.Memory` |
| Views     | TypedArray accessors + seqlock control      | `PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`      |

> **Indexing rule:** slot tables use **byte** `offset` and **element** `length`.
> TypedArray index is `elemIndex = byteOffset / BYTES_PER_ELEM[plane]`.

`mapViews(plan, backing)` is an internal/advanced helper that produces plane-level TypedArrays
and the seqlock control views used by bindings.

---

## 2) Planes, element sizes, and packing

### 2.1 Plane set and element sizes

Planes and element sizes come from `@seqlok/primitives`:

* `PlaneKey`
* `BYTES_PER_ELEM`
* `PLANE_PACK_ORDER`

Current plane set:

| Plane | Purpose       | Typed view   | Elem size |
|:------|:--------------|:-------------|:----------|
| PF32  | Param payload | Float32Array | 4         |
| PI32  | Param payload | Int32Array   | 4         |
| PB    | Param payload | Uint8Array   | 1         |
| PU    | Param control | Uint32Array  | 4         |
| MF32  | Meter payload | Float32Array | 4         |
| MF64  | Meter payload | Float64Array | 8         |
| MU32  | Meter payload | Uint32Array  | 4         |
| MU    | Meter control | Uint32Array  | 4         |

Important boundaries:

* Planes contain **raw numeric storage** only (floats/ints/counters/indices/flags).
* DSL semantics (enum labels, ranges, etc.) live in spec + bindings.
* Kind→plane policy is defined in `core/spec/*`, not in primitives.

---

### 2.2 Canonical packing order

Contiguous and wasm-shared backings use the canonical packing order:

* `PLANE_PACK_ORDER` (from `@seqlok/primitives`)

Tests enforce two invariants in this order:

1. **Contiguity**: `base(curr) == base(prev) + len(prev)`
2. **Alignment**: `base(plane) % BYTES_PER_ELEM[plane] == 0`

The planner is responsible for ensuring each `plan.planes[plane]` is a multiple of
`BYTES_PER_ELEM[plane]`. Given that, backing can pack planes back-to-back without “best-effort”
rounding at this layer.

---

### 2.3 Base offset calculation

`computeBackingPlaneBases` calculates per-plane base offsets (in bytes) by walking the canonical
pack order:

```ts
import { PLANE_PACK_ORDER, type PlaneKey } from "@seqlok/primitives";

export function computeBackingPlaneBases(
  planes: PlaneByteLengths,
  startByteOffset = 0,
): Readonly<Record<PlaneKey, number>> {
  const bases: Record<PlaneKey, number> = {} as Record<PlaneKey, number>;

  let cursor = startByteOffset;
  for (const plane of PLANE_PACK_ORDER) {
    bases[plane] = cursor;
    cursor += planes[plane];
  }

  return bases;
}
```

For wasm-shared mappings, `startByteOffset` must satisfy the strictest alignment used by the layout
(currently 8 bytes due to `MF64`).

---

## 3) Control planes: seqlock layout

Control planes `PU` and `MU` hold the seqlock words for their domain.

Conceptually, each contains at least one pair:

| Index | Meaning | Role                                  |
|:------|:--------|:--------------------------------------|
| 0     | LOCK    | Odd during write, even when quiescent |
| 1     | SEQ     | Monotonic commit counter              |

The Plan guarantees:

* exactly one param seqlock domain (`PU`)
* exactly one meter seqlock domain (`MU`)

Bindings wrap those words into `SeqPair` objects and implement the seqlock protocol.

Backing’s job is only:

* reserve the bytes
* map the `Uint32Array` views
* ensure alignment and size invariants

---

## 4) Backing flavors

Backings are “how a Plan becomes actual memory”. All flavors respect the same Plan; bindings see the
same logical plane set and slot tables regardless of flavor.

| Flavor             | `Backing.kind`       | Container                                   | Mapping                             | Typical use case                         |
|:-------------------|:---------------------|:--------------------------------------------|:------------------------------------|:-----------------------------------------|
| Contiguous SAB     | `shared`             | one `SharedArrayBuffer`                     | all planes slice the same SAB       | default, best locality, simplest handoff |
| Partitioned SAB    | `shared-partitioned` | one SAB per plane                           | each plane has its own SAB          | tooling/debugging, per-plane governance  |
| Shared WASM memory | `wasm-shared`        | shared `WebAssembly.Memory` (`shared:true`) | all planes map over `memory.buffer` | WASM DSP engines owning the memory pool  |

### 4.1 Allocation entry points

```ts
declare function allocateShared<S extends SpecInput>(plan: Plan<S>): SharedBacking;
declare function allocateSharedPartitioned<S extends SpecInput>(
  plan: Plan<S>,
): SharedPartitionedBacking;
declare function allocateWasmShared<S extends SpecInput>(plan: Plan<S>): WasmSharedBacking;
```

All allocators:

* expect a validated Plan
* validate `bytesTotal` / per-plane byte lengths and throw structured errors on failure

---

## 5) Mapping Plan → Views

### 5.1 `mapViews(plan, backing)` (internal/advanced)

`mapViews` produces:

* typed views for each plane (`Float32Array`, `Float64Array`, `Int32Array`, `Uint8Array`, `Uint32Array`)
* seqlock control views for params (`PU`) and meters (`MU`)

Conceptually:

```ts
const views = mapViews(plan, backing);

views.params.PF32; // Float32Array over PF32
views.params.PI32; // Int32Array over PI32
views.params.PB;   // Uint8Array over PB
views.params.PU;   // Uint32Array over PU (control)

views.meters.MF32; // Float32Array over MF32
views.meters.MF64; // Float64Array over MF64
views.meters.MU32; // Uint32Array over MU32
views.meters.MU;   // Uint32Array over MU (control)

views.locks.PU;    // same underlying view as params.PU
views.locks.MU;    // same underlying view as meters.MU
```

Internally:

* For `shared` / `wasm-shared`:

  * obtain a single buffer
  * compute bases via `computeBackingPlaneBases(plan.planes, baseOffset)`
  * create TypedArray views using bases and `BYTES_PER_ELEM`

* For `shared-partitioned`:

  * each plane uses its own SAB
  * bases are `0` per plane
  * validate each SAB is at least `plan.planes[plane]` bytes

---

## 6) Invariants and failure behavior

Backing/layout code is intentionally strict:

* undersized buffers are hard errors
* base offsets must satisfy alignment (especially for wasm-shared base offsets)
* contiguity and alignment invariants are enforced by tests

There is no “best-effort” packing: planner + backing must agree exactly on layout.
If they don’t, it’s treated as a bug, not a recoverable condition.

---

## 7) Design intent

Backing and layout code should have a particular personality:

* **Backings are dumb**: bytes, buffers, typed views, and control words.
* **Plan + bindings are where the meaning lives**: kinds, ranges, enum labels, seqlock protocol usage.
* **Zero allocations in the hot path**: allocation/mapping is setup-time only.
* **Strong invariants, loud failures**: make layout bugs obvious and early.

The goal is not cleverness. The goal is being painfully explicit about where every byte lives,
so everything above can be safe, fast, and deterministic.
