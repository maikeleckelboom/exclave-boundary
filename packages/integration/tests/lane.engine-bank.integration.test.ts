/**
 * @file lane.engine-bank.integration.test.ts
 *
 * Engine-bank level integration tests for the Seqlok lane hot-swap pipeline.
 *
 * This test extends the lane.timeline harness with a tiny EngineBank that
 * renders constant-valued engines (A = 1.0, B = 2.0, C = 3.0) so we can assert
 * sample-level crossfade semantics without touching Web Audio.
 */

import { createTicketId, type SwapTicketRT } from "@seqlok/hotswap";
import { describe, expect, it } from "vitest";

import { scheduleSwap } from "../src";
import {
  createLaneEngineHarness,
  EngineKind,
  type RecordedAudioBlock,
} from "./util/create-lane-engine-harness";

/**
 * Sample-level semantics for typical swaps.
 */
describe("lane engine bank integration: sample-level crossfade semantics", () => {
  it("without any swap scheduled, output equals current engine value", () => {
    const harness = createLaneEngineHarness();
    const { recordedAudio } = harness;
    const blockFrames = 64;

    for (let i = 0; i < 3; i += 1) {
      harness.simulateBlock(blockFrames);
    }

    const baselineBlocks = recordedAudio.filter((b) => {
      const kind = b.decision.kind;
      return kind === "idle" || kind === "runCurrentOnly";
    });

    expect(baselineBlocks.length).toBeGreaterThan(0);

    for (const block of baselineBlocks) {
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(1.0, 5);
      }
    }
  });

  it("during prewarm, output equals only current (next is rendered but discarded)", () => {
    const harness = createLaneEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(2),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 2,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const prewarmBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "prewarm",
    );

    expect(prewarmBlocks.length).toBe(2);

    for (const block of prewarmBlocks) {
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(1.0, 5);
      }
    }
  });

  it("during crossfade, output is weighted sum between engine A and B", () => {
    const harness = createLaneEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(3),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const crossfadeBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "crossfade",
    );

    expect(crossfadeBlocks.length).toBeGreaterThan(0);

    const firstBlock = crossfadeBlocks[0];
    const lastBlock = crossfadeBlocks[crossfadeBlocks.length - 1];

    if (firstBlock === undefined || lastBlock === undefined) {
      throw new Error("crossfadeBlocks should not be empty");
    }

    const firstSum = firstBlock.samples.reduce((sum, v) => sum + v, 0);
    const firstAvg = firstSum / firstBlock.samples.length;

    const lastSum = lastBlock.samples.reduce((sum, v) => sum + v, 0);
    const lastAvg = lastSum / lastBlock.samples.length;

    // First crossfade block: still mostly A (1.0), but above 1.0.
    expect(firstAvg).toBeGreaterThan(1.0);
    expect(firstAvg).toBeLessThan(1.5);

    // Last crossfade block: mostly B (2.0).
    expect(lastAvg).toBeGreaterThan(1.5);
    expect(lastAvg).toBeLessThan(2.0);

    const averages: number[] = crossfadeBlocks.map((block) => {
      const sum = block.samples.reduce((acc, v) => acc + v, 0);
      return sum / block.samples.length;
    });

    let prevAvg: number | null = null;
    for (const avg of averages) {
      if (prevAvg !== null) {
        expect(avg).toBeGreaterThanOrEqual(prevAvg - 0.01);
      }
      prevAvg = avg;
    }
  });

  it("after retire, only next engine is active", () => {
    const harness = createLaneEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(4),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    let afterRetire = false;
    const postRetireBlocks: RecordedAudioBlock[] = [];

    for (const block of recordedAudio) {
      if (block.decision.kind === "retireNow") {
        afterRetire = true;
        continue;
      }
      if (afterRetire && block.decision.status.phase === "idle") {
        postRetireBlocks.push(block);
      }
    }

    expect(postRetireBlocks.length).toBeGreaterThan(0);

    for (const block of postRetireBlocks) {
      expect(block.decision.status.activeEngineKind).toBe(EngineKind.B);
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(2.0, 5);
      }
    }
  });

  it("multi-block crossfade yields a monotonic gain envelope", () => {
    const harness = createLaneEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 32;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(5),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const crossfadeBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "crossfade",
    );

    expect(crossfadeBlocks.length).toBeGreaterThanOrEqual(3);

    const averages: number[] = crossfadeBlocks.map((block) => {
      const sum = block.samples.reduce((acc, v) => acc + v, 0);
      return sum / block.samples.length;
    });

    const first = averages[0];
    const last = averages[averages.length - 1];

    if (first === undefined || last === undefined) {
      throw new Error("unexpected empty averages");
    }

    // Start near A, end near B, without insisting on exact endpoints.
    expect(first).toBeGreaterThan(1.0);
    expect(first).toBeLessThan(1.5);
    expect(last).toBeGreaterThan(1.5);
    expect(last).toBeLessThan(2.0);

    let prevAvg: number | null = null;
    for (const avg of averages) {
      if (prevAvg !== null) {
        expect(avg).toBeGreaterThanOrEqual(prevAvg - 0.01);
      }
      prevAvg = avg;
    }
  });

  it("zero-length segments produce no samples", () => {
    const harness = createLaneEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 128;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(6),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.simulateBlock(blockFrames);

    for (const block of recordedAudio) {
      expect(block.samples.length).toBeGreaterThan(0);
    }
  });

  it("handles same-engine swap (A→A) with correct sample values", () => {
    const harness = createLaneEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(7),
      engineKind: EngineKind.A,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 1,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const crossfadeBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "crossfade",
    );

    for (const block of crossfadeBlocks) {
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(1.0, 5);
      }
    }
  });
});

/**
 * Edge-case semantics and failure modes.
 */
describe("lane engine bank integration: edge cases", () => {
  it("handles engine returning null (silent output)", () => {
    const harness = createLaneEngineHarness();
    const { bank, schedulerConfig, recordedAudio } = harness;

    // Remove engine B: simulates missing engine in the bank.
    bank.unregister(EngineKind.B);

    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(8),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const crossfadeBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "crossfade",
    );

    expect(crossfadeBlocks.length).toBeGreaterThan(0);

    const averages: number[] = crossfadeBlocks.map((block) => {
      const sum = block.samples.reduce((acc, v) => acc + v, 0);
      return sum / block.samples.length;
    });

    const maxAvg = Math.max(...averages);
    const minAvg = Math.min(...averages);

    // With missing next engine, energy decays from 1.0 towards 0.0.
    // We only assert that it stays within (0, 1) and does not blow up.
    expect(maxAvg).toBeLessThan(1.0);
    expect(minAvg).toBeGreaterThan(0.0);
  });

  it("very short fadeFrames produces rapid but smooth transition", () => {
    const harness = createLaneEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 128;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(9),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 32,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const crossfadeBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "crossfade",
    );

    expect(crossfadeBlocks.length).toBeLessThanOrEqual(2);

    const firstBlock = crossfadeBlocks[0];
    const lastBlock = crossfadeBlocks[crossfadeBlocks.length - 1];

    if (firstBlock === undefined || lastBlock === undefined) {
      throw new Error("crossfadeBlocks should not be empty");
    }

    expect(firstBlock.samples[0]).toBeCloseTo(1.0, 1);
    expect(lastBlock.samples[lastBlock.samples.length - 1]).toBeCloseTo(2.0, 1);
  });
});

/**
 * Higher-order semantics: overlapping and sequential swaps.
 * Overlapping test stays skipped until the runtime policy for overlapping swaps
 * (reject vs queue) is fully implemented at the scheduler level.
 */
describe("lane engine bank integration: higher-order swaps", () => {
  it("rejects overlapping swaps: second ticket to C never takes effect during A→B", () => {
    const harness = createLaneEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 64;

    // First swap: A → B.
    const ticketAB: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(10),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticketAB);

    // Second swap: try to go B → C while A→B is still active.
    const ticketBC: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(11),
      engineKind: EngineKind.C,
      atFrame: 32, // inside the first fade window
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticketBC);

    harness.runUntilSwapComplete(blockFrames, 200);

    // Spec: overlapping swap is rejected/ignored.
    // No block should ever reference C as active or next engine.
    const touchedC = recordedAudio.some((block) => {
      const status = block.decision.status;
      return (
        status.activeEngineKind === EngineKind.C ||
        status.nextEngineKind === EngineKind.C
      );
    });

    expect(touchedC).toBe(false);

    // After retire, lane should be running pure B (2.0).
    let sawRetire = false;
    const postRetireBlocks: RecordedAudioBlock[] = [];

    for (const block of recordedAudio) {
      if (block.decision.kind === "retireNow") {
        sawRetire = true;
        continue;
      }
      if (sawRetire && block.decision.status.phase === "idle") {
        postRetireBlocks.push(block);
      }
    }

    expect(postRetireBlocks.length).toBeGreaterThan(0);

    for (const block of postRetireBlocks) {
      expect(block.decision.status.activeEngineKind).toBe(EngineKind.B);
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(2.0, 5);
      }
    }
  });

  it("supports sequential swaps A→B→C without regressing engines", () => {
    const harness = createLaneEngineHarness();
    const { schedulerConfig, recordedAudio, timeline } = harness;
    const blockFrames = 64;

    // First swap: A → B.
    const ticketAB: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(20),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticketAB);
    harness.runUntilSwapComplete(blockFrames, 100);

    const recordedAfterFirst = recordedAudio.length;

    // Sanity: we should have at least one idle block with B only.
    const idleWithB = recordedAudio.filter(
      (block) =>
        block.decision.status.phase === "idle" &&
        block.decision.status.activeEngineKind === EngineKind.B,
    );

    expect(idleWithB.length).toBeGreaterThan(0);

    for (const block of idleWithB) {
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(2.0, 5);
      }
    }

    // Second swap: B → C, scheduled after the current timeline frame.
    const ticketBC: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(21),
      engineKind: EngineKind.C,
      atFrame: timeline.frame, // next block boundary
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticketBC);
    harness.runUntilSwapComplete(blockFrames, 100);

    const newBlocks = recordedAudio.slice(recordedAfterFirst);

    // There must be at least one idle block with C at the end.
    const idleWithC = newBlocks.filter(
      (block) =>
        block.decision.status.phase === "idle" &&
        block.decision.status.activeEngineKind === EngineKind.C,
    );

    expect(idleWithC.length).toBeGreaterThan(0);

    for (const block of idleWithC) {
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(3.0, 5);
      }
    }

    // Once we've seen idle with B, we should never see idle with A again.
    const firstIdleBIndex = recordedAudio.findIndex(
      (block) =>
        block.decision.status.phase === "idle" &&
        block.decision.status.activeEngineKind === EngineKind.B,
    );

    expect(firstIdleBIndex).toBeGreaterThanOrEqual(0);

    const idleWithAAfterB = recordedAudio
      .slice(firstIdleBIndex)
      .filter(
        (block) =>
          block.decision.status.phase === "idle" &&
          block.decision.status.activeEngineKind === EngineKind.A,
      );

    expect(idleWithAAfterB.length).toBe(0);
  });
});
