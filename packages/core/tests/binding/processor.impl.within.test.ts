// File: packages/core/tests/binding/processor.impl.within.test.ts

import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  receiveHandoff,
} from "../../src";
import { mapViews } from "../../src/backing/map-views";

describe("Processor Params: Coherent Read Transaction", () => {
  it("propagates binding.coherentRetryExhausted when lock contention exceeds budget", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "processor-within-coherence",
      params: {
        gain: param.f32({ min: 0, max: 2 }),
      },
      meters: {
        peak: meter.f32(),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const handoff = buildHandoff(plan, backing);
    const received = receiveHandoff(handoff);

    // Bind processor with minimal budgets to ensure immediate failure under simulated contention
    const processor = bindProcessor(received, {
      params: {
        spinBudget: 1,
        retryBudget: 0,
      },
    });

    // Locate the Parameter Update (PU) lock index in the shared backing
    const mapped = mapViews(plan, backing);
    const lockIndex = plan.locks.PU.lock;

    // Simulate a writer holding the lock indefinitely (forcing odd/locked state)
    Atomics.store(mapped.locks.PU, lockIndex, 1);

    let thrown: unknown;

    try {
      processor.params.within(() => {
        // If this executes, the coherence check failed to block the read
        throw new Error(
          "processor.params.within callback should not be invoked when coherent retries are exhausted",
        );
      });
    } catch (err) {
      thrown = err;
    }

    if (!thrown || typeof thrown !== "object") {
      throw new Error(
        "Expected processor.params.within to throw a structured error object",
      );
    }

    const err = thrown as {
      code?: string;
      details?: {
        where?: string;
        [key: string]: unknown;
      };
    };

    expect(err.code).toBe("binding.coherentRetryExhausted");
    expect(err.details?.where).toBe("processor.params.within");
  });
});
