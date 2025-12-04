/**
 * @fileoverview
 * Public surface for `@seqlok/hotswap`.
 *
 * - RT protocol (`spec.ts`)
 * - Command codec for transport (`commands.ts`)
 * - Non-RT helpers (`generator.ts`)
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
