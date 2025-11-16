import { describe, it, expect, vi, afterEach } from 'vitest';

import { allocateWasmShared } from '../../src/backing/allocate-wasm-shared';
import { isSeqlokError } from '../../src/errors/error';
import { planLayout } from '../../src/plan/layout';
import { defineSpec } from '../../src/spec/define';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('allocateWasmShared — non-shared memory surface', () => {
  it('throws backing.wasmMemoryNotShared if Memory.buffer is not a SharedArrayBuffer', () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: 'demo',
      params: { p: param.f32({ min: 0, max: 1 }) },
      meters: { m: meter.f32() },
    }));
    const plan = planLayout(spec);

    // Memory substitute returning a regular ArrayBuffer for buffer
    class NonSharedMemory {
      private readonly _buf = new ArrayBuffer(1024);
      get buffer(): ArrayBuffer {
        return this._buf;
      }
    }

    vi.stubGlobal('WebAssembly', {
      Memory: NonSharedMemory as unknown as typeof WebAssembly.Memory,
    } as unknown as typeof WebAssembly);

    try {
      allocateWasmShared(plan);
      expect(false).toBe(true);
    } catch (e: unknown) {
      if (!isSeqlokError(e)) {
        throw e;
      }
      expect(e.code).toBe('backing.wasmMemoryNotShared');
      if ('shared' in e.details) {
        expect(e.details.shared).toBe(false);
      }
      expect(e.details.where).toBe('allocateWasmShared');
    }
  });
});
