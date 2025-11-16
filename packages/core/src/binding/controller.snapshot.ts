import {
  assertMeterInto,
  assertParamInto,
  throwUnknownKey,
  type MeterPlane,
  type ParamPlane,
} from './validate';
import { createError } from '../errors/error';

import type { ControllerMeters, ControllerParams } from './types';
import type { MeterPlaneViews, ParamPlaneViews } from '../backing/map-views';
import type { ParamDef, SpecInput } from '../spec/types';

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

function isObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object';
}

type EnumDef = Extract<ParamDef, { kind: 'enum' }>;

function isEnumDef(d: unknown): d is EnumDef {
  return isObject(d) && d.kind === 'enum' && Array.isArray(d.values);
}

function enumLabelFromIndex(def: EnumDef, idx: number): string {
  const i = idx | 0;
  const v = def.values[i];
  return typeof v === 'string' ? v : String(i);
}

function copyParamArray(src: Float32Array, into?: Float32Array): Float32Array;
function copyParamArray(src: Int32Array, into?: Int32Array): Int32Array;
function copyParamArray(src: Uint8Array, into?: Uint8Array): Uint8Array;
function copyParamArray(
  src: Float32Array | Int32Array | Uint8Array,
  into?: Float32Array | Int32Array | Uint8Array,
): Float32Array | Int32Array | Uint8Array {
  if (into && into.constructor === src.constructor && into.length === src.length) {
    into.set(src);
    return into;
  }
  if (src instanceof Float32Array) {
    return new Float32Array(src);
  }
  if (src instanceof Int32Array) {
    return new Int32Array(src);
  }
  return new Uint8Array(src);
}

function copyMeterArray(src: Float32Array, into?: Float32Array): Float32Array;
function copyMeterArray(src: Float64Array, into?: Float64Array): Float64Array;
function copyMeterArray(src: Uint32Array, into?: Uint32Array): Uint32Array;
function copyMeterArray(
  src: Float32Array | Float64Array | Uint32Array,
  into?: Float32Array | Float64Array | Uint32Array,
): Float32Array | Float64Array | Uint32Array {
  if (into && into.constructor === src.constructor && into.length === src.length) {
    into.set(src);
    return into;
  }
  if (src instanceof Float32Array) {
    return new Float32Array(src);
  }
  if (src instanceof Float64Array) {
    return new Float64Array(src);
  }
  return new Uint32Array(src);
}

function paramsSnapshotRaw(
  defs: Readonly<Record<string, ParamDef>>,
  slots: Record<string, SnapshotParamSlot>,
  views: ParamPlaneViews,
  knownParamKeys: readonly string[],
  options?: {
    readonly keys: readonly string[];
    readonly into?: Record<string, Float32Array | Int32Array | Uint8Array>;
  },
): Record<string, number | boolean | string | Float32Array | Int32Array | Uint8Array> {
  const keysList = options ? options.keys : knownParamKeys;

  if (options) {
    for (const k of options.keys) {
      if (!(k in slots)) {
        throwUnknownKey('params', k, knownParamKeys);
      }
    }
  }

  const into = options?.into;
  const out: Record<
    string,
    number | boolean | string | Float32Array | Int32Array | Uint8Array
  > = {};

  for (const key of keysList) {
    const slot = slots[key];
    if (!slot) {
      throw createError('internal.assertionFailed', 'Param snapshot slot missing', {
        where: key,
      });
    }
    const start = slot.index;

    if (slot.length > 1) {
      const end = start + slot.length;
      const dst = into?.[key];

      if (dst) {
        assertParamInto(key, slot.plane, dst, slot.length);
        if (slot.plane === 'PF32') {
          (dst as Float32Array).set(views.PF32.subarray(start, end));
        } else if (slot.plane === 'PI32') {
          (dst as Int32Array).set(views.PI32.subarray(start, end));
        } else {
          (dst as Uint8Array).set(views.PB.subarray(start, end));
        }
        out[key] = dst;
      } else {
        if (slot.plane === 'PF32') {
          out[key] = copyParamArray(views.PF32.subarray(start, end));
        } else if (slot.plane === 'PI32') {
          out[key] = copyParamArray(views.PI32.subarray(start, end));
        } else {
          out[key] = copyParamArray(views.PB.subarray(start, end));
        }
      }
    } else {
      if (slot.plane === 'PF32') {
        const vF32 = views.PF32[start];
        if (vF32 === undefined) {
          throw createError('internal.assertionFailed', 'Param PF32 scalar OOB', {
            where: key,
            detail: `index ${String(start)}`,
          });
        }
        out[key] = vF32;
      } else if (slot.plane === 'PI32') {
        const raw = views.PI32[start];
        if (raw === undefined) {
          throw createError('internal.assertionFailed', 'Param PI32 scalar OOB', {
            where: key,
            detail: `index ${String(start)}`,
          });
        }
        const def = defs[key];
        out[key] = isEnumDef(def) ? enumLabelFromIndex(def, raw) : raw;
      } else {
        const b = views.PB[start];
        if (b === undefined) {
          throw createError('internal.assertionFailed', 'Param PB scalar OOB', {
            where: key,
            detail: `index ${String(start)}`,
          });
        }
        out[key] = b !== 0;
      }
    }
  }

  return out;
}

export function createParamSnapshot<S extends SpecInput>(
  defs: Readonly<Record<string, ParamDef>>,
  slots: Record<string, SnapshotParamSlot>,
  views: ParamPlaneViews,
): ControllerParams<S>['snapshot'] {
  const allParamKeys = Object.keys(slots);

  return ((options?: {
    readonly keys?: readonly string[];
    readonly into?: Record<string, Float32Array | Int32Array | Uint8Array>;
  }) => {
    if (!options) {
      return paramsSnapshotRaw(defs, slots, views, allParamKeys);
    }

    if (options.keys && options.keys.length > 0) {
      const base = { keys: options.keys };
      return options.into
        ? paramsSnapshotRaw(defs, slots, views, allParamKeys, {
            ...base,
            into: options.into,
          })
        : paramsSnapshotRaw(defs, slots, views, allParamKeys, base);
    }

    const base = { keys: allParamKeys as readonly string[] };
    return options.into
      ? paramsSnapshotRaw(defs, slots, views, allParamKeys, {
          ...base,
          into: options.into,
        })
      : paramsSnapshotRaw(defs, slots, views, allParamKeys, base);
  }) as ControllerParams<S>['snapshot'];
}

function metersSnapshotRaw(
  slots: Record<string, SnapshotMeterSlot>,
  views: MeterPlaneViews,
  knownMeterKeys: readonly string[],
  options?: {
    readonly keys: readonly string[];
    readonly into?: Record<string, Float32Array | Float64Array | Uint32Array>;
  },
): Record<string, number | Float32Array | Float64Array | Uint32Array> {
  const keysList = options ? options.keys : knownMeterKeys;

  if (options) {
    for (const k of options.keys) {
      if (!(k in slots)) {
        throwUnknownKey('meters', k, knownMeterKeys);
      }
    }
  }

  const into = options?.into;
  const out: Record<string, number | Float32Array | Float64Array | Uint32Array> = {};

  for (const key of keysList) {
    const slot = slots[key];
    if (!slot) {
      throw createError('internal.assertionFailed', 'Meter snapshot slot missing', {
        where: key,
      });
    }
    const start = slot.index;

    if (slot.length > 1) {
      const end = start + slot.length;
      const dst = into?.[key];

      if (dst) {
        assertMeterInto(key, slot.plane, dst, slot.length);
        if (slot.plane === 'MF32') {
          dst.set(views.MF32.subarray(start, end));
        } else if (slot.plane === 'MF64') {
          dst.set(views.MF64.subarray(start, end));
        } else {
          dst.set(views.MU32.subarray(start, end));
        }
        out[key] = dst;
      } else {
        if (slot.plane === 'MF32') {
          out[key] = copyMeterArray(views.MF32.subarray(start, end));
        } else if (slot.plane === 'MF64') {
          out[key] = copyMeterArray(views.MF64.subarray(start, end));
        } else {
          out[key] = copyMeterArray(views.MU32.subarray(start, end));
        }
      }
    } else {
      if (slot.plane === 'MF32') {
        const m32 = views.MF32[start];
        if (m32 === undefined) {
          throw createError('internal.assertionFailed', 'Meter MF32 scalar OOB', {
            where: key,
            detail: `index ${String(start)}`,
          });
        }
        out[key] = m32;
      } else if (slot.plane === 'MF64') {
        const m64 = views.MF64[start];
        if (m64 === undefined) {
          throw createError('internal.assertionFailed', 'Meter MF64 scalar OOB', {
            where: key,
            detail: `index ${String(start)}`,
          });
        }
        out[key] = m64;
      } else {
        const mu = views.MU32[start];
        if (mu === undefined) {
          throw createError('internal.assertionFailed', 'Meter MU32 scalar OOB', {
            where: key,
            detail: `index ${String(start)}`,
          });
        }
        out[key] = mu;
      }
    }
  }

  return out;
}

export function createMeterSnapshot<S extends SpecInput>(
  slots: Record<string, SnapshotMeterSlot>,
  views: MeterPlaneViews,
): ControllerMeters<S>['snapshot'] {
  const allMeterKeys = Object.keys(slots);

  return ((...args: readonly unknown[]) => {
    if (args.length === 0) {
      return metersSnapshotRaw(slots, views, allMeterKeys);
    }

    if (Array.isArray(args[0])) {
      const keys = args[0] as readonly string[];
      const maybeOptions = (args.length > 1 ? args[1] : undefined) as
        | {
            readonly into?: Record<string, Float32Array | Float64Array | Uint32Array>;
          }
        | undefined;
      return maybeOptions?.into
        ? metersSnapshotRaw(slots, views, allMeterKeys, {
            keys,
            into: maybeOptions.into,
          })
        : metersSnapshotRaw(slots, views, allMeterKeys, { keys });
    }

    const allStrings = args.every((x) => typeof x === 'string');
    if (allStrings) {
      return metersSnapshotRaw(slots, views, allMeterKeys, {
        keys: args,
      });
    }

    if (typeof args[0] === 'object' && args[0] !== null) {
      const object = args[0] as {
        readonly keys?: readonly string[];
        readonly into?: Record<string, Float32Array | Float64Array | Uint32Array>;
      };
      if (Array.isArray(object.keys)) {
        const base = { keys: object.keys as readonly string[] };
        return object.into
          ? metersSnapshotRaw(slots, views, allMeterKeys, {
              ...base,
              into: object.into,
            })
          : metersSnapshotRaw(slots, views, allMeterKeys, base);
      }
      if (object.into) {
        return metersSnapshotRaw(slots, views, allMeterKeys, {
          keys: allMeterKeys as readonly string[],
          into: object.into,
        });
      }
      return metersSnapshotRaw(slots, views, allMeterKeys);
    }

    return metersSnapshotRaw(slots, views, allMeterKeys);
  }) as ControllerMeters<S>['snapshot'];
}
