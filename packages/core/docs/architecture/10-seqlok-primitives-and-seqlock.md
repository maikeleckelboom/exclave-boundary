Here's an updated, cleaned-up version of the **Primitives** doc, aligned with the current kernel (`seqlock.ts`, `atomics.ts`, `planes.ts`) and current naming.

---

# Primitives

Lock-free building blocks used by the planner, backing layer, and bindings.

- **Allocation-free** on hot paths
- Use JS `Atomics.*` with **sequential consistency**
- SWMR-friendly (Single-Writer / Multiple-Reader)
- Thin, policy-light surfaces – all higher-level policy lives in bindings and composition layers

Primitives live as a **small internal layer** in `@seqlok-internal/prototype-core`:

- Seqlock (dual-counter, SWMR)
- Atomics helpers
- Plane constants and alignment helpers

They are **not** exposed from the top-level public barrel.

---

## 1. Seqlock (dual-counter, SWMR)

Each domain (params / meters) uses a **dual-counter seqlock** stored in a shared `Uint32Array`:

- `LOCK` — odd while writer is active, even while quiescent
- `SEQ` — monotonic commit counter (incremented **exactly once per successful commit** – the _one-bump rule_)

The kernel represents a lock pair as:

```ts
export interface SeqPair {
  readonly u32: Uint32Array;
  readonly lockIndex: number; // LOCK word
  readonly seqIndex: number; // SEQ word
}
```

Each `SeqPair` is SWMR:

- Exactly **one writer** (e.g. controller for params, processor for meters)
- Potentially many readers

---

### 1.1 Manual reference loop (what this abstracts)

At the lowest level, the protocol is:

- A single writer toggles a lock word and bumps a sequence counter around payload writes.
- Readers sample the payload only when the lock is even and the sequence is stable.

A minimal "reference implementation" of the **two-word** seqlock (ignoring budgets, errors, and ergonomics):

```ts
// SharedArrayBuffer already mapped to `u32` (Uint32Array).
const LOCK_INDEX = 0;
const SEQ_INDEX = 1;

// Writer: mark "writer active", mutate payload, then publish.
function beginWrite(u32: Uint32Array): void {
  // even → odd
  Atomics.add(u32, LOCK_INDEX, 1);
}

function endWrite(u32: Uint32Array): void {
  // commit stamp
  Atomics.add(u32, SEQ_INDEX, 1);
  // odd → even
  Atomics.add(u32, LOCK_INDEX, 1);
}

function writePayload(u32: Uint32Array, apply: () => void): void {
  beginWrite(u32);
  try {
    apply(); // mutate all guarded fields
  } finally {
    // ensure lock is restored even on error
    endWrite(u32);
  }
}

// Reader: spin+sample until a self-consistent snapshot is observed.
function readCoherent<T>(u32: Uint32Array, readPayload: () => T): T {
  // In real code there is a bounded spin/retry budget around this loop.
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    // Wait for writer quiescent
    const lockBefore = Atomics.load(u32, LOCK_INDEX);
    if ((lockBefore & 1) !== 0) {
      continue; // writer active
    }

    const seq0 = Atomics.load(u32, SEQ_INDEX);
    const snapshot = readPayload(); // read guarded payload
    const seq1 = Atomics.load(u32, SEQ_INDEX);
    const lockAfter = Atomics.load(u32, LOCK_INDEX);

    // Same even lock/seq before/after → coherent snapshot
    if ((lockBefore & 1) === 0 && (lockAfter & 1) === 0 && seq0 === seq1) {
      return snapshot;
    }

    // otherwise: torn read or race → retry
  }
}
```

The **seqlock primitives** in the kernel are the budgeted, error-reporting abstraction of this pattern. Bindings (`params.within`, `meters.publish`, `meters.snapshot`) never expose the raw loop directly.

---

### 1.2 Constructing a pair: `createSeqPair`

```ts
const pair = createSeqPair(u32Plane, lockIndex, seqIndex);
```

Guarantees:

- Validates `lockIndex` and `seqIndex` are within bounds of the `Uint32Array`.
- Throws `SeqlokError<'internal.assertionFailed'>` if indices are invalid.
- Used by the backing/layout layer to hook the **control planes** (`PU`, `MU`) into seqlock logic.

This is the **only** supported way to construct a `SeqPair`.

---

### 1.3 Writer protocol (kernel functions)

Writer steps at the conceptual level:

1. **Enter** – mark `LOCK` odd.
2. **Write payload** – update all guarded fields.
3. **Commit & exit** – bump `SEQ`, then mark `LOCK` even.

Kernel helpers (from `seqlock.ts`):

```ts
declare function beginWrite(p: SeqPair): void;
declare function endWrite(p: SeqPair): void;
declare function publish<T>(p: SeqPair, fn: () => T): T;
```

Semantics:

- `beginWrite(p)`
  `LOCK += 1` (even → odd). Enter critical section.

- `endWrite(p)`
  `SEQ += 1` (commit) then `LOCK += 1` (odd → even).

- `publish(p, fn)` — RAII wrapper around `beginWrite` / `endWrite`:

  ```ts
  export function publish<T>(p: SeqPair, fn: () => T): T {
    beginWrite(p);
    let result: T;
    try {
      result = fn();
    } catch (err) {
      // unlock without advancing SEQ
      addU32(p.u32, p.lockIndex, 1);
      throw err;
    }
    endWrite(p);
    return result;
  }
  ```

  Guarantees:

  - **Exactly one** `SEQ` bump per successful call.
  - If `fn` throws, `LOCK` is restored to even and **`SEQ` is not incremented** (no ghost commit).
  - Any lock poisoning is treated as an internal bug.

Bindings always go through `publish` for meter writes; raw `beginWrite` / `endWrite` are reserved for very low-level usage.

---

### 1.4 Reader protocol: `tryRead`

Readers aim to observe a stable version under bounded spin/retry budgets.

Types:

```ts
export interface TryReadOptions {
  /** Max spins while waiting for even LOCK per attempt. Default: 1024. */
  readonly spinBudget?: number;
  /** Max verification retries if writers race us. Default: 8. */
  readonly retryBudget?: number;
}

export interface ReadStatus {
  /** Total spins consumed across all attempts. */
  readonly spins: number;
  /** Retries consumed because writers raced us. */
  readonly retries: number;
  /**
   * Outcome category:
   * - 'ok'              → coherent snapshot
   * - 'writerActive'    → writer never quiesced on this attempt
   * - 'budgetExhausted' → budgets exhausted (used in timeout error detail)
   */
  readonly kind: "ok" | "writerActive" | "budgetExhausted";
}

export type TryReadResult<T> =
  | { ok: true; value: T; status: ReadStatus & { kind: "ok" } }
  | { ok: false; value: T; status: ReadStatus & { kind: "writerActive" } };

declare function tryRead<T>(
  pair: SeqPair,
  reader: () => T,
  options?: TryReadOptions,
): TryReadResult<T>;
```

Behavior:

1. Validates `spinBudget` / `retryBudget` as finite, non-negative integers.

- On invalid budgets → throws `SeqlokError<'primitives.invalidSpinBudget'>`.

2. Repeatedly tries to obtain a coherent snapshot:

- Spin until `LOCK` is even (bounded by `spinBudget`, using `spinUntilEven`).

- Sample `SEQ` → `seqBefore`.

- Run `reader()` to copy/interpret payload into a local value.

- Sample `SEQ` → `seqAfter` and check `LOCK` is still even.

- If lock stayed even and `seqBefore === seqAfter`:

  - Return `{ ok: true, value, status: { kind: 'ok', spins, retries } }`.

- Otherwise:

  - Increment `retries` and try again until `retryBudget` is exhausted.

3. If the writer **never quiesces** within the spin budget on the final attempt:

- Returns `{ ok: false, value, status: { kind: 'writerActive', ... } }`.
  This is a **best-effort** sample; `status` captures contention.

4. If spin/retry budgets are **fully exhausted** without a coherent sample:

- Throws `SeqlokError<'primitives.seqlockTimeout'>` with a `ReadStatus` payload whose `kind` is
  `'budgetExhausted'`.

Important nuance:

- The **return type** only ever has `kind: 'ok' | 'writerActive'`.
- The `'budgetExhausted'` branch is surfaced **via the thrown error**, not as a returned `TryReadResult`.

Bindings interpret results as:

- `ok: true` → coherent snapshot, safe to use.
- `ok: false` + `kind: 'writerActive'` → degraded sample; typically escalated or used only for diagnostics.
- `primitives.seqlockTimeout` → fatal for the calling path (should not happen under sane workloads).

Bindings do **not** expose `tryRead` directly; they use it inside `params.within`, `meters.snapshot`, etc.

---

### 1.5 Lightweight probes: `getSeq` and `isWriterActive`

```ts
/** Current monotonic SEQ (u32). */
declare function getSeq(pair: SeqPair): number;

/** Whether a writer is currently active (LOCK odd). */
declare function isWriterActive(pair: SeqPair): boolean;
```

- `getSeq` is a single `Atomics.load` on the `SEQ` word; used for version counters (`params.version()`, `meters.version()`).
- `isWriterActive` checks the `LOCK` word's parity; useful for diagnostics/HUDs ("writer busy" indicators, etc.).

These helpers **do not** attempt to establish coherence; they're just cheap status probes.

---

### 1.6 Example: manual read vs `tryRead`

Internal usage pattern:

```ts
import { createSeqPair, publish, tryRead } from "./primitives/seqlock";

const pair = createSeqPair(u32Plane, lockIndex, seqIndex);

// Writer: atomic commit of a payload
publish(pair, () => {
  paramsF32[rateIdx] = nextRate;
  metersF32[peakIdx] = currentPeak;
});

// Reader: bounded, explicit status (inside bindings)
const result = tryRead(pair, () => ({
  rate: paramsF32[rateIdx],
  peak: metersF32[peakIdx],
}));

if (result.ok) {
  // coherent snapshot
  consume(result.value);
} else {
  // writer stayed active; `value` is degraded, status carries contention info
  logContention(result.status, result.value);
}
```

Bindings wrap this into higher-level APIs:

- `processor.params.within(...)`
- `controller.meters.snapshot(...)`

User code interacts with those, not with `tryRead` directly.

---

## 2. Atomics helpers

All direct `Atomics` calls used by the seqlock and planner/backing layers are centralized into a tiny helper module (`atomics.ts`):

```ts
declare function loadU32(plane: Uint32Array, index: number): number;

declare function addU32(
  plane: Uint32Array,
  index: number,
  delta: number,
): number;

declare function spinUntilEven(
  plane: Uint32Array,
  index: number,
  spinBudget: number,
): { value: number; spins: number } | undefined;
```

### 2.1 Error normalization

These wrappers normalize errors into structured `SeqlokError`s:

- `SeqlokError<'primitives.atomicsFailed'>`

  - Underlying `Atomics.load` / `Atomics.add` threw (e.g. wrong typed array, detached buffer, non-shared view).
  - Carries `detail.where` / `detail.operation` / indices for diagnostics.

- `SeqlokError<'primitives.invalidSpinBudget'>`

  - For `spinUntilEven` when `spinBudget` is negative, non-integer, or otherwise invalid.

This gives:

- Stable error codes
- Structured metadata
- One place to attach telemetry / logging

### 2.2 `loadU32`

- Thin wrapper around `Atomics.load`.
- Sequentially consistent read.
- Used for all `LOCK` / `SEQ` and other control words.

### 2.3 `addU32`

- Thin wrapper around `Atomics.add`.
- Used to increment `LOCK` and `SEQ` in seqlock and for small counters.
- Returns the **previous** value, like the native Atomics API.

### 2.4 `spinUntilEven`

Bounded spin loop on a `Uint32Array` slot:

```ts
const result = spinUntilEven(u32Plane, lockIndex, spinBudget);

if (result) {
  const { value, spins } = result; // value is guaranteed even
} else {
  // writer stayed active for the entire spinBudget
}
```

Behavior:

- Fast path: first `loadU32` sees an even value → returns immediately with `{ value, spins: 0 }`.
- Slow path: re-reads up to `spinBudget` times until an even value is observed.
- Returns:

  - `{ value, spins }` if an even value is observed within budget.
  - `undefined` if budget is exhausted without seeing an even value.

Seqlock readers use this as the "wait for writer to quiesce" primitive before sequence sampling.

---

## 3. Planes (memory layout primitives)

Planes define how logical fields map onto contiguous/shared memory. Each plane has:

- A **TypedArray kind** (`Float32Array`, `Uint32Array`, …)
- A **byte width** per element
- A **role** (params vs meters, payload vs control)

These are defined in `planes.ts` and are shared across planner, backing, and bindings.

### 3.1 Plane keys

```ts
export type PlaneKey =
  | "PF32" // Float32 params           (f32, f32.array)
  | "PI32" // Int32  params           (i32, i32.array, enum indices)
  | "PB" // Uint8  params           (bool / bool.array as 0/1 bytes)
  | "PU" // Uint32 param control    (param seqlock [LOCK, SEQ])
  | "MF32" // Float32 meters          (f32, f32.array)
  | "MU32" // Uint32 meters           (u32 counters, bool meters as 0/1)
  | "MF64" // Float64 meters          (f64, f64.array)
  | "MU"; // Uint32 meter control    (meter seqlock [LOCK, SEQ])
```

Conventions (ABI v1):

- Bool **params** → `PB` as 0/1 bytes (no bit-packing).
- Bool **meters** → `MU32` as 0/1 `u32`.
- `PU` and `MU` planes contain only seqlock control words `[LOCK, SEQ]`.

There is **no DSL metadata** in the planes: no field names, no ranges, no enum labels; only raw numeric payloads and counters.

### 3.2 Bytes per element

```ts
export const BYTES_PER_ELEM: Readonly<Record<PlaneKey, number>> = {
  PF32: 4,
  PI32: 4,
  PB: 1,
  PU: 4,
  MF32: 4,
  MU32: 4,
  MF64: 8,
  MU: 4,
};
```

Used by:

- Planner: to compute offsets and total byte lengths per plane.
- Backing: to map byte offsets to typed-array indices.
- Tests: to assert determinism and invariants.

### 3.3 Alignment helper: `roundUpTo`

`planes.ts` exposes one small alignment helper:

```ts
declare function roundUpTo(n: number, align: number): number;
```

- `align` must be a positive integer (planner/backing treat misuse as a bug).
- Returns the smallest multiple of `align` that is ≥ `n`.

Typical usage:

```ts
// Ensure MF64 data starts on an 8-byte boundary
offset = roundUpTo(offset, BYTES_PER_ELEM.MF64);
```

This is used by the planner/backing code where explicit alignment boundaries are needed; the **canonical packing order** for contiguous backings is defined and documented in the backing/layout doc (`BACKING_PLANE_PACK_ORDER_V1`).

---

## 4. Design intent of the primitives layer

The primitives layer is deliberately small and boring:

- **Minimal, stable surface**:

  - Seqlock:
    `SeqPair`, `createSeqPair`, `beginWrite`, `endWrite`, `publish`, `TryReadOptions`, `ReadStatus`, `TryReadResult`, `tryRead`, `getSeq`, `isWriterActive`.

  - Atomics:
    `loadU32`, `addU32`, `spinUntilEven`.

  - Planes:
    `PlaneKey`, `BYTES_PER_ELEM`, `roundUpTo`.

- **No allocations** in hot paths. All state lives in shared memory (`SharedArrayBuffer` / shared `WebAssembly.Memory`).

- **No hidden policy**, beyond:

  - bounded spinning and retry budgets,
  - explicit timeout errors (`primitives.seqlockTimeout`),
  - explicit `primitives.atomicsFailed` / `primitives.invalidSpinBudget` for misuse or platform faults.

These primitives line up exactly with higher-level semantics:

- SEQ as version counter (`params.version()`, `meters.version()`).
- SWMR per domain (Controller vs Processor).
- Coherent read windows (`params.within`, meter snapshots).
- Atomic meter commits (`meters.publish`).
- Deterministic plane layout (planner/backing).

Everything above this layer (bindings, kits, observers, rings) can be sophisticated.
The primitives layer must remain simple enough that you can reason about it at 2 AM with a pencil and a coffee.
