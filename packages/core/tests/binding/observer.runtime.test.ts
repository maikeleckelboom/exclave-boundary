// File: tests/binding/observer.runtime.test.ts

import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  bindObserver,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  acceptHandoff,
} from "../../src";

describe("observer binding – coverage edges", () => {
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

    // 1. Full params snapshot
    const paramsFull = observer.params.snapshot();
    expect(paramsFull).toEqual({
      rate: 0.5,
      active: true,
      mode: "manual",
    });

    // 2. Object-form params subset
    const paramsObject = observer.params.snapshot({
      keys: ["rate", "mode"],
    });

    expect(paramsObject).toEqual({
      rate: 0.5,
      mode: "manual",
    });
    expect("active" in paramsObject).toBe(false);

    // 2b. Varargs params subset
    const paramsVarargs = observer.params.snapshot("rate", "mode");
    expect(paramsVarargs).toEqual({
      rate: 0.5,
      mode: "manual",
    });
    expect("active" in paramsVarargs).toBe(false);

    // 3. Empty params subset: by design, [] acts like “no filter” → full snapshot
    const paramsEmpty = observer.params.snapshot([]);
    expect(paramsEmpty).toEqual(paramsFull);

    // --- meters ----------------------------------------------------------------

    // Meters – initial zeros are fine for shape/coverage
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

    // Params version should move monotonically when controller writes.
    const vP1 = observer.params.version();
    controller.params.set("rate", 0.25);
    const vP2 = observer.params.version();

    expect(vP2).not.toBe(vP1);
    expect(vP2).toBeGreaterThan(vP1);

    // Meters version: we at least exercise the meter publish path via handoff.
    const handoff = buildHandoff(plan, backing);
    const accepted = acceptHandoff(handoff);
    const processor = bindProcessor(accepted);

    const vM1 = observer.meters.version();

    processor.meters.publish((w) => {
      w.set("pressure", 1.0);
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

    // Dispose once
    observer.dispose();
    // Dispose again (should not throw)
    expect(() => {
      observer.dispose();
    }).not.toThrow();

    // Guard checks
    expect(() => observer.params.snapshot()).toThrow(
      /observer binding disposed/,
    );
    expect(() => observer.meters.snapshot()).toThrow(
      /observer binding disposed/,
    );
    expect(() => observer.params.version()).toThrow(
      /observer binding disposed/,
    );
    expect(() => observer.meters.version()).toThrow(
      /observer binding disposed/,
    );
    expect(() => {
      observer.params.within(() => {
        // never called
      });
    }).toThrow(/observer binding disposed/);
  });

  it("accepts and respects budget/policy options", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    // This test verifies the options are passed through without error.
    // Checking actual spin logic requires contention; here we just hit the branches.
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

    // Deliberately allocate a SAB smaller than plan.bytesTotal
    const undersizedSab = new SharedArrayBuffer(bigPlan.bytesTotal - 4);
    const smallBacking = { kind: "shared", sab: undersizedSab } as const;

    expect(() => {
      bindObserver(bigSpec, bigPlan, smallBacking);
    }).toThrow("Single-buffer backing byteLength smaller than plan.bytesTotal");
  });

  it("validates partitioned backing capacity", () => {
    // Force a plan that requires multiple planes
    const partitionedSpec = defineSpec(({ param, meter }) => ({
      params: { a: param.f32() },
      meters: { m: meter.f32() },
    }));
    const plan = planLayout(partitionedSpec);

    // Mock a partitioned backing where one plane is too small
    const planes = {
      PF32: new SharedArrayBuffer(plan.planes.PF32),
      PI32: new SharedArrayBuffer(plan.planes.PI32),
      PB: new SharedArrayBuffer(plan.planes.PB),
      PU: new SharedArrayBuffer(plan.planes.PU),
      MF32: new SharedArrayBuffer(0), // Too small on purpose
      MF64: new SharedArrayBuffer(plan.planes.MF64),
      MU32: new SharedArrayBuffer(plan.planes.MU32),
      MU: new SharedArrayBuffer(plan.planes.MU),
    };

    expect(() => {
      bindObserver(partitionedSpec, plan, {
        kind: "shared-partitioned",
        planes,
      });
    }).toThrow("Partitioned backing plane undersized for plan");
  });
});
