import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  receiveHandoff,
} from "../../src";

describe("public quickstart: lane controller ↔ processor flow", () => {
  it("wires params and meters over a SharedArrayBuffer", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "lane",
      params: {
        timeRatio: param.f32({ min: 0.25, max: 4 }),
        eqBands: param.f32.array({ length: 8 }),
        mode: param.enum(["normal", "granular"]),
      },
      meters: {
        rms: meter.f32(),
        peak: meter.f32(),
        spectrum: meter.f32.array({ length: 64 }),
        framesProcessed: meter.u32(),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const controller = bindController(spec, plan, backing);
    const handoff = buildHandoff(plan, backing);
    const received = receiveHandoff(handoff);
    const processor = bindProcessor(received);

    // Controller writes params
    controller.params.update({
      timeRatio: 1.5,
      mode: "granular",
    });

    controller.params.stage("eqBands", (bands) => {
      for (let i = 0; i < bands.length; i += 1) {
        bands[i] = i < 4 ? -3 : 3;
      }
    });

    // Processor reads params coherently
    processor.params.within((view) => {
      expect(view.timeRatio).toBeCloseTo(1.5);
      expect(view.eqBands.length).toBe(8);
      // enum → numeric index in processor view
      expect(view.mode === 0 || view.mode === 1).toBe(true);
    });

    // Processor publishes meters
    processor.meters.publish((writer) => {
      writer.rms(0.5);
      writer.peak(1.0);

      writer.stage("spectrum", (buf) => {
        for (let i = 0; i < buf.length; i += 1) {
          buf[i] = i;
        }
      });

      // Scalar meter: write via the named function, not a generic setter
      writer.framesProcessed(128);
    });

    // Controller observes meters coherently
    const version = controller.meters.version();
    const { rms, peak, framesProcessed } = controller.meters.snapshot(
      "rms",
      "peak",
      "framesProcessed",
    );

    expect(version).toBeGreaterThan(0);
    expect(rms).toBeCloseTo(0.5);
    expect(peak).toBeCloseTo(1.0);
    expect(framesProcessed).toBe(128);

    controller.dispose();
    processor.dispose();
  });
});
