// packages/core/src/binding/processor.impl.ts
/**
 * Internal implementation — single runtime path (plan + backing → binding).
 * All overload resolution and generic pinning happens in the shim.
 */

import {
  type MappedViews,
  mapViews,
  type MeterPlaneViews,
  type ParamPlaneViews,
} from '../backing/map-views';
import { createError } from '../errors/error';
import { invariant } from '../errors/invariant';
import { publish } from '../primitives/seqlock';

import type {
  Ephemeral,
  MeterWriter,
  MUSeq,
  ProcessorBinding,
  ProcessorMeters,
  ProcessorOptions,
  ProcessorParams,
  PUSeq,
} from './types';
import type { MeterPlane, ParamPlane } from './validate';
import type { Backing } from '../backing/types';
import type { Plan } from '../plan/types';
import type { SpecInput } from '../spec/types';

type _WithinCallback<S extends SpecInput> = Parameters<ProcessorParams<S>['within']>[0];
type _WithinView<S extends SpecInput> =
  _WithinCallback<S> extends (view: infer V) => unknown ? V : never;

interface SlotBase {
  readonly offset: number; // byte offset
  readonly length: number; // element count
  readonly bytesPerElement: number;
}

interface ParamSlot extends SlotBase {
  readonly plane: ParamPlane | 'PU';
}

interface MeterSlot extends SlotBase {
  readonly plane: MeterPlane | 'MU';
}

function isParamDataPlane(p: ParamSlot['plane']): p is ParamPlane {
  return p === 'PF32' || p === 'PI32' || p === 'PB';
}

function isMeterDataPlane(p: MeterSlot['plane']): p is MeterPlane {
  return p === 'MF32' || p === 'MF64' || p === 'MU32';
}

function ensurePlane<T>(v: T | undefined, where: string, detail: string): T {
  invariant(v !== undefined, 'internal.assertionFailed', 'expected defined plane view', {
    where,
    detail,
  });
  return v;
}

function readNumberAt(
  values: { length: number; [n: number]: number },
  index: number,
  where: string,
): number {
  invariant(
    index >= 0 && index < values.length,
    'internal.assertionFailed',
    'offset out of range',
    { where, detail: `${String(index)}/${String(values.length)}` },
  );
  const v = values[index];
  invariant(
    typeof v === 'number',
    'internal.assertionFailed',
    'expected numeric element',
    { where, detail: String(index) },
  );
  return v;
}

function paramArrayViewFor(
  views: ParamPlaneViews,
  slot: ParamSlot & { plane: ParamPlane; length: number },
): Ephemeral<Float32Array> | Ephemeral<Int32Array> | Ephemeral<Uint8Array> {
  invariant(slot.length > 1, 'internal.assertionFailed', 'array param expected', {
    where: 'param.array',
    detail: slot.plane,
  });
  const start = (slot.offset / slot.bytesPerElement) | 0;
  const end = start + slot.length;
  switch (slot.plane) {
    case 'PF32':
      return ensurePlane(views.PF32, 'param.array', 'PF32').subarray(
        start,
        end,
      ) as Ephemeral<Float32Array>;
    case 'PI32':
      return ensurePlane(views.PI32, 'param.array', 'PI32').subarray(
        start,
        end,
      ) as Ephemeral<Int32Array>;
    case 'PB':
      return ensurePlane(views.PB, 'param.array', 'PB').subarray(
        start,
        end,
      ) as Ephemeral<Uint8Array>;
  }
}

function readParamScalar(
  views: ParamPlaneViews,
  slot: ParamSlot & { plane: ParamPlane; length: 1 },
): number | boolean {
  const i = (slot.offset / slot.bytesPerElement) | 0;
  switch (slot.plane) {
    case 'PF32': {
      const at = ensurePlane(views.PF32, 'param.scalar', 'PF32');
      return readNumberAt(at, i, 'param.scalar');
    }
    case 'PI32': {
      const at = ensurePlane(views.PI32, 'param.scalar', 'PI32');
      return (readNumberAt(at, i, 'param.scalar') | 0) >>> 0;
    }
    case 'PB': {
      const a = ensurePlane(views.PB, 'param.scalar', 'PB');
      const v = readNumberAt(a, i, 'param.scalar');
      return v !== 0;
    }
  }
}

function meterArrayViewFor(
  views: MeterPlaneViews,
  slot: MeterSlot & { plane: MeterPlane; length: number },
): Ephemeral<Float32Array> | Ephemeral<Float64Array> | Ephemeral<Uint32Array> {
  invariant(slot.length > 1, 'internal.assertionFailed', 'array meter expected', {
    where: 'meter.array',
    detail: slot.plane,
  });
  const start = (slot.offset / slot.bytesPerElement) | 0;
  const end = start + slot.length;
  switch (slot.plane) {
    case 'MF32':
      return ensurePlane(views.MF32, 'meter.array', 'MF32').subarray(
        start,
        end,
      ) as Ephemeral<Float32Array>;
    case 'MF64':
      return ensurePlane(views.MF64, 'meter.array', 'MF64').subarray(
        start,
        end,
      ) as Ephemeral<Float64Array>;
    case 'MU32':
      return ensurePlane(views.MU32, 'meter.array', 'MU32').subarray(
        start,
        end,
      ) as Ephemeral<Uint32Array>;
  }
}

function elementIndex(s: SlotBase): number {
  return (s.offset / s.bytesPerElement) | 0;
}

function makeScalarWriter(
  values: { length: number; [n: number]: number },
  index: number,
  coerce: (v: number) => number,
  where: string,
): (value: number) => void {
  invariant(
    index >= 0 && index < values.length,
    'internal.assertionFailed',
    'offset out of range',
    { where, detail: `${String(index)}/${String(values.length)}` },
  );
  return (value: number) => {
    values[index] = coerce(value);
  };
}

function assertNotDisposed(disposed: boolean, where: string): void {
  invariant(!disposed, 'internal.assertionFailed', 'processor binding disposed', {
    where,
  });
}

function throwUnknownKey(
  scope: 'params' | 'meters',
  key: string,
  known: readonly string[],
): never {
  throw createError('binding.unknownKey', `Unknown ${scope} key "${key}"`, {
    scope,
    key,
    known,
  });
}

/**
 * Build a processor binding from a concrete plan + backing.
 */
export function processorImpl<const S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
  _options: ProcessorOptions = {},
): ProcessorBinding<S> {
  const mapped: MappedViews = mapViews(plan, backing);
  const paramSlots = plan.params as Record<string, ParamSlot>;
  const meterSlots = plan.meters as Record<string, MeterSlot>;

  let disposed = false;

  const params: ProcessorParams<S> = {
    within: ((callback) => {
      assertNotDisposed(disposed, 'processor.params.within');

      const view: Record<string, unknown> = {};
      for (const key of Object.keys(paramSlots)) {
        const slot0 = paramSlots[key];

        invariant(
          !!slot0 && isParamDataPlane(slot0.plane),
          'internal.assertionFailed',
          'unexpected param plane',
          {
            where: slot0?.length && slot0.length > 1 ? 'param.array' : 'param.scalar',
            detail: slot0?.plane ?? 'unknown',
          },
        );

        if (slot0.length > 1) {
          view[key] = paramArrayViewFor(mapped.params, { ...slot0, plane: slot0.plane });
        } else {
          view[key] = readParamScalar(mapped.params, {
            ...slot0,
            plane: slot0.plane,
            length: 1,
          });
        }
      }

      return callback(view as _WithinView<S>);
    }) as ProcessorParams<S>['within'],

    version(): PUSeq {
      assertNotDisposed(disposed, 'processor.params.version');
      const u = mapped.locks.PU;
      return Atomics.load(u, plan.locks.PU.seq) >>> 0;
    },
  };

  // Pre-bind scalar writers
  const scalarWriters: Record<string, (value: number) => void> = {};
  for (const key of Object.keys(meterSlots)) {
    const slot0 = meterSlots[key];
    if (slot0?.length !== 1) {
      continue;
    }

    const elIndex = elementIndex(slot0);
    switch (slot0.plane) {
      case 'MF32': {
        const a = ensurePlane(mapped.meters.MF32, 'meter.scalar', 'MF32');
        scalarWriters[key] = makeScalarWriter(a, elIndex, (v) => v, 'meter.scalar');
        break;
      }
      case 'MF64': {
        const a = ensurePlane(mapped.meters.MF64, 'meter.scalar', 'MF64');
        scalarWriters[key] = makeScalarWriter(a, elIndex, (v) => v, 'meter.scalar');
        break;
      }
      case 'MU32': {
        const a = ensurePlane(mapped.meters.MU32, 'meter.scalar', 'MU32');
        scalarWriters[key] = makeScalarWriter(a, elIndex, (v) => v >>> 0, 'meter.scalar');
        break;
      }
      case 'MU':
        break;
    }
  }

  // MU lock bundle used by publish()
  const mu = {
    u32: mapped.locks.MU,
    lockIndex: plan.locks.MU.lock,
    seqIndex: plan.locks.MU.seq,
  };

  type EM = Ephemeral<Float32Array> | Ephemeral<Float64Array> | Ephemeral<Uint32Array>;

  const meters: ProcessorMeters<S> = {
    publish<T>(cb: (writer: MeterWriter<S>) => T): T {
      assertNotDisposed(disposed, 'processor.meters.publish');

      // Writer surface
      const w: Record<string, unknown> = {};
      for (const key of Object.keys(scalarWriters)) {
        w[key] = scalarWriters[key];
      }

      function stage(key: string, cb2: (dst: EM) => void): void {
        const slot0 = meterSlots[key];
        if (!slot0) {
          throwUnknownKey('meters', key, Object.keys(meterSlots));
        }
        invariant(slot0.length > 1, 'internal.assertionFailed', 'array meter expected', {
          where: 'meter.stage',
          detail: key,
        });
        invariant(
          isMeterDataPlane(slot0.plane),
          'internal.assertionFailed',
          'unexpected meter plane',
          { where: 'meter.stage', detail: slot0.plane },
        );
        const view = meterArrayViewFor(mapped.meters, { ...slot0, plane: slot0.plane });
        cb2(view);
      }

      function set(key: string, arg: number | ((dst: EM) => void)): void {
        if (typeof arg === 'function') {
          stage(key, arg);
          return;
        }
        const f = scalarWriters[key];
        if (!f) {
          throwUnknownKey('meters', key, Object.keys(scalarWriters));
        }
        f(arg);
      }

      (w as { stage: typeof stage }).stage = stage;
      (w as { set: typeof set }).set = set;

      // Exactly one MU commit per publish()
      return publish(mu, () => cb(w as MeterWriter<S>));
    },

    version(): MUSeq {
      assertNotDisposed(disposed, 'processor.meters.version');
      const u = mapped.locks.MU;
      return Atomics.load(u, plan.locks.MU.seq) >>> 0;
    },
  };

  return {
    params,
    meters,
    dispose(): void {
      disposed = true;
    },
  };
}
