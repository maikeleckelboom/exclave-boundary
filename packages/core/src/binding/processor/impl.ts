/**
 * @fileoverview
 * Processor binding implementation for worker/worklet runtimes.
 *
 * @remarks
 * - Maps processor-side param reads and meter writes onto backing planes.
 * - Provides seqlock-protected `within` and `publish` operations.
 * - Enforces binding lifetime and basic invariants.
 */

import { createInternalError, invariant } from "@seqlok/base";
import { publish } from "@seqlok/primitives";

import {
  type MappedViews,
  mapViews,
  type MeterPlaneViews,
  type ParamPlaneViews,
} from "../../backing/map-views";
import { makeWithin } from "../common/coherent";
import { claimBinding, releaseBinding } from "../common/registry";
import { throwUnknownKey } from "../common/validate";

import type { Backing } from "../../backing/types";
import type { Plan } from "../../plan/types";
import type { SpecInput } from "../../spec/types";
import type {
  Ephemeral,
  MeterWriter,
  MUSeq,
  ProcessorBinding,
  ProcessorMeters,
  ProcessorOptions,
  ProcessorParams,
  PUSeq,
} from "../common/types";
import type { MeterPlane, ParamPlane } from "../common/validate";

type WithinCallback<S extends SpecInput> = Parameters<
  ProcessorParams<S>["within"]
>[0];

type WithinView<S extends SpecInput> =
  WithinCallback<S> extends (view: infer V) => unknown ? V : never;

/**
 * Base layout information for a param/meter slot in a plane.
 */
interface SlotBase {
  readonly offset: number;
  readonly length: number;
  readonly bytesPerElement: number;
}

/**
 * Param slot descriptor as produced by the planner.
 *
 * @remarks
 * - `plane` may refer to a logical param plane or the PU lock plane.
 */
interface ParamSlot extends SlotBase {
  readonly plane: ParamPlane | "PU";
}

/**
 * Meter slot descriptor as produced by the planner.
 *
 * @remarks
 * - `plane` may refer to a logical meter plane or the MU lock plane.
 */
interface MeterSlot extends SlotBase {
  readonly plane: MeterPlane | "MU";
}

/**
 * Type guard that narrows param planes to data planes.
 */
function isParamDataPlane(p: ParamSlot["plane"]): p is ParamPlane {
  return p === "PF32" || p === "PI32" || p === "PB";
}

/**
 * Type guard that narrows meter planes to data planes.
 */
function isMeterDataPlane(p: MeterSlot["plane"]): p is MeterPlane {
  return p === "MF32" || p === "MF64" || p === "MU32";
}

/**
 * Ensure that a plane view is defined.
 *
 * @remarks
 * - Throws `internal.assertionFailed` when the view is `undefined`.
 */
function ensurePlane<T>(v: T | undefined, where: string, detail: string): T {
  invariant(v !== undefined, () =>
    createInternalError("assertionFailed", {
      where,
      detail: `missing plane view: ${detail}`,
    }),
  );
  return v;
}

/**
 * Read a numeric value at a given index with bounds and type checks.
 *
 * @remarks
 * - Asserts that the index is in range.
 * - Asserts that the element is a number.
 */
function readNumberAt(
  values: { length: number; [n: number]: number },
  index: number,
  where: string,
): number {
  invariant(index >= 0 && index < values.length, () =>
    createInternalError("assertionFailed", {
      where,
      detail: `offset out of range: ${String(index)}/${String(values.length)}`,
    }),
  );

  const v = values[index];

  invariant(typeof v === "number", () =>
    createInternalError("assertionFailed", {
      where,
      detail: `expected numeric element at index ${String(index)}`,
    }),
  );

  return v;
}

/**
 * Create an ephemeral view for an array param.
 *
 * @remarks
 * - Expects `slot.length > 1` and a data-plane param.
 * - Returns a callback-scoped subarray view.
 */
function paramArrayViewFor(
  views: ParamPlaneViews,
  slot: ParamSlot & {
    plane: ParamPlane;
    length: number;
  },
): Ephemeral<Float32Array> | Ephemeral<Int32Array> | Ephemeral<Uint8Array> {
  invariant(slot.length > 1, () =>
    createInternalError("assertionFailed", {
      where: "param.array",
      detail: `array param expected for plane=${slot.plane}`,
    }),
  );

  const start = (slot.offset / slot.bytesPerElement) | 0;
  const end = start + slot.length;

  switch (slot.plane) {
    case "PF32":
      return ensurePlane(views.PF32, "param.array", "PF32").subarray(
        start,
        end,
      ) as Ephemeral<Float32Array>;
    case "PI32":
      return ensurePlane(views.PI32, "param.array", "PI32").subarray(
        start,
        end,
      ) as Ephemeral<Int32Array>;
    case "PB":
      return ensurePlane(views.PB, "param.array", "PB").subarray(
        start,
        end,
      ) as Ephemeral<Uint8Array>;
  }
}

/**
 * Read a scalar param from a data-plane slot.
 *
 * @remarks
 * - PF32 → `number`
 * - PI32 → signed 32-bit integer (`number`).
 * - PB   → `boolean` (non-zero → `true`).
 */
function readParamScalar(
  views: ParamPlaneViews,
  slot: ParamSlot & {
    plane: ParamPlane;
    length: 1;
  },
): number | boolean {
  const i = (slot.offset / slot.bytesPerElement) | 0;

  switch (slot.plane) {
    case "PF32": {
      const at = ensurePlane(views.PF32, "param.scalar", "PF32");
      return readNumberAt(at, i, "param.scalar");
    }
    case "PI32": {
      const at = ensurePlane(views.PI32, "param.scalar", "PI32");
      return readNumberAt(at, i, "param.scalar") | 0;
    }
    case "PB": {
      const a = ensurePlane(views.PB, "param.scalar", "PB");
      const v = readNumberAt(a, i, "param.scalar");
      return v !== 0;
    }
  }
}

/**
 * Create an ephemeral view for an array meter.
 *
 * @remarks
 * - Expects `slot.length > 1` and a data-plane meter.
 * - Returns a callback-scoped subarray view.
 */
function meterArrayViewFor(
  views: MeterPlaneViews,
  slot: MeterSlot & {
    plane: MeterPlane;
    length: number;
  },
): Ephemeral<Float32Array> | Ephemeral<Float64Array> | Ephemeral<Uint32Array> {
  invariant(slot.length > 1, () =>
    createInternalError("assertionFailed", {
      where: "meter.array",
      detail: `array meter expected for plane=${slot.plane}`,
    }),
  );

  const start = (slot.offset / slot.bytesPerElement) | 0;
  const end = start + slot.length;

  switch (slot.plane) {
    case "MF32":
      return ensurePlane(views.MF32, "meter.array", "MF32").subarray(
        start,
        end,
      ) as Ephemeral<Float32Array>;
    case "MF64":
      return ensurePlane(views.MF64, "meter.array", "MF64").subarray(
        start,
        end,
      ) as Ephemeral<Float64Array>;
    case "MU32":
      return ensurePlane(views.MU32, "meter.array", "MU32").subarray(
        start,
        end,
      ) as Ephemeral<Uint32Array>;
  }
}

/**
 * Compute the element index for a slot.
 */
function elementIndex(s: SlotBase): number {
  return (s.offset / s.bytesPerElement) | 0;
}

/**
 * Build a scalar writer for a meter plane.
 *
 * @remarks
 * - Asserts that the target index is in range.
 * - Applies a `coerce` function before storing the value.
 */
function makeScalarWriter(
  values: {
    length: number;
    [n: number]: number;
  },
  index: number,
  coerce: (v: number) => number,
  where: string,
): (value: number) => void {
  invariant(index >= 0 && index < values.length, () =>
    createInternalError("assertionFailed", {
      where,
      detail: `offset out of range: ${String(index)}/${String(values.length)}`,
    }),
  );

  return (value: number) => {
    values[index] = coerce(value);
  };
}

/**
 * Assert that the processor binding has not been disposed.
 */
function assertNotDisposed(disposed: boolean, where: string): void {
  invariant(!disposed, () =>
    createInternalError("assertionFailed", {
      where,
      detail: "processor binding disposed",
    }),
  );
}

/**
 * Build a processor binding from a concrete plan and backing.
 *
 * @remarks
 * - `params.within(...)` exposes a seqlock-protected coherent view of params.
 * - `meters.publish(...)` exposes a seqlock-protected writer for meters.
 * - `version()` reads PU/MU commit counters via SC atomics.
 * - Lifetime is managed via `noteBinding` / `releaseBinding`.
 */
export function processorImpl<const S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
  options: ProcessorOptions = {},
): ProcessorBinding<S> {
  claimBinding(backing, "processor");

  try {
    const mapped: MappedViews = mapViews(plan, backing);
    const paramSlots = plan.params as Record<string, ParamSlot>;
    const meterSlots = plan.meters as Record<string, MeterSlot>;

    const pu = {
      u32: mapped.locks.PU,
      lockIndex: plan.locks.PU.lock,
      seqIndex: plan.locks.PU.seq,
    };

    let disposed = false;

    /**
     * Raw param reader used by `makeWithin`.
     *
     * @remarks
     * - Asserts binding is not disposed.
     * - Builds a param view with scalars and ephemeral arrays.
     */
    const rawReader = () => {
      assertNotDisposed(disposed, "processor.params.within");

      const view: Record<string, unknown> = {};

      for (const key of Object.keys(paramSlots)) {
        const slot0 = paramSlots[key];

        invariant(!!slot0 && isParamDataPlane(slot0.plane), () =>
          createInternalError("assertionFailed", {
            where:
              slot0?.length && slot0.length > 1
                ? "param.array"
                : "param.scalar",
            detail: `unexpected param plane ${slot0?.plane ?? "unknown"}`,
          }),
        );

        if (slot0.length > 1) {
          view[key] = paramArrayViewFor(mapped.params, {
            ...slot0,
            plane: slot0.plane,
          });
        } else {
          view[key] = readParamScalar(mapped.params, {
            ...slot0,
            plane: slot0.plane,
            length: 1,
          });
        }
      }

      return view as WithinView<S>;
    };

    const withinWrapper = makeWithin(
      pu,
      {
        spinBudget: options.params?.spinBudget ?? 1024,
        retryBudget: options.params?.retryBudget ?? 8,
        where: "processor.params.within",
      },
      rawReader,
    );

    const params: ProcessorParams<S> = {
      /**
       * Read parameters within a seqlock-protected critical section.
       *
       * @remarks
       * - Provides coherent scalar values and ephemeral array views.
       * - Retries according to the configured spin/retry budgets.
       */
      within: (callback): void => {
        withinWrapper(callback);
      },

      /**
       * Current PU sequence number for the binding.
       */
      version(): PUSeq {
        assertNotDisposed(disposed, "processor.params.version");
        const u = mapped.locks.PU;
        return Atomics.load(u, plan.locks.PU.seq) >>> 0;
      },
    };

    const scalarWriters: Record<string, (value: number) => void> = {};

    for (const key of Object.keys(meterSlots)) {
      const slot0 = meterSlots[key];
      if (slot0?.length !== 1) {
        continue;
      }

      const elIndex = elementIndex(slot0);

      switch (slot0.plane) {
        case "MF32": {
          const a = ensurePlane(mapped.meters.MF32, "meter.scalar", "MF32");
          scalarWriters[key] = makeScalarWriter(
            a,
            elIndex,
            (v) => v,
            "meter.scalar",
          );
          break;
        }
        case "MF64": {
          const a = ensurePlane(mapped.meters.MF64, "meter.scalar", "MF64");
          scalarWriters[key] = makeScalarWriter(
            a,
            elIndex,
            (v) => v,
            "meter.scalar",
          );
          break;
        }
        case "MU32": {
          const a = ensurePlane(mapped.meters.MU32, "meter.scalar", "MU32");
          scalarWriters[key] = makeScalarWriter(
            a,
            elIndex,
            (v) => v >>> 0,
            "meter.scalar",
          );
          break;
        }
        case "MU":
          break;
      }
    }

    const mu = {
      u32: mapped.locks.MU,
      lockIndex: plan.locks.MU.lock,
      seqIndex: plan.locks.MU.seq,
    };

    type EM =
      | Ephemeral<Float32Array>
      | Ephemeral<Float64Array>
      | Ephemeral<Uint32Array>;

    const meters: ProcessorMeters<S> = {
      /**
       * Publish meter values within a seqlock-protected critical section.
       *
       * @remarks
       * - Scalar meters:
       *   - Direct writers are precomputed per key.
       *   - Dynamic `set(key, value)` forwards into those writers.
       * - Array meters:
       *   - `stage(key, dst => ...)` exposes ephemeral views.
       */
      publish<T>(cb: (writer: MeterWriter<S>) => T): T {
        assertNotDisposed(disposed, "processor.meters.publish");

        const w: Record<string, unknown> = {};

        for (const key of Object.keys(scalarWriters)) {
          w[key] = scalarWriters[key];
        }

        function stage(key: string, cb2: (dst: EM) => void): void {
          const slot0 = meterSlots[key];

          if (!slot0) {
            throwUnknownKey("meters", key, Object.keys(meterSlots));
          }

          invariant(slot0.length > 1, () =>
            createInternalError("assertionFailed", {
              where: "meter.stage",
              detail: `array meter expected for key=${key}`,
            }),
          );

          invariant(isMeterDataPlane(slot0.plane), () =>
            createInternalError("assertionFailed", {
              where: "meter.stage",
              detail: `unexpected meter plane ${slot0.plane}`,
            }),
          );

          const view = meterArrayViewFor(mapped.meters, {
            ...slot0,
            plane: slot0.plane,
          });

          cb2(view);
        }

        function set(key: string, value: number): void {
          const scalarWriter = scalarWriters[key];

          if (!scalarWriter) {
            throwUnknownKey("meters", key, Object.keys(scalarWriters));
          }

          scalarWriter(value);
        }

        w.stage = stage;
        w.set = set;

        return publish(mu, () => cb(w as MeterWriter<S>));
      },

      /**
       * Current MU sequence number for the binding.
       */
      version(): MUSeq {
        assertNotDisposed(disposed, "processor.meters.version");
        const u = mapped.locks.MU;
        return Atomics.load(u, plan.locks.MU.seq) >>> 0;
      },
    };

    return {
      params,
      meters,
      dispose(): void {
        if (disposed) {
          return;
        }
        disposed = true;
        releaseBinding(backing, "processor");
      },
    };
  } catch (error) {
    releaseBinding(backing, "processor");
    throw error;
  }
}
