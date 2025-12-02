/**
 * @fileoverview
 * Observer binding implementation.
 *
 * @remarks
 * - Read-only binding for passive/introspect consumers.
 * - Shares the same backing and seqlocks as controller/processor.
 * - Uses seqlock-protected snapshots with configurable degradation.
 */

import { createInternalError, invariant } from "@seqlok/base";
import { ALL_PLANES } from "@seqlok/primitives";

import {
  createObserverMeterSnapshot,
  createObserverParamSnapshot,
} from "./snapshot";
import { getPlaneBuffer, getBackingBuffer } from "../../backing/buffers";
import { mapViews } from "../../backing/map-views";
import {
  makeWithin,
  type SnapshotPolicyOptions,
  snapshotWithPolicy,
} from "../common/coherent";
import { noteBinding, releaseBinding } from "../common/registry";
import {
  type MeterPlane,
  type ParamPlane,
  type ValidatedMeterSlot,
  type ValidatedParamSlot,
  validateMeterSlots,
  validateParamSlots,
} from "../common/validate";

import type { Backing } from "../../backing/types";
import type { Plan } from "../../plan/types";
import type {
  MeterKeys,
  ParamDef,
  ParamKeys,
  SpecInput,
} from "../../spec/types";
import type {
  MetersSnapshot,
  MUSeq,
  ObserverBinding,
  ObserverMeters,
  ObserverOptions,
  ObserverParams,
  ParamsSnapshot,
  PUSeq,
} from "../common/types";
import type { SeqPair } from "@seqlok/primitives";

/**
 * Narrow slot shape used by observer snapshots.
 * We drop the raw byte offset and just keep the logical index.
 */
type SnapshotParamSlot = Readonly<{
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

type ObserverParamsSnapshotFn<S extends SpecInput> =
  ObserverParams<S>["snapshot"];
type ObserverMetersSnapshotFn<S extends SpecInput> =
  ObserverMeters<S>["snapshot"];

type ObserverWithinCallback<S extends SpecInput> = Parameters<
  ObserverParams<S>["within"]
>[0];

type ObserverWithinView<S extends SpecInput> =
  ObserverWithinCallback<S> extends (view: infer V) => unknown ? V : never;

function assertNotDisposed(disposed: boolean, where: string): void {
  invariant(!disposed, () =>
    createInternalError("assertionFailed", {
      where,
      bindingRole: "observer",
      reason: "binding disposed",
    }),
  );
}

function toSeqPair(
  u32: Uint32Array,
  lockIndex: number,
  seqIndex: number,
): SeqPair {
  return {
    u32,
    lockIndex,
    seqIndex,
  };
}

function assertBackingCapacity<S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
): void {
  const requiredTotal = plan.bytesTotal >>> 0;

  // Single-buffer backings: shared + wasm-shared
  if (backing.kind === "shared" || backing.kind === "wasm-shared") {
    const buf = getBackingBuffer(backing);
    const actualBytes = buf.byteLength >>> 0;

    invariant(actualBytes >= requiredTotal, () =>
      createInternalError("assertionFailed", {
        where: "binding.observer.backing.single",
        backingKind: backing.kind,
        requiredBytes: requiredTotal,
        actualBytes,
      }),
    );

    return;
  }

  // shared-partitioned: each plane has its own SAB; check per-plane capacity.
  for (const plane of ALL_PLANES) {
    const requiredBytes = plan.planes[plane] >>> 0;

    if (requiredBytes === 0) {
      continue;
    }

    const buf = getPlaneBuffer(backing, plane);
    const actualBytes = buf.byteLength >>> 0;

    invariant(actualBytes >= requiredBytes, () =>
      createInternalError("assertionFailed", {
        where: "binding.observer.backing.shared-partitioned",
        plane,
        requiredBytes,
        actualBytes,
      }),
    );
  }
}

/**
 * Observer binding implementation for a given plan/backing.
 *
 * @typeParam S - Spec type.
 */
export function observerImpl<const S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
  paramDefs: Readonly<Record<string, ParamDef>>,
  options: ObserverOptions = {},
): ObserverBinding<S> {
  // Validate backing size against the plan before mapping.
  assertBackingCapacity(plan, backing);

  // Non-exclusive observer role.
  noteBinding(backing, "observer");

  let disposed = false;

  try {
    const mapped = mapViews(plan, backing);

    interface ParamSlotForValidate {
      readonly plane: ParamPlane | "PU";
      readonly offset: number;
      readonly length: number;
      readonly bytesPerElement: number;
    }

    interface MeterSlotForValidate {
      readonly plane: MeterPlane | "MU";
      readonly offset: number;
      readonly length: number;
      readonly bytesPerElement: number;
    }

    const validatedParams = validateParamSlots(
      plan.params as Record<string, ParamSlotForValidate>,
      mapped.params,
    );

    const validatedMeters = validateMeterSlots(
      plan.meters as Record<string, MeterSlotForValidate>,
      mapped.meters,
    );

    // Strip down to the snapshot slot shape used by observer snapshot helpers.
    const paramSnapshotSlots: Record<string, SnapshotParamSlot> = {};
    for (const [key, slot] of Object.entries<ValidatedParamSlot>(
      validatedParams,
    )) {
      paramSnapshotSlots[key] = {
        plane: slot.plane,
        index: slot.index,
        length: slot.length,
        bytesPerElement: slot.bytesPerElement,
      };
    }

    const meterSnapshotSlots: Record<string, SnapshotMeterSlot> = {};
    for (const [key, slot] of Object.entries<ValidatedMeterSlot>(
      validatedMeters,
    )) {
      meterSnapshotSlots[key] = {
        plane: slot.plane,
        index: slot.index,
        length: slot.length,
        bytesPerElement: slot.bytesPerElement,
      };
    }

    // Seqlock pairs shared with controller/processor.
    const pu: SeqPair = toSeqPair(
      mapped.locks.PU,
      plan.locks.PU.lock,
      plan.locks.PU.seq,
    );
    const mu: SeqPair = toSeqPair(
      mapped.locks.MU,
      plan.locks.MU.lock,
      plan.locks.MU.seq,
    );

    // Global observer tuning.
    const baseSpinBudget = options.spinBudget ?? 256;
    const baseRetryBudget = options.retryBudget ?? 4;
    const baseDegrade: SnapshotPolicyOptions["degrade"] =
      options.degrade ?? "returnLatest";

    // Per-section tuning.
    const paramsSpinBudget = options.params?.spinBudget ?? baseSpinBudget;
    const paramsRetryBudget = options.params?.retryBudget ?? baseRetryBudget;
    const paramsDegrade: SnapshotPolicyOptions["degrade"] =
      options.params?.degrade ?? baseDegrade;
    const paramsWhere = options.params?.where ?? "observer.params.snapshot";

    const metersSpinBudget = options.meters?.spinBudget ?? baseSpinBudget;
    const metersRetryBudget = options.meters?.retryBudget ?? baseRetryBudget;
    const metersDegrade: SnapshotPolicyOptions["degrade"] =
      options.meters?.degrade ?? baseDegrade;
    const metersWhere = options.meters?.where ?? "observer.meters.snapshot";

    // Raw snapshot functions (no seqlock, just views).
    const paramsSnapshotRaw = createObserverParamSnapshot<S>(
      paramDefs,
      paramSnapshotSlots,
      mapped.params,
    );
    const metersSnapshotRaw = createObserverMeterSnapshot<S>(
      meterSnapshotSlots,
      mapped.meters,
    );

    // Last-known-good snapshots for degrade='returnLatest'.
    let lastParamsSnapshot: ParamsSnapshot<S> | undefined;
    let lastMetersSnapshot: MetersSnapshot<S> | undefined;

    const paramsSnapshot: ObserverParamsSnapshotFn<S> = ((
      ...args: unknown[]
    ) => {
      assertNotDisposed(disposed, "observer.params.snapshot");

      let keys: readonly ParamKeys<S>[] | undefined;

      if (args.length === 0) {
        // full snapshot
        keys = undefined;
      } else if (args.length === 1) {
        const [arg] = args;

        if (Array.isArray(arg)) {
          // snapshot(['rate', 'mode'])
          keys = arg as readonly ParamKeys<S>[];
        } else if (arg && typeof arg === "object") {
          // snapshot({ keys: [...] })
          const fromObject = arg as {
            readonly keys?: readonly ParamKeys<S>[];
          };
          keys = fromObject.keys;
        } else {
          // snapshot('rate')
          keys = args as readonly ParamKeys<S>[];
        }
      } else {
        // snapshot('rate', 'mode', ...)
        keys = args as readonly ParamKeys<S>[];
      }

      const reader = () => {
        const snap = (
          paramsSnapshotRaw as (ks?: readonly ParamKeys<S>[]) => unknown
        )(keys);

        if (!keys) {
          // Only full snapshots are cached as last-known-good.
          lastParamsSnapshot = snap as ParamsSnapshot<S>;
        }

        return snap;
      };

      const degradedReader = () => {
        if (!keys && lastParamsSnapshot && paramsDegrade === "returnLatest") {
          return lastParamsSnapshot;
        }
        // Best-effort fallback: raw snapshot without additional seqlock retries.
        return (paramsSnapshotRaw as (ks?: readonly ParamKeys<S>[]) => unknown)(
          keys,
        );
      };

      return snapshotWithPolicy(
        pu,
        {
          where: paramsWhere,
          section: "params",
          spinBudget: paramsSpinBudget,
          retryBudget: paramsRetryBudget,
          degrade: paramsDegrade,
        },
        reader,
        degradedReader,
      ) as ReturnType<ObserverParamsSnapshotFn<S>>;
    }) as ObserverParamsSnapshotFn<S>;

    const rawWithinReader = (): ObserverWithinView<S> => {
      assertNotDisposed(disposed, "observer.params.within");
      // Full snapshot view; uses the same raw machinery as snapshot().
      const snap = paramsSnapshotRaw() as ParamsSnapshot<S>;
      return snap as unknown as ObserverWithinView<S>;
    };

    const paramsWithin = makeWithin(
      pu,
      {
        where: options.params?.where ?? "observer.params.within",
        spinBudget: paramsSpinBudget,
        retryBudget: paramsRetryBudget,
      },
      rawWithinReader,
    );

    const params: ObserverParams<S> = {
      snapshot: paramsSnapshot,
      within(callback: (view: ObserverWithinView<S>) => void): void {
        paramsWithin(callback);
      },
      version(): PUSeq {
        assertNotDisposed(disposed, "observer.params.version");
        const u = mapped.locks.PU;
        return Atomics.load(u, plan.locks.PU.seq) >>> 0;
      },
    };

    const metersSnapshot: ObserverMetersSnapshotFn<S> = ((
      ...args: unknown[]
    ) => {
      assertNotDisposed(disposed, "observer.meters.snapshot");

      let keys: readonly MeterKeys<S>[] | undefined;

      if (args.length === 0) {
        keys = undefined;
      } else if (args.length === 1) {
        const [arg] = args;

        if (Array.isArray(arg)) {
          // snapshot(['pressure', 'counter'])
          keys = arg as readonly MeterKeys<S>[];
        } else if (arg && typeof arg === "object") {
          // snapshot({ keys: [...] })
          const fromObject = arg as {
            readonly keys?: readonly MeterKeys<S>[];
          };
          keys = fromObject.keys;
        } else {
          // snapshot('pressure')
          keys = args as readonly MeterKeys<S>[];
        }
      } else {
        // snapshot('pressure', 'counter', ...)
        keys = args as readonly MeterKeys<S>[];
      }

      const reader = () => {
        const snap = (
          metersSnapshotRaw as (ks?: readonly MeterKeys<S>[]) => unknown
        )(keys);

        if (!keys) {
          lastMetersSnapshot = snap as MetersSnapshot<S>;
        }

        return snap;
      };

      const degradedReader = () => {
        if (!keys && lastMetersSnapshot && metersDegrade === "returnLatest") {
          return lastMetersSnapshot;
        }
        return (metersSnapshotRaw as (ks?: readonly MeterKeys<S>[]) => unknown)(
          keys,
        );
      };

      return snapshotWithPolicy(
        mu,
        {
          where: metersWhere,
          section: "meters",
          spinBudget: metersSpinBudget,
          retryBudget: metersRetryBudget,
          degrade: metersDegrade,
        },
        reader,
        degradedReader,
      ) as ReturnType<ObserverMetersSnapshotFn<S>>;
    }) as ObserverMetersSnapshotFn<S>;

    const meters: ObserverMeters<S> = {
      snapshot: metersSnapshot,
      version(): MUSeq {
        assertNotDisposed(disposed, "observer.meters.version");
        const u = mapped.locks.MU;
        return Atomics.load(u, plan.locks.MU.seq) >>> 0;
      },
    };

    const dispose = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      releaseBinding(backing, "observer");
    };

    return {
      params,
      meters,
      dispose,
    };
  } catch (error) {
    releaseBinding(backing, "observer");
    throw error;
  }
}
