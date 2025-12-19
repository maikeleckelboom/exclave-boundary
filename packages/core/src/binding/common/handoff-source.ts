/**
 * @fileoverview
 * Shared helpers for binding factories that accept `Handoff` and `ReceivedHandoff`.
 *
 * @remarks
 * - Centralizes lightweight runtime shape checks (type guards) for overload dispatch.
 * - Centralizes conversion from `ReceivedHandoff` packing to `Backing`.
 * - Does not validate the protocol; callers must use `receiveHandoff` for `Handoff`.
 */

import type { Backing } from "../../backing/types";
import type { Handoff, ReceivedHandoff } from "../../handoff/types";
import type { SpecInput } from "../../spec/types";

type ObjectRecord = Record<string, unknown>;

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === "object" && value !== null;
}

function hasOwn(obj: ObjectRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPacking(value: unknown): value is "shared" | "shared-partitioned" {
  return value === "shared" || value === "shared-partitioned";
}

/**
 * Returns true when `value` structurally looks like a serialized `Handoff`.
 *
 * @remarks
 * `Handoff` carries the protocol header field `version: 1`.
 * This guard is intentionally cheap; full validation belongs in `receiveHandoff`.
 */
export function isHandoff<const S extends SpecInput>(
  value: unknown,
): value is Handoff<S> {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (value.version !== 1) {
    return false;
  }

  if (!isPacking(value.packing)) {
    return false;
  }

  return (
    hasOwn(value, "plan") && (hasOwn(value, "sab") || hasOwn(value, "planes"))
  );
}

/**
 * Returns true when `value` structurally looks like a validated `ReceivedHandoff`.
 *
 * @remarks
 * `ReceivedHandoff` does not include the protocol header field `version`.
 * This guard is used for overload dispatch only.
 */
export function isReceivedHandoff<const S extends SpecInput>(
  value: unknown,
): value is ReceivedHandoff<S> {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (hasOwn(value, "version")) {
    return false;
  }

  if (!isPacking(value.packing)) {
    return false;
  }

  return (
    hasOwn(value, "plan") && (hasOwn(value, "sab") || hasOwn(value, "planes"))
  );
}

/**
 * Converts a `ReceivedHandoff` packing into the `Backing` shape used by binding impls.
 */
export function backingFromReceived<const S extends SpecInput>(
  received: ReceivedHandoff<S>,
): Backing {
  if (received.packing === "shared") {
    return {
      kind: "shared",
      sab: received.sab,
    };
  }

  return {
    kind: "shared-partitioned",
    planes: received.planes,
  };
}
