/**
 * @fileoverview
 * Hotswap command union and codec for delivering RT swap tickets
 * over `@seqlok/commands` mailboxes.
 */

import type { SwapTicketRT } from "./spec";
import type { CommandCodec, DecodeResult } from "@seqlok/commands";

/**
 * Numeric discriminant for the single hotswap command kind.
 */
export type HotswapCommandTag = 1;

/**
 * Tag value for InstallSwapCommand.
 */
export const HOTSWAP_COMMAND_TAG_INSTALL: HotswapCommandTag = 1;

/**
 * Install a swap ticket into the RT protocol.
 *
 * @remarks
 * - `ticket` is the full RT ticket used by `initSwapStateRT`.
 * - Interpretation is per-mailbox (typically one mailbox per engine slot).
 */
export interface InstallSwapCommand<EngineKind extends number> {
  readonly tag: HotswapCommandTag;
  readonly ticket: SwapTicketRT<EngineKind>;
}

/**
 * Union of all hotswap commands.
 *
 * @remarks
 * Currently only {@link InstallSwapCommand}, but defined as a union
 * to allow future extension (cancel, reset, etc.).
 */
export type HotswapCommand<EngineKind extends number> =
  InstallSwapCommand<EngineKind>;

/**
 * Fixed slot size for all hotswap commands, in u32 words.
 *
 * Layout (all `u32`, little-endian):
 *
 * - [0] tag          (1 = install swap ticket)
 * - [1] ticketId
 * - [2] engineKind
 * - [3] atFrame
 * - [4] fadeFrames
 * - [5] preWarmBlocks
 */
export const HOTSWAP_COMMAND_WORDS_PER_SLOT = 6;

/**
 * Logical command type string used when reporting decode errors.
 */
const HOTSWAP_INSTALL_COMMAND_TYPE = "hotswap.installSwap";

export function createHotswapCommandCodec<
  EngineKind extends number,
>(): CommandCodec<HotswapCommand<EngineKind>> {
  const wordsPerSlot = HOTSWAP_COMMAND_WORDS_PER_SLOT;

  function encode(
    command: HotswapCommand<EngineKind>,
    dst: Uint32Array,
    wordOffset: number,
  ): void {
    const base = wordOffset;

    // Single command kind for now.
    dst[base] = command.tag;

    const ticket = command.ticket;

    // Bridge branded TicketId / EngineKind back to plain numbers on the wire.
    dst[base + 1] = ticket.ticketId as number;
    dst[base + 2] = ticket.engineKind as number;
    dst[base + 3] = ticket.atFrame;
    dst[base + 4] = ticket.fadeFrames;
    dst[base + 5] = ticket.preWarmBlocks;
  }

  function decode(
    src: Uint32Array,
    wordOffset: number,
  ): DecodeResult<HotswapCommand<EngineKind>> {
    const base = wordOffset;

    const tagRaw = src[base];

    if (tagRaw === undefined) {
      return {
        ok: false,
        error: {
          kind: "invalidPayload",
          commandType: HOTSWAP_INSTALL_COMMAND_TYPE,
          reason: "slot missing tag word",
        },
      };
    }

    if (tagRaw !== HOTSWAP_COMMAND_TAG_INSTALL) {
      return {
        ok: false,
        error: {
          kind: "unknownCommand",
          commandType: `hotswap.tag=${String(tagRaw)}`,
        },
      };
    }

    const ticketIdRaw = src[base + 1];
    const engineKindRaw = src[base + 2];
    const atFrameRaw = src[base + 3];
    const fadeFramesRaw = src[base + 4];
    const preWarmBlocksRaw = src[base + 5];

    if (
      ticketIdRaw === undefined ||
      engineKindRaw === undefined ||
      atFrameRaw === undefined ||
      fadeFramesRaw === undefined ||
      preWarmBlocksRaw === undefined
    ) {
      return {
        ok: false,
        error: {
          kind: "invalidPayload",
          commandType: HOTSWAP_INSTALL_COMMAND_TYPE,
          reason: "slot missing payload words",
        },
      };
    }

    const ticketIdNumber = ticketIdRaw;
    const engineKind = engineKindRaw as EngineKind;
    const atFrame = atFrameRaw;
    const fadeFrames = fadeFramesRaw;
    const preWarmBlocks = preWarmBlocksRaw;

    if (ticketIdNumber <= 0) {
      return {
        ok: false,
        error: {
          kind: "invalidPayload",
          commandType: HOTSWAP_INSTALL_COMMAND_TYPE,
          reason: "ticketId must be positive",
        },
      };
    }

    if (fadeFrames <= 0) {
      return {
        ok: false,
        error: {
          kind: "invalidPayload",
          commandType: HOTSWAP_INSTALL_COMMAND_TYPE,
          reason: "fadeFrames must be >= 1",
        },
      };
    }

    if (preWarmBlocks < 0) {
      return {
        ok: false,
        error: {
          kind: "invalidPayload",
          commandType: HOTSWAP_INSTALL_COMMAND_TYPE,
          reason: "preWarmBlocks must be >= 0",
        },
      };
    }

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: ticketIdNumber as SwapTicketRT<EngineKind>["ticketId"],
      engineKind,
      atFrame,
      fadeFrames,
      preWarmBlocks,
    };

    const command: InstallSwapCommand<EngineKind> = {
      tag: HOTSWAP_COMMAND_TAG_INSTALL,
      ticket,
    };

    return {
      ok: true,
      command,
    };
  }

  return {
    wordsPerSlot,
    encode,
    decode,
  };
}
