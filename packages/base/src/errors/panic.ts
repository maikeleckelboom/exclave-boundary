/**
 * @fileoverview
 * Minimal helper for unrecoverable internal failures in the base layer.
 *
 * @remarks
 * - Use this only in foundational code (e.g. error primitives) where the
 *   error system itself is being constructed.
 * - Domain-level invariants in higher layers should use `internal.*`
 *   (i.e. `createInternalError`) instead.
 */

export function panic(message: string): never {
  throw new Error(`Seqlok internal error: ${message}`);
}
