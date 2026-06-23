// File: packages/core/src/binding/processor/index.ts

/**
 * @fileoverview
 * Public processor binding factory.
 *
 * @remarks
 * - Bridges `AcceptedHandoff` + Backing into a typed `ProcessorBinding`.
 * - For use in workers/worklets where the full spec is not available.
 * - Delegates to the low-level implementation with the plan from handoff.
 */

import { processorImpl } from "./impl";

import type { Backing } from "../../backing/types";
import type { AcceptedHandoff } from "../../handoff/types";
import type { SpecInput } from "../../spec/types";
import type { ProcessorBinding, ProcessorOptions } from "../common/types";

/**
 * Public processor binding.
 *
 * Use this in workers/worklets or same-thread processors where the spec
 * value is not available. The `accepted.plan` carries all layout information.
 *
 * @template S - Spec type (inferred from AcceptedHandoff<S>)
 * @param accepted - Validated handoff from acceptHandoff()
 * @param options - Optional processor configuration
 * @returns Typed processor binding
 *
 * @example
 * ```ts
 * // Worker side:
 * import { acceptHandoff, bindProcessor } from '@seqlok-internal/prototype-core';
 * import type { MySpec } from './spec';  // type-only import
 *
 * type InitMessage = { handoff: Handoff<MySpec> };
 *
 * self.onmessage = (ev: MessageEvent<InitMessage>) => {
 *   const accepted = acceptHandoff(ev.data.handoff);
 *   //    ^? AcceptedHandoff<MySpec>
 *
 *   const proc = bindProcessor(accepted);
 *   //    ^? ProcessorBinding<MySpec> ✓
 * };
 * ```
 */
export function bindProcessor<const S extends SpecInput>(
  accepted: AcceptedHandoff<S>,
  options: ProcessorOptions = {},
): ProcessorBinding<S> {
  const backing: Backing =
    accepted.packing === "shared"
      ? {
          kind: "shared",
          sab: accepted.sab,
        }
      : {
          kind: "shared-partitioned",
          planes: accepted.planes,
        };

  return processorImpl(accepted.plan, backing, options);
}
