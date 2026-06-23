# Backing & Plane Layout

Deterministic, allocation-free memory mapping for Seqlok.

This doc explains how a validated **Plan** turns into concrete shared memory **Backings** and **TypedArray views**,
including plane layout, packing rules, and how `mapViews` ties it together.

It's written for people working _inside_ Seqlok (or doing advanced diagnostics), not for everyday users of
`@seqlok-internal/prototype-core`.

---

## 1. Mental Model: From Spec to Views

There are two parallel ways to think about the pipeline.

### 1.1 User-facing pipeline (golden path)

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  receiveHandoff,
  bindController,
  bindProcessor,
} from "@seqlok-internal/prototype-core";

const spec = defineSpec(/* ... */);

// Layout planner: spec → Plan
const plan = planLayout(spec);

// Backing allocation: Plan → memory
const backing = allocateShared(plan);

// Agent-local controller binding (owner side)
const controller = bindController(spec, plan, backing);

// Envelope for cross-agent handoff
const handoff = buildHandoff(plan, backing);
// send `handoff` to another agent...

// Agent-local processor binding (consumer side)
const received = receiveHandoff(handoff);
const processor = bindProcessor(received);
```

From the user's point of view:

- `allocateShared(plan)` gives you "the memory".
- `buildHandoff(plan, backing)` gives you "the envelope".
- `bindController` / `bindProcessor` give you "the APIs".

The actual **plane layout** and **seqlock wiring** are internal concerns of the backing + bindings code.

---

### 1.2 Internal mental model

Internally we still reason in terms of a simple pipeline:

```text
Spec
  ── planLayout ─────▶ Plan
  ── allocate* ──────▶ Backing
  ── mapViews ───────▶ Views
```

| Component   | Role                                       | Output / contents                                             |
| :---------- | :----------------------------------------- | :------------------------------------------------------------ |
| **Spec**    | User-defined param/meter structure         | —                                                             |
| **Plan**    | Blueprint (plane sizes, offsets, slots)    | Per-plane byte lengths, total bytes, slot tables, hashes      |
| **Backing** | Concrete shared storage shaped by the plan | Contiguous SAB / per-plane SABs / shared `WebAssembly.Memory` |
| **Views**   | TypedArray accessors + seqlock control     | `PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`      |

> **Indexing rule:** slot tables use **byte** `offset` and **element** `length`.
> TypedArray index is always `elemIndex = byteOffset / BYTES_PER_ELEM[plane]`.

`mapViews(plan, backing)` is the internal/advanced helper that does the offset math and produces the plane-level
TypedArrays and `SeqPair`s for bindings. It is **not** part of the normal public flow and is never called from the
processor side.

---

## 2. Planes, Alignment, and Packing

### 2.1 Canonical planes & element sizes

These match the primitives doc and the `BYTES_PER_ELEM` constants; they are the only planes in ABI v1:

| Plane  | Purpose       | Data stored                                       | Elem size |
| :----- | :------------ | :------------------------------------------------ | :-------- |
| `PF32` | Param payload | `f32` scalars + `f32.array` elements              | 4 bytes   |
| `PI32` | Param payload | `i32` scalars + `i32.array` + **enum indices**    | 4 bytes   |
| `PB`   | Param payload | `bool` / `bool.array` as 0/1                      | 1 byte    |
| `PU`   | Param control | Param seqlock control words `[LOCK, SEQ]`         | 4 bytes   |
| `MF32` | Meter payload | `f32` scalars + `f32.array`                       | 4 bytes   |
| `MF64` | Meter payload | `f64` scalars + `f64.array` (hi-res time / stats) | 8 bytes   |
| `MU32` | Meter payload | `u32` counters/flags, **bool meters as 0/1**      | 4 bytes   |
| `MU`   | Meter control | Meter seqlock control words `[LOCK, SEQ]`         | 4 bytes   |

Conventions:

- Bool **params** live in `PB` (0/1 bytes).
- Bool **meters** live in `MU32` (0/1 u32).
- Seqlock control is always `Uint32Array` (`PU` and `MU`).

> **No DSL leakage.** Planes contain **raw numeric payload only** (floats, ints, counters, indices, flags).
> Enum labels, ranges, etc., live entirely in the spec + bindings – never in the planes.

---

### 2.2 Packing order & alignment invariants

Contiguous and wasm-shared backings use a single ABI-controlled packing order, exposed as:

```ts
export const BACKING_PLANE_PACK_ORDER_V1: readonly PlaneKey[] = [
  "MF64",
  "PF32",
  "PI32",
  "PU",
  "MF32",
  "MU32",
  "MU",
  "PB",
];
```

The planner guarantees that each entry in `plan.planes[plane]` is a whole-number multiple of `BYTES_PER_ELEM[plane]`.
Given that, `computeBackingPlaneBases` just packs the planes back-to-back in that order:

```ts
export function computeBackingPlaneBases(planes: PlaneByteLengths): PlaneBases {
  const bases = createZeroPlaneBases();
  let cursor = 0;

  for (const plane of BACKING_PLANE_PACK_ORDER_V1) {
    bases[plane] = cursor;
    cursor += planes[plane];
  }

  return bases;
}
```

This ordering gives us:

- `MF64` first → all subsequent planes start on an 8-byte multiple, so all 4-byte planes are naturally aligned.
- `PB` last → 1-byte plane; alignment is trivial.

Effective alignment rules:

- `PF32`, `PI32`, `PU`, `MF32`, `MU32`, `MU` are **4-byte aligned**.
- `MF64` is **8-byte aligned**.
- `PB` is at least 1-byte aligned (and often 4-byte by construction).

We don't need an extra `roundUpTo` at this layer; alignment is encoded into:

- the `BACKING_PLANE_PACK_ORDER_V1` ABI, and
- the requirement that `plan.planes[plane]` respects `BYTES_PER_ELEM[plane]`.

If any of that is violated, it's treated as a planner/backing bug and caught by assertions/tests rather than
“best-effort” packing.

---

### 2.3 Control planes: seqlock layout

Control planes `PU` and `MU` hold exactly the seqlock words for their domain:

| Index | Meaning | Role                                                       |
| :---- | :------ | :--------------------------------------------------------- |
| `0`   | `LOCK`  | Odd during write, even when quiescent                      |
| `1`   | `SEQ`   | Increments exactly once per successful commit (“one bump”) |

The Plan guarantees:

- Exactly **one** param seqlock pair (`PU`) per backing.
- Exactly **one** meter seqlock pair (`MU`) per backing.

Bindings then wrap these via `createSeqPair`:

```ts
const paramSeq = createSeqPair(views.PU, lockIndexP, seqIndexP);
const meterSeq = createSeqPair(views.MU, lockIndexM, seqIndexM);
```

> **Implementation detail:** we _may_ over-allocate control planes to cache-line multiples (e.g. 64B) to reduce false
> sharing. That's not part of the public ABI; it's just a backing implementation choice as long as the Plan is coherent.

---

## 3. Backing Flavors

Backings are "how a Plan becomes actual memory". All flavors respect the **same Plan**; bindings see the same logical
layout and slot tables regardless of backing flavor.

The three main strategies:

| Flavor             | `Backing.kind`         | Container                                    | Mapping                                  | Typical use case                               |
| :----------------- | :--------------------- | :------------------------------------------- | :--------------------------------------- | :--------------------------------------------- |
| Contiguous SAB     | `'shared'`             | **One** `SharedArrayBuffer`                  | All planes slice the same SAB            | Golden path: best locality, simplest handoff   |
| Per-plane SAB      | `'shared-partitioned'` | **One SAB per plane**                        | Each plane has its own SAB               | Debugging, tooling, exotic memory governance   |
| Shared Wasm memory | `'wasm-shared'`        | **One** `WebAssembly.Memory` (`shared:true`) | All views map over `memory.buffer` (SAB) | WASM DSP engines that own the main memory pool |

### 3.1 Public backing entry points

Backings are created via the backing layer:

```ts
// Contiguous SAB (golden path)
declare function allocateShared<S extends SpecInput>(
  plan: Plan<S>,
): SharedBacking;

// Separate SAB per plane (advanced / tooling)
declare function allocateSharedPartitioned<S extends SpecInput>(
  plan: Plan<S>,
): SharedPartitionedBacking;

// Shared WebAssembly.Memory (advanced)
declare function allocateWasmShared<S extends SpecInput>(
  plan: Plan<S>,
): WasmSharedBacking;
```

Common properties:

- All expect a **validated Plan**.
- All enforce `bytesTotal` and per-plane byte-length invariants.
- All throw typed `SeqlokError`s from the `backing.*` or `env.*` domains on failure.

Bindings work against the union `Backing` abstraction; they do not care which flavor produced it.

---

### 3.2 `kind: 'shared'` – contiguous SAB (golden path)

`allocateShared(plan)`:

- Allocates a single `SharedArrayBuffer(plan.bytesTotal)`.
- Uses `computeBackingPlaneBases(plan.planes)` + `BACKING_PLANE_PACK_ORDER_V1` to establish per-plane base offsets.
- Returns a `SharedBacking` the rest of the stack can use.

Benefits:

- Best cache locality.
- Simple `buildHandoff(plan, backing)` envelope:

  - single SAB reference,
  - plan metadata (hash, `bytesTotal`, per-plane lengths).

- Easiest to reason about for both JS and WASM consumers.

This is the **default** path used by examples and recommended for most use cases.

---

### 3.3 `kind: 'shared-partitioned'` – one SAB per plane

`allocateSharedPartitioned(plan)`:

- Allocates one `SharedArrayBuffer` **per plane**:

  ```ts
  PF32: new SharedArrayBuffer(plan.planes.PF32);
  PI32: new SharedArrayBuffer(plan.planes.PI32);
  // ...
  ```

- Each plane's base offset is implicitly `0` in its own SAB.

- Returns a `SharedPartitionedBacking` that still implements the `Backing` union.

Reasons to use this:

- Debugging / diagnostics / tooling that wants to observe or swap planes individually.
- Exotic memory governance where different planes have different budgets or lifetimes.

Tradeoffs:

- Worse locality than a single-SAB backing.
- Handoffs involve more references if you surface all planes across agents.

Internally, `mapViews` treats this variant specially:

- It does **not** call `computeBackingPlaneBases`.
- It validates each per-plane SAB has at least `plan.planes[plane]` bytes.
- It constructs a per-plane TypedArray from offset `0` in each SAB.

---

### 3.4 `kind: 'wasm-shared'` – shared WebAssembly.Memory

`allocateWasmShared(plan)`:

- Allocates a `WebAssembly.Memory` with `{ shared: true }`.
- Verifies its `buffer` is a `SharedArrayBuffer` and large enough for `plan.bytesTotal`.
- Uses the same `BACKING_PLANE_PACK_ORDER_V1` + `computeBackingPlaneBases(plan.planes)` scheme as the contiguous SAB.

Typical deployment:

- A WASM DSP engine (Rust/C/C++) owns a shared `WebAssembly.Memory`.
- JS bindings treat it as a backing and map Seqlok's views into that memory.

Constraints:

- Growing `memory` **after** binding is allowed as long as the original layout stays valid.
- Shrinking `memory` or reusing it for a different Plan is undefined behavior from Seqlok's POV.

---

## 4. Mapping Plan → Views

### 4.1 `mapViews(plan, backing)` (internal / advanced)

`mapViews` turns:

- a `Plan` (plane byte lengths + slot tables), and
- a `Backing` (SAB(s) or shared `WebAssembly.Memory`)

into concrete TypedArrays and locks:

- `Float32Array` / `Float64Array` / `Int32Array` / `Uint8Array` / `Uint32Array` per plane.
- `Uint32Array` views that hold the seqlock words for params (`PU`) and meters (`MU`).

Conceptually:

```ts
const views = mapViews(plan, backing);

// examples:
views.params.PF32; // Float32Array over PF32 plane
views.params.PI32; // Int32Array over PI32 plane
views.params.PB; // Uint8Array over PB plane
views.params.PU; // Uint32Array over PU (control)

views.meters.MF32; // Float32Array over MF32 plane
views.meters.MF64; // Float64Array over MF64 plane
views.meters.MU32; // Uint32Array over MU32 plane
views.meters.MU; // Uint32Array over MU (control)

// Seqlock integration
views.locks.PU; // same underlying view as params.PU
views.locks.MU; // same underlying view as meters.MU
```

Internally:

- For `kind: 'shared' | 'wasm-shared'`:

  - grab a single SAB via `getBackingBuffer(backing)`,
  - use `computeBackingPlaneBases(plan.planes)` to compute per-plane bases,
  - slice TypedArrays using those bases and `plan.planes[plane] / BYTES_PER_ELEM[plane]`.

- For `kind: 'shared-partitioned'`:

  - each plane uses its own SAB,
  - all bases are implicitly `0` for that plane,
  - per-plane SABs are checked against `plan.planes[plane]`.

**Invariants:**

- `views.bases[plane]` matches whatever `computeBackingPlaneBases(plan.planes)` returns for that flavor.
- Each view's `byteLength` is exactly `plan.planes[plane]`.
- For packed backings, `buf.byteLength >= plan.bytesTotal`; otherwise `backing.allocUndersized`.
- Seqlock views (`locks.PU`, `locks.MU`) line up with the slots the bindings expect.

> **Policy:** `mapViews` is an internal/advanced helper. In the canonical flow, the processor only sees a
> `ReceivedHandoff` and `bindProcessor` builds its views from that; it does **not** call `mapViews` directly.

---

### 4.2 Bindings + seqlock integration (context)

Bindings consume `mapViews` output:

- **Controller binding**:

  - param views + param `SeqPair` → `params.set`, `params.update`, `params.stage`,
  - meter views + meter `SeqPair` → `meters.snapshot`, `meters.version`.

- **Processor binding**:

  - param views + param `SeqPair` → `params.within`,
  - meter views + meter `SeqPair` → `meters.publish`, `meters.stage`.

The backing layer:

- never embeds spec semantics ("this float is a filter cutoff"),
- only knows: planes, bytes, and seqlock words.

The bindings layer:

- never assumes more about physical layout than what Plan + backing expose.

---

## 5. Error Conditions & Environment

### 5.1 Backing & mapping errors

Representative backing-domain errors:

| Condition                         | Error code                    | Notes                                                     |
|:----------------------------------|:------------------------------|:----------------------------------------------------------|
| Buffer too small for `bytesTotal` | `backing.allocUndersized`     | Broken allocator or mismatched Plan                       |
| Wasm memory not shared            | `backing.wasmMemoryNotShared` | `WebAssembly.Memory` wasn't created with `shared:true`    |
| Misuse of partitioned backing     | `internal.assertionFailed`    | e.g. calling `getBackingBuffer` on `'shared-partitioned'` |

These are treated as configuration/programming faults, not runtime "soft failures".

### 5.2 Environment constraints

Environment-domain preconditions (roughly):

- Browsers:

  - `SharedArrayBuffer` requires cross-origin isolation (COOP/COEP).
  - Workers / AudioWorklets must live in the same agent cluster.

- Node / other runtimes:

  - need `SharedArrayBuffer` + `Atomics` support,
  - worker model must allow sharing SAB between threads.

Allocators check these once and throw `env.*` codes if shared memory is unavailable. Callers are expected to fail fast
and either:

- disable Seqlok-backed features, or
- refuse configurations that claim to be "real-time" without SAB support.

There is **no** postMessage/clone "fallback mode"; copying would violate Seqlok's core guarantees.

---

## 6. Backing Variants & ABI Stability

Backing implementations can evolve internally (padding, different SAB allocation strategies, diagnostics helpers), but
ABI v1 constrains:

- Plane set is fixed: `PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`.

- Packing order for contiguous / wasm backings is fixed by `BACKING_PLANE_PACK_ORDER_V1`:

  ```text
  MF64 → PF32 → PI32 → PU → MF32 → MU32 → MU → PB
  ```

- Plane byte lengths and bases are determined **only** by the Plan.

- Control planes `PU` and `MU` always contain a single seqlock pair `[LOCK, SEQ]`.

- Backing flavor (`'shared'` vs `'shared-partitioned'` vs `'wasm-shared'`) is not observable through the binding APIs;
  only performance/tooling might care.

As long as those invariants hold, backings are interchangeable from the perspective of:

- `buildHandoff` / `receiveHandoff`,
- `bindController` / `bindProcessor`,
- the concurrency model documented elsewhere.

---

## 7. Design Intent

Backing & plane layout code has a very specific personality:

- **Backings are dumb.**

  - They know bytes, SABs, TypedArrays, and seqlock words.
  - They do **not** know about "filters", "meters", or any domain semantics.

- **All cleverness lives in Plan + bindings.**

  - The planner decides how bytes are carved up.
  - Bindings decide how to _use_ them (seqlock protocol, type-safe views, APIs).

- **Zero allocations in the hot path.**

  - `allocateShared*`, `allocateWasmShared`, `allocateSharedPartitioned`, and `mapViews` are setup-time only.
  - `params.within`, `meters.publish`, `meters.snapshot` never allocate backing or views.

- **Strong invariants, loud failures.**

  - Undersized buffers, non-shared WASM memory, and layout mismatches are hard errors.
  - There is no "best effort" layout; the planner + backing pair must be correct.

If you're working on this layer, the goal is not to be clever. The goal is to be boring, predictable, and painfully
explicit about where every byte lives. Everything above you depends on that staying true.
