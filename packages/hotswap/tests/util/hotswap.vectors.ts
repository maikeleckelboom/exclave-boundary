import type {
  SwapPhase,
  SwapStepKind,
  SwapTicketRT,
  TicketId,
} from "../../src/spec";

export interface SwapTestVector {
  readonly name: string;
  readonly ticket: SwapTicketRT<number>;
  readonly blockFrames: number;
  readonly expectedTransitions: readonly {
    readonly phase: SwapPhase;
    readonly kind: SwapStepKind;
  }[];
}

/**
 * Minimal conformance suite that both TS and C++ implementations must pass.
 * These are the “canonical flows”.
 */
export const swapTestVectors: SwapTestVector[] = [
  {
    name: "prewarm=0, fadeFrames=blockFrames",
    ticket: {
      ticketId: 1 as TicketId,
      engineKind: 1,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    },
    blockFrames: 128,
    expectedTransitions: [
      { phase: "spawn", kind: "runCurrentOnly" },
      { phase: "prime", kind: "runCurrentOnly" },
      { phase: "crossfade", kind: "runBothForCrossfade" },
      { phase: "retire", kind: "retireNow" },
      { phase: "idle", kind: "idle" },
    ],
  },
  {
    name: "prewarm=2, fadeFrames=2*blockFrames",
    ticket: {
      ticketId: 2 as TicketId,
      engineKind: 2,
      atFrame: 0,
      fadeFrames: 256,
      preWarmBlocks: 2,
    },
    blockFrames: 128,
    expectedTransitions: [
      { phase: "spawn", kind: "runCurrentOnly" },
      { phase: "prime", kind: "runCurrentOnly" },
      { phase: "prewarm", kind: "runCurrentAndPrewarmNext" },
      { phase: "prewarm", kind: "runCurrentAndPrewarmNext" },
      { phase: "crossfade", kind: "runBothForCrossfade" },
      { phase: "crossfade", kind: "runBothForCrossfade" },
      { phase: "retire", kind: "retireNow" },
      { phase: "idle", kind: "idle" },
    ],
  },
];
