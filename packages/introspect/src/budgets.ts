/**
 * @fileoverview
 * Introspect budgets for spin and retry limits, timeouts, and trace sizes.
 *
 * @remarks
 * - Used to bound introspect work like tracing and retries.
 * - Not part of the core data path; purely for observability.
 */

import {
  createIntrospectError,
  type IntrospectCounterDetails,
} from "./errors/introspect";

/**
 * Introspect budgets for various introspection limits.
 *
 * @remarks
 * These are soft safety rails. Blowing past them usually indicates a bug
 * or misconfiguration rather than normal operation.
 */
export interface IntrospectBudgets {
  /**
   * Maximum spin iterations for seqlock readers before degrading.
   */
  spinLimit: number;

  /**
   * Maximum number of coherent-read retries before degrading.
   */
  retryLimit: number;

  /**
   * Timeout in milliseconds for long-running introspect operations.
   *
   * @remarks
   * Can be `Infinity` to represent "no timeout".
   */
  timeoutMs: number;

  /**
   * Maximum size of in-memory introspect trace buffers.
   */
  traceBufferSize: number;
}

/**
 * Default introspect budgets.
 */
export const DEFAULT_INTROSPECT_BUDGETS: IntrospectBudgets = {
  spinLimit: 10_000,
  retryLimit: 1_000,
  timeoutMs: 5_000,
  traceBufferSize: 10_000,
};

/**
 * Validate a single budget value.
 *
 * @throws SeqlokError<'introspect.counterInvalid'>
 */
function assertValidBudgetValue(
  name: keyof IntrospectBudgets,
  value: number,
): void {
  const allowsInfinity = name === "timeoutMs";

  const baseValid =
    (Number.isFinite(value) && Number.isInteger(value) && value > 0) ||
    (allowsInfinity && value === Infinity);

  if (!baseValid) {
    const details: IntrospectCounterDetails = {
      name: `budget.${name as string}`,
      value,
    };

    throw createIntrospectError("counterInvalid", details);
  }

  // Per-budget sanity caps (soft "this is probably a bug" thresholds).
  if (name === "spinLimit" && value > 100_000) {
    const details: IntrospectCounterDetails = {
      name: "budget.spinLimit",
      value,
    };

    throw createIntrospectError("counterInvalid", details);
  }

  if (name === "retryLimit" && value > 10_000) {
    const details: IntrospectCounterDetails = {
      name: "budget.retryLimit",
      value,
    };

    throw createIntrospectError("counterInvalid", details);
  }

  if (name === "traceBufferSize" && value > 1_000_000) {
    const details: IntrospectCounterDetails = {
      name: "budget.traceBufferSize",
      value,
    };

    throw createIntrospectError("counterInvalid", details);
  }
}

/**
 * Validate a complete introspect budget object.
 *
 * @throws SeqlokError<'introspect.counterInvalid'>
 */
export function validateIntrospectBudgets(budgets: IntrospectBudgets): void {
  assertValidBudgetValue("spinLimit", budgets.spinLimit);
  assertValidBudgetValue("retryLimit", budgets.retryLimit);
  assertValidBudgetValue("timeoutMs", budgets.timeoutMs);
  assertValidBudgetValue("traceBufferSize", budgets.traceBufferSize);
}

/**
 * Merge overrides into defaults and validate the result.
 *
 * @remarks
 * Recommended entrypoint for external config and CLIs:
 * - fills missing fields from defaults
 * - validates the result
 * - returns an immutable budget object
 *
 * @throws SeqlokError<'introspect.counterInvalid'>
 */
export function createIntrospectBudgets(
  overrides: Partial<IntrospectBudgets> = {},
): IntrospectBudgets {
  const merged: IntrospectBudgets = {
    ...DEFAULT_INTROSPECT_BUDGETS,
    ...overrides,
  };

  validateIntrospectBudgets(merged);
  return merged;
}
