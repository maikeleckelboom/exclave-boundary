/**
 * @fileoverview
 * Shared helpers for binding factories that accept `Handoff` and `AcceptedHandoff`.
 *
 * @remarks
 * - Centralizes lightweight runtime shape checks (type guards) for overload dispatch.
 * - Centralizes conversion from `AcceptedHandoff` packing to `Backing`.
 * - Does not validate the protocol; callers must use `acceptHandoff` for `Handoff`.
 */

import type { Backing } from "../../backing/types";
import type { Handoff, AcceptedHandoff } from "../../handoff/types";
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
 * This guard is intentionally cheap; full validation belongs in `acceptHandoff`.
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
 * Returns true when `value` structurally looks like a validated `AcceptedHandoff`.
 *
 * @remarks
 * `AcceptedHandoff` does not include the protocol header field `version`.
 * This guard is used for overload dispatch only.
 */
export function isAcceptedHandoff<const S extends SpecInput>(
  value: unknown,
): value is AcceptedHandoff<S> {
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
 * Converts an `AcceptedHandoff` packing into the `Backing` shape used by binding impls.
 */
export function backingFromAccepted<const S extends SpecInput>(
  accepted: AcceptedHandoff<S>,
): Backing {
  if (accepted.packing === "shared") {
    return {
      kind: "shared",
      sab: accepted.sab,
    };
  }

  return {
    kind: "shared-partitioned",
    planes: accepted.planes,
  };
}
