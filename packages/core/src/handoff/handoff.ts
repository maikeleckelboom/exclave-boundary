/**
 * @fileoverview
 * Handoff construction and validation (v2.0 – zero duplication).
 *
 * This module defines the producer/consumer helpers that move a `Plan<S>`
 * and its backing memory across concurrency boundaries:
 *
 * - `buildHandoff(plan, backing)` – owner-side construction of a `Handoff<S>`.
 * - `receiveHandoff(handoff)` – boundary validation → `ReceivedHandoff<S>`.
 * - `verifyHandoff(localPlan, remotePlan)` – optional consistency check.
 *
 * Design principles:
 *
 * - `Plan<S>` is the single source of truth for layout and spec metadata.
 * - The handoff envelope carries only `{ version, packing, sab, plan }`.
 * - No duplicated header fields, no derived lengths stored twice.
 * - Consumers bind from `ReceivedHandoff<S>` (plan + SAB), not from
 *   `(Plan<S>, SharedBacking)` directly – preserving the owner/processor
 *   authority boundary.
 */

import { createError } from '../errors/error';

import type { Handoff, ReceivedHandoff } from './types';
import type { SharedBacking } from '../backing/types';
import type { Plan, PlaneByteLengths } from '../plan/types';
import type { SpecInput } from '../spec/types';

/**
 * Protocol version supported by this module.
 *
 * @remarks
 * - Used by `buildHandoff` as the outbound version tag.
 * - Checked by `receiveHandoff` at the boundary.
 * - Increment when introducing breaking changes to the handoff shape or
 *   interpretation semantics.
 */
const SUPPORTED_HANDOFF_VERSION = 1 as const;

/**
 * Narrow an arbitrary value to a plain object.
 *
 * @param x - Value to test.
 * @returns `true` if `x` is a non-null object.
 *
 * @internal
 * Used for structural validation of handoff envelopes and plans.
 */
function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/**
 * Check whether a value is a `SharedArrayBuffer`.
 *
 * @param x - Value to test.
 * @returns `true` if `x` is an instance of `SharedArrayBuffer`.
 *
 * @remarks
 * Guards against environments where `SharedArrayBuffer` is not defined.
 *
 * @internal
 */
function isSharedArrayBuffer(x: unknown): x is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== 'undefined' && x instanceof SharedArrayBuffer;
}

/**
 * Structural guard for `PlaneByteLengths`.
 *
 * @param v - Value to probe for `PlaneByteLengths` shape.
 * @returns `true` if `v` exposes numeric byte lengths for all planes.
 *
 * @remarks
 * This does not validate any semantics beyond the presence and type of
 * the numeric fields (`PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`).
 *
 * @internal
 */
function isPlaneByteLengths(v: unknown): v is PlaneByteLengths {
  if (!isPlainObject(v)) {
    return false;
  }
  return (
    typeof v.PF32 === 'number' &&
    typeof v.PI32 === 'number' &&
    typeof v.PB === 'number' &&
    typeof v.PU === 'number' &&
    typeof v.MF32 === 'number' &&
    typeof v.MF64 === 'number' &&
    typeof v.MU32 === 'number' &&
    typeof v.MU === 'number'
  );
}

/**
 * Minimal structural guard for `Plan<S>`.
 *
 * @typeParam S - Spec type parameter inferred from upstream `defineSpec`.
 * @param x - Value to test.
 * @returns `true` if `x` looks like a `Plan<S>` (hash + bytesTotal + planes).
 *
 * @remarks
 * This performs a shallow shape check only:
 *
 * - `hash` must be a string.
 * - `bytesTotal` must be a number.
 * - `planes` must match {@link PlaneByteLengths}.
 *
 * Deeper invariants (e.g. hash content, byte layout, offsets) are enforced
 * by the plan/backing/bindings pipeline, not here.
 *
 * @internal
 */
function isPlanLike<S extends SpecInput>(x: unknown): x is Plan<S> {
  if (!isPlainObject(x)) {
    return false;
  }
  const rx = x as { hash?: unknown; bytesTotal?: unknown; planes?: unknown };
  return (
    typeof rx.hash === 'string' &&
    typeof rx.bytesTotal === 'number' &&
    isPlaneByteLengths(rx.planes)
  );
}

/**
 * Producer-side: build a typed handoff envelope from a plan and backing.
 *
 * @typeParam S - Spec type (inferred from `plan: Plan<S>`).
 * @param plan - Typed memory layout plan (single source of truth).
 * @param backing - Shared backing for the plan (must expose a `SharedArrayBuffer`).
 * @returns Typed handoff envelope (`Handoff<S>`) suitable for transfer.
 *
 * @throws {@link import('../errors').SeqlokError}
 * Throws `handoff.invalidArtifact` if `backing.sab` is not a `SharedArrayBuffer`.
 *
 * @remarks
 * - The handoff carries only `{ version, packing, sab, plan }`. All metadata
 *   (hash, byte lengths, planes, spec shape) is derived from `plan`.
 * - This is an owner-side operation: callers must already have a `Plan<S>`
 *   and a `SharedBacking`, typically obtained via `planLayout(spec)` and
 *   `allocateShared(plan)`.
 *
 * @example
 * ```ts
 * const spec = defineSpec(...);
 * const plan = planLayout(spec);      // Plan<MySpec>
 * const backing = allocateShared(plan);
 * const handoff = buildHandoff(plan, backing);  // Handoff<MySpec>
 *
 * // Access metadata via plan:
 * console.log(handoff.plan.hash);       // spec hash
 * console.log(handoff.plan.bytesTotal); // required bytes
 * console.log(handoff.plan.planes);     // plane layout
 * ```
 */
export function buildHandoff<S extends SpecInput>(
  plan: Plan<S>,
  backing: SharedBacking,
): Handoff<S> {
  if (!isSharedArrayBuffer(backing.sab)) {
    throw createError(
      'handoff.invalidArtifact',
      'Handoff requires a SharedArrayBuffer backing',
      {
        where: 'handoff.buildHandoff',
        detail: 'backing.sab',
      },
    );
  }

  // Zero duplication: plan is the single source of truth
  return {
    version: SUPPORTED_HANDOFF_VERSION,
    packing: 'shared',
    sab: backing.sab,
    plan,
  };
}

/**
 * Receiver-side overload: validates and unpacks a typed handoff envelope.
 *
 * @typeParam S - Spec type (inferred from `handoff.plan: Plan<S>`).
 * @param handoff - Handoff envelope received from another thread/process.
 * @returns Validated {@link ReceivedHandoff} with a typed plan.
 *
 * @throws {@link import('../errors').SeqlokError}
 * Throws one of:
 * - `handoff.invalidArtifact` – wrong shape, missing plan, or invalid SAB.
 * - `handoff.versionMismatch` – unsupported `version` field.
 *
 * @remarks
 * Use this overload when the `Handoff<S>` type is preserved across the
 * boundary (e.g. strongly-typed `postMessage` payloads).
 */
export function receiveHandoff<S extends SpecInput>(
  handoff: Handoff<S>,
): ReceivedHandoff<S>;

/**
 * Receiver-side overload: validates and unpacks an untyped envelope.
 *
 * @param handoff - Handoff envelope with erased type (e.g. `unknown` from `postMessage`).
 * @returns Validated {@link ReceivedHandoff} with a generic `SpecInput` plan.
 *
 * @throws {@link import('../errors').SeqlokError}
 * Throws one of:
 * - `handoff.invalidArtifact` – wrong shape, missing plan, or invalid SAB.
 * - `handoff.versionMismatch` – unsupported `version` field.
 *
 * @remarks
 * Use this overload when the inbound value is `unknown` or not statically
 * typed as `Handoff<S>`. The resulting plan is still structurally validated
 * but typed as `Plan<SpecInput>`.
 */
export function receiveHandoff(handoff: unknown): ReceivedHandoff<SpecInput>;

/**
 * Runtime implementation for both `receiveHandoff` overloads.
 *
 * @internal
 */
export function receiveHandoff<S extends SpecInput>(
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  handoff: Handoff<S> | unknown,
): ReceivedHandoff<S> {
  if (!isPlainObject(handoff)) {
    throw createError('handoff.invalidArtifact', 'Handoff artifact must be an object', {
      where: 'handoff.receiveHandoff',
      detail: 'non-object',
    });
  }

  const hx = handoff as {
    version?: unknown;
    packing?: unknown;
    sab?: unknown;
    plan?: unknown;
  };

  // Validate protocol version
  if (hx.version !== SUPPORTED_HANDOFF_VERSION) {
    throw createError('handoff.versionMismatch', 'Unexpected handoff version', {
      where: 'handoff.receiveHandoff',
      expectedVersion: SUPPORTED_HANDOFF_VERSION,
      receivedVersion: typeof hx.version === 'number' ? hx.version : Number.NaN,
    });
  }

  // Validate packing strategy
  if (hx.packing !== 'shared') {
    throw createError('handoff.invalidArtifact', 'Unsupported handoff packing', {
      where: 'handoff.receiveHandoff',
      detail: `packing=${String(hx.packing)}`,
    });
  }

  // Validate plan structure (this is our metadata source)
  if (!isPlanLike<S>(hx.plan)) {
    throw createError('handoff.invalidArtifact', 'Missing or invalid plan in handoff', {
      where: 'handoff.receiveHandoff',
      detail: 'plan',
    });
  }

  // Validate SAB backing
  if (!isSharedArrayBuffer(hx.sab)) {
    throw createError(
      'handoff.invalidArtifact',
      'Handoff buffer is not SharedArrayBuffer',
      {
        where: 'handoff.receiveHandoff',
        detail: 'sab',
      },
    );
  }

  // Return minimal contract: plan + sab (zero duplication)
  return { sab: hx.sab, plan: hx.plan };
}

/**
 * Compute a lightweight diff description for two hash strings.
 *
 * @param expected - Expected hash string.
 * @param received - Received hash string.
 * @returns Human-readable summary of the first difference.
 *
 * @remarks
 * - If either input is not a string, returns a simple type mismatch summary.
 * - If the strings are identical, returns `"identical"`.
 * - Otherwise, reports the first differing index, length info, and short
 *   previews around the differing region.
 *
 * This is primarily used to enrich error metadata in `verifyHandoff`.
 *
 * @internal
 */
function computeHashDiff(expected: unknown, received: unknown): string {
  if (typeof expected !== 'string' || typeof received !== 'string') {
    return `types differ: expected=${typeof expected}, received=${typeof received}`;
  }
  if (expected === received) {
    return 'identical';
  }

  const maxPreview = 16;
  const minLen = Math.min(expected.length, received.length);

  let i = 0;
  while (i < minLen && expected[i] === received[i]) {
    i++;
  }

  const prefixStart = Math.max(0, i - 8);
  const prefix = expected.slice(prefixStart, i);
  const expPreview = expected.slice(i, i + maxPreview);
  const recPreview = received.slice(i, i + maxPreview);

  const lenInfo =
    expected.length === received.length
      ? `same length ${String(expected.length)}`
      : `expected length ${String(expected.length)}, received length ${String(received.length)}`;

  return `first diff at index ${String(i)} (${lenInfo}); context="${prefix}" expected="${expPreview}" received="${recPreview}"`;
}

/**
 * Optional verification that two plans match (hash + bytesTotal).
 *
 * @typeParam S - Spec type for both plans.
 * @param localPlan - Local plan (e.g. from `planLayout(spec)` on this side).
 * @param remotePlan - Plan extracted from a received handoff.
 *
 * @throws {@link import('../errors').SeqlokError}
 * Throws:
 * - `handoff.specHashMismatch` if `hash` values differ.
 * - `handoff.backingMismatch` if `bytesTotal` values differ.
 *
 * @remarks
 * This function compares plans directly – no separate metadata structure.
 * It is useful when you want to assert that a locally computed plan matches
 * the one embedded in a remote handoff, for example in:
 *
 * - Electron main vs renderer,
 * - multi-process setups,
 * - or diagnostics tests that must prove spec parity.
 *
 * It does **not** perform any binding or mapping; callers still bind from
 * {@link ReceivedHandoff}, never from `(Plan, SharedBacking)` directly.
 *
 * @example
 * ```ts
 * // Main thread:
 * const spec = defineSpec(...);
 * const plan = planLayout(spec);
 * const backing = allocateShared(plan);
 * const handoff = buildHandoff(plan, backing);
 *
 * // Worker thread:
 * const received = receiveHandoff(handoff);
 * verifyHandoff(plan, received.plan);  // Throws if mismatch
 * ```
 */
export function verifyHandoff<S extends SpecInput>(
  localPlan: Plan<S>,
  remotePlan: Plan<S>,
): void {
  if (localPlan.hash !== remotePlan.hash) {
    throw createError('handoff.specHashMismatch', 'Spec hash mismatch', {
      where: 'handoff.verifyHandoff',
      expectedHash: localPlan.hash,
      receivedHash: remotePlan.hash,
      localHash: localPlan.hash,
      remoteHash: remotePlan.hash,
      diff: computeHashDiff(localPlan.hash, remotePlan.hash),
    });
  }

  if (localPlan.bytesTotal !== remotePlan.bytesTotal) {
    throw createError('handoff.backingMismatch', 'Backing byteLength mismatch', {
      where: 'handoff.verifyHandoff',
      expectedBytes: localPlan.bytesTotal,
      receivedBytes: remotePlan.bytesTotal,
      local: localPlan.bytesTotal,
      remote: remotePlan.bytesTotal,
    });
  }
}
