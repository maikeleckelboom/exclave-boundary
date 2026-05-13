/**
 * @fileoverview
 * Validation and planning utilities for Seqlok memory layouts.
 *
 * @remarks
 * - Validates spec definitions before planning.
 * - Calculates memory offsets and alignments.
 * - Handles packing of parameters and meters into memory planes.
 */

import { BYTES_PER_ELEM } from "@seqlok/primitives";

import { createPlanError } from "../errors/plan";
import { createSpecError } from "../errors/spec";
import { getMeterKindEntry, getParamKindEntry } from "../spec/kinds";

import type { EntrySlot, LockStrideBytes, PlaneByteLengths } from "./types";
import type { CanonicalSpec ,
  MeterDef,
  ParamDef,
  ScalarMeterDef,
  ScalarParamDef,
} from "@seqlok/schema";

/**
 * Internal per-plane byte aggregates used during planning.
 */
type ParamPlaneBytes = Pick<PlaneByteLengths, "PF32" | "PI32" | "PB">;
type MeterPlaneBytes = Pick<PlaneByteLengths, "MF32" | "MF64" | "MU32">;

function isScalarParam(paramDef: ParamDef): paramDef is ScalarParamDef {
  return (
    paramDef.kind === "f32" ||
    paramDef.kind === "i32" ||
    paramDef.kind === "bool" ||
    paramDef.kind === "enum"
  );
}

function isScalarMeter(meterDef: MeterDef): meterDef is ScalarMeterDef {
  return (
    meterDef.kind === "f32" ||
    meterDef.kind === "f64" ||
    meterDef.kind === "u32" ||
    meterDef.kind === "bool"
  );
}

function lenOfParam(paramDef: ParamDef): number {
  return isScalarParam(paramDef) ? 1 : paramDef.length;
}

function lenOfMeter(meterDef: MeterDef): number {
  return isScalarMeter(meterDef) ? 1 : meterDef.length;
}

/** Align n up to the next multiple of m. */
function alignUp(n: number, m: number): number {
  const r = n % m;
  return r === 0 ? n : n + (m - r);
}

// Safety cap: Seqlok specs are control-plane layouts, not bulk-data transport.
// 256 Ki elements keeps any single slot ≤ 1 MiB (4B elems) or ≤ 2 MiB (8B elems),
// which is already enormous for realtime shared layouts and avoids accidental multi-GB plans.
const MAX_ARRAY_LENGTH = 262_144;

function assertArrayLength(key: string, length: number): void {
  if (!Number.isFinite(length) || length <= 0) {
    throw createSpecError("arrayInvalid", {
      where: "plan.planLayout",
      key,
      length,
      reason: "nonPositive",
    });
  }

  if (!Number.isInteger(length)) {
    throw createSpecError("arrayInvalid", {
      where: "plan.planLayout",
      key,
      length,
      reason: "fractional",
    });
  }

  if (length > MAX_ARRAY_LENGTH) {
    // Worst-case bytes for a single slot if the element type is 8 bytes (f64).
    // We don't know the actual kind here, so we report a conservative upper bound.
    const worstCaseBytesPerElem = 8;
    const maxBytesWorstCase = MAX_ARRAY_LENGTH * worstCaseBytesPerElem;
    const receivedBytesWorstCase = length * worstCaseBytesPerElem;

    throw createSpecError("builderInvalid", {
      where: "plan.planLayout",
      reason: "overflowRisk",
      key,
      detail: `array length ${String(length)} exceeds cap ${String(MAX_ARRAY_LENGTH)} (256 Ki elements)`,
      maxArrayLength: MAX_ARRAY_LENGTH,
      receivedLength: length,
      bytesWorstCaseMax: maxBytesWorstCase,
      bytesWorstCaseReceived: receivedBytesWorstCase,
      hint:
        "Seqlok specs are control-plane layouts. " +
        "If you need bulk data (audio, large buffers, long histories), " +
        "use a ring/stream/mailbox instead of a huge spec array.",
    });
  }
}

/**
 * Validate the basic shape of a spec before planning.
 *
 * - Ensures at least one param or meter is defined.
 * - Ensures no key is reused across params and meters.
 *
 * Id handling is left to the spec builder; `planLayout` will
 * auto-generate an anonymous id if none is provided.
 */
export function assertValidSpecForPlanning(spec: CanonicalSpec): void {
  const paramsObj = spec.params ?? {};
  const metersObj = spec.meters ?? {};

  const paramKeys = Object.keys(paramsObj);
  const meterKeys = Object.keys(metersObj);

  if (paramKeys.length === 0 && meterKeys.length === 0) {
    throw createSpecError("builderInvalid", {
      where: "plan.planLayout",
      reason: "emptyParams",
    });
  }

  // Cross-section duplicate key: same name in params and meters.
  for (const key of paramKeys) {
    if (key in metersObj) {
      throw createSpecError("duplicateKey", {
        section: "params",
        key,
      });
    }
  }
}

type ParamDataPlane = "PF32" | "PI32" | "PB";
type MeterDataPlane = "MF32" | "MF64" | "MU32";

/**
 * Resolve a PARAM definition to its storage plane.
 *
 * NOTE: While slicing, we only allow current data planes. Missing kinds will be
 * rejected as builderInvalid until the planner/backing/binding support expands.
 */
function planeOfParam(def: ParamDef): ParamDataPlane {
  const entry = getParamKindEntry(def.kind);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!entry) {
    throw createSpecError("builderInvalid", {
      where: "plan.planeOfParam",
      reason: "invalidKind",
      detail: def.kind,
    });
  }

  const plane = entry.plane;

  // While we’re still in the “current planes only” slice:
  if (plane !== "PF32" && plane !== "PI32" && plane !== "PB") {
    throw createSpecError("builderInvalid", {
      where: "plan.planeOfParam",
      reason: "invalidKind",
      detail: `${def.kind} -> ${plane}`,
    });
  }

  return plane;
}

/**
 * Resolve a METER definition to its storage plane.
 *
 * NOTE: While slicing, we only allow current data planes. Missing kinds will be
 * rejected as builderInvalid until the planner/backing/binding support expands.
 */
function planeOfMeter(def: MeterDef): MeterDataPlane {
  const entry = getMeterKindEntry(def.kind);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!entry) {
    throw createSpecError("builderInvalid", {
      where: "plan.planeOfMeter",
      reason: "invalidKind",
      detail: def.kind,
    });
  }

  const plane = entry.plane;

  if (plane !== "MF32" && plane !== "MF64" && plane !== "MU32") {
    throw createSpecError("builderInvalid", {
      where: "plan.planeOfMeter",
      reason: "invalidKind",
      detail: `${def.kind} -> ${plane}`,
    });
  }

  return plane;
}

/**
 * Decide which PARAM plane carries alignment padding bytes.
 * Order is PB → PI32 → PF32 to keep plan deterministic.
 */
function carryPadParams(sizes: ParamPlaneBytes, pad: number): ParamPlaneBytes {
  if (pad === 0) {
    return sizes;
  }
  if (sizes.PB) {
    return { ...sizes, PB: sizes.PB + pad };
  }
  if (sizes.PI32) {
    return { ...sizes, PI32: sizes.PI32 + pad };
  }
  return { ...sizes, PF32: sizes.PF32 + pad };
}

/**
 * Decide which METER plane carries alignment padding bytes.
 * Order is MU32 → MF64 → MF32 to keep plan deterministic.
 */
function carryPadMeters(sizes: MeterPlaneBytes, pad: number): MeterPlaneBytes {
  if (pad === 0) {
    return sizes;
  }
  if (sizes.MU32) {
    return { ...sizes, MU32: sizes.MU32 + pad };
  }
  if (sizes.MF64) {
    return { ...sizes, MF64: sizes.MF64 + pad };
  }
  return { ...sizes, MF32: sizes.MF32 + pad };
}

export function packParamSlots(params: Readonly<Record<string, ParamDef>>): {
  readonly slots: Record<string, EntrySlot>;
  readonly bytes: ParamPlaneBytes;
} {
  let PF32 = 0;
  let PI32 = 0;
  let PB = 0;

  const slots: Record<string, EntrySlot> = {};

  for (const [key, def] of Object.entries(params)) {
    if (!isScalarParam(def)) {
      assertArrayLength(`params.${key}`, def.length);
    }

    const plane = planeOfParam(def);
    const elemBytes = BYTES_PER_ELEM[plane];
    const length = lenOfParam(def);

    let offset: number;
    if (plane === "PF32") {
      offset = PF32;
      PF32 += length * elemBytes;
    } else if (plane === "PI32") {
      offset = PI32;
      PI32 += length * elemBytes;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (plane === "PB") {
      offset = PB;
      PB += length * elemBytes;
    } else {
      throw createPlanError("failed", {
        where: "plan.packParamSlots",
        detail: plane,
      });
    }

    slots[key] = {
      kind: def.kind,
      plane,
      offset,
      length,
      bytesPerElement: elemBytes,
    };
  }

  return { slots, bytes: { PF32, PI32, PB } };
}

export function packMeterSlots(meters: Readonly<Record<string, MeterDef>>): {
  readonly slots: Record<string, EntrySlot>;
  readonly bytes: MeterPlaneBytes;
} {
  let MF32 = 0;
  let MF64 = 0;
  let MU32 = 0;

  const slots: Record<string, EntrySlot> = {};

  for (const [key, def] of Object.entries(meters)) {
    if (!isScalarMeter(def)) {
      assertArrayLength(`meters.${key}`, def.length);
    }

    const plane = planeOfMeter(def);
    const elemBytes = BYTES_PER_ELEM[plane];
    const length = lenOfMeter(def);

    let offset: number;
    if (plane === "MF32") {
      offset = MF32;
      MF32 += length * elemBytes;
    } else if (plane === "MF64") {
      offset = MF64;
      MF64 += length * elemBytes;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (plane === "MU32") {
      offset = MU32;
      MU32 += length * elemBytes;
    } else {
      throw createPlanError("failed", {
        where: "plan.packMeterSlots",
        detail: plane,
      });
    }

    slots[key] = {
      kind: def.kind,
      plane,
      offset,
      length,
      bytesPerElement: elemBytes,
    };
  }

  return { slots, bytes: { MF32, MF64, MU32 } };
}

/**
 * Compute data+pad for params plane group and reserve PU seqlock stride.
 */
export function withAlignedSeqlockForParams(
  pBytes: ParamPlaneBytes,
  lockStrideBytes: LockStrideBytes,
): { readonly pBytes: ParamPlaneBytes; readonly PU: number } {
  const dataBytes = pBytes.PF32 + pBytes.PI32 + pBytes.PB;
  const pad = alignUp(dataBytes, lockStrideBytes) - dataBytes;
  const padded = carryPadParams(pBytes, pad);

  const PU = lockStrideBytes;
  return { pBytes: padded, PU };
}

/**
 * Compute data+pad for meters plane group and reserve MU seqlock stride.
 */
export function withAlignedSeqlockForMeters(
  mBytes: MeterPlaneBytes,
  lockStrideBytes: LockStrideBytes,
): { readonly mBytes: MeterPlaneBytes; readonly MU: number } {
  const dataBytes = mBytes.MF32 + mBytes.MF64 + mBytes.MU32;
  const pad = alignUp(dataBytes, lockStrideBytes) - dataBytes;
  const padded = carryPadMeters(mBytes, pad);

  const MU = lockStrideBytes;
  return { mBytes: padded, MU };
}

/**
 * Merge param + meter plane byte counts with PU/MU into a full PlaneByteLengths.
 */
export function composePlaneLengths(
  pBytes: ParamPlaneBytes,
  PU: number,
  mBytes: MeterPlaneBytes,
  MU: number,
): PlaneByteLengths {
  return {
    PF32: pBytes.PF32,
    PI32: pBytes.PI32,
    PB: pBytes.PB,
    PU,
    MF32: mBytes.MF32,
    MF64: mBytes.MF64,
    MU32: mBytes.MU32,
    MU,
  };
}

/**
 * Sum all plane byte lengths into a single total.
 */
export function totalBytes(planes: PlaneByteLengths): number {
  return (
    planes.PF32 +
    planes.PI32 +
    planes.PB +
    planes.PU +
    planes.MF32 +
    planes.MF64 +
    planes.MU32 +
    planes.MU
  );
}
