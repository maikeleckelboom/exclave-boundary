/**
 * @fileoverview
 * Shared helpers for snapshot implementations.
 *
 * @remarks
 * - Centralizes bound-check + error shape for scalar reads.
 * - Used by controller and observer snapshot helpers.
 *
 * @internal
 */

import { createInternalError } from "@seqlok/base";

import { getEnumLabelForIndex, isEnumDef } from "./enum-utils";

import type { MeterPlane, ParamPlane } from "./validate";
import type { MeterPlaneViews, ParamPlaneViews } from "../../backing/map-views";
import type { ParamDef } from "../../spec/types";

/**
 * Load a scalar value from a numeric array, enforcing bounds.
 *
 * @remarks
 * - Works with any numeric ArrayLike (TypedArray, Array<number>, etc.).
 * - Throws a structured `internal.assertionFailed` error if the index is OOB.
 */
export function requireIndex(
  arr: ArrayLike<number>,
  index: number,
  where: string,
  detail: string,
): number {
  const value = arr[index];
  if (value === undefined) {
    throw createInternalError("assertionFailed", {
      where,
      detail,
      index,
    });
  }
  return value;
}

export type ParamArray = Float32Array | Int32Array | Uint8Array;
export type MeterArray = Float32Array | Float64Array | Uint32Array;

function copyTypedArray<T extends ParamArray | MeterArray>(
  src: T,
  into?: T,
): T {
  if (
    into &&
    into.constructor === src.constructor &&
    into.length === src.length
  ) {
    into.set(src);
    return into;
  }

  if (src instanceof Float32Array) {
    return new Float32Array(src) as T;
  }
  if (src instanceof Float64Array) {
    return new Float64Array(src) as T;
  }
  if (src instanceof Int32Array) {
    return new Int32Array(src) as T;
  }
  if (src instanceof Uint32Array) {
    return new Uint32Array(src) as T;
  }
  return new Uint8Array(src) as T;
}

export function copyParamArray(
  src: Float32Array,
  into?: Float32Array,
): Float32Array;
export function copyParamArray(src: Int32Array, into?: Int32Array): Int32Array;
export function copyParamArray(src: Uint8Array, into?: Uint8Array): Uint8Array;
export function copyParamArray(src: ParamArray, into?: ParamArray): ParamArray {
  return copyTypedArray(src, into);
}

export function copyMeterArray(
  src: Float32Array,
  into?: Float32Array,
): Float32Array;
export function copyMeterArray(
  src: Float64Array,
  into?: Float64Array,
): Float64Array;
export function copyMeterArray(
  src: Uint32Array,
  into?: Uint32Array,
): Uint32Array;
export function copyMeterArray(src: MeterArray, into?: MeterArray): MeterArray {
  return copyTypedArray(src, into);
}

/**
 * Read a scalar meter value from the correct data plane.
 *
 * @remarks
 * - Scalars are always numbers (including "bool" meters represented as 0/1 in MU32).
 */
export function readMeterScalar(
  plane: MeterPlane,
  views: MeterPlaneViews,
  key: string,
  start: number,
): number {
  if (plane === "MF32") {
    return requireIndex(views.MF32, start, key, "Meter MF32 scalar OOB");
  }
  if (plane === "MF64") {
    return requireIndex(views.MF64, start, key, "Meter MF64 scalar OOB");
  }
  // MU32: used for integer / bool-like meters (0 / 1 / counters etc.)
  return requireIndex(views.MU32, start, key, "Meter MU32 scalar OOB");
}

/**
 * Read a scalar param value from the correct data plane and decode to a public value.
 *
 * @remarks
 * - PF32 → number
 * - PI32 → number or enum label string
 * - PB   → boolean (0/1 → false/true)
 */
export function readParamScalar(
  plane: ParamPlane,
  views: ParamPlaneViews,
  defs: Readonly<Record<string, ParamDef>>,
  key: string,
  start: number,
): number | string | boolean {
  if (plane === "PF32") {
    return requireIndex(views.PF32, start, key, "Param PF32 scalar OOB");
  }

  if (plane === "PI32") {
    const raw = requireIndex(views.PI32, start, key, "Param PI32 scalar OOB");
    const def = defs[key];
    return isEnumDef(def) ? getEnumLabelForIndex(def, raw) : raw;
  }

  // PB: bool param stored as 0/1 byte
  const b = requireIndex(views.PB, start, key, "Param PB scalar OOB");
  return b !== 0;
}
