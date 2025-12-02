# Coherence Semantics: Key Implementation Details

This document captures the critical details that must be preserved when implementing or documenting the coherence policy system.

## 1. Primitive Result Shape (CORRECT)

```ts
interface SeqlockReadStatus {
  readonly spins: number;
  readonly retries: number;
}

type SeqlockReadResult<T> =
  | { ok: true; value: T; status: SeqlockReadStatus }
  | { ok: false; status: SeqlockReadStatus };
```

**Key points:**

- Discriminated union, NOT `{ ok: boolean; value: T | null }`
- NO `failureReason` field at primitive level
- Status is always present on both branches

## 2. Error Creation (CORRECT)

```ts
// ✅ CORRECT
throw createError("binding.snapshotRetryExhausted", {
  where: "controller.meters.snapshot",
});

// ❌ WRONG - no inline message string
throw createError(
  "binding.snapshotRetryExhausted",
  "Controller meter snapshot",
  {
    where: "controller.meters.snapshot",
  },
);
```

**Rationale:** Messages come from the error registry, not call sites.

## 3. Diagnostics Counter Semantics (CORRECT)

```ts
const result = tryRead(/* ... */);

if (!result.ok) {
  const { spins, retries } = result.status;

  // These increment on ANY failure
  if (spins >= spinBudget) {
    incrementCounter("spinBudgetExhausted");
  }
  if (retries >= retryBudget) {
    incrementCounter("retryBudgetExhausted");
  }

  if (degrade === "never") {
    // NO degradedSnapshots increment here!
    throw createError("binding.snapshotRetryExhausted", { where });
  }

  // ONLY increment when we actually degrade
  incrementCounter("degradedSnapshots");
  return getDegradedSnapshot();
}
```

**Key rule:** `degradedSnapshots` increments ONLY when we return degraded data, NOT when we throw.

## 4. Failure Reason Derivation (CORRECT)

```ts
// ✅ Derive failure reason at binding layer by comparing status to budgets
if (!result.ok) {
  const { spins, retries } = result.status;

  // Compare against budgets to determine "why"
  const spinExhausted = spins >= spinBudget;
  const retryExhausted = retries >= retryBudget;
}

// ❌ WRONG - no failureReason on primitive result
if (result.status.failureReason === "spinBudget") {
  /* ... */
}
```

**Rationale:** Primitives don't know about budgets, only actual counts. Binding layer interprets.

## 5. Policy Options Type (CORRECT)

```ts
// ✅ CORRECT - degrade is optional
export interface ControllerMeterPolicyOptions {
  readonly degrade?: MeterDegradePolicy;
  readonly spinBudget?: number;
  readonly retryBudget?: number;
}

// Document the default behavior in JSDoc
```

**Rationale:** Allows binding implementations to provide sensible defaults.

## 6. Diagnostics Feature Gating (NUANCED)

```ts
// In binding layer failure paths (already cold):
// NO feature gate needed - this is already rare
if (spins >= spinBudget) {
  incrementCounter("spinBudgetExhausted");
}

// In hot paths or high-frequency observation:
// YES, use feature gates
if (isIntrospectFeatureEnabled("seqlockTrace")) {
  observeSeqlockRead(result.status);
}
```

**Key distinction:**

- Failure paths are already cold → no gate needed
- Hot observation paths → always gate

## 7. API Surface Reality Check

### What exists today

```ts
const plan = planLayout(spec);
const backing = allocateShared(plan);
const handoff = buildHandoff(plan, backing);
const received = receiveHandoff(handoff);

const controller = bindController(spec, backing);
const processor = bindProcessor(received);
```

### What's conceptual/future

```ts
// This shape does NOT exist yet - mark as conceptual in docs
const controller = bindController(handoff, {
  meterPolicy: STRICT_METER_POLICY,
});
```

**Rule:** When documenting future API shapes, mark them as "conceptual" or "proposed".

## 8. Counter Increment Summary

| Counter                | When to increment                                                    |
| ---------------------- | -------------------------------------------------------------------- |
| `spinBudgetExhausted`  | Read failed AND `status.spins >= spinBudget`                         |
| `retryBudgetExhausted` | Read failed AND `status.retries >= retryBudget`                      |
| `degradedSnapshots`    | Read failed AND we actually return degraded data (NOT when throwing) |

## 9. Behaviour Matrix (Reference)

| `tryRead.ok` | `degrade`  | Return             | Counters                   |
| ------------ | ---------- | ------------------ | -------------------------- |
| `true`       | any        | Coherent snapshot  | none                       |
| `false`      | `'never'`  | Throw error        | spin/retry (if applicable) |
| `false`      | `'stale'`  | Last good snapshot | spin/retry + degraded      |
| `false`      | `'zeroed'` | Sentinel snapshot  | spin/retry + degraded      |

---

## Quick Validation Checklist

When reviewing code/docs related to coherence semantics:

- [ ] Result shape is discriminated union, not nullable value
- [ ] No `failureReason` on primitive results
- [ ] `createError` has no inline message string
- [ ] `degradedSnapshots` only increments when returning degraded data
- [ ] Failure reasons derived by comparing status to budgets
- [ ] Conceptual API shapes marked as such
- [ ] Feature gates only in hot paths, not failure paths
- [ ] Policy options have optional fields with documented defaults
