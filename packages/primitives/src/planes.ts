/**
 * @packageDocumentation
 * Plane identifiers and alignment helpers for Seqlok memory plans.
 *
 * Each plane groups values by storage type to guarantee deterministic plan
 * and correct TypedArray alignment:
 *
 * - `PF32`  Float32 **params**
 * - `PI32`  Int32   **params** (enum indices)
 * - `PB`    Uint8   **params** (booleans, ABI v1)
 * - `PU`    Uint32  **Param** seqlock counters `[LOCK, SEQ]`
 * - `MF32`  Float32 **meters**
 * - `MU32`  Uint32  **meters**
 * - `MF64`  Float64 **meters**
 * - `MU`    Uint32  **Meter** seqlock counters `[LOCK, SEQ]`
 */
import { createInternalError } from "@seqlok/base";

export type PlaneKey =
  | "PF32"
  | "PI32"
  | "PB"
  | "PU"
  | "MF32"
  | "MU32"
  | "MF64"
  | "MU";

export const ALL_PLANES: readonly PlaneKey[] = [
  "PF32",
  "PI32",
  "PB",
  "PU",
  "MF32",
  "MF64",
  "MU32",
  "MU",
] as const;

/**
 * Specifies the number of bytes per element for various data types used in planes.
 * This constant maps plane keys to the size in bytes of their corresponding typed arrays.
 *
 * @property {number} PF32 - Represents the byte size for a Float32Array.
 * @property {number} PI32 - Represents the byte size for an Int32Array.
 * @property {number} PB - Represents the byte size for a Uint8Array.
 * @property {number} PU - Represents the byte size for a Uint32Array.
 * @property {number} MF32 - Represents the byte size for a Float32Array.
 * @property {number} MU32 - Represents the byte size for a Uint32Array.
 * @property {number} MF64 - Represents the byte size for a Float64Array.
 * @property {number} MU - Represents the byte size for a Uint32Array.
 */
export const BYTES_PER_ELEM: Readonly<Record<PlaneKey, number>> = {
  PF32: 4,
  PI32: 4,
  PB: 1,
  PU: 4,
  MF32: 4,
  MU32: 4,
  MF64: 8,
  MU: 4,
} as const;

/**
 * Round `n` up to the next multiple of `align`.
 *
 * @remarks
 * `align` must be a positive power-of-two. This is enforced to keep the bit
 * trick `(n + (align - 1)) & ~(align - 1)` valid and branch-free.
 */
export function roundUpTo(n: number, align: number): number {
  if (align <= 0 || (align & (align - 1)) !== 0) {
    throw createInternalError("assertionFailed", {
      where: "primitives.planes.roundUpTo",
      detail: `align must be positive power-of-two, got ${String(align)}`,
    });
  }

  return (n + (align - 1)) & ~(align - 1);
}
