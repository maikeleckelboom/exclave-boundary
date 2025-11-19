import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { allocateSharedPartitioned } from '../../src/backing/allocate-shared-partitioned';
import { mapViews } from '../../src/backing/map-views';
import { planLayout } from '../../src/plan/layout';
import { specFromPlaneBytes } from '../helpers/spec-from-bytes';

import type { SharedBacking } from '../../src/backing/types';
import type { PlaneByteLengths } from '../../src/plan/types';

const B4 = 4;

function arbBytes(): fc.Arbitrary<PlaneByteLengths> {
  const mul4 = fc.integer({ min: 0, max: 256 }).map((n) => n * B4);
  const anyB = fc.integer({ min: 0, max: 512 });
  return fc
    .record<PlaneByteLengths>({
      PF32: mul4,
      PI32: mul4,
      PB: anyB,
      PU: mul4,
      MF32: mul4,
      MF64: mul4.map((n) => n * 2),
      MU32: mul4,
      MU: mul4,
    })
    .filter((b) => b.PF32 + b.PI32 + b.MF32 + b.MF64 > 0);
}

describe('mapViews parity — more planes', () => {
  it('length/byteLength parity between contiguous and split backings', () => {
    fc.assert(
      fc.property(arbBytes(), (req) => {
        const plan = planLayout(specFromPlaneBytes(req));
        const split = allocateSharedPartitioned(plan);
        const cont: SharedBacking = {
          kind: 'shared',
          sab: new SharedArrayBuffer(plan.bytesTotal),
        };

        const vs = mapViews(plan, split);
        const vc = mapViews(plan, cont);

        expect(vs.params.PI32.byteLength).toBe(vc.params.PI32.byteLength);
        expect(vs.meters.MF32.byteLength).toBe(vc.meters.MF32.byteLength);
        expect(vs.meters.MU32.byteLength).toBe(vc.meters.MU32.byteLength);
        expect(vs.params.PB.byteLength).toBe(vc.params.PB.byteLength);
      }),
    );
  });
});
