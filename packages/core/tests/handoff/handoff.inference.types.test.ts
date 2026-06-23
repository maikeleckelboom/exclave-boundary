import { describe, it, expectTypeOf } from "vitest";

import { allocateShared } from "../../src/backing/allocate-shared";
import { bindProcessor } from "../../src/binding/processor";
import { buildHandoff, acceptHandoff } from "../../src/handoff/handoff";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

import type { ProcessorBinding } from "../../src/binding/common/types";
import type { Handoff, AcceptedHandoff } from "../../src/handoff/types";

describe("Typed Handoff → acceptHandoff → bindProcessor: Inference Contracts", () => {
  it("preserves DemoSpec through the pipeline", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "demo",
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

    // Verify compile-time type inference: the produced envelope is Handoff<DemoSpec>.
    expectTypeOf<typeof handoff>().toExtend<Handoff<DemoSpec>>();

    const accepted = acceptHandoff(handoff);
    // Verify compile-time type inference: acceptHandoff infers <DemoSpec> from Handoff<DemoSpec>.
    expectTypeOf<typeof accepted>().toExtend<AcceptedHandoff<DemoSpec>>();
    expectTypeOf<AcceptedHandoff<DemoSpec>>().toExtend<typeof accepted>();

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const proc = bindProcessor(accepted);
    expectTypeOf<typeof proc>().toExtend<ProcessorBinding<DemoSpec>>();
    expectTypeOf<ProcessorBinding<DemoSpec>>().toExtend<typeof proc>();
  });
});
