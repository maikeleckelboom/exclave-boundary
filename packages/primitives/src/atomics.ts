/**
 * @fileOverview
 * Thin wrappers around Atomics for U32 planes.
 *
 * These helpers centralize error handling so that failures can be surfaced
 * as structured `SeqlokError<'primitives.atomicsFailed'>` instead of raw
 * Atomics exceptions.
 */

import {
  createPrimitivesError,
  type PrimitivesAtomicsFailedDetails,
} from "./errors/primitives";

function atomicsFailed(
  where: string,
  operation: "loadU32" | "addU32",
  plane: Uint32Array,
  index: number,
  delta: number | undefined,
  cause?: unknown,
): never {
  const details = {
    where,
    detail: `operation=${operation}, index=${String(
      index,
    )}, length=${String(plane.length)}, delta=${
      typeof delta === "number" ? String(delta) : "n/a"
    }`,
    operation,
    index,
    length: plane.length,
    delta,
  } satisfies PrimitivesAtomicsFailedDetails;

  throw createPrimitivesError("atomicsFailed", details, cause);
}

/**
 * Load a u32 from the given plane/index.
 *
 * @remarks
 * This is a simple wrapper so that any thrown error is normalized into our
 * error domain rather than leaking raw JS exceptions.
 */
export function loadU32(plane: Uint32Array, index: number): number {
  try {
    return Atomics.load(plane, index);
  } catch (exception) {
    atomicsFailed(
      "primitives.atomics.loadU32",
      "loadU32",
      plane,
      index,
      undefined,
      exception,
    );
  }
}

/**
 * Add a delta to a u32 at the given index (fetch_add style).
 */
export function addU32(
  plane: Uint32Array,
  index: number,
  delta: number,
): number {
  try {
    return Atomics.add(plane, index, delta);
  } catch (exception) {
    atomicsFailed(
      "primitives.atomics.addU32",
      "addU32",
      plane,
      index,
      delta,
      exception,
    );
  }
}

/**
 * Spin until the given LOCK word becomes even, with a bounded spin budget.
 *
 * @returns
 * The observed even value, or `undefined` if the budget is exhausted before
 * seeing an even value.
 */
export function spinUntilEven(
  plane: Uint32Array,
  index: number,
  spinBudget: number,
): { value: number; spins: number } | undefined {
  let spins = 0;

  let value = loadU32(plane, index);
  if ((value & 1) === 0) {
    return { value, spins };
  }

  while (spins < spinBudget) {
    spins += 1;
    value = loadU32(plane, index);
    if ((value & 1) === 0) {
      return { value, spins };
    }
  }

  return undefined;
}
