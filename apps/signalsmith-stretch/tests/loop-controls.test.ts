import { describe, expect, it } from "vitest";

import { enqueueApplyLoop, enqueuePlayLoop } from "../src/loop/loop-commands";
import {
  normalizeSeekFrameIntoLoopRange,
  sourceFrameInsideLoopRange,
} from "../src/loop/loop-normalization";
import {
  SAFE_MINIMUM_LOOP_FRAMES,
  minimumLoopFramesForRuntime,
  validateLoopRange,
} from "../src/loop/loop-validation";

import type {
  EnqueueCommandOptions,
  StretchCommandName,
} from "../src/boundary/commands";

interface EnqueuedCommand {
  readonly name: StretchCommandName;
  readonly options: EnqueueCommandOptions | undefined;
}

describe("loop controls", () => {
  it("validates loop ranges against runtime block and interval facts", () => {
    expect(minimumLoopFramesForRuntime()).toBe(SAFE_MINIMUM_LOOP_FRAMES);
    expect(
      minimumLoopFramesForRuntime({
        blockSamples: 5_760,
        intervalSamples: 1_440,
      }),
    ).toBe(7_200);

    expect(
      validateLoopRange(
        { endFrame: 16_000, startFrame: 8_000 },
        { blockSamples: 5_760, intervalSamples: 1_440 },
      ),
    ).toMatchObject({
      lengthFrames: 8_000,
      reason: null,
      valid: true,
    });
  });

  it("reports end-before-start and too-short loops", () => {
    expect(
      validateLoopRange({ endFrame: 1_000, startFrame: 2_000 }),
    ).toMatchObject({
      message: "End must be after start",
      reason: "end-before-start",
      valid: false,
    });
    expect(
      validateLoopRange(
        { endFrame: 6_000, startFrame: 1_000 },
        { blockSamples: 5_760, intervalSamples: 1_440 },
      ),
    ).toMatchObject({
      message: "Loop too short",
      minimumLoopFrames: 7_200,
      reason: "too-short",
      valid: false,
    });
  });

  it("enqueues the Play loop command sequence shape", () => {
    const commands = collectCommands();
    const result = enqueuePlayLoop(
      commands,
      { endFrame: 36_000, startFrame: 12_000 },
      { blockSamples: 5_760, intervalSamples: 1_440 },
    );

    expect(result.enqueued).toBe(true);
    expect(commands.items).toEqual([
      {
        name: "setLoop",
        options: { loopEndFrame: 36_000, loopStartFrame: 12_000 },
      },
      { name: "seek", options: { targetSourceFrame: 12_000 } },
      { name: "play", options: undefined },
    ]);
  });

  it("normalizes active-loop seeks into the applied loop range", () => {
    const range = { endFrame: 20_000, startFrame: 10_000 };

    expect(normalizeSeekFrameIntoLoopRange(5_000, range)).toBe(10_000);
    expect(normalizeSeekFrameIntoLoopRange(30_000, range)).toBe(10_000);
    expect(normalizeSeekFrameIntoLoopRange(35_123, range)).toBe(15_123);
    expect(sourceFrameInsideLoopRange(15_123, range)).toBe(true);
    expect(sourceFrameInsideLoopRange(20_000, range)).toBe(false);
  });

  it("does not enqueue invalid or too-short setLoop commands", () => {
    const invalid = collectCommands();
    expect(
      enqueueApplyLoop(invalid, { endFrame: 1_000, startFrame: 2_000 }),
    ).toMatchObject({ enqueued: false });
    expect(invalid.items).toEqual([]);

    const tooShort = collectCommands();
    expect(
      enqueueApplyLoop(
        tooShort,
        { endFrame: 6_000, startFrame: 1_000 },
        { blockSamples: 5_760, intervalSamples: 1_440 },
      ),
    ).toMatchObject({ enqueued: false });
    expect(tooShort.items).toEqual([]);
  });
});

function collectCommands(): {
  readonly items: EnqueuedCommand[];
  readonly enqueue: (
    name: StretchCommandName,
    options?: EnqueueCommandOptions,
  ) => void;
} {
  const items: EnqueuedCommand[] = [];

  return {
    enqueue(name, options): void {
      items.push({ name, options });
    },
    items,
  };
}
