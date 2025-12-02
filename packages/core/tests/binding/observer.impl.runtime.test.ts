import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  bindObserver,
  defineSpec,
  planLayout,
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

describe("observer binding – coverage edges", () => {
  const spec = defineSpec(({ param, meter }) => ({
    params: {
      rate: param.f32(),
      active: param.bool(),
      mode: param.enum(["auto", "manual"]),
    },
    meters: {
      pressure: meter.f32(),
      counter: meter.u32(),
    },
  }));

  it("supports object-form snapshots and subset/varargs forms", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    const controller = bindController(spec, plan, backing);
    const observer = bindObserver(spec, plan, backing);

    controller.params.set("rate", 0.5);
    controller.params.set("active", true);
    controller.params.set("mode", "manual");

    // full params snapshot
    const paramsFull = observer.params.snapshot();
    expect(paramsFull.rate).toBeCloseTo(0.5);
    expect(paramsFull.active).toBe(true);
    expect(paramsFull.mode).toBe("manual");

    // array-form subset
    const paramsArray = observer.params.snapshot(["rate", "mode"]);
    expect(paramsArray).toEqual({
      rate: 0.5,
      mode: "manual",
    });

    // object-form subset
    const paramsObject = observer.params.snapshot({
      keys: ["rate", "mode"],
    });
    expect(paramsObject).toEqual(paramsArray);

    // varargs subset
    const paramsVarargs = observer.params.snapshot("rate", "mode");
    expect(paramsVarargs).toEqual(paramsArray);

    // snapshot([]) → current semantics: treated as full snapshot
    const paramsEmpty = observer.params.snapshot([]);
    expect(Object.keys(paramsEmpty).sort()).toEqual(
      Object.keys(paramsFull).sort(),
    );

    // meters: exercise all forms; values are defaults (zeroed)
    const metersFull = observer.meters.snapshot();
    expect(metersFull).toHaveProperty("pressure");
    expect(metersFull).toHaveProperty("counter");

    const metersArray = observer.meters.snapshot(["pressure"]);
    expect(Object.keys(metersArray)).toEqual(["pressure"]);

    const metersObject = observer.meters.snapshot({
      keys: ["pressure"],
    });
    expect(metersObject).toEqual(metersArray);

    const metersVarargs = observer.meters.snapshot("pressure");
    expect(metersVarargs).toEqual(metersArray);

    const metersEmpty = observer.meters.snapshot([]);
    expect(Object.keys(metersEmpty).sort()).toEqual(
      Object.keys(metersFull).sort(),
    );

    observer.dispose();
  });

  it("exposes version information for params and meters", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    const controller = bindController(spec, plan, backing);
    const observer = bindObserver(spec, plan, backing);

    // Params version should be monotone and bump after a write.
    const vP1 = observer.params.version();
    controller.params.set("rate", 0.1);
    const vP2 = observer.params.version();

    expect(vP2).toBeGreaterThanOrEqual(vP1);
    expect(vP2).not.toBe(vP1);

    // Meters version: we at least exercise the read path.
    const vM = observer.meters.version();
    expect(typeof vM).toBe("number");
    expect(vM).toBeGreaterThanOrEqual(0);

    observer.dispose();
  });

  it("handles dispose idempotency and safeguards", () => {
    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    const observer = bindObserver(spec, plan, backing);

    // First dispose
    observer.dispose();
    // Second dispose is no-op
    expect(() => {
      observer.dispose();
    }).not.toThrow();

    const expectObserverDisposed = (fn: () => unknown) => {
      const thrown = captureError(fn);
      const err = thrown as AssertionErrorShape;

      expect(err.code).toBe("internal.assertionFailed");
      expect(err.details?.where ?? "").toMatch(/observer/i);
      // detail text is centralized now; we only care that an assertion fired
    };

    // All APIs should guard after disposal and surface the internal invariant
    expectObserverDisposed(() => observer.params.snapshot());
    expectObserverDisposed(() => observer.meters.snapshot());
    expectObserverDisposed(() => observer.params.version());
    expectObserverDisposed(() => observer.meters.version());
    expectObserverDisposed(() => {
      observer.params.within(() => {
        // no-op
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
        where: "test.params",
        spinBudget: 5,
        degrade: "returnLatest",
      },
      meters: {
        where: "test.meters",
        retryBudget: 1,
      },
    });

    // We only assert that the observer is usable; detailed contention behaviour
    // is covered by coherent snapshot tests.
    expect(() => observer.params.snapshot()).not.toThrow();
    expect(() => {
      observer.params.within((view) => {
        // Default initial values: zeroed.
        expect(view.rate).toBe(0);
      });
    }).not.toThrow();

    expect(() => observer.meters.snapshot()).not.toThrow();

    observer.dispose();
  });

  it("rejects undersized shared backings", () => {
    const smallSpec = defineSpec(({ param, meter }) => ({
      params: {
        a: param.f32(),
      },
      meters: {
        m: meter.f32(),
      },
    }));

    const smallPlan = planLayout(smallSpec);

    // Construct an intentionally undersized SAB for this plan.
    const required = smallPlan.bytesTotal >>> 0;
    const undersizedBytes = required > 4 ? required - 4 : required >>> 0;

    const sab = new SharedArrayBuffer(undersizedBytes);
    const smallBacking: SharedBacking = {
      kind: "shared",
      sab,
    };

    const thrown = captureError(() => {
      bindObserver(smallSpec, smallPlan, smallBacking);
    });

    const err = thrown as AssertionErrorShape;

    expect(err.code).toBe("internal.assertionFailed");
    expect(err.details?.where ?? "").toMatch(/bindObserver|binding\.observer/i);
    // detail text is left to dedicated error tests
  });

  it("validates partitioned backing capacity", () => {
    const partitionedSpec = defineSpec(({ param, meter }) => ({
      params: {
        a: param.f32(),
      },
      meters: {
        m: meter.f32(),
      },
    }));

    const partitionedPlan = planLayout(partitionedSpec);

    const makePlane = (bytes: number): SharedArrayBuffer =>
      new SharedArrayBuffer(bytes);

    const planes: SharedPartitionedBacking["planes"] = {
      PF32: makePlane(partitionedPlan.planes.PF32),
      PI32: makePlane(partitionedPlan.planes.PI32),
      PB: makePlane(partitionedPlan.planes.PB),
      PU: makePlane(partitionedPlan.planes.PU),
      MF32:
        partitionedPlan.planes.MF32 > 0
          ? makePlane(partitionedPlan.planes.MF32 - 4) // deliberately undersized
          : makePlane(0),
      MF64: makePlane(partitionedPlan.planes.MF64),
      MU32: makePlane(partitionedPlan.planes.MU32),
      MU: makePlane(partitionedPlan.planes.MU),
    };

    const undersizedPartitionedBacking: SharedPartitionedBacking = {
      kind: "shared-partitioned",
      planes,
    };

    const thrown = captureError(() => {
      bindObserver(
        partitionedSpec,
        partitionedPlan,
        undersizedPartitionedBacking,
      );
    });

    const err = thrown as AssertionErrorShape;

    expect(err.code).toBe("internal.assertionFailed");
    expect(err.details?.where ?? "").toMatch(/bindObserver|binding\.observer/i);
    // again, do not assert message text here
  });
});
