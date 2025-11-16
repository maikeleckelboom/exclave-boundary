import type { ErrorDetails, ErrorMeta } from '../registry';

export type PlanErrorCode = 'plan.failed' | 'plan.overflowRisk';

export interface PlanFailedDetails extends ErrorDetails {
  readonly detail?: string;
}

export interface PlanOverflowRiskDetails extends ErrorDetails {
  readonly estimatedBytes: number;
  readonly softLimitBytes: number;
}

interface PlanErrorDescriptor<C extends PlanErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

// Explicit key union for this domain
export type PlanErrorKey = 'failed' | 'overflowRisk';

// Map each key to its exact code literal
interface PlanErrorsMap {
  failed: PlanErrorDescriptor<'plan.failed'>;
  overflowRisk: PlanErrorDescriptor<'plan.overflowRisk'>;
}

/**
 * Plan error descriptors.
 *
 * Layer: planning (spec → memory plan).
 *
 * NOTE:
 * - We define a private `PLAN_ERRORS_DEF` with `as const`.
 * - Then derive `PlanErrorsMap` explicitly (no generic Record).
 * - Exported `PLAN_ERRORS` has an explicit annotation
 *   for --isolatedDeclarations.
 */
const PLAN_ERRORS_DEF: PlanErrorsMap = {
  failed: {
    code: 'plan.failed',
    message: 'Failed to plan memory plan',
    meta: {
      severity: 'error',
      recoverable: false,
      safeToExpose: true,
    },
  },
  overflowRisk: {
    code: 'plan.overflowRisk',
    message: 'Planned memory exceeds soft limit',
    meta: {
      severity: 'warning',
      recoverable: true,
      safeToExpose: true,
    },
  },
} as const;

// Exported constant with explicit annotation (for --isolatedDeclarations)
export const PLAN_ERRORS: PlanErrorsMap = PLAN_ERRORS_DEF;

/**
 * Sanity check: ensure PlanErrorCode union matches PLAN_ERRORS.*.code.
 *
 * This remains meaningful because `PlanErrorsMap` is tied to the literal
 * descriptors, not to PlanErrorCode.
 */
type _CodesFromDescriptors = PlanErrorsMap[PlanErrorKey]['code'];
type _CodesExact = PlanErrorCode;

export type _PlanCodesMatch = _CodesFromDescriptors extends _CodesExact
  ? _CodesExact extends _CodesFromDescriptors
    ? true
    : never
  : never;

// Force the check to be instantiated; if it drifts, this line fails.
export const _planCodesMatch: _PlanCodesMatch = true;
void _planCodesMatch;
