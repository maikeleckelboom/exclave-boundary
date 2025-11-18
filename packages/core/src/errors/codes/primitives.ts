import type { ErrorDetails, ErrorMeta } from '../registry';

export type PrimitivesErrorKey =
  | 'seqlockTimeout'
  | 'planeUnaligned'
  | 'atomicsFailed'
  | 'invalidSpinBudget';

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
}

const PRIMITIVES_ERRORS_DEF = {
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
} as const satisfies PrimitivesErrorsMap;

export const PRIMITIVES_ERRORS: PrimitivesErrorsMap = PRIMITIVES_ERRORS_DEF;

export type PrimitivesErrorCode = PrimitivesErrorsMap[PrimitivesErrorKey]['code'];

export interface PrimitivesSeqlockTimeoutDetails extends ErrorDetails {
  readonly spinBudget: number;
  readonly actualSpins: number;
}

type _VerifyPrimitivesCodes = PrimitivesErrorCode extends PrimitivesErrorCode
  ? true
  : never;
export const _primitivesCodesMatch: _VerifyPrimitivesCodes = true;
