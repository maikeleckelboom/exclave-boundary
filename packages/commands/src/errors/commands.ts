/**
 * @fileoverview
 * Error codes and detail types for command transport.
 *
 * @remarks
 * This domain covers:
 * - SWSR command ring overflow and backpressure
 * - Mailbox lifecycle issues (closed / offline)
 * - Command envelope validation (type + payload)
 */

import {
  buildErrorDomain,
  DOMAIN_IDS,
  type BuiltErrorDomain,
  type DomainRegistry,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorKeyOf,
  type KeyedErrorFactoryOf,
  type SeqlokError,
} from "@seqlok/base";

/**
 * Details for `commands.ringOverflow`.
 *
 * @remarks
 * Used when a producer attempts to enqueue into a full SWSR command ring.
 */
export interface CommandsRingOverflowDetails extends ErrorDetails {
  /**
   * Total number of slots in the ring.
   */
  readonly capacity: number;

  /**
   * Number of commands observed as "in flight" at the time of failure.
   */
  readonly queued: number;
}

/**
 * Details for `commands.mailboxClosed`.
 *
 * @remarks
 * Used when a logical mailbox / endpoint has been closed or torn down
 * while callers still attempt to enqueue commands into it.
 */
export interface CommandsMailboxClosedDetails extends ErrorDetails {
  /**
   * Logical identifier for the mailbox / endpoint.
   *
   * @example "engine-A", "deck-1-transport"
   */
  readonly mailboxId: string;
}

/**
 * Details for `commands.unknownCommand`.
 *
 * @remarks
 * Used when the decoded command kind is not recognised by the consumer.
 */
export interface CommandsUnknownCommandDetails extends ErrorDetails {
  /**
   * Raw command type / kind name.
   */
  readonly commandType: string;
}

/**
 * Details for `commands.invalidPayload`.
 *
 * @remarks
 * Used when the payload fails structural or range validation for an
 * otherwise valid command type.
 */
export interface CommandsInvalidPayloadDetails extends ErrorDetails {
  /**
   * Logical command type that failed validation.
   */
  readonly commandType: string;

  /**
   * Optional human-readable hint describing the validation failure.
   */
  readonly reason?: string;
}

/**
 * Detail map keyed by local error keys.
 */
export interface CommandsErrorDetailsByKey {
  readonly ringOverflow: CommandsRingOverflowDetails;
  readonly mailboxClosed: CommandsMailboxClosedDetails;
  readonly unknownCommand: CommandsUnknownCommandDetails;
  readonly invalidPayload: CommandsInvalidPayloadDetails;
}

/**
 * Domain-local definitions used to build the registry.
 */
const COMMANDS_DEFS = {
  ringOverflow: {
    message: "Command ring overflow: command dropped",
    meta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: true,
      domainHint: "commands",
      tags: ["transport", "ring", "backpressure"],
    },
  },
  mailboxClosed: {
    message: "Command mailbox is closed",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
      domainHint: "commands",
      tags: ["transport", "mailbox", "lifecycle"],
    },
  },
  unknownCommand: {
    message: "Unknown command type",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
      domainHint: "commands",
      tags: ["transport", "decode"],
    },
  },
  invalidPayload: {
    message: "Invalid command payload",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
      domainHint: "commands",
      tags: ["transport", "validation"],
    },
  },
} as const;

type CommandsDefs = typeof COMMANDS_DEFS;

/**
 * Full logical domain instance for `commands.*`.
 */
export const COMMANDS: BuiltErrorDomain<"commands", CommandsDefs> =
  buildErrorDomain("commands", DOMAIN_IDS.commands, COMMANDS_DEFS);

/**
 * Registry view used by diagnostics / introspect.
 */
export const COMMANDS_ERRORS: DomainRegistry<"commands", CommandsDefs> =
  COMMANDS.registry;

/**
 * Union of fully-qualified error codes in the `commands.*` domain.
 */
export type CommandsErrorCode = ErrorCodeOf<typeof COMMANDS>;

/**
 * Union of local error keys in the `commands.*` domain.
 */
export type CommandsErrorKey = ErrorKeyOf<typeof COMMANDS>;

/**
 * Strongly-typed SeqlokError for the `commands.*` domain.
 */
export type CommandsError = SeqlokError<CommandsErrorCode>;

/**
 * Keyed factory that enforces the correct detail type per error key.
 */
export const createCommandsError: KeyedErrorFactoryOf<
  typeof COMMANDS,
  CommandsErrorDetailsByKey
> = COMMANDS.createError;

/**
 * Convenience alias for the commands error factory type.
 */
export type CommandsErrorFactory = typeof createCommandsError;
