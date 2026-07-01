import { wrapFrameIntoLoopRange } from "../loop/loop-normalization";
import { calculateSignalsmithSourceWindow } from "../worklet/source-window-position";

import type { RuntimeStatusSnapshot, SourceStatusSnapshot } from "../types";

export type TransportRefillReason =
  | "ahead-low"
  | "current-window-missing"
  | "loop-boundary-missing";
export type TransportBufferExpectationState =
  | "confirmed"
  | "none"
  | "speculative";

export interface TransportBufferExpectation {
  readonly endFrame: number;
  readonly sourceRevision: number;
  readonly state: TransportBufferExpectationState;
  readonly unconfirmedPumpCount: number;
}

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
const MAX_SPECULATIVE_EXPECTATION_PUMPS = 3;
const MIN_CHUNK_SECONDS = 4;
const MIN_SAFE_FLOOR_SECONDS = 8;
const TARGET_AHEAD_SECONDS = 24;

export function emptyTransportBufferExpectation(): TransportBufferExpectation {
  return {
    endFrame: 0,
    sourceRevision: 0,
    state: "none",
    unconfirmedPumpCount: 0,
  };
}

export function noteTransportChunkPosted(input: {
  readonly current: TransportBufferExpectation;
  readonly endFrame: number;
  readonly sourceFrameCount: number;
  readonly sourceRevision: number;
}): TransportBufferExpectation {
  return {
    endFrame: Math.max(
      clampFrame(input.current.endFrame, 0, input.sourceFrameCount),
      clampFrame(input.endFrame, 0, input.sourceFrameCount),
    ),
    sourceRevision: input.sourceRevision,
    state: "speculative",
    unconfirmedPumpCount: 0,
  };
}

export function reconcileTransportBufferExpectation(input: {
  readonly current: TransportBufferExpectation;
  readonly maxUnconfirmedPumpCount?: number;
  readonly sourceFrameCount: number;
  readonly sourceRevision: number;
  readonly sourceStatus: SourceStatusSnapshot;
}): TransportBufferExpectation {
  if (
    input.current.state === "none" ||
    input.current.sourceRevision !== input.sourceRevision ||
    input.sourceStatus.sourceRevision !== input.sourceRevision
  ) {
    return emptyTransportBufferExpectation();
  }

  const expectedEndFrame = clampFrame(
    input.current.endFrame,
    0,
    input.sourceFrameCount,
  );
  const observedEndFrame = clampFrame(
    input.sourceStatus.bufferEndFrame,
    0,
    input.sourceFrameCount,
  );

  if (observedEndFrame >= expectedEndFrame) {
    return {
      endFrame: expectedEndFrame,
      sourceRevision: input.sourceRevision,
      state: "confirmed",
      unconfirmedPumpCount: 0,
    };
  }

  if (input.current.state === "confirmed") {
    return emptyTransportBufferExpectation();
  }

  const unconfirmedPumpCount = input.current.unconfirmedPumpCount + 1;
  const maxUnconfirmedPumpCount =
    input.maxUnconfirmedPumpCount ?? MAX_SPECULATIVE_EXPECTATION_PUMPS;

  if (unconfirmedPumpCount > maxUnconfirmedPumpCount) {
    return emptyTransportBufferExpectation();
  }

  return {
    endFrame: expectedEndFrame,
    sourceRevision: input.sourceRevision,
    state: "speculative",
    unconfirmedPumpCount,
  };
}

export function speculativeTransportBufferEndFrame(
  expectation: TransportBufferExpectation,
): number {
  return expectation.state === "speculative" ? expectation.endFrame : 0;
}

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
  const observedBufferEndFrame = clampFrame(
    input.sourceStatus.bufferEndFrame,
    0,
    sourceFrameCount,
  );
  const effectiveBufferEndFrame = Math.max(
    observedBufferEndFrame,
    clampFrame(input.expectedBufferEndFrame ?? 0, 0, sourceFrameCount),
  );
  const safeFloorFrames = calculateSafeFloorFrames(input.runtime, sampleRate);
  const targetAheadFrames = Math.max(
    safeFloorFrames * 2,
    Math.floor(sampleRate * TARGET_AHEAD_SECONDS),
  );
  const observedAheadFrames = Math.max(
    0,
    observedBufferEndFrame - inputWindowEndFrame,
  );
  const effectiveAheadFrames = Math.max(
    0,
    effectiveBufferEndFrame - inputWindowEndFrame,
  );
  const loopEnabled =
    input.runtime.loopEnabled &&
    input.runtime.loopEndFrame > input.runtime.loopStartFrame;

  if (loopEnabled) {
    const loopStartFrame = clampFrame(
      input.runtime.loopStartFrame,
      0,
      sourceFrameCount,
    );
    const loopEndFrame = clampFrame(
      input.runtime.loopEndFrame,
      loopStartFrame,
      sourceFrameCount,
    );
    const loopRange = {
      endFrame: loopEndFrame,
      startFrame: loopStartFrame,
    };
    const chunkFrames = calculateChunkFrames(input.runtime, sampleRate);

    if (input.runtime.inputWindowMissingFrames > 0) {
      let startFrame =
        wrapFrameIntoLoopRange(inputWindowStartFrame, loopRange) -
        CURRENT_WINDOW_OVERLAP_FRAMES;

      if (
        inputWindowEndFrame > loopEndFrame &&
        input.runtime.loopStartMissingFrames > 0
      ) {
        startFrame = loopStartFrame;
      } else if (
        inputWindowStartFrame < loopStartFrame &&
        input.runtime.loopEndMissingFrames > 0
      ) {
        startFrame = Math.max(loopStartFrame, loopEndFrame - chunkFrames);
      }

      return createDecision({
        aheadFrames: 0,
        inputWindowEndFrame,
        inputWindowStartFrame,
        reason: "current-window-missing",
        safeFloorFrames,
        sourceFrameCount,
        sourceSampleRate: sampleRate,
        startFrame,
        targetAheadFrames,
        runtime: input.runtime,
      });
    }

    if (input.runtime.loopStartMissingFrames > 0) {
      return createDecision({
        aheadFrames: 0,
        inputWindowEndFrame,
        inputWindowStartFrame,
        maxEndFrame: loopEndFrame,
        reason: "loop-boundary-missing",
        safeFloorFrames,
        sourceFrameCount,
        sourceSampleRate: sampleRate,
        startFrame: loopStartFrame,
        targetAheadFrames,
        runtime: input.runtime,
      });
    }

    if (input.runtime.loopEndMissingFrames > 0) {
      return createDecision({
        aheadFrames: 0,
        inputWindowEndFrame,
        inputWindowStartFrame,
        maxEndFrame: loopEndFrame,
        reason: "loop-boundary-missing",
        safeFloorFrames,
        sourceFrameCount,
        sourceSampleRate: sampleRate,
        startFrame: Math.max(loopStartFrame, loopEndFrame - chunkFrames),
        targetAheadFrames,
        runtime: input.runtime,
      });
    }

    return null;
  }

  if (
    observedBufferStartFrame > inputWindowStartFrame ||
    observedBufferEndFrame < inputWindowEndFrame
  ) {
    return createDecision({
      aheadFrames: observedAheadFrames,
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

  if (effectiveAheadFrames < targetAheadFrames) {
    return createDecision({
      aheadFrames: effectiveAheadFrames,
      inputWindowEndFrame,
      inputWindowStartFrame,
      reason: "ahead-low",
      safeFloorFrames,
      sourceFrameCount,
      sourceSampleRate: sampleRate,
      startFrame: effectiveBufferEndFrame,
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
  readonly maxEndFrame?: number;
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
  const maxEndFrame = clampFrame(
    input.maxEndFrame ?? input.sourceFrameCount,
    startFrame,
    input.sourceFrameCount,
  );
  const frameCount = clampFrame(
    Math.min(chunkFrames, maxEndFrame - startFrame),
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
