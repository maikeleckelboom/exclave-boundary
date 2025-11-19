/**
 * Stable hash for a spec.
 *
 * Keys sorted; enums include value order; arrays include only length.
 * Scalar params encode presence of min/max.
 * Backed by FNV-1a 64 over canonical JSON → base36 string.
 */
export type SpecHash = string;

/**
 * Scalar param definition with literal type preservation.
 *
 * - `f32` / `i32` may optionally constrain [min, max] with literal numbers
 * - `bool` is a simple boolean flag
 * - `enum` exposes string labels at the public API with literal tuple types
 */
export type ScalarParamDef =
  // f32 with no bounds
  | { readonly kind: 'f32' }
  // f32 with min only (preserves literal type)
  | { readonly kind: 'f32'; readonly min: number }
  // f32 with max only (preserves literal type)
  | { readonly kind: 'f32'; readonly max: number }
  // f32 with both min and max (preserves literal types)
  | { readonly kind: 'f32'; readonly min: number; readonly max: number }
  // i32 with no bounds
  | { readonly kind: 'i32' }
  // i32 with min only (preserves literal type)
  | { readonly kind: 'i32'; readonly min: number }
  // i32 with max only (preserves literal type)
  | { readonly kind: 'i32'; readonly max: number }
  // i32 with both min and max (preserves literal types)
  | { readonly kind: 'i32'; readonly min: number; readonly max: number }
  // bool flag
  | { readonly kind: 'bool' }
  // enum with tuple type preservation
  | { readonly kind: 'enum'; readonly values: readonly string[] };

/**
 * Array param definition with literal length preservation.
 *
 * Arrays are fixed-length at the DSL level. Enums still expose
 * string labels, but are stored as integer indices internally.
 */
export type ArrayParamDef =
  | { readonly kind: 'f32.array'; readonly length: number }
  | { readonly kind: 'i32.array'; readonly length: number }
  | { readonly kind: 'bool.array'; readonly length: number }
  | {
      readonly kind: 'enum.array';
      readonly values: readonly string[];
      readonly length: number;
    };

/**
 * Union of all param definitions.
 */
export type ParamDef = ScalarParamDef | ArrayParamDef;

/**
 * Scalar meter definition (single value per key).
 */
export type ScalarMeterDef =
  | { readonly kind: 'f32' }
  | { readonly kind: 'f64' }
  | { readonly kind: 'u32' }
  | { readonly kind: 'bool' };

/**
 * Array meter definition with literal length preservation.
 */
export type ArrayMeterDef =
  | { readonly kind: 'f32.array'; readonly length: number }
  | { readonly kind: 'f64.array'; readonly length: number }
  | { readonly kind: 'u32.array'; readonly length: number }
  | { readonly kind: 'bool.array'; readonly length: number };

/**
 * Union of all meter definitions.
 */
export type MeterDef = ScalarMeterDef | ArrayMeterDef;

/**
 * Authored spec input.
 *
 * This is the shape users write in code. `planLayout` and bindings
 * preserve literal key types from here.
 *
 * IMPORTANT: TypeScript will infer literal types for:
 * - Numeric literals in min/max/length fields
 * - Tuple types for enum values arrays
 * - String literal types for keys
 *
 * This preservation flows through the entire type system.
 */
export interface SpecInput {
  readonly id?: string;
  readonly params?: Readonly<Record<string, ParamDef>>;
  readonly meters?: Readonly<Record<string, MeterDef>>;
}

/**
 * Helper: params mapping for a spec, or `{}` when absent.
 *
 * Using `{}` instead of `object` keeps `keyof ParamsOf<SpecInput>`
 * narrow (`never`), which is friendlier for the compiler and avoids
 * accidental `string` blow-ups in generic code.
 */
type ParamsOf<S extends SpecInput> =
  S['params'] extends Readonly<Record<string, ParamDef>> ? S['params'] : object;

/**
 * Helper: meters mapping for a spec, or `{}` when absent.
 */
type MetersOf<S extends SpecInput> =
  S['meters'] extends Readonly<Record<string, MeterDef>> ? S['meters'] : object;

/**
 * Strip readonly from a shape.
 *
 * Used internally where we need a mutable view of authored specs.
 */
export type Mutable<T> = { -readonly [P in keyof T]: T[P] };

/**
 * String keys of the params mapping.
 */
export type ParamKeys<S extends SpecInput> = Extract<keyof ParamsOf<S>, string>;

/**
 * String keys of the meters mapping.
 */
export type MeterKeys<S extends SpecInput> = Extract<keyof MetersOf<S>, string>;

/**
 * Keys of scalar params in a spec.
 *
 * Includes all keys whose value type is `ScalarParamDef`
 * (`kind: 'f32' | 'i32' | 'bool' | 'enum'`).
 */
export type ScalarParamKeys<S extends SpecInput> = Extract<
  {
    [K in ParamKeys<S>]: ParamsOf<S>[K] extends ScalarParamDef ? K : never;
  }[ParamKeys<S>],
  string
>;

/**
 * Keys of array params in a spec.
 *
 * Includes all keys whose value type is `ArrayParamDef`
 * (`kind: 'f32.array' | 'i32.array' | 'bool.array' | 'enum.array'`).
 */
export type ArrayParamKeys<S extends SpecInput> = Extract<
  {
    [K in ParamKeys<S>]: ParamsOf<S>[K] extends ArrayParamDef ? K : never;
  }[ParamKeys<S>],
  string
>;

/**
 * Keys of scalar meters in a spec.
 *
 * Includes all keys whose value type is `ScalarMeterDef`
 * (`kind: 'f32' | 'f64' | 'u32' | 'bool'`).
 */
export type ScalarMeterKeys<S extends SpecInput> = Extract<
  {
    [K in MeterKeys<S>]: MetersOf<S>[K] extends ScalarMeterDef ? K : never;
  }[MeterKeys<S>],
  string
>;

/**
 * Keys of array meters in a spec.
 *
 * Includes all keys whose value type is `ArrayMeterDef`
 * (`kind: 'f32.array' | 'f64.array' | 'u32.array' | 'bool.array'`).
 */
export type ArrayMeterKeys<S extends SpecInput> = Extract<
  {
    [K in MeterKeys<S>]: MetersOf<S>[K] extends ArrayMeterDef ? K : never;
  }[MeterKeys<S>],
  string
>;
