import { describe, expect, it } from "vitest";

import { allocateSharedPartitioned } from "../../src/backing/allocate-shared-partitioned";
import { getBackingBuffer } from "../../src/backing/buffers";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error(
    `Error(core/tests/helpers/capture-error.ts): Expected function to throw.`,
  );
}

describe("getBackingBuffer: Partitioned Backing Restrictions", () => {
  it("throws an internal.assertionFailed error", () => {
    const spec = defineSpec(({ param, meter }) => ({
      params: {
        rate: param.f32(),
      },
      meters: {
        level: meter.f32(),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateSharedPartitioned(plan);
    const thrown = captureError(() => getBackingBuffer(backing));

    const err = thrown as {
      code?: string;
      details?: { where?: string; detail?: string };
    };

    expect(err.code).toBe("internal.assertionFailed");
    expect(err.details?.where).toBe("backing.getBackingBuffer");
    expect(err.details?.detail).toMatch(
      /partitioned backing has no single SharedArrayBuffer/i,
    );

    // internal.* are fatal invariants and not boundarySafe
    expect(err).toHaveProperty("meta");
    const meta = (
      err as { meta?: { boundarySafe?: boolean; recoverable?: boolean } }
    ).meta;
    expect(meta?.boundarySafe).toBe(false);
    expect(meta?.recoverable).toBe(false);
  });
});
