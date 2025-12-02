/**
 * @fileoverview
 * Enum helpers shared across bindings.
 *
 * @remarks
 * - Centralizes enum definition helpers to avoid duplication between
 *   controller/observer bindings and other modules.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

import type { ParamDef } from "../../spec/types";

export type EnumDef = Extract<ParamDef, { kind: "enum" }>;

export function isEnumDef(d: unknown): d is EnumDef {
  return isObject(d) && d.kind === "enum" && Array.isArray(d.values);
}

export function getEnumLabelForIndex(def: EnumDef, idx: number): string {
  const i = idx | 0;
  const v = def.values[i];
  return typeof v === "string" ? v : String(i);
}
