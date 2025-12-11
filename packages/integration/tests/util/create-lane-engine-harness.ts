/**
 * @file create-lane-engine-harness.ts
 *
 * Engine-bank level harness for lane hot-swap tests.
 *
 * This extends the shared lane runtime core with a tiny EngineBank that
 * renders constant-valued engines so we can assert sample-level crossfade
 * semantics without touching Web Audio.
 */

import {
  createLaneRuntimeCore,
  processTimelineBlock,
  drainHotswapMailboxIntoTimeline,
  type TimelineCommand,
  type TimelineDriver,
  type TimelineProcessCallbacks,
  type EngineInstance,
  SimpleEngineBank,
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

export class ConstantEngine implements EngineInstance<EngineKind> {
  constructor(
    public readonly kind: EngineKind,
    private readonly value: number,
  ) {}

  render(dst: Float32Array, frames: number): void {
    for (let i = 0; i < frames; i += 1) {
      dst[i] = this.value;
    }
  }
}

export interface RecordedAudioBlock {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly samples: Float32Array;
  readonly decision: SwapStepDecisionRT<EngineKind>;
}

export interface LaneEngineHarness {
  readonly timeline: TimelineDriver<EngineKind>;
  readonly bank: SimpleEngineBank<EngineKind, EngineInstance<EngineKind>>;
  readonly pendingRTCommands: TimelineCommand<EngineKind>[];
  readonly recordedAudio: RecordedAudioBlock[];
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

export function createLaneEngineHarness(): LaneEngineHarness {
  const { mailbox, timeline, schedulerConfig } =
    createLaneRuntimeCore<EngineKind>("lane-0");

  const bank = new SimpleEngineBank<EngineKind, EngineInstance<EngineKind>>();

  bank.register(new ConstantEngine(EngineKind.A, 1.0));
  bank.register(new ConstantEngine(EngineKind.B, 2.0));
  bank.register(new ConstantEngine(EngineKind.C, 3.0));

  const pendingRTCommands: TimelineCommand<EngineKind>[] = [];
  const recordedAudio: RecordedAudioBlock[] = [];

  let activeEngineKind: EngineKind = EngineKind.A;
  let blockIndex = 0;

  // Crossfade runtime state, maintained entirely in the harness. We treat the
  // crossfade as a linear ramp over ticket.fadeFrames.
  let crossfadeFramesElapsed = 0;
  let lastPhase: string | null = null;

  function getActiveTicketFadeFrames(): number {
    const ticket = timeline.hotswapSlot.state?.ticket ?? null;
    if (ticket === null) {
      return 0;
    }
    return ticket.fadeFrames;
  }

  function renderEngine(
    engine: EngineInstance<EngineKind> | null,
    dst: Float32Array,
    frames: number,
  ): void {
    if (engine !== null) {
      engine.render(dst, frames);
      return;
    }

    for (let i = 0; i < frames; i += 1) {
      dst[i] = 0;
    }
  }

  function mixCrossfade(
    dst: Float32Array,
    frames: number,
    status: SwapStepDecisionRT<EngineKind>["status"],
  ): void {
    const current = bank.get(status.activeEngineKind);
    const next = bank.get(status.nextEngineKind);

    const totalFadeFrames = getActiveTicketFadeFrames();
    if (totalFadeFrames <= 0) {
      renderEngine(next ?? current, dst, frames);
      return;
    }

    const currentSamples = new Float32Array(frames);
    const nextSamples = new Float32Array(frames);

    renderEngine(current, currentSamples, frames);
    renderEngine(next, nextSamples, frames);

    const segmentStart = crossfadeFramesElapsed;
    const segmentEnd = segmentStart + frames;
    const localFadeFrames = totalFadeFrames - 1;

    for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
      const absoluteFrame = segmentStart + frameIndex;
      const t = Math.min(1, Math.max(0, absoluteFrame / localFadeFrames));

      const gainCurrent = 1 - t;
      const gainNext = t;

      const currentSample = currentSamples[frameIndex] ?? 0;
      const nextSample = nextSamples[frameIndex] ?? 0;

      dst[frameIndex] = gainCurrent * currentSample + gainNext * nextSample;
    }

    crossfadeFramesElapsed = segmentEnd;
  }

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

        const samples = new Float32Array(frames);

        if (decision.status.phase === "crossfade") {
          if (lastPhase !== "crossfade") {
            crossfadeFramesElapsed = 0;
          }
          mixCrossfade(samples, frames, decision.status);
        } else if (decision.kind === "runCurrentAndPrewarmNext") {
          const current = bank.get(decision.status.activeEngineKind);
          renderEngine(current, samples, frames);

          const next = bank.get(decision.status.nextEngineKind);
          if (next !== null) {
            const throwaway = new Float32Array(frames);
            renderEngine(next, throwaway, frames);
          }
        } else {
          const current = bank.get(decision.status.activeEngineKind);
          renderEngine(current, samples, frames);
        }

        recordedAudio.push({
          blockIndex: currentBlockIndex,
          segmentIndex,
          samples,
          decision,
        });

        if (decision.kind === "retireNow") {
          activeEngineKind = currentNextKind;
        }

        lastPhase = decision.status.phase;
        segmentIndex += 1;
      },

      applyCommandSideEffects(): void {
        // No-op in this harness: we only care about audio and decisions.
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

      const lastBlock = recordedAudio[recordedAudio.length - 1];
      if (lastBlock === undefined) {
        continue;
      }

      const phase = lastBlock.decision.status.phase;
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
    bank,
    pendingRTCommands,
    recordedAudio,
    schedulerConfig,
    simulateBlock,
    runUntilSwapComplete,
  };
}
