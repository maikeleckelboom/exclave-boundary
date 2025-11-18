/**
 * Binding-domain public types.
 *
 * Rough structure:
 * - core primitives (sequences, policies, helpers)
 * - spec/kind mapping and value maps
 * - shapes & controller-visible values
 * - coherence & ephemeral brands
 * - options & binding interfaces
 * - snapshot / into typings
 * - convenience aliases
 */

import type {
  ArrayMeterKeys,
  ArrayParamKeys,
  MeterKeys,
  ParamKeys,
  ScalarMeterKeys,
  ScalarParamKeys,
  SpecInput,
} from '../spec/types';

/* sequence stamps */
export type PUSeq = number;
export type MUSeq = number;

/* display helper that never rewrites functions */
type Display<T> = T extends (...args: readonly unknown[]) => unknown
  ? T
  : { [K in keyof T]: T[K] } & {};

/* spec access */
type ParamsOf<S extends SpecInput> = S['params'] extends object ? S['params'] : object;
type MetersOf<S extends SpecInput> = S['meters'] extends object ? S['meters'] : object;

type ParamAt<S extends SpecInput, K extends ParamKeys<S>> = K extends keyof ParamsOf<S>
  ? ParamsOf<S>[K]
  : never;
type MeterAt<S extends SpecInput, K extends MeterKeys<S>> = K extends keyof MetersOf<S>
  ? MetersOf<S>[K]
  : never;

type EnumValuesOf<D> = D extends { values: readonly (infer V)[] } ? V : never;

/* kind universes */
type ParamKind =
  | 'f32'
  | 'i32'
  | 'bool'
  | 'enum'
  | 'f32.array'
  | 'i32.array'
  | 'u8.array'
  | 'bool.array'
  | 'enum.array';

type MeterKind =
  | 'f32'
  | 'u32'
  | 'f64'
  | 'bool'
  | 'f32.array'
  | 'u32.array'
  | 'f64.array'
  | 'bool.array';

/* value maps (processor-side views) */
interface ParamProcMap {
  f32: number;
  i32: number;
  bool: boolean;
  enum: number; // enum scalar → numeric index on processor
  'f32.array': Float32Array;
  'i32.array': Int32Array;
  'u8.array': Uint8Array;
  'bool.array': Uint8Array;
  'enum.array': Int32Array; // indices
}

interface MeterProcMap {
  f32: number;
  u32: number;
  f64: number;
  bool: boolean;
  'f32.array': Float32Array;
  'u32.array': Uint32Array;
  'f64.array': Float64Array;
  'bool.array': Uint8Array;
}

/* controller-visible maps */
interface ParamCtlMap {
  f32: number;
  i32: number;
  bool: boolean;
  'f32.array': Readonly<Float32Array>;
  'i32.array': Readonly<Int32Array>;
  'u8.array': Readonly<Uint8Array>;
  'bool.array': Readonly<Uint8Array>;
  'enum.array': Readonly<Int32Array>; // indices
}

interface MeterCtlMap {
  f32: number;
  u32: number;
  f64: number;
  bool: boolean;
  'f32.array': Readonly<Float32Array>;
  'u32.array': Readonly<Uint32Array>;
  'f64.array': Readonly<Float64Array>;
  'bool.array': Readonly<Uint8Array>;
}

/* shapes (processor-side read shapes) */
export type ParamShape<S extends SpecInput> = Display<{
  readonly [K in ParamKeys<S>]: ParamAt<S, K> extends {
    kind: infer Kind;
  }
    ? Kind extends ParamKind
      ? ParamProcMap[Kind]
      : never
    : never;
}>;

export type MeterShape<S extends SpecInput> = Display<{
  readonly [K in MeterKeys<S>]: MeterAt<S, K> extends {
    kind: infer Kind;
  }
    ? Kind extends MeterKind
      ? MeterProcMap[Kind]
      : never
    : never;
}>;

/* controller-visible values */
export type ParamValueFor<S extends SpecInput, K extends ParamKeys<S>> =
  ParamAt<S, K> extends {
    kind: infer Kind;
  }
    ? Kind extends 'enum'
      ? EnumValuesOf<ParamAt<S, K>>
      : Kind extends Exclude<ParamKind, 'enum'>
        ? ParamCtlMap[Kind]
        : never
    : never;

export type MeterValueFor<S extends SpecInput, K extends MeterKeys<S>> =
  MeterAt<S, K> extends {
    kind: infer Kind;
  }
    ? Kind extends MeterKind
      ? MeterCtlMap[Kind]
      : never
    : never;

export type ArrayParamView<
  S extends SpecInput,
  K extends ArrayParamKeys<S>,
> = ParamShape<S>[K];

/* coherent scalars */
export type CoherentValue<T extends number | string | boolean> = T;

type ScalarFor<
  S extends SpecInput,
  K extends ScalarParamKeys<S>,
> = ParamShape<S>[K] extends number | string | boolean ? ParamShape<S>[K] : never;

export type CoherentParamShape<S extends SpecInput> = Display<
  {
    readonly [K in ScalarParamKeys<S>]: CoherentValue<ScalarFor<S, K>>;
  } & {
    readonly [K in ArrayParamKeys<S>]: ParamShape<S>[K];
  }
>;

/* Processor-side params view (used by ProcessorParams.within) */
export type ProcessorParamsView<S extends SpecInput> = Display<
  {
    readonly [K in ScalarParamKeys<S>]: CoherentValue<ScalarFor<S, K>>;
  } & {
    readonly [K in ArrayParamKeys<S>]: Ephemeral<ParamShape<S>[K]>;
  }
>;

/* Ephemeral brand for callback-scoped views */
export type EphemeralTypedArray =
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array
  | Uint8Array;
declare const __ephemeralBrand: unique symbol;
export type Ephemeral<T extends EphemeralTypedArray> = T & {
  readonly [__ephemeralBrand]: true;
  subarray(begin?: number, end?: number): Ephemeral<T>;
};

/* convenience */
export type RawParamShape<S extends SpecInput> = ParamShape<S>;

/**
 * Policy for handling out-of-range param writes on the controller side.
 *
 * - 'clamp'  → value is clamped into [min,max] and committed.
 * - 'reject' → a range error is thrown and the write is not committed.
 *
 * Default behaviour today is effectively 'reject'.
 */
export type RangePolicy = 'clamp' | 'reject';

/**
 * Param-side policy options for a controller binding.
 */
export interface ControllerParamPolicyOptions {
  /**
   * How to handle `set()` / `update()` calls with out-of-range values.
   *
   * @default 'reject'
   */
  readonly rangePolicy?: RangePolicy;
}

/**
 * Meter-side degradation policy when a coherent snapshot cannot be acquired
 * within the configured budgets.
 *
 * - 'returnLatest' → fall back to the last-known-good (best-effort) snapshot.
 * - 'throw'        → propagate an error to the caller.
 *
 * This maps cleanly onto the primitives seqlock AcquireOptions:
 * - 'throw'        → `degrade: 'never'` + throw on timeout
 * - 'returnLatest' → `degrade: 'returnLatest'`
 */
export type MeterDegradePolicy = 'returnLatest' | 'throw';

/**
 * Meter-side policy options for a controller binding.
 *
 * These are read policies; they never affect param writes.
 */
export interface ControllerMeterPolicyOptions {
  /**
   * Degradation strategy when we cannot obtain a coherent snapshot
   * within `spinBudget` × `retryBudget`.
   *
   * @default 'returnLatest'
   */
  readonly degrade?: MeterDegradePolicy;

  /**
   * Max spins per low-level seqlock tryRead attempt.
   *
   * @default 1024 (library default)
   */
  readonly spinBudget?: number;

  /**
   * Max retry attempts before applying `degrade`.
   *
   * @default 8 (library default)
   */
  readonly retryBudget?: number;
}

/**
 * Options for binding a Controller.
 *
 * Structured by role:
 * - `params` → write-side policies (range handling)
 * - `meters` → read-side policies (coherence / retry behaviour)
 */
export interface ControllerOptions {
  /**
   * Policies for the 'params' (writer) domain.
   */
  readonly params?: ControllerParamPolicyOptions;

  /**
   * Policies for the 'meters' (reader) domain.
   */
  readonly meters?: ControllerMeterPolicyOptions;

  /**
   * General controller-wide flags.
   * This is where an 'exclusive' binding flag belongs.
   */
  readonly exclusive?: boolean;
}

export interface ProcessorOptions {
  readonly diagnostics?: boolean;
}

/* bindings */
export interface ControllerBinding<S extends SpecInput> {
  readonly params: ControllerParams<S>;
  readonly meters: ControllerMeters<S>;

  dispose(): void;
}

export interface ProcessorBinding<S extends SpecInput> {
  readonly params: ProcessorParams<S>;
  readonly meters: ProcessorMeters<S>;

  dispose(): void;
}

/* into maps */
type MutableBuffer<T> =
  T extends Readonly<Float32Array>
    ? Float32Array
    : T extends Readonly<Float64Array>
      ? Float64Array
      : T extends Readonly<Uint32Array>
        ? Uint32Array
        : T extends Readonly<Int32Array>
          ? Int32Array
          : T extends Readonly<Uint8Array>
            ? Uint8Array
            : never;

export type IntoForParams<
  S extends SpecInput,
  KS extends readonly ParamKeys<S>[],
> = Readonly<{
  [K in Extract<KS[number], ParamKeys<S>> as ParamValueFor<
    S,
    K
  > extends Readonly<ArrayBufferView>
    ? K
    : never]?: MutableBuffer<ParamValueFor<S, K>>;
}>;

export type IntoForMeters<
  S extends SpecInput,
  KS extends readonly MeterKeys<S>[],
> = Readonly<{
  [K in Extract<KS[number], MeterKeys<S>> as MeterValueFor<
    S,
    K
  > extends Readonly<ArrayBufferView>
    ? K
    : never]?: MutableBuffer<MeterValueFor<S, K>>;
}>;

/* named options interfaces for improved IntelliSense */
export interface SnapshotMetersOptions<
  S extends SpecInput,
  K extends readonly MeterKeys<S>[],
> {
  /** Optional destination buffers for array meters (zero-alloc path). */
  readonly into?: IntoForMeters<S, K>;
}

export interface SnapshotParamsOptions<
  S extends SpecInput,
  K extends readonly ParamKeys<S>[],
> {
  /** Optional destination buffers for array params (zero-alloc path). */
  readonly into?: IntoForParams<S, K>;
}

export type ScalarParamPatch<S extends SpecInput> = Readonly<
  Partial<{ [K in ScalarParamKeys<S>]: ParamValueFor<S, K> }>
>;

/* Controller side */
export interface ControllerParams<S extends SpecInput> {
  set<K extends ScalarParamKeys<S>>(key: K, value: ParamValueFor<S, K>): void;

  update(patch: ScalarParamPatch<S>): void;

  stage<const K extends ArrayParamKeys<S>>(
    key: K,
    callback: (view: Ephemeral<ArrayParamView<S, K>>) => void,
  ): void;

  /** Full snapshot of all params. */
  snapshot(): FullParamsSnapshot<S>;

  /** Array + (optional) options — put this BEFORE the varargs overload. */
  snapshot<const K extends readonly ParamKeys<S>[]>(
    keys: K,
    options?: SnapshotParamsOptions<S, K>,
  ): SnapshotParamsObject<S, K>;

  /** Single-parameter: array OR { keys, into? }. */
  snapshot<const K extends readonly ParamKeys<S>[]>(
    keysOrOptions: K | { readonly keys: K; readonly into?: IntoForParams<S, K> },
  ): SnapshotParamsObject<S, K>;

  /** Into-only (reuse user-provided buffers for full snapshot). */
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  snapshot(options: {
    readonly into: IntoForParams<S, readonly ParamKeys<S>[]>;
  }): FullParamsSnapshot<S>;

  version(): PUSeq;
}

export interface ControllerMeters<S extends SpecInput> {
  /** Full snapshot of all meters. */
  snapshot(): FullMetersSnapshot<S>;

  /** Array + (optional) options — put this BEFORE the varargs overload. */
  snapshot<const K extends readonly MeterKeys<S>[]>(
    keys: K,
    options?: SnapshotMetersOptions<S, K>,
  ): SnapshotMetersObject<S, K>;

  /** Varargs last (no second parameter). */
  snapshot<const K extends readonly MeterKeys<S>[]>(
    ...keys: K
  ): SnapshotMetersObject<S, K>;

  /** Single-parameter: array OR { keys, into? }. */
  snapshot<const K extends readonly MeterKeys<S>[]>(
    keysOrOptions: K | { readonly keys: K; readonly into?: IntoForMeters<S, K> },
  ): SnapshotMetersObject<S, K>;

  /** Into-only (reuse user-provided buffers for full snapshot). */
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  snapshot(options: {
    readonly into: IntoForMeters<S, readonly MeterKeys<S>[]>;
  }): FullMetersSnapshot<S>;

  /** Monotonic MU sequence value published by the processor. */
  version(): MUSeq;
}

/* processor writer value helpers */
type MeterScalarFor<S extends SpecInput, K extends MeterKeys<S>> = NonNullable<
  S['meters']
>[K] extends {
  kind: 'bool';
}
  ? boolean
  : number;

type MeterArrayFor<S extends SpecInput, K extends MeterKeys<S>> = NonNullable<
  S['meters']
>[K] extends {
  kind: 'f32.array';
}
  ? Float32Array
  : NonNullable<S['meters']>[K] extends { kind: 'f64.array' }
    ? Float64Array
    : NonNullable<S['meters']>[K] extends {
          kind: 'u32.array';
        }
      ? Uint32Array
      : NonNullable<S['meters']>[K] extends { kind: 'bool.array' }
        ? Uint8Array
        : never;

/**
 * Writer used inside `processor.meters.publish(...)`.
 *
 * Semantics:
 *
 * - Scalar meters:
 *   ```ts
 *   writer.level(0.75);          // direct, hot-path
 *   writer.set('level', 0.75);   // dynamic, key-driven
 *   ```
 *
 * - Array meters:
 *   ```ts
 *   writer.stage('spectrum', (dest) => {
 *     dest.set(spectrumSource);
 *   });
 *   ```
 *
 * Arrays are intentionally **stage-only**:
 *
 * - There is no `set('spectrum', fn)` overload.
 * - The array write path is always explicit: publish → stage → dest.set.
 *
 * `set(key, value)` exists only as scalar sugar when you need dynamic,
 * key-driven writes (e.g. in loops, tables, or generic instrumentation).
 */
export type MeterWriter<S extends SpecInput> = {
  [K in ScalarMeterKeys<S>]: (value: MeterScalarFor<S, K>) => void;
} & {
  /**
   * Stage an array meter update with an ephemeral view.
   *
   * The callback receives a view that is valid only for the duration of
   * the enclosing `publish(...)` call.
   */
  stage<const K extends ArrayMeterKeys<S>>(
    key: K,
    callback: (destination: Ephemeral<MeterArrayFor<S, K>>) => void,
  ): void;

  /**
   * Dynamic scalar setter.
   *
   * Example:
   * ```ts
   * const key: 'rms' | 'peak' = decideKey();
   * writer.set(key, 0.5);
   * ```
   */
  set<K extends ScalarMeterKeys<S>>(key: K, value: MeterScalarFor<S, K>): void;
};

/* Processor side */

export interface ProcessorParams<S extends SpecInput> {
  /**
   * Read parameters within a seqlock-protected critical section.
   *
   * The view provides:
   * - Scalar params as coherent values (atomic read guarantee)
   * - Array params as ephemeral typed arrays (callback-scoped)
   */
  within<T>(callback: (view: ProcessorParamsView<S>) => T): T;

  version(): PUSeq;
}

export interface ProcessorMeters<S extends SpecInput> {
  /**
   * Publish meter values within a seqlock-protected critical section.
   *
   * The writer provides:
   * - Direct scalar setters (e.g., `writer.rms(0.5)`)
   * - `set(key, value)` as dynamic scalar sugar
   * - `stage(key, dest => ...)` for array meters
   *
   * Array meters are stage-only; there is no `set(key, fn)` array overload.
   */
  publish<T>(callback: (writer: MeterWriter<S>) => T): T;

  version(): MUSeq;
}

/* convenience unions */
export type ScalarParamValue = number | boolean | string;
export type ScalarMeterValue = number;

/* snapshots */
export type ControllerParamsSnapshot<
  S extends SpecInput,
  Keys extends readonly ParamKeys<S>[],
> = SnapshotParamsObject<S, Keys>;

export type ControllerMetersSnapshot<
  S extends SpecInput,
  Keys extends readonly MeterKeys<S>[],
> = SnapshotMetersObject<S, Keys>;

export type FullParamsSnapshot<S extends SpecInput> = Readonly<
  Display<{ [K in ParamKeys<S>]: ParamValueFor<S, K> }>
>;

export type FullMetersSnapshot<S extends SpecInput> = Readonly<
  Display<{ [K in MeterKeys<S>]: MeterValueFor<S, K> }>
>;

type ParamSnapshotKeys<S extends SpecInput, KS extends readonly ParamKeys<S>[]> = Extract<
  KS[number],
  ParamKeys<S>
>;
type MeterSnapshotKeys<S extends SpecInput, KS extends readonly MeterKeys<S>[]> = Extract<
  KS[number],
  MeterKeys<S>
>;

export type SnapshotParamsObject<
  S extends SpecInput,
  KS extends readonly ParamKeys<S>[],
> = Readonly<Display<{ [K in ParamSnapshotKeys<S, KS>]: ParamValueFor<S, K> }>>;

export type SnapshotMetersObject<
  S extends SpecInput,
  KS extends readonly MeterKeys<S>[],
> = Readonly<Display<{ [K in MeterSnapshotKeys<S, KS>]: MeterValueFor<S, K> }>>;

/** Quick access to parameter value type for a key */
export type ParamType<S extends SpecInput, K extends ParamKeys<S>> = ParamValueFor<S, K>;

/** Quick access to meter value type for a key */
export type MeterType<S extends SpecInput, K extends MeterKeys<S>> = MeterValueFor<S, K>;

/** True if K is an array param key */
export type IsArrayParam<S extends SpecInput, K extends ParamKeys<S>> =
  K extends ArrayParamKeys<S> ? true : false;

/** True if K is a scalar meter key */
export type IsScalarMeter<S extends SpecInput, K extends MeterKeys<S>> =
  K extends ScalarMeterKeys<S> ? true : false;
