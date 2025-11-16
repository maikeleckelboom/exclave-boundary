import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { allocateSharedPartitioned } from '../../src/backing/allocate-shared-partitioned';
import { mapViews } from '../../src/backing/map-views';
import { planLayout } from '../../src/plan/layout';
import { specFromPlaneBytes } from '../__helpers__/spec-from-bytes';

import type { SharedBacking } from '../../src/backing/types';
import type { PlaneByteLengths } from '../../src/plan/types';

const B4 = 4;
const B8 = 8;

function arbPlaneBytes(): fc.Arbitrary<PlaneByteLengths> {
  const mul4 = fc.integer({ min: 0, max: 256 }).map((n) => n * B4);
  const mul8 = fc.integer({ min: 0, max: 128 }).map((n) => n * B8);
  const anyB = fc.integer({ min: 0, max: 512 });

  return fc
    .record<PlaneByteLengths>({
      PF32: mul4,
      PI32: mul4,
      PB: anyB,
      PU: mul4,
      MF32: mul4,
      MF64: mul8,
      MU32: mul4,
      MU: mul4,
    })
    .filter((b) => b.PF32 + b.PI32 + b.MF32 + b.MF64 > 0);
}

describe('mapViews parity (contiguous vs split) — properties', () => {
  it('mapped views reflect identical lengths/byteLengths across backings', () => {
    fc.assert(
      fc.property(arbPlaneBytes(), (req) => {
        const plan = planLayout(specFromPlaneBytes(req));
        const cont: SharedBacking = {
          kind: 'shared',
          sab: new SharedArrayBuffer(plan.bytesTotal),
        };
        const split = allocateSharedPartitioned(plan);

        const vc = mapViews(plan, cont);
        const vs = mapViews(plan, split);

        expect(vs.params.PF32.byteLength).toBe(vc.params.PF32.byteLength);
        expect(vs.params.PI32.byteLength).toBe(vc.params.PI32.byteLength);
        expect(vs.params.PB.byteLength).toBe(vc.params.PB.byteLength);
        expect(vs.params.PU.byteLength).toBe(vc.params.PU.byteLength);

        expect(vs.meters.MF32.byteLength).toBe(vc.meters.MF32.byteLength);
        expect(vs.meters.MF64.byteLength).toBe(vc.meters.MF64.byteLength);
        expect(vs.meters.MU32.byteLength).toBe(vc.meters.MU32.byteLength);

        expect(vs.locks.MU.byteLength).toBe(vc.locks.MU.byteLength);
      }),
    );
  });
});
