/**
 * Run scenarios under a Seqlok diagnostics + health envelope.
 *
 * @remarks
 * This helper is intended for:
 * - stress / soak tests,
 * - internal CLIs / dev tools,
 * - property tests that want structured diagnostics.
 *
 * It wires together:
 * - diagnostics sessions,
 * - diagnostics counters + export,
 * - the health lens over `ErrorMeta` (via `getErrorMeta(code)`).
 *
 * Core primitives/bindings/backing do not depend on this module.
 */

import { resetDiagnosticsCounters, snapshotDiagnosticsCounters } from './counters';
import { exportDiagnosticsCounters } from './export';
import { endDiagnosticsSession, startDiagnosticsSession } from './session';
import { isSeqlokError } from '../errors/error';
import { getDocsUrl, interpretHealth, isSafeToExpose } from '../errors/health';
import { getErrorMeta } from '../errors/registry';

import type { DiagnosticsCounterName, DiagnosticsCountersSnapshot } from './counters';
import type { DiagnosticsSession } from './session';
import type { SeqlokError } from '../errors/error';
import type { HealthInterpretation } from '../errors/health';
import type { ErrorMeta } from '../errors/registry';

/**
 * Declarative thresholds for diagnostics counters.
 *
 * @remarks
 * These are intended for tests / soak runs / CI. Only counters present
 * in `DiagnosticsCountersSnapshot` are supported here.
 */
export interface DiagnosticsThresholds {
  readonly degradedSnapshots?: number;
  readonly spinBudgetExhausted?: number;
  readonly retryBudgetExhausted?: number;
}

/**
 * A single diagnostics metric that exceeded its threshold.
 */
export interface ThresholdViolation {
  readonly metric: DiagnosticsCounterName;
  readonly actual: number;
  readonly threshold: number;
}

/**
 * Result of running a scenario under diagnostics + health interpretation.
 *
 * @remarks
 * Shaped to be easy to:
 * - assert on in tests,
 * - log from CLIs,
 * - serialize to JSON.
 *
 * With `exactOptionalPropertyTypes: true` we model “maybe present” fields
 * explicitly as `T | undefined` rather than using `?`.
 */
export interface RunWithDiagnosticsResult<T> {
  readonly scenarioId: string;
  readonly metadata: Readonly<Record<string, unknown>>;

  /**
   * Value returned by the scenario when it succeeds.
   * `undefined` when the scenario fails with a SeqlokError.
   */
  readonly value: T | undefined;

  /**
   * Seqlok error thrown by the scenario, if any.
   */
  readonly error: SeqlokError | undefined;

  /**
   * Interpreted health view for the error, if any.
   */
  readonly health: HealthInterpretation | undefined;

  /**
   * Whether the error (if any) is considered safe to expose outside
   * the trust boundary.
   */
  readonly boundarySafe: boolean;

  /**
   * Optional documentation URL derived from the error metadata.
   */
  readonly docsUrl: string | undefined;

  /**
   * Diagnostics session that covered the scenario.
   */
  readonly diagnosticsSession: DiagnosticsSession;

  /**
   * Snapshot of diagnostics counters at the end of the scenario.
   */
  readonly diagnosticsCounters: DiagnosticsCountersSnapshot;

  /**
   * Diagnostics counters exported as JSON (with timestamp).
   *
   * @remarks
   * This is meant for logs / bug reports / external tooling. If a
   * different format is needed (Prometheus, CSV), use
   * `exportDiagnosticsCounters` directly.
   */
  readonly diagnosticsExportJson: string;

  /**
   * Threshold violations for diagnostics counters, if thresholds were
   * provided in the options.
   */
  readonly thresholdViolations: readonly ThresholdViolation[];
}

/**
 * Options for running a scenario under diagnostics + health.
 */
export interface RunWithDiagnosticsOptions {
  /**
   * Logical scenario identifier (e.g. "stress:load-and-scrub").
   */
  readonly scenarioId: string;

  /**
   * Optional structured metadata attached to the diagnostics session.
   */
  readonly metadata?: Record<string, unknown>;

  /**
   * Optional thresholds to check against diagnostics counters.
   *
   * @remarks
   * Violations are surfaced in `RunWithDiagnosticsResult.thresholdViolations`.
   */
  readonly thresholds?: DiagnosticsThresholds;

  /**
   * Optional hook invoked when a SeqlokError is caught.
   */
  readonly onSeqlokError?: (
    error: SeqlokError,
    health: HealthInterpretation,
    meta: ErrorMeta,
  ) => void;

  /**
   * Optional hook invoked when a non-Seqlok error is caught.
   *
   * @remarks
   * By default, non-Seqlok errors are rethrown after diagnostics
   * bookkeeping. This hook is for logging/telemetry only.
   */
  readonly onUnknownError?: (error: unknown) => void;
}

/**
 * Compute threshold violations for a diagnostics counters snapshot.
 *
 * @remarks
 * Pure helper; exported so tests/CI can reuse the logic without going
 * through `runWithDiagnostics` if they already have a snapshot.
 */
export function checkDiagnosticsThresholds(
  counters: DiagnosticsCountersSnapshot,
  thresholds: DiagnosticsThresholds | undefined,
): ThresholdViolation[] {
  if (thresholds === undefined) {
    return [];
  }

  const violations: ThresholdViolation[] = [];

  if (
    thresholds.degradedSnapshots !== undefined &&
    counters.degradedSnapshots > thresholds.degradedSnapshots
  ) {
    violations.push({
      metric: 'degradedSnapshots',
      actual: counters.degradedSnapshots,
      threshold: thresholds.degradedSnapshots,
    });
  }

  if (
    thresholds.spinBudgetExhausted !== undefined &&
    counters.spinBudgetExhausted > thresholds.spinBudgetExhausted
  ) {
    violations.push({
      metric: 'spinBudgetExhausted',
      actual: counters.spinBudgetExhausted,
      threshold: thresholds.spinBudgetExhausted,
    });
  }

  if (
    thresholds.retryBudgetExhausted !== undefined &&
    counters.retryBudgetExhausted > thresholds.retryBudgetExhausted
  ) {
    violations.push({
      metric: 'retryBudgetExhausted',
      actual: counters.retryBudgetExhausted,
      threshold: thresholds.retryBudgetExhausted,
    });
  }

  return violations;
}

/**
 * Internal helper to derive meta + health from a SeqlokError.
 */
function getMetaAndHealth(error: SeqlokError): {
  meta: ErrorMeta;
  health: HealthInterpretation;
} {
  const meta = getErrorMeta(error.code);
  const health = interpretHealth(meta);
  return { meta, health };
}

interface ErrorState {
  error: SeqlokError | undefined;
  meta: ErrorMeta | undefined;
  health: HealthInterpretation | undefined;
}

/**
 * Shared error handling for async/sync variants.
 *
 * @remarks
 * - Fills `errorState` for Seqlok errors.
 * - Invokes hooks.
 * - Rethrows non-Seqlok errors after `onUnknownError`.
 */
function handleCaughtError(
  caught: unknown,
  errorState: ErrorState,
  onSeqlokError: RunWithDiagnosticsOptions['onSeqlokError'],
  onUnknownError: RunWithDiagnosticsOptions['onUnknownError'],
): void {
  if (isSeqlokError(caught)) {
    const error = caught;
    const { meta, health } = getMetaAndHealth(error);

    errorState.error = error;
    errorState.meta = meta;
    errorState.health = health;

    if (onSeqlokError !== undefined) {
      onSeqlokError(error, health, meta);
    }
    return;
  }

  if (onUnknownError !== undefined) {
    onUnknownError(caught);
  }

  // Non-Seqlok errors are considered programmer or environment bugs.
  throw caught;
}

interface BuildResultArgs<T> {
  readonly scenarioId: string;
  readonly metadata: Record<string, unknown>;
  readonly thresholds: DiagnosticsThresholds | undefined;
  readonly startedSession: DiagnosticsSession;
  readonly completedSession: DiagnosticsSession | null;
  readonly value: T | undefined;
  readonly error: SeqlokError | undefined;
  readonly meta: ErrorMeta | undefined;
  readonly health: HealthInterpretation | undefined;
}

/**
 * Shared tail for async/sync variants.
 */
function buildRunResult<T>(args: BuildResultArgs<T>): RunWithDiagnosticsResult<T> {
  const {
    scenarioId,
    metadata,
    thresholds,
    startedSession,
    completedSession,
    value,
    error,
    meta,
    health,
  } = args;

  const diagnosticsCounters = snapshotDiagnosticsCounters();
  const diagnosticsExportJson = exportDiagnosticsCounters(diagnosticsCounters, {
    format: 'json',
    includeTimestamp: true,
  });

  const diagnosticsSession = completedSession ?? startedSession;
  const thresholdViolations = checkDiagnosticsThresholds(diagnosticsCounters, thresholds);

  return {
    scenarioId,
    metadata,
    value,
    error,
    health,
    boundarySafe: meta ? isSafeToExpose(meta) : false,
    docsUrl: meta ? getDocsUrl(meta) : undefined,
    diagnosticsSession,
    diagnosticsCounters,
    diagnosticsExportJson,
    thresholdViolations,
  };
}

/**
 * Async variant: run an async scenario under diagnostics + health.
 *
 * @remarks
 * Use this for:
 * - stress / soak tests,
 * - CLIs and dev tools,
 * - scenarios that await I/O or timers.
 */
export async function runWithDiagnostics<T>(
  run: () => Promise<T>,
  options: RunWithDiagnosticsOptions,
): Promise<RunWithDiagnosticsResult<T>> {
  const {
    scenarioId,
    metadata = {},
    thresholds,
    onSeqlokError,
    onUnknownError,
  } = options;

  resetDiagnosticsCounters();

  const startedSession = startDiagnosticsSession(scenarioId, {
    ...metadata,
  });

  let value: T | undefined;
  const errorState: ErrorState = {
    error: undefined,
    meta: undefined,
    health: undefined,
  };
  let completedSession: DiagnosticsSession | null;

  try {
    value = await run();
  } catch (caught: unknown) {
    handleCaughtError(caught, errorState, onSeqlokError, onUnknownError);
  } finally {
    completedSession = endDiagnosticsSession();
  }

  return buildRunResult<T>({
    scenarioId,
    metadata,
    thresholds,
    startedSession,
    completedSession,
    value,
    error: errorState.error,
    meta: errorState.meta,
    health: errorState.health,
  });
}

/**
 * Sync variant: run a synchronous scenario under diagnostics + health.
 *
 * @remarks
 * Use this for:
 * - benchmarks,
 * - property tests (fast-check),
 * - tight synchronous stress loops.
 */
export function runWithDiagnosticsSync<T>(
  run: () => T,
  options: RunWithDiagnosticsOptions,
): RunWithDiagnosticsResult<T> {
  const {
    scenarioId,
    metadata = {},
    thresholds,
    onSeqlokError,
    onUnknownError,
  } = options;

  resetDiagnosticsCounters();

  const startedSession = startDiagnosticsSession(scenarioId, {
    ...metadata,
  });

  let value: T | undefined;
  const errorState: ErrorState = {
    error: undefined,
    meta: undefined,
    health: undefined,
  };
  let completedSession: DiagnosticsSession | null;

  try {
    value = run();
  } catch (caught: unknown) {
    handleCaughtError(caught, errorState, onSeqlokError, onUnknownError);
  } finally {
    completedSession = endDiagnosticsSession();
  }

  return buildRunResult<T>({
    scenarioId,
    metadata,
    thresholds,
    startedSession,
    completedSession,
    value,
    error: errorState.error,
    meta: errorState.meta,
    health: errorState.health,
  });
}
