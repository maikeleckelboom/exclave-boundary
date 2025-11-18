# Primitives

Lock-free building blocks used by the planner and bindings.

- **Allocation-free** on hot paths
- Use JS `Atomics.*` with **sequential consistency**
- SWMR-friendly (Single-Writer / Multiple-Reader)
- Thin, policy-light surfaces – all higher-level policy lives in bindings

Primitives live in the core as a small, focused layer: seqlock, atomics helpers, and plane utilities.

---

## Seqlock (dual-counter, SWMR)

Each domain (params / meters) uses a **dual-counter seqlock** stored in a shared `Uint32Array`:

- `LOCK` — odd while writer is active, even while quiescent
- `SEQ` — monotonically incremented **exactly once per successful commit**
  (the **one-bump rule**)

That pair is represented as:

```ts
export interface SeqPair {
  readonly u32: Uint32Array;
  readonly lockIndex: number; // LOCK word
  readonly seqIndex: number; // SEQ word
}
```

---

### Manual reference loop (what this abstracts)

At the lowest level, the protocol Seqlok implements boils down to a single-writer, many-reader loop around a shared
sequence word that encodes both a writer-active bit and a version counter.

This is a minimal "reference implementation" of that primitive, ignoring budgets and errors:

```ts
// "Raw" seqlock usage without Seqlok.
// Single writer, many readers. SharedArrayBuffer is already mapped to `u32`.

const SEQ_INDEX = 0; // one U32 used as [version | lockBit]

// Writer: mark "writer active", mutate payload, then publish a new version.
function beginWrite(u32: Uint32Array): void {
  const seq = Atomics.load(u32, SEQ_INDEX);
  // make it odd → writer active
  Atomics.store(u32, SEQ_INDEX, seq | 1);
}

function endWrite(u32: Uint32Array): void {
  const seq = Atomics.load(u32, SEQ_INDEX);
  // bump to next even → new version, writer idle
  Atomics.store(u32, SEQ_INDEX, (seq + 1) & ~1);
}

function writePayload(u32: Uint32Array, apply: () => void): void {
  beginWrite(u32);
  try {
    // mutate all related fields in shared memory
    apply();
  } finally {
    endWrite(u32);
  }
}

// Reader: spin until a self-consistent snapshot is observed.
function readCoherent<T>(
  u32: Uint32Array,
  readPayload: () => T, // reads everything into a local struct
): T {
  // In real Seqlok code, a spin / retry budget is added around this loop.
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    const seq0 = Atomics.load(u32, SEQ_INDEX);
    if ((seq0 & 1) !== 0) {
      // odd → writer active, skip this round
      continue;
    }

    const snapshot = readPayload(); // interpret the shared bytes

    const seq1 = Atomics.load(u32, SEQ_INDEX);
    if (seq0 === seq1 && (seq1 & 1) === 0) {
      // same even version before/after → coherent snapshot
      return snapshot;
    }

    // otherwise: torn read or writer raced → retry
  }
}
```

The seqlock primitives in this module are a structured, budgeted, error-reporting version of this pattern.
Higher layers (bindings, golden flow) never expose this loop directly; they wrap it in `snapshot()` / `within()` /
`publish()` semantics.

---

### Constructing a pair: `createSeqPair`

```ts
const pair = createSeqPair(u32Plane, lockIndex, seqIndex);
```

- Validates that `lockIndex` and `seqIndex` are in-bounds.
- Throws `SeqlokError<'internal.assertionFailed'>` if indices are invalid.
- Used by planner/bindings to hook the control planes (`PU`, `MU`) up to seqlock logic.

This is the only supported way to construct a `SeqPair`.

---

### Writer protocol (conceptual)

Writer steps:

1. **Enter** – mark `LOCK` odd.
2. **Write payload** – update all guarded fields.
3. **Commit & exit** – bump `SEQ`, then mark `LOCK` even.

Low-level helpers:

```ts
export function beginWrite(p: SeqPair): void;

export function endWrite(p: SeqPair): void;

export function publish<T>(p: SeqPair, fn: () => T): T;
```

- `beginWrite(p)`

  - `LOCK += 1` (even → odd).

- `endWrite(p)`

  - `SEQ += 1` (commit fence).
  - `LOCK += 1` (odd → even).

- `publish(p, fn)` – RAII wrapper:

  ```ts
  export function publish<T>(p: SeqPair, fn: () => T): T {
    beginWrite(p);
    let result: T;
    try {
      result = fn();
    } catch (e) {
      // unlock without advancing SEQ
      addU32(p.u32, p.lockIndex, 1);
      throw e;
    }
    endWrite(p);
    return result;
  }
  ```

  Guarantees:

  - **Exactly one** SEQ bump per successful call.
  - If `fn` throws, `LOCK` is restored to even and **`SEQ` is not incremented** (no ghost commit).

Bindings always use `publish`; raw `beginWrite` / `endWrite` are internal primitives.

---

### Reader protocol (conceptual)

Readers aim to observe a stable version:

1. Spin until `LOCK` is **even** (writer quiescent).
2. Capture `SEQ₀`.
3. Run `reader()` to load the payload.
4. Capture `SEQ₁` and re-check `LOCK` is even.
5. If `LOCK` never went odd and `SEQ₀ === SEQ₁`, the value is **coherent**.

In the primitives layer there are two reader helpers that implement budgeted, structured versions of this pattern:

- `tryRead` – bounded, explicit status, may return degraded values or throw.
- `acquire` – higher-level wrapper that either returns a coherent value or applies a degradation policy / throws.

Note: these live in the primitives module and are used by bindings. They are **not** part of the `@seqlok/core`
top-level public API surface.

---

### Bounded read: `tryRead`

```ts
export interface TryReadOptions {
  /** Max spins while waiting for even LOCK per attempt. Default: 1024. */
  readonly spinBudget?: number;

  /** Max verification retries if writers race us. Default: 8. */
  readonly retryBudget?: number;
}

export interface SpinStatus {
  /** Total spins consumed across all attempts. */
  readonly spins: number;
  /** Retries consumed because writers raced us. */
  readonly retries: number;
  /**
   * Outcome category:
   * - 'ok'              → coherent snapshot
   * - 'writerActive'    → writer never quiesced on this attempt
   * - 'budgetExhausted' → exceeded spin/retry budgets
   */
  readonly kind: 'ok' | 'writerActive' | 'budgetExhausted';
}

export function tryRead<T>(
  p: SeqPair,
  reader: () => T,
  options?: TryReadOptions,
): { ok: boolean; value: T; status: SpinStatus };
```

**Behavior:**

- Validates `spinBudget` / `retryBudget` as non-negative integers
  (invalid → `SeqlokError<'primitives.invalidSpinBudget'>`).

- Then performs bounded attempts to get a coherent snapshot:

  - If it manages a stable read:

    - Returns `{ ok: true, value, status: { kind: 'ok', spins, retries } }`.

  - If a writer **never quiesces within the spin budget** on the attempt where it decides to degrade:

    - Returns `{ ok: false, value: reader(), status: { kind: 'writerActive', ... } }`.
      This is a **best-effort** sample with explicit "writer is stuck" telemetry.

  - If it **exhausts budgets** (spin and/or retries) per its internal policy:

    - Returns with `status.kind === 'budgetExhausted'` _or_ throws
      `SeqlokError<'primitives.seqlockTimeout'>` depending on the exact branch in your current implementation.
      (The type describes the returned shape; throwing is an additional runtime behavior, not reflected in the TS return
      type.)

So at the type level:

- `ok` tells you whether the snapshot is proven coherent.
- `status.kind` tells you **why** you got what you got:

  - `'ok'` → strong guarantee.
  - `'writerActive'` → writer wouldn’t let go within the chosen spin budget.
  - `'budgetExhausted'` → you hit configured limits; check the error path / policy at the call site.

Bindings treat:

- `ok === true && kind === 'ok'` as the only "proper" snapshot.
- Anything else as degraded/diagnostic or escalated via `acquire` on top.

---

### High-level read: `acquire`

```ts
export interface AcquireOptions extends TryReadOptions {
  /**
   * Degrade policy when attempts are exhausted:
   *
   * - 'never'        → on timeout, throw `primitives.seqlockTimeout`
   * - 'returnLatest' → on timeout, return last sampled value (if any)
   *
   * Default: 'never'
   */
  readonly degrade?: 'never' | 'returnLatest';

  /**
   * Upper bound on the number of `tryRead` attempts.
   * Default: 1000.
   */
  readonly maxAttempts?: number;
}

export function acquire<T>(p: SeqPair, reader: () => T, options?: AcquireOptions): T;
```

**Behavior (conceptual):**

- Internally calls `tryRead` in a loop:

  ```ts
  let lastValue: T | undefined;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const result = tryRead(p, reader, options);

    if (result.ok) {
      return result.value; // coherent
    }

    lastValue = result.value; // degraded sample (writer stayed active)
    attempts += 1;
  }
  ```

- If the loop exits without success:

  - If `degrade === 'returnLatest'` and it has at least one `lastValue`, it returns that **best-effort** sample.
  - Otherwise, it throws `SeqlokError<'primitives.seqlockTimeout'>`.

**Usage pattern:**

- Real-time bindings (params/meters) typically use `acquire` under the hood with:

  - A conservative `maxAttempts`.
  - `degrade: 'never'` for correctness-critical paths.

- Diagnostic / "HUD-ish" code could opt into `degrade: 'returnLatest'` to get a non-coherent sample instead of an
  exception, but that's strictly opt-in at higher layers and usually not part of the core binding flow.

---

### Lightweight helpers: `getSeq` and `isWriterActive`

```ts
/** Current monotonic SEQ (u32). */
export function getSeq(p: SeqPair): number;

/** Whether a writer is currently active (LOCK odd). */
export function isWriterActive(p: SeqPair): boolean;
```

- `getSeq` is a cheap `Atomics.load` of the `SEQ` word.
- `isWriterActive` checks whether `LOCK` is odd right now.

These are useful for:

- HUDs (e.g., "param version" / "meter updates per second").
- Metrics about writer activity.

They do not attempt to establish coherence; they're just probes.

---

### Example: manual read vs `acquire`

```ts
import { createSeqPair, publish, tryRead, acquire } from './primitives/seqlock';

const pair = createSeqPair(u32Plane, lockIndex, seqIndex);

// Writer: commit atomically
publish(pair, () => {
  paramsF32[rateIdx] = nextRate;
  metersF32[peakIdx] = currentPeak;
});

// Reader: bounded, explicit status (internal usage)
const result = tryRead(pair, () => ({
  rate: paramsF32[rateIdx],
  peak: metersF32[peakIdx],
}));

if (result.ok) {
  // coherent snapshot
  consume(result.value);
} else {
  // writer stayed active; `value` is degraded but still useful for diagnostics
  logContention(result.status, result.value);
}

// Reader: strong semantics (used by bindings)
const snapshot = acquire(pair, () => ({
  rate: paramsF32[rateIdx],
  peak: metersF32[peakIdx],
}));

consume(snapshot); // coherent or throws on timeout
```

Bindings layer essentially uses `acquire`-style semantics inside:

- `params.within(...)`
- `meters.snapshot(...)`

…so user code normally interacts with those higher-level APIs, not with `tryRead`/`acquire` directly.

---

## Atomics helpers

All direct `Atomics` usage is centralized in a tiny helper module:

```ts
export function loadU32(plane: Uint32Array, index: number): number;

export function addU32(plane: Uint32Array, index: number, delta: number): number;

export function spinUntilEven(
  plane: Uint32Array,
  index: number,
  spinBudget: number,
): { value: number; spins: number } | undefined;
```

### Error normalization

These wrappers route failures through structured errors instead of leaking raw JS exceptions:

- `SeqlokError<'primitives.atomicsFailed'>` – if `Atomics.load` / `Atomics.add` throw.
- `SeqlokError<'primitives.invalidSpinBudget'>` – if budgets are negative or non-integers.

This gives you:

- Stable error codes
- Structured `where` / `detail` metadata
- One place to attach telemetry / crash reporting

### `loadU32`

Thin `Atomics.load` wrapper:

- Sequentially consistent read.
- Used for all LOCK/SEQ and control word loads.

### `addU32`

Thin `Atomics.add` wrapper:

- Used for incrementing `LOCK` and `SEQ`.
- Returns the previous value (same semantics as `Atomics.add`).

### `spinUntilEven`

Bounded spin loop on a `Uint32Array` slot:

```ts
const result = spinUntilEven(u32Plane, lockIndex, spinBudget);

if (result) {
  const { value, spins } = result; // value is even
} else {
  // writer stayed active for entire spinBudget
}
```

- Fast path: first `loadU32` sees an even value → returns immediately.
- Slow path: re-reads up to `spinBudget` times until an even value is found.
- Returns:

  - `{ value, spins }` if an even value is observed.
  - `undefined` if budget is exhausted without observing an even value.

Seqlock readers use this as the core "wait for writer to quiesce" primitive.

---

## Planes (memory layout & alignment)

Planes define how logical fields map onto shared memory. Each plane has:

- A **typed array kind** (`Float32Array`, `Uint32Array`, etc.)
- A **byte width** per element
- A role (params vs meters, payload vs control)

### Plane keys

```ts
export type PlaneKey =
  | 'PF32' // Float32 params           (f32, f32.array)
  | 'PI32' // Int32  params           (i32, i32.array, enum indices)
  | 'PB' // Uint8  params           (bool / bool.array as 0/1 bytes)
  | 'PU' // Uint32 param control    (param seqlock [LOCK, SEQ])
  | 'MF32' // Float32 meters          (f32, f32.array)
  | 'MU32' // Uint32 meters           (u32 counters, bool meters as 0/1)
  | 'MF64' // Float64 meters          (f64, f64.array)
  | 'MU'; // Uint32 meter control    (meter seqlock [LOCK, SEQ])
```

### Bytes per element

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
} as const;
```

Conventions:

- Bool params → `PB` as 0/1 bytes (ABI v1; no bit-packing).
- Bool meters → `MU32` as 0/1 `u32`.
- `PU` / `MU` planes store seqlock control words only: `[LOCK, SEQ]`.

> **No DSL leakage.** Planes store **raw numeric payload** only:
> floats, ints, counters, indices, flags.
> Enum labels, ranges, etc., live purely in the spec and bindings.

---

### Alignment helpers

Primitives expose three helpers that the planner/backing layer use for alignment:

```ts
export function isPow2(n: number): boolean;

export function roundUpTo(n: number, align: number): number;

export function isAligned(byteOffset: number, plane: PlaneKey): boolean;
```

#### `isPow2(n)`

Checks whether `n` is a positive power-of-two integer.

Used to guard `roundUpTo` against nonsense alignments.

#### `roundUpTo(n, align)`

Rounds `n` up to the next multiple of `align`:

```ts
// align must be a power of two
const aligned = roundUpTo(offset, BYTES_PER_ELEM.MF64);
```

Used by the planner to:

- Enforce 4-byte alignment for PF32/PI32/PU/MF32/MU32/MU.
- Enforce 8-byte alignment for MF64.
- Leave PB minimally aligned (1-byte).

#### `isAligned(byteOffset, plane)`

Checks whether an offset is valid for a plane:

```ts
isAligned(24, 'MF64'); // true
isAligned(28, 'MF64'); // false
```

Typical usage:

```ts
let offset = 0;

// align for MF32 region
offset = roundUpTo(offset, BYTES_PER_ELEM.MF32);
if (!isAligned(offset, 'MF32')) {
  /* throw ... */
}
```

Planner and backing code use these helpers to guarantee the resulting `SharedArrayBuffer` layout always maps cleanly to
typed arrays.

---

## Design intent

The primitives layer is deliberately simple:

- **Minimal, stable surface** used by planner, allocator, and bindings:

  - Seqlock: `SeqPair`, `createSeqPair`, `publish`, `tryRead`, `acquire`, `getSeq`, `isWriterActive`
  - Atomics: `loadU32`, `addU32`, `spinUntilEven`
  - Planes: `PlaneKey`, `BYTES_PER_ELEM`, `roundUpTo`, `isPow2`, `isAligned`

- **No allocations** in hot paths; the only state is in the shared planes you supply.

- **No hidden policy** beyond:

  - bounded spinning,
  - explicit degrade-vs-throw behavior,
  - clearly named error codes.

These primitives line up exactly with the higher-level semantics:

- SEQ as a version counter (`meters.version()` reads it).
- SWMR per domain (Controller vs Processor).
- Coherent read windows (`params.within`, `meters.snapshot`).
- Atomic meter commits (`meters.publish`).

Everything above this layer can be fancy.
This layer must stay boring enough that you can reason about it at 2am with a pencil and a coffee.
