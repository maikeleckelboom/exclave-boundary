/**
 * @fileoverview
 * Memory layout planning for Seqlok shared state.
 *
 * @remarks
 * - Transforms a high-level spec into a concrete memory layout plan.
 * - Handles alignment, padding, and isolation of shared memory regions.
 * - Ensures thread-safe access patterns through proper memory barriers.
 */

import { invariant } from "@seqlok/base";

import {
  assertValidSpecForPlanning,
  composePlaneLengths,
  packMeterSlots,
  packParamSlots,
  totalBytes,
  withAlignedSeqlockForMeters,
  withAlignedSeqlockForParams,
} from "./validate";
import { createPlanError } from "../errors/plan";
import { createSpecError } from "../errors/spec";
import { hashSpec } from "../spec/hash";

import type { EntrySlot, LockStrideBytes, Plan, PlanOptions } from "./types";
import type { MeterDef, ParamDef, SpecInput } from "../spec/types";

/**
 * Default logical stride reserved for each seqlock plane (PU/MU).
 *
 * This is *not* a hardware probe. We pick 128B because:
 * - On 64B cache-line CPUs, 128B still isolates the lock from neighboring data.
 * - On 128B cache-line CPUs (Apple Silicon, some ARM), it avoids false sharing.
 *
 * Advanced users who know their target can override via PlanOptions.lockStrideBytes.
 */
const DEFAULT_LOCK_STRIDE: LockStrideBytes = 128;

/**
 * Default upper bound for planned backing size.
 *
 * This is not a browser/ABI limit, but a library-level safety rail.
 * If a plan exceeds this, `planLayout` throws `plan.overflowRisk`.
 */
const PLAN_SOFT_LIMIT_BYTES = 0x7fff_ffff; // ~2GB-1

/**
 * Plan a spec into a concrete memory plan.
 *
 * - Preserves literal key types from `spec` in the returned `Plan<S>`.
 * - Computes per-plane byte lengths and per-entry slots.
 * - Reserves `lockStrideBytes` around the seqlock planes for isolation.
 */
export function planLayout<S extends SpecInput>(
  inputSpec: S,
  options: PlanOptions = {},
): Plan<S> {
  assertValidSpecForPlanning(inputSpec);

  const paramsObj: Readonly<Record<string, ParamDef>> = inputSpec.params ?? {};
  const metersObj: Readonly<Record<string, MeterDef>> = inputSpec.meters ?? {};

  const lockStrideBytes: LockStrideBytes =
    options.lockStrideBytes ?? DEFAULT_LOCK_STRIDE;

  invariant(
    Number.isFinite(lockStrideBytes) &&
      Number.isInteger(lockStrideBytes) &&
      lockStrideBytes >= 8,
    () =>
      createSpecError("builderInvalid", {
        where: "plan.planLayout",
        reason: "alignmentFailed",
        detail: String(lockStrideBytes),
      }),
  );

  const { slots: paramSlots, bytes: pBytes0 } = packParamSlots(paramsObj);
  const { pBytes, PU } = withAlignedSeqlockForParams(pBytes0, lockStrideBytes);

  const { slots: meterSlots, bytes: mBytes0 } = packMeterSlots(metersObj);
  const { mBytes, MU } = withAlignedSeqlockForMeters(mBytes0, lockStrideBytes);

  const planes = composePlaneLengths(pBytes, PU, mBytes, MU);
  const bytesTotal = totalBytes(planes);

  invariant(bytesTotal <= PLAN_SOFT_LIMIT_BYTES, () =>
    createPlanError("overflowRisk", {
      where: "plan.planLayout",
      detail: "plan.size",
      estimatedBytes: bytesTotal,
      softLimitBytes: PLAN_SOFT_LIMIT_BYTES,
    }),
  );

  let hash: ReturnType<typeof hashSpec>;
  try {
    hash = hashSpec(inputSpec);
  } catch (cause) {
    throw createSpecError(
      "builderInvalid",
      {
        where: "plan.planLayout",
        reason: "planFailed",
        detail: "hashSpec",
      },
      cause,
    );
  }

  return {
    id: inputSpec.id ?? `anon:${hash.slice(0, 8)}`,
    hash,
    bytesTotal,
    planes,
    params: paramSlots as Readonly<{
      [K in keyof S["params"]]: EntrySlot;
    }>,
    meters: meterSlots as Readonly<{
      [K in keyof S["meters"]]: EntrySlot;
    }>,
    locks: {
      PU: { lock: 0, seq: 1 },
      MU: { lock: 0, seq: 1 },
    },
    lockStrideBytes,
  };
}
