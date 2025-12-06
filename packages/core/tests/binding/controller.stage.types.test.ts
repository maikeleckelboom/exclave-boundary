import { describe, it, expectTypeOf } from "vitest";

import type {
  ArrayParamView,
  ControllerParams,
} from "../../src/binding/common/types";
import type { SpecInput } from "../../src/spec/types";

interface S extends SpecInput {
  readonly id: "lane";
  readonly params: {
    readonly coeffs: {
      readonly kind: "f32.array";
      readonly length: 8;
    };
    readonly states: {
      readonly kind: "bool.array";
      readonly length: 4;
    };
  };
}

type ParamKeysS = Extract<keyof S["params"], string>;

describe("ControllerParams.stage (array params)", () => {
  type Stage = ControllerParams<S>["stage"];

  type Accepts<F, K extends ParamKeysS, V> = F extends (
    key: K,
    cb: (view: V) => void,
  ) => void
    ? true
    : false;

  it("is callable per key with the precise mutable array view type", () => {
    type C1 = Accepts<Stage, "coeffs", ArrayParamView<S, "coeffs">>;
    expectTypeOf<C1>().toEqualTypeOf<true>();

    type C2 = Accepts<Stage, "states", ArrayParamView<S, "states">>;
    expectTypeOf<C2>().toEqualTypeOf<true>();
  });

  it("array view types are exactly the processor-side mutables", () => {
    type V1 = ArrayParamView<S, "coeffs">;
    expectTypeOf<V1>().toEqualTypeOf<Float32Array>();

    type V2 = ArrayParamView<S, "states">;
    expectTypeOf<V2>().toEqualTypeOf<Uint8Array>();
  });
});
