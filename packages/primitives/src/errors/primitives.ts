/**
 * @fileoverview
 * Error codes, detail types, and factory for the `primitives.*` domain.
 *
 * @remarks
 * - Uses `defineErrorDomain` from @seqlok/base so code/message/meta live in a
 *   single definitions object.
 * - Still exposes a key-aware factory (`createPrimitivesError`) so each code
 *   enforces its own detail payload.
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

/**
 * Primitives error codes.
 *
 * @remarks
 * These codes are stable and safe to persist in logs and diagnostics.
 * They are derived from the domain definition via `defineErrorDomain`.
 */
export type PrimitivesErrorCode = ErrorCodeOf<PrimitivesDomain>;

/**
 * Symbolic keys for primitives error descriptors.
 *
 * @remarks
 * Derived from fully-qualified codes by dropping the `primitives.` prefix.
 */
export type PrimitivesErrorKey = ErrorKeyFromCode<PrimitivesErrorCode>;

/**
 * Details for seqlock timeout diagnostics.
 */
export interface PrimitivesSeqlockTimeoutDetails extends ErrorDetails {
  readonly where: string;
  readonly detail: string;
  readonly spinBudget: number;
  readonly actualSpins: number;
  readonly retryBudget: number;
  readonly retriesUsed: number;
  readonly lockIndex: number;
  readonly seqIndex: number;
}

/**
 * Details for invalid SWSR layout.
 *
 * @remarks
 * Used when capacity/wordsPerSlot are rejected at allocation time.
 */
export interface PrimitivesSwsrRingInvalidLayoutDetails extends ErrorDetails {
  readonly capacity: number;
  readonly wordsPerSlot: number;
}

/**
 * Details for plane alignment failures.
 *
 * @remarks
 * Used when a plane's offset is not aligned to its element size.
 */
export interface PrimitivesPlaneUnalignedDetails extends ErrorDetails {
  readonly where: string;
  readonly detail: string;
  readonly plane: string;
  readonly offsetBytes: number;
  readonly bytesPerElement: number;
}

/**
 * Details for Atomics-related failures.
 *
 * @remarks
 * Used by thin wrappers around Atomics to surface structured diagnostics.
 */
export interface PrimitivesAtomicsFailedDetails extends ErrorDetails {
  readonly where: string;
  readonly detail: string;
  readonly operation: "loadU32" | "addU32";
  readonly index: number;
  readonly length: number;
  readonly delta?: number | undefined;
}

/**
 * Details for invalid spin/retry budget configuration.
 *
 * @remarks
 * Used when `tryRead` receives non-integer or negative budgets.
 */
export interface PrimitivesInvalidSpinBudgetDetails extends ErrorDetails {
  readonly where: string;
  readonly detail: string;
  readonly spinBudget: number;
  readonly retryBudget: number;
}

/**
 * Domain-local defs object used with `defineErrorDomain`.
 *
 * @remarks
 * This is the single source of truth for message + meta; fully-qualified
 * codes are derived as `${prefix}.${key}` by the helper.
 */
interface PrimitivesDomainDefs {
  readonly seqlockTimeout: DomainDef;
  readonly planeUnaligned: DomainDef;
  readonly atomicsFailed: DomainDef;
  readonly invalidSpinBudget: DomainDef;
  readonly swsrRingInvalidLayout: DomainDef;
}

const PRIMITIVES_DEFS: PrimitivesDomainDefs = {
  seqlockTimeout: {
    message: "Seqlock acquisition timeout",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  planeUnaligned: {
    message: "Plane offset not aligned to element size",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  atomicsFailed: {
    message: "Atomics operation failed",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    },
  },
  invalidSpinBudget: {
    message: "Spin budget must be non-negative integer",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  swsrRingInvalidLayout: {
    message: "SWSR ring layout is invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
};

/**
 * Logical primitives error domain, including registry and factory.
 */
export const PRIMITIVES_DOMAIN: ErrorDomainWithFactory<
  "primitives",
  PrimitivesDomainDefs
> = defineErrorDomain("primitives", PRIMITIVES_DEFS);

/**
 * Convenience alias for the domain type.
 */
export type PrimitivesDomain = typeof PRIMITIVES_DOMAIN;

/**
 * Registry type for the primitives domain.
 *
 * @remarks
 * This stays compatible with the previous `PrimitivesErrorsMap` shape and is
 * what domain descriptors (`domains.ts`) consume.
 */
export type PrimitivesErrorsMap = DomainRegistry<
  "primitives",
  PrimitivesDomainDefs
>;

/**
 * Exported descriptor map with an explicit type for isolatedDeclarations.
 */
export const PRIMITIVES_ERRORS: PrimitivesErrorsMap =
  PRIMITIVES_DOMAIN.registry as PrimitivesErrorsMap;

/**
 * Compile-time check: codes derived from the domain defs match the expected
 * string literal union.
 */
type ExpectedPrimitivesErrorCode =
  | "primitives.seqlockTimeout"
  | "primitives.planeUnaligned"
  | "primitives.atomicsFailed"
  | "primitives.invalidSpinBudget"
  | "primitives.swsrRingInvalidLayout";

/** @internal */
export type _PrimitivesCodesMatch = AssertTrue<
  IsExact<PrimitivesErrorCode, ExpectedPrimitivesErrorCode>
>;

/**
 * Per-key details mapping for primitives errors.
 *
 * @remarks
 * Used to drive a key-aware factory so that each error code enforces
 * the appropriate details payload at call sites.
 */
export interface PrimitivesErrorDetailsByKey {
  readonly seqlockTimeout: PrimitivesSeqlockTimeoutDetails;
  readonly planeUnaligned: PrimitivesPlaneUnalignedDetails;
  readonly atomicsFailed: PrimitivesAtomicsFailedDetails;
  readonly invalidSpinBudget: PrimitivesInvalidSpinBudgetDetails;
  readonly swsrRingInvalidLayout: PrimitivesSwsrRingInvalidLayoutDetails;
}

/**
 * Compile-time check: detail mapping keys match the domain's local keys.
 * @internal
 */
export type _PrimitivesDetailKeysMatch = AssertTrue<
  IsExact<keyof PrimitivesErrorDetailsByKey, ErrorKeyOf<PrimitivesDomain>>
>;

/**
 * Domain-local factory type for `primitives.*` errors.
 *
 * @remarks
 * Built on top of the generic domain factory, but specializes `details`
 * per key via `PrimitivesErrorDetailsByKey`.
 */
export type PrimitivesErrorFactory = KeyedErrorFactoryOf<
  PrimitivesDomain,
  PrimitivesErrorDetailsByKey
>;

/**
 * Domain-local factory for creating `primitives.*` errors.
 *
 * @remarks
 * Runtime shape is the same as before; call sites still do:
 *
 *   throw createPrimitivesError("atomicsFailed", details, cause);
 */
export const createPrimitivesError: PrimitivesErrorFactory = (
  key,
  details,
  cause,
) => PRIMITIVES_DOMAIN.createError(key, details, cause);

/**
 * Sanity check: explicit `PrimitivesErrorKey` type matches the domain keys.
 */
type DomainKeys = ErrorKeyOf<PrimitivesDomain>;
type KeysEqual = IsExact<PrimitivesErrorKey, DomainKeys>;
/** @internal */
export type _PrimitivesKeysMatch = AssertTrue<KeysEqual>;
