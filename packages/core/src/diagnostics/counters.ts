import { createError } from '../errors/error';

import type { DiagnosticsCounterDetails } from '../errors/codes/diagnostics';

/**
 * Names for diagnostics counters maintained by Seqlok's introspection layer.
 *
 * @remarks
 * These counters are **not** part of the core data path; they are meant
 * for debug HUDs, metrics exporters, and testing harnesses.
 *
 * The set here is intentionally small and can be extended as diagnostics
 * features grow. Treat names as part of the diagnostics "ABI" – prefer
 * extending over renaming.
 */
export interface DiagnosticsCounters {
  /**
   * Number of times a snapshot had to fall back to a degraded path
   * (e.g. exhausted spin/retry budgets).
   */
  degradedSnapshots: number;

  /**
   * Number of times the seqlock reader hit the spin budget limit.
   */
  spinBudgetExhausted: number;

  /**
   * Number of times the seqlock reader hit the retry budget limit.
   */
  retryBudgetExhausted: number;
}

/**
 * Immutable view of current diagnostics counters.
 */
export type DiagnosticsCountersSnapshot = Readonly<DiagnosticsCounters>;

/**
 * Valid counter identifier.
 */
export type DiagnosticsCounterName = keyof DiagnosticsCounters;

/**
 * Internal mutable backing store for diagnostics counters.
 */
const counters: DiagnosticsCounters = {
  degradedSnapshots: 0,
  spinBudgetExhausted: 0,
  retryBudgetExhausted: 0,
};

const MAX_COUNTER_VALUE = Number.MAX_SAFE_INTEGER;

/**
 * Validate a single counter value and throw a diagnostics error when
 * the value is not a sane introspection metric.
 *
 * @throws SeqlokError<'diagnostics.counterInvalid'>
 */
function assertValidCounterValue(name: DiagnosticsCounterName, value: number): void {
  const isFiniteNumber = Number.isFinite(value);
  const isNonNegative = value >= 0;
  const withinBound = value <= MAX_COUNTER_VALUE;

  if (!isFiniteNumber || !isNonNegative || !withinBound) {
    const details: DiagnosticsCounterDetails = {
      name,
      value,
    };

    throw createError(
      'diagnostics.counterInvalid',
      'Diagnostics counter invalid',
      details,
    );
  }
}

/**
 * Increment a diagnostics counter by the given delta.
 *
 * @remarks
 * This performs validation *after* applying the delta and will throw a
 * diagnostics error if the new value is invalid. Designed for use in
 * cold paths (debug overlays, test harnesses, metrics exporters).
 */
export function incrementDiagnosticsCounter(
  name: DiagnosticsCounterName,
  delta = 1,
): void {
  const current = counters[name];
  const next = current + delta;

  assertValidCounterValue(name, next);
  counters[name] = next;
}

/**
 * Set a diagnostics counter to an explicit value.
 *
 * @remarks
 * Primarily useful in tests or when resetting counters. This validates
 * the value and will throw a diagnostics error if it is not sane.
 */
export function setDiagnosticsCounter(name: DiagnosticsCounterName, value: number): void {
  assertValidCounterValue(name, value);
  counters[name] = value;
}

/**
 * Take a snapshot of all diagnostics counters.
 *
 * @remarks
 * The returned object is a shallow copy and can be safely exposed to
 * callers without risking accidental mutation of internal state.
 */
export function snapshotDiagnosticsCounters(): DiagnosticsCountersSnapshot {
  return {
    degradedSnapshots: counters.degradedSnapshots,
    spinBudgetExhausted: counters.spinBudgetExhausted,
    retryBudgetExhausted: counters.retryBudgetExhausted,
  };
}

/**
 * Reset all diagnostics counters to zero.
 *
 * @remarks
 * Intended for use in test setups or when resetting a long-running
 * diagnostics session.
 */
export function resetDiagnosticsCounters(): void {
  counters.degradedSnapshots = 0;
  counters.spinBudgetExhausted = 0;
  counters.retryBudgetExhausted = 0;
}
