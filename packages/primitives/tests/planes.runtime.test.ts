import { describe, expect, it } from "vitest";

import { ALL_PLANES, BYTES_PER_ELEM, roundUpTo } from "../src";

/**
 * Tests for low-level plane constants and memory alignment utilities.
 * These primitives define the memory layout structure and alignment rules for the shared backing.
 */
describe("Planes Primitives: Constants & Alignment", () => {
  it("exposes all plane keys in a stable, expected order", () => {
    // The order of keys defines the iteration order for layout planning
    expect(ALL_PLANES).toEqual([
      "PF32", // Params: Float32
      "PI32", // Params: Int32
      "PB", // Params: Byte/Bool
      "PU", // Params: Uint32 (Locks)
      "MF32", // Meters: Float32
      "MF64", // Meters: Float64
      "MU32", // Meters: Uint32
      "MU", // Meters: Uint32 (Locks)
    ]);
  });

  it("maps each plane type to its correct byte size per element", () => {
    expect(BYTES_PER_ELEM.PF32).toBe(Float32Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.PI32).toBe(Int32Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.PB).toBe(Uint8Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.PU).toBe(Uint32Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.MF32).toBe(Float32Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.MU32).toBe(Uint32Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.MF64).toBe(Float64Array.BYTES_PER_ELEMENT);
    expect(BYTES_PER_ELEM.MU).toBe(Uint32Array.BYTES_PER_ELEMENT);
  });

  it("aligns values up to the nearest power-of-two boundary", () => {
    expect(roundUpTo(0, 4)).toBe(0);
    expect(roundUpTo(1, 4)).toBe(4);
    expect(roundUpTo(4, 4)).toBe(4);
    expect(roundUpTo(5, 4)).toBe(8);
    expect(roundUpTo(7, 8)).toBe(8);
    expect(roundUpTo(9, 8)).toBe(16);
  });
});
