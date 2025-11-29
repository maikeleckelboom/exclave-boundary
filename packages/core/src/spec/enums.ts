/**
 * @fileoverview
 * Enum utilities for spec definitions.
 *
 * @remarks
 * - Provides type-safe operations for enum params and meters.
 * - Includes conversion between labels and indices, bounds checking, and validation.
 * - Offers UI-friendly helpers for dropdowns, cycling, and palette generation.
 */

import { createSpecError, type SpecEnumDetails } from "../errors/spec";

import type { SpecInput } from "./types";

/**
 * Keys that can meaningfully refer to params or meters.
 */
export type EnumKeyOf<S extends SpecInput> =
  | Extract<keyof S["params"], string>
  | Extract<keyof S["meters"], string>;

/**
 * Infer the enum label union for a given spec + key.
 *
 * Works for both params and meters, and for both scalar `enum` and `enum.array`.
 * We explicitly constrain labels to `string` so they are compatible with
 * SpecEnumDetails.values (readonly string[]).
 */
export type EnumLabel<
  S extends SpecInput,
  K extends EnumKeyOf<S>,
> = K extends keyof S["params"]
  ? S["params"][K] extends {
      values: readonly (infer L)[];
    }
    ? L extends string
      ? L
      : never
    : never
  : K extends keyof S["meters"]
    ? S["meters"][K] extends {
        values: readonly (infer L)[];
      }
      ? L extends string
        ? L
        : never
      : never
    : never;

/**
 * Optional enum label (used for out-of-range index lookups).
 *
 * eslint currently mis-detects this generic union as "redundant", so we
 * locally disable the rule here instead of weakening the return types.
 */
export type EnumLabelMaybe<S extends SpecInput, K extends EnumKeyOf<S>> =
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  EnumLabel<S, K> | undefined;

/**
 * Internal structural shape we expect for enum / enum.array defs.
 */
interface EnumDefLike {
  readonly kind?: string;
  readonly values?: readonly string[];
}

/**
 * Locate the enum (or enum.array) definition for a given key.
 *
 * @remarks
 * - We do a very light structural check and throw if the key is not an enum-ish
 *   definition. This is not on the hot path; it's intended for tools, tests,
 *   and controller-side ergonomics.
 */
function getEnumDef(spec: SpecInput, key: string): EnumDefLike {
  const fromParams = spec.params as Record<string, unknown>;
  const fromMeters = spec.meters as Record<string, unknown>;

  const def = (fromParams[key] ?? fromMeters[key]) as EnumDefLike | undefined;

  if (!def || !Array.isArray(def.values)) {
    // Programmer error: wrong key for these helpers.
    // We keep this as a plain Error instead of a SeqlokError.
    throw new Error(`Key ${key} is not an enum / enum.array in this spec`);
  }

  // could tighten this to check kind === 'enum' | 'enum.array'
  return def;
}

/**
 * Get the enum vocabulary (`values`) for a given key.
 *
 * @example
 * ```ts
 * type Spec = typeof spec;
 * const values = enumValues<Spec, 'padStates'>(spec, 'padStates');
 * //    ^? readonly ('off' | 'dim' | 'full')[]
 * ```
 *
 * @remarks
 * - Not for RT hot paths; intended for UI/tools/tests.
 */
export function enumValues<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
): readonly EnumLabel<S, K>[] {
  const def = getEnumDef(spec, key);
  // EnumLabel<S, K> is always string, so this cast is safe.
  return def.values as readonly EnumLabel<S, K>[];
}

/**
 * Map a label to its index for a given enum key.
 *
 * @returns
 * - `0..N-1` when the label exists
 * - `-1` when it does not
 *
 * @remarks
 * - Not for RT hot paths; intended for UI/tools/tests.
 */
export function enumIndexFromLabel<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
  label: EnumLabel<S, K>,
): number {
  const values = enumValues<S, K>(spec, key);
  return values.indexOf(label);
}

/**
 * Map an index back to its label for a given enum key.
 *
 * @returns
 * - the label when `0 ≤ index < values.length`
 * - `undefined` otherwise
 *
 * @remarks
 * - Not for RT hot paths; intended for controller/tools/tests.
 */
export function enumLabelFromIndex<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
  index: number,
): EnumLabelMaybe<S, K> {
  const values = enumValues<S, K>(spec, key);
  return values[index];
}

/**
 * Convert an `Int32Array` of enum indices into labels, with bounds checking.
 *
 * @remarks
 * - Perfect for tests, debug tools, and inspectors.
 * - If you hit an out-of-range index, we throw a typed `spec.enumInvalid`
 *   error — that's either a spec/codec bug or memory corruption.
 */
export function enumArrayToLabels<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
  indices: Int32Array,
): EnumLabel<S, K>[] {
  const values = enumValues<S, K>(spec, key);
  const out: EnumLabel<S, K>[] = [];

  for (const idx of indices) {
    const label = values[idx];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (label === undefined) {
      throw createSpecError("enumInvalid", {
        key,
        values,
        invalidIndex: idx,
      } satisfies SpecEnumDetails);
    }

    out.push(label);
  }

  return out;
}

/**
 * Convert an array of enum labels into an `Int32Array` of indices.
 *
 * @remarks
 * - Intended for fixtures, tests, tools, and occasional controller usage.
 * - If you hit an unknown label, we throw a typed `spec.enumInvalid` error.
 */
export function enumLabelsToArray<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
  labels: readonly EnumLabel<S, K>[],
): Int32Array {
  const values = enumValues<S, K>(spec, key);
  const out = new Int32Array(labels.length);

  labels.forEach((label, i) => {
    const idx = values.indexOf(label);
    if (idx === -1) {
      throw createSpecError("enumInvalid", {
        key,
        values,
        received: label,
      } satisfies SpecEnumDetails);
    }
    out[i] = idx;
  });

  return out;
}

/**
 * Build a tiny "palette" helper for a single enum key.
 *
 * @example
 * ```ts
 * const padStates = enumPaletteFor<Spec, 'padStates'>(spec, 'padStates');
 *
 * padStates.values;               // readonly ('off'|'dim'|'full')[]
 * padStates.indexFrom('dim');     // 1
 * padStates.labelFrom(2);         // 'full' | undefined
 * ```
 *
 * @remarks
 * - Not for RT hot paths; intended for UI/tools/tests.
 */
export function enumPaletteFor<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
): {
  values: readonly EnumLabel<S, K>[];
  indexFrom(label: EnumLabel<S, K>): number;
  labelFrom(index: number): EnumLabelMaybe<S, K>;
} {
  const values = enumValues<S, K>(spec, key);

  return {
    values,
    indexFrom(label: EnumLabel<S, K>): number {
      return values.indexOf(label);
    },
    labelFrom(index: number): EnumLabelMaybe<S, K> {
      return values[index];
    },
  };
}

/**
 * Create a type-safe guard predicate for an enum key.
 *
 * @example
 * ```ts
 * type Spec = typeof spec;
 * const isSimMode = enumGuardFor<Spec, 'simMode'>(spec, 'simMode');
 *
 * function parseFromUrl(raw: string | null): SimMode | undefined {
 *   if (!raw) return undefined;
 *   return isSimMode(raw) ? raw : undefined;
 * }
 * ```
 *
 * @remarks
 * - Perfect for parsing URL params, JSON configs, user input, etc.
 * - Returns a type guard that narrows `string` → `EnumLabel<S, K>`.
 * - Not for RT hot paths; intended for controller/tools/UI.
 */
export function enumGuardFor<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
): (raw: string) => raw is EnumLabel<S, K> {
  const valuesSet = new Set(enumValues<S, K>(spec, key));
  return (raw: string): raw is EnumLabel<S, K> =>
    (valuesSet as Set<string>).has(raw);
}

/**
 * Helper for cycling through enum values with wrapping.
 */
export interface EnumCycle<S extends SpecInput, K extends EnumKeyOf<S>> {
  readonly values: readonly EnumLabel<S, K>[];
  next(current: EnumLabel<S, K>): EnumLabel<S, K>;
  prev(current: EnumLabel<S, K>): EnumLabel<S, K>;
}

/**
 * Create a cycling helper for an enum key.
 *
 * @example
 * ```ts
 * type Spec = typeof spec;
 * const simModeCycle = enumCycleFor<Spec, 'simMode'>(spec, 'simMode');
 *
 * // In keyboard handler:
 * const { simMode } = ctl.params.snapshot(['simMode']);
 * ctl.params.update({ simMode: simModeCycle.next(simMode) });
 * ```
 *
 * @remarks
 * - Provides `next` and `prev` methods that wrap around at boundaries.
 * - Ideal for keyboard shortcuts, pad toggles, or UI cycling.
 * - Falls back to first value if current value is out of vocabulary.
 * - Not for RT hot paths; intended for controller/UI interactions.
 */
export function enumCycleFor<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
): EnumCycle<S, K> {
  const values = enumValues<S, K>(spec, key);

  const next = (current: EnumLabel<S, K>): EnumLabel<S, K> => {
    const idx = values.indexOf(current);
    if (idx === -1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return values[0]!;
    }
    const nextIndex = (idx + 1) % values.length;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return values[nextIndex]!;
  };

  const prev = (current: EnumLabel<S, K>): EnumLabel<S, K> => {
    const idx = values.indexOf(current);
    if (idx === -1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return values[0]!;
    }
    const prevIndex = (idx - 1 + values.length) % values.length;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return values[prevIndex]!;
  };

  return { values, next, prev };
}

/**
 * Build a fully populated record mapping enum labels to arbitrary values.
 *
 * @example
 * ```ts
 * type Spec = typeof spec;
 * type DynamicsLabel = Spec['params']['dynamics']['values'][number];
 *
 * const DYNAMICS_COLOR: Record<DynamicsLabel, string> = enumRecordFor<
 *   Spec,
 *   'dynamics',
 *   string
 * >(spec, 'dynamics', (_label, index) => {
 *   const hues = [220, 45, 10];
 *   const hue = hues[index % hues.length] ?? 220;
 *   return `hsl(${hue} 90% 55%)`;
 * });
 * ```
 *
 * @remarks
 * - Guarantees all enum values are mapped (exhaustiveness).
 * - Useful for color palettes, velocity scaling, keybindings, etc.
 * - Init function receives both label and index for flexible mapping.
 * - Not for RT hot paths; intended for setup/configuration.
 */
export function enumRecordFor<S extends SpecInput, K extends EnumKeyOf<S>, T>(
  spec: S,
  key: K,
  init: (label: EnumLabel<S, K>, index: number) => T,
): Record<EnumLabel<S, K>, T> {
  const values = enumValues<S, K>(spec, key);
  const out: Partial<Record<EnumLabel<S, K>, T>> = {};

  values.forEach((label, index) => {
    out[label] = init(label, index);
  });

  return out as Record<EnumLabel<S, K>, T>;
}

/**
 * Option shape for UI libraries (React, Vue, Svelte, etc.).
 */
export interface EnumOption<L extends string> {
  readonly value: L;
  readonly label: string;
}

/**
 * Generate an array of options for UI select/dropdown components.
 *
 * @example
 * ```ts
 * type Spec = typeof spec;
 * const options = enumOptionsFor<Spec, 'simMode'>(
 *   spec,
 *   'simMode',
 *   (mode) => mode.toUpperCase()
 * );
 * // [{ value: 'basic', label: 'BASIC' }, ...]
 *
 * // In React:
 * <select>
 *   {options.map(opt => (
 *     <option key={opt.value} value={opt.value}>{opt.label}</option>
 *   ))}
 * </select>
 * ```
 *
 * @remarks
 * - Framework-agnostic; works with any UI library expecting `{value, label}`.
 * - Optional `transform` function transforms labels for display.
 * - Defaults to using raw label as display label if `transform` is omitted.
 * - Not for RT hot paths; intended for UI setup.
 */
export function enumOptionsFor<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
  transform?: (label: EnumLabel<S, K>) => string,
): EnumOption<EnumLabel<S, K>>[] {
  const values = enumValues<S, K>(spec, key);
  const format = transform ?? ((l) => l);

  return values.map((value) => ({
    value,
    label: format(value),
  }));
}
