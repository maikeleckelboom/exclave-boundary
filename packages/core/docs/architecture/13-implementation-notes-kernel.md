# Implementation Notes (Kernel)

Internal details for contributors and advanced users.
This document explains _how_ the kernel achieves its guarantees without imposing runtime overhead on hot paths.

---

## 1. Design principles

### Boring wire, not a framework

The core provides:

- `spec → plan → backing → handoff → bindings`
- seqlock-based synchronization
- typed controller / processor facades

It intentionally does **not** provide:

- reactivity / change-tracking
- schema migration or persistence
- scheduling, scenes, or orchestration

Those live in higher layers (devices, drivers, apps, `@seqlok/compose`).

### Fail-fast over fail-safe

When invariants are broken (mismatched layouts, wrong handoff, undersized backing, out-of-range writes), the library
throws a typed `SeqlokError`.

- No silent recovery
- No "best effort" remapping of incompatible layouts
- Clear error codes that can be logged, surfaced in UIs, or mapped to metrics

The cost is a synchronous throw at the boundary where the invariant is violated; the benefit is avoiding corruption in
long-lived processes.

### Zero-allocation hot paths

After `bindController` / `bindProcessor`:

- `processor.params.within`
- `processor.meters.publish`
- controller param writes (`params.set` / `params.update` / `params.stage`)
- controller meter snapshots that reuse `into` buffers

…are all implemented without heap allocations in the kernel. Any objects you create inside callbacks are your
responsibility.

Plain `controller.meters.snapshot()` **does** allocate result objects and typed arrays; it is expected to run off the RT
thread (UI, logging, tooling).

### Type safety with no runtime cost

Types encode:

- legal param/meter keys per spec
- scalar vs array shape
- enum label unions and value domains

Bindings precompute:

- byte offsets (`offsetBytes`)
- TypedArray indices (`offsetBytes / BYTES_PER_ELEM[plane]`)
- function closures for scalar reads/writes and array staging

At runtime, a field access is a direct TypedArray load/store behind a simple property read / function call. There are:

- no proxies
- no dynamic shape lookups
- no schema reflection in the hot path

### Deterministic plan

Given the same spec:

```ts
const planA = planLayout(spec);
const planB = planLayout(spec);
```

…you must get the same layout: plane lengths, offsets, and hash.

This enables:

- reproducible debugging
- out-of-process tooling
- independent re-implementation in other languages that accept the same spec/plan format

---

## 2. Handoff hashing & optional verification

### Why hash

We want cheap detection of accidental spec/plan/backing mismatches across agents:

- Controller may be upgraded before workers.
- Multiple workers may share similar but not identical specs.
- A wiring bug can easily connect the wrong backing to the wrong spec.

A layout-level hash + size checks provide a low-cost compatibility guard.

### What is hashed

At minimum, the hash covers:

- spec identity (internal id / version)
- param/meter keys
- kinds (`f32`, `i32`, `bool`, `enum`, arrays)
- array lengths
- enum domains (labels in declaration order)

The exact algorithm is an internal 64-bit hash (exposed as `bigint`), not part of the public ABI. Only **equality** of
hashes matters.

### Where it lives

- `plan.hash` — the hash computed from the spec at planning time.
- `handoff.meta.hash` — the hash stored alongside plane lengths/metadata in the handoff envelope.
- `plan.bytesTotal` and `handoff.meta.bytesTotal` — compared as a coarse size guard.

`buildHandoff(plan, backing)` copies the relevant metadata (`hash`, `bytesTotal`, per-plane byte lengths) into the
handoff.

### Verification options

Golden pipeline on the processor side:

```ts
const received = receiveHandoff(msg.handoff);
const processor = bindProcessor(received);
```

In this flow:

- `bindProcessor(received)` trusts that the `handoff` came from the **matching** `plan`.
- The cooperative assumption is: controller and processor are compiled from the same bundle / version.

For environments that want stronger checks (tests, diagnostics, hardened pipelines), core exposes an explicit verifier:

```ts
const plan = planLayout(spec); // same spec as the controller used
const received = receiveHandoff(msg.handoff);

verifyHandoff(plan, received); // throws on mismatch
const processor = bindProcessor(received); // slim binding, no extra hashing
```

The verifier:

1. Compares `plan.hash` against `received.meta.hash`.
2. Compares `plan.bytesTotal` against `received.meta.bytesTotal`.
3. Fails fast with a `handoff.invalidArtifact` (or related) error if they disagree.

Design intent:

- **Hashing lives at the handoff layer** and is cheap.
- **Verification is explicit** and can run on the controller or a non-RT worker.
- `bindProcessor(received)` stays slim for RT use; deep paranoia belongs in verifier calls, not in the hot path.

---

## 3. Seqlock mechanics (kernel level)

Seqlok uses a **dual-counter seqlock** per family (params, meters). Control planes are `Uint32Array`s:

```text
PU: [LOCK, SEQ]  // params domain
MU: [LOCK, SEQ]  // meters domain
```

At the conceptual level we think of:

```text
LOCK: u32   // parity encodes writer activity
SEQ : u32   // commit stamp with wraparound
```

- `LOCK` parity encodes writer activity:

  - even → quiescent
  - odd → writer active

- `SEQ` is a **commit stamp**, incremented exactly once per successful commit.

### Writer protocol (conceptual)

Writers are **single-writer by design** (SWMR) per family. Implementation relies on that: no CAS in the steady state.

For one write epoch:

1. `LOCK += 1` (enter; becomes odd)
2. Write payload (all scalars/arrays in that family)
3. `LOCK += 1` (exit; becomes even)
4. `SEQ += 1` (commit fence)

The final `SEQ` bump is the visibility point: readers pair their second `SEQ` load with this store.

If the writer throws during step 2, the kernel guarantees:

- `LOCK` is returned to an even value.
- `SEQ` is **not** bumped.

This prevents lock poisoning.

### Reader protocol (via primitives)

Readers use `tryRead` / `acquire` from the seqlock primitives against a `SeqPair`:

```ts
const { ok, value, status } = tryRead(pair, reader, options);
```

Where `status` is conceptually:

```ts
interface SpinStatus {
  readonly spins: number;
  readonly retries: number;
  readonly kind: "ok" | "writerActive" | "budgetExhausted";
}
```

Behaviour:

1. Spin while `LOCK` is odd (bounded).

2. Capture `SEQ` → `s1`.

3. Invoke `reader()` to sample payload.

4. Capture `SEQ` → `s2`.

5. If `LOCK` even and `s1 === s2`:

- `ok: true`, `kind: 'ok'` – snapshot is coherent.

6. If the writer **never quiesces** within the spin budget:

- `ok: false`, `kind: 'writerActive'` — value is whatever `reader()` returned on the last attempt (a degraded sample).

7. If the retry budget is exhausted:

- `kind: 'budgetExhausted'`, and `tryRead` (or its wrapper) throws `SeqlokError<'primitives.seqlockTimeout'>`.

`acquire` wraps `tryRead` with a policy (`'fallback' | 'timeout'`) and is what bindings call in hot paths.

### Memory ordering

We rely on the sequentially consistent semantics of JS Atomics.

Writer:

- writes payload (params/meters) into TypedArrays
- then uses `Atomics.store` / `Atomics.add` on `LOCK` / `SEQ`

Reader:

- `Atomics.load` on `SEQ` (and `LOCK`) before payload reads
- `Atomics.load` on `SEQ` (and `LOCK`) after payload reads

On a coherent read (`LOCK` even and `s1 === s2`), the reader sees either the full **before** state or the full
**after** state — never a torn combination within that family.

---

## 4. Binding implementation: `within`, `publish`, `snapshot`

This section connects the seqlock primitives to the public bindings.

### Controller → params (writer side)

Controller is the **only writer** for params.

- `controller.params.set(key, value)`
- `controller.params.update(patch)`
- `controller.params.stage(key, cb)` for array params

Internally:

- These operations use the param seqlock pair `(PU.LOCK, PU.SEQ)` via the writer primitive.
- Each logical commit (set/update/stage) is implemented as a `publish` epoch:

  - payload writes under an odd `LOCK`
  - one `SEQ` bump on successful completion

Invariants:

- Exactly **one** `SEQ` bump per successful commit.
- If the user callback throws (e.g. inside `stage`), we unlock without bumping `SEQ`.

This is what makes `processor.params.within` coherent.

### `processor.params.within(cb)`

The processor reads **params** written by the controller via `processor.params.within(cb)`.

- Uses `acquire` over the **param** pair `(PU.LOCK, PU.SEQ)`.

- On each attempt:

  - Captures all scalar params into a compact struct.
  - Reuses pre-created aliasing views for array params.

- If `acquire` returns `kind: 'ok'`:

  - Invokes `cb(params)` with that struct and views.

- If `acquire` reports `'writerActive'`:

  - Retries until spin/retry budgets are hit.

- If budgets are exhausted:

  - Throws `primitives.seqlockTimeout` with spin/retry counts.

Views are scoped to the callback:

- No allocations per call in the kernel.
- User code must treat views as ephemeral; reusing them outside `cb` is a contract violation.

### `processor.meters.publish(cb)`

The processor is the **only writer** for meters.

- Uses the **meter** pair `(MU.LOCK, MU.SEQ)`.
- Wrapper around `publish(pair, writer)` from the primitives:

  - `LOCK` bumped odd → even
  - `SEQ` bumped once on successful completion

Scalar meters are exposed as writer functions: `m.peak(value)`.
Array meters use `stage`:

```ts
processor.meters.publish((m) => {
  m.peak(peakValue);
  m.spectrum.stage((buf) => {
    buf.set(computedSpectrum); // single SEQ bump for the whole frame
  });
});
```

Internal invariant:

- Exactly **one** `SEQ` bump per `publish`.
- Errors inside `cb` unlock without bumping `SEQ`.

### `controller.meters.snapshot(...)` (best-effort)

Controller meter reads are explicitly **cold-path, best-effort**. They do **not** use the seqlock primitives; they
perform straight reads from the meter planes.

Shapes:

```ts
// 1) Single scalar by name
const peak = controller.meters.snapshot("peak");

// 2) A small set of keys
const { peak, rms } = controller.meters.snapshot(["peak", "rms"]);

// 3) Object form + into buffers
const into = { spectrum: new Float32Array(1024) };
const { spectrum } = controller.meters.snapshot(["spectrum"], { into });
```

Implementation notes:

- All forms normalize into a set of meter keys and an optional `into` map.

- Scalars are copied into a plain object.

- Arrays:

  - Without `into`: new TypedArrays are allocated and filled.
  - With `into`: user-provided buffers are **validated**:

    - constructor must match
    - length must match the planned length

  On mismatch, a typed `binding.snapshotIntoLengthMismatch` / `binding.shape` error is thrown.

- Returned arrays are readonly at the type level, but in the `into` case they alias the provided buffer so callers
  can reuse them.

Coherence:

- Reads may overlap with processor writes.
- It is possible to observe mixed frames ("before" and "after" in one snapshot).
- This is acceptable for UI meters, debug HUDs, logging, etc.

If you need strict visualizer-grade coherence, that belongs in a dedicated **observer** binding built on top of the same
seqlock primitives (see ADR-00Z / MWMR docs).

---

## 5. Planes, offsets, and bindings

### Planner responsibilities

`planLayout(spec)` computes, for each key:

- `plane`: which plane holds the value (`PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`)
- `offsetBytes`: byte offset into that plane
- `length`: element count (arrays only)

And for each plane:

- `lengthBytes`: total bytes used across all fields
- `baseOffset`: where the plane starts inside the contiguous SAB (for shared/wasm backings)

It also assigns the control planes `PU` and `MU` and their seqlock slots.

### Binding construction

Bindings:

1. Map `(plan, backing)` into concrete TypedArrays per plane using the backing layer (`mapViews`).

2. Precompute index and length per key:

- `index = offsetBytes / BYTES_PER_ELEM[plane]`.

3. Build small inline helpers:

- controller param writers: `set`, `update`, `stage`
- processor param readers: struct field getters + aliasing array views
- processor meter writers: scalar writers + array `stage` callbacks
- controller meter readers: snapshot helpers

There is no reflection or dynamic shape at runtime; everything flows from the `Plan`.

---

## 6. Value validation & range policy

### Controller → params

At the binding boundary, runtime validation enforces:

- **Key correctness** — TS prevents invalid keys; runtime still guards against corrupted plans/backings.
- **Type family correctness** — you can’t accidentally use a f32 writer for an enum field.
- **Range policy** for numeric params:

  ```ts
  bindController(spec, plan, backing, {
    rangePolicy: "clamp", // or 'reject'
  });
  ```

  - `rangePolicy: 'clamp'` — values are clamped to `[min, max]`.
  - `rangePolicy: 'reject'` — out-of-range values throw `binding.paramRange`.

Arrays:

- Shape is validated (length must match planned).
- There is no per-element clamping; callers are expected to respect the numeric domain.

### Processor → meters

Meters are treated as **telemetry**:

- Scalar writers accept finite `number`s (subject to domain checks where relevant).
- Arrays must match shape; otherwise a `binding.shape` error is thrown.
- Booleans are encoded as `0`/`1` in `MU32`.

Representative error codes from this layer:

- `binding.invalidValue`
- `binding.paramRange`
- `binding.shape`
- `binding.snapshotIntoLengthMismatch`

---

## 7. Diagnostics & ergonomics hooks

### `version()` helpers

Both families expose a cheap version helper that reads the underlying seqlock `SEQ` as a `u32` with wraparound:

```ts
const pv = controller.params.version(); // PU.SEQ
const mv = controller.meters.version(); // MU.SEQ
```

Each is a single atomic load. Typical pattern:

```ts
let last = controller.meters.version();

function frame() {
  const v = controller.meters.version();
  if (v !== last) {
    last = v;
    const meters = controller.meters.snapshot(["peak", "rms"]);
    drawMeters(meters);
  }
  requestAnimationFrame(frame);
}
```

Only equality comparisons are used; wraparound does not matter for this pattern.

### Error detail payloads

All `SeqlokError` instances carry structured `details`, for example:

- Seqlock timeouts:

  - `spins`, `retries`, domain (`'params' | 'meters'`), where (`'params.within'`, `'meters.publish'`, …).

- Backing / plan issues:

  - expected vs actual byte lengths, plane lengths, hashes.

- Binding issues:

  - key, expected shape/range, actual value.

This makes it easy to:

- dump meaningful logs
- surface targeted error messages in UIs
- assert on specific failure modes in tests

### Helpers & kits

Higher-level helpers (outside the kernel) are encouraged to:

- close over `spec` and `plan` to avoid repetition in app code
- offer "device kits" or "engine kits" that return controller + handoff factories
- remain thin: **no** extra concurrency semantics beyond what the kernel already provides

---

## 8. Future toggles (non-contract v1)

The following are implementation options, **not** part of the v0.1.0 public contract:

- Tunable spin/retry budgets for extreme workloads or platform quirks.
- Extended seqlock state `(SEQ, GEN)` for stricter anti-ABA guarantees if a future use case truly needs it.
- Optional richer status on public APIs (`withinWithStatus`, observer-style `snapshotWithStatus`) that surface
  `SpinStatus` directly.
- Dedicated boolean planes if/when runtimes expose atomic 8-bit operations with suitable semantics.
- [moved to core] A first-class observer binding in `@seqlok/core` for seqlock
  readers is now implemented (`bindObserver`, see ADR-00Z). The remaining future
  toggles are about *how* observers budget and degrade, not about their existence.

Any such feature must preserve the core invariants:

- deterministic plan
- single writer per family (SWMR)
- seqlock-based coherence
- zero-allocation hot paths

---

These notes are the glue between the high-level docs and the actual kernel: they describe how the guarantees are
implemented and where to look when you need to change behaviour.
