import { describe, it, expect, vi, afterEach } from 'vitest';

import { allocateWasmShared } from '../../src/backing/allocate-wasm-shared';
import { planLayout } from '../../src/plan/layout';
import { defineSpec } from '../../src/spec/define';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('allocateWasmShared — allocates enough pages to hold plan.bytesTotal', () => {
  it('allocates a shared memory whose buffer length covers bytesTotal exactly', () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: 'demo',
      params: { p: param.f32({ min: 0, max: 1 }) },
      // push meters to require multiple pages on most envs
      meters: { m: meter.f32.array(1000) },
    }));

    const plan = planLayout(spec);
    const backing = allocateWasmShared(plan);

    // Sanity: backing exposes the underlying SharedArrayBuffer
    expect(backing.kind).toBe('wasm-shared');
    expect(backing.memory.buffer instanceof SharedArrayBuffer).toBe(true);
    expect(backing.memory.buffer.byteLength).toBeGreaterThanOrEqual(plan.bytesTotal);
  });
});
