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

let _blackhole = 0;

const spec = defineSpec(({ param, meter }) => ({
  id: 'bench/param-operations',
  params: {
    gain: param.f32({ min: 0, max: 2 }),
    cutoffHz: param.f32({ min: 20, max: 20_000 }),
    drive: param.f32({ min: 0, max: 10 }),
    pan: param.f32({ min: -1, max: 1 }),
    eqBands: param.f32.array(8),
  },
  meters: {
    dummy: meter.f32(),
  },
}));

const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, backing);
const handoff = buildHandoff(plan, backing);
const received = receiveHandoff(handoff);
const processor = bindProcessor(received);

// Pre-allocate arrays used in writes and reads so we only measure binding cost.
const eqWriteBuffer = new Float32Array(8);
for (let i = 0; i < eqWriteBuffer.length; i++) {
  eqWriteBuffer[i] = 0.5 + i * 0.01;
}

/**
 * One scalar-only update via set(): gain + cutoffHz.
 */
function paramsSetTwoScalars(): void {
  controller.params.set('gain', 1.0);
  controller.params.set('cutoffHz', 4_000);
  _blackhole ^= 1;
}

/**
 * Batch update of 3 scalars via update().
 */
function paramsUpdateThreeScalars(): void {
  controller.params.update({
    gain: 1.0,
    cutoffHz: 4_000,
    drive: 3.5,
  });
  _blackhole ^= 2;
}

/**
 * Update 3 scalars + stage the eqBands f32[8] array.
 *
 * Important: arrays NEVER go through update() – only through stage().
 */
function paramsUpdateScalarsAndStageArray(): void {
  // Scalars via update()
  controller.params.update({
    gain: 0.8,
    cutoffHz: 8_000,
    drive: 5.0,
  });

  // Array via stage()
  controller.params.stage('eqBands', (view) => {
    const len = view.length;

    for (let i = 0; i < len; i++) {
      view[i] = eqWriteBuffer[i] ?? 0;
    }
  });

  _blackhole ^= 4;
}

/**
 * Bulk hydrate: 3 scalars + eqBands f32[8] via params.hydrate().
 *
 * Mirrors paramsUpdateScalarsAndStageArray(), but exercises the hydrate macro path.
 */
function paramsHydrateScalarsAndArray(): void {
  controller.params.hydrate({
    gain: 0.8,
    cutoffHz: 8_000,
    drive: 5.0,
    eqBands: eqWriteBuffer,
  });
  _blackhole ^= 1024;
}

/**
 * Array-only write: pure stage() of eqBands.
 */
function paramsStageArrayOnly(): void {
  controller.params.stage('eqBands', (view) => {
    const len = view.length;

    for (let i = 0; i < len; i++) {
      view[i] = eqWriteBuffer[i] ?? 0;
    }
  });
  _blackhole ^= 8;
}

/**
 * Processor: coherent read of scalar params only.
 */
function processorWithinScalarsOnly(): void {
  processor.params.within((view) => {
    const g = view.gain;
    const c = view.cutoffHz;
    const d = view.drive;
    _blackhole ^= g > 0 && c > 0 && d >= 0 ? 16 : 32;
  });
}

/**
 * Processor: coherent read of scalars + eqBands array.
 */
function processorWithinScalarsAndArray(): void {
  processor.params.within((view) => {
    const g = view.gain;
    const c = view.cutoffHz;
    const bands = view.eqBands;

    let acc = 0;
    const len = bands.length;

    for (let i = 0; i < len; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      acc += bands[i]! * (i + 1);
    }

    _blackhole ^= g > 0 && c > 0 && acc > 0 ? 64 : 128;
  });
}

/**
 * Interleaved controller update + processor read.
 */
function interleavedControllerUpdateAndProcessorWithin(): void {
  controller.params.update({
    gain: 1.2,
    cutoffHz: 6_000,
    drive: 4.0,
  });

  processor.params.within((view) => {
    const sum = view.gain + view.cutoffHz * 1e-4 + view.drive;
    _blackhole ^= sum > 0 ? 256 : 512;
  });
}

describe('Parameter operations: controller ↔ processor', () => {
  bench(
    'controller.params.set (two scalars)',
    () => {
      paramsSetTwoScalars();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    'controller.params.update (3 scalars)',
    () => {
      paramsUpdateThreeScalars();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    'controller.params.update (3 scalars + f32[8])',
    () => {
      paramsUpdateScalarsAndStageArray();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    'controller.params.hydrate (3 scalars + f32[8])',
    () => {
      paramsHydrateScalarsAndArray();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    'controller.params.stage (eqBands f32[8])',
    () => {
      paramsStageArrayOnly();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    'processor.params.within (scalars only)',
    () => {
      processorWithinScalarsOnly();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    'processor.params.within (scalars + eqBands f32[8])',
    () => {
      processorWithinScalarsAndArray();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    'interleaved controller.update + processor.within',
    () => {
      interleavedControllerUpdateAndProcessorWithin();
    },
    MICRO_BENCH_OPTS,
  );
});
