/**
 * @fileoverview
 * Public processor binding factory.
 *
 * @remarks
 * - Bridges `ReceivedHandoff` + Backing into a typed `ProcessorBinding`.
 * - For use in workers/worklets where the full spec is not available.
 * - Delegates to the low-level implementation with the plan from handoff.
 */

import { processorImpl } from "./impl";

import type { Backing } from "../../backing/types";
import type { ReceivedHandoff } from "../../handoff/types";
import type { SpecInput } from "../../spec/types";
import type { ProcessorBinding, ProcessorOptions } from "../common/types";

/**
 * Public processor binding.
 *
 * Use this in workers/worklets or same-thread processors where the spec
 * value is not available. The `received.plan` carries all layout information.
 *
 * @template S - Spec type (inferred from ReceivedHandoff<S>)
 * @param received - Validated handoff from receiveHandoff()
 * @param options - Optional processor configuration
 * @returns Typed processor binding
 *
 * @example
 * ```ts
 * // Worker side:
 * import { receiveHandoff, bindProcessor } from '@seqlok/core';
 * import type { MySpec } from './spec';  // type-only import
 *
 * type InitMessage = { handoff: Handoff<MySpec> };
 *
 * self.onmessage = (ev: MessageEvent<InitMessage>) => {
 *   const received = receiveHandoff(ev.data.handoff);
 *   //    ^? ReceivedHandoff<MySpec>
 *
 *   const proc = bindProcessor(received);
 *   //    ^? ProcessorBinding<MySpec> ✓
 * };
 * ```
 */
export function bindProcessor<const S extends SpecInput>(
  received: ReceivedHandoff<S>,
  options: ProcessorOptions = {},
): ProcessorBinding<S> {
  const backing: Backing =
    received.packing === "shared"
      ? {
          kind: "shared",
          sab: received.sab,
        }
      : {
          kind: "shared-partitioned",
          planes: received.planes,
        };

  return processorImpl(received.plan, backing, options);
}
