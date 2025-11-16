// SPEC & LAYOUT
export { defineSpec, type ParamBuilders, type MeterBuilders } from './spec/define';

export { planLayout } from './plan/layout';
export type { SpecInput } from './spec/types';

// BACKING & MEMORY
export { allocateShared } from './backing/allocate-shared';
export { allocateSharedPartitioned } from './backing/allocate-shared-partitioned';
export { allocateWasmShared } from './backing/allocate-wasm-shared';

// BINDINGS (Functions)
export { bindController } from './binding/controller';
export { bindProcessor } from './binding/processor';

// BINDINGS (Types)
export type {
  // Core binding interfaces
  ControllerBinding,
  ProcessorBinding,
  ControllerParams,
  ProcessorParams,
  ControllerMeters,
  ProcessorMeters,

  // Param value types
  ParamValueFor,
  ArrayParamView,
  ParamsView,
  CoherentParamShape,
  CoherentValue,
  ScalarParamPatch,

  // Meter value types
  MeterValueFor,
  MeterWriter,

  // Snapshot types
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

  // Utility types
  Ephemeral,
  PUSeq,
  MUSeq,
} from './binding/types';

// HANDOFF
export { buildHandoff, receiveHandoff, verifyHandoff } from './handoff/handoff';

export type { Handoff, HandoffPacking, ReceivedHandoff } from './handoff/types';

// ERRORS (runtime)
export { SeqlokError, isSeqlokError, createError } from './errors/error';

export { invariant } from './errors/invariant';
export { interpretHealth } from './errors/health';

export { getErrorMeta, getErrorMessage, isErrorCode } from './errors/registry';

// ERRORS (types)
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
