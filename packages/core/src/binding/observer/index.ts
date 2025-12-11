/**
 * @fileoverview
 * Public observer binding factory.
 *
 * @remarks
 * - Bridges `ReceivedHandoff` or `SharedContext` into a typed `ObserverBinding`.
 * - Host-side (context/spec) observers can surface rich shapes (e.g. enum labels).
 * - Worker-side (handoff) observers fall back to numeric enum indices.
 * - Can be used in the same thread as the Controller OR in workers.
 * - Safe to have multiple observers on the same handoff.
 */

import { observerImpl } from "./impl";
import { isSharedContext } from "../../context/guard";

import type { Backing } from "../../backing/types";
import type { SharedContext } from "../../context/types";
import type { ReceivedHandoff } from "../../handoff/types";
import type { Plan } from "../../plan/types";
import type { ParamDef, SpecInput } from "../../spec/types";
import type { ObserverBinding, ObserverOptions } from "../common/types";

const EMPTY_PARAM_DEFS: Readonly<Record<string, ParamDef>> = {};

interface NormalizedObserverSource<S extends SpecInput> {
  readonly plan: Plan<S>;
  readonly backing: Backing;
  readonly defs: Readonly<Record<string, ParamDef>>;
}

/**
 * Bind a read-only observer to the shared state (high-level variant).
 *
 * @remarks
 * - If `source` is a `SharedContext`, enums are surfaced as string labels
 *   because the Spec (and labels) are available.
 * - If `source` is a `ReceivedHandoff`, enums are surfaced as numeric indices
 *   because the Spec is not present on the remote side.
 */
export function bindObserver<S extends SpecInput>(
  source: ReceivedHandoff<S> | SharedContext<S>,
  options?: ObserverOptions,
): ObserverBinding<S>;

/**
 * Bind a read-only observer to the shared state (Host / explicit low-level variant).
 *
 * @remarks
 * - Low-level injection if you are managing resources manually.
 */
export function bindObserver<S extends SpecInput>(
  spec: S,
  plan: Plan<S>,
  backing: Backing,
  options?: ObserverOptions,
): ObserverBinding<S>;

/**
 * Implementation of bindObserver dispatching.
 */
export function bindObserver<S extends SpecInput>(
  arg1: ReceivedHandoff<S> | SharedContext<S> | S,
  arg2?: ObserverOptions | Plan<S>,
  arg3?: Backing,
  arg4?: ObserverOptions,
): ObserverBinding<S> {
  const { plan, backing, defs } = normalizeSource(arg1, arg2, arg3);
  const options = getOptions(arg1, arg2, arg4);

  return observerImpl(plan, backing, defs, options);
}

function normalizeSource<S extends SpecInput>(
  arg1: ReceivedHandoff<S> | SharedContext<S> | S,
  arg2?: ObserverOptions | Plan<S>,
  arg3?: Backing,
): NormalizedObserverSource<S> {
  // Case 1: ReceivedHandoff (Worker / remote side)
  if (isReceivedHandoff<S>(arg1)) {
    const received = arg1;

    const backing: Backing =
      received.packing === "shared"
        ? { kind: "shared", sab: received.sab }
        : {
            kind: "shared-partitioned",
            planes: received.planes,
          };

    return {
      plan: received.plan,
      backing,
      defs: EMPTY_PARAM_DEFS,
    };
  }

  // Case 2: SharedContext (Host ergonomic)
  if (isSharedContext<S>(arg1)) {
    const ctx = arg1;
    const defs: Readonly<Record<string, ParamDef>> = ctx.spec.params ?? {};

    return {
      plan: ctx.plan,
      backing: ctx.backing,
      defs,
    };
  }

  // Case 3: Explicit triple (Host low-level)
  const spec = arg1;
  const plan = arg2 as Plan<S>;

  if (arg3 === undefined) {
    throw new Error(
      "bindObserver: backing is required when binding from (spec, plan, backing).",
    );
  }

  const backing = arg3;
  const defs: Readonly<Record<string, ParamDef>> = spec.params ?? {};

  return {
    plan,
    backing,
    defs,
  };
}

function getOptions<S extends SpecInput>(
  arg1: ReceivedHandoff<S> | SharedContext<S> | S,
  arg2?: ObserverOptions | Plan<S>,
  arg4?: ObserverOptions,
): ObserverOptions | undefined {
  if (isReceivedHandoff<S>(arg1) || isSharedContext<S>(arg1)) {
    return arg2 as ObserverOptions | undefined;
  }

  // Explicit triple variant: options is the 4th argument.
  return arg4;
}

function isReceivedHandoff<S extends SpecInput>(
  value: ReceivedHandoff<S> | SharedContext<S> | S,
): value is ReceivedHandoff<S> {
  return (
    typeof value === "object" &&
    "packing" in value &&
    typeof (value as { packing: unknown }).packing === "string"
  );
}
