/**
 * Hotswap helpers
 *
 * @remarks
 * These utilities live at the integration layer and bridge between:
 * - host/control code that schedules swaps via commands, and
 * - RT code that drives paired engines according to the hotswap protocol.
 */

/**
 * RT driver for a single hotswap slot.
 *
 * @remarks
 * - Owns the `SwapStateRT` for one logical engine pair.
 * - Exposes `acceptTicket` to install a validated `SwapTicketRT`.
 * - Exposes `stepBlock` to advance the protocol each audio block and
 *   drive the hot/cold engines and crossFade according to the protocol.
 *
 * Intended to be constructed once per lane/slot on the RT side
 * (audio worklet, audio thread, or dedicated worker), then reused
 * for the lifetime of that slot.
 */
export { createHotswapSlotDriver } from "./hotswap/slot-driver";
export type { HotswapSlotDriver } from "./hotswap/slot-driver";

/**
 * Timeline transport helpers
 *
 * @remarks
 * These utilities slice a monotonically advancing frame timeline into
 * render segments with sample-accurate command application and wire that
 * into a hotswap slot driver.
 */

export type {
  ScheduledCommandBase,
  BlockSegment,
  SlicerState,
} from "./transport/timeline-slicer";
export {
  createSlicerState,
  appendCommands,
  sliceBlock,
} from "./transport/timeline-slicer";

export type {
  TimelineCommand,
  TimelineDriver,
  TimelineProcessCallbacks,
} from "./transport/timeline-driver";
export { processTimelineBlock } from "./transport/timeline-driver";
export {
  createLaneRuntimeCore,
  type LaneRuntimeCore,
} from "./lane/runtime-core";
export {
  type EngineInstance,
  type EngineBank,
  SimpleEngineBank,
} from "./lane/engine-bank";
export {
  drainHotswapMailboxIntoTimeline,
  type HotswapDrainContext,
} from "./lane/hotswap-timeline-drain";
export type {
  LaneProcessorPlugin,
  LaneObserverPlugin,
  LanePluginPack,
} from "./lane/lane-plugins";
