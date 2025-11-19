import { bench, describe } from 'vitest';

import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  receiveHandoff,
} from '../src';
import { MICRO_BENCH_OPTS } from '../vitest.config';

describe('MeterWriter sugar: set vs stage, direct vs named', () => {
  const spec = defineSpec(({ param, meter }) => ({
    id: 'bench/meter-writer-sugar',
    params: {
      dummy: param.f32({ min: 0, max: 1 }),
    },
    meters: {
      level: meter.f32(),
      spectrum: meter.f32.array(512),
    },
  }));

  const plan = planLayout(spec);
  const backing = allocateShared(plan);
  const controller = bindController(spec, backing);
  const handoff = buildHandoff(plan, backing);
  const received = receiveHandoff(handoff);
  const processor = bindProcessor(received);

  // Keep meters “legit” with a dummy param write
  controller.params.set('dummy', 0.5);

  // Shared source buffer for spectrum writes
  const spectrumSource = new Float32Array(512);
  spectrumSource.fill(0.5);

  // 1. Scalar meters: direct writer.key(v) vs writer.set('key', v)
  bench(
    'meter scalar: writer.level(0.75)',
    () => {
      processor.meters.publish((writer) => {
        writer.level(0.75);
      });
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    "meter scalar: writer.set('level', 0.75)",
    () => {
      processor.meters.publish((writer) => {
        writer.set('level', 0.75);
      });
    },
    MICRO_BENCH_OPTS,
  );

  // 2. Array meters: stage(key, cb) vs set(key, cb)
  bench(
    "meter array: writer.stage('spectrum', cb)",
    () => {
      processor.meters.publish((writer) => {
        writer.stage('spectrum', (dest) => {
          dest.set(spectrumSource);
        });
      });
    },
    MICRO_BENCH_OPTS,
  );
});
