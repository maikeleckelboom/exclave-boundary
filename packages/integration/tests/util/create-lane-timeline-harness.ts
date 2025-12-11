/**
 * @file create-lane-timeline-harness.ts
 *
 * Timeline-level harness for lane hot-swap tests.
 *
 * This wires the runtime core (mailbox + scheduler + timeline) into a simple
 * recorder that captures swap decisions per segment, without touching engines
 * or audio samples.
 */

import {
  createLaneRuntimeCore,
  processTimelineBlock,
  drainHotswapMailboxIntoTimeline,
  type TimelineCommand,
  type TimelineDriver,
  type TimelineProcessCallbacks,
} from "../../src";

import type {
  HotswapCommand,
  SwapStepDecisionRT,
  HotswapSchedulerConfig,
} from "@seqlok/hotswap";

export enum EngineKind {
  None = 0,
  A = 1,
  B = 2,
  C = 3,
}

export interface RecordedStep {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly segmentFrames: number;
  readonly decision: SwapStepDecisionRT<EngineKind>;
}

export interface RecordedCommand {
  readonly blockIndex: number;
  readonly command: TimelineCommand<EngineKind>;
}

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

  let activeEngineKind: EngineKind = EngineKind.A;
  let blockIndex = 0;

  function simulateBlock(blockFrames: number): void {
    const currentBlockIndex = blockIndex;
    let segmentIndex = 0;

    const drainedCommands = drainHotswapMailboxIntoTimeline({
      mailboxConsumer: mailbox.consumer,
      pendingCommands: pendingRTCommands,
      timeline,
      blockFrames,
    });

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
      if (lastStep === undefined) {
        continue;
      }

      const phase = lastStep.decision.status.phase;
      if (phase !== "idle") {
        sawNonIdlePhase = true;
      } else if (sawNonIdlePhase) {
        return { completed: true, blocksRun };
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
