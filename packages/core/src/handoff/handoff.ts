/**
 * @fileoverview
 * Handoff construction and validation (v1 – zero duplication).
 *
 * Moves a `Plan<S>` and its backing across concurrency boundaries:
 *
 * - `buildHandoff(plan, backing)` – owner-side construction of a `Handoff<S>`.
 * - `buildHandoff(context)` – owner-side construction from `SharedContext<S>`.
 * - `acceptHandoff(handoff)` – boundary validation → `AcceptedHandoff<S>`.
 * - `verifyHandoff(localPlan, remotePlan)` – optional consistency check.
 *
 * Design:
 * - `Plan<S>` is the single source of truth for layout/spec metadata.
 * - The handoff envelope carries only `{ version, packing, backing, plan }`.
 * - No duplicated header fields, no derived lengths stored twice.
 * - Consumers bind from `AcceptedHandoff<S>`, never raw `(Plan<S>, Backing)`.
 */

import { createError } from "../errors/error";
import { isObject } from "../internal/is-object";
import { ALL_PLANES, type PlaneKey } from "../primitives/planes";

import type { Handoff, AcceptedHandoff } from "./types";
import type { Backing } from "../backing/types";
import type { SharedContext } from "../context/types";
import type { Plan, PlaneByteLengths } from "../plan/types";
import type { SpecInput } from "../spec/types";

/**
 * Protocol version supported by this module.
 *
 * @remarks
 * - Used by `buildHandoff` as the outbound version tag.
 * - Checked by `acceptHandoff` at the boundary.
 * - Increment when introducing breaking changes to the handoff shape/semantics.
 */
const SUPPORTED_HANDOFF_VERSION = 1 as const;

/**
 * Check whether a value is a `SharedArrayBuffer`.
 *
 * @remarks
 * Guards against environments where `SharedArrayBuffer` is not defined.
 */
function isSharedArrayBuffer(x: unknown): x is SharedArrayBuffer {
  return (
    typeof SharedArrayBuffer !== "undefined" && x instanceof SharedArrayBuffer
  );
}

/**
 * Structural guard for `PlaneByteLengths`.
 *
 * @internal
 */
function isPlaneByteLengths(value: unknown): value is PlaneByteLengths {
  if (!isObject(value)) {
    return false;
  }

  for (const v of Object.values(value)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      return false;
    }
  }

  return true;
}

/**
 * Structural guard for `Plan<S>` used at the boundary.
 *
 * @internal
 */
function isPlanLike<S extends SpecInput>(plan: unknown): plan is Plan<S> {
  if (!isObject(plan)) {
    return false;
  }

  const maybeHash = (plan as { hash?: unknown }).hash;
  const maybeBytesTotal = (plan as { bytesTotal?: unknown }).bytesTotal;
  const maybePlanes = (plan as { planes?: unknown }).planes;

  if (typeof maybeHash !== "string" || typeof maybeBytesTotal !== "number") {
    return false;
  }

  if (!isPlaneByteLengths(maybePlanes)) {
    return false;
  }

  return true;
}

/**
 * Construct a {@link Handoff} from a context, plan, and backing.
 *
 * @typeParam S - Spec type (inferred from `plan` or `context.plan`).
 *
 * @throws {@link import('../errors').SeqlokError}
 * - `handoff.invalidArtifact` if the backing is incompatible with the plan,
 *   or an unsupported backing kind is provided.
 *
 * @remarks
 * - v1 supports:
 *   - `backing.kind: 'shared'` → `packing: 'shared'` with a single `sab`.
 *   - `backing.kind: 'shared-partitioned'` → `packing: 'shared-partitioned'`
 *     with per-plane SABs keyed by `PlaneKey`.
 *   - `backing.kind: 'wasm-shared'` is **not** serializable via handoff yet
 *     and will throw a descriptive error.
 */

/**
 * Owner-side overload: build a handoff from a `SharedContext<S>`.
 */
export function buildHandoff<S extends SpecInput>(
  context: SharedContext<S>,
): Handoff<S>;

/**
 * Owner-side overload: build a handoff from an explicit `(plan, backing)` pair.
 */
export function buildHandoff<S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
): Handoff<S>;

/**
 * Runtime implementation for both `buildHandoff` overloads.
 */
export function buildHandoff<S extends SpecInput>(
  arg1: Plan<S> | SharedContext<S>,
  arg2?: Backing,
): Handoff<S> {
  let plan: Plan<S>;
  let backing: Backing;

  if (isSharedContext<S>(arg1)) {
    plan = arg1.plan;
    backing = arg1.backing;
  } else {
    plan = arg1;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    backing = arg2!;
  }

  if (backing.kind === "shared") {
    if (!isSharedArrayBuffer(backing.sab)) {
      throw createError(
        "handoff.invalidArtifact",
        'Handoff requires a SharedArrayBuffer backing for kind="shared"',
        {
          where: "handoff.buildHandoff",
          detail: "backing.sab",
        },
      );
    }

    const requiredBytes = plan.bytesTotal >>> 0;
    const actualBytes = backing.sab.byteLength >>> 0;

    if (actualBytes < requiredBytes) {
      throw createError(
        "handoff.invalidArtifact",
        "Backing SharedArrayBuffer undersized for plan",
        {
          where: "handoff.buildHandoff",
          expectedBytes: requiredBytes,
          receivedBytes: actualBytes,
        },
      );
    }

    // Brand on the way out.
    return {
      version: SUPPORTED_HANDOFF_VERSION,
      packing: "shared",
      sab: backing.sab,
      plan,
    } as unknown as Handoff<S>;
  }

  if (backing.kind === "shared-partitioned") {
    // View plan.planes through the same key-space as the backing.
    const planeLengths = plan.planes as Record<PlaneKey, number>;
    const planes = backing.planes;

    for (const plane of ALL_PLANES) {
      const sab = planes[plane];

      if (!isSharedArrayBuffer(sab)) {
        throw createError(
          "handoff.invalidArtifact",
          "Plane backing is not a SharedArrayBuffer",
          {
            where: "handoff.buildHandoff",
            detail: `plane=${plane}`,
          },
        );
      }

      const requiredBytes = planeLengths[plane] >>> 0;
      const actualBytes = sab.byteLength >>> 0;

      if (actualBytes < requiredBytes) {
        throw createError(
          "handoff.invalidArtifact",
          "Plane backing undersized for plan",
          {
            where: "handoff.buildHandoff",
            detail: `plane=${plane}`,
            expectedBytes: requiredBytes,
            receivedBytes: actualBytes,
          },
        );
      }
    }

    return {
      version: SUPPORTED_HANDOFF_VERSION,
      packing: "shared-partitioned",
      planes,
      plan,
    } as unknown as Handoff<S>;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (backing.kind === "wasm-shared") {
    throw createError(
      "handoff.invalidArtifact",
      "wasm-shared backing is not yet supported by the handoff protocol",
      {
        where: "handoff.buildHandoff",
        detail: "kind=wasm-shared",
      },
    );
  }

  const kind = (backing as { kind?: unknown }).kind;

  throw createError(
    "handoff.invalidArtifact",
    "Unsupported backing kind for handoff",
    {
      where: "handoff.buildHandoff",
      detail: `kind=${String(kind)}`,
    },
  );
}

/**
 * Acceptance-boundary overload: validates and unpacks a typed handoff envelope.
 *
 * @typeParam S - Spec type (inferred from `handoff.plan: Plan<S>`).
 *
 * Use this overload when the `Handoff<S>` type is preserved across the boundary.
 */
export function acceptHandoff<S extends SpecInput>(
  handoff: Handoff<S>,
): AcceptedHandoff<S>;

/**
 * Acceptance-boundary overload: validates and unpacks an untyped envelope.
 *
 * Use this overload when the inbound value is `unknown` (e.g. from `postMessage`).
 */
export function acceptHandoff(handoff: unknown): AcceptedHandoff;

/**
 * Runtime implementation for both `acceptHandoff` overloads.
 *
 * @internal
 */
export function acceptHandoff<S extends SpecInput>( // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  handoff: Handoff<S> | unknown,
): AcceptedHandoff<S> {
  if (!isObject(handoff)) {
    throw createError(
      "handoff.invalidArtifact",
      "Handoff artifact must be an object",
      {
        where: "handoff.acceptHandoff",
        detail: "non-object",
      },
    );
  }

  const hx = handoff as {
    version?: unknown;
    packing?: unknown;
    sab?: unknown;
    planes?: unknown;
    plan?: unknown;
  };

  // Validate protocol version.
  if (hx.version !== SUPPORTED_HANDOFF_VERSION) {
    throw createError("handoff.versionMismatch", "Unexpected handoff version", {
      where: "handoff.acceptHandoff",
      expectedVersion: SUPPORTED_HANDOFF_VERSION,
      receivedVersion: typeof hx.version === "number" ? hx.version : Number.NaN,
    });
  }

  // Validate plan structure (metadata source).
  if (!isPlanLike<S>(hx.plan)) {
    throw createError(
      "handoff.invalidArtifact",
      "Missing or invalid plan in handoff",
      {
        where: "handoff.acceptHandoff",
        detail: "plan",
      },
    );
  }

  const plan = hx.plan;

  if (hx.packing === "shared") {
    if (!isSharedArrayBuffer(hx.sab)) {
      throw createError(
        "handoff.invalidArtifact",
        "Handoff buffer is not SharedArrayBuffer",
        {
          where: "handoff.acceptHandoff",
          detail: "sab",
        },
      );
    }

    return {
      packing: "shared",
      sab: hx.sab,
      plan,
    } as AcceptedHandoff<S>;
  }

  if (hx.packing === "shared-partitioned") {
    if (!isObject(hx.planes)) {
      throw createError(
        "handoff.invalidArtifact",
        "Handoff planes map must be an object",
        {
          where: "handoff.acceptHandoff",
          detail: "planes",
        },
      );
    }

    const planesObject = hx.planes;
    const planeSabMap: Record<string, SharedArrayBuffer> = {};

    for (const [key, value] of Object.entries(planesObject)) {
      if (!isSharedArrayBuffer(value)) {
        throw createError(
          "handoff.invalidArtifact",
          "Plane backing is not a SharedArrayBuffer",
          {
            where: "handoff.acceptHandoff",
            detail: `plane=${key}`,
          },
        );
      }

      planeSabMap[key] = value;
    }

    return {
      packing: "shared-partitioned",
      planes: planeSabMap,
      plan,
    } as AcceptedHandoff<S>;
  }

  throw createError("handoff.invalidArtifact", "Unsupported handoff packing", {
    where: "handoff.acceptHandoff",
    detail: `packing=${String(hx.packing)}`,
  });
}

/**
 * Compare two plans for compatibility.
 *
 * @throws {@link import('../errors').SeqlokError}
 * - `handoff.specHashMismatch` if `hash` values differ.
 * - `handoff.backingMismatch` if `bytesTotal` differ.
 */
export function verifyHandoff<S extends SpecInput>(
  localPlan: Plan<S>,
  remotePlan: Plan<S>,
): void {
  if (localPlan.hash !== remotePlan.hash) {
    throw createError("handoff.specHashMismatch", "Spec hash mismatch", {
      where: "handoff.verifyHandoff",
      expectedHash: localPlan.hash,
      receivedHash: remotePlan.hash,
      localHash: localPlan.hash,
      remoteHash: remotePlan.hash,
      diff: computeHashDiff(localPlan.hash, remotePlan.hash),
    });
  }

  if (localPlan.bytesTotal !== remotePlan.bytesTotal) {
    throw createError(
      "handoff.backingMismatch",
      "Backing byteLength mismatch",
      {
        where: "handoff.verifyHandoff",
        expectedBytes: localPlan.bytesTotal,
        receivedBytes: remotePlan.bytesTotal,
        local: localPlan.bytesTotal,
        remote: remotePlan.bytesTotal,
      },
    );
  }
}

/**
 * Compute a small diff string between two hash values.
 *
 * @remarks
 * Diagnostics-only, used in `verifyHandoff` payloads.
 */
function computeHashDiff(expected: string, received: string): string {
  const len = Math.min(expected.length, received.length);
  let firstDiff = -1;

  for (let i = 0; i < len; i += 1) {
    if (expected[i] !== received[i]) {
      firstDiff = i;
      break;
    }
  }

  if (firstDiff === -1 && expected.length === received.length) {
    return "no-diff";
  }

  return `first-diff@${String(firstDiff)}`;
}

function isSharedContext<S extends SpecInput>(
  value: Plan<S> | SharedContext<S>,
): value is SharedContext<S> {
  return (
    isObject(value) && "spec" in value && "plan" in value && "backing" in value
  );
}
