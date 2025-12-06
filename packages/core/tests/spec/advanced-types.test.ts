import { describe, expect, it } from "vitest";

import { defineSpec } from "../../src";
import { bindingsFromSpec } from "../helpers/binding";

describe("Array Offsets: Type-Level Regression Contracts", () => {
  it("correctly reads multiple array params with non-zero offsets", () => {
    const spec = defineSpec(({ param }) => ({
      id: "multi-array-offset",
      params: {
        a: param.f32({ min: 0, max: 1 }), // 1 elem @ offset 0
        b: param.f32.array(4), // 4 elems @ offset 4
        c: param.f32({ min: 0, max: 1 }), // 1 elem @ offset 20
        d: param.f32.array(8), // 8 elems @ offset 24
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    // Write distinct values.
    ctl.params.set("a", 0.1);
    ctl.params.stage("b", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = 0.2 + i * 0.01;
      }
    });
    ctl.params.set("c", 0.3);
    ctl.params.stage("d", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = 0.4 + i * 0.01;
      }
    });

    // Verify lengths and values in processor.
    proc.params.within((view) => {
      expect(view.b.length).toBe(4);
      expect(view.d.length).toBe(8);

      expect(view.a).toBeCloseTo(0.1);
      expect(view.b[0]).toBeCloseTo(0.2);
      expect(view.b[3]).toBeCloseTo(0.23);
      expect(view.c).toBeCloseTo(0.3);
      expect(view.d[0]).toBeCloseTo(0.4);
      expect(view.d[7]).toBeCloseTo(0.47);
    });

    // Verify controller snapshots.
    const snap = ctl.params.snapshot();
    expect(snap.b.length).toBe(4);
    expect(snap.d.length).toBe(8);
    expect(snap.a).toBeCloseTo(0.1);
    expect(snap.b[0]).toBeCloseTo(0.2);
    expect(snap.b[3]).toBeCloseTo(0.23);
    expect(snap.c).toBeCloseTo(0.3);
    expect(snap.d[0]).toBeCloseTo(0.4);
    expect(snap.d[7]).toBeCloseTo(0.47);
  });

  it("correctly reads i32 and bool arrays with non-zero offsets", () => {
    const spec = defineSpec(({ param }) => ({
      id: "mixed-array-offset",
      params: {
        gain: param.f32({ min: 0, max: 1 }), // f32 scalar @ PF32 offset 0
        indices: param.i32.array(6), // i32 array @ PI32 offset 0
        mode: param.i32({ min: 0, max: 10 }), // i32 scalar @ PI32 offset 24
        flags: param.bool.array(10), // bool array @ PB offset 0
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    ctl.params.set("gain", 0.5);
    ctl.params.set("mode", 7);
    ctl.params.stage("indices", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = i * 10;
      }
    });
    ctl.params.stage("flags", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = i % 2;
      }
    });

    proc.params.within((view) => {
      expect(view.indices.length).toBe(6);
      expect(view.flags.length).toBe(10);

      expect(view.gain).toBeCloseTo(0.5);
      expect(view.mode).toBe(7);
      expect(view.indices[0]).toBe(0);
      expect(view.indices[5]).toBe(50);
      expect(view.flags[0]).toBe(0);
      expect(view.flags[1]).toBe(1);
      expect(view.flags[9]).toBe(1);
    });
  });

  it("correctly publishes and reads meter arrays with non-zero offsets", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "meter-array-offset",
      params: {
        gain: param.f32({ min: 0, max: 1 }),
      },
      meters: {
        rms: meter.f32(), // scalar @ offset 0
        spectrum: meter.f32.array(16), // array @ offset 4
        peak: meter.f32(), // scalar @ offset 68
        histogram: meter.f32.array(8), // array @ offset 72
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    proc.meters.publish((writer) => {
      writer.rms(0.5);
      writer.stage("spectrum", (v) => {
        for (let i = 0; i < v.length; i++) {
          v[i] = i / 16;
        }
      });
      writer.peak(0.9);
      writer.stage("histogram", (v) => {
        for (let i = 0; i < v.length; i++) {
          v[i] = (i + 1) * 0.1;
        }
      });
    });

    const snap = ctl.meters.snapshot();
    expect(snap.rms).toBe(0.5);
    expect(snap.spectrum.length).toBe(16);
    expect(snap.spectrum[0]).toBe(0);
    expect(snap.spectrum[15]).toBeCloseTo(15 / 16);
    expect(snap.peak).toBeCloseTo(0.9);
    expect(snap.histogram.length).toBe(8);
    expect(snap.histogram[0]).toBeCloseTo(0.1);
    expect(snap.histogram[7]).toBeCloseTo(0.8);
  });

  it("fills into buffers correctly for arrays with non-zero offsets", () => {
    const spec = defineSpec(({ param }) => ({
      id: "into-buffer-offset",
      params: {
        scalar: param.f32({ min: 0, max: 1 }),
        arr1: param.f32.array(4),
        arr2: param.f32.array(8),
      },
    }));

    const { ctl } = bindingsFromSpec(spec);

    ctl.params.stage("arr1", (v) => {
      v.fill(1.0);
    });
    ctl.params.stage("arr2", (v) => {
      v.fill(2.0);
    });

    const into = {
      arr1: new Float32Array(4),
      arr2: new Float32Array(8),
    };

    const snap = ctl.params.snapshot({ keys: ["arr1", "arr2"], into });

    // Verify identity (into buffers are returned).
    expect(snap.arr1).toBe(into.arr1);
    expect(snap.arr2).toBe(into.arr2);

    // Verify correct lengths.
    expect(snap.arr1.length).toBe(4);
    expect(snap.arr2.length).toBe(8);

    // Verify values.
    expect(snap.arr1.every((v) => v === 1.0)).toBe(true);
    expect(snap.arr2.every((v) => v === 2.0)).toBe(true);
  });

  it("handles arrays with large byte offsets correctly", () => {
    const spec = defineSpec(({ param }) => ({
      id: "large-offset",
      params: {
        // Create many params to push "late" to a high offset.
        early1: param.f32.array(100),
        early2: param.f32.array(100),
        early3: param.f32.array(100),
        late: param.f32.array(50), // offset will be 1200 bytes
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    ctl.params.stage("late", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = i;
      }
    });

    proc.params.within((view) => {
      expect(view.late.length).toBe(50);
      expect(view.late[0]).toBe(0);
      expect(view.late[49]).toBe(49);
    });

    const snap = ctl.params.snapshot({ keys: ["late"] });
    expect(snap.late.length).toBe(50);
    expect(snap.late[0]).toBe(0);
    expect(snap.late[49]).toBe(49);
  });

  it("correctly handles enum arrays with non-zero offsets", () => {
    const spec = defineSpec(({ param }) => ({
      id: "enum-array-offset",
      params: {
        mode: param.f32({ min: 0, max: 1 }), // push enum array to non-zero offset
        waveforms: param.enum.array({
          values: ["sine", "square", "saw", "triangle"],
          length: 8,
        }),
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    // Stage enum array via controller (indices).
    ctl.params.stage("waveforms", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = i % 4; // cycle through enum indices
      }
    });

    // Processor sees numeric indices in its view.
    proc.params.within((view) => {
      expect(view.waveforms.length).toBe(8);
      expect(view.waveforms[0]).toBe(0);
      expect(view.waveforms[3]).toBe(3);
    });

    // Controller snapshot returns index array view.
    const snap = ctl.params.snapshot();
    expect(snap.waveforms.length).toBe(8);
    expect(snap.waveforms[0]).toBe(0);
    expect(snap.waveforms[3]).toBe(3);
  });

  it("correctly handles f64 meter arrays with non-zero offsets", () => {
    const spec = defineSpec(({ meter }) => ({
      id: "f64-array-offset",
      meters: {
        counter: meter.u32(), // MU32 scalar, pushes MF64 to offset 0
        rms: meter.f32(), // MF32 scalar @ offset 0
        precise: meter.f64.array(10), // MF64 array @ offset 0
        peak: meter.f32(), // MF32 scalar @ offset 4
        spectrum: meter.f64.array(16), // MF64 array @ offset 80
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    proc.meters.publish((writer) => {
      writer.counter(42);
      writer.rms(0.5);
      writer.peak(0.9);
      writer.stage("precise", (v) => {
        for (let i = 0; i < v.length; i++) {
          v[i] = i / 10;
        }
      });
      writer.stage("spectrum", (v) => {
        for (let i = 0; i < v.length; i++) {
          v[i] = Math.sin(i);
        }
      });
    });

    const snap = ctl.meters.snapshot();
    expect(snap.counter).toBe(42);
    expect(snap.rms).toBe(0.5);
    expect(snap.precise.length).toBe(10);
    expect(snap.precise[0]).toBe(0);
    expect(snap.precise[9]).toBeCloseTo(0.9);
    expect(snap.peak).toBeCloseTo(0.9);
    expect(snap.spectrum.length).toBe(16);
    expect(snap.spectrum[0]).toBeCloseTo(Math.sin(0));
    expect(snap.spectrum[15]).toBeCloseTo(Math.sin(15));
  });

  it("preserves array values across multiple write/read cycles", () => {
    const spec = defineSpec(({ param }) => ({
      id: "multi-cycle",
      params: {
        a: param.f32({ min: 0, max: 1 }),
        b: param.f32.array(6),
        c: param.f32({ min: 0, max: 1 }),
        d: param.f32.array(4),
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    // Cycle 1.
    ctl.params.stage("b", (v) => {
      v.fill(1.0);
    });
    ctl.params.stage("d", (v) => {
      v.fill(2.0);
    });

    proc.params.within((view) => {
      expect(view.b.length).toBe(6);
      expect(view.d.length).toBe(4);
      expect(view.b.every((x) => x === 1.0)).toBe(true);
      expect(view.d.every((x) => x === 2.0)).toBe(true);
    });

    // Cycle 2 - different values.
    ctl.params.stage("b", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = i * 0.1;
      }
    });
    ctl.params.stage("d", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = (i + 1) * 0.2;
      }
    });

    proc.params.within((view) => {
      expect(view.b.length).toBe(6);
      expect(view.d.length).toBe(4);
      expect(view.b[0]).toBe(0);
      expect(view.b[5]).toBeCloseTo(0.5);
      expect(view.d[0]).toBeCloseTo(0.2);
      expect(view.d[3]).toBeCloseTo(0.8);
    });
  });

  it("handles partial snapshot with into for non-zero offset arrays", () => {
    const spec = defineSpec(({ param }) => ({
      id: "partial-into",
      params: {
        x: param.f32({ min: 0, max: 1 }),
        arr1: param.f32.array(8),
        y: param.f32({ min: 0, max: 1 }),
        arr2: param.f32.array(12),
      },
    }));

    const { ctl } = bindingsFromSpec(spec);

    ctl.params.stage("arr1", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = i;
      }
    });
    ctl.params.stage("arr2", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = i * 2;
      }
    });

    const buffer1 = new Float32Array(8);
    const buffer2 = new Float32Array(12);

    const snap = ctl.params.snapshot({
      keys: ["arr1", "arr2"],
      into: { arr1: buffer1, arr2: buffer2 },
    });

    // Verify identity.
    expect(snap.arr1).toBe(buffer1);
    expect(snap.arr2).toBe(buffer2);

    // Verify values.
    for (let i = 0; i < 8; i++) {
      expect(snap.arr1[i]).toBe(i);
    }
    for (let i = 0; i < 12; i++) {
      expect(snap.arr2[i]).toBe(i * 2);
    }
  });
});
