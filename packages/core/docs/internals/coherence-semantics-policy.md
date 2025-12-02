# Absolute Coherence Semantics: Policy, Not Primitives

**TL;DR:** If you want **"either 100% coherent or fail loudly"** semantics, you get that through
**policy configuration**, not by changing the seqlock primitives. The primitives already guarantee
that every _successful_ read is coherent — your policy decides what happens when coherence cannot
be achieved within budgets.

---

## 1. What the primitives already guarantee

At the primitive layer, `tryRead` gives you binary clarity:

```ts
interface SeqlockReadStatus {
  readonly spins: number;
  readonly retries: number;
}

type SeqlockReadResult<T> =
  | { ok: true; value: T; status: SeqlockReadStatus }
  | { ok: false; status: SeqlockReadStatus };
```

- **`ok: true`** → the snapshot was taken with a stable `[SEQ, data, SEQ]` triplet. Guaranteed coherent.
- **`ok: false`** → we did not manage to observe a stable state within the configured budgets. No data is returned.

There is no "maybe coherent" state. Ambiguity starts **above** the primitives: what does the binding layer do when
`ok === false`?

---

## 2. Policy options: what happens when coherence fails

The binding layer uses a **degradation policy** plus budgets to decide how to handle failed reads.

```ts
export type MeterDegradePolicy =
  | "never" // Throw on failure (strict coherence)
  | "stale" // Return last known good snapshot
  | "zeroed"; // Return sentinel values (e.g. zeros)

export interface ControllerMeterPolicyOptions {
  /**
   * What to do when a coherent snapshot cannot be obtained within budgets.
   * If omitted, the default is implementation-defined (typically 'never' or 'stale').
   */
  readonly degrade?: MeterDegradePolicy;

  /**
   * Maximum spins per retry attempt (inner loop patience).
   * Higher values → more CPU burn, better chance under heavy contention.
   */
  readonly spinBudget?: number;

  /**
   * Maximum retry attempts (outer loop patience).
   * Higher values → more latency, better chance under flappy contention.
   */
  readonly retryBudget?: number;
}
```

### Policy behaviours

| Policy     | Behaviour when `ok === false`                                                                  | Typical use case                                              |
| ---------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `'never'`  | Increment diagnostics counters, then **throw** `binding.snapshotRetryExhausted`                | Mission-critical metrics, stress tests, hard coherence checks |
| `'stale'`  | Increment diagnostics counters (incl. `degradedSnapshots`), return last coherent snapshot      | HUDs, visualizers, continuity > freshness                     |
| `'zeroed'` | Increment diagnostics counters (incl. `degradedSnapshots`), return sentinel snapshot (e.g. 0s) | Best-effort feeds where gaps are acceptable                   |

**Key point:** Primitive semantics are identical across all policies. Only the binding-layer behaviour and error
handling change.

---

## 3. Budget parameters: how hard to try before giving up

### `spinBudget` (inner loop patience)

Limits how long we spin while the lock is "busy":

- **Higher values** (e.g. 1000):

  - more likely to eventually catch a coherent window under heavy write contention
  - more CPU burn and higher worst-case latency

- **Lower values** (e.g. 10):
  - failures surface quickly (great for diagnostics)
  - more frequent failures under load

Diagnostics interpretation at binding level:

- If a read fails (`ok === false`) and `status.spins >= spinBudget`, we increment `spinBudgetExhausted`.

### `retryBudget` (outer loop patience)

Limits how many full read attempts we allow:

- **Higher values** (e.g. 10):

  - more tolerant to transient contention spikes
  - more total work and latency per snapshot

- **Lower values** (e.g. 2):
  - fast failure detection
  - less tolerance for sustained contention

Diagnostics interpretation:

- If a read fails (`ok === false`) and `status.retries >= retryBudget`, we increment `retryBudgetExhausted`.

---

## 4. Getting absolute coherence guarantees

For call sites where you want **provably coherent snapshots or loud failures**, the recipe is:

1. Use a **strict policy** (`degrade: 'never'`).
2. Choose budgets appropriate for your latency/robustness tradeoff.
3. Wire diagnostics in the _failure_ path at the binding layer.
4. Set strict thresholds in `runWithDiagnostics`.

### 4.1 Strict policy preset (conceptual)

```ts
const STRICT_METER_POLICY: ControllerMeterPolicyOptions = {
  degrade: "never", // No fallbacks — either coherent or error
  spinBudget: 100,
  retryBudget: 4,
};
```

How you plumb this into `bindController` is an API choice (e.g. via an options object). The important part is that the
_binding_ sees these budgets and the degrade policy.

### 4.2 Binding-side wiring (controller snapshot)

Shape of the controller snapshot wrapper:

```ts
import { tryRead } from "../primitives/seqlock";
import { createError } from "../errors/error";
import { incrementCounter } from "../introspect/counters";

interface SnapshotOptions {
  readonly spinBudget: number;
  readonly retryBudget: number;
  readonly where: string;
  readonly degrade: MeterDegradePolicy;
}

function snapshotWithPolicy<T>(
  options: SnapshotOptions,
  reader: () => T,
  getDegradedSnapshot: () => T,
): T {
  const { spinBudget, retryBudget, where, degrade } = options;

  const result = tryRead(/* pair */ /* ... */ reader, {
    spinBudget,
    retryBudget,
  });

  if (result.ok) {
    return result.value;
  }

  const { spins, retries } = result.status;

  if (spins >= spinBudget) {
    incrementCounter("spinBudgetExhausted");
  }

  if (retries >= retryBudget) {
    incrementCounter("retryBudgetExhausted");
  }

  if (degrade === "never") {
    throw createError("binding.snapshotRetryExhausted", { where });
  }

  incrementCounter("degradedSnapshots");

  return getDegradedSnapshot();
}
```

Semantics:

- Every return from `snapshotWithPolicy` is either:
  - a coherent snapshot (fast path), or
  - a deliberately degraded snapshot (tracked in diagnostics).
- In strict mode (`degrade === 'never'`), you never return degraded data, only coherent or error.

---

## 5. Thresholds in `runWithDiagnostics`

Given the counters above, a typical strict diagnostics configuration looks like:

```ts
const result = await runWithDiagnostics(() => runCriticalScenario(), {
  scenarioId: "critical:coherence-test",
  thresholds: {
    degradedSnapshots: 0, // In strict mode we don't expect any degradation
    spinBudgetExhausted: 0, // Any exhaustion is suspicious
    retryBudgetExhausted: 0, // Same
  },
});
```

- If all snapshots are coherent and budgets are respected, counters will remain at zero and thresholds pass.
- If contention or misconfiguration causes repeated failures, counters trip the thresholds and
  `result.thresholdViolations` gives a structured report.

---

## 6. Behaviour matrix: policy × outcome

For a single snapshot call:

| `tryRead.ok` | `degrade`  | Outcome                                | Counters                                                           |
| ------------ | ---------- | -------------------------------------- | ------------------------------------------------------------------ |
| `true`       | any        | Return coherent snapshot               | none                                                               |
| `false`      | `'never'`  | Throw `binding.snapshotRetryExhausted` | `spinBudgetExhausted`/`retryBudgetExhausted` as applicable         |
| `false`      | `'stale'`  | Return last coherent snapshot          | `spinBudgetExhausted`/`retryBudgetExhausted` + `degradedSnapshots` |
| `false`      | `'zeroed'` | Return sentinel snapshot (e.g. zeros)  | `spinBudgetExhausted`/`retryBudgetExhausted` + `degradedSnapshots` |

Rows 1–2 give you **absolute coherence guarantees** (no degraded data ever leaves strict call sites).
Rows 3–4 are opt-in continuity behaviours for UI/visual paths.

---

## 7. Recommended doc blurb for `ControllerMeterPolicyOptions`

When you document this in the API reference, a condensed version of the above is enough:

```ts
/**
 * Policy for controller meter snapshots.
 *
 * @remarks
 * The seqlock primitive guarantees that every successful read is coherent.
 * This policy controls what happens when a coherent read cannot be obtained
 * within the configured spin/retry budgets.
 *
 * - `degrade: 'never'` → strict coherence: on failure we throw a binding error.
 * - `degrade: 'stale'` → continuity via last-known-good snapshots.
 * - `degrade: 'zeroed'` → continuity via sentinel values.
 *
 * Lower budgets → faster failure detection (good for introspect).
 * Higher budgets → better success rates under contention (good for production),
 * at the cost of more work per snapshot in worst cases.
 *
 * Diagnostics counters (e.g. `spinBudgetExhausted`, `retryBudgetExhausted`,
 * `degradedSnapshots`) are incremented in the failure/degrade branches at
 * the binding layer, and can be inspected via `runWithDiagnostics`.
 */
export interface ControllerMeterPolicyOptions {
  readonly degrade?: MeterDegradePolicy;
  readonly spinBudget?: number;
  readonly retryBudget?: number;
}
```

---

## 8. Common policy presets (reference)

### Strict (mission-critical)

```ts
const options: {
  degrade: "never";
  spinBudget: 100;
  retryBudget: 4;
};
```

**Use for:** Meters backing critical business logic, financial calculations, safety systems.

### Soft (UI/visualization)

```ts
const options: {
  degrade: "stale";
  spinBudget: 50;
  retryBudget: 2;
};
```

**Use for:** Debug HUDs, waveform visualizers, non-critical telemetry.

### Diagnostic (stress testing)

```ts
const options: {
  degrade: "never";
  spinBudget: 10; // Deliberately low
  retryBudget: 2; // Deliberately low
};
```

**Use for:** Stress tests where you want failures to surface immediately so you can measure contention characteristics.

### Opportunistic (best-effort sampling)

```ts
const options: {
  degrade: "zeroed";
  spinBudget: 5;
  retryBudget: 1;
};
```

**Use for:** High-frequency polling where occasional missing samples are acceptable (e.g., visual FFT, spectrogram).

---

## Summary

**Absolute coherence semantics** = `degrade: 'never'` + appropriate budgets + diagnostic thresholds.

- The **primitive** already guarantees coherent-or-nothing at the low level
- The **policy** decides whether to fail loudly or fall back gracefully
- The **diagnostics** capture exactly where and why coherence failed
- The **thresholds** let you enforce SLOs in tests and production

This keeps primitives fast and simple while giving you complete control over error handling and observability at the
edges.

Net result: same spirit as the initial draft, but:

- matches the real `tryRead` contract (discriminated union, no `failureReason` at primitive level),
- aligns with `createError` and the registry model (no inline message strings),
- keeps `degradedSnapshots` semantics clean (only when we actually degrade),
- and doesn't sneak in unimplemented API shapes as facts.
