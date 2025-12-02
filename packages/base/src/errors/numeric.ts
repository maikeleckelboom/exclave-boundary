/**
 * @fileoverview
 * Numeric error code representation shared across all Seqlok packages.
 *
 * @remarks
 * - Encodes a domain id and local id into a 32-bit integer.
 * - Layout is intentionally tiny and stable so native bindings can mirror it.
 * - Higher layers decide which domain ids and local ids to assign and validate.
 */

/**
 * Branded 32-bit numeric error code.
 *
 * @remarks
 * The underlying value is a JavaScript number, but it should always be a
 * 32-bit unsigned integer encoded via {@link encodeNumeric}.
 */
export type ErrorNumericCode = number & {
  readonly __brand: "ErrorNumericCode";
};

/**
 * Decoded parts of a numeric error code.
 *
 * @remarks
 * - `domainId` → high 8 bits (0–255)
 * - `localId`  → low 24 bits (0–16_777_215)
 */
export interface ErrorNumericParts {
  readonly domainId: number;
  readonly localId: number;
}

const TOTAL_BITS = 32;

// High 8 bits → domain id, low 24 bits → local id.
const DOMAIN_BITS = 8;
const LOCAL_BITS = TOTAL_BITS - DOMAIN_BITS;

const DOMAIN_MASK = (1 << DOMAIN_BITS) - 1;
const LOCAL_MASK = (1 << LOCAL_BITS) - 1;

/**
 * Encode a `(domainId, localId)` pair into a numeric error code.
 *
 * @remarks
 * This helper is deliberately minimal and does not perform range validation.
 * Values are truncated to the configured layout:
 *
 * - `domainId` is masked to `DOMAIN_BITS`.
 * - `localId`  is masked to `LOCAL_BITS`.
 *
 * Callers are responsible for enforcing allocation policies at a higher layer.
 */
export function encodeNumeric(
  domainId: number,
  localId: number,
): ErrorNumericCode {
  const domainPart = (domainId & DOMAIN_MASK) << LOCAL_BITS;
  const localPart = localId & LOCAL_MASK;
  return (domainPart | localPart) as ErrorNumericCode;
}

/**
 * Decode a numeric error code into its `(domainId, localId)` parts.
 */
export function decodeNumeric(code: ErrorNumericCode): ErrorNumericParts {
  const raw = code as number;
  return {
    domainId: (raw >>> LOCAL_BITS) & DOMAIN_MASK,
    localId: raw & LOCAL_MASK,
  };
}
