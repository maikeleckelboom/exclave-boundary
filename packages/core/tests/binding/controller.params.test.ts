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
 * Defines a comprehensive test specification covering all supported parameter types.
 * Includes scalars (f32, bool, enum) and arrays to validate serialization paths.
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
 * Wires up a complete shared memory environment for testing.
 * Establishes the Controller <-> Processor link via a local handoff.
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

describe("Controller Parameters: Versioning & Atomicity", () => {
  it("increments version exactly once for a single scalar set()", () => {
    const { ctl } = setupController();
    const initialVersion = ctl.params.version();

    ctl.params.set("rate", 1.25);

    const updatedVersion = ctl.params.version();
    expect(updatedVersion).toBe(initialVersion + 1);

    const snap = ctl.params.snapshot({ keys: ["rate"] });
    expect(snap.rate).toBeCloseTo(1.25, 6);
  });

  it("increments version exactly once for a multi-parameter update()", () => {
    const { ctl } = setupController();
    const initialVersion = ctl.params.version();

    // Batch update acts as a single atomic commit
    ctl.params.update({
      rate: 1.5,
      enabled: true,
      mode: "b",
    });

    const updatedVersion = ctl.params.version();
    expect(updatedVersion).toBe(initialVersion + 1);

    const snap = ctl.params.snapshot({ keys: ["rate", "enabled", "mode"] });
    expect(snap.rate).toBeCloseTo(1.5, 6);
    expect(snap.enabled).toBe(true);
    expect(snap.mode).toBe("b");
  });

  it("increments version exactly once for an array stage() operation", () => {
    const { ctl } = setupController();
    const initialVersion = ctl.params.version();

    ctl.params.stage("coeffs", (view) => {
      view.fill(0);
      view[2] = 0.75;
      view[7] = 0.33;
    });

    const updatedVersion = ctl.params.version();
    expect(updatedVersion).toBe(initialVersion + 1);

    const snap = ctl.params.snapshot({ keys: ["coeffs"] });
    expect(snap.coeffs).toBeInstanceOf(Float32Array);
    expect((snap.coeffs as Float32Array)[2]).toBeCloseTo(0.75, 6);
    expect((snap.coeffs as Float32Array)[7]).toBeCloseTo(0.33, 6);
  });
});

describe("Controller Parameters: Range Policy Behavior", () => {
  it('throws on out-of-range values when policy is "reject" (default) and preserves version', () => {
    const { ctl } = setupController(); // defaults to reject
    const initialVersion = ctl.params.version();

    expect(() => {
      ctl.params.set("rate", 999); // Exceeds max=2.0
    }).toThrow();

    // Version must not change if the write was rejected
    const updatedVersion = ctl.params.version();
    expect(updatedVersion).toBe(initialVersion);
  });

  it('clamps out-of-range values when policy is "clamp" and commits the change', () => {
    const { ctl } = setupController({ params: { rangePolicy: "clamp" } });
    const initialVersion = ctl.params.version();

    ctl.params.set("rate", -10); // Below min=0.5, should clamp

    const updatedVersion = ctl.params.version();
    expect(updatedVersion).toBe(initialVersion + 1);

    const snap = ctl.params.snapshot({ keys: ["rate"] });
    expect(snap.rate).toBeCloseTo(0.5, 6);
  });
});

describe("Controller Parameters: Snapshot Identity & Validation", () => {
  it('reuses the provided "into" buffer (identity preserved)', () => {
    const { ctl } = setupController();

    // Pre-fill some data
    ctl.params.stage("coeffs", (view) => {
      view.fill(0);
      view[2] = 0.3;
      view[7] = 0.8;
    });

    const targetBuffer = new Float32Array(8);
    const into = { coeffs: targetBuffer };

    const snap = ctl.params.snapshot({ keys: ["coeffs"], into });

    // Verify the returned object is strictly the one we provided
    expect(snap.coeffs).toBe(targetBuffer);

    // Verify content was written correctly
    expect(snap.coeffs[2]).toBeCloseTo(0.3, 6);
    expect(snap.coeffs[7]).toBeCloseTo(0.8, 6);
  });

  it("throws when snapshotting a non-existent parameter key", () => {
    const { ctl } = setupController();
    expect(() => {
      // @ts-expect-error Intentional invalid key access for runtime test
      ctl.params.snapshot({ keys: ["doesNotExist"] });
    }).toThrow();
  });
});
