/**
 * @fileoverview
 * Public controller binding factory.
 *
 * @remarks
 * Binds a controller to shared state using one of two input shapes:
 * - **SharedContext**: the usual host-side path where the Spec is available.
 * - **(spec, plan, backing)**: an explicit low-level path for advanced wiring/tests.
 *
 * Argument misuse (e.g. missing backing in the explicit form) throws `binding.invalidArgs`.
 */

import { controllerImpl } from "./impl";
import { isSharedContext } from "../../context/guard";
import { throwInvalidBindingArgs } from "../common/arg-errors";
import { getParamDefs } from "../common/param-defs";

import type { Backing } from "../../backing/types";
import type { SharedContext } from "../../context/types";
import type { Plan } from "../../plan/types";
import type { SpecInput } from "../../spec/types";
import type { ParamDefs } from "../common/param-defs";
import type { ControllerBinding, ControllerOptions } from "../common/types";

interface NormalizedControllerSource<S extends SpecInput> {
  readonly plan: Plan<S>;
  readonly backing: Backing;
  readonly defs: ParamDefs;
}

/**
 * Bind a controller from a SharedContext.
 *
 * @remarks
 * This is the standard host-side entrypoint. The Spec is available, so param defs
 * are used for range policy and enum label support.
 */
export function bindController<const S extends SpecInput>(
  context: SharedContext<S>,
  options?: ControllerOptions,
): ControllerBinding<S>;

/**
 * Bind a controller from explicit inputs.
 *
 * @remarks
 * This form is useful in tests, custom hosts, or when you are composing bindings
 * around a plan/backing that you already manage.
 */
export function bindController<const S extends SpecInput>(
  spec: S,
  plan: Plan<S>,
  backing: Backing,
  options?: ControllerOptions,
): ControllerBinding<S>;

/**
 * Implementation of bindController overload dispatch.
 */
export function bindController<const S extends SpecInput>(
  arg1: SharedContext<S> | S,
  arg2?: ControllerOptions | Plan<S>,
  arg3?: Backing,
  arg4?: ControllerOptions,
): ControllerBinding<S> {
  const { plan, backing, defs } = normalizeSource(arg1, arg2, arg3);
  const options = getOptions(arg1, arg2, arg4);
  return controllerImpl(plan, backing, defs, options);
}

function normalizeSource<const S extends SpecInput>(
  arg1: SharedContext<S> | S,
  arg2?: ControllerOptions | Plan<S>,
  arg3?: Backing,
): NormalizedControllerSource<S> {
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
    throwInvalidBindingArgs("bindController", "missingPlan");
  }

  if (arg3 === undefined) {
    throwInvalidBindingArgs("bindController", "missingBacking");
  }

  return {
    plan,
    backing: arg3,
    defs: getParamDefs(spec),
  };
}

function getOptions<const S extends SpecInput>(
  arg1: SharedContext<S> | S,
  arg2?: ControllerOptions | Plan<S>,
  arg4?: ControllerOptions,
): ControllerOptions | undefined {
  if (isSharedContext(arg1)) {
    return arg2 as ControllerOptions | undefined;
  }

  return arg4;
}
