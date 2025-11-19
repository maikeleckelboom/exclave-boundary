import { describe, expect, it } from 'vitest';

import { mapViews } from '../../src/backing/map-views';
import { planLayout } from '../../src/plan/layout';
import { specFromPlaneBytes } from '../helpers/spec-from-bytes';

import type { WasmSharedBacking } from '../../src/backing/types';
import type { PlaneByteLengths } from '../../src/plan/types';

const B4 = 4;
const B8 = 8;
const PAGE = 64 * 1024;

function roundPages(bytes: number): number {
  return Math.ceil(bytes / PAGE);
}

describe('mapViews (wasm shared)', () => {
  it('maps views from wasm-shared memory with planned byteLengths', () => {
    const req: PlaneByteLengths = {
      PF32: 8 * B4,
      PI32: 4 * B4,
      PB: 10,
      PU: 2 * B4,
      MF32: 6 * B4,
      MF64: 3 * B8,
      MU32: 3 * B4,
      MU: 2 * B4,
    };
    const plan = planLayout(specFromPlaneBytes(req));

    const memory = new WebAssembly.Memory({
      shared: true,
      initial: roundPages(plan.bytesTotal),
      maximum: roundPages(plan.bytesTotal),
    });
    const backing: WasmSharedBacking = { kind: 'wasm-shared', memory };

    const v = mapViews(plan, backing);
    expect(v.params.PF32.byteLength).toBe(plan.planes.PF32);
    expect(v.params.PI32.byteLength).toBe(plan.planes.PI32);
    expect(v.params.PB.byteLength).toBe(plan.planes.PB);
    expect(v.params.PU.byteLength).toBe(plan.planes.PU);
    expect(v.meters.MF32.byteLength).toBe(plan.planes.MF32);
    expect(v.meters.MF64.byteLength).toBe(plan.planes.MF64);
    expect(v.meters.MU32.byteLength).toBe(plan.planes.MU32);
    expect(v.locks.MU.byteLength).toBe(plan.planes.MU);
  });
});
