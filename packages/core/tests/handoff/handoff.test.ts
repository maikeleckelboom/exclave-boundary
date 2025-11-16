import { describe, expect, it } from 'vitest';

import { allocateShared } from '../../src/backing/allocate-shared';
import { isSeqlokError } from '../../src/errors/error';
import { buildHandoff, receiveHandoff, verifyHandoff } from '../../src/handoff/handoff';
import { planLayout } from '../../src/plan/layout';
import { defineSpec } from '../../src/spec/define';

describe('handoff (contiguous SAB only)', () => {
  const spec = defineSpec(({ param, meter }) => ({
    id: 'handoff',
    params: {
      rate: param.f32({ min: 0.25, max: 4 }),
      mode: param.enum({ values: ['a', 'b', 'c'] }),
    },
    meters: {
      peak: meter.f32(),
      frames: meter.u32(),
    },
  }));

  it('build → receive → verify roundtrip', () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    const env = buildHandoff(plan, backing);
    const received = receiveHandoff(env);

    // v2.0: All metadata accessed via plan (single source of truth)
    expect(received.plan.id).toBe('handoff'); // ← Fixed: spec.id is the string 'handoff'
    expect(received.plan.hash).toBe(plan.hash);
    expect(received.plan.bytesTotal).toBe(plan.bytesTotal);
    expect(received.sab.byteLength).toBeGreaterThanOrEqual(plan.bytesTotal);

    // v2.0: verifyHandoff compares plans directly
    expect(() => {
      verifyHandoff(plan, received.plan);
    }).not.toThrow();
  });

  it('verifyHandoff throws on spec hash mismatch', () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const env = buildHandoff(plan, backing);
    const received = receiveHandoff(env);

    /* Different local plan (hash change, same id, different content, changed bounds) */
    const spec2 = defineSpec(({ param, meter }) => ({
      id: 'handoff-v1',
      params: { rate: param.f32({ min: 0.5, max: 2 }) },
      meters: { peak: meter.f32() },
    }));
    const plan2 = planLayout(spec2);

    try {
      // v2.0: compare plans directly
      verifyHandoff(plan2, received.plan);
      expect.unreachable('verifyHandoff should throw');
    } catch (e) {
      expect(isSeqlokError(e)).toBe(true);
      if (isSeqlokError(e)) {
        expect(e.code).toBe('handoff.specHashMismatch');
      }
    }
  });

  it('receiveHandoff rejects non-SharedArrayBuffer (shape guard)', () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const env = buildHandoff(plan, backing);

    /* Poison sab field to ArrayBuffer, force cast to bypass TS */
    const badEnv = { ...env, sab: new ArrayBuffer(8) };

    expect(() => receiveHandoff(badEnv)).toThrow();
  });

  it('received.plan provides all metadata (zero duplication)', () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const env = buildHandoff(plan, backing);
    const received = receiveHandoff(env);

    // v2.0: Single source of truth - everything via plan
    expect(received.plan.id).toBe('handoff'); // ← Fixed: spec.id is the string
    expect(received.plan.hash).toBe(plan.hash);
    expect(received.plan.bytesTotal).toBe(plan.bytesTotal);
    expect(received.plan.planes.PF32).toBe(plan.planes.PF32);
    expect(received.plan.planes.PI32).toBe(plan.planes.PI32);
    expect(received.plan.planes.PB).toBe(plan.planes.PB);
    expect(received.plan.planes.PU).toBe(plan.planes.PU);
    expect(received.plan.planes.MF32).toBe(plan.planes.MF32);
    expect(received.plan.planes.MF64).toBe(plan.planes.MF64);
    expect(received.plan.planes.MU32).toBe(plan.planes.MU32);
    expect(received.plan.planes.MU).toBe(plan.planes.MU);

    // v2.0: No duplicated fields on envelope or received
    expect('hash' in env).toBe(false);
    expect('bytesTotal' in env).toBe(false);
    expect('planes' in env).toBe(false);
    expect('meta' in received).toBe(false);
  });
});
