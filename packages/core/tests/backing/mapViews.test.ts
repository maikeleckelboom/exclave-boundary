import { describe, expect, it } from "vitest";

import { allocateShared } from "../../src/backing/allocate-shared";
import { mapViews } from "../../src/backing/map-views";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

/**
 * Type guard to identify Seqlok-shaped errors.
 * Validates the presence of `name`, `message`, and `code` properties.
 */
export function isSeqlokError(
  x: unknown,
): x is { name?: string; message?: string; code?: string } {
  if (typeof x !== "object" || x === null) {
    return false;
  }

  const obj = x as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
  };

  return (
    obj.name === "SeqlokError" &&
    typeof obj.message === "string" &&
    typeof obj.code === "string"
  );
}

describe("Map Views: Runtime Behavior & Validation", () => {
  it("maps contiguous backing memory to typed arrays matching the planned layout", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "demo-mapping",
      params: {
        table: param.f32.array(8),
        flags: param.bool.array(3),
      },
      meters: {
        peak: meter.f32(),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const views = mapViews(plan, backing);

    // Verify that views are instantiated as the correct TypedArray subclasses
    expect(views.params.PF32).toBeInstanceOf(Float32Array);
    expect(views.params.PB).toBeInstanceOf(Uint8Array);
    expect(views.meters.MF32).toBeInstanceOf(Float32Array);

    // Verify that view sizes (in elements/bytes) are consistent with the plan
    expect(views.params.PF32.length * Float32Array.BYTES_PER_ELEMENT).toBe(
      plan.planes.PF32,
    );
    expect(views.params.PB.length).toBe(plan.planes.PB);
  });

  it("throws backing.allocUndersized when the provided SharedArrayBuffer is smaller than the plan requires", () => {
    const spec = defineSpec(({ param }) => ({
      id: "undersized-validation",
      params: {
        table: param.f32.array(16),
      },
    }));

    const plan = planLayout(spec);

    // Create a buffer that is intentionally too small (short by 8 bytes)
    const sab = new SharedArrayBuffer(Math.max(0, plan.bytesTotal - 8));
    const backing = { kind: "shared" as const, sab };

    let thrown: unknown;
    try {
      mapViews(plan, backing);
    } catch (e) {
      thrown = e;
    }

    expect(isSeqlokError(thrown)).toBe(true);

    if (!isSeqlokError(thrown)) {
      throw new Error("Expected mapViews to throw a Seqlok-shaped error");
    }

    expect(thrown.code).toBe("backing.allocUndersized");
    expect(thrown.message).toMatch(/smaller than required|undersized/i);
  });
});
