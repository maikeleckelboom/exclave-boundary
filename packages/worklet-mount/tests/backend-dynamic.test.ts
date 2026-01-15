import { describe, expect, it } from "vitest";

import { createDynamicFactory } from "../src/worklet/backend-dynamic";

type Mod = Readonly<{
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
}>;

function wasmBytes(): ArrayBuffer {
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
    .buffer;
}

describe("backend-dynamic", () => {
  it("instantiates a module from wrapper text", async () => {
    const wrapper = `
      var Module = function(opts) {
        if (!(opts && opts.wasmBinary instanceof Uint8Array)) {
          throw new Error("missing wasmBinary");
        }
        return {
          HEAPU8: new Uint8Array(8),
          HEAPF32: new Float32Array(8),
          _malloc: function(bytes) { return bytes >>> 0; },
          _free: function(ptr) { void ptr; },
        };
      };
    `;

    const factory = createDynamicFactory<Mod>({
      key: "k",
      seq: 1,
      wrapperJs: wrapper,
      wasmBytes: wasmBytes(),
    });

    const mod = await factory({ wasmBinary: new Uint8Array([1, 2, 3]) });

    expect(mod.HEAPU8).toBeInstanceOf(Uint8Array);
    expect(mod.HEAPF32).toBeInstanceOf(Float32Array);
    expect(mod._malloc(4)).toBe(4);
  });

  it("throws if wrapper does not yield a factory", () => {
    const wrapper = `
      var Module = { not: "a function" };
    `;

    expect(() =>
      createDynamicFactory<Mod>({
        key: "k",
        seq: 1,
        wrapperJs: wrapper,
        wasmBytes: wasmBytes(),
      }),
    ).toThrow(/yield a factory/i);
  });
});
