/**
 * @fileoverview
 * Public controller binding factory.
 *
 * @remarks
 * - Bridges `defineSpec` + Plan + Backing into a typed `ControllerBinding`.
 * - Matches the explicit golden flow:
 *
 *   defineSpec → planLayout → allocateShared → buildHandoff →
 *   receiveHandoff → bindController / bindProcessor
 *
 * - The binding layer does not perform planning; callers are responsible
 *   for computing the Plan via `planLayout(spec)` and allocating a Backing
 *   from that Plan.
 */

import { controllerImpl } from "./impl";
import { isSharedContext } from "../../context/guard";

export type { SharedContext } from "../../context/types";

import type { Backing } from "../../backing/types";
import type { SharedContext } from "../../context/types";
import type { Plan } from "../../plan/types";
import type { SpecInput } from "../../spec/types";
import type { ControllerBinding, ControllerOptions } from "../common/types";

/**
 * Bind a controller to a backing using an explicit Plan.
 *
 * @typeParam S - Spec type (inferred from `spec`)
 *
 * @param context
 * @param options - Optional controller configuration.
 *
 * @returns A typed controller binding for the given spec/plan/backing triple.
 *
 * @remarks
 * - This is the canonical controller API in `@seqlok-internal/prototype-core`.
 * - The caller is responsible for:
 *   - Computing the plan once via `planLayout(spec)`.
 *   - Allocating a compatible backing via `allocateShared(plan)` (or a
 *     different backing factory that consumes `Plan<S>`).
 *   - Passing the same `spec`/`plan`/`backing` triple here.
 * - The binding layer does not re-derive layouts; mismatched
 *   spec/plan/backing triples are a contract violation.
 */
// 1) Host ergonomic: SharedContext
export function bindController<const S extends SpecInput>(
  context: SharedContext<S>,
  options?: ControllerOptions,
): ControllerBinding<S>;

// 2) Host low-level: explicit triple (existing public surface)
export function bindController<const S extends SpecInput>(
  spec: S,
  plan: Plan<S>,
  backing: Backing,
  options?: ControllerOptions,
): ControllerBinding<S>;

// 3) Implementation
export function bindController<const S extends SpecInput>(
  arg1: SharedContext<S> | S,
  arg2?: ControllerOptions | Plan<S>,
  arg3?: Backing,
  arg4?: ControllerOptions,
): ControllerBinding<S> {
  if (isSharedContext<S>(arg1)) {
    const ctx = arg1;
    const options = arg2 as ControllerOptions | undefined;
    const params = ctx.spec.params ?? {};
    return controllerImpl(ctx.plan, ctx.backing, params, options);
  }

  const spec = arg1;
  const plan = arg2 as Plan<S>;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const backing = arg3!;
  const options = arg4;
  const params = spec.params ?? {};

  return controllerImpl(plan, backing, params, options);
}
