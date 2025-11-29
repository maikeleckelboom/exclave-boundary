/**
 * @fileoverview
 * Error codes and detail types for introspect and introspection.
 *
 * @remarks
 * - Covers invalid counters/metrics and unknown introspect features.
 * - Intended for debug/observability paths, not normal API misuse.
 * - Registered into the global error registry as the `introspect.*` domain.
 */

import {
  defineErrorDomain,
  type DomainDef,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorDomainWithFactory,
  type ErrorFactoryOf,
  type ErrorMeta,
  type SeqlokError,
} from "@seqlok/base";

/**
 * Details for `introspect.counterInvalid`.
 *
 * @remarks
 * Used when an introspect counter or budget value is not sane:
 * - NaN or Infinity
 * - negative
 * - exceeds a soft "this is probably a bug" threshold
 */
export interface IntrospectCounterDetails extends ErrorDetails {
  readonly name: string;
  readonly value: number;
}

/**
 * Details for `introspect.featureInvalid`.
 *
 * @remarks
 * Used when an introspect feature flag is unknown or unsupported.
 */
export interface IntrospectFeatureDetails extends ErrorDetails {
  readonly feature: string;
  readonly detail?: string;
}

interface IntrospectDefs {
  readonly counterInvalid: DomainDef;
  readonly featureInvalid: DomainDef;
}

/**
 * Local domain definitions: keys → message/meta.
 *
 * Codes are derived as `introspect.${key}` by the base helper.
 */
const INTROSPECT_DEFS: IntrospectDefs = {
  counterInvalid: {
    message: "Introspect counter invalid",
    meta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: false,
    } satisfies ErrorMeta,
  },
  featureInvalid: {
    message: "Introspect feature invalid",
    meta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: false,
    } satisfies ErrorMeta,
  },
};

/**
 * Strong domain type for `introspect.*`.
 *
 * @remarks
 * Using the shared `ErrorDomainWithFactory` ensures we see `.createError`
 * on the domain value and keeps `--isolatedDeclarations` happy.
 */
export type IntrospectDomain = ErrorDomainWithFactory<
  "introspect",
  typeof INTROSPECT_DEFS
>;

/**
 * Concrete domain instance.
 */
export const INTROSPECT_DOMAIN: IntrospectDomain = defineErrorDomain(
  "introspect",
  INTROSPECT_DEFS,
);

/**
 * Exported introspect error descriptors map.
 *
 * @remarks
 * This is what the global registry / diagnostics aggregation consumes.
 */
export type IntrospectErrorsMap = IntrospectDomain["registry"];
export const INTROSPECT_ERRORS: IntrospectErrorsMap =
  INTROSPECT_DOMAIN.registry;

/**
 * Fully-qualified code union:
 *
 *   "introspect.counterInvalid" | "introspect.featureInvalid"
 */
export type IntrospectErrorCode = ErrorCodeOf<IntrospectDomain>;

/**
 * Runtime error type for this domain.
 */
export type IntrospectError = SeqlokError<IntrospectErrorCode>;

/**
 * Domain-local factory type for `introspect.*` errors.
 *
 * @remarks
 * For this domain we treat all details as generic `ErrorDetails`. If/when you
 * want per-key narrowing, introduce a `DetailsByKey` map and wrap the base
 * factory (similar to `primitives.*`).
 */
export type IntrospectErrorFactory = ErrorFactoryOf<IntrospectDomain>;

/**
 * Runtime factory – already correctly typed via the domain helper.
 *
 * @example
 * ```ts
 * throw createIntrospectError("counterInvalid", {
 *   name: "snapshot.spinBudgetExhausted",
 *   value: Number.NaN,
 * });
 * ```
 */
export const createIntrospectError: IntrospectErrorFactory =
  INTROSPECT_DOMAIN.createError;
