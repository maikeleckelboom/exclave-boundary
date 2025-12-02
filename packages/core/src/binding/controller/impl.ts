/**
 * @fileoverview
 * Controller binding implementation.
 *
 * @remarks
 * - Validates and normalizes public param values against spec definitions.
 * - Maps controller operations onto seqlock-protected backing planes.
 * - Ensures one successful commit (set/update/stage/hydrate) → one PU bump.
 * - Provides snapshot helpers for params and meters, including zero-alloc `into`.
 */

import { createInternalError, invariant } from "@seqlok/base";
import { publish } from "@seqlok/primitives";

import { createMeterSnapshot, createParamSnapshot } from "./snapshot";
import {
  type MappedViews,
  mapViews,
  type ParamPlaneViews,
} from "../../backing/map-views";
import { isEnumDef } from "../common/enum-utils";
import { claimBinding, releaseBinding } from "../common/registry";
import {
  throwInvalidParamValue,
  throwParamRange,
  throwUnknownKey,
  validateMeterSlots,
  validateParamSlots,
} from "../common/validate";

import type { Backing } from "../../backing/types";
import type { Plan } from "../../plan/types";
import type {
  ArrayParamKeys,
  ParamDef,
  ParamKeys,
  ScalarParamKeys,
  SpecInput,
} from "../../spec/types";
import type {
  ArrayParamView,
  ControllerBinding,
  ControllerMeters,
  ControllerOptions,
  ControllerParams,
  Ephemeral,
  EphemeralTypedArray,
  HydratePatch,
  MUSeq,
  ParamValueFor,
  PUSeq,
  RangePolicy,
  ScalarParamPatch,
} from "../common/types";
import type {
  MeterSlot,
  ParamSlot,
  ValidatedParamSlot,
} from "../common/validate";
import type { JsonValue } from "@seqlok/base";

/**
 * Convert an unknown value into a compact, JSON-safe diagnostic payload.
 *
 * @remarks
 * - Primitives pass through unchanged.
 * - Arrays and typed-array-like values are summarized as `{ type, length }`.
 * - Other objects are summarized as `{ type }` using their constructor name.
 */
function toJsonDetail(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return {
      type: "Array",
      length: value.length,
    };
  }

  if (typeof value === "object" && "buffer" in value && "byteLength" in value) {
    const ctorName =
      (value as { constructor?: { name?: string } }).constructor?.name ??
      "ArrayBufferView";
    const length = (value as { length?: number }).length ?? 0;

    return {
      type: ctorName,
      length,
    };
  }

  if (typeof value === "object") {
    const ctorName =
      (value as { constructor?: { name?: string } }).constructor?.name ??
      "Object";

    return {
      type: ctorName,
    };
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "symbol") {
    return value.description ?? "Symbol";
  }

  if (typeof value === "function") {
    return "Function";
  }

  // Covers `undefined` or any truly weird case
  return "undefined";
}

/**
 * Internal helper for bulk array copies in `hydrate()`.
 *
 * @remarks
 * - Plane is one of the param array planes (PF32, PI32, PB).
 * - `slot.index` represents the starting element offset.
 */
type ArrayOp =
  | {
      readonly plane: "PF32";
      readonly slot: ValidatedParamSlot;
      readonly src: Float32Array;
    }
  | {
      readonly plane: "PI32";
      readonly slot: ValidatedParamSlot;
      readonly src: Int32Array;
    }
  | {
      readonly plane: "PB";
      readonly slot: ValidatedParamSlot;
      readonly src: Uint8Array;
    };

/**
 * Range-bearing f32 scalar definition.
 */
type F32RangeDef = Extract<ParamDef, { kind: "f32" }> & {
  readonly min: number;
  readonly max: number;
};

/**
 * Range-bearing i32 scalar definition.
 */
type I32RangeDef = Extract<ParamDef, { kind: "i32" }> & {
  readonly min: number;
  readonly max: number;
};

type BoolDef = Extract<ParamDef, { kind: "bool" }>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * Type guard for f32 scalar definitions with explicit range.
 */
const isF32RangeDef = (d: unknown): d is F32RangeDef =>
  isObject(d) &&
  d.kind === "f32" &&
  typeof d.min === "number" &&
  typeof d.max === "number" &&
  Number.isFinite(d.min) &&
  Number.isFinite(d.max);

/**
 * Type guard for i32 scalar definitions with explicit range.
 */
const isI32RangeDef = (d: unknown): d is I32RangeDef =>
  isObject(d) &&
  d.kind === "i32" &&
  typeof d.min === "number" &&
  typeof d.max === "number" &&
  Number.isInteger(d.min) &&
  Number.isInteger(d.max);

/**
 * Type guard for boolean param definitions.
 */
const isBoolDef = (d: unknown): d is BoolDef =>
  isObject(d) && d.kind === "bool";

/**
 * Clamp helper for range policy `'clamp'`.
 */
const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/**
 * Extract inclusive numeric range for scalar kinds that have one.
 *
 * @remarks
 * - f32/i32 scalars use their explicit `[min, max]` fields.
 * - Enums use `[0, values.length - 1]` (or `[0, 0]` when empty).
 * - Returns `undefined` when the def has no numeric range.
 */
function scalarRangeFor(
  def: unknown,
): { min: number; max: number } | undefined {
  if (isF32RangeDef(def) || isI32RangeDef(def)) {
    return { min: def.min, max: def.max };
  }

  if (isEnumDef(def)) {
    const n = def.values.length;
    if (n <= 0) {
      return { min: 0, max: 0 };
    }
    return { min: 0, max: n - 1 };
  }

  return undefined;
}

/**
 * Assert that a param slot exists and is scalar (`length === 1`).
 *
 * @remarks
 * - Throws `binding.unknownKey` when the key is missing or array-shaped.
 * - Narrows the slot type for scalar write helpers.
 */
function assertScalarParamSlot(
  slot: ValidatedParamSlot | undefined,
  key: string,
  known: readonly string[],
): asserts slot is ValidatedParamSlot & {
  length: 1;
} {
  if (slot?.length !== 1) {
    throwUnknownKey("params", key, known);
  }
}

/**
 * Normalize public scalar value → plane-storable scalar (`number | boolean`).
 *
 * @remarks
 * - Enum:
 *   - Accepts string labels or numeric indices.
 *   - Returns numeric index.
 * - Bool:
 *   - Accepts `boolean` or `0 | 1`.
 *   - Returns boolean; converted to 0/1 at write.
 * - f32/i32:
 *   - Requires a `number`.
 * - Fallback:
 *   - Accepts `number | boolean`.
 *   - Throws for any other shape.
 */
function normalizeScalarValue(
  def: unknown,
  value: unknown,
  key: string,
): number | boolean {
  if (isEnumDef(def)) {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const idx = def.values.indexOf(value);
      if (idx < 0) {
        throwInvalidParamValue(
          key,
          `oneOf(${def.values.join(",")})`,
          toJsonDetail(value),
        );
      }
      return idx;
    }
    throwInvalidParamValue(key, "enum index|string", toJsonDetail(value));
  }

  if (isBoolDef(def)) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    throwInvalidParamValue(key, "boolean|0|1", toJsonDetail(value));
  }

  if (isF32RangeDef(def) || isI32RangeDef(def)) {
    if (typeof value !== "number") {
      throwInvalidParamValue(key, "number", toJsonDetail(value));
    }
    return value;
  }

  if (!(typeof value === "number" || typeof value === "boolean")) {
    throwInvalidParamValue(key, "number|boolean", toJsonDetail(value));
  }

  return value;
}

/**
 * Unchecked scalar write (no policy/validation).
 *
 * @remarks
 * - Use only inside `publish(...)` after all validation and range policy
 *   have been applied.
 * - Handles coercion from boolean to 0/1 for numeric planes.
 */
function writeScalarUnchecked(
  views: ParamPlaneViews,
  slot: ValidatedParamSlot & {
    length: 1;
  },
  normalized: number | boolean,
): void {
  const i = slot.index;

  switch (slot.plane) {
    case "PF32":
      views.PF32[i] =
        typeof normalized === "boolean" ? (normalized ? 1 : 0) : normalized;
      return;

    case "PI32":
      views.PI32[i] = Math.trunc(
        typeof normalized === "boolean" ? (normalized ? 1 : 0) : normalized,
      );
      return;

    case "PB":
      views.PB[i] = normalized ? 1 : 0;
      return;
  }
}

/**
 * Assert that the backing buffer is large enough for the plan.
 *
 * @remarks
 * - For shared backings, validates that the SAB `byteLength` can satisfy
 *   `plan.bytesTotal`.
 * - Other backing kinds (WASM, partitioned) are expected to be validated in
 *   their respective allocators or `mapViews` implementations.
 */
function assertBackingCapacity<S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
): void {
  if (backing.kind === "shared") {
    const required = plan.bytesTotal >>> 0;
    const actual = backing.sab.byteLength >>> 0;

    invariant(actual >= required, () =>
      createInternalError("assertionFailed", {
        where: "binding.controller.backing",
        detail: `required=${String(required)}, actual=${String(actual)}`,
      }),
    );
  }
  // Other backing kinds (e.g. WASM, partitioned) should be validated
  // in their respective allocators / mapViews implementations.
}

/**
 * Build a controller binding from a concrete plan and backing.
 *
 * @remarks
 * - One successful commit (set/update/stage/hydrate) → exactly one PU bump.
 * - All validation happens before `publish`, so failures never bump PU.
 * - `version()` reads the commit counter; no parity check is needed on the
 *   controller side.
 */
export function controllerImpl<const S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
  paramDefs: Readonly<Record<string, ParamDef>>,
  options: ControllerOptions = {},
): ControllerBinding<S> {
  const policy: RangePolicy = options.params?.rangePolicy ?? "reject";

  assertBackingCapacity(plan, backing);
  claimBinding(backing, "controller");

  try {
    const mapped: MappedViews = mapViews(plan, backing);

    // PU seqlock pair for controller param writes (one bump per successful commit).
    const pu = {
      u32: mapped.locks.PU,
      lockIndex: plan.locks.PU.lock,
      seqIndex: plan.locks.PU.seq,
    };

    // Prevalidate and cache fast-path slots.
    const validatedParams = validateParamSlots(
      plan.params as Record<string, ParamSlot>,
      mapped.params,
    );
    const validatedMeters = validateMeterSlots(
      plan.meters as Record<string, MeterSlot>,
      mapped.meters,
    );
    const knownParamKeys = Object.keys(validatedParams);

    /**
     * Prepare a single scalar write.
     *
     * @remarks
     * - Validates key and scalar shape.
     * - Normalizes public value into a plane-storable scalar.
     * - Applies range policy:
     *   - `'reject'` → throws on out-of-range.
     *   - `'clamp'` → clamps into `[min, max]`.
     * - Returns the validated slot and final value to write.
     *
     * No side-effects; safe to call before `publish()`.
     */
    function prepareScalarWrite<K extends ScalarParamKeys<S>>(
      key: K,
      value: ParamValueFor<S, K>,
    ): {
      slot: ValidatedParamSlot & { length: 1 };
      toWrite: number | boolean;
    } {
      const slot = validatedParams[key];
      assertScalarParamSlot(slot, key, knownParamKeys);

      const scalarSlot = slot;
      const def: ParamDef | undefined = paramDefs[key];
      const normalized = normalizeScalarValue(def, value, key);

      const numeric =
        typeof normalized === "boolean" ? (normalized ? 1 : 0) : normalized;
      const range = scalarRangeFor(def);

      if (range) {
        if (numeric < range.min || numeric > range.max) {
          if (policy === "reject") {
            throwParamRange(key, range.min, range.max, numeric);
          }

          return {
            slot: scalarSlot,
            toWrite: clamp(numeric, range.min, range.max),
          };
        }

        return { slot: scalarSlot, toWrite: numeric };
      }

      return { slot: scalarSlot, toWrite: normalized };
    }

    const paramsSnapshot = createParamSnapshot<S>(
      paramDefs,
      validatedParams,
      mapped.params,
    );
    const metersSnapshot = createMeterSnapshot<S>(
      validatedMeters,
      mapped.meters,
    );

    const params: ControllerParams<S> = {
      set<K extends ScalarParamKeys<S>>(
        key: K,
        value: ParamValueFor<S, K>,
      ): void {
        const { slot, toWrite } = prepareScalarWrite(key, value);

        publish(pu, () => {
          writeScalarUnchecked(mapped.params, slot, toWrite);
        });
      },

      update(patch: ScalarParamPatch<S>): void {
        const ops: {
          slot: ValidatedParamSlot & { length: 1 };
          value: number | boolean;
        }[] = [];

        const keys = Object.keys(patch) as ScalarParamKeys<S>[];

        for (const key of keys) {
          const value = patch[key] as ParamValueFor<S, typeof key>;
          // `ScalarParamPatch<S>` is effectively a Partial<...>.
          // We treat explicit `undefined` as invalid and let normalize/prepare throw.
          const prepared = prepareScalarWrite(key, value);
          ops.push({ slot: prepared.slot, value: prepared.toWrite });
        }

        // No-op guard: do not bump PU when nothing is written.
        if (ops.length === 0) {
          return;
        }

        publish(pu, () => {
          for (const op of ops) {
            writeScalarUnchecked(mapped.params, op.slot, op.value);
          }
        });
      },

      hydrate(patch: HydratePatch<S>): void {
        const scalarOps: {
          readonly slot: ValidatedParamSlot & { readonly length: 1 };
          readonly value: number | boolean;
        }[] = [];
        const arrayOps: ArrayOp[] = [];

        const keys = Object.keys(patch) as ParamKeys<S>[];

        for (const key of keys) {
          const value = patch[key];

          const slot = validatedParams[key];
          if (!slot) {
            throwUnknownKey("params", key, knownParamKeys);
          }

          if (slot.length === 1) {
            const prepared = prepareScalarWrite(
              key as ScalarParamKeys<S>,
              value as ParamValueFor<S, ScalarParamKeys<S>>,
            );
            scalarOps.push({ slot: prepared.slot, value: prepared.toWrite });
            continue;
          }

          const expectedLength = slot.length;
          const v = value as unknown;

          switch (slot.plane) {
            case "PF32": {
              if (!(v instanceof Float32Array)) {
                throwInvalidParamValue(key, "Float32Array", toJsonDetail(v));
              }
              const src = v;
              if (src.length !== expectedLength) {
                throwInvalidParamValue(
                  key,
                  `Float32Array(length ${String(expectedLength)})`,
                  src.length,
                );
              }
              arrayOps.push({ plane: "PF32", slot, src });
              break;
            }

            case "PI32": {
              if (!(v instanceof Int32Array)) {
                throwInvalidParamValue(key, "Int32Array", toJsonDetail(v));
              }
              const src = v;
              if (src.length !== expectedLength) {
                throwInvalidParamValue(
                  key,
                  `Int32Array(length ${String(expectedLength)})`,
                  src.length,
                );
              }
              arrayOps.push({ plane: "PI32", slot, src });
              break;
            }

            case "PB": {
              if (!(v instanceof Uint8Array)) {
                throwInvalidParamValue(key, "Uint8Array", toJsonDetail(v));
              }
              const src = v;
              if (src.length !== expectedLength) {
                throwInvalidParamValue(
                  key,
                  `Uint8Array(length ${String(expectedLength)})`,
                  src.length,
                );
              }
              arrayOps.push({ plane: "PB", slot, src });
              break;
            }

            default: {
              // Compile-time exhaustiveness: if ArrayOp grows, this is a type error.
              const _exhaustive: never = slot.plane;
              void _exhaustive;

              invariant(false, () =>
                createInternalError("assertionFailed", {
                  where: "binding.controller.hydrate",
                  detail: "param.hydrate:unknownPlane",
                }),
              );
            }
          }
        }

        // No-op guard: do not bump PU when nothing is written.
        if (scalarOps.length === 0 && arrayOps.length === 0) {
          return;
        }

        publish(pu, () => {
          for (const { slot, value } of scalarOps) {
            writeScalarUnchecked(mapped.params, slot, value);
          }

          for (const op of arrayOps) {
            const start = op.slot.index;

            switch (op.plane) {
              case "PF32": {
                mapped.params.PF32.set(op.src, start);
                break;
              }
              case "PI32": {
                mapped.params.PI32.set(op.src, start);
                break;
              }
              case "PB": {
                mapped.params.PB.set(op.src, start);
                break;
              }
              default: {
                const _exhaustive: never = op;
                void _exhaustive;

                invariant(false, () =>
                  createInternalError("assertionFailed", {
                    where: "binding.controller.hydrate",
                    detail: "param.hydrate:unknownPlane",
                  }),
                );
              }
            }
          }
        });
      },

      stage<K extends ArrayParamKeys<S>>(
        key: K,
        cb: (view: Ephemeral<ArrayParamView<S, K>>) => void,
      ): void {
        const slot = validatedParams[key];
        if (!slot || slot.length <= 1) {
          throwUnknownKey("params", key, knownParamKeys);
        }

        publish(pu, () => {
          const start = slot.index;
          const end = start + slot.length;
          let view: EphemeralTypedArray;
          if (slot.plane === "PF32") {
            view = mapped.params.PF32.subarray(start, end);
          } else if (slot.plane === "PI32") {
            view = mapped.params.PI32.subarray(start, end);
          } else {
            view = mapped.params.PB.subarray(start, end);
          }
          cb(view as Ephemeral<ArrayParamView<S, K>>);
        });
      },

      snapshot: paramsSnapshot,

      version(): PUSeq {
        const u = mapped.locks.PU;
        return Atomics.load(u, plan.locks.PU.seq) >>> 0;
      },
    };

    const meters: ControllerMeters<S> = {
      snapshot: metersSnapshot,

      /**
       * Version (MU sequence number).
       *
       * @remarks
       * - Processor-side `publish(...)` commits exactly once per call by
       *   bumping `MU.SEQ`.
       * - This reader observes that commit via an SC atomic load on the MU
       *   `Int32Array`.
       * - The value is returned in the u32 domain (`>>> 0`) to model wraparound
       *   precisely.
       * - No parity checks are needed for a version read: it is a pure commit
       *   counter.
       */
      version(): MUSeq {
        const u = mapped.locks.MU;
        const seqIdx = plan.locks.MU.seq;
        return Atomics.load(u, seqIdx) >>> 0;
      },
    };

    let disposed = false;

    const dispose = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      releaseBinding(backing, "controller");
    };

    return {
      params,
      meters,
      dispose,
    };
  } catch (error) {
    releaseBinding(backing, "controller");
    throw error;
  }
}
