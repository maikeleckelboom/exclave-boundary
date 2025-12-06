import { describe, it, expectTypeOf } from "vitest";

import type { ParamShape, ParamValueFor } from "../../src/binding/common/types";
import type { SpecInput } from "../../src/spec/types";

type I32RO = Readonly<Int32Array>;

describe("EnumArray: Public and Processor Shapes", () => {
  interface S extends SpecInput {
    readonly id: "x";
    readonly params: {
      readonly ea: {
        readonly kind: "enum.array";
        readonly length: 5;
        readonly values: readonly ["x", "y", "z"];
      };
    };
  }

  it('ParamValueFor<S,"ea"> is Readonly<Int32Array> (indices exposed to controller)', () => {
    expectTypeOf<ParamValueFor<S, "ea">>().toExtend<I32RO>();
    expectTypeOf<I32RO>().toExtend<ParamValueFor<S, "ea">>();
  });

  it('ParamShape<S>["ea"] is Int32Array (processor view)', () => {
    expectTypeOf<ParamShape<S>["ea"]>().toEqualTypeOf<Int32Array>();
  });
});
