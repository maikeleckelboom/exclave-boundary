/**
 * @fileoverview
 * Enum helpers used by bindings.
 *
 * @remarks
 * A host-side binding may choose to surface enum labels (strings) when the Spec is available.
 * Remote-side bindings typically only have numeric values and can optionally map them using
 * the enum tables carried in the Spec.
 */

import type { ParamDef } from "../../spec/types";

type ObjectRecord = Record<string, unknown>;

function isObject(value: unknown): value is ObjectRecord {
  return value !== null && typeof value === "object";
}

/**
 * Param definition for scalar enums.
 */
export type EnumDef = Extract<ParamDef, { kind: "enum" }>;

/**
 * Runtime guard for `EnumDef`.
 *
 * @remarks
 * Used for safe label mapping in non-TS entrypoints / dynamic consumers.
 */
export function isEnumDef(d: unknown): d is EnumDef {
  return isObject(d) && d.kind === "enum" && Array.isArray(d.values);
}

/**
 * Returns the label for an enum index, falling back to the numeric string.
 */
export function getEnumLabelForIndex(def: EnumDef, idx: number): string {
  const i = idx | 0;
  const v = def.values[i];
  return typeof v === "string" ? v : String(i);
}
