/**
 * @fileoverview
 * Observer snapshot helpers.
 *
 * @remarks
 * Semantics:
 * - Read-only, zero-copy views into the backing planes.
 * - Arrays are returned as ephemeral `subarray(...)` views.
 * - Scalars are returned as JS numbers/booleans/enum labels.
 * - API surface is intentionally smaller than controller snapshots:
 *   - No `into` support.
 *   - No varargs overloads.
 *   - `snapshot()` → full snapshot
 *   - `snapshot(keys)` → subset snapshot
 *
 * Coherence and retry/degrade policy are handled by `snapshotWithPolicy`
 * in `binding/base/coherent.ts`. This module is purely view logic.
 */

import { createInternalError, invariant } from "@seqlok/base";

import { readMeterScalar, readParamScalar } from "../common/snapshot-util";
import {
  type MeterPlane,
  type ParamPlane,
  throwUnknownKey,
} from "../common/validate";

import type { MeterPlaneViews, ParamPlaneViews } from "../../backing/map-views";
import type {
  MeterKeys,
  ParamDef,
  ParamKeys,
  SpecInput,
} from "../../spec/types";
import type {
  MetersSnapshot,
  ParamsSnapshot,
  SnapshotMetersObject,
  SnapshotParamsObject,
} from "../common/types";

type SnapshotParamSlot = Readonly<{
  /**
   * Spec-authored kind string (e.g. "u32.array").
   *
   * @remarks
   * Optional for backwards compatibility with older plans / accepted handoffs.
   */
  kind?: string;
  plane: ParamPlane;
  index: number;
  length: number;
  bytesPerElement: number;
}>;

type SnapshotMeterSlot = Readonly<{
  plane: MeterPlane;
  index: number;
  length: number;
  bytesPerElement: number;
}>;

/**
 * Observer params snapshot function type:
 * - `snapshot()` → full ParamsSnapshot<S>
 * - `snapshot(keys)` → subset SnapshotParamsObject<S, K>
 */
export interface ObserverParamsSnapshot<S extends SpecInput> {
  (): ParamsSnapshot<S>;

  <const K extends readonly ParamKeys<S>[]>(
    keys: K,
  ): SnapshotParamsObject<S, K>;
}

/**
 * Observer meters snapshot function type:
 * - `snapshot()` → full MetersSnapshot<S>
 * - `snapshot(keys)` → subset SnapshotMetersObject<S, K>
 */
export interface ObserverMetersSnapshot<S extends SpecInput> {
  (): MetersSnapshot<S>;

  <const K extends readonly MeterKeys<S>[]>(
    keys: K,
  ): SnapshotMetersObject<S, K>;
}

function paramsSnapshotRawObserver(
  defs: Readonly<Record<string, ParamDef>>,
  slots: Record<string, SnapshotParamSlot>,
  views: ParamPlaneViews,
  knownParamKeys: readonly string[],
  keys?: readonly string[],
): Record<
  string,
  | number
  | boolean
  | string
  | Float32Array
  | Int32Array
  | Uint32Array
  | Uint8Array
> {
  const keysList = keys && keys.length > 0 ? keys : knownParamKeys;

  if (keys && keys.length > 0) {
    for (const k of keys) {
      if (!(k in slots)) {
        throwUnknownKey("params", k, knownParamKeys);
      }
    }
  }

  const out: Record<
    string,
    | number
    | boolean
    | string
    | Float32Array
    | Int32Array
    | Uint32Array
    | Uint8Array
  > = {};

  for (const key of keysList) {
    const slot = slots[key];

    invariant(slot !== undefined, () =>
      createInternalError("assertionFailed", {
        where: "observer.params.snapshot",
        detail: `missing param slot for key=${key}`,
      }),
    );

    const start = slot.index;

    if (slot.length > 1) {
      const end = start + slot.length;

      if (slot.plane === "PF32") {
        out[key] = views.PF32.subarray(start, end);
      } else if (slot.plane === "PI32") {
        const kind = slot.kind ?? defs[key]?.kind;
        if (kind === "u32.array") {
          out[key] = new Uint32Array(
            views.PI32.buffer,
            views.PI32.byteOffset + start * slot.bytesPerElement,
            slot.length,
          );
        } else {
          out[key] = views.PI32.subarray(start, end);
        }
      } else {
        out[key] = views.PB.subarray(start, end);
      }
    } else {
      // Scalar value: number / boolean / enum label.
      out[key] = readParamScalar(slot.plane, views, defs, key, start);
    }
  }

  return out;
}

function metersSnapshotRawObserver(
  slots: Record<string, SnapshotMeterSlot>,
  views: MeterPlaneViews,
  knownMeterKeys: readonly string[],
  keys?: readonly string[],
): Record<string, number | Float32Array | Float64Array | Uint32Array> {
  const keysList = keys && keys.length > 0 ? keys : knownMeterKeys;

  if (keys && keys.length > 0) {
    for (const k of keys) {
      if (!(k in slots)) {
        throwUnknownKey("meters", k, knownMeterKeys);
      }
    }
  }

  const out: Record<
    string,
    number | Float32Array | Float64Array | Uint32Array
  > = {};

  for (const key of keysList) {
    const slot = slots[key];

    invariant(slot !== undefined, () =>
      createInternalError("assertionFailed", {
        where: "observer.meters.snapshot",
        detail: `missing meter slot for key=${key}`,
      }),
    );

    const start = slot.index;

    if (slot.length > 1) {
      // Array value: ephemeral view.
      const end = start + slot.length;

      if (slot.plane === "MF32") {
        out[key] = views.MF32.subarray(start, end);
      } else if (slot.plane === "MF64") {
        out[key] = views.MF64.subarray(start, end);
      } else {
        // MU32 plane for u32 arrays / bool arrays.
        out[key] = views.MU32.subarray(start, end);
      }
    } else {
      // Scalar value: numbers only (bool meters use MU32 as 0/1).
      out[key] = readMeterScalar(slot.plane, views, key, start);
    }
  }

  return out;
}

/**
 * Build the raw observer params snapshot function.
 *
 * @remarks
 * This is a thin, allocation-free view layer. Coherence and retry/degrade
 * policy are handled by the binding layer (`snapshotWithPolicy` +
 * seqlock pair). Arrays are ephemeral views into the backing.
 */
export function createObserverParamSnapshot<S extends SpecInput>(
  defs: Readonly<Record<string, ParamDef>>,
  slots: Record<string, SnapshotParamSlot>,
  views: ParamPlaneViews,
): ObserverParamsSnapshot<S> {
  const allParamKeys = Object.keys(slots);

  const snapshotImpl = (keys?: readonly string[]) => {
    return paramsSnapshotRawObserver(defs, slots, views, allParamKeys, keys);
  };

  return snapshotImpl as ObserverParamsSnapshot<S>;
}

/**
 * Build the raw observer meters snapshot function.
 *
 * @remarks
 * Same deal as params: this is pure view logic. Seqlock coherence and
 * degrade policy live above this in the observer binding.
 */
export function createObserverMeterSnapshot<S extends SpecInput>(
  slots: Record<string, SnapshotMeterSlot>,
  views: MeterPlaneViews,
): ObserverMetersSnapshot<S> {
  const allMeterKeys = Object.keys(slots);

  const snapshotImpl = (keys?: readonly string[]) => {
    return metersSnapshotRawObserver(slots, views, allMeterKeys, keys);
  };

  return snapshotImpl as ObserverMetersSnapshot<S>;
}
