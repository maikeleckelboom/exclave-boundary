import {
  ADAPTER_MODES,
  enumIndex,
  RUNTIME_STATES,
  type RuntimeState,
} from "../types";

import type { signalsmithStretchSpec } from "../boundary/specs";
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
  readonly scheduledCommandDroppedTotal: number;
  readonly scheduledCommandQueueSize: number;
  readonly sessionId: number;
  readonly sourceFrame: number;
  readonly staleReadTotal: number;
  readonly state: RuntimeState;
  readonly underrunTotal: number;
  readonly workletGeneration: number;
}

export function publishRuntimeMeters(
  runtime: ProcessorBinding<typeof signalsmithStretchSpec>,
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
    writer.set("runtime.adapterMode", enumIndex(ADAPTER_MODES, "real-worklet"));
    writer.set("runtime.audioWorkletFrameHi", frame.hi);
    writer.set("runtime.audioWorkletFrameLo", frame.lo);
    writer.set(
      "runtime.audioWorkletTimeSeconds",
      input.audioWorkletTimeSeconds,
    );
    writer.set("runtime.blockSamples", input.blockSamples);
    writer.set("runtime.bufferReadyFrames", input.bufferReadyFrames);
    writer.set("runtime.bufferLengthFrames", input.bufferLengthFrames);
    writer.set("runtime.commandDroppedTotal", input.commandDroppedTotal);
    writer.set("runtime.durationFrames", input.durationFrames);
    writer.set("runtime.durationSeconds", input.durationSeconds);
    writer.set("runtime.effectiveRate", input.effectiveRate);
    writer.set("runtime.heapGeneration", input.heapGeneration);
    writer.set("runtime.inputLatencyFrames", input.inputLatencyFrames);
    writer.set(
      "runtime.inputLatencySeconds",
      input.inputLatencyFrames / sampleRate,
    );
    writer.set("runtime.intervalSamples", input.intervalSamples);
    writer.set("runtime.invalidSampleTotal", input.invalidSampleTotal);
    writer.set("runtime.invalidTransitionTotal", input.invalidTransitionTotal);
    writer.set(
      "runtime.lastAppliedCommandSequence",
      input.lastAppliedCommandSequence,
    );
    writer.set(
      "runtime.lastAppliedConfigSequence",
      input.lastAppliedConfigSequence,
    );
    writer.set(
      "runtime.lastAppliedDesiredSequence",
      input.lastAppliedDesiredSequence,
    );
    writer.set("runtime.lastErrorCode", input.lastErrorCode);
    writer.set("runtime.loopEnabled", input.loopEnabled);
    writer.set("runtime.loopEndFrame", input.loopEndFrame);
    writer.set("runtime.loopRevision", input.loopRevision);
    writer.set("runtime.loopStartFrame", input.loopStartFrame);
    writer.set(
      "runtime.maxObservedRenderQuantum",
      input.maxObservedRenderQuantum,
    );
    writer.set("runtime.outputFrame", input.outputFrame);
    writer.set("runtime.outputLatencyFrames", input.outputLatencyFrames);
    writer.set(
      "runtime.outputLatencySeconds",
      input.outputLatencyFrames / sampleRate,
    );
    writer.set("runtime.processingCenterFrame", input.processingCenterFrame);
    writer.set(
      "runtime.scheduledCommandDroppedTotal",
      input.scheduledCommandDroppedTotal,
    );
    writer.set(
      "runtime.scheduledCommandQueueSize",
      input.scheduledCommandQueueSize,
    );
    writer.set("runtime.sessionId", input.sessionId);
    writer.set("runtime.sourceFrame", input.sourceFrame);
    writer.set("runtime.staleReadTotal", input.staleReadTotal);
    writer.set("runtime.state", enumIndex(RUNTIME_STATES, input.state));
    writer.set("runtime.underrunTotal", input.underrunTotal);
    writer.set("runtime.workletGeneration", input.workletGeneration);
  });
}

function splitU64(value: number): { readonly hi: number; readonly lo: number } {
  const whole = Math.max(0, Math.floor(value));

  return {
    hi: Math.floor(whole / 0x100000000) >>> 0,
    lo: whole >>> 0,
  };
}
