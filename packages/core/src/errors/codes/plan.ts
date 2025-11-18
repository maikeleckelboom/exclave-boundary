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

export type PlanErrorKey = 'failed' | 'overflowRisk';

interface PlanErrorsMap {
  failed: PlanErrorDescriptor<'plan.failed'>;
  overflowRisk: PlanErrorDescriptor<'plan.overflowRisk'>;
}

export const PLAN_ERRORS: PlanErrorsMap = {
  failed: {
    code: 'plan.failed',
    message: 'Failed to plan memory plan',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
  overflowRisk: {
    code: 'plan.overflowRisk',
    message: 'Planned memory exceeds soft limit',
    meta: {
      severity: 'warning',
      recoverable: true,
      boundarySafe: true,
    },
  },
} as const;

type _CodesFromDescriptors = PlanErrorsMap[PlanErrorKey]['code'];
type _CodesExact = PlanErrorCode;
type _PlanCodesMatch = _CodesFromDescriptors extends _CodesExact
  ? _CodesExact extends _CodesFromDescriptors
    ? true
    : never
  : never;

const _planCodesMatch: _PlanCodesMatch = true;
void _planCodesMatch;
