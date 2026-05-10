/**
 * @fileoverview
 * Observer read-path micro-benchmarks.
 *
 * Focus:
 * - full vs partial `params.snapshot(...)`
 * - `params.within(...)` coherent read windows
 * - full vs partial `meters.snapshot(...)`
 * - API shape: varargs vs array vs `{ keys }` form
 *
 * These benches exercise observer reads while a controller + processor pair
 * drive a simple gain/mode + peak/spectrum pipeline over a shared backing.
 */

import { bench, describe } from "vitest";

import { MICRO_BENCH_OPTS } from "../../../scripts/vitest/bench-presets";
import {
  allocateShared,
  bindController,
  bindObserver,
  bindProcessor,
  buildHandoff,
  defineSpec,
  planLayout,
  acceptHandoff,
} from "../src";

const ITERATIONS = 128;

const OBSERVER_BENCH_OPTS = {
  ...MICRO_BENCH_OPTS,
  time: 500,
};

// Reused key arrays for snapshot() array / object forms.
const PARAM_KEYS_GAIN = ["gain"] as const;
const METER_KEYS_PEAK = ["peak"] as const;

describe("Observer read-path benchmarks", () => {
  const spec = defineSpec(({ param, meter }) => ({
    id: "bench/observer-reads",
    params: {
      gain: param.f32({ min: 0, max: 2 }),
      mode: param.enum(["a", "b", "c"]),
    },
    meters: {
      peak: meter.f32(),
      spectrum: meter.f32.array(32),
    },
  }));

  const plan = planLayout(spec);
  const backing = allocateShared(plan);
  const handoff = buildHandoff(plan, backing);
  const accepted = acceptHandoff(handoff);

  const controller = bindController(spec, plan, backing);
  const processor = bindProcessor(accepted);
  const observer = bindObserver(spec, plan, backing);

  function processorStep(gain: number): void {
    controller.params.set("gain", gain);

    processor.params.within((view) => {
      processor.meters.publish((writer) => {
        writer.peak(view.gain);

        writer.stage("spectrum", (dest) => {
          const value = view.gain;
          const len = dest.length;

          for (let i = 0; i < len; i += 1) {
            dest[i] = value;
          }
        });
      });
    });
  }

  // Warm once so snapshots see realistic values.
  processorStep(0.5);
  controller.params.set("mode", "b");

  bench(
    "params.within() – full view",
    () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        controller.params.set("gain", gain);

        observer.params.within((view) => {
          const g = view.gain;
          const m = view.mode;

          if (!Number.isFinite(g) || typeof m !== "string") {
            throw new Error("observer.params.within produced invalid values");
          }
        });
      }
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "params.snapshot() – full spec",
    () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        controller.params.set("gain", gain);

        const snapshot = observer.params.snapshot();
        const g = snapshot.gain;
        const m = snapshot.mode;

        if (!Number.isFinite(g) || typeof m !== "string") {
          throw new Error("params.snapshot() produced invalid values");
        }
      }
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "params.snapshot('gain') – vararg",
    () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        controller.params.set("gain", gain);

        const snapshot = observer.params.snapshot("gain");
        const g = snapshot.gain;

        if (!Number.isFinite(g)) {
          throw new Error("params.snapshot('gain') produced invalid values");
        }
      }
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "params.snapshot(['gain']) – array",
    () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        controller.params.set("gain", gain);

        const snapshot = observer.params.snapshot(["gain"]);
        const g = snapshot.gain;

        if (!Number.isFinite(g)) {
          throw new Error("params.snapshot(['gain']) produced invalid values");
        }
      }
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "params.snapshot({ keys: ['gain'] }) – object",
    () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        controller.params.set("gain", gain);

        const snapshot = observer.params.snapshot({
          keys: PARAM_KEYS_GAIN,
        });

        const g = snapshot.gain;

        if (!Number.isFinite(g)) {
          throw new Error("params.snapshot({ keys }) produced invalid values");
        }
      }
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "meters.snapshot() – full spec",
    () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        processorStep(gain);

        const meters = observer.meters.snapshot();
        const peak = meters.peak;
        const firstBin = meters.spectrum[0] ?? 0;

        if (!Number.isFinite(peak) || !Number.isFinite(firstBin)) {
          throw new Error("meters.snapshot() produced invalid values");
        }
      }
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "meters.snapshot('peak') – vararg",
    () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        processorStep(gain);

        const meters = observer.meters.snapshot("peak");
        const peak = meters.peak;

        if (!Number.isFinite(peak)) {
          throw new Error("meters.snapshot('peak') produced invalid values");
        }
      }
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "meters.snapshot(['peak']) – array",
    () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        processorStep(gain);

        const meters = observer.meters.snapshot(["peak"]);
        const peak = meters.peak;

        if (!Number.isFinite(peak)) {
          throw new Error("meters.snapshot(['peak']) produced invalid values");
        }
      }
    },
    OBSERVER_BENCH_OPTS,
  );

  bench(
    "meters.snapshot({ keys: ['peak'] }) – object",
    () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const gain = (i % 16) / 16;
        processorStep(gain);

        const meters = observer.meters.snapshot({
          keys: METER_KEYS_PEAK,
        });

        const peak = meters.peak;

        if (!Number.isFinite(peak)) {
          throw new Error("meters.snapshot({ keys }) produced invalid values");
        }
      }
    },
    OBSERVER_BENCH_OPTS,
  );
});
