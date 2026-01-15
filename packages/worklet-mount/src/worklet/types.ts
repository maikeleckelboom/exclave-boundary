export interface EmscriptenModule {
  readonly HEAPU8: Uint8Array;
  readonly HEAPF32: Float32Array;

  _malloc(bytes: number): number;
  _free(ptr: number): void;

  stackSave?(): number;
  stackRestore?(ptr: number): void;
}

/**
 * MODULARIZE=1 factories are sync in some builds and async in others.
 * We model both.
 *
 * We also encourage passing `wasmBinary` for deterministic instantiation.
 */
export type EmscriptenFactory<T extends EmscriptenModule> = (
  opts: Readonly<Record<string, unknown> & { wasmBinary: Uint8Array }>,
) => T | Promise<T>;

export type Registry<T extends EmscriptenModule> = Readonly<
  Record<string, EmscriptenFactory<T>>
>;

/**
 * A module view intended for realtime usage.
 *
 * This removes heap allocation primitives from the type surface so code inside
 * `processBlock` cannot accidentally call `_malloc/_free` without an explicit cast.
 */
export type RuntimeModule<T extends EmscriptenModule> = Omit<
  T,
  "_malloc" | "_free"
>;

/**
 * Runtime handle (correlates identity + RT-safe module view).
 */
export type RuntimeInstance<T extends EmscriptenModule> = Readonly<{
  key: string;
  module: RuntimeModule<T>;
}>;
