/**
 * @fileoverview
 * Public processor binding factory.
 *
 * @remarks
 * Binds a processor to shared state using one of two input shapes:
 * - **Handoff / ReceivedHandoff / SharedContext**: ergonomic entrypoints for remote and host.
 * - **(spec, plan, backing)**: explicit low-level wiring (tests/custom hosts).
 *
 * A typed `Handoff<S>` can be passed directly; it is validated via `receiveHandoff`.
 * Argument misuse throws `binding.invalidArgs`.
 */

import { processorImpl } from "./impl";
import { isSharedContext } from "../../context/guard";
import { receiveHandoff } from "../../handoff/handoff";
import { throwInvalidBindingArgs } from "../common/arg-errors";
import {
  backingFromReceived,
  isHandoff,
  isReceivedHandoff,
} from "../common/handoff-source";

import type { Backing } from "../../backing/types";
import type { SharedContext } from "../../context/types";
import type { Handoff, ReceivedHandoff } from "../../handoff/types";
import type { Plan } from "../../plan/types";
import type { SpecInput } from "../../spec/types";
import type { ProcessorBinding, ProcessorOptions } from "../common/types";

interface NormalizedProcessorSource<S extends SpecInput> {
  readonly plan: Plan<S>;
  readonly backing: Backing;
}

/**
 * Bind a processor from a high-level source.
 *
 * @remarks
 * This overload is designed for worker/worklet entrypoints where the Spec may be unavailable.
 * The plan embedded in the handoff is sufficient to wire reads/writes.
 */
export function bindProcessor<const S extends SpecInput>(
  source: Handoff<S> | ReceivedHandoff<S> | SharedContext<S>,
  options?: ProcessorOptions,
): ProcessorBinding<S>;

/**
 * Bind a processor from explicit inputs.
 *
 * @remarks
 * This form is useful in tests, custom hosts, or when you are composing processors
 * around a plan/backing that you already manage.
 */
export function bindProcessor<const S extends SpecInput>(
  spec: S,
  plan: Plan<S>,
  backing: Backing,
  options?: ProcessorOptions,
): ProcessorBinding<S>;

/**
 * Implementation of bindProcessor overload dispatch.
 */
export function bindProcessor<const S extends SpecInput>(
  arg1: Handoff<S> | ReceivedHandoff<S> | SharedContext<S> | S,
  arg2?: ProcessorOptions | Plan<S>,
  arg3?: Backing,
  arg4?: ProcessorOptions,
): ProcessorBinding<S> {
  const { plan, backing } = normalizeSource(arg1, arg2, arg3);
  const options = getOptions(arg1, arg2, arg4) ?? {};
  return processorImpl(plan, backing, options);
}

function normalizeSource<const S extends SpecInput>(
  arg1: Handoff<S> | ReceivedHandoff<S> | SharedContext<S> | S,
  arg2?: ProcessorOptions | Plan<S>,
  arg3?: Backing,
): NormalizedProcessorSource<S> {
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
    };
  }

  const plan = arg2 as Plan<S> | undefined;
  if (plan === undefined) {
    throwInvalidBindingArgs("bindProcessor", "missingPlan");
  }

  if (arg3 === undefined) {
    throwInvalidBindingArgs("bindProcessor", "missingBacking");
  }

  return {
    plan,
    backing: arg3,
  };
}

function normalizeFromReceived<const S extends SpecInput>(
  received: ReceivedHandoff<S>,
): NormalizedProcessorSource<S> {
  return {
    plan: received.plan,
    backing: backingFromReceived(received),
  };
}

function getOptions<const S extends SpecInput>(
  arg1: Handoff<S> | ReceivedHandoff<S> | SharedContext<S> | S,
  arg2?: ProcessorOptions | Plan<S>,
  arg4?: ProcessorOptions,
): ProcessorOptions | undefined {
  if (isHandoff(arg1) || isReceivedHandoff(arg1) || isSharedContext(arg1)) {
    return arg2 as ProcessorOptions | undefined;
  }

  return arg4;
}
