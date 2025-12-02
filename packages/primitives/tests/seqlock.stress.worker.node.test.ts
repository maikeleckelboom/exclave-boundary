import { Worker } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import { tryRead, type SeqPair } from "../src";

interface SeqlockTimeoutError {
  readonly code: "primitives.seqlockTimeout";
}

/**
 * Type guard to identify Seqlock timeout errors.
 * These occur when the retry budget is exhausted due to high contention.
 */
function isSeqlockTimeout(error: unknown): error is SeqlockTimeoutError {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const maybe = error as { code?: unknown };
  return maybe.code === "primitives.seqlockTimeout";
}

describe("Seqlock Cross-Thread Stress", () => {
  it("reads monotone values under concurrent publishes", async () => {
    const WRITES = 50_000;
    const VALUE_INDEX = 2;
    const MAX_OK_READS = 2000;

    // Layout: [0: LOCK, 1: SEQ, 2: VALUE]
    // We allocate 12 bytes for 3 x Uint32
    const sab = new SharedArrayBuffer(3 * 4);
    const u32 = new Uint32Array(sab);
    const pair: SeqPair = { u32, lockIndex: 0, seqIndex: 1 };

    const worker = new Worker(
      `
          const { parentPort, workerData } = require('node:worker_threads');

          /** @type {Uint32Array} */
          const u32 = new Uint32Array(workerData.sab);
          const lockIndex = workerData.lockIndex >>> 0;
          const seqIndex = workerData.seqIndex >>> 0;
          const valueIndex = workerData.valueIndex >>> 0;
          const writes = workerData.writes >>> 0;

          for (let n = 1; n <= writes; n++) {
            // Begin Write: Increment LOCK (state becomes odd/locked)
            Atomics.add(u32, lockIndex, 1);

            // Write payload
            u32[valueIndex] = n;

            // End Write: Increment LOCK (state becomes even/unlocked)
            Atomics.add(u32, lockIndex, 1);

            // Commit: Increment SEQUENCE to invalidate previous reads
            Atomics.add(u32, seqIndex, 1);
          }

          parentPort.postMessage({ type: 'done' });
        `,
      {
        eval: true,
        workerData: {
          sab,
          lockIndex: 0,
          seqIndex: 1,
          valueIndex: VALUE_INDEX,
          writes: WRITES,
        },
      },
    );

    // Track worker completion via message, though the exit code check is primary
    let done = false;
    worker.on("message", (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: string }).type === "done"
      ) {
        done = true;
      }
    });

    // Stress Loop: Attempt to read values while the worker writes rapidly
    let lastValue: number | undefined = undefined;
    let successfulReads = 0;

    while (successfulReads < MAX_OK_READS) {
      let res;
      try {
        // Attempt to read the value at index 2
        res = tryRead(pair, () => u32[VALUE_INDEX]);
      } catch (error) {
        // In high contention scenarios, the reader may exhaust its retry budget.
        // We treat this as a transient failure and continue the stress test.
        if (isSeqlockTimeout(error)) {
          continue;
        }
        throw error;
      }

      if (!res.ok) {
        continue;
      }

      const value = res.value;

      // Skip the initial state (0) if we haven't started tracking writes yet
      if (value === 0 && lastValue === undefined) {
        continue;
      }

      // First successful read of a written value
      if (lastValue === undefined) {
        expect(value).toBeGreaterThan(0);
        lastValue = value;
        successfulReads += 1;
        continue;
      }

      // Verify monotonicity: The value must never decrease
      expect(value).toBeGreaterThanOrEqual(lastValue);
      lastValue = value;
      successfulReads += 1;
    }

    // Ensure the worker exits cleanly
    const exitCode = await new Promise<number>((resolve) => {
      worker.on("exit", (code) => {
        resolve(code);
      });
    });

    expect(exitCode).toBe(0);
    expect(successfulReads).toBeGreaterThan(0);
    expect(lastValue).not.toBeNull();
    expect(lastValue).toBeLessThanOrEqual(WRITES);
    expect(done).toBe(true);
  }, 20_000);
});
