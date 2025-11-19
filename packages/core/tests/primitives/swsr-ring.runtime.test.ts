import { describe, it, expect } from 'vitest';

import { SeqlokError } from '../../src/errors/error';
import {
  SWSR_HEADER_WORDS,
  SWSR_HEADER_WRITE_INDEX,
  SWSR_HEADER_READ_INDEX,
  SWSR_HEADER_WRITE_SEQ,
  SWSR_HEADER_DROPPED,
  allocateSwsrRing,
  bindSwsrRingProducer,
  bindSwsrRingConsumer,
} from '../../src/primitives/swsr-ring';

describe('SWSR ring primitives (runtime)', () => {
  const encodeNumber = {
    encode(value: number, dst: Uint32Array, offset: number): void {
      dst[offset] = value;
    },
  };

  const decodeNumber = {
    decode(src: Uint32Array, offset: number): number {
      if (!Object.call(src.keys(), Number.isInteger)) {
        throw new Error(String(Object.keys(src).map((key) => Number.isInteger(key))));
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return src[offset]!;
    },
  };

  it('allocates backing with header + slots and zeroed header', () => {
    const capacity = 4;
    const wordsPerSlot = 2;

    const backing = allocateSwsrRing({ capacity, wordsPerSlot });

    expect(backing.capacity).toBe(capacity);
    expect(backing.wordsPerSlot).toBe(wordsPerSlot);
    expect(backing.sab).toBeInstanceOf(SharedArrayBuffer);

    expect(backing.header.length).toBe(SWSR_HEADER_WORDS);
    expect(backing.slots.length).toBe(capacity * wordsPerSlot);

    // Header is zero-initialized
    for (let i = 0; i < SWSR_HEADER_WORDS; i += 1) {
      expect(backing.header[i]).toBe(0);
    }

    const expectedWords = SWSR_HEADER_WORDS + capacity * wordsPerSlot;
    const expectedBytes = expectedWords * Uint32Array.BYTES_PER_ELEMENT;
    expect(backing.sab.byteLength).toBe(expectedBytes);
  });

  it('rejects invalid layouts with primitives.swsrRingInvalidLayout', () => {
    // capacity <= 0
    expect(() => allocateSwsrRing({ capacity: 0, wordsPerSlot: 1 })).toThrow(SeqlokError);

    try {
      allocateSwsrRing({ capacity: 0, wordsPerSlot: 1 });
    } catch (error) {
      const err = error as SeqlokError<'primitives.swsrRingInvalidLayout'>;
      expect(err.code).toBe('primitives.swsrRingInvalidLayout');
      expect(err.details.capacity).toBe(0);
      expect(err.details.wordsPerSlot).toBe(1);
    }

    // wordsPerSlot <= 0
    expect(() => allocateSwsrRing({ capacity: 1, wordsPerSlot: 0 })).toThrow(SeqlokError);
  });

  it('enqueues and drains values in FIFO order and bumps writeSeq', () => {
    const backing = allocateSwsrRing({ capacity: 8, wordsPerSlot: 1 });
    const producer = bindSwsrRingProducer(backing, encodeNumber);
    const consumer = bindSwsrRingConsumer(backing, decodeNumber);

    expect(producer.enqueue(1)).toBe(true);
    expect(producer.enqueue(2)).toBe(true);
    expect(producer.enqueue(3)).toBe(true);

    // writeSeq should track successful commits
    expect(backing.header[SWSR_HEADER_WRITE_SEQ]).toBe(3);

    const received: number[] = [];
    consumer.drain((value) => {
      received.push(value);
    });

    expect(received).toEqual([1, 2, 3]);

    // Subsequent drain without new writes should be a no-op
    consumer.drain((value) => {
      received.push(value);
    });
    expect(received).toEqual([1, 2, 3]);

    // No drops in this scenario
    expect(producer.stats().dropped).toBe(0);

    // readIndex should have caught up with writeIndex
    expect(backing.header[SWSR_HEADER_READ_INDEX]).toBe(
      backing.header[SWSR_HEADER_WRITE_INDEX],
    );
  });

  it('drops newest value and tracks dropped count when ring is full', () => {
    // With capacity=2, the ring can hold at most 1 in-flight element
    const backing = allocateSwsrRing({ capacity: 2, wordsPerSlot: 1 });
    const producer = bindSwsrRingProducer(backing, encodeNumber);
    const consumer = bindSwsrRingConsumer(backing, decodeNumber);

    const first = producer.enqueue(10);
    const second = producer.enqueue(11); // should be dropped

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

  it('handles wrap-around correctly when draining across the ring boundary', () => {
    const backing = allocateSwsrRing({ capacity: 4, wordsPerSlot: 1 });
    const producer = bindSwsrRingProducer(backing, encodeNumber);
    const consumer = bindSwsrRingConsumer(backing, decodeNumber);

    // Fill up to near the end
    expect(producer.enqueue(1)).toBe(true);
    expect(producer.enqueue(2)).toBe(true);
    expect(producer.enqueue(3)).toBe(true);

    const firstBatch: number[] = [];
    consumer.drain((value) => {
      firstBatch.push(value);
    });
    expect(firstBatch).toEqual([1, 2, 3]);

    // Now write values that will wrap around (slots 3, then 0)
    expect(producer.enqueue(4)).toBe(true);
    expect(producer.enqueue(5)).toBe(true);

    const secondBatch: number[] = [];
    consumer.drain((value) => {
      secondBatch.push(value);
    });
    expect(secondBatch).toEqual([4, 5]);

    // After draining everything, readIndex and writeIndex should match
    expect(backing.header[SWSR_HEADER_READ_INDEX]).toBe(
      backing.header[SWSR_HEADER_WRITE_INDEX],
    );
  });
});
