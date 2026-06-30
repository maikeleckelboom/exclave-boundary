import { describe, expectTypeOf, it } from "vitest";

import { defineSpec } from "../../src";

import type {
  MeterGroup,
  MeterGroupKey,
  MeterGroupValues,
  ProcessorMeters,
} from "../../src";

const _spec = defineSpec(({ meter }) => ({
  id: "meter-groups",
  meters: {
    levels: {
      hold: meter.f64(),
      peak: meter.f32(),
    },
    runtime: {
      active: meter.bool(),
      blockSamples: meter.u32(),
      spectrum: meter.f32.array(4),
      state: meter.enum(["idle", "running"]),
    },
  },
}));

type RuntimeValues = MeterGroupValues<typeof _spec, "runtime">;
type LevelsValues = MeterGroupValues<typeof _spec, "levels">;

const validRuntimeValues = {
  active: true,
  blockSamples: 128,
  spectrum: new Float32Array(4),
  state: 1,
} satisfies RuntimeValues;

const validLevelsValues = {
  hold: 1.25,
  peak: 0.5,
} satisfies LevelsValues;

const runtimeValuesWithUnknownKey: RuntimeValues = {
  active: true,
  blockSamples: 128,
  // @ts-expect-error Unknown group key should fail.
  extra: 1,
  spectrum: new Float32Array(4),
  state: 1,
};

const runtimeValuesWithWrongType: RuntimeValues = {
  active: true,
  // @ts-expect-error Wrong group value type should fail.
  blockSamples: "128",
  spectrum: new Float32Array(4),
  state: 1,
};

// @ts-expect-error Missing required group value should fail.
const runtimeValuesMissingKey: RuntimeValues = {
  active: true,
  blockSamples: 128,
  state: 1,
};

void runtimeValuesWithUnknownKey;
void runtimeValuesWithWrongType;
void runtimeValuesMissingKey;

describe("Meter group type utilities", () => {
  it("derive groups and unprefixed keys from canonical meter keys", () => {
    expectTypeOf<MeterGroup<typeof _spec>>().toEqualTypeOf<
      "levels" | "runtime"
    >();
    expectTypeOf<MeterGroupKey<typeof _spec, "runtime">>().toEqualTypeOf<
      "active" | "blockSamples" | "spectrum" | "state"
    >();
    expectTypeOf<RuntimeValues>().toEqualTypeOf<
      Readonly<{
        readonly active: boolean;
        readonly blockSamples: number;
        readonly spectrum: Float32Array;
        readonly state: number;
      }>
    >();
  });
});

function assertGroupedPublishingTypes(
  meters: ProcessorMeters<typeof _spec>,
): void {
  meters.publishGroup("runtime", validRuntimeValues);

  meters.publish((writer) => {
    writer.set("runtime.blockSamples", 128);
    writer.setGroup("runtime", validRuntimeValues);
    writer.setGroup("levels", validLevelsValues);
  });

  // @ts-expect-error Invalid group name should fail.
  meters.publishGroup("missing", validRuntimeValues);

  const runtimeValuesWithExtraKey = {
    ...validRuntimeValues,
    extra: 1,
  };

  // @ts-expect-error Unknown group key should fail for variables too.
  meters.publishGroup("runtime", runtimeValuesWithExtraKey);

  meters.publish((writer) => {
    // @ts-expect-error writer.set still requires fully qualified meter keys.
    writer.set("blockSamples", 128);
  });
}

void assertGroupedPublishingTypes;
