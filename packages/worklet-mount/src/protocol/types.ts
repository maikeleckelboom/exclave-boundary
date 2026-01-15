import type { WorkletMountErrorCode } from "../errors";

export type WmLogLevel = "info" | "warn" | "error" | "critical";

/**
 * Runtime phase of the worklet as observed at the worklet boundary.
 *
 * - `"loading"`: a mount/load attempt is in progress (or failed during load).
 * - `"rt"`: the processor is in real-time mode (audio callback running).
 */
export type WmPhase = "loading" | "rt";

/**
 * JSON-serializable value type used for compact, structured error `details`.
 *
 * @remarks
 * This is intentionally strict: no `undefined`, no functions, no class instances.
 *
 * TypeScript forbids recursive type-aliases under some configurations, so the
 * recursive pieces are expressed as interfaces.
 */
export type WmJsonPrimitive = string | number | boolean | null;

export interface WmJsonObject {
  readonly [key: string]: WmJsonValue;
}

export type WmJsonArray = readonly WmJsonValue[];

export type WmJsonValue = WmJsonPrimitive | WmJsonObject | WmJsonArray;

/**
 * WASM bytes accepted by the protocol.
 *
 * - `ArrayBuffer` is the most transferable-friendly option.
 * - `SharedArrayBuffer` supports COOP/COEP environments.
 * - `ArrayBufferView` (e.g. `Uint8Array`) is ergonomic for callers.
 */
export type WmWasmBytes = ArrayBuffer | SharedArrayBuffer | ArrayBufferView;

/**
 * Mount request sent from host -> worklet.
 */
export interface WmMountMessage {
  readonly type: "wm:mount";
  readonly key: string;
  readonly seq: number;

  /**
   * Raw WASM bytes. Must start with `\0asm`.
   */
  readonly wasmBytes: WmWasmBytes;

  /**
   * Optional Emscripten wrapper JS text.
   *
   * @remarks
   * If omitted, the worklet will attempt to resolve a bundled factory by `key`.
   */
  readonly wrapperJs?: string;

  /**
   * Optional module options passed to the Emscripten factory.
   *
   * @remarks
   * Values must be structured-clone compatible if they cross the port.
   */
  readonly moduleOpts?: Readonly<Record<string, unknown>>;
}

/**
 * Ready acknowledgement sent from worklet -> host.
 */
export interface WmReadyMessage {
  readonly type: "wm:ready";
  readonly key: string;
  readonly seq: number;
}

/**
 * Error response sent from worklet -> host.
 */
export interface WmErrorMessage {
  readonly type: "wm:error";
  readonly key: string;
  readonly seq: number;

  /**
   * Phase at the time the error was produced.
   */
  readonly phase: WmPhase;

  /**
   * Human-friendly error message (best-effort).
   */
  readonly message: string;

  /**
   * Optional domains error code (e.g. `"workletMount.invalidMountMessage"`).
   */
  readonly code?: WorkletMountErrorCode;

  /**
   * Optional structured, JSON-serializable details.
   */
  readonly details?: WmJsonObject;
}

export interface WmLogMessage {
  readonly type: "wm:log";
  readonly key: string;
  readonly seq: number;
  readonly level: WmLogLevel;
  readonly msg: string;
}

export type WmMessageIn = WmMountMessage;
export type WmMessageOut = WmReadyMessage | WmErrorMessage | WmLogMessage;
