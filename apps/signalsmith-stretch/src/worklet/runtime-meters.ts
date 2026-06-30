import {
  ADAPTER_MODES,
  enumIndex,
  RUNTIME_STATES,
  type RuntimeState,
} from "../types";

import type { signalsmithStretchSpec } from "../boundary/specs";
import type { MeterGroupValues, ProcessorBinding } from "@exclave/boundary";

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

export type RuntimeMeterValues = MeterGroupValues<
  typeof signalsmithStretchSpec,
  "runtime"
>;

export function runtimeMeterValues(
  input: RuntimeMeterInput,
): RuntimeMeterValues {
  const frame = splitU64(input.audioWorkletFrame);
  const sampleRate = Math.max(
    1,
    input.durationSeconds > 0
      ? input.durationFrames / input.durationSeconds
      : 48_000,
  );
  const adapterMode = enumIndex(ADAPTER_MODES, "real-worklet");
  const inputLatencySeconds = input.inputLatencyFrames / sampleRate;
  const outputLatencySeconds = input.outputLatencyFrames / sampleRate;
  const state = enumIndex(RUNTIME_STATES, input.state);

  return {
    adapterMode,
    audioWorkletFrameHi: frame.hi,
    audioWorkletFrameLo: frame.lo,
    audioWorkletTimeSeconds: input.audioWorkletTimeSeconds,
    blockSamples: input.blockSamples,
    bufferLengthFrames: input.bufferLengthFrames,
    bufferReadyFrames: input.bufferReadyFrames,
    commandDroppedTotal: input.commandDroppedTotal,
    durationFrames: input.durationFrames,
    durationSeconds: input.durationSeconds,
    effectiveRate: input.effectiveRate,
    heapGeneration: input.heapGeneration,
    inputLatencyFrames: input.inputLatencyFrames,
    inputLatencySeconds,
    intervalSamples: input.intervalSamples,
    invalidSampleTotal: input.invalidSampleTotal,
    invalidTransitionTotal: input.invalidTransitionTotal,
    lastAppliedCommandSequence: input.lastAppliedCommandSequence,
    lastAppliedConfigSequence: input.lastAppliedConfigSequence,
    lastAppliedDesiredSequence: input.lastAppliedDesiredSequence,
    lastErrorCode: input.lastErrorCode,
    loopEnabled: input.loopEnabled,
    loopEndFrame: input.loopEndFrame,
    loopRevision: input.loopRevision,
    loopStartFrame: input.loopStartFrame,
    maxObservedRenderQuantum: input.maxObservedRenderQuantum,
    outputFrame: input.outputFrame,
    outputLatencyFrames: input.outputLatencyFrames,
    outputLatencySeconds,
    processingCenterFrame: input.processingCenterFrame,
    scheduledCommandDroppedTotal: input.scheduledCommandDroppedTotal,
    scheduledCommandQueueSize: input.scheduledCommandQueueSize,
    sessionId: input.sessionId,
    sourceFrame: input.sourceFrame,
    staleReadTotal: input.staleReadTotal,
    state,
    underrunTotal: input.underrunTotal,
    workletGeneration: input.workletGeneration,
  };
}

export function publishRuntimeMeters(
  runtime: ProcessorBinding<typeof signalsmithStretchSpec>,
  input: RuntimeMeterInput,
): void {
  runtime.meters.publishGroup("runtime", runtimeMeterValues(input));
}

function splitU64(value: number): { readonly hi: number; readonly lo: number } {
  const whole = Math.max(0, Math.floor(value));

  return {
    hi: Math.floor(whole / 0x100000000) >>> 0,
    lo: whole >>> 0,
  };
}
