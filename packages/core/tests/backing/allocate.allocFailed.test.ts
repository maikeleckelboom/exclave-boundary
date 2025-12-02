// File: packages/core/tests/backing/allocate.allocFailed.test.ts

import { describe, expect, it } from "vitest";

import { createBackingError } from "../../src/errors/backing";
import { createEnvError } from "../../src/errors/env";

describe("Domain error factories", () => {
  it("creates backing.wasmMemoryNotShared errors and preserves the underlying cause", () => {
    const cause = new TypeError("shared memory not supported");

    const error = createBackingError(
      "wasmMemoryNotShared",
      {
        plane: "wasm",
        requestedBytes: 0,
        allocatedBytes: 0,
        detail: "memory.buffer is not a SharedArrayBuffer",
      },
      cause,
    );

    expect(error.code).toBe("backing.wasmMemoryNotShared");
    expect(error.message).toMatch(/WebAssembly\.Memory is not shared/i);
    expect(error.details.plane).toBe("wasm");
    expect(error.details.detail).toMatch(/SharedArrayBuffer/i);
    expect((error as Error).cause).toBe(cause);
  });

  it('constructs "env.unsupported" errors with structured feature details', () => {
    const error = createEnvError("unsupported", {
      where: "test.env.unsupported",
      feature: "SharedArrayBuffer",
      reason: "Missing COOP/COEP",
    });

    expect(error.code).toBe("env.unsupported");
    expect(error.message).toMatch(/Required env feature unavailable/i);
    expect(error.message).toMatch(/SharedArrayBuffer/i);
    expect(error.details.feature).toBe("SharedArrayBuffer");
    expect(error.details.where).toBe("test.env.unsupported");
    expect(error.details.reason).toMatch(/COOP\/COEP/i);
  });
});
