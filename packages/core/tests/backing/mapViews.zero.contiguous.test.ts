import { describe, it, expect } from 'vitest';

import { mapViews } from '../../src/backing/map-views';
import { planLayout } from '../../src/plan/layout';
import { specFromPlaneBytes } from '../helpers/spec-from-bytes';

const B4 = 4;

describe('mapViews (contiguous) — zero-length PB plane maps to zero-length view', () => {
  it('byte plane PB can be zero-length while locks still map correctly', () => {
    const req = {
      // keep PF32/PI32 non-zero because helper/spec might always declare some f32/i32 params
      PF32: 8 * B4,
      PI32: 4 * B4,
      PB: 0, // the one we explicitly want to test as zero-length
      PU: 2 * B4, // param locks (u32) must exist
      MF32: 0,
      MF64: 0,
      MU32: 0,
      MU: 2 * B4, // meter locks (u32) must exist
    };

    const plan = planLayout(specFromPlaneBytes(req));
    const sab = new SharedArrayBuffer(plan.bytesTotal);
    const v = mapViews(plan, { kind: 'shared', sab });

    // PB should reflect the requested zero-length exactly
    expect(v.params.PB.byteLength).toBe(0);

    // Locks should still be present per requested bytes
    expect(v.locks.PU.byteLength).toBe(plan.planes.PU);
    expect(v.locks.MU.byteLength).toBe(plan.planes.MU);
  });
});
