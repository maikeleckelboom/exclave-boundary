import { describe, it, expect } from "vitest";

import * as seqlok from "../../src";

describe("Public API Surface (Runtime Exports)", () => {
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

      // BINDING
      "bindController",
      "bindProcessor",
      "bindObserver",

      // HANDOFF
      "buildHandoff",
      "acceptHandoff",
      "verifyHandoff",

      // ERRORS + HEALTH
      "SeqlokError",
      "isSeqlokError",
      "getErrorMeta",
      "getErrorMessage",
      "isErrorCode",
      "interpretHealth",

      // ENUM UTILITIES
      "enumArrayToLabels",
      "enumIndexFromLabel",
      "enumLabelFromIndex",
      "enumValues",
      "enumLabelsToArray",
      "enumPaletteFor",

      // SWSR RING
      "SWSR_HEADER_WORDS",
      "SWSR_HEADER_WRITE_INDEX",
      "SWSR_HEADER_READ_INDEX",
      "SWSR_HEADER_WRITE_SEQ",
      "SWSR_HEADER_DROPPED",
      "allocateSwsrRing",
      "bindSwsrRingProducer",
      "bindSwsrRingConsumer",

      // CONTEXT
      "createSharedContext",
    ].sort();

    expect(runtimeExports).toEqual(expectedExports);
  });

  it("wires error and health helpers through the public surface", () => {
    // Pick a diagnostics code to exercise the path end-to-end.
    const code = "diagnostics.counterInvalid";

    // The code should be recognized by the public isErrorCode helper.
    expect(seqlok.isErrorCode(code)).toBe(true);

    // Meta should come back with the expected basic shape.
    const meta = seqlok.getErrorMeta(code);
    expect(meta.severity).toBe("warning");
    expect(meta.recoverable).toBe(true);
    expect(meta.boundarySafe).toBe(false);

    // InterpretHealth should be callable via the public surface and
    // return a structured status + label + hint.
    const health = seqlok.interpretHealth(meta);

    // Narrow: we do not re-specify the exact mapping here, only that
    // it returns a known status and operator-facing strings.
    expect(["fatal", "error", "warning"]).toContain(health.status);
    expect(typeof health.label).toBe("string");
    expect(health.label.length).toBeGreaterThan(0);
    expect(typeof health.hint).toBe("string");
    expect(health.hint?.length).toBeGreaterThan(0);
  });

  it("does not define a default export", () => {
    expect("default" in seqlok).toBe(false);
  });
});
