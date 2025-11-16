import { describe, it, expect } from 'vitest';

import { allocateShared } from '../../src/backing/allocate-shared';
import { bindController } from '../../src/binding/controller';
import { bindProcessor } from '../../src/binding/processor';
import { buildHandoff, receiveHandoff, verifyHandoff } from '../../src/handoff/handoff';
import { planLayout } from '../../src/plan/layout';
import { defineSpec } from '../../src/spec/define';

describe('handoff wire: controller ⇄ processor (runtime smoke)', () => {
  it('moves params & meters correctly across handoff', () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: 'demo',
      params: {
        timeRatio: param.f32({ min: 0.25, max: 4 }),
        coeffs: param.f32.array(8),
      },
      meters: {
        fps: meter.f32(),
        frameMs: meter.f32(),
      },
    }));
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, backing);

    // controller → processor via handoff
    const handoff = buildHandoff(plan, backing);
    const rx = receiveHandoff(handoff);

    // v2.0: verifyHandoff compares plans directly (localPlan, remotePlan)
    verifyHandoff(plan, rx.plan);

    const proc = bindProcessor(rx);

    // 1) controller writes a param, processor reads coherently
    ctl.params.update({ timeRatio: 0.5 });

    let seen = Number.NaN;
    proc.params.within((v) => {
      // capture inside the coherent window; avoid returning value to keep ESLint happy

      seen = v.timeRatio;
    });
    expect(seen).toBeCloseTo(0.5, 6);

    // 2) processor publishes meters, controller sees them
    const vBefore = ctl.meters.version();

    // prefer the already-tested runtime path that avoids callback typing noise
    proc.meters.publish((w) => {
      w.fps(120);
      w.frameMs(8.33);
    });

    const vAfter = ctl.meters.version();
    expect(vAfter).toBeGreaterThan(vBefore);

    const { fps, frameMs } = ctl.meters.snapshot(['fps', 'frameMs']);
    expect(fps).toBeCloseTo(120, 6);
    expect(frameMs).toBeCloseTo(8.33, 6);
  });

  it('handoff preserves plan metadata (zero duplication)', () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: 'metadata',
      params: { gain: param.f32({ min: 0, max: 1 }) },
      meters: { rms: meter.f32() },
    }));
    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    const handoff = buildHandoff(plan, backing);
    const rx = receiveHandoff(handoff);

    // v2.0: All metadata flows through plan (single source of truth)
    expect(rx.plan.hash).toBe(plan.hash);
    expect(rx.plan.bytesTotal).toBe(plan.bytesTotal);
    expect(rx.plan.id).toBe(plan.id);
    expect(rx.plan.planes).toEqual(plan.planes);

    // v2.0: Verify plan-to-plan comparison works
    expect(() => {
      verifyHandoff(plan, rx.plan);
    }).not.toThrow();
  });
});
