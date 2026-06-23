import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  type ControllerOptions,
  defineSpec,
  planLayout,
  acceptHandoff,
} from "../../src";

/**
 * Creates a comprehensive specification with mixed scalar and array types
 * for both parameters and meters to validate controller binding logic.
 */
function makeSpec() {
  return defineSpec(({ param, meter }) => ({
    id: "controller-binding-tests",
    params: {
      rate: param.f32({ min: 0.5, max: 2.0 }),
      mode: param.enum(["a", "b", "c"]),
      enabled: param.bool(),
      coeffs: param.f32.array({ length: 8 }),
    },
    meters: {
      rms: meter.f32(),
      spectrum: meter.f32.array(16),
      flags: meter.u32.array(8),
    },
  }));
}

/**
 * Wires up a shared memory environment, establishing the connection between
 * a Controller and a Processor for testing.
 */
function setupController(
  options: ControllerOptions = { params: { rangePolicy: "reject" } },
) {
  const spec = makeSpec();
  const plan = planLayout(spec);
  const backing = allocateShared(plan);

  const handoff = buildHandoff(plan, backing);
  const accepted = acceptHandoff(handoff);

  const ctl = bindController(spec, plan, backing, options);
  const proc = bindProcessor(accepted);

  return { spec, plan, backing, handoff, accepted, ctl, proc };
}

describe("Controller Meters: Versioning & Synchronization", () => {
  it("increments the version counter exactly once per processor publish", () => {
    const { ctl, proc } = setupController();
    const startVersion = ctl.meters.version();

    proc.meters.publish((w) => {
      w.rms(0.42);
    });

    const nextVersion = ctl.meters.version();
    expect(nextVersion).toBe(startVersion + 1);

    const snap = ctl.meters.snapshot({ keys: ["rms"] });
    expect(snap.rms).toBeCloseTo(0.42, 6);
  });

  it("treats multiple writes within a single publish block as atomic (one version bump)", () => {
    const { ctl, proc } = setupController();
    const startVersion = ctl.meters.version();

    proc.meters.publish((w) => {
      w.rms(0.1);
      w.stage("spectrum", (vec) => {
        for (let i = 0; i < vec.length; i++) {
          vec[i] = i / vec.length;
        }
      });
    });

    const nextVersion = ctl.meters.version();
    expect(nextVersion).toBe(startVersion + 1);

    const snap = ctl.meters.snapshot({ keys: ["rms", "spectrum"] });
    expect(snap.rms).toBeCloseTo(0.1, 6);
    expect(snap.spectrum).toBeInstanceOf(Float32Array);
    expect(snap.spectrum[0]).toBeCloseTo(0, 6);
    expect(snap.spectrum[15]).toBeCloseTo(15 / 16, 6);
  });
});

describe("Controller Meters: Snapshot Identity & Validation", () => {
  it("writes meter snapshots directly into the provided buffer", () => {
    const { ctl, proc } = setupController();

    // Populate initial data
    proc.meters.publish((w) => {
      w.stage("spectrum", (vec) => {
        vec.fill(0);
        vec[2] = 1.25;
        vec[10] = 0.5;
      });
    });

    const targetBuffer = new Float32Array(16);
    const into = { spectrum: targetBuffer };

    const snap = ctl.meters.snapshot({ keys: ["spectrum"], into });

    // Verify reference identity to ensure no new allocation occurred
    expect(snap.spectrum).toBe(targetBuffer);

    // Verify data integrity
    expect(snap.spectrum[2]).toBeCloseTo(1.25, 6);
    expect(snap.spectrum[10]).toBeCloseTo(0.5, 6);
  });

  it("throws when snapshotting a non-existent meter key", () => {
    const { ctl } = setupController();
    expect(() => {
      // @ts-expect-error Intentional invalid key to test runtime guard
      ctl.meters.snapshot({ keys: ["nope"] });
    }).toThrow();
  });
});
