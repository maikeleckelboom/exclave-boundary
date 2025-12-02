/**
 * @fileoverview
 * Introspect public surface.
 *
 * @remarks
 * - Re-exports environment helpers, counters, and view-description tools.
 * - Intended for dev tooling, HUDs, and stress harnesses, not hot-path code.
 * - Safe to tree-shake out in production builds if unused.
 */
export {
  createIntrospectBudgets,
  DEFAULT_INTROSPECT_BUDGETS,
  type IntrospectBudgets,
  validateIntrospectBudgets,
} from "./budgets";

export {
  type IntrospectCounterName,
  type IntrospectCounters,
  type IntrospectCountersSnapshot,
  incrementCounter,
  resetCounters,
  setCounter,
  snapshotCounters,
} from "./counters";

export {
  exportIntrospectCounters,
  type IntrospectExportFormat,
  type IntrospectExportOptions,
} from "./export";

export {
  enableIntrospectFeature,
  enableIntrospectFeatureByName,
  isIntrospectFeatureEnabled,
  listEnabledIntrospectFeatures,
  resetIntrospectFeatures,
  type IntrospectFeatureName,
} from "./features";

export {
  installCoreIntrospectSink,
  recordIntrospectCounter,
  type CoreIntrospectCounterName,
  type CoreIntrospectEventContext,
  type CoreIntrospectSink,
} from "./hooks";

export {
  startIntrospectSession,
  endIntrospectSession,
  getActiveIntrospectSession,
  getIntrospectSessionDuration,
  type IntrospectSession,
} from "./session";

export {
  type ThresholdViolation,
  runWithIntrospectSync,
  runWithIntrospect,
  checkIntrospectThresholds,
  type RunWithIntrospectOptions,
  type IntrospectThresholds,
  type RunWithIntrospectResult,
} from "./run-with-health";

export {
  type ErrorRegistrySchema,
  exportErrorRegistryJsonSchema,
  ERROR_REGISTRY_JSON_SCHEMA,
  type ErrorCodeSchema,
  type ErrorMetaSchema,
  type JsonSchemaDocument,
  type DomainSchema,
  type RegistryStats,
} from "./errors/export-json";

export type { AggregatedErrorDescriptor } from "./errors/descriptors";
export { listErrors, computeNumericCode } from "./errors/all-domains";

export {
  type SubsetSelectionCriteria,
  type ErrorSubset,
  type SelectedDomain,
  selectErrorSubset,
} from "./errors/subset-selection";

export {
  type ExportedError,
  type ExportedDomain,
  type ErrorRegistryJson,
  buildErrorRegistryJson,
  buildFullErrorRegistryJson,
} from "./errors/registry-export";
