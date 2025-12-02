/**
 * @fileoverview
 * Public surface for the `@seqlok/commands` package.
 *
 * @remarks
 * For now this package only exposes the typed error domain for
 * command transport. SWSR command rings and higher-level transport
 * helpers will live here next.
 */

export {
  COMMANDS,
  COMMANDS_ERRORS,
  createCommandsError,
} from "./errors/commands";

export type {
  CommandsError,
  CommandsErrorCode,
  CommandsErrorDetailsByKey,
  CommandsErrorFactory,
  CommandsErrorKey,
  CommandsInvalidPayloadDetails,
  CommandsMailboxClosedDetails,
  CommandsRingOverflowDetails,
  CommandsUnknownCommandDetails,
} from "./errors/commands";
