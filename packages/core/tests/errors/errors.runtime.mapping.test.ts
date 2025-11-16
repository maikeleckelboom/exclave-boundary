import { describe, expect, it } from 'vitest';

import { createError } from '../../src/errors/error';

interface DetailShape {
  readonly detail: string;
}

interface FeatureReasonShape {
  readonly feature: string;
  readonly reason: string;
}

/**
 * Test helper: asserts that details has a string `detail` field,
 * and narrows the type for subsequent assertions.
 */
function expectHasDetail(details: unknown): asserts details is DetailShape {
  expect(details, 'details must not be null/undefined').not.toBeNull();
  expect(typeof details, 'details must be an object').toBe('object');

  const rec = details as Record<string, unknown>;
  expect(typeof rec.detail, 'details.detail must be a string').toBe('string');
}

/**
 * Test helper: asserts that details has string `feature` and `reason` fields.
 */
function expectHasFeatureReason(details: unknown): asserts details is FeatureReasonShape {
  expect(details, 'details must not be null/undefined').not.toBeNull();
  expect(typeof details, 'details must be an object').toBe('object');

  const rec = details as Record<string, unknown>;
  expect(typeof rec.feature, 'details.feature must be a string').toBe('string');
  expect(typeof rec.reason, 'details.reason must be a string').toBe('string');
}

describe('errors/error createError runtime composition', () => {
  it('composes backing.wasmMemoryNotShared with message, details and cause', () => {
    const cause = new TypeError('shared memory not supported');

    const err = createError(
      'backing.wasmMemoryNotShared',
      'Allocated WebAssembly.Memory is not shared',
      {
        detail: 'memory.buffer is not a SharedArrayBuffer',
        plane: 'wasm',
        shared: false,
      },
      cause,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('backing.wasmMemoryNotShared');

    // Human-friendly explanation is present
    expect(err.message).toMatch(/not shared/i);

    // Details payload should be present and well-typed
    expectHasDetail(err.details);
    expect(err.details.detail).toMatch(/SharedArrayBuffer/i);

    // Cause should be preserved verbatim
    expect(err.cause).toBe(cause);
  });

  it('composes env.unsupported with feature + reason details', () => {
    const err = createError('env.unsupported', 'Feature unavailable', {
      feature: 'SharedArrayBuffer',
      reason: 'Missing COOP/COEP',
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('env.unsupported');

    // Human message remains readable and stable
    expect(err.message).toMatch(/Feature unavailable/i);

    // Shape-specific details contract: { feature, reason }
    expectHasFeatureReason(err.details);
    expect(err.details.feature).toBe('SharedArrayBuffer');
    expect(err.details.reason).toMatch(/COOP\/COEP/i);
  });
});
