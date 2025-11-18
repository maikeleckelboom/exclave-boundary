// src/diagnostics/budgets.ts

import { createError } from '../errors/error';

import type { DiagnosticsCounterDetails } from '../errors/codes/diagnostics';

/**
 * Budget constraints for diagnostics and introspection paths.
 *
 * @remarks
 * These budgets are for diagnostics-only work:
 * traces, HUD sampling, debug seqlock reads, etc.
 * They are separate from core seqlock/read budgets.
 */
export interface DiagnosticsBudgets {
  /**
   * Maximum spin iterations for diagnostics-only reads
   * (e.g. high-detail traces, slow HUD sampling).
   */
  readonly spinLimit: number;

  /**
   * Maximum retry attempts for diagnostics-only reads.
   */
  readonly retryLimit: number;

  /**
   * Maximum duration (ms) for a diagnostics operation before timeout.
   * Use Infinity to disable timeout checking.
   */
  readonly timeoutMs: number;

  /**
   * Maximum number of events in a diagnostics trace buffer.
   */
  readonly traceBufferSize: number;
}

/**
 * Default budgets for diagnostics operations.
 *
 * @remarks
 * Generous, cold-path oriented defaults. Production tooling can wrap
 * this and override as needed.
 */
export const DEFAULT_DIAGNOSTICS_BUDGETS: DiagnosticsBudgets = {
  spinLimit: 1_000,
  retryLimit: 100,
  timeoutMs: 5_000,
  traceBufferSize: 10_000,
};

/**
 * Validate an individual diagnostics budget value.
 *
 * @throws SeqlokError<'diagnostics.counterInvalid'>
 */
function assertValidBudgetValue(name: keyof DiagnosticsBudgets, value: number): void {
  const allowsInfinity = name === 'timeoutMs';

  const baseValid =
    (Number.isFinite(value) && Number.isInteger(value) && value > 0) ||
    (allowsInfinity && value === Infinity);

  if (!baseValid) {
    const details: DiagnosticsCounterDetails = {
      name: `budget.${name as string}`,
      value,
    };

    throw createError(
      'diagnostics.counterInvalid',
      'Diagnostics counter invalid',
      details,
    );
  }

  // Per-budget sanity caps (soft "this is probably a bug" thresholds).
  if (name === 'spinLimit' && value > 100_000) {
    const details: DiagnosticsCounterDetails = {
      name: 'budget.spinLimit',
      value,
    };

    throw createError(
      'diagnostics.counterInvalid',
      'Diagnostics counter invalid',
      details,
    );
  }

  if (name === 'retryLimit' && value > 10_000) {
    const details: DiagnosticsCounterDetails = {
      name: 'budget.retryLimit',
      value,
    };

    throw createError(
      'diagnostics.counterInvalid',
      'Diagnostics counter invalid',
      details,
    );
  }

  if (name === 'traceBufferSize' && value > 1_000_000) {
    const details: DiagnosticsCounterDetails = {
      name: 'budget.traceBufferSize',
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
 * Validate a complete diagnostics budget object.
 *
 * @throws SeqlokError<'diagnostics.counterInvalid'>
 */
export function validateDiagnosticsBudgets(budgets: DiagnosticsBudgets): void {
  assertValidBudgetValue('spinLimit', budgets.spinLimit);
  assertValidBudgetValue('retryLimit', budgets.retryLimit);
  assertValidBudgetValue('timeoutMs', budgets.timeoutMs);
  assertValidBudgetValue('traceBufferSize', budgets.traceBufferSize);
}

/**
 * Merge overrides into defaults and validate the result.
 *
 * @remarks
 * Recommended entrypoint for external config / CLIs:
 * - fills missing fields from defaults,
 * - validates the result,
 * - returns an immutable budget object.
 *
 * @throws SeqlokError<'diagnostics.counterInvalid'>
 */
export function createDiagnosticsBudgets(
  overrides: Partial<DiagnosticsBudgets> = {},
): DiagnosticsBudgets {
  const merged: DiagnosticsBudgets = {
    ...DEFAULT_DIAGNOSTICS_BUDGETS,
    ...overrides,
  };

  validateDiagnosticsBudgets(merged);
  return merged;
}
