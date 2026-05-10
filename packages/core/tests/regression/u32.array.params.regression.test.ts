// File: packages/core/tests/regression/u32.array.params.regression.test.ts

import { describe, expect, test } from "vitest";

import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  acceptHandoff,
} from "../../src";

function setup() {
  const spec = defineSpec(({ param }) => ({
    id: "regression/u32.array",
    params: {
      arr: param.u32.array(6),
    },
  }));

  const plan = planLayout(spec);
  const backing = allocateShared(plan);

  const ctl = bindController(spec, plan, backing);

  // Critical: processor binds from accepted handoff (defs may be unavailable there).
  const handoff = buildHandoff(plan, backing);
  const accepted = acceptHandoff(handoff);
  const proc = bindProcessor(accepted);

  return { spec, plan, backing, ctl, proc };
}

describe("Regression: u32.array params (do not delete)", () => {
  test("processor sees Uint32Array even when defs are unavailable (accepted handoff)", () => {
    const { ctl, proc } = setup();

    const write = new Uint32Array([
      0, 1, 2, 0x7fffffff, 0x80000000, 0xffffffff,
    ]);

    ctl.params.stage("arr", (v) => {
      // Compile-time sanity: ephemeral view must be usable as Uint32Array
      const _u32: Uint32Array = v;
      void _u32;

      expect(v).toBeInstanceOf(Uint32Array);
      v.set(write);
    });

    proc.params.within((view) => {
      const _u32: Uint32Array = view.arr;
      void _u32;

      expect(view.arr).toBeInstanceOf(Uint32Array);
      expect(view.arr.length).toBe(6);
      expect(view.arr[3]).toBe(0x7fffffff);
      expect(view.arr[4]).toBe(0x80000000);
      expect(view.arr[5]).toBe(0xffffffff);
    });
  });

  test("snapshot into reuses identity for u32.array", () => {
    const { ctl } = setup();

    const write = new Uint32Array([
      10, 11, 12, 0x7fffffff, 0x80000000, 0xffffffff,
    ]);

    ctl.params.hydrate({ arr: write });

    const keys = ["arr"] as const;

    // Controller snapshot takes a single options object (not observer-style overloads).
    const snap = ctl.params.snapshot({ keys });
    expect(snap.arr).toBeInstanceOf(Uint32Array);
    expect(snap.arr[4]).toBe(0x80000000);
    expect(snap.arr[5]).toBe(0xffffffff);

    const into = new Uint32Array(6);

    const snapInto = ctl.params.snapshot({
      keys,
      into: { arr: into },
    });

    expect(snapInto.arr).toBe(into);
    expect(snapInto.arr[0]).toBe(10);
    expect(snapInto.arr[4]).toBe(0x80000000);
    expect(snapInto.arr[5]).toBe(0xffffffff);
  });
});
