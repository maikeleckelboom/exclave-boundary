/**
 * @fileoverview
 * Public surface for `@seqlok/hotswap`.
 *
 * - RT protocol (`spec.ts`)
 * - Command codec for transport (`commands.ts`)
 * - Host-side scheduling (`schedule-swap.ts`)
 * - Error domain (`errors/hotswap.ts`)
 */

export type {
  HotswapCommand,
  InstallSwapCommand,
  HotswapCommandTag,
} from "./commands";

export {
  HOTSWAP_COMMAND_WORDS_PER_SLOT,
  HOTSWAP_COMMAND_TAG_INSTALL,
  createHotswapCommandCodec,
} from "./commands";

export {
  createTicketId,
  initSwapStateRT,
  stepSwapStateRT,
  type TicketId,
  type SwapPhase,
  type SwapStepKind,
  type SwapTicketRT,
  type SwapStatusRT,
  type SwapStateRT,
  type SwapStepDecisionRT,
} from "./spec";

export { HOTSWAP_ERRORS, createHotswapError } from "./errors/hotswap";

export type {
  HotswapError,
  HotswapErrorCode,
  HotswapErrorKey,
  HotswapErrorFactory,
  HotswapInvalidTicketDetails,
} from "./errors/hotswap";

/**
 * Host-side scheduling helpers.
 *
 * - `scheduleSwap` implements Level 2.5 Reject-While-Busy
 * - `SwapResult` reports acceptance/rejection reasons
 */
export {
  scheduleSwap,
  type HotswapSchedulerConfig,
  type SwapResult,
} from "./schedule-swap";
