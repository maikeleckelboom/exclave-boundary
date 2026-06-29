import {
  ADAPTER_MODES,
  enumIndex,
  RUNTIME_STATES,
  type RuntimeState,
} from "../types";

import type { runtimeStatusSpec } from "../boundary/specs";
import type { ProcessorBinding } from "@exclave/boundary";

export interface RuntimeMeterInput {
  readonly audioWorkletFrame: number;
  readonly audioWorkletTimeSeconds: number;
  readonly blockSamples: number;
  readonly bufferLengthFrames: number;
  readonly bufferReadyFrames: number;
  readonly commandDroppedTotal: number;
  readonly durationFrames: number;
  readonly durationSeconds: number;
  readonly effectiveRate: number;
  readonly heapGeneration: number;
  readonly inputLatencyFrames: number;
  readonly intervalSamples: number;
  readonly invalidSampleTotal: number;
  readonly invalidTransitionTotal: number;
  readonly lastAppliedCommandSequence: number;
  readonly lastAppliedConfigSequence: number;
  readonly lastAppliedDesiredSequence: number;
  readonly lastErrorCode: number;
  readonly loopEnabled: boolean;
  readonly loopEndFrame: number;
  readonly loopRevision: number;
  readonly loopStartFrame: number;
  readonly maxObservedRenderQuantum: number;
  readonly outputFrame: number;
  readonly outputLatencyFrames: number;
  readonly processingCenterFrame: number;
  readonly sessionId: number;
  readonly sourceFrame: number;
  readonly staleReadTotal: number;
  readonly state: RuntimeState;
  readonly underrunTotal: number;
  readonly workletGeneration: number;
}

export function publishRuntimeMeters(
  runtime: ProcessorBinding<typeof runtimeStatusSpec>,
  input: RuntimeMeterInput,
): void {
  const frame = splitU64(input.audioWorkletFrame);
  const sampleRate = Math.max(
    1,
    input.durationSeconds > 0
      ? input.durationFrames / input.durationSeconds
      : 48_000,
  );

  runtime.meters.publish((writer) => {
    writer.set("adapterMode", enumIndex(ADAPTER_MODES, "real-worklet"));
    writer.set("audioWorkletFrameHi", frame.hi);
    writer.set("audioWorkletFrameLo", frame.lo);
    writer.set("audioWorkletTimeSeconds", input.audioWorkletTimeSeconds);
    writer.set("blockSamples", input.blockSamples);
    writer.set("bufferReadyFrames", input.bufferReadyFrames);
    writer.set("bufferLengthFrames", input.bufferLengthFrames);
    writer.set("commandDroppedTotal", input.commandDroppedTotal);
    writer.set("durationFrames", input.durationFrames);
    writer.set("durationSeconds", input.durationSeconds);
    writer.set("effectiveRate", input.effectiveRate);
    writer.set("heapGeneration", input.heapGeneration);
    writer.set("inputLatencyFrames", input.inputLatencyFrames);
    writer.set("inputLatencySeconds", input.inputLatencyFrames / sampleRate);
    writer.set("intervalSamples", input.intervalSamples);
    writer.set("invalidSampleTotal", input.invalidSampleTotal);
    writer.set("invalidTransitionTotal", input.invalidTransitionTotal);
    writer.set("lastAppliedCommandSequence", input.lastAppliedCommandSequence);
    writer.set("lastAppliedConfigSequence", input.lastAppliedConfigSequence);
    writer.set("lastAppliedDesiredSequence", input.lastAppliedDesiredSequence);
    writer.set("lastErrorCode", input.lastErrorCode);
    writer.set("loopEnabled", input.loopEnabled);
    writer.set("loopEndFrame", input.loopEndFrame);
    writer.set("loopRevision", input.loopRevision);
    writer.set("loopStartFrame", input.loopStartFrame);
    writer.set("maxObservedRenderQuantum", input.maxObservedRenderQuantum);
    writer.set("outputFrame", input.outputFrame);
    writer.set("outputLatencyFrames", input.outputLatencyFrames);
    writer.set("outputLatencySeconds", input.outputLatencyFrames / sampleRate);
    writer.set("processingCenterFrame", input.processingCenterFrame);
    writer.set("sessionId", input.sessionId);
    writer.set("sourceFrame", input.sourceFrame);
    writer.set("staleReadTotal", input.staleReadTotal);
    writer.set("state", enumIndex(RUNTIME_STATES, input.state));
    writer.set("underrunTotal", input.underrunTotal);
    writer.set("workletGeneration", input.workletGeneration);
  });
}

function splitU64(value: number): { readonly hi: number; readonly lo: number } {
  const whole = Math.max(0, Math.floor(value));

  return {
    hi: Math.floor(whole / 0x100000000) >>> 0,
    lo: whole >>> 0,
  };
}
