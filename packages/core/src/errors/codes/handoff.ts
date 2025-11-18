import type { ErrorDetails, ErrorMeta } from '../registry';

export type HandoffErrorCode =
  | 'handoff.versionMismatch'
  | 'handoff.invalidArtifact'
  | 'handoff.specHashMismatch'
  | 'handoff.backingMismatch';

export type HandoffErrorKey =
  | 'versionMismatch'
  | 'invalidArtifact'
  | 'specHashMismatch'
  | 'backingMismatch';

export interface HandoffVersionMismatchDetails extends ErrorDetails {
  readonly expectedVersion: number;
  readonly receivedVersion: number;
}

export interface HandoffInvalidArtifactDetails extends ErrorDetails {
  readonly detail?: string;
}

export interface HandoffSpecHashMismatchDetails extends ErrorDetails {
  readonly expectedHash: string;
  readonly receivedHash: string;
  readonly localHash: string;
  readonly remoteHash: string;
  readonly diff?: string;
}

export interface HandoffBackingMismatchDetails extends ErrorDetails {
  readonly expectedBytes: number;
  readonly receivedBytes: number;
  readonly local?: number;
  readonly remote?: number;
}

interface HandoffErrorDescriptor<C extends HandoffErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

interface HandoffErrorsMap {
  versionMismatch: HandoffErrorDescriptor<'handoff.versionMismatch'>;
  invalidArtifact: HandoffErrorDescriptor<'handoff.invalidArtifact'>;
  specHashMismatch: HandoffErrorDescriptor<'handoff.specHashMismatch'>;
  backingMismatch: HandoffErrorDescriptor<'handoff.backingMismatch'>;
}

/**
 * Domain-local descriptors used for IDE navigation and as a single
 * source of truth for code, message, and metadata.
 */
const HANDOFF_ERRORS_DEF: HandoffErrorsMap = {
  versionMismatch: {
    code: 'handoff.versionMismatch',
    message: 'Unexpected handoff version',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
  invalidArtifact: {
    code: 'handoff.invalidArtifact',
    message: 'Unsupported handoff artifact',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
  specHashMismatch: {
    code: 'handoff.specHashMismatch',
    message: 'Spec hash mismatch',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
  backingMismatch: {
    code: 'handoff.backingMismatch',
    message: 'Backing byteLength mismatch',
    meta: {
      severity: 'error',
      recoverable: false,
      boundarySafe: true,
    },
  },
} as const;

export const HANDOFF_ERRORS: HandoffErrorsMap = HANDOFF_ERRORS_DEF;

type _CodesFromDescriptors = HandoffErrorsMap[HandoffErrorKey]['code'];
type _CodesExact = HandoffErrorCode;

type _HandoffCodesMatch = _CodesFromDescriptors extends _CodesExact
  ? _CodesExact extends _CodesFromDescriptors
    ? true
    : never
  : never;

const _handoffCodesMatch: _HandoffCodesMatch = true;
void _handoffCodesMatch;
