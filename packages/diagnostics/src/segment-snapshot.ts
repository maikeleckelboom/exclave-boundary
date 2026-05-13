declare const __brand: unique symbol;

/**
 * Opaque lifecycle phase identifier.
 *
 * @remarks
 * Introspect does not define the meaning of these ids.
 * Producers define the mapping; consumers may render them however they like.
 */
export type PhaseId = number & { readonly [__brand]: "PhaseId" };

/**
 * Opaque engine kind identifier.
 *
 * @remarks
 * Introspect does not define the meaning of these ids.
 * Producers define the mapping; consumers may render them however they like.
 */
export type EngineKindId = number & { readonly [__brand]: "EngineKindId" };

export function phaseId(value: number): PhaseId {
  return (value >>> 0) as PhaseId;
}

export function engineKindId(value: number): EngineKindId {
  return (value >>> 0) as EngineKindId;
}

/**
 * Segment snapshot flags bitfield.
 *
 * @remarks
 * These are generic observability bits (not engine-specific).
 */
export type SegmentSnapshotFlags = number;

export const SegmentSnapshotFlag: {
  outputNonFinite: number;
  overrun: number;
  transitionActive: number;
  inputGuardFailed: number;
} = {
  outputNonFinite: 1 << 0,
  overrun: 1 << 1,
  transitionActive: 1 << 2,
  inputGuardFailed: 1 << 3,
} satisfies Readonly<Record<string, number>>;

export interface SegmentSnapshot {
  readonly frame: number;
  readonly segmentIndex: number;
  readonly segmentOffsetFrames: number;
  readonly segmentFrames: number;

  readonly phase: PhaseId;
  readonly fadeStartFrame: number;
  readonly fadeEndFrame: number;

  readonly activeEngine: EngineKindId;
  readonly nextEngine: EngineKindId;
  readonly latencyPadFrames: number;

  readonly inputHashLo: number;
  readonly inputHashHi: number;

  readonly outRmsL: number;
  readonly outRmsR: number;
  readonly outPeakL: number;
  readonly outPeakR: number;

  readonly flags: SegmentSnapshotFlags;
  readonly overrunMicros: number;
}
