/**
 * @fileoverview
 * Spec definition entrypoint.
 *
 * Author-time specs (`SpecAstInput`) are designed to be ergonomic and JSON-friendly:
 * namespaces may be nested and `id` may be omitted. At runtime we normalize into a
 * flat `SpecInput` shape (dot-path keys, validated numeric ranges, stable defaults).
 *
 * Two things are intentionally “touchy” here:
 * 1) Enum builders must preserve literal tuples (do not refactor overloads into unions).
 * 2) With `exactOptionalPropertyTypes`, optional fields must be omitted (not set to `undefined`).
 */

import {
  asNonEmpty,
  assertValidateScalarRange,
  createRangeInput,
  isPlainObject,
  parseArrayLen,
} from "./validate";

import type {
  MeterDef,
  ParamDef,
  ResolvedSpec,
  ScalarRange,
  SpecAstInput,
  SpecInput,
  SpecNamespace,
} from "./types";

/*
 * Constants and Helpers
 */

type LenArg<Len extends number> = Len | Readonly<{ length: Len }>;
type ScalarRangeDefaults = Readonly<{ min: number; max: number }>;

const F32_MAX = 3.4028234663852886e38;

const DEFAULT_F32_RANGE: ScalarRangeDefaults = { min: -F32_MAX, max: F32_MAX };
const DEFAULT_I32_RANGE: ScalarRangeDefaults = {
  min: -2147483648,
  max: 2147483647,
};
const DEFAULT_U32_RANGE: ScalarRangeDefaults = { min: 0, max: 4294967295 };

/**
 * Internal range-validation switches used during normalization.
 */
type RangeValidateOpts = Readonly<{
  integer?: boolean;
  unsigned?: boolean;
}>;

/**
 * Applies defaults, normalizes, then validates a scalar range.
 *
 * @remarks
 * `context` is included in spec errors and should be stable and human-readable.
 */
const normalizeRange = (
  input: ScalarRange | undefined,
  defaults: ScalarRangeDefaults,
  context: string,
  opts: RangeValidateOpts = {},
): ScalarRangeDefaults => {
  const min = input?.min ?? defaults.min;
  const max = input?.max ?? defaults.max;

  const range = createRangeInput(min, max);

  const validateOpts = {
    ...(opts.integer === true ? { integer: true } : {}),
    ...(opts.unsigned === true ? { unsigned: true } : {}),
  };

  assertValidateScalarRange(context, range, validateOpts);

  return { min: range.min, max: range.max };
};

const makeLen = (length: LenArg<number>, context: string): number => {
  return parseArrayLen(length, context);
};

const isArray = (value: unknown): value is readonly unknown[] => {
  return Array.isArray(value);
};

const isNamespaceObject = (
  value: unknown,
): value is Record<string, unknown> => {
  return isPlainObject(value);
};

const isLeafDef = (value: unknown): value is { kind: string } => {
  if (!isNamespaceObject(value)) {
    return false;
  }
  return typeof value.kind === "string";
};

/*
 * Builder Type Definitions
 */

interface NumericBuilder<K extends string, KArr extends string> {
  (): Readonly<{ kind: K }>;
  <const R extends ScalarRange>(range: R): Readonly<{ kind: K } & R>;
  array<const Len extends number>(
    length: LenArg<Len>,
  ): Readonly<{ kind: KArr; length: Len }>;
}

export type F32ParamBuilder = NumericBuilder<"f32", "f32.array">;
export type I32ParamBuilder = NumericBuilder<"i32", "i32.array">;
export type U32ParamBuilder = NumericBuilder<"u32", "u32.array">;

export interface BoolParamBuilder {
  (): Readonly<{ kind: "bool" }>;
  array<const Len extends number>(
    length: LenArg<Len>,
  ): Readonly<{ kind: "bool.array"; length: Len }>;
}

interface SimpleArrayBuilder<K extends string> {
  array<const Len extends number>(
    length: LenArg<Len>,
  ): Readonly<{ kind: K; length: Len }>;
}

export type BytesParamBuilder = SimpleArrayBuilder<"u8.array">;
export type I8ParamBuilder = SimpleArrayBuilder<"i8.array">;
export type I16ParamBuilder = SimpleArrayBuilder<"i16.array">;
export type U16ParamBuilder = SimpleArrayBuilder<"u16.array">;

/**
 * Enum overload preservation note.
 *
 * @remarks
 * Do not combine the enum overloads into a union parameter.
 * ESLint may suggest this via `@typescript-eslint/unified-signatures`, but the
 * union form frequently causes TypeScript to widen literal tuples to
 * `readonly string[]`, breaking downstream inference and type tests.
 *
 * Keep the overloads, suppress the lint rule on the object-form overload.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type EnumOverloadPreservationNote = never;

/**
 * Enum parameter builder.
 *
 * @remarks
 * {@link EnumOverloadPreservationNote}
 */
export interface EnumParamBuilder {
  <const Values extends readonly string[]>(
    values: Values,
  ): Readonly<{ kind: "enum"; values: Values }>;

  <const Values extends readonly string[]>(
    // eslint-disable-next-line @typescript-eslint/unified-signatures
    config: Readonly<{ values: Values }>,
  ): Readonly<{ kind: "enum"; values: Values }>;

  array<const Values extends readonly string[], const Len extends number>(
    opts: Readonly<{ values: Values; length: LenArg<Len> }>,
  ): Readonly<{ kind: "enum.array"; values: Values; length: Len }>;
}

/**
 * Enum meter builder.
 *
 * @remarks
 * {@link EnumOverloadPreservationNote}
 */
export interface MeterEnumBuilder {
  <const Values extends readonly string[]>(
    values: Values,
  ): Readonly<{ kind: "enum"; values: Values }>;

  <const Values extends readonly string[]>(
    // eslint-disable-next-line @typescript-eslint/unified-signatures
    config: Readonly<{ values: Values }>,
  ): Readonly<{ kind: "enum"; values: Values }>;

  array<const Values extends readonly string[], const Len extends number>(
    opts: Readonly<{ values: Values; length: LenArg<Len> }>,
  ): Readonly<{ kind: "enum.array"; values: Values; length: Len }>;
}

export type ParamBuilders = Readonly<{
  f32: F32ParamBuilder;
  i32: I32ParamBuilder;
  u32: U32ParamBuilder;
  bool: BoolParamBuilder;
  u8: BytesParamBuilder;
  i8: I8ParamBuilder;
  i16: I16ParamBuilder;
  u16: U16ParamBuilder;
  enum: EnumParamBuilder;
}>;

interface MeterNumericBuilder<K extends string, KArr extends string> {
  (): Readonly<{ kind: K }>;
  array<const Len extends number>(
    length: LenArg<Len>,
  ): Readonly<{ kind: KArr; length: Len }>;
}

export type MeterF32Builder = MeterNumericBuilder<"f32", "f32.array">;
export type MeterF64Builder = MeterNumericBuilder<"f64", "f64.array">;
export type MeterI32Builder = MeterNumericBuilder<"i32", "i32.array">;
export type MeterU32Builder = MeterNumericBuilder<"u32", "u32.array">;

/**
 * Meter bool builder (includes `.array(...)`).
 */
export interface MeterBoolBuilder {
  (): Readonly<{ kind: "bool" }>;
  array<const Len extends number>(
    length: LenArg<Len>,
  ): Readonly<{ kind: "bool.array"; length: Len }>;
}

export type MeterBuilders = Readonly<{
  f32: MeterF32Builder;
  f64: MeterF64Builder;
  i32: MeterI32Builder;
  u32: MeterU32Builder;
  bool: MeterBoolBuilder;
  enum: MeterEnumBuilder;
}>;

/*
 * Builder Implementations
 */

const createNumericParam = <K extends string, KArr extends string>(
  kind: K,
  arrayKind: KArr,
): NumericBuilder<K, KArr> => {
  function scalar(): Readonly<{ kind: K }>;
  function scalar<const R extends ScalarRange>(
    range: R,
  ): Readonly<{ kind: K } & R>;
  function scalar<const R extends ScalarRange>(range?: R) {
    if (range == null) {
      return { kind } as Readonly<{ kind: K }>;
    }
    return { kind, ...range } as Readonly<{ kind: K } & R>;
  }

  const array = <const Len extends number>(length: LenArg<Len>) =>
    ({
      kind: arrayKind,
      length: makeLen(length, `param.${arrayKind}.length`),
    }) as Readonly<{ kind: KArr; length: Len }>;

  return Object.assign(scalar, { array });
};

const createBoolParam = (): BoolParamBuilder => {
  const scalar = () => ({ kind: "bool" as const });

  const array = <const Len extends number>(length: LenArg<Len>) =>
    ({
      kind: "bool.array" as const,
      length: makeLen(length, "param.bool.array.length"),
    }) as Readonly<{ kind: "bool.array"; length: Len }>;

  return Object.assign(scalar, { array });
};

/**
 * Bool meter builder with `.array(...)`.
 */
const createBoolMeter = (): MeterBoolBuilder => {
  const scalar = () => ({ kind: "bool" as const });

  const array = <const Len extends number>(length: LenArg<Len>) =>
    ({
      kind: "bool.array" as const,
      length: makeLen(length, "meter.bool.array.length"),
    }) as Readonly<{ kind: "bool.array"; length: Len }>;

  return Object.assign(scalar, { array });
};

const createSimpleArrayParam = <K extends string>(
  kind: K,
): SimpleArrayBuilder<K> => ({
  array: <const Len extends number>(length: LenArg<Len>) =>
    ({
      kind,
      length: makeLen(length, `param.${kind}.length`),
    }) as Readonly<{ kind: K; length: Len }>,
});

/**
 * Runtime implementation for enum builders.
 *
 * @remarks
 * The overloads that preserve literal inference live on the public interfaces
 * (`EnumParamBuilder` / `MeterEnumBuilder`). This function keeps the runtime code
 * single-path while still benefiting from those interface types at call sites.
 */
const createEnumBuilder = (scope: "param" | "meter") => {
  const scalar = <const Values extends readonly string[]>(
    valuesOrOpts: Values | Readonly<{ values: Values }>,
  ): Readonly<{ kind: "enum"; values: Values }> => {
    const values: Values = isArray(valuesOrOpts)
      ? valuesOrOpts
      : valuesOrOpts.values;

    return {
      kind: "enum" as const,
      values: asNonEmpty(values, `${scope}.enum.values`),
    };
  };

  const array = <
    const Values extends readonly string[],
    const Len extends number,
  >(
    opts: Readonly<{ values: Values; length: LenArg<Len> }>,
  ) =>
    ({
      kind: "enum.array" as const,
      values: asNonEmpty(opts.values, `${scope}.enum.array.values`),
      length: makeLen(opts.length, `${scope}.enum.array.length`),
    }) as Readonly<{ kind: "enum.array"; values: Values; length: Len }>;

  return Object.assign(scalar, { array });
};

const paramBuilder: ParamBuilders = {
  f32: createNumericParam("f32", "f32.array"),
  i32: createNumericParam("i32", "i32.array"),
  u32: createNumericParam("u32", "u32.array"),
  bool: createBoolParam(),
  u8: createSimpleArrayParam("u8.array"),
  i8: createSimpleArrayParam("i8.array"),
  i16: createSimpleArrayParam("i16.array"),
  u16: createSimpleArrayParam("u16.array"),
  enum: createEnumBuilder("param"),
};

const createNumericMeter = <K extends string, KArr extends string>(
  kind: K,
  arrayKind: KArr,
): MeterNumericBuilder<K, KArr> => {
  const scalar = () => ({ kind });

  const array = <const Len extends number>(length: LenArg<Len>) =>
    ({
      kind: arrayKind,
      length: makeLen(length, `meter.${arrayKind}.length`),
    }) as Readonly<{ kind: KArr; length: Len }>;

  return Object.assign(scalar, { array });
};

const meterBuilder: MeterBuilders = {
  f32: createNumericMeter("f32", "f32.array"),
  f64: createNumericMeter("f64", "f64.array"),
  i32: createNumericMeter("i32", "i32.array"),
  u32: createNumericMeter("u32", "u32.array"),
  bool: createBoolMeter(),
  enum: createEnumBuilder("meter"),
};

/*
 * Runtime Normalization
 */

/**
 * Flattens a nested namespace object into dot-path keys.
 *
 * @remarks
 * Leaf nodes are detected by the presence of a string `kind` field.
 * If authors create ambiguous shapes (a namespace and a leaf sharing a key path),
 * later entries win by object iteration order.
 */
const flattenNamespace = <T>(
  ns: SpecNamespace<T>,
  prefix: string,
  out: Record<string, T>,
): void => {
  for (const [key, value] of Object.entries(ns)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (isNamespaceObject(value) && !isLeafDef(value)) {
      flattenNamespace(value, fullKey, out);
    } else {
      out[fullKey] = value as T;
    }
  }
};

/**
 * Normalizes numeric scalar parameters in-place.
 *
 * @remarks
 * Only parameter scalars carry `{ min, max }`. Meters do not have ranges.
 */
const normalizeNumericParamsInPlace = (
  params: Record<string, ParamDef>,
): void => {
  for (const [key, def] of Object.entries(params)) {
    const context = `spec.params.${key}`;

    if (def.kind === "f32") {
      params[key] = {
        kind: "f32",
        ...normalizeRange(def, DEFAULT_F32_RANGE, context),
      };
      continue;
    }

    if (def.kind === "i32") {
      params[key] = {
        kind: "i32",
        ...normalizeRange(def, DEFAULT_I32_RANGE, context, { integer: true }),
      };
      continue;
    }

    if (def.kind === "u32") {
      params[key] = {
        kind: "u32",
        ...normalizeRange(def, DEFAULT_U32_RANGE, context, {
          integer: true,
          unsigned: true,
        }),
      };
    }
  }
};

/**
 * Converts `SpecAstInput` into the normalized runtime `SpecInput`.
 *
 * @remarks
 * With `exactOptionalPropertyTypes`, empty objects must not be attached as optional
 * properties. We only attach `params`/`meters` when non-empty.
 */
const normalizeAst = (ast: SpecAstInput): SpecInput => {
  const paramsOut: Record<string, ParamDef> = {};
  const metersOut: Record<string, MeterDef> = {};

  if (ast.params) {
    flattenNamespace(ast.params, "", paramsOut);
  }
  if (ast.meters) {
    flattenNamespace(ast.meters, "", metersOut);
  }

  if (Object.keys(paramsOut).length > 0) {
    normalizeNumericParamsInPlace(paramsOut);
  }

  const result: {
    id: string;
    params?: typeof paramsOut;
    meters?: typeof metersOut;
  } = {
    id: ast.id ?? "spec",
  };

  if (Object.keys(paramsOut).length > 0) {
    result.params = paramsOut;
  }
  if (Object.keys(metersOut).length > 0) {
    result.meters = metersOut;
  }

  return result as SpecInput;
};

/*
 * Public API
 */

/**
 * Defines a spec from either an AST object or a builder callback.
 *
 * @remarks
 * The return type is `ResolvedSpec<T>` to reflect the AST → normalized transformation:
 * - namespaces are flattened
 * - numeric ranges are validated and defaulted
 * - optional properties are omitted when empty
 */
export function defineSpec<const T extends SpecAstInput>(
  buildOrAst:
    | T
    | ((api: Readonly<{ param: ParamBuilders; meter: MeterBuilders }>) => T),
): ResolvedSpec<T> {
  if (typeof buildOrAst === "function") {
    const ast = buildOrAst({ param: paramBuilder, meter: meterBuilder });
    return normalizeAst(ast) as ResolvedSpec<T>;
  }

  return normalizeAst(buildOrAst) as ResolvedSpec<T>;
}
