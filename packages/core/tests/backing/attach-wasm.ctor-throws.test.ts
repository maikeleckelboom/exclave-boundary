import { describe, it, expect, vi, afterEach } from 'vitest';

import { allocateWasmShared } from '../../src/backing/allocate-wasm-shared';
import { isSeqlokError } from '../../src/errors/error';
import { planLayout } from '../../src/plan/layout';
import { defineSpec } from '../../src/spec/define';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('allocateWasmShared — Memory ctor failure path', () => {
  it('throws a typed SeqlokError when WebAssembly.Memory constructor throws', () => {
    // Arrange
    const spec = defineSpec(({ param, meter }) => ({
      id: 'test',
      params: { p: param.f32({ min: 0, max: 1 }) },
      meters: { m: meter.f32() },
    }));
    const plan = planLayout(spec);

    // Make constructor throw synchronously
    class ThrowingMemory {
      constructor(_desc: WebAssembly.MemoryDescriptor) {
        throw new Error('boom-ctor');
      }

      get buffer(): ArrayBuffer {
        // never reached; keep shape-compatible
        return new ArrayBuffer(0);
      }
    }

    vi.stubGlobal('WebAssembly', {
      Memory: ThrowingMemory as unknown as typeof WebAssembly.Memory,
    } as unknown as typeof WebAssembly);

    // Act/Assert
    try {
      allocateWasmShared(plan);
      // If we get here, ctor did not throw as expected
      expect(false).toBe(true);
    } catch (e: unknown) {
      // Narrow using our official guard, no unsafe casts
      if (!isSeqlokError(e)) {
        throw e;
      }
      // Code path caught by allocateWasmShared when ctor fails
      expect(e.code).toBe('backing.wasmMemoryNotShared');
      expect(e.message).toMatch(/Failed to attach shared WebAssembly\.Memory/i);
      expect(e.details.where).toBe('allocateWasmShared');
    }
  });
});
