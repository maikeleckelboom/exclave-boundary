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

export type PlaneKey = 'PF32' | 'PI32' | 'PB' | 'PU' | 'MF32' | 'MU32' | 'MF64' | 'MU';

export const ALL_PLANES: readonly PlaneKey[] = [
  'PF32',
  'PI32',
  'PB',
  'PU',
  'MF32',
  'MF64',
  'MU32',
  'MU',
];

/** Bytes per element for each plane's natural typed array. */
export const BYTES_PER_ELEM: Readonly<Record<PlaneKey, number>> = {
  PF32: 4, // Float32Array
  PI32: 4, // Int32Array
  PB: 1, // Uint8Array
  PU: 4, // Uint32Array
  MF32: 4, // Float32Array
  MU32: 4, // Uint32Array
  MF64: 8, // Float64Array
  MU: 4, // Uint32Array
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
    throw new Error('roundUpTo: align must be power-of-two');
  }
  return (n + (align - 1)) & ~(align - 1);
}

/**
 * True if `byteOffset` satisfies alignment requirements for the plane's typed array.
 * For MF64 this is 8-byte alignment; for others it is 4 or 1 as per BYTES_PER_ELEM.
 */

/** Type-level drift guards (no runtime churn). */
// type _AssertTrue<T extends true> = T;
// type _PlaneBytesCovered = _AssertTrue<Exclude<PlaneKey, keyof typeof BYTES_PER_ELEM> extends never ? true : false>;
// type _PlaneMapNoExtras = _AssertTrue<Exclude<keyof typeof BYTES_PER_ELEM, PlaneKey> extends never ? true : false>;
