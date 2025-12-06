import { createCommandMailbox, type CommandMailbox } from "@seqlok/commands";

import {
  createHotswapCommandCodec,
  HOTSWAP_COMMAND_WORDS_PER_SLOT,
  type HotswapCommand,
} from "../../src/commands";
import {
  initSwapStateRT,
  stepSwapStateRT,
  type SwapStateRT,
  type SwapStepKind,
} from "../../src/spec";

/**
 * Configuration for the mailbox-backed hotswap driver used in tests.
 */
export interface MailboxDriverConfig<EngineKind extends number> {
  readonly mailboxId: string;
  /**
   * Number of command slots in the ring.
   */
  readonly capacity: number;
  /**
   * Audio block size in frames.
   */
  readonly blockFrames: number;
  /**
   * Initial active engine kind.
   */
  readonly initialActiveKind: EngineKind;
  /**
   * Sentinel value representing "no engine".
   */
  readonly noneSentinel: EngineKind;
}

/**
 * Minimal RT-side driver for hotswap tests: consumes hotswap commands from a
 * mailbox and runs the swap protocol for a single engine slot.
 */
export interface MailboxHotswapDriver<EngineKind extends number> {
  readonly mailbox: CommandMailbox<HotswapCommand<EngineKind>>;

  /**
   * Advance the protocol by one audio block and return the observed step kind.
   */
  step(): SwapStepKind;
}

/**
 * Create a mailbox-backed hotswap driver for tests.
 */
export function createMailboxHotswapDriver<EngineKind extends number>(
  config: MailboxDriverConfig<EngineKind>,
): MailboxHotswapDriver<EngineKind> {
  const { mailboxId, capacity, blockFrames, initialActiveKind, noneSentinel } =
    config;

  const codec = createHotswapCommandCodec<EngineKind>();

  const mailbox = createCommandMailbox<HotswapCommand<EngineKind>>({
    mailboxId,
    codec,
    layout: {
      capacity,
      wordsPerSlot: HOTSWAP_COMMAND_WORDS_PER_SLOT,
    },
  });

  let state: SwapStateRT<EngineKind> | null = null;
  let activeKind: EngineKind = initialActiveKind;
  let nextKind: EngineKind = initialActiveKind;

  function pollCommands(): void {
    mailbox.consumer.drain({
      onCommand(command) {
        // For now, we only have InstallSwapCommand.
        state = initSwapStateRT(command.ticket);
        nextKind = command.ticket.engineKind;
      },
    });
  }

  function step(): SwapStepKind {
    pollCommands();

    if (state === null) {
      // No ticket yet: the protocol is logically idle.
      return "idle";
    }

    const decision = stepSwapStateRT(
      state,
      blockFrames,
      activeKind,
      nextKind,
      noneSentinel,
    );

    if (decision.kind === "retireNow") {
      activeKind = nextKind;
    }

    return decision.kind;
  }

  return {
    mailbox,
    step,
  };
}
