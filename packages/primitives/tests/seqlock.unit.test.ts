import { describe, expect, it } from "vitest";

import { beginWrite, endWrite, publish, type SeqPair, tryRead } from "../src";

/**
 * Minimal local factory for isolation; avoids shared test utils dependencies.
 * Allocates 16 bytes (4x Uint32). Layout:
 * [0] LOCK, [1] SEQ, [2] PAYLOAD, [3] SPARE
 */
function pair(): { p: SeqPair; u32: Uint32Array; dataIndex: number } {
  const sab = new SharedArrayBuffer(16);
  const u32 = new Uint32Array(sab);
  const p: SeqPair = { u32, lockIndex: 0, seqIndex: 1 };
  const dataIndex = 2;
  return { p, u32, dataIndex };
}

describe("Seqlock Primitives", () => {
  it("publish increments SEQ exactly once and maintains even LOCK parity", () => {
    const { p } = pair();
    // Use nullish coalescing to satisfy strict null checks without non-null assertions
    const seq0 = (p.u32[p.seqIndex] ?? 0) >>> 0;
    const lock0 = (p.u32[p.lockIndex] ?? 0) >>> 0;

    publish(p, () => {
      // No-op payload
    });

    const seq1 = (p.u32[p.seqIndex] ?? 0) >>> 0;
    const lock1 = (p.u32[p.lockIndex] ?? 0) >>> 0;

    // Sequence must increment by 1 (handling u32 wrap)
    expect(seq1).toBe((seq0 + 1) >>> 0);
    // Lock increments by 2 (acquire + release), ensuring it remains even
    expect(lock1 % 2).toBe(0);
    expect(lock1 - lock0).toBe(2);
  });

  it("beginWrite/endWrite cycle toggles LOCK parity and commits sequence once", () => {
    const { p } = pair();
    const lock0 = (p.u32[p.lockIndex] ?? 0) >>> 0;
    const seq0 = (p.u32[p.seqIndex] ?? 0) >>> 0;

    beginWrite(p);

    const lockOdd = (p.u32[p.lockIndex] ?? 0) >>> 0;
    expect(lockOdd % 2).toBe(1); // Locked state

    endWrite(p);

    const lockEven = (p.u32[p.lockIndex] ?? 0) >>> 0;
    const seq1 = (p.u32[p.seqIndex] ?? 0) >>> 0;

    expect(lockEven % 2).toBe(0); // Unlocked state
    expect(lockEven - lock0).toBe(2);
    expect(seq1).toBe((seq0 + 1) >>> 0);
  });

  it("tryRead returns coherent value when uncontended", () => {
    const { p, u32, dataIndex } = pair();
    publish(p, () => {
      u32[dataIndex] = 42;
    });

    const res = tryRead(p, () => u32[dataIndex]);

    expect(res.ok).toBe(true);
    expect(res.value).toBe(42);
    expect(res.status.retries).toBeGreaterThanOrEqual(0);
  });

  it("tryRead returns fallback (ok=false) when writer holds LOCK (odd state)", () => {
    const { p, u32, dataIndex } = pair();
    u32[dataIndex] = 7;

    beginWrite(p);
    try {
      // Set 0 retries to fail immediately on lock contention
      const res = tryRead(p, () => u32[dataIndex], {
        spinBudget: 1,
        retryBudget: 0,
      });

      expect(res.ok).toBe(false);
      // Value is a best-effort capture
      expect(res.value).toBe(7);
      expect(res.status.retries).toBe(0);
    } finally {
      endWrite(p);
    }
  });

  it("handles SEQ integer overflow (wraparound) while remaining readable", () => {
    const { p, u32, dataIndex } = pair();

    // Force SEQ to max u32 to test overflow behavior
    p.u32[p.seqIndex] = 0xffffffff;
    publish(p, () => {
      u32[dataIndex] = 1234;
    });

    // Verify wrap to 0
    expect((p.u32[p.seqIndex] ?? 0) >>> 0).toBe(0);

    // Read should still be coherent despite the wrap
    const r = tryRead(p, () => u32[dataIndex]);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(1234);
  });

  it("sequential publishes increment SEQ by 2 and maintain LOCK parity", () => {
    const { p } = pair();
    const seq0 = (p.u32[p.seqIndex] ?? 0) >>> 0;
    const lock0 = (p.u32[p.lockIndex] ?? 0) >>> 0;

    publish(p, () => {
      /* empty */
    });
    publish(p, () => {
      /* empty */
    });

    expect((p.u32[p.seqIndex] ?? 0) >>> 0).toBe((seq0 + 2) >>> 0);

    const lock = (p.u32[p.lockIndex] ?? 0) >>> 0;
    expect(lock % 2).toBe(0);
    expect(lock - lock0).toBe(4);
  });

  it("bumps seq and unlocks when publish callback throws", () => {
    const { p, u32, dataIndex } = pair();

    // Seed a known value in the payload and capture initial header words.
    u32[dataIndex] = 1;

    const seqBefore = (u32[p.seqIndex] ?? 0) >>> 0;
    const lockBefore = (u32[p.lockIndex] ?? 0) >>> 0;

    expect(() => {
      publish(p, () => {
        // Partial write: mutate the payload, then throw.
        u32[dataIndex] = 2;
        throw new Error("boom");
      });
    }).toThrowError(/boom/);

    const seqAfter = (u32[p.seqIndex] ?? 0) >>> 0;
    const lockAfter = (u32[p.lockIndex] ?? 0) >>> 0;

    // After a failed write:
    // - SEQ must have advanced (no "silent" reuse of the old version number).
    // - LOCK must be even again (writer is no longer active).
    // - LOCK must have moved by exactly 2 (odd → even round trip).
    expect(seqAfter).toBe((seqBefore + 1) >>> 0);

    expect(lockAfter % 2).toBe(0);
    expect(lockAfter).toBe((lockBefore + 2) >>> 0);

    // Sanity: the payload really was mutated under the failed write.
    // We accept "dirty but coherent" memory; the important part is that
    // the header no longer pretends this is still the old version.
    expect(u32[dataIndex]).toBe(2);
  });
});
