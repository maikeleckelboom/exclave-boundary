/**
 * @fileoverview
 * Allocates shared WebAssembly memory backings for a plan.
 *
 * @remarks
 * - Uses `WebAssembly.Memory` with `shared: true` for WASM-based runtimes.
 * - Derives byte requirements from the Plan.
 * - Bootstrapping growth:
 *   - If an existing `WebAssembly.Memory` is provided, it will be grown
 *     via `.grow()` until it can hold `plan.bytesTotal`, or an error is thrown.
 *   - If no memory is provided, a new `WebAssembly.Memory` is allocated
 *     with exactly enough pages for the plan.
 *
 * @internal
 */

import { createBackingError } from "../errors/backing";
import { createEnvError } from "../errors/env";

import type { WasmSharedBacking } from "./types";
import type { Plan } from "../plan/types";
import type { SpecInput } from "../spec/types";

/** WebAssembly page size in bytes (64 KiB). */
const WASM_PAGE_SIZE = 64 * 1024;

/**
 * Validates that a buffer is a SharedArrayBuffer.
 */
function toSharedBuffer(buf: ArrayBuffer, where: string): SharedArrayBuffer {
  const sharedAvailable = typeof SharedArrayBuffer !== "undefined";
  const isShared = sharedAvailable && buf instanceof SharedArrayBuffer;

  if (!isShared) {
    throw createBackingError("wasmMemoryNotShared", {
      plane: "wasm",
      shared: false,
      where,
    });
  }

  return buf as SharedArrayBuffer;
}

/**
 * Ensure that the given WebAssembly.Memory is large enough to hold `totalBytes`.
 *
 * @remarks
 * - Calls `memory.grow()` in page-sized increments if needed.
 * - Throws `backing.allocUndersized` if growth fails (e.g. maximum hit).
 */
function ensureWasmCapacity(
  totalBytes: number,
  memory: WebAssembly.Memory,
  where: string,
): void {
  const currentBytes = memory.buffer.byteLength;

  if (currentBytes >= totalBytes) {
    return;
  }

  const missingBytes = totalBytes - currentBytes;
  const pagesNeeded = Math.ceil(missingBytes / WASM_PAGE_SIZE);

  try {
    memory.grow(pagesNeeded);
  } catch (cause) {
    throw createBackingError(
      "allocUndersized",
      {
        plane: "all",
        requestedBytes: totalBytes,
        allocatedBytes: currentBytes,
        where,
      },
      cause,
    );
  }
}

/**
 * Allocate or wrap a shared WebAssembly.Memory for the given plan.
 *
 * @remarks
 * - If `existingMemory` is provided:
 *   - Validates it is shared.
 *   - Grows it if necessary to satisfy `plan.bytesTotal`.
 * - If `existingMemory` is not provided:
 *   - Allocates a new `WebAssembly.Memory` with
 *     `initial = maximum = ceil(bytesTotal / pageSize)`.
 */
export function allocateWasmShared<S extends SpecInput>(
  plan: Plan<S>,
  existingMemory?: WebAssembly.Memory,
): WasmSharedBacking {
  if (
    typeof WebAssembly === "undefined" ||
    typeof WebAssembly.Memory === "undefined"
  ) {
    throw createEnvError("unsupported", {
      feature: "WebAssembly.Memory",
      reason: "WebAssembly or WebAssembly.Memory is not defined",
    });
  }

  let memory: WebAssembly.Memory;

  if (existingMemory) {
    memory = existingMemory;
    toSharedBuffer(memory.buffer, "allocateWasmShared");
    ensureWasmCapacity(plan.bytesTotal, memory, "allocateWasmShared.grow");
  } else {
    const requiredPages = Math.max(
      1,
      Math.ceil(plan.bytesTotal / WASM_PAGE_SIZE),
    );

    try {
      memory = new WebAssembly.Memory({
        initial: requiredPages,
        maximum: requiredPages,
        shared: true,
      });
    } catch (cause) {
      throw createBackingError(
        "wasmMemoryNotShared",
        {
          plane: "wasm",
          shared: false,
          where: "allocateWasmShared",
        },
        cause,
      );
    }
  }

  const sharedBuf = toSharedBuffer(memory.buffer, "allocateWasmShared");

  if (sharedBuf.byteLength < plan.bytesTotal) {
    throw createBackingError("allocUndersized", {
      plane: "all",
      requestedBytes: plan.bytesTotal,
      allocatedBytes: sharedBuf.byteLength,
      where: "allocateWasmShared",
    });
  }

  return { kind: "wasm-shared", memory };
}
