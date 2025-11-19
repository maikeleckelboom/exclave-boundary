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
import { E2E_BENCH_OPTS } from '../vitest.config';

let _blackhole = 0;

describe('E2E pipeline: plan + allocate + handoff + bind', () => {
  const smallSpec = defineSpec(({ param, meter }) => ({
    id: 'bench/e2e/small',
    params: {
      gain: param.f32({ min: 0, max: 2 }),
      cutoffHz: param.f32({ min: 20, max: 20_000 }),
      pan: param.f32({ min: -1, max: 1 }),
      drive: param.f32({ min: 0, max: 10 }),
    },
    meters: {
      rmsL: meter.f32(),
      rmsR: meter.f32(),
    },
  }));

  const mediumSpec = defineSpec(({ param, meter }) => ({
    id: 'bench/e2e/medium',
    params: {
      gain: param.f32({ min: 0, max: 2 }),
      cutoffHz: param.f32({ min: 20, max: 20_000 }),
      resonance: param.f32({ min: 0.1, max: 10 }),
      drive: param.f32({ min: 0, max: 10 }),
      pan: param.f32({ min: -1, max: 1 }),
      attackMs: param.f32({ min: 0.1, max: 2_000 }),
      releaseMs: param.f32({ min: 0.1, max: 5_000 }),
      eqBands: param.f32.array(8),
    },
    meters: {
      rmsL: meter.f32(),
      rmsR: meter.f32(),
      engineWorkMs: meter.f32(),
      headroomDb: meter.f32(),
    },
  }));

  const largeSpec = defineSpec(({ param, meter }) => ({
    id: 'bench/e2e/large',
    params: {
      gain: param.f32({ min: 0, max: 4 }),
      cutoffHz: param.f32({ min: 20, max: 20_000 }),
      resonance: param.f32({ min: 0.1, max: 20 }),
      drive: param.f32({ min: 0, max: 20 }),
      pan: param.f32({ min: -1, max: 1 }),
      attackMs: param.f32({ min: 0.1, max: 5_000 }),
      releaseMs: param.f32({ min: 0.1, max: 10_000 }),
      lfoRateHz: param.f32({ min: 0.01, max: 40 }),
      lfoDepth: param.f32({ min: 0, max: 1 }),
      envAmount: param.f32({ min: 0, max: 1 }),
      eqBands: param.f32.array(16),
      sends: param.f32.array(8),
    },
    meters: {
      rmsL: meter.f32(),
      rmsR: meter.f32(),
      engineWorkMs: meter.f32(),
      headroomDb: meter.f32(),
      spectrum: meter.f32.array(256),
    },
  }));

  bench(
    'small spec: full setup',
    () => {
      const plan = planLayout(smallSpec);
      const backing = allocateShared(plan);
      const handoff = buildHandoff(plan, backing);
      const received = receiveHandoff(handoff);

      // Exercise bindings
      bindController(smallSpec, backing);
      bindProcessor(received);

      // Trivial side-effect to keep things "live"
      _blackhole ^= 1;
    },
    E2E_BENCH_OPTS,
  );

  bench(
    'medium spec: full setup',
    () => {
      const plan = planLayout(mediumSpec);
      const backing = allocateShared(plan);
      const handoff = buildHandoff(plan, backing);
      const received = receiveHandoff(handoff);

      bindController(mediumSpec, backing);
      bindProcessor(received);

      _blackhole ^= 2;
    },
    E2E_BENCH_OPTS,
  );

  bench(
    'large spec: full setup',
    () => {
      const plan = planLayout(largeSpec);
      const backing = allocateShared(plan);
      const handoff = buildHandoff(plan, backing);
      const received = receiveHandoff(handoff);

      bindController(largeSpec, backing);
      bindProcessor(received);

      _blackhole ^= 4;
    },
    E2E_BENCH_OPTS,
  );
});
