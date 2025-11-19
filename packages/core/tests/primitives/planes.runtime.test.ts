import { describe, it, expect } from 'vitest';

import { ALL_PLANES, BYTES_PER_ELEM, roundUpTo } from '../../src/primitives/planes';

describe('planes primitives', () => {
  it('exposes the expected plane keys in a stable order', () => {
    expect(ALL_PLANES).toEqual([
      'PF32',
      'PI32',
      'PB',
      'PU',
      'MF32',
      'MF64',
      'MU32',
      'MU',
    ]);
  });

  it('maps planes to correct byte sizes', () => {
    expect(BYTES_PER_ELEM.PF32).toBe(Float32Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.PI32).toBe(Int32Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.PB).toBe(Uint8Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.PU).toBe(Uint32Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.MF32).toBe(Float32Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.MU32).toBe(Uint32Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.MF64).toBe(Float64Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.MU).toBe(Uint32Array.BYTES_PER_ELEMENT);
  });

  it('roundUpTo aligns to power-of-two boundaries', () => {
    expect(roundUpTo(0, 4)).toBe(0);
    expect(roundUpTo(1, 4)).toBe(4);
    expect(roundUpTo(4, 4)).toBe(4);
    expect(roundUpTo(5, 4)).toBe(8);

    // another alignment just to exercise the bit math a bit more
    expect(roundUpTo(7, 8)).toBe(8);
    expect(roundUpTo(9, 8)).toBe(16);
  });

  it('roundUpTo rejects non power-of-two or non-positive alignments', () => {
    expect(() => roundUpTo(10, 0)).toThrow('roundUpTo: align must be power-of-two');
    expect(() => roundUpTo(10, -8)).toThrow('roundUpTo: align must be power-of-two');
    expect(() => roundUpTo(10, 3)).toThrow('roundUpTo: align must be power-of-two');
  });
});
