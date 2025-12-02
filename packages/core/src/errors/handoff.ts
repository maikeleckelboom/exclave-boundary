/**
 * @fileoverview
 * Error codes and detail types for handoff artifacts.
 *
 * @remarks
 * - Covers invalid/mismatched plan/backing/spec combinations in handoffs.
 * - Used when validating handoff payloads at controller/processor boundaries.
 * - Registered into the global error registry as the `handoff.*` domain.
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
 * Details for a handoff version mismatch.
 */
export interface HandoffVersionMismatchDetails extends ErrorDetails {
  readonly expectedVersion: number;
  readonly receivedVersion: number;
}

/**
 * Details for an invalid or unsupported handoff artifact.
 */
export interface HandoffInvalidArtifactDetails extends ErrorDetails {
  readonly detail?: string;
  readonly expectedBytes?: number;
  readonly receivedBytes?: number;
}

/**
 * Details for spec hash mismatches during handoff validation.
 */
export interface HandoffSpecHashMismatchDetails extends ErrorDetails {
  readonly expectedHash: string;
  readonly receivedHash: string;
  readonly localHash: string;
  readonly remoteHash: string;
  readonly diff?: string;
}

/**
 * Details for backing byteLength mismatches during handoff.
 */
export interface HandoffBackingMismatchDetails extends ErrorDetails {
  readonly expectedBytes: number;
  readonly receivedBytes: number;
  readonly local?: number;
  readonly remote?: number;
}

interface HandoffDetailsByKey {
  readonly versionMismatch: HandoffVersionMismatchDetails;
  readonly invalidArtifact: HandoffInvalidArtifactDetails;
  readonly specHashMismatch: HandoffSpecHashMismatchDetails;
  readonly backingMismatch: HandoffBackingMismatchDetails;
}

const HANDOFF_DEFS = {
  versionMismatch: {
    message: "Unexpected handoff version",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  invalidArtifact: {
    message: "Unsupported handoff artifact",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  specHashMismatch: {
    message: "Spec hash mismatch",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  backingMismatch: {
    message: "Backing byteLength mismatch",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
} as const;

type HandoffDefs = typeof HANDOFF_DEFS;

export const HANDOFF: BuiltErrorDomain<"handoff", HandoffDefs> =
  buildErrorDomain("handoff", DOMAIN_IDS.handoff, HANDOFF_DEFS);

export type HandoffErrorCode = ErrorCodeOf<typeof HANDOFF>;
export type HandoffErrorKey = ErrorKeyOf<typeof HANDOFF>;
export type HandoffError = SeqlokError<HandoffErrorCode>;

export const HANDOFF_ERRORS: DomainRegistry<"handoff", HandoffDefs> =
  HANDOFF.registry;

export const createHandoffError: KeyedErrorFactoryOf<
  BuiltErrorDomain<"handoff", HandoffDefs>,
  HandoffDetailsByKey
> = HANDOFF.createError;

export type HandoffErrorFactory = typeof createHandoffError;
