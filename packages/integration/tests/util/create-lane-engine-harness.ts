/**
 * @file create-lane-engine-harness.ts
 *
 * Engine-bank level harness for lane hot-swap tests.
 *
 * This extends the shared lane runtime core with a tiny EngineBank that
 * renders constant-valued engines so we can assert sample-level crossfade
 * semantics without touching Web Audio.
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
 * Engine identifiers used in the tests.
 *
 * None is the sentinel, A/B/C are concrete engines with constant sample
 * values. The exact mapping is:
 *   - A = 1.0
 *   - B = 2.0
 *   - C = 3.0
 */
export enum EngineKind {
  None = 0,
  A = 1,
  B = 2,
  C = 3,
}

/**
 * Simple engine abstraction: renders into a Float32Array for N frames.
 */
export interface EngineInstance {
  readonly kind: EngineKind;
  render(dst: Float32Array, frames: number): void;
}

/**
 * Test engine that outputs a constant value.
 *
 * With A/B/C mapped to 1/2/3, crossfade math becomes easy to reason about:
 *   output = currentGain * A + nextGain * B/C.
 */
export class ConstantEngine implements EngineInstance {
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

/**
 * EngineBank indirection so the lane never talks to engines directly.
 */
export interface EngineBank<K extends number> {
  get(kind: K): EngineInstance | null;
  unregister(kind: K): void;
}

export class SimpleEngineBank implements EngineBank<EngineKind> {
  private readonly map = new Map<EngineKind, EngineInstance>();

  register(engine: EngineInstance): void {
    this.map.set(engine.kind, engine);
  }

  unregister(kind: EngineKind): void {
    this.map.delete(kind);
  }

  get(kind: EngineKind): EngineInstance | null {
    return this.map.get(kind) ?? null;
  }
}

/**
 * Audio block + decision snapshot for sample-level assertions.
 */
export interface RecordedAudioBlock {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly samples: Float32Array;
  readonly decision: SwapStepDecisionRT<EngineKind>;
}

/**
 * Public harness surface for engine-bank integration tests.
 */
export interface LaneEngineHarness {
  readonly timeline: TimelineDriver<EngineKind>;
  readonly bank: SimpleEngineBank;
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

/**`
 * Builds a lane engine harness:
 *   - underlying lane runtime (mailbox + timeline + scheduler)
 *   - constant-valued engine bank
 *   - crossfade mixer that interprets SwapStepDecisionRT as gains
 */
export function createLaneEngineHarness(): LaneEngineHarness {
  const { mailbox, timeline, schedulerConfig } =
    createLaneRuntimeCore<EngineKind>("lane-0");

  // Engine bank with constant engines: A = 1, B = 2, C = 3.
  const bank = new SimpleEngineBank();
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

  function mixCrossfade(
    dst: Float32Array,
    frames: number,
    status: SwapStepDecisionRT<EngineKind>["status"],
  ): void {
    const current = bank.get(status.activeEngineKind);
    const next = bank.get(status.nextEngineKind);

    const totalFadeFrames = getActiveTicketFadeFrames();
    if (totalFadeFrames <= 0) {
      // Degenerate case: no fade, just jump to next engine.
      if (next !== null) {
        next.render(dst, frames);
      } else if (current !== null) {
        current.render(dst, frames);
      } else {
        for (let i = 0; i < frames; i += 1) {
          dst[i] = 0;
        }
      }
      return;
    }

    const currentBuf = new Float32Array(frames);
    const nextBuf = new Float32Array(frames);

    if (current !== null) {
      current.render(currentBuf, frames);
    } else {
      for (let i = 0; i < frames; i += 1) {
        currentBuf[i] = 0;
      }
    }

    if (next !== null) {
      next.render(nextBuf, frames);
    } else {
      for (let i = 0; i < frames; i += 1) {
        nextBuf[i] = 0;
      }
    }

    const segmentStart = crossfadeFramesElapsed;
    const segmentEnd = segmentStart + frames;

    for (let i = 0; i < frames; i += 1) {
      const globalFrame = segmentStart + i;
      const clampedFrame =
        globalFrame >= totalFadeFrames ? totalFadeFrames : globalFrame;
      const progress =
        totalFadeFrames === 0 ? 1 : clampedFrame / totalFadeFrames;

      const currentGain = 1 - progress;
      const nextGain = progress;

      const currentSample = currentBuf[i] ?? 0;
      const nextSample = nextBuf[i] ?? 0;

      dst[i] = currentSample * currentGain + nextSample * nextGain;
    }

    crossfadeFramesElapsed = segmentEnd;
  }

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

        // Ignore zero-length segments for audio recording: they are protocol
        // artifacts and should not produce samples.
        if (frames > 0) {
          const samples = new Float32Array(frames);

          if (decision.status.phase === "crossfade") {
            if (lastPhase !== "crossfade") {
              crossfadeFramesElapsed = 0;
            }
            mixCrossfade(samples, frames, decision.status);
          } else if (decision.kind === "runCurrentAndPrewarmNext") {
            const current = bank.get(decision.status.activeEngineKind);
            if (current !== null) {
              current.render(samples, frames);
            } else {
              for (let i = 0; i < frames; i += 1) {
                samples[i] = 0;
              }
            }

            const next = bank.get(decision.status.nextEngineKind);
            if (next !== null) {
              const scratch = new Float32Array(frames);
              next.render(scratch, frames);
              // scratch is intentionally discarded: prewarm only
            }
          } else {
            const current = bank.get(decision.status.activeEngineKind);
            if (current !== null) {
              current.render(samples, frames);
            } else {
              for (let i = 0; i < frames; i += 1) {
                samples[i] = 0;
              }
            }
          }

          recordedAudio.push({
            blockIndex: currentBlockIndex,
            segmentIndex,
            samples,
            decision,
          });

          segmentIndex += 1;
        }

        lastPhase = decision.status.phase;

        if (decision.kind === "retireNow") {
          // IMPORTANT: adopt the next engine as the new active engine.
          activeEngineKind = decision.status.nextEngineKind;
          crossfadeFramesElapsed = 0;
        }
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
      if (lastBlock !== undefined) {
        const phase = lastBlock.decision.status.phase;
        if (phase !== "idle") {
          sawNonIdlePhase = true;
        } else if (sawNonIdlePhase) {
          return { completed: true, blocksRun };
        }
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
