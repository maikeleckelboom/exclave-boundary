/**
 * @fileoverview
 * Public observer binding factory.
 *
 * @remarks
 * Binds a read-only observer to shared state using one of two input shapes:
 * - **Handoff / ReceivedHandoff**: remote-side friendly; Spec is typically unavailable.
 * - **SharedContext / (spec, plan, backing)**: host-side friendly; Spec is available.
 *
 * When the Spec is not available, param defs are empty and enum values remain numeric.
 * Argument misuse throws `binding.invalidArgs`.
 */

import { observerImpl } from "./impl";
import { isSharedContext } from "../../context/guard";
import { receiveHandoff } from "../../handoff/handoff";
import { throwInvalidBindingArgs } from "../common/arg-errors";
import {
  backingFromReceived,
  isHandoff,
  isReceivedHandoff,
} from "../common/handoff-source";
import { getParamDefs } from "../common/param-defs";

import type { Backing } from "../../backing/types";
import type { SharedContext } from "../../context/types";
import type { Handoff, ReceivedHandoff } from "../../handoff/types";
import type { Plan } from "../../plan/types";
import type { SpecInput } from "../../spec/types";
import type { ParamDefs } from "../common/param-defs";
import type { ObserverBinding, ObserverOptions } from "../common/types";

/**
 * Bind an observer from a high-level source.
 *
 * @remarks
 * - `SharedContext` surfaces host-side richness via Spec param defs.
 * - `Handoff` / `ReceivedHandoff` binds from the embedded plan and shared memory only.
 */
export function bindObserver<const S extends SpecInput>(
  source: Handoff<S> | ReceivedHandoff<S> | SharedContext<S>,
  options?: ObserverOptions,
): ObserverBinding<S>;

/**
 * Bind an observer from explicit inputs.
 *
 * @remarks
 * This form is useful in tests, custom hosts, or when you are composing bindings
 * around a plan/backing that you already manage.
 */
export function bindObserver<const S extends SpecInput>(
  spec: S,
  plan: Plan<S>,
  backing: Backing,
  options?: ObserverOptions,
): ObserverBinding<S>;

/**
 * Implementation of bindObserver overload dispatch.
 */
export function bindObserver<const S extends SpecInput>(
  arg1: Handoff<S> | ReceivedHandoff<S> | SharedContext<S> | S,
  arg2?: ObserverOptions | Plan<S>,
  arg3?: Backing,
  arg4?: ObserverOptions,
): ObserverBinding<S> {
  const { plan, backing, defs } = normalizeSource(arg1, arg2, arg3);
  const options = getOptions(arg1, arg2, arg4);
  return observerImpl(plan, backing, defs, options);
}

function normalizeSource<const S extends SpecInput>(
  arg1: Handoff<S> | ReceivedHandoff<S> | SharedContext<S> | S,
  arg2?: ObserverOptions | Plan<S>,
  arg3?: Backing,
): {
  readonly plan: Plan<S>;
  readonly backing: Backing;
  readonly defs: ParamDefs;
} {
  if (isHandoff(arg1)) {
    return normalizeFromReceived(receiveHandoff(arg1));
  }

  if (isReceivedHandoff(arg1)) {
    return normalizeFromReceived(arg1);
  }

  if (isSharedContext(arg1)) {
    return {
      plan: arg1.plan,
      backing: arg1.backing,
      defs: getParamDefs(arg1.spec),
    };
  }

  const spec = arg1;
  const plan = arg2 as Plan<S> | undefined;

  if (plan === undefined) {
    throwInvalidBindingArgs("bindObserver", "missingPlan");
  }

  if (arg3 === undefined) {
    throwInvalidBindingArgs("bindObserver", "missingBacking");
  }

  return {
    plan,
    backing: arg3,
    defs: getParamDefs(spec),
  };
}

function normalizeFromReceived<const S extends SpecInput>(
  received: ReceivedHandoff<S>,
): {
  readonly plan: Plan<S>;
  readonly backing: Backing;
  readonly defs: ParamDefs;
} {
  return {
    plan: received.plan,
    backing: backingFromReceived(received),
    defs: getParamDefs(undefined),
  };
}

function getOptions<const S extends SpecInput>(
  arg1: Handoff<S> | ReceivedHandoff<S> | SharedContext<S> | S,
  arg2?: ObserverOptions | Plan<S>,
  arg4?: ObserverOptions,
): ObserverOptions | undefined {
  if (isHandoff(arg1) || isReceivedHandoff(arg1) || isSharedContext(arg1)) {
    return arg2 as ObserverOptions | undefined;
  }

  return arg4;
}
