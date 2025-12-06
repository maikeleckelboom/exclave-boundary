import { createTicketId, type SwapTicketRT } from "@seqlok/hotswap";
import { describe, expect, it } from "vitest";

import { scheduleSwap } from "../src";
import {
  createLaneEngineHarness,
  EngineKind,
} from "./util/create-lane-engine-harness";

function getLast<T>(items: readonly T[]): T {
  const lastIndex = items.length - 1;
  if (lastIndex < 0 || items[lastIndex] === undefined) {
    throw new Error("Expected at least one item");
  }
  return items[lastIndex] as T;
}

describe("lane engine bank overlaps integration", () => {
  it("overlapping A→B and mid-swap B→C never exposes C and settles on B", () => {
    const harness = createLaneEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;

    const blockFrames = 128;

    // First ticket: A → B, long enough to have a meaningful prewarm + crossfade.
    const ticketAtoB: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(100),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 256,
      preWarmBlocks: 2,
    };

    // Second ticket: B → C, scheduled so it would overlap the first swap
    // if it were allowed to take effect.
    const ticketBtoC: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(101),
      engineKind: EngineKind.C,
      atFrame: 64,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    // Host fires both intents; Level 2.5 policy (Reject While Busy) plus
    // slot behavior must ensure that C never becomes active/next.
    scheduleSwap(schedulerConfig, ticketAtoB);
    scheduleSwap(schedulerConfig, ticketBtoC);

    const { completed } = harness.runUntilSwapComplete(blockFrames, 200);
    expect(completed).toBe(true);

    // 1. No decision should ever reference EngineKind.C as active or next.
    for (const block of recordedAudio) {
      const { activeEngineKind, nextEngineKind } = block.decision.status;
      expect(activeEngineKind).not.toBe(EngineKind.C);
      expect(nextEngineKind).not.toBe(EngineKind.C);
    }

    // 2. Final idle plateau should settle on B with ≈ 2.0 samples for the
    //    constant-engine harness (A=1, B=2, C=3).
    const idleBlocks = recordedAudio.filter(
      (block) => block.decision.status.phase === "idle",
    );
    expect(idleBlocks.length).toBeGreaterThan(0);

    const lastIdleBlock = getLast(idleBlocks);
    const { samples } = lastIdleBlock;

    let sum = 0;
    for (const sample of samples) {
      sum += sample;
    }
    const mean = sum / samples.length;

    // Tight-ish bounds around 2.0; adjust if your harness constants differ.
    expect(mean).toBeGreaterThan(1.5);
    expect(mean).toBeLessThan(2.5);

    expect(lastIdleBlock.decision.status.activeEngineKind).toBe(EngineKind.B);
  });
});
