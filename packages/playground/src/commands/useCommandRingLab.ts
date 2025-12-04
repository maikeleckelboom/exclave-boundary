// File: packages/playground/src/composables/useCommandRingLab.ts

/**
 * @fileoverview
 * Composable for the Command Ring Lab visualization.
 *
 * @remarks
 * Uses the actual `@seqlok/commands` API:
 * - `createCommandMailbox()` to allocate a SWSR-backed mailbox
 * - `CommandProducer.push()` for enqueuing
 * - `CommandConsumer.drain(hooks)` for consuming
 * - Header inspection via `CommandMailbox.backing.header`
 */

import {
  type CommandCodec,
  type CommandConsumerHooks,
  type CommandDrainStats,
  type CommandMailbox,
  type CommandPushResult,
  createCommandMailbox,
  type DecodeResult,
} from "@seqlok/commands";
import {
  SWSR_HEADER_DROPPED,
  SWSR_HEADER_READ_INDEX,
  SWSR_HEADER_WRITE_INDEX,
  SWSR_HEADER_WRITE_SEQ,
} from "@seqlok/primitives";
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";

// DEMO COMMAND TYPES

/**
 * Demo command opcodes for visualization.
 */
export const enum DemoOpCode {
  Noop = 0,
  Ping = 1,
  SetValue = 2,
  Trigger = 3,
}

/**
 * Human-readable labels for opcodes.
 */
export const OPCODE_LABELS: Record<DemoOpCode, string> = {
  [DemoOpCode.Noop]: "NOOP",
  [DemoOpCode.Ping]: "PING",
  [DemoOpCode.SetValue]: "SET",
  [DemoOpCode.Trigger]: "TRIG",
};

/**
 * Minimal command for visualization purposes.
 * Two words: [opCode, timestampLo]
 */
export interface DemoCommand {
  readonly opCode: DemoOpCode;
  readonly timestampMs: number;
}

/**
 * Words per slot for the demo codec.
 */
const DEMO_WORDS_PER_SLOT = 2;

/**
 * CommandCodec implementation for DemoCommand.
 *
 * @remarks
 * This is a proper `CommandCodec<C>` as required by `createCommandMailbox`.
 */
const DEMO_CODEC: CommandCodec<DemoCommand> = {
  wordsPerSlot: DEMO_WORDS_PER_SLOT,

  encode(command: DemoCommand, dst: Uint32Array, wordOffset: number): void {
    dst[wordOffset] = command.opCode;
    dst[wordOffset + 1] = command.timestampMs & 0xffffffff;
  },

  decode(src: Uint32Array, wordOffset: number): DecodeResult<DemoCommand> {
    const opCode = src[wordOffset];
    if (!opCode) {
      throw new Error("Unknown opCode");
    }
    const timestampMs = src[wordOffset + 1];
    if (!timestampMs) {
      throw new Error("Unknown timestampMs");
    }

    // Validate opcode range
    if (opCode > DemoOpCode.Trigger.valueOf()) {
      return {
        ok: false,
        error: {
          kind: "unknownCommand",
          commandType: `0x${opCode.toString(16)}`,
        },
      };
    }

    return {
      ok: true,
      command: {
        opCode: opCode as DemoOpCode,
        timestampMs,
      },
    };
  },
};

// EVENT LOG TYPES

export type LogEventKind =
  | "enqueue"
  | "enqueue_dropped"
  | "enqueue_closed"
  | "drain_batch"
  | "drain_empty"
  | "mailbox_closed"
  | "mailbox_opened"
  | "ring_reset";

export interface LogEvent {
  readonly id: number;
  readonly kind: LogEventKind;
  readonly timestamp: number;
  readonly seq?: number;
  readonly count?: number;
  readonly payload?: DemoCommand;
  readonly pushResult?: CommandPushResult;
}

// RING SNAPSHOT TYPES

export interface RingSnapshot {
  readonly writeIndex: number;
  readonly readIndex: number;
  readonly writeSeq: number;
  readonly dropped: number;
  readonly inFlight: number;
  readonly utilizationPct: number;
  readonly isFull: boolean;
  readonly isEmpty: boolean;
}

export type SlotState =
  | "empty"
  | "pending"
  | "read_head"
  | "write_head"
  | "both_heads";

export interface SlotView {
  readonly index: number;
  readonly state: SlotState;
  readonly isPending: boolean;
  readonly isReadHead: boolean;
  readonly isWriteHead: boolean;
  readonly age: number; // 0 = newest, higher = older
}

// CUMULATIVE METRICS

export interface CumulativeMetrics {
  totalEnqueued: number;
  totalDropped: number;
  totalConsumed: number;
  peakUtilization: number;
  totalUnknownCommand: number;
  totalInvalidPayload: number;
}

// CONFIGURATION

export const CAPACITY_OPTIONS = [4, 8, 16, 32, 64] as const;
export type CapacityOption = (typeof CAPACITY_OPTIONS)[number];

const MAX_LOG_ENTRIES = 200;

// COMPOSABLE

export function useCommandRingLab() {
  // Configuration state

  const capacity = ref<CapacityOption>(16);

  // Rate controls (commands/drains per second)

  const producerRate = ref<number>(5);
  const consumerRate = ref<number>(5);
  const producerPaused = ref<boolean>(false);
  const consumerPaused = ref<boolean>(false);

  // Mailbox instance

  const mailbox = shallowRef<CommandMailbox<DemoCommand> | null>(null);

  // Observable state

  const snapshot = ref<RingSnapshot>({
    writeIndex: 0,
    readIndex: 0,
    writeSeq: 0,
    dropped: 0,
    inFlight: 0,
    utilizationPct: 0,
    isFull: false,
    isEmpty: true,
  });

  const metrics = ref<CumulativeMetrics>({
    totalEnqueued: 0,
    totalDropped: 0,
    totalConsumed: 0,
    peakUtilization: 0,
    totalUnknownCommand: 0,
    totalInvalidPayload: 0,
  });

  const eventLog = ref<LogEvent[]>([]);

  // Internal state

  let nextLogId = 1;
  let nextSeq = 1;
  let producerAccumulator = 0;
  let consumerAccumulator = 0;
  let lastTickTimestamp: number | null = null;
  let rafId: number | null = null;

  // Logging

  function logEvent(
    kind: LogEventKind,
    extra?: Partial<Omit<LogEvent, "id" | "kind" | "timestamp">>,
  ): void {
    const event: LogEvent = {
      id: nextLogId++,
      kind,
      timestamp: performance.now(),
      ...extra,
    };

    eventLog.value = [event, ...eventLog.value].slice(0, MAX_LOG_ENTRIES);
  }

  function clearLog(): void {
    eventLog.value = [];
  }

  // Ring state sampling

  function sampleRingState(): void {
    const mb = mailbox.value;
    if (!mb) {
      snapshot.value = {
        writeIndex: 0,
        readIndex: 0,
        writeSeq: 0,
        dropped: 0,
        inFlight: 0,
        utilizationPct: 0,
        isFull: false,
        isEmpty: true,
      };
      return;
    }

    const { header, capacity: cap } = mb.backing;

    // Read indices atomically from the SWSR header
    const writeIndex = Atomics.load(header, SWSR_HEADER_WRITE_INDEX);
    const readIndex = Atomics.load(header, SWSR_HEADER_READ_INDEX);
    const writeSeq = Atomics.load(header, SWSR_HEADER_WRITE_SEQ);
    const dropped = Atomics.load(header, SWSR_HEADER_DROPPED);

    // Compute queue depth with wrap-around
    const inFlight = computeQueueDepth(writeIndex, readIndex, cap);
    const utilizationPct = (inFlight / cap) * 100;

    snapshot.value = {
      writeIndex,
      readIndex,
      writeSeq,
      dropped,
      inFlight,
      utilizationPct,
      isFull: inFlight >= cap - 1, // One slot reserved to distinguish full vs empty
      isEmpty: inFlight === 0,
    };

    // Track peak utilization
    if (utilizationPct > metrics.value.peakUtilization) {
      metrics.value = {
        ...metrics.value,
        peakUtilization: utilizationPct,
      };
    }
  }

  function computeQueueDepth(
    writeIndex: number,
    readIndex: number,
    cap: number,
  ): number {
    if (writeIndex >= readIndex) {
      return writeIndex - readIndex;
    }
    return cap - readIndex + writeIndex;
  }

  // Slot visualization

  const slotViews = computed<SlotView[]>(() => {
    const cap = capacity.value;
    const { writeIndex, readIndex, inFlight } = snapshot.value;

    const views: SlotView[] = [];

    for (let i = 0; i < cap; i++) {
      const isReadHead = i === readIndex % cap;
      const isWriteHead = i === writeIndex % cap;
      const isPending = isSlotPending(i, readIndex, writeIndex, cap);

      let state: SlotState = "empty";
      if (isReadHead && isWriteHead && inFlight === 0) {
        state = "both_heads";
      } else if (isPending) {
        state = isReadHead ? "read_head" : "pending";
      } else if (isWriteHead) {
        state = "write_head";
      }

      // Age: 0 = oldest (at read head), higher = newer
      const age = isPending ? slotAge(i, readIndex, writeIndex, cap) : -1;

      views.push({
        index: i,
        state,
        isPending,
        isReadHead,
        isWriteHead,
        age,
      });
    }

    return views;
  });

  function isSlotPending(
    slot: number,
    read: number,
    write: number,
    cap: number,
  ): boolean {
    const readMod = read % cap;
    const writeMod = write % cap;

    if (read === write) {
      return false; // empty
    }

    if (writeMod > readMod) {
      return slot >= readMod && slot < writeMod;
    }
    // wrap-around
    return slot >= readMod || slot < writeMod;
  }

  function slotAge(
    slot: number,
    read: number,
    _write: number,
    cap: number,
  ): number {
    const readMod = read % cap;

    if (slot >= readMod) {
      return slot - readMod;
    }
    // wrap-around
    return cap - readMod + slot;
  }

  // Mailbox lifecycle

  function createMailbox(): void {
    // Close existing mailbox if any
    if (mailbox.value) {
      mailbox.value.producer.close();
    }

    const mb = createCommandMailbox<DemoCommand>({
      mailboxId: "lab",
      codec: DEMO_CODEC,
      layout: {
        capacity: capacity.value,
        wordsPerSlot: DEMO_CODEC.wordsPerSlot,
      },
    });

    mailbox.value = mb;
    nextSeq = 1;

    // Reset metrics
    metrics.value = {
      totalEnqueued: 0,
      totalDropped: 0,
      totalConsumed: 0,
      peakUtilization: 0,
      totalUnknownCommand: 0,
      totalInvalidPayload: 0,
    };

    logEvent("mailbox_opened");
    sampleRingState();
  }

  function closeMailbox(): void {
    const mb = mailbox.value;
    if (mb && !mb.producer.isClosed) {
      mb.producer.close();
      logEvent("mailbox_closed");
    }
  }

  function reopenMailbox(): void {
    createMailbox();
  }

  function resetRing(): void {
    clearLog();
    createMailbox();
    logEvent("ring_reset");
  }

  // Producer operations

  function enqueueOne(): void {
    const mb = mailbox.value;
    if (!mb) {
      return;
    }

    const cmd: DemoCommand = {
      opCode: randomOpCode(),
      timestampMs: performance.now(),
    };

    const result = mb.producer.push(cmd);

    if (result.ok) {
      logEvent("enqueue", {
        seq: nextSeq,
        payload: cmd,
        pushResult: result,
      });
      metrics.value = {
        ...metrics.value,
        totalEnqueued: metrics.value.totalEnqueued + 1,
      };
    } else if (result.reason === "mailboxClosed") {
      logEvent("enqueue_closed", {
        seq: nextSeq,
        pushResult: result,
      });
    } else {
      // ringOverflow
      logEvent("enqueue_dropped", {
        seq: nextSeq,
        pushResult: result,
      });
      metrics.value = {
        ...metrics.value,
        totalDropped: metrics.value.totalDropped + 1,
      };
    }

    nextSeq++;
    sampleRingState();
  }

  function burstEnqueue(count: number): void {
    for (let i = 0; i < count; i++) {
      enqueueOne();
    }
  }

  function randomOpCode(): DemoOpCode {
    const codes = [DemoOpCode.Ping, DemoOpCode.SetValue, DemoOpCode.Trigger];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return codes[Math.floor(Math.random() * codes.length)]!;
  }

  // Consumer operations

  function drainOnce(): void {
    const mb = mailbox.value;
    if (!mb) {
      return;
    }

    const hooks: CommandConsumerHooks<DemoCommand> = {
      onCommand(_cmd) {
        // Individual commands handled via stats
      },
      onUnknownCommand(_error) {
        metrics.value = {
          ...metrics.value,
          totalUnknownCommand: metrics.value.totalUnknownCommand + 1,
        };
      },
      onInvalidPayload(_error) {
        metrics.value = {
          ...metrics.value,
          totalInvalidPayload: metrics.value.totalInvalidPayload + 1,
        };
      },
    };

    const stats: CommandDrainStats = mb.consumer.drain(hooks);

    if (stats.processed > 0) {
      logEvent("drain_batch", {
        count: stats.processed,
      });
      metrics.value = {
        ...metrics.value,
        totalConsumed: metrics.value.totalConsumed + stats.processed,
      };
    } else {
      logEvent("drain_empty");
    }

    sampleRingState();
  }

  function drainAll(): void {
    // Drain until empty
    const mb = mailbox.value;
    if (!mb) {
      return;
    }

    let totalDrained = 0;

    const hooks: CommandConsumerHooks<DemoCommand> = {
      onCommand(_cmd) {
        totalDrained++;
      },
      onUnknownCommand(_error) {
        metrics.value = {
          ...metrics.value,
          totalUnknownCommand: metrics.value.totalUnknownCommand + 1,
        };
      },
      onInvalidPayload(_error) {
        metrics.value = {
          ...metrics.value,
          totalInvalidPayload: metrics.value.totalInvalidPayload + 1,
        };
      },
    };

    mb.consumer.drain(hooks);

    if (totalDrained > 0) {
      logEvent("drain_batch", { count: totalDrained });
      metrics.value = {
        ...metrics.value,
        totalConsumed: metrics.value.totalConsumed + totalDrained,
      };
    }

    sampleRingState();
  }

  // Rate-limited loop (rAF + accumulator pattern)

  function tickLoop(timestamp: number): void {
    if (lastTickTimestamp === null) {
      lastTickTimestamp = timestamp;
      rafId = requestAnimationFrame(tickLoop);
      return;
    }

    const deltaMs = timestamp - lastTickTimestamp;
    lastTickTimestamp = timestamp;

    // Producer tick
    if (!producerPaused.value && producerRate.value > 0) {
      const producerIntervalMs = 1000 / producerRate.value;
      producerAccumulator += deltaMs;

      while (producerAccumulator >= producerIntervalMs) {
        enqueueOne();
        producerAccumulator -= producerIntervalMs;
      }
    }

    // Consumer tick
    if (!consumerPaused.value && consumerRate.value > 0) {
      const consumerIntervalMs = 1000 / consumerRate.value;
      consumerAccumulator += deltaMs;

      while (consumerAccumulator >= consumerIntervalMs) {
        drainOnce();
        consumerAccumulator -= consumerIntervalMs;
      }
    }

    // Periodic state sampling even when paused
    sampleRingState();

    rafId = requestAnimationFrame(tickLoop);
  }

  function startLoop(): void {
    if (rafId !== null) {
      return;
    }
    lastTickTimestamp = null;
    producerAccumulator = 0;
    consumerAccumulator = 0;
    rafId = requestAnimationFrame(tickLoop);
  }

  function stopLoop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastTickTimestamp = null;
  }

  // Controls

  function toggleProducer(): void {
    producerPaused.value = !producerPaused.value;
    producerAccumulator = 0;
  }

  function toggleConsumer(): void {
    consumerPaused.value = !consumerPaused.value;
    consumerAccumulator = 0;
  }

  // Computed helpers

  const isMailboxClosed = computed(() => {
    const mb = mailbox.value;
    return mb ? mb.producer.isClosed : true;
  });

  const queueDepth = computed(() => {
    const mb = mailbox.value;
    return mb ? mb.consumer.depth : 0;
  });

  // Lifecycle

  // Rebuild mailbox when capacity changes
  watch(capacity, () => {
    createMailbox();
  });

  // Initialize
  createMailbox();
  startLoop();

  onBeforeUnmount(() => {
    stopLoop();
    closeMailbox();
  });

  return {
    // Configuration
    capacity,
    CAPACITY_OPTIONS,

    // Rate controls
    producerRate,
    consumerRate,
    producerPaused,
    consumerPaused,

    // State
    snapshot,
    metrics,
    eventLog,
    slotViews,

    // Computed
    isMailboxClosed,
    queueDepth,

    // Actions
    toggleProducer,
    toggleConsumer,
    burstEnqueue,
    drainAll,
    closeMailbox,
    reopenMailbox,
    resetRing,
    clearLog,
  };
}
