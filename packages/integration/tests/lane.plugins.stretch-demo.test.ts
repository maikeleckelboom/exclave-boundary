import {
  acceptHandoff,
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  type ProcessorBinding,
} from "@seqlok/core";
import { describe, expect, it } from "vitest";

import type { LanePluginPack, LaneProcessorPlugin } from "../src";

/**
 * Demo lane-plugin spec used by this test.
 *
 * The authored input remains structural. Semantic compilation lowers it to the
 * canonical runtime key `stretch.mix`.
 */
const stretchDemoSpec = defineSpec({
  params: {
    stretch: {
      mix: {
        kind: "f32" as const,
        min: 0,
        max: 1,
      },
    },
  },
  meters: {},
});

type StretchDemoSpec = typeof stretchDemoSpec;

/**
 * Minimal processor plugin used to prove end-to-end parameter flow through the
 * Seqlok lane pipeline.
 *
 * The plugin reads the canonical `stretch.mix` parameter once per block and
 * applies it as a wet gain to the output buffers.
 */
const stretchMixProcessorPlugin: LaneProcessorPlugin<StretchDemoSpec> = {
  id: "stretch-mix-gain",

  /**
   * Attaches the processor-side runtime for the demo plugin.
   *
   * The returned handle exposes a single `processBlock` function because this
   * test only needs deterministic block processing over caller-provided buffers.
   */
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
      /**
       * Processes one audio block using the current coherent parameter snapshot.
       *
       * `stretch.mix` is interpreted as a simple wet gain:
       * - `0` mutes the signal
       * - `0.5` halves the signal
       * - `1` passes the signal through unchanged
       */
      processBlock(
        inputL: Float32Array,
        inputR: Float32Array,
        outputL: Float32Array,
        outputR: Float32Array,
      ): void {
        const frames = inputL.length;

        let wet = 1;

        binding.params.within((params) => {
          wet = params["stretch.mix"];
        });

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

/**
 * Test-local plugin pack containing only the processor plugin under test.
 */
const stretchDemoPack: LanePluginPack<StretchDemoSpec> = {
  observers: [],
  processors: [stretchMixProcessorPlugin],
};

describe("LaneProcessorPlugin stretch.mix demo", () => {
  it("applies stretch.mix as a wet gain on stereo buffers", () => {
    /**
     * Build the real Seqlok runtime path:
     * spec -> plan -> shared backing -> controller/handoff -> processor binding.
     */
    const plan = planLayout(stretchDemoSpec);
    const backing = allocateShared(plan);

    const controller = bindController(stretchDemoSpec, plan, backing);
    const handoff = buildHandoff(plan, backing);

    const accepted = acceptHandoff(handoff);
    const binding = bindProcessor(accepted);

    const plugin = stretchDemoPack.processors[0];
    if (!plugin) {
      throw new Error("expected stretch plugin");
    }

    const handle = plugin.attachProcessor(binding);

    /**
     * Block 1:
     * `stretch.mix = 0` should fully mute both channels.
     */
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

    /**
     * Block 2:
     * `stretch.mix = 0.5` should attenuate both channels by half.
     */
    controller.params.set("stretch.mix", 0.5);

    const inL2 = new Float32Array(frames).fill(0.5);
    const inR2 = new Float32Array(frames).fill(0.25);
    const outL2 = new Float32Array(frames);
    const outR2 = new Float32Array(frames);

    handle.processBlock(inL2, inR2, outL2, outR2);

    for (let i = 0; i < frames; i += 1) {
      expect(outL2[i]).toBeCloseTo(0.5 * 0.5);
      expect(outR2[i]).toBeCloseTo(0.25 * 0.5);
    }
  });
});
