import { Worker } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import { createSeqPair, tryRead } from "../src";

describe("Seqlock Cross-Thread Coherence", () => {
  /**
   * Verifies that the seqlock mechanism maintains data consistency (safety)
   * and allows progress (liveness) across thread boundaries using SharedArrayBuffer.
   *
   * The test spawns a writer worker that performs updates using the seqlock protocol.
   * The main thread concurrently attempts to read the value. We assert:
   * 1. Monotonicity: We never observe a value 'going backwards', which ensures we don't see
   * stale values or torn writes mixed with new sequences.
   * 2. Progress: We eventually observe values greater than 0.
   */
  it("observes monotone progression and exits cleanly under concurrent load", async () => {
    // Memory Layout: [LOCK_WORD, SEQUENCE_WORD, DATA_WORD]
    // All 32-bit unsigned integers.
    const sab = new SharedArrayBuffer(3 * 4);
    const u32 = new Uint32Array(sab);
    const INDICES = {
      LOCK: 0,
      SEQ: 1,
      VALUE: 2,
    } as const;

    const pair = createSeqPair(u32, INDICES.LOCK, INDICES.SEQ);
    const WRITE_COUNT = 100_000;

    const workerScript = `
      const { parentPort, workerData } = require('node:worker_threads');

      const u32 = new Uint32Array(workerData.sab);
      const LOCK = workerData.indices.LOCK;
      const SEQ = workerData.indices.SEQ;
      const VALUE = workerData.indices.VALUE;
      const LIMIT = workerData.writes;

      let i = 0;

      function tick() {
        if (i >= LIMIT) {
          parentPort.postMessage({ type: 'done' });
          return;
        }

        // 1. Acquire: Increment LOCK (transitions to odd/locked state)
        Atomics.add(u32, LOCK, 1);

        // 2. Critical Section: Write payload
        Atomics.store(u32, VALUE, i);

        // 3. Release: Increment LOCK (transitions to even/unlocked state)
        Atomics.add(u32, LOCK, 1);

        // 4. Commit: Increment Sequence
        Atomics.add(u32, SEQ, 1);

        i++;

        // Yield to event loop to allow realistic interleaving
        setImmediate(tick);
      }

      tick();
    `;

    const worker = new Worker(workerScript, {
      eval: true,
      workerData: {
        sab,
        indices: INDICES,
        writes: WRITE_COUNT,
      },
    });

    let lastObservedValue = 0;
    let hasProgressed = false;
    let workerFinished = false;

    worker.on("message", (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        "type" in msg &&
        (msg as { type: string }).type === "done"
      ) {
        workerFinished = true;
      }
    });

    // Observe for a fixed duration (500ms) or until completion logic dictates.
    const start = Date.now();

    while (Date.now() - start < 500) {
      const readResult = tryRead(
        pair,
        () => Atomics.load(u32, INDICES.VALUE) >>> 0,
        {
          spinBudget: 512,
          retryBudget: 4,
        },
      );

      if (!readResult.ok) {
        continue;
      }

      const currentValue = readResult.value >>> 0;

      if (currentValue > 0) {
        hasProgressed = true;
      }

      // Invariant: Value must be Monotonically Increasing.
      // If we read a value smaller than last, we read a torn write or stale data.
      expect(currentValue).toBeGreaterThanOrEqual(lastObservedValue);
      lastObservedValue = currentValue;
    }

    // Ensure worker shuts down cleanly
    const exitCode = await new Promise<number>((resolve) => {
      worker.on("exit", resolve);
    });

    expect(exitCode).toBe(0);
    expect(hasProgressed).toBe(true);
    expect(workerFinished).toBe(true);
  }, 20_000);
});
