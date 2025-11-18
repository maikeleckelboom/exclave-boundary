/**
 * Central error registry with metadata.
 * - Type-safe mapping of codes to detail shapes
 * - Metadata for telemetry, UI, and recovery
 * - Navigable via symbolic constants
 */

import {
  BACKING_ERRORS,
  type BackingErrorCode,
  type BackingIntoDetails,
  type BackingPlaneDetails,
  type BackingWasmMemoryDetails,
} from './codes/backing';
import {
  BINDING_ERRORS,
  type BindingErrorCode,
  type BindingInvalidValueDetails,
  type BindingParamRangeDetails,
  type BindingShapeDetails,
  type BindingSnapshotIntoLengthMismatchDetails,
  type BindingSnapshotIntoTypeMismatchDetails,
  type BindingUnknownKeyDetails,
} from './codes/binding';
import {
  DIAGNOSTICS_ERRORS,
  type DiagnosticsCounterDetails,
  type DiagnosticsErrorCode,
  type DiagnosticsFeatureDetails,
} from './codes/diagnostics';
import {
  ENV_ERRORS,
  type EnvErrorCode,
  type EnvCoopCoepDetails,
  type EnvUnsupportedDetails,
} from './codes/env';
import {
  HANDOFF_ERRORS,
  type HandoffBackingMismatchDetails,
  type HandoffErrorCode,
  type HandoffInvalidArtifactDetails,
  type HandoffSpecHashMismatchDetails,
  type HandoffVersionMismatchDetails,
} from './codes/handoff';
import {
  INTERNAL_ERRORS,
  type InternalAssertionDetails,
  type InternalErrorCode,
} from './codes/internal';
import {
  ORCHESTRATION_ERRORS,
  type OrchestrationDetails,
  type OrchestrationErrorCode,
} from './codes/orchestration';
import {
  PLAN_ERRORS,
  type PlanErrorCode,
  type PlanFailedDetails,
  type PlanOverflowRiskDetails,
} from './codes/plan';
import { PRIMITIVES_ERRORS, type PrimitivesErrorCode } from './codes/primitives';
import {
  SPEC_ERRORS,
  type SpecErrorCode,
  type SpecArrayDetails,
  type SpecBuilderDetails,
  type SpecDuplicateKeyDetails,
  type SpecEnumDetails,
  type SpecRangeDetails,
} from './codes/spec';

/**
 * Base details common to all errors.
 *
 * Domain detail interfaces may extend this or remain separate; this is a
 * lightweight hook for `where` / `detail` that we've found useful.
 */
export interface ErrorDetails {
  readonly where?: string;
  readonly detail?: string;
}

/**
 * Canonical set of typed-array constructor names used in buffer-related
 * error details.
 */
export type TypedArrayName =
  | 'Float32Array'
  | 'Float64Array'
  | 'Uint32Array'
  | 'Int32Array'
  | 'Uint8Array';

/**
 * Error metadata used for governance / health interpretation.
 */
export interface ErrorMeta {
  readonly severity: 'fatal' | 'error' | 'warning';
  readonly recoverable: boolean;
  readonly boundarySafe: boolean;
  readonly deprecated?: { readonly useInstead: string };
  readonly docsUrl?: string;
}

/**
 * Union of all error codes across domains.
 * Extend this as you add more descriptor modules.
 */
export type ErrorCode =
  | PrimitivesErrorCode
  | BackingErrorCode
  | SpecErrorCode
  | EnvErrorCode
  | BindingErrorCode
  | HandoffErrorCode
  | PlanErrorCode
  | OrchestrationErrorCode
  | DiagnosticsErrorCode
  | InternalErrorCode;

/**
 * Mapping from error code to its typed payload (details).
 * This is the single source of truth for code → payload associations.
 */
export interface CodeToPayload {
  // primitives.*
  'primitives.seqlockTimeout': ErrorDetails;
  'primitives.planeUnaligned': ErrorDetails;
  'primitives.atomicsFailed': ErrorDetails;
  'primitives.invalidSpinBudget': ErrorDetails;

  // internal.*
  'internal.assertionFailed': InternalAssertionDetails;
  'internal.unreachable': ErrorDetails;
  'internal.exhaustiveness': ErrorDetails;

  // backing.*
  'backing.allocFailed': BackingPlaneDetails;
  'backing.allocUndersized': BackingPlaneDetails;
  'backing.wasmMemoryNotShared': BackingWasmMemoryDetails;
  'backing.intoTypeMismatch': BackingIntoDetails;
  'backing.intoLengthMismatch': BackingIntoDetails;

  // spec.*
  'spec.rangeInvalid': SpecRangeDetails;
  'spec.enumInvalid': SpecEnumDetails;
  'spec.arrayInvalid': SpecArrayDetails;
  'spec.duplicateKey': SpecDuplicateKeyDetails;
  'spec.builderInvalid': SpecBuilderDetails;

  // env.*
  'env.unsupported': EnvUnsupportedDetails;
  'env.coopCoepRequired': EnvCoopCoepDetails;

  // binding.*
  'binding.unknownKey': BindingUnknownKeyDetails;
  'binding.paramRange': BindingParamRangeDetails;
  'binding.paramInvalidValue': BindingInvalidValueDetails;
  'binding.shapeInvalid': BindingShapeDetails;
  'binding.snapshotIntoTypeMismatch': BindingSnapshotIntoTypeMismatchDetails;
  'binding.snapshotIntoLengthMismatch': BindingSnapshotIntoLengthMismatchDetails;
  'binding.snapshotRetryExhausted': ErrorDetails;
  'binding.coherentRetryExhausted': ErrorDetails;

  // handoff.*
  'handoff.versionMismatch': HandoffVersionMismatchDetails;
  'handoff.invalidArtifact': HandoffInvalidArtifactDetails;
  'handoff.specHashMismatch': HandoffSpecHashMismatchDetails;
  'handoff.backingMismatch': HandoffBackingMismatchDetails;

  // plan.*
  'plan.failed': PlanFailedDetails;
  'plan.overflowRisk': PlanOverflowRiskDetails;

  // orchestration.*
  'orchestration.createFailed': OrchestrationDetails;

  // diagnostics.*
  'diagnostics.counterInvalid': DiagnosticsCounterDetails;
  'diagnostics.featureInvalid': DiagnosticsFeatureDetails;
}

/**
 * Get typed payload for error code.
 */
export type ErrorPayload<C extends ErrorCode> = CodeToPayload[C];

/**
 * Flattened metadata map (simple object literal, no expensive operations).
 * TypeScript will scream if you forget any ErrorCode here.
 */
const RAW_META = {
  // internal.*
  [INTERNAL_ERRORS.assertionFailed.code]: INTERNAL_ERRORS.assertionFailed.meta,
  [INTERNAL_ERRORS.unreachable.code]: INTERNAL_ERRORS.unreachable.meta,
  [INTERNAL_ERRORS.exhaustiveness.code]: INTERNAL_ERRORS.exhaustiveness.meta,

  // primitive.*
  [PRIMITIVES_ERRORS.seqlockTimeout.code]: PRIMITIVES_ERRORS.seqlockTimeout.meta,
  [PRIMITIVES_ERRORS.planeUnaligned.code]: PRIMITIVES_ERRORS.planeUnaligned.meta,
  [PRIMITIVES_ERRORS.atomicsFailed.code]: PRIMITIVES_ERRORS.atomicsFailed.meta,
  [PRIMITIVES_ERRORS.invalidSpinBudget.code]: PRIMITIVES_ERRORS.invalidSpinBudget.meta,

  // backing.*
  [BACKING_ERRORS.allocFailed.code]: BACKING_ERRORS.allocFailed.meta,
  [BACKING_ERRORS.allocUndersized.code]: BACKING_ERRORS.allocUndersized.meta,
  [BACKING_ERRORS.wasmMemoryNotShared.code]: BACKING_ERRORS.wasmMemoryNotShared.meta,
  [BACKING_ERRORS.intoTypeMismatch.code]: BACKING_ERRORS.intoTypeMismatch.meta,
  [BACKING_ERRORS.intoLengthMismatch.code]: BACKING_ERRORS.intoLengthMismatch.meta,

  // spec.*
  [SPEC_ERRORS.rangeInvalid.code]: SPEC_ERRORS.rangeInvalid.meta,
  [SPEC_ERRORS.enumInvalid.code]: SPEC_ERRORS.enumInvalid.meta,
  [SPEC_ERRORS.arrayInvalid.code]: SPEC_ERRORS.arrayInvalid.meta,
  [SPEC_ERRORS.duplicateKey.code]: SPEC_ERRORS.duplicateKey.meta,
  [SPEC_ERRORS.builderInvalid.code]: SPEC_ERRORS.builderInvalid.meta,

  // env.*
  [ENV_ERRORS.unsupported.code]: ENV_ERRORS.unsupported.meta,
  [ENV_ERRORS.coopCoepRequired.code]: ENV_ERRORS.coopCoepRequired.meta,

  // binding.*
  [BINDING_ERRORS.unknownKey.code]: BINDING_ERRORS.unknownKey.meta,
  [BINDING_ERRORS.paramRange.code]: BINDING_ERRORS.paramRange.meta,
  [BINDING_ERRORS.paramInvalidValue.code]: BINDING_ERRORS.paramInvalidValue.meta,
  [BINDING_ERRORS.shapeInvalid.code]: BINDING_ERRORS.shapeInvalid.meta,
  [BINDING_ERRORS.snapshotIntoTypeMismatch.code]:
    BINDING_ERRORS.snapshotIntoTypeMismatch.meta,
  [BINDING_ERRORS.snapshotIntoLengthMismatch.code]:
    BINDING_ERRORS.snapshotIntoLengthMismatch.meta,
  [BINDING_ERRORS.snapshotRetryExhausted.code]:
    BINDING_ERRORS.snapshotRetryExhausted.meta,
  [BINDING_ERRORS.coherentRetryExhausted.code]:
    BINDING_ERRORS.coherentRetryExhausted.meta,

  // handoff.*
  [HANDOFF_ERRORS.invalidArtifact.code]: HANDOFF_ERRORS.invalidArtifact.meta,
  [HANDOFF_ERRORS.versionMismatch.code]: HANDOFF_ERRORS.versionMismatch.meta,
  [HANDOFF_ERRORS.specHashMismatch.code]: HANDOFF_ERRORS.specHashMismatch.meta,
  [HANDOFF_ERRORS.backingMismatch.code]: HANDOFF_ERRORS.backingMismatch.meta,

  // plan.*
  [PLAN_ERRORS.failed.code]: PLAN_ERRORS.failed.meta,
  [PLAN_ERRORS.overflowRisk.code]: PLAN_ERRORS.overflowRisk.meta,

  // orchestration.*
  [ORCHESTRATION_ERRORS.createFailed.code]: ORCHESTRATION_ERRORS.createFailed.meta,

  // diagnostics.*
  [DIAGNOSTICS_ERRORS.counterInvalid.code]: DIAGNOSTICS_ERRORS.counterInvalid.meta,
  [DIAGNOSTICS_ERRORS.featureInvalid.code]: DIAGNOSTICS_ERRORS.featureInvalid.meta,
} as const;

/**
 * Flattened message map.
 */
const RAW_MESSAGES = {
  // internal.*
  [INTERNAL_ERRORS.assertionFailed.code]: INTERNAL_ERRORS.assertionFailed.message,
  [INTERNAL_ERRORS.unreachable.code]: INTERNAL_ERRORS.unreachable.message,
  [INTERNAL_ERRORS.exhaustiveness.code]: INTERNAL_ERRORS.exhaustiveness.message,

  // primitives.*
  [PRIMITIVES_ERRORS.seqlockTimeout.code]: PRIMITIVES_ERRORS.seqlockTimeout.message,
  [PRIMITIVES_ERRORS.planeUnaligned.code]: PRIMITIVES_ERRORS.planeUnaligned.message,
  [PRIMITIVES_ERRORS.atomicsFailed.code]: PRIMITIVES_ERRORS.atomicsFailed.message,
  [PRIMITIVES_ERRORS.invalidSpinBudget.code]: PRIMITIVES_ERRORS.invalidSpinBudget.message,
  // backing.*
  [BACKING_ERRORS.allocFailed.code]: BACKING_ERRORS.allocFailed.message,
  [BACKING_ERRORS.allocUndersized.code]: BACKING_ERRORS.allocUndersized.message,
  [BACKING_ERRORS.wasmMemoryNotShared.code]: BACKING_ERRORS.wasmMemoryNotShared.message,
  [BACKING_ERRORS.intoTypeMismatch.code]: BACKING_ERRORS.intoTypeMismatch.message,
  [BACKING_ERRORS.intoLengthMismatch.code]: BACKING_ERRORS.intoLengthMismatch.message,

  // spec.*
  [SPEC_ERRORS.rangeInvalid.code]: SPEC_ERRORS.rangeInvalid.message,
  [SPEC_ERRORS.enumInvalid.code]: SPEC_ERRORS.enumInvalid.message,
  [SPEC_ERRORS.arrayInvalid.code]: SPEC_ERRORS.arrayInvalid.message,
  [SPEC_ERRORS.duplicateKey.code]: SPEC_ERRORS.duplicateKey.message,
  [SPEC_ERRORS.builderInvalid.code]: SPEC_ERRORS.builderInvalid.message,

  // env.*
  [ENV_ERRORS.unsupported.code]: ENV_ERRORS.unsupported.message,
  [ENV_ERRORS.coopCoepRequired.code]: ENV_ERRORS.coopCoepRequired.message,

  // binding.*
  [BINDING_ERRORS.unknownKey.code]: BINDING_ERRORS.unknownKey.message,
  [BINDING_ERRORS.paramRange.code]: BINDING_ERRORS.paramRange.message,
  [BINDING_ERRORS.paramInvalidValue.code]: BINDING_ERRORS.paramInvalidValue.message,
  [BINDING_ERRORS.shapeInvalid.code]: BINDING_ERRORS.shapeInvalid.message,
  [BINDING_ERRORS.snapshotIntoTypeMismatch.code]:
    BINDING_ERRORS.snapshotIntoTypeMismatch.message,
  [BINDING_ERRORS.snapshotIntoLengthMismatch.code]:
    BINDING_ERRORS.snapshotIntoLengthMismatch.message,
  [BINDING_ERRORS.snapshotRetryExhausted.code]:
    BINDING_ERRORS.snapshotRetryExhausted.message,
  [BINDING_ERRORS.coherentRetryExhausted.code]:
    BINDING_ERRORS.coherentRetryExhausted.message,
  // handoff.*
  [HANDOFF_ERRORS.invalidArtifact.code]: HANDOFF_ERRORS.invalidArtifact.message,
  [HANDOFF_ERRORS.versionMismatch.code]: HANDOFF_ERRORS.versionMismatch.message,
  [HANDOFF_ERRORS.specHashMismatch.code]: HANDOFF_ERRORS.specHashMismatch.message,
  [HANDOFF_ERRORS.backingMismatch.code]: HANDOFF_ERRORS.backingMismatch.message,

  // plan.*
  [PLAN_ERRORS.failed.code]: PLAN_ERRORS.failed.message,
  [PLAN_ERRORS.overflowRisk.code]: PLAN_ERRORS.overflowRisk.message,

  // orchestration.*
  [ORCHESTRATION_ERRORS.createFailed.code]: ORCHESTRATION_ERRORS.createFailed.message,

  // diagnostics.*
  [DIAGNOSTICS_ERRORS.counterInvalid.code]: DIAGNOSTICS_ERRORS.counterInvalid.message,
  [DIAGNOSTICS_ERRORS.featureInvalid.code]: DIAGNOSTICS_ERRORS.featureInvalid.message,
} as const;

/**
 * Public metadata map (readonly wrapper).
 */
export const ERROR_META: Readonly<Record<ErrorCode, ErrorMeta>> = RAW_META;

/**
 * Public message map (readonly wrapper).
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = RAW_MESSAGES;

/**
 * Get static message for error code.
 */
export function getErrorMessage(code: ErrorCode): string {
  return RAW_MESSAGES[code];
}

/**
 * Get metadata for error code.
 */
export function getErrorMeta(code: ErrorCode): ErrorMeta {
  return RAW_META[code];
}

/**
 * Check if string is a valid error code.
 */
export function isErrorCode(code: string): code is ErrorCode {
  return code in RAW_MESSAGES;
}
