import { describe, expect, it } from "vitest";

import {
  HOTSWAP_COMMAND_TAG_INSTALL,
  type HotswapCommand,
} from "../src/commands";
import {
  type HotswapSchedulerConfig,
  scheduleSwap,
} from "../src/schedule-swap";
import { createTicketId, type SwapTicketRT } from "../src/spec";

import type { CommandProducer, CommandPushResult } from "@seqlok/commands";

/**
 * Tiny in-memory CommandProducer so we can observe what scheduleSwap enqueues
 * without pulling in the full mailbox machinery.
 */
function makeTestProducer<C>(mailboxId: string): {
  readonly producer: CommandProducer<C>;
  readonly pushed: C[];
} {
  const pushed: C[] = [];

  const producer: CommandProducer<C> = {
    mailboxId,
    get isClosed() {
      return false;
    },
    push(command: C): CommandPushResult {
      pushed.push(command);
      return {
        ok: true,
        queued: pushed.length,
      };
    },
    close() {
      // No-op for tests, we never close in these cases.
    },
  };

  return { producer, pushed };
}

enum EngineKind {
  None = 0,
  A = 1,
  B = 2,
}

type TestCommand = HotswapCommand<EngineKind>;

function makeValidTicket(id: number): SwapTicketRT<EngineKind> {
  return {
    ticketId: createTicketId(id),
    engineKind: EngineKind.B,
    atFrame: 0,
    fadeFrames: 128,
    preWarmBlocks: 0,
  };
}

describe("@seqlok/hotswap – scheduleSwap", () => {
  it("enqueues an install command for a valid ticket", () => {
    const { producer, pushed } = makeTestProducer<TestCommand>("lane-0");

    const cfg: HotswapSchedulerConfig<EngineKind, TestCommand> = {
      mailboxId: "lane-0",
      producer,
      encodeInstallSwap(ticket) {
        return {
          tag: HOTSWAP_COMMAND_TAG_INSTALL,
          ticket,
        };
      },
    };

    const ticket = makeValidTicket(1);

    const result = scheduleSwap(cfg, ticket);

    expect(result.accepted).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.ticketId).toBe(1);

    expect(pushed).toHaveLength(1);

    const command = pushed[0];
    if (command === undefined) {
      throw new Error("expected exactly one enqueued command");
    }

    expect(command.tag).toBe(HOTSWAP_COMMAND_TAG_INSTALL);
    expect(command.ticket).toBe(ticket);
  });

  it("rejects when the lane reports busy and does not enqueue", () => {
    const { producer, pushed } = makeTestProducer<TestCommand>("lane-0");

    let busyChecks = 0;

    const cfg: HotswapSchedulerConfig<EngineKind, TestCommand> = {
      mailboxId: "lane-0",
      producer,
      encodeInstallSwap(ticket) {
        return {
          tag: HOTSWAP_COMMAND_TAG_INSTALL,
          ticket,
        };
      },
      isLaneBusy() {
        busyChecks += 1;
        return true;
      },
    };

    const ticket = makeValidTicket(2);

    const result = scheduleSwap(cfg, ticket);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("lane-busy");
    expect(result.ticketId).toBe(2);

    expect(busyChecks).toBe(1);
    expect(pushed.length).toBe(0);
  });

  it("rejects invalid tickets (fadeFrames < 1) and does not enqueue", () => {
    const { producer, pushed } = makeTestProducer<TestCommand>("lane-0");

    const cfg: HotswapSchedulerConfig<EngineKind, TestCommand> = {
      mailboxId: "lane-0",
      producer,
      encodeInstallSwap(ticket) {
        return {
          tag: HOTSWAP_COMMAND_TAG_INSTALL,
          ticket,
        };
      },
    };

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(3),
      engineKind: EngineKind.A,
      atFrame: 0,
      // This violates the protocol precondition in initSwapStateRT:
      // `fadeFrames >= 1`.
      fadeFrames: 0,
      preWarmBlocks: 0,
    };

    const result = scheduleSwap(cfg, ticket);

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("invalid-ticket");
    expect(result.ticketId).toBe(3);

    // Because validation fails, nothing should be pushed into the mailbox.
    expect(pushed.length).toBe(0);
  });
});
