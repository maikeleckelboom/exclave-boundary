import {
  createTicketId,
  scheduleSwap,
  type SwapResult,
  type SwapStepDecisionRT,
  type SwapTicketRT,
} from "@seqlok/hotswap";

import {
  drainHotswapMailboxIntoTimeline,
} from "./hotswap-timeline-drain";
import {
  createLaneRuntimeCore,
  type LaneRuntimeCore,
} from "./lane-runtime-core";
import {
  processTimelineBlock,
  type TimelineCommand,
} from "./timeline-driver";

export enum EngineKind {
  None = 0,
  A = 1,
  B = 2,
  C = 3,
}

export type RenderSegment = (
  frames: number,
  decision: SwapStepDecisionRT<EngineKind>,
) => void;

export interface PlaygroundHotswapLane {
  readonly runtime: LaneRuntimeCore<EngineKind>;

  /** Schedule a swap from “host/UI land”. */
  scheduleSwapTo(ticket: SwapTicketRT<EngineKind>): SwapResult;

  /** Convenience helper for UI: make a ticket. */
  makeTicket(args: {
    readonly engineKind: EngineKind;
    readonly atFrame: number;
    readonly fadeFrames: number;
    readonly preWarmBlocks: number;
    readonly ticketId?: number;
  }): SwapTicketRT<EngineKind>;

  /** Run RT for one block (call from your worklet/worker render loop). */
  processBlock(blockFrames: number, renderSegment: RenderSegment): void;

  /** Debug helpers */
  getActiveKind(): EngineKind;
  getNextKind(): EngineKind;
}

export function createPlaygroundHotswapLane(
  mailboxId: string,
): PlaygroundHotswapLane {
  const runtime = createLaneRuntimeCore<EngineKind>(mailboxId);

  const pendingRTCommands: TimelineCommand<EngineKind>[] = [];
  let activeKind: EngineKind = EngineKind.A;

  const getNextKind = (): EngineKind => {
    if (!runtime.hotswapSlot.hasState) {
      return EngineKind.None;
    }
    const ticketKind = runtime.hotswapSlot.state?.ticket.engineKind;
    return ticketKind ?? EngineKind.None;
  };

  const makeTicket = (args: {
    readonly engineKind: EngineKind;
    readonly atFrame: number;
    readonly fadeFrames: number;
    readonly preWarmBlocks: number;
    readonly ticketId?: number;
  }): SwapTicketRT<EngineKind> => ({
    ticketId: createTicketId(args.ticketId ?? 1),
    engineKind: args.engineKind,
    atFrame: args.atFrame,
    fadeFrames: args.fadeFrames,
    preWarmBlocks: args.preWarmBlocks,
  });

  const scheduleSwapTo = (ticket: SwapTicketRT<EngineKind>): SwapResult =>
    scheduleSwap(runtime.schedulerConfig, ticket);

  const processBlock = (
    blockFrames: number,
    renderSegment: RenderSegment,
  ): void => {
    const drained = drainHotswapMailboxIntoTimeline({
      mailboxConsumer: runtime.mailbox.consumer,
      pendingCommands: pendingRTCommands,
      timeline: runtime.timeline,
      blockFrames,
    });

    processTimelineBlock(runtime.timeline, blockFrames, drained, {
      renderSegment(frames) {
        const nextKind = getNextKind();
        const decision = runtime.hotswapSlot.stepBlock(
          frames,
          activeKind,
          nextKind,
          EngineKind.None,
        );

        // This is the canonical “active switches when protocol says retireNow”.
        if (decision.kind === "retireNow") {
          activeKind = nextKind;
        }

        renderSegment(frames, decision);
      },
      applyCommandSideEffects() {
        // Optional: hook UI logging / stats. Keep it no-op for audio correctness.
      },
    });
  };

  return {
    runtime,
    scheduleSwapTo,
    makeTicket,
    processBlock,
    getActiveKind: () => activeKind,
    getNextKind,
  };
}
