/**
 * @fileoverview
 * Convenience helpers built on top of the RT hot-swap protocol.
 *
 * - Crossfade curve utilities (linear / equal-power).
 * - A JS generator for offline / testing-style iteration of a single swap.
 *
 * The canonical protocol is defined in `spec.ts`:
 * - `SwapStateRT`, `SwapTicketRT`
 * - `initSwapStateRT`
 * - `stepSwapStateRT`
 *
 * These helpers are intentionally non-essential, the state machine in `spec.ts`
 * is the protocol, this module just provides ergonomic tools around it.
 */

import {
  initSwapStateRT,
  stepSwapStateRT,
  type SwapStateRT,
  type SwapStepDecisionRT,
  type SwapTicketRT,
} from "./spec";

/**
 * Crossfade coefficients for blending current/next engine outputs.
 *
 * - `fadeOut`: weight for the current engine.
 * - `fadeIn`:  weight for the next engine.
 */
export interface FadeCoefficients {
  readonly fadeIn: number;
  readonly fadeOut: number;
}

/**
 * Linear crossfade based on the fraction of fade completed.
 *
 * This is primarily useful for visualization or non-audio use-cases.
 */
export function linearFade<EngineKind extends number>(
  state: SwapStateRT<EngineKind>,
): FadeCoefficients {
  const { totalFadeFrames, fadeFramesRemaining } = state;

  if (totalFadeFrames <= 0) {
    return { fadeIn: 0, fadeOut: 1 };
  }

  const tRaw = 1 - fadeFramesRemaining / totalFadeFrames;
  const t = tRaw <= 0 ? 0 : tRaw >= 1 ? 1 : tRaw;

  return {
    fadeIn: t,
    fadeOut: 1 - t,
  };
}

/**
 * Equal-power crossfade (recommended for audio).
 *
 * Uses sin/cos over half a period to preserve perceived loudness as
 * the crossfade progresses.
 */
export function equalPowerFade<EngineKind extends number>(
  state: SwapStateRT<EngineKind>,
): FadeCoefficients {
  const { totalFadeFrames, fadeFramesRemaining } = state;

  if (totalFadeFrames <= 0) {
    return { fadeIn: 0, fadeOut: 1 };
  }

  const tRaw = 1 - fadeFramesRemaining / totalFadeFrames;
  const t = tRaw <= 0 ? 0 : tRaw >= 1 ? 1 : tRaw;

  const angle = t * Math.PI * 0.5;
  const fadeIn = Math.sin(angle);
  const fadeOut = Math.cos(angle);

  return {
    fadeIn,
    fadeOut,
  };
}

/**
 * Static configuration for a single swap simulation.
 *
 * This is deliberately simple and assumes a fixed block size. For
 * real-time engines with variable block sizes, call `stepSwapStateRT`
 * directly instead of using the generator.
 */
export interface SwapGeneratorInput<EngineKind extends number> {
  /**
   * The RT ticket describing this swap. Must satisfy the protocol
   * preconditions:
   * - ticketId !== 0
   * - fadeFrames >= 1
   * - preWarmBlocks >= 0
   */
  readonly ticket: SwapTicketRT<EngineKind>;

  /**
   * Number of frames per simulated audio block.
   */
  readonly blockFrames: number;

  /**
   * Kind of the currently-active engine.
   */
  readonly activeKind: EngineKind;

  /**
   * Kind of the next engine (the one being swapped in).
   */
  readonly nextKind: EngineKind;

  /**
   * Sentinel value representing "no next engine".
   *
   * This is passed through to `stepSwapStateRT` and should match the
   * sentinel used by the actual engine integration.
   */
  readonly noneKindSentinel: EngineKind;
}

/**
 * A typed JS generator that yields one `SwapStepDecisionRT` per block.
 *
 * - `yield` value: the current decision (what to do this block).
 * - `return` value: the final decision (which will have `kind === "retireNow"`).
 * - `next()` input is unused and typed as `void`.
 */
export type SwapDecisionGenerator<EngineKind extends number> = Generator<
  SwapStepDecisionRT<EngineKind>,
  SwapStepDecisionRT<EngineKind>,
  void
>;

/**
 * Create a JS generator that simulates a single swap from `spawn` to `retireNow`.
 *
 * Typical usage (offline / tests / visualization):
 *
 * ```ts
 * const gen = createSwapGenerator({
 *   ticket,
 *   blockFrames: 128,
 *   activeKind: 1,
 *   nextKind: 2,
 *   noneKindSentinel: 0,
 * });
 *
 * for (const decision of gen) {
 *   console.log(decision.kind, decision.status.phase, decision.status.progress);
 * }
 * ```
 *
 * For real-time engines, prefer calling `stepSwapStateRT` directly in the
 * audio callback. This generator is intentionally integration-side ergonomics.
 */
export function* createSwapGenerator<EngineKind extends number>(
  input: SwapGeneratorInput<EngineKind>,
): SwapDecisionGenerator<EngineKind> {
  const state = initSwapStateRT<EngineKind>(input.ticket);

  // Each iteration represents one audio block at `blockFrames`.
  // The generator terminates as soon as the protocol returns `retireNow`.
  // The final `return` value is that same decision.
  for (;;) {
    const decision = stepSwapStateRT<EngineKind>(
      state,
      input.blockFrames,
      input.activeKind,
      input.nextKind,
      input.noneKindSentinel,
    );

    // Expose the pure protocol result to the caller.
    // They remain responsible for interpreting `kind` and doing the
    // actual engine work (run current, prewarm next, blend, retire, etc.).
    yield decision;

    if (decision.kind === "retireNow") {
      return decision;
    }
  }
}
