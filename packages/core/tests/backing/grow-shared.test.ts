import { describe, expect, it } from 'vitest';

import { allocateShared } from '../../src/backing/allocate-shared';
import { growSharedBacking } from '../../src/backing/grow-shared-backing';
import { BACKING_PLANE_PACK_ORDER_V1 } from '../../src/backing/map-views';
import { planLayout } from '../../src/plan/layout';

import type { PlaneByteLengths } from '../../src/plan/types';
import type { SpecInput } from '../../src/spec/types';

type PlaneKeyConst = (typeof BACKING_PLANE_PACK_ORDER_V1)[number];

function computeBases(planes: PlaneByteLengths): Record<PlaneKeyConst, number> {
  const bases = {} as Record<PlaneKeyConst, number>;
  let cursor = 0;
  for (const k of BACKING_PLANE_PACK_ORDER_V1) {
    bases[k] = cursor;
    cursor += planes[k];
  }
  return bases;
}

const spec: SpecInput = {
  id: 't',
  params: {
    gain: { kind: 'f32' },
    steps: { kind: 'i32.array', length: 16 },
    flags: { kind: 'bool.array', length: 8 },
  },
  meters: {
    peak: { kind: 'f32' },
    counter: { kind: 'u32' },
  },
};

function sumPlanes(p: PlaneByteLengths): number {
  return BACKING_PLANE_PACK_ORDER_V1.reduce((acc, k) => acc + p[k], 0);
}

describe('growSharedBacking', () => {
  it('monotonically increases plane sizes and preserves content', () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const { sab } = backing;

    const pf32Bases = computeBases(plan.planes);
    const PF32_END = plan.planes.PF32 - 4;
    new Uint8Array(sab, pf32Bases.PF32 + PF32_END, 4).set([1, 2, 3, 4]);

    const growPF32 = plan.planes.PF32 + 1024;
    const res = growSharedBacking(plan, backing, { PF32: growPF32 });

    expect(res.planes.PF32).toBe(growPF32);
    expect(res.planes.PI32).toBe(plan.planes.PI32);
    expect(res.planes.PB).toBe(plan.planes.PB);
    expect(res.backing.sab.byteLength).toBe(sumPlanes(res.planes));

    const newBases = computeBases(res.planes);
    const oldEnd = new Uint8Array(res.backing.sab, newBases.PF32 + PF32_END, 4);
    expect([...oldEnd]).toEqual([1, 2, 3, 4]);
  });

  it('ignores targets smaller than current planes', () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const res = growSharedBacking(plan, backing, { PF32: plan.planes.PF32 - 64 });
    expect(res.planes.PF32).toBe(plan.planes.PF32);
  });

  it('zeros new bytes by SAB guarantee', () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const res = growSharedBacking(plan, backing, { PI32: plan.planes.PI32 + 128 });

    const bases = computeBases(res.planes);
    const tail = new Uint8Array(res.backing.sab, bases.PI32 + plan.planes.PI32, 128);
    expect([...tail]).toEqual(Array(128).fill(0));
  });
});
