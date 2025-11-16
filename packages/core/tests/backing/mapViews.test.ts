import { describe, expect, it } from 'vitest';

import { allocateShared } from '../../src/backing/allocate-shared';
import { mapViews } from '../../src/backing/map-views';
import { planLayout } from '../../src/plan/layout';
import { defineSpec } from '../../src/spec/define';

import type { SeqlokError } from '../../src/errors/error';

export function isSeqlokError(x: unknown): x is SeqlokError {
  if (typeof x !== 'object' || x === null) {
    return false;
  }
  const obj = x as Record<string, unknown>;
  return obj.name === 'SeqlokError' && typeof obj.message === 'string' && 'code' in obj;
}

describe('mapViews (runtime)', () => {
  it('maps a small contiguous backing and returns plane-typed arrays', () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: 'demo',
      params: {
        table: param.f32.array(8),
        flags: param.bool.array(3),
      },
      meters: {
        peak: meter.f32(),
      },
    }));
    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    const views = mapViews(plan, backing);

    /* Basic shape checks (no unsafe access) */
    expect(views.params.PF32).toBeInstanceOf(Float32Array);
    expect(views.params.PB).toBeInstanceOf(Uint8Array);
    expect(views.meters.MF32).toBeInstanceOf(Float32Array);

    /* Sizes consistent with plan */
    expect(views.params.PF32.length * 4).toBe(plan.planes.PF32);
    expect(views.params.PB.length).toBe(plan.planes.PB);
  });

  it('throws typed SeqlokError on undersized SAB (contiguous/WASM path)', () => {
    const spec = defineSpec(({ param }) => ({
      id: 'undersized',
      params: {
        table: param.f32.array(16),
      },
    }));
    const plan = planLayout(spec);

    const sab = new SharedArrayBuffer(Math.max(0, plan.bytesTotal - 8));
    const backing = { kind: 'shared' as const, sab };

    try {
      mapViews(plan, backing);
      throw new Error('expected mapViews to throw on undersized SAB');
    } catch (e: unknown) {
      expect(isSeqlokError(e)).toBe(true);
      if (isSeqlokError(e)) {
        expect(e.code).toBe('backing.allocUndersized');
        expect(e.message).toMatch(/smaller than required|undersized/i);
      }
    }
  });
});
