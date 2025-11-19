import { describe, expect, it } from 'vitest';

import { allocateSharedPartitioned } from '../../src/backing/allocate-shared-partitioned';
import { mapViews } from '../../src/backing/map-views';
import { planLayout } from '../../src/plan/layout';
import { specFromPlaneBytes } from '../helpers/spec-from-bytes';

import type { SharedBacking } from '../../src/backing/types';
import type { PlaneByteLengths } from '../../src/plan/types';

const B4 = 4;
const B8 = 8;

const CASES: readonly PlaneByteLengths[] = [
  {
    PF32: 5 * B4,
    PI32: 2 * B4,
    PB: 3,
    PU: 1 * B4,
    MF32: 4 * B4,
    MF64: 1 * B8,
    MU32: 1 * B4,
    MU: 1 * B4,
  },
  {
    PF32: 0,
    PI32: 0,
    PB: 0,
    PU: 2 * B4,
    MF32: 0,
    MF64: 0,
    MU32: 0,
    MU: 2 * B4,
  },
  {
    PF32: 16 * B4,
    PI32: 8 * B4,
    PB: 32,
    PU: 4 * B4,
    MF32: 12 * B4,
    MF64: 9 * B8,
    MU32: 6 * B4,
    MU: 4 * B4,
  },
];

describe('mapViews (parity table)', () => {
  it('split vs contiguous: byteLengths match the *planned* sizes', () => {
    for (const req of CASES) {
      const plan = planLayout(specFromPlaneBytes(req));
      const split = allocateSharedPartitioned(plan);
      const vSplit = mapViews(plan, split);

      const cont: SharedBacking = {
        kind: 'shared',
        sab: new SharedArrayBuffer(plan.bytesTotal),
      };
      const vCont = mapViews(plan, cont);

      expect(vSplit.params.PF32.byteLength).toBe(plan.planes.PF32);
      expect(vSplit.params.PI32.byteLength).toBe(plan.planes.PI32);
      expect(vSplit.params.PB.byteLength).toBe(plan.planes.PB);
      expect(vSplit.params.PU.byteLength).toBe(plan.planes.PU);
      expect(vSplit.meters.MF32.byteLength).toBe(plan.planes.MF32);
      expect(vSplit.meters.MF64.byteLength).toBe(plan.planes.MF64);
      expect(vSplit.meters.MU32.byteLength).toBe(plan.planes.MU32);
      expect(vSplit.locks.MU.byteLength).toBe(plan.planes.MU);

      expect(vCont.params.PF32.byteLength).toBe(plan.planes.PF32);
      expect(vCont.params.PI32.byteLength).toBe(plan.planes.PI32);
      expect(vCont.params.PB.byteLength).toBe(plan.planes.PB);
      expect(vCont.params.PU.byteLength).toBe(plan.planes.PU);
      expect(vCont.meters.MF32.byteLength).toBe(plan.planes.MF32);
      expect(vCont.meters.MF64.byteLength).toBe(plan.planes.MF64);
      expect(vCont.meters.MU32.byteLength).toBe(plan.planes.MU32);
      expect(vCont.locks.MU.byteLength).toBe(plan.planes.MU);
    }
  });
});
