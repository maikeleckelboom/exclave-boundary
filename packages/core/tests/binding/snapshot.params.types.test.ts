import { describe, it, expectTypeOf } from "vitest";

import type {
  IntoForParams,
  ParamsSnapshot,
  SnapshotParamsObject,
} from "../../src/binding/common/types";
import type { SpecInput } from "../../src/spec/types";

interface S extends SpecInput {
  readonly id: "snap-params";
  readonly params: {
    readonly gain: { readonly kind: "f32" };
    readonly mode: {
      readonly kind: "enum";
      readonly values: readonly ["normal", "granular"];
    };
    readonly curve: { readonly kind: "f32.array"; readonly length: 8 };
    readonly states: { readonly kind: "bool.array"; readonly length: 4 };
  };
}

describe("ControllerParams.snapshot typing", () => {
  it("mapping: all params via ParamsSnapshot", () => {
    type R = ParamsSnapshot<S>;
    type Expected = Readonly<{
      readonly gain: number;
      readonly mode: "normal" | "granular";
      readonly curve: Readonly<Float32Array>;
      readonly states: Readonly<Uint8Array>;
    }>;

    expectTypeOf<R>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<R>();
  });

  it("mapping: all params via SnapshotParamsObject with full key set", () => {
    type R = SnapshotParamsObject<
      S,
      readonly ["gain", "mode", "curve", "states"]
    >;
    type Expected = Readonly<{
      readonly gain: number;
      readonly mode: "normal" | "granular";
      readonly curve: Readonly<Float32Array>;
      readonly states: Readonly<Uint8Array>;
    }>;

    expectTypeOf<R>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<R>();
  });

  it("mapping: single-key subset stays scalar", () => {
    type R = SnapshotParamsObject<S, readonly ["gain"]>;
    type Expected = Readonly<{
      readonly gain: number;
    }>;

    expectTypeOf<R>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<R>();
  });

  it("mapping: mixed subset stays precise per property", () => {
    type R = SnapshotParamsObject<S, readonly ["mode", "curve"]>;
    type Expected = Readonly<{
      readonly mode: "normal" | "granular";
      readonly curve: Readonly<Float32Array>;
    }>;

    expectTypeOf<R>().toExtend<Expected>();
    expectTypeOf<Expected>().toExtend<R>();
  });

  it("into typing only allows array keys and enforces constructors", () => {
    type Good = IntoForParams<S, readonly ["curve", "states"]>;
    type GoodExpected = Readonly<{
      curve?: Float32Array;
      states?: Uint8Array;
    }>;

    expectTypeOf<Good>().toExtend<GoodExpected>();
    expectTypeOf<GoodExpected>().toExtend<Good>();

    type BadScalar = IntoForParams<S, readonly ["gain"]>;
    type Empty = Readonly<Record<never, never>>;

    expectTypeOf<BadScalar>().toExtend<Empty>();
    expectTypeOf<Empty>().toExtend<BadScalar>();
  });
});
