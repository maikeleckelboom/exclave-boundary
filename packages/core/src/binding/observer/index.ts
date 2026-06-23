/**
 * @fileoverview
 * Public observer binding factory.
 *
 * @remarks
 * - Bridges `AcceptedHandoff` or `SharedContext` into a typed `ObserverBinding`.
 * - Host-side (context/spec) observers can surface rich shapes (e.g. enum labels).
 * - Worker-side (handoff) observers fall back to numeric enum indices.
 * - Can be used in the same thread as the Controller OR in workers.
 * - Safe to have multiple observers on the same handoff.
 */

import { observerImpl } from "./impl";
import { isSharedContext } from "../../context/guard";

import type { Backing } from "../../backing/types";
import type { SharedContext } from "../../context/types";
import type { AcceptedHandoff } from "../../handoff/types";
import type { Plan } from "../../plan/types";
import type { ParamDef, SpecInput } from "../../spec/types";
import type { ObserverBinding, ObserverOptions } from "../common/types";

const EMPTY_PARAM_DEFS: Readonly<Record<string, ParamDef>> = {};

/**
 * Bind a read-only observer to the shared state (Worker / Handoff variant).
 *
 * @remarks
 * - Used in AudioWorklets or Workers receiving a handoff.
 * - Enums are surfaced as raw numeric indices because the full Spec definition
 *   (and thus label strings) is not present in the Handoff.
 */
export function bindObserver<S extends SpecInput>(
  accepted: AcceptedHandoff<S>,
  options?: ObserverOptions,
): ObserverBinding<S>;

/**
 * Bind a read-only observer to the shared state (Host / Context variant).
 *
 * @remarks
 * - Used on the main thread where `SharedContext` is available.
 * - Enums are surfaced as string labels because the Spec is available.
 */

export function bindObserver<S extends SpecInput>(
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  context: SharedContext<S>,
  options?: ObserverOptions,
): ObserverBinding<S>;

/**
 * Bind a read-only observer to the shared state (Host / Explicit variant).
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
  arg1: AcceptedHandoff<S> | SharedContext<S> | S,
  arg2?: ObserverOptions | Plan<S>,
  arg3?: Backing,
  arg4?: ObserverOptions,
): ObserverBinding<S> {
  // Case 1: AcceptedHandoff (Worker / remote side)
  if (isAcceptedHandoff<S>(arg1)) {
    const accepted = arg1;
    const options = arg2 as ObserverOptions | undefined;

    const backing: Backing =
      accepted.packing === "shared"
        ? { kind: "shared", sab: accepted.sab }
        : {
            kind: "shared-partitioned",
            planes: accepted.planes,
          };

    // No spec on the remote side: enums remain numeric indices.
    return observerImpl(accepted.plan, backing, EMPTY_PARAM_DEFS, options);
  }

  // Case 2: SharedContext (Host ergonomic)
  if (isSharedContext<S>(arg1)) {
    const ctx = arg1;
    const options = arg2 as ObserverOptions | undefined;
    const defs: Readonly<Record<string, ParamDef>> = ctx.spec.params ?? {};

    return observerImpl(ctx.plan, ctx.backing, defs, options);
  }

  // Case 3: Explicit triple (Host low-level)
  const spec = arg1;
  const plan = arg2 as Plan<S>;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const backing = arg3!;
  const options = arg4;
  const defs: Readonly<Record<string, ParamDef>> = spec.params ?? {};

  return observerImpl(plan, backing, defs, options);
}

function isAcceptedHandoff<S extends SpecInput>(
  value: AcceptedHandoff<S> | SharedContext<S> | S,
): value is AcceptedHandoff<S> {
  return (
    typeof value === "object" &&
    "packing" in value &&
    typeof (value as { packing: unknown }).packing === "string"
  );
}
