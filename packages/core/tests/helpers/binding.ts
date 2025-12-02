import {
  allocateShared,
  bindController,
  bindProcessor,
  buildHandoff,
  planLayout,
  receiveHandoff,
  type ControllerBinding,
  type ProcessorBinding,
} from "../../src";

import type { SharedBacking } from "../../src/backing/types";
import type {
  ControllerOptions,
  ProcessorOptions,
} from "../../src/binding/common/types";
import type { Handoff, ReceivedHandoff } from "../../src/handoff/types";
import type { Plan } from "../../src/plan/types";
import type { SpecInput } from "../../src/spec/types";

export interface BoundPair<S extends SpecInput> {
  readonly spec: S;
  readonly plan: Plan<S>;
  readonly backing: SharedBacking;
  readonly handoff: Handoff<S>;
  readonly received: ReceivedHandoff<S>;
  readonly ctl: ControllerBinding<S>;
  readonly proc: ProcessorBinding<S>;
}

/**
 * Test-only convenience:
 * Spec → Plan → Allocate → Handoff → Bind₁ (controller) → Bind₂ (processor)
 */
export function bindingsFromSpec<S extends SpecInput>(
  spec: S,
  options?: {
    readonly controller?: ControllerOptions;
    readonly processor?: ProcessorOptions;
  },
): BoundPair<S> {
  const plan = planLayout(spec);
  const backing = allocateShared(plan);
  const handoff = buildHandoff(plan, backing);
  const received = receiveHandoff(handoff);

  const ctl = bindController(spec, plan, backing, options?.controller);
  const proc = bindProcessor(received, options?.processor);

  return { spec, plan, backing, handoff, received, ctl, proc };
}
