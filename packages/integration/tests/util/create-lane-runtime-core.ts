import { createCommandMailbox } from "@seqlok/commands";
import {
  createHotswapCommandCodec,
  HOTSWAP_COMMAND_TAG_INSTALL,
  HOTSWAP_COMMAND_WORDS_PER_SLOT,
  type HotswapCommand,
  type SwapTicketRT,
} from "@seqlok/hotswap";

import {
  createHotswapSlotDriver,
  createSlicerState,
  type HotswapSchedulerConfig,
  type TimelineCommand,
  type TimelineDriver,
} from "../../src";

import type { SwsrRingLayout } from "@seqlok/primitives";

/**
 * Shared runtime wiring for lane-level hot-swap tests.
 *
 * This bundles:
 *   - Command mailbox with hotswap codec
 *   - Hotswap slot driver
 *   - Timeline driver + slicer
 *   - Host-side schedulerConfig that pushes InstallSwapCommand into the mailbox
 *
 * Test harnesses (timeline-only vs engine-bank) can build on top of this
 * without duplicating the low-level plumbing.
 */
export function createLaneRuntimeCore<EngineKind extends number>(
  mailboxId: string,
): {
  mailbox: {
    readonly producer: HotswapSchedulerConfig<
      EngineKind,
      HotswapCommand<EngineKind>
    >["producer"];
    readonly consumer: {
      drain(cb: { onCommand(command: HotswapCommand<EngineKind>): void }): void;
    };
  };
  timeline: TimelineDriver<EngineKind>;
  schedulerConfig: HotswapSchedulerConfig<
    EngineKind,
    HotswapCommand<EngineKind>
  >;
} {
  const codec = createHotswapCommandCodec<EngineKind>();

  const layout: SwsrRingLayout = {
    capacity: 16,
    wordsPerSlot: HOTSWAP_COMMAND_WORDS_PER_SLOT,
  };

  const mailbox = createCommandMailbox<HotswapCommand<EngineKind>>({
    mailboxId,
    codec,
    layout,
  });

  const hotswapSlot = createHotswapSlotDriver<EngineKind>();

  const timeline: TimelineDriver<EngineKind> = {
    frame: 0,
    isPlaying: true,
    slicer: createSlicerState<TimelineCommand<EngineKind>>(),
    hotswapSlot,
  };

  const schedulerConfig: HotswapSchedulerConfig<
    EngineKind,
    HotswapCommand<EngineKind>
  > = {
    mailboxId,
    producer: mailbox.producer,
    encodeInstallSwap(
      ticket: SwapTicketRT<EngineKind>,
    ): HotswapCommand<EngineKind> {
      return {
        tag: HOTSWAP_COMMAND_TAG_INSTALL,
        ticket,
      };
    },
  };

  return {
    mailbox: {
      producer: mailbox.producer,
      consumer: mailbox.consumer,
    },
    timeline,
    schedulerConfig,
  };
}
