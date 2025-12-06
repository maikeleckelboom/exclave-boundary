/**
 * @fileoverview
 * Thin RT helper for driving a single hotswap slot.
 *
 * @remarks
 * Wraps {@link initSwapStateRT} and {@link stepSwapStateRT} into a small
 * driver object so integration code does not have to manage SwapStateRT
 * directly.
 */

import {
  initSwapStateRT,
  stepSwapStateRT,
  type SwapStateRT,
  type SwapStepDecisionRT,
  type SwapTicketRT,
} from "@seqlok/hotswap";

export interface HotswapSlotDriver<EngineKind extends number> {
  /**
   * Whether there is an active swap state for this slot.
   */
  readonly hasState: boolean;

  /**
   * Current RT state for this slot.
   *
   * @remarks
   * - When {@link hasState} is false, this will be `null`.
   * - Callers should treat this as read-only and use {@link stepBlock}
   *   to advance the protocol.
   */
  readonly state: SwapStateRT<EngineKind> | null;

  /**
   * Accept a new swap ticket for this slot.
   *
   * @remarks
   * The ticket is assumed to have been validated off the audio thread.
   */
  acceptTicket(ticket: SwapTicketRT<EngineKind>): void;

  /**
   * Clear any active swap state and return to idle.
   */
  clear(): void;

  /**
   * Advance the swap protocol by one audio block.
   *
   * @param blockFrames      Number of frames in this block.
   * @param activeKind       Kind of the current engine.
   * @param nextKind         Kind of the next engine.
   * @param noneKindSentinel Sentinel representing "no next engine".
   */
  stepBlock(
    blockFrames: number,
    activeKind: EngineKind,
    nextKind: EngineKind,
    noneKindSentinel: EngineKind,
  ): SwapStepDecisionRT<EngineKind>;
}

/**
 * Create a new hotswap slot driver.
 */
export function createHotswapSlotDriver<
  EngineKind extends number,
>(): HotswapSlotDriver<EngineKind> {
  let hasState = false;
  let state: SwapStateRT<EngineKind> | null = null;

  return {
    get hasState(): boolean {
      return hasState;
    },

    get state(): SwapStateRT<EngineKind> | null {
      return state;
    },

    acceptTicket(ticket: SwapTicketRT<EngineKind>): void {
      // Reject While Busy:
      // - If there is an active ticket in any non-idle phase, we do NOT
      //   overwrite it. The second ticket is effectively ignored.
      // - Once the protocol reaches `retire` and steps to `idle`, it clears
      //   `state.hasTicket`, and new tickets are allowed again.
      if (hasState && state?.hasTicket) {
        // Busy: keep the existing swap; ignore the overlapping ticket.
        return;
      }

      // Idle (no state or no active ticket): accept a new swap.
      state = initSwapStateRT(ticket);
      hasState = true;
    },

    clear(): void {
      state = null;
      hasState = false;
    },

    stepBlock(
      blockFrames: number,
      activeKind: EngineKind,
      nextKind: EngineKind,
      noneKindSentinel: EngineKind,
    ): SwapStepDecisionRT<EngineKind> {
      if (!hasState || state === null) {
        return {
          kind: "idle",
          status: {
            phase: "idle",
            ticketId: 0,
            progress: 0,
            activeEngineKind: activeKind,
            nextEngineKind: noneKindSentinel,
          },
        };
      }

      return stepSwapStateRT(
        state,
        blockFrames,
        activeKind,
        nextKind,
        noneKindSentinel,
      );
    },
  };
}
