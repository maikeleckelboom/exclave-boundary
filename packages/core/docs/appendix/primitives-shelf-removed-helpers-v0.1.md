# Primitives Shelf: Removed Helpers in v0.1.0 (with Code Reference)

> Status: Accepted
> Scope: `src/primitives/*` in `@seqlok/core`
> Intent: Record the intent and **exact implementations** of primitives that were removed from the runtime, so they can
> be resurrected or reused without spelunking history.

## 1. Context

`@seqlok/core` deliberately exposes **only** the high-level flow:

- `defineSpec` → `planLayout` → `allocateShared` → `buildHandoff` / `receiveHandoff` → `bindController` /
  `bindProcessor`

The `primitives` layer (planes, atomics, seqlock internals) is treated as **internal implementation**, not a public API.

As part of that decision, several helpers that were working but unused (or only loosely connected to future ideas) have
been removed from the codebase to keep the runtime and maintenance surface honest.

This document captures:

- What was removed,
- What it did / was meant to do,
- The **exact TypeScript implementations** as they existed in v0.1.0 so they can be copy-pasted into other projects or
  future packages.

---

## 2. Final Consensus Decision Matrix

For reference, this is the final decision matrix for the primitives under discussion:

| Symbol                | Action               | Rationale                                              |
|-----------------------|----------------------|--------------------------------------------------------|
| `isPow2`              | **DELETE**           | Unused; adds noise                                     |
| `isAligned`           | **DELETE**           | Unused; adds noise                                     |
| `acquire`             | **DELETE**           | Design stub for future feature; implement when needed  |
| `AcquireOptions`      | **DELETE**           | Same                                                   |
| `getSeq`              | **DELETE**           | Never called                                           |
| `isWriterActive`      | **DELETE**           | Never called                                           |
| `createSeqPair`       | **KEEP + @internal** | Essential for seqlock tests; keep in src/primitives    |
| `tryRead` + types     | **KEEP + @internal** | Essential for seqlock tests; keep in src/primitives    |
| `publish` + `SeqPair` | **KEEP (unmarked)**  | Runtime hot path; internal by virtue of no root export |
| `PlaneKey`, etc.      | **KEEP (unmarked)**  | Runtime dependencies; internal                         |

This doc focuses on the **deleted** ones and preserves their implementations.

---

## 3. Plane Helpers Removed from `src/primitives/planes.ts`

These lived next to `PlaneKey` and `BYTES_PER_ELEM`. They are simple and generic, and can be safely reused anywhere.

### 3.1 `isPow2(n: number): boolean`

**Purpose**

Check whether a positive integer is a power of two. Used by `roundUpTo` at the time.

**Original implementation**

```ts
export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}
```

**Notes**

- This is the classic bit-twiddle power-of-two check.
- Assumes `n` is an integer; negative values and zero return `false`.

---

### 3.2 `isAligned(byteOffset: number, plane: PlaneKey): boolean`

**Purpose**

Check whether a byte offset satisfies the natural alignment for a given plane's TypedArray.

- `MF64` → 8-byte alignment
- `PF32` / `MF32` / `MU32` / `PU` / `PI32` → 4-byte alignment
- `PB` → 1-byte alignment

**Original implementation**

```ts
export function isAligned(byteOffset: number, plane: PlaneKey): boolean {
  const align = BYTES_PER_ELEM[plane];
  return (byteOffset & (align - 1)) === 0;
}
```

**Dependencies**

- `PlaneKey`: the string union of plane identifiers.
- `BYTES_PER_ELEM: Readonly<Record<PlaneKey, number>>`: maps each plane to its element size in bytes.

**Notes**

- Uses bit-masking (`n & (align - 1)`) which assumes `align` is a power of two; that holds for all current plane sizes.
- If you use this outside Seqlok, ensure your `BYTES_PER_ELEM` obeys that invariant.

---

## 4. Seqlock Helpers Removed from `src/primitives/seqlock.ts`

These helpers sit on top of the seqlock primitive used by `publish`. They were removed from the runtime because the
current bindings don't use them yet, but the implementations are solid and coherent.

### 4.1 `AcquireOptions`

**Purpose**

Extension of `TryReadOptions` that configures the behaviour of the high-level `acquire` primitive:

- `degrade`: whether to return the latest sampled value when budgets are exhausted.
- `maxAttempts`: outer cap on total `tryRead` attempts.

**Original implementation**

```ts
export interface AcquireOptions extends TryReadOptions {
  /**
   * Degrade policy when budgets are exhausted:
   *  - 'never'       → keep retrying until maxAttempts then throw
   *  - 'returnLatest'→ return the last sampled value even if coherence
   *                    could not be proven
   *
   * Default: 'never'
   */
  readonly degrade?: "never" | "returnLatest";

  /**
   * Hard cap on number of tryRead attempts before giving up.
   * Default: 1000
   */
  readonly maxAttempts?: number;
}
```

**Dependencies**

- `TryReadOptions` from the same module:

  ```ts
  export interface TryReadOptions {
    /** Max spins per attempt while waiting for even LOCK. Default: 1024. */
    readonly spinBudget?: number;
    /** Max verification retries if a writer races. Default: 8. */
    readonly retryBudget?: number;
  }
  ```

---

### 4.2 `acquire<T>(...)`

**Purpose**

Higher-level, never-degraded seqlock read primitive built on top of `tryRead`. It:

- Uses `tryRead` internally with bounded spin and retry budgets.
- Retries up to `maxAttempts` times.
- Supports a degrade policy:

  - `degrade: 'never'` → throw on timeout.
  - `degrade: 'returnLatest'` → return last sampled value when budgets are exhausted.

- Surfaces timeouts via structured error `primitives.seqlockTimeout`.

**Original implementation**

```ts
export function acquire<T>(
  p: SeqPair,
  reader: () => T,
  options?: AcquireOptions,
): T {
  const degrade = options?.degrade ?? "never";
  const maxAttempts = options?.maxAttempts ?? 1000;

  let attempts = 0;
  let lastValue: T | undefined;
  let totalSpins = 0;

  while (attempts < maxAttempts) {
    const result = tryRead(p, reader, options);
    totalSpins += result.status.spins;
    attempts += 1;

    if (result.ok) {
      return result.value;
    }

    lastValue = result.value;

    // Writer stayed active; just retry.
    if (result.status.kind === "writerActive") {
      // Loop continues, budgets are reset per tryRead call.
      continue;
    }

    // Budget exhausted inside tryRead; either degrade or continue.
    if (result.status.kind === "budgetExhausted") {
      if (degrade === "returnLatest" && lastValue !== undefined) {
        return lastValue;
      }
      // Otherwise, fall through and let the outer attempts budget decide.
    }
  }

  // Exceeded maxAttempts: surface a structured timeout.
  const details = {
    where: "primitives.seqlock.acquire",
    detail: `maxAttempts=${String(maxAttempts)}, degrade=${degrade}, spins=${String(
      totalSpins,
    )}`,
    spinBudget: options?.spinBudget ?? 1024,
    actualSpins: totalSpins,
  } as const satisfies PrimitivesSeqlockTimeoutDetails;

  throw createError(
    "primitives.seqlockTimeout",
    "Seqlock acquisition timeout",
    details,
  );
}
```

**Dependencies**

- `SeqPair` from the same module:

  ```ts
  export interface SeqPair {
    readonly u32: Uint32Array;
    readonly lockIndex: number;
    readonly seqIndex: number;
  }
  ```

- `tryRead<T>(...)` from the same module:

  ```ts
  export function tryRead<T>(
    p: SeqPair,
    reader: () => T,
    options?: TryReadOptions,
  ): { ok: boolean; value: T; status: SpinStatus } {
    // implementation elided here; still present in src/primitives
  }
  ```

  where `SpinStatus` looks like:

  ```ts
  export interface SpinStatus {
    /** Total spins consumed across all attempts. */
    readonly spins: number;
    /** Retries consumed because writers raced. */
    readonly retries: number;
    /**
     * Outcome category:
     *  - 'ok'             → coherent snapshot
     *  - 'writerActive'   → writer never quiesced on this attempt
     *  - 'budgetExhausted'→ exceeded spin/retry budgets
     */
    readonly kind: "ok" | "writerActive" | "budgetExhausted";
  }
  ```

- `PrimitivesSeqlockTimeoutDetails` from the primitives error domain, and `createError(...)` from `src/errors`:

  ```ts
  import type { PrimitivesSeqlockTimeoutDetails } from "../errors/codes/primitives";
  import { createError } from "../errors";
  ```

**Notes**

- This is a good starting point if you later implement **coherent meter snapshots** with explicit degrade policies in
  the binding layer.
- The outer `maxAttempts` loop bounds total work; inner `tryRead` bounds spins and retries per attempt.

---

### 4.3 `getSeq(p: SeqPair): number`

**Purpose**

Read the current SEQ counter from a seqlock pair.

**Original implementation**

```ts
/** Current monotonic SEQ (u32). */
export function getSeq(p: SeqPair): number {
  return loadU32(p.u32, p.seqIndex);
}
```

**Dependencies**

- `SeqPair` as above.
- `loadU32` from `src/primitives/atomics.ts`:

  ```ts
  export function loadU32(u32: Uint32Array, index: number): number {
    return Atomics.load(u32, index);
  }
  ```

**Typical uses (conceptual)**

- Diagnostics or monitoring ("how many successful publishes happened?").
- Not needed for binding-level APIs, which instead expose `version()` via meters.

---

### 4.4 `isWriterActive(p: SeqPair): boolean`

**Purpose**

Lightweight predicate to check whether the seqlock is currently in a write phase (LOCK odd).

**Original implementation**

```ts
/** Whether a writer is currently active (LOCK odd). */
export function isWriterActive(p: SeqPair): boolean {
  return (loadU32(p.u32, p.lockIndex) & 1) === 1;
}
```

**Dependencies**

- `SeqPair` as above.
- `loadU32` from `src/primitives/atomics.ts`.

**Notes**

- This intentionally leaks the "odd = writer, even = reader" convention of the lock word.
- In Seqlok's design, binding consumers should **never** branch on this directly; they use higher-level snapshot APIs
  instead.

---

## 5. When to Resurrect Anything from This Shelf

These helpers are **not** part of the v0.1.0 public API, but they're preserved here because they are:

- Small,
- Self-contained,
- Already integrated / designed for Seqlok's model.

If you bring any of them back into the runtime or into a new package:

1. Make sure there is a **real feature** driving it (e.g. coherent meter snapshots, alignment validation).
2. Start from the **binding API design** first, and then pull in the primitive (e.g. `acquire`) to support that.
3. Add tests and short docs for the new feature, rather than relying solely on this file.

Until then, this doc is the "cold storage" for the nice bits of code we decided not to ship in v0.1.0
