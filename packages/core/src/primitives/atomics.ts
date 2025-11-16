/**
 * Thin wrappers around Atomics for U32 planes.
 *
 * These helpers centralize error handling so that failures can be surfaced
 * as structured `SeqlokError<'primitives.atomicsFailed'>` instead of raw
 * Atomics exceptions.
 */
import { createError } from '../errors/error';

function atomicsFailed(detail: string, where: string, exception?: unknown): never {
  const details = {
    where,
    detail,
  } as const;
  throw createError('primitives.atomicsFailed', 'Atomics operation failed', details, {
    cause: exception,
  });
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
  } catch (e) {
    atomicsFailed(`loadU32 index=${String(index)}`, 'primitives.atomics.loadU32', e);
  }
}

/**
 * Add a delta to a u32 at the given index (fetch_add style).
 */
export function addU32(plane: Uint32Array, index: number, delta: number): number {
  try {
    return Atomics.add(plane, index, delta);
  } catch (e) {
    atomicsFailed(
      `addU32 index=${String(index)} delta=${String(delta)}`,
      'primitives.atomics.addU32',
      e,
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
