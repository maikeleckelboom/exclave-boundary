import { describe, expect, it } from "vitest";

import {
  defineSpec,
  enumArrayToLabels,
  enumIndexFromLabel,
  enumLabelFromIndex,
  enumLabelsToArray,
  enumPaletteFor,
  enumValues,
} from "../../src";
import { enumGuardFor } from "../../src/spec/enums";

/**
 * Shape of the enumInvalid error we expect from the spec helpers.
 */
interface EnumInvalidErrorDetails {
  key: string;
  values: readonly string[];
  invalidIndex?: number;
  received?: string;
}

interface EnumInvalidError {
  code: "spec.enumInvalid";
  details: EnumInvalidErrorDetails;
}

/**
 * Internal test specification defining a single enum parameter.
 * Used to validate helper functions against a known schema.
 */
const spec = defineSpec(({ param, meter }) => ({
  id: "enum-test-spec",
  params: {
    mode: param.enum(["normal", "stretch", "freeze"]),
  },
  meters: {
    level: meter.f32(),
  },
}));

describe("Enum Utilities & Helper Functions", () => {
  it("successfully round-trips labels to indices and back", () => {
    // Verify value extraction
    const values = enumValues(spec, "mode");
    expect(values).toEqual(["normal", "stretch", "freeze"]);

    // Single scalar lookups
    expect(enumIndexFromLabel(spec, "mode", "stretch")).toBe(1);
    expect(enumLabelFromIndex(spec, "mode", 0)).toBe("normal");

    // Batch array conversion (Labels -> Indices)
    const indices = enumLabelsToArray(spec, "mode", ["freeze", "normal"]);
    expect(Array.from(indices)).toEqual([2, 0]);

    // Batch array conversion (Indices -> Labels)
    const labels = enumArrayToLabels(spec, "mode", indices);
    expect(labels).toEqual(["freeze", "normal"]);
  });

  it("throws spec.enumInvalid when converting an out-of-bounds index to a label", () => {
    const indices = Int32Array.from([0, 99]);

    // We only care that it throws; class identity is tested elsewhere
    expect(() => enumArrayToLabels(spec, "mode", indices)).toThrow();

    try {
      enumArrayToLabels(spec, "mode", indices);
    } catch (error: unknown) {
      const err = error as EnumInvalidError;

      expect(err.code).toBe("spec.enumInvalid");
      expect(err.details.key).toBe("mode");
      expect(err.details.invalidIndex).toBe(99);
      expect(err.details.values).toEqual(["normal", "stretch", "freeze"]);
    }
  });

  it("throws spec.enumInvalid when converting an unknown string label to an index", () => {
    const labels = ["normal", "nope"] as const;

    expect(() => {
      // @ts-expect-error Intentional invalid label to verify runtime validation.
      enumLabelsToArray(spec, "mode", labels);
    }).toThrow();

    try {
      // @ts-expect-error Intentional invalid label to verify runtime validation.
      enumLabelsToArray(spec, "mode", labels);
    } catch (error: unknown) {
      const err = error as EnumInvalidError;

      expect(err.code).toBe("spec.enumInvalid");
      expect(err.details.key).toBe("mode");
      expect(err.details.received).toBe("nope");
      expect(err.details.values).toEqual(["normal", "stretch", "freeze"]);
    }
  });

  it("provides correct lookup palettes and type guards via internal helpers", () => {
    // Validate Palette behavior (lookup object)
    const palette = enumPaletteFor(spec, "mode");
    expect(palette.values).toEqual(["normal", "stretch", "freeze"]);
    expect(palette.indexFrom("freeze")).toBe(2);
    expect(palette.labelFrom(1)).toBe("stretch");

    // Undefined index lookup returns undefined rather than throwing (safe lookup)
    expect(palette.labelFrom(99)).toBeUndefined();

    // Validate Type Guard behavior
    const guard = enumGuardFor(spec, "mode");
    expect(guard("normal")).toBe(true);
    expect(guard("wat")).toBe(false);
  });
});
