/**
 * @fileoverview
 * Binding-domain public types shared by controller and processor bindings.
 *
 * @remarks
 * - Lifts spec-level param/meter definitions into concrete runtime shapes.
 * - Defines controller-visible and processor-visible value maps.
 * - Models coherent scalar views and ephemeral array views for params.
 * - Encodes binding policies, options and binding interfaces.
 * - Provides snapshot and `into` typings for zero-alloc reads on the controller.
 */

import type {
  ArrayMeterKeys,
  ArrayParamKeys,
  MeterKeys,
  ParamKeys,
  ScalarMeterKeys,
  ScalarParamKeys,
  SpecInput,
} from "../../spec/types";

/**
 * Monotonic sequence number for param updates (PU domain).
 *
 * @remarks
 * - Incremented on each successful param publish from the processor.
 * - Exposed via `controller.params.version()` and `processor.params.version()`.
 */
export type PUSeq = number;

/**
 * Monotonic sequence number for meter updates (MU domain).
 *
 * @remarks
 * - Incremented on each successful meter publish from the processor.
 * - Exposed via `controller.meters.version()` and `processor.meters.version()`.
 */
export type MUSeq = number;

/**
 * Helper to force a mapped type to display as a concrete object in IntelliSense.
 */
type Display<T> = T extends (...args: readonly unknown[]) => unknown
  ? T
  : { [K in keyof T]: T[K] } & {};

type ParamsOf<S extends SpecInput> = S["params"] extends object
  ? S["params"]
  : object;
type MetersOf<S extends SpecInput> = S["meters"] extends object
  ? S["meters"]
  : object;

type ParamAt<
  S extends SpecInput,
  K extends ParamKeys<S>,
> = K extends keyof ParamsOf<S> ? ParamsOf<S>[K] : never;

type MeterAt<
  S extends SpecInput,
  K extends MeterKeys<S>,
> = K extends keyof MetersOf<S> ? MetersOf<S>[K] : never;

type EnumValuesOf<D> = D extends { values: readonly (infer V)[] } ? V : never;

// Param kind universe (spec-level `kind` field).
type ParamKind =
  | "f32"
  | "i32"
  | "bool"
  | "enum"
  | "f32.array"
  | "i32.array"
  | "u8.array"
  | "bool.array"
  | "enum.array";

// Meter kind universe (spec-level `kind` field).
type MeterKind =
  | "f32"
  | "u32"
  | "f64"
  | "bool"
  | "f32.array"
  | "u32.array"
  | "f64.array"
  | "bool.array";

/**
 * Processor-side param value map.
 *
 * @remarks
 * - Scalars are plain JS primitives.
 * - Arrays are typed views into the backing planes.
 * - Enum scalars are always numeric indices on the processor side.
 */
interface ParamProcessorMap {
  f32: number;
  i32: number;
  bool: boolean;
  enum: number;
  "f32.array": Float32Array;
  "i32.array": Int32Array;
  "u8.array": Uint8Array;
  "bool.array": Uint8Array;
  "enum.array": Int32Array;
}

/**
 * Processor-side meter value map.
 *
 * @remarks
 * - Mirrors the meter plane storage layout.
 * - Used to derive `MeterShape` for processor bindings.
 */
interface MeterProcessorMap {
  f32: number;
  u32: number;
  f64: number;
  bool: boolean;
  "f32.array": Float32Array;
  "u32.array": Uint32Array;
  "f64.array": Float64Array;
  "bool.array": Uint8Array;
}

/**
 * Controller-visible param value map.
 *
 * @remarks
 * - Scalars are plain JS primitives.
 * - Arrays are exposed as readonly views to prevent accidental mutation.
 * - Enum arrays expose indices; UI is expected to map them back to labels.
 */
interface ParamControllerMap {
  f32: number;
  i32: number;
  bool: boolean;
  "f32.array": Readonly<Float32Array>;
  "i32.array": Readonly<Int32Array>;
  "u8.array": Readonly<Uint8Array>;
  "bool.array": Readonly<Uint8Array>;
  "enum.array": Readonly<Int32Array>; // indices
}

/**
 * Controller-visible meter value map.
 *
 * @remarks
 * - Scalars are plain JS primitives.
 * - Arrays are exposed as readonly views to prevent accidental mutation.
 */
interface MeterControllerMap {
  f32: number;
  u32: number;
  f64: number;
  bool: boolean;
  "f32.array": Readonly<Float32Array>;
  "u32.array": Readonly<Uint32Array>;
  "f64.array": Readonly<Float64Array>;
  "bool.array": Readonly<Uint8Array>;
}

/**
 * Processor-side param shape derived from a spec.
 *
 * @remarks
 * - Keys are param keys from the spec.
 * - Values are processor-side views (`ParamProcessorMap`).
 * - Used inside `ProcessorParamsView` and processor bindings.
 */
export type ParamShape<S extends SpecInput> = Display<{
  readonly [K in ParamKeys<S>]: ParamAt<S, K> extends {
    kind: infer Kind;
  }
    ? Kind extends ParamKind
      ? ParamProcessorMap[Kind]
      : never
    : never;
}>;

/**
 * Processor-side meter shape derived from a spec.
 *
 * @remarks
 * - Keys are meter keys from the spec.
 * - Values are processor-side views (`MeterProcessorMap`).
 */
export type MeterShape<S extends SpecInput> = Display<{
  readonly [K in MeterKeys<S>]: MeterAt<S, K> extends {
    kind: infer Kind;
  }
    ? Kind extends MeterKind
      ? MeterProcessorMap[Kind]
      : never
    : never;
}>;

/**
 * Controller-visible value type for a single param key.
 *
 * @remarks
 * - For enum scalars, returns the enum label type (not the index).
 * - For arrays, returns readonly typed array views.
 */
export type ParamValueFor<S extends SpecInput, K extends ParamKeys<S>> =
  ParamAt<S, K> extends {
    kind: infer Kind;
  }
    ? Kind extends "enum"
      ? EnumValuesOf<ParamAt<S, K>>
      : Kind extends Exclude<ParamKind, "enum">
        ? ParamControllerMap[Kind]
        : never
    : never;

/**
 * Controller-visible value type for a single meter key.
 *
 * @remarks
 * - Scalars are primitives.
 * - Arrays are readonly typed array views.
 */
export type MeterValueFor<S extends SpecInput, K extends MeterKeys<S>> =
  MeterAt<S, K> extends {
    kind: infer Kind;
  }
    ? Kind extends MeterKind
      ? MeterControllerMap[Kind]
      : never
    : never;

/**
 * Controller-side view type for an array param.
 *
 * @remarks
 * - Uses the processor-side `ParamShape` entry for the key.
 * - Typically wrapped in `Ephemeral` for processor views.
 */
export type ArrayParamView<
  S extends SpecInput,
  K extends ArrayParamKeys<S>,
> = ParamShape<S>[K];

/**
 * Coherent scalar value type.
 *
 * @remarks
 * - Represents a scalar that was read under a seqlock and is self-consistent
 *   within the enclosing critical section.
 * - Includes only primitive scalar types used by params.
 */
export type CoherentValue<T extends number | string | boolean> = T;

type ScalarFor<
  S extends SpecInput,
  K extends ScalarParamKeys<S>,
> = ParamShape<S>[K] extends number | string | boolean
  ? ParamShape<S>[K]
  : never;

/**
 * Processor-side coherent param shape.
 *
 * @remarks
 * - Scalar params are exposed as coherent scalar values.
 * - Array params are exposed as raw processor-side arrays.
 * - This shape is used for single-shot coherent snapshots.
 */
export type CoherentParamShape<S extends SpecInput> = Display<
  {
    readonly [K in ScalarParamKeys<S>]: CoherentValue<ScalarFor<S, K>>;
  } & {
    readonly [K in ArrayParamKeys<S>]: ParamShape<S>[K];
  }
>;

/**
 * Processor-side params view used inside `ProcessorParams.within(...)`.
 *
 * @remarks
 * - Scalar params: coherent scalar values.
 * - Array params: ephemeral typed array views (callback-scoped).
 */
export type ProcessorParamsView<S extends SpecInput> = Display<
  {
    readonly [K in ScalarParamKeys<S>]: CoherentValue<ScalarFor<S, K>>;
  } & {
    readonly [K in ArrayParamKeys<S>]: Ephemeral<ParamShape<S>[K]>;
  }
>;

/**
 * Union of typed arrays that can be branded as ephemeral.
 */
export type EphemeralTypedArray =
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array
  | Uint8Array;

declare const __ephemeralBrand: unique symbol;

/**
 * Ephemeral view wrapper for callback-scoped arrays.
 *
 * @remarks
 * - Instances are only valid for the duration of the enclosing callback.
 * - The branded `subarray` preserves the ephemeral brand.
 * - Do not retain references outside the callback; this is not enforced
 *   at runtime but is part of the contract.
 */
export type Ephemeral<T extends EphemeralTypedArray> = T & {
  readonly [__ephemeralBrand]: true;
  subarray(begin?: number, end?: number): Ephemeral<T>;
};

/**
 * Alias for the full processor-side param shape, kept for readability.
 */
// export type RawParamShape<S extends SpecInput> = ParamShape<S>;

/**
 * Policy for handling out-of-range param writes on the controller side.
 *
 * @remarks
 * - `'clamp'`  → value is clamped into `[min, max]` and committed.
 * - `'reject'` → a range error is thrown and the write is not committed.
 *
 * Default behaviour today is effectively `'reject'`.
 */
export type RangePolicy = "clamp" | "reject";

/**
 * Param-side policy options for a controller binding.
 *
 * @remarks
 * - Controls how scalar writes are validated and applied.
 * - Does not affect meter reads.
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
 * @remarks
 * - `'returnLatest'` → fall back to the last-known-good snapshot (best-effort).
 * - `'throw'`        → propagate an error to the caller.
 *
 * This maps onto the primitives seqlock `AcquireOptions`:
 * - `'throw'`        → `degrade: 'never'` + throw on timeout.
 * - `'returnLatest'` → `degrade: 'returnLatest'`.
 */
export type MeterDegradePolicy = "returnLatest" | "throw";

/**
 * Meter-side policy options for a controller binding.
 *
 * @remarks
 * - Only influences meter reads, never param writes.
 * - Controls seqlock retry behaviour and degradation strategy.
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
   * Max spins per low-level seqlock `tryRead` attempt.
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
 * Options for binding a controller.
 *
 * @remarks
 * - Structured by role:
 *   - `params` → write-side policies (range handling).
 *   - `meters` → read-side policies (coherence / retry behaviour).
 */
export interface ControllerOptions {
  /**
   * Policies for the params (writer) domain.
   */
  readonly params?: ControllerParamPolicyOptions;

  /**
   * Policies for the meters (reader) domain.
   */
  readonly meters?: ControllerMeterPolicyOptions;
}

/**
 * Options for binding a processor.
 *
 * @remarks
 * - Configures seqlock spin/retry budgets for params and meters.
 * - These are per-binding tuning knobs for the processor side.
 */
export interface ProcessorOptions {
  readonly params?: {
    /**
     * Max spin iterations per `within()` attempt.
     *
     * @default 1024 (library default)
     */
    readonly spinBudget?: number /**
     * Max retry attempts before giving up and throwing.
     *
     * @default 8 (library default)
     */;
    readonly retryBudget?: number;
  };

  readonly meters?: {
    /**
     * Max spin iterations per `publish()` attempt.
     *
     * @default 1024 (library default)
     */
    readonly spinBudget?: number /**
     * Max retry attempts before giving up and throwing.
     *
     * @default 8 (library default)
     */;
    readonly retryBudget?: number;
  };
}

/**
 * Controller binding: main-thread facade for params and meters.
 *
 * @remarks
 * - `params` exposes write operations and snapshots.
 * - `meters` exposes coherent read operations and snapshots.
 * - `dispose()` releases backing references and internal resources.
 */
export interface ControllerBinding<S extends SpecInput> {
  readonly params: ControllerParams<S>;
  readonly meters: ControllerMeters<S>;

  dispose(): void;
}

/**
 * Processor binding: audio-thread facade for params and meters.
 *
 * @remarks
 * - `params` exposes coherent reads via `within(...)`.
 * - `meters` exposes coherent writes via `publish(...)`.
 * - `dispose()` releases backing references and internal resources.
 */
export interface ProcessorBinding<S extends SpecInput> {
  readonly params: ProcessorParams<S>;
  readonly meters: ProcessorMeters<S>;

  dispose(): void;
}

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

/**
 * Mapping from param keys to user-provided destination buffers.
 *
 * @remarks
 * - Used by controller-side APIs to support zero-alloc snapshots.
 * - Only array-typed params are allowed; scalar keys are filtered out.
 */
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

/**
 * Mapping from meter keys to user-provided destination buffers.
 *
 * @remarks
 * - Used by controller-side APIs to support zero-alloc snapshots.
 * - Only array-typed meters are allowed; scalar keys are filtered out.
 */
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

/**
 * Options for controller meter snapshots.
 *
 * @remarks
 * - `into` enables zero-alloc snapshots by reusing caller-provided buffers.
 */
export interface SnapshotMetersOptions<
  S extends SpecInput,
  K extends readonly MeterKeys<S>[],
> {
  /**
   * Optional destination buffers for array meters (zero-alloc path).
   */
  readonly into?: IntoForMeters<S, K>;
}

/**
 * Options for controller param snapshots.
 *
 * @remarks
 * - `into` enables zero-alloc snapshots by reusing caller-provided buffers.
 */
export interface SnapshotParamsOptions<
  S extends SpecInput,
  K extends readonly ParamKeys<S>[],
> {
  /**
   * Optional destination buffers for array params (zero-alloc path).
   */
  readonly into?: IntoForParams<S, K>;
}

/**
 * Patch type for scalar param updates.
 *
 * @remarks
 * - Used by `controller.params.update(...)`.
 * - Only scalar param keys are allowed; arrays are excluded.
 */
export type ScalarParamPatch<S extends SpecInput> = Readonly<
  Partial<{ [K in ScalarParamKeys<S>]: ParamValueFor<S, K> }>
>;

/**
 * Cold-path bulk patch for params – accepts both scalar and array params.
 *
 * @remarks
 * - Used by `controller.params.hydrate(...)`.
 * - Applies scalar range policy (`'reject' | 'clamp'`).
 * - Validates array types/lengths.
 * - Commits all changes under a single PU publish.
 */
export type HydratePatch<S extends SpecInput> = Readonly<
  Partial<{ [K in ParamKeys<S>]: ParamValueFor<S, K> }>
>;

/**
 * Controller-side param operations.
 *
 * @remarks
 * - `set` / `update` for scalar params.
 * - `stage` for array params (ephemeral write window).
 * - `hydrate` for cold-path bulk updates.
 * - `snapshot` overloads for full and partial snapshots (with optional `into`).
 * - `version` exposes the current PU sequence.
 */
export interface ControllerParams<S extends SpecInput> {
  /**
   * Set a single scalar param value.
   *
   * @remarks
   * - Subject to `RangePolicy` when configured.
   */
  set<K extends ScalarParamKeys<S>>(key: K, value: ParamValueFor<S, K>): void;

  /**
   * Apply a patch of scalar param updates.
   *
   * @remarks
   * - Each entry is validated according to `RangePolicy`.
   * - Multiple updates are coalesced into a single publish.
   */
  update(patch: ScalarParamPatch<S>): void;

  /**
   * Stage a write into an array param.
   *
   * @remarks
   * - Provides an ephemeral view scoped to the callback.
   * - Writes are committed under a single PU publish.
   */
  stage<const K extends ArrayParamKeys<S>>(
    key: K,
    callback: (view: Ephemeral<ArrayParamView<S, K>>) => void,
  ): void;

  /**
   * Cold-path bulk write.
   *
   * @remarks
   * - Accepts both scalar and array params.
   * - Applies scalar range policy (`'reject' | 'clamp'`).
   * - Validates array types/lengths.
   * - Commits all changes under a single PU publish.
   */
  hydrate(patch: HydratePatch<S>): void;

  /**
   * Full snapshot of all params.
   */
  snapshot(): ParamsSnapshot<S>;

  /**
   * Snapshot for a selected set of param keys, with optional `into` buffers.
   *
   * @remarks
   * - Keys are provided as an array.
   * - `options.into` enables zero-alloc snapshots for arrays.
   */
  snapshot<const K extends readonly ParamKeys<S>[]>(
    keys: K,
    options?: SnapshotParamsOptions<S, K>,
  ): SnapshotParamsObject<S, K>;

  /**
   * Snapshot for a selected set of param keys, or for a `{ keys, into }` options object.
   *
   * @remarks
   * - When passed an array, behaves like the array overload.
   * - When passed `{ keys, into }`, performs a zero-alloc snapshot where possible.
   */
  snapshot<const K extends readonly ParamKeys<S>[]>(
    keysOrOptions:
      | K
      | {
          readonly keys: K;
          readonly into?: IntoForParams<S, K>;
        },
  ): SnapshotParamsObject<S, K>;

  /**
   * Full snapshot that reuses user-provided buffers for array params.
   *
   * @remarks
   * - `options.into` must supply buffers for array params.
   * - Scalars are always copied by value.
   */
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  snapshot(options: {
    readonly into: IntoForParams<S, readonly ParamKeys<S>[]>;
  }): ParamsSnapshot<S>;

  /**
   * Current PU sequence number for the binding.
   */
  version(): PUSeq;
}

/**
 * Controller-side meter operations.
 *
 * @remarks
 * - `snapshot` overloads for full and partial meter snapshots (with optional `into`).
 * - `version` exposes the current MU sequence.
 */
export interface ControllerMeters<S extends SpecInput> {
  /**
   * Full snapshot of all meters.
   */
  snapshot(): MetersSnapshot<S>;

  /**
   * Snapshot for a selected set of meter keys, with optional `into` buffers.
   *
   * @remarks
   * - Keys are provided as an array.
   * - `options.into` enables zero-alloc snapshots for arrays.
   */
  snapshot<const K extends readonly MeterKeys<S>[]>(
    keys: K,
    options?: SnapshotMetersOptions<S, K>,
  ): SnapshotMetersObject<S, K>;

  /**
   * Varargs snapshot overload for convenience.
   *
   * @remarks
   * - `snapshot('rms', 'peak')` form.
   */
  snapshot<const K extends readonly MeterKeys<S>[]>(
    ...keys: K
  ): SnapshotMetersObject<S, K>;

  /**
   * Snapshot for a selected set of meter keys, or for a `{ keys, into }` options object.
   *
   * @remarks
   * - When passed an array, behaves like the array overload.
   * - When passed `{ keys, into }`, performs a zero-alloc snapshot where possible.
   */
  snapshot<const K extends readonly MeterKeys<S>[]>(
    keysOrOptions:
      | K
      | {
          readonly keys: K;
          readonly into?: IntoForMeters<S, K>;
        },
  ): SnapshotMetersObject<S, K>;

  /**
   * Full snapshot that reuses user-provided buffers for array meters.
   *
   * @remarks
   * - `options.into` must supply buffers for array meters.
   * - Scalars are always copied by value.
   */
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  snapshot(options: {
    readonly into: IntoForMeters<S, readonly MeterKeys<S>[]>;
  }): MetersSnapshot<S>;

  /**
   * Current MU sequence number for the binding.
   */
  version(): MUSeq;
}

type MeterScalarFor<S extends SpecInput, K extends MeterKeys<S>> = NonNullable<
  S["meters"]
>[K] extends {
  kind: "bool";
}
  ? boolean
  : number;

type MeterArrayFor<S extends SpecInput, K extends MeterKeys<S>> = NonNullable<
  S["meters"]
>[K] extends {
  kind: "f32.array";
}
  ? Float32Array
  : NonNullable<S["meters"]>[K] extends {
        kind: "f64.array";
      }
    ? Float64Array
    : NonNullable<S["meters"]>[K] extends {
          kind: "u32.array";
        }
      ? Uint32Array
      : NonNullable<S["meters"]>[K] extends { kind: "bool.array" }
        ? Uint8Array
        : never;

/**
 * Writer used inside `processor.meters.publish(...)`.
 *
 * @remarks
 * - Scalar meters:
 *   ```ts
 *   writer.level(0.75);        // direct, hot-path
 *   writer.set('level', 0.75); // dynamic, key-driven
 *   ```
 * - Array meters:
 *   ```ts
 *   writer.stage('spectrum', (dest) => {
 *     dest.set(spectrumSource);
 *   });
 *   ```
 *
 * Arrays are intentionally stage-only:
 *
 * - There is no `set('spectrum', fn)` overload.
 * - The array write path is explicit: publish → stage → dest.set.
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
   * @remarks
   * - The callback receives a view that is valid only for the duration of
   *   the enclosing `publish(...)` call.
   */
  stage<const K extends ArrayMeterKeys<S>>(
    key: K,
    callback: (destination: Ephemeral<MeterArrayFor<S, K>>) => void,
  ): void;

  /**
   * Dynamic scalar setter.
   *
   * @example
   * ```ts
   * const key: 'rms' | 'peak' = decideKey();
   * writer.set(key, 0.5);
   * ```
   */
  set<K extends ScalarMeterKeys<S>>(key: K, value: MeterScalarFor<S, K>): void;
};

/**
 * Processor-side param binding.
 *
 * @remarks
 * - `within` exposes a seqlock-protected view of all params.
 * - `version` exposes the current PU sequence.
 */
export interface ProcessorParams<S extends SpecInput> {
  /**
   * Read parameters within a seqlock-protected critical section.
   *
   * @remarks
   * - The view provides:
   *   - Scalar params as coherent values (atomic read guarantee).
   *   - Array params as ephemeral typed arrays (callback-scoped).
   */
  within(callback: (view: ProcessorParamsView<S>) => void): void;

  /**
   * Current PU sequence number for the binding.
   */
  version(): PUSeq;
}

/**
 * Processor-side meter binding.
 *
 * @remarks
 * - `publish` exposes a seqlock-protected writer for meters.
 * - `version` exposes the current MU sequence.
 */
export interface ProcessorMeters<S extends SpecInput> {
  /**
   * Publish meter values within a seqlock-protected critical section.
   *
   * @remarks
   * - The writer provides:
   *   - Direct scalar setters (e.g. `writer.rms(0.5)`).
   *   - `set(key, value)` as dynamic scalar sugar.
   *   - `stage(key, dest => ...)` for array meters.
   *
   * Array meters are stage-only; there is no `set(key, fn)` array overload.
   */
  publish<T>(callback: (writer: MeterWriter<S>) => T): T;

  /**
   * Current MU sequence number for the binding.
   */
  version(): MUSeq;
}

/**
 * Full controller-visible snapshot of all params.
 */
export type ParamsSnapshot<S extends SpecInput> = Readonly<
  Display<{ [K in ParamKeys<S>]: ParamValueFor<S, K> }>
>;

/**
 * Full controller-visible snapshot of all meters.
 */
export type MetersSnapshot<S extends SpecInput> = Readonly<
  Display<{ [K in MeterKeys<S>]: MeterValueFor<S, K> }>
>;

type ParamSnapshotKeys<
  S extends SpecInput,
  KS extends readonly ParamKeys<S>[],
> = Extract<KS[number], ParamKeys<S>>;
type MeterSnapshotKeys<
  S extends SpecInput,
  KS extends readonly MeterKeys<S>[],
> = Extract<KS[number], MeterKeys<S>>;

/**
 * Controller-visible partial snapshot object for params.
 *
 * @remarks
 * - Keys correspond to the requested subset.
 */
export type SnapshotParamsObject<
  S extends SpecInput,
  KS extends readonly ParamKeys<S>[],
> = Readonly<Display<{ [K in ParamSnapshotKeys<S, KS>]: ParamValueFor<S, K> }>>;

/**
 * Controller-visible partial snapshot object for meters.
 *
 * @remarks
 * - Keys correspond to the requested subset.
 */
export type SnapshotMetersObject<
  S extends SpecInput,
  KS extends readonly MeterKeys<S>[],
> = Readonly<Display<{ [K in MeterSnapshotKeys<S, KS>]: MeterValueFor<S, K> }>>;

/**
 * Configuration for a seqlock-protected read in an Observer context.
 */
export interface ObserverCoherentOptions {
  readonly where?: string;
  readonly spinBudget?: number;
  readonly retryBudget?: number;
  readonly degrade?: MeterDegradePolicy;
}

/**
 * Options for binding an observer.
 *
 * @remarks
 * - Configures retry budgets for both param and meter reads.
 * - Observers are strictly read-only.
 */
export interface ObserverOptions {
  readonly spinBudget?: number;
  readonly retryBudget?: number;
  readonly degrade?: MeterDegradePolicy;
  readonly params?: ObserverCoherentOptions;
  readonly meters?: ObserverCoherentOptions;
}

/**
 * Observer-side param binding.
 *
 * @remarks
 * - `snapshot()` / `snapshot(keys)` expose controller-like snapshots for
 *   convenience; array values may be backed by ephemeral views.
 * - `within(...)` mirrors `processor.params.within` for hot-path, zero-copy reads.
 */
export interface ObserverParams<S extends SpecInput> {
  /**
   * Full snapshot of all params.
   */
  snapshot(): ParamsSnapshot<S>;

  /**
   * Snapshot for a selected set of param keys (array form).
   *
   * @remarks
   * - `snapshot(['gain', 'mode'])` form.
   */
  snapshot<const K extends readonly ParamKeys<S>[]>(
    keys: K,
  ): SnapshotParamsObject<S, K>;

  /**
   * Varargs snapshot overload for convenience.
   *
   * @remarks
   * - `snapshot('gain', 'mode')` form.
   */
  snapshot<const K extends readonly ParamKeys<S>[]>(
    ...keys: K
  ): SnapshotParamsObject<S, K>;

  /**
   * Snapshot for a selected set of param keys, or for a `{ keys }` options object.
   *
   * @remarks
   * - When passed an array, behaves like the array overload.
   * - When passed `{ keys }`, behaves the same, but allows future extension
   *   without breaking callers.
   */
  snapshot<const K extends readonly ParamKeys<S>[]>(
    // eslint-disable-next-line @typescript-eslint/unified-signatures
    keysOrOptions:
      | K
      | {
          readonly keys: K;
        },
  ): SnapshotParamsObject<S, K>;

  /**
   * Read parameters within a seqlock-protected critical section.
   */
  within(callback: (view: ProcessorParamsView<S>) => void): void;

  /**
   * Current PU sequence number for this observer.
   */
  version(): PUSeq;
}

/**
 * Observer-side meter binding.
 *
 * @remarks
 * - Exposes the same snapshot ergonomics as `ControllerMeters`, but:
 *   - No `into` support (arrays are ephemeral views into backing planes).
 *   - Strictly read-only; no publish/write surface.
 */
export interface ObserverMeters<S extends SpecInput> {
  /**
   * Full snapshot of all meters.
   */
  snapshot(): MetersSnapshot<S>;

  /**
   * Snapshot for a selected set of meter keys (array form).
   *
   * @remarks
   * - `snapshot(['rms', 'peak'])` form.
   */
  snapshot<const K extends readonly MeterKeys<S>[]>(
    keys: K,
  ): SnapshotMetersObject<S, K>;

  /**
   * Varargs snapshot overload for convenience.
   *
   * @remarks
   * - `snapshot('rms', 'peak')` form.
   */
  snapshot<const K extends readonly MeterKeys<S>[]>(
    ...keys: K
  ): SnapshotMetersObject<S, K>;

  /**
   * Snapshot for a selected set of meter keys, or for a `{ keys }` options object.
   *
   * @remarks
   * - When passed an array, behaves like the array overload.
   * - When passed `{ keys }`, behaves the same, but allows future extension
   *   (e.g. observer-specific options) without breaking callers.
   */
  snapshot<const K extends readonly MeterKeys<S>[]>(
    // eslint-disable-next-line @typescript-eslint/unified-signatures
    keysOrOptions:
      | K
      | {
          readonly keys: K;
        },
  ): SnapshotMetersObject<S, K>;

  /**
   * Current MU sequence number.
   */
  version(): MUSeq;
}

/**
 * Observer binding: read-only facade for params and meters.
 *
 * @remarks
 * - Intended for visualizations, introspect, HUDs, and remote inspectors.
 * - `params` exposes coherent reads via `within(...)` and small snapshots.
 * - `meters` exposes coherent snapshots with rich overloads.
 * - No write capability.
 */
export interface ObserverBinding<S extends SpecInput> {
  readonly params: ObserverParams<S>;
  readonly meters: ObserverMeters<S>;

  dispose(): void;
}
