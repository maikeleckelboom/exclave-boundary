import { describe, it, expectTypeOf } from "vitest";

import type { CoherentParamShape } from "../../src/binding/common/types";
import type { SpecInput } from "../../src/spec/types";

describe("Coherent Param Shape", () => {
  interface S extends SpecInput {
    readonly id: "demo";
    readonly params: {
      readonly gain: { kind: "f32" };
      readonly mode: { kind: "enum"; values: ["square", "sine", "saw"] };
      readonly curve: { kind: "f32.array"; length: 64 };
    };
  }

  type P = CoherentParamShape<S>;
  const p: P = {
    gain: 0,
    mode: 2,
    curve: new Float32Array(4),
  };

  it("scalars are value-like (numeric for enums) and not callable", () => {
    expectTypeOf(p.gain).toExtend<number>();
    expectTypeOf(p.mode).toExtend<number>();

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (false as unknown as never) {
      // @ts-expect-error Intentional check to ensure CoherentValue is not callable.
      p.gain(123);
    }

    // Verify usage as primitives.
    void (p.gain * 2);
    void String(p.mode);
  });

  it("arrays remain processor scratch views (mutable typed arrays)", () => {
    expectTypeOf(p.curve).toExtend<Float32Array>();
    p.curve[0] = 1;
    void p.curve.byteLength;
  });
});
