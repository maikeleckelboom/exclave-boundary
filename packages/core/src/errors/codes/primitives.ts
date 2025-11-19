// packages/core/src/errors/codes/primitives.ts

import type { ErrorDetails, ErrorMeta } from '../registry';

export type PrimitivesErrorKey =
  | 'seqlockTimeout'
  | 'planeUnaligned'
  | 'atomicsFailed'
  | 'invalidSpinBudget'
  | 'swsrRingInvalidLayout';

interface PrimitivesErrorsMap {
  seqlockTimeout: {
    readonly code: 'primitives.seqlockTimeout';
    readonly message: string;
    readonly meta: ErrorMeta;
  };
  planeUnaligned: {
    readonly code: 'primitives.planeUnaligned';
    readonly message: string;
    readonly meta: ErrorMeta;
  };
  atomicsFailed: {
    readonly code: 'primitives.atomicsFailed';
    readonly message: string;
    readonly meta: ErrorMeta;
  };
  invalidSpinBudget: {
    readonly code: 'primitives.invalidSpinBudget';
    readonly message: string;
    readonly meta: ErrorMeta;
  };
  swsrRingInvalidLayout: {
    readonly code: 'primitives.swsrRingInvalidLayout';
    readonly message: string;
    readonly meta: ErrorMeta;
  };
}

const PRIMITIVES_ERRORS_DEF: PrimitivesErrorsMap = {
  seqlockTimeout: {
    code: 'primitives.seqlockTimeout',
    message: 'Seqlock acquisition timeout',
    meta: {
      severity: 'error',
      recoverable: true,
      boundarySafe: true,
    },
  },
  planeUnaligned: {
    code: 'primitives.planeUnaligned',
    message: 'Plane offset not aligned to element size',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
  atomicsFailed: {
    code: 'primitives.atomicsFailed',
    message: 'Atomics operation failed',
    meta: {
      severity: 'fatal',
      recoverable: false,
      boundarySafe: false,
    },
  },
  invalidSpinBudget: {
    code: 'primitives.invalidSpinBudget',
    message: 'Spin budget must be non-negative integer',
    meta: {
      severity: 'error',
      recoverable: true,
      boundarySafe: true,
    },
  },
  swsrRingInvalidLayout: {
    code: 'primitives.swsrRingInvalidLayout',
    message: 'SWSR ring layout is invalid',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
} as const;

export const PRIMITIVES_ERRORS: PrimitivesErrorsMap = PRIMITIVES_ERRORS_DEF;

export type PrimitivesErrorCode = PrimitivesErrorsMap[PrimitivesErrorKey]['code'];

/**
 * Details for seqlock timeout diagnostics.
 */
export interface PrimitivesSeqlockTimeoutDetails extends ErrorDetails {
  readonly spinBudget: number;
  readonly actualSpins: number;
}

/**
 * Details for invalid SWSR layout.
 * Used when capacity/wordsPerSlot are rejected at allocation time.
 */
export interface PrimitivesSwsrRingInvalidLayoutDetails extends ErrorDetails {
  readonly capacity: number;
  readonly wordsPerSlot: number;
}

type _VerifyPrimitivesCodes = PrimitivesErrorCode extends PrimitivesErrorCode
  ? true
  : never;
const _primitivesCodesMatch: _VerifyPrimitivesCodes = true;
void _primitivesCodesMatch;
