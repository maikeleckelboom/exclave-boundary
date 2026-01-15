import { createWorkletMountError } from "../errors";

import type {
  WmErrorMessage,
  WmJsonObject,
  WmJsonValue,
  WmMountMessage,
  WmPhase,
  WmWasmBytes,
} from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  return (
    typeof SharedArrayBuffer !== "undefined" &&
    value instanceof SharedArrayBuffer
  );
}

function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value);
}

function kindOf(value: unknown): string {
  if (value === null) {
    return "null";
  }
  const t = typeof value;
  if (t !== "object") {
    return t;
  }
  if (value instanceof ArrayBuffer) {
    return "ArrayBuffer";
  }
  if (isSharedArrayBuffer(value)) {
    return "SharedArrayBuffer";
  }
  if (isArrayBufferView(value)) {
    const ctor = (value as { readonly constructor?: unknown }).constructor;
    if (
      typeof ctor === "function" &&
      typeof (ctor as { readonly name?: unknown }).name === "string"
    ) {
      const name = (ctor as { readonly name: string }).name;
      return name.length > 0 ? name : "ArrayBufferView";
    }
    return "ArrayBufferView";
  }
  const ctor = (value as { readonly constructor?: unknown }).constructor;
  if (
    typeof ctor === "function" &&
    typeof (ctor as { readonly name?: unknown }).name === "string"
  ) {
    const name = (ctor as { readonly name: string }).name;
    return name.length > 0 ? name : "object";
  }
  return "object";
}

export function isWmPhase(value: unknown): value is WmPhase {
  return value === "loading" || value === "rt";
}

/**
 * Returns true if the value is a JSON-serializable object.
 *
 * @remarks
 * Used to safely forward `error.details` over `postMessage` without
 * smuggling `undefined`, functions, or class instances.
 */
export function isWmJsonObject(value: unknown): value is WmJsonObject {
  return isJsonObject(value, 8);
}

function isJsonPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isJsonValue(value: unknown, depth: number): value is WmJsonValue {
  if (isJsonPrimitive(value)) {
    return true;
  }
  if (depth <= 0) {
    return false;
  }
  if (Array.isArray(value)) {
    for (const el of value) {
      if (!isJsonValue(el, depth - 1)) {
        return false;
      }
    }
    return true;
  }
  return isJsonObject(value, depth - 1);
}

function isJsonObject(value: unknown, depth: number): value is WmJsonObject {
  if (!isObject(value)) {
    return false;
  }
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (!isJsonValue(v, depth - 1)) {
      return false;
    }
  }
  return true;
}

/**
 * Validates an error message emitted from the worklet.
 */
export function isWmErrorMessage(value: unknown): value is WmErrorMessage {
  if (!isObject(value)) {
    return false;
  }
  if (value.type !== "wm:error") {
    return false;
  }

  const { key, seq, phase, message, code, details } = value;

  if (!isString(key)) {
    return false;
  }
  if (!isSeq(seq)) {
    return false;
  }
  if (!isWmPhase(phase)) {
    return false;
  }
  if (!isString(message)) {
    return false;
  }

  if (code !== undefined && !isString(code)) {
    return false;
  }
  if (details !== undefined && !isWmJsonObject(details)) {
    return false;
  }

  return true;
}

/**
 * Returns true if the value can represent WASM bytes.
 */
export function isWmWasmBytes(value: unknown): value is WmWasmBytes {
  if (value instanceof ArrayBuffer) {
    return true;
  }
  if (isSharedArrayBuffer(value)) {
    return true;
  }
  return isArrayBufferView(value);
}

/**
 * Coerces the incoming wasm bytes into a `Uint8Array` view.
 *
 * @remarks
 * This does not copy unless the input forces it.
 */
export function toU8View(bytes: WmWasmBytes): Uint8Array {
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  if (isSharedArrayBuffer(bytes)) {
    return new Uint8Array(bytes);
  }
  if (isArrayBufferView(bytes)) {
    const view = bytes;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }

  // Should be unreachable due to guards (WmWasmBytes).
  throw createWorkletMountError("invalidWasmBytes", {
    op: "protocol.toU8View",
    receivedKind: kindOf(bytes),
  });
}

export function hasWasmMagic(bytes: WmWasmBytes): boolean {
  const u8 = toU8View(bytes);
  return (
    u8.byteLength >= 4 &&
    u8[0] === 0x00 &&
    u8[1] === 0x61 &&
    u8[2] === 0x73 &&
    u8[3] === 0x6d
  );
}

function byteLengthOf(bytes: WmWasmBytes): number {
  if (bytes instanceof ArrayBuffer) {
    return bytes.byteLength;
  }
  if (isSharedArrayBuffer(bytes)) {
    return bytes.byteLength;
  }
  return bytes.byteLength;
}

/**
 * Asserts that the input looks like WASM bytes and starts with the WASM magic header.
 *
 * @throws WorkletMountError
 */
export function assertWasmBinary(value: unknown, where: string): WmWasmBytes {
  if (!isWmWasmBytes(value)) {
    throw createWorkletMountError("invalidWasmBytes", {
      op: where,
      receivedKind: kindOf(value),
    });
  }

  if (!hasWasmMagic(value)) {
    throw createWorkletMountError("invalidWasmBytes", {
      op: where,
      receivedKind: kindOf(value),
      byteLength: byteLengthOf(value),
    });
  }

  return value;
}

export function isWmMountMessage(value: unknown): value is WmMountMessage {
  if (!isObject(value)) {
    return false;
  }
  if (value.type !== "wm:mount") {
    return false;
  }

  const { key, seq, wasmBytes, wrapperJs, moduleOpts } = value;

  if (!isNonEmptyString(key)) {
    return false;
  }
  if (!isSeq(seq)) {
    return false;
  }

  if (!isWmWasmBytes(wasmBytes) || !hasWasmMagic(wasmBytes)) {
    return false;
  }

  if (wrapperJs !== undefined && !isString(wrapperJs)) {
    return false;
  }
  if (moduleOpts !== undefined && !isObject(moduleOpts)) {
    return false;
  }

  return true;
}
