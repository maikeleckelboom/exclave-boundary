/**
 * @fileoverview
 * Run scenarios under a Seqlok introspect + health envelope.
 *
 * @remarks
 * This helper is intended for:
 * - stress / soak tests,
 * - internal CLIs / dev tools,
 * - property tests that want structured introspect.
 *
 * It wires together:
 * - introspect sessions,
 * - introspect counters + export,
 * - the health lens over `ErrorMeta` (via `getErrorMeta(code)`).
 *
 * Core primitives/bindings/backing do not depend on this module.
 */

import {
  type ErrorMeta,
  type HealthInterpretation,
  interpretHealth,
  getDocsUrl,
  isBoundarySafe,
  isSeqlokError,
  type SeqlokError,
} from "@seqlok/base";

import { resetCounters, snapshotCounters } from "./counters";
import { exportIntrospectCounters } from "./export";
import { endIntrospectSession, startIntrospectSession } from "./session";

import type {
  IntrospectCounterName,
  IntrospectCountersSnapshot,
} from "./counters";
import type { IntrospectSession } from "./session";

/**
 * Declarative thresholds for introspect counters.
 *
 * @remarks
 * These are intended for tests / soak runs / CI. Only counters present
 * in `IntrospectCountersSnapshot` are supported here.
 */
export interface IntrospectThresholds {
  readonly degradedSnapshots?: number;
  readonly spinBudgetExhausted?: number;
  readonly retryBudgetExhausted?: number;
}

/**
 * A single introspect metric that exceeded its threshold.
 */
export interface ThresholdViolation {
  readonly metric: IntrospectCounterName;
  readonly actual: number;
  readonly threshold: number;
}

/**
 * Result of running a scenario under introspect + health interpretation.
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
export interface RunWithIntrospectResult<T> {
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
   * Introspect session that covered the scenario.
   */
  readonly introspectSession: IntrospectSession;

  /**
   * Snapshot of introspect counters at the end of the scenario.
   */
  readonly introspectCounters: IntrospectCountersSnapshot;

  /**
   * Introspect counters exported as JSON (with timestamp).
   *
   * @remarks
   * This is meant for logs / bug reports / external tooling. If a
   * different format is needed (Prometheus, CSV), use
   * `exportIntrospectCounters` directly.
   */
  readonly introspectExportJson: string;

  /**
   * Threshold violations for introspect counters, if thresholds were
   * provided in the options.
   */
  readonly thresholdViolations: readonly ThresholdViolation[];
}

/**
 * Options for running a scenario under introspect + health.
 */
export interface RunWithIntrospectOptions {
  /**
   * Logical scenario identifier (e.g. "stress:load-and-scrub").
   */
  readonly scenarioId: string;

  /**
   * Optional structured metadata attached to the introspect session.
   */
  readonly metadata?: Record<string, unknown>;

  /**
   * Optional thresholds to check against introspect counters.
   *
   * @remarks
   * Violations are surfaced in `RunWithIntrospectResult.thresholdViolations`.
   */
  readonly thresholds?: IntrospectThresholds;

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
   * By default, non-Seqlok errors are rethrown after introspect
   * bookkeeping. This hook is for logging/introspect only.
   */
  readonly onUnknownError?: (error: unknown) => void;
}

/**
 * Compute threshold violations for a introspect counters snapshot.
 *
 * @remarks
 * Pure helper; exported so tests/CI can reuse the logic without going
 * through `runWithIntrospect` if they already have a snapshot.
 */
export function checkIntrospectThresholds(
  counters: IntrospectCountersSnapshot,
  thresholds: IntrospectThresholds | undefined,
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
      metric: "degradedSnapshots",
      actual: counters.degradedSnapshots,
      threshold: thresholds.degradedSnapshots,
    });
  }

  if (
    thresholds.spinBudgetExhausted !== undefined &&
    counters.spinBudgetExhausted > thresholds.spinBudgetExhausted
  ) {
    violations.push({
      metric: "spinBudgetExhausted",
      actual: counters.spinBudgetExhausted,
      threshold: thresholds.spinBudgetExhausted,
    });
  }

  if (
    thresholds.retryBudgetExhausted !== undefined &&
    counters.retryBudgetExhausted > thresholds.retryBudgetExhausted
  ) {
    violations.push({
      metric: "retryBudgetExhausted",
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
  const health = interpretHealth(error.meta);
  return { meta: error.meta, health };
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
  onSeqlokError: RunWithIntrospectOptions["onSeqlokError"],
  onUnknownError: RunWithIntrospectOptions["onUnknownError"],
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
  readonly thresholds: IntrospectThresholds | undefined;
  readonly startedSession: IntrospectSession;
  readonly completedSession: IntrospectSession | null;
  readonly value: T | undefined;
  readonly error: SeqlokError | undefined;
  readonly meta: ErrorMeta | undefined;
  readonly health: HealthInterpretation | undefined;
}

/**
 * Shared tail for async/sync variants.
 */
function buildRunResult<T>(
  args: BuildResultArgs<T>,
): RunWithIntrospectResult<T> {
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

  const introspectCounters = snapshotCounters();
  const introspectExportJson = exportIntrospectCounters(introspectCounters, {
    format: "json",
    includeTimestamp: true,
  });

  const introspectSession = completedSession ?? startedSession;
  const thresholdViolations = checkIntrospectThresholds(
    introspectCounters,
    thresholds,
  );

  return {
    scenarioId,
    metadata,
    value,
    error,
    health,
    boundarySafe: meta ? isBoundarySafe(meta) : false,
    docsUrl: meta ? getDocsUrl(meta) : undefined,
    introspectSession: introspectSession,
    introspectCounters: introspectCounters,
    introspectExportJson: introspectExportJson,
    thresholdViolations,
  };
}

/**
 * Async variant: run an async scenario under introspect + health.
 *
 * @remarks
 * Use this for:
 * - stress / soak tests,
 * - CLIs and dev tools,
 * - scenarios that await I/O or timers.
 */
export async function runWithIntrospect<T>(
  run: () => Promise<T>,
  options: RunWithIntrospectOptions,
): Promise<RunWithIntrospectResult<T>> {
  const {
    scenarioId,
    metadata = {},
    thresholds,
    onSeqlokError,
    onUnknownError,
  } = options;

  resetCounters();

  const startedSession = startIntrospectSession(scenarioId, {
    ...metadata,
  });

  let value: T | undefined;
  const errorState: ErrorState = {
    error: undefined,
    meta: undefined,
    health: undefined,
  };
  let completedSession: IntrospectSession | null;

  try {
    value = await run();
  } catch (caught: unknown) {
    handleCaughtError(caught, errorState, onSeqlokError, onUnknownError);
  } finally {
    completedSession = endIntrospectSession();
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
 * Sync variant: run a synchronous scenario under introspect + health.
 *
 * @remarks
 * Use this for:
 * - benchmarks,
 * - property tests (fast-check),
 * - tight synchronous stress loops.
 */
export function runWithIntrospectSync<T>(
  run: () => T,
  options: RunWithIntrospectOptions,
): RunWithIntrospectResult<T> {
  const {
    scenarioId,
    metadata = {},
    thresholds,
    onSeqlokError,
    onUnknownError,
  } = options;

  resetCounters();

  const startedSession = startIntrospectSession(scenarioId, {
    ...metadata,
  });

  let value: T | undefined;
  const errorState: ErrorState = {
    error: undefined,
    meta: undefined,
    health: undefined,
  };
  let completedSession: IntrospectSession | null;

  try {
    value = run();
  } catch (caught: unknown) {
    handleCaughtError(caught, errorState, onSeqlokError, onUnknownError);
  } finally {
    completedSession = endIntrospectSession();
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
