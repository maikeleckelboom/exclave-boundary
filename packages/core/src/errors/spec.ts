/**
 * Error-domain definitions for authored spec validation and semantic compilation.
 *
 * This file covers spec-time failures only. These errors are emitted before any
 * layout plan or runtime binding is built and are registered under the
 * `spec.*` domain.
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

export type SpecPlane = "params" | "meters";

/**
 * Detail payload for invalid scalar ranges.
 */
export interface SpecRangeDetails extends ErrorDetails {
  readonly key: string;
  readonly min?: number;
  readonly max?: number;
  readonly received?: number;
}

/**
 * Detail payload for invalid enum definitions.
 */
export interface SpecEnumDetails extends ErrorDetails {
  readonly key: string;
  readonly values: readonly string[];
  readonly received?: string | number;
  readonly duplicate?: string;
  readonly invalidIndex?: number;
}

/**
 * Detail payload for invalid fixed-length array definitions.
 */
export interface SpecArrayDetails extends ErrorDetails {
  readonly key: string;
  readonly length: number;
  readonly reason: "nonPositive" | "fractional";
}

/**
 * Detail payload for legacy duplicate-key reporting.
 *
 * This broad form is kept for compatibility with older callers. Newer canonical
 * key collisions should prefer the more specific semantic-compilation payloads
 * below.
 */
export interface SpecDuplicateKeyDetails extends ErrorDetails {
  readonly key: string;
  readonly section: SpecPlane;
}

/**
 * Detail payload for invalid authored namespace segments.
 */
export interface SpecInvalidSegmentDetails extends ErrorDetails {
  readonly plane: SpecPlane;
  readonly parentPath: readonly string[];
  readonly offendingSegment: string;
  readonly reason: "empty-segment" | "segment-contains-dot";
}

/**
 * Detail payload for duplicate canonical keys discovered during semantic
 * compilation.
 */
export interface SpecDuplicateCanonicalKeyDetails extends ErrorDetails {
  readonly plane: SpecPlane;
  readonly canonicalKey: string;
  readonly firstPath: readonly string[];
  readonly secondPath: readonly string[];
}

/**
 * Detail payload for leaf-versus-namespace collisions discovered during
 * semantic compilation.
 */
export interface SpecLeafNamespaceConflictDetails extends ErrorDetails {
  readonly plane: SpecPlane;
  readonly canonicalPath: string;
  readonly leafPath: readonly string[];
  readonly namespacePath: readonly string[];
  readonly conflictKind:
    | "namespace-collides-with-leaf"
    | "leaf-collides-with-namespace"
    | "ancestor-leaf-blocks-descendant";
}

/**
 * Detail payload for builder-side overflow-risk failures.
 *
 * Used when a requested array length, or a future size-derived value, exceeds
 * the allowed safety cap. The extra structure exists so logs and UIs can
 * explain both the limit and the remediation path.
 */
export interface SpecBuilderOverflowRiskDetails extends ErrorDetails {
  readonly reason: "overflowRisk";
  readonly key: string;

  readonly maxArrayLength: number;
  readonly receivedLength: number;

  /**
   * Conservative worst-case byte estimates (assumes 8 bytes/element).
   * We report worst-case because the checker may not know the element kind.
   */
  readonly bytesWorstCaseMax: number;
  readonly bytesWorstCaseReceived: number;

  /**
   * Human guidance for the fix (e.g. "use a ring/stream, not a giant spec array").
   */
  readonly hint: string;
}

/**
 * Detail payload for general builder-side validation failures.
 *
 * This stays intentionally small. Specific `builderInvalid` reasons are reused
 * across spec validation and planning entrypoints.
 */
export interface SpecBuilderGeneralDetails extends ErrorDetails {
  readonly key?: string;
  readonly reason?:
    | "invalidKind"
    | "missingId"
    | "emptyParams"
    | "missingMinMax"
    | "planFailed"
    | "alignmentFailed";
  readonly totalBytes?: number;
  readonly maxSafeBytes?: number;
}

/**
 * Union of builder-side failure payloads.
 *
 * The discriminant keeps richer failure cases strongly typed without forcing the
 * broader builder error shape to carry unrelated fields.
 */
export type SpecBuilderDetails =
  | SpecBuilderOverflowRiskDetails
  | SpecBuilderGeneralDetails;

interface SpecDetailsByKey {
  readonly rangeInvalid: SpecRangeDetails;
  readonly enumInvalid: SpecEnumDetails;
  readonly arrayInvalid: SpecArrayDetails;
  readonly duplicateKey: SpecDuplicateKeyDetails;
  readonly invalidSegment: SpecInvalidSegmentDetails;
  readonly duplicateCanonicalKey: SpecDuplicateCanonicalKeyDetails;
  readonly leafNamespaceConflict: SpecLeafNamespaceConflictDetails;
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
  invalidSegment: {
    message: "Authored namespace segment invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  duplicateCanonicalKey: {
    message: "Canonical key duplicated during spec normalization",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  leafNamespaceConflict: {
    message: "Leaf and namespace collide during spec normalization",
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
