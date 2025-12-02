import { describe, it, expect } from "vitest";

import {
  ALL_DOMAINS,
  listErrors,
  computeNumericCode,
} from "../src/errors/all-domains";

describe("error index invariants", () => {
  it("has unique string codes and numeric codes", () => {
    const all = listErrors();

    const codes = new Set<string>();
    const numeric = new Set<number>();

    for (const err of all) {
      expect(codes.has(err.code)).toBe(false);
      expect(numeric.has(err.numericCode)).toBe(false);

      codes.add(err.code);
      numeric.add(err.numericCode);
    }
  });

  it("computeNumericCode matches the index", () => {
    const all = listErrors();

    for (const err of all) {
      const computed = computeNumericCode(err.code);
      expect(computed).toBe(err.numericCode);
    }
  });

  it("ALL_DOMAINS covers the same codes as listErrors", () => {
    const fromIndex = new Set(listErrors().map((e) => e.code));
    const fromDomains = new Set(
      ALL_DOMAINS.flatMap((d) => d.entries.map((e) => e.code)),
    );

    expect(fromIndex).toEqual(fromDomains);
  });
});
