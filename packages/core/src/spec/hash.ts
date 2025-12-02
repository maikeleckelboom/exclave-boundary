/**
 * @fileoverview
 * Hashing utilities for spec definitions.
 *
 * @remarks
 * - Implements FNV-1a 64-bit hashing for spec fingerprints.
 * - Provides canonicalization for deterministic hashing of equivalent specs.
 * - Used for versioning, cache keys, and change detection.
 */

import type { MeterDef, ParamDef, SpecHash, SpecInput } from "./types";

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
    case "f32":
    case "i32": {
      const hasMin = "min" in def;
      const hasMax = "max" in def;

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

    case "bool":
      return { kind: def.kind };

    case "enum":
      // Values-order matters, so we preserve order
      return { kind: def.kind, values: [...def.values] };

    case "f32.array":
    case "i32.array":
    case "bool.array":
      return { kind: def.kind, length: def.length };

    case "enum.array":
      return {
        kind: def.kind,
        length: def.length,
        values: [...def.values],
      };
  }
}

function canonicalizeMeter(def: MeterDef) {
  switch (def.kind) {
    case "f32":
    case "f64":
    case "u32":
    case "bool":
      return { kind: def.kind };

    case "f32.array":
    case "f64.array":
    case "bool.array":
    case "u32.array":
      return { kind: def.kind, length: def.length };
  }
}

/**
 * Returns sorted `[key, value]` tuples without relying on object property order.
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
 * Deterministic stringification for canonical spec / plan structures.
 *
 * @remarks
 * - Recursively sorts object keys to avoid engine-dependent ordering.
 * - Preserves array order.
 * - Assumes input is a plain data tree (no functions, Symbols, etc.).
 */
function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }

  const t = typeof value;

  if (t === "number" || t === "boolean") {
    return JSON.stringify(value);
  }

  if (t === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const inner = value.map((item) => stableStringify(item));
    return `[${inner.join(",")}]`;
  }

  if (t === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];

    for (const key of keys) {
      const v = record[key];
      parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
    }

    return `{${parts.join(",")}}`;
  }

  // Fallback – should not be reached for well-formed SpecInput trees.
  return "null";
}

/**
 * Canonical structural representation of a spec as a pure data tree.
 *
 * @remarks
 * - Ignores `spec.id` on purpose.
 * - Includes:
 *   - param keys and canonical param shape (kind, min/max, length, enum values)
 *   - meter keys and canonical meter shape (kind, length)
 */
function canonicalizeSpecObject(spec: SpecInput): {
  params: Record<string, unknown>;
  meters: Record<string, unknown>;
} {
  const params: Record<string, unknown> = {};
  const meters: Record<string, unknown> = {};

  const paramEntries = sortedEntries(spec.params);
  for (const [key, value] of paramEntries) {
    params[key] = canonicalizeParam(value as ParamDef);
  }

  const meterEntries = sortedEntries(spec.meters);
  for (const [key, value] of meterEntries) {
    meters[key] = canonicalizeMeter(value as MeterDef);
  }

  return { params, meters };
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
  const tree = canonicalizeSpecObject(spec);
  const canonical = stableStringify(tree);
  return fnv1aHash(canonical);
}

/**
 * Canonical spec source for dev-mode introspect and handoff debugging.
 *
 * @remarks
 * Intended for use in `_debugSource` fields on handoff payloads and for
 * deep structural comparisons in development builds.
 */
export function getCanonicalSpecSource(spec: SpecInput): string {
  const tree = canonicalizeSpecObject(spec);
  return stableStringify(tree);
}
