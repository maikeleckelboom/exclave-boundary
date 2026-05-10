import { describe, it, expectTypeOf } from "vitest";

import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  acceptHandoff,
  bindController,
  bindProcessor,
} from "../../src";

import type {
  ControllerParams,
  ControllerMeters,
  ProcessorBinding,
} from "../../src/binding/common/types";

describe("BindController / BindProcessor: Inference Contracts", () => {
  it("bindController returns correctly-typed params/meters", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "lane" as const,
      params: { rate: param.f32({ min: 0.25, max: 4 }) },
      meters: { fps: meter.f32() },
    }));
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, plan, backing);
    expectTypeOf(ctl.params).toEqualTypeOf<ControllerParams<typeof spec>>();
    expectTypeOf(ctl.meters).toEqualTypeOf<ControllerMeters<typeof spec>>();
  });

  it("bindProcessor infers ProcessorBinding from handoff", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "demo" as const,
      params: { timeRatio: param.f32({ min: 0.5, max: 2 }) },
      meters: { rms: meter.f32() },
    }));

    type DemoSpec = typeof spec;

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const handoff = buildHandoff(plan, backing);

    const accepted = acceptHandoff(handoff);
    const procA = bindProcessor(accepted);
    expectTypeOf(procA).toEqualTypeOf<ProcessorBinding<DemoSpec>>();
  });
});
