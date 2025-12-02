import { describe, expect, it } from "vitest";

import {
  ALL_DOMAINS,
  computeNumericCode,
  extractDomainPrefix,
  extractLocalCode,
  listErrors,
} from "../src/errors/all-domains";

describe("Introspect: domain aggregation", () => {
  it("exposes a non-empty list of domains with unique prefixes", () => {
    expect(ALL_DOMAINS.length).toBeGreaterThan(0);

    const prefixes = ALL_DOMAINS.map((domain) => domain.prefix);
    const uniquePrefixes = new Set(prefixes);

    expect(uniquePrefixes.size).toBe(prefixes.length);

    for (const domain of ALL_DOMAINS) {
      expect(domain.entries.length).toBeGreaterThan(0);
    }
  });

  it("provides a flattened error list with unique codes and numeric codes", () => {
    const errors = listErrors();
    expect(errors.length).toBeGreaterThan(0);

    const seenCodes = new Set<string>();
    const seenNumeric = new Set<number>();

    for (const error of errors) {
      expect(error.code).toContain(".");
      expect(error.domain).toBe(extractDomainPrefix(error.code));
      expect(error.key.length).toBeGreaterThan(0);
      expect(typeof error.numericCode).toBe("number");
      expect(Number.isFinite(error.numericCode)).toBe(true);

      seenCodes.add(error.code);
      seenNumeric.add(error.numericCode);
    }

    expect(seenCodes.size).toBe(errors.length);
    expect(seenNumeric.size).toBe(errors.length);
  });

  it("computes numeric codes compatible with aggregated entries", () => {
    const errors = listErrors();
    const first = errors[0];
    if (!first) {
      return;
    }

    const numeric = computeNumericCode(first.code);
    expect(numeric).toBe(first.numericCode);
  });

  it("splits domain prefix and local code correctly", () => {
    expect(extractDomainPrefix("env.unsupported")).toBe("env");
    expect(extractLocalCode("env.unsupported")).toBe("unsupported");

    expect(extractDomainPrefix("plainCode")).toBe("");
    expect(extractLocalCode("plainCode")).toBe("plainCode");
  });
});
