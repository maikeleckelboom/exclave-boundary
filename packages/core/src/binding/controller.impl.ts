import { createMeterSnapshot, createParamSnapshot } from './controller.snapshot';
import { claimBinding, noteBinding, releaseBinding } from './registry';
import {
  throwInvalidParamValue,
  throwParamRange,
  throwUnknownKey,
  type MeterPlane,
  type ParamPlane,
} from './validate';
import {
  type MappedViews,
  mapViews,
  type MeterPlaneViews,
  type ParamPlaneViews,
} from '../backing/map-views';
import { invariant } from '../errors/invariant';
import { publish } from '../primitives/seqlock';

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
} from './types';
import type { Backing } from '../backing/types';
import type { Plan } from '../plan/types';
import type {
  ArrayParamKeys,
  ParamDef,
  ParamKeys,
  ScalarParamKeys,
  SpecInput,
} from '../spec/types';

interface SlotBase {
  readonly offset: number;
  readonly length: number;
  readonly bytesPerElement: number;
}

interface ParamSlot extends SlotBase {
  readonly plane: ParamPlane | 'PU';
}

interface MeterSlot extends SlotBase {
  readonly plane: MeterPlane | 'MU';
}

/** Validated fast-path slots (precomputed element index). */
interface ValidatedParamSlot extends SlotBase {
  readonly plane: ParamPlane;
  readonly index: number; // element index (offset / bytesPerElement)
}

interface ValidatedMeterSlot extends SlotBase {
  readonly plane: MeterPlane;
  readonly index: number; // element index (offset / bytesPerElement)
}

/** Internal helper for bulk array copies in hydrate(). */
type ArrayOp =
  | {
      readonly plane: 'PF32';
      readonly slot: ValidatedParamSlot;
      readonly src: Float32Array;
    }
  | {
      readonly plane: 'PI32';
      readonly slot: ValidatedParamSlot;
      readonly src: Int32Array;
    }
  | {
      readonly plane: 'PB';
      readonly slot: ValidatedParamSlot;
      readonly src: Uint8Array;
    };

const isObject = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object';

/** Range-bearing scalar defs. */
type F32RangeDef = Extract<ParamDef, { kind: 'f32' }> & {
  readonly min: number;
  readonly max: number;
};

type I32RangeDef = Extract<ParamDef, { kind: 'i32' }> & {
  readonly min: number;
  readonly max: number;
};

type BoolDef = Extract<ParamDef, { kind: 'bool' }>;
type EnumDef = Extract<ParamDef, { kind: 'enum' }>;

/**
 * Type guards use only structural checks on `Record<string, unknown>` and
 * do not rely on `as unknown` casts.
 */
const isF32RangeDef = (d: unknown): d is F32RangeDef =>
  isObject(d) &&
  d.kind === 'f32' &&
  typeof d.min === 'number' &&
  typeof d.max === 'number';

const isI32RangeDef = (d: unknown): d is I32RangeDef =>
  isObject(d) &&
  d.kind === 'i32' &&
  typeof d.min === 'number' &&
  typeof d.max === 'number';

const isBoolDef = (d: unknown): d is BoolDef => isObject(d) && d.kind === 'bool';

const isEnumDef = (d: unknown): d is EnumDef =>
  isObject(d) && d.kind === 'enum' && Array.isArray(d.values);

/** Clamp helper for range policy 'clamp'. */
const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/** Extract inclusive numeric range for scalar kinds that have one. */
function scalarRangeFor(def: unknown): { min: number; max: number } | undefined {
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

function validateParamSlots(
  slots: Record<string, ParamSlot>,
  views: ParamPlaneViews,
): Record<string, ValidatedParamSlot> {
  const validated: Record<string, ValidatedParamSlot> = {};

  for (const [key, slot] of Object.entries(slots)) {
    if (slot.plane !== 'PF32' && slot.plane !== 'PI32' && slot.plane !== 'PB') {
      continue;
    }

    const index = (slot.offset / slot.bytesPerElement) | 0;
    const length = slot.length;

    if (length === 1) {
      let ok = false;
      if (slot.plane === 'PF32') {
        ok = index >= 0 && index < views.PF32.length;
      } else if (slot.plane === 'PI32') {
        ok = index >= 0 && index < views.PI32.length;
      } else {
        ok = index >= 0 && index < views.PB.length;
      }

      invariant(
        ok,
        'internal.assertionFailed',
        `Param scalar "${key}" offset out of bounds`,
        { detail: `param.scalar:${key}` },
      );
    } else {
      const end = index + length;
      let ok = false;
      if (slot.plane === 'PF32') {
        ok = index >= 0 && end <= views.PF32.length;
      } else if (slot.plane === 'PI32') {
        ok = index >= 0 && end <= views.PI32.length;
      } else {
        ok = index >= 0 && end <= views.PB.length;
      }

      invariant(
        ok,
        'internal.assertionFailed',
        `Param array "${key}" range out of bounds`,
        { detail: `param.array:${key}` },
      );
    }

    validated[key] = {
      plane: slot.plane,
      offset: slot.offset,
      length: slot.length,
      bytesPerElement: slot.bytesPerElement,
      index,
    };
  }

  return validated;
}

function validateMeterSlots(
  slots: Record<string, MeterSlot>,
  views: MeterPlaneViews,
): Record<string, ValidatedMeterSlot> {
  const validated: Record<string, ValidatedMeterSlot> = {};

  for (const [key, slot] of Object.entries(slots)) {
    if (slot.plane !== 'MF32' && slot.plane !== 'MF64' && slot.plane !== 'MU32') {
      continue;
    }

    const index = (slot.offset / slot.bytesPerElement) | 0;
    const length = slot.length;

    if (length === 1) {
      let ok = false;
      if (slot.plane === 'MF32') {
        ok = index >= 0 && index < views.MF32.length;
      } else if (slot.plane === 'MF64') {
        ok = index >= 0 && index < views.MF64.length;
      } else {
        ok = index >= 0 && index < views.MU32.length;
      }

      invariant(
        ok,
        'internal.assertionFailed',
        `Meter scalar "${key}" offset out of bounds`,
        { detail: `meter.scalar:${key}` },
      );
    } else {
      const end = index + length;
      let ok = false;
      if (slot.plane === 'MF32') {
        ok = index >= 0 && end <= views.MF32.length;
      } else if (slot.plane === 'MF64') {
        ok = index >= 0 && end <= views.MF64.length;
      } else {
        ok = index >= 0 && end <= views.MU32.length;
      }

      invariant(
        ok,
        'internal.assertionFailed',
        `Meter array "${key}" range out of bounds`,
        { detail: `meter.array:${key}` },
      );
    }

    validated[key] = {
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
 * Assert that a slot exists and is scalar (length === 1).
 * This gives us a precise type without `as` at call sites.
 */
function assertScalarParamSlot(
  slot: ValidatedParamSlot | undefined,
  key: string,
  known: readonly string[],
): asserts slot is ValidatedParamSlot & {
  length: 1;
} {
  if (slot?.length !== 1) {
    throwUnknownKey('params', key, known);
  }
}

/**
 * Normalize public scalar value → plane-storable scalar (number | boolean).
 * - enum: string label or numeric index → numeric index
 * - bool: boolean or 0/1 → boolean (converted to 0/1 at write)
 * - f32/i32: number
 */
function normalizeScalarValue(
  def: unknown,
  value: unknown,
  key: string,
): number | boolean {
  if (isEnumDef(def)) {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const idx = def.values.indexOf(value);
      if (idx < 0) {
        throwInvalidParamValue(key, `oneOf(${def.values.join(',')})`, value);
      }
      return idx;
    }
    throwInvalidParamValue(key, 'enum index|string', value);
  }

  if (isBoolDef(def)) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    throwInvalidParamValue(key, 'boolean|0|1', value);
  }

  if (isF32RangeDef(def) || isI32RangeDef(def)) {
    if (typeof value !== 'number') {
      throwInvalidParamValue(key, 'number', value);
    }
    return value;
  }

  if (!(typeof value === 'number' || typeof value === 'boolean')) {
    throwInvalidParamValue(key, 'number|boolean', value);
  }

  return value;
}

/**
 * Unchecked scalar write (no policy/validation). Use only inside publish()
 * after all validation and range policy have been applied.
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
    case 'PF32':
      views.PF32[i] = typeof normalized === 'boolean' ? (normalized ? 1 : 0) : normalized;
      return;
    case 'PI32':
      views.PI32[i] = Math.trunc(
        typeof normalized === 'boolean' ? (normalized ? 1 : 0) : normalized,
      );
      return;
    case 'PB':
      views.PB[i] = normalized ? 1 : 0;
      return;
  }
}

/**
 * Assert that the backing buffer is large enough for the plan.
 *
 * @remarks
 * For shared backings, validates that the SAB byteLength can satisfy
 * the layout described by plan.bytesTotal. Other backing kinds (WASM,
 * partitioned) should be validated in their respective allocators or
 * mapViews implementations.
 */
function assertBackingCapacity<S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
): void {
  if (backing.kind === 'shared') {
    const required = plan.bytesTotal >>> 0;
    const actual = backing.sab.byteLength >>> 0;

    invariant(
      actual >= required,
      'internal.assertionFailed',
      'Shared backing byteLength smaller than plan.bytesTotal',
      {
        where: 'binding.controller.backing',
        detail: `required=${String(required)}, actual=${String(actual)}`,
      },
    );
  }
  // Other backing kinds (e.g. WASM, partitioned) should be validated
  // in their respective allocators / mapViews implementations.
}

/**
 * Build a controller binding from a concrete plan + backing.
 *
 * @remarks
 * - One successful commit (set/update/stage/hydrate) → exactly one PU bump.
 * - All validation happens before `publish`, so failures never bump PU.
 * - `version()` reads the commit counter; no parity check needed on the controller side.
 */
export function controllerImpl<const S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
  paramDefs: Readonly<Record<string, ParamDef>>,
  options: ControllerOptions = {},
): ControllerBinding<S> {
  const policy: RangePolicy = options.params?.rangePolicy ?? 'reject';
  const exclusive = options.exclusive ?? true;

  assertBackingCapacity(plan, backing);

  if (exclusive) {
    claimBinding(backing, 'controller');
  } else {
    noteBinding(backing, 'controller');
  }
  try {
    const mapped: MappedViews = mapViews(plan, backing);

    // PU seqlock pair for controller param writes (one bump per successful commit).
    const pu = {
      u32: mapped.locks.PU,
      lockIndex: plan.locks.PU.lock,
      seqIndex: plan.locks.PU.seq,
    };

    // Prevalidate & cache fast-path slots.
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
     * Prepare a single scalar write:
     * - validates key/shape,
     * - normalizes public value,
     * - applies range policy (throw for 'reject', clamp for 'clamp'),
     * - returns the validated slot + final value to write.
     * No side-effects; safe to call before publish().
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

      const numeric = typeof normalized === 'boolean' ? (normalized ? 1 : 0) : normalized;
      const range = scalarRangeFor(def);

      if (range) {
        if (numeric < range.min || numeric > range.max) {
          if (policy === 'reject') {
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
    const metersSnapshot = createMeterSnapshot<S>(validatedMeters, mapped.meters);

    const params: ControllerParams<S> = {
      set<K extends ScalarParamKeys<S>>(key: K, value: ParamValueFor<S, K>): void {
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
            throwUnknownKey('params', key, knownParamKeys);
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
            case 'PF32': {
              if (!(v instanceof Float32Array)) {
                throwInvalidParamValue(key, 'Float32Array', v);
              }
              const src = v;
              if (src.length !== expectedLength) {
                throwInvalidParamValue(
                  key,
                  `Float32Array(length ${String(expectedLength)})`,
                  src.length,
                );
              }
              arrayOps.push({ plane: 'PF32', slot, src });
              break;
            }

            case 'PI32': {
              if (!(v instanceof Int32Array)) {
                throwInvalidParamValue(key, 'Int32Array', v);
              }
              const src = v;
              if (src.length !== expectedLength) {
                throwInvalidParamValue(
                  key,
                  `Int32Array(length ${String(expectedLength)})`,
                  src.length,
                );
              }
              arrayOps.push({ plane: 'PI32', slot, src });
              break;
            }

            case 'PB': {
              if (!(v instanceof Uint8Array)) {
                throwInvalidParamValue(key, 'Uint8Array', v);
              }
              const src = v;
              if (src.length !== expectedLength) {
                throwInvalidParamValue(
                  key,
                  `Uint8Array(length ${String(expectedLength)})`,
                  src.length,
                );
              }
              arrayOps.push({ plane: 'PB', slot, src });
              break;
            }

            default: {
              const _plane: never = slot.plane;
              void _plane;
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
              case 'PF32': {
                mapped.params.PF32.set(op.src, start);
                break;
              }
              case 'PI32': {
                mapped.params.PI32.set(op.src, start);
                break;
              }
              case 'PB': {
                mapped.params.PB.set(op.src, start);
                break;
              }
              default: {
                // Compile-time exhaustiveness: if ArrayOp grows, this is a type error.
                // noinspection UnnecessaryLocalVariableJS
                const _exhaustive: never = op;
                void _exhaustive;

                invariant(
                  false,
                  'internal.assertionFailed',
                  'Param hydrate() reached unsupported plane',
                  { detail: 'param.hydrate:unknownPlane' },
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
          throwUnknownKey('params', key, knownParamKeys);
        }

        publish(pu, () => {
          const start = slot.index;
          const end = start + slot.length;
          let view: EphemeralTypedArray;
          if (slot.plane === 'PF32') {
            view = mapped.params.PF32.subarray(start, end);
          } else if (slot.plane === 'PI32') {
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
       * Semantics:
       * - Processor-side `publish(...)` commits exactly once per call by bumping MU.SEQ.
       * - This reader observes that commit via an SC atomic load on the MU Int32Array.
       * - The value is returned in the u32 domain (>>> 0) to model wraparound precisely.
       * - No parity checks are needed for a version read: we only need the commit counter.
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
      releaseBinding(backing, 'controller');
    };

    return {
      params,
      meters,
      dispose,
    };
  } catch (error) {
    releaseBinding(backing, 'controller');
    throw error;
  }
}
