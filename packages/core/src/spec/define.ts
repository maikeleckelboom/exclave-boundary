/**
 * @fileoverview
 * Spec definition DSL and type-safe builders.
 *
 * @remarks
 * - Provides `defineSpec()` for declaring params and meters with type inference.
 * - Builders preserve literal types and array lengths for precise type checking.
 * - Handles validation of min/max ranges and enum values at definition time.
 */

import {
  asNonEmpty,
  assertValidateScalarRange,
  createRangeInput,
  isPlainObject,
  parseArrayLen,
} from "./validate";

import type { SpecInput } from "./types";
import type { ScalarRangeInput } from "./validate";

/**
 * Scalar param builders.
 *
 * Overloads capture literal min/max so `typeof spec` can see them, while
 * still being assignable to the wider ScalarParamDef (`min?: number`, etc.).
 */
interface F32Builder {
  (): { readonly kind: "f32" };

  <TMin extends number>(range: {
    readonly min: TMin;
  }): {
    readonly kind: "f32";
    readonly min: TMin;
  };

  <TMax extends number>(range: {
    readonly max: TMax;
  }): {
    readonly kind: "f32";
    readonly max: TMax;
  };

  <TMin extends number, TMax extends number>(range: {
    readonly min: TMin;
    readonly max: TMax;
  }): {
    readonly kind: "f32";
    readonly min: TMin;
    readonly max: TMax;
  };

  array<TLen extends number>(
    length: TLen | { readonly length: TLen },
  ): {
    readonly kind: "f32.array";
    readonly length: TLen;
  };
}

interface I32Builder {
  (): { readonly kind: "i32" };

  <TMin extends number>(range: {
    readonly min: TMin;
  }): {
    readonly kind: "i32";
    readonly min: TMin;
  };

  <TMax extends number>(range: {
    readonly max: TMax;
  }): {
    readonly kind: "i32";
    readonly max: TMax;
  };

  <TMin extends number, TMax extends number>(range: {
    readonly min: TMin;
    readonly max: TMax;
  }): {
    readonly kind: "i32";
    readonly min: TMin;
    readonly max: TMax;
  };

  array<TLen extends number>(
    length: TLen | { readonly length: TLen },
  ): {
    readonly kind: "i32.array";
    readonly length: TLen;
  };
}

interface BoolBuilder {
  (): { readonly kind: "bool" };

  array<TLen extends number>(
    length: TLen | { readonly length: TLen },
  ): {
    readonly kind: "bool.array";
    readonly length: TLen;
  };
}

/**
 * Enum builder — `<const V>` keeps tuples, array overload preserves length.
 *
 * We use *overloads* instead of a union parameter type so that
 * `param.enum(['a','b','c'])` doesn't get its tuple widened to
 * `readonly string[]` by contextual typing.
 *
 * NOTE: ESLint may suggest combining these overloads into one signature
 * with a union type. DO NOT do this — the union causes TypeScript to
 * widen literal tuples to `readonly string[]` during inference.
 */
interface EnumBuilder {
  <const V extends readonly string[]>(
    values: V,
  ): {
    readonly kind: "enum";
    readonly values: V;
  };

  // eslint-disable-next-line @typescript-eslint/unified-signatures
  <const V extends readonly string[]>(config: {
    readonly values: V;
  }): {
    readonly kind: "enum";
    readonly values: V;
  };

  array<const V extends readonly string[], TLen extends number>(opts: {
    readonly values: V;
    readonly length: TLen;
  }): {
    readonly kind: "enum.array";
    readonly values: V;
    readonly length: TLen;
  };
}

/**
 * Meter builders — arrays get literal-preserving length as well.
 */
interface MeterF32Builder {
  (): { readonly kind: "f32" };

  array<TLen extends number>(
    length: TLen | { readonly length: TLen },
  ): {
    readonly kind: "f32.array";
    readonly length: TLen;
  };
}

interface MeterF64Builder {
  (): { readonly kind: "f64" };

  array<TLen extends number>(
    length: TLen | { readonly length: TLen },
  ): {
    readonly kind: "f64.array";
    readonly length: TLen;
  };
}

interface MeterU32Builder {
  (): { readonly kind: "u32" };

  array<TLen extends number>(
    length: TLen | { readonly length: TLen },
  ): {
    readonly kind: "u32.array";
    readonly length: TLen;
  };
}

type MeterBoolBuilder = () => { readonly kind: "bool" };

export interface ParamBuilders {
  readonly f32: F32Builder;
  readonly i32: I32Builder;
  readonly bool: BoolBuilder;
  readonly enum: EnumBuilder;
}

export interface MeterBuilders {
  readonly f32: MeterF32Builder;
  readonly f64: MeterF64Builder;
  readonly u32: MeterU32Builder;
  readonly bool: MeterBoolBuilder;
}

/**
 * Create a spec either from a plain object or via builders.
 *
 * - Builder form (preferred):
 *     const spec = defineSpec(({ param, meter }) => ({ ... }));
 *   here we use `const S` so nested literals are preserved.
 *
 * - Plain object form (power users / tests):
 *     const spec = defineSpec({ id: 'foo', params: { ... } });
 *   here we enforce `S extends SpecInput`.
 */
export function defineSpec<const S>(
  build: (api: {
    readonly param: ParamBuilders;
    readonly meter: MeterBuilders;
  }) => S,
): S;

export function defineSpec<S extends SpecInput>(spec: S): S;

export function defineSpec<S>(
  arg:
    | S
    | ((api: {
        readonly param: ParamBuilders;
        readonly meter: MeterBuilders;
      }) => S),
): S {
  if (typeof arg !== "function") {
    return arg;
  }

  const f32 = ((input?: ScalarRangeInput) => {
    const min = input?.min;
    const max = input?.max;

    if (min !== undefined || max !== undefined) {
      assertValidateScalarRange("param.f32", createRangeInput(min, max));
    }

    if (min !== undefined && max !== undefined) {
      return { kind: "f32" as const, min, max };
    }
    if (min !== undefined) {
      return { kind: "f32" as const, min };
    }
    if (max !== undefined) {
      return { kind: "f32" as const, max };
    }
    return { kind: "f32" as const };
  }) as F32Builder;

  f32.array = <TLen extends number>(
    length: TLen | { readonly length: TLen },
  ) => ({
    kind: "f32.array" as const,
    length: parseArrayLen(length) as TLen,
  });

  const i32 = ((r?: ScalarRangeInput) => {
    const min = r?.min;
    const max = r?.max;

    if (min !== undefined || max !== undefined) {
      assertValidateScalarRange("param.i32", createRangeInput(min, max), {
        integer: true,
      });
    }

    if (min !== undefined && max !== undefined) {
      return { kind: "i32" as const, min, max };
    }
    if (min !== undefined) {
      return { kind: "i32" as const, min };
    }
    if (max !== undefined) {
      return { kind: "i32" as const, max };
    }
    return { kind: "i32" as const };
  }) as I32Builder;

  i32.array = <TLen extends number>(
    length: TLen | { readonly length: TLen },
  ) => ({
    kind: "i32.array" as const,
    length: parseArrayLen(length) as TLen,
  });

  const bool = (() => ({ kind: "bool" as const })) as BoolBuilder;

  bool.array = <TLen extends number>(
    length: TLen | { readonly length: TLen },
  ) => ({
    kind: "bool.array" as const,
    length: parseArrayLen(length) as TLen,
  });

  const scalarEnum = <const V extends readonly string[]>(
    argEnum: V | { readonly values: V },
  ) => {
    const raw: V = isPlainObject(argEnum)
      ? (argEnum as { readonly values: V }).values
      : argEnum;
    return { kind: "enum" as const, values: asNonEmpty(raw) };
  };

  const arrayEnum = <
    const V extends readonly string[],
    TLen extends number,
  >(opts: {
    readonly values: V;
    readonly length: TLen;
  }) => ({
    kind: "enum.array" as const,
    values: asNonEmpty(opts.values),
    length: parseArrayLen(opts.length) as TLen,
  });

  const enumBuilder = scalarEnum as EnumBuilder;
  enumBuilder.array = arrayEnum;

  const meterF32 = (() => ({ kind: "f32" as const })) as MeterF32Builder;

  meterF32.array = <TLen extends number>(
    length: TLen | { readonly length: TLen },
  ) => ({
    kind: "f32.array" as const,
    length: parseArrayLen(length) as TLen,
  });

  const meterF64 = (() => ({ kind: "f64" as const })) as MeterF64Builder;

  meterF64.array = <TLen extends number>(
    length: TLen | { readonly length: TLen },
  ) => ({
    kind: "f64.array" as const,
    length: parseArrayLen(length) as TLen,
  });

  const meterU32 = (() => ({ kind: "u32" as const })) as MeterU32Builder;

  meterU32.array = <TLen extends number>(
    length: TLen | { readonly length: TLen },
  ) => ({
    kind: "u32.array" as const,
    length: parseArrayLen(length) as TLen,
  });

  const meterBool: MeterBoolBuilder = () => ({ kind: "bool" as const });

  const param = {
    f32,
    i32,
    bool,
    enum: enumBuilder,
  } as const;

  const meter = {
    f32: meterF32,
    f64: meterF64,
    u32: meterU32,
    bool: meterBool,
  } as const;

  const build = arg as (api: {
    readonly param: ParamBuilders;
    readonly meter: MeterBuilders;
  }) => S;

  return build({ param, meter });
}
