import { describe, expect, it } from "vitest";

import { allocateSharedPartitioned } from "../../src/backing/allocate-shared-partitioned";
import { buildHandoff, acceptHandoff } from "../../src/handoff/handoff";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

describe("handoff v1 – shared-partitioned runtime roundtrip", () => {
  it("builds and accepts a partitioned handoff with matching plan + planes", () => {
    const spec = defineSpec(({ param, meter }) => ({
      params: {
        rate: param.f32({ min: 0.5, max: 2 }),
        mode: param.enum(["a", "b"]),
      },
      meters: {
        peak: meter.f32(),
        rms: meter.f32(),
      },
    }));

    const plan = planLayout(spec);

    // allocateSharedPartitioned must size each plane according to plan.planes
    const backing = allocateSharedPartitioned(plan);

    const handoff = buildHandoff(plan, backing);
    const accepted = acceptHandoff(handoff);

    // Shape + packing
    expect(accepted.packing).toBe("shared-partitioned");

    // Narrow to the partitioned variant for the rest of the test
    if (accepted.packing !== "shared-partitioned") {
      throw new Error("Test invariant: expected shared-partitioned packing");
    }

    // Same plan metadata (hash/bytesTotal)
    expect(accepted.plan.hash).toBe(plan.hash);
    expect(accepted.plan.bytesTotal).toBe(plan.bytesTotal);

    // Plane lengths as observed from the accepted planes
    const remotePlaneLengths: Record<string, number> = {};
    const { planes } = accepted;

    for (const plane of Object.keys(planes)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const sab = planes[plane]!;
      const byteLength = sab.byteLength >>> 0;
      remotePlaneLengths[plane] = byteLength;
    }

    // `plan.planes` is the single source of truth for byte lengths.
    for (const [plane, expectedBytes] of Object.entries(plan.planes)) {
      const remoteBytes = remotePlaneLengths[plane];

      expect(typeof remoteBytes).toBe("number");
      expect(remoteBytes).toBe((expectedBytes as number) >>> 0);
    }
  });
});
