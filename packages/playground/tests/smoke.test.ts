import { describe, it, expect } from "vitest";

describe("@seqlok/playground smoke", () => {
  it("bootstraps the test environment", () => {
    // if Vitest + the Vite config load, this passes.
    expect(process.env.NODE_ENV === "test").toBe(true);
  });
});
