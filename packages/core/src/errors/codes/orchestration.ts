import type { ErrorDetails, ErrorMeta } from '../registry';

export type OrchestrationErrorCode = 'orchestration.createFailed';
export type OrchestrationErrorKey = 'createFailed';

export interface OrchestrationDetails extends ErrorDetails {
  readonly phase?: 'plan' | 'allocate' | 'bindController';
  readonly detail?: string;
}

interface OrchestrationErrorDescriptor<C extends OrchestrationErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

interface OrchestrationErrorsMap {
  createFailed: OrchestrationErrorDescriptor<'orchestration.createFailed'>;
}

const ORCHESTRATION_ERRORS_DEF = {
  createFailed: {
    code: 'orchestration.createFailed',
    message: 'High-level creation/orchestration failed',
    meta: {
      severity: 'error',
      recoverable: true,
      boundarySafe: true,
    },
  },
} as const satisfies OrchestrationErrorsMap;

export const ORCHESTRATION_ERRORS: OrchestrationErrorsMap = ORCHESTRATION_ERRORS_DEF;

type _CodesFromDescriptors = OrchestrationErrorsMap[OrchestrationErrorKey]['code'];
type _VerifyOrchestrationCodes = OrchestrationErrorCode extends _CodesFromDescriptors
  ? _CodesFromDescriptors extends OrchestrationErrorCode
    ? true
    : never
  : never;
export const _orchestrationCodesMatch: _VerifyOrchestrationCodes = true;
