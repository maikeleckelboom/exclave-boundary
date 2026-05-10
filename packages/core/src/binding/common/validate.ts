/**
 * @fileoverview
 * Shared validation and error helpers for binding implementations.
 *
 * @remarks
 * - Provides slot-shape validation for params and meters.
 * - Throws structured `binding.*` errors for unknown keys and bad shapes.
 * - Used by both controller and processor bindings to keep checks consistent.
 *
 * @internal
 */

import { createInternalError, invariant } from "@seqlok/base";

import {
  type BindingInvalidValueDetails,
  type BindingParamRangeDetails,
  type BindingSnapshotIntoLengthMismatchDetails,
  type BindingSnapshotIntoTypeMismatchDetails,
  type BindingUnknownKeyDetails,
  createBindingError,
} from "../../errors/binding";

import type { MeterPlaneViews, ParamPlaneViews } from "../../backing/map-views";

export function throwUnknownKey(
  scope: "params" | "meters",
  key: string,
  known: readonly string[],
): never {
  throw createBindingError("unknownKey", {
    scope,
    key,
    known,
  } satisfies BindingUnknownKeyDetails);
}

export function throwParamRange(
  key: string,
  min: number,
  max: number,
  received: number,
): never {
  throw createBindingError("paramRange", {
    key,
    min,
    max,
    received,
  } satisfies BindingParamRangeDetails);
}

export function throwInvalidParamValue(
  key: string,
  expected: BindingInvalidValueDetails["expected"],
  received: BindingInvalidValueDetails["received"],
): never {
  throw createBindingError("paramInvalidValue", {
    key,
    expected,
    received,
  } satisfies BindingInvalidValueDetails);
}

export function throwIntoType(
  key: string,
  expectedType: string,
  receivedType: string,
  expectedLength: number,
  receivedLength: number,
): never {
  throw createBindingError("snapshotIntoTypeMismatch", {
    key,
    expectedType:
      expectedType as BindingSnapshotIntoTypeMismatchDetails["expectedType"],
    receivedType,
    expectedLength,
    receivedLength,
  } satisfies BindingSnapshotIntoTypeMismatchDetails);
}

export function throwIntoLength(
  key: string,
  expectedType: string,
  expectedLength: number,
  receivedLength: number,
): never {
  throw createBindingError("snapshotIntoLengthMismatch", {
    key,
    expectedType:
      expectedType as BindingSnapshotIntoLengthMismatchDetails["expectedType"],
    receivedType: expectedType,
    expectedLength,
    receivedLength,
  } satisfies BindingSnapshotIntoLengthMismatchDetails);
}

/** @internal Param planes (data) — binding-local union. */
export type ParamPlane = "PF32" | "PI32" | "PB";

/** @internal Meter planes (data) — binding-local union. */
export type MeterPlane = "MF32" | "MF64" | "MU32";

type ParamDst = Float32Array | Int32Array | Uint32Array | Uint8Array;
type MeterDst = Float32Array | Float64Array | Uint32Array;

/** Constructor shape for typed arrays (length → instance). */
interface TA<T extends ArrayBufferView & { length: number }> {
  readonly name: string;
  new (len: number): T;
}

/**
 * Shared validator for both params/meters "into" targets.
 *
 * @remarks
 * - Enforces constructor type (e.g. Float32Array)
 * - Enforces exact length
 */
export function validateIntoBuffer<
  T extends ArrayBufferView & {
    length: number;
  },
>(
  key: string,
  expectedCtor: TA<T>,
  expectedLength: number,
  dst: ArrayBufferView & { length: number },
): void {
  const expectedName = expectedCtor.name;
  const receivedName = (dst.constructor as { name?: string }).name ?? "Unknown";

  // Constructor/type mismatch
  if (!(dst instanceof expectedCtor)) {
    const receivedLen = dst.length;
    throwIntoType(key, expectedName, receivedName, expectedLength, receivedLen);
  }

  // Length mismatch
  if (dst.length !== expectedLength) {
    throwIntoLength(key, expectedName, expectedLength, dst.length);
  }
}

/** into validation (params). */
export function assertParamInto(
  key: string,
  plane: ParamPlane,
  dst: ParamDst,
  expectedLength: number,
  kind?: string,
): void {
  switch (plane) {
    case "PF32":
      validateIntoBuffer(key, Float32Array, expectedLength, dst);
      return;
    case "PI32":
      if (kind === "u32.array") {
        validateIntoBuffer(key, Uint32Array, expectedLength, dst);
      } else {
        validateIntoBuffer(key, Int32Array, expectedLength, dst);
      }
      return;
    case "PB":
      validateIntoBuffer(key, Uint8Array, expectedLength, dst);
      return;
  }
}

/** into validation (meters). */
export function assertMeterInto(
  key: string,
  plane: MeterPlane,
  dst: MeterDst,
  expectedLength: number,
): void {
  switch (plane) {
    case "MF32":
      validateIntoBuffer(key, Float32Array, expectedLength, dst);
      return;
    case "MF64":
      validateIntoBuffer(key, Float64Array, expectedLength, dst);
      return;
    case "MU32":
      validateIntoBuffer(key, Uint32Array, expectedLength, dst);
      return;
  }
}

interface SlotBase {
  /**
   * Spec-authored kind string (e.g. "u32.array").
   *
   * @remarks
   * Optional for backwards compatibility with older plans / accepted handoffs.
   */
  readonly kind?: string;
  readonly offset: number;
  readonly length: number;
  readonly bytesPerElement: number;
}

/**
 * Raw param slot description from the plan.
 *
 * @internal
 */
export interface ParamSlot extends SlotBase {
  readonly plane: ParamPlane | "PU";
}

/**
 * Raw meter slot description from the plan.
 *
 * @internal
 */
export interface MeterSlot extends SlotBase {
  readonly plane: MeterPlane | "MU";
}

/**
 * Param slot validated against backing capacity and aligned to elements.
 *
 * @remarks
 * - `index` is the element index in the corresponding plane.
 * - `plane` is guaranteed to be a data plane (no PU).
 */
export interface ValidatedParamSlot extends SlotBase {
  readonly plane: ParamPlane;
  readonly index: number;
}

/**
 * Meter slot validated against backing capacity and aligned to elements.
 *
 * @remarks
 * - `index` is the element index in the corresponding plane.
 * - `plane` is guaranteed to be a data plane (no MU).
 */
export interface ValidatedMeterSlot extends SlotBase {
  readonly plane: MeterPlane;
  readonly index: number;
}

/**
 * Validate param slots against the mapped planes and compute element indices.
 *
 * @internal
 */
export function validateParamSlots(
  slots: Record<string, ParamSlot>,
  views: ParamPlaneViews,
): Record<string, ValidatedParamSlot> {
  const validated: Record<string, ValidatedParamSlot> = {};

  const keys = Object.keys(slots);
  for (const key of keys) {
    const slot = slots[key];
    if (!slot) {
      continue;
    }

    if (slot.plane !== "PF32" && slot.plane !== "PI32" && slot.plane !== "PB") {
      continue;
    }

    const index = (slot.offset / slot.bytesPerElement) | 0;
    const length = slot.length;

    if (length === 1) {
      let ok = false;
      if (slot.plane === "PF32") {
        ok = index >= 0 && index < views.PF32.length;
      } else if (slot.plane === "PI32") {
        ok = index >= 0 && index < views.PI32.length;
      } else {
        ok = index >= 0 && index < views.PB.length;
      }

      invariant(ok, () =>
        createInternalError("assertionFailed", {
          where: "binding.validateParamSlots",
          detail: `param.scalar:${key}`,
        }),
      );
    } else {
      const end = index + length;
      let ok = false;
      if (slot.plane === "PF32") {
        ok = index >= 0 && end <= views.PF32.length;
      } else if (slot.plane === "PI32") {
        ok = index >= 0 && end <= views.PI32.length;
      } else {
        ok = index >= 0 && end <= views.PB.length;
      }

      invariant(ok, () =>
        createInternalError("assertionFailed", {
          where: "binding.validateParamSlots",
          detail: `param.array:${key}`,
        }),
      );
    }

    const kind = slot.kind;
    validated[key] = {
      ...(kind !== undefined ? { kind } : {}),
      plane: slot.plane,
      offset: slot.offset,
      length: slot.length,
      bytesPerElement: slot.bytesPerElement,
      index,
    };
  }

  return validated;
}

/**
 * Validate meter slots against the mapped planes and compute element indices.
 *
 * @internal
 */
export function validateMeterSlots(
  slots: Record<string, MeterSlot>,
  views: MeterPlaneViews,
): Record<string, ValidatedMeterSlot> {
  const validated: Record<string, ValidatedMeterSlot> = {};

  const keys = Object.keys(slots);
  for (const key of keys) {
    const slot = slots[key];
    if (!slot) {
      continue;
    }

    if (
      slot.plane !== "MF32" &&
      slot.plane !== "MF64" &&
      slot.plane !== "MU32"
    ) {
      continue;
    }

    const index = (slot.offset / slot.bytesPerElement) | 0;
    const length = slot.length;

    if (length === 1) {
      let ok = false;
      if (slot.plane === "MF32") {
        ok = index >= 0 && index < views.MF32.length;
      } else if (slot.plane === "MF64") {
        ok = index >= 0 && index < views.MF64.length;
      } else {
        ok = index >= 0 && index < views.MU32.length;
      }

      invariant(ok, () =>
        createInternalError("assertionFailed", {
          where: "binding.validateMeterSlots",
          detail: `meter.scalar:${key}`,
        }),
      );
    } else {
      const end = index + length;
      let ok = false;
      if (slot.plane === "MF32") {
        ok = index >= 0 && end <= views.MF32.length;
      } else if (slot.plane === "MF64") {
        ok = index >= 0 && end <= views.MF64.length;
      } else {
        ok = index >= 0 && end <= views.MU32.length;
      }

      invariant(ok, () =>
        createInternalError("assertionFailed", {
          where: "binding.validateMeterSlots",
          detail: `meter.array:${key}`,
        }),
      );
    }

    const kind = slot.kind;
    validated[key] = {
      ...(kind !== undefined ? { kind } : {}),
      plane: slot.plane,
      offset: slot.offset,
      length: slot.length,
      bytesPerElement: slot.bytesPerElement,
      index,
    };
  }

  return validated;
}
