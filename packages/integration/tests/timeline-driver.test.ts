import { describe, expect, it } from "vitest";

import {
  processTimelineBlock,
  type TimelineCommand,
  type TimelineDriver,
  type TimelineProcessCallbacks,
} from "../src/transport/timeline-driver";
import {
  createSlicerState,
  type SlicerState,
} from "../src/transport/timeline-slicer";

import type { HotswapSlotDriver } from "../src/hotswap/slot-driver";
import type {
  SwapStateRT,
  SwapStepDecisionRT,
  SwapTicketRT,
  TicketId,
} from "@seqlok/hotswap";

// For these tests we use a fixed engine-kind domain.
type EngineKind = 0;

type StubHotswapSlot = HotswapSlotDriver<EngineKind> & {
  readonly acceptedTicketIds: readonly number[];
};

function createStubHotswapSlot(): StubHotswapSlot {
  let state: SwapStateRT<EngineKind> | null = null;
  const acceptedTicketIdsInternal: number[] = [];

  return {
    get hasState(): boolean {
      return state !== null;
    },

    get state(): SwapStateRT<EngineKind> | null {
      return state;
    },

    acceptTicket(ticket: SwapTicketRT<EngineKind>): void {
      acceptedTicketIdsInternal.push(ticket.ticketId);
      // In the real driver we would call initSwapStateRT here.
      state = null;
    },

    clear(): void {
      state = null;
    },

    stepBlock(
      _blockFrames: number,
      activeKind: EngineKind,
      _nextKind: EngineKind,
      noneKindSentinel: EngineKind,
    ): SwapStepDecisionRT<EngineKind> {
      // Timeline tests focus on render/command sequencing, so we keep the
      // hotswap behavior trivially idle here.
      return {
        kind: "idle",
        status: {
          phase: "idle",
          ticketId: 0,
          progress: 0,
          activeEngineKind: activeKind,
          nextEngineKind: noneKindSentinel,
        },
      };
    },

    get acceptedTicketIds(): readonly number[] {
      return acceptedTicketIdsInternal;
    },
  };
}

type TestTimeline = TimelineDriver<EngineKind> & {
  readonly hotswapSlot: StubHotswapSlot;
};

function createTestTimeline(frame: number, isPlaying: boolean): TestTimeline {
  const slot = createStubHotswapSlot();
  const slicer: SlicerState<TimelineCommand<EngineKind>> =
    createSlicerState<TimelineCommand<EngineKind>>();

  return {
    frame,
    isPlaying,
    slicer,
    hotswapSlot: slot,
  };
}

interface RecordedCallbacks {
  readonly rendered: number[];
  readonly commands: TimelineCommand<EngineKind>[];
}

function createCallbacks(
  record: RecordedCallbacks,
): TimelineProcessCallbacks<EngineKind> {
  return {
    renderSegment(frames: number): void {
      record.rendered.push(frames);
    },
    applyCommandSideEffects(cmd: TimelineCommand<EngineKind>): void {
      record.commands.push(cmd);
    },
  };
}

describe("processTimelineBlock", () => {
  it("renders a single segment when there are no commands", () => {
    const timeline = createTestTimeline(0, false);
    const record: RecordedCallbacks = { rendered: [], commands: [] };

    const callbacks = createCallbacks(record);
    const drained: TimelineCommand<EngineKind>[] = [];

    processTimelineBlock<EngineKind>(timeline, 128, drained, callbacks);

    expect(record.rendered).toEqual([128]);
    expect(record.commands).toHaveLength(0);
    expect(timeline.frame).toBe(128);
    expect(timeline.isPlaying).toBe(false);
  });

  it("applies a play command at block start before rendering", () => {
    const timeline = createTestTimeline(0, false);
    const record: RecordedCallbacks = { rendered: [], commands: [] };
    const callbacks = createCallbacks(record);

    const cmd: TimelineCommand<EngineKind> = {
      atFrame: 0,
      priority: 0,
      payload: { kind: "play" },
    };

    processTimelineBlock<EngineKind>(timeline, 128, [cmd], callbacks);

    // Command happens at a zero-length segment at the start, then we render 128.
    expect(record.rendered).toEqual([128]);
    expect(record.commands).toEqual([cmd]);

    expect(timeline.isPlaying).toBe(true);
    expect(timeline.frame).toBe(128);
  });

  it("splits rendering around a play command in the middle of the block", () => {
    const timeline = createTestTimeline(0, false);
    const record: RecordedCallbacks = { rendered: [], commands: [] };
    const callbacks = createCallbacks(record);

    const cmd: TimelineCommand<EngineKind> = {
      atFrame: 64,
      priority: 0,
      payload: { kind: "play" },
    };

    processTimelineBlock<EngineKind>(timeline, 128, [cmd], callbacks);

    // Two render segments: [0..64) then [64..128)
    expect(record.rendered).toEqual([64, 64]);

    // Command applied exactly once between segments.
    expect(record.commands).toEqual([cmd]);

    expect(timeline.frame).toBe(128);
    expect(timeline.isPlaying).toBe(true);
  });

  it("clamps late commands to the beginning of the block", () => {
    // Block [32, 96), command atFrame=10 should be clamped to 32.
    const timeline = createTestTimeline(32, false);
    const record: RecordedCallbacks = { rendered: [], commands: [] };
    const callbacks = createCallbacks(record);

    const late: TimelineCommand<EngineKind> = {
      atFrame: 10,
      priority: 0,
      payload: { kind: "play" },
    };

    processTimelineBlock<EngineKind>(timeline, 64, [late], callbacks);

    // Because the command is clamped to the block start, we only see
    // one render segment for the whole block.
    expect(record.rendered).toEqual([64]);
    expect(record.commands).toEqual([late]);

    expect(timeline.frame).toBe(32 + 64);
    expect(timeline.isPlaying).toBe(true);
  });

  it("orders same-frame commands by ascending priority before applying", () => {
    const timeline = createTestTimeline(0, false);
    const record: RecordedCallbacks = { rendered: [], commands: [] };
    const callbacks = createCallbacks(record);

    const first: TimelineCommand<EngineKind> = {
      atFrame: 32,
      priority: 0,
      payload: { kind: "play" },
    };

    const second: TimelineCommand<EngineKind> = {
      atFrame: 32,
      priority: 10,
      payload: { kind: "stop" },
    };

    // Intentionally out-of-order input.
    const drained: TimelineCommand<EngineKind>[] = [second, first];

    processTimelineBlock<EngineKind>(timeline, 64, drained, callbacks);

    // Two render segments: [0..32) then [32..64)
    expect(record.rendered).toEqual([32, 32]);

    // Commands are applied in priority order.
    expect(record.commands).toEqual([first, second]);

    // Final state reflects last command.
    expect(timeline.isPlaying).toBe(false);
    expect(timeline.frame).toBe(64);
  });

  it("wires installSwap through to the hotswap slot driver", () => {
    const timeline = createTestTimeline(0, true);
    const slot = timeline.hotswapSlot;

    const record: RecordedCallbacks = { rendered: [], commands: [] };
    const callbacks = createCallbacks(record);

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: 42 as TicketId,
      engineKind: 0 as EngineKind,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    const cmd: TimelineCommand<EngineKind> = {
      atFrame: 0,
      priority: 0,
      payload: { kind: "installSwap", ticket },
    };

    processTimelineBlock<EngineKind>(timeline, 128, [cmd], callbacks);

    // Swap should be forwarded into the slot driver.
    expect(slot.acceptedTicketIds).toEqual([42]);
  });
});
