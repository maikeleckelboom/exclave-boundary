import type { MeterDef, ParamDef, SpecHash, SpecInput } from './types';

/**
 * FNV-1a 64-bit, encoded as lowercase base36.
 *
 * @remarks
 * Not cryptographic. Intended for spec fingerprints and cache keys.
 */
function fnv1aHash(input: string): string {
  let offsetBasis = 0xcbf29ce484222325n;
  const fnvPrime = 0x100000001b3n;

  for (let i = 0; i < input.length; i++) {
    offsetBasis ^= BigInt(input.charCodeAt(i) & 0xff);
    offsetBasis = (offsetBasis * fnvPrime) & 0xffffffffffffffffn;
  }

  return offsetBasis.toString(36);
}

function canonicalizeParam(def: ParamDef) {
  switch (def.kind) {
    case 'f32':
    case 'i32': {
      const hasMin = 'min' in def;
      const hasMax = 'max' in def;

      if (hasMin && hasMax) {
        return { kind: def.kind, min: def.min, max: def.max };
      }

      if (hasMin) {
        return { kind: def.kind, min: def.min };
      }

      if (hasMax) {
        return { kind: def.kind, max: def.max };
      }

      return { kind: def.kind };
    }

    case 'bool':
      return { kind: def.kind };

    case 'enum':
      // Values-order matters, so we preserve order
      return { kind: def.kind, values: [...def.values] };

    case 'f32.array':
    case 'i32.array':
    case 'bool.array':
      return { kind: def.kind, length: def.length };

    case 'enum.array':
      return {
        kind: def.kind,
        length: def.length,
        values: [...def.values],
      };
  }
}

function canonicalizeMeter(def: MeterDef) {
  switch (def.kind) {
    case 'f32':
    case 'f64':
    case 'u32':
    case 'bool':
      return { kind: def.kind };

    case 'f32.array':
    case 'f64.array':
    case 'bool.array':
    case 'u32.array':
      return { kind: def.kind, length: def.length };
  }
}

/**
 * Returns sorted `[key, value]` tuples without generics or non-null assertions.
 */
function sortedEntries(
  obj?: Readonly<Record<string, unknown>>,
): readonly (readonly [string, unknown])[] {
  if (!obj) {
    return [];
  }

  const keys = Object.keys(obj).sort();
  const out: (readonly [string, unknown])[] = [];

  for (const k of keys) {
    out.push([k, obj[k]]);
  }

  return out;
}

/**
 * Canonical structural representation of a spec.
 *
 * @remarks
 * - Ignores `spec.id` on purpose.
 * - Includes:
 *   - param keys and canonical param shape (kind, min/max, length, enum values)
 *   - meter keys and canonical meter shape (kind, length)
 * - Order of object properties is normalized via sorted keys.
 */
function canonicalizeSpec(spec: SpecInput): string {
  const params = sortedEntries(spec.params).map(([key, value]) => [
    key,
    canonicalizeParam(value as ParamDef),
  ]);

  const meters = sortedEntries(spec.meters).map(([key, value]) => [
    key,
    canonicalizeMeter(value as MeterDef),
  ]);

  // Note: we deliberately do *not* include `spec.id` here.
  return JSON.stringify({ params, meters });
}

/**
 * Stable structural hash for a spec.
 *
 * @remarks
 * - Does not include `spec.id` (renaming a spec does not break compatibility).
 * - Keys are sorted for determinism.
 * - Arrays include only length and, for enums, the ordered values.
 * - FNV-1a 64 over canonical JSON, encoded as base36.
 */
export function hashSpec(spec: SpecInput): SpecHash {
  const canonical = canonicalizeSpec(spec);
  return fnv1aHash(canonical);
}
