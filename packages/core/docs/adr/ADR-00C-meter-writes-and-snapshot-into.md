# Alternative Dispute Resolution 2025-11-12 — Meter Writes & Snapshot `into` (Seqlok v1)

**Status:** Accepted
**Date:** 2025-11-12
**Scope:** `@seqlok/core` bindings — meter writing API and controller snapshots
**Decision Owners:** Binding/API maintainers

---

#

## 0) Summary

We finalize two user-visible binding decisions:

1. **No lazy scalar setters.** Scalars are written by value; arrays are written via a mutator callback. We keep three
   entry points with distinct use cases:

- **Direct scalar writers**: `writer.peak(1.25)` — hot path
- **Generic writer**: `writer.set(key, valueOrMutator)` — dynamic keys, single mental model
- **Explicit array mutation**: `writer.stage('spectrum', dst => { /* mutate */ })`

2. **Controller snapshot keeps `into` as a nested option** (do **not** flatten). Arrays may be zero-copied into
   caller-supplied buffers via `snapshot(keys, { into: { arrayKey: buffer } })`.

These choices preserve semantic clarity, maintain type precision, and avoid runtime discrimination overhead.

---

## 1) Rationale

### 1.1 Scalars by value; arrays by mutation

- Different semantics: scalars are cheap immutable values; arrays are buffers mutated in place.
- Type safety: avoids "lazy" scalar callbacks and forgotten returns.
- Performance: avoids per-call key lookups / extra invocations for scalars.
- API honesty: two data categories → two write styles. `set()` supports both without weakening rules.

### 1.2 Keep `into` nested

- Signals intent: `into` is an explicit destination map for zero-copy writes.
- Future-proof: room for options like `format` / `precision` / `normalize` without clashing with meter names.
- Simple types & impl: buffers (`into`) are separated from other options.

---

## 2) Canonical API (high-level)

### 2.1 Processor — meter writers

Inside `processor.meters.publish(fn)` we expose three entry points:

- **Per-key scalar methods** generated from the spec: `w.peak(v)`, `w.rms(v)`, …
- **Generic `set(key, valueOrMutator)`** for dynamic keys or single-model code.
- **`stage(key, fn)`**: explicit array mutation; thin alias of the array branch of `set`.

**Invariant:** one MU bump per `publish` call; array mutations commit at the end of the mutator.

Constraints:

- Scalars are always `set(key, scalarValue)`.
- Arrays are always `set(key, fn(view))` / `stage(key, fn(view))`.
- Lazy scalar setters like `set('peak', () => compute())` are **not** supported.

### 2.2 Controller — meter snapshots (with `into`)

Controller-side meter reads:

- `ctl.meters.snapshot()` — full snapshot
- `ctl.meters.snapshot(keys, options?)` — projection snapshot
- `options.into` — buffer map for zero-copy array meters

**Only array and object forms** (no tuple/variadic overload):

```ts
const scratch = { spectrum: new Float32Array(1024) };

const [peak, spectrum] = ctl.meters.snapshot(['peak', 'spectrum'], {
  into: { spectrum: scratch.spectrum },
});

// Or object form:
const { 0: peak2, 1: frameMs } = ctl.meters.snapshot({
  keys: ['peak', 'frameMs'],
  // into: { frameMs: buf }
});
```

Returned arrays are typed readonly; if `into` is supplied, the implementation fills the caller's buffer in place and the
returned view aliases that buffer.

Diagnostics:

- `binding.snapshotIntoTypeMismatch`
- `binding.snapshotIntoLengthMismatch`

---

## 3) Alternatives Considered

### 3.1 Single `mutate(key, valueOrFn)` for scalars + arrays

Rejected.

Pros:

- One mental model for all meter writes.
- Slightly simpler surface area.

Cons:

- Hot-path branching on "is this a function or a scalar?".
- Per-call key lookup and dispatch; worse inlining.
- Temptation to overuse callback form for scalars, hurting readability and performance.
- Type signature gets more complex; harder to keep zero-`any`.

We prefer:

- Per-key scalar functions for fast paths.
- `set`/`stage` for data-driven and array cases.

### 3.2 Flattened `into` options

e.g.

```ts
ctl.meters.snapshot(['spectrum'], { spectrum: buf });
```

Rejected.

Cons:

- Name collisions between option keys and meter keys.
- Harder to extend options in the future (format/precision/normalize/etc.).
- Less obvious that these are **destination buffers** rather than general options.

We keep `into` nested:

```ts
ctl.meters.snapshot(['spectrum'], { into: { spectrum: buf } });
```

---

## 4) Migration

For code written before this ADR:

- **Hot loops**
  Prefer per-key scalar writers:

  ```ts
  proc.meters.publish((w) => {
    w.peak(peakValue);
    w.rms(rmsValue);
  });
  ```

- **Dynamic paths**
  Use `set(key, valueOrMutator)` when keys are not statically known:

  ```ts
  function writeDynamicMeter(
    w: MeterWriter<MySpec>,
    key: keyof MeterShape<MySpec>,
    value: number,
  ) {
    w.set(key as any, value); // cast only at the call site
  }
  ```

  (The public API stays zero-`any`; any casts are caller-owned for dynamic scenarios.)

- **Array meters**
  Prefer `stage` (or the array branch of `set`) to make array semantics explicit:

  ```ts
  proc.meters.publish((w) => {
    w.stage('spectrum', (dst) => {
      dst.view.set(spectrumScratch);
    });
  });
  ```

- **Snapshots**
  Use nested `into` for zero-copy polling loops:

  ```ts
  const buffers = { spectrum: new Float32Array(1024) };
  let lastVersion = 0;

  function frame() {
    const v = ctl.meters.version();
    if (v !== lastVersion) {
      const [spectrum] = ctl.meters.snapshot(['spectrum'], {
        into: { spectrum: buffers.spectrum },
      });
      drawSpectrum(spectrum);
      lastVersion = v;
    }
    requestAnimationFrame(frame);
  }
  ```

---

## 5) Documentation Tasks

- **API Reference** (`09-seqlok-api-reference.md`)

  - Document the three writer entry points (`w.key`, `w.set`, `w.stage`).
  - Document `meters.snapshot` array/object forms and nested `into`.
  - Include examples of `version()` + `into` for garbage-free polling loops.
  - Include error codes: `binding.snapshotIntoTypeMismatch`, `binding.snapshotIntoLengthMismatch`.

- **Rationale docs**

  - Cross-link this ADR from:

    - `07-seqlok-api-shape-rationale.md` (bindings section)
    - `12-coherent-reads-and-planes.md` (meters side)

This ADR is the normative source for meter write semantics and controller snapshot `into` behavior in Seqlok v1.
