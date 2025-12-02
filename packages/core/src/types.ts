import type {
  MeterShape,
  MeterValueFor,
  ParamShape,
  ParamValueFor,
} from "./binding/common/types";
import type { MeterKeys, ParamKeys, SpecInput } from "./spec/types";

/**
 * All controller-visible param values for a spec.
 *
 * - Scalars are plain JS numbers/booleans.
 * - Enums are *label unions* (e.g. `'normal' | 'granular'`).
 * - Arrays are readonly views.
 *
 * @typeParam S - The spec input produced by {@link defineSpec}.
 *
 * @example
 * const spec = defineSpec(/* ... *\/);
 * type Spec = typeof spec;
 *
 * type AllParams = ParamValues<Spec>;
 * // AllParams:
 * // {
 * //   gain: number;
 * //   mode: 'normal' | 'granular';
 * //   spectrum: readonly number[];
 * //   ...
 * // }
 */
export type ParamValues<S extends SpecInput> = {
  [K in ParamKeys<S>]: ParamValueFor<S, K>;
};

/**
 * All controller-visible meter values for a spec.
 *
 * - Scalars are plain JS numbers.
 * - Arrays are readonly views.
 *
 * @typeParam S - The spec input produced by {@link defineSpec}.
 *
 * @example
 * const spec = defineSpec(/* ... *\/);
 * type Spec = typeof spec;
 *
 * type AllMeters = MeterValues<Spec>;
 * // AllMeters:
 * // {
 * //   engineFps: number;
 * //   workMs: number;
 * //   spectrum: readonly number[];
 * //   ...
 * // }
 */
export type MeterValues<S extends SpecInput> = {
  [K in MeterKeys<S>]: MeterValueFor<S, K>;
};

/**
 * Processor-side coherent param view.
 *
 * This is the type you see inside `params.within()` on the processor:
 * scalars are plain numbers/booleans, arrays are *mutable scratch views*
 * backed by the shared memory.
 *
 * @typeParam S - The spec input produced by {@link defineSpec}.
 *
 * @example
 * const spec = defineSpec(/* ... *\/);
 * type Spec = typeof spec;
 *
 * // In an AudioWorklet / worker:
 * params.within((view: ProcessorParamView<Spec>) => {
 *   const gain = view.gain;
 *   const spectrum = view.spectrum; // Float32Array scratch view
 * });
 */
export type ProcessorParamView<S extends SpecInput> = ParamShape<S>;

/**
 * Processor-side coherent meter view.
 *
 * This is the type you see inside `meters.publish()` on the processor:
 * scalars are writer functions, arrays are scratch views for bulk writes.
 *
 * @typeParam S - The spec input produced by {@link defineSpec}.
 *
 * @example
 * const spec = defineSpec(/* ... *\/);
 * type Spec = typeof spec;
 *
 * meters.publish((view: ProcessorMeterView<Spec>) => {
 *   view.engineFps(60);
 *   const spectrum = view.spectrum;
 *   // write into `spectrum` here
 * });
 */
export type ProcessorMeterView<S extends SpecInput> = MeterShape<S>;

/**
 * Shape of a param snapshot constrained to a key list.
 *
 * When used with a single type parameter, `SnapshotOf<S>` describes the
 * *full* param snapshot shape for the spec.
 *
 * When used with an explicit key tuple, `SnapshotOf<S, K>` narrows to just
 * those keys. This mirrors the shape returned by `params.snapshot({ keys })`.
 *
 * @typeParam S - The spec input produced by {@link defineSpec}.
 * @typeParam K - Readonly tuple of param keys for `S`. Defaults to all keys.
 *
 * @example
 * const spec = defineSpec(/* ... *\/);
 * type Spec = typeof spec;
 *
 * // Full snapshot (all params):
 * type ParamsSnapshot = SnapshotOf<Spec>;
 *
 * // Partial snapshot for specific params:
 * type GainAndModeSnapshot = SnapshotOf<Spec, ['gain', 'mode']>;
 * // {
 * //   gain: number;
 * //   mode: 'normal' | 'granular';
 * // }
 */
export type SnapshotOf<
  S extends SpecInput,
  K extends readonly ParamKeys<S>[] = readonly ParamKeys<S>[],
> = {
  [P in K[number]]: ParamValueFor<S, P>;
};

/**
 * Shape of a meter snapshot constrained to a key list.
 *
 * When used with a single type parameter, `SnapshotMetersOf<S>` describes
 * the *full* meter snapshot shape for the spec.
 *
 * Values are `T | undefined` because meter snapshots are allowed to be
 * partially populated (e.g. on startup or after resets).
 *
 * When used with an explicit key tuple, `SnapshotMetersOf<S, K>` narrows to
 * just those keys. This mirrors the shape returned by `meters.snapshot({ keys })`.
 *
 * @typeParam S - The spec input produced by {@link defineSpec}.
 * @typeParam K - Readonly tuple of meter keys for `S`. Defaults to all keys.
 *
 * @example
 * const spec = defineSpec(/* ... *\/);
 * type Spec = typeof spec;
 *
 * // Full meter snapshot (all meters):
 * type MetersSnapshot = SnapshotMetersOf<Spec>;
 *
 * // Partial snapshot for a HUD:
 * type HudMetersSnapshot = SnapshotMetersOf<Spec, ['engineFps', 'workMs']>;
 * // {
 * //   engineFps: number | undefined;
 * //   workMs: number | undefined;
 * // }
 */
export type SnapshotMetersOf<
  S extends SpecInput,
  K extends readonly MeterKeys<S>[] = readonly MeterKeys<S>[],
> = {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  [P in K[number]]: MeterValueFor<S, P> | undefined;
};
