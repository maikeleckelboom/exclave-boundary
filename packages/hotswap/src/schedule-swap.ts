/**
 * Host-side helper for scheduling hotswap tickets into a command mailbox.
 *
 * This lives in @seqlok/hotswap so tests and host code can share the same
 * semantics directly from the protocol package.
 */

import { isSeqlokError } from "@seqlok/base";
import {
  createCommandsError,
  type CommandsError,
  type CommandProducer,
  type CommandPushResult,
} from "@seqlok/commands";

import { initSwapStateRT, type SwapTicketRT } from "./spec";

/**
 * Configuration for host-side swap scheduling.
 *
 * EngineKind stays generic so this helper can be reused for different lanes.
 */
export interface HotswapSchedulerConfig<EngineKind extends number, Command> {
  /**
   * Logical identifier for the mailbox used for this hotswap lane.
   * Only used for error reporting on transport failures.
   */
  readonly mailboxId: string;

  /**
   * Producer end of the command mailbox.
   */
  readonly producer: CommandProducer<Command>;

  /**
   * Encode an "install swap" command for the given ticket.
   *
   * The concrete command union is product-defined; this adapter keeps the
   * scheduler generic.
   */
  readonly encodeInstallSwap: (ticket: SwapTicketRT<EngineKind>) => Command;

  /**
   * Optional per-lane busy detector.
   *
   * If provided, scheduleSwap will call this before validating/enqueuing
   * a ticket. When it returns true, the swap is rejected with
   * `reason: "lane-busy"` and nothing is pushed into the mailbox.
   *
   * This is the implementation hook for Level 2.5 "Reject While Busy".
   */
  readonly isLaneBusy?: () => boolean;
}

/**
 * Structured result for swap scheduling attempts.
 *
 * - accepted: true  → ticket was validated and enqueued
 * - accepted: false → ticket was rejected; `reason` explains why
 *
 * Transport failures (mailbox closed / overflow) are *still* surfaced as
 * `commands.*` exceptions, not encoded in this result.
 */
export interface SwapResult {
  readonly accepted: boolean;
  readonly reason?:
    | "lane-busy"
    | "invalid-ticket"
    | "out-of-range"
    | "internal-error";
  readonly ticketId?: number;
}

/**
 * Map a failed command push result into a `commands.*` error.
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
 * Validate a SwapTicketRT and enqueue an install-swap command into the lane's
 * command mailbox.
 *
 * Level 2.5 extensions:
 * - Consults cfg.isLaneBusy (if present) to implement "Reject While Busy".
 * - Returns a SwapResult instead of forcing callers to rely solely on
 *   exceptions for invalid tickets vs busy lanes.
 *
 * Still throws for command-mailbox failures (commands.* errors).
 */
export function scheduleSwap<EngineKind extends number, Command>(
  config: HotswapSchedulerConfig<EngineKind, Command>,
  ticket: SwapTicketRT<EngineKind>,
): SwapResult {
  const ticketId = ticket.ticketId as number;

  // Overlap policy: Reject While Busy
  if (config.isLaneBusy?.()) {
    return {
      accepted: false,
      reason: "lane-busy",
      ticketId,
    };
  }

  // Validate ticket using RT protocol
  // If invalid, return a structured rejection instead of throwing
  try {
    // initSwapStateRT performs full ticket validation
    // We don't need the state here, only the validation side-effects
    initSwapStateRT(ticket);
  } catch (error) {
    if (isSeqlokError(error) && error.code === "hotswap.invalidTicket") {
      return {
        accepted: false,
        reason: "invalid-ticket",
        ticketId,
      };
    }

    // For now, surface any other error as-is. "internal-error" and
    // "out-of-range" are reserved for future differentiation at the
    // integration layer
    throw error;
  }

  // Encode and enqueue the command.
  const command = config.encodeInstallSwap(ticket);
  const pushResult = config.producer.push(command);

  const commandsError = mapPushFailureToCommandsError(
    config.mailboxId,
    pushResult,
  );

  if (commandsError !== null) {
    // Command/mailbox failures stay as exceptions — they are not multi-swap policy
    throw commandsError;
  }

  // Success
  return {
    accepted: true,
    ticketId,
  };
}
