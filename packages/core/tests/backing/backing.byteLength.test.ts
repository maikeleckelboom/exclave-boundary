import { describe, expect, it } from 'vitest';

import { backingByteLength } from '../../src/backing/allocate-shared';

describe('backingByteLength', () => {
  it('reports sab-contiguous length', () => {
    const sab = new SharedArrayBuffer(256);
    const len = backingByteLength({ kind: 'shared', sab } as const);
    expect(len).toBe(256);
  });

  it('reports wasm-shared length', () => {
    const mem = new WebAssembly.Memory({ shared: true, initial: 1, maximum: 1 });
    const len = backingByteLength({ kind: 'wasm-shared', memory: mem } as const);
    expect(len).toBe(mem.buffer.byteLength);
  });
});
