/**
 * Backing error codes with navigable descriptors.
 * Symbolic constants + metadata + type safety.
 *
 * @module errors/codes/backing
 */

import type { BufferDetails } from '../details';
import type { ErrorDetails, ErrorMeta } from '../registry';

export interface BackingPlaneDetails extends ErrorDetails {
  readonly plane: string;
  readonly requestedBytes: number;
  readonly allocatedBytes: number;
}

export interface BackingWasmMemoryDetails extends ErrorDetails {
  readonly plane: 'wasm';
  readonly shared: boolean;
  readonly detail?: string;
}

export type BackingIntoDetails = BufferDetails;

export type BackingErrorCode =
  | 'backing.allocFailed'
  | 'backing.allocUndersized'
  | 'backing.wasmMemoryNotShared'
  | 'backing.intoTypeMismatch'
  | 'backing.intoLengthMismatch';

export type BackingErrorKey =
  | 'allocFailed'
  | 'allocUndersized'
  | 'wasmMemoryNotShared'
  | 'intoTypeMismatch'
  | 'intoLengthMismatch';

export interface ErrorDescriptor<C extends BackingErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

interface BackingErrorsMap {
  allocFailed: ErrorDescriptor<'backing.allocFailed'>;
  allocUndersized: ErrorDescriptor<'backing.allocUndersized'>;
  wasmMemoryNotShared: ErrorDescriptor<'backing.wasmMemoryNotShared'>;
  intoTypeMismatch: ErrorDescriptor<'backing.intoTypeMismatch'>;
  intoLengthMismatch: ErrorDescriptor<'backing.intoLengthMismatch'>;
}

/**
 * Domain-local descriptors used for IDE navigation and as a single
 * source of truth for code, message, and metadata.
 */
export const BACKING_ERRORS: BackingErrorsMap = {
  allocFailed: {
    code: 'backing.allocFailed',
    message: 'Backing allocation failed',
    meta: {
      severity: 'fatal',
      recoverable: true,
      boundarySafe: true,
    },
  },
  allocUndersized: {
    code: 'backing.allocUndersized',
    message: 'Backing undersized for requested plan',
    meta: {
      severity: 'error',
      recoverable: true,
      boundarySafe: true,
    },
  },
  wasmMemoryNotShared: {
    code: 'backing.wasmMemoryNotShared',
    message: 'WebAssembly.Memory is not shared',
    meta: {
      severity: 'error',
      recoverable: true,
      boundarySafe: true,
    },
  },
  intoTypeMismatch: {
    code: 'backing.intoTypeMismatch',
    message: 'Into buffer typed array constructor mismatch',
    meta: {
      severity: 'error',
      recoverable: true,
      boundarySafe: true,
    },
  },
  intoLengthMismatch: {
    code: 'backing.intoLengthMismatch',
    message: 'Into buffer length mismatch',
    meta: {
      severity: 'error',
      recoverable: true,
      boundarySafe: true,
    },
  },
} as const;

type _CodesFromDescriptors = BackingErrorsMap[BackingErrorKey]['code'];
type _CodesExact = BackingErrorCode;

export type _BackingCodesMatch = _CodesFromDescriptors extends _CodesExact
  ? _CodesExact extends _CodesFromDescriptors
    ? true
    : never
  : never;

export const _backingCodesMatch: _BackingCodesMatch = true;
void _backingCodesMatch;
