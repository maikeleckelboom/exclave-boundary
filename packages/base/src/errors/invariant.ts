/**
 * @fileoverview
 * Runtime invariant helper for Seqlok.
 *
 * @remarks
 * - Stays domain-agnostic: it does not know about specific error codes.
 * - Callers provide a lazy factory that builds a SeqlokError for this site.
 * - Matches how native ports will implement invariants (closure / lambda that
 *   constructs a domain error when violated).
 */

import type { SeqlokError } from "./error";

/**
 * Lazy error factory used by invariants.
 *
 * @remarks
 * Using a thunk means we only allocate / compute details on failure.
 */
export type InvariantErrorFactory<E extends SeqlokError> = () => E;

/**
 * Assert that a condition holds, otherwise throw a SeqlokError.
 *
 * @typeParam E - Concrete SeqlokError subtype produced by the factory.
 *
 * @example
 * invariant(
 *   backing.kind === "shared",
 *   () =>
 *     createBackingError("kindMismatch", {
 *       where: "backing.attachWasm",
 *       expectedKind: "shared",
 *       receivedKind: backing.kind,
 *     }),
 * );
 */
export function invariant<E extends SeqlokError>(
  condition: unknown,
  createError: InvariantErrorFactory<E>,
): asserts condition {
  if (!condition) {
    throw createError();
  }
}
