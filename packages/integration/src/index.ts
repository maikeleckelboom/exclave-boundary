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
 * Configuration for {@link scheduleSwap}.
 *
 * @typeParam EngineKind - Numeric engine-kind discriminator used by the host.
 * @typeParam Command - Concrete command union carried over the command ring.
 *
 * @remarks
 * Binds the generic scheduler to:
 * - a specific mailbox (`mailboxId`, `producer`), and
 * - a concrete "install swap" command encoder.
 */
export type { HotswapSchedulerConfig } from "./hotswap/schedule-swap";

/**
 * Host-side helper to schedule a hotswap.
 *
 * @typeParam EngineKind - Numeric engine-kind discriminator used by the host.
 * @typeParam Command - Concrete command union carried over the command ring.
 *
 * @remarks
 * Responsibilities:
 * - Dry-runs `initSwapStateRT` off the audio thread to validate tickets.
 * - Raises `hotswap.invalidTicket` for protocol violations.
 * - Encodes and pushes an "install swap" command into the mailbox.
 * - Maps transport failures to `commands.*` errors
 *   (e.g. `commands.mailboxClosed`, `commands.ringOverflow`).
 *
 * This function is intended for host/control code, not for audio callbacks.
 */
export { scheduleSwap } from "./hotswap/schedule-swap";

/**
 * Timeline transport helpers
 *
 * @remarks
 * These utilities slice a monotonically advancing frame timeline into
 * render segments with sample-accurate command application and wire that
 * into a hotswap slot driver.
 */

// Pure slicer primitives (timeline-agnostic)
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

// Timeline + hotswap wiring
export type {
  TimelineCommand,
  TimelineDriver,
  TimelineProcessCallbacks,
} from "./transport/timeline-driver";
export { processTimelineBlock } from "./transport/timeline-driver";
