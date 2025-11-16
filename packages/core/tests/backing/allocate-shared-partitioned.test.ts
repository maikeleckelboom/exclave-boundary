// packages/core/tests/backing/allocate-shared-partitioned.test.ts
import { describe, it, expect } from 'vitest';

import { allocateSharedPartitioned } from '../../src/backing/allocate-shared-partitioned';
import { mapViews } from '../../src/backing/map-views';
import { planLayout } from '../../src/plan/layout';
import { BYTES_PER_ELEM } from '../../src/primitives/planes';
import { defineSpec } from '../../src/spec/define';
import { specFromPlaneBytes } from '../__helpers__/spec-from-bytes';

import type { SharedPartitionedBacking } from '../../src/backing/types';

const B4 = 4;
const B8 = 8;

const floorTo = (n: number, q: number): number => Math.trunc(n / q) * q;

describe('allocateSharedPartitioned', () => {
  it('allocates and maps split planes with correct typed view byteLengths (floor to element size)', () => {
    // Deliberately include MF64 that can be non-multiple-of-8 in plan; we assert floored sizes.
    const bytes = {
      PF32: 16 * B4, // 64
      PI32: 4 * B4, // 16
      PB: 32, // byte plane: exact
      PU: 2 * B4, // 8
      MF32: 7 * B4, // 28
      MF64: 13 * B8, // 104 (view floors to /8)
      MU32: 5 * B4, // 20
      MU: 2 * B4, // 8
    };

    const plan = planLayout(specFromPlaneBytes(bytes));
    const split = allocateSharedPartitioned(plan);
    const v = mapViews(plan, split);

    // params
    expect(v.params.PF32.byteLength).toBe(floorTo(plan.planes.PF32, BYTES_PER_ELEM.PF32));
    expect(v.params.PI32.byteLength).toBe(floorTo(plan.planes.PI32, BYTES_PER_ELEM.PI32));
    expect(v.params.PB.byteLength).toBe(plan.planes.PB); // PB maps exact bytes
    expect(v.params.PU.byteLength).toBe(floorTo(plan.planes.PU, BYTES_PER_ELEM.PU));

    // meters
    expect(v.meters.MF32.byteLength).toBe(floorTo(plan.planes.MF32, BYTES_PER_ELEM.MF32));
    expect(v.meters.MF64.byteLength).toBe(floorTo(plan.planes.MF64, BYTES_PER_ELEM.MF64));
    expect(v.meters.MU32.byteLength).toBe(floorTo(plan.planes.MU32, BYTES_PER_ELEM.MU32));
    expect(v.meters.MU.byteLength).toBe(floorTo(plan.planes.MU, BYTES_PER_ELEM.MU));

    // locks alias typed views (PU/MU)
    expect(v.locks.PU.byteLength).toBe(floorTo(plan.planes.PU, BYTES_PER_ELEM.PU));
    expect(v.locks.MU.byteLength).toBe(floorTo(plan.planes.MU, BYTES_PER_ELEM.MU));
  });

  it('throws when a split plane SAB is undersized (PB too small), with a guaranteed non-zero PB', () => {
    // Build a spec that *guarantees* PB > 0: bool array lives on PB as bytes.
    const specPB = defineSpec(({ param }) => ({
      id: 'split-pb',
      params: {
        flags: param.bool.array(64), // 64 bytes on PB
        kf: param.f32.array(4), // ensure PF32 present (not required, but realistic)
      },
      meters: {},
    }));

    const plan = planLayout(specPB);

    // Sanity: PB must be positive here by construction.
    const plannedPB = plan.planes.PB;
    expect(plannedPB).toBeGreaterThan(0);

    // Create a valid split backing and then surgically replace PB with an undersized SAB.
    const split = allocateSharedPartitioned(plan);

    // Make an undersized PB that is still a valid SAB length (multiple of 4 and > 0).
    const pbUndersized = Math.max(4, floorTo(plannedPB, 4) - 4);

    const bad: SharedPartitionedBacking = {
      kind: 'shared-partitioned',
      planes: {
        ...split.planes,
        PB: new SharedArrayBuffer(pbUndersized), // strictly smaller than plannedPB
      },
    };

    // Should be caught by mapPartitioned -> ensure('PB') size check.
    expect(() => mapViews(plan, bad)).toThrow(/Plane PB.*too small/i);
  });
});
