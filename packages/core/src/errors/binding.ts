/**
 * @fileoverview
 * Error codes and detail types for binding-level failures.
 *
 * @remarks
 * - Covers controller/processor param validation and range violations.
 * - Includes snapshot/hydrate/stage and snapshotInto buffer mismatches.
 * - Registered into the global error registry as the `binding.*` domain.
 */

import {
  buildErrorDomain,
  DOMAIN_IDS,
  type BuiltErrorDomain,
  type DomainRegistry,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorKeyOf,
  type JsonValue,
  type KeyedErrorFactoryOf,
  type SeqlokError,
  type TypedArrayName,
} from "@seqlok/base";

/**
 * Unknown key in params/meters at the binding layer.
 *
 * @remarks
 * We model scope explicitly and require `known` keys here,
 * instead of aliasing a shared UnknownKeyDetails type.
 */
export interface BindingUnknownKeyDetails extends ErrorDetails {
  readonly scope: "params" | "meters";
  readonly key: string;
  readonly known: readonly string[];
}

/**
 * Param range details at the binding layer.
 *
 * @remarks
 * This duplicates the generic "range" vocabulary but is kept
 * local to the binding domain to avoid cross-module aliases.
 */
export interface BindingParamRangeDetails extends ErrorDetails {
  readonly key: string;
  readonly min?: number;
  readonly max?: number;
  readonly received?: number;
}

/**
 * Invalid parameter value (type/shape/etc).
 */
export interface BindingInvalidValueDetails extends ErrorDetails {
  readonly key: string;
  readonly expected?: JsonValue | undefined;
  readonly received?: JsonValue | undefined;
}

/**
 * Invalid shape for a binding (e.g. wrong array rank / element count).
 */
export interface BindingShapeDetails extends ErrorDetails {
  readonly key: string;
  readonly detail?: string;
}

/**
 * Buffer constraints for binding-level "into" operations.
 *
 * Used by snapshotInto for both type and length mismatches.
 */
export interface BindingBufferDetails extends ErrorDetails {
  readonly key: string;
  readonly expectedType: TypedArrayName;
  readonly receivedType: string;
  readonly expectedLength: number;
  readonly receivedLength: number;
}

/**
 * Snapshot → typed array mismatches at the binding layer.
 *
 * These share the same underlying shape as BindingBufferDetails but
 * keep separate type names for clarity at call sites.
 */
export type BindingSnapshotIntoTypeMismatchDetails = BindingBufferDetails;

export type BindingSnapshotIntoLengthMismatchDetails = BindingBufferDetails;

export interface BindingCoherentRetryDetails extends ErrorDetails {
  readonly retries?: number;
  readonly spins?: number;
}

/**
 * Details for snapshot/coherent retry exhaustion.
 *
 * Binding adds section information on top of generic retry metrics.
 */
export interface BindingSnapshotRetryDetails
  extends BindingCoherentRetryDetails {
  readonly section: "params" | "meters";
}

/**
 * Details for invalid arguments to bindController/bindObserver/bindProcessor.
 * @remarks
 * - `fn` is the name of the binding function.
 * - `reason` is the specific error condition.
 * - `signature` is the function signature of the binding function.
 */
export interface BindingInvalidArgsDetails extends ErrorDetails {
  readonly fn: "bindController" | "bindObserver" | "bindProcessor";
  readonly reason: "missingPlan" | "missingBacking";
  readonly signature: string;
}

interface BindingDetailsByKey {
  readonly unknownKey: BindingUnknownKeyDetails;
  readonly paramRange: BindingParamRangeDetails;
  readonly paramInvalidValue: BindingInvalidValueDetails;
  readonly invalidArgs: BindingInvalidArgsDetails;
  readonly shapeInvalid: BindingShapeDetails;
  readonly snapshotIntoTypeMismatch: BindingSnapshotIntoTypeMismatchDetails;
  readonly snapshotIntoLengthMismatch: BindingSnapshotIntoLengthMismatchDetails;
  readonly snapshotRetryExhausted: BindingSnapshotRetryDetails;
  readonly coherentRetryExhausted: BindingCoherentRetryDetails;
}

const BINDING_DEFS = {
  unknownKey: {
    message: "Unknown binding key",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  paramRange: {
    message: "Param out of range",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  paramInvalidValue: {
    message: "Param invalid value",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  shapeInvalid: {
    message: "Invalid shape",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  snapshotIntoTypeMismatch: {
    message: "Snapshot into: typed array mismatch",
    meta: { severity: "error", recoverable: true, boundarySafe: false },
  },
  snapshotIntoLengthMismatch: {
    message: "Snapshot into: length mismatch",
    meta: { severity: "error", recoverable: true, boundarySafe: false },
  },
  snapshotRetryExhausted: {
    message: "Snapshot retries exhausted",
    meta: { severity: "warning", recoverable: true, boundarySafe: false },
  },
  coherentRetryExhausted: {
    message: "Coherent retries exhausted",
    meta: { severity: "warning", recoverable: true, boundarySafe: false },
  },
  invalidArgs: {
    message: "Invalid binding arguments",
    meta: { severity: "error", recoverable: false, boundarySafe: true },
  },
} as const;

type BindingDefs = typeof BINDING_DEFS;

export const BINDING: BuiltErrorDomain<"binding", BindingDefs> =
  buildErrorDomain("binding", DOMAIN_IDS.binding, BINDING_DEFS);

export type BindingErrorCode = ErrorCodeOf<typeof BINDING>;
export type BindingErrorKey = ErrorKeyOf<typeof BINDING>;
export type BindingError = SeqlokError<BindingErrorCode>;

export const BINDING_ERRORS: DomainRegistry<"binding", BindingDefs> =
  BINDING.registry;

export const createBindingError: KeyedErrorFactoryOf<
  BuiltErrorDomain<"binding", BindingDefs>,
  BindingDetailsByKey
> = BINDING.createError;

export type BindingErrorFactory = typeof createBindingError;
