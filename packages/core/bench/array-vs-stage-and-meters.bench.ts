import { bench, describe } from "vitest";

import { MICRO_BENCH_OPTS } from "../../../scripts/vitest/bench-presets";
import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  acceptHandoff,
} from "../src";

/**
 * @fileoverview
 * Micro-benchmarks for MeterWriter sugar vs the generic meter API.
 *
 * Compares scalar writes (`writer.level(v)` vs `writer.set('level', v)`)
 * and array writes (`writer.stage('spectrum', cb)`).
 *
 * The goal is to quantify the overhead of the ergonomic MeterWriter helpers
 * in isolation, without seqlock or controller logic in the way.
 */

describe("MeterWriter sugar: set vs stage, direct vs named", () => {
  const spec = defineSpec(({ param, meter }) => ({
    id: "bench/meter-writer-sugar",
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
  const controller = bindController(spec, plan, backing);
  const handoff = buildHandoff(plan, backing);
  const accepted = acceptHandoff(handoff);
  const processor = bindProcessor(accepted);

  // Keep meters live with a dummy param write.
  controller.params.set("dummy", 0.5);

  // Shared source buffer for spectrum writes.
  const spectrumSource = new Float32Array(512);
  spectrumSource.fill(0.5);

  // Scalar meter write via writer.level(v) vs writer.set('level', v).
  bench(
    "meter scalar: writer.level(0.75)",
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
        writer.set("level", 0.75);
      });
    },
    MICRO_BENCH_OPTS,
  );

  // Array meter write via writer.stage('spectrum', cb).
  bench(
    "meter array: writer.stage('spectrum', cb)",
    () => {
      processor.meters.publish((writer) => {
        writer.stage("spectrum", (dest) => {
          dest.set(spectrumSource);
        });
      });
    },
    MICRO_BENCH_OPTS,
  );
});
