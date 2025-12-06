import { bench, describe } from "vitest";

import { MICRO_BENCH_OPTS } from "../../../scripts/vitest/bench-presets";
import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  receiveHandoff,
} from "../src";

/**
 * @fileoverview
 * Parameter operations under mixed controller/processor load.
 *
 * Uses a DJ-style lane spec (transport, filter, EQ, meters) to exercise
 * realistic hot paths on both sides of the binding.
 */

const spec = defineSpec(({ param, meter }) => ({
  id: "bench/param-operations",
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
const controller = bindController(spec, plan, backing);
const handoff = buildHandoff(plan, backing);
const received = receiveHandoff(handoff);
const processor = bindProcessor(received);

const eqWriteBuffer = new Float32Array(8);
for (let i = 0; i < eqWriteBuffer.length; i++) {
  eqWriteBuffer[i] = 0.5 + i * 0.01;
}

/** Scalar-only update via set(): gain + cutoffHz. */
function paramsSetTwoScalars(): void {
  controller.params.set("gain", 1.0);
  controller.params.set("cutoffHz", 4_000);
}

/** Batch update of three scalar params via update(). */
function paramsUpdateThreeScalars(): void {
  controller.params.update({
    gain: 1.0,
    cutoffHz: 4_000,
    drive: 3.5,
  });
}

/**
 * Update three scalars via update() and eqBands f32[8] via stage().
 * Arrays always use stage(), never update().
 */
function paramsUpdateScalarsAndStageArray(): void {
  // Scalars via update()
  controller.params.update({
    gain: 0.8,
    cutoffHz: 8_000,
    drive: 5.0,
  });

  // Array via stage()
  controller.params.stage("eqBands", (view) => {
    const len = view.length;

    for (let i = 0; i < len; i++) {
      view[i] = eqWriteBuffer[i] ?? 0;
    }
  });
}

/** Bulk hydrate of three scalars + eqBands f32[8] via params.hydrate(), mirroring paramsUpdateScalarsAndStageArray(). */
function paramsHydrateScalarsAndArray(): void {
  controller.params.hydrate({
    gain: 0.8,
    cutoffHz: 8_000,
    drive: 5.0,
    eqBands: eqWriteBuffer,
  });
}

/** Array-only write of eqBands via stage(). */
function paramsStageArrayOnly(): void {
  controller.params.stage("eqBands", (view) => {
    const len = view.length;

    for (let i = 0; i < len; i++) {
      view[i] = eqWriteBuffer[i] ?? 0;
    }
  });
}

/** Processor-side coherent read of scalar params only. */
function processorWithinScalarsOnly(): void {
  processor.params.within((view) => {
    const _g = view.gain;
    const _c = view.cutoffHz;
    const _d = view.drive;
  });
}

/** Processor-side coherent read of scalar params and the eqBands array. */
function processorWithinScalarsAndArray(): void {
  processor.params.within((view) => {
    const _g = view.gain;
    const _c = view.cutoffHz;
    const bands = view.eqBands;

    let _acc = 0;
    const len = bands.length;

    for (let i = 0; i < len; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      _acc += bands[i]! * (i + 1);
    }
  });
}

/** Interleaved controller update and processor read. */
function interleavedControllerUpdateAndProcessorWithin(): void {
  controller.params.update({
    gain: 1.2,
    cutoffHz: 6_000,
    drive: 4.0,
  });

  processor.params.within((view) => {
    const _sum = view.gain + view.cutoffHz * 1e-4 + view.drive;
  });
}

describe("Parameter operations: DJ-style controller ↔ processor", () => {
  bench(
    "controller.params.set (two scalars)",
    () => {
      paramsSetTwoScalars();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    "controller.params.update (3 scalars)",
    () => {
      paramsUpdateThreeScalars();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    "controller.params.update (3 scalars + f32[8])",
    () => {
      paramsUpdateScalarsAndStageArray();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    "controller.params.hydrate (3 scalars + f32[8])",
    () => {
      paramsHydrateScalarsAndArray();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    "controller.params.stage (eqBands f32[8])",
    () => {
      paramsStageArrayOnly();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    "processor.params.within (scalars only)",
    () => {
      processorWithinScalarsOnly();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    "processor.params.within (scalars + eqBands f32[8])",
    () => {
      processorWithinScalarsAndArray();
    },
    MICRO_BENCH_OPTS,
  );

  bench(
    "interleaved controller.update + processor.within",
    () => {
      interleavedControllerUpdateAndProcessorWithin();
    },
    MICRO_BENCH_OPTS,
  );
});
