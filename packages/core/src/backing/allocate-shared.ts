/**
 * @fileoverview
 * Allocates a single contiguous SharedArrayBuffer backing for a plan.
 *
 * @remarks
 * - Computes a contiguous layout for all planes and locks from the Plan.
 * - Returns a shared backing that can be mapped into typed views via `mapViews`.
 * - Throws structured errors when SAB allocation or support fails.
 *
 * @see {@link ../../docs/architecture/11-backing-and-plane-layout.md} for layout details
 *
 * @internal
 */

import { createBackingError } from "../errors/backing";
import { createEnvError } from "../errors/env";

import type { SharedBacking } from "./types";
import type { Plan } from "../plan/types";
import type { SpecInput } from "../spec/types";

/**
 * Allocates a contiguous SharedArrayBuffer for the entire layout.
 *
 * @typeParam S - Layout spec type
 * @param plan - Memory layout specification
 * @returns SharedBacking with a single SAB
 *
 * @throws {Error}
 * - If SharedArrayBuffer is unsupported in the environment
 * - If allocation fails due to memory constraints
 *
 * @example
 * ```typescript
 * const backing = allocateShared(plan);
 * // backing.sab contains all planes contiguously
 * ```
 */
export function allocateShared<S extends SpecInput>(
  plan: Plan<S>,
): SharedBacking {
  if (typeof SharedArrayBuffer === "undefined") {
    throw createEnvError("unsupported", {
      feature: "SharedArrayBuffer",
      reason: "missing SharedArrayBuffer (check COOP/COEP for browsers)",
    });
  }

  try {
    const sab = new SharedArrayBuffer(plan.bytesTotal);
    return { kind: "shared", sab };
  } catch (cause) {
    throw createBackingError(
      "allocFailed",
      {
        plane: "all",
        requestedBytes: plan.bytesTotal,
        allocatedBytes: 0,
        where: "allocateShared",
      },
      cause,
    );
  }
}

/**
 * Gets the total byte length of a non-partitioned backing.
 *
 * @remarks
 * Only works with 'shared' and 'wasm-shared' backings.
 * For 'shared-partitioned', use the plan's `bytesTotal` directly.
 *
 * @param backing - Backing to measure (must not be partitioned)
 * @returns Size in bytes
 */
export function backingByteLength(
  backing:
    | { kind: "shared"; sab: SharedArrayBuffer }
    | {
        kind: "wasm-shared";
        memory: WebAssembly.Memory;
      },
): number {
  return backing.kind === "shared"
    ? backing.sab.byteLength
    : (backing.memory.buffer as ArrayBufferLike).byteLength;
}
