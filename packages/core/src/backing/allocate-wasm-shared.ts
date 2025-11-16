import { createError } from '../errors/error';
import { throwEnvUnsupported } from '../errors/helpers';

import type { WasmSharedBacking } from './types';
import type { Plan } from '../plan/types';
import type { SpecInput } from '../spec/types';

const WASM_PAGE_SIZE = 65536;

function toSharedBuffer(buf: ArrayBuffer, where: string): SharedArrayBuffer {
  const sharedAvailable = typeof SharedArrayBuffer !== 'undefined';
  const isShared = sharedAvailable && buf instanceof SharedArrayBuffer;
  if (!isShared) {
    throw createError('backing.wasmMemoryNotShared', 'Wasm memory is not shared', {
      plane: 'wasm',
      shared: false,
      where,
    });
  }
  return buf as unknown as SharedArrayBuffer;
}

export function allocateWasmShared<S extends SpecInput>(
  plan: Plan<S>,
): WasmSharedBacking {
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.Memory === 'undefined') {
    throwEnvUnsupported(
      'WebAssembly.Memory',
      'WebAssembly or WebAssembly.Memory is not defined',
    );
  }

  const requiredPages = Math.max(1, Math.ceil(plan.bytesTotal / WASM_PAGE_SIZE));

  let memory: WebAssembly.Memory;
  try {
    memory = new WebAssembly.Memory({
      initial: requiredPages,
      maximum: requiredPages,
      shared: true,
    });
  } catch (cause) {
    throw createError(
      'backing.wasmMemoryNotShared',
      'Failed to attach shared WebAssembly.Memory',
      { plane: 'wasm', shared: false, where: 'allocateWasmShared' },
      cause,
    );
  }

  const sharedBuf = toSharedBuffer(memory.buffer, 'allocateWasmShared');

  if (sharedBuf.byteLength < plan.bytesTotal) {
    throw createError('backing.allocUndersized', 'Wasm shared memory undersized', {
      plane: 'all',
      requestedBytes: plan.bytesTotal,
      allocatedBytes: sharedBuf.byteLength,
      where: 'allocateWasmShared',
    });
  }

  return { kind: 'wasm-shared', memory };
}
