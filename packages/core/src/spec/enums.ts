/**
 * @fileoverview
 * Enum helpers for specs.
 *
 * @remarks
 * - Enums exist on **params** and **meters** (`kind: "enum"` / `"enum.array"`).
 * - Intended for UI/tools/tests (not RT hot paths).
 */

import { createSpecError, type SpecEnumDetails } from "../errors/spec";

import type { MetersOf, ParamsOf , CanonicalSpec } from "./types";

export type EnumKeyOf<S extends CanonicalSpec> = {
  [K in Extract<keyof ParamsOf<S>, string>]: ParamsOf<S>[K] extends {
    readonly kind: "enum" | "enum.array";
    readonly values: readonly string[];
  }
    ? K
    : never;
}[Extract<keyof ParamsOf<S>, string>];

export type EnumMeterKeyOf<S extends CanonicalSpec> = {
  [K in Extract<keyof MetersOf<S>, string>]: MetersOf<S>[K] extends {
    readonly kind: "enum" | "enum.array";
    readonly values: readonly string[];
  }
    ? K
    : never;
}[Extract<keyof MetersOf<S>, string>];

export type EnumLabel<
  S extends CanonicalSpec,
  K extends EnumKeyOf<S>,
> = ParamsOf<S>[K] extends { readonly values: readonly (infer L)[] }
  ? Extract<L, string>
  : never;

export type EnumLabelMaybe<S extends CanonicalSpec, K extends EnumKeyOf<S>> =
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  EnumLabel<S, K> | undefined;

export type EnumMeterLabel<
  S extends CanonicalSpec,
  K extends EnumMeterKeyOf<S>,
> = MetersOf<S>[K] extends { readonly values: readonly (infer L)[] }
  ? Extract<L, string>
  : never;

export type EnumMeterLabelMaybe<
  S extends CanonicalSpec,
  K extends EnumMeterKeyOf<S>,
> =
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  EnumMeterLabel<S, K> | undefined;

interface EnumDefLike {
  readonly kind?: string;
  readonly values?: readonly string[];
}

function getEnumDef(
  spec: CanonicalSpec,
  scope: "params" | "meters",
  key: string,
): EnumDefLike {
  const root =
    scope === "params"
      ? (spec.params as Record<string, unknown> | undefined)
      : (spec.meters as Record<string, unknown> | undefined);

  const def = (root?.[key] ?? undefined) as EnumDefLike | undefined;

  if (
    !def ||
    !Array.isArray(def.values) ||
    (def.kind !== "enum" && def.kind !== "enum.array")
  ) {
    throw createSpecError("builderInvalid", {
      key,
      reason: "invalidKind",
    });
  }

  return def;
}

/* params */

export function enumValues<S extends CanonicalSpec, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
): readonly EnumLabel<S, K>[] {
  const def = getEnumDef(spec, "params", key);
  return def.values as readonly EnumLabel<S, K>[];
}

export function enumIndexFromLabel<
  S extends CanonicalSpec,
  K extends EnumKeyOf<S>,
>(spec: S, key: K, label: EnumLabel<S, K>): number {
  const values = enumValues<S, K>(spec, key);
  return values.indexOf(label);
}

export function enumLabelFromIndex<
  S extends CanonicalSpec,
  K extends EnumKeyOf<S>,
>(spec: S, key: K, index: number): EnumLabelMaybe<S, K> {
  const values = enumValues<S, K>(spec, key);
  return values[index];
}

export function enumArrayToLabels<
  S extends CanonicalSpec,
  K extends EnumKeyOf<S>,
>(spec: S, key: K, indices: Int32Array): EnumLabel<S, K>[] {
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

export function enumLabelsToArray<
  S extends CanonicalSpec,
  K extends EnumKeyOf<S>,
>(spec: S, key: K, labels: readonly EnumLabel<S, K>[]): Int32Array {
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

export function enumPaletteFor<S extends CanonicalSpec, K extends EnumKeyOf<S>>(
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

export function enumGuardFor<S extends CanonicalSpec, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
): (raw: string) => raw is EnumLabel<S, K> {
  const valuesSet = new Set(enumValues<S, K>(spec, key));
  return (raw: string): raw is EnumLabel<S, K> =>
    (valuesSet as Set<string>).has(raw);
}

/* meters */

export function meterEnumValues<
  S extends CanonicalSpec,
  K extends EnumMeterKeyOf<S>,
>(spec: S, key: K): readonly EnumMeterLabel<S, K>[] {
  const def = getEnumDef(spec, "meters", key);
  return def.values as readonly EnumMeterLabel<S, K>[];
}

export function meterEnumIndexFromLabel<
  S extends CanonicalSpec,
  K extends EnumMeterKeyOf<S>,
>(spec: S, key: K, label: EnumMeterLabel<S, K>): number {
  const values = meterEnumValues<S, K>(spec, key);
  return values.indexOf(label);
}

export function meterEnumLabelFromIndex<
  S extends CanonicalSpec,
  K extends EnumMeterKeyOf<S>,
>(spec: S, key: K, index: number): EnumMeterLabelMaybe<S, K> {
  const values = meterEnumValues<S, K>(spec, key);
  return values[index];
}

export function meterEnumArrayToLabels<
  S extends CanonicalSpec,
  K extends EnumMeterKeyOf<S>,
>(spec: S, key: K, indices: Int32Array): EnumMeterLabel<S, K>[] {
  const values = meterEnumValues<S, K>(spec, key);
  const out: EnumMeterLabel<S, K>[] = [];

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

export function meterEnumLabelsToArray<
  S extends CanonicalSpec,
  K extends EnumMeterKeyOf<S>,
>(spec: S, key: K, labels: readonly EnumMeterLabel<S, K>[]): Int32Array {
  const values = meterEnumValues<S, K>(spec, key);
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

export function meterEnumPaletteFor<
  S extends CanonicalSpec,
  K extends EnumMeterKeyOf<S>,
>(
  spec: S,
  key: K,
): {
  values: readonly EnumMeterLabel<S, K>[];
  indexFrom(label: EnumMeterLabel<S, K>): number;
  labelFrom(index: number): EnumMeterLabelMaybe<S, K>;
} {
  const values = meterEnumValues<S, K>(spec, key);

  return {
    values,
    indexFrom(label: EnumMeterLabel<S, K>): number {
      return values.indexOf(label);
    },
    labelFrom(index: number): EnumMeterLabelMaybe<S, K> {
      return values[index];
    },
  };
}

export function meterEnumGuardFor<
  S extends CanonicalSpec,
  K extends EnumMeterKeyOf<S>,
>(spec: S, key: K): (raw: string) => raw is EnumMeterLabel<S, K> {
  const valuesSet = new Set(meterEnumValues<S, K>(spec, key));
  return (raw: string): raw is EnumMeterLabel<S, K> =>
    (valuesSet as Set<string>).has(raw);
}
