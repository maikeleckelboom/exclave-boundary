export function invariant(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    // In dev/test this should blow up loudly.
    // In production builds you can have your bundler/tree-shaker
    // replace this function with a no-op if desired.
    throw new Error(message);
  }
}

// import { invariant } from "packages/base";

const __DEV__ = true;

/**
 * Branded ticket identifier.
 *
 * - `0` is reserved for "no ticket" and cannot be constructed via this API.
 * - At the type level, you cannot accidentally pass a plain number where
 *   a `TicketId` is expected without going through `createTicketId`.
 */
declare const TicketIdBrand: unique symbol;
export type TicketId = number & { readonly [TicketIdBrand]: never };

/**
 * Construct a `TicketId` from a plain number.
 *
 * This enforces that:
 * - `id !== 0`
 * - `id` is finite
 */
export function createTicketId(id: number): TicketId {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (__DEV__) {
    invariant(Number.isFinite(id), "TicketId: id must be a finite number");

    invariant(id !== 0, 'TicketId: 0 is reserved for "no ticket"');
  }

  return id as TicketId;
}

/**
 * Phases of the hot-swap protocol for a single engine slot.
 *
 * Must be kept in sync with:
 * - C++ enum `SwapPhase` in `include/seqlok/hotswap_spec.hpp`
 * - TLA+ `phase` domain in `HotSwapProtocol.tla`
 */
export type SwapPhase =
  | "idle"
  | "spawn"
  | "prime"
  | "prewarm"
  | "crossfade"
  | "retire";

/**
 * What the caller should do in the current audio block.
 *
 * Must be kept in sync with:
 * - C++ enum `SwapStepKind` in `include/seqlok/hotswap_spec.hpp`
 */
export type SwapStepKind =
  | "idle"
  | "runCurrentOnly"
  | "runCurrentAndPrewarmNext"
  | "runBothForCrossfade"
  | "retireNow";

/**
 * Compact RT ticket: description of a swap that is safe to copy into
 * an audio-thread-owned slot (no heap, all numeric).
 */
export interface SwapTicketRT<EngineKind extends number> {
  /**
   * Host-chosen numeric ID. 0 means "no ticket".
   * Host can map this back to a string / UUID out of band.
   *
   * Enforced at the type level via `TicketId` and at runtime via
   * `createTicketId` and `initSwapStateRT`.
   */
  readonly ticketId: TicketId;

  /**
   * Enum-like numeric kind for the next engine to activate.
   */
  readonly engineKind: EngineKind;

  /**
   * Absolute frame index (in the global timebase) where the crossfade
   * should start. The protocol itself does not enforce this; it is
   * exposed so the caller can align fades to musical / transport time.
   */
  readonly atFrame: number;

  /**
   * Crossfade length in frames. Must be >= 1.
   */
  readonly fadeFrames: number;

  /**
   * Number of pre-warm blocks to run on the next engine before its
   * output is ever mixed into the final signal. Must be >= 0.
   */
  readonly preWarmBlocks: number;
}

/**
 * RT status: safe to publish from the audio thread to a introspect /
 * meter plane (numbers only, no heap allocation).
 */
export interface SwapStatusRT<EngineKind extends number> {
  readonly phase: SwapPhase;
  readonly ticketId: number; // 0 = none
  readonly progress: number; // 0..1 over the lifecycle
  readonly activeEngineKind: EngineKind;
  readonly nextEngineKind: EngineKind; // caller chooses a sentinel for "none"
}

/**
 * Internal RT state for the protocol. This is mirrored in C++ as
 * `SwapStateRT` and in the TLA+ spec as state variables.
 */
export interface SwapStateRT<EngineKind extends number> {
  phase: SwapPhase;
  hasTicket: boolean;

  ticket: SwapTicketRT<EngineKind>;

  totalFadeFrames: number;
  fadeFramesRemaining: number;
  preWarmBlocksRemaining: number;

  stepIndex: number;
  stepTotal: number;
}

/**
 * One step of the protocol: given the current RT state and current
 * block size, describe what should happen this block.
 */
export interface SwapStepDecisionRT<EngineKind extends number> {
  readonly kind: SwapStepKind;
  readonly status: SwapStatusRT<EngineKind>;
}

/**
 * Initialise RT swap state when the audio thread accepts a ticket and
 * the next engine is ready to be used.
 *
 * The actual engine handle / pointer is owned by the caller; this
 * state machine only tracks protocol phase and counters.
 */
export function initSwapStateRT<EngineKind extends number>(
  ticket: SwapTicketRT<EngineKind>,
): SwapStateRT<EngineKind> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (__DEV__) {
    invariant(
      ticket.ticketId !== 0,
      'SwapTicketRT: ticketId 0 is reserved for "no ticket"',
    );

    invariant(
      Number.isFinite(ticket.fadeFrames) && ticket.fadeFrames >= 1,
      "SwapTicketRT: fadeFrames must be >= 1",
    );

    invariant(
      Number.isFinite(ticket.preWarmBlocks) && ticket.preWarmBlocks >= 0,
      "SwapTicketRT: preWarmBlocks must be >= 0",
    );
  }

  const preWarmBlocks = ticket.preWarmBlocks;
  const totalFadeFrames = ticket.fadeFrames;

  // Used only to smooth out `progress`; does not affect semantics.
  const fadeStepsHint = 16;

  return {
    phase: "spawn",
    hasTicket: true,
    ticket,
    totalFadeFrames,
    fadeFramesRemaining: totalFadeFrames,
    preWarmBlocksRemaining: preWarmBlocks,
    stepIndex: 0,
    stepTotal: 2 + preWarmBlocks + fadeStepsHint + 1,
  };
}

/**
 * Pure RT state machine step.
 *
 * - Mutates `state` in-place.
 * - Does not allocate.
 * - Does not know about engines or audio; caller interprets `kind`.
 *
 * @param state              RT state for a single slot
 * @param blockFrames        number of frames in this block
 * @param activeKind         kind of the current engine
 * @param nextKind           kind of the next engine (or sentinel)
 * @param noneKindSentinel   sentinel representing "no next engine"
 */
export function stepSwapStateRT<EngineKind extends number>(
  state: SwapStateRT<EngineKind>,
  blockFrames: number,
  activeKind: EngineKind,
  nextKind: EngineKind,
  noneKindSentinel: EngineKind,
): SwapStepDecisionRT<EngineKind> {
  const ticketId: number = state.hasTicket ? state.ticket.ticketId : 0;
  const activeEngineKind = activeKind;
  const nextEngineKind: EngineKind =
    state.phase === "idle" || !state.hasTicket ? noneKindSentinel : nextKind;

  const progress = state.stepTotal > 0 ? state.stepIndex / state.stepTotal : 0;

  const mkStatus = (phase: SwapPhase): SwapStatusRT<EngineKind> => ({
    phase,
    ticketId,
    progress,
    activeEngineKind,
    nextEngineKind,
  });

  if (!state.hasTicket || state.phase === "idle") {
    return {
      kind: "idle",
      status: mkStatus("idle"),
    };
  }

  switch (state.phase) {
    case "spawn": {
      // New engine is already constructed and associated with this slot
      // by the caller; we simply advance the protocol.
      state.phase = "prime";
      state.stepIndex += 1;

      return {
        kind: "runCurrentOnly",
        status: mkStatus("spawn"),
      };
    }

    case "prime": {
      // First-time setup of the next engine happens in the caller when
      // this step is observed.
      state.phase = state.preWarmBlocksRemaining > 0 ? "prewarm" : "crossfade";
      state.stepIndex += 1;

      return {
        kind: "runCurrentOnly",
        status: mkStatus("prime"),
      };
    }

    case "prewarm": {
      // Caller should:
      // - run current engine normally for output
      // - run next engine in "prewarm" mode and discard its output
      state.preWarmBlocksRemaining -= 1;
      state.stepIndex += 1;

      if (state.preWarmBlocksRemaining <= 0) {
        state.phase = "crossfade";
      }

      return {
        kind: "runCurrentAndPrewarmNext",
        status: mkStatus("prewarm"),
      };
    }

    case "crossfade": {
      // Caller should:
      // - run both engines
      // - mix outputs according to a fade curve derived from fadeFramesRemaining
      state.fadeFramesRemaining = Math.max(
        0,
        state.fadeFramesRemaining - blockFrames,
      );
      state.stepIndex += 1;

      if (state.fadeFramesRemaining <= 0) {
        state.phase = "retire";
      }

      return {
        kind: "runBothForCrossfade",
        status: mkStatus("crossfade"),
      };
    }

    case "retire": {
      // Caller should:
      // - keep running current engine this block
      // - after the block, swap handles (next → current, retire current)
      // - ensure proper memory ordering before reclamation
      state.phase = "idle";
      state.hasTicket = false;
      state.stepIndex += 1;

      return {
        kind: "retireNow",
        status: mkStatus("retire"),
      };
    }

    default: {
      // Exhaustiveness guard: if a new phase is added to `SwapPhase`
      // but not handled here, this assignment will fail to type-check.

      const _exhaustive: never = state.phase;

      throw new Error(`Unhandled swap phase: ${String(_exhaustive)}`);
    }
  }
}
