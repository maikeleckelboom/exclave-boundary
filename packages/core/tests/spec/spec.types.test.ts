import { describe, expectTypeOf, it } from "vitest";

import type {
  MeterValueFor,
  ParamValueFor,
} from "../../src/binding/common/types";
import type {
  ArrayMeterKeys,
  ArrayParamKeys,
  MeterKeys,
  ParamKeys,
  ScalarMeterKeys,
  ScalarParamKeys,
  SpecInput,
} from "../../src/spec/types";

describe("Spec Keys Splitting (Compile-Time Contracts)", () => {
  it("Param/Meter keys", () => {
    interface Spec extends SpecInput {
      id: "x";
      params: {
        rate: {
          kind: "f32";
          min: 0;
          max: 4;
        };
      };
      meters: {
        rms: {
          kind: "f32";
        };
      };
    }

    type PK = ParamKeys<Spec>;
    type MK = MeterKeys<Spec>;

    expectTypeOf<PK>().toEqualTypeOf<"rate">();
    expectTypeOf<MK>().toEqualTypeOf<"rms">();
  });

  it("array/scalar key partitions", () => {
    interface Spec extends SpecInput {
      id: "x";
      params: {
        a: { kind: "f32"; min: 0; max: 10 };
        b: { kind: "f32.array"; length: 8 };
        c: { kind: "bool" };
      };
      meters: {
        m1: { kind: "f32" };
        m2: { kind: "f32.array"; length: 16 };
        m3: { kind: "f64" };
      };
    }

    expectTypeOf<ArrayParamKeys<Spec>>().toEqualTypeOf<"b">();
    expectTypeOf<ArrayMeterKeys<Spec>>().toEqualTypeOf<"m2">();

    expectTypeOf<ScalarParamKeys<Spec>>().toEqualTypeOf<"a" | "c">();
    expectTypeOf<ScalarMeterKeys<Spec>>().toEqualTypeOf<"m1" | "m3">();
  });
});

describe("ParamValueFor / MeterValueFor shapes (spot checks)", () => {
  it("value shapes are correct", () => {
    interface Spec extends SpecInput {
      id: "x";
      params: {
        gain: { kind: "f32"; min: 0; max: 4 };
        flags: { kind: "bool.array"; length: 4 };
        mode: { kind: "enum"; values: ["normal", "granular"] };
      };
      meters: {
        rms: { kind: "f32" };
        spectrum: { kind: "f32.array"; length: 1024 };
      };
    }

    expectTypeOf<ParamValueFor<Spec, "gain">>().toEqualTypeOf<number>();

    expectTypeOf<ParamValueFor<Spec, "mode">>().toExtend<
      "normal" | "granular"
    >();
    expectTypeOf<"normal" | "granular">().toExtend<
      ParamValueFor<Spec, "mode">
    >();

    expectTypeOf<ParamValueFor<Spec, "flags">>().toExtend<
      Readonly<Uint8Array>
    >();
    expectTypeOf<MeterValueFor<Spec, "spectrum">>().toExtend<
      Readonly<Float32Array>
    >();
  });
});
