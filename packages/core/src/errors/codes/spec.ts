/**
 * Spec error codes with navigable descriptors (consolidated).
 * Fewer codes, more structured reasons in the detail payloads.
 *
 * @module errors/codes/spec
 */

import type { EnumDetails, RangeDetails } from '../details';
import type { ErrorDetails, ErrorMeta } from '../registry';

export type SpecErrorCode =
  | 'spec.rangeInvalid'
  | 'spec.enumInvalid'
  | 'spec.arrayInvalid'
  | 'spec.duplicateKey'
  | 'spec.builderInvalid';

export type SpecErrorKey =
  | 'rangeInvalid'
  | 'enumInvalid'
  | 'arrayInvalid'
  | 'duplicateKey'
  | 'builderInvalid';

export interface SpecRangeDetails extends RangeDetails {
  readonly reason: 'inverted' | 'nan' | 'infinite';
}

export type SpecEnumDetails = EnumDetails;

export interface SpecArrayDetails extends ErrorDetails {
  readonly key: string;
  readonly length: number;
  readonly reason: 'nonPositive' | 'fractional';
}

export interface SpecDuplicateKeyDetails extends ErrorDetails {
  readonly key: string;
  readonly section: 'params' | 'meters';
}

export interface SpecBuilderDetails extends ErrorDetails {
  readonly key?: string;
  readonly reason?:
    | 'invalidKind'
    | 'missingId'
    | 'emptyParams'
    | 'planFailed'
    | 'alignmentFailed'
    | 'overflowRisk';
  readonly totalBytes?: number;
  readonly maxSafeBytes?: number;
}

interface ErrorDescriptor<C extends string> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

interface SpecErrorsMap {
  rangeInvalid: ErrorDescriptor<'spec.rangeInvalid'>;
  enumInvalid: ErrorDescriptor<'spec.enumInvalid'>;
  arrayInvalid: ErrorDescriptor<'spec.arrayInvalid'>;
  duplicateKey: ErrorDescriptor<'spec.duplicateKey'>;
  builderInvalid: ErrorDescriptor<'spec.builderInvalid'>;
}

const SPEC_ERRORS_DEF = {
  rangeInvalid: {
    code: 'spec.rangeInvalid',
    message: 'Parameter range invalid',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
  enumInvalid: {
    code: 'spec.enumInvalid',
    message: 'Enum validation failed',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
  arrayInvalid: {
    code: 'spec.arrayInvalid',
    message: 'Array definition invalid',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
  duplicateKey: {
    code: 'spec.duplicateKey',
    message: 'Duplicate key in params or meters',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
  builderInvalid: {
    code: 'spec.builderInvalid',
    message: 'Spec builder validation failed',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: false,
    },
  },
} as const satisfies SpecErrorsMap;

export const SPEC_ERRORS: SpecErrorsMap = SPEC_ERRORS_DEF;

type _CodesFromDescriptors = SpecErrorsMap[SpecErrorKey]['code'];
type _VerifySpecCodes = SpecErrorCode extends _CodesFromDescriptors
  ? _CodesFromDescriptors extends SpecErrorCode
    ? true
    : never
  : never;
export const _specCodesMatch: _VerifySpecCodes = true;
