import { type PlaneKey } from "@seqlok/primitives";
import { describe, expect, it } from "vitest";

import { getBackingBuffer } from "../../src/backing/buffers";
import { planLayout } from "../../src/plan/layout";
import { specFromPlaneBytes } from "../helpers/spec-from-bytes";

import type {
  Backing,
  SharedBacking,
  SharedPartitionedBacking,
  WasmSharedBacking,
} from "../../src/backing/types";
import type { PlaneByteLengths } from "../../src/plan/types";

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error(
    `Error(core/tests/helpers/capture-error.ts): Expected function to throw.`,
  );
}

const WASM_PAGE_SIZE = 64 * 1024;

/**
 * Retrieves the specific SharedArrayBuffer for a given plane key.
 * Handles polymorphism between partitioned backings (where planes have distinct buffers)
 * and contiguous backings (where all planes share one buffer).
 */
export function getBufferForPlane(
  backing: Backing,
  plane: PlaneKey,
): SharedArrayBuffer {
  if (backing.kind === "shared-partitioned") {
    return backing.planes[plane];
  }
  return getBackingBuffer(backing);
}

describe("Backing Buffer Utilities: Retrieval Strategies", () => {
  // Define a representative layout to ensure valid backing structures
  const bytes: PlaneByteLengths = {
    PF32: 8 * 4,
    PI32: 4 * 4,
    PB: 7,
    PU: 2 * 4,
    MF32: 6 * 4,
    MF64: 8,
    MU32: 3 * 4,
    MU: 2 * 4,
  };
  const plan = planLayout(specFromPlaneBytes(bytes));

  it("retrieves the underlying SharedArrayBuffer for contiguous and WebAssembly backings", () => {
    // Case 1: Standard Contiguous Shared Backing
    const sab = new SharedArrayBuffer(plan.bytesTotal);
    const cont: SharedBacking = { kind: "shared", sab };

    expect(getBackingBuffer(cont)).toBe(sab);

    // Case 2: WebAssembly Shared Backing
    const pages = Math.ceil(plan.bytesTotal / WASM_PAGE_SIZE);
    const memory = new WebAssembly.Memory({
      shared: true,
      initial: pages,
      maximum: pages,
    });
    const wasm: WasmSharedBacking = { kind: "wasm-shared", memory };

    expect(getBackingBuffer(wasm)).toBe(memory.buffer);
  });

  it("throws on partitioned backings when accessing a single buffer, requiring plane-specific retrieval", () => {
    // Construct a partitioned backing where every plane has its own isolated buffer
    const split: SharedPartitionedBacking = {
      kind: "shared-partitioned",
      planes: {
        PF32: new SharedArrayBuffer(plan.planes.PF32),
        PI32: new SharedArrayBuffer(plan.planes.PI32),
        PB: new SharedArrayBuffer(plan.planes.PB),
        PU: new SharedArrayBuffer(plan.planes.PU),
        MF32: new SharedArrayBuffer(plan.planes.MF32),
        MF64: new SharedArrayBuffer(plan.planes.MF64),
        MU32: new SharedArrayBuffer(plan.planes.MU32),
        MU: new SharedArrayBuffer(plan.planes.MU),
      },
    };

    // getBackingBuffer must fail because there is no single "shared buffer" for the whole backing
    const thrown = captureError(() => getBackingBuffer(split));

    const err = thrown as {
      code?: string;
      details?: { where?: string; detail?: string };
    };

    expect(err.code).toBe("internal.assertionFailed");
    expect(err.details?.where).toBe("backing.getBackingBuffer");
    expect(err.details?.detail).toMatch(
      /partitioned backing has no single SharedArrayBuffer/i,
    );

    // Helper should correctly resolve specific plane buffers
    expect(getBufferForPlane(split, "PF32")).toBe(split.planes.PF32);
    expect(getBufferForPlane(split, "MU")).toBe(split.planes.MU);
  });
});
