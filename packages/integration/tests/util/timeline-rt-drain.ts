/**
 * @file timeline-rt-drain.ts
 *
 * Shared helpers for draining the hotswap mailbox into pending RT commands
 * and selecting the commands that apply to a given timeline block.
 */

import type { TimelineCommand, TimelineDriver } from "../../src";
import type { HotswapCommand } from "@seqlok/hotswap";

interface HotswapMailboxConsumer<EngineKind extends number> {
  drain(handlers: {
    onCommand(command: HotswapCommand<EngineKind>): void;
  }): void;
}

interface HotswapMailbox<EngineKind extends number> {
  readonly consumer: HotswapMailboxConsumer<EngineKind>;
}

/**
 * Drain the hotswap mailbox into the pending RT command queue and
 * return the commands that should fire in the current block.
 *
 * This is shared between the timeline-level harness and the engine-bank
 * harness so the "mailbox → pendingRTCommands → sorted block commands"
 * behaviour is defined in exactly one place.
 */
export function drainMailboxAndPendingCommands<EngineKind extends number>(
  mailbox: HotswapMailbox<EngineKind>,
  pendingRTCommands: TimelineCommand<EngineKind>[],
  timeline: TimelineDriver<EngineKind>,
  blockFrames: number,
): TimelineCommand<EngineKind>[] {
  // Drain mailbox and project HotswapCommand → TimelineCommand.
  mailbox.consumer.drain({
    onCommand(command): void {
      const { ticket } = command;
      pendingRTCommands.push({
        atFrame: ticket.atFrame,
        priority: 0,
        payload: {
          kind: "installSwap",
          ticket,
        },
      });
    },
  });

  // Select commands that fall into this block.
  const blockStart = timeline.frame;
  const blockEnd = blockStart + blockFrames;

  const drainedCommands: TimelineCommand<EngineKind>[] = [];

  for (let i = pendingRTCommands.length - 1; i >= 0; i -= 1) {
    const cmd = pendingRTCommands[i];
    if (cmd === undefined) {
      continue;
    }
    if (cmd.atFrame < blockEnd) {
      drainedCommands.push(cmd);
      pendingRTCommands.splice(i, 1);
    }
  }

  // Sort by (atFrame, priority).
  drainedCommands.sort((a, b) => {
    if (a.atFrame !== b.atFrame) {
      return a.atFrame - b.atFrame;
    }
    return a.priority - b.priority;
  });

  return drainedCommands;
}
