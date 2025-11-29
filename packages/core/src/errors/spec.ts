/**
 * @fileoverview
 * Error codes and detail types for spec-time validation.
 *
 * @remarks
 * - Covers invalid spec shapes, enums, ranges, and DSL misuse.
 * - Emitted by `defineSpec` / spec validators before any plan is built.
 * - Registered into the global error registry as the `spec.*` domain.
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
} from "@seqlok/base";

/**
 * Details for invalid parameter ranges.
 *
 * @remarks
 * - `reason: "inverted"` means min > max.
 * - `reason: "nan"` means one or both bounds are NaN.
 * - `reason: "infinite"` means one or both bounds are infinite.
 */
export interface SpecRangeDetails extends ErrorDetails {
  readonly key: string;
  readonly min?: number;
  readonly max?: number;
  readonly received?: number;
}

/**
 * Details for invalid enum specifications.
 */
export interface SpecEnumDetails extends ErrorDetails {
  readonly key: string;
  readonly values: readonly string[];
  readonly received?: string | number;
  readonly duplicate?: string;
  readonly invalidIndex?: number;
}

/**
 * Details for invalid array specifications.
 *
 * @remarks
 * - `reason: "nonPositive"` means length <= 0.
 * - `reason: "fractional"` means length is not an integer.
 */
export interface SpecArrayDetails extends ErrorDetails {
  readonly key: string;
  readonly length: number;
  readonly reason: "nonPositive" | "fractional";
}

/**
 * Details for duplicate keys in params or meters sections.
 */
export interface SpecDuplicateKeyDetails extends ErrorDetails {
  readonly key: string;
  readonly section: "params" | "meters";
}

/**
 * Details for high level builder failures.
 *
 * @remarks
 * `planFailed`, `alignmentFailed`, and `overflowRisk` are reserved for cases
 * where the spec is structurally valid but cannot be turned into a safe plan.
 */
export interface SpecBuilderDetails extends ErrorDetails {
  readonly key?: string;
  readonly reason?:
    | "invalidKind"
    | "missingId"
    | "emptyParams"
    | "planFailed"
    | "alignmentFailed"
    | "overflowRisk";
  readonly totalBytes?: number;
  readonly maxSafeBytes?: number;
}

interface SpecDetailsByKey {
  readonly rangeInvalid: SpecRangeDetails;
  readonly enumInvalid: SpecEnumDetails;
  readonly arrayInvalid: SpecArrayDetails;
  readonly duplicateKey: SpecDuplicateKeyDetails;
  readonly builderInvalid: SpecBuilderDetails;
}

const SPEC_DEFS = {
  rangeInvalid: {
    message: "Parameter range invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  enumInvalid: {
    message: "Enum validation failed",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  arrayInvalid: {
    message: "Array definition invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  duplicateKey: {
    message: "Duplicate key in params or meters",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  builderInvalid: {
    message: "Spec builder validation failed",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: false,
    },
  },
} as const;

type SpecDefs = typeof SPEC_DEFS;

export const SPEC: BuiltErrorDomain<"spec", SpecDefs> = buildErrorDomain(
  "spec",
  DOMAIN_IDS.spec,
  SPEC_DEFS,
);

export type SpecErrorCode = ErrorCodeOf<typeof SPEC>;
export type SpecErrorKey = ErrorKeyOf<typeof SPEC>;
export type SpecError = SeqlokError<SpecErrorCode>;

export const SPEC_ERRORS: DomainRegistry<"spec", SpecDefs> = SPEC.registry;

export const createSpecError: KeyedErrorFactoryOf<
  BuiltErrorDomain<"spec", SpecDefs>,
  SpecDetailsByKey
> = SPEC.createError;

export type SpecErrorFactory = typeof createSpecError;
