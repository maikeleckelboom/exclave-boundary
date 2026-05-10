import type { MeterDef, ParamDef, SpecHash, SpecInput } from "./types";

type HashableSpecContent = Readonly<{
  id?: string;
  params?: Readonly<Record<string, ParamDef>>;
  meters?: Readonly<Record<string, MeterDef>>;
}>;

const F32_MAX = 3.4028234663852886e38;

const DEFAULT_F32_RANGE = { min: -F32_MAX, max: F32_MAX } as const;
const DEFAULT_I32_RANGE = { min: -2147483648, max: 2147483647 } as const;
const DEFAULT_U32_RANGE = { min: 0, max: 4294967295 } as const;

/**
 * Canonicalizes a parameter definition for stable hashing.
 *
 * Missing numeric bounds are filled with runtime defaults so authored omission
 * and compiled meaning hash identically.
 */
function canonParam(def: ParamDef): ParamDef {
  switch (def.kind) {
    case "f32":
      return {
        kind: "f32",
        min: def.min ?? DEFAULT_F32_RANGE.min,
        max: def.max ?? DEFAULT_F32_RANGE.max,
      };

    case "i32":
      return {
        kind: "i32",
        min: def.min ?? DEFAULT_I32_RANGE.min,
        max: def.max ?? DEFAULT_I32_RANGE.max,
      };

    case "u32":
      return {
        kind: "u32",
        min: def.min ?? DEFAULT_U32_RANGE.min,
        max: def.max ?? DEFAULT_U32_RANGE.max,
      };

    case "enum":
      return {
        kind: "enum",
        values: [...def.values],
      };

    case "enum.array":
      return {
        kind: "enum.array",
        values: [...def.values],
        length: def.length,
      };

    default:
      return def;
  }
}

/**
 * Canonicalizes a meter definition for stable hashing.
 */
function canonMeter(def: MeterDef): MeterDef {
  switch (def.kind) {
    case "enum":
      return {
        kind: "enum",
        values: [...def.values],
      };

    case "enum.array":
      return {
        kind: "enum.array",
        values: [...def.values],
        length: def.length,
      };

    default:
      return def;
  }
}

/**
 * Canonicalizes hash input by:
 * - normalizing param and meter leaf definitions
 * - omitting empty planes
 * - retaining `id` only when the caller includes it
 */
function canonSpecContent(content: HashableSpecContent): HashableSpecContent {
  const paramsIn = content.params ?? {};
  const metersIn = content.meters ?? {};

  const params: Record<string, ParamDef> = {};
  for (const [key, def] of Object.entries(paramsIn)) {
    params[key] = canonParam(def);
  }

  const meters: Record<string, MeterDef> = {};
  for (const [key, def] of Object.entries(metersIn)) {
    meters[key] = canonMeter(def);
  }

  const result: {
    id?: string;
    params?: Record<string, ParamDef>;
    meters?: Record<string, MeterDef>;
  } = {};

  if (content.id !== undefined) {
    result.id = content.id;
  }

  if (Object.keys(params).length > 0) {
    result.params = params;
  }

  if (Object.keys(meters).length > 0) {
    result.meters = meters;
  }

  return result;
}

/**
 * Stable JSON stringification with sorted object keys.
 *
 * Array order is preserved intentionally because enum vocabulary order remains
 * identity-significant.
 */
function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`,
    );
    return `{${entries.join(",")}}`;
  }

  return "null";
}

/**
 * Small deterministic 64-bit mix without a BigInt dependency.
 */
function mix64(
  seedHi: number,
  seedLo: number,
  data: string,
): Readonly<{ hi: number; lo: number }> {
  let h1 = seedHi >>> 0;
  let h2 = seedLo >>> 0;

  for (let index = 0; index < data.length; index += 1) {
    const code = data.charCodeAt(index) >>> 0;
    h1 = Math.imul(h1 ^ code, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ code, 0xc2b2ae35) >>> 0;
    h1 = (h1 ^ (h1 >>> 13)) >>> 0;
    h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  }

  return { hi: h1 >>> 0, lo: h2 >>> 0 };
}

function hashCanonicalPayload(content: HashableSpecContent): string {
  const canonical = canonSpecContent(content);
  const json = stableStringify(canonical);
  const mixed = mix64(0x12345678, 0x9abcdef0, json);

  const hi = mixed.hi.toString(16).padStart(8, "0");
  const lo = mixed.lo.toString(16).padStart(8, "0");

  return `${hi}${lo}`;
}

/**
 * Hashes canonical compiled spec content while excluding `id`.
 *
 * This is the correct entry point for anonymous authored spec identity.
 */
export function hashCanonicalSpecContent(
  content: Readonly<{
    params?: Readonly<Record<string, ParamDef>>;
    meters?: Readonly<Record<string, MeterDef>>;
  }>,
): string {
  return hashCanonicalPayload(content);
}

/**
 * Hashes the full spec identity, including `id`.
 */
export function hashSpec(spec: SpecInput): SpecHash {
  return hashCanonicalPayload(spec) as SpecHash;
}
