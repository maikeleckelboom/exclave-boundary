import type {
  SpecInput,
  ObserverBinding,
  ProcessorBinding,
} from "@seqlok/core";

export interface LaneObserverPlugin<S extends SpecInput> {
  readonly id: string;

  /**
   * Optional hook to wire observer-side behavior.
   *
   * Called once after the `ObserverBinding` is created from a `ReceivedHandoff`.
   * Plugin can:
   * - start polling snapshots
   * - register listeners
   * - hook into a UI store, etc.
   */
  readonly attachObserver?: (observer: ObserverBinding<S>) => void;
}

export interface LaneProcessorPlugin<S extends SpecInput> {
  readonly id: string;

  /**
   * Called once after `ProcessorBinding` is created in the worklet/worker.
   *
   * Plugin returns a small handle with a `processBlock` function that
   * will be invoked per audio block by the lane host.
   */
  readonly attachProcessor: (binding: ProcessorBinding<S>) => {
    readonly processBlock: (
      inputL: Float32Array,
      inputR: Float32Array,
      outputL: Float32Array,
      outputR: Float32Array,
    ) => void;
    readonly dispose?: () => void;
  };
}

export interface LanePluginPack<S extends SpecInput> {
  readonly observers: readonly LaneObserverPlugin<S>[];
  readonly processors: readonly LaneProcessorPlugin<S>[];
}
