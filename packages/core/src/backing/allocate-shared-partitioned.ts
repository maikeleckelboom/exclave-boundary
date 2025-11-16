import { createError } from '../errors/error';
import { throwEnvUnsupported } from '../errors/helpers';
import { ALL_PLANES, type PlaneKey } from '../primitives/planes';

import type { SharedPartitionedBacking } from './types';
import type { Plan } from '../plan/types';
import type { SpecInput } from '../spec/types';

export function allocateSharedPartitioned<S extends SpecInput>(
  plan: Plan<S>,
): SharedPartitionedBacking {
  if (typeof SharedArrayBuffer === 'undefined') {
    throwEnvUnsupported(
      'SharedArrayBuffer',
      'missing SharedArrayBuffer (check COOP/COEP for browsers)',
    );
  }

  const sabByPlane = Object.create(null) as Record<PlaneKey, SharedArrayBuffer>;

  for (const plane of ALL_PLANES) {
    const bytes = plan.planes[plane];

    try {
      sabByPlane[plane] = new SharedArrayBuffer(bytes);
    } catch (cause) {
      throw createError(
        'backing.allocFailed',
        'Failed to allocate SharedArrayBuffer for plane ' + plane,
        {
          plane,
          requestedBytes: bytes,
          allocatedBytes: 0,
          where: 'allocateSharedPartitioned',
        },
        cause,
      );
    }
  }

  return {
    kind: 'shared-partitioned',
    planes: sabByPlane,
  };
}
