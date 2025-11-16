import { describe, it, expectTypeOf } from 'vitest';

import { allocateShared } from '../../src/backing/allocate-shared';
import { bindProcessor } from '../../src/binding/processor';
import { buildHandoff, receiveHandoff } from '../../src/handoff/handoff';
import { planLayout } from '../../src/plan/layout';
import { defineSpec } from '../../src/spec/define';

import type { ProcessorBinding } from '../../src/binding/types';
import type { Handoff, ReceivedHandoff } from '../../src/handoff/types';

describe('typed handoff → receiveHandoff → bindProcessor (inference)', () => {
  it('preserves DemoSpec through the pipeline', () => {
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
    type DemoSpec = typeof spec;

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const handoff = buildHandoff(plan, backing);

    // compile-time: the produced envelope is HandoffOf<DemoSpec>
    expectTypeOf<typeof handoff>().toExtend<Handoff<DemoSpec>>();

    const received = receiveHandoff(handoff);
    // compile-time: receiveHandoff infers <DemoSpec> from HandoffOf<DemoSpec>
    expectTypeOf<typeof received>().toExtend<ReceivedHandoff<DemoSpec>>();
    expectTypeOf<ReceivedHandoff<DemoSpec>>().toExtend<typeof received>();

    const proc = bindProcessor(received);
    // compile-time: bindProcessor carries <DemoSpec>
    expectTypeOf<typeof proc>().toExtend<ProcessorBinding<DemoSpec>>();
    expectTypeOf<ProcessorBinding<DemoSpec>>().toExtend<typeof proc>();
  });
});
