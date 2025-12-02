/**
 * @fileoverview
 * Error codes and detail types for backing/memory operations.
 */

import {
  buildErrorDomain,
  type BuiltErrorDomain,
  DOMAIN_IDS,
  type DomainRegistry,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorKeyOf,
  type KeyedErrorFactoryOf,
  type SeqlokError,
  type TypedArrayName,
} from "@seqlok/base";

export interface BackingPlaneDetails extends ErrorDetails {
  readonly plane: string;
  readonly requestedBytes: number;
  readonly allocatedBytes: number;
}

export interface BackingWasmMemoryDetails extends ErrorDetails {
  readonly plane: "wasm";
  readonly requestedPages?: number;
  readonly allocatedPages?: number;
}

export interface BackingIntoTypeMismatchDetails extends ErrorDetails {
  readonly key: string;
  readonly expectedType: TypedArrayName;
  readonly receivedType: string;
}

export interface BackingIntoLengthMismatchDetails extends ErrorDetails {
  readonly key: string;
  readonly expectedLength: number;
  readonly receivedLength: number;
}

interface BackingDetailsByKey {
  readonly allocFailed: BackingPlaneDetails;
  readonly allocUndersized: BackingPlaneDetails;
  readonly wasmMemoryNotShared: BackingWasmMemoryDetails;
  readonly intoTypeMismatch: BackingIntoTypeMismatchDetails;
  readonly intoLengthMismatch: BackingIntoLengthMismatchDetails;
}

const BACKING_DEFS = {
  allocFailed: {
    message: "Backing allocation failed",
    meta: { severity: "fatal", recoverable: true, boundarySafe: true },
  },
  allocUndersized: {
    message: "Backing undersized for requested plan",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  wasmMemoryNotShared: {
    message: "WebAssembly.Memory is not shared",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  intoTypeMismatch: {
    message: "Into buffer typed array constructor mismatch",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  intoLengthMismatch: {
    message: "Into buffer length mismatch",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
} as const;

type BackingDefs = typeof BACKING_DEFS;

export const BACKING: BuiltErrorDomain<"backing", BackingDefs> =
  buildErrorDomain("backing", DOMAIN_IDS.backing, BACKING_DEFS);

export type BackingErrorCode = ErrorCodeOf<typeof BACKING>;
export type BackingErrorKey = ErrorKeyOf<typeof BACKING>;
export type BackingError = SeqlokError<BackingErrorCode>;

export const BACKING_ERRORS: DomainRegistry<"backing", BackingDefs> =
  BACKING.registry;

export const createBackingError: KeyedErrorFactoryOf<
  BuiltErrorDomain<"backing", BackingDefs>,
  BackingDetailsByKey
> = BACKING.createError;

export type BackingErrorFactory = typeof createBackingError;
