/**
 * @fileoverview
 * Host-side helper for scheduling hotswap tickets via a command mailbox.
 *
 * @remarks
 * This helper:
 * - Validates tickets by dry-running `initSwapStateRT` off the audio thread.
 * - Enqueues an install-swap command into a {@link CommandProducer}.
 * - Raises typed `hotswap.*` / `commands.*` errors on failure.
 */

import { isSeqlokError } from "@seqlok/base";
import {
  createCommandsError,
  type CommandsError,
  type CommandProducer,
  type CommandPushResult,
} from "@seqlok/commands";
import { initSwapStateRT, type SwapTicketRT } from "@seqlok/hotswap";

export interface HotswapSchedulerConfig<EngineKind extends number, Command> {
  /**
   * Logical identifier for the mailbox used for this hotswap lane.
   *
   * @remarks
   * Used for error reporting on transport failures.
   */
  readonly mailboxId: string;

  /**
   * Producer end of the command mailbox.
   */
  readonly producer: CommandProducer<Command>;

  /**
   * Encode an "install swap" command for the given ticket.
   *
   * @remarks
   * The concrete command union is product-defined; this adapter keeps the
   * scheduler generic.
   */
  readonly encodeInstallSwap: (ticket: SwapTicketRT<EngineKind>) => Command;
}

/**
 * Map a failed command push result into `commands.*` error.
 */
function mapPushFailureToCommandsError(
  mailboxId: string,
  result: CommandPushResult,
): CommandsError | null {
  if (result.ok) {
    return null;
  }

  if (result.reason === "mailboxClosed") {
    return createCommandsError("mailboxClosed", { mailboxId });
  }

  return createCommandsError("ringOverflow", {
    mailboxId,
    capacity: result.capacity,
    queued: result.queued,
  });
}

/**
 * Schedule a hotswap by validating and enqueueing a ticket.
 *
 * @remarks
 * This helper is intended for host/control code, not for audio callbacks.
 * It enforces the invariant that only tickets which survive
 * `initSwapStateRT` are ever sent over the command ring.
 *
 * Failure modes:
 * - Throws `HotswapError` with `code === "hotswap.invalidTicket"` when the
 *   ticket violates protocol preconditions.
 * - Throws `CommandsError` with `code` in `commands.*` when the mailbox
 *   rejects the command (closed / ring overflow).
 */
export function scheduleSwap<EngineKind extends number, Command>(
  cfg: HotswapSchedulerConfig<EngineKind, Command>,
  ticket: SwapTicketRT<EngineKind>,
): void {
  // Dry-run initSwapStateRT into a scratch state to exercise invariants.
  try {
    // The return value is intentionally discarded; we only care that
    // initSwapStateRT does not throw.

    const _scratch = initSwapStateRT(ticket);
  } catch (error) {
    if (isSeqlokError(error) && error.code === "hotswap.invalidTicket") {
      // Host bug: surface as-is to the caller.
      throw error;
    }

    // Other errors should not be swallowed.
    throw error;
  }

  const command = cfg.encodeInstallSwap(ticket);
  const pushResult = cfg.producer.push(command);

  const commandsError = mapPushFailureToCommandsError(
    cfg.mailboxId,
    pushResult,
  );

  if (commandsError !== null) {
    throw commandsError;
  }
}
