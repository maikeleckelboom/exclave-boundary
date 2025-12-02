/**
 * @fileoverview
 * Public entry point for @seqlok/primitives.
 *
 * @remarks
 * - Currently exposes the primitives error domain (codes + factory).
 * - Future: this is also where seqlock/SWSR/etc. primitives will be exported.
 */

export type {
  PrimitivesErrorCode,
  PrimitivesErrorKey,
  PrimitivesErrorFactory,
  PrimitivesErrorDetailsByKey,
  PrimitivesSeqlockTimeoutDetails,
  PrimitivesSwsrRingInvalidLayoutDetails,
  PrimitivesPlaneUnalignedDetails,
  PrimitivesAtomicsFailedDetails,
  PrimitivesInvalidSpinBudgetDetails,
  PrimitivesDomain,
  PrimitivesErrorsMap,
} from "./errors/primitives";

export {
  PRIMITIVES_ERRORS,
  PRIMITIVES_DOMAIN,
  createPrimitivesError,
} from "./errors/primitives";

export type {
  SeqPair,
  ReadStatus,
  TryReadOptions,
  TryReadResult,
} from "./seqlock";
export {
  tryRead,
  createSeqPair,
  publish,
  beginWrite,
  endWrite,
} from "./seqlock";

export { ALL_PLANES, BYTES_PER_ELEM, roundUpTo, type PlaneKey } from "./planes";
export { addU32, loadU32, spinUntilEven } from "./atomics";
export {
  SWSR_HEADER_DROPPED,
  SWSR_HEADER_WORDS,
  SWSR_HEADER_READ_INDEX,
  SWSR_HEADER_WRITE_INDEX,
  SWSR_HEADER_WRITE_SEQ,
  allocateSwsrRing,
  bindSwsrRingConsumer,
  bindSwsrRingProducer,
} from "./swsr-ring";
export type {
  SwsrRingBacking,
  SwsrRingDecode,
  SwsrRingConsumer,
  SwsrRingEncode,
  SwsrRingLayout,
  SwsrRingProducer,
  SwsrRingStats,
} from "./swsr-ring";
