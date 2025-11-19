/**
 * Single-SAB backing growth / repack helpers.
 *
 * This module implements a low-level primitive for growing a *contiguous*
 * SharedArrayBuffer backing by increasing the byte budget of individual planes
 * and repacking their contents into a freshly allocated SAB.
 *
 * @remarks
 * - This is **not** part of the public `@seqlok/core` surface. It is intended
 *   to be used by higher-level components such as a MemoryGovernor / repack
 *   pipeline, and is deliberately not exported from the package root.
 *
 * - The function in this module never mutates the existing backing in place.
 *   It allocates a new SAB, copies plane contents into their new bases, and
 *   returns a new `SharedBacking` that callers must treat as a distinct
 *   artifact. Live bindings must switch to the new backing via a SwapTicket /
 *   atFrame swap, not by “patching” views in place.
 *
 * - Plane lengths are grown **monotonically**: callers provide `targets` in
 *   bytes per plane, and the effective lengths are:
 *
 *     next[k] = max(plan.planes[k], targets[k] ?? plan.planes[k])
 *
 *   Shrinking planes is intentionally not supported here; compaction policies
 *   that reduce plane sizes should be implemented explicitly at a higher level.
 *
 * - `plan.planes` is treated as the canonical description of the current
 *   layout. If a MemoryGovernor performs incremental growth over time, it
 *   should feed in a Plan-like object whose `planes` table already reflects
 *   the current plane lengths; this helper will then compute the next
 *   monotonic step from that state.
 *
 * - This module does **not**:
 *   - remap typed views (callers must invoke `mapViews` with the returned
 *     `{ backing, planes }`),
 *   - coordinate any live controller/processor bindings,
 *   - integrate with diagnostics or error registry.
 *
 *   In a production MemoryGovernor, this primitive should be wrapped with:
 *   - admission control and watermarks,
 *   - `createError`-based error reporting on allocation failures,
 *   - SwapTicket construction and ACK/NAK handling.
 *
 * @example
 * ```ts
 * // Pseudocode inside a MemoryGovernor that wants to grow the PCM plane
 * // and then perform a swap atFrame.
 *
 * const currentPlan = plan; // Plan<S> whose planes reflect the current layout
 * const currentBacking = backing; // SharedBacking for the active instance
 *
 * // 1) Decide new plane targets (bytes)
 * const targets: Partial<PlaneByteLengths> = {
 *   pcm: currentPlan.planes.pcm * 2,
 * };
 *
 * // 2) Perform a pure repack into a larger SAB (off the audio thread)
 * const { backing: grownBacking, planes: grownPlanes } =
 *   growSharedBacking(currentPlan, currentBacking, targets);
 *
 * // 3) Remap views for the new backing
 * const views = mapViews(grownPlanes, grownBacking);
 *
 * // 4) Spawn/prime a shadow engine using the new views, preWarm it,
 * //    and schedule a SwapTicket atFrame to atomically switch bindings.
 * const ticket = buildSwapTicket({ backing: grownBacking, atFrame, fadeLen });
 * ```
 */

import { computeBackingPlaneBases, BACKING_PLANE_PACK_ORDER_V1 } from './map-views';

import type { SharedBacking } from './types';
import type { Plan, PlaneByteLengths } from '../plan/types';
import type { Mutable, SpecInput } from '../spec/types';

/**
 * Grow a single-SAB `SharedBacking` by increasing per-plane byte lengths and
 * repacking existing plane data into a freshly allocated SAB.
 *
 * @typeParam S - Spec type describing the layout; must extend {@link SpecInput}.
 *
 * @param plan
 * The Plan whose `planes` table describes the **current** plane byte lengths
 * and packing for the backing being grown. For incremental growth, callers
 * should pass a Plan-like object whose `planes` already reflects the latest
 * grown state.
 *
 * @param backing
 * The existing single-SAB {@link SharedBacking} to grow. Its `sab` is assumed
 * to be laid out according to `plan.planes` and `BACKING_PLANE_PACK_ORDER_V1`.
 *
 * @param targets
 * Desired **minimum** byte lengths for individual planes. For each plane key
 * `k` in `BACKING_PLANE_PACK_ORDER_V1`, the resulting length is:
 *
 *   - `plan.planes[k]` if `targets[k]` is `undefined` or less than or equal to
 *     the current length.
 *   - `targets[k]` if it is a number greater than the current length.
 *
 * Planes are never shrunk by this helper.
 *
 * @returns
 * A new backing + plane-length table:
 *
 * - `backing`: a new {@link SharedBacking} with `kind: 'shared'` and a freshly
 *   allocated `SharedArrayBuffer` sized to the sum of the new plane lengths.
 * - `planes`: the updated `PlaneByteLengths` table describing the grown
 *   layout, suitable for passing to `mapViews`.
 *
 * @remarks
 * - This function does **not** remap typed views; callers must use the returned
 *   `{ backing, planes }` with `mapViews` to construct new views.
 *
 * - The original `backing` and its SAB remain untouched and can continue to be
 *   used by existing bindings until a swap is performed.
 *
 * - Allocation failures (e.g. due to quota/fragmentation) will surface as
 *   native `SharedArrayBuffer` errors. Higher-level code should wrap this
 *   primitive and translate failures into structured Seqlok errors (e.g.
 *   `backing.allocFailed`) and diagnostics.
 *
 * - This helper must never be invoked directly on a live binding’s backing in
 *   an attempt to “grow in place”. Treat the returned backing as a new
 *   artifact to be introduced via the spawn → prime → preWarm → crossFade /
 *   atFrame swap pipeline.
 *
 * @internal
 */
export function growSharedBacking<S extends SpecInput>(
  plan: Plan<S>,
  backing: SharedBacking,
  targets: Partial<PlaneByteLengths>,
): {
  backing: SharedBacking;
  planes: PlaneByteLengths;
} {
  // 1) compute new plane sizes (monotonic per plane) using a mutable working copy
  const next: Mutable<PlaneByteLengths> = {
    ...(plan.planes as Mutable<PlaneByteLengths>),
  };

  // Prefer iterating known plane keys to keep types precise
  for (const k of BACKING_PLANE_PACK_ORDER_V1) {
    const want = targets[k];
    if (typeof want === 'number' && want > next[k]) {
      next[k] = want; // OK: next is mutable
    }
  }

  // 2) allocate new SAB sized to the new plane totals
  const newTotal = BACKING_PLANE_PACK_ORDER_V1.reduce((acc, k) => acc + next[k], 0);
  const nextSab = new SharedArrayBuffer(newTotal);
  const oldSab = backing.sab;

  // 3) copy plane-by-plane at their old/new bases
  const oldBases = computeBackingPlaneBases(plan.planes);
  const newBases = computeBackingPlaneBases(next);

  for (const k of BACKING_PLANE_PACK_ORDER_V1) {
    const oldLen = plan.planes[k];
    const newLen = next[k];
    const copyLen = Math.min(oldLen, newLen);

    const src = new Uint8Array(oldSab, oldBases[k], copyLen);
    const dst = new Uint8Array(nextSab, newBases[k], copyLen);
    dst.set(src);
    // SAB regions are zero-initialized; no extra tail fill required.
  }

  return {
    backing: {
      kind: 'shared',
      sab: nextSab,
    },
    planes: next,
  };
}
