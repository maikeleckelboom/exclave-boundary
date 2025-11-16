# Seqlok: Error System & Fail-Fast Philosophy

> _When things are wrong, Seqlok tells you loudly and immediately._

This document explains:

- Where Seqlok can fail
- How errors are structured and surfaced
- Why the library **refuses** to silently recover from certain problems
- How to work with `SeqlokError` as a user or contributor

The short version:

> Seqlok is a **low-level concurrency + memory primitive**.
> When invariants are broken, it prefers a clean crash over quiet corruption.

---

## 1. Why Fail-Fast?

Seqlok sits at the bottom of a stack:

- It defines **memory plan** for shared buffers.
- It controls **concurrency semantics** over that memory.
- It provides **typed bindings** that other systems build on.

If something goes wrong here (e.g. mismatched plan, broken handoff, unsafe environment), trying to "soldier on" means:

- Undefined behavior
- Silent corruption of shared state
- Nasty heisenbugs in DSP / simulations / UIs

That is worse than:

- Failing early
- With a precise error code
- In a place that's easy to locate and test

So the philosophy is:

> If Seqlok detects a violation of its invariants, it throws a structured `SeqlokError`.
> It does **not** attempt best-effort recovery or automatic fallback.

Higher-level code is free to catch those and decide what to do (show a dialog, disable a device, etc.), but **Seqlok
itself** doesn't try to patch over broken fundamentals.

---

## 2. Error Surfaces

Errors can originate in a few distinct phases of Seqlok's lifecycle:

1. **Spec definition**

- Invalid spec shape (e.g. unsupported type).
- Conflicting field names or structurally impossible configs.

2. **Planning**

- Spec cannot produce a valid plan (extremely rare if DSL is used correctly).
- Derived sizes overflow limits.

3. **Backing allocation**

- Provided `SharedArrayBuffer` / `WebAssembly.Memory` is too small.
- Misaligned or incompatible backing reused with a new plan.

4. **Handoff construction / parsing**

- Handoff missing required fields.
- Handoff's plan hash/spec hash does not match the current spec.

5. **Binding**

- Attempting to bind a `spec` with a backing planned for a _different_ spec.
- Binding against an environment that does not support required features (e.g. no `Atomics`).

6. **Runtime operations**

- Calling APIs on a binding after the underlying backing has been invalidated/disposed (if you support that).
- In debug modes, strict checks on roles (e.g. misuse of an internal API).

For user-facing APIs, every error that crosses the boundary is:

- An instance of `SeqlokError`
- With a **machine-parseable code**
- And a **human-readable message**

---

## 3. `SeqlokError` Shape

The error object is intentionally simple and structured.

Conceptually:

```ts
export type SeqlokErrorCode =
  | 'spec.invalidDefinition'
  | 'spec.duplicateField'
  | 'plan.incompatibleSpecVersion'
  | 'backing.insufficientSize'
  | 'backing.invalidBuffer'
  | 'handoff.missingFields'
  | 'handoff.layoutMismatch'
  | 'bindings.specBackingMismatch'
  | 'bindings.unsupportedEnvironment'
  | 'env.sharedMemoryUnavailable'
  | 'env.atomicsUnavailable';

// ...plus a small, curated set of others

export interface SeqlokErrorDetails {
  code: SeqlokErrorCode;
  message: string;
  context?: Record<string, unknown>;
}

export class SeqlokError extends Error {
  public readonly code: SeqlokErrorCode;
  public readonly context?: Record<string, unknown>;

  constructor(details: SeqlokErrorDetails) {
    super(details.message);
    this.name = 'SeqlokError';
    this.code = details.code;
    this.context = details.context;
  }
}
```

Design choices:

- **Strongly-typed `code`**: no arbitrary strings from random throw sites.
- **No `any` in `context`**: use `unknown` or structured types where feasible.
- **Single error class** for all Seqlok-originated failures.

From a consumer's perspective:

```ts
try {
  const plan = planLayout(spec);
  const backing = allocateShared(plan);
  const controller = bindController(spec, backing);
} catch (createError) {
  if (createError instanceof SeqlokError) {
    console.error(
      'Seqlok failed:',
      createError.code,
      createError.message,
      createError.context,
    );
    // react appropriately based on createError.code
  } else {
    throw createError; // not ours, rethrow
  }
}
```

---

## 4. Error Domains

To keep errors organized and avoid code bloat, Seqlok uses **domains**. Each domain covers a small slice of the system
and uses a compact enum of codes.

Typical domains:

- `spec.*` – problems building or interpreting specs
- `plan.*` – failures during plan planning
- `backing.*` – invalid or insufficient backing memory
- `handoff.*` – malformed or incompatible handoffs
- `bindings.*` – binding mismatches and misuse
- `env.*` – environment is missing required primitives (SAB, Atomics, etc.)

### 4.1 Spec Errors (`spec.*`)

Thrown from `defineSpec` or anything that inspects or validates specs.

Examples:

- `spec.invalidDefinition`

  - Spec shape is not what the DSL expects.

- `spec.duplicateField`

  - Same param or meter name defined twice.

- `spec.unsupportedParamType`

  - Someone tried to plug a non-DSL descriptor into the spec.

```ts
throw new SeqlokError({
  code: 'spec.duplicateField',
  message: `Duplicate param name "gain" in spec.`,
  context: { field: 'gain' },
});
```

---

### 4.2 Plan Errors (`plan.*`)

Thrown from `planLayout(spec)` if something about the spec cannot be planned.

Examples:

- `plan.invalidSpecVersion`

  - Spec has an incompatible version marker (if you support these).

- `plan.layoutOverflow`

  - The calculated plan size exceeds an internal maximum or addressable range.

These should be **extremely rare** if the DSL is the only way to construct specs. But the domain exists to keep "
planning-time" failures separated from everything else.

---

### 4.3 Backing Errors (`backing.*`)

Thrown when allocating or validating backing memory:

- `backing.invalidBuffer`

  - Provided buffer is not a `SharedArrayBuffer` or a compatible `WebAssembly.Memory`.

- `backing.insufficientSize`

  - Buffer is smaller than what the plan requires.

- `backing.misaligned`

  - Internal alignment invariants violated (e.g. misaligned planes in user-provided memory).

Example:

```ts
if (providedByteLength < plan.requiredByteLength) {
  throw new SeqlokError({
    code: 'backing.insufficientSize',
    message: `Backing buffer too small: required ${plan.requiredByteLength}, got ${providedByteLength}.`,
    context: { required: plan.requiredByteLength, got: providedByteLength },
  });
}
```

---

### 4.4 Handoff Errors (`handoff.*`)

Handoffs are the "wiring diagrams" sent across postMessage from Controller to Processor contexts.

Errors here mean: **we cannot trust this handoff**.

Examples:

- `handoff.missingFields`

  - Required keys missing (e.g. no plan info, no plane sizes).

- `handoff.layoutMismatch`

  - Handoff claims a plan that does not match the `plan` for the current spec.

- `handoff.specHashMismatch`

  - Handoff's spec hash differs from the spec used to create the `plan`.

Example:

```ts
if (handoff.specHash !== plan.specHash) {
  throw new SeqlokError({
    code: 'handoff.specHashMismatch',
    message: 'Handoff spec hash does not match local spec.',
    context: {
      expected: plan.specHash,
      got: handoff.specHash,
    },
  });
}
```

---

### 4.5 Binding Errors (`bindings.*`)

Thrown from `bindController` or `bindProcessor` when we detect an inconsistency between:

- Spec
- Plan
- Backing
- Handoff

Examples:

- `bindings.specBackingMismatch`

  - Backing was allocated for a different plan/spec.

- `bindings.unsupportedEnvironment`

  - Trying to create bindings in an environment without SAB/Atomics.

Example:

```ts
if (!env.hasSharedMemory) {
  throw new SeqlokError({
    code: 'bindings.unsupportedEnvironment',
    message: 'Shared memory is not available in this environment.',
    context: { env: env.description },
  });
}
```

---

### 4.6 Environment Errors (`env.*`)

These are **preconditions** that can be detected early, often before planning or binding:

- `env.sharedMemoryUnavailable`

  - SAB is disabled or not supported.

- `env.atomicsUnavailable`

  - `Atomics` is missing.

- `env.incompatibleRuntime`

  - Unsupported platform/runtime version.

These should be thrown as soon as such a condition is detected, not deep in some unrelated code path.

---

## 5. Runtime vs Initialization Errors

There are essentially two phases:

1. **Initialization / binding**

- `defineSpec`, `planLayout`, `allocateShared`, `allocateWasmShared`, `buildHandoff`, `receiveHandoff`, `bindController`,
  `bindProcessor`.
- **Most errors should surface here.**
- Library is strict about correctness.

2. **Steady-state operation**

- `controller.params.set/update`
- `controller.meters.snapshot`
- `processor.params.within`
- `processor.meters.publish`

During steady-state, under normal use, errors are rare. Error conditions here usually indicate **contract violations**:

- Using a binding after its backing has been disposed.
- Calling APIs from the wrong thread / agent.
- Internal assertion failures (in debug builds).

The design intent:

- Almost all misconfiguration is caught at **init time**.
- Hot-path methods (`within`, `publish`, `snapshot`) do not constantly re-check environment invariants; doing so would
  cost perf.

---

## 6. What Seqlok Does _Not_ Do

### 6.1 No Silent Fallbacks

Seqlok does **not**:

- Fall back from SAB to `postMessage` if SAB is unavailable.
- “Emulate” Atomics with locks or message passing.
- Auto-upgrade or reinterpret handoffs that don't match the current spec.

Reasoning:

- These fallbacks change semantics in ways that are invisible from call sites.
- They can break real-time guarantees (e.g. GC on copies).
- They turn clear failures into subtle performance/behavior regressions.

If the environment doesn't satisfy Seqlok's requirements, you get an `env.*` or `bindings.*` error and **initialization
fails**.

---

### 6.2 No Best-Effort Layout "Fixes"

If a backing buffer is too small or incorrectly aligned, Seqlok does **not**:

- Truncate the plan
- Shift offsets
- “Make do” with a partial memory map

Instead, it throws a `backing.*` error.

Utilities that create backings for you (`allocateShared`, `allocateWasmShared`) are designed so that if they succeed,
backing/plan/ spec already match. If you choose to provide your own backing, you own the responsibility to match the
plan exactly.

---

### 6.3 No Automatic Spec Migration

If you change your spec:

- Seqlok does **not** try to interpret old handoffs or backings as if they matched the new spec.
- No magic "migration" layer exists inside Seqlok.

It is up to your application to:

- Version specs
- Migrate state if needed
- Rebuild plans/backings
- Rebind controller & processor

Seqlok simply enforces "spec and backing must match" and fails when they do not.

---

## 7. How Users Should Handle Errors

A typical app will centralize Seqlok initialization and treat errors as **device-level** failures.

Example:

```ts
function createSeqlokDevice() {
  try {
    const spec = defineSpec(/* ... */);
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const controller = bindController(spec, backing);

    return { spec, plan, backing, controller };
  } catch (createError) {
    if (createError instanceof SeqlokError) {
      // Log + surface a user-friendly message
      console.error(
        'Failed to initialize Seqlok device',
        createError.code,
        createError.context,
      );
      return null;
    }
    throw createError;
  }
}
```

Guidelines:

- **Catch around initialization**, not around every hot-path call.
- Treat `SeqlokError` as "this device or environment is misconfigured."
- Avoid trying to recover by "turning Seqlok off but continuing as if nothing happened" — better to disable the affected
  feature cleanly.

---

## 8. Guidelines for Contributors

If you're working on Seqlok internals:

### 8.1 Never Throw Bare `Error`

❌ Don’t:

```ts
throw new Error('Backing too small');
```

✅ Do:

```ts
throw new SeqlokError({
  code: 'backing.insufficientSize',
  message: 'Backing too small for planned plan.',
  context: { required: requiredBytes, got: providedBytes },
});
```

All library-originated errors that escape must be `SeqlokError`.

---

### 8.2 Reuse Existing Codes Where Reasonable

Do **not** introduce a new code for every tiny variation.

Bad:

- `backing.insufficientSizeForPlane`
- `backing.insufficientSizeForControlPlane`
- `backing.insufficientSizeForDataPlane`

Better:

- `backing.insufficientSize` with `context` fields clarifying what failed:

```
context: { plane: 'PF32', required: requiredBytes, got: providedBytes }
```

Keep the code set **small, stable, and meaningful**.

---

### 8.3 Keep Error Domains Focused

Avoid dragging dependencies upward:

- `spec.*` should not depend on backing logic.
- `backing.*` should not inspect spec internals directly; it should work with `plan`.
- `bindings.*` should glue spec/plan/backing, and is allowed to reference all three.

The domain boundary often mirrors the **module boundary**; respect that when placing error constructions.

---

### 8.4 Test Every New Code Path

When you add a new error path:

- Add a test that _forces_ that error.
- Assert on `createError.code` and some part of `createError.context`.
- For user-facing messages, keep them stable enough for docs but not part of the "API surface" — the **code** is the
  contract, the message is for humans.

Example Jest-ish pattern:

```ts
it('throws backing.insufficientSize for too-small buffer', () => {
  const spec = defineSpec(/* ... */);
  const plan = planLayout(spec);
  const tooSmall = new SharedArrayBuffer(plan.requiredByteLength - 4);

  expect(() => bindController(spec, { buffer: tooSmall })).toThrowError(
    expect.objectContaining({
      code: 'backing.insufficientSize' as const,
    }),
  );
});
```

---

## 9. Summary

- Seqlok is a **low-level, shared-memory primitive** where silent failure is unacceptable.
- All library-originated failures are surfaced as **`SeqlokError`** with a small, structured set of codes.
- The library chooses **fail-fast** over "best-effort recovery" when core invariants are violated.
- Error domains (`spec.*`, `plan.*`, `backing.*`, `handoff.*`, `bindings.*`, `env.*`) keep responsibilities clear.
- Users should handle errors primarily at **initialization time**, not in the real-time hot path.
- Contributors must:

  - Avoid bare `Error`
  - Reuse error codes where appropriate
  - Keep domains clean
  - Test new error paths

If you treat Seqlok as a **sharp but honest tool**—one that refuses to lie about the state of shared memory—its error
system will feel like a safety harness instead of a nuisance.
