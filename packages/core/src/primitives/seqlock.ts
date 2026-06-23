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
 * This module is an internal implementation detail of `@seqlok-internal/prototype-core`.
 * Runtime bindings call into it indirectly via higher-level helpers.
 *
 * Functions {@link createSeqPair} and {@link tryRead} exist primarily for
 * primitives tests and are marked `@internal`. They are not part of the
 * supported bindings surface and may change without notice.
 */

import { addU32, loadU32, spinUntilEven } from "./atomics";
import { createError } from "../errors/error";
import { invariant } from "../errors/invariant";

import type { PrimitivesSeqlockTimeoutDetails } from "../errors/codes/primitives";

/**
 * Pair of indices into a `Uint32Array` forming a seqlock.
 *
 * @remarks
 * Layout:
 * - `u32[lockIndex]` – lock word (even = quiescent, odd = writer active).
 * - `u32[seqIndex]` – version word.
 */
export interface SeqPair {
  readonly u32: Uint32Array;
  readonly lockIndex: number;
  readonly seqIndex: number;
}

/**
 * Create a {@link SeqPair} view over a shared `Uint32Array`.
 *
 * @remarks
 * This helper is primarily used in primitives tests.
 *
 * @throws {@link import('../errors').SeqlokError}
 * - `internal.assertionFailed` – if indices are out of range or equal.
 *
 * @internal
 */
export function createSeqPair(
  u32: Uint32Array,
  lockIndex: number,
  seqIndex: number,
): SeqPair {
  const len = u32.length;

  invariant(
    lockIndex >= 0 && lockIndex < len && seqIndex >= 0 && seqIndex < len,
    "internal.assertionFailed",
    "SeqPair indices must be within bounds of the backing Uint32Array",
  );

  invariant(
    lockIndex !== seqIndex,
    "internal.assertionFailed",
    "SeqPair lockIndex and seqIndex must be distinct",
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
  readonly kind: "ok" | "writerActive" | "budgetExhausted";
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
 * Begin a write: transition LOCK from even → odd to enter the critical
 * section.
 */
export function beginWrite(pair: SeqPair): void {
  addU32(pair.u32, pair.lockIndex, 1);
}

/**
 * End a write: commit version (SEQ+1), then unlock (LOCK+1).
 */
export function endWrite(pair: SeqPair): void {
  // 1. Publish new version (release barrier)
  addU32(pair.u32, pair.seqIndex, 1);
  // 2. Leave critical section (odd → even)
  addU32(pair.u32, pair.lockIndex, 1);
}

/**
 * Exception-safe publish wrapper.
 *
 * @remarks
 * Guarantees that the writer lock is always released, even if the callback
 * throws. On failure it now also bumps the SEQ word to avoid "silent tearing"
 * where partially-written data would still be tagged with the previous
 * version number.
 *
 * Readers that see this SEQ bump will treat the write as contended and
 * retry (or exhaust their budgets) instead of trusting the old version.
 */
export function publish<T>(p: SeqPair, fn: () => T): T {
  beginWrite(p);
  let result: T;
  try {
    result = fn();
  } catch (e) {
    // Writer attempted to modify shared state and threw.
    // The underlying memory may now be "dirty but coherent": a partial
    // write happened under the lock. We still need to:
    // - bump SEQ so readers observe a version change, and
    // - release the lock so they do not hang.
    addU32(p.u32, p.seqIndex, 1);
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
 * @param pair
 * @param reader
 * @param options
 *
 * @remarks
 * Summary:
 *
 * - Spins on the LOCK word until it appears even, up to `spinBudget`.
 * - Reads `SEQ` (`seq0`), then calls `reader()`, then reads `SEQ` again (`seq1`).
 * - Accepts the snapshot if `seq0 === seq1` and LOCK is still even.
 * - Otherwise, retries up to `retryBudget` times.
 * - If budgets are exhausted:
 *   - A structured timeout error (`primitives.seqlockTimeout`) is thrown.
 */
export function tryRead<T>(
  pair: SeqPair,
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
    "primitives.invalidSpinBudget",
    "Spin budget must be non-negative integer",
    {
      where: "primitives.seqlock.tryRead",
      detail: `spinBudget=${String(
        spinBudgetOption,
      )}, retryBudget=${String(retryBudgetOption)}`,
    },
  );

  const spinBudget = spinBudgetOption;
  const retryBudget = retryBudgetOption;

  let totalSpins = 0;
  let retriesUsed = 0;

  // Attempt 0 + up to `retryBudget` additional retries.
  while (retriesUsed <= retryBudget) {
    const spinResult = spinUntilEven(pair.u32, pair.lockIndex, spinBudget);

    if (!spinResult) {
      // Never observed an even LOCK within spin budget.
      const status: ReadStatus = {
        spins: totalSpins,
        retries: retriesUsed,
        kind: "writerActive",
      };
      // Degraded snapshot: reader() is called exactly once in this branch.
      return { ok: false, value: reader(), status };
    }

    totalSpins += spinResult.spins;

    const seq0 = loadU32(pair.u32, pair.seqIndex);
    const value = reader();
    const seq1 = loadU32(pair.u32, pair.seqIndex);
    const lockNow = loadU32(pair.u32, pair.lockIndex);

    if (seq0 === seq1 && (lockNow & 1) === 0) {
      const status: ReadStatus = {
        spins: totalSpins,
        retries: retriesUsed,
        kind: "ok",
      };
      return { ok: true, value, status };
    }

    retriesUsed += 1;
  }

  // Budgets exhausted (spins or retries). This is considered a timeout in
  // the sense of the primitives domain; we surface it as a structured error.
  const details = {
    where: "primitives.seqlock.tryRead",
    detail: `spinBudget=${String(spinBudget)}, retryBudget=${String(
      retryBudget,
    )}, spins=${String(totalSpins)}, retriesUsed=${String(retriesUsed)}`,
    spinBudget,
    actualSpins: totalSpins,
  } as const satisfies PrimitivesSeqlockTimeoutDetails;

  throw createError(
    "primitives.seqlockTimeout",
    "Seqlock acquisition timeout",
    details,
  );
}
