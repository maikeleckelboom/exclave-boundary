/**
 * @fileoverview
 * Argument errors for public binding factories.
 *
 * @remarks
 * These helpers are used when a caller selects an overload shape but fails to provide
 * required arguments (e.g. missing backing in the (spec, plan, backing) form).
 *
 * These are API misuse errors and should be surfaced as typed binding-domain errors.
 */
import { createBindingError } from "../../errors/binding";

export type BindingFactoryFn =
  | "bindController"
  | "bindObserver"
  | "bindProcessor";
export type BindingInvalidArgsReason = "missingPlan" | "missingBacking";

const SIGNATURES: Record<BindingFactoryFn, string> = {
  bindController: "bindController(spec, plan, backing, options?)",
  bindObserver: "bindObserver(spec, plan, backing, options?)",
  bindProcessor: "bindProcessor(spec, plan, backing, options?)",
};

export function throwInvalidBindingArgs(
  fn: BindingFactoryFn,
  reason: BindingInvalidArgsReason,
): never {
  throw createBindingError("invalidArgs", {
    fn,
    reason,
    signature: SIGNATURES[fn],
  });
}
