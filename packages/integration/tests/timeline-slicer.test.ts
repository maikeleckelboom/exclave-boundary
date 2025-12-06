import { describe, it, expect } from "vitest";

import {
  type ScheduledCommandBase,
  type SlicerState,
  sliceBlock,
} from "../src/transport/timeline-slicer";

interface TestCommand extends ScheduledCommandBase {
  readonly name: string;
}

function makeState(pending: readonly TestCommand[]): SlicerState<TestCommand> {
  return { pending };
}

describe("timeline-slicer.sliceBlock", () => {
  it("returns a single segment when there are no pending commands", () => {
    const blockStart = 0;
    const blockFrames = 128;

    const initial = makeState([]);
    const { segments, nextState } = sliceBlock(
      initial,
      blockStart,
      blockFrames,
    );

    expect(segments).toHaveLength(1);

    const first = segments[0];
    if (first === undefined) {
      throw new Error("expected exactly one segment");
    }

    expect(first.frames).toBe(blockFrames);
    expect(first.commandsAfter).toHaveLength(0);
    expect(nextState.pending).toHaveLength(0);
  });

  it("splits the block around a command strictly inside the block", () => {
    const blockStart = 0;
    const blockFrames = 128;

    const cmd: TestCommand = {
      atFrame: 64,
      priority: 10,
      name: "play",
    };

    const initial = makeState([cmd]);
    const { segments, nextState } = sliceBlock(
      initial,
      blockStart,
      blockFrames,
    );

    expect(segments).toHaveLength(2);

    const first = segments[0];
    const second = segments[1];

    if (first === undefined || second === undefined) {
      throw new Error("expected exactly two segments");
    }

    expect(first.frames).toBe(64);
    expect(first.commandsAfter).toEqual([cmd]);

    expect(second.frames).toBe(64);
    expect(second.commandsAfter).toHaveLength(0);

    expect(nextState.pending).toHaveLength(0);
  });

  it("clamps late commands to the start of the current block", () => {
    // Block [32, 96), command scheduled earlier at frame 10.
    const blockStart = 32;
    const blockFrames = 64;

    const late: TestCommand = {
      atFrame: 10,
      priority: 0,
      name: "late-play",
    };

    const initial = makeState([late]);
    const { segments, nextState } = sliceBlock(
      initial,
      blockStart,
      blockFrames,
    );

    // Expected:
    //   [{ frames: 0, commandsAfter: [late] },
    //    { frames: 64, commandsAfter: [] }]
    expect(segments).toHaveLength(2);

    const first = segments[0];
    const second = segments[1];

    if (first === undefined || second === undefined) {
      throw new Error("expected exactly two segments");
    }

    expect(first.frames).toBe(0);
    expect(first.commandsAfter).toEqual([late]);

    expect(second.frames).toBe(blockFrames);
    expect(second.commandsAfter).toHaveLength(0);

    expect(nextState.pending).toHaveLength(0);
  });

  it("keeps future commands pending for later blocks", () => {
    const blockStart = 0;
    const blockFrames = 128;

    const inBlock: TestCommand = {
      atFrame: 32,
      priority: 0,
      name: "in-block",
    };

    const future: TestCommand = {
      atFrame: 220,
      priority: 0,
      name: "future",
    };

    const initial = makeState([inBlock, future]);
    const { segments, nextState } = sliceBlock(
      initial,
      blockStart,
      blockFrames,
    );

    expect(segments).toHaveLength(2);

    const first = segments[0];
    if (first === undefined) {
      throw new Error("expected at least one segment");
    }

    expect(first.commandsAfter).toEqual([inBlock]);

    expect(nextState.pending).toHaveLength(1);
    expect(nextState.pending[0]).toBe(future);
  });

  it("orders same-frame commands by ascending priority", () => {
    const blockStart = 0;
    const blockFrames = 64;

    const highPriority: TestCommand = {
      atFrame: 32,
      priority: 0,
      name: "high",
    };

    const lowPriority: TestCommand = {
      atFrame: 32,
      priority: 10,
      name: "low",
    };

    // Intentionally reversed to prove sorting is applied.
    const initial = makeState([lowPriority, highPriority]);

    const { segments } = sliceBlock(initial, blockStart, blockFrames);

    expect(segments).toHaveLength(2);

    const boundarySeg = segments[0];
    if (boundarySeg === undefined) {
      throw new Error("expected first segment");
    }

    expect(boundarySeg.frames).toBe(32);
    expect(boundarySeg.commandsAfter.map((c) => c.name)).toEqual([
      "high",
      "low",
    ]);
  });
});
