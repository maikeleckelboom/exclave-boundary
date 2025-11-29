/**
 * @fileoverview
 * Public surface for the `@seqlok/base` package.
 *
 * @remarks
 * This package exposes the portable error primitives, numeric encoding, and
 * internal assertion helpers used throughout the Seqlok workspace. Higher
 * layers define their own domains and registries on top of these building blocks.
 */

// ERROR PRIMITIVES
export {
  SeqlokError,
  isSeqlokError,
  createErrorFactory,
  defineErrorDomain,
} from "./errors/error";
export type {
  ErrorDetails,
  ErrorMeta,
  ErrorSeverity,
  TypedArrayName,
  ErrorEnvelope,
  ErrorKeyFromCode,
  ErrorCodeOf,
  ErrorKeyOf,
  ErrorFactoryOf,
  DomainDef,
  DomainRegistry,
  ErrorDescriptor,
  ErrorDomain,
  ErrorRegistry,
  KeyedErrorFactoryOf,
  ErrorDomainWithFactory,
} from "./errors/error";

// NUMERIC ENCODING & DOMAINS
export { encodeNumeric, decodeNumeric } from "./errors/numeric";
export type { ErrorNumericCode, ErrorNumericParts } from "./errors/numeric";

export {
  DOMAIN_IDS,
  DOMAIN_RANGES,
  isBuiltinDomainId,
  isUserDomainId,
} from "./errors/domains";
export type {
  DomainEntry,
  DomainDescriptor,
  DomainId,
  DomainName,
  DomainRange,
  DomainIdName,
} from "./errors/domains";

export { buildErrorDomain } from "./errors/build-domain";
export type { BuiltErrorDomain } from "./errors/build-domain";

// INTERNAL ERRORS & ASSERTIONS
export { invariant } from "./errors/invariant";
export { createInternalError, INTERNAL_ERRORS } from "./errors/internal";
export type {
  InternalAssertionDetails,
  InternalErrorCode,
  InternalErrorFactory,
  InternalErrorKey,
} from "./errors/internal";
export { panic } from "./errors/panic";

// HEALTH INTERPRETATION
export { interpretHealth, isBoundarySafe, getDocsUrl } from "./errors/health";
export type { HealthInterpretation, HealthStatus } from "./errors/health";

// JSON & TYPE HELPERS
export type { JsonPrimitive, JsonValue } from "./errors/json";
export type { AssertTrue, IsExact, IsExtends } from "./types/helpers";
