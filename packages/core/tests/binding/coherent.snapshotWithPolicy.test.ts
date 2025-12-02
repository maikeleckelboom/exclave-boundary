import * as seqlock from "@seqlok/primitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotWithPolicy } from "../../src/binding/common/coherent";
import {
  type CoreIntrospectCounterName,
  installCoreIntrospectSink,
} from "../../src/binding/common/coherent-introspect";

import type { SeqPair } from "@seqlok/primitives";

interface SnapshotRetryError {
  code?: string;
  details?: {
    where?: string;
    section?: "params" | "meters";
    spins?: number;
    retries?: number;
  };
}

describe("Snapshot With Policy: Coherent Snapshot & Fallback Strategies", () => {
  // Minimal SeqPair stub for testing policy wrappers
  const pair: SeqPair = {
    u32: new Uint32Array(2),
    lockIndex: 0,
    seqIndex: 1,
  };

  let diagnosticsCounts: Record<CoreIntrospectCounterName, number>;

  beforeEach(() => {
    diagnosticsCounts = {
      degradedSnapshots: 0,
      spinBudgetExhausted: 0,
      retryBudgetExhausted: 0,
    };

    installCoreIntrospectSink({
      onCounterIncrement: (name) => {
        diagnosticsCounts[name] += 1;
      },
    });
  });

  afterEach(() => {
    installCoreIntrospectSink(undefined);
    vi.restoreAllMocks();
  });

  it("returns the reader value on success without triggering introspect", () => {
    const tryReadSpy = vi.spyOn(seqlock, "tryRead");

    tryReadSpy.mockImplementation((_pair, reader) => ({
      ok: true as const,
      value: reader(),
      status: {
        spins: 0,
        retries: 0,
        kind: "ok" as const,
      },
    }));

    const value = snapshotWithPolicy(
      pair,
      {
        where: "controller.meters.snapshot",
        section: "meters",
        spinBudget: 4,
        retryBudget: 2,
        degrade: "returnLatest",
      },
      () => 42,
      () => {
        throw new Error("Fallback reader should not be invoked on success");
      },
    );

    expect(value).toBe(42);
    expect(tryReadSpy).toHaveBeenCalledTimes(1);

    // No introspect should be emitted on success
    expect(diagnosticsCounts.degradedSnapshots).toBe(0);
    expect(diagnosticsCounts.spinBudgetExhausted).toBe(0);
    expect(diagnosticsCounts.retryBudgetExhausted).toBe(0);
  });

  it('degrades to the fallback reader and records introspect under "returnLatest"', () => {
    const tryReadSpy = vi.spyOn(seqlock, "tryRead");

    // Simulate a failed read where budgets were fully consumed
    tryReadSpy.mockImplementation((_pair, _reader) => ({
      ok: false as const,
      value: 0, // ignored on failure
      status: {
        spins: 5,
        retries: 3,
        kind: "budgetExhausted" as const,
      },
    }));

    const degradedValue = 1337;

    const result = snapshotWithPolicy(
      pair,
      {
        where: "controller.meters.snapshot",
        section: "meters",
        spinBudget: 4,
        retryBudget: 2,
        degrade: "returnLatest",
      },
      () => {
        throw new Error("Primary reader should not be used when tryRead fails");
      },
      () => degradedValue,
    );

    expect(result).toBe(degradedValue);

    // Verify diagnostic counters are incremented for visibility
    expect(diagnosticsCounts.degradedSnapshots).toBe(1);
    expect(diagnosticsCounts.spinBudgetExhausted).toBeGreaterThanOrEqual(0);
    expect(diagnosticsCounts.retryBudgetExhausted).toBeGreaterThanOrEqual(0);

    expect(tryReadSpy).toHaveBeenCalledTimes(1);
  });

  it("throws binding.snapshotRetryExhausted when retries are exhausted without degradation policy", () => {
    const tryReadSpy = vi.spyOn(seqlock, "tryRead");

    tryReadSpy.mockImplementation((_pair, _reader) => ({
      ok: false as const,
      value: 0,
      status: {
        spins: 1,
        retries: 0,
        kind: "budgetExhausted" as const,
      },
    }));

    let thrown: unknown;

    try {
      snapshotWithPolicy(
        pair,
        {
          where: "controller.meters.snapshot",
          section: "meters",
          spinBudget: 1,
          retryBudget: 0,
          // no degrade -> must throw
        },
        () => {
          throw new Error("Primary reader should not be called on failure");
        },
        () => {
          throw new Error(
            "Fallback should not be called without degrade policy",
          );
        },
      );
    } catch (error) {
      thrown = error;
    }

    // We only care that we did *not* degrade in this path
    expect(diagnosticsCounts.degradedSnapshots).toBe(0);

    if (!thrown || typeof thrown !== "object") {
      throw new Error(
        "Expected snapshotWithPolicy to throw a structured error object",
      );
    }

    const err = thrown as SnapshotRetryError;

    expect(err.code).toBe("binding.snapshotRetryExhausted");
    expect(err.details?.where).toBe("controller.meters.snapshot");
    expect(err.details?.section).toBe("meters");
    expect(err.details?.spins ?? 0).toBeGreaterThanOrEqual(0);
    expect(err.details?.retries ?? 0).toBeGreaterThanOrEqual(0);

    expect(tryReadSpy).toHaveBeenCalledTimes(1);
  });
});
