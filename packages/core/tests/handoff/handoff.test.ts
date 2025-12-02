import { describe, expect, it } from "vitest";

import { buildHandoff } from "../../src/handoff/handoff";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

import type { WasmSharedBacking } from "../../src/backing/types";

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

    let thrown: unknown;

    try {
      buildHandoff(plan, wasmBacking);
      expect.unreachable("buildHandoff should throw for wasm-shared backing");
    } catch (error) {
      thrown = error;
    }

    if (!thrown || typeof thrown !== "object") {
      throw new Error(
        "Expected buildHandoff to throw a structured error object",
      );
    }

    const err = thrown as { code?: string };

    expect(err.code).toBe("handoff.invalidArtifact");
  });
});
