import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  bindObserver,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  receiveHandoff,
} from "../../src";

import type {
  SharedBacking,
  SharedPartitionedBacking,
} from "../../src/backing/types";

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error(
    `Error(core/tests/helpers/capture-error.ts): Expected function to throw.`,
  );
}

interface AssertionErrorShape {
  code?: string;
  details?: { where?: string; detail?: string };
}

describe("observer binding - coverage edges", () => {
  const spec = defineSpec(({ param, meter }) => ({
    params: {
      rate: param.f32({ min: 0, max: 2 }),
      active: param.bool(),
      mode: param.enum(["auto", "manual"]),
    },
    meters: {
      pressure: meter.f32(),
      counter: meter.u32(),
    },
  }));

  it("supports object-form, varargs, and empty-subset snapshots", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const controller = bindController(spec, plan, backing);
    const observer = bindObserver(spec, plan, backing);

    controller.params.set("rate", 0.5);
    controller.params.set("active", true);
    controller.params.set("mode", "manual");

    // full params snapshot
    const paramsFull = observer.params.snapshot();
    expect(paramsFull).toEqual({
      rate: 0.5,
      active: true,
      mode: "manual",
    });

    // object-form params subset
    const paramsObject = observer.params.snapshot({
      keys: ["rate", "mode"],
    });
    expect(paramsObject).toEqual({
      rate: 0.5,
      mode: "manual",
    });
    expect("active" in paramsObject).toBe(false);

    // varargs params subset
    const paramsVarargs = observer.params.snapshot("rate", "mode");
    expect(paramsVarargs).toEqual({
      rate: 0.5,
      mode: "manual",
    });
    expect("active" in paramsVarargs).toBe(false);

    // empty params subset: [] acts like no filter → full snapshot
    const paramsEmpty = observer.params.snapshot([]);
    expect(paramsEmpty).toEqual(paramsFull);

    // meters, initial zeros are fine for shape and coverage
    const metersFull = observer.meters.snapshot();
    expect(metersFull).toEqual({
      pressure: 0,
      counter: 0,
    });

    const metersObject = observer.meters.snapshot({
      keys: ["pressure"],
    });
    expect(metersObject).toEqual({ pressure: 0 });
    expect("counter" in metersObject).toBe(false);

    const metersVarargs = observer.meters.snapshot("pressure");
    expect(metersVarargs).toEqual({ pressure: 0 });
    expect("counter" in metersVarargs).toBe(false);

    const metersEmpty = observer.meters.snapshot([]);
    expect(metersEmpty).toEqual(metersFull);

    observer.dispose();
  });

  it("exposes version information for params and meters", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const controller = bindController(spec, plan, backing);
    const observer = bindObserver(spec, plan, backing);

    // params version should move monotonically when controller writes
    const vP1 = observer.params.version();
    controller.params.set("rate", 0.25);
    const vP2 = observer.params.version();

    expect(vP2).not.toBe(vP1);
    expect(vP2).toBeGreaterThan(vP1);

    // meters version via handoff and processor publish
    const handoff = buildHandoff(plan, backing);
    const received = receiveHandoff(handoff);
    const processor = bindProcessor(received);

    const vM1 = observer.meters.version();

    processor.meters.publish((w) => {
      w.set("pressure", 1);
      w.set("counter", 1);
    });

    const vM2 = observer.meters.version();
    expect(vM2).not.toBe(vM1);
    expect(vM2).toBeGreaterThan(vM1);

    observer.dispose();
  });

  it("handles dispose idempotency and safeguards", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const observer = bindObserver(spec, plan, backing);

    // first dispose
    observer.dispose();
    // second dispose is a no-op
    expect(() => {
      observer.dispose();
    }).not.toThrow();

    const expectObserverDisposed = (fn: () => unknown) => {
      const thrown = captureError(fn);
      const err = thrown as AssertionErrorShape;

      expect(err.code).toBe("internal.assertionFailed");
      expect(err.details?.where ?? "").toMatch(/observer/i);
    };

    // guard checks on all observer APIs
    expectObserverDisposed(() => observer.params.snapshot());
    expectObserverDisposed(() => observer.meters.snapshot());
    expectObserverDisposed(() => observer.params.version());
    expectObserverDisposed(() => observer.meters.version());
    expectObserverDisposed(() => {
      observer.params.within(() => {
        // never reached
      });
    });
  });

  it("accepts and respects budget/policy options", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    const observer = bindObserver(spec, plan, backing, {
      spinBudget: 10,
      retryBudget: 0,
      params: {
        where: "custom.params",
        spinBudget: 5,
        degrade: "returnLatest",
      },
      meters: {
        where: "custom.meters",
        retryBudget: 1,
      },
    });

    expect(() => observer.params.snapshot()).not.toThrow();
    expect(() => observer.meters.snapshot()).not.toThrow();

    observer.dispose();
  });

  it("rejects undersized shared backings", () => {
    const bigSpec = defineSpec(({ param, meter }) => ({
      params: {
        a: param.f32(),
        b: param.f32(),
        c: param.f32(),
        d: param.f32(),
      },
      meters: {
        m0: meter.f32(),
        m1: meter.f32(),
      },
    }));

    const bigPlan = planLayout(bigSpec);

    const undersizedSab = new SharedArrayBuffer(bigPlan.bytesTotal - 4);
    const smallBacking: SharedBacking = {
      kind: "shared",
      sab: undersizedSab,
    };

    const thrown = captureError(() => {
      bindObserver(bigSpec, bigPlan, smallBacking);
    });

    const err = thrown as AssertionErrorShape;

    expect(err.code).toBe("internal.assertionFailed");
    expect(err.details?.where ?? "").toMatch(/bindObserver|binding\.observer/i);
  });

  it("validates partitioned backing capacity", () => {
    const partitionedSpec = defineSpec(({ param, meter }) => ({
      params: { a: param.f32() },
      meters: { m: meter.f32() },
    }));

    const plan = planLayout(partitionedSpec);

    const makePlane = (bytes: number): SharedArrayBuffer =>
      new SharedArrayBuffer(bytes);

    const planes: SharedPartitionedBacking["planes"] = {
      PF32: makePlane(plan.planes.PF32),
      PI32: makePlane(plan.planes.PI32),
      PB: makePlane(plan.planes.PB),
      PU: makePlane(plan.planes.PU),
      MF32:
        plan.planes.MF32 > 0
          ? makePlane(plan.planes.MF32 - 4) // deliberately undersized
          : makePlane(0),
      MF64: makePlane(plan.planes.MF64),
      MU32: makePlane(plan.planes.MU32),
      MU: makePlane(plan.planes.MU),
    };

    const backing: SharedPartitionedBacking = {
      kind: "shared-partitioned",
      planes,
    };

    const thrown = captureError(() => {
      bindObserver(partitionedSpec, plan, backing);
    });

    const err = thrown as AssertionErrorShape;

    expect(err.code).toBe("internal.assertionFailed");
    expect(err.details?.where ?? "").toMatch(/bindObserver|binding\.observer/i);
  });
});
