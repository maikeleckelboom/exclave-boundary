import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  type ProcessorBinding,
  receiveHandoff,
} from "@seqlok/core";
import { describe, expect, it } from "vitest";

import type { LanePluginPack, LaneProcessorPlugin } from "../src"; // packages/integration/src/index.ts

//
// Spec: single scalar param "stretch.mix" (0..1), no meters.
//

const stretchDemoSpec = defineSpec({
  params: {
    "stretch.mix": {
      kind: "f32" as const,
      min: 0,
      max: 1,
    },
  },
  meters: {},
});

type StretchDemoSpec = typeof stretchDemoSpec;

//
// Processor plugin: treat "stretch.mix" as simple wet gain on stereo.
//

const stretchMixProcessorPlugin: LaneProcessorPlugin<StretchDemoSpec> = {
  id: "stretch-mix-gain",

  attachProcessor(binding: ProcessorBinding<StretchDemoSpec>): {
    readonly processBlock: (
      inputL: Float32Array,
      inputR: Float32Array,
      outputL: Float32Array,
      outputR: Float32Array,
    ) => void;
    readonly dispose?: () => void;
  } {
    return {
      processBlock(
        inputL: Float32Array,
        inputR: Float32Array,
        outputL: Float32Array,
        outputR: Float32Array,
      ): void {
        const frames = inputL.length;

        // 1) Coherent param read for this block.
        let wet = 1;

        binding.params.within((params) => {
          wet = params["stretch.mix"];
        });

        // 2) Apply wet gain (no dry path for this demo).
        const channels = inputR.length > 0 && outputR.length > 0 ? 2 : 1;

        if (channels >= 1) {
          for (let i = 0; i < frames; i += 1) {
            outputL[i] = (inputL[i] ?? 0) * wet;
          }
        }

        if (channels >= 2) {
          for (let i = 0; i < frames; i += 1) {
            outputR[i] = (inputR[i] ?? 0) * wet;
          }
        }
      },
    };
  },
};

const stretchDemoPack: LanePluginPack<StretchDemoSpec> = {
  observers: [],
  processors: [stretchMixProcessorPlugin],
};

//
// Test harness: real Seqlok pipeline + plugin driving actual buffers.
//

describe("LaneProcessorPlugin stretch.mix demo", () => {
  it("applies stretch.mix as a wet gain on stereo buffers", () => {
    // Core Seqlok pipeline: spec → plan → backing → controller / handoff / processor

    const plan = planLayout(stretchDemoSpec);
    const backing = allocateShared(plan);

    const controller = bindController(stretchDemoSpec, plan, backing);
    const handoff = buildHandoff(plan, backing);

    const received = receiveHandoff(handoff);
    const binding = bindProcessor(received);

    // Plugin handle

    const plugin = stretchDemoPack.processors[0];
    if (!plugin) {
      throw new Error("expected stretch plugin");
    }

    const handle = plugin.attachProcessor(binding);

    // Block 1: mix = 0 → full silence

    controller.params.set("stretch.mix", 0);

    const frames = 8;

    const inL1 = new Float32Array(frames).fill(0.5);
    const inR1 = new Float32Array(frames).fill(0.25);
    const outL1 = new Float32Array(frames);
    const outR1 = new Float32Array(frames);

    handle.processBlock(inL1, inR1, outL1, outR1);

    for (let i = 0; i < frames; i += 1) {
      expect(outL1[i]).toBeCloseTo(0);
      expect(outR1[i]).toBeCloseTo(0);
    }

    // Block 2: mix = 0.5 → attenuate inputs by 0.5.

    controller.params.set("stretch.mix", 0.5);

    const inL2 = new Float32Array(frames).fill(0.5);
    const inR2 = new Float32Array(frames).fill(0.25);
    const outL2 = new Float32Array(frames);
    const outR2 = new Float32Array(frames);

    handle.processBlock(inL2, inR2, outL2, outR2);

    for (let i = 0; i < frames; i += 1) {
      expect(outL2[i]).toBeCloseTo(0.5 * 0.5); // 0.25
      expect(outR2[i]).toBeCloseTo(0.25 * 0.5); // 0.125
    }
  });
});
