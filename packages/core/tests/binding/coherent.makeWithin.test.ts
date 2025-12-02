import { describe, expect, it, vi } from "vitest";

import { makeWithin } from "../../src/binding/common/coherent";

describe("Make Within: Coherent Read Primitive", () => {
  it("executes the reader and callback with a coherent value when lock acquisition succeeds", () => {
    const u32 = new Uint32Array(4);
    const pair = { u32, lockIndex: 0, seqIndex: 1 };

    const expectedState = { foo: 42 };
    const reader = vi.fn(() => expectedState);

    const within = makeWithin(
      pair,
      {
        where: "tests.binding.coherent.makeWithin:success",
        spinBudget: 8,
        retryBudget: 2,
      },
      reader,
    );

    const callback = vi.fn();
    within(callback);

    expect(reader).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expectedState);
  });

  it("throws binding.coherentRetryExhausted when retry budget is exhausted due to contention", () => {
    const u32 = new Uint32Array(4);
    const pair = { u32, lockIndex: 0, seqIndex: 1 };

    // Simulate persistent contention by holding the lock (odd state)
    Atomics.store(u32, pair.lockIndex, 1);

    const reader = vi.fn(() => ({ foo: 1337 }));

    const within = makeWithin(
      pair,
      {
        where: "tests.binding.coherent.makeWithin:failure",
        spinBudget: 1,
        retryBudget: 0,
      },
      reader,
    );

    // Note: Seqlock primitives may speculatively execute the reader multiple times.
    // We validate the final error outcome rather than call counts.
    let thrownError: unknown;
    try {
      within(() => {
        // Unreachable on failure
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(Error);

    // Verify specific error code structure
    const err = thrownError as { code?: string };
    expect(err.code).toBe("binding.coherentRetryExhausted");
    // message is owned by the error registry; not asserted here
  });
});
