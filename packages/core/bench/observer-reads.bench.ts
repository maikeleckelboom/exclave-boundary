/**
 * @fileoverview
 * Observer read-path micro benchmarks.
 *
 * Focus:
 * - full vs partial `params.snapshot(...)`
 * - `params.within(...)` coherent read windows
 * - full vs partial `meters.snapshot(...)`
 *
 * These benches exercise observer reads while a controller + processor pair
 * drive a simple gain/peak + spectrum pipeline over a shared backing.
 */

import { bench, describe } from "vitest";

import {
  allocateShared,
  bindController,
  bindObserver,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  receiveHandoff,
} from "../src";
import { MICRO_BENCH_OPTS } from "../vitest.config";

// Keep the JIT from optimizing everything away.
let _blackhole = 0;

describe("Observer read-path benchmarks", () => {
  const spec = defineSpec(({ param, meter }) => ({
    params: {
      gain: param.f32({ min: 0, max: 2 }),
      mode: param.enum(["a", "b", "c"]),
    },
    meters: {
      peak: meter.f32(),
      // Small array to exercise array views in meter snapshots.
      spectrum: meter.f32.array(32),
    },
  }));

  const plan = planLayout(spec);
  const backing = allocateShared(plan);
  const handoff = buildHandoff(plan, backing);
  const received = receiveHandoff(handoff);

  const controller = bindController(spec, plan, backing);
  const processor = bindProcessor(received);
  const observer = bindObserver(spec, plan, backing);

  // Pre-warm: write non-zero values so snapshots see realistic data.
  controller.params.set("gain", 0.5);
  controller.params.set("mode", "b");

  processor.params.within((view) => {
    processor.meters.publish((writer) => {
      writer.peak(view.gain);
      writer.stage("spectrum", (dest) => {
        const value = view.gain;
        for (let i = 0; i < dest.length; i += 1) {
          dest[i] = value;
        }
      });
    });
  });

  const ITERATIONS = 128;
  const OBSERVER_BENCH_OPTS = { ...MICRO_BENCH_OPTS, time: 500 };

  bench(
    "params.within() – full view",
    () => {
      let local = 0;

      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        controller.params.set("gain", gain);

        observer.params.within((view) => {
          local ^= Number.isFinite(view.gain) ? 1 : 0;
          // Touch the enum label to exercise label mapping.
          local ^= typeof view.mode === "string" ? 1 : 0;
        });
      }

      _blackhole ^= local;
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "params.snapshot() – full spec",
    () => {
      let local = 0;

      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        controller.params.set("gain", gain);

        const snapshot = observer.params.snapshot();
        local ^= Number.isFinite(snapshot.gain) ? 1 : 0;
        local ^= typeof snapshot.mode === "string" ? 1 : 0;
      }

      _blackhole ^= local;
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "params.snapshot(['gain']) – partial",
    () => {
      let local = 0;

      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        controller.params.set("gain", gain);

        const snapshot = observer.params.snapshot(["gain"]);
        local ^= Number.isFinite(snapshot.gain) ? 1 : 0;
      }

      _blackhole ^= local;
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "meters.snapshot() – full spec",
    () => {
      let local = 0;

      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        controller.params.set("gain", gain);

        processor.params.within((view) => {
          processor.meters.publish((writer) => {
            writer.peak(view.gain);
            writer.stage("spectrum", (dest) => {
              const value = view.gain;
              for (let j = 0; j < dest.length; j += 1) {
                dest[j] = value;
              }
            });
          });
        });

        const meters = observer.meters.snapshot();
        local ^= Number.isFinite(meters.peak) ? 1 : 0;
        local ^= Number.isFinite(meters.spectrum[0]) ? 1 : 0;
      }

      _blackhole ^= local;
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "meters.snapshot(['peak']) – partial",
    () => {
      let local = 0;

      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        controller.params.set("gain", gain);
        processor.params.within((view) => {
          processor.meters.publish((writer) => {
            writer.peak(view.gain);
          });
        });

        const meters = observer.meters.snapshot(["peak"]);
        local ^= Number.isFinite(meters.peak) ? 1 : 0;
      }

      _blackhole ^= local;
    },
    OBSERVER_BENCH_OPTS,
  );
});
