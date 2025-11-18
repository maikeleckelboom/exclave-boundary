import type { ErrorDetails, ErrorMeta } from '../registry';

export type InternalErrorCode =
  | 'internal.assertionFailed'
  | 'internal.unreachable'
  | 'internal.exhaustiveness';

export interface InternalAssertionDetails extends ErrorDetails {
  readonly detail?: string;
}

interface InternalErrorDescriptor<C extends InternalErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

export type InternalErrorKey = 'assertionFailed' | 'unreachable' | 'exhaustiveness';

interface InternalErrorsMap {
  assertionFailed: InternalErrorDescriptor<'internal.assertionFailed'>;
  unreachable: InternalErrorDescriptor<'internal.unreachable'>;
  exhaustiveness: InternalErrorDescriptor<'internal.exhaustiveness'>;
}

export const INTERNAL_ERRORS: InternalErrorsMap = {
  assertionFailed: {
    code: 'internal.assertionFailed',
    message: 'Internal assertion failed',
    meta: {
      severity: 'fatal',
      recoverable: false,
      boundarySafe: false,
    },
  },
  unreachable: {
    code: 'internal.unreachable',
    message: 'Unreachable code executed',
    meta: {
      severity: 'fatal',
      recoverable: false,
      boundarySafe: false,
    },
  },
  exhaustiveness: {
    code: 'internal.exhaustiveness',
    message: 'Non-exhaustive branch',
    meta: {
      severity: 'fatal',
      recoverable: false,
      boundarySafe: false,
    },
  },
} as const;

/* Sanity check: ensure InternalErrorCode union matches INTERNAL_ERRORS.*.code */
type _CodesFromDescriptors = InternalErrorsMap[InternalErrorKey]['code'];
type _CodesExact = InternalErrorCode;
type _InternalCodesMatch = _CodesFromDescriptors extends _CodesExact
  ? _CodesExact extends _CodesFromDescriptors
    ? true
    : never
  : never;

const _internalCodesMatch: _InternalCodesMatch = true;
void _internalCodesMatch;
