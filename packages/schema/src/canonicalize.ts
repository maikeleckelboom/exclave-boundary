/**
 * @fileoverview
 * Public owner of AST-to-canonical spec canonicalization.
 */

import { generateAnonymousSpecId } from "./canonical-hash";
import { compilePlane, isLeafDef } from "./collapse";
import { createSchemaError } from "./errors/schema";
import { validateSpecAst } from "./validate";

import type { ParamDef, MeterDef, SpecAstInput } from "./ast";
import type { CanonicalSpec } from "./canonical";

const F32_MAX = 3.4028234663852886e38;
const DEFAULT_F32_RANGE: Readonly<{ min: number; max: number }> = {
  min: -F32_MAX,
  max: F32_MAX,
};
const DEFAULT_I32_RANGE: Readonly<{ min: number; max: number }> = {
  min: -2147483648,
  max: 2147483647,
};
const DEFAULT_U32_RANGE: Readonly<{ min: number; max: number }> = {
  min: 0,
  max: 4294967295,
};

function asFiniteNumber(key: string, value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Number.isNaN(value)
  ) {
    throw createSchemaError("invalidDefinition", {
      key,
      reason: value === undefined ? "missingMinMax" : "invalidKind",
    });
  }
  return value;
}

function validateScalarRange(
  key: string,
  range: { min: number; max: number },
  opts: { integer?: boolean; unsigned?: boolean } = {},
): void {
  const { min, max } = range;
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    Number.isNaN(min) ||
    Number.isNaN(max)
  ) {
    throw createSchemaError("rangeInvalid", { key, min, max });
  }
  if (!(min < max)) {
    throw createSchemaError("rangeInvalid", { key, min, max });
  }
  if (opts.integer) {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw createSchemaError("rangeInvalid", { key, min, max });
    }
  }
  if (opts.unsigned) {
    if (min < 0 || max < 0) {
      throw createSchemaError("rangeInvalid", { key, min, max });
    }
  }
}

function normalizeRange(
  input: { min?: number; max?: number } | undefined,
  defaults: { min: number; max: number },
  context: string,
  opts: { integer?: boolean; unsigned?: boolean } = {},
): { min: number; max: number } {
  const min = input?.min ?? defaults.min;
  const max = input?.max ?? defaults.max;
  const range = {
    min: asFiniteNumber(context, min),
    max: asFiniteNumber(context, max),
  };
  validateScalarRange(context, range, opts);
  return range;
}

function cloneParamDef(def: ParamDef): ParamDef {
  const base: Record<string, unknown> = { kind: def.kind };
  if ("length" in def) {
    base.length = def.length;
  }
  if ("values" in def) {
    base.values = [...def.values];
  }
  if ("min" in def) {
    base.min = def.min;
  }
  if ("max" in def) {
    base.max = def.max;
  }
  return base as ParamDef;
}

function cloneMeterDef(def: MeterDef): MeterDef {
  const base: Record<string, unknown> = { kind: def.kind };
  if ("length" in def) {
    base.length = def.length;
  }
  if ("values" in def) {
    base.values = [...def.values];
  }
  return base as MeterDef;
}

function normalizeParamDef(key: string, def: ParamDef): ParamDef {
  const cloned = cloneParamDef(def);
  const context = `params.${key}`;
  switch (cloned.kind) {
    case "f32":
      return {
        kind: "f32",
        ...normalizeRange(
          def as { min?: number; max?: number },
          DEFAULT_F32_RANGE,
          context,
        ),
      };
    case "i32":
      return {
        kind: "i32",
        ...normalizeRange(
          def as { min?: number; max?: number },
          DEFAULT_I32_RANGE,
          context,
          { integer: true },
        ),
      };
    case "u32":
      return {
        kind: "u32",
        ...normalizeRange(
          def as { min?: number; max?: number },
          DEFAULT_U32_RANGE,
          context,
          {
            integer: true,
            unsigned: true,
          },
        ),
      };
    default:
      return cloned;
  }
}

function normalizeMeterDef(_key: string, def: MeterDef): MeterDef {
  return cloneMeterDef(def);
}

/**
 * Canonicalize an authored spec AST into the canonical flat spec.
 *
 * - Validates structure
 * - Flattens namespaces
 * - Fills default scalar ranges
 * - Generates deterministic anonymous id when omitted
 * - Omits empty planes
 */
export function canonicalizeSpecAst(ast: SpecAstInput): CanonicalSpec {
  validateSpecAst(ast);

  const compiledParams = compilePlane(
    "params",
    ast.params,
    isLeafDef as (value: unknown) => value is ParamDef,
    normalizeParamDef,
  );
  const compiledMeters = compilePlane(
    "meters",
    ast.meters,
    isLeafDef as (value: unknown) => value is MeterDef,
    normalizeMeterDef,
  );

  const paramsOut = compiledParams.byCanonicalKey;
  const metersOut = compiledMeters.byCanonicalKey;

  const result: {
    id: string;
    params?: Record<string, ParamDef>;
    meters?: Record<string, MeterDef>;
  } = {
    id: ast.id ?? generateAnonymousSpecId(paramsOut, metersOut),
  };

  if (Object.keys(paramsOut).length > 0) {
    result.params = paramsOut;
  }
  if (Object.keys(metersOut).length > 0) {
    result.meters = metersOut;
  }

  return result as CanonicalSpec;
}
