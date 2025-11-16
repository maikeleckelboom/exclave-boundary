/**
 * @fileoverview
 * Seqlock primitives for Seqlok (LOCK/SEQ pair).
 *
 * This module implements the low-level protocol used by the bindings to
 * publish and sample coherent state via a single-writer / multi-reader
 * seqlock:
 *
 * - {@link SeqPair} describes indices into a shared `Uint32Array` storing
 *   `[LOCK, SEQ]`.
 * - {@link beginWrite} / {@link endWrite} wrap the writer critical section.
 * - {@link publish} provides an exception-safe RAII-style write.
 * - {@link tryRead} performs a bounded, best-effort coherent read and is used
 *   by primitives tests.
 *
 * @remarks
 * This module is an internal implementation detail of `@seqlok/core`.
 * Runtime bindings call into it indirectly via higher-level helpers.
 *
 * Functions {@link createSeqPair} and {@link tryRead} exist primarily for
 * primitives tests and are marked `@internal`. They are not part of the
 * supported bindings surface and may change without notice.
 */

import { addU32, loadU32, spinUntilEven } from './atomics';
import { createError } from '../errors/error';
import { invariant } from '../errors/invariant';

import type { PrimitivesSeqlockTimeoutDetails } from '../errors/codes/primitives';

/**
 * Pair of indices into a shared `Uint32Array` that stores `[LOCK, SEQ]`.
 *
 * @remarks
 * - `LOCK` is incremented by writers:
 *   - even → no writer active
 *   - odd  → writer in critical section
 * - `SEQ` is a monotonically increasing version stamp, incremented exactly
 *   once per successful commit.
 */
export interface SeqPair {
  readonly u32: Uint32Array;
  readonly lockIndex: number;
  readonly seqIndex: number;
}

/**
 * Construct a {@link SeqPair} with bounds validation.
 *
 * @param u32 Shared `Uint32Array` plane holding the lock/sequence words.
 * @param lockIndex Index of the LOCK word (must be in-bounds).
 * @param seqIndex Index of the SEQ word (must be in-bounds and distinct from `lockIndex`).
 *
 * @throws {@link import('../errors').SeqlokError}
 * Throws with code `"internal.assertionFailed"` if any index is out of bounds,
 * or if `lockIndex === seqIndex`.
 *
 * @internal
 * Used by primitives tests only; not part of the bindings API.
 */
export function createSeqPair(
  u32: Uint32Array,
  lockIndex: number,
  seqIndex: number,
): SeqPair {
  const len = u32.length >>> 0;

  invariant(
    lockIndex >= 0 && lockIndex < len,
    'internal.assertionFailed',
    'lockIndex out of bounds',
    {
      where: 'primitives.seqlock.createSeqPair',
      detail: `lockIndex=${String(lockIndex)}, len=${String(len)}`,
    },
  );

  invariant(
    seqIndex >= 0 && seqIndex < len,
    'internal.assertionFailed',
    'seqIndex out of bounds',
    {
      where: 'primitives.seqlock.createSeqPair',
      detail: `seqIndex=${String(seqIndex)}, len=${String(len)}`,
    },
  );

  invariant(
    lockIndex !== seqIndex,
    'internal.assertionFailed',
    'lockIndex and seqIndex must differ',
    {
      where: 'primitives.seqlock.createSeqPair',
    },
  );

  return { u32, lockIndex, seqIndex };
}

/**
 * Configuration for bounded coherent reads.
 *
 * @remarks
 * These budgets control how aggressively `tryRead` will spin and retry in
 * the presence of a contending writer.
 */
export interface TryReadOptions {
  /**
   * Maximum number of spin iterations per attempt while waiting for an even
   * LOCK value. Default: 1024.
   */
  readonly spinBudget?: number;

  /**
   * Maximum number of verification retries if a writer races the reader
   * (i.e. SEQ changes during sampling). Default: 8.
   */
  readonly retryBudget?: number;
}

/**
 * Status of a seqlock read attempt.
 *
 * @remarks
 * This aggregates total work and classifies the outcome:
 *
 * - `'ok'` – a coherent snapshot was obtained.
 * - `'writerActive'` – writer never quiesced within the spin budget.
 * - `'budgetExhausted'` – spin and/or retry budgets were fully consumed.
 */
export interface ReadStatus {
  /** Total spins consumed across all attempts. */
  readonly spins: number;
  /** Retries consumed because writers raced (excludes the initial attempt). */
  readonly retries: number;
  /**
   * Outcome category:
   * - `'ok'`             → coherent snapshot
   * - `'writerActive'`   → writer never quiesced on this attempt
   * - `'budgetExhausted'`→ exceeded spin/retry budgets
   */
  readonly kind: 'ok' | 'writerActive' | 'budgetExhausted';
}

/**
 * Discriminated result of {@link tryRead}.
 *
 * @typeParam T Value type returned by the reader function.
 */
export type TryReadResult<T> =
  | { ok: true; value: T; status: ReadStatus }
  | {
      ok: false;
      value: T;
      status: ReadStatus;
    };

/**
 * Begin a write: transition LOCK from even → odd to enter the critical section.
 *
 * @remarks
 * This function does **not** perform any memory barriers by itself; the
 * seqlock protocol relies on the ordering of:
 *
 * 1. `beginWrite()` – LOCK becomes odd.
 * 2. user writes their data.
 * 3. `endWrite()` – SEQ increment + LOCK becomes even.
 */
export function beginWrite(p: SeqPair): void {
  addU32(p.u32, p.lockIndex, 1);
}

/**
 * End a write: commit the new version first, then unlock.
 *
 * @remarks
 * Ordering is crucial:
 *
 * - `SEQ` is incremented *before* releasing the lock so that readers which
 *   see an even LOCK and stable SEQ pair are guaranteed to observe a fully
 *   committed snapshot.
 * - Unlocking last (odd → even) prevents readers from seeing an even LOCK
 *   with bytes written under the odd phase but without the version stamp.
 */
export function endWrite(p: SeqPair): void {
  // 1) publish the new version (release edge for readers)
  addU32(p.u32, p.seqIndex, 1);
  // 2) leave the critical section (odd → even)
  addU32(p.u32, p.lockIndex, 1);
}

/**
 * Exception-safe publish wrapper.
 *
 * @typeParam T Value type produced by the critical section.
 * @param p Seqlock pair to guard the critical section.
 * @param fn Critical section that mutates shared state under the lock.
 *
 * @returns The value returned by `fn`.
 *
 * @throws Rethrows any error thrown by `fn`.
 *
 * @remarks
 * This helper ensures that the writer never remains stuck in an odd (locked)
 * state. If `fn` throws, the lock is released and `SEQ` is **not**
 * incremented.
 *
 * Typical usage:
 *
 * ```ts
 * publish(pair, () => {
 *   shared[0] = nextValue;
 * });
 * ```
 */
export function publish<T>(p: SeqPair, fn: () => T): T {
  beginWrite(p);
  let result: T;
  try {
    result = fn();
  } catch (e) {
    // Best effort: make sure we leave the lock in a consistent state.
    // SEQ is not incremented because the write did not complete.
    addU32(p.u32, p.lockIndex, 1);
    throw e;
  }
  endWrite(p);
  return result;
}

/**
 * Best-effort coherent read with bounded spinning and retries.
 *
 * @typeParam T Value type produced by the reader function.
 * @param p Seqlock pair to sample from.
 * @param reader Function that samples the underlying shared state.
 * @param options Budgets controlling spin and retry behaviour.
 *
 * @returns A {@link TryReadResult} containing the sampled value and status.
 *
 * @throws {@link import('../errors').SeqlokError}
 * Throws with code `"primitives.seqlockTimeout"` if budgets are exhausted
 * (spins or retries) without obtaining a coherent snapshot.
 *
 * @remarks
 * This primitive is primarily used by primitives tests to exercise and
 * validate the seqlock behaviour. Production bindings currently use a
 * simpler single-pass read.
 *
 * Behaviour summary:
 *
 * - Spins on the LOCK word until it appears even, up to `spinBudget`.
 * - Reads `SEQ` (`seq0`), then calls `reader()`, then reads `SEQ` again (`seq1`).
 * - Accepts the snapshot if `seq0 === seq1` and LOCK is still even.
 * - Otherwise, retries up to `retryBudget` times.
 * - If budgets are exhausted:
 *   - A structured timeout error (`primitives.seqlockTimeout`) is thrown.
 */
export function tryRead<T>(
  p: SeqPair,
  reader: () => T,
  options?: TryReadOptions,
): TryReadResult<T> {
  const spinBudgetOption = options?.spinBudget ?? 1024;
  const retryBudgetOption = options?.retryBudget ?? 8;

  const budgetsAreValid =
    Number.isFinite(spinBudgetOption) &&
    Number.isFinite(retryBudgetOption) &&
    spinBudgetOption >= 0 &&
    retryBudgetOption >= 0 &&
    Number.isInteger(spinBudgetOption) &&
    Number.isInteger(retryBudgetOption);

  invariant(
    budgetsAreValid,
    'primitives.invalidSpinBudget',
    'Spin budget must be non-negative integer',
    {
      where: 'primitives.seqlock.tryRead',
      detail: `spinBudget=${String(spinBudgetOption)}, retryBudget=${String(retryBudgetOption)}`,
    },
  );

  const spinBudget = spinBudgetOption;
  const retryBudget = retryBudgetOption;

  let totalSpins = 0;
  let retriesUsed = 0;

  // Attempt 0 + up to `retryBudget` additional retries.
  while (retriesUsed <= retryBudget) {
    const spinResult = spinUntilEven(p.u32, p.lockIndex, spinBudget);

    if (!spinResult) {
      // Never observed an even LOCK within spin budget.
      const status: ReadStatus = {
        spins: totalSpins,
        retries: retriesUsed,
        kind: 'writerActive',
      };
      // Degraded snapshot: reader() is called exactly once in this branch.
      return { ok: false, value: reader(), status };
    }

    totalSpins += spinResult.spins;

    const seq0 = loadU32(p.u32, p.seqIndex);
    const value = reader();
    const seq1 = loadU32(p.u32, p.seqIndex);
    const lockNow = loadU32(p.u32, p.lockIndex);

    if (seq0 === seq1 && (lockNow & 1) === 0) {
      const status: ReadStatus = {
        spins: totalSpins,
        retries: retriesUsed,
        kind: 'ok',
      };
      return { ok: true, value, status };
    }

    retriesUsed += 1;
  }

  // Budgets exhausted (spins or retries). This is considered a timeout in
  // the sense of the primitives domain; we surface it as a structured error.
  const details = {
    where: 'primitives.seqlock.tryRead',
    detail: `spinBudget=${String(spinBudget)}, retryBudget=${String(retryBudget)}, spins=${String(totalSpins)}, retriesUsed=${String(retriesUsed)}`,
    spinBudget,
    actualSpins: totalSpins,
  } as const satisfies PrimitivesSeqlockTimeoutDetails;

  throw createError('primitives.seqlockTimeout', 'Seqlock acquisition timeout', details);
}
