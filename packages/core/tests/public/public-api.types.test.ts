import { describe, expect, it } from "vitest";

import * as seqlok from "../../src";

describe("Public API Surface (Runtime Exports)", () => {
  it("does not define a default export", () => {
    expect("default" in seqlok).toBe(false);
  });

  it("exports the expected value symbols and nothing else", () => {
    const runtimeExports = Object.keys(seqlok).sort();

    const expectedExports: string[] = [
      // SPEC
      "defineSpec",

      // PLAN
      "planLayout",

      // BACKING
      "allocateShared",
      "allocateSharedPartitioned",
      "allocateWasmShared",
      "describeViews",

      // BINDING
      "bindController",
      "bindProcessor",
      "bindObserver",

      // HANDOFF
      "buildHandoff",
      "receiveHandoff",
      "verifyHandoff",

      // ERRORS
      "BACKING_ERRORS",
      "BINDING_ERRORS",
      "ENV_ERRORS",
      "HANDOFF_ERRORS",
      "PLAN_ERRORS",
      "SPEC_ERRORS",

      // ENUM UTILITIES
      "enumArrayToLabels",
      "enumIndexFromLabel",
      "enumLabelFromIndex",
      "enumValues",
      "enumLabelsToArray",
      "enumPaletteFor",

      // ENV
      "probeEnv",
      "summarizeEnv",
      "assertSabSupportFromSummary",
      "assertSabSupport",

      // CONTEXT
      "createSharedContext",
    ].sort();

    expect(runtimeExports).toEqual(expectedExports);
  });

  /*
    it("wires SeqlokError and interpretHealth through the public surface", () => {
      const error = new seqlok.SeqlokError(
        "introspect.counterInvalid",
        "Counter name is invalid",
        { where: "public-api.types.test" },
        {
          severity: "warning",
          recoverable: true,
          boundarySafe: false,
        },
      );

      expect(error).toBeInstanceOf(seqlok.SeqlokError);
      expect(seqlok.isSeqlokError(error)).toBe(true);

      const health = seqlok.interpretHealth(error.meta);

      expect(["fatal", "error", "warning"]).toContain(health.status);
      expect(health.label.length).toBeGreaterThan(0);
      expect(typeof health.label).toBe("string");
      expect(typeof health.hint === "string").toBe(true);
    });
  */
});
