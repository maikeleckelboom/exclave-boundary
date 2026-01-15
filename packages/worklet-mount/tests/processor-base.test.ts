import { describe, expect, it, vi } from "vitest";

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

function must<T>(value: T | undefined, msg: string): T {
  if (value === undefined) {
    throw new Error(msg);
  }
  return value;
}

type Posted = Readonly<{
  msg: unknown;
  transfer?: readonly Transferable[];
}>;

class TestMessagePort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  readonly sent: Posted[] = [];

  postMessage(msg: unknown, transfer?: readonly Transferable[]): void {
    if (transfer === undefined) {
      this.sent.push({ msg });
      return;
    }
    this.sent.push({ msg, transfer });
  }
}

class TestAudioWorkletProcessor {
  readonly port: MessagePort;

  constructor() {
    this.port = new TestMessagePort() as unknown as MessagePort;
  }

  process(
    _inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _params: Record<string, Float32Array>,
  ): boolean {
    return true;
  }
}

describe("WorkletMountAudioWorkletProcessor", () => {
  it("loads, transitions to ready, and locks RT alloc", async () => {
    vi.stubGlobal(
      "AudioWorkletProcessor",
      TestAudioWorkletProcessor as unknown as typeof AudioWorkletProcessor,
    );

    const { WorkletMountAudioWorkletProcessor } = await import(
      "../src/worklet/processor-base"
    );

    class P extends WorkletMountAudioWorkletProcessor<Mod> {
      loaded: Mod | null = null;

      protected getBundledRegistry() {
        return {
          test: (
            _opts: Readonly<
              Record<string, unknown> & { wasmBinary: Uint8Array }
            >,
          ) => ({
            HEAPU8: new Uint8Array(8),
            HEAPF32: new Float32Array(8),
            _malloc: (b: number) => b >>> 0,
            _free: (ptr: number) => {
              void ptr;
            },
          }),
        };
      }

      protected onWasmLoaded(module: Mod): void {
        const p = this.malloc(16);
        expect(p).toBe(16);
        this.free(p);
        this.loaded = module;
      }

      protected processBlock(): boolean {
        return true;
      }
    }

    const p = new P();
    const port = p.port as unknown as TestMessagePort;

    port.onmessage?.({
      data: {
        type: "wm:mount",
        key: "test",
        seq: 1,
        wasmBytes: wasmBytes(),
      },
    } as MessageEvent<unknown>);

    await Promise.resolve();
    await Promise.resolve();

    expect(
      port.sent.some((m) => (m.msg as { type?: unknown }).type === "wm:ready"),
    ).toBe(true);

    const mod = p.loaded;
    if (!mod) {
      throw new Error("missing module");
    }
    expect(() => mod._malloc(4)).toThrow(/RT allocation/i);

    vi.unstubAllGlobals();
  });

  it("zeros outputs on process crash", async () => {
    vi.stubGlobal(
      "AudioWorkletProcessor",
      TestAudioWorkletProcessor as unknown as typeof AudioWorkletProcessor,
    );

    const { WorkletMountAudioWorkletProcessor } = await import(
      "../src/worklet/processor-base"
    );

    class P extends WorkletMountAudioWorkletProcessor<Mod> {
      protected getBundledRegistry() {
        return {
          test: (
            _opts: Readonly<
              Record<string, unknown> & { wasmBinary: Uint8Array }
            >,
          ) => ({
            HEAPU8: new Uint8Array(8),
            HEAPF32: new Float32Array(8),
            _malloc: (b: number) => b >>> 0,
            _free: (ptr: number) => {
              void ptr;
            },
          }),
        };
      }

      protected onWasmLoaded(): void {
        /* no-op */
      }

      protected processBlock(): boolean {
        throw new Error("boom");
      }
    }

    const p = new P();
    const port = p.port as unknown as TestMessagePort;

    port.onmessage?.({
      data: {
        type: "wm:mount",
        key: "test",
        seq: 1,
        wasmBytes: wasmBytes(),
      },
    } as MessageEvent<unknown>);

    await Promise.resolve();
    await Promise.resolve();

    const outputs: Float32Array[][] = [
      [new Float32Array([1, 1]), new Float32Array([2, 2])],
    ];

    p.process([], outputs, {});
    const bus0 = must(outputs[0], "missing output bus");
    const ch0 = must(bus0[0], "missing output channel");
    expect(ch0[0]).toBe(0);

    vi.unstubAllGlobals();
  });
});
