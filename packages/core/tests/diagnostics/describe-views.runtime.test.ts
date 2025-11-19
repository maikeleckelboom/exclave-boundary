import { describe, it, expect } from 'vitest';

import { defineSpec, planLayout, describeViews } from '../../src';

describe('describeViews', () => {
  it('renders a human-readable table with correct total bytes', () => {
    const spec = defineSpec(({ param, meter }) => ({
      params: {
        rate: param.f32({ min: 0.5, max: 2 }),
        mode: param.i32({ min: 0, max: 4 }),
        flags: param.bool.array({ length: 4 }),
      },
      meters: {
        level: meter.f32(),
        peak: meter.f32(),
      },
    }));

    const plan = planLayout(spec);
    const lines = describeViews(plan);

    expect(lines[0]).toBe('Plane  Kind              Present  Length(B)  Offset');
    expect(lines[1]).toBe('-----  ----------------  -------  ---------  ------');

    const totalLine = lines[lines.length - 1];
    expect(totalLine).toBe(`Total backing bytes: ${String(plan.bytesTotal)}`);

    // sanity: at least one plane is marked present
    expect(lines.some((line) => line.includes('✔'))).toBe(true);
  });
});
