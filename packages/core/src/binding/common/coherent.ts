/**
 * @fileoverview
 * Coherent read helpers for seqlock-protected parameter snapshots.
 *
 * @remarks
 * - Provides `makeWithin` to implement `params.within(...)` on the processor.
 * - Encodes retry/spin budgets and degrade policies for read-side callers.
 * - Used by bindings to obtain coherent views without exposing raw seqlocks.
 *
 * @internal
 */

import { tryRead, type SeqPair } from "@seqlok/primitives";

import { recordIntrospectCounter } from "./coherent-introspect";
import { createBindingError } from "../../errors/binding";

import type { MeterDegradePolicy } from "./types";

/**
 * Configuration for a seqlock-protected read.
 */
export interface CoherentReadOptions {
  readonly where: string;
  readonly spinBudget: number;
  readonly retryBudget: number;
}

/**
 * Extended options for snapshots (adds degradation policy).
 */
export interface SnapshotPolicyOptions extends CoherentReadOptions {
  readonly section: "params" | "meters";
  readonly degrade?: MeterDegradePolicy;
}

export interface SnapshotStatus {
  readonly spins: number;
  readonly retries: number;
}

/**
 * Internal: run a snapshot reader under seqlock with optional degrade policy.
 *
 * - Uses primitives `tryRead`.
 * - Emits introspect counters on spin / retry exhaustion.
 * - On failure:
 *   - if `degrade` is `'returnLatest'`, falls back to `degradedReader`.
 *   - otherwise throws `binding.snapshotRetryExhausted`.
 */
export function snapshotWithPolicy<T>(
  pair: SeqPair,
  options: SnapshotPolicyOptions,
  reader: () => T,
  degradedReader: () => T,
): T {
  const { spinBudget, retryBudget, where, section, degrade } = options;

  const result = tryRead(pair, reader, { spinBudget, retryBudget });

  if (result.ok) {
    return result.value;
  }

  const status: SnapshotStatus = result.status;

  if (status.spins >= spinBudget) {
    recordIntrospectCounter("spinBudgetExhausted", {
      where,
      section,
    });
  }
  if (status.retries >= retryBudget) {
    recordIntrospectCounter("retryBudgetExhausted", {
      where,
      section,
    });
  }

  if (degrade === "returnLatest") {
    recordIntrospectCounter("degradedSnapshots", {
      where,
      section,
    });
    return degradedReader();
  }

  throw createBindingError("snapshotRetryExhausted", {
    where,
    section,
    spins: status.spins,
    retries: status.retries,
  });
}

/**
 * @internal Processor-side coherent read helper.
 *
 * - Wraps a raw reader in the PU seqlock protocol.
 * - No degrade path: coherence is mandatory on the processor.
 * - Throws `binding.coherentRetryExhausted` on failure.
 */
export function makeWithin<T>(
  pair: SeqPair,
  options: CoherentReadOptions,
  reader: () => T,
): (cb: (view: T) => void) => void {
  const { spinBudget, retryBudget, where } = options;

  return (cb: (view: T) => void): void => {
    const result = tryRead(pair, reader, { spinBudget, retryBudget });

    if (!result.ok) {
      const { spins, retries } = result.status;

      if (spins >= spinBudget) {
        recordIntrospectCounter("spinBudgetExhausted", {
          where,
        });
      }
      if (retries >= retryBudget) {
        recordIntrospectCounter("retryBudgetExhausted", {
          where,
        });
      }

      throw createBindingError("coherentRetryExhausted", {
        where,
        spins,
        retries,
      });
    }

    cb(result.value);
  };
}
