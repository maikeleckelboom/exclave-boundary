/**
 * @fileoverview
 * Core module for Seqlok - Shared memory synchronization for real-time applications.
 *
 * @remarks
 * - Re-exports all public APIs for the @seqlok-internal/prototype-core package.
 * - Organized into logical sections: SPEC, PLAN, BACKING, BINDING, HANDOFF, and ERRORS.
 * - This is the main entry point for consumers of the library.
 */

// SPEC
export {
  defineSpec,
  type ParamBuilders,
  type MeterBuilders,
} from "./spec/define";
export type { SpecInput } from "./spec/types";

// PLAN
export { planLayout } from "./plan/layout";

// BACKING
export { allocateShared } from "./backing/allocate-shared";
export { allocateSharedPartitioned } from "./backing/allocate-shared-partitioned";
export { allocateWasmShared } from "./backing/allocate-wasm-shared";

// BINDING
export { bindController } from "./binding/controller";
export { bindProcessor } from "./binding/processor";
export { bindObserver } from "./binding/observer";

// BINDING TYPES
export type {
  ControllerBinding,
  ProcessorBinding,
  ObserverBinding,
  ControllerParams,
  ProcessorParams,
  ObserverParams,
  ControllerMeters,
  ProcessorMeters,
  ObserverMeters,
  ParamValueFor,
  ScalarParamPatch,
  MeterValueFor,
  ParamsSnapshot,
  MetersSnapshot,
  SnapshotParamsObject,
  SnapshotMetersObject,
  SnapshotParamsOptions,
  SnapshotMetersOptions,
  IntoForParams,
  IntoForMeters,
  ControllerOptions,
  ProcessorOptions,
  ObserverOptions,
  RangePolicy,
} from "./binding/common/types";

// HANDOFF
export { buildHandoff, receiveHandoff, verifyHandoff } from "./handoff/handoff";
export type { Handoff, HandoffPacking, ReceivedHandoff } from "./handoff/types";

// ERRORS
export { SeqlokError, isSeqlokError } from "./errors/error";
export { getErrorMeta, getErrorMessage, isErrorCode } from "./errors/registry";
export { interpretHealth } from "./errors/health";

// ERROR TYPES
export type {
  ErrorCode,
  ErrorPayload,
  ErrorDetails,
  ErrorMeta,
  HealthInterpretation,
} from "./errors/types";

// ENUM UTILITIES
export {
  enumArrayToLabels,
  enumIndexFromLabel,
  enumLabelFromIndex,
  enumValues,
  enumLabelsToArray,
  enumPaletteFor,
  type EnumLabel,
  type EnumKeyOf,
} from "./spec/enums";

// TYPE UTILITIES
export type {
  ParamValues,
  MeterValues,
  ProcessorParamView,
  ProcessorMeterView,
  SnapshotOf,
  SnapshotMetersOf,
} from "./types";

// PRIMITIVES
export {
  SWSR_HEADER_WORDS,
  SWSR_HEADER_WRITE_INDEX,
  SWSR_HEADER_READ_INDEX,
  SWSR_HEADER_WRITE_SEQ,
  SWSR_HEADER_DROPPED,
  allocateSwsrRing,
  bindSwsrRingProducer,
  bindSwsrRingConsumer,
} from "./primitives/swsr-ring";

export type {
  SwsrRingLayout,
  SwsrRingBacking,
  SwsrRingEncode,
  SwsrRingDecode,
  SwsrRingProducer,
  SwsrRingConsumer,
  SwsrRingStats,
} from "./primitives/swsr-ring";

// CONTEXT
export type { SharedContext } from "./context/types";
export { createSharedContext } from "./context/create";
