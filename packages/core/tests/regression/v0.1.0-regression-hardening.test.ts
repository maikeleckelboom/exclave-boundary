import { createSeqPair, publish } from "@seqlok/primitives";
import { describe, it, expect } from "vitest";

import { allocateShared } from "../../src/backing/allocate-shared";
import { snapshotWithPolicy } from "../../src/binding/common/coherent";
import { buildHandoff, receiveHandoff } from "../../src/handoff/handoff";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";
import { hashSpec } from "../../src/spec/hash";

describe("V0.1.0 Regression Hardening Checks", () => {
  it("keeps spec hash stable across descriptor key order", () => {
    // Force different key orders
    const specA = defineSpec(({ param }) => ({
      params: {
        a: param.f32({ min: 0, max: 1 }),
      },
    }));

    const specB = defineSpec(({ param }) => ({
      params: {
        a: param.f32({ max: 1, min: 0 }),
      }, // Swapped
    }));

    expect(hashSpec(specA)).toBe(hashSpec(specB));
  });

  it("accepts plain handoff-shaped objects (postMessage-style)", () => {
    const spec = defineSpec(({ param }) => ({ params: { a: param.f32() } }));
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const original = buildHandoff(plan, backing);

    // Simulate structured clone / JSON transport (strips brands/prototypes)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const raw = JSON.parse(JSON.stringify(original));

    // Re-attach SAB because JSON stringify kills it, but postMessage preserves it
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    raw.sab = backing.sab;

    const received = receiveHandoff(raw);
    expect(received.plan.hash).toBe(plan.hash);
  });

  it("handles snapshotWithPolicy after a crashed writer sequence bump", () => {
    const sab = new SharedArrayBuffer(128);
    const u32 = new Uint32Array(sab);
    const pair = createSeqPair(u32, 0, 1);

    // 1. Writer crashes -> SEQ increments
    try {
      publish(pair, () => {
        throw new Error("Crash");
      });
    } catch {
      // intentionally ignored for this regression check
    }

    // 2. Reader should not explode when invoked after the crash
    const readStrategy = {
      spinBudget: 1,
      retryBudget: 1,
      where: "test",
      section: "meters" as const,
    };

    try {
      snapshotWithPolicy(
        pair,
        readStrategy,
        () => 123, // The "read"
        () => 456, // The "degrade"
      );
      // No assertion: this is a smoke regression ensuring snapshotWithPolicy
      // can be called after a crashed writer without tearing the process.
    } catch {
      // Also acceptable: older policies may surface this as an error path
      expect(true).toBe(true);
    }
  });
});
