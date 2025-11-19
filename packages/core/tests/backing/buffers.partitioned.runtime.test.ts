import { describe, it, expect } from 'vitest';

import { allocateSharedPartitioned } from '../../src/backing/allocate-shared-partitioned';
import { getSharedBuffer } from '../../src/backing/buffers';
import { SeqlokError } from '../../src/errors/error';
import { planLayout } from '../../src/plan/layout';
import { defineSpec } from '../../src/spec/define';

describe('getSharedBuffer with shared-partitioned backing', () => {
  it('throws an internal.assertionFailed error', () => {
    const spec = defineSpec(({ param, meter }) => ({
      params: {
        rate: param.f32(),
      },
      meters: {
        level: param.f32(),
      },
    }));
    const plan = planLayout(spec);
    const backing = allocateSharedPartitioned(plan);

    expect(() => getSharedBuffer(backing)).toThrow(SeqlokError);

    try {
      getSharedBuffer(backing);
    } catch (error) {
      const err = error as SeqlokError;
      expect(err.code).toBe('internal.assertionFailed');
      expect(err.details.where).toBe('backing.getSharedBuffer');
    }
  });
});
