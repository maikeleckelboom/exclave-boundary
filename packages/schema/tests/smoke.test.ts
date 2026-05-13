import { describe, expect, it } from "vitest";

import { SPEC_AST_V1_ID, validateSpecAst } from "../src/index";

describe("schema package smoke", () => {
  it("validates a minimal authored spec", () => {
    const isValid = validateSpecAst({
      id: "smoke",
      params: {
        gain: { kind: "f32", min: 0, max: 1 },
      },
      meters: {},
    });

    expect(SPEC_AST_V1_ID).toBe("https://seqlok.dev/schema/spec-ast/v1.json");
    expect(isValid).toBe(true);
  });
});
