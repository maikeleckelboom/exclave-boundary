import { describe, expect, it } from "vitest";

/**
 * Represents the atomic state of the seqlock mechanism.
 */
interface SeqState {
  readonly lock: number;
  readonly seq: number;
}

/**
 * Simulates the state transition of the seqlock after `writes` number of cycles.
 *
 * Mechanism:
 * - LOCK increments by 2 per cycle (enter odd, exit even).
 * - SEQ increments by 1 per cycle (commit).
 *
 * Note: Uses zero-fill right shift (>>> 0) to enforce 32-bit unsigned integer arithmetic,
 * simulating the behavior of low-level atomic counters.
 */
function simulateWrites(pre: SeqState, writes: number): SeqState {
  const lock = (pre.lock + (writes << 1)) >>> 0;
  const seq = (pre.seq + writes) >>> 0;
  return { lock, seq };
}

/**
 * Determines if a read operation would consider the `post` state consistent with the `pre` state.
 *
 * Condition for consistency:
 * 1. Lock value is unchanged.
 * 2. Lock is currently free (even parity).
 * 3. Sequence number is unchanged.
 */
function coherenceAccepts(pre: SeqState, post: SeqState): boolean {
  const lockOk = pre.lock === post.lock && (post.lock & 1) === 0;
  const seqOk = pre.seq === post.seq;

  return lockOk && seqOk;
}

/**
 * Detects if a 32-bit unsigned overflow occurred between `pre` and `post` states.
 */
function hasWrap(pre: SeqState, post: SeqState): boolean {
  // In unsigned arithmetic, if the new value is less than the old value, a wrap occurred.
  const lockWrapped = post.lock < pre.lock;
  const seqWrapped = post.seq < pre.seq;
  return lockWrapped || seqWrapped;
}

describe("Seqlock Invariants (ABA Properties)", () => {
  it("rejects reads when writes occur without integer overflow", () => {
    const pre: SeqState = { lock: 0, seq: 0 };
    const MAX_WRITES = 10_000;

    // Verify that for any number of writes within a range that precludes overflow,
    // the coherence check correctly identifies the state as modified.
    for (let writes = 1; writes <= MAX_WRITES; writes++) {
      const post = simulateWrites(pre, writes);

      const accepted = coherenceAccepts(pre, post);
      const wrapped = hasWrap(pre, post);

      if (accepted) {
        // Invariant: Acceptance implies either no modification (impossible here) or overflow.
        expect(wrapped).toBe(true);
      }

      // Since wrap is mathematically impossible for this range starting at 0,
      // the state must strictly be rejected.
      expect(accepted).toBe(false);
    }
  });

  it("guarantees that acceptance of a modified state implies integer overflow", () => {
    const startStates: SeqState[] = [
      { lock: 0, seq: 0 },
      { lock: 0, seq: 0xffff_fff0 },
      {
        lock: 1024,
        seq: 0x7fff_ffff,
      },
      { lock: 0xffff_fffe & ~1, seq: 123_456_789 },
    ];

    const MAX_WRITES = 1_000_000;
    const STEP = 10_001;

    for (const pre of startStates) {
      for (let writes = 0; writes <= MAX_WRITES; writes += STEP) {
        const post = simulateWrites(pre, writes);

        const accepted = coherenceAccepts(pre, post);
        const wrapped = hasWrap(pre, post);

        if (accepted) {
          // Invariant: If accepted, we must not have modified the state (writes === 0)
          // OR the modification must have caused a collision via overflow.
          if (writes === 0) {
            expect(wrapped).toBe(false);
          } else {
            expect(wrapped).toBe(true);
          }
        }
      }
    }
  });
});
