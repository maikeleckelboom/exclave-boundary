/**
 * @fileoverview
 * Fan-in bus over multiple command consumers.
 *
 * @remarks
 * Provides a single `drainAll` entry point over multiple
 * {@link CommandConsumer} instances. It has no knowledge of the underlying
 * transport; it only composes existing consumers.
 */

import { createCommandsError } from "./errors/commands";

import type {
  DecodeErrorInvalidPayload,
  DecodeErrorUnknownCommand,
} from "./codec";
import type { CommandConsumer, CommandDrainStats } from "./mailbox";

/**
 * Identifier for a command source/mailbox.
 *
 * @remarks
 * Kept as a plain string to avoid ceremony. Host code can choose its own
 * naming scheme (e.g. "ui-main", "midi-bridge", "lane-1").
 */
export type SourceId = string;

/**
 * Hooks invoked while draining all registered sources.
 */
export interface CommandBusHooks<C> {
  /**
   * Called for each successfully decoded command.
   */
  onCommand(command: C, sourceId: SourceId): void;

  /**
   * Called when a source reports an unknown command type.
   */
  onUnknownCommand?(error: DecodeErrorUnknownCommand, sourceId: SourceId): void;

  /**
   * Called when a source reports an invalid payload.
   */
  onInvalidPayload?(error: DecodeErrorInvalidPayload, sourceId: SourceId): void;
}

/**
 * Aggregate statistics from draining all sources.
 */
export interface CommandBusDrainStats {
  readonly totalProcessed: number;
  readonly totalUnknownCommand: number;
  readonly totalInvalidPayload: number;

  /**
   * Per-source statistics keyed by {@link SourceId}.
   */
  readonly bySource: ReadonlyMap<SourceId, CommandDrainStats>;
}

interface SourceEntry<C> {
  readonly id: SourceId;
  readonly consumer: CommandConsumer<C>;
}

/**
 * Fan-in bus over multiple {@link CommandConsumer} instances.
 */
export interface CommandBus<C> {
  /**
   * Number of registered sources.
   */
  readonly sourceCount: number;

  /**
   * Snapshot of registered source ids.
   */
  readonly sourceIds: readonly SourceId[];

  /**
   * Register a new source.
   *
   * @throws CommandsError with code `"commands.duplicateSourceId"`
   *         if the source id is already registered.
   */
  addSource(id: SourceId, consumer: CommandConsumer<C>): void;

  /**
   * Remove a source by id.
   *
   * @returns true if removed, false if not found.
   */
  removeSource(id: SourceId): boolean;

  /**
   * Drain all registered sources in registration order.
   *
   * @remarks
   * No fairness guarantees beyond registration order. Higher-level
   * scheduling belongs in the host/topology layer.
   */
  drainAll(hooks: CommandBusHooks<C>): CommandBusDrainStats;
}

/**
 * Create an empty command bus.
 */
export function createCommandBus<C>(): CommandBus<C> {
  const sources: SourceEntry<C>[] = [];

  function addSource(id: SourceId, consumer: CommandConsumer<C>): void {
    if (sources.some((entry) => entry.id === id)) {
      throw createCommandsError("duplicateSourceId", { sourceId: id });
    }
    sources.push({ id, consumer });
  }

  function removeSource(id: SourceId): boolean {
    const index = sources.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return false;
    }
    sources.splice(index, 1);
    return true;
  }

  function drainAll(hooks: CommandBusHooks<C>): CommandBusDrainStats {
    let totalProcessed = 0;
    let totalUnknownCommand = 0;
    let totalInvalidPayload = 0;

    const bySource = new Map<SourceId, CommandDrainStats>();

    for (const { id, consumer } of sources) {
      const stats = consumer.drain({
        onCommand(command) {
          hooks.onCommand(command, id);
        },
        onUnknownCommand(error) {
          hooks.onUnknownCommand?.(error, id);
        },
        onInvalidPayload(error) {
          hooks.onInvalidPayload?.(error, id);
        },
      });

      totalProcessed += stats.processed;
      totalUnknownCommand += stats.unknownCommand;
      totalInvalidPayload += stats.invalidPayload;

      bySource.set(id, stats);
    }

    return {
      totalProcessed,
      totalUnknownCommand,
      totalInvalidPayload,
      bySource,
    };
  }

  return {
    addSource,
    removeSource,
    drainAll,
    get sourceCount() {
      return sources.length;
    },
    get sourceIds() {
      return sources.map((entry) => entry.id);
    },
  };
}
