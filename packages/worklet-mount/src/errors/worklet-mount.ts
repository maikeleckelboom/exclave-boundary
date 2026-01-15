/**
 * @fileoverview
 * Error codes, detail types, and factory for the `workletMount.*` domain.
 *
 * @remarks
 * This domain covers:
 * - Host-side mounting (fetching wrapper/wasm and basic validation)
 * - Worklet-side mount lifecycle (busy / invalid messages / invalid bytes)
 * - Factory resolution (bundled registry-first vs dynamic wrapper backend)
 * - Runtime invariants (RT allocation forbidden, faulted processor)
 *
 * Numeric codes are assigned by @seqlok/introspect via stable key order.
 */

import {
  type AssertTrue,
  defineErrorDomain,
  type DomainDef,
  type DomainRegistry,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorDomainWithFactory,
  type ErrorKeyFromCode,
  type ErrorKeyOf,
  type IsExact,
  type KeyedErrorFactoryOf,
} from "@seqlok/base";

export type WorkletMountPhase = "loading" | "rt";

/**
 * JSON-serializable value type for error details which must cross `postMessage`.
 *
 * @remarks
 * This is deliberately strict: no `undefined`, no functions, no class instances.
 *
 * TypeScript forbids recursive type-aliases under some configurations, so the
 * recursive pieces are expressed as interfaces.
 */
export type WorkletMountJsonPrimitive = string | number | boolean | null;

export interface WorkletMountJsonObject {
  readonly [key: string]: WorkletMountJsonValue;
}

export type WorkletMountJsonArray = readonly WorkletMountJsonValue[];

export type WorkletMountJsonValue =
  | WorkletMountJsonPrimitive
  | WorkletMountJsonObject
  | WorkletMountJsonArray;

/**
 * Worklet mount error codes.
 *
 * @remarks
 * These codes are stable and safe to persist in logs and diagnostics.
 */
export type WorkletMountErrorCode = ErrorCodeOf<WorkletMountDomain>;

/**
 * Symbolic keys for worklet mount error descriptors.
 *
 * @remarks
 * Derived from fully-qualified codes by dropping the `workletMount.` prefix.
 */
export type WorkletMountErrorKey = ErrorKeyFromCode<WorkletMountErrorCode>;

/**
 * Details for `workletMount.busyLoading`.
 *
 * @remarks
 * A mount request arrived while a prior mount is still in flight.
 */
export interface WorkletMountBusyLoadingDetails extends ErrorDetails {
  readonly requestedKey: string;
  readonly requestedSeq: number;
  readonly currentKey?: string;
  readonly currentSeq?: number;
}

/**
 * Details for `workletMount.invalidMountMessage`.
 *
 * @remarks
 * The worklet received a message that is not a valid `wm:*` mount message.
 */
export interface WorkletMountInvalidMountMessageDetails extends ErrorDetails {
  readonly reason: string;
  readonly receivedType?: string;
  readonly receivedKeys?: readonly string[];
}

/**
 * Details for `workletMount.emptyKey`.
 */
export interface WorkletMountEmptyKeyDetails extends ErrorDetails {
  /**
   * Operation context.
   *
   * @example "mountWorkletOnPort", "toMountMessage"
   */
  readonly op: string;
}

/**
 * Details for `workletMount.invalidWasmBytes`.
 */
export interface WorkletMountInvalidWasmBytesDetails extends ErrorDetails {
  readonly op: string;
  readonly receivedKind: string;
  readonly byteLength?: number;
}

/**
 * Details for `workletMount.fetchFailed`.
 *
 * @remarks
 * Host-side: wrapper/wasm fetch failed with a non-OK status.
 */
export interface WorkletMountFetchFailedDetails extends ErrorDetails {
  readonly resource: "wrapper" | "wasm";
  readonly url: string;
  readonly status: number;
}

/**
 * Details for `workletMount.wrapperReturnedHtml`.
 *
 * @remarks
 * Host-side: wrapperUrl returned HTML (often a dev server 404 page).
 */
export interface WorkletMountWrapperReturnedHtmlDetails extends ErrorDetails {
  readonly url: string;
}

/**
 * Details for `workletMount.bundledFactoryNotFound`.
 *
 * @remarks
 * Worklet-side: registry-first path could not find a bundled factory for `key`.
 */
export interface WorkletMountBundledFactoryNotFoundDetails
  extends ErrorDetails {
  readonly key: string;
  readonly registeredKeys: readonly string[];
}

/**
 * Details for `workletMount.dynamicWrapperEvalFailed`.
 */
export interface WorkletMountDynamicWrapperEvalFailedDetails
  extends ErrorDetails {
  readonly key: string;
  readonly seq: number;
  readonly stage: "compile" | "execute" | "resolveFactory";
  readonly errorMessage: string;
}

/**
 * Details for `workletMount.dynamicWrapperNoFactory`.
 */
export interface WorkletMountDynamicWrapperNoFactoryDetails
  extends ErrorDetails {
  readonly key: string;
  readonly seq: number;
  readonly reason: string;
}

/**
 * Details for `workletMount.workletError`.
 *
 * @remarks
 * Host-side: the worklet responded with `wm:error`.
 */
export interface WorkletMountWorkletErrorDetails extends ErrorDetails {
  readonly key: string;
  readonly seq: number;

  /**
   * Phase observed in the worklet when the error occurred.
   */
  readonly phase: WorkletMountPhase;

  /**
   * Human-friendly error message forwarded from the worklet.
   */
  readonly message: string;

  /**
   * Optional domain error code forwarded from the worklet.
   */
  readonly workletCode?: WorkletMountErrorCode;

  /**
   * Optional structured, JSON-serializable details forwarded from the worklet.
   */
  readonly workletDetails?: WorkletMountJsonObject;
}

/**
 * Details for `workletMount.runtimeFaulted`.
 *
 * @remarks
 * Worklet-side: the processor has faulted and will no longer run normally.
 */
export interface WorkletMountRuntimeFaultedDetails extends ErrorDetails {
  readonly key: string;
  readonly seq: number;
  readonly phase: WorkletMountPhase;
  readonly errorMessage: string;
}

/**
 * Details for `workletMount.rtAllocationForbidden`.
 *
 * @remarks
 * Worklet-side invariant: allocating/freeing memory on the realtime path is forbidden.
 */
export interface WorkletMountRtAllocationForbiddenDetails extends ErrorDetails {
  readonly op: "malloc" | "free";
  readonly phase: WorkletMountPhase;
  readonly key?: string;
}

/**
 * Details for `workletMount.moduleNotAvailable`.
 */
export interface WorkletMountModuleNotAvailableDetails extends ErrorDetails {
  readonly op: "malloc" | "free" | "process";
}

/**
 * Details for `workletMount.moduleNotReady`.
 */
export interface WorkletMountModuleNotReadyDetails extends ErrorDetails {
  readonly op: "malloc" | "free" | "process";
  readonly state: "idle" | "loading" | "ready" | "faulted";
}

/**
 * Domain-local defs object used with `defineErrorDomain`.
 *
 * @remarks
 * This is the single source of truth for message + meta; fully-qualified
 * codes are derived as `${prefix}.${key}` by the helper.
 */
interface WorkletMountDomainDefs {
  readonly busyLoading: DomainDef;
  readonly invalidMountMessage: DomainDef;
  readonly emptyKey: DomainDef;
  readonly invalidWasmBytes: DomainDef;
  readonly fetchFailed: DomainDef;
  readonly wrapperReturnedHtml: DomainDef;
  readonly bundledFactoryNotFound: DomainDef;
  readonly dynamicWrapperEvalFailed: DomainDef;
  readonly dynamicWrapperNoFactory: DomainDef;
  readonly workletError: DomainDef;
  readonly runtimeFaulted: DomainDef;
  readonly rtAllocationForbidden: DomainDef;
  readonly moduleNotAvailable: DomainDef;
  readonly moduleNotReady: DomainDef;
}

const WORKLET_MOUNT_DEFS: WorkletMountDomainDefs = {
  busyLoading: {
    message: "Worklet mount is busy: already loading",
    meta: { severity: "warning", recoverable: true, boundarySafe: true },
  },
  invalidMountMessage: {
    message: "Invalid worklet mount message",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  emptyKey: {
    message: "Worklet key is empty",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  invalidWasmBytes: {
    message: "Invalid wasm bytes",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  fetchFailed: {
    message: "Failed to fetch worklet resource",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  wrapperReturnedHtml: {
    message: "Wrapper URL returned HTML (check path)",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  bundledFactoryNotFound: {
    message: "Bundled factory not found for key",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  dynamicWrapperEvalFailed: {
    message: "Dynamic wrapper evaluation failed",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  dynamicWrapperNoFactory: {
    message: "Dynamic wrapper did not yield a factory",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  workletError: {
    message: "Worklet returned an error",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  runtimeFaulted: {
    message: "Worklet runtime faulted",
    meta: { severity: "fatal", recoverable: false, boundarySafe: false },
  },
  rtAllocationForbidden: {
    message: "RT allocation forbidden",
    meta: { severity: "fatal", recoverable: false, boundarySafe: false },
  },
  moduleNotAvailable: {
    message: "Module not available",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  moduleNotReady: {
    message: "Module not ready",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
};

/**
 * Logical worklet mount domain, including registry and factory.
 */
export const WORKLET_MOUNT_DOMAIN: ErrorDomainWithFactory<
  "workletMount",
  WorkletMountDomainDefs
> = defineErrorDomain("workletMount", WORKLET_MOUNT_DEFS);

/**
 * Convenience alias for the domain type.
 */
export type WorkletMountDomain = typeof WORKLET_MOUNT_DOMAIN;

/**
 * Registry type for the worklet mount domain.
 */
export type WorkletMountErrorsMap = DomainRegistry<
  "workletMount",
  WorkletMountDomainDefs
>;

/**
 * Exported descriptor map with an explicit type for isolatedDeclarations.
 */
export const WORKLET_MOUNT_ERRORS: WorkletMountErrorsMap =
  WORKLET_MOUNT_DOMAIN.registry;

/**
 * Expected fully-qualified code union.
 *
 * @remarks
 * This is a sanity check. Update additively when adding new keys.
 */
type ExpectedWorkletMountErrorCode =
  | "workletMount.busyLoading"
  | "workletMount.invalidMountMessage"
  | "workletMount.emptyKey"
  | "workletMount.invalidWasmBytes"
  | "workletMount.fetchFailed"
  | "workletMount.wrapperReturnedHtml"
  | "workletMount.bundledFactoryNotFound"
  | "workletMount.dynamicWrapperEvalFailed"
  | "workletMount.dynamicWrapperNoFactory"
  | "workletMount.workletError"
  | "workletMount.runtimeFaulted"
  | "workletMount.rtAllocationForbidden"
  | "workletMount.moduleNotAvailable"
  | "workletMount.moduleNotReady";

/** @internal */
export type _WorkletMountCodesMatch = AssertTrue<
  IsExact<WorkletMountErrorCode, ExpectedWorkletMountErrorCode>
>;

/**
 * Per-key details mapping for worklet mount errors.
 */
export interface WorkletMountErrorDetailsByKey {
  readonly busyLoading: WorkletMountBusyLoadingDetails;
  readonly invalidMountMessage: WorkletMountInvalidMountMessageDetails;
  readonly emptyKey: WorkletMountEmptyKeyDetails;
  readonly invalidWasmBytes: WorkletMountInvalidWasmBytesDetails;
  readonly fetchFailed: WorkletMountFetchFailedDetails;
  readonly wrapperReturnedHtml: WorkletMountWrapperReturnedHtmlDetails;
  readonly bundledFactoryNotFound: WorkletMountBundledFactoryNotFoundDetails;
  readonly dynamicWrapperEvalFailed: WorkletMountDynamicWrapperEvalFailedDetails;
  readonly dynamicWrapperNoFactory: WorkletMountDynamicWrapperNoFactoryDetails;
  readonly workletError: WorkletMountWorkletErrorDetails;
  readonly runtimeFaulted: WorkletMountRuntimeFaultedDetails;
  readonly rtAllocationForbidden: WorkletMountRtAllocationForbiddenDetails;
  readonly moduleNotAvailable: WorkletMountModuleNotAvailableDetails;
  readonly moduleNotReady: WorkletMountModuleNotReadyDetails;
}

export function isWorkletMountPhase(v: unknown): v is WorkletMountPhase {
  return v === "loading" || v === "rt";
}

export function isWorkletMountErrorCode(
  v: unknown,
): v is WorkletMountErrorCode {
  if (typeof v !== "string") {
    return false;
  }

  const prefix = "workletMount.";
  if (!v.startsWith(prefix)) {
    return false;
  }

  const localKey = v.slice(prefix.length);

  return Object.prototype.hasOwnProperty.call(WORKLET_MOUNT_ERRORS, localKey);
}

/**
 * Compile-time check: detail mapping keys match the domain's local keys.
 * @internal
 */
export type _WorkletMountDetailKeysMatch = AssertTrue<
  IsExact<keyof WorkletMountErrorDetailsByKey, ErrorKeyOf<WorkletMountDomain>>
>;

/**
 * Domain-local factory type for disclosed `workletMount.*` errors.
 */
export type WorkletMountErrorFactory = KeyedErrorFactoryOf<
  WorkletMountDomain,
  WorkletMountErrorDetailsByKey
>;

/**
 * Domain-local factory for creating `workletMount.*` errors.
 */
export const createWorkletMountError: WorkletMountErrorFactory = (
  key,
  details,
  cause,
) => WORKLET_MOUNT_DOMAIN.createError(key, details, cause);

/**
 * Sanity check: explicit `WorkletMountErrorKey` matches the domain keys.
 */
type DomainKeys = ErrorKeyOf<WorkletMountDomain>;
type KeysEqual = IsExact<WorkletMountErrorKey, DomainKeys>;
/** @internal */
export type _WorkletMountKeysMatch = AssertTrue<KeysEqual>;
