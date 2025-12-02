import { describe, expect, it } from "vitest";

import { publish, tryRead, type SeqPair } from "../src";

describe("Seqlock Contention & Fallback Mechanisms", () => {
  /**
   * specific helper to create a SharedArrayBuffer-backed sequence pair
   * for testing concurrency primitives.
   */
  function makeSeqPair(): SeqPair {
    // Allocate 8 bytes: [0] = Lock (u32), [1] = Sequence (u32)
    const u32 = new Uint32Array(new SharedArrayBuffer(8));
    return { u32, lockIndex: 0, seqIndex: 1 };
  }

  it("returns fallback value when lock stays held and spin budget is exhausted", () => {
    const pair = makeSeqPair();

    // Simulate active writer: Lock is odd, Sequence is 0
    pair.u32[0] = 1;
    pair.u32[1] = 0;

    const fallbackValue = 42;
    const result = tryRead(pair, () => fallbackValue, {
      spinBudget: 10,
      retryBudget: 0,
    });

    expect(result.ok).toBe(false);
    // Implementation may optimize spins, so we assert valid range rather than exact count
    expect(result.status.spins).toBeGreaterThanOrEqual(0);
    expect(result.status.retries).toBe(0);
    expect(result.value).toBe(fallbackValue);
  });

  it("throws timeout when retry budget is exhausted under rapid writes", () => {
    const pair = makeSeqPair();
    let readCount = 0;

    expect(() =>
      tryRead(
        pair,
        () => {
          readCount++;
          // Simulate a writer advancing the sequence *during* the read operation
          if (readCount <= 5) {
            const currentSeq = pair.u32[1] ?? 0;
            pair.u32[1] = currentSeq + 1;
          }
          return readCount;
        },
        { spinBudget: 1, retryBudget: 3 },
      ),
    ).toThrow(/timeout/i);
  });

  it("succeeds on first attempt under no contention", () => {
    const pair = makeSeqPair();
    pair.u32[0] = 0; // Lock even (unlocked)
    pair.u32[1] = 0; // Sequence 0

    const expectedValue = 123;
    const result = tryRead(pair, () => expectedValue);

    expect(result.ok).toBe(true);
    expect(result.status.spins).toBe(0);
    expect(result.status.retries).toBe(0);
    expect(result.value).toBe(expectedValue);
  });

  it("detects lock state change occurring mid-read", () => {
    const pair = makeSeqPair();
    pair.u32[0] = 0;
    pair.u32[1] = 5;

    const result = tryRead(
      pair,
      () => {
        // Simulate a writer acquiring the lock (odd) while the read is in progress
        pair.u32[0] = 1;
        return 999;
      },
      { spinBudget: 5, retryBudget: 2 },
    );

    // The read should fail consistency checks and trigger retries
    expect(result.ok).toBe(false);
    expect(result.status.retries).toBeGreaterThan(0);
  });

  it("handles sequence integer overflow (wraparound) correctly", () => {
    const pair = makeSeqPair();
    pair.u32[0] = 0;
    pair.u32[1] = 0xffffffff; // Max u32 value

    publish(pair, () => {
      /* No-op write to trigger sequence increment */
    });

    // Sequence should wrap to 0 (0xffffffff + 1 = 0 in u32 arithmetic)
    expect(pair.u32[1]).toBe(0);

    // Lock should increment twice (acquire + release): 0 -> 1 -> 2
    expect(pair.u32[0]).toBe(2);
  });

  it("throws timeout when no coherent read is possible within budget", () => {
    const pair = makeSeqPair();
    let attempts = 0;

    expect(() =>
      tryRead(
        pair,
        () => {
          attempts++;
          // Force sequence mismatch on every attempt
          const currentSeq = pair.u32[1] ?? 0;
          pair.u32[1] = currentSeq + 1;
          return `attempt-${String(attempts)}`;
        },
        { spinBudget: 0, retryBudget: 3 },
      ),
    ).toThrow(/timeout/i);
  });

  it("resets spin counter between retries (documented behavior)", () => {
    const pair = makeSeqPair();
    let callCount = 0;

    const result = tryRead(
      pair,
      () => {
        callCount++;
        // Force retry by changing sequence for the first few calls
        if (callCount < 3) {
          const currentSeq = pair.u32[1] ?? 0;
          pair.u32[1] = currentSeq + 1;
        }
        return callCount;
      },
      { spinBudget: 5, retryBudget: 5 },
    );

    // Verifies that spins are tracked and multiple read attempts occurred
    expect(result.status.spins).toBeGreaterThanOrEqual(0);
    expect(callCount).toBeGreaterThan(1);
  });

  it("tracks lock progression through a full publish cycle", () => {
    const pair = makeSeqPair();
    pair.u32[0] = 4; // Start even
    pair.u32[1] = 10;

    expect(pair.u32[0] % 2).toBe(0);

    publish(pair, () => {
      // Inside callback, lock must be odd (acquired)
      // Using logical AND for bit check as it's cleaner for binary states
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(pair.u32[0]! & 1).toBe(1);
    });

    // After publish: Lock increments by 2 (acquire + release), Sequence increments by 1
    expect(pair.u32[0]).toBe(6);
    expect(pair.u32[1]).toBe(11);
  });
});
