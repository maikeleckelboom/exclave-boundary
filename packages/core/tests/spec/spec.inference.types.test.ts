import { describe, it, expectTypeOf } from "vitest";

import { defineSpec } from "../../src/spec/define";

import type { SpecInput } from "../../src/spec/types";

describe("DefineSpec: Strengthened Inference Contracts", () => {
  it("preserves literals for scalar ranges, enum values, and array lengths", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "audioProcessor" as const,
      params: {
        gain: param.f32({ min: 0, max: 2 }),
        cutoff: param.f32({ min: 20, max: 20_000 }),
        filterType: param.enum(["lowpass", "highpass", "bandpass"]),
        bands: param.f32.array(8),
      },
      meters: {
        samples: meter.f32.array(128),
      },
    }));

    const { id, params, meters } = spec;

    expectTypeOf(id).toEqualTypeOf<"audioProcessor">();

    expectTypeOf(params.gain).toEqualTypeOf<{
      readonly kind: "f32";
      readonly min: 0;
      readonly max: 2;
    }>();

    expectTypeOf(params.cutoff).toEqualTypeOf<{
      readonly kind: "f32";
      readonly min: 20;
      readonly max: 20_000;
    }>();

    expectTypeOf(params.filterType).toEqualTypeOf<{
      readonly kind: "enum";
      readonly values: readonly ["lowpass", "highpass", "bandpass"];
    }>();

    expectTypeOf(params.bands).toEqualTypeOf<{
      readonly kind: "f32.array";
      readonly length: 8;
    }>();

    expectTypeOf(meters.samples).toEqualTypeOf<{
      readonly kind: "f32.array";
      readonly length: 128;
    }>();
  });

  it("preserves enum array literals and object-length forms", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "arrays" as const,
      params: {
        vec3: param.f32.array(3),
        matrix4x4: param.f32.array({ length: 16 }),
        boolFlags: param.bool.array({ length: 5 }),
        enumArray: param.enum.array({ values: ["a", "b", "c"], length: 10 }),
      },
      meters: {
        samples: meter.f32.array({ length: 128 }),
        counters: meter.u32.array(4),
      },
    }));

    const { params, meters } = spec;

    expectTypeOf(params.vec3).toEqualTypeOf<{
      readonly kind: "f32.array";
      readonly length: 3;
    }>();

    expectTypeOf(params.matrix4x4).toEqualTypeOf<{
      readonly kind: "f32.array";
      readonly length: 16;
    }>();

    expectTypeOf(params.boolFlags).toEqualTypeOf<{
      readonly kind: "bool.array";
      readonly length: 5;
    }>();

    expectTypeOf(params.enumArray).toEqualTypeOf<{
      readonly kind: "enum.array";
      readonly values: readonly ["a", "b", "c"];
      readonly length: 10;
    }>();

    expectTypeOf(meters.samples).toEqualTypeOf<{
      readonly kind: "f32.array";
      readonly length: 128;
    }>();

    expectTypeOf(meters.counters).toEqualTypeOf<{
      readonly kind: "u32.array";
      readonly length: 4;
    }>();
  });

  it("accepts plain-object specs when constrained by SpecInput", () => {
    const input = {
      id: "plain",
      params: {
        value: { kind: "f32", min: 0, max: 1 },
      },
    } satisfies SpecInput;

    const spec = defineSpec(input);

    expectTypeOf(spec).toEqualTypeOf<typeof input>();

    expectTypeOf(spec).toExtend<SpecInput>();
  });

  it("covers scalar overload variants for f32/i32", () => {
    const spec = defineSpec(({ param }) => ({
      id: "ranges" as const,
      params: {
        noRange: param.f32(),
        minOnly: param.f32({ min: 10 }),
        maxOnly: param.f32({ max: 100 }),
        both: param.f32({ min: 0, max: 50 }),
        intMinOnly: param.i32({ min: -5 }),
        intBoth: param.i32({ min: 0, max: 255 }),
      },
    }));

    const { params } = spec;

    expectTypeOf(params.noRange).toEqualTypeOf<{
      readonly kind: "f32";
    }>();

    expectTypeOf(params.minOnly).toEqualTypeOf<{
      readonly kind: "f32";
      readonly min: 10;
    }>();

    expectTypeOf(params.maxOnly).toEqualTypeOf<{
      readonly kind: "f32";
      readonly max: 100;
    }>();

    expectTypeOf(params.both).toEqualTypeOf<{
      readonly kind: "f32";
      readonly min: 0;
      readonly max: 50;
    }>();

    expectTypeOf(params.intMinOnly).toEqualTypeOf<{
      readonly kind: "i32";
      readonly min: -5;
    }>();

    expectTypeOf(params.intBoth).toEqualTypeOf<{
      readonly kind: "i32";
      readonly min: 0;
      readonly max: 255;
    }>();
  });
});
