import { computeBackingPlaneBases, BACKING_PLANE_PACK_ORDER_V1 } from './map-views';

import type { Backing } from './types';
import type { Plan, PlaneByteLengths } from '../plan/types';
import type { Mutable, SpecInput } from '../spec/types';

type SharedBacking = Extract<Backing, { kind: 'shared' }>;

/**
 * Grow a single-SAB backing by plane-byte targets.
 * Caller is responsible for remapping views afterwards.
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
