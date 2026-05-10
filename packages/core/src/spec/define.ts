/**
 * @fileoverview
 * Spec definition entrypoint.
 *
 * Author-time specs (`SpecAstInput`) are designed to be ergonomic and JSON-friendly:
 * namespaces may be nested and `id` may be omitted. At runtime we normalize into a
 * flat `SpecInput` shape (dot-path keys, validated numeric ranges, deterministic ids,
 * stable defaults).
 *
 * Two things are intentionally “touchy” here:
 * 1) Enum builders must preserve literal tuples (do not refactor overloads into unions).
 * 2) With `exactOptionalPropertyTypes`, optional fields must be omitted (not set to `undefined`).
 */

import { anonymousId } from "./anonymous-id";
import {
  asNonEmpty,
  assertValidateScalarRange,
  createRangeInput,
  isPlainObject,
  parseArrayLen,
} from "./validate";
import { createSpecError } from "../errors/spec";

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

type SpecPlane = "params" | "meters";

type AuthoredPath = readonly string[];

interface PlaneCompileState<TLeaf> {
  readonly plane: SpecPlane;
  readonly leafDefsByCanonicalKey: Map<string, TLeaf>;
  readonly leafSourcePathsByCanonicalKey: Map<string, string[]>;
  readonly namespaceSourcePathsByCanonicalKey: Map<string, string[]>;
}

interface CompiledPlane<TLeaf> {
  readonly byCanonicalKey: Record<string, TLeaf>;
}

const isParamLeafDef = (value: unknown): value is ParamDef => {
  return isLeafDef(value);
};

const isMeterLeafDef = (value: unknown): value is MeterDef => {
  return isLeafDef(value);
};

const canonicalKeyFromPath = (path: AuthoredPath): string => {
  return path.join(".");
};

const toSortedRecord = <T>(input: Map<string, T>): Record<string, T> => {
  const out: Record<string, T> = {};

  for (const key of [...input.keys()].sort()) {
    const value = input.get(key);
    if (value !== undefined) {
      out[key] = value;
    }
  }

  return out;
};

const specKeyForPath = (plane: SpecPlane, path: AuthoredPath): string => {
  const canonicalPath = canonicalKeyFromPath(path);
  return canonicalPath.length > 0
    ? `spec.${plane}.${canonicalPath}`
    : `spec.${plane}`;
};

const clonePath = (path: AuthoredPath): string[] => {
  return [...path];
};

const validateAuthoredSegment = (
  plane: SpecPlane,
  parentPath: AuthoredPath,
  segment: string,
): void => {
  if (segment.length === 0) {
    throw createSpecError("invalidSegment", {
      plane,
      parentPath: clonePath(parentPath),
      offendingSegment: segment,
      reason: "empty-segment",
    });
  }

  if (segment.includes(".")) {
    throw createSpecError("invalidSegment", {
      plane,
      parentPath: clonePath(parentPath),
      offendingSegment: segment,
      reason: "segment-contains-dot",
    });
  }
};

const registerNamespaceNode = <TLeaf>(
  state: PlaneCompileState<TLeaf>,
  canonicalPath: string,
  sourcePath: AuthoredPath,
): void => {
  if (canonicalPath.length === 0) {
    return;
  }

  const existingLeafPath =
    state.leafSourcePathsByCanonicalKey.get(canonicalPath);
  if (existingLeafPath !== undefined) {
    throw createSpecError("leafNamespaceConflict", {
      plane: state.plane,
      canonicalPath,
      leafPath: clonePath(existingLeafPath),
      namespacePath: clonePath(sourcePath),
      conflictKind: "namespace-collides-with-leaf",
    });
  }

  if (!state.namespaceSourcePathsByCanonicalKey.has(canonicalPath)) {
    state.namespaceSourcePathsByCanonicalKey.set(
      canonicalPath,
      clonePath(sourcePath),
    );
  }
};

const assertNoLeafAncestorConflict = <TLeaf>(
  state: PlaneCompileState<TLeaf>,
  canonicalKey: string,
  sourcePath: AuthoredPath,
): void => {
  const segments = canonicalKey.split(".");

  for (let i = 1; i < segments.length; i += 1) {
    const ancestorKey = segments.slice(0, i).join(".");
    const existingLeafPath =
      state.leafSourcePathsByCanonicalKey.get(ancestorKey);

    if (existingLeafPath !== undefined) {
      throw createSpecError("leafNamespaceConflict", {
        plane: state.plane,
        canonicalPath: ancestorKey,
        leafPath: clonePath(existingLeafPath),
        namespacePath: clonePath(sourcePath),
        conflictKind: "ancestor-leaf-blocks-descendant",
      });
    }
  }
};

const registerLeafNode = <TLeaf>(
  state: PlaneCompileState<TLeaf>,
  canonicalKey: string,
  sourcePath: AuthoredPath,
  normalizedLeafDef: TLeaf,
): void => {
  const existingLeafPath =
    state.leafSourcePathsByCanonicalKey.get(canonicalKey);
  if (existingLeafPath !== undefined) {
    throw createSpecError("duplicateCanonicalKey", {
      plane: state.plane,
      canonicalKey,
      firstPath: clonePath(existingLeafPath),
      secondPath: clonePath(sourcePath),
    });
  }

  const existingNamespacePath =
    state.namespaceSourcePathsByCanonicalKey.get(canonicalKey);
  if (existingNamespacePath !== undefined) {
    throw createSpecError("leafNamespaceConflict", {
      plane: state.plane,
      canonicalPath: canonicalKey,
      leafPath: clonePath(sourcePath),
      namespacePath: clonePath(existingNamespacePath),
      conflictKind: "leaf-collides-with-namespace",
    });
  }

  assertNoLeafAncestorConflict(state, canonicalKey, sourcePath);

  state.leafDefsByCanonicalKey.set(canonicalKey, normalizedLeafDef);
  state.leafSourcePathsByCanonicalKey.set(canonicalKey, clonePath(sourcePath));
};

const visitNamespaceNode = <TLeaf>(
  state: PlaneCompileState<TLeaf>,
  path: string[],
  namespaceNode: SpecNamespace<TLeaf>,
  isLeaf: (value: unknown) => value is TLeaf,
  normalizeLeafDef: (key: string, leaf: TLeaf) => TLeaf,
): void => {
  for (const [segment, child] of Object.entries(namespaceNode)) {
    validateAuthoredSegment(state.plane, path, segment);

    const childPath = [...path, segment];
    const canonicalPath = canonicalKeyFromPath(childPath);

    if (!isNamespaceObject(child)) {
      throw createSpecError("builderInvalid", {
        key: specKeyForPath(state.plane, childPath),
        reason: "invalidKind",
      });
    }

    if (isLeaf(child)) {
      const normalizedLeafDef = normalizeLeafDef(canonicalPath, child);
      registerLeafNode(state, canonicalPath, childPath, normalizedLeafDef);
      continue;
    }

    registerNamespaceNode(state, canonicalPath, childPath);
    visitNamespaceNode(state, childPath, child, isLeaf, normalizeLeafDef);
  }
};

const compilePlane = <TLeaf>(
  plane: SpecPlane,
  root: SpecNamespace<TLeaf> | undefined,
  isLeaf: (value: unknown) => value is TLeaf,
  normalizeLeafDef: (key: string, leaf: TLeaf) => TLeaf,
): CompiledPlane<TLeaf> => {
  const state: PlaneCompileState<TLeaf> = {
    plane,
    leafDefsByCanonicalKey: new Map<string, TLeaf>(),
    leafSourcePathsByCanonicalKey: new Map<string, string[]>(),
    namespaceSourcePathsByCanonicalKey: new Map<string, string[]>(),
  };

  if (root !== undefined) {
    visitNamespaceNode(state, [], root, isLeaf, normalizeLeafDef);
  }

  return {
    byCanonicalKey: toSortedRecord(state.leafDefsByCanonicalKey),
  };
};

const normalizeParamDef = (key: string, def: ParamDef): ParamDef => {
  const context = `spec.params.${key}`;

  if (def.kind === "f32") {
    return {
      kind: "f32",
      ...normalizeRange(def, DEFAULT_F32_RANGE, context),
    };
  }

  if (def.kind === "i32") {
    return {
      kind: "i32",
      ...normalizeRange(def, DEFAULT_I32_RANGE, context, { integer: true }),
    };
  }

  if (def.kind === "u32") {
    return {
      kind: "u32",
      ...normalizeRange(def, DEFAULT_U32_RANGE, context, {
        integer: true,
        unsigned: true,
      }),
    };
  }

  return def;
};

const normalizeMeterDef = (_key: string, def: MeterDef): MeterDef => {
  return def;
};

/**
 * Converts authored spec input into the normalized runtime `SpecInput`.
 *
 * With `exactOptionalPropertyTypes`, empty plane objects must be omitted rather
 * than attached as optional properties. Anonymous specs receive a deterministic
 * generated id derived from canonical compiled content.
 */
const normalizeAst = (ast: SpecAstInput): SpecInput => {
  const compiledParams = compilePlane(
    "params",
    ast.params,
    isParamLeafDef,
    normalizeParamDef,
  );
  const compiledMeters = compilePlane(
    "meters",
    ast.meters,
    isMeterLeafDef,
    normalizeMeterDef,
  );

  const paramsOut = compiledParams.byCanonicalKey;
  const metersOut = compiledMeters.byCanonicalKey;

  const result: {
    id: string;
    params?: typeof paramsOut;
    meters?: typeof metersOut;
  } = {
    id:
      ast.id ??
      anonymousId({
        params: paramsOut,
        meters: metersOut,
      }),
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
