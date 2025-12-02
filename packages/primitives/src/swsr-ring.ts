import { invariant } from "@seqlok/base";

import { createPrimitivesError } from "./errors/primitives";

/**
 * Number of 32-bit header words reserved for a SWSR ring.
 *
 * The header is 16 × 4 bytes = 64 bytes, which matches a typical cache line.
 * This keeps metadata (indices, counters) separate from slot payloads and
 * avoids false sharing when the producer and consumer are active.
 */
export const SWSR_HEADER_WORDS = 16;

/**
 * Header word indices.
 *
 * Layout (all u32 in little-endian order):
 *
 * - [0] writeIndex: next slot index the producer will write into (0..capacity-1)
 * - [1] readIndex:  next slot index the consumer will read from   (0..capacity-1)
 * - [2] writeSeq:   monotonically increasing commit counter
 * - [3] dropped:    count of failed enqueue attempts due to a full ring
 * - [4..15] reserved/padding
 */
export const SWSR_HEADER_WRITE_INDEX = 0;
export const SWSR_HEADER_READ_INDEX = 1;
export const SWSR_HEADER_WRITE_SEQ = 2;
export const SWSR_HEADER_DROPPED = 3;

/**
 * Layout parameters used when allocating a SWSR ring.
 *
 * @remarks
 * - `capacity` is the number of slots in the ring (must be ≥ 1).
 * - `wordsPerSlot` is the number of 32-bit words in each slot (≥ 1).
 *   The application is responsible for defining the slot payload layout.
 */
export interface SwsrRingLayout {
  readonly capacity: number;
  readonly wordsPerSlot: number;
}

/**
 * Backing views for a SWSR ring over a SharedArrayBuffer.
 *
 * @remarks
 * - `sab` is the raw SharedArrayBuffer that holds both header and slots.
 * - `header` is a 16-word Uint32Array view over the header.
 * - `slots` is a contiguous view over all slot payload words.
 */
export interface SwsrRingBacking {
  readonly sab: SharedArrayBuffer;
  readonly header: Uint32Array;
  readonly slots: Uint32Array;
  readonly capacity: number;
  readonly wordsPerSlot: number;
}

/**
 * Encoder from a typed payload `T` into a slot.
 *
 * Implementations must write exactly `wordsPerSlot` 32-bit values starting
 * at `dst[offset]`. The ring does not enforce this at runtime.
 */
export interface SwsrRingEncode<T> {
  encode(value: T, dst: Uint32Array, offset: number): void;
}

/**
 * Decoder from a slot payload into a typed value `T`.
 *
 * Implementations must read exactly `wordsPerSlot` 32-bit values starting
 * at `src[offset]`. The ring does not enforce this at runtime.
 */
export interface SwsrRingDecode<T> {
  decode(src: Uint32Array, offset: number): T;
}

/**
 * Lightweight statistics for a producer.
 *
 * @remarks
 * Currently tracks only the number of dropped enqueue attempts due to
 * a full ring. This can be extended later without breaking ABI.
 */
export interface SwsrRingStats {
  readonly dropped: number;
}

/**
 * Single-writer producer API for a SWSR ring.
 *
 * @template T Typed payload representation.
 */
export interface SwsrRingProducer<T> {
  /**
   * Enqueue a value into the ring.
   *
   * @returns
   * - `true` if the value was enqueued successfully.
   * - `false` if the ring was full and the value was dropped.
   *
   * @remarks
   * This method is wait-free for the producer. It never blocks; on a full
   * ring it increments the `dropped` counter and returns `false`.
   */
  enqueue(value: T): boolean;

  /**
   * Read a snapshot of producer-side statistics.
   *
   * @remarks
   * Stats are approximate and intended for introspect/introspect only.
   */
  stats(): SwsrRingStats;
}

/**
 * Single-reader consumer API for a SWSR ring.
 *
 * @template T Typed payload representation.
 */
export interface SwsrRingConsumer<T> {
  /**
   * Drain all currently enqueued values and invoke `handle` for each.
   *
   * @remarks
   * - This method processes a finite snapshot of the ring contents: it
   *   drains from the current `readIndex` up to the current `writeIndex`.
   * - It does not block and does not spin or wait for new data.
   * - Typical usage is "once per audio block" or "once per render tick".
   */
  drain(handle: (value: T) => void): void;
}

/**
 * Allocate a new single-writer single-reader ring buffer on a fresh
 * SharedArrayBuffer.
 *
 * @param layout Capacity and slot-size parameters.
 *
 * @returns A backing structure with views over the header and slot region.
 *
 * @throws If `capacity < 1` or `wordsPerSlot < 1`.
 *
 * @remarks
 * - The underlying buffer is zero-initialized.
 * - The header is 16 words (64 bytes) aligned at the start of the buffer
 *   and is followed by `capacity * wordsPerSlot` payload words.
 * - The caller is responsible for sharing `sab` with the producer and
 *   consumer threads (e.g. via postMessage or AudioWorkletOptions).
 */
export function allocateSwsrRing(layout: SwsrRingLayout): SwsrRingBacking {
  const { capacity, wordsPerSlot } = layout;

  invariant(Number.isInteger(capacity) && capacity > 0, () =>
    createPrimitivesError("swsrRingInvalidLayout", {
      where: "primitives.allocateSwsrRing",
      detail: "capacity must be a positive integer",
      capacity,
      wordsPerSlot,
    }),
  );

  invariant(Number.isInteger(wordsPerSlot) && wordsPerSlot > 0, () =>
    createPrimitivesError("swsrRingInvalidLayout", {
      where: "primitives.allocateSwsrRing",
      detail: "wordsPerSlot must be a positive integer",
      capacity,
      wordsPerSlot,
    }),
  );

  const totalWords = SWSR_HEADER_WORDS + capacity * wordsPerSlot;

  const sab = new SharedArrayBuffer(totalWords * Uint32Array.BYTES_PER_ELEMENT);

  const header = new Uint32Array(sab, 0, SWSR_HEADER_WORDS);
  const slots = new Uint32Array(
    sab,
    SWSR_HEADER_WORDS * Uint32Array.BYTES_PER_ELEMENT,
    capacity * wordsPerSlot,
  );

  header[0] = 0; // writeIndex
  header[1] = 0; // readIndex
  header[2] = 0; // writeSeq
  header[3] = 0; // dropped
  // [4..15] remain zeroed (reserved/padding)

  return {
    sab,
    header,
    slots,
    capacity,
    wordsPerSlot,
  };
}

/**
 * Bind a single-writer producer to an existing SWSR ring backing.
 *
 * @param backing Backing views created by {@link allocateSwsrRing}.
 * @param encode  Typed payload encoder.
 *
 * @returns A producer that can enqueue values of type `T`.
 *
 * @remarks
 * - This API assumes a single producer thread. Concurrent writers are
 *   undefined behavior.
 * - On a full ring the newest value is dropped; the producer never blocks.
 */
export function bindSwsrRingProducer<T>(
  backing: SwsrRingBacking,
  encode: SwsrRingEncode<T>,
): SwsrRingProducer<T> {
  const { header, slots, capacity, wordsPerSlot } = backing;

  const enqueue = (value: T): boolean => {
    const readIndex = Atomics.load(header, SWSR_HEADER_READ_INDEX);
    const writeIndex = Atomics.load(header, SWSR_HEADER_WRITE_INDEX);

    // Compute next index with wrap-around.
    const next = writeIndex + 1 === capacity ? 0 : writeIndex + 1;

    if (next === readIndex) {
      // Ring is full: drop newest value and bump introspect counter.
      Atomics.add(header, SWSR_HEADER_DROPPED, 1);
      return false;
    }

    const base = writeIndex * wordsPerSlot;
    encode.encode(value, slots, base);

    // Publish the new writeIndex. JS Atomics are sequentially consistent,
    // which is stronger than the acquire/release pattern we target for C++.
    Atomics.store(header, SWSR_HEADER_WRITE_INDEX, next);
    Atomics.add(header, SWSR_HEADER_WRITE_SEQ, 1);

    return true;
  };

  const stats = (): SwsrRingStats => {
    const dropped = Atomics.load(header, SWSR_HEADER_DROPPED);
    return { dropped };
  };

  return { enqueue, stats };
}

/**
 * Bind a single-reader consumer to an existing SWSR ring backing.
 *
 * @param backing Backing views created by {@link allocateSwsrRing}.
 * @param decode  Typed payload decoder.
 *
 * @returns A consumer that can drain values of type `T`.
 *
 * @remarks
 * - This API assumes a single consumer thread. Concurrent readers are
 *   undefined behavior.
 * - `drain` processes a finite snapshot from `readIndex` up to the current
 *   `writeIndex` and then updates `readIndex` in one atomic store.
 */
export function bindSwsrRingConsumer<T>(
  backing: SwsrRingBacking,
  decode: SwsrRingDecode<T>,
): SwsrRingConsumer<T> {
  const { header, slots, capacity, wordsPerSlot } = backing;

  const drain = (handle: (value: T) => void): void => {
    let readIndex = Atomics.load(header, SWSR_HEADER_READ_INDEX);
    const writeIndex = Atomics.load(header, SWSR_HEADER_WRITE_INDEX);

    while (readIndex !== writeIndex) {
      const base = readIndex * wordsPerSlot;
      const value = decode.decode(slots, base);
      handle(value);

      readIndex = readIndex + 1 === capacity ? 0 : readIndex + 1;
    }

    Atomics.store(header, SWSR_HEADER_READ_INDEX, readIndex);
  };

  return { drain };
}
