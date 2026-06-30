import { describe, expect, it } from "vitest";

import { defineSpec } from "../../src";
import { bindingsFromSpec } from "../helpers/binding";

import type { MeterGroupValues } from "../../src";

describe("ProcessorMeters grouped publishing", () => {
  const spec = defineSpec(({ meter }) => ({
    id: "group-runtime",
    meters: {
      runtime: {
        active: meter.bool(),
        count: meter.u32(),
        peak: meter.f32(),
      },
      levels: {
        flags: meter.u32.array(3),
        hold: meter.f64(),
        spectrum: meter.f32.array(4),
      },
    },
  }));

  it("commits writer.setGroup values inside one publish transaction", () => {
    const { ctl, proc } = bindingsFromSpec(spec);
    const startVersion = ctl.meters.version();

    proc.meters.publish((writer) => {
      writer.setGroup("runtime", {
        active: true,
        count: 42,
        peak: 0.5,
      });
      writer.setGroup("levels", {
        flags: Uint32Array.from([1, 2, 3]),
        hold: Math.PI,
        spectrum: Float32Array.from([0, 0.25, 0.5, 1]),
      });
    });

    expect(ctl.meters.version()).toBe(startVersion + 1);

    const meters = ctl.meters.snapshot(
      "runtime.active",
      "runtime.count",
      "runtime.peak",
      "levels.flags",
      "levels.hold",
      "levels.spectrum",
    );

    expect(meters["runtime.active"]).toBe(true);
    expect(meters["runtime.count"]).toBe(42);
    expect(meters["runtime.peak"]).toBeCloseTo(0.5);
    expect(meters["levels.hold"]).toBeCloseTo(Math.PI);
    expect(Array.from(meters["levels.flags"])).toEqual([1, 2, 3]);
    expect(Array.from(meters["levels.spectrum"])).toEqual([0, 0.25, 0.5, 1]);
  });

  it("publishes one group through meters.publishGroup", () => {
    const { ctl, proc } = bindingsFromSpec(spec);
    const startVersion = ctl.meters.version();

    proc.meters.publishGroup("runtime", {
      active: false,
      count: 7,
      peak: 0.125,
    });

    expect(ctl.meters.version()).toBe(startVersion + 1);

    const meters = ctl.meters.snapshot(
      "runtime.active",
      "runtime.count",
      "runtime.peak",
    );

    expect(meters["runtime.active"]).toBe(false);
    expect(meters["runtime.count"]).toBe(7);
    expect(meters["runtime.peak"]).toBeCloseTo(0.125);
  });

  it("keeps runtime validation for unknown grouped keys", () => {
    const { proc } = bindingsFromSpec(spec);
    const invalidValues = {
      active: true,
      count: 1,
      extra: 1,
      peak: 0.25,
    };

    expect(() => {
      proc.meters.publish((writer) => {
        writer.setGroup(
          "runtime",
          invalidValues as unknown as MeterGroupValues<typeof spec, "runtime">,
        );
      });
    }).toThrow(/unknown/i);
  });

  it("validates group names even when the values object is empty", () => {
    const { proc } = bindingsFromSpec(spec);

    expect(() => {
      proc.meters.publish((writer) => {
        (
          writer as unknown as {
            setGroup(group: string, values: unknown): void;
          }
        ).setGroup("missing", {});
      });
    }).toThrow(/unknown/i);
  });

  it("rejects array group values with the wrong length", () => {
    const { proc } = bindingsFromSpec(spec);

    expect(() => {
      proc.meters.publish((writer) => {
        writer.setGroup("levels", {
          flags: Uint32Array.from([1, 2, 3]),
          hold: 1,
          spectrum: Float32Array.from([1, 2]),
        });
      });
    }).toThrow(/length/i);
  });
});
