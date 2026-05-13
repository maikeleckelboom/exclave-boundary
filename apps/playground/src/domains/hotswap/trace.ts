import { scheduleSwap } from "@seqlok/hotswap";

import {
  drainHotswapMailboxIntoTimeline,
} from "./hotswap-timeline-drain";
import {
  createLaneRuntimeCore,
} from "./lane-runtime-core";
import {
  processTimelineBlock,
  type TimelineCommand,
} from "./timeline-driver";

import type {
  SwapPhase,
  SwapStateRT,
  SwapStatusRT,
  SwapStepDecisionRT,
  SwapTicketRT,
} from "@seqlok/hotswap";

/**
 * Lightweight point for a timeline strip.
 *
 * Good for "one color per block" views.
 */
export interface SwapTimelinePoint<EngineKind extends number> {
  readonly blockIndex: number;
  readonly phase: SwapPhase;
  readonly stepKind: SwapStepDecisionRT<EngineKind>["kind"];
  readonly fadeProgress: number;
  readonly preWarmBlocksRemaining: number;
}

/**
 * Snapshot of the internal RT state for a given step.
 *
 * Uses indexed access types so it stays aligned with @seqlok/hotswap.
 */
export interface SwapStateSnapshot<EngineKind extends number> {
  readonly phase: SwapStateRT<EngineKind>["phase"];
  readonly hasTicket: SwapStateRT<EngineKind>["hasTicket"];
  readonly totalFadeFrames: SwapStateRT<EngineKind>["totalFadeFrames"];
  readonly fadeFramesRemaining: SwapStateRT<EngineKind>["fadeFramesRemaining"];
  readonly preWarmBlocksRemaining: SwapStateRT<EngineKind>["preWarmBlocksRemaining"];
  readonly stepIndex: SwapStateRT<EngineKind>["stepIndex"];
  readonly stepTotal: SwapStateRT<EngineKind>["stepTotal"];
}

/**
 * Full trace frame: decision, status and state snapshot.
 *
 * This is what the Vue lab will usually consume.
 */
export interface SwapTraceFrame<EngineKind extends number> {
  readonly blockIndex: number;
  readonly decision: SwapStepDecisionRT<EngineKind>;
  readonly status: SwapStatusRT<EngineKind>;
  readonly state: SwapStateSnapshot<EngineKind>;
  readonly fadeProgress: number; // 0..1
}

export interface SwapTraceOptions<EngineKind extends number> {
  readonly ticket: SwapTicketRT<EngineKind>;
  readonly blockFrames: number;
  readonly activeKind: EngineKind;
  readonly nextKind: EngineKind;
  readonly noneKindSentinel: EngineKind;
  readonly maxBlocks?: number;

  /**
   * Optional identity string used only for error context.
   * (Mailbox IDs are not global singletons; this is safe to reuse.)
   */
  readonly mailboxId?: string;
}

function makeIdleDecision<EngineKind extends number>(
  activeKind: EngineKind,
  noneKindSentinel: EngineKind,
): SwapStepDecisionRT<EngineKind> {
  return {
    kind: "idle",
    status: {
      phase: "idle",
      ticketId: 0,
      progress: 0,
      activeEngineKind: activeKind,
      nextEngineKind: noneKindSentinel,
      fadeTotalFrames: 0,
      fadeDoneFramesAtBlockStart: 0,
      fadeDoneFramesAtBlockEnd: 0,
      preWarmBlocksRemaining: 0,
    },
  };
}

function snapshotStateOrIdle<EngineKind extends number>(
  state: SwapStateRT<EngineKind> | null,
): SwapStateSnapshot<EngineKind> {
  if (state === null) {
    return {
      phase: "idle",
      hasTicket: false,
      totalFadeFrames: 0,
      fadeFramesRemaining: 0,
      preWarmBlocksRemaining: 0,
      stepIndex: 0,
      stepTotal: 0,
    };
  }

  return {
    phase: state.phase,
    hasTicket: state.hasTicket,
    totalFadeFrames: state.totalFadeFrames,
    fadeFramesRemaining: state.fadeFramesRemaining,
    preWarmBlocksRemaining: state.preWarmBlocksRemaining,
    stepIndex: state.stepIndex,
    stepTotal: state.stepTotal,
  };
}

/**
 * Run the *real* Seqlok lane pipeline block-by-block and capture a trace.
 *
 * This does:
 *   scheduleSwap → mailbox push → drain mailbox → timeline slicing →
 *   acceptTicket at the boundary → hotswapSlot.stepBlock(...)
 *
 * So the playground becomes a proof that the pipeline is real, not a shadow sim.
 */
export function traceSwap<EngineKind extends number>(
  options: SwapTraceOptions<EngineKind>,
): readonly SwapTraceFrame<EngineKind>[] {
  const {
    ticket,
    blockFrames,
    activeKind,
    nextKind,
    noneKindSentinel,
    maxBlocks = 2048,
    mailboxId = "playground-hotswap-trace",
  } = options;

  const runtime = createLaneRuntimeCore<EngineKind>(mailboxId);
  const pendingCommands: TimelineCommand<EngineKind>[] = [];

  try {
    scheduleSwap(runtime.schedulerConfig, ticket);
  } catch {
    // Lab behavior: show idle trace instead of crashing UI on transport failure.
  }

  const frames: SwapTraceFrame<EngineKind>[] = [];

  let active = activeKind;
  let next = nextKind;

  for (let blockIndex = 0; blockIndex < maxBlocks; blockIndex += 1) {
    const drained = drainHotswapMailboxIntoTimeline({
      mailboxConsumer: runtime.mailbox.consumer,
      pendingCommands,
      timeline: runtime.timeline,
      blockFrames,
    });

    // Default: “no segment ran”, so decision stays idle.
    let decision: SwapStepDecisionRT<EngineKind> = makeIdleDecision(
      active,
      noneKindSentinel,
    );

    processTimelineBlock(runtime.timeline, blockFrames, drained, {
      renderSegment(framesInSegment) {
        const d = runtime.hotswapSlot.stepBlock(
          framesInSegment,
          active,
          next,
          noneKindSentinel,
        );

        if (d.kind === "retireNow") {
          active = next;
          next = noneKindSentinel;
        }

        decision = d;
      },
    });

    const status = decision.status;
    const snapshot = snapshotStateOrIdle(runtime.hotswapSlot.state);

    const totalFadeFrames = snapshot.totalFadeFrames;
    const fadeFramesRemaining = snapshot.fadeFramesRemaining;

    const fadeProgress =
      totalFadeFrames > 0
        ? 1 - fadeFramesRemaining / totalFadeFrames
        : status.phase === "crossfade"
          ? 1
          : 0;

    frames.push({
      blockIndex,
      decision,
      status,
      state: snapshot,
      fadeProgress,
    });

    if (status.phase === "idle" && blockIndex > 0) {
      break;
    }
  }

  return frames;
}
