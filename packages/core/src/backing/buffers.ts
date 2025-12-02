/**
 * @fileoverview
 * Unified access to backing storage buffers.
 *
 * @remarks
 * - Abstracts away differences between backing types
 * - Provides type-safe access to underlying SharedArrayBuffer(s)
 * - Used by allocators, mappers, and tests
 *
 * @see {@link getBackingBuffer} - For single-buffer backings
 * @see {@link getPlaneBuffer} - For plane-specific access
 * @see {@link ../../docs/architecture/11-backing-and-plane-layout.md} for design
 *
 * @internal
 */

import { createInternalError } from "@seqlok/base";

import type { Backing } from "./types";
import type { PlaneKey } from "@seqlok/primitives";

/**
 * Gets the single SharedArrayBuffer for a non-partitioned backing.
 *
 * @remarks
 * - `shared`: Returns the contiguous SAB
 * - `wasm-shared`: Returns the WebAssembly.Memory buffer
 * - `shared-partitioned`: Throws (use {@link getPlaneBuffer} instead)
 *
 * @throws {SeqlokError<"internal.assertionFailed">}
 * If called with a partitioned backing
 *
 * @example
 * ```typescript
 * // For non-partitioned backings
 * const buf = getBackingBuffer(backing)
 * const view = new Float32Array(buf)
 * ```
 *
 * @internal
 */
export function getBackingBuffer(backing: Backing): SharedArrayBuffer {
  switch (backing.kind) {
    case "shared":
      return backing.sab;

    case "wasm-shared":
      // We rely on that invariant to keep this helper hot-path friendly.
      return backing.memory.buffer as unknown as SharedArrayBuffer;

    case "shared-partitioned":
      // This is a programmer error: API misuse.
      throw createInternalError("assertionFailed", {
        where: "backing.getBackingBuffer",
        detail:
          "partitioned backing has no single SharedArrayBuffer; use getPlaneBuffer instead",
      });

    default: {
      throw createInternalError("exhaustiveness", {
        where: "backing.getBackingBuffer",
        detail: `unknown backing kind ${(backing as { kind: string }).kind}`,
      });
    }
  }
}

/**
 * Gets the buffer for a specific plane, handling all backing types.
 *
 * @remarks
 * - `shared-partitioned`: Returns the plane's dedicated SAB
 * - `shared` / `wasm-shared`: Returns the main buffer (offsets handled by mappers)
 *
 * @example
 * ```typescript
 * // Works with any backing type
 * const buf = getPlaneBuffer(backing, "PF32")
 * const view = new Float32Array(buf)
 * ```
 *
 * @see {@link mapViews} For creating typed array views
 */
export function getPlaneBuffer(
  backing: Backing,
  plane: PlaneKey,
): SharedArrayBuffer {
  if (backing.kind === "shared-partitioned") {
    return backing.planes[plane];
  }

  return getBackingBuffer(backing);
}
