/**
 * Command ring lab composable.
 *
 * Drives a demo SPSC command mailbox and exposes a UI-friendly model:
 * - Config (capacity, producer/consumer pacing)
 * - Snapshots of header state
 * - Derived metrics
 * - Slot views that now also include the current opCode (when pending)
 */

import {
  type CommandCodec,
  type CommandConsumerHooks,
  type CommandMailbox,
  createCommandMailbox,
} from "@seqlok/commands";
import {
  SWSR_HEADER_DROPPED,
  SWSR_HEADER_READ_INDEX,
  SWSR_HEADER_WRITE_INDEX,
  SWSR_HEADER_WRITE_SEQ,
} from "@seqlok/primitives";
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";

/**
 * Tiny demo opcode enum.
 *
 * In real applications this would be your command enum.
 */
export const enum DemoOpCode {
  Noop = 0,
  Ping = 1,
  SetValue = 2,
  Trigger = 3,
}

export const OPCODE_LABELS: Record<DemoOpCode, string> = {
  [DemoOpCode.Noop]: "NOOP",
  [DemoOpCode.Ping]: "PING",
  [DemoOpCode.SetValue]: "SET",
  [DemoOpCode.Trigger]: "TRIG",
};

export interface DemoCommand {
  readonly opCode: DemoOpCode;
  readonly timestampMs: number;
}

/**
 * Layout for the demo codec: [opCode, timestamp].
 */
const DEMO_WORDS_PER_SLOT = 2;

/**
 * Narrow a raw number into DemoOpCode.
 * Useful both for decode() and SAB visualization.
 */
function isDemoOpCode(value: number): value is DemoOpCode {
  const min = DemoOpCode.Noop.valueOf();
  const max = DemoOpCode.Trigger.valueOf();
  return value >= min && value <= max;
}

const DEMO_CODEC: CommandCodec<DemoCommand> = {
  wordsPerSlot: DEMO_WORDS_PER_SLOT,

  encode(source, target, baseIndex) {
    target[baseIndex] = source.opCode;
    target[baseIndex + 1] = Math.floor(source.timestampMs);
  },

  decode(source, baseIndex) {
    const opWord = source[baseIndex];
    const tsWord = source[baseIndex + 1];

    // noUncheckedIndexedAccess-safe: bail out if the slot is underfilled
    if (opWord === undefined || tsWord === undefined) {
      return {
        ok: false,
        error: {
          kind: "unknownCommand",
          commandType: "underfilledSlot",
        },
      };
    }

    if (!isDemoOpCode(opWord)) {
      return {
        ok: false,
        error: {
          kind: "unknownCommand",
          commandType: `0x${opWord.toString(16)}`,
        },
      };
    }

    const command: DemoCommand = {
      opCode: opWord,
      timestampMs: tsWord,
    };

    return { ok: true, command };
  },
};

export type LogEventKind =
  | "mailbox_opened"
  | "mailbox_closed"
  | "ring_reset"
  | "enqueue"
  | "enqueue_closed"
  | "enqueue_dropped"
  | "drain_batch"
  | "drain_empty";

/**
 * Lightweight event for the right-hand log panel.
 */
export interface LogEvent {
  readonly id: number;
  readonly kind: LogEventKind;
  readonly timestamp: number;
  readonly seq: number | null;
  readonly opCode: DemoOpCode | null;
  readonly processedCount: number | null;
}

/**
 * Snapshot of the mailbox header and derived status.
 */
export interface RingSnapshot {
  readonly writeIndex: number;
  readonly readIndex: number;
  readonly writeSeq: number;
  readonly dropped: number;
  readonly inFlight: number;
  readonly utilizationPct: number;
  readonly isFull: boolean;
  readonly isEmpty: boolean;
  readonly usableCapacity: number;
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
  /**
   * Age measured in slots:
   * 0 = oldest (read head), increasing as you move toward the write head.
   * -1 means "not pending".
   */
  readonly age: number;
  /**
   * Opcode currently stored in this slot (when pending and decodable).
   * Undefined for empty slots or unknown values.
   */
  readonly opCode?: DemoOpCode;
}

/**
 * Cumulative metrics for the run.
 */
export interface CumulativeMetrics {
  totalEnqueued: number;
  totalDropped: number;
  totalConsumed: number;
  peakUtilization: number;
  totalUnknownCommand: number;
  totalInvalidPayload: number;
}

export type CapacityOption = 4 | 8 | 16 | 32 | 64;

export const CAPACITY_OPTIONS: readonly CapacityOption[] = [4, 8, 16, 32, 64];

const MAX_LOG_ENTRIES = 200;

export function useCommandRingLab() {
  // Configuration state
  const capacity = ref<CapacityOption>(16);
  const producerRate = ref<number>(5);
  const consumerRate = ref<number>(5);
  const producerPaused = ref<boolean>(false);
  const consumerPaused = ref<boolean>(false);

  // Jitter: models main-thread timing noise (ms of +/- jitter on producer interval)
  const producerJitterMs = ref<number>(0);

  // Mailbox + backing
  const mailbox = shallowRef<CommandMailbox<DemoCommand> | null>(null);

  // Live snapshot of the header state
  const snapshot = ref<RingSnapshot>({
    writeIndex: 0,
    readIndex: 0,
    writeSeq: 0,
    dropped: 0,
    inFlight: 0,
    utilizationPct: 0,
    isFull: false,
    isEmpty: true,
    usableCapacity: 0,
  });

  // Cumulative metrics across the run
  const metrics = ref<CumulativeMetrics>({
    totalEnqueued: 0,
    totalDropped: 0,
    totalConsumed: 0,
    peakUtilization: 0,
    totalUnknownCommand: 0,
    totalInvalidPayload: 0,
  });

  // Right-hand event log
  const eventLog = ref<LogEvent[]>([]);

  // Internal counters / timing
  let nextLogId = 1;
  let nextSeq = 1;
  let producerAccumulator = 0;
  let consumerAccumulator = 0;
  let lastTickTimestamp: number | null = null;
  let rafId: number | null = null;

  function logEvent(
    kind: LogEventKind,
    data?: {
      readonly seq?: number;
      readonly opCode?: DemoOpCode;
      readonly processedCount?: number;
    },
  ): void {
    const base: LogEvent = {
      id: nextLogId++,
      kind,
      timestamp: performance.now(),
      seq: data?.seq ?? null,
      opCode: data?.opCode ?? null,
      processedCount: data?.processedCount ?? null,
    };

    eventLog.value = [base, ...eventLog.value].slice(0, MAX_LOG_ENTRIES);
  }

  function clearLog(): void {
    eventLog.value = [];
  }

  function computeQueueDepth(
    writeIndex: number,
    readIndex: number,
    capacityValue: number,
  ): number {
    if (capacityValue <= 0) {
      return 0;
    }

    const w = writeIndex % capacityValue;
    const r = readIndex % capacityValue;

    if (w >= r) {
      return w - r;
    }

    return capacityValue - r + w;
  }

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
        usableCapacity: 0,
      };
      return;
    }

    const { header, capacity: backingCapacity } = mb.backing;

    const writeIndex = Atomics.load(header, SWSR_HEADER_WRITE_INDEX);
    const readIndex = Atomics.load(header, SWSR_HEADER_READ_INDEX);
    const writeSeq = Atomics.load(header, SWSR_HEADER_WRITE_SEQ);
    const dropped = Atomics.load(header, SWSR_HEADER_DROPPED);

    const inFlight = computeQueueDepth(writeIndex, readIndex, backingCapacity);

    // One-slot-empty convention: usable capacity is capacity - 1.
    const usableCapacity = Math.max(0, backingCapacity - 1);

    const utilizationPct =
      usableCapacity > 0 ? (inFlight / usableCapacity) * 100 : 0;

    const isEmpty = inFlight === 0;
    const isFull = usableCapacity > 0 && inFlight >= usableCapacity;

    snapshot.value = {
      writeIndex,
      readIndex,
      writeSeq,
      dropped,
      inFlight,
      utilizationPct,
      isFull,
      isEmpty,
      usableCapacity,
    };

    if (utilizationPct > metrics.value.peakUtilization) {
      metrics.value.peakUtilization = utilizationPct;
    }
  }

  function isSlotPending(
    slotIndex: number,
    readIndex: number,
    writeIndex: number,
    capacityValue: number,
  ): boolean {
    if (capacityValue <= 0 || readIndex === writeIndex) {
      return false;
    }

    const readMod = readIndex % capacityValue;
    const writeMod = writeIndex % capacityValue;

    if (writeMod > readMod) {
      return slotIndex >= readMod && slotIndex < writeMod;
    }

    // Wrapped case
    return slotIndex >= readMod || slotIndex < writeMod;
  }

  function slotAge(
    slotIndex: number,
    readIndex: number,
    capacityValue: number,
  ): number {
    const readMod = readIndex % capacityValue;

    if (slotIndex >= readMod) {
      return slotIndex - readMod;
    }

    return capacityValue - readMod + slotIndex;
  }

  /**
   * X-ray view: slot-by-slot visualization, including opCode where possible.
   *
   * Note: SAB reads here are *advisory* only. We never base logic on them.
   */
  const slotViews = computed<SlotView[]>(() => {
    const mb = mailbox.value;
    const cap = mb?.backing.capacity ?? capacity.value;
    const { writeIndex, readIndex, inFlight } = snapshot.value;
    const slotBuffer: Uint32Array | null = mb?.backing.slots ?? null;

    if (cap <= 0) {
      return [];
    }

    const views: SlotView[] = [];

    for (let index = 0; index < cap; index += 1) {
      const pending = isSlotPending(index, readIndex, writeIndex, cap);
      const isReadHead = index === readIndex % cap;
      const isWriteHead = index === writeIndex % cap;

      let state: SlotState = "empty";

      if (isReadHead && isWriteHead && inFlight === 0) {
        state = "both_heads";
      } else if (isWriteHead) {
        state = "write_head";
      } else if (isReadHead && pending) {
        state = "read_head";
      } else if (pending) {
        state = "pending";
      }

      const age = pending ? slotAge(index, readIndex, cap) : -1;

      let opCode: DemoOpCode | undefined;

      // Purely visual peek into the SAB slot payload.
      if (pending && slotBuffer) {
        const wordOffset = index * DEMO_WORDS_PER_SLOT;
        const rawOp = slotBuffer[wordOffset];

        if (rawOp && isDemoOpCode(rawOp)) {
          opCode = rawOp;
        }
      }

      views.push({
        index,
        state,
        isPending: pending,
        isReadHead,
        isWriteHead,
        age,
        // we expect a valid opcode whenever pending is true; assert for visualization
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        opCode: opCode!,
      });
    }

    return views;
  });

  function createMailbox(): void {
    if (mailbox.value) {
      mailbox.value.producer.close();
    }

    mailbox.value = createCommandMailbox<DemoCommand>({
      mailboxId: "lab",
      codec: DEMO_CODEC,
      layout: {
        capacity: capacity.value,
        wordsPerSlot: DEMO_CODEC.wordsPerSlot,
      },
    });
    nextSeq = 1;
    producerAccumulator = 0;
    consumerAccumulator = 0;

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
    if (!mb || mb.producer.isClosed) {
      return;
    }

    mb.producer.close();
    logEvent("mailbox_closed");
  }

  function reopenMailbox(): void {
    createMailbox();
  }

  function resetRing(): void {
    clearLog();
    createMailbox();
    logEvent("ring_reset");
  }

  function randomOpCode(): DemoOpCode {
    const candidates: readonly DemoOpCode[] = [
      DemoOpCode.Ping,
      DemoOpCode.SetValue,
      DemoOpCode.Trigger,
    ];
    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx] ?? DemoOpCode.Ping;
  }

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
      metrics.value.totalEnqueued += 1;
      logEvent("enqueue", {
        seq: nextSeq,
        opCode: cmd.opCode,
      });
    } else if (result.reason === "mailboxClosed") {
      logEvent("enqueue_closed", {
        seq: nextSeq,
        opCode: cmd.opCode,
      });
    } else {
      metrics.value.totalDropped += 1;
      logEvent("enqueue_dropped", {
        seq: nextSeq,
        opCode: cmd.opCode,
      });
    }

    nextSeq += 1;
    sampleRingState();
  }

  function burstEnqueue(count: number): void {
    for (let i = 0; i < count; i += 1) {
      enqueueOne();
    }
  }

  function drainOnce(): void {
    const mb = mailbox.value;
    if (!mb) {
      return;
    }

    let processedCount = 0;

    const hooks: CommandConsumerHooks<DemoCommand> = {
      onCommand() {
        processedCount += 1;
      },
      onUnknownCommand() {
        metrics.value.totalUnknownCommand += 1;
      },
      onInvalidPayload() {
        metrics.value.totalInvalidPayload += 1;
      },
    };

    mb.consumer.drain(hooks);

    if (processedCount > 0) {
      metrics.value.totalConsumed += processedCount;
      logEvent("drain_batch", { processedCount });
    } else {
      logEvent("drain_empty");
    }

    sampleRingState();
  }

  function drainAll(): void {
    const mb = mailbox.value;
    if (!mb) {
      return;
    }

    let totalProcessed = 0;

    const hooks: CommandConsumerHooks<DemoCommand> = {
      onCommand() {
        totalProcessed += 1;
      },
      onUnknownCommand() {
        metrics.value.totalUnknownCommand += 1;
      },
      onInvalidPayload() {
        metrics.value.totalInvalidPayload += 1;
      },
    };

    mb.consumer.drain(hooks);

    if (totalProcessed > 0) {
      metrics.value.totalConsumed += totalProcessed;
      logEvent("drain_batch", { processedCount: totalProcessed });
    }

    sampleRingState();
  }

  function tickLoop(timestampMs: number): void {
    if (lastTickTimestamp === null) {
      lastTickTimestamp = timestampMs;
      rafId = window.requestAnimationFrame(tickLoop);
      return;
    }

    let deltaMs = timestampMs - lastTickTimestamp;
    lastTickTimestamp = timestampMs;

    // If the frame took > 100ms (e.g. tab was inactive), we just cap it.
    if (deltaMs > 100) {
      deltaMs = 100;
    }

    // PRODUCER (noisy main thread)
    if (!producerPaused.value && producerRate.value > 0) {
      const intervalMs = 1000 / producerRate.value;

      const jitterRange = producerJitterMs.value;
      const jitterOffset =
        jitterRange > 0 ? (Math.random() - 0.5) * 2 * jitterRange : 0;

      // Jitter the elapsed time seen by the producer
      const effectiveDeltaMs = Math.max(0, deltaMs + jitterOffset);

      producerAccumulator += effectiveDeltaMs;

      // [!] LoopGuard prevents infinite loops if rates are wild
      let loopGuard = 0;
      while (producerAccumulator >= intervalMs && loopGuard < 50) {
        enqueueOne();
        producerAccumulator -= intervalMs;
        loopGuard++;
      }
    }

    // CONSUMER (steady-ish audio thread)
    if (!consumerPaused.value && consumerRate.value > 0) {
      const intervalMs = 1000 / consumerRate.value;
      consumerAccumulator += deltaMs;

      // [!] LoopGuard
      let loopGuard = 0;
      while (consumerAccumulator >= intervalMs && loopGuard < 50) {
        drainOnce();
        consumerAccumulator -= intervalMs;
        loopGuard++;
      }
    }

    sampleRingState();
    rafId = window.requestAnimationFrame(tickLoop);
  }

  function startLoop(): void {
    if (rafId !== null) {
      return;
    }

    lastTickTimestamp = null;
    producerAccumulator = 0;
    consumerAccumulator = 0;
    rafId = window.requestAnimationFrame(tickLoop);
  }

  function stopLoop(): void {
    if (rafId === null) {
      return;
    }

    window.cancelAnimationFrame(rafId);
    rafId = null;
    lastTickTimestamp = null;
  }

  function toggleProducer(): void {
    producerPaused.value = !producerPaused.value;
    producerAccumulator = 0;
  }

  function toggleConsumer(): void {
    consumerPaused.value = !consumerPaused.value;
    consumerAccumulator = 0;
  }

  const isMailboxClosed = computed(() => {
    const mb = mailbox.value;
    return mb ? mb.producer.isClosed : true;
  });

  const queueDepth = computed(() => {
    const mb = mailbox.value;
    return mb ? mb.consumer.depth : 0;
  });

  watch(capacity, () => {
    createMailbox();
  });

  // Initial spin-up
  createMailbox();
  startLoop();

  onBeforeUnmount(() => {
    stopLoop();
    closeMailbox();
  });

  return {
    capacity,
    CAPACITY_OPTIONS,
    producerRate,
    consumerRate,
    producerPaused,
    consumerPaused,
    producerJitterMs,
    snapshot,
    metrics,
    eventLog,
    slotViews,
    isMailboxClosed,
    queueDepth,
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
