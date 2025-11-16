import type { ParamDef, ScalarParamKeys, SpecInput } from './types';

/**
 * Normalized metadata view over a param definition.
 *
 * @remarks
 * - Covers both scalar and array params.
 * - `values` is only populated for enum / enum.array.
 */
export interface ParamMeta {
  readonly kind: ParamDef['kind'];
  readonly min?: number;
  readonly max?: number;
  readonly length?: number;
  readonly values?: readonly string[];
}

/**
 * Return a normalized metadata view for a param key.
 *
 * This is a spec-level helper; it does not touch bindings or backings.
 *
 * @remarks
 * - Assumes `spec` has passed validation.
 * - Intended for tools / UI generation, not RT hot paths.
 */
export function paramMetaFor(spec: SpecInput, key: string): ParamMeta {
  const params = spec.params as Record<string, ParamDef>;
  const def = params[key];

  if (!def) {
    // Programmer error: using a key that is not present in this spec.
    throw new Error(`Unknown param key "${key}" for this spec`);
  }

  const hasMin = 'min' in def;
  const hasMax = 'max' in def;
  const hasLength = 'length' in def;
  const hasValues = 'values' in def;

  return {
    kind: def.kind,
    ...(hasMin ? { min: def.min } : {}),
    ...(hasMax ? { max: def.max } : {}),
    ...(hasLength ? { length: def.length } : {}),
    ...(hasValues ? { values: def.values } : {}),
  };
}

/**
 * Normalized numeric range for a scalar param.
 *
 * @remarks
 * - Only meaningful for `f32` / `i32` params.
 * - If min/max are not declared in the spec, they remain `undefined`.
 */
export interface ParamRange {
  readonly min: number | undefined;
  readonly max: number | undefined;
}

/**
 * Extract declared numeric range (if any) for a scalar param.
 */
export function paramRangeFor<S extends SpecInput>(
  spec: S,
  key: ScalarParamKeys<S>,
): ParamRange {
  const meta = paramMetaFor(spec, key as string);
  return { min: meta.min, max: meta.max };
}

/**
 * Helper for mapping between [0,1] slider space and the param's numeric range.
 *
 * @remarks
 * - Treats missing min/max as [0,1] purely for mapping.
 * - `step` is derived from param kind: 1 for `i32`, a small fraction for `f32`.
 * - Intended for UI/controllers, not RT hot paths.
 */
export interface RangeMapper {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  fromNormalized(norm: number): number;
  toNormalized(value: number): number;
  clamp(value: number): number;
}

/**
 * Build a RangeMapper for a scalar numeric param.
 */
export function makeRangeMapper<S extends SpecInput>(
  spec: S,
  key: ScalarParamKeys<S>,
): RangeMapper {
  const params = spec.params as Record<string, ParamDef>;
  const def = params[key as string];

  if (!def) {
    // Programmer error: using a key that is not present in this spec.
    throw new Error(`Unknown param key "${key}" for this spec`);
  }

  const range = paramRangeFor(spec, key);

  const lo = range.min ?? 0;
  const hi = range.max ?? 1;
  const span = hi - lo || 1;

  const step = def.kind === 'i32' ? 1 : span / 1000 || 0.001;

  const clamp = (value: number): number => {
    if (value < lo) {
      return lo;
    }
    if (value > hi) {
      return hi;
    }
    return value;
  };

  return {
    min: lo,
    max: hi,
    step,
    fromNormalized(norm: number): number {
      const n = norm < 0 ? 0 : norm > 1 ? 1 : norm;
      return lo + span * n;
    },
    toNormalized(value: number): number {
      if (span === 0) {
        return 0;
      }
      return (value - lo) / span;
    },
    clamp,
  };
}

/**
 * List param keys whose definitions match a given kind.
 *
 * @remarks
 * - `kind` is just a string here; callers can pass `ParamDef['kind']` if they
 *   want stronger typing. We avoid a union with `string` to keep lint happy.
 * - Intended for UI generation and debug tooling.
 */
export function paramsOfKind(spec: SpecInput, kind: string): string[] {
  const params = spec.params as Record<string, ParamDef>;
  const out: string[] = [];

  for (const key of Object.keys(params)) {
    const def = params[key];
    if (!def) {
      continue;
    }
    if (def.kind === kind) {
      out.push(key);
    }
  }

  return out;
}

/**
 * Group params by prefix before a delimiter (default `.`).
 *
 * @example
 * - "osc1.gain", "osc1.detune" → group "osc1"
 * - "lfo.rate" → group "lfo"
 * - "masterGain" (no delimiter) → group "" (empty key)
 *
 * @remarks
 * - Intended for UI layout (sections / accordions).
 */
export function groupParams(spec: SpecInput, delimiter = '.'): Record<string, string[]> {
  const params = spec.params as Record<string, ParamDef>;
  const groups: Record<string, string[]> = {};

  for (const key of Object.keys(params)) {
    const def = params[key];
    if (!def) {
      continue;
    }

    const idx = key.indexOf(delimiter);
    const group = idx === -1 ? '' : key.slice(0, idx);

    const bucket = groups[group] ?? (groups[group] = []);
    bucket.push(key);
  }

  return groups;
}
