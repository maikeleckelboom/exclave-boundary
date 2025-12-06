import { describe, it, expectTypeOf } from "vitest";

import {
  isSharedBacking,
  isSharedPartitionedBacking,
  isWasmSharedBacking,
} from "../../src/backing/types";

import type {
  Backing,
  SharedBacking,
  SharedPartitionedBacking,
  WasmSharedBacking,
} from "../../src/backing/types";

describe("Backing Types (Compile-Time Contracts)", () => {
  it("discriminated union and guards narrow precisely", () => {
    const cases: Backing[] = [
      { kind: "shared", sab: new SharedArrayBuffer(8) },
      {
        kind: "shared-partitioned",
        planes: {
          PF32: new SharedArrayBuffer(0),
          PI32: new SharedArrayBuffer(0),
          PB: new SharedArrayBuffer(0),
          PU: new SharedArrayBuffer(8),
          MF32: new SharedArrayBuffer(0),
          MF64: new SharedArrayBuffer(0),
          MU32: new SharedArrayBuffer(0),
          MU: new SharedArrayBuffer(8),
        },
      },
      {
        kind: "wasm-shared",
        memory: new WebAssembly.Memory({
          initial: 1,
          maximum: 1,
          shared: true,
        }),
      },
    ];

    for (const b of cases) {
      if (isSharedBacking(b)) {
        expectTypeOf(b).toExtend<SharedBacking>();
      } else if (isSharedPartitionedBacking(b)) {
        expectTypeOf(b).toExtend<SharedPartitionedBacking>();
      } else if (isWasmSharedBacking(b)) {
        expectTypeOf(b).toExtend<WasmSharedBacking>();
      }
    }
  });
});
