import { isSeqlokError, type SeqlokError } from "@seqlok/base";
import { describe, expect, it } from "vitest";

import {
  type HotswapSchedulerConfig,
  scheduleSwap,
} from "../src/hotswap/schedule-swap";

import type { CommandProducer, CommandPushResult } from "@seqlok/commands";
import type { SwapTicketRT, TicketId } from "@seqlok/hotswap";

type EngineKind = 0;

interface TestCommand {
  readonly kind: "installSwap";
  readonly ticketId: number;
}

/**
 * Minimal valid ticket for testing.
 *
 * We rely on `initSwapStateRT` validation inside `scheduleSwap` to catch
 * protocol violations; here we use a structurally valid ticket.
 */
function createValidTicket(): SwapTicketRT<EngineKind> {
  return {
    ticketId: 1 as TicketId,
    engineKind: 0 as EngineKind,
    atFrame: 0,
    fadeFrames: 128,
    preWarmBlocks: 0,
  };
}

interface RecordingCommandProducer extends CommandProducer<TestCommand> {
  readonly pushed: readonly TestCommand[];
}

function createRecordingProducer(mailboxId: string): RecordingCommandProducer {
  const pushedInternal: TestCommand[] = [];

  return {
    mailboxId,
    get isClosed(): boolean {
      return false;
    },
    push(command: TestCommand): CommandPushResult {
      pushedInternal.push(command);
      return {
        ok: true,
        queued: pushedInternal.length,
      };
    },
    close(): void {
      // no-op for tests
    },
    get pushed(): readonly TestCommand[] {
      return pushedInternal;
    },
  };
}

function createClosedProducer(mailboxId: string): CommandProducer<TestCommand> {
  return {
    mailboxId,
    get isClosed(): boolean {
      return true;
    },
    push(): CommandPushResult {
      return {
        ok: false,
        reason: "mailboxClosed",
      };
    },
    close(): void {
      // no-op
    },
  };
}

function createOverflowProducer(
  mailboxId: string,
  capacity: number,
  queued: number,
): CommandProducer<TestCommand> {
  return {
    mailboxId,
    get isClosed(): boolean {
      return false;
    },
    push(): CommandPushResult {
      return {
        ok: false,
        reason: "ringOverflow",
        capacity,
        queued,
      };
    },
    close(): void {
      // no-op
    },
  };
}

function createConfig(
  producer: CommandProducer<TestCommand>,
): HotswapSchedulerConfig<EngineKind, TestCommand> {
  return {
    mailboxId: producer.mailboxId,
    producer,
    encodeInstallSwap(ticket: SwapTicketRT<EngineKind>): TestCommand {
      return {
        kind: "installSwap",
        ticketId: ticket.ticketId,
      };
    },
  };
}

function expectCommandsError(
  error: unknown,
  expectedCode: string,
): asserts error is SeqlokError {
  expect(isSeqlokError(error)).toBe(true);

  const seqlokError = error as SeqlokError;
  expect(seqlokError.code).toBe(expectedCode);
}

describe("scheduleSwap", () => {
  it("enqueues an install-swap command on success", () => {
    const producer = createRecordingProducer("lane-A");
    const cfg = createConfig(producer);
    const ticket = createValidTicket();

    expect(() => {
      scheduleSwap(cfg, ticket);
    }).not.toThrow();

    expect(producer.pushed).toHaveLength(1);

    const cmd = producer.pushed[0];
    if (cmd === undefined) {
      throw new Error("expected exactly one pushed command");
    }

    expect(cmd.kind).toBe("installSwap");
    expect(cmd.ticketId).toBe(ticket.ticketId);
  });

  it("maps mailboxClosed push result to commands.mailboxClosed", () => {
    const producer = createClosedProducer("lane-closed");
    const cfg = createConfig(producer);
    const ticket = createValidTicket();

    try {
      scheduleSwap(cfg, ticket);
      // Should not reach here.
      expect(false).toBe(true);
    } catch (error) {
      expectCommandsError(error, "commands.mailboxClosed");
      expect(error.details).toMatchObject({
        mailboxId: "lane-closed",
      });
    }
  });

  it("maps ringOverflow push result to commands.ringOverflow with capacity and queued", () => {
    const capacity = 64;
    const queued = 65;
    const producer = createOverflowProducer("lane-overflow", capacity, queued);
    const cfg = createConfig(producer);
    const ticket = createValidTicket();

    try {
      scheduleSwap(cfg, ticket);
      // Should not reach here.
      expect(false).toBe(true);
    } catch (error) {
      expectCommandsError(error, "commands.ringOverflow");

      expect(error.details).toMatchObject({
        mailboxId: "lane-overflow",
        capacity,
        queued,
      });
    }
  });
});
