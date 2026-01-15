import { describe, expect, it } from "vitest";

import { WorkletMountProcessorCore } from "../src/worklet/processor-core";

import type { WmMessageOut } from "../src/protocol";
import type { EmscriptenModule, RuntimeModule } from "../src/worklet/types";

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

function unsafeRaw<T extends EmscriptenModule>(rt: RuntimeModule<T>): T {
  // Intentional: tests must pierce the RT-safe view to verify the guard.
  return rt as unknown as T;
}

describe("WorkletMountProcessorCore", () => {
  it("transitions to ready and locks setup alloc", async () => {
    const out: WmMessageOut[] = [];

    const core = new WorkletMountProcessorCore<Mod>({
      post: (m) => {
        out.push(m);
      },
      getBundledRegistry: () => ({
        a: () => ({
          HEAPU8: new Uint8Array(8),
          HEAPF32: new Float32Array(8),
          _malloc: (b) => b >>> 0,
          _free: (ptr) => {
            void ptr;
          },
        }),
      }),
      onWasmLoaded: (inst) => {
        const p = core.malloc(16);
        expect(p).toBe(16);
        core.free(p);
        expect(inst.key).toBe("a");
      },
    });

    await core.load({
      type: "wm:mount",
      key: "a",
      seq: 1,
      wasmBytes: wasmBytes(),
    });

    expect(core.state).toBe("ready");
    expect(out.some((m) => m.type === "wm:ready")).toBe(true);

    expect(() => core.malloc(4)).toThrow(/RT allocation/i);

    const rt = core.runtime;
    if (!rt) {
      throw new Error("missing runtime");
    }

    expect(() => unsafeRaw(rt.module)._malloc(4)).toThrow(/RT allocation/i);
  });

  it("faults on runtime exception and forces silence", async () => {
    const out: WmMessageOut[] = [];

    const core = new WorkletMountProcessorCore<Mod>({
      post: (m) => {
        out.push(m);
      },
      getBundledRegistry: () => ({
        a: () => ({
          HEAPU8: new Uint8Array(8),
          HEAPF32: new Float32Array(8),
          _malloc: (b) => b >>> 0,
          _free: (ptr) => {
            void ptr;
          },
        }),
      }),
      onWasmLoaded: () => {
        /* no-op */
      },
    });

    await core.load({
      type: "wm:mount",
      key: "a",
      seq: 1,
      wasmBytes: wasmBytes(),
    });

    const outputs: Float32Array[][] = [
      [new Float32Array([1, 1]), new Float32Array([2, 2])],
    ];

    core.runRt(outputs, () => {
      throw new Error("boom");
    });

    expect(out.some((m) => m.type === "wm:log" && m.level === "critical")).toBe(
      true,
    );
    expect(outputs[0]?.[0]?.[0]).toBe(0);
    expect(core.state).toBe("faulted");
  });
});
