import { defineSpec } from '../../src';

import type { PlaneByteLengths } from '../../src/plan/types';

/**
 * Build a minimal spec from desired plane byte counts.
 * Notes:
 * - Uses only param.f32 / param.i32 (no param.bytes/u32 in your DSL).
 * - Uses meter.f32 / meter.f64 (no meter.u32 dependency).
 * - Guarantees at least one param so planning never rejects an empty spec.
 */
export function specFromPlaneBytes(bytes: PlaneByteLengths) {
  const pf32N = Math.floor(bytes.PF32 / 4);
  const pi32N = Math.floor(bytes.PI32 / 4);

  const mf32N = Math.floor(bytes.MF32 / 4);
  const mf64N = Math.floor(bytes.MF64 / 8);

  const hasAnyParam = pf32N > 0 || pi32N > 0;
  const hasAnyMeter = mf32N > 0 || mf64N > 0;

  return defineSpec(({ param, meter }) => ({
    id: 'from-bytes',
    params: hasAnyParam
      ? {
          ...(pf32N > 0 ? { p_f32: param.f32.array(pf32N) } : {}),
          ...(pi32N > 0 ? { p_i32: param.i32.array(pi32N) } : {}),
        }
      : {
          p_min: param.f32.array(1),
        },
    meters: hasAnyMeter
      ? {
          ...(mf32N > 0 ? { m_f32: meter.f32.array(mf32N) } : {}),
          ...(mf64N > 0 ? { m_f64: meter.f64.array(mf64N) } : {}),
        }
      : {},
  }));
}
