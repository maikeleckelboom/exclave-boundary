export interface LoopRange {
  readonly endFrame: number;
  readonly startFrame: number;
}

export interface LoopRuntimeFacts {
  readonly blockSamples?: number;
  readonly intervalSamples?: number;
}

export type LoopValidationReason = "end-before-start" | "too-short";

export interface LoopValidationResult {
  readonly lengthFrames: number;
  readonly message: string;
  readonly minimumLoopFrames: number;
  readonly range: LoopRange;
  readonly reason: LoopValidationReason | null;
  readonly valid: boolean;
}

export const SAFE_MINIMUM_LOOP_FRAMES = 2_048;

export function minimumLoopFramesForRuntime(
  facts: LoopRuntimeFacts = {},
): number {
  const blockSamples = positiveFiniteFrame(facts.blockSamples);
  const intervalSamples = positiveFiniteFrame(facts.intervalSamples);
  const runtimeMinimum = blockSamples + intervalSamples;

  return Math.max(
    SAFE_MINIMUM_LOOP_FRAMES,
    runtimeMinimum > 0 ? runtimeMinimum : SAFE_MINIMUM_LOOP_FRAMES,
  );
}

export function validateLoopRange(
  range: LoopRange,
  facts: LoopRuntimeFacts = {},
): LoopValidationResult {
  const normalizedRange = {
    endFrame: finiteFrame(range.endFrame),
    startFrame: finiteFrame(range.startFrame),
  };
  const minimumLoopFrames = minimumLoopFramesForRuntime(facts);
  const lengthFrames = normalizedRange.endFrame - normalizedRange.startFrame;

  if (normalizedRange.endFrame <= normalizedRange.startFrame) {
    return {
      lengthFrames,
      message: "End must be after start",
      minimumLoopFrames,
      range: normalizedRange,
      reason: "end-before-start",
      valid: false,
    };
  }

  if (lengthFrames < minimumLoopFrames) {
    return {
      lengthFrames,
      message: "Loop too short",
      minimumLoopFrames,
      range: normalizedRange,
      reason: "too-short",
      valid: false,
    };
  }

  return {
    lengthFrames,
    message: "Loop ready",
    minimumLoopFrames,
    range: normalizedRange,
    reason: null,
    valid: true,
  };
}

function finiteFrame(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function positiveFiniteFrame(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value ?? 0));
}
