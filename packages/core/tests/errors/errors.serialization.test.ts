import { describe, it, expect } from 'vitest';

import { createError, isSeqlokError, type SeqlokError } from '../../src/errors/error';

describe('errors/error – toJSON + type guard coverage', () => {
  it('serializes to a stable minimal JSON shape and omits details/cause', () => {
    const err = createError('backing.wasmMemoryNotShared', 'wrapped', {
      detail: 'WebAssembly.Memory.buffer is not SharedArrayBuffer',
      plane: 'wasm',
      shared: false,
    });

    expect(isSeqlokError(err)).toBe(true);

    const json = JSON.parse(JSON.stringify(err)) as ReturnType<SeqlokError['toJSON']>;

    expect(json.name).toBe('SeqlokError');
    expect(json.code).toBe('backing.wasmMemoryNotShared');
    expect(typeof json.message).toBe('string');

    const keys = Object.keys(json).sort();
    expect(keys).toEqual(['code', 'message', 'name']);

    expect('payload' in json).toBe(false);
    expect('cause' in json).toBe(false);
  });

  it('isSeqlokError only accepts branded SeqlokError-like objects (by name)', () => {
    const seqlokErr = createError('env.unsupported', 'Feature unavailable', {
      feature: 'SharedArrayBuffer',
      reason: 'Missing COOP/COEP',
    });

    expect(isSeqlokError(seqlokErr)).toBe(true);

    const foreign1 = new Error('nope');
    const foreign2 = {
      name: 'Error',
      message: 'nope',
      code: 'env.unsupported',
    } as unknown;
    const foreign3 = null as unknown;
    const foreign4 = 42 as unknown;

    expect(isSeqlokError(foreign1)).toBe(false);
    expect(isSeqlokError(foreign2)).toBe(false);
    expect(isSeqlokError(foreign3)).toBe(false);
    expect(isSeqlokError(foreign4)).toBe(false);
  });
});
