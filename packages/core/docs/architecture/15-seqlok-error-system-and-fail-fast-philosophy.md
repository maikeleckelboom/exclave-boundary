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

- It defines the **memory plan** for shared buffers.
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

Higher-level code is free to catch those and decide what to do (show a dialog, disable a device, rebuild a graph), but **Seqlok itself** doesn't try to patch over broken fundamentals.

---

## 2. Error Architecture at a Glance

Seqlok's error system has three pillars:

1. **Single error class** for all kernel-originated failures.
2. **Central registry of codes → payload types → metadata.**
3. **Health interpretation** to drive recovery decisions.

### 2.1 Core types

Conceptually, the error system is shaped like this:

```ts
import {
  SeqlokError,
  isSeqlokError,
  interpretHealth,
  type ErrorMeta,
} from "@seqlok/base";
import {
  getErrorMeta,
  type ErrorCode,
  type ErrorPayload,
} from "@seqlok/introspect";
```

In the package layout:

- `@seqlok/base` hosts the portable error primitives and health interpretation.
- `@seqlok/introspect` hosts the aggregated registry and lookup helpers (`getErrorMeta`, JSON export, subset selection).
- Runtime packages (`@seqlok/core`, `@seqlok/primitives`, etc.) only define domain-local registries and never own the global registry.

- `ErrorCode` – finite union of string codes (`'env.unsupported'`, `'backing.allocUndersized'`, …).
- `ErrorPayload<C>` – details payload type for code `C`.
- `ErrorMeta` – static metadata per code (severity, recoverable, docs section, etc.).
- `SeqlokError<C extends ErrorCode>` – the concrete error class Seqlok throws.

`SeqlokError` carries:

- `code: C`
- `message: string`
- `details: ErrorPayload<C>`
- `cause?: unknown` (optional, for nested failures)

### 2.2 Construction helpers (kernel-side)

Inside the kernel (and any internal helpers), errors are created via small factories:

```ts
import { createError } from "./errors/error";

throw createError("backing.allocUndersized", "Backing too small", {
  requiredBytes,
  backingBytes,
});
```

There are also assertion-style helpers (simplified):

```ts
import { invariant } from "./errors/invariant";

invariant(
  backing.byteLength >= plan.totalBytes,
  "backing.allocUndersized",
  "Backing buffer too small for plan",
  { requiredBytes: plan.totalBytes, backingBytes: backing.byteLength },
);
```

Design constraints:

- **No `any` in payloads.** Every code has a dedicated payload type.
- **No ad-hoc strings.** All codes live in domain-specific registries.
- The only class thrown by the kernel is `SeqlokError`.

### 2.3 Health interpretation (consumer-side)

Consumers never need to parse error messages. Instead, they use:

```ts
import {
  SeqlokError,
  isSeqlokError,
  interpretHealth,
} from "@seqlok/base";
import { getErrorMeta } from "@seqlok/introspect";

try {
  // … Seqlok operations …
} catch (err) {
  if (isSeqlokError(err)) {
    const meta = getErrorMeta(err.code);
    const health = interpretHealth(meta);

    console.error(`${health.label}: ${err.message}`);

    if (health.hint) {
      console.info(`Suggestion: ${health.hint}`);
    }

    if (!health.recoverable) {
      // fatal: device/environment is not usable
      engine.stop();
    } else {
      // non-fatal: you may retry / rebuild / soft-disable
    }
  } else {
    throw err; // not ours
  }
}
```

`interpretHealth(meta)` condenses error metadata into:

- a **label** (e.g. “Fatal shared-memory misconfiguration”),
- a **recoverable** flag,
- an optional **hint** for UI / logging.

That's the canonical way to decide how hard you should crash, and what to tell the user.

---

## 3. Where Errors Come From (Phases)

Errors can originate in several phases of Seqlok's lifecycle.

### 3.1 Environment / prerequisites (`env.*`)

Before you even plan or allocate, the environment must support Seqlok's core assumptions:

- Shared memory (`SharedArrayBuffer` / shared `WebAssembly.Memory`)
- Atomics on typed arrays
- (In browsers) cross-origin isolation for SAB

Examples:

- `env.unsupported`
  SAB / Atomics not available at all for this runtime.
- `env.coopCoepRequired`
  Browser is missing COOP/COEP headers; SAB is disabled.

These are typically thrown by helpers such as `assertSabSupport` or low-level environment probes.

### 3.2 Spec & plan (`spec.*`, `plan.*`)

During:

- `defineSpec(…)`
- `planLayout(spec)`

you can get:

- `spec.invalidDefinition` – spec isn’t structurally valid.
- `spec.duplicateKey` – same param/meter name defined twice.
- `plan.overflowRisk` – plan would exceed internal limits.
- `plan.failed` – a generic “cannot generate a valid layout from this spec” guardrail.

These represent **authoring problems**; they should be caught in tests or during development.

### 3.3 Backing (`backing.*`)

When you allocate or validate backing memory:

- `backing.allocFailed` – `SharedArrayBuffer` / memory allocation failed.
- `backing.allocUndersized` – backing is smaller than the plan requires.
- `backing.wasmMemoryNotShared` – `WebAssembly.Memory` is not marked shared.
- `backing.intoTypeMismatch` / `backing.intoLengthMismatch` – “into” snapshot buffers are of the wrong type/length.

These errors ensure **plan ↔ backing** invariants:

- Byte lengths line up
- Plan expectations match backing reality
- We don't quietly truncate or misalign planes

### 3.4 Handoff (`handoff.*`)

Handoffs are structured envelopes used to ship plan+backing across agents.

Typical errors:

- `handoff.invalidArtifact` – structurally malformed; missing required fields or incompatible schema.
- `handoff.versionMismatch` – handoff produced by a different Seqlok version or incompatible schema version.
- `handoff.specHashMismatch` – spec driving this process doesn’t match the one that produced the handoff.
- `handoff.backingMismatch` – handoff doesn’t describe the provided backing accurately.

These mean: **“we cannot trust this artifact; refuse to bind it.”**

### 3.5 Binding (`binding.*`)

At:

- `bindController(spec, plan, backing)`
- `bindProcessor(received)`

Seqlok checks spec, plan, backing, and handoff against each other.

Examples:

- `binding.paramRange` – attempted param write whacks a value outside its declared `[min, max]` under a strict policy.
- `binding.paramInvalidValue` – wrong scalar shape/type for a param.
- `binding.shapeInvalid` – dimensionality constraints violated (e.g. too-long array).
- `binding.snapshotIntoTypeMismatch` / `binding.snapshotIntoLengthMismatch` – meter snapshot into user-provided buffers of mismatched type/length.
- `binding.snapshotRetryExhausted` / `binding.coherentRetryExhausted` – coherent read contracts could not be satisfied within configured budgets.

Binding errors are where most **user-visible contract violations** show up.

### 3.6 Primitives & seqlock (`primitives.*`)

The primitives layer is allowed to fail when its own low-level assumptions are broken:

- `primitives.invalidSpinBudget` – spin / retry budget configuration is invalid.
- `primitives.atomicsFailed` – Atomics operations threw (e.g. wrong typed array).
- `primitives.seqlockTimeout` – bounded seqlock read (`acquire` path) could not obtain a coherent snapshot within budgets.
- `primitives.planeUnaligned` – enforced alignment invariants for a plane are broken.
- `primitives.swsrRingInvalidLayout` – ring descriptor is inconsistent or broken.

These often surface as the cause behind binding-level timeouts or retries.

### 3.7 Introspect & internal (`introspect.*`, `internal.*`)

Auxiliary domains:

- `introspect.*` – counters/metrics and observability plumbing that should "never happen" (NaN, Infinity, negative counts, etc.).
- `internal.assertionFailed`, `internal.unreachable`, `internal.exhaustiveness` – hard kernel bugs / missing `switch` branches.

These are treated as **fatal** and point at problems in Seqlok itself, not user code.

---

## 4. `SeqlokError` Shape & Usage

### 4.1 What you get at call sites

From a consumer's perspective, you only need to rely on the public shape:

```ts
try {
  const spec = defineSpec(/* … */);
  const plan = planLayout(spec);
  const backing = allocateShared(plan);
  const controller = bindController(spec, plan, backing);
} catch (err) {
  if (isSeqlokError(err)) {
    console.error("Seqlok failed:", err.code, err.message, err.details);
  } else {
    throw err;
  }
}
```

Key points:

- `err.code` is **stable** and machine-parseable.
- `err.details` is a typed object; the shape depends on `err.code`.
- `err.message` is for humans, not for branching logic.

You never need to construct `SeqlokError` manually from application code; that's a kernel concern.

### 4.2 Anatomy of a payload

Every code has a dedicated payload type, even for simple cases.

Example, conceptually, for `backing.allocUndersized`:

```ts
if (backing.byteLength < plan.totalBytes) {
  throw createError("backing.allocUndersized", "Backing too small for plan", {
    requiredBytes: plan.totalBytes,
    backingBytes: backing.byteLength,
  });
}
```

Payloads always:

- Provide **enough context** for debugging/logging.
- Avoid generic `Record<string, unknown>` blobs.
- Never carry `any`.

You can safely log `err.details` and pass it into tooling/telemetry.

---

## 5. Initialization vs Steady-State Errors

There are two broad phases.

### 5.1 Initialization / binding

APIs:

- `defineSpec`
- `planLayout`
- `allocateShared`, `allocateWasmShared`
- `buildHandoff`, `receiveHandoff`
- `bindController`, `bindProcessor`
- Environment probes (`assertSabSupport`, `probeEnv`)

**Most** errors should surface here:

- Spec mistakes
- Plan problems
- Mis-sized backings
- Broken handoffs
- Unsupported environments

This is where Seqlok is intentionally strict: if something is wrong, you get a `SeqlokError` and initialization fails.

Guideline:

> Catch around device / engine initialization, not around every hot-path call.

### 5.2 Steady-state operation

APIs:

- `controller.params.set/update/stage/hydrate`
- `controller.meters.snapshot`
- `processor.params.within`
- `processor.meters.publish`
- Internal SWSR ring operations, observers, etc.

Under normal use, runtime errors are rare. When they occur, they usually mean:

- Concurrency budgets exhausted (seqlock timeouts, snapshot retries exhausted).
- A binding-level contract was violated (wrong shapes for snapshot buffers, out-of-range values in strict mode).
- Environment degraded mid-flight (extremely rare; typically caught earlier).

The design intent:

- **Configuration bugs** are caught at init time.
- **Hot paths** perform minimal checks, but still honor seqlock contracts and budgets. When those fail, you get an explicit code (`primitives.seqlockTimeout`, `binding.coherentRetryExhausted`, …).

---

## 6. What Seqlok Does _Not_ Do

### 6.1 No silent fallbacks

Seqlok does **not**:

- Fall back from SAB to `postMessage` if SAB is unavailable.
- “Emulate” Atomics with locks or message passing.
- Auto-upgrade or reinterpret handoffs that don't match the current spec.

Reasoning:

- These fallbacks change semantics invisibly.
- They can break real-time guarantees (e.g. GC from copying).
- They turn clear failures into subtle performance/behavior regressions.

If the environment doesn't satisfy Seqlok's requirements, you get an `env.*` or `binding.*` error and **initialization fails**.

### 6.2 No best-effort layout "fixes"

If a backing buffer is too small or incorrectly aligned, Seqlok does **not**:

- Truncate the plan
- Shift offsets
- “Make do” with a partial memory map

Instead, it throws a `backing.*` error.

Helpers that create backings for you (`allocateShared`, `allocateWasmShared`) are designed so that if they succeed, backing/plan already match. If you provide your own backing, you’re responsible for matching the plan exactly.

### 6.3 No automatic spec migration

If you change your spec:

- Seqlok does **not** try to interpret old handoffs or backings as if they matched the new spec.
- There is no hidden migration layer inside the kernel.

Your app is responsible for:

- Versioning specs
- Migrating state if needed
- Rebuilding plans/backings
- Rebinding controller & processor

Seqlok simply enforces "spec and backing must match" and fails when they don't.

---

## 7. How Users Should Handle Errors

### 7.1 Initialization wrapper pattern

Typical pattern for a device/engine factory:

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  bindController,
} from "@seqlok/core";
import {
  SeqlokError,
  isSeqlokError,
  interpretHealth,
} from "@seqlok/base";
import { getErrorMeta } from "@seqlok/introspect";

function createSeqlokDevice() {
  try {
    const spec = defineSpec(/* … */);
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const controller = bindController(spec, plan, backing);

    return { spec, plan, backing, controller };
  } catch (err) {
    if (isSeqlokError(err)) {
      const health = interpretHealth(getErrorMeta(err.code));

      console.error(`[Seqlok] ${health.label}: ${err.message}`, err.details);

      if (!health.recoverable) {
        // Device cannot be used in this environment/config.
        return null;
      }

      // Optional: attempt a softer fallback.
      return null;
    }

    throw err; // non-Seqlok error; let it propagate
  }
}
```

Guidelines:

- **Centralize** error handling around initialization and major topology changes.
- Treat `SeqlokError` as "this device / environment / binding is misconfigured or unhealthy."
- Use `interpretHealth` to decide whether to retry, rebuild, or fail hard.

### 7.2 Runtime handling

For hot paths, only catch if you genuinely have a strategy:

- UI overlays may catch `binding.snapshotInto*` to disable a specific graph.
- Observers may treat seqlock timeouts as degraded telemetry (log + continue).
- Anything that suggests corrupted memory or incompatible bindings should be treated as fatal for that device.

---

## 8. Guidelines for Contributors

If you're working on Seqlok internals (or on tightly coupled helpers), these rules apply.

### 8.1 Never throw bare `Error`

❌ Don’t:

```ts
throw new Error("Backing too small");
```

✅ Do:

```ts
throw createError("backing.allocUndersized", "Backing too small for plan", {
  requiredBytes,
  backingBytes,
});
```

or, if it's a pure invariant check:

```ts
invariant(
  backing.byteLength >= plan.totalBytes,
  "backing.allocUndersized",
  "Backing too small for plan",
  { requiredBytes: plan.totalBytes, backingBytes: backing.byteLength },
);
```

All kernel-originated failures that escape **must** be `SeqlokError`.

### 8.2 Reuse existing codes where reasonable

Do **not** introduce a new code for every tiny variation.

Bad:

- `backing.allocUndersizedForPlane`
- `backing.allocUndersizedForControlPlane`
- `backing.allocUndersizedForDataPlane`

Better:

- `backing.allocUndersized` with a payload that indicates which plane / region failed:

```ts
details: {
  plane: "PF32", requiredBytes, backingBytes;
}
```

Keep the code set **small, stable, and meaningful**; push variation into the payload.

### 8.3 Keep domains clean

Respect domain boundaries in error placement:

- `spec.*` should not depend on backing logic.
- `backing.*` should not introspect spec internals directly; it should work off `plan`.
- `handoff.*` should validate the envelope, not do binding work.
- `binding.*` is where spec/plan/backing/handoff are glued and cross-checked.

If a new feature spans multiple domains, **compose** existing codes rather than inventing a mega-code.

### 8.4 Test every new error path

When you add a new error path:

- Add a test that forces that path.
- Assert on `err.code` and at least one field of `err.details`.
- Don't rely on `message` text in tests; that's for humans, not compatibility.

Example:

```ts
it("throws backing.allocUndersized for too-small buffer", () => {
  const spec = defineSpec(/* … */);
  const plan = planLayout(spec);
  const tooSmall = new SharedArrayBuffer(plan.totalBytes - 4);

  expect(() => bindController(spec, plan, tooSmall as never)).toThrowError(
    expect.objectContaining({
      code: "backing.allocUndersized",
    }),
  );
});
```

---

## 9. Summary

- Seqlok is a **low-level shared-memory kernel**; silent failure is unacceptable.
- All kernel-originated failures are surfaced as **`SeqlokError`** with a small, structured set of codes and typed payloads.
- Error **domains** (`spec.*`, `plan.*`, `backing.*`, `handoff.*`, `binding.*`, `primitives.*`, `env.*`, `introspect.*`, `internal.*`) mirror the architectural layers.
- The library chooses **fail-fast** over "best-effort recovery" when core invariants are violated.
- Users should handle errors primarily at **initialization time**, using `isSeqlokError`, `getErrorMeta`, and `interpretHealth` to decide on recovery.
- Contributors must:

  - Avoid bare `Error`
  - Reuse codes thoughtfully
  - Keep domains clean
  - Test every new error path

If you treat Seqlok as a **sharp but honest tool**—one that refuses to lie about the state of shared memory—its error system becomes a safety harness instead of a nuisance.
