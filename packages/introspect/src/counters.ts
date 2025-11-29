/**
 * @fileoverview
 * Diagnostics counters for monitoring and introspection.
 *
 * @remarks
 * - Tracks operational metrics and performance counters.
 * - Provides thread-safe counter management for introspect.
 * - Used by debug overlays, metrics exporters, and test harnesses.
 *
 * Note: These counters are not part of the core data path and are
 * designed for observability and debugging purposes only.
 */

import {
  createIntrospectError,
  type IntrospectCounterDetails,
} from "./errors/introspect";

/**
 * Names for introspect counters maintained by Seqlok's introspection layer.
 *
 * @remarks
 * These counters are **not** part of the core data path; they are meant
 * for debug HUDs, metrics exporters, and testing harnesses.
 *
 * The set here is intentionally small and can be extended as introspect
 * features grow. Treat names as part of the introspect "ABI" – prefer
 * extending over renaming.
 */
export interface IntrospectCounters {
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
 * Immutable view of current introspect counters.
 */
export type IntrospectCountersSnapshot = Readonly<IntrospectCounters>;

/**
 * Valid counter identifier.
 */
export type IntrospectCounterName = keyof IntrospectCounters;

/**
 * Internal mutable backing store for introspect counters.
 */
const counters: IntrospectCounters = {
  degradedSnapshots: 0,
  spinBudgetExhausted: 0,
  retryBudgetExhausted: 0,
};

const MAX_COUNTER_VALUE = Number.MAX_SAFE_INTEGER;

/**
 * Validate a single counter value and throw a introspect error when
 * the value is not a sane introspection metric.
 *
 * @throws SeqlokError<'introspect.counterInvalid'>
 */
function assertValidCounterValue(
  name: IntrospectCounterName,
  value: number,
): void {
  const isFiniteNumber = Number.isFinite(value);
  const isNonNegative = value >= 0;
  const withinBound = value <= MAX_COUNTER_VALUE;

  if (!isFiniteNumber || !isNonNegative || !withinBound) {
    const details: IntrospectCounterDetails = {
      name,
      value,
    };

    throw createIntrospectError("counterInvalid", details);
  }
}

/**
 * Increment a introspect counter by the given delta.
 *
 * @remarks
 * This performs validation *after* applying the delta and will throw a
 * introspect error if the new value is invalid. Designed for use in
 * cold paths (debug overlays, test harnesses, metrics exporters).
 */
export function incrementCounter(name: IntrospectCounterName, delta = 1): void {
  const current = counters[name];
  const next = current + delta;

  assertValidCounterValue(name, next);
  counters[name] = next;
}

/**
 * Set a introspect counter to an explicit value.
 *
 * @remarks
 * Primarily useful in tests or when resetting counters. This validates
 * the value and will throw a introspect error if it is not sane.
 */
export function setCounter(name: IntrospectCounterName, value: number): void {
  assertValidCounterValue(name, value);
  counters[name] = value;
}

/**
 * Take a snapshot of all introspect counters.
 *
 * @remarks
 * The returned object is a shallow copy and can be safely exposed to
 * callers without risking accidental mutation of internal state.
 */
export function snapshotCounters(): IntrospectCountersSnapshot {
  return {
    degradedSnapshots: counters.degradedSnapshots,
    spinBudgetExhausted: counters.spinBudgetExhausted,
    retryBudgetExhausted: counters.retryBudgetExhausted,
  };
}

/**
 * Reset all introspect counters to zero.
 *
 * @remarks
 * Intended for use in test setups or when resetting a long-running
 * introspect session.
 */
export function resetCounters(): void {
  counters.degradedSnapshots = 0;
  counters.spinBudgetExhausted = 0;
  counters.retryBudgetExhausted = 0;
}
