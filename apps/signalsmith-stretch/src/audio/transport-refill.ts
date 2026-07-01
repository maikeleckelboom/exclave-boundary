import { calculateSignalsmithSourceWindow } from "../worklet/source-window-position";

import type { RuntimeStatusSnapshot, SourceStatusSnapshot } from "../types";

export type TransportRefillReason = "ahead-low" | "current-window-missing";

export interface TransportRefillDecision {
  readonly aheadFrames: number;
  readonly frameCount: number;
  readonly inputWindowEndFrame: number;
  readonly inputWindowStartFrame: number;
  readonly reason: TransportRefillReason;
  readonly safeFloorFrames: number;
  readonly startFrame: number;
  readonly targetAheadFrames: number;
}

export interface TransportRefillInput {
  readonly active: boolean;
  readonly expectedBufferEndFrame?: number;
  readonly runtime: RuntimeStatusSnapshot;
  readonly sourceFrameCount: number;
  readonly sourceSampleRate: number;
  readonly sourceStatus: SourceStatusSnapshot;
}

const CURRENT_WINDOW_OVERLAP_FRAMES = 512;
const MIN_CHUNK_SECONDS = 4;
const MIN_SAFE_FLOOR_SECONDS = 8;
const TARGET_AHEAD_SECONDS = 24;

export function chooseTransportRefill(
  input: TransportRefillInput,
): TransportRefillDecision | null {
  if (!input.active) {
    return null;
  }

  const sourceFrameCount = clampFrame(
    input.sourceFrameCount,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const sampleRate = Math.max(1, Math.floor(input.sourceSampleRate));

  if (sourceFrameCount <= 0) {
    return null;
  }

  const window = calculateSignalsmithSourceWindow({
    audibleSourceFrame: input.runtime.sourceFrame,
    bufferLengthFrames: input.runtime.bufferLengthFrames,
    effectiveRate: input.runtime.effectiveRate,
    inputLatencyFrames: input.runtime.inputLatencyFrames,
    outputLatencyFrames: input.runtime.outputLatencyFrames,
  });
  const inputWindowStartFrame = clampFrame(
    window.inputWindowStartFrame,
    0,
    sourceFrameCount,
  );
  const inputWindowEndFrame = clampFrame(
    window.inputWindowEndFrame,
    0,
    sourceFrameCount,
  );
  const observedBufferStartFrame = clampFrame(
    input.sourceStatus.bufferStartFrame,
    0,
    sourceFrameCount,
  );
  const observedBufferEndFrame = Math.max(
    clampFrame(input.sourceStatus.bufferEndFrame, 0, sourceFrameCount),
    clampFrame(input.expectedBufferEndFrame ?? 0, 0, sourceFrameCount),
  );
  const safeFloorFrames = calculateSafeFloorFrames(input.runtime, sampleRate);
  const targetAheadFrames = Math.max(
    safeFloorFrames * 2,
    Math.floor(sampleRate * TARGET_AHEAD_SECONDS),
  );
  const aheadFrames = Math.max(0, observedBufferEndFrame - inputWindowEndFrame);

  if (
    observedBufferStartFrame > inputWindowStartFrame ||
    observedBufferEndFrame < inputWindowEndFrame
  ) {
    return createDecision({
      aheadFrames,
      inputWindowEndFrame,
      inputWindowStartFrame,
      reason: "current-window-missing",
      safeFloorFrames,
      sourceFrameCount,
      sourceSampleRate: sampleRate,
      startFrame: inputWindowStartFrame - CURRENT_WINDOW_OVERLAP_FRAMES,
      targetAheadFrames,
      runtime: input.runtime,
    });
  }

  if (aheadFrames < targetAheadFrames) {
    return createDecision({
      aheadFrames,
      inputWindowEndFrame,
      inputWindowStartFrame,
      reason: "ahead-low",
      safeFloorFrames,
      sourceFrameCount,
      sourceSampleRate: sampleRate,
      startFrame: observedBufferEndFrame,
      targetAheadFrames,
      runtime: input.runtime,
    });
  }

  return null;
}

function createDecision(input: {
  readonly aheadFrames: number;
  readonly inputWindowEndFrame: number;
  readonly inputWindowStartFrame: number;
  readonly reason: TransportRefillReason;
  readonly runtime: RuntimeStatusSnapshot;
  readonly safeFloorFrames: number;
  readonly sourceFrameCount: number;
  readonly sourceSampleRate: number;
  readonly startFrame: number;
  readonly targetAheadFrames: number;
}): TransportRefillDecision | null {
  const startFrame = clampFrame(input.startFrame, 0, input.sourceFrameCount);
  const chunkFrames = calculateChunkFrames(input.runtime, input.sourceSampleRate);
  const frameCount = clampFrame(
    Math.min(chunkFrames, input.sourceFrameCount - startFrame),
    0,
    input.sourceFrameCount,
  );

  if (frameCount <= 0) {
    return null;
  }

  return {
    aheadFrames: input.aheadFrames,
    frameCount,
    inputWindowEndFrame: input.inputWindowEndFrame,
    inputWindowStartFrame: input.inputWindowStartFrame,
    reason: input.reason,
    safeFloorFrames: input.safeFloorFrames,
    startFrame,
    targetAheadFrames: input.targetAheadFrames,
  };
}

function calculateChunkFrames(
  runtime: RuntimeStatusSnapshot,
  sampleRate: number,
): number {
  return Math.max(
    Math.floor(sampleRate * MIN_CHUNK_SECONDS),
    runtime.bufferLengthFrames * 4,
    runtime.blockSamples + runtime.intervalSamples,
  );
}

function calculateSafeFloorFrames(
  runtime: RuntimeStatusSnapshot,
  sampleRate: number,
): number {
  return Math.max(
    Math.floor(sampleRate * MIN_SAFE_FLOOR_SECONDS),
    runtime.bufferLengthFrames * 4,
    runtime.inputLatencyFrames + runtime.outputLatencyFrames,
    runtime.blockSamples + runtime.intervalSamples,
  );
}

function clampFrame(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}
