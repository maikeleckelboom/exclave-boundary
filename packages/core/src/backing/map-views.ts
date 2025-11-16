import { getSharedBuffer } from './buffers';
import { createError } from '../errors/error';
import { ALL_PLANES, BYTES_PER_ELEM, type PlaneKey } from '../primitives/planes';

import type { Backing, SharedBacking, WasmSharedBacking } from './types';
import type { Plan, PlaneByteLengths } from '../plan/types';
import type { SpecInput } from '../spec/types';

/**
 * Backing ABI: byte-pack order of all planes for contiguous / wasm-shared backings.
 *
 * @remarks
 * - Used to compute contiguous base offsets (`PlaneBases`) for `SharedBacking`
 *   and `WasmSharedBacking`.
 * - Changing this is a breaking layout change; introduce a V2 constant instead
 *   of mutating this one in place.
 */
export const BACKING_PLANE_PACK_ORDER_V1: readonly PlaneKey[] = [
  'MF64',
  'PF32',
  'PI32',
  'PU',
  'MF32',
  'MU32',
  'MU',
  'PB',
];

export type PlaneBases = Readonly<Record<PlaneKey, number>>;

/** Internal mutable view used while constructing PlaneBases. */
type MutablePlaneBases = Record<PlaneKey, number>;

export interface ParamPlaneViews {
  readonly PF32: Float32Array;
  readonly PI32: Int32Array;
  readonly PB: Uint8Array;
  readonly PU: Uint32Array;
}

export interface MeterPlaneViews {
  readonly MF32: Float32Array;
  readonly MF64: Float64Array;
  readonly MU32: Uint32Array;
  readonly MU: Uint32Array;
}

export interface MappedViews {
  readonly bases: PlaneBases;
  readonly params: ParamPlaneViews;
  readonly meters: MeterPlaneViews;
  readonly locks: {
    readonly PU: Uint32Array;
    readonly MU: Uint32Array;
  };
}

/**
 * Build a zero-initialized plane-bases record.
 * This keeps the set of planes in one place (`ALL_PLANES`).
 */
function createZeroPlaneBases(): MutablePlaneBases {
  const bases: MutablePlaneBases = {} as MutablePlaneBases;
  for (const plane of ALL_PLANES) {
    bases[plane] = 0;
  }
  return bases;
}

/**
 * Compute byte offsets for each plane in a packed backing (contiguous / wasm-shared).
 *
 * @remarks
 * - Offsets are expressed in bytes, not elements.
 * - Packing order is defined by `BACKING_PLANE_PACK_ORDER_V1`.
 */
export function computeBackingPlaneBases(planes: PlaneByteLengths): PlaneBases {
  const bases = createZeroPlaneBases();
  let cursor = 0;

  for (const plane of BACKING_PLANE_PACK_ORDER_V1) {
    bases[plane] = cursor;
    cursor += planes[plane];
  }

  return bases;
}

function mapPackedBacking<S extends SpecInput>(
  plan: Plan<S>,
  backing: SharedBacking | WasmSharedBacking,
): MappedViews {
  const buf = getSharedBuffer(backing);
  const actualBytes = buf.byteLength;
  const requiredBytes = plan.bytesTotal;

  if (actualBytes < requiredBytes) {
    throw createError('backing.allocUndersized', 'Backing buffer undersized', {
      plane: 'all',
      requestedBytes: requiredBytes,
      allocatedBytes: actualBytes,
      where: 'mapViews',
    });
  }

  const bases = computeBackingPlaneBases(plan.planes);

  const PF32 = new Float32Array(
    buf,
    bases.PF32,
    Math.trunc(plan.planes.PF32 / BYTES_PER_ELEM.PF32),
  );
  const PI32 = new Int32Array(
    buf,
    bases.PI32,
    Math.trunc(plan.planes.PI32 / BYTES_PER_ELEM.PI32),
  );
  const PB = new Uint8Array(buf, bases.PB, plan.planes.PB);
  const PU = new Uint32Array(
    buf,
    bases.PU,
    Math.trunc(plan.planes.PU / BYTES_PER_ELEM.PU),
  );

  const MF32 = new Float32Array(
    buf,
    bases.MF32,
    Math.trunc(plan.planes.MF32 / BYTES_PER_ELEM.MF32),
  );
  const MF64 = new Float64Array(
    buf,
    bases.MF64,
    Math.trunc(plan.planes.MF64 / BYTES_PER_ELEM.MF64),
  );
  const MU32 = new Uint32Array(
    buf,
    bases.MU32,
    Math.trunc(plan.planes.MU32 / BYTES_PER_ELEM.MU32),
  );
  const MU = new Uint32Array(
    buf,
    bases.MU,
    Math.trunc(plan.planes.MU / BYTES_PER_ELEM.MU),
  );

  return {
    bases,
    params: { PF32, PI32, PB, PU },
    meters: { MF32, MF64, MU32, MU },
    locks: { PU, MU },
  };
}

function mapPartitionedBacking<S extends SpecInput>(
  plan: Plan<S>,
  partitionedBacking: Extract<Backing, { kind: 'shared-partitioned' }>,
): MappedViews {
  // In partitioned mode each plane starts at byteOffset 0 in its own SAB.
  const bases = createZeroPlaneBases();

  const ensurePlaneBuffer = (plane: PlaneKey): SharedArrayBuffer => {
    const sab = partitionedBacking.planes[plane];
    const requiredByteLength = plan.planes[plane];

    if (sab.byteLength < requiredByteLength) {
      throw createError('backing.allocUndersized', `Plane ${plane} too small`, {
        plane,
        requestedBytes: requiredByteLength,
        allocatedBytes: sab.byteLength,
        where: 'mapViews.partitioned',
      });
    }

    return sab;
  };

  const PF32 = new Float32Array(
    ensurePlaneBuffer('PF32'),
    0,
    Math.trunc(plan.planes.PF32 / BYTES_PER_ELEM.PF32),
  );
  const PI32 = new Int32Array(
    ensurePlaneBuffer('PI32'),
    0,
    Math.trunc(plan.planes.PI32 / BYTES_PER_ELEM.PI32),
  );
  const PB = new Uint8Array(ensurePlaneBuffer('PB'), 0, plan.planes.PB);
  const PU = new Uint32Array(
    ensurePlaneBuffer('PU'),
    0,
    Math.trunc(plan.planes.PU / BYTES_PER_ELEM.PU),
  );

  const MF32 = new Float32Array(
    ensurePlaneBuffer('MF32'),
    0,
    Math.trunc(plan.planes.MF32 / BYTES_PER_ELEM.MF32),
  );
  const MF64 = new Float64Array(
    ensurePlaneBuffer('MF64'),
    0,
    Math.trunc(plan.planes.MF64 / BYTES_PER_ELEM.MF64),
  );
  const MU32 = new Uint32Array(
    ensurePlaneBuffer('MU32'),
    0,
    Math.trunc(plan.planes.MU32 / BYTES_PER_ELEM.MU32),
  );
  const MU = new Uint32Array(
    ensurePlaneBuffer('MU'),
    0,
    Math.trunc(plan.planes.MU / BYTES_PER_ELEM.MU),
  );

  return {
    bases,
    params: { PF32, PI32, PB, PU },
    meters: { MF32, MF64, MU32, MU },
    locks: { PU, MU },
  };
}

export function mapViews<S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
): MappedViews {
  switch (backing.kind) {
    case 'shared-partitioned':
      return mapPartitionedBacking(plan, backing);
    case 'shared':
    case 'wasm-shared':
      return mapPackedBacking(plan, backing);
  }
}
