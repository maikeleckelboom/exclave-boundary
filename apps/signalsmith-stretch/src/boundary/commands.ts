import {
  allocateSwsrRing,
  bindSwsrRingConsumer,
  bindSwsrRingProducer,
  SWSR_HEADER_READ_INDEX,
  SWSR_HEADER_WRITE_INDEX,
  SWSR_HEADER_WRITE_SEQ,
  type SwsrRingBacking,
  type SwsrRingConsumer,
  type SwsrRingProducer,
} from "@exclave/boundary";

export const STRETCH_COMMAND_WORDS_PER_SLOT = 24;
export const DEFAULT_COMMAND_RING_CAPACITY = 16;

const COMMAND_IDS = {
  clearLoop: 7,
  configure: 8,
  destroy: 13,
  flush: 12,
  loadSource: 1,
  pause: 3,
  play: 2,
  presetCheaper: 10,
  presetDefault: 9,
  reset: 11,
  resetFault: 14,
  seek: 5,
  setLoop: 6,
  stop: 4,
} as const;

const COMMAND_NAMES = {
  1: "loadSource",
  2: "play",
  3: "pause",
  4: "stop",
  5: "seek",
  6: "setLoop",
  7: "clearLoop",
  8: "configure",
  9: "presetDefault",
  10: "presetCheaper",
  11: "reset",
  12: "flush",
  13: "destroy",
  14: "resetFault",
} as const;

export type StretchCommandName = keyof typeof COMMAND_IDS;

export interface StretchCommand {
  readonly blockMs: number;
  readonly configSequence: number;
  readonly desiredSequence: number;
  readonly flushOutputFrames: number;
  readonly flags: number;
  readonly id: number;
  readonly intervalMs: number;
  readonly loopEndFrame: number;
  readonly loopStartFrame: number;
  readonly name: StretchCommandName;
  readonly presetIndex: number;
  readonly reserved0: number;
  readonly reserved1: number;
  readonly scheduledOutputFrame: number;
  readonly sequence: number;
  readonly sourceRevision: number;
  readonly splitComputation: boolean;
  readonly targetSourceFrame: number;
}

export interface EnqueueCommandOptions {
  readonly blockMs?: number;
  readonly configSequence?: number;
  readonly desiredSequence?: number;
  readonly flushOutputFrames?: number;
  readonly flags?: number;
  readonly intervalMs?: number;
  readonly loopEndFrame?: number;
  readonly loopStartFrame?: number;
  readonly presetIndex?: number;
  readonly reserved0?: number;
  readonly reserved1?: number;
  readonly scheduledOutputFrame?: number;
  readonly sourceRevision?: number;
  readonly splitComputation?: boolean;
  readonly targetSourceFrame?: number;
}

export interface StretchCommandTransport {
  readonly backing: SwsrRingBacking;
  readonly capacity: number;
  readonly consumer: SwsrRingConsumer<StretchCommand>;
  readonly producer: SwsrRingProducer<StretchCommand>;
  drain(callback: (command: StretchCommand) => void): void;
  enqueue(
    name: StretchCommandName,
    options?: EnqueueCommandOptions,
  ): {
    readonly accepted: boolean;
    readonly command: StretchCommand;
    readonly dropped: number;
    readonly sequence: number;
  };
  stats(): {
    readonly dropped: number;
    readonly readIndex: number;
    readonly writeIndex: number;
    readonly writeSeq: number;
  };
}

const float64Scratch = new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT);
const float64ScratchView = new DataView(float64Scratch);

export interface EncodedF64Words {
  readonly hi: number;
  readonly lo: number;
}

export function encodeF64ToU32Words(value: number): EncodedF64Words {
  float64ScratchView.setFloat64(0, value, true);

  return {
    hi: float64ScratchView.getUint32(4, true),
    lo: float64ScratchView.getUint32(0, true),
  };
}

export function decodeF64FromU32Words(lo: number, hi: number): number {
  float64ScratchView.setUint32(0, lo >>> 0, true);
  float64ScratchView.setUint32(4, hi >>> 0, true);

  return float64ScratchView.getFloat64(0, true);
}

export function bindStretchCommandConsumer(
  backing: SwsrRingBacking,
): SwsrRingConsumer<StretchCommand> {
  return bindSwsrRingConsumer(backing, decoder);
}

const encoder = {
  encode(command: StretchCommand, dst: Uint32Array, offset: number): void {
    writeF64(dst, offset + 6, command.targetSourceFrame);
    writeF64(dst, offset + 8, command.scheduledOutputFrame);
    writeF64(dst, offset + 10, command.loopStartFrame);
    writeF64(dst, offset + 12, command.loopEndFrame);
    writeF64(dst, offset + 14, command.blockMs);
    writeF64(dst, offset + 16, command.intervalMs);
    writeF64(dst, offset + 20, command.flushOutputFrames);

    dst[offset] = command.sequence >>> 0;
    dst[offset + 1] = command.id >>> 0;
    dst[offset + 2] = command.flags >>> 0;
    dst[offset + 3] = command.sourceRevision >>> 0;
    dst[offset + 4] = command.desiredSequence >>> 0;
    dst[offset + 5] = command.configSequence >>> 0;
    dst[offset + 18] = command.presetIndex >>> 0;
    dst[offset + 19] = command.splitComputation ? 1 : 0;
    dst[offset + 22] = command.reserved0 >>> 0;
    dst[offset + 23] = command.reserved1 >>> 0;
  },
};

const decoder = {
  decode(src: Uint32Array, offset: number): StretchCommand {
    const id = src[offset + 1] ?? 0;
    const name = commandNameFromId(id);

    return {
      blockMs: readF64(src, offset + 14),
      configSequence: src[offset + 5] ?? 0,
      desiredSequence: src[offset + 4] ?? 0,
      flushOutputFrames: readF64(src, offset + 20),
      flags: src[offset + 2] ?? 0,
      id,
      intervalMs: readF64(src, offset + 16),
      loopEndFrame: readF64(src, offset + 12),
      loopStartFrame: readF64(src, offset + 10),
      name,
      presetIndex: src[offset + 18] ?? 0,
      reserved0: src[offset + 22] ?? 0,
      reserved1: src[offset + 23] ?? 0,
      scheduledOutputFrame: readF64(src, offset + 8),
      sequence: src[offset] ?? 0,
      sourceRevision: src[offset + 3] ?? 0,
      splitComputation: (src[offset + 19] ?? 0) === 1,
      targetSourceFrame: readF64(src, offset + 6),
    };
  },
};

export function createStretchCommandTransport(
  capacity = DEFAULT_COMMAND_RING_CAPACITY,
): StretchCommandTransport {
  const backing = allocateSwsrRing({
    capacity,
    wordsPerSlot: STRETCH_COMMAND_WORDS_PER_SLOT,
  });
  const producer = bindSwsrRingProducer(backing, encoder);
  const consumer = bindSwsrRingConsumer(backing, decoder);
  let nextSequence = 1;

  return {
    backing,
    capacity,
    consumer,
    drain(callback): void {
      consumer.drain(callback);
    },
    enqueue(name, options = {}) {
      const sequence = nextSequence;
      nextSequence = (nextSequence + 1) >>> 0;

      const command: StretchCommand = {
        blockMs: options.blockMs ?? 0,
        configSequence: options.configSequence ?? 0,
        desiredSequence: options.desiredSequence ?? 0,
        flushOutputFrames: options.flushOutputFrames ?? 0,
        flags: options.flags ?? 0,
        id: COMMAND_IDS[name],
        intervalMs: options.intervalMs ?? 0,
        loopEndFrame: options.loopEndFrame ?? 0,
        loopStartFrame: options.loopStartFrame ?? 0,
        name,
        presetIndex: options.presetIndex ?? 0,
        reserved0: options.reserved0 ?? 0,
        reserved1: options.reserved1 ?? 0,
        scheduledOutputFrame: options.scheduledOutputFrame ?? 0,
        sequence,
        sourceRevision: options.sourceRevision ?? 0,
        splitComputation: options.splitComputation ?? false,
        targetSourceFrame: options.targetSourceFrame ?? 0,
      };
      const accepted = producer.enqueue(command);

      return {
        accepted,
        command,
        dropped: producer.stats().dropped,
        sequence,
      };
    },
    producer,
    stats() {
      return {
        dropped: producer.stats().dropped,
        readIndex: Atomics.load(backing.header, SWSR_HEADER_READ_INDEX),
        writeIndex: Atomics.load(backing.header, SWSR_HEADER_WRITE_INDEX),
        writeSeq: Atomics.load(backing.header, SWSR_HEADER_WRITE_SEQ),
      };
    },
  };
}

function writeF64(dst: Uint32Array, offset: number, value: number): void {
  const words = encodeF64ToU32Words(value);
  dst[offset] = words.lo;
  dst[offset + 1] = words.hi;
}

function readF64(src: Uint32Array, offset: number): number {
  return decodeF64FromU32Words(src[offset] ?? 0, src[offset + 1] ?? 0);
}

function commandNameFromId(id: number): StretchCommandName {
  if (id in COMMAND_NAMES) {
    return COMMAND_NAMES[id as keyof typeof COMMAND_NAMES];
  }

  return "pause";
}
