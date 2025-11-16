/**
 * @fileoverview Handoff construction and validation (v2.0 - zero duplication)
 *
 * Design principle: Plan<S> is the single source of truth.
 * All validation happens against the plan, not duplicated header fields.
 */

import { createError } from '../errors/error';

import type { Handoff, ReceivedHandoff } from './types';
import type { SharedBacking } from '../backing/types';
import type { Plan, PlaneByteLengths } from '../plan/types';
import type { SpecInput } from '../spec/types';

const SUPPORTED_HANDOFF_VERSION = 1 as const;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isSharedArrayBufferLike(x: unknown): x is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== 'undefined' && x instanceof SharedArrayBuffer;
}

function isPlaneByteLengths(value: unknown): value is PlaneByteLengths {
  if (!isObject(value)) {
    return false;
  }
  const v = value;
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

/** Minimal structural guard for Plan<S>. */
function isPlanLike<S extends SpecInput>(x: unknown): x is Plan<S> {
  if (!isObject(x)) {
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
 * Producer-side: builds a typed handoff envelope.
 *
 * Returns `Handoff<S>` where `S` is inferred from `plan: Plan<S>`.
 * The handoff carries only the essential fields - plan is the metadata source.
 *
 * @template S - Spec type (inferred from plan)
 * @param plan - Typed memory layout plan (single source of truth)
 * @param backing - SharedArrayBuffer backing
 * @returns Typed handoff envelope (no duplicated metadata)
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
  if (!isSharedArrayBufferLike(backing.sab)) {
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
 * Receiver-side: validates and unpacks a handoff envelope.
 *
 * Generic parameter `S` is automatically inferred from `handoff.plan`.
 * If handoff type is erased (e.g., `unknown` from postMessage), falls back to `SpecInput`.
 *
 * Validates:
 * - Protocol version
 * - Packing strategy
 * - Plan structure (hash, bytesTotal, planes)
 * - SAB presence
 *
 * All metadata comes from the plan.
 *
 * @template S - Spec type (inferred from handoff.plan: Plan<S>)
 * @param handoff - Handoff envelope (from postMessage)
 * @returns Validated handoff with typed plan
 *
 * @example
 * ```ts
 * import type { Handoff } from '@seqlok/core';
 * import type { MySpec } from './spec';
 *
 * type InitMessage = { handoff: Handoff<MySpec> };
 *
 * self.onmessage = (ev: MessageEvent<InitMessage>) => {
 *   const received = receiveHandoff(ev.data.handoff);
 *   //    ^? ReceivedHandoff<MySpec> ✓
 *
 *   // Access metadata via plan:
 *   console.log(received.plan.hash);
 *   console.log(received.plan.bytesTotal);
 * };
 * ```
 */
export function receiveHandoff<S extends SpecInput>(
  handoff: Handoff<S>,
): ReceivedHandoff<S>;

/**
 * Fallback overload for untyped handoff (runtime validation only).
 * Returns `ReceivedHandoff<SpecInput>` with untyped spec.
 */
export function receiveHandoff(handoff: unknown): ReceivedHandoff<SpecInput>;

export function receiveHandoff<S extends SpecInput>(
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  handoff: Handoff<S> | unknown,
): ReceivedHandoff<S> {
  if (!isObject(handoff)) {
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
  if (!isSharedArrayBufferLike(hx.sab)) {
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

/** Lightweight diff string for two hash strings (prefix context + preview). */
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
 * Compares plans directly - no separate metadata structure.
 * Useful for asserting local plan matches remote received plan.
 *
 * @param localPlan - Your local plan (from planLayout)
 * @param remotePlan - Plan from received handoff
 * @throws {SeqlokError} If plans don't match
 *
 * @example
 * ```ts
 * // Main thread:
 * const plan = planLayout(spec);
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
