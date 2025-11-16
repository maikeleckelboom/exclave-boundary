import { describe, expect, it } from 'vitest';

import { getSharedBuffer } from '../../src/backing/buffers';
import { planLayout } from '../../src/plan/layout';
import { specFromPlaneBytes } from '../__helpers__/spec-from-bytes';

import type {
  Backing,
  SharedBacking,
  SharedPartitionedBacking,
  WasmSharedBacking,
} from '../../src/backing/types';
import type { PlaneByteLengths } from '../../src/plan/types';
import type { PlaneKey } from '../../src/primitives';

export function getBufferForPlane(backing: Backing, plane: PlaneKey): SharedArrayBuffer {
  if (backing.kind === 'shared-partitioned') {
    return backing.planes[plane];
  }
  return getSharedBuffer(backing);
}

describe('buffer helpers', () => {
  const bytes: PlaneByteLengths = {
    PF32: 8 * 4,
    PI32: 4 * 4,
    PB: 7,
    PU: 2 * 4,
    MF32: 6 * 4,
    MF64: 8,
    MU32: 3 * 4,
    MU: 2 * 4,
  };
  const plan = planLayout(specFromPlaneBytes(bytes));

  it('getSharedBuffer returns the underlying shared buffer for contiguous and wasm backings', () => {
    const sab = new SharedArrayBuffer(plan.bytesTotal);
    const cont: SharedBacking = { kind: 'shared', sab };
    expect(getSharedBuffer(cont)).toBe(sab);

    const pages = Math.ceil(plan.bytesTotal / (64 * 1024));
    const memory = new WebAssembly.Memory({
      shared: true,
      initial: pages,
      maximum: pages,
    });
    const wasm: WasmSharedBacking = { kind: 'wasm-shared', memory };
    expect(getSharedBuffer(wasm)).toBe(memory.buffer);
  });

  it('getSharedBuffer throws for split/partitioned (no single SAB); use getBufferForPlane', () => {
    const split: SharedPartitionedBacking = {
      kind: 'shared-partitioned',
      planes: {
        PF32: new SharedArrayBuffer(plan.planes.PF32),
        PI32: new SharedArrayBuffer(plan.planes.PI32),
        PB: new SharedArrayBuffer(plan.planes.PB),
        PU: new SharedArrayBuffer(plan.planes.PU),
        MF32: new SharedArrayBuffer(plan.planes.MF32),
        MF64: new SharedArrayBuffer(plan.planes.MF64),
        MU32: new SharedArrayBuffer(plan.planes.MU32),
        MU: new SharedArrayBuffer(plan.planes.MU),
      },
    };

    expect(() => getSharedBuffer(split)).toThrow(
      /partitioned.*no single SharedArrayBuffer/i,
    );
    expect(getBufferForPlane(split, 'PF32')).toBe(split.planes.PF32);
    expect(getBufferForPlane(split, 'MU')).toBe(split.planes.MU);
  });
});
