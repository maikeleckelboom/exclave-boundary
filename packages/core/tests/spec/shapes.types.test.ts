import { describe, it, expectTypeOf } from "vitest";

import { type MeterValueFor, type ParamValueFor } from "../../src";

import type { SpecInput } from "../../src/spec/types";

type F32RO = Readonly<Float32Array>;
type I32RO = Readonly<Int32Array>;
type U8RO = Readonly<Uint8Array>;

describe("Param Shapes via ParamValueFor", () => {
  it("bool → boolean", () => {
    interface S extends SpecInput {
      id: "x";
      params: { enabled: { kind: "bool" } };
    }
    expectTypeOf<ParamValueFor<S, "enabled">>().toEqualTypeOf<boolean>();
  });

  it("enum → public string union", () => {
    interface S extends SpecInput {
      id: "x";
      params: { mode: { kind: "enum"; values: readonly ["a", "b", "c"] } };
    }
    expectTypeOf<ParamValueFor<S, "mode">>().toExtend<"a" | "b" | "c">();
    expectTypeOf<"a" | "b" | "c">().toExtend<ParamValueFor<S, "mode">>();
  });

  it("arrays → correct typed arrays", () => {
    interface S extends SpecInput {
      id: "x";
      params: {
        coeffsF: { kind: "f32.array"; length: 8 };
        coeffsI: { kind: "i32.array"; length: 4 };
        flags: { kind: "bool.array"; length: 16 };
      };
    }
    expectTypeOf<ParamValueFor<S, "coeffsF">>().toExtend<F32RO>();
    expectTypeOf<ParamValueFor<S, "coeffsI">>().toExtend<I32RO>();
    expectTypeOf<ParamValueFor<S, "flags">>().toExtend<U8RO>();
  });
});

describe("Meter Shapes via MeterValueFor", () => {
  it("scalar + array", () => {
    interface S extends SpecInput {
      id: "x";
      meters: {
        peak: { kind: "f32" };
        spectrum: { kind: "f32.array"; length: 512 };
      };
    }
    expectTypeOf<MeterValueFor<S, "peak">>().toEqualTypeOf<number>();
    expectTypeOf<MeterValueFor<S, "spectrum">>().toExtend<F32RO>();
  });
});
