import { describe, expect, it, expectTypeOf } from "vitest";

import { defineSpec } from "../../src/spec/define";

describe("DSL: type inference & validation", () => {
  it("preserves literal enum values with", () => {
    const _spec = defineSpec(({ param }) => ({
      id: "literal-enum",
      params: {
        mode: param.enum(["sine", "square", "saw"]),
      },
    }));

    type Mode = (typeof _spec.params.mode.values)[number];
    expectTypeOf<Mode>().toEqualTypeOf<"sine" | "square" | "saw">();
  });

  it("infers array lengths correctly", () => {
    const _spec = defineSpec(({ param, meter }) => ({
      id: "array-lengths",
      params: {
        curve: param.f32.array(128),
      },
      meters: {
        spectrum: meter.f32.array(1024),
      },
    }));

    type CurveLen = typeof _spec.params.curve.length;
    type SpectrumLen = typeof _spec.meters.spectrum.length;

    expectTypeOf<CurveLen>().toEqualTypeOf<128>();
    expectTypeOf<SpectrumLen>().toEqualTypeOf<1024>();
  });

  it("accepts both scalar and object forms for enum", () => {
    const spec1 = defineSpec(({ param }) => ({
      id: "enum-scalar",
      params: {
        mode: param.enum(["a", "b"]),
      },
      meters: {},
    }));

    const spec2 = defineSpec(({ param }) => ({
      id: "enum-object",
      params: {
        mode: param.enum({ values: ["a", "b"] }),
      },
      meters: {},
    }));

    expect(spec1.params.mode.values).toEqual(["a", "b"]);
    expect(spec2.params.mode.values).toEqual(["a", "b"]);
  });

  it("throws on invalid numeric range (min > max)", () => {
    expect(() => {
      defineSpec(({ param }) => ({
        id: "bad-range",
        params: {
          gain: param.f32({ min: 10, max: 1 }), // Invalid: min > max.
        },
        meters: {},
      }));
    }).toThrow(/range|min|max/i);
  });

  it("throws on non-integer i32 range bounds", () => {
    expect(() => {
      defineSpec(({ param }) => ({
        id: "fractional-i32",
        params: {
          steps: param.i32({ min: 1.5, max: 10 }), // Invalid: Fractional min.
        },
        meters: {},
      }));
    }).toThrow(); // spec.rangeInvalid is enough; message tested elsewhere
  });

  it("throws on non-positive array lengths", () => {
    expect(() => {
      defineSpec(({ param }) => ({
        id: "zero-array",
        params: {
          invalid: param.f32.array(0), // Invalid: Zero length.
        },
        meters: {},
      }));
    }).toThrow(); // spec.arrayInvalid

    expect(() => {
      defineSpec(({ param }) => ({
        id: "negative-array",
        params: {
          invalid: param.f32.array(-5), // Invalid: Negative length.
        },
        meters: {},
      }));
    }).toThrow(); // spec.arrayInvalid
  });

  it("throws on empty enum values", () => {
    expect(() => {
      defineSpec(({ param }) => ({
        id: "empty-enum",
        params: {
          mode: param.enum([]),
        },
        meters: {},
      }));
    }).toThrow(/enum|value|empty/i);
  });

  it("throws on enum with empty string values", () => {
    expect(() => {
      defineSpec(({ param }) => ({
        id: "empty-string-enum",
        params: {
          mode: param.enum(["valid", "", "another"]),
        },
        meters: {},
      }));
    }).toThrow(); // spec.enumInvalid
  });

  it("accepts array length when passed as an object", () => {
    const spec = defineSpec(({ param }) => ({
      id: "object-length",
      params: {
        data: param.f32.array({ length: 256 }),
      },
      meters: {},
    }));

    expect(spec.params.data.length).toBe(256);
  });

  it("preserves enum array literal types", () => {
    const _spec = defineSpec(({ param }) => ({
      id: "enum-array",
      params: {
        states: param.enum.array({
          values: ["idle", "active", "paused"],
          length: 8,
        }),
      },
      meters: {},
    }));

    type State = (typeof _spec.params.states.values)[number];
    expectTypeOf<State>().toEqualTypeOf<"idle" | "active" | "paused">();
  });

  it("allows minimal scalar f32/i32 without ranges", () => {
    const spec = defineSpec(() => ({
      id: "minimal",
      params: {
        f: { kind: "f32" },
        i: { kind: "i32" },
      },
    }));

    expect(spec.params.f.kind).toBe("f32");
    expect(spec.params.i.kind).toBe("i32");
  });

  it("distinguishes param vs meter builders", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "builder-types",
      params: {
        pf32: param.f32({ min: 0, max: 1 }),
      },
      meters: {
        mf32: meter.f32(),
        mf64: meter.f64(),
        mu32: meter.u32(),
      },
    }));

    expect(spec.params.pf32.kind).toBe("f32");
    expect(spec.meters.mf32.kind).toBe("f32");
    expect(spec.meters.mf64.kind).toBe("f64");
    expect(spec.meters.mu32.kind).toBe("u32");
  });

  it("infers readonly constraint on spec properties", () => {
    const _spec = defineSpec(({ param }) => ({
      id: "readonly-check",
      params: {
        gain: param.f32({ min: 0, max: 1 }),
      },
    }));

    type IsReadonly<T> = T extends { readonly kind: unknown } ? true : false;
    type Check = IsReadonly<typeof _spec.params.gain>;
    expectTypeOf<Check>().toEqualTypeOf<true>();
  });

  it("validates meter bool kind (new in v1)", () => {
    const spec = defineSpec(({ meter }) => ({
      id: "meter-bool",
      params: {},
      meters: {
        active: meter.bool(),
      },
    }));

    expect(spec.meters.active.kind).toBe("bool");
  });
});
