import { describe, expect, it } from "vitest";

import { defineSpec } from "../../src/spec/define";

describe("defineSpec anonymous id generation", () => {
  it("generates a deterministic anonymous id when authored id is omitted", () => {
    const first = defineSpec({
      params: {
        transport: {
          tempo: { kind: "f32", min: 40, max: 240 },
        },
      },
    });

    const second = defineSpec({
      params: {
        transport: {
          tempo: { kind: "f32", min: 40, max: 240 },
        },
      },
    });

    expect(first.id).toBe(second.id);
    expect(first.id).toMatch(/^anon_[0-9a-f]+$/);
  });

  it("changes the anonymous id when a canonical param key changes", () => {
    const first = defineSpec({
      params: {
        transport: {
          tempo: { kind: "f32" },
        },
      },
    });

    const second = defineSpec({
      params: {
        transport: {
          swing: { kind: "f32" },
        },
      },
    });

    expect(first.id).not.toBe(second.id);
  });

  it("changes the anonymous id when a canonical meter key changes", () => {
    const first = defineSpec({
      meters: {
        deck: {
          left: {
            peak: { kind: "f32" },
          },
        },
      },
    });

    const second = defineSpec({
      meters: {
        deck: {
          right: {
            peak: { kind: "f32" },
          },
        },
      },
    });

    expect(first.id).not.toBe(second.id);
  });

  it("changes the anonymous id when a canonical leaf definition changes", () => {
    const first = defineSpec({
      params: {
        transport: {
          tempo: { kind: "f32", min: 40, max: 240 },
        },
      },
    });

    const second = defineSpec({
      params: {
        transport: {
          tempo: { kind: "f32", min: 40, max: 250 },
        },
      },
    });

    expect(first.id).not.toBe(second.id);
  });

  it("preserves enum vocabulary order as part of anonymous id identity", () => {
    const first = defineSpec({
      params: {
        transport: {
          mode: { kind: "enum", values: ["vinyl", "cdj", "sync"] as const },
        },
      },
    });

    const second = defineSpec({
      params: {
        transport: {
          mode: { kind: "enum", values: ["cdj", "vinyl", "sync"] as const },
        },
      },
    });

    expect(first.id).not.toBe(second.id);
  });

  it("does not depend on object insertion order in authored input", () => {
    const paramsA = {
      transport: {
        swing: { kind: "f32" as const },
        tempo: { kind: "f32" as const },
      },
    };

    const transportB: {
      tempo: { kind: "f32" };
      swing: { kind: "f32" };
    } = {
      tempo: { kind: "f32" },
      swing: { kind: "f32" },
    };

    const paramsB = {
      transport: transportB,
    };

    const first = defineSpec({ params: paramsA });
    const second = defineSpec({ params: paramsB });

    expect(first.id).toBe(second.id);
  });

  it("treats omitted and empty planes as the same anonymous compiled identity", () => {
    const first = defineSpec({
      params: {
        transport: {
          tempo: { kind: "f32" },
        },
      },
    });

    const second = defineSpec({
      params: {
        transport: {
          tempo: { kind: "f32" },
        },
      },
      meters: {},
    });

    expect(first.id).toBe(second.id);
  });

  it("prefers an explicit authored id over generated anonymous identity", () => {
    const spec = defineSpec({
      id: "transport-spec",
      params: {
        transport: {
          tempo: { kind: "f32" },
        },
      },
    });

    expect(spec.id).toBe("transport-spec");
  });
});
