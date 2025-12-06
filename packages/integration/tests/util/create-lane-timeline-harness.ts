/**
 * @file create-lane-timeline-harness.ts
 *
 * Timeline-level harness for lane hot-swap tests.
 *
 * This wires the runtime core (mailbox + scheduler + timeline) into a simple
 * recorder that captures swap decisions per segment, without touching engines
 * or audio samples.
 */

import { createLaneRuntimeCore } from "./create-lane-runtime-core";
import { drainMailboxAndPendingCommands } from "./timeline-rt-drain";
import {
  processTimelineBlock,
  type TimelineCommand,
  type TimelineDriver,
  type TimelineProcessCallbacks,
  type HotswapSchedulerConfig,
} from "../../src";

import type { HotswapCommand, SwapStepDecisionRT } from "@seqlok/hotswap";

/**
 * Minimal engine kind enum for testing the hot-swap protocol.
 * None is the sentinel indicating "no engine", A is the initial engine,
 * and B is the target engine we swap to.
 */
export enum EngineKind {
  None = 0,
  A = 1,
  B = 2,
}

/**
 * Recorded step decision for post-hoc assertion.
 */
export interface RecordedStep {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly segmentFrames: number;
  readonly decision: SwapStepDecisionRT<EngineKind>;
}

/**
 * Recorded command application for tracking timeline command side effects.
 */
export interface RecordedCommand {
  readonly blockIndex: number;
  readonly command: TimelineCommand<EngineKind>;
}

/**
 * Test harness surface for lane.timeline integration tests.
 */
export interface LaneTimelineHarness {
  readonly timeline: TimelineDriver<EngineKind>;
  readonly pendingRTCommands: TimelineCommand<EngineKind>[];
  readonly recordedSteps: RecordedStep[];
  readonly recordedCommands: RecordedCommand[];
  readonly schedulerConfig: HotswapSchedulerConfig<
    EngineKind,
    HotswapCommand<EngineKind>
  >;

  simulateBlock(blockFrames: number): void;

  runUntilSwapComplete(
    blockFrames: number,
    maxBlocks: number,
  ): { completed: boolean; blocksRun: number };
}

export function createLaneTimelineHarness(): LaneTimelineHarness {
  const { mailbox, timeline, schedulerConfig } =
    createLaneRuntimeCore<EngineKind>("lane-0");

  const pendingRTCommands: TimelineCommand<EngineKind>[] = [];
  const recordedSteps: RecordedStep[] = [];
  const recordedCommands: RecordedCommand[] = [];

  // Track current active engine (starts with A).
  let activeEngineKind: EngineKind = EngineKind.A;
  let blockIndex = 0;

  function simulateBlock(blockFrames: number): void {
    const currentBlockIndex = blockIndex;
    let segmentIndex = 0;

    const drainedCommands = drainMailboxAndPendingCommands(
      mailbox,
      pendingRTCommands,
      timeline,
      blockFrames,
    );

    const callbacks: TimelineProcessCallbacks<EngineKind> = {
      renderSegment(frames: number): void {
        const currentNextKind: EngineKind = timeline.hotswapSlot.hasState
          ? (timeline.hotswapSlot.state?.ticket.engineKind ?? EngineKind.None)
          : EngineKind.None;

        const decision = timeline.hotswapSlot.stepBlock(
          frames,
          activeEngineKind,
          currentNextKind,
          EngineKind.None,
        );

        recordedSteps.push({
          blockIndex: currentBlockIndex,
          segmentIndex,
          segmentFrames: frames,
          decision,
        });

        if (decision.kind === "retireNow") {
          // IMPORTANT: adopt the ticket's engine as the new active engine.
          activeEngineKind = currentNextKind;
        }

        segmentIndex += 1;
      },
      applyCommandSideEffects(cmd: TimelineCommand<EngineKind>): void {
        recordedCommands.push({
          blockIndex: currentBlockIndex,
          command: cmd,
        });
      },
    };

    processTimelineBlock(timeline, blockFrames, drainedCommands, callbacks);
    blockIndex += 1;
  }

  function runUntilSwapComplete(
    blockFrames: number,
    maxBlocks: number,
  ): { completed: boolean; blocksRun: number } {
    let blocksRun = 0;
    let sawNonIdlePhase = false;

    for (let i = 0; i < maxBlocks; i += 1) {
      simulateBlock(blockFrames);
      blocksRun += 1;

      const lastStep = recordedSteps[recordedSteps.length - 1];
      if (lastStep !== undefined) {
        const phase = lastStep.decision.status.phase;
        if (phase !== "idle") {
          sawNonIdlePhase = true;
        } else if (sawNonIdlePhase) {
          // We saw non-idle phases and now returned to idle = completed.
          return { completed: true, blocksRun };
        }
      }
    }

    return { completed: false, blocksRun };
  }

  return {
    timeline,
    pendingRTCommands,
    recordedSteps,
    recordedCommands,
    schedulerConfig,
    simulateBlock,
    runUntilSwapComplete,
  };
}
