import { describe, expect, it } from 'vitest';

import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  type ControllerOptions,
  defineSpec,
  planLayout,
  receiveHandoff,
} from '../../src';

function makeSpec() {
  return defineSpec(({ param, meter }) => ({
    id: 'controller-binding-tests',
    params: {
      rate: param.f32({ min: 0.5, max: 2.0 }),
      mode: param.enum(['a', 'b', 'c']),
      enabled: param.bool(),
      coeffs: param.f32.array({ length: 8 }),
    },
    meters: {
      rms: meter.f32(),
      spectrum: meter.f32.array(16),
      flags: meter.u32.array(8),
    },
  }));
}

function setupController(
  options: ControllerOptions = { params: { rangePolicy: 'reject' } },
) {
  const spec = makeSpec();
  const plan = planLayout(spec);
  const backing = allocateShared(plan);

  const handoff = buildHandoff(plan, backing);
  const received = receiveHandoff(handoff);

  const ctl = bindController(spec, backing, options);
  const proc = bindProcessor(received);

  return { spec, plan, backing, handoff, received, ctl, proc };
}

describe('Controller meters: version reflects processor MU publishes', () => {
  it('proc.meters.publish() → controller.meters.version() increments by 1', () => {
    const { ctl, proc } = setupController();
    const start = ctl.meters.version();

    proc.meters.publish((w) => {
      w.rms(0.42);
    });

    const v1 = ctl.meters.version();
    expect(v1).toBe(start + 1);

    const snap = ctl.meters.snapshot({ keys: ['rms'] as const });
    expect(snap.rms).toBeCloseTo(0.42, 6);
  });

  it('single publish with multiple writes is one bump', () => {
    const { ctl, proc } = setupController();
    const start = ctl.meters.version();

    proc.meters.publish((w) => {
      w.rms(0.1);
      w.stage('spectrum', (vec) => {
        for (let i = 0; i < vec.length; i++) {
          vec[i] = i / vec.length;
        }
      });
    });

    const v1 = ctl.meters.version();
    expect(v1).toBe(start + 1);

    const snap = ctl.meters.snapshot({ keys: ['rms', 'spectrum'] });
    expect(snap.rms).toBeCloseTo(0.1, 6);
    expect(snap.spectrum).toBeInstanceOf(Float32Array);
    expect(snap.spectrum[0]).toBeCloseTo(0, 6);
    expect(snap.spectrum[15]).toBeCloseTo(15 / 16, 6);
  });
});

describe('Controller meters: snapshot into() identity and key validation', () => {
  it('meters.snapshot({keys, into}) reuses provided buffer (identity)', () => {
    const { ctl, proc } = setupController();

    // write some data
    proc.meters.publish((w) => {
      w.stage('spectrum', (vec) => {
        vec.fill(0);
        vec[2] = 1.25;
        vec[10] = 0.5;
      });
    });

    const into = { spectrum: new Float32Array(16) };
    const snap = ctl.meters.snapshot({ keys: ['spectrum'], into });

    // identity + content checks
    expect(snap.spectrum).toBe(into.spectrum);
    expect(snap.spectrum[2]).toBeCloseTo(1.25, 6);
    expect(snap.spectrum[10]).toBeCloseTo(0.5, 6);
  });

  it('unknown key in meters.snapshot() throws', () => {
    const { ctl } = setupController();
    expect(() => {
      // @ts-expect-error intentional invalid key to test guard
      ctl.meters.snapshot({ keys: ['nope'] });
    }).toThrow();
  });
});
