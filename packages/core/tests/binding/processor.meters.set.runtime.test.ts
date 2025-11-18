import { describe, expect, it } from 'vitest';

import { defineSpec } from '../../src';
import { makeBindingsFromSpec } from '../__helpers__/binding';

describe('ProcessorMeters.set (runtime)', () => {
  const spec = defineSpec(({ param, meter }) => ({
    id: 'set-runtime',
    params: {
      gain: param.f32({ min: 0, max: 2 }),
    },
    meters: {
      peak: meter.f32(),
      count: meter.u32(),
      spectrum: meter.f32.array({ length: 8 }),
    },
  }));

  it('writes scalar via set()', () => {
    const { ctl, proc } = makeBindingsFromSpec(spec);

    // 1) write scalars via set()
    proc.meters.publish((writer) => {
      writer.set('peak', 0.5);
      writer.set('count', 42);
    });

    const meters = ctl.meters.snapshot(['peak', 'count', 'spectrum']);

    expect(meters.peak).toBeCloseTo(0.5);
    expect(meters.count >>> 0).toBe(42);
  });

  it('throws on unknown meter key at runtime (type escape for test)', () => {
    const { proc } = makeBindingsFromSpec(spec);

    expect(() => {
      proc.meters.publish((w) => {
        // @ts-expect-error escape the type system intentionally to hit runtime guard
        w.set('nope', 1);
      });
    }).toThrow(/unknown/i);
  });
});
