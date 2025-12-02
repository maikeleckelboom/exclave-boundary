import { describe, expect, it } from "vitest";

import { allocateShared } from "../../src/backing/allocate-shared";
import { mapViews } from "../../src/backing/map-views";
import {
  validateMeterSlots,
  validateParamSlots,
  type MeterSlot,
  type ParamSlot,
} from "../../src/binding/common/validate";
import {
  createObserverMeterSnapshot,
  createObserverParamSnapshot,
} from "../../src/binding/observer/snapshot";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

describe("observer snapshots", () => {
  it("read scalar and array params / meters from backing planes", () => {
    const spec = defineSpec(({ param, meter }) => ({
      params: {
        rate: param.f32({ min: 0.5, max: 2 }),
        mode: param.enum(["a", "b"]),
        enabled: param.bool(),
        curve: param.f32.array(4),
      },
      meters: {
        peak: meter.f32(),
        rms: meter.f32(),
        history: meter.f32.array(3),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const mapped = mapViews(plan, backing);

    const paramSlots = validateParamSlots(
      plan.params as Record<string, ParamSlot>,
      mapped.params,
    );
    const meterSlots = validateMeterSlots(
      plan.meters as Record<string, MeterSlot>,
      mapped.meters,
    );

    /** Pre-fill param planes to mimic a controller commit. */
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mapped.params.PF32[paramSlots.rate!.index] = 1.25;
    mapped.params.PF32.set(
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      paramSlots.curve!.index,
    );
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mapped.params.PI32[paramSlots.mode!.index] = 1; // enum index → 'b'
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mapped.params.PB[paramSlots.enabled!.index] = 1; // bool true

    /** Pre-fill meter planes to mimic processor publishes. */
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mapped.meters.MF32[meterSlots.peak!.index] = 0.9;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    mapped.meters.MF32[meterSlots.rms!.index] = 0.4;
    mapped.meters.MF32.set(
      new Float32Array([0.11, 0.22, 0.33]),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      meterSlots.history!.index,
    );

    const paramsSnapshot = createObserverParamSnapshot<typeof spec>(
      spec.params,
      paramSlots,
      mapped.params,
    );

    const metersSnapshot = createObserverMeterSnapshot<typeof spec>(
      meterSlots,
      mapped.meters,
    );

    const paramsFull = paramsSnapshot();

    expect(paramsFull.rate).toBeCloseTo(1.25);
    expect(paramsFull.enabled).toBe(true);
    expect(paramsFull.mode).toBe("b");
    expect(paramsFull.curve).toBeInstanceOf(Float32Array);

    const curveValues = Array.from(paramsFull.curve);

    expect(curveValues).toHaveLength(4);
    expect(curveValues[0]).toBeCloseTo(0.1);
    expect(curveValues[1]).toBeCloseTo(0.2);
    expect(curveValues[2]).toBeCloseTo(0.3);
    expect(curveValues[3]).toBeCloseTo(0.4);

    const paramsSubset = paramsSnapshot(["rate", "enabled"] as const);

    expect(Object.keys(paramsSubset).sort()).toEqual(["enabled", "rate"]);
    expect(paramsSubset.rate).toBeCloseTo(1.25);
    expect(paramsSubset.enabled).toBe(true);

    const metersFull = metersSnapshot();

    expect(metersFull.peak).toBeCloseTo(0.9);
    expect(metersFull.rms).toBeCloseTo(0.4);
    expect(metersFull.history).toBeInstanceOf(Float32Array);

    const historyValues = Array.from(metersFull.history);

    expect(historyValues).toHaveLength(3);
    expect(historyValues[0]).toBeCloseTo(0.11);
    expect(historyValues[1]).toBeCloseTo(0.22);
    expect(historyValues[2]).toBeCloseTo(0.33);

    const metersSubset = metersSnapshot(["rms"] as const);

    expect(Object.keys(metersSubset)).toEqual(["rms"]);
    expect(metersSubset.rms).toBeCloseTo(0.4);
  });

  it("returns ephemeral array views backed by the same underlying planes", () => {
    const spec = defineSpec(({ param, meter }) => ({
      params: {
        curve: param.f32.array(4),
      },
      meters: {
        history: meter.f32.array(3),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const mapped = mapViews(plan, backing);

    const paramSlots = validateParamSlots(
      plan.params as Record<string, ParamSlot>,
      mapped.params,
    );
    const meterSlots = validateMeterSlots(
      plan.meters as Record<string, MeterSlot>,
      mapped.meters,
    );

    // Seed with initial values.
    mapped.params.PF32.set(
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      paramSlots.curve!.index,
    );
    mapped.meters.MF32.set(
      new Float32Array([0.11, 0.22, 0.33]),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      meterSlots.history!.index,
    );

    const paramsSnapshot = createObserverParamSnapshot<typeof spec>(
      spec.params,
      paramSlots,
      mapped.params,
    );

    const metersSnapshot = createObserverMeterSnapshot<typeof spec>(
      meterSlots,
      mapped.meters,
    );

    const paramsFirst = paramsSnapshot();
    const curveView = paramsFirst.curve;

    const metersFirst = metersSnapshot();
    const historyView = metersFirst.history;

    // Mutate backing planes directly.
    mapped.params.PF32.set(
      new Float32Array([1, 2, 3, 4]),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      paramSlots.curve!.index,
    );
    mapped.meters.MF32.set(
      new Float32Array([9, 8, 7]),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      meterSlots.history!.index,
    );

    const paramsSecond = paramsSnapshot();
    const metersSecond = metersSnapshot();

    /**
     * Both the old captured views and fresh snapshots should see updated data,
     * proving we are returning ephemeral subarray views with no copies.
     */

    expect(Array.from(curveView)).toEqual([1, 2, 3, 4]);
    expect(Array.from(paramsSecond.curve)).toEqual([1, 2, 3, 4]);

    expect(Array.from(historyView)).toEqual([9, 8, 7]);
    expect(Array.from(metersSecond.history)).toEqual([9, 8, 7]);
  });
});
