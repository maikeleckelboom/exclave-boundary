import { describe, expect, it } from "vitest";

import {
  allocateSwsrRing,
  bindSwsrRingConsumer,
  bindSwsrRingProducer,
  SWSR_HEADER_DROPPED,
  SWSR_HEADER_READ_INDEX,
  SWSR_HEADER_WORDS,
  SWSR_HEADER_WRITE_INDEX,
  SWSR_HEADER_WRITE_SEQ,
} from "../src";

interface SwsrRingInvalidLayoutError {
  code: "primitives.swsrRingInvalidLayout";
  details: {
    capacity: number;
    wordsPerSlot: number;
    where?: string;
    detail?: string;
  };
}

describe("SWSR Ring Primitives: Runtime Behavior", () => {
  /**
   * Mock encoder strategy for testing.
   * Writes numbers directly into the underlying Uint32Array.
   */
  const encodeNumber = {
    encode(value: number, dst: Uint32Array, offset: number): void {
      dst[offset] = value;
    },
  };

  /**
   * Mock decoder strategy for testing.
   * Reads numbers directly from the underlying Uint32Array.
   */
  const decodeNumber = {
    decode(src: Uint32Array, offset: number): number {
      if (!src[offset]) {
        throw new Error("src[offset] cannot decode value");
      }
      return src[offset];
    },
  };

  it("allocates backing memory with correct header size and zero initialization", () => {
    const capacity = 4;
    const wordsPerSlot = 2;

    const backing = allocateSwsrRing({ capacity, wordsPerSlot });

    expect(backing.capacity).toBe(capacity);
    expect(backing.wordsPerSlot).toBe(wordsPerSlot);
    expect(backing.sab).toBeInstanceOf(SharedArrayBuffer);

    expect(backing.header.length).toBe(SWSR_HEADER_WORDS);
    expect(backing.slots.length).toBe(capacity * wordsPerSlot);

    // Ensure header is zero-initialized
    for (let i = 0; i < SWSR_HEADER_WORDS; i += 1) {
      expect(backing.header[i]).toBe(0);
    }

    // Validate total byte length calculation: Header + (Capacity * SlotSize)
    const expectedWords = SWSR_HEADER_WORDS + capacity * wordsPerSlot;
    const expectedBytes = expectedWords * Uint32Array.BYTES_PER_ELEMENT;
    expect(backing.sab.byteLength).toBe(expectedBytes);
  });

  it("rejects invalid layouts with specific error codes", () => {
    // Case: Capacity <= 0
    expect(() => allocateSwsrRing({ capacity: 0, wordsPerSlot: 1 })).toThrow();

    try {
      allocateSwsrRing({ capacity: 0, wordsPerSlot: 1 });
    } catch (error) {
      const err = error as SwsrRingInvalidLayoutError;
      expect(err.code).toBe("primitives.swsrRingInvalidLayout");
      expect(err.details.capacity).toBe(0);
      expect(err.details.wordsPerSlot).toBe(1);
    }

    // Case: wordsPerSlot <= 0
    expect(() => allocateSwsrRing({ capacity: 1, wordsPerSlot: 0 })).toThrow();
  });

  it("enqueues and drains values in FIFO order while updating write sequences", () => {
    const backing = allocateSwsrRing({ capacity: 8, wordsPerSlot: 1 });
    const producer = bindSwsrRingProducer(backing, encodeNumber);
    const consumer = bindSwsrRingConsumer(backing, decodeNumber);

    expect(producer.enqueue(1)).toBe(true);
    expect(producer.enqueue(2)).toBe(true);
    expect(producer.enqueue(3)).toBe(true);

    // writeSeq tracks successful commits
    expect(backing.header[SWSR_HEADER_WRITE_SEQ]).toBe(3);

    const received: number[] = [];
    consumer.drain((value) => {
      received.push(value);
    });

    expect(received).toEqual([1, 2, 3]);

    // Subsequent drain should be a no-op (idempotent)
    consumer.drain((value) => {
      received.push(value);
    });
    expect(received).toEqual([1, 2, 3]);

    expect(producer.stats().dropped).toBe(0);

    // Read index should have synchronized with write index
    expect(backing.header[SWSR_HEADER_READ_INDEX]).toBe(
      backing.header[SWSR_HEADER_WRITE_INDEX],
    );
  });

  it("drops the newest value when the ring is full and tracks the dropped count", () => {
    // Capacity 2 implies at most 1 usable slot (one slot reserved for head/tail separation)
    const backing = allocateSwsrRing({ capacity: 2, wordsPerSlot: 1 });
    const producer = bindSwsrRingProducer(backing, encodeNumber);
    const consumer = bindSwsrRingConsumer(backing, decodeNumber);

    const first = producer.enqueue(10);
    const second = producer.enqueue(11); // Should fail (drop) due to full ring

    expect(first).toBe(true);
    expect(second).toBe(false);

    // Only one successful commit
    expect(backing.header[SWSR_HEADER_WRITE_SEQ]).toBe(1);
    expect(producer.stats().dropped).toBe(1);
    expect(backing.header[SWSR_HEADER_DROPPED]).toBe(1);

    const drained: number[] = [];
    consumer.drain((value) => {
      drained.push(value);
    });

    expect(drained).toEqual([10]);
  });

  it("handles buffer wrap-around correctly when draining across boundary lines", () => {
    const backing = allocateSwsrRing({ capacity: 4, wordsPerSlot: 1 });
    const producer = bindSwsrRingProducer(backing, encodeNumber);
    const consumer = bindSwsrRingConsumer(backing, decodeNumber);

    // Fill near capacity
    expect(producer.enqueue(1)).toBe(true);
    expect(producer.enqueue(2)).toBe(true);
    expect(producer.enqueue(3)).toBe(true);

    const firstBatch: number[] = [];
    consumer.drain((value) => {
      firstBatch.push(value);
    });
    expect(firstBatch).toEqual([1, 2, 3]);

    // Write new values that force indices to wrap (slots 3 -> 0)
    expect(producer.enqueue(4)).toBe(true);
    expect(producer.enqueue(5)).toBe(true);

    const secondBatch: number[] = [];
    consumer.drain((value) => {
      secondBatch.push(value);
    });
    expect(secondBatch).toEqual([4, 5]);

    // Verify synchronization after full cycle
    expect(backing.header[SWSR_HEADER_READ_INDEX]).toBe(
      backing.header[SWSR_HEADER_WRITE_INDEX],
    );
  });
});
