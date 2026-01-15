// File: packages/core/src/spec/kinds.ts

/**
 * @fileoverview
 * Kind catalogs: maps DSL kind strings to plane + element metadata.
 *
 * @remarks
 * These catalogs are intentionally allowed to be partial while we slice changes
 * safely. If a kind is missing here, the planner rejects it early with a clear
 * error. Adding an entry here is the switch that “turns on” support for a kind.
 */

import type { ParamDef, MeterDef } from "./types";
import type { PlaneKey } from "@seqlok/primitives";

export type ParamKind = ParamDef["kind"];
export type MeterKind = MeterDef["kind"];

export type KindElem =
  | "f32"
  | "f64"
  | "i32"
  | "u32"
  | "u16"
  | "i16"
  | "u8"
  | "i8"
  | "bool"
  | "enum";

export interface KindCatalogEntry {
  readonly plane: PlaneKey;
  readonly bytesPerElement: number;
  readonly isArray: boolean;
  readonly elem: KindElem;
  readonly semantic: "number" | "bool" | "enum";
}

/**
 * Param + meter catalogs are defined separately to avoid redundant union noise in lint.
 */
export type ParamKindCatalog = Readonly<
  Partial<Record<ParamKind, KindCatalogEntry>>
>;
export type MeterKindCatalog = Readonly<
  Partial<Record<MeterKind, KindCatalogEntry>>
>;

/**
 * Param kind catalog.
 *
 * @remarks
 * Partial by design: missing kinds are rejected by the planner until explicitly enabled.
 */
export const PARAM_KIND_CATALOG: ParamKindCatalog = {
  f32: {
    plane: "PF32",
    isArray: false,
    elem: "f32",
    semantic: "number",
    bytesPerElement: 4,
  },
  i32: {
    plane: "PI32",
    isArray: false,
    elem: "i32",
    semantic: "number",
    bytesPerElement: 4,
  },

  // u32 scalar params (stored in PI32 bits; decoded as unsigned in snapshot-util)
  u32: {
    plane: "PI32",
    isArray: false,
    elem: "u32",
    semantic: "number",
    bytesPerElement: 4,
  },

  bool: {
    plane: "PB",
    isArray: false,
    elem: "bool",
    semantic: "bool",
    bytesPerElement: 1,
  },
  enum: {
    plane: "PI32",
    isArray: false,
    elem: "enum",
    semantic: "enum",
    bytesPerElement: 4,
  },

  "f32.array": {
    plane: "PF32",
    isArray: true,
    elem: "f32",
    semantic: "number",
    bytesPerElement: 4,
  },
  "i32.array": {
    plane: "PI32",
    isArray: true,
    elem: "i32",
    semantic: "number",
    bytesPerElement: 4,
  },

  "u32.array": {
    plane: "PI32",
    isArray: true,
    elem: "u32",
    semantic: "number",
    bytesPerElement: 4,
  },

  // u8.array params live in PB
  "u8.array": {
    plane: "PB",
    isArray: true,
    elem: "u8",
    semantic: "number",
    bytesPerElement: 1,
  },

  "bool.array": {
    plane: "PB",
    isArray: true,
    elem: "bool",
    semantic: "bool",
    bytesPerElement: 1,
  },
  "enum.array": {
    plane: "PI32",
    isArray: true,
    elem: "enum",
    semantic: "enum",
    bytesPerElement: 4,
  },
} as const satisfies ParamKindCatalog;

/**
 * Meter kind catalog.
 *
 * @remarks
 * Partial by design: missing kinds are rejected by the planner until explicitly enabled.
 */
export const METER_KIND_CATALOG: MeterKindCatalog = {
  f32: {
    plane: "MF32",
    isArray: false,
    elem: "f32",
    semantic: "number",
    bytesPerElement: 4,
  },
  f64: {
    plane: "MF64",
    isArray: false,
    elem: "f64",
    semantic: "number",
    bytesPerElement: 8,
  },
  u32: {
    plane: "MU32",
    isArray: false,
    elem: "u32",
    semantic: "number",
    bytesPerElement: 4,
  },
  bool: {
    plane: "MU32",
    isArray: false,
    elem: "bool",
    semantic: "bool",
    bytesPerElement: 4,
  },

  "f32.array": {
    plane: "MF32",
    isArray: true,
    elem: "f32",
    semantic: "number",
    bytesPerElement: 4,
  },
  "f64.array": {
    plane: "MF64",
    isArray: true,
    elem: "f64",
    semantic: "number",
    bytesPerElement: 8,
  },
  "u32.array": {
    plane: "MU32",
    isArray: true,
    elem: "u32",
    semantic: "number",
    bytesPerElement: 4,
  },
  "bool.array": {
    plane: "MU32",
    isArray: true,
    elem: "bool",
    semantic: "bool",
    bytesPerElement: 4,
  },
} as const satisfies MeterKindCatalog;

export function getParamKindEntry(kind: string): KindCatalogEntry {
  const entry = PARAM_KIND_CATALOG[kind as ParamKind];
  if (!entry) {
    throw new Error(`Unsupported param kind: ${kind}`);
  }
  return entry;
}

export function getMeterKindEntry(kind: string): KindCatalogEntry {
  const entry = METER_KIND_CATALOG[kind as MeterKind];
  if (!entry) {
    throw new Error(`Unsupported meter kind: ${kind}`);
  }
  return entry;
}
