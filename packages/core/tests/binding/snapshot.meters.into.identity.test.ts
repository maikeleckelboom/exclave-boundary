import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  acceptHandoff,
} from "../../src";

/**
 * Sets up a standard test harness with mixed meter types (scalars and arrays)
 * to validate snapshot buffer management.
 */
function createHarness() {
  const spec = defineSpec(({ meter }) => ({
    id: "meters-identity-test",
    meters: {
      rms: meter.f32(),
      flags: meter.u32.array(64),
      spectrum: meter.f32.array(512),
    },
  }));

  const plan = planLayout(spec);
  const backing = allocateShared(plan);

  const handoff = buildHandoff(plan, backing);
  const accepted = acceptHandoff(handoff);

  const ctl = bindController(spec, plan, backing);
  const proc = bindProcessor(accepted);

  return { ctl, proc };
}

describe("Meters Snapshot: Buffer Identity & Allocation", () => {
  it('reuses provided "into" buffers strictly by identity', () => {
    const { ctl, proc } = createHarness();

    // Populate meters with verification data
    proc.meters.publish((w) => {
      w.set("rms", 0.42);
      w.stage("flags", (dst) => {
        dst.fill(0);
        dst[0] = 1;
      });
      w.stage("spectrum", (dst) => {
        for (let i = 0; i < dst.length; i++) {
          dst[i] = i;
        }
      });
    });

    // Allocate external buffers to test zero-copy/write-into behavior
    const f32 = new Float32Array(512);
    const u32 = new Uint32Array(64);

    const snap = ctl.meters.snapshot({
      keys: ["spectrum", "flags", "rms"],
      into: {
        spectrum: f32,
        flags: u32,
      },
    });

    // Verify referential identity: the library must write into the exact instances provided
    expect(snap.spectrum).toBe(f32);
    expect(snap.flags).toBe(u32);

    // Verify scalars are returned as primitives
    expect(snap.rms).toBeTypeOf("number");

    // Verify content integrity
    expect(f32[0]).toBe(0);
    expect(u32[0]).toBe(1);
  });

  it('allocates fresh arrays only for keys missing from the "into" map', () => {
    const { ctl } = createHarness();

    const f32 = new Float32Array(512);

    // Provide buffer for 'spectrum' but rely on internal allocation for 'flags'
    const result = ctl.meters.snapshot({
      keys: ["spectrum", "flags"],
      into: {
        spectrum: f32,
      },
    });

    // Provided buffer is reused
    expect(result.spectrum).toBe(f32);

    // Missing buffer is allocated internally
    expect(result.flags).toBeInstanceOf(Uint32Array);
    expect(result.flags).not.toBe(f32);
  });
});
