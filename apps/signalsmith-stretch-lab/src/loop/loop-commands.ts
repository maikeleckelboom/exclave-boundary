import {
  validateLoopRange,
  type LoopRange,
  type LoopRuntimeFacts,
  type LoopValidationResult,
} from "./loop-validation";

import type {
  EnqueueCommandOptions,
  StretchCommandName,
} from "../boundary/commands";

export interface LoopCommandQueue {
  enqueue(name: StretchCommandName, options?: EnqueueCommandOptions): unknown;
}

export interface LoopCommandSequenceResult {
  readonly enqueued: boolean;
  readonly validation: LoopValidationResult;
}

export function enqueueApplyLoop(
  queue: LoopCommandQueue,
  range: LoopRange,
  facts: LoopRuntimeFacts = {},
): LoopCommandSequenceResult {
  const validation = validateLoopRange(range, facts);

  if (!validation.valid) {
    return { enqueued: false, validation };
  }

  queue.enqueue("setLoop", {
    loopEndFrame: validation.range.endFrame,
    loopStartFrame: validation.range.startFrame,
  });

  return { enqueued: true, validation };
}

export function enqueuePlayLoop(
  queue: LoopCommandQueue,
  range: LoopRange,
  facts: LoopRuntimeFacts = {},
): LoopCommandSequenceResult {
  const validation = validateLoopRange(range, facts);

  if (!validation.valid) {
    return { enqueued: false, validation };
  }

  queue.enqueue("setLoop", {
    loopEndFrame: validation.range.endFrame,
    loopStartFrame: validation.range.startFrame,
  });
  queue.enqueue("seek", {
    targetSourceFrame: validation.range.startFrame,
  });
  queue.enqueue("play");

  return { enqueued: true, validation };
}
