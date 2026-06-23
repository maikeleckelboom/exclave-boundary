import { describe, expect, it } from "vitest";

import { allocateShared } from "../../src/backing/allocate-shared";
import { allocateSharedPartitioned } from "../../src/backing/allocate-shared-partitioned";
import { isSeqlokError } from "../../src/errors/error";
import {
  buildHandoff,
  acceptHandoff,
  verifyHandoff,
} from "../../src/handoff/handoff";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

import type {
  SharedPartitionedBacking,
  WasmSharedBacking,
} from "../../src/backing/types";

describe("Handoff Mechanisms (Contiguous SAB)", () => {
  const spec = defineSpec(({ param, meter }) => ({
    id: "handoff",
    params: {
      rate: param.f32({ min: 0.25, max: 4 }),
      mode: param.enum({ values: ["a", "b", "c"] }),
    },
    meters: {
      peak: meter.f32(),
      frames: meter.u32(),
    },
  }));

  it("successfully completes the build -> receive -> verify lifecycle", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    const env = buildHandoff(plan, backing);
    const accepted = acceptHandoff(env);

    // Verify metadata integrity through the plan source of truth
    expect(accepted.plan.id).toBe("handoff");
    expect(accepted.plan.hash).toBe(plan.hash);
    expect(accepted.plan.bytesTotal).toBe(plan.bytesTotal);

    // Verify compatibility between the local plan and the accepted plan
    expect(() => {
      verifyHandoff(plan, accepted.plan);
    }).not.toThrow();
  });

  it("throws specifically on spec hash mismatch during verification", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const env = buildHandoff(plan, backing);
    const accepted = acceptHandoff(env);

    // Define a different local spec (hash mismatch)
    const spec2 = defineSpec(({ param, meter }) => ({
      params: { rate: param.f32({ min: 0.5, max: 2 }) },
      meters: { peak: meter.f32() },
    }));
    const plan2 = planLayout(spec2);

    try {
      // Compare the incompatible local plan against the accepted plan
      verifyHandoff(plan2, accepted.plan);
      expect.unreachable("verifyHandoff should throw on hash mismatch");
    } catch (error: unknown) {
      if (!isSeqlokError(error)) {
        throw error;
      }
      expect(error.code).toBe("handoff.specHashMismatch");
    }
  });

  it("rejects non-SharedArrayBuffer instances via shape guards", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const env = buildHandoff(plan, backing);

    // Poison the sab field with a standard ArrayBuffer to test type enforcement
    const badEnv = { ...env, sab: new ArrayBuffer(8) };

    expect(() => acceptHandoff(badEnv)).toThrow();
  });

  it("provides comprehensive metadata via the accepted plan object", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const env = buildHandoff(plan, backing);
    const accepted = acceptHandoff(env);

    // Verify all plane offsets and layout details are preserved
    expect(accepted.plan.id).toBe("handoff");
    expect(accepted.plan.hash).toBe(plan.hash);
    expect(accepted.plan.bytesTotal).toBe(plan.bytesTotal);
    expect(accepted.plan.planes.PF32).toBe(plan.planes.PF32);
    expect(accepted.plan.planes.PI32).toBe(plan.planes.PI32);
    expect(accepted.plan.planes.PB).toBe(plan.planes.PB);
    expect(accepted.plan.planes.PU).toBe(plan.planes.PU);
    expect(accepted.plan.planes.MF32).toBe(plan.planes.MF32);
    expect(accepted.plan.planes.MF64).toBe(plan.planes.MF64);
    expect(accepted.plan.planes.MU32).toBe(plan.planes.MU32);
    expect(accepted.plan.planes.MU).toBe(plan.planes.MU);

    // Ensure no legacy or duplicated fields exist on the envelope or result
    expect("hash" in env).toBe(false);
    expect("bytesTotal" in env).toBe(false);
    expect("planes" in env).toBe(false);
    expect("meta" in accepted).toBe(false);
  });
});

describe("Handoff Mechanisms (Partitioned SAB)", () => {
  const spec = defineSpec(({ param, meter }) => ({
    id: "handoff-partitioned",
    params: {
      rate: param.f32({ min: 0.5, max: 2 }),
      mode: param.enum({ values: ["a", "b"] }),
    },
    meters: {
      peak: meter.f32(),
      frames: meter.u32(),
    },
  }));

  it("supports the build -> receive lifecycle for partitioned backing", () => {
    const plan = planLayout(spec);
    const backing = allocateSharedPartitioned(plan);

    const env = buildHandoff(plan, backing);
    const accepted = acceptHandoff(env);

    if (accepted.packing !== "shared-partitioned") {
      throw new Error(
        'Expected packing "shared-partitioned" for partitioned backing',
      );
    }

    expect(accepted.plan.id).toBe("handoff-partitioned");
    expect(accepted.plan.hash).toBe(plan.hash);
    expect(accepted.plan.bytesTotal).toBe(plan.bytesTotal);

    const receivedPlaneKeys = Object.keys(accepted.planes).sort();
    const plannedPlaneKeys = Object.keys(accepted.plan.planes).sort();

    expect(receivedPlaneKeys).toEqual(plannedPlaneKeys);
  });

  it("throws when a plane backing is undersized", () => {
    const plan = planLayout(spec);
    const backing = allocateSharedPartitioned(plan);

    const pf32Bytes = plan.planes.PF32;
    const undersizedBytes = pf32Bytes > 0 ? pf32Bytes - 4 : 0;

    const badBacking: SharedPartitionedBacking = {
      kind: "shared-partitioned",
      planes: {
        ...backing.planes,
        PF32: new SharedArrayBuffer(undersizedBytes),
      },
    };

    try {
      buildHandoff(plan, badBacking);
      expect.unreachable(
        "buildHandoff should throw on undersized plane backing",
      );
    } catch (error: unknown) {
      if (!isSeqlokError(error)) {
        throw error;
      }
      expect(error.code).toBe("handoff.invalidArtifact");
    }
  });
});

describe("Handoff Mechanisms (Wasm shared)", () => {
  const spec = defineSpec(({ param, meter }) => ({
    id: "handoff-wasm",
    params: {
      rate: param.f32({ min: 0.25, max: 4 }),
    },
    meters: {
      peak: meter.f32(),
    },
  }));

  it("rejects wasm-shared backings at build time", () => {
    const plan = planLayout(spec);

    const wasmBacking: WasmSharedBacking = {
      kind: "wasm-shared",
      memory: new WebAssembly.Memory({ initial: 1 }),
    };

    try {
      buildHandoff(plan, wasmBacking);
      expect.unreachable("buildHandoff should throw for wasm-shared backing");
    } catch (error: unknown) {
      if (!isSeqlokError(error)) {
        throw error;
      }
      expect(error.code).toBe("handoff.invalidArtifact");
    }
  });
});
