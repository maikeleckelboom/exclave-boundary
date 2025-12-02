// File: tests/binding/controller.hydrate.test.ts

import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  defineSpec,
  planLayout,
} from "../../src";

describe("Controller: Hydrate Validation", () => {
  const spec = defineSpec((b) => ({
    id: "hydrate-hardening",
    params: {
      arr: b.param.f32.array(4),
      val: b.param.f32(),
    },
  }));
  const plan = planLayout(spec);

  it("validates hydrate inputs rigorously against spec mismatch", () => {
    const backing = allocateShared(plan);
    const ctrl = bindController(spec, plan, backing);

    // 1. Unknown key check
    expect(() => {
      // @ts-expect-error: Testing runtime validation for unknown keys
      ctrl.params.hydrate({ unknownKey: 123 });
    }).toThrow();

    // 2. Invalid array length check (Runtime vs Spec)
    expect(() => {
      ctrl.params.hydrate({ arr: new Float32Array(2) }); // Expected 4
    }).toThrow();

    // 3. Invalid type check (Scalar passed where Array expected)
    expect(() => {
      // @ts-expect-error: Testing runtime validation for type mismatch
      ctrl.params.hydrate({ arr: 123 });
    }).toThrow();

    // 4. Invalid type check (Array passed where Scalar expected)
    expect(() => {
      // @ts-expect-error: Testing runtime validation for type mismatch
      ctrl.params.hydrate({ val: new Float32Array(1) });
    }).toThrow();
  });
});
