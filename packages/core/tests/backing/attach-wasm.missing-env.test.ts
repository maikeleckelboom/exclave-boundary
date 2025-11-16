import { describe, it, expect, vi, afterEach } from 'vitest';

import { allocateWasmShared } from '../../src/backing/allocate-wasm-shared';
import { isSeqlokError } from '../../src/errors/error';
import { planLayout } from '../../src/plan/layout';
import { defineSpec } from '../../src/spec/define';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('allocateWasmShared — missing WebAssembly environment', () => {
  it('throws env.unsupported when WebAssembly is not available', () => {
    // Arrange
    const spec = defineSpec(({ param, meter }) => ({
      id: 'test',
      params: { p: param.f32({ min: 0, max: 1 }) },
      meters: { m: meter.f32() },
    }));
    const plan = planLayout(spec);

    // Simulate environment with no WebAssembly support
    vi.stubGlobal('WebAssembly', undefined as never);

    // Act/Assert
    try {
      allocateWasmShared(plan);
      expect(false).toBe(true); // should not reach
    } catch (e: unknown) {
      if (!isSeqlokError(e)) {
        throw e;
      }

      expect(e.code).toBe('env.unsupported');

      // Be tolerant to implementation wording:
      // - "WebAssembly.Memory unavailable"
      // - "WebAssembly or WebAssembly.Memory is not defined"
      const msg = e.message.toLowerCase();
      expect(msg.includes('webassembly')).toBe(true);
      expect(msg.includes('unavailable') || msg.includes('not defined')).toBe(true);

      // If details carries a reason string, sanity-check it without unsafe casts
      const d = e.details;
      const hasReason =
        typeof d === 'object' &&
        'reason' in d &&
        typeof (d as { reason: unknown }).reason === 'string';
      if (hasReason) {
        const reason = (d as { reason: string }).reason.toLowerCase();
        expect(reason.length).toBeGreaterThan(0);
      }
    }
  });
});
