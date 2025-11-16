/**
 * Controller binding (main/UI agent) - public API shim.
 *
 * This is the thin public interface that:
 * - Accepts a SpecInput
 * - Calls planLayout(spec) to compute the memory plan
 * - Delegates to controllerImpl(plan, backing, options)
 *
 * Mirrors processor.ts architecture for consistency.
 *
 * Features:
 * - Scalar param writes with range enforcement ('reject' | 'clamp')
 * - Array param staging via zero-copy subarray views
 * - Param/meter snapshots with optional { keys, into } for zero-alloc reads
 *
 * v1 coherence: controller snapshots are single-pass best-effort.
 */

import { controllerImpl } from './controller.impl';
import { planLayout } from '../plan/layout';

import type { ControllerBinding, ControllerOptions } from './types';
import type { Backing } from '../backing/types';
import type { ParamDef, SpecInput } from '../spec/types';

/**
 * Bind a controller to a backing.
 *
 * @template S - Spec type (inferred from spec)
 * @param spec - Spec definition from defineSpec()
 * @param backing - Memory backing
 * @param options - Optional controller configuration
 * @returns Typed controller binding
 *
 * @remarks
 * - One successful commit (set/update/stage) → exactly one PU bump.
 * - All validation happens before `publish`, so failures never bump PU.
 * - `version()` reads the commit counter; no parity check needed on the controller side.
 *
 * @example
 * ```ts
 * import { defineSpec, bindController, allocateShared } from '@seqlok/core';
 *
 * const spec = defineSpec(({ param, meter }) => ({
 *   id: 'demo',
 *   params: {
 *     gain: param.f32({ min: 0, max: 1 }),
 *   },
 *   meters: {
 *     rms: meter.f32(),
 *   },
 * }));
 *
 * const plan = planLayout(spec);
 * const backing = allocateShared(plan);
 * const controller = bindController(spec, backing);
 *
 * // Set a scalar param
 * controller.params.set('gain', 0.5);
 *
 * // Update multiple params atomically
 * controller.params.update({ gain: 0.8 });
 *
 * // Read meters
 * const meters = controller.meters.snapshot();
 * console.log(meters.rms);
 *
 * // Check versions
 * const paramVersion = controller.params.version();
 * const meterVersion = controller.meters.version();
 * ```
 */
export function bindController<const S extends SpecInput>(
  spec: S,
  backing: Backing,
  options: ControllerOptions = {},
): ControllerBinding<S> {
  const plan = planLayout(spec);
  const defs: Readonly<Record<string, ParamDef>> = spec.params ?? {};
  return controllerImpl(plan, backing, defs, options);
}
