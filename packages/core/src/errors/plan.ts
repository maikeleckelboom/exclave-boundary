/**
 * @fileoverview
 * Error codes and detail types for planning shared memory layouts.
 *
 * @remarks
 * - Covers plan failures and soft-limit overflow risk for `planLayout`.
 * - Used by planners and allocators before backing memory is committed.
 * - Registered into the global error registry as the `plan.*` domain.
 */

import {
  buildErrorDomain,
  DOMAIN_IDS,
  type BuiltErrorDomain,
  type DomainRegistry,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorKeyOf,
  type KeyedErrorFactoryOf,
  type SeqlokError,
} from "@seqlok/base";

/**
 * Detail payload for a generic planning failure.
 */
export interface PlanFailedDetails extends ErrorDetails {
  /**
   * Optional human-readable detail about the failure.
   *
   * @example "negative plane byte length"
   */
  readonly detail?: string;
}

/**
 * Detail payload for a soft-limit overflow in planning.
 *
 * @remarks
 * - `estimatedBytes` is the total planned footprint.
 * - `softLimitBytes` is the configured soft cap that was exceeded.
 */
export interface PlanOverflowRiskDetails extends ErrorDetails {
  readonly estimatedBytes: number;
  readonly softLimitBytes: number;
}

interface PlanDetailsByKey {
  readonly failed: PlanFailedDetails;
  readonly overflowRisk: PlanOverflowRiskDetails;
}

const PLAN_DEFS = {
  failed: {
    message: "Failed to compute memory layout plan",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  overflowRisk: {
    message: "Planned memory exceeds soft limit",
    meta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: true,
    },
  },
} as const;

type PlanDefs = typeof PLAN_DEFS;

export const PLAN: BuiltErrorDomain<"plan", PlanDefs> = buildErrorDomain(
  "plan",
  DOMAIN_IDS.plan,
  PLAN_DEFS,
);

export type PlanErrorCode = ErrorCodeOf<typeof PLAN>;
export type PlanErrorKey = ErrorKeyOf<typeof PLAN>;
export type PlanError = SeqlokError<PlanErrorCode>;

export const PLAN_ERRORS: DomainRegistry<"plan", PlanDefs> = PLAN.registry;

export const createPlanError: KeyedErrorFactoryOf<
  BuiltErrorDomain<"plan", PlanDefs>,
  PlanDetailsByKey
> = PLAN.createError;

export type PlanErrorFactory = typeof createPlanError;
