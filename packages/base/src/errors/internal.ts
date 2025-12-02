/**
 * @fileoverview
 * Error codes and detail types for internal invariants.
 *
 * @remarks
 * - Models `internal.*` failures surfaced via `invariant(...)`.
 * - Reserved for "this should never happen" situations in core code.
 * - Registered into the global error registry as the `internal.*` domain.
 */

import {
  createErrorFactory,
  type ErrorDetails,
  type ErrorKeyFromCode,
  type ErrorMeta,
  type SeqlokError,
} from "./error";

import type { AssertTrue, IsExact } from "../types/helpers";

/**
 * Internal invariant error codes.
 */
export type InternalErrorCode =
  | "internal.assertionFailed"
  | "internal.unreachable"
  | "internal.exhaustiveness";

/**
 * Details for internal assertion failures.
 *
 * @remarks
 * - `detail` is a short human-oriented locator or description.
 * - Additional fields come from call-sites via `ErrorDetails`.
 */
export interface InternalAssertionDetails extends ErrorDetails {
  readonly detail?: string;
}

/**
 * Descriptor for a single internal error code.
 */
interface InternalErrorDescriptor<C extends InternalErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

/**
 * Local keys used for the internal error registry.
 *
 * @remarks
 * These are the identifiers used with `createInternalError(...)`.
 */
export type InternalErrorKey = ErrorKeyFromCode<InternalErrorCode>;

/**
 * Descriptor map keyed by local names.
 *
 * @remarks
 * - Keys are short, domain-local identifiers.
 * - `code` carries the fully-qualified error code string.
 */
interface InternalErrorsMap {
  readonly assertionFailed: InternalErrorDescriptor<"internal.assertionFailed">;
  readonly unreachable: InternalErrorDescriptor<"internal.unreachable">;
  readonly exhaustiveness: InternalErrorDescriptor<"internal.exhaustiveness">;
}

/**
 * Canonical internal error descriptors keyed by local names.
 *
 * @remarks
 * Used by:
 * - Diagnostics / registry aggregation in @seqlok/introspect
 * - The domain-local `createInternalError(...)` factory
 */
const INTERNAL_ERRORS_DEF = {
  assertionFailed: {
    code: "internal.assertionFailed",
    message: "Internal assertion failed",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    },
  },
  unreachable: {
    code: "internal.unreachable",
    message: "Unreachable code executed",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    },
  },
  exhaustiveness: {
    code: "internal.exhaustiveness",
    message: "Non-exhaustive branch",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    },
  },
} as const satisfies InternalErrorsMap;

/**
 * Exported internal error descriptor map.
 *
 * @remarks
 * This is the shape consumed by introspect and registry tooling.
 */
export const INTERNAL_ERRORS: InternalErrorsMap = INTERNAL_ERRORS_DEF;

/**
 * Type-level sanity check that descriptor codes match `InternalErrorCode`.
 * @internal
 */
export type _InternalCodesMatch = AssertTrue<
  IsExact<InternalErrorCode, InternalErrorsMap[InternalErrorKey]["code"]>
>;

/**
 * Domain-local factory type for `internal.*` errors.
 *
 * @remarks
 * This matches the runtime shape returned by `createErrorFactory(INTERNAL_ERRORS_DEF)`,
 * but is written explicitly to satisfy `--isolatedDeclarations`.
 */
export type InternalErrorFactory = (
  key: InternalErrorKey,
  details: ErrorDetails,
  cause?: unknown,
) => SeqlokError<InternalErrorCode>;

/**
 * Domain-local factory for creating `internal.*` errors.
 *
 * @example
 * ```ts
 * throw createInternalError("assertionFailed", {
 *   where: "binding.controller.backing",
 *   detail: "Shared backing too small for plan.bytesTotal",
 * });
 * ```
 */
export const createInternalError: InternalErrorFactory =
  createErrorFactory(INTERNAL_ERRORS_DEF);
