import { type WmJsonObject, type WmPhase, isWmJsonObject } from "../protocol";

import type { WorkletMountErrorCode } from "../errors";

/**
 * Internal runtime phase used by the worklet mount runtime to distinguish between:
 * - `"setup"`: non-real-time lifecycle (loading/initialization)
 * - `"rt"`: real-time audio processing
 *
 * This type is intentionally narrower than the wire protocol phase (`WmPhase`),
 * and must be converted via {@link phaseForWire}.
 */
type Phase = "setup" | "rt";

/**
 * Type guard for "plain object-ish" values.
 *
 * Notes:
 * - Returns `true` for objects including arrays and class instances.
 * - Returns `false` for `null` and all primitives.
 *
 * Use this as a shallow precondition before checking property existence with
 * `"key" in value`.
 *
 * @param value - Unknown value to test.
 * @returns `true` if `value` is non-null and `typeof value === "object"`.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * Type guard for a non-negative, safe integer sequence number.
 *
 * Sequence numbers are used to correlate host ↔ runtime messages and must be:
 * - a JavaScript number
 * - a safe integer (`Number.isSafeInteger`)
 * - non-negative (`>= 0`)
 *
 * @param value - Unknown value to test.
 * @returns `true` if `value` is a non-negative safe integer.
 */
export function isSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Extracts a worklet-mount error code from an unknown thrown value.
 *
 * This function is deliberately defensive:
 * - The thrown value may be anything (Error, object literal, string, etc.).
 * - Only a string-valued `code` property is interpreted as an error code.
 *
 * No validation is performed beyond checking that `code` is a string; the caller
 * may choose to validate membership in the registry (if desired).
 *
 * @param err - Unknown thrown value.
 * @returns The extracted {@link WorkletMountErrorCode} if present, otherwise `undefined`.
 */
export function getErrorCode(err: unknown): WorkletMountErrorCode | undefined {
  if (!isRecord(err) || !("code" in err)) {
    return undefined;
  }
  const code = (err as { readonly code?: unknown }).code;
  return typeof code === "string" ? (code as WorkletMountErrorCode) : undefined;
}

/**
 * Extracts structured JSON details from an unknown thrown value.
 *
 * The runtime uses `details` as a structured, JSON-safe payload suitable for
 * cross-thread transport (postMessage / structured clone) and for consistent
 * logging and telemetry.
 *
 * Only values accepted by {@link isWmJsonObject} are returned.
 *
 * @param err - Unknown thrown value.
 * @returns A {@link WmJsonObject} if a valid `details` payload is present, otherwise `undefined`.
 */
export function getErrorDetails(err: unknown): WmJsonObject | undefined {
  if (!isRecord(err) || !("details" in err)) {
    return undefined;
  }
  const details = (err as { readonly details?: unknown }).details;
  return isWmJsonObject(details) ? details : undefined;
}

/**
 * Maps the internal runtime phase to the wire protocol phase.
 *
 * The wire protocol uses:
 * - `"loading"` for all setup/non-RT work
 * - `"rt"` for real-time processing
 *
 * @param phase - Internal runtime phase.
 * @returns Corresponding wire protocol phase.
 */
export function phaseForWire(phase: Phase): WmPhase {
  return phase === "setup" ? "loading" : "rt";
}

/**
 * Clears (zeros) all output audio buffers in-place.
 *
 * `outputs` is expected to follow the AudioWorklet-style layout:
 * - `outputs[busIndex][channelIndex]` is a `Float32Array` for one channel
 *
 * This is RT-safe: it performs bounded loops and in-place `fill(0)` with no allocations.
 *
 * @param outputs - Output buffer array to zero in-place.
 */
export function zeroOutputs(outputs: Float32Array[][]): void {
  for (const bus of outputs) {
    for (const ch of bus) {
      ch.fill(0);
    }
  }
}
