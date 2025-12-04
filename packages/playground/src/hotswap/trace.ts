import {
  initSwapStateRT,
  stepSwapStateRT,
  type SwapPhase,
  type SwapStateRT,
  type SwapStepDecisionRT,
  type SwapStatusRT,
  type SwapTicketRT,
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
}

/**
 * Run the RT swap protocol block-by-block and capture a trace.
 *
 * This mirrors how an audio engine would call stepSwapStateRT, but keeps
 *  the state in JS so we can visualise it.
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
  } = options;

  const state = initSwapStateRT<EngineKind>(ticket);
  const frames: SwapTraceFrame<EngineKind>[] = [];

  for (let blockIndex = 0; blockIndex < maxBlocks; blockIndex += 1) {
    const decision = stepSwapStateRT(
      state,
      blockFrames,
      activeKind,
      nextKind,
      noneKindSentinel,
    );

    const status = decision.status;

    const snapshot: SwapStateSnapshot<EngineKind> = {
      phase: state.phase,
      hasTicket: state.hasTicket,
      totalFadeFrames: state.totalFadeFrames,
      fadeFramesRemaining: state.fadeFramesRemaining,
      preWarmBlocksRemaining: state.preWarmBlocksRemaining,
      stepIndex: state.stepIndex,
      stepTotal: state.stepTotal,
    };

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

// TODO: re-enable this or remove it
// /**
//  * Project a full trace down to a lightweight timeline.
//  *
//  * This keeps your original SwapTimelinePoint shape intact.
//  */
// export function toTimeline<EngineKind extends number>(
//   frames: readonly SwapTraceFrame<EngineKind>[],
// ): readonly SwapTimelinePoint<EngineKind>[] {
//   return frames.map(
//     (frame): SwapTimelinePoint<EngineKind> => ({
//       blockIndex: frame.blockIndex,
//       phase: frame.status.phase,
//       stepKind: frame.decision.kind,
//       fadeProgress: frame.fadeProgress,
//       preWarmBlocksRemaining: frame.state.preWarmBlocksRemaining,
//     }),
//   );
// }
