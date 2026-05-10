import { bindObserver, bindProcessor } from "@seqlok/core";

import { createLaneRuntimeCore } from "./runtime-core";

import type { EngineInstance } from "./engine-bank";
import type { LaneKind } from "./lane-kind";
import type { LaneRuntimeCore } from "./runtime-core";
import type {
  Handoff,
  ObserverBinding,
  ProcessorBinding,
  AcceptedHandoff,
  SharedContext,
  SpecInput,
} from "@seqlok/core";

export type LaneBindSource<S extends SpecInput> =
  | AcceptedHandoff<S>
  | Handoff<S>
  | SharedContext<S>;

/**
 * Options for mounting a lane kind on the RT side (AudioWorklet / worker).
 *
 * @remarks
 * - `mailboxId` is passed through to `createLaneRuntimeCore` so the lane
 *   can receive hotswap commands via the shared mailbox.
 * - `source` may be a `Handoff`, `AcceptedHandoff`, or `SharedContext`.
 *   We bind observer/processor directly from it (core handles normalization).
 */
export interface MountLaneOptions<S extends SpecInput> {
  readonly mailboxId: string;
  readonly source: LaneBindSource<S>;
}

/**
 * Mounted lane handle.
 *
 * @remarks
 * - Exposes the `LaneRuntimeCore` for transport/hotswap plumbing.
 * - Exposes observer + processor bindings for direct param/meter access.
 * - Aggregates all processor plugins into a single `processBlock` function.
 */
export interface MountedLane<
  S extends SpecInput,
  EngineKindEnum extends number,
> {
  readonly laneKindId: string;

  readonly runtime: LaneRuntimeCore<EngineKindEnum>;
  readonly observer: ObserverBinding<S>;
  readonly processor: ProcessorBinding<S>;

  /**
   * Invoke all processor plugins for a single audio block.
   *
   * @remarks
   * - All plugins see the same I/O buffers and can mutate them in-place.
   * - In the common case there is a single processor plugin.
   */
  readonly processBlock: (
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
  ) => void;

  /**
   * Dispose processor-side plugin handles, in reverse registration order.
   */
  readonly dispose: () => void;
}

interface ProcessorHandle {
  readonly processBlock: (
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
  ) => void;
  readonly dispose?: () => void;
}

/**
 * Mount a lane kind against a bindable source and mailbox id.
 *
 * @remarks
 * - Intended to be called on the RT side (AudioWorklet / worker).
 * - Creates `ObserverBinding` + `ProcessorBinding` from the provided source.
 * - Wires all observer plugins once.
 * - Wires all processor plugins once and aggregates their `processBlock`.
 * - Creates a `LaneRuntimeCore` for this lane so transport/hotswap can be layered on top.
 */
export function mountLane<
  S extends SpecInput,
  TConfig,
  EngineKindEnum extends number,
  Command,
  EventPayload,
  TInstance extends EngineInstance<EngineKindEnum>,
>(
  laneKind: LaneKind<
    S,
    TConfig,
    EngineKindEnum,
    Command,
    EventPayload,
    TInstance
  >,
  options: MountLaneOptions<S>,
): MountedLane<S, EngineKindEnum> {
  const { mailboxId, source } = options;

  const runtime = createLaneRuntimeCore<EngineKindEnum>(mailboxId);

  const observer = bindObserver<S>(source);
  const processor = bindProcessor<S>(source);

  for (const plugin of laneKind.plugins.observers) {
    plugin.attachObserver?.(observer);
  }

  const processorHandles: ProcessorHandle[] = laneKind.plugins.processors.map(
    (plugin) => plugin.attachProcessor(processor),
  );

  const processBlock = (
    inputL: Float32Array,
    inputR: Float32Array,
    outputL: Float32Array,
    outputR: Float32Array,
  ): void => {
    for (const handle of processorHandles) {
      handle.processBlock(inputL, inputR, outputL, outputR);
    }
  };

  const dispose = (): void => {
    for (let i = processorHandles.length - 1; i >= 0; i -= 1) {
      const handle = processorHandles[i];
      handle?.dispose?.();
    }
  };

  return {
    laneKindId: laneKind.id,
    runtime,
    observer,
    processor,
    processBlock,
    dispose,
  };
}
