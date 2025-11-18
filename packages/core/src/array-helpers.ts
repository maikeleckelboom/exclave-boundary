import type { SpecInput } from './spec/types';
import type { ProcessorParamView } from './types';

export type TypedArray =
  | Float32Array
  | Float64Array
  | Int32Array
  | Int16Array
  | Int8Array
  | Uint32Array
  | Uint16Array
  | Uint8Array;

/**
 * Param keys whose processor view is a TypedArray.
 *
 * @remarks
 * This is intentionally processor-side only: controller sees readonly
 * arrays, processor sees mutable scratch views.
 */
export type ArrayParamKeys<S extends SpecInput> = {
  [K in keyof ProcessorParamView<S>]: ProcessorParamView<S>[K] extends TypedArray
    ? K
    : never;
}[keyof ProcessorParamView<S>];

/**
 * Copy the overlapping prefix of an array param into a destination typed array.
 *
 * - Never allocates
 * - Safe to call inside `params.within`
 * - Copies min(src.length, dest.length) elements starting at 0
 */
export function copyParamArrayInto<S extends SpecInput>(
  view: ProcessorParamView<S>,
  key: ArrayParamKeys<S>,
  into: TypedArray,
): void {
  const src = view[key] as TypedArray;
  const len = src.length <= into.length ? src.length : into.length;
  into.set(src.subarray(0, len), 0);
}
