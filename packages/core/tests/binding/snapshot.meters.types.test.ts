import { describe, expectTypeOf, it } from "vitest";

import type {
  IntoForMeters,
  SnapshotMetersObject,
} from "../../src/binding/common/types";
import type { SpecInput } from "../../src/spec/types";

interface S extends SpecInput {
  readonly id: "snap-meters";
  readonly meters: {
    readonly rms: { readonly kind: "f32" };
    readonly flags: { readonly kind: "u32.array"; readonly length: 4 };
    readonly spectrum: { readonly kind: "f32.array"; readonly length: 512 };
  };
}

describe("ControllerMeters.snapshot typing", () => {
  it("mapping: all meters", () => {
    type R = SnapshotMetersObject<S, readonly ["rms", "flags", "spectrum"]>;
    type Expected = Readonly<{
      rms: number;
      flags: Readonly<Uint32Array>;
      spectrum: Readonly<Float32Array>;
    }>;

    expectTypeOf<R>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<R>();
  });

  it("mapping: single-key subset stays scalar without array pollution", () => {
    type R = SnapshotMetersObject<S, readonly ["rms"]>;
    type Expected = Readonly<{
      rms: number;
    }>;

    expectTypeOf<R>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<R>();
  });

  it("mapping: mixed subset remains precise per property", () => {
    type R = SnapshotMetersObject<S, readonly ["rms", "spectrum"]>;
    type Expected = Readonly<{
      rms: number;
      spectrum: Readonly<Float32Array>;
    }>;

    expectTypeOf<R>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<R>();
  });

  it("into typing only allows array keys and enforces constructors", () => {
    type Good = IntoForMeters<S, readonly ["flags", "spectrum"]>;
    type GoodExpected = Readonly<{
      flags?: Uint32Array;
      spectrum?: Float32Array;
    }>;

    expectTypeOf<Good>().toExtend<GoodExpected>();
    expectTypeOf<GoodExpected>().toExtend<Good>();

    // Prove scalar keys produce no properties in into.
    type BadScalar = IntoForMeters<S, readonly ["rms"]>;
    expectTypeOf<BadScalar>().toExtend<Readonly<Record<never, never>>>();
    expectTypeOf<Readonly<Record<never, never>>>().toExtend<BadScalar>();
  });
});
