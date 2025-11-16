import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  computeBackingPlaneBases,
  BACKING_PLANE_PACK_ORDER_V1,
} from '../../src/backing/map-views';

import type { PlaneByteLengths } from '../../src/plan/types';
import type { PlaneKey } from '../../src/primitives/planes';

const align4 = [
  'PF32',
  'PI32',
  'MF32',
  'MU32',
  'PU',
] as const satisfies readonly PlaneKey[];
const align8 = ['MF64'] as const satisfies readonly PlaneKey[];
const align1 = ['PB'] as const satisfies readonly PlaneKey[];

describe('computeBackingPlaneBases alignment invariants', () => {
  it('respects natural alignment and full coverage (contiguous, pack-order)', () => {
    /* PER-PLANE BYTE LENGTHS already aligned for their element width */
    const arb = fc.record<PlaneByteLengths>({
      PF32: fc.nat(1 << 24).map((n) => n * 4),
      PI32: fc.nat(1 << 24).map((n) => n * 4),
      PB: fc.nat(1 << 24),
      PU: fc.nat(1 << 24).map((n) => n * 4),
      MF32: fc.nat(1 << 24).map((n) => n * 4),
      MF64: fc.nat(1 << 24).map((n) => n * 8),
      MU32: fc.nat(1 << 24).map((n) => n * 4),
      MU: fc.nat(1 << 24).map((n) => n * 4),
    });

    fc.assert(
      fc.property(arb, (lens) => {
        const bases = computeBackingPlaneBases(lens);

        /* Alignment per plane */
        for (const k of align4) {
          expect(bases[k] % 4).toBe(0);
        }
        for (const k of align8) {
          expect(bases[k] % 8).toBe(0);
        }
        for (const k of align1) {
          expect(bases[k] % 1).toBe(0);
        }

        /* Contiguity in BACKING_PLANE_PACK_ORDER_V1: base[next] === base[prev] + len[prev] */
        for (let i = 1; i < BACKING_PLANE_PACK_ORDER_V1.length; i++) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const prev = BACKING_PLANE_PACK_ORDER_V1[i - 1]!;
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const curr = BACKING_PLANE_PACK_ORDER_V1[i]!;
          expect(bases[curr]).toBe(bases[prev] + lens[prev]);
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const last = BACKING_PLANE_PACK_ORDER_V1[BACKING_PLANE_PACK_ORDER_V1.length - 1]!;
        const endLast = bases[last] + lens[last];
        const sum = (Object.keys(lens) as PlaneKey[]).reduce(
          (acc, k) => acc + lens[k],
          0,
        );
        expect(endLast).toBe(sum);
      }),
    );
  });
});
