import { describe, expect, it } from "vitest";

import {
  allocateSharedPartitioned,
  bindController,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  receiveHandoff,
} from "../../src";

describe("public quickstart: lane controller ↔ processor flow (partitioned backing)", () => {
  it("wires params and meters over a partitioned SharedArrayBuffer backing", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "lane-partitioned",
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

    // This is the behavioural bit we care about: full flow on partitioned backing.
    const backing = allocateSharedPartitioned(plan);
    const controller = bindController(spec, plan, backing);

    const handoff = buildHandoff(plan, backing);
    const received = receiveHandoff(handoff);

    // Sanity check: we really are exercising the partitioned variant.
    expect(received.packing).toBe("shared-partitioned");
    if (received.packing !== "shared-partitioned") {
      throw new Error("Test invariant: expected shared-partitioned packing");
    }

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
      // Processor sees enum as numeric index
      expect(view.mode === 0 || view.mode === 1).toBe(true);
    });

    // Processor publishes meters
    processor.meters.publish((writer) => {
      writer.rms(0.5);
      writer.peak(1.0);
      writer.framesProcessed(512);

      writer.stage("spectrum", (spectrum) => {
        for (let i = 0; i < spectrum.length; i += 1) {
          spectrum[i] = i / spectrum.length;
        }
      });
    });

    // Controller snapshots meters (full object)
    const meters = controller.meters.snapshot();

    expect(meters.rms).toBeCloseTo(0.5);
    expect(meters.peak).toBeCloseTo(1.0);
    expect(meters.framesProcessed).toBe(512);
    expect(meters.spectrum.length).toBe(64);

    // Optional: light shape sanity on array contents
    let monotone = true;
    for (let i = 1; i < meters.spectrum.length; i += 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (!(meters.spectrum[i]! >= meters.spectrum[i - 1]!)) {
        monotone = false;
        break;
      }
    }
    expect(monotone).toBe(true);

    controller.dispose();
    processor.dispose();
  });
});
