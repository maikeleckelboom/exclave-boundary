/**
 * @fileoverview
 * Backing buffer access helpers.
 *
 * These helpers normalize access to the underlying SharedArrayBuffer(s)
 * behind a {@link Backing} so callers do not have to repeat branching on
 * `backing.kind`:
 *
 * - `getSharedBuffer`:
 *   - `kind: 'shared'`        → contiguous SharedArrayBuffer
 *   - `kind: 'wasm-shared'`   → `WebAssembly.Memory.buffer` (validated as shared)
 *   - `kind: 'shared-partitioned'` → throws (no single SAB exists)
 *
 * - `getBufferForPlane`:
 *   - `kind: 'shared-partitioned'` → per-plane SharedArrayBuffer
 *   - `kind: 'shared' | 'wasm-shared'` → the single backing buffer
 *
 * Higher-level code (allocators, `mapViews`, tests) should use these
 * helpers instead of switching on `backing.kind` directly when they only
 * care about “which SAB to use?” rather than layout details.
 */

import { createError } from '../errors/error';

import type { Backing } from './types';
import type { PlaneKey } from '../primitives/planes';

/**
 * Return the single SharedArrayBuffer backing when it exists.
 *
 * @remarks
 * - For `kind: 'shared'` this is the contiguous SAB created by `allocateShared()`.
 * - For `kind: 'wasm-shared'` this is `WebAssembly.Memory.buffer`, which has
 *   already been validated as a `SharedArrayBuffer` by the allocator.
 *
 * This helper is intentionally *not* exposed at the top-level public API;
 * it is used by backing internals and tests.
 *
 * @throws
 * A `SeqlokError<'internal.assertionFailed'>` when called with a
 * `kind: 'shared-partitioned'` backing, because there is no single SAB in
 * that configuration. Callers in that case should use
 * {@link getBufferForPlane}.
 */
export function getSharedBuffer(backing: Backing): SharedArrayBuffer {
  switch (backing.kind) {
    case 'shared':
      return backing.sab;

    case 'wasm-shared':
      // `allocateWasmShared` ensures this is a SharedArrayBuffer.
      // We rely on that invariant here to keep this helper hot-path friendly.
      return backing.memory.buffer as unknown as SharedArrayBuffer;

    case 'shared-partitioned':
      break;

    default: {
      // Exhaustiveness guard in case BackingKind ever grows.
      // noinspection UnnecessaryLocalVariableJS
      const _exhaustive: never = backing;
      void _exhaustive;
    }
  }

  throw createError(
    'internal.assertionFailed',
    'getSharedBuffer(backing): partitioned backing has no single SharedArrayBuffer; use getBufferForPlane instead.',
    {
      where: 'backing.getSharedBuffer',
      detail: 'shared-partitioned',
    },
  );
}

/**
 * Plane-aware buffer accessor.
 *
 * @remarks
 * - For `kind: 'shared-partitioned'` this returns the per-plane
 *   `SharedArrayBuffer` for the requested plane.
 * - For `kind: 'shared' | 'wasm-shared'` this returns the single backing
 *   buffer; plane-local byte offsets are handled by the planner / mappers
 *   (e.g. in `mapViews`).
 */
export function getBufferForPlane(backing: Backing, plane: PlaneKey): SharedArrayBuffer {
  if (backing.kind === 'shared-partitioned') {
    return backing.planes[plane];
  }
  return getSharedBuffer(backing);
}
