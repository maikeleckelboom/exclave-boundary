# ADR-00F: ControllerParams.hydrate() for Cold-Path Bulk Updates

**Status**: Accepted
**Date**: 2025-11-18
**Owner**: _TBD_

**Related**:

- 03 – Concurrency Model & Roles (Controller vs Processor)
- 07 – Seqlok API Shape Rationale
- 08 – Seqlok API & Naming Rationale
- 09 – Seqlok API Reference

---

## 1. Context

`ControllerParams<S>` is the controller-side API for mutating the parameter
plane defined by a spec `S`. Before this ADR it exposed:

```ts
interface ControllerParams<S extends SpecInput> {
  set<K extends ScalarParamKeys<S>>(key: K, value: ParamValueFor<S, K>): void;
  update(patch: ScalarParamPatch<S>): void;
  stage<const K extends ArrayParamKeys<S>>(
    key: K,
    cb: (view: ArrayParamView<S, K>) => void,
  ): void;

  snapshot(...): ParamsSnapshot<S> | SnapshotParamsObject<S, any>;
  version(): PUSeq;
}
```

We deliberately separated:

- **Hot-path scalar writes**: `set` / `update`.
- **Hot-path array writes**: `stage`.
- **Coherent reads**: `snapshot`.
- **Version tracking**: `version`.

This gives a clean mental model:

- `update` is **scalar-only**, “cheap micro-batch”.
- Arrays are **stage-only**, written through explicit views.

However, common **cold-path** operations (presets, project restore, snapshot
round-trips, IPC) currently require awkward scalar/array bifurcation and
shape-based branching.

---

## 2. Problem

### 2.1 Ergonomics gap for cold-path operations

Examples of friction with the existing surface:

**Preset loading**

```ts
// Before: scalar vs array bifurcation
controller.params.update({
  gain: preset.gain,
  cutoffHz: preset.cutoffHz,
});

controller.params.stage("eqBands", (dst) => {
  dst.set(preset.eqBands);
});
```

**Snapshot round-trip**

```ts
const snap = controller.params.snapshot(); // scalars + arrays

// Natural but illegal:
controller.params.update(snap); // ❌ arrays are not allowed in update()
```

**Generic tooling / IPC**

```ts
// Before: shape-based branching
for (const [key, value] of Object.entries(incomingParams)) {
  if (isArrayParam(key)) {
    controller.params.stage(key as ArrayParamKeys<S>, (dst) => dst.set(value));
  } else {
    controller.params.update({ [key]: value } as ScalarParamPatch<S>);
  }
}
```

We want a **single-call bulk operation** that accepts both scalars and arrays
for _cold_ paths, without compromising hot-path guarantees.

### 2.2 Why not relax `update()`?

The obvious idea — "just let `update()` accept arrays" — conflicts with several
core invariants.

1. **Performance invariants**

   Today:

   ```ts
   controller.params.update(patch);
   ```

   is guaranteed to mean "a handful of scalar writes", not "maybe a 1024-float
   memcpy". Allowing arrays here makes every `update` call ambiguous: it could
   be cheap, or it could hide a large copy.

2. **Hot-path discipline**

   It becomes easy to accidentally build a 60 Hz footgun:

   ```ts
   function onFrame() {
     controller.params.update({
       gain: slider.value,
       eqBands: computedCurve, // ← hidden 4 KB memcpy at UI rate
     });
     requestAnimationFrame(onFrame);
   }
   ```

   The API no longer nudges developers toward the intended split:

- scalars → `update` (hot),
- arrays → `stage` (hot) or a dedicated cold-path verb.

3. **Range-policy semantics**

   Scalars go through:

- `normalizeScalarValue` + `rangePolicy` (`'clamp' | 'reject'`),
- consistent, per-scalar validation.

Arrays are treated as **structured data** (EQ curves, envelopes, LUTs) and
intentionally _not_ subjected to per-element range policy.

Mixing both in `update` either:

- applies range policy per element (expensive + surprising), or
- skips it for arrays (inconsistent semantics inside one verb).

4. **Docs and benches already commit to the invariant**

   Existing documentation and param-op benchmarks explicitly describe:

- `update` as **scalar-only** micro-batch,
- arrays as **stage-only** on the hot path,
- a cost model that contrasts "scalar update" vs "array stage".

Relaxing `update` would break that story and make cost much harder to reason
about. We want `update` to remain obviously cheap.

---

## 3. Options

### Option A – Expand `update` to accept scalars + arrays

- Change `update` to take something like `Partial<ParamValues<S>>`.
- Scalars: same semantics as now.
- Arrays: validated typed arrays, copied into backing.

**Pros:**

- Very convenient: one verb for everything.

**Cons:**

- Breaks the "update is scalar-only" invariant.
- Hides large memcopies behind a hot-path verb.
- Muddies range-policy semantics.
- Invalidates the existing perf narrative and mental model.

### Option B – Keep `update` scalar-only, add a cold-path verb

- Preserve `update(patch: ScalarParamPatch<S>)` exactly as-is.
- Introduce `hydrate(patch)` for **scalars + arrays**, explicitly cold-path.

**Pros:**

- Preserves hot-path invariants and cost model.
- Gives a clear "bulk state" hook for presets, snapshots, IPC.
- Supports a clean `snapshot` ↔ `hydrate` round-trip story.
- Keeps `update` meaning "cheap scalar micro-batch".

**Cons:**

- Adds one more verb to `ControllerParams`.

### Option C – Keep binding surface as-is; add only helpers

- No new method on `ControllerParams`.
- Provide helpers like `applyParamsSnapshot(params, snapshot)` that internally
  use `update` + `stage`.

**Pros:**

- No surface change.

**Cons:**

- Less discoverable; hot/cold distinction is hidden in helper modules.
- Round-trip story is indirect and harder to learn.

---

## 4. Decision

We choose **Option B**.

- `update` remains **scalar-only** forever (hot path).

- Arrays stay **stage-only** in hot paths.

- We add a **new cold-path verb** to `ControllerParams<S>`:

  ```ts
  hydrate(
    patch: {
      readonly [K in ParamKeys<S>]?: ParamValueFor<S, K> | undefined;
    },
  ): void;
  ```

- We introduce a named helper type:

  ```ts
  export type HydratePatch<S extends SpecInput> = {
    readonly [K in ParamKeys<S>]?: ParamValueFor<S, K> | undefined;
  };
  ```

  so the signature is:

  ```ts
  hydrate(patch: HydratePatch<S>): void;
  ```

- We **do not** add an `applySnapshot()` method to the binding. If needed,
  a free helper like `applyParamsSnapshot(params, snapshot)` can exist in a
  non-hot module and simply call `params.hydrate(snapshot)`.

---

## 5. Rationale

### 5.1 Semantic pairing: `snapshot` ↔ `hydrate`

We want an explicit, symmetric round-trip:

```ts
const snap = controller.params.snapshot(); // coherent, inert
controller.params.hydrate(snap); // reconstitute into SAB-backed state
```

- `snapshot` freezes shared state into plain values + readonly arrays.
- `hydrate` rehydrates those values + typed arrays into live shared memory.

The terminology aligns with industry usage ("hydrate" in React/Redux/SSR) and
maps well to the Seqlok model: dry data → hydrated in shared memory.

### 5.2 Temperature semantics (hot vs cold)

Verbs naturally fall into two "temperature bands":

- **Hot path – frequent, perf sensitive**

  - `set` / `update` for **scalars only**.
  - `stage` for **arrays** via explicit views.

- **Cold path – infrequent, ergonomics-centric**

  - `snapshot` for coherent reads.
  - `hydrate` for bulk writeback (scalars + arrays).

If you find yourself calling `hydrate` at UI frame rate or audio rate, that is
a strong smell that the wrong verb is being used.

### 5.3 Ergonomics for real-world use cases

`hydrate` directly solves:

- Preset/scene loading:

  ```ts
  const preset: ParamValues<typeof spec> = loadFromDisk();
  controller.params.hydrate(preset);
  ```

- Snapshot round-trips:

  ```ts
  const snap = controller.params.snapshot();
  // ... some time later
  controller.params.hydrate(snap);
  ```

- IPC/network bridges:

  ```ts
  socket.on("params:update", (msg: { params: ParamValues<typeof spec> }) => {
    controller.params.hydrate(msg.params);
  });
  ```

without sacrificing the clarity of `update`/`stage` for hot-path use.

### 5.4 API minimalism

We keep the binding surface small:

- Exactly one cold-path bulk verb on the controller (`hydrate`), not two
  (`hydrate` + `applySnapshot`).
- Any additional naming (`applyParamsSnapshot`, `mergeSnapshots`, etc.) can
  live in helper modules that wrap `hydrate`.

---

## 6. Semantics of `hydrate`

### 6.1 Type shape

`HydratePatch<S>` is structurally equivalent to a partial `ParamValues<S>`:

- Keys are spec param keys.
- Values are controller-visible param values:

  - scalars: numbers / booleans / enum labels,
  - arrays: typed arrays (`Float32Array`, `Int32Array`, `Uint8Array`, etc.).

```ts
export type HydratePatch<S extends SpecInput> = {
  readonly [K in ParamKeys<S>]?: ParamValueFor<S, K> | undefined;
};

interface ControllerParams<S extends SpecInput> {
  // existing hot-path verbs
  set<K extends ScalarParamKeys<S>>(key: K, value: ParamValueFor<S, K>): void;
  update(patch: ScalarParamPatch<S>): void;
  stage<const K extends ArrayParamKeys<S>>(
    key: K,
    cb: (view: ArrayParamView<S, K>) => void,
  ): void;

  // new cold-path verb
  hydrate(patch: HydratePatch<S>): void;

  snapshot(...): ParamsSnapshot<S> | SnapshotParamsObject<S, any>;
  version(): PUSeq;
}
```

### 6.2 Behaviour

Given `patch: HydratePatch<S>`:

1. **Validation phase (pre-commit)**

- Reject non-object patches.

- For each defined key:

  - Verify the key is a known param (`validatedParams`), else `throwUnknownKey`.
  - If `slot.length === 1`: classify as scalar write.
  - Else: require a typed array and verify `length === slot.length`.

- All validation errors are thrown **before** touching shared memory.

2. **Commit phase (single `publish`)**

- If there are no writes, return with **no** PU bump.

- Otherwise:

  ```ts
  publish(pu, () => {
    // scalars first
    // arrays second
  });
  ```

- Scalars:

  - reuse the existing scalar write path,
  - obey `rangePolicy` (`'reject' | 'clamp'`).

- Arrays:

  - compute `start` / `end` from slot index/length,
  - use `subarray(start, end).set(src)` on the correct plane (`PF32`, `PI32`, `PB`).

3. **Atomicity**

- All writes from a single `hydrate` call are grouped under one param-domain
  seqlock critical section (one PU bump).
- Processor-side `within(cb)` sees either the old state or the fully
  hydrated new state, never a mix.

4. **Partial patches**

- Keys with `value === undefined` are skipped.
- Omitted keys leave those params untouched.

5. **Intended call rate**

- “Human-time” operations:

  - presets and scene changes,
  - project load / restore,
  - snapshot re-application,
  - IPC / debug flows.

- Not suitable for high-frequency UI or audio-rate control.

---

## 7. Consequences

### 7.1 ControllerParams verb grid

After this ADR, `ControllerParams<S>` conceptually has:

- **Hot:**

  - `set(key, value)` – single scalar write.
  - `update(patch)` – scalar-only micro-batch.
  - `stage(key, cb)` – array-only, explicit view.

- **Cold:**

  - `snapshot(...)` – coherent read.
  - `hydrate(patch)` – bulk state (scalars + arrays).

- **Meta:**

  - `version()` – param update sequence counter.

This hot/cold split is now an explicit design guarantee.

### 7.2 Backwards compatibility

- No breaking changes:

  - Existing methods are unchanged.
  - Existing call sites remain valid.

- New behavior:

  - `hydrate` is purely additive.
  - Error messages for incorrect use of `update` (arrays) can now explicitly
    point callers to `stage` / `hydrate`.

### 7.3 Docs, tests, benchmarks

This ADR implies:

- **Docs**

  - Update architecture and API docs to:

    - emphasise `update` as scalar-only, hot-path,
    - describe `hydrate` as cold-path bulk verb,
    - show `snapshot` ↔ `hydrate` round-trips,
    - document the hot vs cold decision tree.

- **Tests**

  - Unit tests for:

    - scalar-only patches,
    - array-only patches,
    - mixed patches,
    - partial patches,
    - empty patch (no-op, no PU bump),
    - error cases (unknown key, wrong type, length mismatch),
    - range policy enforcement for scalar writes.

  - Integration tests for:

    - full snapshot round-trip,
    - processor observing hydrated state coherently via `within`.

- **Benchmarks** (recommended, not strictly required)

  - Compare `hydrate` vs equivalent `update` + `stage` sequence.
  - Confirm `hydrate` overhead is acceptable for cold-path usage.

---

## 8. Future Work

This ADR does **not** pre-commit to higher-level state tooling, but it defines
the primitive those tools should be built on:

- Preset/scene managers → `snapshot` + `hydrate`.
- Project save/restore → `snapshot` + serialization + `hydrate`.
- Future diff/merge helpers → compute `HydratePatch<S>` and call `hydrate`.

Any future host/runtime integration or topology helper should treat `hydrate` as the canonical bulk write primitive for each SWMR domain, layered on top of the existing seqlock-based controller/processor split.

---
