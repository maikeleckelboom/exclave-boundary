# Diagnostics & Seqlock Budgets: Binding-Level Contract

**Status:** Draft / Implementation Guidance

**Scope:** `@seqlok/core` – bindings + diagnostics, _not_ primitives

This doc freezes the mental model for how diagnostics counters and thresholds relate to seqlock usage, **without**
wiring anything into primitives. It exists so we can implement the hooks later without re-arguing the design.

## 1. Design Intent

We want to:

- Measure **how often** seqlock reads are in distress (budget exhaustion, degraded fallback).

- Keep **all diagnostics work off the hot success path**.

- Avoid contaminating primitives with diagnostics, error domains, or policy.

This gives us:

- Real signals for `runWithDiagnostics` thresholds like:

```ts
const thresholds: {
  degradedSnapshots: 100;
  spinBudgetExhausted: 10;
  retryBudgetExhausted: 10;
};
```

- While primitives remain pure and reusable.

## 2. Layering: Who Does What

### 2.1 Primitives (`primitives/seqlock.ts`)

**Contract:**

- Implement the dual-counter seqlock.

- Provide a bounded read primitive:

```
// Shape only – actual types may differ slightly
type TryReadStatus = {
  readonly spins: number;
  readonly retries: number;
};

type TryReadResult<T> =
  | { ok: true; value: T; status: TryReadStatus }
  | { ok: false; status: TryReadStatus };

function tryRead<T>(
  pair: SeqPair,
  reader: () => T,
  options: { spinBudget: number; retryBudget: number },
): TryReadResult<T>;
```

**Must NOT:**

- Call `createError`.

- Touch diagnostics (counters, sessions, exports).

- Know about domains (`binding.*`, `diagnostics.*`, etc.).

- Embed policy ("what to do if budgets are exhausted").

Primitives only **report**: `ok`, `value`, `status.spins`, `status.retries`.

### 2.2 Bindings (controller/processor)

Bindings are where we:

- Interpret `tryRead` results.

- Enforce budgets.

- Decide whether to:

  - succeed,

  - degrade,

  - or throw a `binding.*` error.

- Increment diagnostics counters _only in exceptional paths_.

**Key helpers (conceptual):**

```
// diagnostics/counters.ts (already exists conceptually)
export type IntrospectCounterName =
  | 'degradedSnapshots'
  | 'spinBudgetExhausted'
  | 'retryBudgetExhausted';

export function incrementCounter(
  name: IntrospectCounterName,
  delta: number = 1,
): void;
```

Bindings import `incrementCounter` and use it **only** when something is already bad.

#### 2.2.1 Controller: meters snapshot

Controller meters snapshot uses `tryRead` under the hood.

Canonical wrapper (shape):

```ts
// controller.snapshot.ts (shape only)
import { tryRead } from "../primitives/seqlock";
import { createError } from "../errors";
import { incrementCounter } from "../introspect/counters";

interface SnapshotOptions {
  readonly spinBudget: number;
  readonly retryBudget: number;
  readonly where: string;
}

// No degraded fallback: either coherent or throws.
function snapshotWithSeqlock<T>(options: SnapshotOptions, reader: () => T): T {
  const { spinBudget, retryBudget, where } = options;

  const result = tryRead(
    /* pair */
    reader,
    { spinBudget, retryBudget },
  );

  if (!result.ok) {
    const { spins, retries } = result.status;

    if (spins >= spinBudget) {
      incrementCounter("spinBudgetExhausted");
    }

    if (retries >= retryBudget) {
      incrementCounter("retryBudgetExhausted");
    }

    throw createError("binding.snapshotRetryExhausted", { where });
  }

  return result.value;
}
```

Degraded variant (if we ever add one):

```ts
function snapshotWithFallback<T>(
  options: SnapshotOptions,
  reader: () => T,
  degradedReader: () => T,
): T {
  const { spinBudget, retryBudget, where } = options;

  const result = tryRead(
    /* pair */
    reader,
    { spinBudget, retryBudget },
  );

  if (!result.ok) {
    const { spins, retries } = result.status;

    if (spins >= spinBudget) {
      incrementCounter("spinBudgetExhausted");
    }

    if (retries >= retryBudget) {
      incrementCounter("retryBudgetExhausted");
    }

    // We choose to continue in a degraded mode instead of throwing.
    incrementCounter("degradedSnapshots");

    return degradedReader();
  }

  return result.value;
}
```

`controller.meters.snapshot(...)` can be trivially implemented in terms of these helpers.

#### 2.2.2 Processor: `params.within`

Processor coherent param read is also a `tryRead` wrapper.

Canonical pattern:

```ts
// processor.impl.ts (shape only)
import { tryRead } from "../primitives/seqlock";
import { createError } from "../errors";
import { incrementCounter } from "../introspect/counters";

export function makeWithin<S>(
  spinBudget: number,
  retryBudget: number,
  where: string,
  reader: () => ParamView<S>,
) {
  return (cb: (params: ParamView<S>) => void): void => {
    const result = tryRead(
      /* pair */
      reader,
      { spinBudget, retryBudget },
    );

    if (!result.ok) {
      const { spins, retries } = result.status;

      if (spins >= spinBudget) {
        incrementCounter("spinBudgetExhausted");
      }

      if (retries >= retryBudget) {
        incrementCounter("retryBudgetExhausted");
      }

      throw createError("binding.coherentRetryExhausted", { where });
    }

    cb(result.value);
  };
}
```

Notes:

- No degraded path here — processor coherent read is "coherent or fail."

- Still no changes to primitives.

### 2.3 Diagnostics (`diagnostics/*`)

Diagnostics is **fully downstream**:

- It never calls primitives directly.

- It never decides seqlock policy.

- It only sees **counters**, **sessions**, **health**, and **exports**.

The important building block for scenarios is:

```ts
// introspect/run-with-health.ts (shape only)

export interface DiagnosticsThresholds {
  readonly degradedSnapshots?: number;
  readonly spinBudgetExhausted?: number;
  readonly retryBudgetExhausted?: number;
}

export interface ThresholdViolation {
  readonly metric: IntrospectCounterName;
  readonly actual: number;
  readonly threshold: number;
}

export interface RunWithDiagnosticsResult<T> {
  readonly scenarioId: string;
  readonly metadata: Readonly<Record<string, unknown>>;

  readonly value: T | undefined;
  readonly error: SeqlokError<ErrorCode> | undefined;
  readonly health: HealthInterpretation | undefined;

  readonly boundarySafe: boolean;
  readonly docsUrl: string | undefined;

  readonly introspectSession: DiagnosticsSession;
  readonly introspectCounters: IntrospectCountersSnapshot;
  readonly introspectExportJson: string;
  readonly thresholdViolations: readonly ThresholdViolation[];
}

export interface RunWithDiagnosticsOptions {
  readonly scenarioId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly thresholds?: DiagnosticsThresholds;
  // optional callbacks, etc.
}

export async function runWithDiagnostics<T>(
  run: () => Promise<T> | T,
  options: RunWithDiagnosticsOptions,
): Promise<RunWithDiagnosticsResult<T>> {
  // 1) reset counters
  // 2) start session
  // 3) run scenario (capture value / SeqlokError)
  // 4) end session
  // 5) snapshot counters
  // 6) export JSON
  // 7) compute thresholdViolations based on options.thresholds
  // 8) attach health via interpretHealth(error.meta) if present
}
```

Threshold checking happens entirely on **snapshotted counters**:

```ts
function checkDiagnosticsThresholds(
  counters: IntrospectCountersSnapshot,
  thresholds: DiagnosticsThresholds | undefined,
): ThresholdViolation[] {
  if (!thresholds) return [];

  const violations: ThresholdViolation[] = [];

  if (
    thresholds.degradedSnapshots !== undefined &&
    counters.degradedSnapshots > thresholds.degradedSnapshots
  ) {
    violations.push({
      metric: "degradedSnapshots",
      actual: counters.degradedSnapshots,
      threshold: thresholds.degradedSnapshots,
    });
  }

  if (
    thresholds.spinBudgetExhausted !== undefined &&
    counters.spinBudgetExhausted > thresholds.spinBudgetExhausted
  ) {
    violations.push({
      metric: "spinBudgetExhausted",
      actual: counters.spinBudgetExhausted,
      threshold: thresholds.spinBudgetExhausted,
    });
  }

  if (
    thresholds.retryBudgetExhausted !== undefined &&
    counters.retryBudgetExhausted > thresholds.retryBudgetExhausted
  ) {
    violations.push({
      metric: "retryBudgetExhausted",
      actual: counters.retryBudgetExhausted,
      threshold: thresholds.retryBudgetExhausted,
    });
  }

  return violations;
}
```

## 3. Semantics of Diagnostics Counters

Assuming the binding hooks described above, the counters mean:

**`degradedSnapshots`** Number of times a binding-level read failed to obtain a coherent snapshot within budgets and \*
\*chose to degrade\*\* instead of throwing (e.g. fallback read, stale cache).

**`spinBudgetExhausted`** Number of times a binding-level read used `tryRead`, saw `result.ok === false`, and the
`status.spins` was at or above the configured `spinBudget`. _Interpretation:_ “We burned our allowed spins and still
didn't see a stable seqlock state."

**`retryBudgetExhausted`** Number of times a binding-level read used `tryRead`, saw `result.ok === false`, and the
`status.retries` was at or above the configured `retryBudget`. _Interpretation:_ “We performed bounded retries and still
never got a coherent snapshot."

All three are expected to be **zero or near-zero** in a healthy system under typical workloads.

## 4. Semantics of Thresholds

Given the counters above, the diagnostics thresholds in a scenario:

```ts
const thresholds: {
  degradedSnapshots: 100;
  spinBudgetExhausted: 10;
  retryBudgetExhausted: 10;
};
```

are interpreted as:

- **`degradedSnapshots`**: “How many degraded reads we tolerate for this scenario before calling it too
  noisy/unreliable.”

- **`spinBudgetExhausted`**: “How many times the spin budget may be exhausted before we consider this scenario a
  regression.”

- **`retryBudgetExhausted`**: “How many times the retry budget may be exhausted before we consider this scenario a
  regression.”

Exceeding a threshold:

1. **does not throw** inside `runWithDiagnostics`.

2. populates `result.thresholdViolations`, so tests / CI / tooling can assert on it.

Example check:

```ts
const result = await runWithDiagnostics(() => runDeckLoadAndScrubScenario(), {
  scenarioId: "stress:deck-load-and-scrub",
  thresholds: {
    degradedSnapshots: 100,
    spinBudgetExhausted: 10,
    retryBudgetExhausted: 10,
  },
});

if (result.thresholdViolations.length > 0) {
  // fail test / mark CI red / log regressions
}
```

## 5. Invariants & Non-Goals

**Invariants:**

- Primitives never import or reference diagnostics or domain-specific errors.

- Diagnostics never reach into primitives; they only consume:

  - bindings' behaviour (via counters),

  - `ErrorMeta` (via `interpretHealth`),

  - sessions + exports.

- Binding-layer seqlock wrappers are the only place where:

  - budget exhaustion is interpreted,

  - degraded read behaviour is implemented,

  - diagnostics counters are incremented.

**Non-goals:**

- No per-read threshold checks inside bindings (no per-call dynamic thresholds).

- No dynamic tuning of spin/retry budgets based on diagnostics data inside core.

- No coupling between diagnostics and real-time hot paths beyond the "already failing" branches.

## 6. Future Implementation Notes

When we come back to implement this:

1. **Add hooks**:

- Implement the `incrementCounter` calls in:

  - controller snapshot helpers,

  - processor within helpers,

  - any degraded-read path we introduce.

2. **Align docs**:

- Ensure README and architecture docs describe counters and thresholds exactly as in this file.

3. **Tests**:

- Add property / stress tests that:

  - deliberately force budget exhaustion and verify counters increase.

  - verify `runWithDiagnostics` thresholds produce `thresholdViolations`.

Once those are in place, the diagnostics thresholds in scenarios (audio, WebGPU, etc.) will be backed by real,
binding-level signals without ever touching the primitives layer.
