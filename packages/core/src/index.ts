// SPEC
export { defineSpec, type ParamBuilders, type MeterBuilders } from './spec/define';
export type { SpecInput } from './spec/types';

// PLAN
export { planLayout } from './plan/layout';

// BACKING
export { allocateShared } from './backing/allocate-shared';
export { allocateSharedPartitioned } from './backing/allocate-shared-partitioned';
export { allocateWasmShared } from './backing/allocate-wasm-shared';

// BINDING
export { bindController } from './binding/controller';
export { bindProcessor } from './binding/processor';

// BINDING TYPES
export type {
  // Core binding interfaces
  ControllerBinding,
  ProcessorBinding,
  ControllerParams,
  ProcessorParams,
  ControllerMeters,
  ProcessorMeters,

  // Param value
  ParamValueFor,
  ScalarParamPatch,

  // Meter value
  MeterValueFor,

  // Snapshot
  FullParamsSnapshot,
  FullMetersSnapshot,
  SnapshotParamsObject,
  SnapshotMetersObject,
  SnapshotParamsOptions,
  SnapshotMetersOptions,
  IntoForParams,
  IntoForMeters,

  // Options
  ControllerOptions,
  ProcessorOptions,
  RangePolicy,
} from './binding/types';

// HANDOFF
export { buildHandoff, receiveHandoff, verifyHandoff } from './handoff/handoff';
export type { Handoff, HandoffPacking, ReceivedHandoff } from './handoff/types';

// ERRORS
export { SeqlokError, isSeqlokError, createError } from './errors/error';
export { getErrorMeta, getErrorMessage, isErrorCode } from './errors/registry';
export { interpretHealth } from './errors/health';

// ERROR TYPES
export type {
  ErrorCode,
  ErrorPayload,
  ErrorDetails,
  ErrorMeta,
  TypedArrayName,
  HealthInterpretation,
} from './errors/types';

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
} from './spec/enums';

// TYPE UTILITIES
export type {
  ParamValues,
  MeterValues,
  ProcessorParamView,
  ProcessorMeterView,
  SnapshotOf,
  SnapshotMetersOf,
} from './types';
