import { createCommandMailbox } from "@seqlok/commands";
import {
  createHotswapCommandCodec,
  HOTSWAP_COMMAND_WORDS_PER_SLOT,
  createTicketId,
  type HotswapCommand,
  type SwapStepDecisionRT,
  type SwapTicketRT,
} from "@seqlok/hotswap";
import { describe, expect, it } from "vitest";

import {
  createHotswapSlotDriver,
  scheduleSwap,
  type HotswapSchedulerConfig,
} from "../src";

import type { SwsrRingLayout } from "@seqlok/primitives";

enum EngineKind {
  None = 0,
  Current = 1,
  Next = 2,
}

describe("integration: scheduleSwap → mailbox → HotswapSlotDriver", () => {
  it("delivers a validated ticket over a mailbox and drives the swap back to idle", () => {
    // 1. Hotswap command codec and mailbox for a single slot.
    const codec = createHotswapCommandCodec<EngineKind>();

    const layout: SwsrRingLayout = {
      capacity: 8,
      wordsPerSlot: HOTSWAP_COMMAND_WORDS_PER_SLOT,
    };

    const mailbox = createCommandMailbox<HotswapCommand<EngineKind>>({
      mailboxId: "slot-0",
      codec,
      layout,
    });

    const { producer, consumer } = mailbox;

    // 2. Host-side scheduler config: "install swap" as a mailbox command.
    const schedulerConfig: HotswapSchedulerConfig<
      EngineKind,
      HotswapCommand<EngineKind>
    > = {
      mailboxId: "slot-0",
      producer,
      encodeInstallSwap(
        ticket: SwapTicketRT<EngineKind>,
      ): HotswapCommand<EngineKind> {
        return {
          tag: 1,
          ticket,
        };
      },
    };

    // 3. Valid ticket: small fade and a couple of prewarm blocks.
    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(1),
      engineKind: EngineKind.Next,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 2,
    };

    // 4. Use scheduleSwap (host helper).
    //    This:
    //    - dry-runs initSwapStateRT off-RT
    //    - enqueues the command into the mailbox
    expect(() => {
      scheduleSwap<EngineKind, HotswapCommand<EngineKind>>(
        schedulerConfig,
        ticket,
      );
    }).not.toThrow();

    // 5. RT side: create a real hotswap slot driver.
    const slot = createHotswapSlotDriver<EngineKind>();

    // Drain the mailbox once and install any tickets into the slot.
    const stats = consumer.drain({
      onCommand(command: HotswapCommand<EngineKind>): void {
        // Single command kind for now: install swap ticket.
        slot.acceptTicket(command.ticket);
      },
    });

    expect(stats.processed).toBe(1);
    expect(stats.unknownCommand).toBe(0);
    expect(stats.invalidPayload).toBe(0);

    // Sanity: slot has adopted the ticket.
    expect(slot.hasState).toBe(true);
    expect(slot.state).not.toBeNull();
    expect(slot.state?.ticket.ticketId).toBe(ticket.ticketId);

    // 6. Drive the RT protocol until it returns to idle.
    const blockFrames = 64;
    const activeKind = EngineKind.Current;
    const nextKind = EngineKind.Next;
    const noneKindSentinel = EngineKind.None;

    let sawNonIdlePhase = false;
    let returnedToIdle = false;
    let lastDecision: SwapStepDecisionRT<EngineKind> | null = null;

    // The protocol guarantees progress; this is just a defensive upper bound.
    const maxBlocks = 1_000;

    for (let i = 0; i < maxBlocks; i += 1) {
      const decision = slot.stepBlock(
        blockFrames,
        activeKind,
        nextKind,
        noneKindSentinel,
      );

      lastDecision = decision;

      if (decision.status.phase !== "idle") {
        sawNonIdlePhase = true;
      } else if (sawNonIdlePhase) {
        returnedToIdle = true;
        break;
      }
    }

    expect(sawNonIdlePhase).toBe(true);
    expect(returnedToIdle).toBe(true);
    expect(lastDecision).not.toBeNull();
  });
});
