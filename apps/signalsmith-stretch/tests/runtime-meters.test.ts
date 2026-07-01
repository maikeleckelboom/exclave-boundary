import {
  acceptHandoff,
  allocatePacked,
  bindController,
  bindProcessor,
  buildHandoff,
  planLayout,
} from "@exclave/boundary";
import { describe, expect, it } from "vitest";

import { signalsmithStretchSpec } from "../src/boundary/specs";
import { ADAPTER_MODES, enumIndex, RUNTIME_STATES } from "../src/types";
import {
  publishRuntimeMeters,
  runtimeMeterValues,
  type RuntimeMeterInput,
} from "../src/worklet/runtime-meters";

describe("Signalsmith runtime meter publishing", () => {
  it("builds explicit runtime group values from Worklet input", () => {
    const values = runtimeMeterValues(runtimeInput());

    expect(values.adapterMode).toBe(enumIndex(ADAPTER_MODES, "real-worklet"));
    expect(values.audioWorkletFrameHi).toBe(1);
    expect(values.audioWorkletFrameLo).toBe(5);
    expect(values.inputLatencySeconds).toBeCloseTo(0.1);
    expect(values.inputWindowMissingFrames).toBe(17);
    expect(values.loopSourceFrameInside).toBe(true);
    expect(values.loopStartMissingFrames).toBe(23);
    expect(values.loopEndMissingFrames).toBe(29);
    expect(values.outputLatencySeconds).toBeCloseTo(0.025);
    expect(values.state).toBe(enumIndex(RUNTIME_STATES, "playing"));
  });

  it("publishes runtime values through one coherent meter publish section", () => {
    const plan = planLayout(signalsmithStretchSpec);
    const backing = allocatePacked(plan);
    const controller = bindController(signalsmithStretchSpec, plan, backing);
    const processor = bindProcessor(acceptHandoff(buildHandoff(plan, backing)));
    const startVersion = controller.meters.version();

    publishRuntimeMeters(processor, runtimeInput());

    expect(controller.meters.version()).toBe(startVersion + 1);

    const meters = controller.meters.snapshot(
      "runtime.adapterMode",
      "runtime.audioWorkletFrameHi",
      "runtime.audioWorkletFrameLo",
      "runtime.blockSamples",
      "runtime.inputLatencySeconds",
      "runtime.inputWindowMissingFrames",
      "runtime.loopSourceFrameInside",
      "runtime.loopStartMissingFrames",
      "runtime.loopEndMissingFrames",
      "runtime.outputLatencySeconds",
      "runtime.state",
    );

    expect(meters["runtime.adapterMode"]).toBe(
      enumIndex(ADAPTER_MODES, "real-worklet"),
    );
    expect(meters["runtime.audioWorkletFrameHi"]).toBe(1);
    expect(meters["runtime.audioWorkletFrameLo"]).toBe(5);
    expect(meters["runtime.blockSamples"]).toBe(128);
    expect(meters["runtime.inputLatencySeconds"]).toBeCloseTo(0.1);
    expect(meters["runtime.inputWindowMissingFrames"]).toBe(17);
    expect(meters["runtime.loopSourceFrameInside"]).toBe(true);
    expect(meters["runtime.loopStartMissingFrames"]).toBe(23);
    expect(meters["runtime.loopEndMissingFrames"]).toBe(29);
    expect(meters["runtime.outputLatencySeconds"]).toBeCloseTo(0.025);
    expect(meters["runtime.state"]).toBe(enumIndex(RUNTIME_STATES, "playing"));
  });
});

function runtimeInput(): RuntimeMeterInput {
  return {
    audioWorkletFrame: 0x1_0000_0000 + 5,
    audioWorkletTimeSeconds: 12.5,
    blockSamples: 128,
    bufferLengthFrames: 7_200,
    bufferReadyFrames: 6_912,
    commandDroppedTotal: 2,
    durationFrames: 48_000,
    durationSeconds: 1,
    effectiveRate: 1.25,
    heapGeneration: 3,
    inputLatencyFrames: 4_800,
    inputWindowMissingFrames: 17,
    intervalSamples: 1_440,
    invalidSampleTotal: 4,
    invalidTransitionTotal: 5,
    lastAppliedCommandSequence: 6,
    lastAppliedConfigSequence: 7,
    lastAppliedDesiredSequence: 8,
    lastErrorCode: 0,
    loopEnabled: true,
    loopEndFrame: 44_100,
    loopEndMissingFrames: 29,
    loopRevision: 9,
    loopSourceFrameInside: true,
    loopStartFrame: 1_024,
    loopStartMissingFrames: 23,
    maxObservedRenderQuantum: 128,
    outputFrame: 12_345,
    outputLatencyFrames: 1_200,
    processingCenterFrame: 13_545,
    scheduledCommandDroppedTotal: 10,
    scheduledCommandQueueSize: 2,
    sessionId: 11,
    sourceFrame: 22_222,
    staleReadTotal: 12,
    state: "playing",
    underrunTotal: 13,
    workletGeneration: 14,
  };
}
