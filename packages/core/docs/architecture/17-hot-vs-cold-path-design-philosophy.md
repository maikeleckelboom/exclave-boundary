# Hot Path vs Cold Path: Temperature-Based Design Philosophy

**Type**: Design Principle
**Date**: 2025-11-19`
**Related**:

- ADR-00C — Meter Writes & Snapshot `into` (Controller side)
- ADR-00F — ControllerParams.hydrate() for Cold-Path Bulk Updates
- ADR-00Z — Observer Binding Role in `@seqlok-internal/prototype-core`
- 07 — Seqlok API Shape Rationale
- 09 — Seqlok API Reference

---

## Overview

Seqlok's API surface is shaped by an implicit **temperature-based design philosophy**: operations are designed for either **hot paths** (real-time, performance-critical) or **cold paths** (human-time, ergonomics-centric), never both.

This document formalizes that philosophy and provides guidance for evaluating existing APIs and designing new features.

---

## The Two Temperature Bands

### Hot Path (Performance-Critical)

**Definition:** Operations that execute at **real-time frequencies** with **strict latency requirements**.

**Characteristics:**

- Called at audio rate (48+ kHz), frame rate (60–240 Hz), or particle update rate (1000+ Hz)
- Must complete within microsecond or sub-millisecond budgets
- Subject to underrun/dropout/glitch consequences if delayed
- **Allocation-free** (no GC pressure)
- **Bounded worst-case latency** (predictable, no unbounded loops)
- **Lock-free** (no blocking waits)

**Performance Contracts:**

- Zero allocations per call
- Bounded retry/spin budgets (e.g., seqlock: 3–5 attempts)
- Inline-friendly (small, predictable code paths)
- Cache-conscious (minimize SAB thrashing)

**Examples in Seqlok:**

```ts
// Hot: Audio quantum processing
processor.params.within((params) => {
  const { gain, frequency } = params;
  // DSP loop
  processor.meters.publish((meters) => {
    meters.rms = computeRMS();
  });
});

// Hot: Per-frame meter reads
const seq = observer.meters.version();
if (seq !== lastSeq) {
  const { rms, peak } = observer.meters.snapshot(["rms", "peak"]);
  updateVU(rms, peak);
  lastSeq = seq;
}

// Hot: Scalar param updates
controller.params.set("gain", slider.value);
controller.params.update({ gain, pitch, rate });

// Hot: Array mutations via explicit views
controller.params.stage("eqBands", (dst) => {
  computeEQCurve(dst.view);
});
```

---

### Cold Path (Ergonomics-Centric)

**Definition:** Operations that execute at **human-time frequencies** with **relaxed latency tolerance**.

**Characteristics:**

- Called on user actions (clicks, preset loads, project opens) or periodic tasks (save, telemetry flush)
- Typically <1 Hz to ~10 Hz call rates
- Latency budgets in milliseconds to seconds
- Can allocate, copy, serialize, or perform I/O
- Ergonomics and developer experience prioritized over raw speed

**Performance Allowances:**

- Allocations permitted (one-time costs are acceptable)
- Unbounded operations allowed (e.g., iteration over all keys)
- Type conversions, validation, and defensive checks
- Can touch multiple planes or domains in one call

**Examples in Seqlok:**

```ts
// Cold: Preset loading (scalars + arrays in one call)
const preset = await loadPreset("my-track.json");
controller.params.hydrate(preset);

// Cold: Snapshot round-trip
const snapshot = controller.params.snapshot(); // Full state
await saveProject(snapshot);
// ... later
const loaded = await loadProject();
controller.params.hydrate(loaded);

// Cold: Controller-side meter snapshots for persistence
const meterState = controller.meters.snapshot(["spectrum", "history"], {
  into: { spectrum: scratchBuffer }, // Optional optimization
});
await logTelemetry(meterState);

// Cold: Observer binding lifecycle
const vizObserver = bindObserver(spec, handoff);
// ... when done
vizObserver.dispose();

// Cold: Domain growth/swap
const newHandoff = await growDomain(currentHandoff, newCapacity);
controller.swap(newHandoff);
```

---

## How Temperature Shapes API Design

### Separate Verbs by Temperature

Hot and cold paths use **different verbs** to signal their temperature:

| Operation              | Hot Path Verb | Cold Path Verb | Why Separate                                         |
| ---------------------- | ------------- | -------------- | ---------------------------------------------------- |
| Scalar param writes    | `set/update`  | `hydrate`      | Hot stays lightweight; cold accepts arrays too       |
| Array param writes     | `stage`       | `hydrate`      | Hot uses explicit views; cold accepts typed arrays   |
| Param reads            | —             | `snapshot`     | Controller snapshots are always cold (for save/load) |
| Meter reads (observer) | `snapshot`    | —              | Observer snapshots are always hot (SAB views)        |
| Meter reads (ctrl)     | —             | `snapshot`     | Controller snapshots are cold (logical copies)       |

**Guideline:** If a verb is called at >10 Hz, it should be hot-path. If <1 Hz, it should be cold-path.

---

### Type-Level Hints

Where possible, TypeScript types hint at temperature:

```ts
// Hot: Generic, works with any subset of keys
processor.params.within(params => {
  const { gain } = params; // Inline access
});

// Cold: Accepts full param shape (scalars + arrays)
type HydratePatch<S> = {
  [K in ParamKeys<S>]?: ParamValueFor<S, K>;
};
controller.params.hydrate(patch: HydratePatch<S>);

// Hot: Returns ephemeral SAB-backed views
observer.meters.snapshot(): MetersSnapshot<S>; // TypedArrays are views

// Cold: Returns logical copies (safe to persist)
controller.meters.snapshot(): MetersSnapshot<S>; // Detachable buffers
```

---

### Error Handling Temperature

Error handling respects temperature semantics (see ADR-015):

**Hot path:**

- **Fail-fast**: Throw immediately on contract violations
- **No recovery attempts**: Assume caller is wrong, not the system
- **Minimal diagnostics**: Error code + key, no stack traces or object inspection
- Examples: `binding.unknownKey`, `binding.typeMismatch`

**Cold path:**

- **Defensive validation**: Check inputs before touching state
- **Rich diagnostics**: Include context, suggestions, related keys
- **Batch validation**: Collect multiple errors before throwing
- Examples: `hydrate` validates all keys before any writes

---

## Case Study: Why `update` Stays Scalar-Only (ADR-00F)

**Scenario:** User wants to update params with both scalars and arrays.

**Wrong approach:** Relax `update` to accept arrays.

```ts
// ❌ If we allowed this:
controller.params.update({
  gain: 0.8, // 4 bytes
  eqBands: curve, // 4 KB array
});
```

**Problems with mixing temperatures:**

1. **Temperature confusion**: `update` is documented as hot-path, but now hides expensive operations
2. **Performance surprise**: Caller can't tell if this is "cheap" or "expensive" without inspecting the patch
3. **Footgun potential**: Easy to accidentally put array updates in 60 Hz loops
4. **Mental model breaks**: "update is fast" no longer holds

**Correct approach:** Separate verbs by temperature.

```ts
// ✅ Hot: Scalar-only, obviously cheap
controller.params.update({ gain: 0.8, pitch: 1.05 });

// ✅ Hot: Array-only, explicit view semantics
controller.params.stage("eqBands", (dst) => {
  dst.view.set(curve);
});

// ✅ Cold: Bulk state, accepts everything
controller.params.hydrate({
  gain: 0.8,
  pitch: 1.05,
  eqBands: curve,
});
```

Each verb's name and signature **signals its temperature**, preventing misuse.

---

## Case Study: Controller vs Observer Snapshots (ADR-00Z)

ADR-00Z distinguishes controller and observer snapshots based on temperature:

**Controller snapshots (cold):**

```ts
const snapshot = controller.meters.snapshot(["spectrum"]);
await persistToDatabase(snapshot); // Safe: logical copy
```

- **Use case**: Save/restore, presets, off-line analysis
- **Semantic**: Logical copy, safe to persist or send over IPC
- **Performance**: Can allocate, copy into caller buffers via `into`

**Observer snapshots (hot):**

```ts
const { spectrum } = observer.meters.snapshot(["spectrum"]);
device.queue.writeBuffer(gpuBuffer, 0, spectrum); // Ephemeral SAB view
```

- **Use case**: GPU uploads, UDP streaming, real-time visualization
- **Semantic**: Ephemeral SAB-backed view, valid this tick only
- **Performance**: Zero-copy, direct view into shared memory

**Why different?**

- Controller needs **persistence semantics** (cold path: project save, telemetry logging)
- Observer needs **streaming semantics** (hot path: frame-rate GPU uploads, network packets)

Temperature determines which trade-off to make.

---

## Decision Framework for New Features

When designing a new operation, follow this process:

### Step 1: Determine Expected Call Frequency

- **>10 Hz**: Hot path
- **1–10 Hz**: Probably hot, consider cold if operation is large/complex
- **<1 Hz**: Cold path

### Step 2: Identify Latency Budget

- **Sub-millisecond**: Must be hot
- **1–10 ms**: Probably hot
- **>10 ms**: Can be cold

### Step 3: Check Allocation Requirements

- **Must be zero-allocation**: Must be hot
- **Can allocate occasionally**: Can be cold

### Step 4: Choose API Style

**If hot:**

- Use specialized verbs (`set`, `stage`, `within`, `publish`)
- Require typed views or fixed-size operations
- Document performance contracts explicitly
- Throw immediately on errors (fail-fast)

**If cold:**

- Use ergonomic verbs (`hydrate`, `snapshot`, `bindObserver`)
- Accept flexible shapes (partial patches, full state)
- Allow allocations and conversions
- Provide rich error diagnostics

### Step 5: Validate Against Existing Patterns

- Does this follow the temperature split in related APIs?
- Does the verb name signal its temperature clearly?
- Can users tell from the signature whether it's hot or cold?

---

## Examples Throughout Seqlok

### Controller Binding

```ts
interface ControllerParams<S> {
  // Hot path
  set<K extends ScalarParamKeys<S>>(key: K, value: ParamValueFor<S, K>): void;
  update(patch: ScalarParamPatch<S>): void;
  stage<K extends ArrayParamKeys<S>>(
    key: K,
    cb: (view: ArrayParamView<S, K>) => void,
  ): void;

  // Cold path
  hydrate(patch: HydratePatch<S>): void;
  snapshot(): ParamsSnapshot<S>; // Controller snapshots are cold

  // Meta
  version(): PUSeq;
}
```

### Processor Binding

```ts
interface ProcessorParams<S> {
  // Hot path only
  within<R>(cb: (params: ParamShape<S>) => R): R;
}

interface ProcessorMeters<S> {
  // Hot path only
  publish(cb: (writer: MeterWriter<S>) => void): void;
}
```

### Observer Binding

```ts
interface ObserverParams<S> {
  // Hot path only (ephemeral SAB views)
  snapshot(): ParamsSnapshot<S>;
  snapshot<K extends readonly ParamKeys<S>[]>(
    keys: K,
  ): SnapshotParamsObject<S, K>;
  version(): PUSeq;
}

interface ObserverMeters<S> {
  // Hot path only (ephemeral SAB views)
  snapshot(): MetersSnapshot<S>;
  snapshot<K extends readonly MeterKeys<S>[]>(
    keys: K,
  ): SnapshotMetersObject<S, K>;
  version(): MUSeq;
}
```

---

## Common Patterns and Anti-Patterns

### ✅ Good: Temperature-Aware Code

```ts
// Hot path: version check + selective read
let lastSeq: MUSeq = 0;

function onFrame() {
  const seq = observer.meters.version();
  if (seq !== lastSeq) {
    const { rms, peak } = observer.meters.snapshot(["rms", "peak"]);
    updateVU(rms, peak);
    lastSeq = seq;
  }
  requestAnimationFrame(onFrame);
}

// Cold path: bulk preset load
async function loadPreset(name: string) {
  const preset = await fetch(`/presets/${name}.json`).then((r) => r.json());
  controller.params.hydrate(preset); // One call, all data
}
```

### ❌ Bad: Temperature Confusion

```ts
// ❌ WRONG: Using cold-path verb at hot frequency
function onFrame() {
  const preset = getCurrentPresetState(); // Full state extraction
  controller.params.hydrate(preset); // Bulk write at 60 Hz
  requestAnimationFrame(onFrame);
}

// ❌ WRONG: Using hot-path verb for large bulk updates
async function loadPreset(name: string) {
  const preset = await fetch(`/presets/${name}.json`).then((r) => r.json());

  // Manually splitting scalars and arrays
  controller.params.update({
    gain: preset.gain,
    pitch: preset.pitch,
    // ... 50 more scalars
  });

  controller.params.stage("eqBands", (dst) => dst.view.set(preset.eqBands));
  controller.params.stage("envelope", (dst) => dst.view.set(preset.envelope));
  // ... 10 more arrays

  // Should have just used hydrate()
}
```

---

## Summary

Temperature-based design is a **first-class principle** in Seqlok:

- **Hot path**: Real-time frequencies, allocation-free, bounded latency, specialized verbs
- **Cold path**: Human-time frequencies, ergonomic, flexible types, bulk operations

Every Seqlok operation has a temperature. Every new API must declare its temperature and honor the corresponding performance contracts.

This philosophy is reflected in:

- ADR-00F's decision to separate `update` (hot) and `hydrate` (cold)
- ADR-00Z's distinction between controller (cold) and observer (hot) snapshots
- ADR-00C's `into` optimization for hot polling loops
- The entire binding API surface (see 09-seqlok-api-reference.md)

When in doubt, ask: **"Is this hot or cold?"** The answer determines everything else.
